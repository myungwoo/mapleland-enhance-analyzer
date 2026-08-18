import type { ScrollSpec } from '../types';

/** 가격을 뺀 주문서 사양. 가격은 사용자가 채운다. */
export type ScrollTemplate = Omit<ScrollSpec, 'price'> & {
  /** public/icons 의 자체 제작 아이콘 경로 */
  icon: string;
};

export interface EnhancePreset {
  id: string;
  /** 부위/무기 종류 이름 */
  name: string;
  /** 올리는 능력치 이름 (화면 표기용) */
  statLabel: string;
  /** 업그레이드 가능 횟수 기본값. 아이템마다 다르므로 수정 가능해야 한다. */
  defaultSlots: number;
  scrolls: ScrollTemplate[];
}

/**
 * 무기 공격력 주문서 계열 — 100%:+1, 60%:+2, 10%:+5.
 * 한손검 공격력 주문서(인벤 아이템코드 2043000/2043001/2043002)로 확인했다.
 * 무기 종류가 달라도 성공률과 상승폭은 같다.
 *
 * 아이콘은 게임 원본이 아니라 직접 그린 것이다 (scripts/draw-scroll-icons.mjs).
 * 성공률별 색 코드(파랑/빨강/금색)만 게임과 맞췄다.
 */
const WEAPON_ATTACK: ScrollTemplate[] = [
  { id: '100', label: '100%', successRate: 1.0, attackGain: 1, icon: '/icons/scroll-100.svg' },
  { id: '60', label: '60%', successRate: 0.6, attackGain: 2, icon: '/icons/scroll-60.svg' },
  { id: '10', label: '10%', successRate: 0.1, attackGain: 5, icon: '/icons/scroll-10.svg' },
];

/**
 * 장갑 공격력 주문서 — 100%:+1, 60%:+2, 10%:+3.
 * 무기와 달리 10% 의 상승폭이 작아 최적 전략이 크게 달라진다.
 */
const GLOVE_ATTACK: ScrollTemplate[] = [
  { id: '100', label: '100%', successRate: 1.0, attackGain: 1, icon: '/icons/scroll-100.svg' },
  { id: '60', label: '60%', successRate: 0.6, attackGain: 2, icon: '/icons/scroll-60.svg' },
  { id: '10', label: '10%', successRate: 0.1, attackGain: 3, icon: '/icons/scroll-10.svg' },
];

const WEAPON_TYPES = [
  '한손검',
  '한손도끼',
  '한손둔기',
  '두손검',
  '두손도끼',
  '두손둔기',
  '창',
  '폴암',
  '단검',
  '아대',
  '활',
  '석궁',
] as const;

export const PRESETS: EnhancePreset[] = [
  ...WEAPON_TYPES.map((name) => ({
    id: `weapon-${name}`,
    name: `${name} 공격력`,
    statLabel: '공격력',
    defaultSlots: 7,
    scrolls: WEAPON_ATTACK,
  })),
  {
    id: 'glove-attack',
    name: '장갑 공격력',
    statLabel: '공격력',
    defaultSlots: 5,
    scrolls: GLOVE_ATTACK,
  },
];

export const DEFAULT_PRESET_ID = 'weapon-한손검';

export function findPreset(id: string): EnhancePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** 프리셋 + 가격 → 엔진이 먹는 ScrollSpec 배열. 가격을 안 적은 주문서는 빠진다. */
export function withPrices(
  preset: EnhancePreset,
  prices: Record<string, number | null>,
): ScrollSpec[] {
  return preset.scrolls
    .filter((s) => {
      const p = prices[s.id];
      return p !== null && p !== undefined && Number.isFinite(p) && p >= 0;
    })
    .map((s) => ({
      id: s.id,
      label: s.label,
      successRate: s.successRate,
      attackGain: s.attackGain,
      price: prices[s.id] as number,
    }));
}
