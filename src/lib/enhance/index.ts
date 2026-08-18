import { breakevenPrices, type BreakevenResult } from './breakeven';
import { solveMaxSuccess, startBands, type BudgetSolution, type StartBand, type StartPlan } from './dp-budget';
import { solveMinCost, type CostSolution } from './dp-cost';
import {
  attackDistribution,
  costDistribution,
  successProbabilities,
  type AttackDistribution,
  type CostDistribution,
} from './evaluate';
import { mix } from './distribution';
import { baseFairValue, prepareProblem } from './salvage';
import { decodeAction, gridIndex, type Action, type Outcome, type Problem } from './types';

export * from './types';
export { solveMinCost, type CostSolution } from './dp-cost';
export {
  solveMaxSuccess,
  startBands,
  type BudgetSolution,
  type BudgetOptions,
  type StartBand,
  type StartPlan,
} from './dp-budget';
export {
  attackDistribution,
  costDistribution,
  successProbabilities,
  type AttackDistribution,
  type CostDistribution,
} from './evaluate';
export { breakevenPrices, type BreakevenResult } from './breakeven';
export {
  makeSalvageFn,
  makeEnhanceSalvage,
  prepareProblem,
  baseFairValue,
  type EnhanceSalvage,
} from './salvage';
export * from './distribution';

export interface StrategyComparison {
  label: string;
  /** 목표 달성 기대비용. 도달 불가면 Infinity. 손절을 금지하면 "지출 기대값"이 된다. */
  expectedCost: number;
  /** 아이템 하나로 목표를 만들 확률 */
  successProbability: number;
}

export interface AnalyzeOptions {
  /** 주면 모드 C(예산 제약)까지 함께 푼다 */
  budget?: number;
  budgetTicks?: number;
  distributionTicks?: number;
  /** 손익분기 가격 계산은 DP 를 수십 번 돌리므로 필요할 때만 켠다 */
  includeBreakeven?: boolean;
}

export interface Analysis {
  /** 합성 매물("완성품 직접 구매")까지 포함된 문제. 인덱스 해석은 이걸 기준으로. */
  problem: Problem;
  cost: CostSolution;
  /** S[u][a] — 그 상태에서 이 아이템 1개로 목표를 만들 확률 (cost 와 같은 인덱싱) */
  successChance: Float64Array;
  distribution: CostDistribution | null;
  outcome: AttackDistribution | null;
  budget: BudgetSolution | null;
  /** 예산을 안 넣어서 참고용 범위로 그린 곡선인지 */
  budgetIsAuto: boolean;
  /** 사용자가 넣은 예산에서의 달성 확률. 예산을 안 넣었으면 null. */
  budgetProbability: number | null;
  /**
   * 사용자가 넣은 예산으로 시작할 때 사야 할 매물과 첫 수. 예산을 안 넣었으면 null.
   *
   * `cost.bestBaseIndex` (최소비용 기준) 와 다를 수 있다. 그 차이가 곧 "예산이 정해지면
   * 전략이 달라진다"는 말의 알맹이다 — 돈이 빠듯하면 비싼 매물은 사고 나서 주문서 살
   * 돈이 없어지고, 넉넉하면 싼 매물로 여러 번 도전하는 쪽이 유리해진다.
   */
  budgetStart: StartPlan | null;
  /** 예산 구간별로 사야 할 매물. 예산 곡선이 있을 때만 채워진다. */
  budgetStartBands: StartBand[];
  breakeven: BreakevenResult[] | null;
  /** 매물별 "얼마까지 주고 살 만한가" */
  bases: BaseValue[];
  strategies: StrategyComparison[];
  warnings: string[];
}

