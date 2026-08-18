'use client';

import { useRef, useState } from 'react';
import { formatMeso, formatPercent } from '@/lib/format';

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

export interface CurveMarker {
  x: number;
  label: string;
}

/**
 * 누적 확률 곡선 (지출 → 달성 확률).
 *
 * 계열이 하나뿐이라 범례 없이 제목이 정체를 나른다. 그리드는 뒤로 물리고,
 * 분위수만 직접 라벨을 단다 — 모든 점에 숫자를 다는 건 금지.
 */
export function ProbabilityCurve({
  values,
  step,
  xLabel,
  markers = [],
  color = 'var(--series-100)',
}: {
  /** 0..1 확률 배열. 인덱스 i 는 지출 i*step 에 대응한다. */
  values: Float64Array;
  step: number;
  xLabel: string;
  markers?: CurveMarker[];
  color?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  // 화면에 필요한 만큼만 남기고 솎아낸다. 4,000점을 다 그릴 이유가 없다.
  const maxIndex = lastMeaningfulIndex(values);
  const sampleCount = Math.min(240, maxIndex + 1);
  const points: Array<{ spend: number; p: number }> = [];
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.round((i / (sampleCount - 1)) * maxIndex);
    points.push({ spend: idx * step, p: values[idx] });
  }

  // 마커가 축 밖으로 잘리지 않도록 도메인에 포함시킨다.
  const maxSpend = Math.max(points[points.length - 1]?.spend || 1, ...markers.map((m) => m.x));
  const sx = (spend: number) =>
    PAD.left + (spend / maxSpend) * (W - PAD.left - PAD.right);
  const sy = (p: number) => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);

  const path = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${sx(pt.spend).toFixed(1)},${sy(pt.p).toFixed(1)}`)
    .join('');

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const spend = Math.max(0, Math.min(maxSpend, ratio * W >= PAD.left
      ? ((ratio * W - PAD.left) / (W - PAD.left - PAD.right)) * maxSpend
      : 0));
    const idx = Math.max(0, Math.min(maxIndex, Math.round(spend / step)));
    setHover({ x: idx * step, y: values[idx] });
  };

  return (
    <figure className="m-0">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${xLabel}별 달성 확률 곡선`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(p)}
              y2={sy(p)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={sy(p) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--ink-3)"
            >
              {p * 100}%
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {markers.map((m, i) => {
          // 라벨끼리 겹치지 않게 층을 나누고, 오른쪽 끝에서는 왼쪽으로 붙인다.
          const x = sx(m.x);
          const nearRight = x > W - PAD.right - 70;
          return (
            <g key={m.label}>
              <line
                x1={x}
                x2={x}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--ink-3)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={nearRight ? x - 4 : x + 4}
                y={PAD.top + 9 + i * 11}
                textAnchor={nearRight ? 'end' : 'start'}
                fontSize={9}
                fill="var(--ink-2)"
              >
                {m.label} {formatMeso(m.x)}
              </text>
            </g>
          );
        })}

        {hover && (
          <g>
            <line
              x1={sx(hover.x)}
              x2={sx(hover.x)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--ink-2)"
              strokeWidth={1}
            />
            <circle
              cx={sx(hover.x)}
              cy={sy(hover.y)}
              r={4.5}
              fill={color}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </g>
        )}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={sx(maxSpend * f)}
            y={H - 8}
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
            fontSize={9}
            fill="var(--ink-3)"
          >
            {f === 0 ? '0' : formatMeso(maxSpend * f)}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex min-h-[16px] justify-between text-[11px] text-ink-3">
        <span>{xLabel}</span>
        {hover && (
          <span className="tabular text-ink-1">
            {formatMeso(hover.x)} → {formatPercent(hover.y)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function lastMeaningfulIndex(values: Float64Array): number {
  const target = values[values.length - 1] * 0.999;
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= target) return Math.max(1, i);
  }
  return values.length - 1;
}

/** 가로 막대 목록. 값이 하나의 척도를 공유할 때만 쓴다. */
export function BarList({
  rows,
  format = formatMeso,
  color = 'var(--series-100)',
  highlight,
}: {
  rows: Array<{ label: string; value: number; note?: string }>;
  format?: (v: number) => string;
  color?: string;
  highlight?: string;
}) {
  const finite = rows.filter((r) => Number.isFinite(r.value));
  const max = Math.max(1, ...finite.map((r) => r.value));

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const isBest = row.label === highlight;
        const width = Number.isFinite(row.value) ? (row.value / max) * 100 : 0;
        return (
          <li key={row.label} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2">
            <span className={`truncate text-[11px] ${isBest ? 'text-gold' : 'text-ink-2'}`}>
              {row.label}
            </span>
            <span className="inset h-4 overflow-hidden">
              <span
                className="block h-full rounded-r-[3px]"
                style={{
                  width: `${width}%`,
                  background: isBest ? 'var(--gold)' : color,
                }}
              />
            </span>
            <span className="tabular text-right text-[11px] text-ink-1">
              {Number.isFinite(row.value) ? format(row.value) : '불가능'}
              {row.note && <span className="ml-1 text-ink-3">{row.note}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
