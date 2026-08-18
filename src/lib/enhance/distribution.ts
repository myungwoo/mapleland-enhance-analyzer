/** 이산 확률 분포의 한 항. */
export interface Outcome {
  /** 증가량 */
  value: number;
  /** 확률. 합이 1이 아니면 정규화해서 쓴다. */
  probability: number;
}

/** 합이 1이 되도록 맞추고, 확률 0 인 항과 음수는 걷어낸다. */
export function normalize(outcomes: Outcome[]): Outcome[] {
  const valid = outcomes.filter((o) => Number.isFinite(o.probability) && o.probability > 0);
  const total = valid.reduce((sum, o) => sum + o.probability, 0);
  if (total <= 0) return [{ value: 0, probability: 1 }];

  const merged = new Map<number, number>();
  for (const o of valid) {
    merged.set(o.value, (merged.get(o.value) ?? 0) + o.probability / total);
  }
  return [...merged.entries()]
    .map(([value, probability]) => ({ value, probability }))
    .sort((a, b) => a.value - b.value);
}

/** 같은 분포를 `times` 번 독립으로 더했을 때의 분포. */
export function convolve(outcomes: Outcome[], times: number): Outcome[] {
  const one = normalize(outcomes);
  let total: Outcome[] = [{ value: 0, probability: 1 }];
  for (let i = 0; i < Math.max(0, Math.round(times)); i++) {
    const next = new Map<number, number>();
    for (const a of total) {
      for (const b of one) {
        next.set(a.value + b.value, (next.get(a.value + b.value) ?? 0) + a.probability * b.probability);
      }
    }
    total = [...next.entries()]
      .map(([value, probability]) => ({ value, probability }))
      .sort((x, y) => x.value - y.value);
  }
  return total;
}

export function expectedValue(outcomes: Outcome[]): number {
  return normalize(outcomes).reduce((sum, o) => sum + o.value * o.probability, 0);
}

/** P(값 ≥ threshold) */
export function probabilityAtLeast(outcomes: Outcome[], threshold: number): number {
  return normalize(outcomes)
    .filter((o) => o.value >= threshold)
    .reduce((sum, o) => sum + o.probability, 0);
}

/** 분포를 따라 f(값) 의 기댓값을 낸다. 상태 진입점을 섞을 때 쓴다. */
export function mix(outcomes: Outcome[] | null | undefined, f: (value: number) => number): number {
  if (!outcomes || outcomes.length === 0) return f(0);
  let sum = 0;
  for (const o of normalize(outcomes)) sum += o.probability * f(o.value);
  return sum;
}
