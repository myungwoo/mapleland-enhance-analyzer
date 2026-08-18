import { convolve } from '../distribution';
import type { Outcome, Problem } from '../types';

/** 테스트에서 쓰는 현실적인 기준 문제 (한손검, 업횟 7, 목표 +7). */
export function baseProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    maxSlots: 7,
    scrolls: [
      { id: '100', label: '100%', successRate: 1.0, attackGain: 1, price: 200_000 },
      { id: '60', label: '60%', successRate: 0.6, attackGain: 2, price: 1_000_000 },
      { id: '10', label: '10%', successRate: 0.1, attackGain: 5, price: 3_000_000 },
    ],
    // 매물가는 그 매물의 이론가(npm run diag) 위여야 앞뒤가 맞는다.
    // 이론가보다 싼 매물은 사서 강화하는 것만으로 이득이라 최소비용이 정의되지 않는다.
    baseOptions: [
      { offset: -1, price: 2_000_000, label: '공1하' },
      { offset: 0, price: 4_000_000, label: '정옵' },
      { offset: 1, price: 9_000_000, label: '공1상' },
    ],
    target: 7,
    // 업횟 0회 기준 공격력별 시세. 남은 업횟의 값어치는 엔진이 이론가로 유도한다.
    // 목표(공7) 시세는 일부러 비워 뒀다 — 완성품 매물이 없어 직접 만들어야 하는,
    // 이 도구가 실제로 쓰이는 상황이다. 시세를 채우면 답은 "그냥 사라"로 자명해진다.
    salvage: {
      byAttack: [
        { attack: 0, price: 200_000 },
        { attack: 2, price: 1_200_000 },
        { attack: 4, price: 2_500_000 },
        { attack: 5, price: 2_700_000 },
        { attack: 6, price: 2_900_000 },
      ],
    },
    allowRestart: true,
    ...overrides,
  };
}

/** 리버스 무기 레벨업 1회당 공격력 — 유저들이 쓰는 추정값 */
export const REVERSE_PER_LEVEL: Outcome[] = [
  { value: 0, probability: 0.3 },
  { value: 1, probability: 0.5 },
  { value: 2, probability: 0.2 },
];

/**
 * 시작 공격력이 랜덤인 문제 (리버스 무기).
 * 매물가는 레벨업 기댓값이 얹힌 이론가보다 위여야 앞뒤가 맞는다.
 */
export function reverseProblem(overrides: Partial<Problem> = {}): Problem {
  return baseProblem({
    baseOptions: [{ offset: 0, price: 30_000_000, label: '리버스' }],
    startBonus: convolve(REVERSE_PER_LEVEL, 3),
    ...overrides,
  });
}

/** 결정론적 시뮬레이션을 위한 32비트 LCG. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
