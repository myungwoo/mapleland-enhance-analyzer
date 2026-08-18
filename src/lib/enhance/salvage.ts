import { gridIndex, makeAxes, type Problem, type SalvageModel } from './types';

export interface EnhanceSalvage {
  /** 상태 (남은 업횟, 공격력) 의 이론가 */
  salvage: (slotsLeft: number, attack: number) => number;
  /** 목표 완성품을 시장에서 그냥 살 때의 값. 시세 표가 목표까지 안 닿으면 Infinity. */
  finishedPrice: number;
}

/**
 * 상태의 **이론가** W(u, a) — 그 물건을 손에 쥐고 최적으로 굴렸을 때의 가치.
 *
 *   W(u, a) = max( V(a),  max_s [ E W(u−1, ·) − c_s ] )
 *
 * 여기서 V(a) 는 사용자가 입력한 "업횟 0칸 기준 공격력별 시세"다.
 *
 * 남은 업횟의 가치를 사용자에게 묻지 않고 이렇게 유도하는 게 핵심이다. "1칸당 N메소"
 * 같은 상수를 입력받으면 시세 곡선과 거의 반드시 모순이 난다 — 예컨대 공7 시세 600만,
 * 공8 시세 900만인데 100% 주문서가 30만이면, 1칸 남은 공7 은 그 자체로 870만 이상의
 * 가치가 있다. 칸당 10만이라고 적으면 사서 주문서 한 장 바르는 것만으로 260만이
 * 공짜로 생기는 차익거래가 모델 안에 생겨 최소비용이 −∞ 로 발산한다.
 *
 * W 는 정의상 "주문서를 발라 얻을 수 있는 값"을 이미 포함하므로 그런 구멍이 없다.
 * 덤으로 이 값이 곧 매물 가치 평가("이 공5 3칸짜리 얼마가 적정?")에 그대로 쓰인다.
 */
export function makeEnhanceSalvage(problem: Problem): EnhanceSalvage {
  const priceAt = makeSalvageFn(problem.salvage);
  const known = problem.salvage?.byAttack.some((p) => p.attack >= problem.target) ?? false;
  const finishedPrice = known ? priceAt(problem.target) : Number.POSITIVE_INFINITY;

  if (!problem.salvage) return { salvage: () => 0, finishedPrice };

  const axes = makeAxes(problem);
  const { maxSlots, attackMin, attackMax, span } = axes;
  const table = new Float64Array((maxSlots + 1) * span);

  for (let u = 0; u <= maxSlots; u++) {
    for (let a = attackMin; a <= attackMax; a++) {
      const i = u * span + (a - attackMin);
      let best = priceAt(a);
      if (u > 0) {
        for (const s of problem.scrolls) {
          const hit = table[gridIndex(axes, u - 1, a + s.attackGain)];
          const miss = table[(u - 1) * span + (a - attackMin)];
          const v = s.successRate * hit + (1 - s.successRate) * miss - s.price;
          if (v > best) best = v;
        }
      }
      table[i] = best;
    }
  }

  return {
    salvage: (slotsLeft, attack) => table[gridIndex(axes, slotsLeft, attack)],
    finishedPrice,
  };
}

/**
 * 업횟 0칸 기준, 공격력별 시세를 보간한다.
 *
 * 메이플랜드 시세는 공격력이 오를수록 초선형으로 뛰므로 점 사이는 기하 보간(로그 선형)을
 * 쓴다. 가격 0이 끼면 산술 보간으로 떨어진다. 아래쪽은 같은 비율로 외삽하지만,
 * 위쪽으로는 외삽하지 않는다 — 공격력당 2배씩 뛰는 곡선을 몇 칸만 연장해도 값이
 * 폭주하고 있지도 않은 차익거래가 생겨난다.
 */
export function makeSalvageFn(model: SalvageModel | null): (attack: number) => number {
  if (!model || model.byAttack.length === 0) return () => 0;

  const pts = [...model.byAttack].sort((x, y) => x.attack - y.attack);

  return (attack) => {
    if (pts.length === 1) return Math.max(0, pts[0].price);
    if (attack <= pts[0].attack) return Math.max(0, extrapolate(pts[0], pts[1], attack));
    if (attack >= pts[pts.length - 1].attack) return Math.max(0, pts[pts.length - 1].price);

    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].attack <= attack) i++;
    return Math.max(0, interpolate(pts[i], pts[i + 1], attack));
  };
}

/**
 * "완성품을 시장에서 그냥 산다"를 베이스 매물 목록에 합성 항목으로 끼워 넣는다.
 *
 * 이렇게 두면 시작 선택지로도, 손절 후 갈아탈 대상으로도 자동으로 비교되고,
 * 기대비용이 완성품 시세 위로 올라가지 못하게 구조적으로 묶인다.
 * 이미 끼워져 있거나 시세를 모르면 그대로 돌려준다.
 */
export function prepareProblem(problem: Problem): Problem {
  if (problem.baseOptions.some((b) => b.offset >= problem.target)) return problem;
  const { finishedPrice } = makeEnhanceSalvage(problem);
  if (!Number.isFinite(finishedPrice)) return problem;
  return {
    ...problem,
    baseOptions: [
      ...problem.baseOptions,
      { offset: problem.target, price: finishedPrice, label: '완성품 직접 구매', synthetic: true },
    ],
  };
}

type Point = { attack: number; price: number };

function interpolate(lo: Point, hi: Point, attack: number): number {
  const t = (attack - lo.attack) / (hi.attack - lo.attack);
  if (lo.price > 0 && hi.price > 0) {
    return lo.price * Math.pow(hi.price / lo.price, t);
  }
  return lo.price + (hi.price - lo.price) * t;
}

/** `anchor` 를 기준점으로, `anchor`—`other` 구간의 기울기를 그대로 연장한다. */
function extrapolate(anchor: Point, other: Point, attack: number): number {
  const step = attack - anchor.attack;
  const span = anchor.attack - other.attack; // anchor 방향이 양수
  if (span === 0) return anchor.price;
  if (anchor.price > 0 && other.price > 0) {
    const ratioPerAttack = Math.pow(anchor.price / other.price, 1 / span);
    return anchor.price * Math.pow(ratioPerAttack, step);
  }
  return anchor.price + ((anchor.price - other.price) / span) * step;
}
