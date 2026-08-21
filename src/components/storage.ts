'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Outcome } from '@/lib/enhance';
import { PRESETS } from '@/lib/enhance/data/presets';
import { BASE_OFFSETS, DEFAULT_INPUTS, type Inputs, type ReverseInputs } from './inputs';

/**
 * 입력값을 브라우저에 남긴다.
 *
 * 시세를 한 번 채우는 데 스무 칸 넘게 들어가는데 새로고침 한 번에 다 날아가면, 강화가
 * 며칠에 걸치는 이 도구는 두 번째 방문부터 쓸모가 없다. 서버가 없으니 자리는 localStorage
 * 하나뿐이다 — 입력은 이 브라우저 밖으로 나가지 않는다.
 *
 * ## 키에 접두어가 붙는 이유
 *
 * `mapleland.myungwoo.kr` 과 `myungwoo.github.io` 에서 이 앱은 다른 유틸들과 **오리진을
 * 공유한다.** localStorage 는 경로로 갈라지지 않아서, 접두어 없는 이름을 쓰면 옆 유틸의
 * 값을 조용히 덮어쓴다 (CLAUDE.md 7번).
 *
 * ## 저장한 값을 믿지 않는다
 *
 * 저장소에 든 것은 사용자가 콘솔로 고칠 수도 있고 예전 판의 이 앱이 쓴 것일 수도 있는,
 * 통제 밖의 데이터다. 그대로 상태에 넣으면 NaN 이 격자로 흘러 들어가 화면이 통째로
 * 죽는다. 읽을 때 칸마다 검사해서 **이상한 칸만** 기본값으로 되돌린다.
 */
const KEY = 'ml:enhance:state';

/** 저장 포맷 판 번호. 구조가 바뀌면 올린다 — 모르는 판은 통째로 버리고 기본값으로 연다. */
const VERSION = 1;

/** 타이핑이 멎고 이만큼 지나면 쓴다. 글자마다 쓰면 직렬화가 입력을 갉아먹는다. */
const SAVE_DELAY_MS = 400;

/**
 * 입력 패널 바깥에서 사용자가 손으로 넣는 값들 — "현재 상황" 패널의 진행 상태.
 *
 * 시세와 성격이 다르다(시세는 설정, 이쪽은 지금 굴리는 아이템의 진행)지만, 새로고침에
 * 날아가면 아쉬운 건 똑같아서 같이 저장한다.
 */
export interface Progress {
  /** 격자에서 고른 칸 = 지금 들고 있는 아이템의 상태 */
  selected: { slots: number; attack: number } | null;
  /** 아직 안 굴린 리버스 레벨업 횟수 */
  pendingLevels: number;
  /** 지금까지 쓴 돈 (메소) */
  spent: number;
}

export interface SavedState {
  inputs: Inputs;
  progress: Progress;
}

export const DEFAULT_PROGRESS: Progress = { selected: null, pendingLevels: 0, spent: 0 };

export const DEFAULT_STATE: SavedState = { inputs: DEFAULT_INPUTS, progress: DEFAULT_PROGRESS };

/* ── 검사기 ─────────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 유한한 수만 통과시키고 범위 밖은 잘라 낸다. 수가 아니면 fallback. */
function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 비워 둘 수 있는 금액 칸. 음수·NaN 은 "안 적음"으로 본다. */
function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const SCROLL_IDS = new Set(PRESETS.flatMap((p) => p.scrolls.map((s) => s.id)));

/**
 * 주문서 시세.
 *
 * 빈 객체를 기본값으로 되돌리지 않는다 — 전부 지운 것도 사용자의 선택이다(그러면 화면이
 * "입력이 더 필요합니다"로 돌아간다). 필드 자체가 없을 때만 기본값을 쓴다.
 */
function readScrollPrices(value: unknown): Record<string, number | null> {
  if (!isRecord(value)) return DEFAULT_INPUTS.scrollPrices;
  const out: Record<string, number | null> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!SCROLL_IDS.has(id)) continue;
    const p = price(raw);
    if (p !== null) out[id] = p;
  }
  return out;
}

/** 매물 시세. 칸 목록은 저장값이 아니라 코드가 정한다 — 빠진 줄이 있으면 표가 깨진다. */
function readBases(value: unknown): Inputs['bases'] {
  if (!Array.isArray(value)) return DEFAULT_INPUTS.bases;
  const saved = new Map<number, number | null>();
  for (const row of value) {
    if (!isRecord(row)) continue;
    const offset = num(row.offset, NaN);
    if (!(BASE_OFFSETS as readonly number[]).includes(offset)) continue;
    saved.set(offset, price(row.price));
  }
  return BASE_OFFSETS.map((offset) => ({ offset, price: saved.get(offset) ?? null }));
}

