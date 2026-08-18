import { describe, expect, it } from 'vitest';
import { solveMaxSuccess } from '../dp-budget';
import { solveMinCost } from '../dp-cost';
import { attackDistribution, costDistribution, successProbabilities } from '../evaluate';
import { breakevenPrices } from '../breakeven';
import { analyze, baseValues } from '../index';
import { makeSalvageFn, prepareProblem } from '../salvage';
import { decodeAction, gridIndex } from '../types';
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

describe('완작 시세 곡선', () => {
  const priceAt = makeSalvageFn({
    byAttack: [
      { attack: 0, price: 200_000 },
      { attack: 2, price: 1_200_000 },
      { attack: 4, price: 2_500_000 },
    ],
  });

  it('점 사이는 기하 보간이다', () => {
    expect(priceAt(1)).toBeCloseTo(Math.sqrt(200_000 * 1_200_000), 6);
  });

  it('최저 점 아래는 그 값이 바닥으로 깔린다', () => {
    // 어느 선 밑으로는 완작이라도 유저끼리 안 팔리고 상점 판매가가 회수의 전부다.
    // 곡선을 연장해 0 근처로 떨어뜨리면 하옵 완작의 회수를 실제보다 낮게 본다.
    for (const a of [-1, -3, -5]) expect(priceAt(a)).toBe(200_000);
  });

  it('최고 점 위로는 외삽하지 않는다', () => {
    // 공격력당 2배씩 뛰는 곡선을 연장하면 값이 폭주하고 없던 차익거래가 생긴다.
    for (const a of [5, 8, 20]) expect(priceAt(a)).toBe(2_500_000);
  });

  it('상점행이 싫으면 최저 칸에 0 을 적어 바닥을 없앤다', () => {
    const noShop = makeSalvageFn({
      byAttack: [
        { attack: 0, price: 0 },
        { attack: 2, price: 1_200_000 },
      ],
    });
    expect(noShop(-2)).toBe(0);
    expect(noShop(0)).toBe(0);
    // 0 이 끼면 기하 보간이 성립하지 않아 산술 보간으로 떨어진다.
    expect(noShop(1)).toBeCloseTo(600_000, 6);
  });
});

