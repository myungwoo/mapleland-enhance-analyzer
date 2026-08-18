import type { CostSolution } from './dp-cost';
import { mix, normalize } from './distribution';
import { tickCost } from './grid';
import { prepareProblem } from './salvage';
import { decodeAction, gridIndex, type Problem } from './types';

export interface CostDistribution {
  tick: number;
  ticks: number;
  /** cdf[b] = 총지출이 b*tick 이하로 목표를 달성할 확률 */
  cdf: Float64Array;
  quantiles: { p50: number; p75: number; p90: number; p99: number };
  /**
   * CDF 를 적분한 기대 지출액.
   *
   * 회수액이 새 매물값을 넘는 구간(예: 공6 을 팔면 하옵 새로 사고도 돈이 남는)에서는
   * 예산 축이 음수 지출을 표현하지 못해 그 초과분을 인정하지 않는다. 그래서 이 값은
   * `CostSolution.expectedCost`(순비용, 정확값) 이상이 되며, 그 차이가 곧
   * "재투자하지 못하고 남는 판매 대금"이다. `creditCapped` 로 걸렸는지 알 수 있다.
   */
  expectedCostFromCdf: number;
  /** 회수액이 새 매물값을 넘어 잘린 구간이 실제로 쓰였는지 */
  creditCapped: boolean;
  /** 격자가 담아낸 확률 질량. 1 에 가까울수록 꼬리까지 본 것. */
  coverage: number;
}

export interface DistributionOptions {
  ticks?: number;
  /** 예산 축 상한. 미지정 시 기대비용 기준으로 자동 확장한다. */
  maxCost?: number;
}

/**
 * 모드 A 의 최적 정책을 **고정한 채** 예산 격자 위에서 평가하면
 * `P(예산 b 안에 달성)` 이 그대로 총비용의 CDF 가 된다.
 * 기댓값만으로는 안 보이는 꼬리 위험(중앙값 대비 p90)을 여기서 얻는다.
 */
export function costDistribution(
  input: Problem,
  solution: CostSolution,
  options: DistributionOptions = {},
): CostDistribution {
  const problem = prepareProblem(input);
  const ticks = options.ticks ?? 4000;
  const floor = Math.max(...problem.baseOptions.map((b) => b.price), 1);
  let maxCost = options.maxCost ?? Math.max(solution.expectedCost * 20, floor * 4);

  let result = evaluateOnGrid(problem, solution, maxCost, ticks);
  if (options.maxCost === undefined) {
    for (let i = 0; i < 6 && result.coverage < 0.9995; i++) {
      maxCost *= 2.5;
      result = evaluateOnGrid(problem, solution, maxCost, ticks);
    }
  }
  return result;
}

function evaluateOnGrid(
  problem: Problem,
  solution: CostSolution,
  maxCost: number,
  ticks: number,
): CostDistribution {
  const tick = maxCost / ticks;
  // 상한이 걸렸을 수 있으므로 해가 실제로 쓴 회수 함수를 그대로 쓴다.
  const salvage = solution.salvageAt;
  const { axes, policy } = solution;
  const { maxSlots, attackMin, attackMax, span } = axes;
  const planeSize = (maxSlots + 1) * span;
  const reached = new Float32Array(planeSize * (ticks + 1));

  const scrolls = problem.scrolls;
  const scrollTicks = scrolls.map((s) => tickCost(s.price, tick));
  let creditCapped = false;

  /** 매물을 산 직후의 값. 시작 공격력이 랜덤이면(리버스) 분포로 섞는다. */
  const afterBuying = (plane: number, option: Problem['baseOptions'][number]) =>
    mix(option.synthetic ? null : problem.startBonus, (delta) =>
      reached[plane + gridIndex(axes, maxSlots, option.offset + delta)],
    );

  for (let b = 0; b <= ticks; b++) {
    const base = b * planeSize;
    for (let u = 0; u <= maxSlots; u++) {
      for (let a = attackMin; a <= attackMax; a++) {
        const i = base + u * span + (a - attackMin);
        const action = decodeAction(policy[u * span + (a - attackMin)]);

        if (action.kind === 'done') {
          reached[i] = 1;
          continue;
        }
        if (action.kind === 'infeasible') {
          reached[i] = 0;
          continue;
        }

        let v = 0;
        if (action.kind === 'scroll') {
          const sc = scrolls[action.scrollIndex];
          const t = scrollTicks[action.scrollIndex];
          const hitIdx = gridIndex(axes, u - 1, a + sc.attackGain);
          const missIdx = (u - 1) * span + (a - attackMin);
          if (b >= t.lo) {
            const p = (b - t.lo) * planeSize;
            v += (1 - t.pHi) * (sc.successRate * reached[p + hitIdx] + (1 - sc.successRate) * reached[p + missIdx]);
          }
          if (t.pHi > 0 && b >= t.hi) {
            const p = (b - t.hi) * planeSize;
            v += t.pHi * (sc.successRate * reached[p + hitIdx] + (1 - sc.successRate) * reached[p + missIdx]);
          }
        } else {
          const option = problem.baseOptions[action.baseIndex];
          const net = option.price - salvage(u, a);
          if (net < 0) creditCapped = true;
          const t = tickCost(Math.max(0, net), tick, 1);
          if (b >= t.lo) v += (1 - t.pHi) * afterBuying((b - t.lo) * planeSize, option);
          if (t.pHi > 0 && b >= t.hi) v += t.pHi * afterBuying((b - t.hi) * planeSize, option);
        }
        reached[i] = v;
      }
    }
  }

  // 첫 매물 구매비까지 얹은 CDF
  const buy = problem.baseOptions[solution.bestBaseIndex];
  const t = tickCost(buy.price, tick, 1);
  const cdf = new Float64Array(ticks + 1);
  for (let b = 0; b <= ticks; b++) {
    let v = 0;
    if (b >= t.lo) v += (1 - t.pHi) * afterBuying((b - t.lo) * planeSize, buy);
    if (t.pHi > 0 && b >= t.hi) v += t.pHi * afterBuying((b - t.hi) * planeSize, buy);
    cdf[b] = v;
  }

  let integral = 0;
  for (let b = 0; b < ticks; b++) integral += (1 - cdf[b]) * tick;

  return {
    tick,
    ticks,
    cdf,
    quantiles: {
      p50: quantile(cdf, tick, 0.5),
      p75: quantile(cdf, tick, 0.75),
      p90: quantile(cdf, tick, 0.9),
      p99: quantile(cdf, tick, 0.99),
    },
    expectedCostFromCdf: integral,
    creditCapped,
    coverage: cdf[ticks],
  };
}