/** 한 문제에 대한 전체 분석. UI 가 필요로 하는 값을 한 번에 뽑는다. */
export function analyze(input: Problem, options: AnalyzeOptions = {}): Analysis {
  const problem = prepareProblem(input);
  const cost = solveMinCost(problem);
  const warnings = [...cost.warnings];

  const successChance = successProbabilities(problem, cost);

  if (!cost.feasible || cost.arbitrage) {
    return {
      problem,
      cost,
      successChance,
      bases: [],
      budgetIsAuto: false,
      budgetProbability: null,
      budgetStart: null,
      budgetStartBands: [],
      distribution: null,
      outcome: null,
      budget: null,
      breakeven: null,
      strategies: [],
      warnings,
    };
  }

  // 손절이 없으면 비용 CDF 와 손익분기는 뜻이 흐려진다. "이 금액 안에 끝날 확률"이
  // 성공 확률에서 멈춰 버리고, 손익분기는 애초에 최소비용 기준이라 정의되지 않는다.
  const distribution = problem.allowRestart
    ? costDistribution(problem, cost, { ticks: options.distributionTicks })
    : null;
  const outcome = attackDistribution(problem, cost);

  // 예산을 안 넣었어도 곡선 자체는 쓸모가 있다 — "얼마쯤 있으면 몇 %"를 보여 준다.
  // 넉넉한 기본 범위를 잡아 그리되, 그 사실을 밖에서 알 수 있게 표시한다.
  const budgetIsAuto = !(options.budget !== undefined && options.budget > 0);
  // 비용 곡선과 나란히 놓고 보려면 같은 구간을 덮어야 한다. 예산 DP 는 어차피 모든 예산
  // 수준을 한 번에 풀므로, 넓게 풀어 두고 사용자의 예산 지점만 따로 읽으면 된다.
  const userBudget = budgetIsAuto ? 0 : (options.budget as number);
  const budgetAmount = Math.max(userBudget, autoBudgetRange(cost, distribution));

  let budget: BudgetSolution | null = null;
  let budgetProbability: number | null = null;
  let budgetStart: StartPlan | null = null;
  let budgetStartBands: StartBand[] = [];
  if (Number.isFinite(budgetAmount) && budgetAmount > 0) {
    budget = solveMaxSuccess(problem, { budget: budgetAmount, ticks: options.budgetTicks });
    budgetStartBands = startBands(budget);
    if (!budgetIsAuto) {
      budgetProbability = budget.curve[Math.min(budget.ticks, Math.floor(userBudget / budget.tick))];
      // 곡선은 사용자의 예산보다 넓은 구간까지 풀려 있다. 첫 매물은 반드시 **사용자의
      // 예산 지점**에서 읽어야 한다 — 끝점에서 읽으면 있지도 않은 돈 기준의 답이 나온다.
      budgetStart = budget.startAt(userBudget);
      if (budgetProbability === 0) {
        warnings.push('이 예산으로는 목표를 달성할 수 없습니다.');
      }
    }
  }

  if (distribution && distribution.coverage < 0.99) {
    warnings.push(
      '비용 분포의 꼬리가 매우 두껍습니다. 상위 분위수는 표시된 값보다 클 수 있습니다.',
    );
  }

  return {
    problem,
    cost,
    successChance,
    distribution,
    outcome,
    budget,
    budgetIsAuto,
    budgetProbability,
    budgetStart,
    budgetStartBands,
    breakeven:
      options.includeBreakeven && problem.allowRestart
        ? breakevenPrices(alignSalvage(problem, cost))
        : null,
    bases: baseValues(input, cost),
    strategies: compareStrategies(problem, cost),
    warnings,
  };
}

/**
 * 예산을 안 넣었을 때 곡선을 그릴 범위.
 *
 * 상위 1% 지출까지 담으면 곡선이 위쪽에서 평평해지는 모습까지 보인다. 그 값이 없으면
 * (손절 금지처럼 분포를 안 내는 경우) 기대 지출의 몇 배로 잡는다.
 */
