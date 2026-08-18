import { mix } from './distribution';
import { baseFairValue, makeEnhanceSalvage, prepareProblem } from './salvage';
import {
  ACTION_DONE,
  ACTION_INFEASIBLE,
  ACTION_RESTART_BASE,
  gridIndex,
  makeAxes,
  type Axes,
  type Problem,
} from './types';

export interface CostSolution {
  /** 새 무기를 사는 순간부터 목표 달성까지의 총 기대비용 */
  expectedCost: number;
  /** 처음 사야 할 베이스 매물의 인덱스 */
  bestBaseIndex: number;
  /** C[u][a] — 그 상태에서 목표까지 남은 기대비용 */
  cost: Float64Array;
  /** π[u][a] — 최적 행동 (types.ts 의 인코딩) */
  policy: Uint8Array;
  axes: Axes;
  /** 완성품을 시장에서 바로 사는 값. 시세 표가 목표까지 안 닿으면 Infinity. */
  finishedPrice: number;
  /** 이 해가 실제로 쓴 회수 가치 함수. 같은 문제의 변형끼리 비교할 땐 이걸 맞춰야 한다. */
  salvageAt: (slotsLeft: number, attack: number) => number;
  /** 'market' 이론가 그대로 / 'none' 시세가 앞뒤가 안 맞아 되팔이를 껐음 */
  salvageMode: 'market' | 'none';
  feasible: boolean;
  /** 되팔이만으로 돈이 무한히 불어나는 입력이라 최소비용이 정의되지 않는 경우 */
  arbitrage: boolean;
  warnings: string[];
}

/** 문제 하나를 푸는 데 필요한, R 에 무관한 상수들. */
interface Context {
  axes: Axes;
  salvage: (u: number, a: number) => number;
  allowRestart: boolean;
}

/**
 * 모드 A — 목표 공격력 달성까지의 기대비용을 최소화하는 정책을 구한다.
 *
 * 재시작 항에 시작 상태의 값 R 이 다시 등장하므로 R 은 고정점 문제다. R 을 고정하면
 * 나머지는 업횟 오름차순 한 번의 스윕으로 끝나니, 바깥에서 R 만 맞추면 된다.
 *
 * f(R) = "R 을 가정하고 한 번 스윕했을 때 나오는 시작 상태 값" 은 비감소이고 기울기가
 * 1 이하다(손절 확률 < 1). 따라서 R=0 에서 시작해 R ← f(R) 을 반복하면 단조 증가하며
 * **최소** 고정점으로 수렴한다. 수렴이 느릴 수 있어 Aitken Δ² 로 가속하되, 고정점을
 * 지나치면(f(R) < R) 가속값을 버린다.
 *
 * 정책 반복은 쓰지 않는다. R 이 아직 낮은 중간 단계에서 "영원히 손절"이라는 부적절한
 * 정책이 최적으로 보여 손절 확률이 1 로 붙어 버린다.
 *
 * "완성품을 그냥 산다"는 합성 매물(prepareProblem)로 매물 목록에 들어와 있어, 시작
 * 선택지로도 손절 후 갈아탈 대상으로도 자동으로 비교된다.
 */
