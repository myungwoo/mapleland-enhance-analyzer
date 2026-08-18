import { mix } from './distribution';
import { tickCost } from './grid';
import { makeEnhanceSalvage, prepareProblem } from './salvage';
import {
  ACTION_DONE,
  ACTION_INFEASIBLE,
  ACTION_RESTART_BASE,
  decodeAction,
  gridIndex,
  makeAxes,
  type Action,
  type Axes,
  type Problem,
} from './types';

export interface BudgetOptions {
  /** 총 예산 (메소) */
  budget: number;
  /** 예산 축 이산화 칸 수. 클수록 정확하고 느리다. */
  ticks?: number;
}

export interface BudgetSolution {
  /** 전액 예산으로 목표를 달성할 확률 */
  successProbability: number;
  /** curve[b] = 예산 b*tick 으로 달성할 확률 (첫 매물 구매비 포함) */
  curve: Float64Array;
  tick: number;
  ticks: number;
  axes: Axes;
  /** 전액 예산 기준, 지금 사야 할 매물과 첫 주문서 */
  firstBaseIndex: number;
  firstAction: Action;
  warnings: string[];
  /** 임의 상태의 최적 행동 조회 */
  actionAt: (slotsLeft: number, attack: number, remainingBudget: number) => Action;
}

/**
 * 모드 C — 예산이 유한할 때 목표 달성 확률을 최대화하는 정책.
 *
 * 주문서는 업횟을 반드시 1 소비하므로 같은 예산 칸 안에서도 u 오름차순이면
 * 참조가 앞서 계산된 값만 향한다. 재시작만 업횟을 되돌리므로 최소 1틱을
 * 소비하도록 강제해 예산 축의 순환을 끊었다. 결과적으로 b 오름차순 한 번의
 * 스윕으로 정확히 풀린다.
 */