function quantile(cdf: Float64Array, tick: number, q: number): number {
  for (let b = 0; b < cdf.length; b++) {
    if (cdf[b] >= q) return b * tick;
  }
  return Number.POSITIVE_INFINITY;
}

export interface AttackDistribution {
  /** 무기 한 자루의 생애 안에 목표를 달성했을 때의 공격력 분포 */
  outcomes: Array<{ attack: number; probability: number }>;
  /** 그 자루를 손절하고 다시 시작하게 될 확률 */
  abandonProbability: number;
  /** 손절 시점의 (남은 업횟, 공격력) 분포 */
  abandonStates: Array<{ slotsLeft: number; attack: number; probability: number }>;
  /** 목표 달성까지 평균적으로 소모하는 무기 자루 수 */
  expectedWeapons: number;
  /** 무기 한 자루당 평균 소모 주문서 장수 */
  expectedScrollsPerWeapon: number;
}

/**
 * 최적 정책을 따랐을 때, 무기 한 자루가 겪는 일의 분포.
 * "몇 자루 태워야 하나"와 "어디서 손절하게 되나"를 여기서 얻는다.
 */
export function attackDistribution(
  input: Problem,
  solution: CostSolution,
): AttackDistribution {
  const problem = prepareProblem(input);
  const { axes, policy } = solution;
  const { maxSlots, attackMin, attackMax, span } = axes;
  const mass = new Float64Array((maxSlots + 1) * span);
  const start = problem.baseOptions[solution.bestBaseIndex];
  // 시작 공격력이 랜덤이면(리버스 레벨업) 그 분포대로 질량을 흩뿌리고 시작한다.
  const startRoll = start.synthetic ? null : problem.startBonus;
  for (const { value, probability } of startRoll?.length
    ? normalize(startRoll)
    : [{ value: 0, probability: 1 }]) {
    mass[gridIndex(axes, maxSlots, start.offset + value)] += probability;
  }

  const outcomes = new Map<number, number>();
  const abandonStates: AttackDistribution['abandonStates'] = [];
  let abandon = 0;
  let scrollsUsed = 0;

  for (let u = maxSlots; u >= 0; u--) {
    for (let a = attackMin; a <= attackMax; a++) {
      const i = u * span + (a - attackMin);
      const m = mass[i];
      if (m <= 0) continue;
      const action = decodeAction(policy[i]);

      if (action.kind === 'done') {
        outcomes.set(a, (outcomes.get(a) ?? 0) + m);
        continue;
      }
      if (action.kind !== 'scroll') {
        abandon += m;
        abandonStates.push({ slotsLeft: u, attack: a, probability: m });
        continue;
      }

      const sc = problem.scrolls[action.scrollIndex];
      scrollsUsed += m;
      mass[gridIndex(axes, u - 1, a + sc.attackGain)] += m * sc.successRate;
      mass[(u - 1) * span + (a - attackMin)] += m * (1 - sc.successRate);
    }
  }

  const success = 1 - abandon;
  return {
    outcomes: [...outcomes.entries()]
      .map(([attack, probability]) => ({ attack, probability }))
      .sort((x, y) => x.attack - y.attack),
    abandonProbability: abandon,
    abandonStates: abandonStates.sort((x, y) => y.probability - x.probability),
    expectedWeapons: success > 0 ? 1 / success : Number.POSITIVE_INFINITY,
    expectedScrollsPerWeapon: scrollsUsed,
  };
}