export function solveMinCost(input: Problem): CostSolution {
  const problem = prepareProblem(input);
  const axes = makeAxes(problem);
  const { salvage, finishedPrice } = makeEnhanceSalvage(problem);
  const warnings: string[] = [];

  const ctx: Context = { axes, salvage, allowRestart: problem.allowRestart };
  const finish = (
    partial: Pick<CostSolution, 'expectedCost' | 'bestBaseIndex' | 'cost' | 'policy'> &
      Partial<CostSolution>,
  ): CostSolution => ({
    axes,
    finishedPrice,
    salvageAt: ctx.salvage,
    salvageMode: 'market',
    feasible: true,
    arbitrage: false,
    warnings,
    ...partial,
  });

  const maxGain = Math.max(...problem.scrolls.map((s) => s.attackGain), 0);
  const reachableByScrolling =
    Math.max(...problem.baseOptions.map((b) => b.offset)) + problem.maxSlots * maxGain >=
    problem.target;

  if (!reachableByScrolling && !Number.isFinite(finishedPrice)) {
    const empty = sweep(problem, { ...ctx, allowRestart: false }, 0);
    warnings.push(
      `목표 +${problem.target} 은 업횟 ${problem.maxSlots}회로 도달할 수 없습니다. ` +
        '목표를 낮추거나 업횟이 더 많은 아이템을 쓰세요.',
    );
    return finish({
      expectedCost: Number.POSITIVE_INFINITY,
      bestBaseIndex: 0,
      cost: empty.cost,
      policy: empty.policy,
      feasible: false,
    });
  }
  if (!reachableByScrolling) {
    warnings.push(
      `목표 +${problem.target} 은 업횟 ${problem.maxSlots}회로 직접 만들 수 없어 ` +
        '완성품 구매만이 답입니다.',
    );
  }

  if (!problem.allowRestart) {
    const single = sweep(problem, ctx, 0);
    const start = startValue(problem, axes, single.cost);
    if (!Number.isFinite(start.value)) {
      warnings.push(
        '손절을 금지하면 확률형 주문서로는 목표 달성을 보장할 수 없어 기대비용이 무한대입니다. ' +
          '예산 모드로 달성 확률을 보세요.',
      );
    }
    return finish({
      expectedCost: start.value,
      bestBaseIndex: start.index,
      cost: single.cost,
      policy: single.policy,
    });
  }

  let salvageMode: CostSolution['salvageMode'] = 'market';
  let solved = iterateValue(problem, ctx, axes);

  if (solved.diverged) {
    // 되팔이만으로 돈이 느는 입력이다. 원인은 거의 언제나 "매물이 이론가보다 싸다".
    // 되팔이를 아예 꺼서 확실히 수렴시키고, 무엇이 이상한지 짚어 준다.
    for (const base of problem.baseOptions) {
      if (base.synthetic) continue;
      const fair = baseFairValue(problem, salvage, base);
      if (fair > base.price) {
        warnings.push(
          `${base.label ?? `공${base.offset}`} 매물이 이론가 ` +
            `${Math.round(fair).toLocaleString('ko-KR')}메소보다 싸게 입력됐습니다 — ` +
            '사서 강화하는 것만으로 이득이 나는 값이라 최소비용이 정의되지 않습니다.',
        );
      }
    }
    warnings.push('아래 수치는 되팔이를 전혀 인정하지 않은 보수적 상한입니다.');
    ctx.salvage = () => 0;
    salvageMode = 'none';
    solved = iterateValue(problem, ctx, axes);
  }

  if (solved.diverged) {
    const nonSelling = sweep(problem, { ...ctx, allowRestart: false }, 0);
    warnings.push('입력한 시세로는 최소 기대비용이 정의되지 않습니다. 시세 입력을 확인해 주세요.');
    return finish({
      expectedCost: Number.NEGATIVE_INFINITY,
      bestBaseIndex: startValue(problem, axes, nonSelling.cost).index,
      cost: nonSelling.cost,
      policy: nonSelling.policy,
      salvageMode,
      arbitrage: true,
    });
  }

  const final = sweep(problem, ctx, solved.value);
  const start = startValue(problem, axes, final.cost);

  // 재시작 시 사는 매물은 언제나 R 을 만들어낸 그 매물이다.
  for (let i = 0; i < final.policy.length; i++) {
    if (final.policy[i] === ACTION_RESTART_BASE) {
      final.policy[i] = ACTION_RESTART_BASE + start.index;
    }
  }

  return finish({
    expectedCost: start.value,
    bestBaseIndex: start.index,
    cost: final.cost,
    policy: final.policy,
    salvageMode,
  });
}