describe('상태의 이론가', () => {
  const problem = baseProblem();
  const solution = solveMinCost(problem);

  it('업횟 0회의 이론가가 입력한 완작 시세 그대로다', () => {
    for (const point of problem.salvage!.byAttack) {
      expect(solution.salvageAt(0, point.attack)).toBeCloseTo(point.price, 6);
    }
  });

  it('업횟이 남으면 팔 수 없으니 주문서로 태운 값만 남는다', () => {
    // 완작 시세로 바닥을 받쳐 주지 않는다 — 남은 업횟은 다 태워야 팔린다.
    for (let u = 1; u <= problem.maxSlots; u++) {
      for (let a = -1; a <= 6; a++) {
        const best = Math.max(
          ...problem.scrolls.map(
            (s) =>
              s.successRate * solution.salvageAt(u - 1, a + s.attackGain) +
              (1 - s.successRate) * solution.salvageAt(u - 1, a) -
              s.price,
          ),
        );
        expect(solution.salvageAt(u, a)).toBeCloseTo(Math.max(0, best), 6);
      }
    }
  });

  it('주문서가 값어치보다 비싸면 남은 업횟이 오히려 부채가 된다', () => {
    // 팔려면 태워야 하는데 태우는 값이 더 비싼 구간이 실제로 존재한다.
    const liability = [];
    for (let u = 1; u <= problem.maxSlots; u++) {
      for (let a = -1; a <= 6; a++) {
        if (solution.salvageAt(u, a) < solution.salvageAt(0, a) - 1e-6) liability.push([u, a]);
      }
    }
    expect(liability.length).toBeGreaterThan(0);
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

describe('손절을 금지했을 때', () => {
  // 목표 공7 은 상옵 + 100% 7장이면 확정이라 확률이 1 이 된다. 확정으로는 못 닿는
  // 목표라야 "보장은 안 되지만 최선을 다한다"는 동작이 드러난다.
  const problem = baseProblem({ target: 10, allowRestart: false });
  const solution = solveMinCost(problem);
  const chance = successProbabilities(problem, solution);
  const start = problem.baseOptions[solution.bestBaseIndex];
  const startChance = chance[gridIndex(solution.axes, problem.maxSlots, start.offset)];

  it('막다른 길이 아니라 쓸 수 있는 전략을 준다', () => {
    expect(solution.feasible).toBe(true);
    expect(Number.isFinite(solution.expectedCost)).toBe(true);
    expect(solution.expectedCost).toBeGreaterThan(0);
    expect(startChance).toBeGreaterThan(0);
    expect(startChance).toBeLessThan(1); // 확률형 주문서라 보장은 못 한다
  });

  it('지출이 매물값 + 업횟만큼의 주문서값을 넘지 않는다', () => {
    // 손절이 없으면 아이템 하나에 업횟만큼만 쓴다. 위로 유한하다.
    const maxScroll = Math.max(...problem.scrolls.map((s) => s.price));
    const maxBase = Math.max(...problem.baseOptions.map((b) => b.price));
    expect(solution.expectedCost).toBeLessThanOrEqual(maxBase + problem.maxSlots * maxScroll);
  });

  it('손절을 허용할 때보다 달성 확률이 낮을 수 없다 — 같은 아이템 하나 기준', () => {
    const withRestart = solveMinCost(baseProblem({ target: 10 }));
    const oneItem = successProbabilities(baseProblem({ target: 10 }), withRestart);
    const base = withRestart.axes;
    const theirs = oneItem[gridIndex(base, problem.maxSlots, start.offset)];
    // 비용을 무시하고 확률만 좇는 쪽이 확률로는 앞선다.
    expect(startChance).toBeGreaterThanOrEqual(theirs - 1e-9);
  });

  it('예산 모드도 손절 금지를 지킨다', () => {
    // 예산 DP 가 allowRestart 를 무시하고 손절을 허용하던 버그가 있었다.
    const noRestart = solveMaxSuccess(problem, { budget: 500_000_000, ticks: 800 });
    const free = solveMaxSuccess(baseProblem({ target: 10 }), { budget: 500_000_000, ticks: 800 });
    expect(noRestart.successProbability).toBeLessThan(free.successProbability);
    expect(noRestart.successProbability).toBeCloseTo(startChance, 2);
  });
});

describe('매물별 살 만한 상한', () => {
  const problem = baseProblem({ target: 10 });
  const solution = solveMinCost(problem);
  const prepared = prepareProblem(problem);
  const values = baseValues(problem, solution);

  it('최적 매물만 "살 만함"이 된다', () => {
    const worth = values.filter((b) => b.price < b.worthPayingUpTo);
    expect(worth).toHaveLength(1);
    expect(worth[0].offset).toBe(prepared.baseOptions[solution.bestBaseIndex].offset);
  });

  it('최적이 아닌 매물은 R − C(U, off) 와 정확히 같다', () => {
    // 그 매물을 빼도 최적해가 안 바뀌므로, 상한은 남은 비용을 뺀 값 그대로다.
    for (const b of values) {
      if (b.offset === prepared.baseOptions[solution.bestBaseIndex].offset) continue;
      const ahead = solution.cost[gridIndex(solution.axes, problem.maxSlots, b.offset)];
      const expected = solution.expectedCost - ahead;
      // 메소 단위라 절대 오차로 재면 이분탐색 정밀도(상대 1e-9)에 걸린다.
      expect(Math.abs(b.worthPayingUpTo - expected) / expected).toBeLessThan(1e-6);
    }
  });

  it('되팔기를 꺼도 쓸 수 있는 값이 나온다', () => {
    // 되팔이 이론가는 0 으로 무너지지만, "얼마까지 주고 살 만한가"는 그대로 살아 있다.
    const noResale = baseProblem({ target: 10, salvage: null });
    const solved = solveMinCost(noResale);
    for (const b of baseValues(noResale, solved)) {
      expect(b.resaleValue).toBe(0);
      expect(b.worthPayingUpTo).toBeGreaterThan(0);
      expect(Number.isFinite(b.worthPayingUpTo)).toBe(true);
    }
  });

  it('대안이 없으면 상한이 없다', () => {
    const only = baseProblem({ target: 10, baseOptions: [{ offset: 0, price: 4_000_000 }] });
    const solved = solveMinCost(only);
    expect(baseValues(only, solved)[0].worthPayingUpTo).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('두 곡선을 나란히 놓을 때', () => {
  // 화면에서 겹쳐 그리므로 "초록이 파랑 아래로 내려가지 않는다"가 눈에 보이는 약속이 된다.
  // 예산 곡선이 비용 곡선보다 짧으면 그 뒤가 평평해져 역전처럼 보이던 적이 있다.
  const cases = [
    ['예산 없음', {}],
    ['예산 설정', { budget: 40_000_000 }],
  ] as const;

  it.each(cases)('%s — 예산 최적 곡선이 비용 최적 곡선 아래로 내려가지 않는다', (_label, opts) => {
    const result = analyze(baseProblem({ target: 12 }), opts);
    const cdf = result.distribution!;
    const budget = result.budget!;

    for (let i = 0; i <= budget.ticks; i++) {
      const spend = i * budget.tick;
      const fixed = cdf.cdf[Math.min(cdf.ticks, Math.round(spend / cdf.tick))];
      expect(budget.curve[i]).toBeGreaterThan(fixed - 0.02);
    }
  });

  it('두 곡선이 같은 구간을 덮는다', () => {
    const result = analyze(baseProblem({ target: 12 }));
    const budgetEnd = (result.budget!.curve.length - 1) * result.budget!.tick;
    // 비용 곡선이 사실상 끝나는 지점까지는 예산 곡선도 그려져야 비교가 된다.
    const cdf = result.distribution!;
    const settled = cdf.cdf[cdf.ticks] * 0.999;
    let meaningfulEnd = cdf.ticks * cdf.tick;
    for (let i = 0; i <= cdf.ticks; i++) {
      if (cdf.cdf[i] >= settled) {
        meaningfulEnd = i * cdf.tick;
        break;
      }
    }
    expect(budgetEnd).toBeGreaterThanOrEqual(meaningfulEnd * 0.99);
  });

  it('예산을 넣으면 그 지점의 확률을 따로 알려준다', () => {
    const result = analyze(baseProblem({ target: 12 }), { budget: 40_000_000 });
    expect(result.budgetIsAuto).toBe(false);
    expect(result.budgetProbability).toBeGreaterThan(0);
    expect(result.budgetProbability).toBeLessThan(1);
    expect(analyze(baseProblem({ target: 12 })).budgetProbability).toBeNull();
  });
});

describe('남은 예산에 따른 최적 수', () => {
  const problem = baseProblem({ target: 12 });
  const budget = solveMaxSuccess(problem, { budget: 200_000_000, ticks: 1500 });
  const cost = solveMinCost(problem);

  it('남은 예산이 많아질수록 달성 확률이 오른다', () => {
    let prev = -1;
    for (const remaining of [0, 1e7, 3e7, 6e7, 1e8, 2e8]) {
      const chance = budget.chanceAt(4, 4, remaining);
      expect(chance).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = chance;
    }
  });

  it('예산이 빠듯할 때는 최소비용 전략과 다른 수를 둔다', () => {
    // 이 차이가 예산 곡선이 비용 곡선 위로 벌어지는 이유다. 하나라도 갈리지 않으면
    // 두 곡선을 나란히 보여 줄 이유도 없다.
    const differs = [];
    for (let u = 1; u <= problem.maxSlots; u++) {
      for (let a = -1; a <= 8; a++) {
        const byCost = decodeAction(cost.policy[gridIndex(cost.axes, u, a)]);
        const byBudget = budget.actionAt(u, a, 30_000_000);
        if (JSON.stringify(byCost) !== JSON.stringify(byBudget)) differs.push([u, a]);
      }
    }
    expect(differs.length).toBeGreaterThan(0);
  });

  it('돈이 없으면 아무것도 못 한다', () => {
    expect(budget.chanceAt(5, 0, 0)).toBe(0);
  });
});
