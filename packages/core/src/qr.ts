// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * QR codes (Shapes & text, 13 Nov 2026): our own encoder, written from the public QR code rules (ISO/IEC 18004), for
 * versions 1 to 10 (21 to 57 modules a side), the four repair levels and the eight masks. Text is written in the smallest
 * mode that holds all of it: digits only, capitals and a few signs, or any text as UTF-8 bytes.
 *
 * Pure functions, no DOM; the web app loads this file on first use through `@free-photoeditor/core/qr`.
 */
import { anchorAt, type Subpath } from './path';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';
export type QrMode = 'numeric' | 'alnum' | 'byte';
export interface QrCode {
  version: number; level: QrLevel; mask: number; mode: QrMode; size: number;
  /** Dark (true) or light, row by row: `dark[y][x]`. */
  dark: boolean[][];
}

/** The two format bits of each repair level. */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
/**
 * Error correction per version (1 to 10), in the order L, M, Q, H: [repair codewords per block, blocks in group 1, data
 * codewords in each, blocks in group 2, data codewords in each]. Each version's total (data plus repair) is checked in the
 * tests against the modules left over once the fixed patterns are drawn.
 */
const BLOCKS: readonly (readonly (readonly [number, number, number, number, number])[])[] = [
  [[7, 1, 19, 0, 0], [10, 1, 16, 0, 0], [13, 1, 13, 0, 0], [17, 1, 9, 0, 0]],
  [[10, 1, 34, 0, 0], [16, 1, 28, 0, 0], [22, 1, 22, 0, 0], [28, 1, 16, 0, 0]],
  [[15, 1, 55, 0, 0], [26, 1, 44, 0, 0], [18, 2, 17, 0, 0], [22, 2, 13, 0, 0]],
  [[20, 1, 80, 0, 0], [18, 2, 32, 0, 0], [26, 2, 24, 0, 0], [16, 4, 9, 0, 0]],
  [[26, 1, 108, 0, 0], [24, 2, 43, 0, 0], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]],
  [[18, 2, 68, 0, 0], [16, 4, 27, 0, 0], [24, 4, 19, 0, 0], [28, 4, 15, 0, 0]],
  [[20, 2, 78, 0, 0], [18, 4, 31, 0, 0], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]],
  [[24, 2, 97, 0, 0], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]],
  [[30, 2, 116, 0, 0], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]],
  [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]],
];
const ORDER: readonly QrLevel[] = ['L', 'M', 'Q', 'H'];
/** Centres of the small square targets (alignment patterns) for versions 2 to 10, along each side. */
const ALIGN: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_VERSION = 10;
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** The block layout of a version and level. */
export function qrBlocks(version: number, level: QrLevel): { ec: number; data: number[] } {
  const [ec, n1, d1, n2, d2] = BLOCKS[version - 1][ORDER.indexOf(level)];
  return { ec, data: [...Array(n1).fill(d1), ...Array(n2).fill(d2)] };
}
/** Data codewords a version and level hold. */
export const qrDataCodewords = (version: number, level: QrLevel): number => qrBlocks(version, level).data.reduce((a, b) => a + b, 0);
/** Data plus repair codewords of a version. */
export function qrTotalCodewords(version: number): number { const b = qrBlocks(version, 'L'); return b.data.reduce((a, c) => a + c, 0) + b.ec * b.data.length; }

// ---- the arithmetic of the repair codewords (Reed-Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1) ----------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
/** The generator of `n` repair codewords: (x − α⁰)(x − α¹)…(x − αⁿ⁻¹), highest power first, its leading 1 left out. */
function generator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g.slice(1);
}
/** The `n` repair codewords of one block of data codewords. */
export function qrRepair(data: readonly number[], n: number): number[] {
  const g = generator(n), r = new Array<number>(n).fill(0);
  for (const b of data) {
    const f = b ^ r[0];
    r.shift(); r.push(0);
    for (let i = 0; i < n; i++) r[i] ^= mul(g[i], f);
  }
  return r;
}

