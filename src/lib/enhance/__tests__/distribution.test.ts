import { describe, expect, it } from 'vitest';
import { solveMaxSuccess } from '../dp-budget';
import { solveMinCost } from '../dp-cost';
import { attackDistribution, costDistribution } from '../evaluate';
import { breakevenPrices } from '../breakeven';
import { baseProblem } from './fixtures';

describe('비용 분포', () => {
  const problem = baseProblem();
  const solution = solveMinCost(problem);
  const dist = costDistribution(problem, solution);

  it('회수액 상한이 걸리지 않으면 CDF 적분이 DP 의 기대비용과 정확히 맞는다', () => {
    // 매각가가 새 매물값을 넘지 않는 문제라야 예산 축이 순비용을 그대로 표현한다.
    const cheapResale = baseProblem({
      salvage: { byAttack: [{ attack: 0, price: 100_000 }] },
    });
    const s = solveMinCost(cheapResale);
    const d = costDistribution(cheapResale, s);
    expect(d.creditCapped).toBe(false);
    expect(Math.abs(d.expectedCostFromCdf - s.expectedCost) / s.expectedCost).toBeLessThan(0.005);
  });

  it('분위수가 순서대로이고 기대비용을 감싼다', () => {
    const { p50, p75, p90, p99 } = dist.quantiles;
    expect(p50).toBeLessThanOrEqual(p75);
    expect(p75).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p99);
    expect(p50).toBeLessThan(solution.expectedCost * 3);
    expect(p99).toBeGreaterThan(p50);
  });

  it('격자가 꼬리까지 담아낸다', () => {
    expect(dist.coverage).toBeGreaterThan(0.99);
  });

  it('CDF 는 비감소한다', () => {
    for (let b = 1; b <= dist.ticks; b++) {
      expect(dist.cdf[b]).toBeGreaterThanOrEqual(dist.cdf[b - 1] - 1e-9);
    }
  });
});

describe('아이템 1개의 결과 분포', () => {
  const problem = baseProblem();
  const solution = solveMinCost(problem);
  const outcome = attackDistribution(problem, solution);

  it('확률 질량의 합이 1이다', () => {
    const total =
      outcome.outcomes.reduce((sum, o) => sum + o.probability, 0) + outcome.abandonProbability;
    expect(total).toBeCloseTo(1, 9);
  });

  it('달성 시 공격력은 항상 목표 이상이다', () => {
    for (const o of outcome.outcomes) expect(o.attack).toBeGreaterThanOrEqual(problem.target);
  });

  it('평균 강화 개수가 1 이상이고 성공확률의 역수와 맞는다', () => {
    expect(outcome.expectedItems).toBeGreaterThanOrEqual(1);
    expect(outcome.expectedItems).toBeCloseTo(1 / (1 - outcome.abandonProbability), 6);
  });
});

describe('예산 제약 모드', () => {
  const problem = baseProblem();
  const solution = solveMinCost(problem);

  it('예산을 충분히 주면 달성 확률이 1에 가까워진다', () => {
    const s = solveMaxSuccess(problem, { budget: solution.expectedCost * 40, ticks: 1200 });
    expect(s.successProbability).toBeGreaterThan(0.95);
  });

  it('매물 하나도 못 사는 예산이면 0이다', () => {
    const s = solveMaxSuccess(problem, { budget: 100_000, ticks: 200 });
    expect(s.successProbability).toBe(0);
  });

  it('예산 최적 정책은 비용 최적 정책보다 달성 확률이 낮지 않다', () => {
    // 두 DP 를 서로 검증하는 핵심 불변식이다.
    const dist = costDistribution(problem, solution, { ticks: 4000 });
    for (const q of [0.3, 0.5, 0.8]) {
      const budget = dist.quantiles.p90 * q;
      const viaBudgetDp = solveMaxSuccess(problem, { budget, ticks: 1500 }).successProbability;
      const b = Math.floor(budget / dist.tick);
      const viaCostPolicy = dist.cdf[Math.min(b, dist.ticks)];
      expect(viaBudgetDp).toBeGreaterThan(viaCostPolicy - 0.02);
    }
  });
});

