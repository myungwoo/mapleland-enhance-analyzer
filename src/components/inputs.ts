import { DEFAULT_PRESET_ID, findPreset, withPrices } from '@/lib/enhance/data/presets';
import { convolve, type Outcome, type Problem } from '@/lib/enhance';
import { MAN } from '@/lib/format';

/** 화면에서 다루는 입력. 금액은 전부 **만 메소** 단위다. */
export interface Inputs {
  presetId: string;
  maxSlots: number;
  target: number;
  scrollPrices: Record<string, number | null>;
  bases: Array<{ offset: number; price: number | null }>;
  /** 업횟 0회 기준 공격력별 시세 (공격력 → 만 메소) */
  resale: Record<number, number | null>;
  budget: number | null;
  allowRestart: boolean;
  reverse: ReverseInputs;
}

/**
 * 리버스 무기의 아이템 레벨업.
 *
 * 확률은 유출된 값이 아니라 유저들의 추정이라 전부 조절 가능하다.
 * 강화 분석에 실제로 들어가는 건 공격력뿐이고, 주스탯/부스탯은 참고용 분포만 보여 준다
 * (엔진이 공격력 하나로 상태를 잡고 있어서, 스탯까지 넣으면 격자가 통째로 커진다).
 */
export interface ReverseInputs {
  enabled: boolean;
  levels: number;
  attack: Outcome[];
  mainStat: Outcome[];
  subStat: Outcome[];
}

/** 인게임 매물은 공5하 ~ 공5상까지 나온다. */
export const BASE_OFFSETS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5] as const;

export function baseLabel(offset: number): string {
  if (offset === 0) return '정옵';
  return offset < 0 ? `공${-offset}하` : `공${offset}상`;
}

export const DEFAULT_INPUTS: Inputs = {
  presetId: DEFAULT_PRESET_ID,
  maxSlots: 7,
  target: 10,
  scrollPrices: { '100': 30, '60': 120, '10': 400 },
  bases: BASE_OFFSETS.map((offset) => ({
    offset,
    price: offset === -1 ? 300 : offset === 0 ? 800 : offset === 1 ? 1500 : null,
  })),
  // 목표(공10)는 일부러 비워 뒀다. 완성품 매물이 있으면 답은 "그냥 사라"로 자명해지고,
  // 이 분석이 값을 하는 건 매물이 없어 직접 만들어야 할 때다.
  resale: { 0: 50, 2: 280, 4: 350, 5: 380, 6: 400, 7: 600, 8: 900 },
  budget: 5000,
  allowRestart: true,
  reverse: {
    enabled: false,
    levels: 3,
    attack: [
      { value: 0, probability: 0.3 },
      { value: 1, probability: 0.5 },
      { value: 2, probability: 0.2 },
    ],
    mainStat: [
      { value: 1, probability: 0.6 },
      { value: 2, probability: 0.4 },
    ],
    subStat: [
      { value: 0, probability: 0.6 },
      { value: 1, probability: 0.4 },
    ],
  },
};

/** 레벨업을 n회 마쳤을 때의 누적 분포. 안 쓰면 null. */
export function reverseAttackBonus(reverse: ReverseInputs, levels = reverse.levels): Outcome[] | null {
  if (!reverse.enabled || levels <= 0) return null;
  return convolve(reverse.attack, levels);
}

/** 화면 입력 → 엔진 입력. 필수 항목이 비면 null 을 준다. */
export function toProblem(inputs: Inputs): Problem | null {
  const preset = findPreset(inputs.presetId);
  const scrolls = withPrices(
    preset,
    Object.fromEntries(
      Object.entries(inputs.scrollPrices).map(([k, v]) => [k, v === null ? null : v * MAN]),
    ),
  );

  const baseOptions = inputs.bases
    .filter((b) => b.price !== null && Number.isFinite(b.price) && b.price > 0)
    .map((b) => ({ offset: b.offset, price: (b.price as number) * MAN, label: baseLabel(b.offset) }));

  const byAttack = Object.entries(inputs.resale)
    .filter(([, v]) => v !== null && Number.isFinite(v) && (v as number) >= 0)
    .map(([attack, price]) => ({ attack: Number(attack), price: (price as number) * MAN }))
    .sort((a, b) => a.attack - b.attack);

  if (!scrolls.length || !baseOptions.length) return null;
  if (!Number.isFinite(inputs.maxSlots) || inputs.maxSlots < 1) return null;
  if (!Number.isFinite(inputs.target) || inputs.target < 1) return null;

  return {
    maxSlots: Math.min(20, Math.round(inputs.maxSlots)),
    scrolls,
    baseOptions,
    target: Math.min(60, Math.round(inputs.target)),
    salvage: byAttack.length ? { byAttack } : null,
    allowRestart: inputs.allowRestart,
    startBonus: reverseAttackBonus(inputs.reverse),
  };
}
