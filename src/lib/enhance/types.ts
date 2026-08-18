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
 * **업횟을 다 쓴 상태**의 공격력별 시세만 받는다. 남은 업횟의 가치는 엔진이
 * 주문서 가격과 이 곡선으로부터 이론가를 유도해서 채운다 (salvage.ts 참고).
 * 사용자가 "1칸당 얼마" 를 직접 적으면 시세 곡선과 거의 반드시 모순이 나기 때문이다.
 */
export interface SalvageModel {
  /** 업횟 0칸 기준, (공격력 증가량 → 시세). 아는 점만 넣으면 나머지는 보간한다. */
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
  const attackMax = Math.max(
    problem.target,
    Math.max(0, ...offsets) + problem.maxSlots * maxGain,
  );
  return {
    maxSlots: problem.maxSlots,
    attackMin,
    attackMax,
    span: attackMax - attackMin + 1,
  };
}