describe('주문서 손익분기 가격', () => {
  it('현재 시세와 손익분기 가격의 대소가 채택 여부와 맞는다', () => {
    const problem = baseProblem();
    const rows = breakevenPrices(problem);
    expect(rows).toHaveLength(problem.scrolls.length);
    for (const row of rows) {
      expect(row.breakevenPrice).toBeGreaterThanOrEqual(0);
      expect(row.worthUsing).toBe(row.currentPrice < row.breakevenPrice);
    }
  });

  it('손익분기 가격 바로 아래에서는 이득, 위에서는 이득이 없다', () => {
    const problem = baseProblem();
    const row = breakevenPrices(problem).find((r) => r.scrollId === '10')!;
    if (!Number.isFinite(row.breakevenPrice) || row.breakevenPrice === 0) return;

    const at = (price: number) =>
      solveMinCost({
        ...problem,
        scrolls: problem.scrolls.map((s) => (s.id === '10' ? { ...s, price } : s)),
      }).expectedCost;

    expect(at(row.breakevenPrice * 0.9)).toBeLessThan(row.costWithout);
    expect(at(row.breakevenPrice * 1.1)).toBeGreaterThan(row.costWithout - 1e-6);
  });
});

describe('시세 입력 이상 감지', () => {
  it('매물이 이론가보다 싸면 그 사실을 짚고 보수적으로 계산한다', () => {
    // 공6 을 5억에 팔 수 있다면 200만짜리 하옵 매물은 터무니없이 싼 것이고,
    // 사서 강화하는 것만으로 이득이 나므로 "최소 비용"이 정의되지 않는다.
    const solution = solveMinCost(
      baseProblem({
        salvage: {
          byAttack: [
            { attack: 0, price: 300_000 },
            { attack: 6, price: 500_000_000 },
            { attack: 7, price: 600_000_000 },
          ],
        },
      }),
    );
    const text = solution.warnings.join(' ');
    expect(text).toContain('이론가');
    expect(solution.salvageMode).toBe('none');
    // 발산하지 않고 쓸 수 있는 숫자를 낸다.
    expect(Number.isFinite(solution.expectedCost)).toBe(true);
    expect(solution.expectedCost).toBeGreaterThan(0);
  });

  it('앞뒤가 맞는 시세에서는 경고 없이 이론가를 그대로 쓴다', () => {
    const solution = solveMinCost(baseProblem());
    expect(solution.salvageMode).toBe('market');
    expect(solution.warnings).toEqual([]);
  });
});

describe('상태의 이론가', () => {
  const problem = baseProblem();
  const solution = solveMinCost(problem);

  it('업횟이 남을수록 값이 오른다', () => {
    for (let u = 1; u <= problem.maxSlots; u++) {
      expect(solution.salvageAt(u, 0)).toBeGreaterThanOrEqual(solution.salvageAt(u - 1, 0));
    }
  });

  it('공격력이 높을수록 값이 오른다', () => {
    for (let a = 1; a <= 6; a++) {
      expect(solution.salvageAt(0, a)).toBeGreaterThan(solution.salvageAt(0, a - 1));
    }
  });

  it('주문서 한 장으로 얻을 수 있는 값보다 낮을 수 없다', () => {
    // 이 성질이 깨지면 "사서 한 장 바르고 되팔기" 차익거래가 모델 안에 생긴다.
    for (const scroll of problem.scrolls) {
      for (let u = 1; u <= problem.maxSlots; u++) {
        for (let a = -1; a <= 6; a++) {
          const rolled =
            scroll.successRate * solution.salvageAt(u - 1, a + scroll.attackGain) +
            (1 - scroll.successRate) * solution.salvageAt(u - 1, a) -
            scroll.price;
          expect(solution.salvageAt(u, a)).toBeGreaterThanOrEqual(rolled - 1e-6);
        }
      }
    }
  });
});
