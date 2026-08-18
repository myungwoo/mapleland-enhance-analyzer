/** 비용 하나를 예산 격자 위의 두 분기로 쪼갠 결과. */
export interface TickCost {
  /** 아래쪽 분기가 소비하는 틱 수 */
  lo: number;
  /** 위쪽 분기가 소비하는 틱 수 (= lo + 1) */
  hi: number;
  /** 위쪽 분기의 확률. 0이면 lo 하나만 쓴다. */
  pHi: number;
}

/**
 * 비용을 예산 격자에 **확률적으로** 반올림한다.
 *
 * 매번 올림/내림하면 행동을 수십 번 반복하는 동안 편향이 누적돼 비용 분포가
 * 통째로 밀린다. lo 와 lo+1 을 소수부 확률로 섞으면 기대 소비 틱 수가 정확히
 * cost/tick 이 되어 편향이 사라진다.
 *
 * `minTicks` 는 예산 축에 순환이 생기지 않도록 최소 소비량을 강제할 때 쓴다
 * (재시작은 업횟을 되돌리므로 반드시 1틱 이상 소비해야 한다).
 */
export function tickCost(cost: number, tick: number, minTicks = 0): TickCost {
  const x = cost / tick;
  const floor = Math.floor(x);
  if (!Number.isFinite(x) || floor < minTicks) {
    return { lo: minTicks, hi: minTicks + 1, pHi: 0 };
  }
  return { lo: floor, hi: floor + 1, pHi: x - floor };
}
