import { foldOutcomes } from './distribution';
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
  /** 첫 매물을 갈아탈 최소 이득. 기본값은 SWITCH_MARGIN. */
  switchMargin?: number;
}

/** 아직 아무것도 안 산 상태에서, 가진 돈이 정해졌을 때의 첫 수. */
export interface StartPlan {
  /** 사야 할 매물의 인덱스. 이 돈으로는 달성 확률이 0 이면 -1. */
  baseIndex: number;
  /** 그 매물을 사서 최적으로 굴렸을 때의 달성 확률 */
  chance: number;
  /** 사고 난 직후에 둘 수. 리버스면 가장 흔한 굴림 기준이다. */
  action: Action;
}

/** 첫 매물이 같은 답으로 유지되는 예산 구간. */
export interface StartBand {
  /** 구간의 하한 (메소) */
  from: number;
  /** 구간의 상한 (메소). 마지막 구간은 이 해가 푼 최대 예산이다. */
  to: number;
  baseIndex: number;
  /** 구간 하한의 돈으로 낼 수 있는 달성 확률 */
  chanceFrom: number;
  /** 구간 상한의 돈으로 낼 수 있는 달성 확률 */
  chanceTo: number;
  /**
   * 이 구간에서 차선 매물 대비 벌어 주는 확률 (최대치). 매물이 하나뿐이면 Infinity.
   *
   * "여기서는 이걸 사라"가 얼마나 강한 말인지를 나타낸다. 작으면 어느 쪽을 사도
   * 사실상 같다는 뜻이다.
   */
  margin: number;
}

export interface BudgetSolution {
  /** 전액 예산으로 목표를 달성할 확률 */
  successProbability: number;
  /** curve[b] = 예산 b*tick 으로 달성할 확률 (첫 매물 구매비 포함) */
  curve: Float64Array;
  /**
   * startBase[b] = 예산 b*tick 으로 시작할 때 사야 할 매물. 달성 확률이 0 이면 -1.
   *
   * 예산이 빠듯하면 비싼 매물은 사고 나서 주문서 살 돈이 없어지고, 넉넉하면 싸게 사서
   * 여러 번 도전하는 쪽이 유리해진다 — 그래서 이 값은 b 에 따라 바뀐다.
   *
   * curve[b] 의 argmax 를 그대로 쓰지는 않는다 (SWITCH_MARGIN 참고). 대신 어느 예산
   * 에서든 **curve[b] − SWITCH_MARGIN 이상**은 보장한다.
   */
  startBase: Int16Array;
  /**
   * startMargin[b] = 그 예산에서 startBase[b] 가 차선 매물보다 벌어 주는 확률.
   * 매물이 하나뿐이면 Infinity. 살 수 있는 게 없으면 0.
   */
  startMargin: Float64Array;
  tick: number;
  ticks: number;
  axes: Axes;
  warnings: string[];
  /** 가진 돈이 이만큼일 때 사야 할 매물과 첫 수 */
  startAt: (amount: number) => StartPlan;
  /** 임의 상태의 최적 행동 조회 */
  actionAt: (slotsLeft: number, attack: number, remainingBudget: number) => Action;
  /** 임의 상태에서 남은 예산으로 목표를 달성할 확률 */
  chanceAt: (slotsLeft: number, attack: number, remainingBudget: number) => number;
}

/**
 * 첫 매물을 갈아탈 만한 최소 이득. 이만큼도 못 벌면 사던 걸 계속 산다.
 *
 * 매물별 달성 확률은 서로 아주 가깝게 붙는 구간이 많다. 예산이 아이템값으로 딱 떨어
 * 지지 않아 "한 번 더 도전할 수 있느냐"가 오락가락하기 때문이고, 거기에 예산 격자의
 * 이산화 잡음(0.1%p 안팎)까지 얹힌다. 틱마다 argmax 를 그대로 쓰면 "3,500만이면 공2상,
 * 3,900만이면 공1하, 5,300만이면 공3상" 처럼 답이 널뛰어 아무 말도 못 하게 된다.
 *
 * 그래서 예산 오름차순으로 훑으면서 **쥐고 있던 매물이 이만큼 뒤처질 때만** 갈아탄다.
 * 대가는 명확하다 — 어느 예산에서든 권하는 매물이 최선보다 최대 이만큼 못하다. 그
 * 대신 답이 몇 개의 구간으로 뭉쳐서 "얼마부터는 이걸 사라"를 말할 수 있게 된다.
 */
