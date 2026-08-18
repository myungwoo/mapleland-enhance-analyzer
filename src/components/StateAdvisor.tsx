'use client';

import { advise, type Analysis } from '@/lib/enhance';
import { formatMeso } from '@/lib/format';
import { NumberField, Panel } from './ui';

export function StateAdvisor({
  analysis,
  state,
  onChange,
}: {
  analysis: Analysis;
  state: { slots: number; attack: number };
  onChange: (next: { slots: number; attack: number }) => void;
}) {
  const { problem, cost } = analysis;
  const slots = clamp(state.slots, 0, problem.maxSlots);
  const attack = clamp(state.attack, cost.axes.attackMin, problem.target);
  const advice = advise(problem, cost, slots, attack);

  const next =
    advice.action.kind === 'scroll'
      ? `${problem.scrolls[advice.action.scrollIndex].label} 바르기`
      : advice.action.kind === 'restart'
        ? problem.baseOptions[advice.action.baseIndex].synthetic
          ? '완제품 사기'
          : `손절하고 ${problem.baseOptions[advice.action.baseIndex].label ?? '새 매물'} 사기`
        : advice.action.kind === 'done'
          ? '이미 목표 달성'
          : '방법 없음';

  const keepIsBetter = advice.advantageOverRestart > 0;

  return (
    <Panel title="내 무기 판정" hint="지금 들고 있는 무기 상태를 넣어 보세요">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-48">
          <NumberField
            label="남은 업횟"
            value={slots}
            onChange={(v) => onChange({ slots: v ?? 0, attack })}
            suffix="칸"
            min={0}
            max={problem.maxSlots}
          />
          <NumberField
            label="현재 공격력"
            value={attack}
            onChange={(v) => onChange({ slots, attack: v ?? 0 })}
            suffix="정옵 대비"
            min={cost.axes.attackMin}
            max={problem.target}
          />
        </div>

        <div className="inset flex-1 px-3 py-2">
          <div className="text-[11px] text-ink-3">지금 할 일</div>
          <div className="mt-1 text-[16px] text-gold">{next}</div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-ink-3">여기서 목표까지</dt>
            <dd className="tabular text-right text-ink-1">{formatMeso(advice.remainingCost)}</dd>
            <dt className="text-ink-3">지금 팔면 (이론가)</dt>
            <dd className="tabular text-right text-ink-1">{formatMeso(advice.salvageValue)}</dd>
            <dt className="text-ink-3">손절 후 새로 시작하면</dt>
            <dd className="tabular text-right text-ink-1">{formatMeso(advice.restartCost)}</dd>
          </dl>
          {advice.action.kind !== 'done' && (
            <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-2">
              {keepIsBetter ? (
                <>
                  계속 바르는 쪽이{' '}
                  <b className="text-[color:var(--series-60)]">
                    {formatMeso(advice.advantageOverRestart)}
                  </b>{' '}
                  이득입니다.
                </>
              ) : (
                <>
                  손절하는 쪽이{' '}
                  <b className="text-[color:var(--series-stop)]">
                    {formatMeso(-advice.advantageOverRestart)}
                  </b>{' '}
                  이득입니다.
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
