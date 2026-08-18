'use client';

import Image from 'next/image';
import { asset } from '@/lib/asset';
import { PRESETS, findPreset } from '@/lib/enhance/data/presets';
import { BASE_OFFSETS, baseLabel, type Inputs } from './inputs';
import { OutcomeEditor } from './OutcomeEditor';
import { NumberField, Panel } from './ui';

export function InputPanel({
  inputs,
  onChange,
}: {
  inputs: Inputs;
  onChange: (next: Inputs) => void;
}) {
  const preset = findPreset(inputs.presetId);
  const patch = (p: Partial<Inputs>) => onChange({ ...inputs, ...p });

  const resaleRows: number[] = [];
  for (let a = 0; a <= inputs.target; a++) resaleRows.push(a);

  return (
    <div className="flex flex-col gap-3">
      <Panel title="강화 대상">
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12px]">
            <span className="w-20 shrink-0 text-ink-2">주문서</span>
            <span className="inset flex-1 px-2 py-1">
              <select
                className="w-full bg-transparent text-ink-1 outline-none"
                value={inputs.presetId}
                onChange={(e) => {
                  const next = findPreset(e.target.value);
                  patch({ presetId: e.target.value, maxSlots: next.defaultSlots });
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id} className="bg-surface-2">
                    {p.name} 주문서
                  </option>
                ))}
              </select>
            </span>
          </label>
          <NumberField
            label="업횟"
            value={inputs.maxSlots}
            onChange={(v) => patch({ maxSlots: v ?? 1 })}
            suffix="회"
            min={1}
            max={20}
          />
          <NumberField
            label="목표"
            value={inputs.target}
            onChange={(v) => patch({ target: v ?? 1 })}
            suffix={`${preset.statLabel} 이상`}
            min={1}
            max={60}
          />
        </div>
      </Panel>

      <Panel title="주문서 시세" hint="장당">
        <div className="flex flex-col gap-2">
          {preset.scrolls.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              {/* 원본이 30×29 라 그대로 놓아야 도트가 안 뭉개진다 */}
              <Image
                src={asset(s.icon)}
                alt=""
                width={30}
                height={29}
                unoptimized
                className="pixelated shrink-0"
              />
              <div className="flex-1">
                <NumberField
                  label={s.label}
                  value={inputs.scrollPrices[s.id] ?? null}
                  onChange={(v) =>
                    patch({ scrollPrices: { ...inputs.scrollPrices, [s.id]: v } })
                  }
                  suffix="만"
                  placeholder="미사용"
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[11px] text-ink-3">
                +{s.attackGain}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="베이스 매물 시세" hint="빈칸은 안 삼">
        <div className="flex flex-col gap-1.5">
          {BASE_OFFSETS.map((offset) => {
            const row = inputs.bases.find((b) => b.offset === offset);
            return (
              <NumberField
                key={offset}
                label={baseLabel(offset)}
                value={row?.price ?? null}
                onChange={(v) =>
                  patch({
                    bases: inputs.bases.map((b) => (b.offset === offset ? { ...b, price: v } : b)),
                  })
                }
                suffix="만"
                placeholder="—"
              />
            );
          })}
        </div>
      </Panel>

      <Panel title="완작 시세" hint="업횟 0회 기준, 아는 것만">
        <p className="mb-2 text-[11px] leading-relaxed text-ink-3">
          남은 업횟의 값어치는 엔진이 이 곡선과 주문서 값에서 유도합니다. 목표 시세를 비워
          두면 &ldquo;직접 만들어야 하는&rdquo; 상황으로 계산합니다.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {resaleRows.map((a) => (
            <NumberField
              key={a}
              compact
              label={`공${a}`}
              value={inputs.resale[a] ?? null}
              onChange={(v) => patch({ resale: { ...inputs.resale, [a]: v } })}
              suffix="만"
              placeholder="—"
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="리버스 아이템 레벨업"
        hint="선택"
        right={
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
            <input
              type="checkbox"
              checked={inputs.reverse.enabled}
              onChange={(e) =>
                patch({ reverse: { ...inputs.reverse, enabled: e.target.checked } })
              }
            />
            사용
          </label>
        }
      >
        {inputs.reverse.enabled ? (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] leading-relaxed text-ink-3">
              레벨업을 먼저 끝내고 그 결과를 보고 강화한다고 봅니다. 확률은 유저 추정값이니
              직접 바꿔 가며 돌려 보세요.
            </p>
            <p className="text-[11px] leading-relaxed text-[color:var(--warn)]">
              위 <b>베이스 매물 시세</b>도 리버스 무기 시세로 바꿔 주세요. 레벨업으로 공격력이
              공짜로 붙는 만큼 이론가가 올라가서, 일반 무기 시세를 그대로 두면 &ldquo;이론가보다
              싼 매물&rdquo; 경고가 뜹니다.
            </p>
            <NumberField
              label="레벨업"
              value={inputs.reverse.levels}
              onChange={(v) => patch({ reverse: { ...inputs.reverse, levels: v ?? 0 } })}
              suffix="회"
              min={0}
              max={10}
            />
            <OutcomeEditor
              label="공격력 (강화 분석에 반영)"
              outcomes={inputs.reverse.attack}
              onChange={(attack) => patch({ reverse: { ...inputs.reverse, attack } })}
            />
            <OutcomeEditor
              label="주스탯 (참고용)"
              outcomes={inputs.reverse.mainStat}
              onChange={(mainStat) => patch({ reverse: { ...inputs.reverse, mainStat } })}
            />
            <OutcomeEditor
              label="부스탯 (참고용)"
              outcomes={inputs.reverse.subStat}
              onChange={(subStat) => patch({ reverse: { ...inputs.reverse, subStat } })}
            />
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-ink-3">
            리버스 무기는 아이템 레벨이 오를 때마다 공격력·주스탯·부스탯이 확률적으로
            오릅니다. 켜면 그 굴림을 시작 공격력으로 반영합니다.
          </p>
        )}
      </Panel>

      <Panel title="예산" hint="선택">
        <div className="flex flex-col gap-2">
          <NumberField
            label="총 예산"
            value={inputs.budget}
            onChange={(v) => patch({ budget: v })}
            suffix="만"
            placeholder="미설정"
          />
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={inputs.allowRestart}
              onChange={(e) => patch({ allowRestart: e.target.checked })}
            />
            손절하고 새 무기로 다시 시작 허용
          </label>
        </div>
      </Panel>
    </div>
  );
}
