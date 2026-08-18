# 🍁 메이플랜드 주문서 강화 분석기

[![Website - Live](https://img.shields.io/badge/Website-Live-2ea44f?style=flat&logo=githubpages)](https://myungwoo.github.io/mapleland-enhance-analyzer/)
[![Deploy](https://github.com/myungwoo/mapleland-enhance-analyzer/actions/workflows/deploy.yml/badge.svg)](.github/workflows/deploy.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Vitest-36%20passing-6E9F18?logo=vitest&logoColor=white)](src/lib/enhance/__tests__)

무기 주문서 강화에서 **목표 공격력까지의 최소 기대비용 전략**과 **예산 제약 하 달성 확률**을
계산한다. 시뮬레이션이 아니라 동적계획 엄밀해다.

**바로 사용하기 → [myungwoo.github.io/mapleland-enhance-analyzer](https://myungwoo.github.io/mapleland-enhance-analyzer/)**
(설치 없이 브라우저에서 동작하고, 계산은 전부 로컬에서 끝난다)

```bash
npm run dev        # 웹 UI
npm test           # 엔진 검증 (해석해 대조 · 몬테카를로 교차검증 · 불변식)
npm run typecheck  # next typegen + tsc
npm run lint
npm run build      # 정적 내보내기 (out/)
npm run report     # 예제 시나리오 전체 분석을 터미널에 출력
npm run diag       # 입력 시세가 앞뒤가 맞는지 (매물 이론가) 확인
```

계산은 전부 브라우저에서 끝나므로 서버가 필요 없다. `main` 에 푸시하면 GitHub Pages 로
정적 배포된다.

## 문제

업횟(업그레이드 가능 횟수)이 유일한 희소 자원이다. 성공·실패 무관하게 1씩 줄고,
아이템 파괴는 없다. 슬롯당 기대 공격력은 60%가 1.2로 가장 높다.

| 주문서 | 성공률 | 공격력 | 슬롯당 기대치 |
| ------ | ------ | ------ | ------------- |
| 100%   | 1.0    | +1     | 1.0           |
| 60%    | 0.6    | +2     | 1.2           |
| 10%    | 0.1    | +5     | 0.5           |

그럼에도 10%를 쓰는 이유는 **분산**이다. 업횟 7칸을 60%로만 채우면 기댓값은 공8.4,
최대는 공14다. 목표가 평균보다 위에 있으면 분산을 사야만 도달 확률이 생긴다.
여기에 "실패한 무기를 팔고 새로 시작한다"는 선택지가 붙어 재시작 옵션이 있는
확률적 동적계획 문제가 된다.

## 엔진 구조 (`src/lib/enhance`)

상태는 `(남은 업횟 u, 정옵 대비 공격력 a)` 하나뿐이라 격자가 작고, 전체 해가 수 ms에 나온다.

| 파일            | 역할                                                      |
| --------------- | --------------------------------------------------------- |
| `dp-cost.ts`    | 모드 A — 목표 달성 최소 기대비용과 최적 정책              |
| `dp-budget.ts`  | 모드 C — 예산 제약 하 달성 확률 최대화                    |
| `evaluate.ts`   | 정책 고정 후 비용 CDF·분위수, 무기 한 자루의 결과 분포    |
| `breakeven.ts`  | 주문서별 손익분기 가격 역산                               |
| `salvage.ts`    | 시세 보간과 상태의 **이론가** 유도                        |

### 재시작 고정점

손절 후 재시작하는 비용에 시작 상태의 값 `R` 이 다시 등장한다. `R` 을 고정하면 나머지는
업횟 오름차순 한 번의 스윕으로 끝나므로, 바깥에서 `R` 만 맞추면 된다. `f(R)` 은 비감소이고
기울기가 1 이하라 `R=0` 에서 `R ← f(R)` 을 반복하면 **최소** 고정점으로 단조 수렴한다
(Aitken Δ² 가속, 오버슈트 시 폐기).

### 남은 업횟의 가치는 묻지 않고 유도한다

사용자에게 받는 시세는 **업횟 0칸 기준 공격력별 시세** 하나뿐이다. 남은 업횟의 값어치는
엔진이 계산한다.

```
W(u, a) = max( V(a),  max_s [ E W(u−1, ·) − c_s ] )
```

"1칸당 N메소" 같은 상수를 입력받으면 시세 곡선과 거의 반드시 모순이 난다. 예컨대 공7이
600만, 공8이 900만인데 100% 주문서가 30만이라면, 1칸 남은 공7은 그 자체로 870만 이상의
가치가 있다. 칸당 10만이라고 적으면 사서 주문서 한 장 바르는 것만으로 260만이 공짜로 생기는
차익거래가 모델 안에 생겨 최소비용이 −∞로 발산한다. `W` 는 정의상 그 구멍이 없고, 덤으로
**매물 가치 평가**("이 공5 3칸짜리 적정가?")에 그대로 쓰인다.

### 이 도구가 의미 있는 조건

시세가 완전히 정합한 시장에서는 답이 자명해진다 — 목표 완성품을 살 수 있다면 최소비용은
정확히 그 시세다. 이 분석이 실제로 값을 하는 상황은 둘이다.

1. **목표 완성품 매물이 없다.** 공10짜리를 파는 사람이 없으니 직접 만들어야 한다.
   (목표 공격력의 시세를 비워 두면 이 모드가 된다.)
2. **매물이 이론가보다 싸다.** 엔진이 이걸 찾아내면 그 사실을 먼저 알린다.

## 알려진 근사

- **예산 축은 음수 지출을 표현하지 못한다.** 공6을 팔면 새 하옵을 사고도 돈이 남는 경우가
  있는데, 예산 모드와 비용 CDF는 그 초과분을 재투자하지 못하는 것으로 본다(`creditCapped`).
  결과는 보수적인 쪽으로 치우친다. 헤드라인인 기대 순비용은 이 근사를 쓰지 않는 엄밀값이다.
- 비용을 예산 격자에 올릴 때는 **확률적 반올림**을 써서 이산화 편향을 없앴다.
  매번 올림/내림하면 수십 번의 행동을 거치며 편향이 누적돼 분포가 통째로 밀린다.

## 화면 (`src/components`)

| 파일 | 역할 |
| --- | --- |
| `Analyzer.tsx` | 입력 상태와 결과 조립 |
| `InputPanel.tsx` | 시세·목표 입력 |
| `PolicyHeatmap.tsx` | (남은 업횟 × 공격력) 격자에 최적 행동을 칠한 시그니처 화면 |
| `charts.tsx` | 누적 확률 곡선, 가로 막대 |
| `StateAdvisor.tsx` | 지금 들고 있는 무기의 "계속 vs 손절" 판정 |

계열색 4종(주문서 3 + 손절)은 dataviz 검증기의 all-pairs 기준을 통과한 조합이다
(dark, surface `#1a1d21`). 색맹 분리 ΔE 7.2 로 경고대에 있어 **보조 인코딩이 필수**이며,
그래서 격자의 모든 칸에 문자 라벨이 함께 들어간다. 색을 바꾸려면 검증기를 다시 돌릴 것.

## CI

검증 단계는 `.github/workflows/checks.yml` 한 곳에만 있고, PR 과 배포가 이를 재사용한다
(`workflow_call`). 배포 워크플로는 여기에 Pages 하위 경로를 넘기고 결과물을 아티팩트로
받아 그대로 올린다 — PR 에서 통과한 것과 같은 빌드가 배포된다.
