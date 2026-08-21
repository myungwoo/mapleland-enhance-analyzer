'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { asset } from '@/lib/asset';
import { makeSalvageFn } from '@/lib/enhance';
import { PRESETS, findPreset } from '@/lib/enhance/data/presets';
import { BASE_OFFSETS, baseLabel, type Inputs } from './inputs';
import { OutcomeEditor } from './OutcomeEditor';
import { NumberField, Panel } from './ui';

export function InputPanel({
  inputs,
  onChange,
  onReset,
}: {
  inputs: Inputs;
  onChange: (next: Inputs) => void;
  /** 저장된 입력을 지우고 기본값으로 되돌린다 */
  onReset: () => void;
}) {
  const preset = findPreset(inputs.presetId);
  const patch = (p: Partial<Inputs>) => onChange({ ...inputs, ...p });

  // 완작 시세 표의 세로 범위. 하옵 매물을 살 생각이면 하옵 완작의 회수값도 물어봐야
  // 한다 — 곡선의 최저 칸이 그 아래 전부의 바닥값이 되므로, 하옵 칸이 없으면 "하옵
  // 완작은 유저한테 안 팔리고 상점행" 을 적을 방법이 없다.
  const lowestRow = Math.min(
    0,
    ...inputs.bases.filter((b) => b.price != null && b.price > 0).map((b) => b.offset),
  );
  const resaleRows: number[] = [];
  for (let a = lowestRow; a <= inputs.target; a++) resaleRows.push(a);

  // 비워 둔 칸에는 곡선이 예측한 값을 회색으로 띄운다. 실제 시세와 얼마나 어긋나는지
  // 눈으로 보고 고칠 수 있어야 한다. 보간은 배율에 무관해서 만 단위 그대로 넣어도 된다.
  const knownResale = resaleRows
    .filter((a) => inputs.resale[a] != null && Number.isFinite(inputs.resale[a] as number))
    .map((a) => ({ attack: a, price: inputs.resale[a] as number }));
  const predictResale = knownResale.length ? makeSalvageFn({ byAttack: knownResale }) : null;
  // 입력한 최고 공격력 위쪽은 예측이 아니다 — 곡선이 폭주해서 일부러 외삽을 안 한다.
  // 거기까지 숫자를 띄우면 없는 근거를 있는 것처럼 보이게 한다.
  const predictableUpTo = knownResale.length
    ? Math.max(...knownResale.map((p) => p.attack))
    : -Infinity;

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
        <div className="grid grid-cols-2 gap-1.5">
          {BASE_OFFSETS.map((offset) => {
            const row = inputs.bases.find((b) => b.offset === offset);
            return (
              <NumberField
                key={offset}
                compact
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
          업횟이 남은 매물은 거래가 거의 없어, 손절하려면 남은 업횟을 다 태워 완작으로
          만들어야 팔린다고 봅니다. 태우는 데 드는 주문서값까지 계산에 넣기 때문에, 남은
          업횟이 이득이 될지 부담이 될지도 이 곡선에서 갈립니다. 회색 숫자는 예측값이니
          실제와 다르면 채워 주세요.
        </p>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-3">
          <b>채운 칸 중 가장 낮은 공격력의 값이 그 아래 전부의 바닥값</b>이 됩니다. 어느
          선 밑으로는 완작이라도 유저끼리 안 팔리고 상점에 넘기는 게 회수의 전부라, 곡선을
          더 내리지 않습니다. 그러니 그 최저 칸에는 <b>상점 판매가</b>를 적고, 상점에 팔
          생각이 없으면 <b>0</b> 을 적어 주세요.
        </p>
        {!predictResale && (
          <p className="mb-2 border-l-2 border-[color:var(--warn)] bg-[#2a2417] px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
            전부 비어 있어 <b>되팔기를 끕니다</b> — 손절해도 회수 0으로 계산합니다. 리버스처럼
            장착하면 교환불가가 되는 아이템이 이 경우입니다.
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {resaleRows.map((a) => (
            <NumberField
              key={a}
              compact
              label={a < 0 ? baseLabel(a) : `공${a}`}
              value={inputs.resale[a] ?? null}
              onChange={(v) => patch({ resale: { ...inputs.resale, [a]: v } })}
              suffix="만"
              placeholder={
                predictResale && a <= predictableUpTo
                  ? `≈${Math.round(predictResale(a)).toLocaleString('ko-KR')}`
                  : '—'
              }
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
            손절하고 새 아이템으로 다시 시작 허용
          </label>
        </div>
      </Panel>

      <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] leading-relaxed text-ink-3">
        <p>
          입력값은 <b>이 브라우저에만</b> 저장됩니다. 새로고침하거나 나중에 다시 열어도
          그대로입니다.
        </p>
        <ResetButton onReset={onReset} />
      </div>
    </div>
  );
}

/**
 * 저장된 입력을 지운다.
 *
 * 시세 스무 칸을 실수로 날리면 복구할 방법이 없어서 두 번 누르게 했다. 브라우저
 * confirm 은 이 화면의 톤과도 안 맞고 모바일에서 특히 거칠다.
 */
function ResetButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`inset shrink-0 px-2 py-1 ${
        armed ? 'text-[color:var(--warn)]' : 'text-ink-2 hover:text-ink-1'
      }`}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onReset();
      }}
    >
      {armed ? '정말 지울까요?' : '입력 초기화'}
    </button>
  );
}