// ---- the text as bits -------------------------------------------------------------------------------------------------
/** The smallest mode that holds all of the text. */
export function qrMode(text: string): QrMode {
  if (/^[0-9]*$/.test(text)) return 'numeric';
  if ([...text].every((c) => ALNUM.includes(c))) return 'alnum';
  return 'byte';
}
const countBits = (mode: QrMode, version: number): number => (mode === 'numeric' ? (version < 10 ? 10 : 12) : mode === 'alnum' ? (version < 10 ? 9 : 11) : version < 10 ? 8 : 16);
/** UTF-8 bytes of the text (the core has no DOM, so no TextEncoder). */
export function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
/** The text's bits after the mode and count (they do not depend on the version). */
function payload(text: string, mode: QrMode): { bits: number[]; count: number } {
  const bits: number[] = [], put = (v: number, n: number): void => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) { const g = text.slice(i, i + 3); put(Number(g), g.length * 3 + 1); }
    return { bits, count: text.length };
  }
  if (mode === 'alnum') {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM.indexOf(text[i]);
      if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]), 11); else put(a, 6);
    }
    return { bits, count: text.length };
  }
  const bytes = utf8(text);
  for (const b of bytes) put(b, 8);
  return { bits, count: bytes.length };
}
/** The data codewords for a version and level: mode, count, text, end mark and filler bytes; null when it does not fit. */
export function qrData(text: string, version: number, level: QrLevel, mode = qrMode(text)): number[] | null {
  const { bits: body, count } = payload(text, mode), cb = countBits(mode, version), cap = qrDataCodewords(version, level) * 8;
  if (count >= 1 << cb) return null;
  const bits: number[] = [], put = (v: number, n: number): void => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(mode === 'numeric' ? 1 : mode === 'alnum' ? 2 : 4, 4);
  put(count, cb);
  bits.push(...body);
  if (bits.length > cap) return null;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
/** Data and repair codewords in the order they are laid on the square: block by block, codeword by codeword. */
export function qrCodewords(data: readonly number[], version: number, level: QrLevel): number[] {
  const { ec, data: sizes } = qrBlocks(version, level), blocks: number[][] = [];
  let at = 0;
  for (const n of sizes) { blocks.push(data.slice(at, at + n)); at += n; }
  const repair = blocks.map((b) => qrRepair(b, ec)), out: number[] = [];
  for (let i = 0; i < Math.max(...sizes); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const r of repair) out.push(r[i]);
  return out;
}

// ---- the square ---------------------------------------------------------------------------------------------------------
/** The 15 format bits: repair level and mask, 10 check bits, then the fixed pattern 101010000010010 laid over them. */
export function qrFormatBits(level: QrLevel, mask: number): number {
  const d = (LEVEL_BITS[level] << 3) | mask;
  let r = d;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((d << 10) | (r & 0x3ff)) ^ 0x5412;
}
/** The 18 version bits (version 7 and up): the version, then 12 check bits. */
export function qrVersionBits(version: number): number {
  let r = version;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  return (version << 12) | (r & 0xfff);
}
const MASKS: readonly ((y: number, x: number) => boolean)[] = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (_y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

/** The fixed patterns of a version: which modules they take, and their colours. */
function base(version: number): { size: number; dark: boolean[][]; fixed: boolean[][] } {
  const size = 17 + 4 * version, dark = [...Array(size)].map(() => new Array<boolean>(size).fill(false)), fixed = dark.map((r) => r.slice());
  const set = (x: number, y: number, v: boolean): void => { if (x >= 0 && y >= 0 && x < size && y < size) { dark[y][x] = v; fixed[y][x] = true; } };
  // The three corner targets (finder patterns), each with a light border.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const r = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, r !== 2 && r !== 4); }
  }
  // The dotted timing lines along row 6 and column 6.
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  // The small targets, wherever they do not sit on a corner target.
  const at = ALIGN[version - 1], last = at.length - 1;
  for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(at[i] + dx, at[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Room for the format bits (filled once the mask is chosen), and the one module that is always dark.
  for (let i = 0; i < 9; i++) if (i !== 6) { set(8, i, false); set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
  set(8, size - 8, true);
  if (version >= 7) {
    const v = qrVersionBits(version);
    for (let i = 0; i < 18; i++) { const b = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
  }
  return { size, dark, fixed };
}
/** How many modules the data and repair codewords have, once the fixed patterns are drawn. */
export function qrDataModules(version: number): number { return base(version).fixed.flat().filter((f) => !f).length; }

function drawFormat(dark: boolean[][], size: number, level: QrLevel, mask: number): void {
  const f = qrFormatBits(level, mask), bit = (i: number): boolean => ((f >>> i) & 1) === 1;
  // First copy, round the top-left corner target: up column 8 for bits 0 to 8, then left along row 8.
  for (let i = 0; i <= 5; i++) dark[i][8] = bit(i);
  dark[7][8] = bit(6); dark[8][8] = bit(7); dark[8][7] = bit(8);
  for (let i = 9; i < 15; i++) dark[8][14 - i] = bit(i);
  // Second copy: along row 8 at the top right, then down column 8 at the bottom left.
  for (let i = 0; i < 8; i++) dark[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) dark[size - 15 + i][8] = bit(i);
}

/** The penalty of a finished square: long runs, 2 × 2 blocks, corner-target look-alikes, and too much dark or light. */
export function qrPenalty(dark: readonly (readonly boolean[])[]): number {
  const n = dark.length;
  let score = 0, black = 0;
  const line = (get: (i: number) => boolean): void => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) score += 3 + run - 5;
      run = 1;
    }
    // 1:1:3:1:1 dark-light-dark-light-dark with four light modules on one side (outside the square counts as light).
    const at = (i: number): boolean => i >= 0 && i < n && get(i);
    for (let i = -4; i < n; i++) {
      if (!(at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6))) continue;
      const before = !at(i - 1) && !at(i - 2) && !at(i - 3) && !at(i - 4), after = !at(i + 7) && !at(i + 8) && !at(i + 9) && !at(i + 10);
      if (before) score += 40;
      if (after) score += 40;
    }
  };
  for (let y = 0; y < n; y++) line((x) => dark[y][x]);
  for (let x = 0; x < n; x++) line((y) => dark[y][x]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (dark[y][x]) black++;
    if (y + 1 < n && x + 1 < n) { const c = dark[y][x]; if (dark[y][x + 1] === c && dark[y + 1][x] === c && dark[y + 1][x + 1] === c) score += 3; }
  }
  score += 10 * Math.floor(Math.abs((black * 100) / (n * n) - 50) / 5);
  return score;
}

/**
 * The QR code of `text` at a repair level, in the smallest version from `minVersion` up that holds it. The mask is the one
 * with the lowest penalty unless `mask` (0 to 7) is given. Null when the text is empty or too long for version 10.
 */
export function qrEncode(text: string, level: QrLevel = 'M', mask = -1, minVersion = 1): QrCode | null {
  if (!text) return null;
  const mode = qrMode(text);
  for (let version = Math.max(1, minVersion); version <= QR_MAX_VERSION; version++) {
    const data = qrData(text, version, level, mode);
    if (!data) continue;
    const words = qrCodewords(data, version, level), { size, dark, fixed } = base(version);
    // Lay the bits two columns at a time from the right, up then down, skipping the timing column and the fixed modules.
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const up = ((right + 1) & 2) === 0;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = up ? size - 1 - v : v;
        if (fixed[y][x]) continue;
        dark[y][x] = k < words.length * 8 && ((words[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
    const masked = (m: number): boolean[][] => {
      const out = dark.map((r) => r.slice()), f = MASKS[m];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && f(y, x)) out[y][x] = !out[y][x];
      drawFormat(out, size, level, m);
      return out;
    };
    let best = mask >= 0 && mask < 8 ? mask : 0, grid = masked(best);
    if (!(mask >= 0 && mask < 8)) {
      let low = qrPenalty(grid);
      for (let m = 1; m < 8; m++) { const g = masked(m), p = qrPenalty(g); if (p < low) { low = p; best = m; grid = g; } }
    }
    return { version, level, mask: best, mode, size, dark: grid };
  }
  return null;
}

/**
 * The code as one outline: each run of dark modules along a row is one rectangle, `module` picture pixels a side, with
 * its top-left module at (x, y). Filled, it is the code; the quiet border round it is not part of the outline.
 */
export function qrSubpaths(code: QrCode, x: number, y: number, module: number): Subpath[] {
  const out: Subpath[] = [];
  for (let r = 0; r < code.size; r++) {
    let c = 0;
    while (c < code.size) {
      if (!code.dark[r][c]) { c++; continue; }
      const c0 = c;
      while (c < code.size && code.dark[r][c]) c++;
      const x0 = x + c0 * module, x1 = x + c * module, y0 = y + r * module, y1 = y0 + module;
      out.push({ closed: true, anchors: [anchorAt(x0, y0), anchorAt(x1, y0), anchorAt(x1, y1), anchorAt(x0, y1)] });
    }
  }
  return out;
}

/** The code as RGBA pixels with a light border `quiet` modules wide (4 is what scanners expect). */
export function qrPixels(code: QrCode, module: number, quiet: number, dark: readonly number[], light: readonly number[]): { width: number; data: Uint8ClampedArray } {
  const width = (code.size + 2 * quiet) * module, data = new Uint8ClampedArray(width * width * 4);
  for (let py = 0; py < width; py++) {
    const r = Math.floor(py / module) - quiet;
    for (let px = 0; px < width; px++) {
      const c = Math.floor(px / module) - quiet, on = r >= 0 && c >= 0 && r < code.size && c < code.size && code.dark[r][c], col = on ? dark : light, i = (py * width + px) * 4;
      data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = col[3] ?? 255;
    }
  }
  return { width, data };
}
