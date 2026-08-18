/**
 * 주문서 아이콘을 직접 그린다.
 *
 *   node scripts/draw-scroll-icons.mjs
 *
 * 왜 직접 그리나: 게임 원본 아이콘은 넥슨 저작물이라 저장소에 담아 MIT 로 재배포할 수
 * 없다. 그렇다고 픽셀을 그대로 옮겨 그리면 2차적저작물이라 문제가 그대로다.
 * 그래서 "대각선으로 말린 두루마리"라는 일반적인 관용구와, 유저가 실제 식별에 쓰는
 * 색 코드(100% 파랑 / 60% 빨강 / 10% 금색)만 맞추고 형상은 여기서 새로 만든다.
 *
 * 32×32 격자에 파라메트릭으로 래스터라이즈한 뒤 픽셀 하나당 사각형으로 SVG 를 뽑는다.
 * 손으로 찍은 도트가 아니라 코드라서, 비율이 마음에 안 들면 숫자만 고치면 된다.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 32;

/**
 * 구성: 위/아래에 대각선으로 말린 원기둥, 그 사이에 펼쳐진 면.
 * 말린 부분이 면보다 좌우로 삐져나와야 "말려 있다"로 읽힌다.
 */
const TOP = { a: [5.5, 10.5], b: [27.5, 4.5] };
const BOTTOM = { a: [4.5, 27.5], b: [26.5, 21.5] };
const ROLL_RADIUS = 4.0;

/** 펼쳐진 면의 좌우 경계 — 아래로 갈수록 살짝 오른쪽으로 흐른다 */
const sheetLeft = (y) => 5.8 + 0.07 * (y - 14);
const sheetRight = (y) => 25.2 + 0.07 * (y - 14);

const PALETTES = {
  100: { trim: '#eaf3f7', light: '#d3e3ea', mid: '#749cad', dark: '#456d80', hole: '#22404e', edge: '#10191f' },
  60: { trim: '#f6d6bd', light: '#eab89b', mid: '#b65f3f', dark: '#87401f', hole: '#4c2210', edge: '#1d0f08' },
  10: { trim: '#fff0c2', light: '#ffdb8d', mid: '#c99433', dark: '#95661b', hole: '#54390c', edge: '#1d1507' },
};

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const len = (p) => Math.hypot(p[0], p[1]);
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];

/** 점에서 선분까지의 거리, 진행 위치(0~1), 그리고 어느 쪽인지(부호) */
function toSegment(px, seg) {
  const ab = sub(seg.b, seg.a);
  const t = Math.max(0, Math.min(1, dot(sub(px, seg.a), ab) / dot(ab, ab)));
  const foot = [seg.a[0] + ab[0] * t, seg.a[1] + ab[1] * t];
  return { dist: len(sub(px, foot)), t, signed: cross(ab, sub(px, seg.a)) / len(ab) };
}

/** 32×32 격자를 채운다. 값은 'light' | 'mid' | 'dark' | null */
function raster() {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = [x + 0.5, y + 0.5];

      // 1) 펼쳐진 면 — 두 말이 사이에 낀 세로 띠. 왼쪽에서 빛을 받는다.
      const belowTop = toSegment(px, TOP).signed > 0;
      const aboveBottom = toSegment(px, BOTTOM).signed < 0;
      if (belowTop && aboveBottom) {
        const l = sheetLeft(px[1]);
        const r = sheetRight(px[1]);
        if (px[0] > l && px[0] < r) {
          // 양 옆에 밝은 테두리를 한 줄 둔다. 작은 크기에서 면의 경계가 살아난다.
          if (px[0] - l < 1.15 || r - px[0] < 1.15) {
            grid[y][x] = 'trim';
          } else {
            const t = (px[0] - l) / (r - l);
            grid[y][x] = t < 0.32 ? 'light' : t < 0.72 ? 'mid' : 'dark';
          }
        }
      }

      // 2) 말린 부분 — 면 위에 덮어 그린다. 축에서 아래로 갈수록 어두운 원기둥.
      for (const seg of [TOP, BOTTOM]) {
        const { dist, signed, t } = toSegment(px, seg);
        if (dist <= ROLL_RADIUS && t > 0.0001 && t < 0.9999) {
          const k = signed / ROLL_RADIUS; // -1(위) ~ +1(아래)
          grid[y][x] = k < -0.32 ? 'light' : k < 0.5 ? 'mid' : 'dark';
        }
        // 오른쪽 끝의 관 구멍. 이게 있어야 "말려 있다"가 한눈에 읽힌다.
        if (len(sub(px, seg.b)) <= ROLL_RADIUS * 0.62) grid[y][x] = 'hole';
      }
    }
  }
  return grid;
}

