'use client';

import { convolve, expectedValue, probabilityAtLeast, type Outcome } from '@/lib/enhance';
import { formatPercent } from '@/lib/format';
import type { ReverseInputs } from './inputs';
import { Panel } from './ui';

/**
 * 레벨업을 다 마쳤을 때 각 능력치가 얼마나 올라 있을지.
 *
 * "이상 확률"이 실제로 쓰이는 열이다 — 유저가 묻는 건 "공+4 이상 나올 확률"이지
 * "정확히 +4일 확률"이 아니다.
 */
export function ReverseOutcome({ reverse }: { reverse: ReverseInputs }) {
  const stats = [
    { label: '공격력', outcomes: reverse.attack, primary: true },
    { label: '주스탯', outcomes: reverse.mainStat, primary: false },
    { label: '부스탯', outcomes: reverse.subStat, primary: false },
  ];

  return (
    <Panel title="리버스 레벨업 결과" hint={`${reverse.levels}회 마쳤을 때`}>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <StatTable
            key={stat.label}
            label={stat.label}
            total={convolve(stat.outcomes, reverse.levels)}
            primary={stat.primary}
          />
        ))}
      </div>
      <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">
        강화 분석에 실제로 들어가는 건 <b className="text-ink-2">공격력</b> 뿐입니다. 주스탯과
        부스탯은 분포만 보여 줍니다 — 엔진이 공격력 하나로 상태를 잡고 있어서, 스탯까지 넣으면
        격자가 통째로 커집니다.
      </p>
    </Panel>
  );
}

function StatTable({
  label,
  total,
  primary,
}: {
  label: string;
  total: Outcome[];
  primary: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className={`text-[12px] ${primary ? 'text-gold' : 'text-ink-2'}`}>{label}</span>
        <span className="tabular text-[11px] text-ink-3">
          평균 +{expectedValue(total).toFixed(2)}
        </span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-ink-3">
            <th className="pb-1 text-left font-normal">결과</th>
            <th className="pb-1 text-right font-normal">확률</th>
            <th className="pb-1 text-right font-normal">이상</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {total.map((o) => (
            <tr key={o.value} className="border-t border-line">
              <td className="py-0.5 text-ink-2">+{o.value}</td>
              <td className="py-0.5 text-right text-ink-1">{formatPercent(o.probability)}</td>
              <td className="py-0.5 text-right text-ink-3">
                {formatPercent(probabilityAtLeast(total, o.value))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