const SWITCH_MARGIN = 1e-2;

/**
 * 갈아탈 때 어느 매물로 갈지 고르는 잡음대.
 *
 * 갈아타기로 했으면 그 자리의 최선으로 간다. 다만 이 폭 안에서 갈리는 건 격자 잡음이라
 * 싼 쪽을 고른다 — 잴 수 없는 차이를 위해 더 비싼 물건을 권할 이유가 없다.
 *
 * 이 폭을 SWITCH_MARGIN 까지 넓히면 안 된다. 갈아타는 순간마다 "문턱 안에서 제일 싼
 * 것"으로 튀어, 한 틱만 살다 사라지는 구간이 생긴다.
 */
const PRICE_TIE = 2e-3;

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
  const switchMargin = options.switchMargin ?? SWITCH_MARGIN;
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
   * 매물 v 를 산 직후에 들어서는 칸들. 리버스처럼 시작 공격력이 랜덤이면 여러 칸이다.
   * 합성 매물(완성품 직접 구매)은 이미 목표를 만족한 물건이라 분포를 타지 않는다.
   *
   * 최내곽 루프에서 도는 값이라 인덱스까지 미리 접어 둔다. 여기서 분포를 매번 정규화하면
   * 셀 수 × 매물 수만큼 배열을 새로 만들게 되어 리버스 + 매물 11개에서 초 단위로 늘어난다.
   */
  const entries = problem.baseOptions.map((base) =>
    foldOutcomes(base.synthetic ? null : problem.startBonus, (delta) =>
      gridIndex(axes, maxSlots, base.offset + delta),
    ),
  );
  const valueAfterBuying = (plane: number, v: number) => {
    let sum = 0;
    for (const e of entries[v]) sum += e.probability * prob[plane + e.key];
    return sum;
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

  // 첫 매물 구매까지 포함한 예산-달성확률 곡선. 어느 매물이 그 확률을 냈는지도 같이
  // 남긴다 — 예산에 따라 사야 할 물건이 달라지는 게 이 모드의 핵심 결론이다.
  const curve = new Float64Array(ticks + 1);
  const startBase = new Int16Array(ticks + 1);
  const startChance = new Float64Array(ticks + 1);
  const startMargin = new Float64Array(ticks + 1);
  const byBase = new Float64Array(problem.baseOptions.length);
  let held = -1; // 직전 예산 틱에서 권했던 매물
  for (let b = 0; b <= ticks; b++) {
    let best = 0;
    for (let v = 0; v < problem.baseOptions.length; v++) {
      const t = buyTicks[v];
      let value = 0;
      if (b >= t.lo) value += (1 - t.pHi) * valueAfterBuying((b - t.lo) * planeSize, v);
      if (t.pHi > 0 && b >= t.hi) value += t.pHi * valueAfterBuying((b - t.hi) * planeSize, v);
      byBase[v] = value;
      if (value > best) best = value;
    }
    curve[b] = best;

    // 사던 걸 계속 살 만하면 그대로 두고, 아니면 그 자리의 최선으로 갈아탄다.
    let chosen = -1;
    if (best > 0) {
      if (held >= 0 && byBase[held] >= best - switchMargin) {
        chosen = held;
      } else {
        let chosenPrice = Number.POSITIVE_INFINITY;
        for (let v = 0; v < problem.baseOptions.length; v++) {
          const price = problem.baseOptions[v].price;
          if (byBase[v] >= best - PRICE_TIE && price < chosenPrice) {
            chosen = v;
            chosenPrice = price;
          }
        }
      }
    }
    held = chosen;
    startBase[b] = chosen;
    startChance[b] = chosen < 0 ? 0 : byBase[chosen];

    // 차선과의 거리. 이게 작으면 "이 예산에선 이걸 사라"가 사실상 아무 말도 아니다.
    let runnerUp = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < problem.baseOptions.length; v++) {
      if (v !== chosen && byBase[v] > runnerUp) runnerUp = byBase[v];
    }
    startMargin[b] =
      chosen < 0 ? 0 : runnerUp === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : byBase[chosen] - runnerUp;
  }

  // 시작 공격력이 랜덤이면 첫 수도 굴림 결과에 달렸다. 가장 흔한 굴림을 대표로 쓴다.
  const likelyBonus = problem.startBonus?.length
    ? problem.startBonus.reduce((a, b) => (b.probability > a.probability ? b : a)).value
    : 0;

  const budgetIndex = (amount: number) =>
    Math.max(0, Math.min(ticks, Math.floor(amount / tick)));

  const startAt = (amount: number): StartPlan => {
    const b = budgetIndex(amount);
    const baseIndex = startBase[b];
    if (baseIndex < 0) return { baseIndex: -1, chance: 0, action: { kind: 'infeasible' } };

    // startBase 가 -1 이 아니라는 건 그 매물을 사고도 확률이 남았다는 뜻이라 b ≥ lo 다.
    const after = b - buyTicks[baseIndex].lo;
    const base = problem.baseOptions[baseIndex];
    return {
      baseIndex,
      chance: startChance[b],
      action: decodeAction(
        policy[after * planeSize + gridIndex(axes, maxSlots, base.offset + likelyBonus)],
      ),
    };
  };

  if (curve[ticks] === 0) {
    warnings.push('이 예산으로는 목표를 달성할 수 없습니다.');
  }

  return {
    successProbability: curve[ticks],
    curve,
    startBase,
    startMargin,
    tick,
    ticks,
    axes,
    warnings,
    startAt,
    actionAt: (slotsLeft, attack, remainingBudget) => {
      const b = budgetIndex(remainingBudget);
      return decodeAction(policy[b * planeSize + gridIndex(axes, slotsLeft, attack)]);
    },
    chanceAt: (slotsLeft, attack, remainingBudget) =>
      prob[budgetIndex(remainingBudget) * planeSize + gridIndex(axes, slotsLeft, attack)],
  };
}

