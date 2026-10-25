/**
 * 生成 PNG 图标（零依赖，自带 PNG 编码）
 * 用法：node tools/make-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 画布 ---------- */
function canvas(size) {
  return { size, buf: Buffer.alloc(size * size * 4, 0) };
}

function px(c, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const srcA = a / 255;
  const dstA = c.buf[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  c.buf[i] = Math.round((r * srcA + c.buf[i] * dstA * (1 - srcA)) / outA);
  c.buf[i + 1] = Math.round((g * srcA + c.buf[i + 1] * dstA * (1 - srcA)) / outA);
  c.buf[i + 2] = Math.round((b * srcA + c.buf[i + 2] * dstA * (1 - srcA)) / outA);
  c.buf[i + 3] = Math.round(outA * 255);
}

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 圆角矩形填充（带抗锯齿） */
function roundRect(c, x0, y0, w, h, r, color, alpha = 255) {
  const [R, G, B] = hex(color);
  const SS = 4; // 超采样
  for (let y = Math.floor(y0) - 1; y < y0 + h + 1; y++) {
    for (let x = Math.floor(x0) - 1; x < x0 + w + 1; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS, py0 = y + (sy + 0.5) / SS;
          if (insideRound(px0, py0, x0, y0, w, h, r)) hits++;
        }
      }
      if (!hits) continue;
      const cov = hits / (SS * SS);
      px(c, x, y, R, G, B, Math.round(alpha * cov));
    }
  }
}

function insideRound(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r + 0.001;
}

/* ---------- 图标设计 ---------- */
const ACCENT = '#4f7cff';
const ACCENT_DARK = '#3563e8';
const WHITE = '#ffffff';
const LINE = '#dfe6f8';
const DOT_COLORS = ['#f2586f', '#16b6a4', '#f79c22'];

function drawIcon(size, { fullBleed = false } = {}) {
  const c = canvas(size);
  const s = size / 512;

  // 背景：整块圆角（maskable 版本铺满，避免被裁）
  const radius = fullBleed ? 0 : 118 * s;
  roundRect(c, 0, 0, size, size, radius, ACCENT);

  // 顶部微渐变（简单两层叠加模拟）
  roundRect(c, 0, 0, size, size * 0.52, radius, ACCENT_DARK, 46);

  // 白色日历卡片
  const cardX = (fullBleed ? 92 : 104) * s;
  const cardY = (fullBleed ? 120 : 126) * s;
  const cardW = size - cardX * 2;
  const cardH = (fullBleed ? 300 : 288) * s;
  roundRect(c, cardX, cardY, cardW, cardH, 34 * s, WHITE);

  // 卡片顶部浅色条（日期区）
  roundRect(c, cardX, cardY, cardW, 62 * s, 34 * s, '#dbe4ff');
  roundRect(c, cardX, cardY + 30 * s, cardW, 32 * s, 0, '#dbe4ff');

  // 顶部三个小圆点（代表日期）
  for (let i = 0; i < 3; i++) {
    const dotR = 7 * s;
    roundRect(c, cardX + cardW * (0.3 + i * 0.2) - dotR, cardY + 31 * s - dotR, dotR * 2, dotR * 2, dotR, ACCENT, 150);
  }

  // 挂钩
  const hookW = 14 * s, hookH = 46 * s;
  roundRect(c, cardX + cardW * 0.26 - hookW / 2, cardY - 22 * s, hookW, hookH, 7 * s, '#ffffff');
  roundRect(c, cardX + cardW * 0.74 - hookW / 2, cardY - 22 * s, hookW, hookH, 7 * s, '#ffffff');

  // 网格：3 列 2 行
  const padX = 26 * s, padY = 24 * s;
  const gridTop = cardY + 84 * s;
  const gridW = cardW - padX * 2;
  const gridH = cardH - (gridTop - cardY) - padY;
  const cellW = gridW / 3, cellH = gridH / 2;
  for (let r = 1; r < 2; r++) {
    roundRect(c, cardX + padX, gridTop + r * cellH - 2 * s, gridW, 4 * s, 2 * s, LINE);
  }
  for (let col = 1; col < 3; col++) {
    roundRect(c, cardX + padX + col * cellW - 2 * s, gridTop, 4 * s, gridH, 2 * s, LINE);
  }

  // 色块
  const blocks = [
    { col: 0, row: 0, h: 1, color: DOT_COLORS[0] },
    { col: 1, row: 0, h: 0.55, color: DOT_COLORS[1] },
    { col: 2, row: 0.55, h: 0.45, color: DOT_COLORS[2] },
    { col: 1, row: 0.62, h: 0.38, color: DOT_COLORS[0] }
  ];
  blocks.forEach((b) => {
    const bx = cardX + padX + b.col * cellW + 8 * s;
    const by = gridTop + b.row * cellH + 8 * s;
    const bw = cellW - 16 * s;
    const bh = cellH * b.h - 16 * s;
    roundRect(c, bx, by, bw, Math.max(bh, 20 * s), 10 * s, b.color);
  });

  return c;
}

function save(name, size, opts) {
  const c = drawIcon(size, opts);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, encodePng(size, size, c.buf));
  console.log('✓', name, size + 'x' + size, (fs.statSync(file).size / 1024).toFixed(1) + 'KB');
}

save('icon-192.png', 192);
save('icon-512.png', 512);
save('maskable-512.png', 512, { fullBleed: true });
save('apple-touch-icon.png', 180);

// favicon.svg
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="118" fill="${ACCENT}"/>
  <rect x="104" y="126" width="304" height="288" rx="34" fill="#fff"/>
  <path d="M104 160a34 34 0 0 1 34-34h236a34 34 0 0 1 34 34v28H104z" fill="${ACCENT}"/>
  <rect x="166" y="104" width="14" height="46" rx="7" fill="#fff"/>
  <rect x="332" y="104" width="14" height="46" rx="7" fill="#fff"/>
  <rect x="130" y="214" width="252" height="4" rx="2" fill="${LINE}"/>
  <rect x="130" y="308" width="252" height="4" rx="2" fill="${LINE}"/>
  <rect x="216" y="210" width="4" height="180" rx="2" fill="${LINE}"/>
  <rect x="300" y="210" width="4" height="180" rx="2" fill="${LINE}"/>
  <rect x="138" y="222" width="70" height="78" rx="10" fill="#f2586f"/>
  <rect x="224" y="222" width="68" height="40" rx="10" fill="#16b6a4"/>
  <rect x="308" y="270" width="66" height="38" rx="10" fill="#f79c22"/>
  <rect x="224" y="316" width="68" height="30" rx="10" fill="#f2586f"/>
</svg>
`;
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg);
console.log('✓ favicon.svg');