function autoBudgetRange(cost: CostSolution, distribution: CostDistribution | null): number {
  if (!Number.isFinite(cost.expectedCost) || cost.expectedCost <= 0) return 0;
  if (!distribution) return cost.expectedCost * 4;

  // 비용 곡선과 같은 구간을 덮어야 나란히 놓고 볼 수 있다. 한쪽만 짧으면 그 뒤로
  // 선이 끊겨 비교가 안 된다.
  const { cdf, tick, ticks } = distribution;
  const settled = cdf[ticks] * 0.999;
  for (let i = 0; i <= ticks; i++) {
    if (cdf[i] >= settled) return Math.max(i * tick, cost.expectedCost);
  }
  return ticks * tick;
}

/**
 * 최적 전략 vs 단일 주문서 고집 vs 완성품 직접 구매.
 *
 * 변형 문제는 제작 비용이 달라져 회수 모델도 달라질 수 있다. 그대로 비교하면
 * "60%만 쓰기"가 최적 전략보다 싸게 나오는 사과 대 오렌지가 되므로 모델을 맞춘다.
 */
export function compareStrategies(problem: Problem, optimal: CostSolution): StrategyComparison[] {
  const aligned = alignSalvage(problem, optimal);
  const rows: StrategyComparison[] = [
    {
      label: '최적 전략',
      expectedCost: optimal.expectedCost,
      successProbability: startSuccess(problem, optimal),
    },
  ];

  for (const scroll of problem.scrolls) {
    const variant = { ...aligned, scrolls: [scroll] };
    const solved = solveMinCost(variant);
    rows.push({
      label: `${scroll.label}만 사용`,
      expectedCost: solved.expectedCost,
      successProbability: startSuccess(variant, solved),
    });
  }

  if (Number.isFinite(optimal.finishedPrice)) {
    rows.push({
      label: '완성품 직접 구매',
      expectedCost: optimal.finishedPrice,
      successProbability: 1,
    });
  }

  return rows;
}

/** 첫 매물에서 출발했을 때 아이템 하나로 목표를 만들 확률. */
export function startSuccess(problem: Problem, solution: CostSolution): number {
  const prepared = prepareProblem(problem);
  const chance = successProbabilities(prepared, solution);
  const base = prepared.baseOptions[solution.bestBaseIndex];
  return mix(base.synthetic ? null : prepared.startBonus, (delta) =>
    chance[gridIndex(solution.axes, prepared.maxSlots, base.offset + delta)],
  );
}

/** 기준 해와 같은 회수 모델을 쓰도록 문제를 맞춘다. */
export function alignSalvage(problem: Problem, reference: CostSolution): Problem {
  return reference.salvageMode === 'none' ? { ...problem, salvage: null } : problem;
}

export interface BaseValue {
  offset: number;
  label?: string;
  price: number;
  /**
   * 이 매물에 지불할 수 있는 상한 — 이 값보다 싸면 사는 게 이득이다.
   *
   * "이 매물을 빼고 풀었을 때의 총비용"에서 "이 매물로 시작했을 때 앞으로 들 비용"을
   * 뺀 값이다. 그보다 비싸게 주면 차라리 다른 선택지로 가는 게 낫다는 뜻이라, 되팔기가
   * 꺼져 있어도(리버스처럼 교환불가) 의미가 살아 있다.
   *
   * 다른 대안이 아예 없으면 Infinity 다 — 값이 얼마든 이것밖에 방법이 없다.
   */
  worthPayingUpTo: number;
  /** 되팔이 기준 이론가. 되팔기를 끄면 0 이라 판단 근거가 되지 못한다. */
  resaleValue: number;
}

/**
 * 매물별 "얼마까지 주고 살 만한가".
 *
 * 되팔이 이론가(W)와는 다른 질문에 답한다. W 는 "팔면 얼마 받나"라 시장 가치이고,
 * 이쪽은 "내 목표를 두고 볼 때 얼마까지가 이득인가"라 의사결정 기준이다. 되팔 수 없는
 * 아이템에서는 W 가 0 으로 무너지지만 이 값은 그대로 쓸모가 있다.
 */
