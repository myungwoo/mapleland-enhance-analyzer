import { describe, expect, it } from 'vitest';
import { convolve, expectedValue, normalize, probabilityAtLeast } from '../distribution';
import { solveMinCost } from '../dp-cost';
import { attackDistribution, successProbabilities } from '../evaluate';
import { baseFairValue } from '../salvage';
import { gridIndex } from '../types';
import { REVERSE_PER_LEVEL as PER_LEVEL, reverseProblem } from './fixtures';

describe('레벨업 분포', () => {
  it('정규화가 합을 1로 맞추고 같은 값을 합친다', () => {
    const d = normalize([
      { value: 1, probability: 2 },
      { value: 1, probability: 2 },
      { value: 2, probability: 4 },
      { value: 3, probability: 0 },
    ]);
    expect(d).toEqual([
      { value: 1, probability: 0.5 },
      { value: 2, probability: 0.5 },
    ]);
  });

  it('3회 합성 분포의 양 끝이 각 확률의 세제곱이다', () => {
    const total = convolve(PER_LEVEL, 3);
    expect(total.reduce((s, o) => s + o.probability, 0)).toBeCloseTo(1, 12);
    expect(total[0]).toEqual({ value: 0, probability: expect.closeTo(0.3 ** 3, 12) });
    expect(total[total.length - 1]).toEqual({
      value: 6,
      probability: expect.closeTo(0.2 ** 3, 12),
    });
  });

  it('기댓값은 1회 기댓값의 횟수배다', () => {
    expect(expectedValue(convolve(PER_LEVEL, 3))).toBeCloseTo(3 * 0.9, 12);
  });

  it('0회 합성은 항상 +0 이다', () => {
    expect(convolve(PER_LEVEL, 0)).toEqual([{ value: 0, probability: 1 }]);
  });

  it('누적 확률이 단조 감소한다', () => {
    const total = convolve(PER_LEVEL, 3);
    let prev = 1;
    for (let t = 0; t <= 6; t++) {
      const p = probabilityAtLeast(total, t);
      expect(p).toBeLessThanOrEqual(prev + 1e-12);
      prev = p;
    }
    expect(probabilityAtLeast(total, 0)).toBeCloseTo(1, 12);
    expect(probabilityAtLeast(total, 7)).toBe(0);
  });
});

describe('시작 공격력이 랜덤인 경우', () => {
  it('한 점짜리 분포는 매물 오프셋을 그만큼 옮긴 것과 같다', () => {
    const shifted = solveMinCost(
      reverseProblem({ startBonus: [{ value: 2, probability: 1 }] }),
    ).expectedCost;
    const fixed = solveMinCost(
      reverseProblem({
        startBonus: null,
        baseOptions: [{ offset: 2, price: 30_000_000, label: '리버스' }],
      }),
    ).expectedCost;
    expect(shifted).toBeCloseTo(fixed, 6);
  });

  it('기대비용이 최악 굴림과 최선 굴림 사이에 있다', () => {
    const random = solveMinCost(reverseProblem()).expectedCost;
    const at = (offset: number) =>
      solveMinCost(
        reverseProblem({
          startBonus: null,
          baseOptions: [{ offset, price: 30_000_000, label: '리버스' }],
        }),
      ).expectedCost;
    expect(random).toBeLessThan(at(0));
    expect(random).toBeGreaterThan(at(6));
  });

  it('레벨업이 후할수록 기대비용이 내려간다', () => {
    const cost = (good: number) =>
      solveMinCost(
        reverseProblem({
          startBonus: convolve(
            [
              { value: 0, probability: 1 - good },
              { value: 2, probability: good },
            ],
            3,
          ),
        }),
      ).expectedCost;
    const seq = [0.1, 0.3, 0.5, 0.7, 0.9].map(cost);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
  });

  it('결과 분포의 확률 질량이 여전히 1이다', () => {
    const problem = reverseProblem();
    const solution = solveMinCost(problem);
    const outcome = attackDistribution(problem, solution);
    const total =
      outcome.outcomes.reduce((s, o) => s + o.probability, 0) + outcome.abandonProbability;
    expect(total).toBeCloseTo(1, 9);
  });

  it('매물 이론가가 굴림 결과들의 기댓값이다', () => {
    const problem = reverseProblem();
    const solution = solveMinCost(problem);
    const base = problem.baseOptions[0];
    const byHand = convolve(PER_LEVEL, 3).reduce(
      (sum, o) => sum + o.probability * solution.salvageAt(problem.maxSlots, base.offset + o.value),
      0,
    );
    expect(baseFairValue(problem, solution.salvageAt, base)).toBeCloseTo(byHand, 6);
  });
});

describe('이 무기로 목표를 만들 확률', () => {
  const problem = reverseProblem();
  const solution = solveMinCost(problem);
  const chance = successProbabilities(problem, solution);
  const { axes } = solution;
  const at = (slots: number, attack: number) => chance[gridIndex(axes, slots, attack)];

  it('목표를 이미 넘긴 상태는 1이다', () => {
    for (let u = 0; u <= problem.maxSlots; u++) expect(at(u, problem.target)).toBe(1);
  });

  it('업횟이 없고 목표 미달이면 0이다', () => {
    for (let a = axes.attackMin; a < problem.target; a++) expect(at(0, a)).toBe(0);
  });

  it('공격력이 높을수록 확률이 높다', () => {
    for (let u = 1; u <= problem.maxSlots; u++) {
      for (let a = axes.attackMin; a < problem.target - 1; a++) {
        expect(at(u, a + 1)).toBeGreaterThanOrEqual(at(u, a) - 1e-12);
      }
    }
  });

  it('출발 지점의 확률이 결과 분포의 성공 질량과 정확히 같다', () => {
    // 두 계산이 서로를 검증한다. attackDistribution 은 질량을 앞으로 흘리고,
    // successProbabilities 는 뒤에서부터 접는다.
    const outcome = attackDistribution(problem, solution);
    const base = problem.baseOptions[solution.bestBaseIndex];
    const fromChance = convolve(PER_LEVEL, 3).reduce(
      (sum, o) => sum + o.probability * at(problem.maxSlots, base.offset + o.value),
      0,
    );
    expect(fromChance).toBeCloseTo(1 - outcome.abandonProbability, 9);
  });
});