/** 바깥 테두리 한 겹을 깐다. 도트 아이콘은 이게 있어야 형태가 선다. */
function outline(grid) {
  const out = grid.map((row) => row.slice());
  const opaque = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && grid[y][x] !== null;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!opaque(x, y)) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) {
        out[y][x] = 'edge';
      }
    }
  }
  return out;
}

/** 같은 색이 이어지는 구간은 사각형 하나로 묶는다 */
function toSvg(grid, palette, { scale = 1, trim = 0 } = {}) {
  const rects = [];
  for (let y = 0; y < SIZE; y++) {
    let run = null;
    for (let x = 0; x <= SIZE; x++) {
      const tone = x < SIZE ? grid[y][x] : null;
      if (run && run.tone === tone) {
        run.width++;
        continue;
      }
      if (run) {
        rects.push(
          `<rect x="${run.x}" y="${y}" width="${run.width}" height="1" fill="${palette[run.tone]}"/>`,
        );
      }
      run = tone ? { tone, x, width: 1 } : null;
    }
  }
  const view = `${trim} ${trim} ${SIZE - trim * 2} ${SIZE - trim * 2}`;
  const px = (SIZE - trim * 2) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${view}" shape-rendering="crispEdges">\n${rects.join('\n')}\n</svg>\n`;
}

/** 최소한의 PNG 인코더. 파비콘은 SVG 를 못 읽는 브라우저도 있어 PNG 로 낸다. */
function toPng(grid, palette, scale) {
  const w = SIZE * scale;
  const raw = Buffer.alloc((w * 4 + 1) * w);
  let p = 0;
  for (let y = 0; y < w; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const tone = grid[Math.floor(y / scale)][Math.floor(x / scale)];
      if (!tone) {
        p += 4;
        continue;
      }
      const hex = palette[tone];
      raw[p++] = parseInt(hex.slice(1, 3), 16);
      raw[p++] = parseInt(hex.slice(3, 5), 16);
      raw[p++] = parseInt(hex.slice(5, 7), 16);
      raw[p++] = 255;
    }
  }

  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) | 0, data.length + 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const grid = outline(raster());

mkdirSync(join(ROOT, 'public/icons'), { recursive: true });
for (const [id, palette] of Object.entries(PALETTES)) {
  writeFileSync(join(ROOT, `public/icons/scroll-${id}.svg`), toSvg(grid, palette));
}

// 파비콘은 60% 주문서를 여백만 잘라 꽉 채운 것. 탭에서 16px 로 줄어도 형태가 남는다.
writeFileSync(join(ROOT, 'src/app/icon.svg'), toSvg(grid, PALETTES[60], { trim: 1 }));
writeFileSync(join(ROOT, 'src/app/icon.png'), toPng(grid, PALETTES[60], 4));

// 눈으로 확인할 수 있게 격자를 찍어 준다
const CH = { trim: '+', light: '@', mid: 'o', dark: '-', hole: 'O', edge: '#', null: '.' };
console.log(grid.map((row) => row.map((t) => CH[t] ?? '.').join('')).join('\n'));
