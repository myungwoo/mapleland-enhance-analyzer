import { DEFAULT_PRESET_ID, findPreset, withPrices } from '@/lib/enhance/data/presets';
import type { Problem } from '@/lib/enhance';
import { MAN } from '@/lib/format';

/** 화면에서 다루는 입력. 금액은 전부 **만 메소** 단위다. */
export interface Inputs {
  presetId: string;
  maxSlots: number;
  target: number;
  scrollPrices: Record<string, number | null>;
  bases: Array<{ offset: number; price: number | null }>;
  /** 업횟 0칸 기준 공격력별 시세 (공격력 → 만 메소) */
  resale: Record<number, number | null>;
  budget: number | null;
  allowRestart: boolean;
}

export const BASE_OFFSETS = [-2, -1, 0, 1, 2] as const;

export function baseLabel(offset: number): string {
  if (offset === 0) return '정옵';
  return offset < 0 ? `공${-offset}하` : `공${offset}상`;
}

export const DEFAULT_INPUTS: Inputs = {
  presetId: DEFAULT_PRESET_ID,
  maxSlots: 7,
  target: 10,
  scrollPrices: { '100': 30, '60': 120, '10': 400 },
  bases: [
    { offset: -2, price: null },
    { offset: -1, price: 300 },
    { offset: 0, price: 800 },
    { offset: 1, price: 1500 },
    { offset: 2, price: null },
  ],
  // 목표(공10)는 일부러 비워 뒀다. 완성품 매물이 있으면 답은 "그냥 사라"로 자명해지고,
  // 이 분석이 값을 하는 건 매물이 없어 직접 만들어야 할 때다.
  resale: { 0: 50, 2: 280, 4: 350, 5: 380, 6: 400, 7: 600, 8: 900 },
  budget: 5000,
  allowRestart: true,
};

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
  };
}