export function solveMaxSuccess(input: Problem, options: BudgetOptions): BudgetSolution {
  const problem = prepareProblem(input);
  const ticks = options.ticks ?? 2000;
  const tick = options.budget / ticks;
  if (tick <= 0 || !Number.isFinite(tick)) {
    throw new Error('예산은 0보다 큰 유한한 값이어야 합니다.');
  }

  const axes = makeAxes(problem);
  const { salvage } = makeEnhanceSalvage(problem);
  const warnings: string[] = [];

  const { maxSlots, attackMin, attackMax, span } = axes;
  const planeSize = (maxSlots + 1) * span;
  const prob = new Float32Array(planeSize * (ticks + 1));
  const policy = new Uint8Array(planeSize * (ticks + 1));

  const scrolls = problem.scrolls;
  const scrollTicks = scrolls.map((s) => tickCost(s.price, tick));
  const buyTicks = problem.baseOptions.map((b) => tickCost(b.price, tick, 1));

  /**
   * 매물 v 를 산 직후의 값. 리버스 무기처럼 시작 공격력이 랜덤이면 분포로 섞는다.
   * 합성 매물(완성품 직접 구매)은 이미 목표를 만족한 물건이라 분포를 타지 않는다.
   */
  const valueAfterBuying = (plane: number, v: number) => {
    const base = problem.baseOptions[v];
    return mix(base.synthetic ? null : problem.startBonus, (delta) =>
      prob[plane + gridIndex(axes, maxSlots, base.offset + delta)],
    );
  };
  // 재시작 순비용은 (u, a) 마다 달라지므로 상태별로 계산한다.

  for (let b = 0; b <= ticks; b++) {
    const base = b * planeSize;
    for (let u = 0; u <= maxSlots; u++) {
      for (let a = attackMin; a <= attackMax; a++) {
        const i = base + u * span + (a - attackMin);

        if (a >= problem.target) {
          prob[i] = 1;
          policy[i] = ACTION_DONE;
          continue;
        }

        let best = 0;
        let bestAction = ACTION_INFEASIBLE;

        if (u > 0) {
          const hitOffset = (aa: number) => gridIndex(axes, u - 1, aa);
          const missOffset = (u - 1) * span + (a - attackMin);
          for (let s = 0; s < scrolls.length; s++) {
            const sc = scrolls[s];
            const t = scrollTicks[s];
            const hitIdx = hitOffset(a + sc.attackGain);
            let v = 0;
            if (b >= t.lo) {
              const p = (b - t.lo) * planeSize;
              v += (1 - t.pHi) * (sc.successRate * prob[p + hitIdx] + (1 - sc.successRate) * prob[p + missOffset]);
            }
            if (t.pHi > 0 && b >= t.hi) {
              const p = (b - t.hi) * planeSize;
              v += t.pHi * (sc.successRate * prob[p + hitIdx] + (1 - sc.successRate) * prob[p + missOffset]);
            }
            if (v > best) {
              best = v;
              bestAction = s;
            }
          }
        }

        // 손절 후 새 매물 구매 (완성품 직접 구매도 합성 매물로 여기 들어 있다)
        const recovered = problem.allowRestart ? salvage(u, a) : 0;
        for (let v = 0; problem.allowRestart && v < problem.baseOptions.length; v++) {
          // 예산 축은 음수 지출을 표현하지 못한다. 회수액이 새 매물값을 넘는 만큼은
          // 재투자되지 않는 것으로 보수적으로 처리한다.
          const t = tickCost(Math.max(0, problem.baseOptions[v].price - recovered), tick, 1);
          let value = 0;
          if (b >= t.lo) value += (1 - t.pHi) * valueAfterBuying((b - t.lo) * planeSize, v);
          if (t.pHi > 0 && b >= t.hi) value += t.pHi * valueAfterBuying((b - t.hi) * planeSize, v);
          if (value > best) {
            best = value;
            bestAction = ACTION_RESTART_BASE + v;
          }
        }

        prob[i] = best;
        policy[i] = bestAction;
      }
    }
  }

  // 첫 매물 구매까지 포함한 예산-달성확률 곡선
  const curve = new Float64Array(ticks + 1);
  let firstBaseIndex = 0;
  for (let b = 0; b <= ticks; b++) {
    let best = 0;
    let bestBase = 0;
    for (let v = 0; v < problem.baseOptions.length; v++) {
      const t = buyTicks[v];
      let value = 0;
      if (b >= t.lo) value += (1 - t.pHi) * valueAfterBuying((b - t.lo) * planeSize, v);
      if (t.pHi > 0 && b >= t.hi) value += t.pHi * valueAfterBuying((b - t.hi) * planeSize, v);
      if (value > best) {
        best = value;
        bestBase = v;
      }
    }
    curve[b] = best;
    if (b === ticks) firstBaseIndex = bestBase;
  }

  // 시작 공격력이 랜덤이면 첫 수도 굴림 결과에 달렸다. 가장 흔한 굴림을 대표로 쓴다.
  const likelyBonus = problem.startBonus?.length
    ? problem.startBonus.reduce((a, b) => (b.probability > a.probability ? b : a)).value
    : 0;
  const budgetAfterBuy = ticks - buyTicks[firstBaseIndex].lo;
  const firstAction: Action =
    budgetAfterBuy >= 0
      ? decodeAction(
          policy[
            budgetAfterBuy * planeSize +
              gridIndex(axes, maxSlots, problem.baseOptions[firstBaseIndex].offset + likelyBonus)
          ],
        )
      : { kind: 'infeasible' };

  if (curve[ticks] === 0) {
    warnings.push('이 예산으로는 목표를 달성할 수 없습니다.');
  }

  return {
    successProbability: curve[ticks],
    curve,
    tick,
    ticks,
    axes,
    firstBaseIndex,
    firstAction,
    warnings,
    actionAt: (slotsLeft, attack, remainingBudget) => {
      const b = Math.max(0, Math.min(ticks, Math.floor(remainingBudget / tick)));
      return decodeAction(policy[b * planeSize + gridIndex(axes, slotsLeft, attack)]);
    },
  };
}
