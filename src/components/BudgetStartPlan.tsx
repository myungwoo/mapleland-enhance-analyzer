'use client';

import type { Action, Analysis } from '@/lib/enhance';
import { formatMeso, formatPercent } from '@/lib/format';

/**
 * "가진 돈이 얼마냐에 따라 사야 할 매물이 달라진다" 를 보여 주는 표.
 *
 * 예산 곡선(초록)이 비용 곡선 위로 벌어지는 이유의 절반은 여기에 있다. 예산이 빠듯하면
 * 비싼 매물은 사고 나서 주문서 살 돈이 없어지고, 넉넉하면 싸게 사서 여러 번 도전하는
 * 쪽이 유리해진다. 결론 패널의 매물은 최소비용 기준이라 이 표와 다를 수 있다.
 */
export function BudgetStartPlan({
  analysis,
  budgetMeso,
}: {
  analysis: Analysis;
  /** 사용자가 잡은 예산. 안 잡았으면 null */
  budgetMeso: number | null;
}) {
  const { problem, budgetStartBands: bands } = analysis;
  if (!bands.length) return null;

  const nameOf = (index: number) => {
    const base = problem.baseOptions[index];
    return base.synthetic ? '완성품 직접 구매' : (base.label ?? `공${base.offset}`);
  };
  const floor = bands[0].from;
  const belowFloor = budgetMeso !== null && budgetMeso < floor;

  // 답이 하나뿐이면 표를 만들 이유가 없다 — 매물 선택이 예산을 안 타는 문제다.
  if (bands.length === 1) {
    return (
      <div className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-2">
        예산이 얼마든 첫 매물은 <b className="text-gold">{nameOf(bands[0].baseIndex)}</b>{' '}
        입니다 — 이 문제에서는 사야 할 물건이 가진 돈에 따라 달라지지 않습니다.
        {floor > 0 && <> 다만 {formatMeso(floor)} 아래로는 무엇을 사도 목표를 만들지 못합니다.</>}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-2">
      <div className="mb-1.5 text-[11px] text-ink-2">
        가진 돈에 따라 <b className="text-ink-1">사야 할 매물이 달라집니다</b>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] text-[11px]">
          <thead>
            <tr className="text-ink-3">
              <th className="pb-1 text-left font-normal">가진 돈</th>
              <th className="pb-1 text-left font-normal">사야 할 매물</th>
              <th className="pb-1 text-right font-normal">호가</th>
              <th className="pb-1 text-right font-normal">달성 확률</th>
              <th className="pb-1 text-right font-normal">차선 대비</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {bands.map((band, i) => {
              const last = i === bands.length - 1;
              const mine =
                budgetMeso !== null &&
                budgetMeso >= band.from &&
                (last || budgetMeso <= band.to);
              return (
                <tr
                  key={band.from}
                  className={`border-t border-line ${mine ? 'bg-[#152420]' : ''}`}
                >
                  <td className={`py-1 ${mine ? 'text-ink-1' : 'text-ink-2'}`}>
                    {last
                      ? `${formatMeso(band.from)} 이상`
                      : `${formatMeso(band.from)} ~ ${formatMeso(band.to)}`}
                  </td>
                  <td className={`py-1 ${mine ? 'text-gold' : 'text-ink-1'}`}>
                    {nameOf(band.baseIndex)}
                    {mine && <span className="ml-1 text-[10px] text-ink-3">← 내 예산</span>}
                  </td>
                  <td className="py-1 text-right text-ink-3">
                    {formatMeso(problem.baseOptions[band.baseIndex].price)}
                  </td>
                  <td className="py-1 text-right text-ink-1">
                    {formatPercent(band.chanceFrom)} → {formatPercent(band.chanceTo)}
                  </td>
                  <td className="py-1 text-right text-ink-3">
                    {Number.isFinite(band.margin)
                      ? `+${(band.margin * 100).toFixed(1)}%p`
                      : '유일'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {floor > 0 && (
          <>
            {formatMeso(floor)} 아래로는 무엇을 사도 목표를 만들지 못합니다.{' '}
            {belowFloor && <b className="text-[color:var(--warn)]">지금 예산이 그 아래입니다. </b>}
          </>
        )}
        &ldquo;차선 대비&rdquo;는 그 구간에서 두 번째로 나은 매물보다 얼마나 더 높은
        확률을 주는지입니다. 이 값이 작으면 어느 쪽을 사도 사실상 같다는 뜻입니다.
        구간을 가를 때는 사던 걸 계속 사는 쪽에 무게를 뒀습니다 — 1%p 도 못 벌면
        갈아타지 않는 것으로 봤기 때문에, 여기 적힌 매물이 그 예산의 최선보다 1%p
        가량 못할 수 있습니다.
      </p>
    </div>
  );
}

/**
 * 결론 패널에 붙는 한 줄 — "그런데 네 예산에서는 이걸 사라".
 *
 * 결론의 매물은 돈 제한이 없을 때의 최소비용 답이라, 예산을 잡으면 답이 달라질 수 있다.
 * 달라질 때만 눈에 띄게 말하고, 같으면 조용히 확인만 해 준다.
 */
export function BudgetStartNote({
  analysis,
  budgetMeso,
}: {
  analysis: Analysis;
  budgetMeso: number;
}) {
  const { problem, cost, budgetStart } = analysis;
  if (!budgetStart) return null;

  if (budgetStart.baseIndex < 0) {
    return (
      <p className="mt-2 border-l-2 border-[color:var(--warn)] bg-[#2a2417] px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
        다만 가진 돈 {formatMeso(budgetMeso)} 으로는 무엇을 사도 목표를 만들지 못합니다. 위
        문장은 돈 제한이 없을 때의 답입니다.
      </p>
    );
  }

  const base = problem.baseOptions[budgetStart.baseIndex];
  const name = base.synthetic ? '완성품' : (base.label ?? `공${base.offset}`);
  const move = describeAction(analysis, budgetStart.action);

  if (budgetStart.baseIndex === cost.bestBaseIndex) {
    return (
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        예산 {formatMeso(budgetMeso)} 을 따져 봐도 첫 매물은 그대로 {name} 입니다 — 이
        예산에서의 달성 확률은{' '}
        <b className="text-[color:var(--series-60)]">{formatPercent(budgetStart.chance)}</b>{' '}
        입니다.
      </p>
    );
  }

  return (
    <p className="mt-2 border-l-2 border-[color:var(--series-60)] bg-[#152420] px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
      다만 가진 돈이 {formatMeso(budgetMeso)} 뿐이라면 이야기가 다릅니다 —{' '}
      <b className="text-[color:var(--series-60)]">{name}</b> 매물(
      <span className="tabular">{formatMeso(base.price)}</span>)을 사서 <b>{move}</b>이 달성
      확률{' '}
      <b className="text-[color:var(--series-60)]">{formatPercent(budgetStart.chance)}</b> 로
      가장 높습니다. 위 문장은 돈 제한 없이 기대비용만 따진 답이라 몇 번이고 다시 도전할
      수 있다고 봅니다.
    </p>
  );
}

/** 매물 이름 뒤에 조사를 붙이지 않아도 되게, "…쪽" 으로 끝나는 명사구로 만든다. */
function describeAction(analysis: Analysis, action: Action): string {
  if (action.kind === 'scroll') {
    return `${analysis.problem.scrolls[action.scrollIndex].label} 바르는 쪽`;
  }
  if (action.kind === 'done') return '그대로 두는 쪽';
  if (action.kind === 'restart') return '바로 되파는 쪽';
  return '거기서 멈추는 쪽';
}
