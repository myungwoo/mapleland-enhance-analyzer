'use client';

import type { Outcome } from '@/lib/enhance';

/**
 * 이산 확률 분포를 손으로 고치는 표.
 *
 * 리버스 레벨업 확률은 유출된 값이 아니라 유저들의 추정이라, 바꿔 가며 돌려볼 수 있어야
 * 한다. 합이 100%가 아니어도 엔진이 정규화하므로 막지 않고 현재 합만 보여 준다.
 */
export function OutcomeEditor({
  label,
  outcomes,
  onChange,
  unit = '',
}: {
  label: string;
  outcomes: Outcome[];
  onChange: (next: Outcome[]) => void;
  unit?: string;
}) {
  const total = outcomes.reduce((sum, o) => sum + (o.probability || 0), 0);
  const off = Math.abs(total - 1) > 0.0005;

  const patch = (index: number, next: Partial<Outcome>) =>
    onChange(outcomes.map((o, i) => (i === index ? { ...o, ...next } : o)));

  return (
    <div className="inset px-2 py-2">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] text-ink-2">{label}</span>
        <span className={`tabular text-[10px] ${off ? 'text-[color:var(--warn)]' : 'text-ink-3'}`}>
          합 {(total * 100).toFixed(0)}%{off && ' (정규화됨)'}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {outcomes.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-10 shrink-0 text-right text-ink-3">
              +
              <input
                type="number"
                aria-label={`${label} ${i + 1}번째 증가량`}
                className="w-6 bg-transparent text-right text-ink-1 outline-none"
                value={o.value}
                onChange={(e) => patch(i, { value: Number(e.target.value) })}
              />
            </span>
            <span className="shrink-0 text-ink-3">{unit}</span>
            <input
              type="range"
              aria-label={`${label} +${o.value} 확률`}
              className="min-w-0 flex-1 accent-[color:var(--gold)]"
              min={0}
              max={100}
              step={1}
              value={Math.round((o.probability || 0) * 100)}
              onChange={(e) => patch(i, { probability: Number(e.target.value) / 100 })}
            />
            <span className="tabular w-11 shrink-0 text-right">
              <input
                type="number"
                aria-label={`${label} +${o.value} 확률 (%)`}
                className="w-8 bg-transparent text-right text-ink-1 outline-none"
                min={0}
                max={100}
                value={Math.round((o.probability || 0) * 100)}
                onChange={(e) => patch(i, { probability: Number(e.target.value) / 100 })}
              />
              <span className="text-ink-3">%</span>
            </span>
            <button
              type="button"
              aria-label={`${label} +${o.value} 항목 삭제`}
              className="shrink-0 px-1 text-ink-3 hover:text-[color:var(--series-stop)]"
              onClick={() => onChange(outcomes.filter((_, j) => j !== i))}
              disabled={outcomes.length <= 1}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="mt-1.5 text-[10px] text-ink-3 hover:text-gold"
        onClick={() =>
          onChange([
            ...outcomes,
            { value: Math.max(...outcomes.map((o) => o.value)) + 1, probability: 0 },
          ])
        }
      >
        + 항목 추가
      </button>
    </div>
  );
}
