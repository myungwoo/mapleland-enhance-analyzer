'use client';

import { useState } from 'react';
import { decodeAction, type Analysis } from '@/lib/enhance';
import { formatMeso, formatPercent } from '@/lib/format';
import { Panel } from './ui';

/** 주문서 id → 계열색. 색은 보조 수단이고, 칸마다 문자 라벨이 정체를 나른다. */
const SCROLL_COLOR: Record<string, string> = {
  '100': 'var(--series-100)',
  '60': 'var(--series-60)',
  '10': 'var(--series-10)',
};

interface Cell {
  slots: number;
  attack: number;
  label: string;
  color: string;
  reachable: boolean;
  remaining: number;
  salvage: number;
  success: number;
}

export function PolicyHeatmap({
  analysis,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  selected: { slots: number; attack: number } | null;
  onSelect: (state: { slots: number; attack: number }) => void;
}) {
  const [hover, setHover] = useState<Cell | null>(null);
  const { problem, cost, successChance } = analysis;
  const { axes } = cost;

  const maxGain = Math.max(...problem.scrolls.map((s) => s.attackGain));
  const realOffsets = problem.baseOptions.filter((b) => !b.synthetic).map((b) => b.offset);

  // 리버스 레벨업이 있으면 매물이 이미 공격력을 달고 나온다. 시작 가능한 공격력이
  // 여러 개라 도달 범위도, 출발 표시도 그만큼 넓어진다.
  const bonuses = problem.startBonus?.length
    ? problem.startBonus.filter((o) => o.probability > 0).map((o) => o.value)
    : [0];
  const startAttacks = new Set(realOffsets.flatMap((o) => bonuses.map((b) => o + b)));
  const maxStart = Math.max(...startAttacks);
  const minOffset = Math.min(...problem.baseOptions.map((b) => b.offset), ...startAttacks);

  const columns: number[] = [];
  for (let a = axes.attackMin; a <= problem.target; a++) columns.push(a);

  const cellOf = (slots: number, attack: number): Cell => {
    const i = slots * axes.span + (attack - axes.attackMin);
    const action = decodeAction(cost.policy[i]);
    const reachable =
      attack >= minOffset && attack <= maxStart + (problem.maxSlots - slots) * maxGain;

    let label = '';
    let color = 'transparent';
    if (action.kind === 'done') {
      label = '달성';
      color = 'var(--series-done)';
    } else if (action.kind === 'scroll') {
      const scroll = problem.scrolls[action.scrollIndex];
      label = scroll.label;
      color = SCROLL_COLOR[scroll.id] ?? 'var(--series-100)';
    } else if (action.kind === 'restart') {
      label = problem.baseOptions[action.baseIndex].synthetic ? '완제품' : '손절';
      color = 'var(--series-stop)';
    } else {
      label = '×';
      color = 'var(--surface-2)';
    }

    return {
      slots,
      attack,
      label,
      color,
      reachable,
      remaining: cost.cost[i],
      salvage: cost.salvageAt(slots, attack),
      success: successChance[i],
    };
  };

  return (
    <Panel
      title="최적 정책"
      hint="세로: 남은 업횟 · 가로: 지금 공격력"
      right={<Legend problem={analysis.problem} />}
    >
      <div className="relative overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-[11px]">
          <thead>
            <tr>
              <th className="w-10" />
              {columns.map((a) => (
                <th key={a} className="tabular pb-1 font-normal text-ink-3">
                  {a >= 0 ? `+${a}` : a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: problem.maxSlots + 1 }, (_, k) => problem.maxSlots - k).map(
              (slots) => (
                <tr key={slots}>
                  <th className="tabular pr-1 text-right font-normal text-ink-3">{slots}회</th>
                  {columns.map((attack) => {
                    const cell = cellOf(slots, attack);
                    const isStart = slots === problem.maxSlots && startAttacks.has(attack);
                    const isSelected =
                      selected?.slots === slots && selected?.attack === attack;
                    if (!cell.reachable) {
                      return <td key={attack} className="h-6 bg-[#141619]" />;
                    }
                    return (
                      <td key={attack} className="p-0">
                        <button
                          type="button"
                          onMouseEnter={() => setHover(cell)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(cell)}
                          onBlur={() => setHover(null)}
                          onClick={() => onSelect({ slots, attack })}
                          style={{ background: cell.color }}
                          className={`flex h-6 w-full items-center justify-center text-[10px] leading-none text-[#0e1013] transition-[outline] ${
                            isSelected
                              ? 'outline outline-2 outline-offset-[-2px] outline-[color:var(--ink-1)]'
                              : isStart
                                ? 'outline outline-2 outline-offset-[-2px] outline-[color:var(--gold)]'
                                : ''
                          }`}
                          aria-label={`남은 ${slots}회, 공+${attack}: ${cell.label}`}
                        >
                          {cell.label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>

        <div className="mt-2 flex min-h-[34px] items-center gap-3 border-t border-line pt-2 text-[11px]">
          {hover ? (
            <>
              <span className="text-ink-2">
                남은 <b className="tabular text-ink-1">{hover.slots}회</b> · 지금{' '}
                <b className="tabular text-ink-1">공+{hover.attack}</b>
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block size-2.5"
                  style={{ background: hover.color }}
                />
                <b className="text-ink-1">{hover.label}</b>
              </span>
              <span className="tabular text-ink-3">
                이 무기로 달성 {formatPercent(hover.success)}
              </span>
              <span className="tabular text-ink-3">
                남은 기대비용 {formatMeso(hover.remaining)}
              </span>
              <span className="tabular text-ink-3">
                지금 팔면 {formatMeso(hover.salvage)}
              </span>
            </>
          ) : (
            <span className="text-ink-3">
              격자 칸에 커서를 올리면 상세가 보이고, 누르면 아래 판정기에 들어갑니다. 금색
              테두리가 출발 지점입니다{startAttacks.size > 1 && ' — 리버스 레벨업 결과에 따라 여러 곳에서 시작합니다'}.
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Legend({ problem }: { problem: Analysis['problem'] }) {
  const items = [
    ...problem.scrolls.map((s) => ({
      label: s.label,
      color: SCROLL_COLOR[s.id] ?? 'var(--series-100)',
    })),
    { label: '손절', color: 'var(--series-stop)' },
    { label: '달성', color: 'var(--series-done)' },
  ];
  return (
    <ul className="flex shrink-0 items-center gap-2 text-[10px] text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1">
          <span aria-hidden className="inline-block size-2.5" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