/** 완작 시세 칸의 세로 범위. 목표 상한(60)과 공5하까지 여유를 둔 값이다. */
const RESALE_ATTACK_MIN = -20;
const RESALE_ATTACK_MAX = 60;

/** 완작 시세. 여기서도 빈 객체는 그대로 둔다 — 되팔기를 끈 상태(리버스)가 그것이다. */
function readResale(value: unknown): Record<number, number | null> {
  if (!isRecord(value)) return DEFAULT_INPUTS.resale;
  const out: Record<number, number | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    const attack = Number(key);
    if (!Number.isInteger(attack) || attack < RESALE_ATTACK_MIN || attack > RESALE_ATTACK_MAX) {
      continue;
    }
    const p = price(raw);
    if (p !== null) out[attack] = p;
  }
  return out;
}

/**
 * 확률 분포 한 벌.
 *
 * 확률이 전부 0 이면 분포가 아니다. 엔진의 `normalize` 가 그런 벌을 "무조건 +0" 으로
 * 바꿔 조용히 넘어가므로, 화면에는 못 쓰는 표가 남고 계산은 레벨업이 없는 것처럼 돈다.
 * 그 벌은 통째로 기본값으로 되돌린다.
 */
function readOutcomes(value: unknown, fallback: Outcome[]): Outcome[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .slice(0, 32)
    .filter(isRecord)
    .map((row) => ({
      value: num(row.value, NaN, -100, 100),
      probability: num(row.probability, NaN, 0, 1),
    }))
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.probability));
  if (!rows.length || rows.every((row) => row.probability === 0)) return fallback;
  return rows;
}

function readReverse(value: unknown): ReverseInputs {
  const base = DEFAULT_INPUTS.reverse;
  if (!isRecord(value)) return base;
  return {
    enabled: bool(value.enabled, base.enabled),
    levels: Math.round(num(value.levels, base.levels, 0, 10)),
    attack: readOutcomes(value.attack, base.attack),
    mainStat: readOutcomes(value.mainStat, base.mainStat),
    subStat: readOutcomes(value.subStat, base.subStat),
  };
}

/** 저장값 → 입력. 어떤 쓰레기가 들어와도 화면이 뜨는 입력이 나와야 한다. */
export function sanitizeInputs(value: unknown): Inputs {
  const base = DEFAULT_INPUTS;
  if (!isRecord(value)) return base;
  const presetId =
    typeof value.presetId === 'string' && PRESETS.some((p) => p.id === value.presetId)
      ? value.presetId
      : base.presetId;
  return {
    presetId,
    maxSlots: Math.round(num(value.maxSlots, base.maxSlots, 1, 20)),
    target: Math.round(num(value.target, base.target, 1, 60)),
    scrollPrices: readScrollPrices(value.scrollPrices),
    bases: readBases(value.bases),
    resale: readResale(value.resale),
    // 예산은 비워 두는 게 정상 상태라 기본값으로 되돌리지 않는다.
    budget: price(value.budget),
    allowRestart: bool(value.allowRestart, base.allowRestart),
    reverse: readReverse(value.reverse),
  };
}

/** 진행 상태. 입력이 바뀌었을 수 있으니 그쪽 상한에 맞춰 자른다. */
export function sanitizeProgress(value: unknown, inputs: Inputs): Progress {
  if (!isRecord(value)) return DEFAULT_PROGRESS;
  const raw = value.selected;
  const selected = isRecord(raw)
    ? {
        slots: Math.round(num(raw.slots, NaN, 0, inputs.maxSlots)),
        attack: Math.round(num(raw.attack, NaN, -RESALE_ATTACK_MAX, RESALE_ATTACK_MAX)),
      }
    : null;
  return {
    selected:
      selected && Number.isFinite(selected.slots) && Number.isFinite(selected.attack)
        ? selected
        : null,
    pendingLevels: Math.round(num(value.pendingLevels, 0, 0, inputs.reverse.levels)),
    spent: num(value.spent, 0, 0),
  };
}

