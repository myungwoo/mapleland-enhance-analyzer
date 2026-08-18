import { solveMinCost } from './dp-cost';
import type { Problem } from './types';

export interface BreakevenResult {
  scrollId: string;
  scrollLabel: string;
  currentPrice: number;
  /** 이 가격을 넘으면 최적 전략에서 이 주문서가 사라진다 */
  breakevenPrice: number;
  /** 지금 시세에서 실제로 쓸 가치가 있는지 */
  worthUsing: boolean;
  /** 이 주문서를 아예 못 쓸 때의 기대비용 */
  costWithout: number;
}

/**
 * 각 주문서의 손익분기 가격 — "얼마 이하일 때만 쓸 가치가 있나".
 *
 * 기대비용은 주문서 가격에 대해 비감소이고, 그 주문서를 아예 빼고 푼 값에서
 * 평평해진다. 그 평평해지는 지점이 손익분기점이므로 이분탐색으로 찾는다.
 */
export function breakevenPrices(problem: Problem): BreakevenResult[] {
  return problem.scrolls.map((scroll, index) => {
    const without: Problem = {
      ...problem,
      scrolls: problem.scrolls.filter((_, i) => i !== index),
    };
    const costWithout = without.scrolls.length
      ? solveMinCost(without).expectedCost
      : Number.POSITIVE_INFINITY;

    const at = (price: number) =>
      solveMinCost({
        ...problem,
        scrolls: problem.scrolls.map((s, i) => (i === index ? { ...s, price } : s)),
      }).expectedCost;

    let breakeven: number;
    if (!Number.isFinite(costWithout)) {
      // 이 주문서 없이는 목표 자체가 불가능하다 — 값이 얼마든 쓸 수밖에 없다.
      breakeven = Number.POSITIVE_INFINITY;
    } else if (at(0) >= costWithout - 1e-6) {
      // 공짜여도 도움이 안 되는 주문서
      breakeven = 0;
    } else {
      let lo = 0;
      let hi = costWithout;
      for (let i = 0; i < 60 && hi - lo > 1e-7 * Math.max(1, hi); i++) {
        const mid = (lo + hi) / 2;
        if (at(mid) < costWithout - 1e-6) lo = mid;
        else hi = mid;
      }
      breakeven = lo;
    }

    return {
      scrollId: scroll.id,
      scrollLabel: scroll.label,
      currentPrice: scroll.price,
      breakevenPrice: breakeven,
      worthUsing: scroll.price < breakeven,
      costWithout,
    };
  });
}
