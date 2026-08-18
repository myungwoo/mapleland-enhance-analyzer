import type { Outcome } from './distribution';

export type { Outcome } from './distribution';

/**
 * 메이플랜드 주문서 강화 분석 엔진의 공용 타입.
 *
 * 좌표계 규약: 공격력은 언제나 "정옵 베이스 대비 증가량"으로 표현한다.
 * 상옵(+1) 무기를 사서 60%를 한 번 성공시키면 a = 3 이다.
 */

/** 주문서 1종. */
export interface ScrollSpec {
  /** 정책/결과에서 이 주문서를 가리키는 키. 예: '100', '60', '10' */
  id: string;
  /** 화면 표기용 이름. 예: '60%' */
  label: string;
  /** 성공 확률 (0~1) */
  successRate: number;
  /** 성공 시 공격력 증가량 */
  attackGain: number;
  /** 주문서 1장 시세 (메소) */
  price: number;
}

/** 새로 사올 수 있는 베이스 무기 매물 1종. */
export interface BaseOption {
  /** 정옵 대비 공격력 차이. 하옵이면 음수, 상옵이면 양수. */
  offset: number;
  /** 매물 시세 (메소) */
  price: number;
  /** 화면 표기용 이름. 예: '공1상' */
  label?: string;
  /**
   * 엔진이 끼워 넣은 "완성품 직접 구매" 항목인지.
   * 실제로 강화해서 도달할 수 있는 상태를 따질 때는 이 항목을 빼야 한다.
   */
  synthetic?: boolean;
}

/**
 * 중간 산출물(손절 대상)의 시세.
 *
 * **업횟을 다 쓴 상태**의 공격력별 시세만 받는다. 업횟이 남은 매물은 거래가 거의 없어
 * 시세랄 게 없고, 그 상태의 값은 엔진이 주문서 가격과 이 곡선에서 유도한다 (salvage.ts).
 * 사용자가 "1회당 얼마" 를 직접 적으면 시세 곡선과 거의 반드시 모순이 나기 때문이기도 하다.
 */
export interface SalvageModel {
  /**
   * 업횟 0회 기준, (공격력 증가량 → 시세). 아는 점만 넣으면 나머지는 보간한다.
   *
   * 양 끝 바깥으로는 외삽하지 않고 끝점 값을 유지한다. 특히 **최저 점의 값이 그 아래
   * 전부의 바닥값**이다 — 어느 선 밑으로는 완작이라도 유저끼리 안 팔리고 상점 판매가
   * 회수의 전부라서다. 그래서 최저 점에는 상점 판매가를(상점행이 싫으면 0을) 적는다.
   */
  byAttack: Array<{ attack: number; price: number }>;
}

/** 분석할 강화 문제 하나. */
export interface Problem {
  /** 무기의 업그레이드 가능 횟수 */
  maxSlots: number;
  /** 사용 가능한 주문서 목록 (가격 포함) */
  scrolls: ScrollSpec[];
  /** 베이스 무기 매물 후보 */
  baseOptions: BaseOption[];
  /** 목표 공격력 증가량. 이 값 이상이면 달성. */
  target: number;
  /** 손절 회수 가치. null이면 버릴 때 한 푼도 못 건진다고 본다. */
  salvage: SalvageModel | null;
  /** 손절 후 새 무기로 다시 시작하는 선택지를 허용할지 */
  allowRestart: boolean;
  /**
   * 갓 사온 매물이 랜덤한 시작 공격력을 갖는 경우 — 리버스 무기의 아이템 레벨업.
   *
   * **레벨업을 먼저 끝낸 뒤 강화를 시작한다고 본다.** 목표 공격력을 두고 강화하는
   * 상황이라면 이쪽이 유리하다 — 레벨업은 메소가 아니라 사냥 시간을 쓰므로 이 모델에서
   * 공짜이고, 시작 공격력을 보고 주문서 전략을 짜면 나쁘게 뜬 무기에 주문서를 붓는 일을
   * 피할 수 있다. 정보가 늘 뿐이라 손해 볼 여지가 없다.
   *
   * 실제로 어느 쪽을 먼저 하느냐는 취향에 가깝고(사냥할 때 이미 강화된 무기를 들고
   * 싶다든가), 여기서 다루는 건 어디까지나 메소 기준의 최적이다.
   */
  startBonus?: Outcome[] | null;
}

/** 정책 격자의 한 칸이 지시하는 행동. */
export type Action =
  | { kind: 'done' }
  | { kind: 'scroll'; scrollIndex: number }
  | { kind: 'restart'; baseIndex: number }
  | { kind: 'infeasible' };

/** 정책 격자 내부 인코딩. 0..scrolls.length-1 은 주문서 인덱스. */
export const ACTION_RESTART_BASE = 100; // 100 + baseIndex
export const ACTION_DONE = 250;
export const ACTION_INFEASIBLE = 251;

export function decodeAction(code: number): Action {
  if (code === ACTION_DONE) return { kind: 'done' };
  if (code === ACTION_INFEASIBLE) return { kind: 'infeasible' };
  if (code >= ACTION_RESTART_BASE) {
    return { kind: 'restart', baseIndex: code - ACTION_RESTART_BASE };
  }
  return { kind: 'scroll', scrollIndex: code };
}

/** (남은 업횟, 공격력) 격자의 축 정보. 모든 DP 결과가 이 인덱싱을 공유한다. */
export interface Axes {
  maxSlots: number;
  /** 공격력 축의 하한 (보통 가장 낮은 하옵 오프셋) */
  attackMin: number;
  /** 공격력 축의 상한 (목표와 이론상 최대 도달치 중 큰 값) */
  attackMax: number;
  /** attackMax - attackMin + 1 */
  span: number;
}

/** 시작 보너스가 낼 수 있는 최대 공격력. 없으면 0. */
export function maxStartBonus(problem: Problem): number {
  const positive = problem.startBonus?.filter((o) => o.probability > 0) ?? [];
  return positive.length ? Math.max(...positive.map((o) => o.value)) : 0;
}

/** (u, a) → 1차원 인덱스 */
export function gridIndex(axes: Axes, slotsLeft: number, attack: number): number {
  const a = attack < axes.attackMin
    ? axes.attackMin
    : attack > axes.attackMax
      ? axes.attackMax
      : attack;
  return slotsLeft * axes.span + (a - axes.attackMin);
}

export function makeAxes(problem: Problem): Axes {
  const offsets = problem.baseOptions.map((b) => b.offset);
  const maxGain = Math.max(...problem.scrolls.map((s) => s.attackGain), 0);
  const attackMin = Math.min(0, ...offsets);
  // 리버스 레벨업처럼 매물이 공격력을 달고 나오면 도달 범위가 그만큼 넓어진다.
  const maxBonus = maxStartBonus(problem);
  const attackMax = Math.max(
    problem.target,
    Math.max(0, ...offsets) + maxBonus + problem.maxSlots * maxGain,
  );
  return {
    maxSlots: problem.maxSlots,
    attackMin,
    attackMax,
    span: attackMax - attackMin + 1,
  };
}