export function baseValues(input: Problem, solution: CostSolution): BaseValue[] {
  const problem = prepareProblem(input);
  const real = problem.baseOptions.filter((b) => !b.synthetic);

  return real.map((base) => {
    // 목록에서 아예 빼면 격자의 공격력 축이 좁아져 gridIndex 가 엉뚱한 칸으로 클램프된다
    // (공1하를 빼면 하한이 0 이 되어 −1 을 0 으로 읽는다). 값만 무한대로 두면 축은
    // 그대로 두고 선택지에서만 빠진다.
    const priced = { ...input, baseOptions: real.map((b) => (b === base ? { ...b, price: Number.POSITIVE_INFINITY } : b)) };
    const withoutIt = real.length > 1 ? solveMinCost(priced) : null;

    let worthPayingUpTo = Number.POSITIVE_INFINITY;
    if (withoutIt && Number.isFinite(withoutIt.expectedCost)) {
      // 이 매물이 없다고 쳤을 때의 비용 격자로, 여기서 출발하면 앞으로 얼마가 드는지 잰다.
      const ahead = mix(problem.startBonus, (delta) =>
        withoutIt.cost[gridIndex(withoutIt.axes, problem.maxSlots, base.offset + delta)],
      );
      worthPayingUpTo = withoutIt.expectedCost - ahead;
    }

    return {
      offset: base.offset,
      label: base.label,
      price: base.price,
      worthPayingUpTo,
      resaleValue: baseFairValue(problem, solution.salvageAt, base),
    };
  });
}

export interface Advice {
  /** 지금 해야 할 행동 */
  action: Action;
  /** 아직 남은 레벨업이 있어 먼저 굴려야 하는 상태인지 (리버스 무기) */
  levelUpFirst: boolean;
  /**
   * 이 아이템 1개로 목표를 만들 확률. 손절하면 실패로 친다.
   * "언젠가 목표를 갖게 될 확률"이 아니다 — 그건 새 아이템을 계속 사면 되니 항상 100% 이고,
   * 그 대가가 기대비용이다.
   */
  successProbability: number;
  /** 이 상태에서 목표까지 남은 기대비용 */
  remainingCost: number;
  /** 지금 팔면 손에 쥐는 금액 */
  salvageValue: number;
  /** 손절하고 새로 시작할 때의 남은 기대비용 */
  restartCost: number;
  /** 계속 바르는 게 손절보다 얼마나 싼가 (음수면 손절이 낫다) */
  advantageOverRestart: number;
}

/**
 * 이미 가지고 있는 무기의 현재 상태를 넣으면 "계속 바를까, 지금 팔까"에 답한다.
 * 최적 정책 표를 그대로 조회하는 것이라 추가 계산이 없다.
 */
export function advise(
  problem: Problem,
  solution: CostSolution,
  successChance: Float64Array,
  slotsLeft: number,
  attack: number,
  /**
   * 아직 안 굴린 레벨업의 공격력 분포 (리버스 무기).
   * 레벨업은 메소를 안 쓰고 정보만 늘려 주므로, 남아 있으면 먼저 굴리는 게 항상 낫다.
   * 그래서 남은 값들은 전부 이 분포로 섞은 기댓값이다.
   */
  pendingLevelBonus?: Outcome[] | null,
): Advice {
  const pending = pendingLevelBonus?.length ? pendingLevelBonus : null;
  const at = (delta: number) => gridIndex(solution.axes, slotsLeft, attack + delta);
  const action = decodeAction(solution.policy[at(0)]);
  const remainingCost = mix(pending, (d) => solution.cost[at(d)]);
  const salvageValue = mix(pending, (d) => solution.salvageAt(slotsLeft, attack + d));
  const restartCost = solution.expectedCost - salvageValue;

  return {
    action,
    levelUpFirst: pending !== null,
    successProbability: mix(pending, (d) => successChance[at(d)]),
    remainingCost,
    salvageValue,
    restartCost,
    advantageOverRestart: restartCost - remainingCost,
  };
}
