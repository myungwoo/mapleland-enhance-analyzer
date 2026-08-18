import { describe, expect, it } from 'vitest';
import { solveMinCost, type CostSolution } from '../dp-cost';
import { costDistribution } from '../evaluate';
import { normalize } from '../distribution';
import { prepareProblem } from '../salvage';
import { decodeAction, gridIndex, type Problem } from '../types';
import { baseProblem, makeRng, reverseProblem } from './fixtures';

interface SimOptions {
  /**
   * 예산 격자와 같은 방식으로, 회수액을 새 매물값까지만 인정한다.
   * false 면 DP 의 순비용 정의 그대로 전액 회수한다.
   */
  capCredit?: boolean;
}

/** DP 가 내놓은 정책을 그대로 따라가며 실제 지출을 굴려본다. */
function simulate(
  input: Problem,
  solution: CostSolution,
  runs: number,
  seed: number,
  options: SimOptions = {},
) {
  const problem = prepareProblem(input);
  const rng = makeRng(seed);
  const salvage = solution.salvageAt;
  const { axes, policy } = solution;
  const samples = new Float64Array(runs);

  /** 리버스 무기의 아이템 레벨업처럼, 매물을 살 때마다 시작 공격력을 다시 굴린다. */
  const rollStart = (option: (typeof problem.baseOptions)[number]) => {
    const dist = option.synthetic ? null : problem.startBonus;
    if (!dist?.length) return option.offset;
    let r = rng();
    for (const o of normalize(dist)) {
      r -= o.probability;
      if (r <= 0) return option.offset + o.value;
    }
    return option.offset + normalize(dist)[normalize(dist).length - 1].value;
  };

  for (let r = 0; r < runs; r++) {
    const first = problem.baseOptions[solution.bestBaseIndex];
    let cost = first.price;
    let slots = problem.maxSlots;
    let attack = rollStart(first);

    let done = false;
    for (let step = 0; step < 5_000 && !done; step++) {
      const action = decodeAction(policy[gridIndex(axes, slots, attack)]);
      if (action.kind === 'done') {
        done = true;
        break;
      }
      if (action.kind === 'infeasible') throw new Error('정책이 막다른 길로 보냈습니다');

      if (action.kind === 'scroll') {
        const scroll = problem.scrolls[action.scrollIndex];
        cost += scroll.price;
        slots -= 1;
        if (rng() < scroll.successRate) attack += scroll.attackGain;
      } else {
        const option = problem.baseOptions[action.baseIndex];
        const net = option.price - salvage(slots, attack);
        cost += options.capCredit ? Math.max(0, net) : net;
        slots = problem.maxSlots;
        attack = rollStart(option);
      }
    }
    if (!done) throw new Error('정책이 5,000수 안에 끝나지 않았습니다 (순환 의심)');

    samples[r] = cost;
  }

  let sum = 0;
  let sumSq = 0;
  for (const v of samples) {
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / runs;
  const variance = Math.max(0, sumSq / runs - mean * mean);
  return { mean, stderr: Math.sqrt(variance / runs), samples };
}

function quantileOf(samples: Float64Array, q: number): number {
  const sorted = Float64Array.from(samples).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

describe('몬테카를로 교차검증', () => {
  const cases: Array<[string, Problem]> = [
    ['기준 문제 (목표 +7)', baseProblem()],
    ['빡센 목표 (+12)', baseProblem({ target: 12 })],
    ['헐거운 목표 (+4)', baseProblem({ target: 4 })],
    ['회수 가치 없음', baseProblem({ salvage: null })],
    ['하옵만 살 수 있을 때', baseProblem({ baseOptions: [{ offset: -1, price: 2_000_000 }] })],
    ['리버스 (시작 공격력 랜덤)', reverseProblem()],
    ['리버스 · 빡센 목표 (+12)', reverseProblem({ target: 12 })],
  ];

  it.each(cases)('%s 의 기대비용이 시뮬레이션과 일치한다', (_label, problem) => {
    const solution = solveMinCost(problem);
    const sim = simulate(problem, solution, 200_000, 12345);
    expect(Math.abs(sim.mean - solution.expectedCost)).toBeLessThan(
      4 * sim.stderr + 1e-6 * solution.expectedCost,
    );
  });

  it('최적 정책이 다른 어떤 고정 전략보다 싸다', () => {
    const problem = baseProblem();
    const optimal = solveMinCost(problem).expectedCost;
    for (const scroll of problem.scrolls) {
      const single = solveMinCost({ ...problem, scrolls: [scroll] }).expectedCost;
      expect(single).toBeGreaterThanOrEqual(optimal - 1e-6);
    }
  });
});

describe('비용 분포와 시뮬레이션', () => {
  // CDF 는 예산 격자 위에서 계산되므로 회수액 상한이 걸린 모델과 비교해야 한다.
  const problem = baseProblem();
  const solution = solveMinCost(problem);
  const dist = costDistribution(problem, solution);
  const sim = simulate(problem, solution, 200_000, 777, { capCredit: true });

  it('CDF 의 기댓값이 같은 모델의 시뮬레이션과 일치한다', () => {
    expect(Math.abs(sim.mean - dist.expectedCostFromCdf)).toBeLessThan(
      4 * sim.stderr + 0.01 * sim.mean,
    );
  });

  it('CDF 의 분위수가 시뮬레이션 분위수와 일치한다', () => {
    for (const q of [0.5, 0.75, 0.9] as const) {
      const key = `p${Math.round(q * 100)}` as 'p50' | 'p75' | 'p90';
      const fromSim = quantileOf(sim.samples, q);
      expect(Math.abs(dist.quantiles[key] - fromSim)).toBeLessThan(0.05 * fromSim + dist.tick * 2);
    }
  });

  it('회수액 상한이 걸리면 CDF 기댓값이 순비용보다 크다', () => {
    // 공6 을 팔면 새 하옵을 사고도 돈이 남는데, 예산 축은 음수 지출을 표현하지 못한다.
    // 그 초과분은 인정하지 않으므로 예산 기준 지출은 순비용보다 커진다.
    expect(dist.creditCapped).toBe(true);
    expect(dist.expectedCostFromCdf).toBeGreaterThan(solution.expectedCost);
  });
});
