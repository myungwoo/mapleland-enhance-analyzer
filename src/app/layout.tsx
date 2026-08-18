import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '메이플랜드 주문서 강화 분석기',
  description:
    '목표 공격력까지의 최소 기대비용 전략과 손절 시점, 예산별 달성 확률을 계산합니다.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className="h-full">
      <head>
        {/* Galmuri — 오픈소스 한글 픽셀 폰트 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/quiple/galmuri/dist/galmuri.css"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