/**
 * R ← f(R) 단조 반복으로 최소 고정점을 찾는다.
 * f(0) 이 0 이하면 손절만으로 돈이 느는 시세라 최소비용이 아래로 발산한다.
 */
function iterateValue(
  problem: Problem,
  ctx: Context,
  axes: Axes,
): { value: number; diverged: boolean } {
  const f = (r: number) => startValue(problem, axes, sweep(problem, ctx, r).cost).value;

  const first = f(0);
  if (!(first > 0) || !Number.isFinite(first)) return { value: Number.NaN, diverged: true };

  let R = 0;
  for (let i = 0; i < 300; i++) {
    const r1 = f(R);
    const r2 = f(r1);
    const d1 = r1 - R;
    const d2 = r2 - r1;

    let next = r2;
    const denom = d1 - d2;
    if (denom > 1e-12) {
      const accelerated = R + (d1 * d1) / denom;
      // 고정점을 지나쳤으면 f(x) < x 가 된다. 그때는 가속값을 버린다.
      if (accelerated > r2 && Number.isFinite(accelerated) && f(accelerated) >= accelerated) {
        next = accelerated;
      }
    }

    if (Math.abs(next - R) <= 1e-10 * Math.max(1, next)) return { value: next, diverged: false };
    R = next;
  }
  return { value: R, diverged: false };
}

/** R 을 고정한 채 C[u][a] 를 채운다. */
function sweep(
  problem: Problem,
  ctx: Context,
  restartTotal: number,
): { cost: Float64Array; policy: Uint8Array } {
  const { axes, salvage, allowRestart } = ctx;
  const { maxSlots, attackMin, attackMax, span } = axes;
  const cost = new Float64Array((maxSlots + 1) * span);
  const policy = new Uint8Array((maxSlots + 1) * span);
  const scrolls = problem.scrolls;

  for (let u = 0; u <= maxSlots; u++) {
    for (let a = attackMin; a <= attackMax; a++) {
      const i = u * span + (a - attackMin);

      if (a >= problem.target) {
        cost[i] = 0;
        policy[i] = ACTION_DONE;
        continue;
      }

      let best = Number.POSITIVE_INFINITY;
      let bestAction = ACTION_INFEASIBLE;

      if (u > 0) {
        const missIdx = (u - 1) * span + (a - attackMin);
        for (let s = 0; s < scrolls.length; s++) {
          const sc = scrolls[s];
          const hit = cost[gridIndex(axes, u - 1, a + sc.attackGain)];
          const v = sc.price + sc.successRate * hit + (1 - sc.successRate) * cost[missIdx];
          if (v < best) {
            best = v;
            bestAction = s;
          }
        }
      }

      // 손절은 마지막에 본다. 동점이면 주문서 쪽을 남겨 순환 위험을 피한다.
      if (allowRestart) {
        const v = restartTotal - salvage(u, a);
        if (v < best) {
          best = v;
          bestAction = ACTION_RESTART_BASE;
        }
      }

      cost[i] = best;
      policy[i] = Number.isFinite(best) ? bestAction : ACTION_INFEASIBLE;
    }
  }

  return { cost, policy };
}

/**
 * R = min over 베이스 매물 v 의 (매물가 + C[U][offset_v])
 *
 * 리버스 무기처럼 시작 공격력이 랜덤이면 그 분포로 섞는다. 합성 매물(완성품 직접 구매)은
 * 이미 목표를 만족한 물건이라 레벨업 분포를 타지 않는다.
 */
function startValue(
  problem: Problem,
  axes: Axes,
  cost: Float64Array,
): { value: number; index: number } {
  let best = Number.POSITIVE_INFINITY;
  let index = 0;
  problem.baseOptions.forEach((base, i) => {
    const bonus = base.synthetic ? null : problem.startBonus;
    const v =
      base.price +
      mix(bonus, (delta) => cost[gridIndex(axes, problem.maxSlots, base.offset + delta)]);
    if (v < best) {
      best = v;
      index = i;
    }
  });
  return { value: best, index };
}
