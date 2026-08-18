'use client';

import { useMemo, useState } from 'react';
import { analyze, decodeAction, normalize, startSuccess, type Analysis } from '@/lib/enhance';
import { formatMeso, formatPercent, MAN } from '@/lib/format';
import { BarList, ProbabilityCurve } from './charts';
import { InputPanel } from './InputPanel';
import { DEFAULT_INPUTS, reverseAttackBonus, toProblem, type Inputs } from './inputs';
import { ReverseOutcome } from './ReverseOutcome';
import { PolicyHeatmap } from './PolicyHeatmap';
import { StateAdvisor } from './StateAdvisor';
import { useDebounced } from './useDebounced';
import { Panel, Stat, Warning } from './ui';

export function Analyzer() {
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [selected, setSelected] = useState<{ slots: number; attack: number } | null>(null);
  const [pendingLevels, setPendingLevels] = useState(0);

  // 입력칸은 즉시 반응하고, 무거운 분석만 타이핑이 멎은 뒤에 돈다.
  const settled = useDebounced(inputs);
  const stale = settled !== inputs;

  const analysis = useMemo<Analysis | null>(() => {
    const problem = toProblem(settled);
    if (!problem) return null;
    return analyze(problem, {
      budget: settled.budget ? settled.budget * MAN : undefined,
      includeBreakeven: true,
    });
  }, [settled]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[18px] text-gold">메이플랜드 주문서 강화 분석기</h1>
        <p className="text-[11px] text-ink-3">
          목표까지의 최소 기대비용 전략과 손절 시점을 동적계획으로 정확히 계산합니다
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <InputPanel inputs={inputs} onChange={setInputs} />
        </div>

        <div className={`relative flex flex-col gap-4 ${stale ? 'opacity-50' : ''}`}>
          {stale && (
            <span className="pointer-events-none absolute right-0 -top-5 text-[11px] text-ink-3">
              입력 반영 중…
            </span>
          )}
          {analysis ? (
            <Results
              analysis={analysis}
              selected={selected}
              onSelect={setSelected}
              budgetMeso={settled.budget ? settled.budget * MAN : null}
              reverse={settled.reverse}
              pendingLevels={Math.min(pendingLevels, settled.reverse.levels)}
              onPendingLevelsChange={setPendingLevels}
            />
          ) : (
            <Panel title="입력이 더 필요합니다">
              <p className="text-[12px] leading-relaxed text-ink-2">
                주문서 시세와 베이스 매물 시세를 최소 하나씩 채워 주세요.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Results({
  analysis,
  selected,
  onSelect,
  budgetMeso,
  reverse,
  pendingLevels,
  onPendingLevelsChange,
}: {
  analysis: Analysis;
  selected: { slots: number; attack: number } | null;
  onSelect: (s: { slots: number; attack: number }) => void;
  budgetMeso: number | null;
  reverse: Inputs['reverse'];
  pendingLevels: number;
  onPendingLevelsChange: (levels: number) => void;
}) {
  const { problem, cost, distribution, outcome, budget, breakeven, bases, strategies, warnings } =
    analysis;

  const start = problem.baseOptions[cost.bestBaseIndex];
  const firstAction = decodeAction(
    cost.policy[problem.maxSlots * cost.axes.span + (start.offset - cost.axes.attackMin)],
  );
  const firstMove =
    firstAction.kind === 'scroll'
      ? `${problem.scrolls[firstAction.scrollIndex].label} 주문서를 바르세요`
      : firstAction.kind === 'done'
        ? '이미 목표를 만족합니다'
        : '바로 되파는 게 낫습니다';

  // 리버스처럼 시작 공격력이 랜덤이면 첫 수가 하나로 정해지지 않는다. 굴림 결과별로
  // 무엇을 바르는지 보여 주되, 같은 수가 이어지는 구간은 묶어야 읽힌다.
  const startRolls = firstMovesByRoll(analysis, start);

  const advisorState = selected ?? { slots: problem.maxSlots, attack: start.offset };
  const noRestart = !problem.allowRestart;
  const startChance = startSuccess(problem, cost);

  return (
    <>
      {warnings.map((w) => (
        <Warning key={w}>{w}</Warning>
      ))}

      {cost.feasible && Number.isFinite(cost.expectedCost) && (
        <Panel title="결론" hint="지금 해야 할 일">
          {startRolls.length > 1 ? (
            <>
              <p className="text-[15px] leading-relaxed text-ink-1">
                <b className="text-gold">{start.label ?? `공${start.offset}`}</b> 매물을{' '}
                <b className="tabular text-gold">{formatMeso(start.price)}</b> 에 사서{' '}
                <b className="text-gold">레벨업부터 끝내세요</b>. 첫 수는 레벨업 결과에 따라
                갈립니다.
              </p>
              <table className="mt-2 w-full max-w-md text-[11px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="pb-1 text-left font-normal">레벨업 후 공격력</th>
                    <th className="pb-1 text-right font-normal">확률</th>
                    <th className="pb-1 text-right font-normal">첫 수</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {startRolls.map((row) => (
                    <tr key={row.label} className="border-t border-line">
                      <td className="py-0.5 text-ink-2">{row.label}</td>
                      <td className="py-0.5 text-right text-ink-1">
                        {formatPercent(row.probability)}
                      </td>
                      <td className="py-0.5 text-right text-gold">{row.move}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-[15px] leading-relaxed text-ink-1">
              <b className="text-gold">{start.label ?? `공${start.offset}`}</b> 매물을{' '}
              <b className="tabular text-gold">{formatMeso(start.price)}</b> 에 사서{' '}
              <b className="text-gold">{startRolls[0]?.moveSentence ?? firstMove}</b>.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {noRestart ? (
              <>
                <Stat
                  label="목표 달성 확률"
                  value={formatPercent(startChance)}
                  sub="아이템 1개로"
                  tone="gold"
                />
                <Stat
                  label="예상 지출"
                  value={formatMeso(cost.expectedCost)}
                  sub="성공 여부와 무관하게 쓰는 돈"
                />
              </>
            ) : (
              <Stat
                label="기대 총비용"
                value={formatMeso(cost.expectedCost)}
                sub={problem.salvage ? '되팔이 회수 반영' : '되팔기 없음 (회수 0)'}
                tone="gold"
              />
            )}
            {distribution && (
              <>
                <Stat
                  label="지출 중앙값"
                  value={formatMeso(distribution.quantiles.p50)}
                  sub="절반은 이 안에 끝남"
                />
                <Stat
                  label="운 나쁘면 (상위 10%)"
                  value={formatMeso(distribution.quantiles.p90)}
                  sub={`상위 1% ${formatMeso(distribution.quantiles.p99)}`}
                  tone="warn"
                />
              </>
            )}
            {outcome && (
              <Stat
                label={noRestart ? '평균 소모 주문서' : '평균 강화하는 아이템 개수'}
                value={
                  noRestart
                    ? `${outcome.expectedScrollsPerItem.toFixed(1)}장`
                    : `${outcome.expectedItems.toFixed(1)}개`
                }
                sub={
                  noRestart
                    ? '아이템은 1개만 씁니다'
                    : `개당 주문서 ${outcome.expectedScrollsPerItem.toFixed(1)}장`
                }
              />
            )}
          </div>
        </Panel>
      )}

      <StateAdvisor
        noRestart={noRestart}
        analysis={analysis}
        state={advisorState}
        onChange={onSelect}
        pendingLevels={pendingLevels}
        maxPendingLevels={reverse.enabled ? reverse.levels : 0}
        pendingLevelBonus={reverseAttackBonus(reverse, pendingLevels)}
        onPendingLevelsChange={onPendingLevelsChange}
      />

      {reverse.enabled && <ReverseOutcome reverse={reverse} />}

      <PolicyHeatmap analysis={analysis} selected={selected} onSelect={onSelect} />

      <div className="grid gap-4 xl:grid-cols-2">
        {distribution && (
          <Panel title="총 지출 분포" hint="이 금액 안에 끝날 확률">
            <ProbabilityCurve
              values={distribution.cdf}
              step={distribution.tick}
              xLabel="총 지출"
              markers={[
                { x: distribution.quantiles.p50, label: '중앙' },
                { x: distribution.quantiles.p90, label: '상위10%' },
              ]}
            />
            {distribution.creditCapped && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                되판 돈이 새 매물값을 넘는 구간은 재투자되지 않는 것으로 봤습니다. 이 곡선은
                기대 총비용보다 약간 보수적입니다.
              </p>
            )}
          </Panel>
        )}

        {budget && budgetMeso && (
          <Panel title="예산별 달성 확률" hint={`현재 예산 ${formatMeso(budgetMeso)}`}>
            <ProbabilityCurve
              values={budget.curve}
              step={budget.tick}
              xLabel="예산"
              color="var(--series-60)"
              markers={[{ x: budgetMeso, label: '내 예산' }]}
            />
            <p className="mt-2 text-[12px] text-ink-2">
              지금 예산으로 목표 달성 확률{' '}
              <b className="tabular text-[color:var(--series-60)]">
                {formatPercent(budget.successProbability)}
              </b>
            </p>
          </Panel>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="전략 비교"
          hint={noRestart ? '같은 조건에서의 달성 확률' : '같은 조건에서의 기대 총비용'}
        >
          {noRestart ? (
            <BarList
              rows={[...strategies]
                .sort((a, b) => b.successProbability - a.successProbability)
                .map((s) => ({ label: s.label, value: s.successProbability }))}
              format={(v) => formatPercent(v)}
              color="var(--series-60)"
              highlight="최적 전략"
            />
          ) : (
            <BarList
              rows={[...strategies]
                .sort((a, b) => a.expectedCost - b.expectedCost)
                .map((s) => ({ label: s.label, value: s.expectedCost }))}
              highlight="최적 전략"
            />
          )}
        </Panel>

        {outcome && outcome.outcomes.length > 0 && (
          <Panel title="달성 시점의 공격력" hint="아이템 1개 기준">
            <BarList
              rows={outcome.outcomes.map((o) => ({
                label: `공+${o.attack}`,
                value: o.probability,
              }))}
              format={(v) => formatPercent(v)}
              color="var(--series-60)"
            />
            <p className="mt-2 text-[11px] text-ink-3">
              이 아이템을 손절하게 될 확률 {formatPercent(outcome.abandonProbability)}
            </p>
          </Panel>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {breakeven && (
          <Panel title="주문서 손익분기" hint="이 값보다 비싸면 쓸 이유가 없음">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-ink-3">
                  <th className="pb-1 text-left font-normal">주문서</th>
                  <th className="pb-1 text-right font-normal">현재 시세</th>
                  <th className="pb-1 text-right font-normal">손익분기</th>
                  <th className="pb-1 text-right font-normal">판정</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {breakeven.map((b) => (
                  <tr key={b.scrollId} className="border-t border-line">
                    <td className="py-1 text-ink-2">{b.scrollLabel}</td>
                    <td className="py-1 text-right text-ink-1">{formatMeso(b.currentPrice)}</td>
                    <td className="py-1 text-right text-ink-1">
                      {formatMeso(b.breakevenPrice)}
                    </td>
                    <td
                      className="py-1 text-right"
                      style={{
                        color: b.worthUsing ? 'var(--series-60)' : 'var(--series-stop)',
                      }}
                    >
                      {b.worthUsing ? '쓸 만함' : '비쌈'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <Panel title="살 만한 매물" hint="이 값보다 싸면 사는 게 이득">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-ink-3">
                <th className="pb-1 text-left font-normal">매물</th>
                <th className="pb-1 text-right font-normal">호가</th>
                <th className="pb-1 text-right font-normal">여기까지</th>
                {problem.salvage && <th className="pb-1 text-right font-normal">되팔이가</th>}
                <th className="pb-1 text-right font-normal">판정</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {bases.map((b) => {
                const worth = b.price < b.worthPayingUpTo;
                return (
                  <tr key={b.offset} className="border-t border-line">
                    <td className="py-1 text-ink-2">{b.label ?? `공${b.offset}`}</td>
                    <td className="py-1 text-right text-ink-1">{formatMeso(b.price)}</td>
                    <td className="py-1 text-right text-ink-1">
                      {Number.isFinite(b.worthPayingUpTo) ? formatMeso(b.worthPayingUpTo) : '제한 없음'}
                    </td>
                    {problem.salvage && (
                      <td className="py-1 text-right text-ink-3">{formatMeso(b.resaleValue)}</td>
                    )}
                    <td
                      className="py-1 text-right"
                      style={{ color: worth ? 'var(--series-60)' : 'var(--ink-3)' }}
                    >
                      {worth ? '살 만함' : '비쌈'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">
            &ldquo;여기까지&rdquo;는 이 매물을 뺐을 때의 총비용에서, 이걸로 시작하면 앞으로 들
            비용을 뺀 값입니다. 그보다 비싸게 주면 차라리 다른 선택지가 낫다는 뜻이라
            {problem.salvage ? ' 되팔 수 없는 아이템에도 그대로 씁니다.' : ' 되팔기를 꺼도 쓸 수 있습니다.'}
          </p>
        </Panel>
      </div>

    </>
  );
}

interface FirstMoveRow {
  label: string;
  probability: number;
  /** 표에 쓰는 짧은 표기 */
  move: string;
  /** 문장에 넣는 표기 */
  moveSentence: string;
}

/** 레벨업 굴림별 첫 수. 같은 수가 이어지는 구간은 하나로 묶는다. */
function firstMovesByRoll(analysis: Analysis, start: Analysis['problem']['baseOptions'][number]) {
  const { problem, cost } = analysis;
  const rolls = start.synthetic ? null : problem.startBonus;
  if (!rolls?.length) return [] as FirstMoveRow[];

  const moveAt = (attack: number) => {
    const action = decodeAction(
      cost.policy[problem.maxSlots * cost.axes.span + (attack - cost.axes.attackMin)],
    );
    if (action.kind === 'scroll') {
      const label = problem.scrolls[action.scrollIndex].label;
      return { move: label, moveSentence: `${label} 주문서를 바르세요` };
    }
    if (action.kind === 'done') return { move: '이미 달성', moveSentence: '이미 목표를 만족합니다' };
    if (action.kind === 'restart') {
      return { move: '바로 되팔기', moveSentence: '바로 되파는 게 낫습니다' };
    }
    return { move: '방법 없음', moveSentence: '이 조건으로는 방법이 없습니다' };
  };

  const rows: FirstMoveRow[] = [];
  for (const roll of normalize(rolls)) {
    const attack = start.offset + roll.value;
    const { move, moveSentence } = moveAt(attack);
    const last = rows[rows.length - 1];
    if (last && last.move === move) {
      last.probability += roll.probability;
      last.label = `${last.label.split('~')[0]}~공+${attack}`;
    } else {
      rows.push({ label: `공+${attack}`, probability: roll.probability, move, moveSentence });
    }
  }
  return rows;
}
