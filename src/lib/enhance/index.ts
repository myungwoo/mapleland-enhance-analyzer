import { breakevenPrices, type BreakevenResult } from './breakeven';
import { solveMaxSuccess, type BudgetSolution } from './dp-budget';
import { solveMinCost, type CostSolution } from './dp-cost';
import {
  attackDistribution,
  costDistribution,
  type AttackDistribution,
  type CostDistribution,
} from './evaluate';
import { prepareProblem } from './salvage';
import { decodeAction, gridIndex, type Action, type Problem } from './types';

export * from './types';
export { solveMinCost, type CostSolution } from './dp-cost';
export { solveMaxSuccess, type BudgetSolution, type BudgetOptions } from './dp-budget';
export {
  attackDistribution,
  costDistribution,
  type AttackDistribution,
  type CostDistribution,
} from './evaluate';
export { breakevenPrices, type BreakevenResult } from './breakeven';
export {
  makeSalvageFn,
  makeEnhanceSalvage,
  prepareProblem,
  type EnhanceSalvage,
} from './salvage';

export interface StrategyComparison {
  label: string;
  /** 목표 달성 기대비용. 도달 불가면 Infinity. */
  expectedCost: number;
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
  distribution: CostDistribution | null;
  outcome: AttackDistribution | null;
  budget: BudgetSolution | null;
  breakeven: BreakevenResult[] | null;
  strategies: StrategyComparison[];
  warnings: string[];
}

/** 한 문제에 대한 전체 분석. UI 가 필요로 하는 값을 한 번에 뽑는다. */
export function analyze(input: Problem, options: AnalyzeOptions = {}): Analysis {
  const problem = prepareProblem(input);
  const cost = solveMinCost(problem);
  const warnings = [...cost.warnings];

  if (!cost.feasible || cost.arbitrage) {
    return {
      problem,
      cost,
      distribution: null,
      outcome: null,
      budget: null,
      breakeven: null,
      strategies: [],
      warnings,
    };
  }

  const distribution = costDistribution(problem, cost, { ticks: options.distributionTicks });
  const outcome = attackDistribution(problem, cost);

  let budget: BudgetSolution | null = null;
  if (options.budget !== undefined && options.budget > 0) {
    budget = solveMaxSuccess(problem, { budget: options.budget, ticks: options.budgetTicks });
    warnings.push(...budget.warnings);
  }

  if (distribution.coverage < 0.99) {
    warnings.push(
      '비용 분포의 꼬리가 매우 두껍습니다. 상위 분위수는 표시된 값보다 클 수 있습니다.',
    );
  }

  return {
    problem,
    cost,
    distribution,
    outcome,
    budget,
    breakeven: options.includeBreakeven ? breakevenPrices(alignSalvage(problem, cost)) : null,
    strategies: compareStrategies(problem, cost),
    warnings,
  };
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
    { label: '최적 전략', expectedCost: optimal.expectedCost },
  ];

  for (const scroll of problem.scrolls) {
    rows.push({
      label: `${scroll.label}만 사용`,
      expectedCost: solveMinCost({ ...aligned, scrolls: [scroll] }).expectedCost,
    });
  }

  if (Number.isFinite(optimal.finishedPrice)) {
    rows.push({ label: '완성품 직접 구매', expectedCost: optimal.finishedPrice });
  }

  return rows;
}

/** 기준 해와 같은 회수 모델을 쓰도록 문제를 맞춘다. */
export function alignSalvage(problem: Problem, reference: CostSolution): Problem {
  return reference.salvageMode === 'none' ? { ...problem, salvage: null } : problem;
}

export interface Advice {
  /** 지금 해야 할 행동 */
  action: Action;
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
  slotsLeft: number,
  attack: number,
): Advice {
  const i = gridIndex(solution.axes, slotsLeft, attack);
  const action = decodeAction(solution.policy[i]);
  const remainingCost = solution.cost[i];
  const salvageValue = solution.salvageAt(slotsLeft, attack);
  const restartCost = solution.expectedCost - salvageValue;

  return {
    action,
    remainingCost,
    salvageValue,
    restartCost,
    advantageOverRestart: restartCost - remainingCost,
  };
}
