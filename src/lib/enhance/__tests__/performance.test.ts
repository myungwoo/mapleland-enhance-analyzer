import { describe, expect, it } from 'vitest';
import { analyze, convolve } from '../index';
import { baseProblem, REVERSE_PER_LEVEL } from './fixtures';

/**
 * 화면에서 글자 하나 칠 때마다 도는 계산이라 느려지면 바로 체감된다.
 *
 * 한때 분포를 섞는 자리에서 매번 normalize() 를 불러 최내곽 루프에서 배열을 새로
 * 만들었고, 리버스 + 매물 11개 조합이 900ms 를 넘겼다. 인덱스를 미리 접어 200ms 아래로
 * 내렸다. 여유를 크게 두었으니 이 한도를 넘으면 그런 종류의 회귀가 다시 생긴 것이다.
 */
describe('최악 입력의 계산 시간', () => {
  const worst = baseProblem({
    target: 12,
    startBonus: convolve(REVERSE_PER_LEVEL, 3),
    baseOptions: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((offset) => ({
      offset,
      price: 30_000_000 + (offset + 5) * 8_000_000,
    })),
  });

  it('예산·손익분기까지 다 켜도 2초를 넘지 않는다', () => {
    analyze(worst, { budget: 100_000_000, includeBreakeven: true }); // 예열
    const started = performance.now();
    analyze(worst, { budget: 100_000_000, includeBreakeven: true });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('매물이 11개로 늘어도 3개일 때의 20배를 넘지 않는다', () => {
    const few = baseProblem({ target: 12, startBonus: convolve(REVERSE_PER_LEVEL, 3) });
    const time = (p: Parameters<typeof analyze>[0]) => {
      analyze(p, { budget: 100_000_000 });
      const started = performance.now();
      analyze(p, { budget: 100_000_000 });
      return performance.now() - started;
    };
    expect(time(worst)).toBeLessThan(time(few) * 20 + 200);
  });
});

/**
 * 고정점을 반복 대입으로 풀던 시절, 손절 확률이 1 에 가까운 빡센 목표에서 횟수 제한에
 * 걸려 조용히 어중간한 값을 돌려줬다. 목표 16 과 18 이 똑같이 3.005억으로 나왔고,
 * 그 값으로 예산 축이 좁아져 비용 CDF 가 통째로 0 이 되고 분위수가 무한대로 튀었다.
 * 화면에서는 SVG 좌표가 NaN 이 되어 콘솔 에러로 드러났다.
 */
describe('빡센 목표에서도 고정점이 수렴한다', () => {
  const targets = [14, 15, 16, 17, 18, 20];
  const solved = targets.map((target) => analyze(baseProblem({ target })));

  it('목표가 오를수록 기대비용이 엄격히 증가한다', () => {
    for (let i = 1; i < solved.length; i++) {
      expect(solved[i].cost.expectedCost).toBeGreaterThan(solved[i - 1].cost.expectedCost);
    }
  });

  it('분위수가 무한대로 튀지 않는다', () => {
    for (const r of solved) {
      const q = r.distribution!.quantiles;
      for (const v of [q.p50, q.p75, q.p90, q.p99]) expect(Number.isFinite(v)).toBe(true);
      expect(r.distribution!.coverage).toBeGreaterThan(0.99);
    }
  });
});
