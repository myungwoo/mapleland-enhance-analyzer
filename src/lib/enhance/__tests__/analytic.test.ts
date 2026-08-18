import { describe, expect, it } from 'vitest';
import { solveMinCost } from '../dp-cost';
import { solveMaxSuccess } from '../dp-budget';
import type { Problem } from '../types';
import { baseProblem } from './fixtures';

const cheapBase: Problem = {
  maxSlots: 5,
  scrolls: [{ id: '100', label: '100%', successRate: 1, attackGain: 1, price: 1_000 }],
  baseOptions: [{ offset: 0, price: 10_000 }],
  target: 5,
  salvage: null,
  allowRestart: true,
};

describe('닫힌 형태와의 대조', () => {
  it('100% 주문서만 쓰면 비용이 결정론적이다', () => {
    const s = solveMinCost(cheapBase);
    expect(s.expectedCost).toBeCloseTo(10_000 + 5 * 1_000, 6);
  });

  it('60% 한 방 승부의 기대비용은 (매물가 + 주문서가) / 0.6', () => {
    const s = solveMinCost({
      maxSlots: 1,
      scrolls: [{ id: '60', label: '60%', successRate: 0.6, attackGain: 2, price: 1_000 }],
      baseOptions: [{ offset: 0, price: 10_000 }],
      target: 2,
      salvage: null,
      allowRestart: true,
    });
    expect(s.expectedCost).toBeCloseTo(11_000 / 0.6, 3);
  });

  it('10% 한 방 승부의 기대비용은 (매물가 + 주문서가) / 0.1', () => {
    const s = solveMinCost({
      maxSlots: 1,
      scrolls: [{ id: '10', label: '10%', successRate: 0.1, attackGain: 5, price: 1_000 }],
      baseOptions: [{ offset: 0, price: 10_000 }],
      target: 5,
      salvage: null,
      allowRestart: true,
    });
    expect(s.expectedCost).toBeCloseTo(11_000 / 0.1, 2);
  });

  it('손절로 회수한 금액만큼 기대비용이 줄어든다', () => {
    // 실패하면 남는 무기를 3,000 에 팔 수 있으므로 재시도 1회당 순비용이 3,000 싸진다.
    const s = solveMinCost({
      maxSlots: 1,
      scrolls: [{ id: '60', label: '60%', successRate: 0.6, attackGain: 2, price: 1_000 }],
      baseOptions: [{ offset: 0, price: 10_000 }],
      target: 2,
      salvage: { byAttack: [{ attack: 0, price: 3_000 }] },
      allowRestart: true,
    });
    // R = 10000 + 1000 + 0.4·(R − 3000)  →  0.6R = 9800
    expect(s.expectedCost).toBeCloseTo(9_800 / 0.6, 3);
  });
});

describe('도달 불가 판정', () => {
  it('업횟으로 낼 수 있는 최대치를 넘는 목표는 infeasible', () => {
    const s = solveMinCost(baseProblem({ target: 40 }));
    expect(s.feasible).toBe(false);
    expect(s.expectedCost).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('단조성 불변식', () => {
  const cost = (p: Partial<Problem>) => solveMinCost(baseProblem(p)).expectedCost;

  it('목표가 높아지면 기대비용이 오른다', () => {
    const seq = [3, 5, 7, 9, 11].map((target) => cost({ target }));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]);
  });

  it('업횟이 늘면 기대비용이 내린다', () => {
    const seq = [4, 5, 6, 7, 8].map((maxSlots) => cost({ maxSlots }));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
  });

  it('주문서가 비싸지면 기대비용이 오른다', () => {
    const base = baseProblem();
    const seq = [1, 2, 4, 8].map((mult) =>
      solveMinCost({
        ...base,
        scrolls: base.scrolls.map((s) => (s.id === '60' ? { ...s, price: s.price * mult } : s)),
      }).expectedCost,
    );
    expect(seq[1]).toBeGreaterThan(seq[0]);
    // 완성품을 그냥 사는 선택지가 있어 위로는 평평해진다. 내려가면 안 된다.
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1] - 1e-6);
  });

  it('선택지를 뺏으면 기대비용이 오를 수는 있어도 내려가지 않는다', () => {
    const base = baseProblem();
    const all = solveMinCost(base).expectedCost;
    for (let i = 0; i < base.scrolls.length; i++) {
      const fewer = solveMinCost({
        ...base,
        scrolls: base.scrolls.filter((_, j) => j !== i),
      }).expectedCost;
      expect(fewer).toBeGreaterThanOrEqual(all - 1e-6);
    }
    const noRestart = solveMinCost({ ...base, allowRestart: false }).expectedCost;
    expect(noRestart).toBeGreaterThanOrEqual(all - 1e-6);
  });

  it('예산이 늘면 달성 확률이 오른다', () => {
    const s = solveMaxSuccess(baseProblem(), { budget: 400_000_000, ticks: 800 });
    for (let b = 1; b <= s.ticks; b++) {
      expect(s.curve[b]).toBeGreaterThanOrEqual(s.curve[b - 1] - 1e-6);
    }
    expect(s.successProbability).toBeGreaterThan(0);
    expect(s.successProbability).toBeLessThanOrEqual(1);
  });
});
