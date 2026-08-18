/**
 * 엔진 검증용 리포트. UI 를 붙이기 전에 숫자가 말이 되는지 눈으로 확인한다.
 *
 *   npm run report
 */
import { analyze, advise, decodeAction, type Problem } from '../src/lib/enhance';

const 만 = 10_000;
const 억 = 100_000_000;

/** 한손검(업횟 7) 을 공10 까지 올리는 시나리오. 시세는 예시값이다. */
const problem: Problem = {
  maxSlots: 7,
  scrolls: [
    { id: '100', label: '100%', successRate: 1.0, attackGain: 1, price: 30 * 만 },
    { id: '60', label: '60%', successRate: 0.6, attackGain: 2, price: 120 * 만 },
    { id: '10', label: '10%', successRate: 0.1, attackGain: 5, price: 400 * 만 },
  ],
  baseOptions: [
    { offset: -1, price: 300 * 만, label: '공1하' },
    { offset: 0, price: 800 * 만, label: '정옵' },
    { offset: 1, price: 1500 * 만, label: '공1상' },
  ],
  target: 10,
  // 업횟 0회 기준 공격력별 시세. 매물가는 이 곡선에서 유도되는 이론가 위여야
  // 앞뒤가 맞는다 (npm run diag 로 확인).
  salvage: {
    byAttack: [
      { attack: 0, price: 50 * 만 },
      { attack: 2, price: 280 * 만 },
      { attack: 4, price: 350 * 만 },
      { attack: 5, price: 380 * 만 },
      { attack: 6, price: 400 * 만 },
      { attack: 7, price: 600 * 만 },
      { attack: 8, price: 900 * 만 },
      // 공10 은 매물 자체가 없어 시세를 못 적는 상황. 그래서 직접 만들어야 한다.
    ],
  },
  allowRestart: true,
};

const money = (v: number) =>
  !Number.isFinite(v)
    ? '—'
    : Math.abs(v) >= 억
      ? `${(v / 억).toFixed(2)}억`
      : `${Math.round(v / 만).toLocaleString('ko-KR')}만`;

const result = analyze(problem, { budget: 5000 * 만, includeBreakeven: true });
const { cost, successChance, distribution, outcome, budget, breakeven, strategies } = result;

console.log('═'.repeat(64));
console.log(`한손검 업횟 ${problem.maxSlots}회 → 목표 공${problem.target}`);
console.log('═'.repeat(64));

for (const w of result.warnings) console.log(`⚠  ${w}`);
if (result.warnings.length) console.log();

console.log(`첫 매물        ${result.problem.baseOptions[cost.bestBaseIndex].label}`);
console.log(`기대 순비용    ${money(cost.expectedCost)}`);
if (distribution) {
  const q = distribution.quantiles;
  console.log(
    `지출 분위수    중앙 ${money(q.p50)} / 상위25% ${money(q.p75)} / 상위10% ${money(q.p90)} / 상위1% ${money(q.p99)}`,
  );
}
if (outcome) {
  console.log(`평균 강화      아이템 ${outcome.expectedItems.toFixed(2)}개`);
  console.log(`개당           주문서 ${outcome.expectedScrollsPerItem.toFixed(2)}장 소모, 손절 확률 ${(outcome.abandonProbability * 100).toFixed(1)}%`);
}

console.log('\n── 최적 전략 (행: 남은 업횟, 열: 현재 공격력) ──');
const names = problem.scrolls.map((s) => s.label);
const header = [];
for (let a = cost.axes.attackMin; a <= problem.target; a++) header.push(`공${a}`.padStart(6));
console.log('       ' + header.join(''));
for (let u = problem.maxSlots; u >= 0; u--) {
  const row: string[] = [];
  for (let a = cost.axes.attackMin; a <= problem.target; a++) {
    const act = decodeAction(cost.policy[u * cost.axes.span + (a - cost.axes.attackMin)]);
    const reachable = a <= 1 + (problem.maxSlots - u) * 5;
    row.push(
      (!reachable
        ? '·'
        : act.kind === 'scroll'
          ? names[act.scrollIndex]
          : act.kind === 'restart'
            ? result.problem.baseOptions[act.baseIndex].synthetic
              ? '완제품'
              : '손절'
            : act.kind === 'done'
              ? '달성'
              : '×'
      ).padStart(6),
    );
  }
  console.log(`${String(u).padStart(2)}회  ` + row.join(''));
}

