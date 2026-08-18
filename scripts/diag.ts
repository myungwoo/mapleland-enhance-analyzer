/** 시세 표를 넣으면 매물의 이론가를 계산해 준다. 예제 시세를 앞뒤 맞게 고를 때 쓴다. */
import { makeEnhanceSalvage } from '../src/lib/enhance/salvage';
import type { Problem, ScrollSpec, SalvageModel } from '../src/lib/enhance/types';

const 만 = 10_000;

function fair(scrolls: ScrollSpec[], salvage: SalvageModel, maxSlots: number, target: number) {
  const p: Problem = {
    maxSlots,
    scrolls,
    baseOptions: [{ offset: -1, price: 1 }, { offset: 0, price: 1 }, { offset: 1, price: 1 }],
    target,
    salvage,
    allowRestart: true,
  };
  const { salvage: W } = makeEnhanceSalvage(p);
  console.log(`  이론가 (업횟 ${maxSlots}회): 하옵 ${(W(maxSlots, -1) / 만).toFixed(0)}만 / 정옵 ${(W(maxSlots, 0) / 만).toFixed(0)}만 / 상옵 ${(W(maxSlots, 1) / 만).toFixed(0)}만`);
  for (let u = 0; u <= maxSlots; u++) {
    const row = [];
    for (let a = -1; a <= target; a++) row.push(`${(W(u, a) / 만).toFixed(0)}`.padStart(6));
    console.log(`  u=${u}` + row.join(''));
  }
}

console.log('[테스트 픽스처]');
fair(
  [
    { id: '100', label: '100%', successRate: 1, attackGain: 1, price: 200_000 },
    { id: '60', label: '60%', successRate: 0.6, attackGain: 2, price: 1_000_000 },
    { id: '10', label: '10%', successRate: 0.1, attackGain: 5, price: 3_000_000 },
  ],
  {
    byAttack: [
      { attack: 0, price: 200_000 }, { attack: 2, price: 1_200_000 },
      { attack: 4, price: 2_500_000 }, { attack: 5, price: 2_700_000 },
      { attack: 6, price: 2_900_000 },
    ],
  },
  7, 7,
);

console.log('\n[리포트 시나리오]');
fair(
  [
    { id: '100', label: '100%', successRate: 1, attackGain: 1, price: 30 * 만 },
    { id: '60', label: '60%', successRate: 0.6, attackGain: 2, price: 120 * 만 },
    { id: '10', label: '10%', successRate: 0.1, attackGain: 5, price: 400 * 만 },
  ],
  {
    byAttack: [
      { attack: 0, price: 50 * 만 }, { attack: 2, price: 280 * 만 },
      { attack: 4, price: 350 * 만 }, { attack: 5, price: 380 * 만 },
      { attack: 6, price: 400 * 만 }, { attack: 7, price: 600 * 만 },
      { attack: 8, price: 900 * 만 },
    ],
  },
  7, 10,
);
