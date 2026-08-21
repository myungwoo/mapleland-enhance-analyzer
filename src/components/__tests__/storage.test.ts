import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, toProblem } from '../inputs';
import {
  DEFAULT_PROGRESS,
  DEFAULT_STATE,
  parseSaved,
  sanitizeInputs,
  sanitizeProgress,
  serialize,
} from '../storage';

/**
 * 저장소에 든 값은 통제 밖의 데이터다. 예전 판이 쓴 것일 수도, 사용자가 콘솔로 고친
 * 것일 수도 있다. 여기서 보는 건 "그 무엇이 들어와도 화면이 뜨는 입력이 나오는가" 다.
 */
describe('저장값 복원', () => {
  it('쓴 그대로 읽는다', () => {
    expect(parseSaved(serialize(DEFAULT_STATE))).toEqual(DEFAULT_STATE);
  });

  it('사용자가 고친 값을 그대로 살린다', () => {
    const mine = {
      ...DEFAULT_INPUTS,
      target: 12,
      maxSlots: 5,
      budget: 12_000,
      allowRestart: false,
    };
    const restored = parseSaved(serialize({ inputs: mine, progress: DEFAULT_PROGRESS }));
    expect(restored?.inputs).toEqual(mine);
  });

  it('JSON 이 아니거나 모르는 판이면 버린다', () => {
    expect(parseSaved('{')).toBeNull();
    expect(parseSaved('null')).toBeNull();
    expect(parseSaved('"ml:theme 값이 잘못 들어옴"')).toBeNull();
    expect(parseSaved(JSON.stringify({ v: 99, inputs: DEFAULT_INPUTS }))).toBeNull();
  });
});

describe('입력 검사', () => {
  it('이상한 칸만 기본값으로 되돌린다', () => {
    const restored = sanitizeInputs({
      ...DEFAULT_INPUTS,
      target: 'twelve',
      maxSlots: NaN,
      allowRestart: 'yes',
      // 채워 둔 시세는 살아남아야 한다 — 한 칸 깨졌다고 스무 칸을 날리면 저장의 뜻이 없다.
      resale: { 0: 50, 4: 350 },
    });
    expect(restored.target).toBe(DEFAULT_INPUTS.target);
    expect(restored.maxSlots).toBe(DEFAULT_INPUTS.maxSlots);
    expect(restored.allowRestart).toBe(DEFAULT_INPUTS.allowRestart);
    expect(restored.resale).toEqual({ 0: 50, 4: 350 });
  });

  it('범위 밖 수는 잘라 낸다', () => {
    expect(sanitizeInputs({ maxSlots: 999 }).maxSlots).toBe(20);
    expect(sanitizeInputs({ target: -3 }).target).toBe(1);
    expect(sanitizeInputs({ reverse: { levels: 40 } }).reverse.levels).toBe(10);
  });

  it('비운 칸은 비운 채로 둔다', () => {
    // 전부 지우는 것도 사용자의 선택이다. 완작 시세를 다 비우면 되팔기가 꺼진다(리버스).
    const empty = sanitizeInputs({ ...DEFAULT_INPUTS, resale: {}, budget: null });
    expect(empty.resale).toEqual({});
    expect(empty.budget).toBeNull();
  });

  it('매물 줄은 저장값이 아니라 코드가 정한다', () => {
    const restored = sanitizeInputs({ bases: [{ offset: 0, price: 700 }, { offset: 99, price: 1 }] });
    expect(restored.bases).toHaveLength(DEFAULT_INPUTS.bases.length);
    expect(restored.bases.find((b) => b.offset === 0)?.price).toBe(700);
    expect(restored.bases.find((b) => b.offset === 1)?.price).toBeNull();
    expect(restored.bases.some((b) => b.offset === 99)).toBe(false);
  });

  it('모르는 주문서 아이디와 음수 시세는 버린다', () => {
    const restored = sanitizeInputs({ scrollPrices: { '100': 30, '60': -5, hack: 1 } });
    expect(restored.scrollPrices).toEqual({ '100': 30 });
  });

  it('없는 프리셋은 기본 프리셋으로 돌린다', () => {
    expect(sanitizeInputs({ presetId: '없는프리셋' }).presetId).toBe(DEFAULT_INPUTS.presetId);
  });

  it('확률이 전부 0 인 분포는 쓰지 않는다', () => {
    const zeroed = sanitizeInputs({
      reverse: { ...DEFAULT_INPUTS.reverse, attack: [{ value: 1, probability: 0 }] },
    });
    expect(zeroed.reverse.attack).toEqual(DEFAULT_INPUTS.reverse.attack);
  });

  it('무엇이 들어와도 엔진에 넣을 수 있는 입력이 나온다', () => {
    const garbage: unknown[] = [
      null,
      42,
      'ml:enhance:state',
      [],
      { inputs: { target: Infinity } },
      { resale: { '0': 'free' }, bases: 'none', reverse: { attack: 'nope' } },
    ];
    for (const value of garbage) {
      const inputs = sanitizeInputs(value);
      expect(() => toProblem(inputs)).not.toThrow();
      expect(Number.isFinite(inputs.target)).toBe(true);
      expect(Number.isFinite(inputs.maxSlots)).toBe(true);
    }
  });
});

describe('진행 상태 검사', () => {
  it('입력이 줄어든 만큼 잘라 준다', () => {
    // 저장한 뒤에 업횟이나 레벨업 횟수를 줄였을 수 있다. 격자 밖 칸을 그대로 살리면
    // "없는 칸"을 고른 상태가 된다.
    const inputs = sanitizeInputs({ ...DEFAULT_INPUTS, maxSlots: 3, reverse: { ...DEFAULT_INPUTS.reverse, levels: 1 } });
    const progress = sanitizeProgress({ selected: { slots: 7, attack: 4 }, pendingLevels: 3, spent: 1_000 }, inputs);
    expect(progress.selected).toEqual({ slots: 3, attack: 4 });
    expect(progress.pendingLevels).toBe(1);
    expect(progress.spent).toBe(1_000);
  });

  it('쓴 돈은 음수가 되지 않는다', () => {
    expect(sanitizeProgress({ spent: -5 }, DEFAULT_INPUTS).spent).toBe(0);
    expect(sanitizeProgress({ spent: 'lots' }, DEFAULT_INPUTS).spent).toBe(0);
  });

  it('고른 칸이 깨졌으면 안 고른 것으로 본다', () => {
    expect(sanitizeProgress({ selected: { slots: 'a', attack: 1 } }, DEFAULT_INPUTS).selected).toBeNull();
    expect(sanitizeProgress({ selected: null }, DEFAULT_INPUTS).selected).toBeNull();
  });
});