console.log('\n── 전략 비교 ──');
for (const s of [...strategies].sort((a, b) => a.expectedCost - b.expectedCost)) {
  console.log(`  ${s.label.padEnd(16)} ${money(s.expectedCost)}`);
}

if (breakeven) {
  console.log('\n── 주문서 손익분기 가격 ──');
  for (const b of breakeven) {
    const verdict = b.worthUsing ? '쓸 만함' : '비쌈';
    console.log(
      `  ${b.scrollLabel.padEnd(6)} 현재 ${money(b.currentPrice).padStart(8)} / 손익분기 ${money(b.breakevenPrice).padStart(8)}  ${verdict}`,
    );
  }
}

if (budget) {
  console.log('\n── 예산별 달성 확률 ──');
  for (const frac of [0.1, 0.2, 0.4, 0.6, 0.8, 1]) {
    const b = Math.floor(budget.ticks * frac);
    console.log(`  ${money(b * budget.tick).padStart(8)}  →  ${(budget.curve[b] * 100).toFixed(1)}%`);
  }
}

if (result.budgetStartBands.length) {
  // 가진 돈에 따라 첫 매물이 갈리는 지점. 한 줄이면 이 문제에서는 안 갈린다는 뜻이다.
  console.log('\n── 예산 구간별 사야 할 매물 ──');
  for (const band of result.budgetStartBands) {
    const label = result.problem.baseOptions[band.baseIndex].label ?? '완성품';
    console.log(
      `  ${money(band.from).padStart(8)} ~ ${money(band.to).padStart(8)}  →  ${label.padEnd(8)}` +
        `달성확률 ${(band.chanceFrom * 100).toFixed(1).padStart(5)}% → ${(band.chanceTo * 100).toFixed(1).padStart(5)}%` +
        `, 차선 대비 ${Number.isFinite(band.margin) ? `${(band.margin * 100).toFixed(1)}%p` : '유일'}`,
    );
  }
  if (result.budgetStart) {
    const plan = result.budgetStart;
    console.log(
      `  → 입력한 예산 기준: ${
        plan.baseIndex < 0 ? '살 수 있는 게 없음' : (result.problem.baseOptions[plan.baseIndex].label ?? '완성품')
      } (달성확률 ${(plan.chance * 100).toFixed(1)}%)`,
    );
  }
}

console.log('\n── 매물 이론가 (이 값보다 싸면 사도 되는 가격) ──');
for (const base of result.problem.baseOptions) {
  if (base.synthetic) continue;
  const fair = cost.salvageAt(problem.maxSlots, base.offset);
  const verdict = base.price < fair ? '저평가' : '적정/비쌈';
  console.log(
    `  ${(base.label ?? '').padEnd(6)} 호가 ${money(base.price).padStart(8)} / 이론가 ${money(fair).padStart(8)}  ${verdict}`,
  );
}

console.log('\n── 현재 상황에서 최적 전략 ──');
for (const [slots, attack] of [
  [4, 0],
  [3, 5],
  [2, 5],
  [1, 5],
  [1, 8],
  [0, 8],
] as const) {
  const a = advise(result.problem, cost, successChance, slots, attack);
  const next =
    a.action.kind === 'scroll'
      ? `${names[a.action.scrollIndex]} 바르기`
      : a.action.kind === 'restart'
        ? result.problem.baseOptions[a.action.baseIndex].synthetic
          ? '완제품 구매'
          : '손절하고 새 아이템'
        : a.action.kind === 'done'
          ? '이미 달성'
          : '방법 없음';
  console.log(
    `  공${attack} ${slots}회 남음 → ${next.padEnd(18)} ` +
      `달성확률 ${(a.successProbability * 100).toFixed(1).padStart(5)}%, ` +
      `남은 기대비용 ${money(a.remainingCost).padStart(8)}, 지금 팔면 ${money(a.salvageValue).padStart(8)}`,
  );
}
