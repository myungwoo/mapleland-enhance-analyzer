'use client';

import Image from 'next/image';
import { asset } from '@/lib/asset';
import { PRESETS, findPreset } from '@/lib/enhance/data/presets';
import { BASE_OFFSETS, baseLabel, type Inputs } from './inputs';
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
            suffix="칸"
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
              <Image
                src={asset(s.icon)}
                alt=""
                width={32}
                height={32}
                unoptimized
                className="size-8 shrink-0"
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

      <Panel title="완작 시세" hint="업횟 0칸 기준, 아는 것만">
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
