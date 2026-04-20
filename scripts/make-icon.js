/* eslint-disable no-console */
/**
 * Pure-Node placeholder icon generator.
 *
 * Generates:
 *   build/icon.png  — 256x256 RGB PNG (electron-builder source)
 *   build/icon.ico  — Multi-size Windows ICO (16, 32, 48, 64, 128, 256 — all PNG-embedded)
 *
 * No external deps. Uses Node's built-in zlib for PNG IDAT compression.
 * Re-run any time via `npm run make:icon` and swap the SVG/PNG source later
 * for a real designer asset (just drop your own `build/icon.png` and rerun
 * the script — or replace `build/icon.ico` directly).
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---------- CRC32 (for PNG chunks) ----------
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

// ---------- PNG writer (RGB, 8-bit, filter 0) ----------
function makePng(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height);
      raw[off + 1 + x * 3] = r & 0xff;
      raw[off + 2 + x * 3] = g & 0xff;
      raw[off + 3 + x * 3] = b & 0xff;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Icon design ----------
// Dark navy background, accent gradient corner, blocky "E" for EduOps.

const BG_TOP = [12, 20, 36];
const BG_BOTTOM = [6, 10, 20];
const ACCENT = [77, 166, 255];
const ACCENT_DARK = [37, 99, 235];
const FG = [232, 240, 252];

// Simple 7x9 blocky "E" (1 = painted)
const GLYPH_E = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 0, 0],
  [1, 1, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 0],
  [1, 1, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
];
const GLYPH_W = GLYPH_E[0].length; // 7
const GLYPH_H = GLYPH_E.length; // 9

function pixelAt(x, y, w, h) {
  // Vertical gradient background
  const t = y / h;
  const bgR = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t);
  const bgG = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t);
  const bgB = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t);

  // Rounded square mask (outer margin 6%, corner radius 22%)
  const margin = Math.round(w * 0.06);
  const radius = Math.round(w * 0.22);
  const inLeft = x >= margin && x < w - margin;
  const inTop = y >= margin && y < h - margin;
  if (!(inLeft && inTop)) return [0, 0, 0]; // transparent-ish: we output RGB only, so use black; PNG is opaque.
  // Corner rounding
  const rx = Math.min(x - margin, w - margin - 1 - x);
  const ry = Math.min(y - margin, h - margin - 1 - y);
  if (rx < radius && ry < radius) {
    const dx = radius - rx;
    const dy = radius - ry;
    if (dx * dx + dy * dy > radius * radius) return [0, 0, 0];
  }

  // Accent diagonal stripe (top-right to bottom-left)
  const diag = x + (h - y);
  const diagNorm = diag / (w + h);
  if (diagNorm > 0.78 && diagNorm < 0.88) {
    const k = (diagNorm - 0.78) / 0.1;
    return [
      Math.round(ACCENT[0] * (1 - k) + ACCENT_DARK[0] * k),
      Math.round(ACCENT[1] * (1 - k) + ACCENT_DARK[1] * k),
      Math.round(ACCENT[2] * (1 - k) + ACCENT_DARK[2] * k),
    ];
  }

  // Centered "E" glyph
  const glyphBoxW = Math.round(w * 0.55);
  const glyphBoxH = Math.round(h * 0.55);
  const cellSize = Math.min(Math.floor(glyphBoxW / GLYPH_W), Math.floor(glyphBoxH / GLYPH_H));
  const letterW = cellSize * GLYPH_W;
  const letterH = cellSize * GLYPH_H;
  const letterX = Math.floor((w - letterW) / 2);
  const letterY = Math.floor((h - letterH) / 2);
  if (x >= letterX && x < letterX + letterW && y >= letterY && y < letterY + letterH) {
    const gx = Math.floor((x - letterX) / cellSize);
    const gy = Math.floor((y - letterY) / cellSize);
    if (GLYPH_E[gy] && GLYPH_E[gy][gx]) return FG;
  }

  return [bgR, bgG, bgB];
}

function renderPng(size) {
  return makePng(size, size, (x, y) => pixelAt(x, y, size, size));
}

// ---------- ICO writer (Vista+ PNG-embedded) ----------
function makeIco(images) {
  // Header (ICONDIR): 6 bytes
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type = ICO
  dir.writeUInt16LE(images.length, 4);

  // Directory entries (ICONDIRENTRY): 16 bytes each
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((img, i) => {
    const base = 16 * i;
    entries[base + 0] = img.size >= 256 ? 0 : img.size; // width
    entries[base + 1] = img.size >= 256 ? 0 : img.size; // height
    entries[base + 2] = 0; // color count
    entries[base + 3] = 0; // reserved
    entries.writeUInt16LE(1, base + 4); // planes
    entries.writeUInt16LE(32, base + 6); // bits per pixel
    entries.writeUInt32LE(img.data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += img.data.length;
  });

  return Buffer.concat([dir, entries, ...images.map((i) => i.data)]);
}

// ---------- Emit ----------
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const MAIN_SIZE = 256;

const buildDir = path.resolve(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

console.log('[icon] rendering PNGs…');
const pngs = ICO_SIZES.map((size) => ({ size, data: renderPng(size) }));
const main = pngs.find((p) => p.size === MAIN_SIZE);

fs.writeFileSync(path.join(buildDir, 'icon.png'), main.data);
console.log(`[icon] wrote build/icon.png (${MAIN_SIZE}x${MAIN_SIZE}, ${main.data.length}B)`);

const ico = makeIco(pngs);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
console.log(`[icon] wrote build/icon.ico (${ICO_SIZES.join(',')} px, ${ico.length}B)`);