/**
 * `startBase` 를 "같은 답이 유지되는 예산 구간"으로 접는다.
 *
 * 화면에 2000개의 틱을 늘어놓을 수는 없고, 사용자가 알고 싶은 건 **답이 바뀌는 지점**
 * 이다. "3,000만까지는 공1상, 그 위로는 공3상" 처럼 몇 줄로 접힌다.
 *
 * 잘게 번갈아 나오는 구간을 걷어내는 일은 여기서 하지 않는다 — `startBase` 자체가
 * 이미 갈아탈 값어치가 있을 때만 바뀌게 만들어져 있다(SWITCH_MARGIN). 여기서 다시
 * 이웃에 흡수시키면 흡수된 구간에서 엉뚱한 매물을 권하게 된다.
 */
export function startBands(solution: BudgetSolution): StartBand[] {
  const { startBase, startMargin, curve, tick, ticks } = solution;

  const raw: Array<{ fromTick: number; toTick: number; baseIndex: number; margin: number }> = [];
  for (let b = 0; b <= ticks; b++) {
    const v = startBase[b];
    if (v < 0) continue; // 이 예산으로는 무엇을 사도 확률이 0 이다
    const last = raw[raw.length - 1];
    if (last && last.baseIndex === v && last.toTick === b - 1) {
      last.toTick = b;
      last.margin = Math.max(last.margin, startMargin[b]);
    } else {
      raw.push({ fromTick: b, toTick: b, baseIndex: v, margin: startMargin[b] });
    }
  }

  return raw.map((r) => ({
    from: r.fromTick * tick,
    to: r.toTick * tick,
    baseIndex: r.baseIndex,
    chanceFrom: curve[r.fromTick],
    chanceTo: curve[r.toTick],
    margin: r.margin,
  }));
}
