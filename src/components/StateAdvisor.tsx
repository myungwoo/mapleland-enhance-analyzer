'use client';

import { advise, type Analysis, type Outcome } from '@/lib/enhance';
import { formatMeso, formatPercent } from '@/lib/format';
import { NumberField, Panel } from './ui';

export function StateAdvisor({
  analysis,
  noRestart,
  state,
  onChange,
  pendingLevels,
  maxPendingLevels,
  pendingLevelBonus,
  onPendingLevelsChange,
}: {
  analysis: Analysis;
  /** 손절을 금지한 모드 — 되팔이/재시작 관련 수치는 뜻이 없다 */
  noRestart: boolean;
  state: { slots: number; attack: number };
  onChange: (next: { slots: number; attack: number }) => void;
  /** 아직 안 굴린 리버스 레벨업 횟수 */
  pendingLevels: number;
  maxPendingLevels: number;
  pendingLevelBonus: Outcome[] | null;
  onPendingLevelsChange: (levels: number) => void;
}) {
  const { problem, cost, successChance } = analysis;
  const slots = clamp(state.slots, 0, problem.maxSlots);
  const attack = clamp(state.attack, cost.axes.attackMin, problem.target);
  const advice = advise(problem, cost, successChance, slots, attack, pendingLevelBonus);

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
  const headline = advice.levelUpFirst ? `레벨업 먼저 (${pendingLevels}회 남음)` : next;

  return (
    <Panel title="현재 상황에서 최적 전략" hint="지금 들고 있는 아이템 상태를 넣어 보세요">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-48">
          <NumberField
            label="남은 업횟"
            value={slots}
            onChange={(v) => onChange({ slots: v ?? 0, attack })}
            suffix="회"
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
          {maxPendingLevels > 0 && (
            <NumberField
              label="남은 레벨업"
              value={pendingLevels}
              onChange={(v) => onPendingLevelsChange(v ?? 0)}
              suffix="회"
              min={0}
              max={maxPendingLevels}
            />
          )}
        </div>

        <div className="inset flex-1 px-3 py-2">
          <div className="text-[11px] text-ink-3">지금 할 일</div>
          <div className="mt-1 text-[16px] text-gold">{headline}</div>
          {advice.levelUpFirst && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
              레벨업은 메소가 안 들고 결과까지 보여 줍니다. 먼저 굴리고 나면 그때 {next} 쪽으로
              갈 가능성이 높습니다. 아래 값들은 남은 굴림을 평균 낸 것입니다.
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-ink-2">이 아이템으로 목표 달성할 확률</dt>
            <dd className="tabular text-right text-gold">
              {formatPercent(advice.successProbability)}
            </dd>
            <dt className="text-ink-3">
              {noRestart ? '여기서 더 쓸 돈 (기대값)' : '목표까지 더 들 돈 (기대값)'}
            </dt>
            <dd className="tabular text-right text-ink-1">{formatMeso(advice.remainingCost)}</dd>
            {!noRestart && (
              <>
                <dt className="text-ink-3">지금 팔면 받는 값 (이론가)</dt>
                <dd className="tabular text-right text-ink-1">
                  {formatMeso(advice.salvageValue)}
                </dd>
                <dt className="text-ink-3">손절하고 새로 시작할 때 (기대값)</dt>
                <dd className="tabular text-right text-ink-1">{formatMeso(advice.restartCost)}</dd>
              </>
            )}
          </dl>
          {noRestart ? (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              손절 없이 이 아이템 하나로만 갑니다. 달성이 보장되지 않으므로 확률을 최대로 하는
              수를 고르고, 같은 확률이면 더 싼 쪽을 씁니다.
            </p>
          ) : advice.action.kind === 'scroll' && advice.successProbability < 1e-9 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--warn)]">
              이 아이템으로는 목표에 못 닿습니다. 그런데도 주문서를 바르라는 건, 공격력을 올려
              <b> 되팔 값을 높이는 쪽이 그냥 손절하는 것보다 싸기 때문</b>입니다. 목표를 향한
              진전이 아니라 손절 준비입니다.
            </p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              손절하면 실패로 칩니다. 새 아이템을 계속 사면 언젠가는 만들게 되니, 그쪽 확률은
              늘 100%이고 그 대가가 위의 기대비용입니다.
            </p>
          )}
          {!noRestart && advice.action.kind !== 'done' && (
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