/** 저장 문자열 → 상태. 읽을 수 없으면 null 이고, 그때는 기본값으로 시작한다. */
export function parseSaved(raw: string): SavedState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== VERSION) return null;
  const inputs = sanitizeInputs(parsed.inputs);
  return { inputs, progress: sanitizeProgress(parsed.progress, inputs) };
}

export function serialize(state: SavedState): string {
  return JSON.stringify({ v: VERSION, inputs: state.inputs, progress: state.progress });
}

/* ── 저장소 ─────────────────────────────────────────────────────────────── */

// localStorage 는 있는데 못 쓰는 경우가 있다 (사파리 비공개 모드, 서드파티 저장소 차단,
// 용량 초과). 저장은 부가 기능이라, 실패해도 계산은 그대로 돌아가야 한다.

/**
 * 이번 방문에서 읽어 둔 저장값. 렌더 중에 매번 파싱하면 같은 내용이 매번 새 객체가 되어
 * 화면이 끝없이 다시 그려진다. 우리가 쓴 값도 여기 반영해 둔다.
 */
let cached: { state: SavedState | null } | null = null;

export function readState(): SavedState | null {
  if (typeof window === 'undefined') return null;
  if (cached) return cached.state;
  let state: SavedState | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    state = raw ? parseSaved(raw) : null;
  } catch {
    state = null;
  }
  cached = { state };
  return state;
}

export function writeState(state: SavedState): void {
  cached = { state };
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, serialize(state));
  } catch {
    /* 저장 못 해도 그만 */
  }
}

export function clearState(): void {
  cached = { state: null };
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* 지우지 못해도 그만 */
  }
}

/* ── 훅 ─────────────────────────────────────────────────────────────────── */

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * 화면 상태를 들고 있으면서 저장소와 맞춰 준다.
 *
 * 정적 내보내기라 HTML 이 빌드 때 미리 그려져 나온다. 그 HTML 에는 기본값이 박혀 있으니
 * 첫 렌더에서 저장값을 읽으면 하이드레이션이 깨진다. `useSyncExternalStore` 는 서버
 * 스냅샷으로 하이드레이션한 뒤 클라이언트 값으로 한 번 더 그려 주는, 이 경계를 넘는
 * 표준 수단이다.
 *
 * 사용자가 손대기 전까지 `edited` 는 null 이고, 그동안은 아무것도 쓰지 않는다.
 * 기본값이 저장값을 덮을 틈 자체를 없앤다.
 */
export function usePersistedState() {
  const hydrated = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const [edited, setEdited] = useState<SavedState | null>(null);
  const state = edited ?? (hydrated ? readState() : null) ?? DEFAULT_STATE;

  // 타이핑 중에 글자마다 쓰지 않는다. 손이 멎은 뒤에 한 번.
  useEffect(() => {
    if (edited === null) return;
    const timer = setTimeout(() => writeState(edited), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [edited]);

  // 위 타이머는 탭을 닫으면 타이머째 사라진다. 마지막 몇 글자를 잃지 않도록 나가기
  // 직전에 한 번 더 쓴다. beforeunload 는 모바일에서 안 오는 경우가 있어 pagehide 를 쓴다.
  const latest = useRef<SavedState | null>(null);
  useEffect(() => {
    latest.current = edited;
  }, [edited]);
  useEffect(() => {
    const flush = () => {
      if (latest.current) writeState(latest.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const update = useCallback((change: (prev: SavedState) => SavedState) => {
    setEdited((prev) => change(prev ?? readState() ?? DEFAULT_STATE));
  }, []);

  const setInputs = useCallback(
    (inputs: Inputs) => update((prev) => ({ ...prev, inputs })),
    [update],
  );

  const patchProgress = useCallback(
    (patch: Partial<Progress>) =>
      update((prev) => ({ ...prev, progress: { ...prev.progress, ...patch } })),
    [update],
  );

  const setSelected = useCallback(
    (selected: Progress['selected']) => patchProgress({ selected }),
    [patchProgress],
  );
  const setPendingLevels = useCallback(
    (pendingLevels: number) => patchProgress({ pendingLevels }),
    [patchProgress],
  );
  const setSpent = useCallback((spent: number) => patchProgress({ spent }), [patchProgress]);

  const reset = useCallback(() => {
    clearState();
    setEdited(DEFAULT_STATE);
  }, []);

  return {
    inputs: state.inputs,
    progress: state.progress,
    setInputs,
    setSelected,
    setPendingLevels,
    setSpent,
    reset,
  };
}
