// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The third filters wave (13 Nov 2026). Each kind is one row of the function map and builds every look its name lists:
 * traced outline and relief; halftone dots and engraved lines; dents and mirror tiles; cartoon, photocopy, cubist squares
 * and glass blocks; ink and pencil drawing; lino print and leaded glass; six generated patterns; the stroke blur and the
 * wrap-around blur. Every read stays inside the edited box, so none needs a reach. All maths here is written for this project.
 */
import type { Bitmap } from '../document';
import { clamp, extremePlane, fbm, hash, luma, num, premul, rgbOf, warp, type Box, type Fx, type P } from './lib';
import type { FxKind } from './meta';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const each = (b: Box, f: (x: number, y: number) => void): void => {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) f(x, y);
};
/** Which look of the row is picked (the `look` setting, 0 to n - 1). */
const look = (p: P, n: number): number => clamp(Math.round(num(p, 'look', 0)), 0, n - 1);
const int = (p: P, k: string, d: number, lo: number, hi: number): number => clamp(Math.round(num(p, k, d)), lo, hi);
/** The box's brightness times opacity, row by row, and a reader that repeats the box edge, so nothing outside is read. */
function lum(src: Bitmap, b: Box): { L: Float32Array; at: (x: number, y: number) => number } {
  const W = src.width, d = src.data, L = new Float32Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = ((b.y + y) * W + b.x + x) * 4;
    L[y * b.w + x] = (luma(d[i], d[i + 1], d[i + 2]) * d[i + 3]) / 255;
  }
  return { L, at: (x, y) => L[clamp(y, 0, b.h - 1) * b.w + clamp(x, 0, b.w - 1)] };
}
/** Mean of a plane over the (2r + 1) square round each point, the square cut to the box (a summed-area table: any r costs the same). */
function boxMean(f: Float32Array, w: number, h: number, r: number): Float32Array {
  const S = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += f[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}
/** Ink of the edges, 0 to 1: the brightness slope (Sobel, divided by 4) times `k`, full at 128; widened by `width` - 1 px. */
function inkLines(src: Bitmap, b: Box, k: number, width: number): Float32Array {
  const { at } = lum(src, b), e = new Float32Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    e[y * b.w + x] = Math.min(1, (Math.hypot(gx, gy) / 4) * k / 128);
  }
  return width > 1 ? extremePlane(e, b.w, b.h, width - 1, true) : e;
}
/** For tiles of size `t` laid from the box's corner: the tile's centre, with a cut tile at the far edge centred on what is left. */
const tileCentre = (v: number, o: number, len: number, t: number): number => { const s = o + Math.floor((v - o) / t) * t; return s + (Math.min(t, o + len - s) - 1) / 2; };

// ---------- lines ----------
/** Traced outline (dark lines along the edges over the picture) or relief (the edges raised and sunk, colours kept). */
const outline: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), k = clamp(num(p, 'amount', 100), 10, 400) / 100;
  if (look(p, 2) === 1) {
    const { at } = lum(src, b), a = num(p, 'angle', 135) * DEG, hh = int(p, 'height', 2, 1, 10), ox = Math.round(Math.cos(a) * hh), oy = Math.round(-Math.sin(a) * hh);
    each(b, (x, y) => {
      const lx = x - b.x, ly = y - b.y, dl = (at(lx + ox, ly + oy) - at(lx - ox, ly - oy)) * k, i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = d[i + c] + dl;
    });
    return out;
  }
  const t = inkLines(src, b, k, int(p, 'width', 1, 1, 10));
  each(b, (x, y) => { const i = (y * W + x) * 4, f = 1 - t[(y - b.y) * b.w + x - b.x]; for (let c = 0; c < 3; c++) out[i + c] = d[i + c] * f; });
  return out;
};
/** Ink drawing (ink lines over paler colour) or pencil drawing (grey lines from the dark details, on white paper). */
const sketch: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice();
  if (look(p, 2) === 1) {
    const { L } = lum(src, b), inv = new Float32Array(L.length), dark = clamp(num(p, 'dark', 100), 10, 300) / 100;
    for (let j = 0; j < L.length; j++) inv[j] = 255 - L[j];
    const soft = boxMean(inv, b.w, b.h, int(p, 'size', 4, 1, 100));
    each(b, (x, y) => {
      const j = (y - b.y) * b.w + x - b.x, s = soft[j], v = s >= 254.5 ? 255 : Math.min(255, (L[j] * 255) / (255 - s)), i = (y * W + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255 - (255 - v) * dark;
    });
    return out;
  }
  const t = inkLines(src, b, clamp(num(p, 'amount', 100), 10, 400) / 100, int(p, 'width', 1, 1, 10)), col = clamp(num(p, 'color', 50), 0, 100) / 100;
  each(b, (x, y) => {
    const i = (y * W + x) * 4, f = 1 - t[(y - b.y) * b.w + x - b.x];
    for (let c = 0; c < 3; c++) out[i + c] = (255 - (255 - d[i + c]) * col) * f;
  });
  return out;
};

// ---------- print ----------
/** Newsprint: one black ink screen of round dots (bigger where darker) or engraved lines (thicker where darker), on white. */
const newsprint: Fx = (src, p, b) => {
  const W = src.width, out = src.data.slice(), { at } = lum(src, b), s = clamp(num(p, 'size', 8), 2, 64), a = num(p, 'angle', 45) * DEG;
  const cs = Math.cos(a), sn = Math.sin(a), lines = look(p, 2) === 1;
  each(b, (x, y) => {
    const lx = x - b.x + 0.5, ly = y - b.y + 0.5, u = lx * cs + ly * sn, v = -lx * sn + ly * cs;
    let D: number, cover: number;
    if (lines) {
      D = 1 - at(x - b.x, y - b.y) / 255;
      const m = v - Math.floor(v / s) * s;
      cover = clamp((s * D) / 2 - Math.abs(m - s / 2) + 0.5, 0, 1);
    } else {
      const cu = (Math.floor(u / s) + 0.5) * s, cv = (Math.floor(v / s) + 0.5) * s;
      D = 1 - at(Math.floor(cu * cs - cv * sn), Math.floor(cu * sn + cv * cs)) / 255;
      cover = clamp(s * 0.7072 * Math.sqrt(Math.max(0, D)) - Math.hypot(u - cu, v - cv) + 0.5, 0, 1);
    }
    if (D <= 0.002) cover = 0; else if (D >= 0.998) cover = 1;
    const i = (y * W + x) * 4;
    out[i] = out[i + 1] = out[i + 2] = 255 * (1 - cover);
  });
  return out;
};
/** Lino print (black where the smoothed picture is dark, with white carved lines) or leaded glass (flat pieces, dark lead between). */
const linocut: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice();
  if (look(p, 2) === 1) {
    const s = clamp(num(p, 'cell', 24), 6, 400), lead = clamp(num(p, 'lead', 2), 0, 20), sd = num(p, 'seed', 1), nx = Math.ceil(b.w / s) + 1, ny = Math.ceil(b.h / s) + 1;
    const sx = new Float32Array(nx * ny), sy = new Float32Array(nx * ny), col = new Uint8ClampedArray(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      sx[k] = (i + 0.15 + 0.7 * hash(i, j, sd)) * s; sy[k] = (j + 0.15 + 0.7 * hash(i, j, sd + 1)) * s;
      const q = ((b.y + clamp(Math.floor(sy[k]), 0, b.h - 1)) * W + b.x + clamp(Math.floor(sx[k]), 0, b.w - 1)) * 4;
      col[k * 3] = d[q]; col[k * 3 + 1] = d[q + 1]; col[k * 3 + 2] = d[q + 2];
    }
    each(b, (x, y) => {
      const lx = x - b.x + 0.5, ly = y - b.y + 0.5, ci = Math.floor(lx / s), cj = Math.floor(ly / s);
      let d1 = Infinity, d2 = Infinity, k1 = 0;
      for (let j = Math.max(0, cj - 2); j <= Math.min(ny - 1, cj + 2); j++) for (let i = Math.max(0, ci - 2); i <= Math.min(nx - 1, ci + 2); i++) {
        const k = j * nx + i, dd = Math.hypot(lx - sx[k], ly - sy[k]);
        if (dd < d1) { d2 = d1; d1 = dd; k1 = k; } else if (dd < d2) d2 = dd;
      }
      const o = (y * W + x) * 4, isLead = d2 - d1 < lead;
      for (let c = 0; c < 3; c++) out[o + c] = isLead ? 0 : col[k1 * 3 + c];
    });
    return out;
  }
  const { L } = lum(src, b), sm = boxMean(L, b.w, b.h, int(p, 'smooth', 1, 0, 50)), T = clamp(num(p, 'level', 128), 1, 254);
  const gouge = num(p, 'gouges', 1) > 0, per = int(p, 'spacing', 6, 3, 40);
  each(b, (x, y) => {
    const v = sm[(y - b.y) * b.w + x - b.x], i = (y * W + x) * 4;
    const ink = v < T && !(gouge && ((y - b.y) % per) < (per / 2) * (v / T));
    out[i] = out[i + 1] = out[i + 2] = ink ? 0 : 255;
  });
  return out;
};

// ---------- graphic looks ----------
/** Cartoon (flat colour steps and black lines), photocopy (only the dark details print), cubist squares, or glass blocks. */
const cartoon: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), m = look(p, 4), t = clamp(num(p, 'tile', 16), 2, 400), sd = num(p, 'seed', 1);
  if (m === 3) {
    const k = 1 + clamp(num(p, 'amount', 50), 0, 100) / 100;
    return warp(src, b, (x, y, o) => {
      const cx = tileCentre(x, b.x, b.w, t), cy = tileCentre(y, b.y, b.h, t);
      o[0] = cx + (x - cx) * k; o[1] = cy + (y - cy) * k;
    });
  }
  if (m === 2) {
    const [br, bgr, bb] = rgbOf(num(p, 'bg', 0)), nx = Math.ceil(b.w / t), ny = Math.ceil(b.h / t), n = nx * ny;
    const cx = new Float32Array(n), cy = new Float32Array(n), half = new Float32Array(n), co = new Float32Array(n), si = new Float32Array(n), pr = new Float32Array(n), col = new Uint8ClampedArray(n * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, a = hash(i, j, sd + 3) * (Math.PI / 2);
      cx[k] = (i + 0.5 + (hash(i, j, sd) - 0.5) * 0.5) * t; cy[k] = (j + 0.5 + (hash(i, j, sd + 1) - 0.5) * 0.5) * t;
      half[k] = t * (0.35 + 0.25 * hash(i, j, sd + 2)); co[k] = Math.cos(a); si[k] = Math.sin(a); pr[k] = hash(i, j, sd + 4);
      const q = ((b.y + clamp(Math.floor(cy[k]), 0, b.h - 1)) * W + b.x + clamp(Math.floor(cx[k]), 0, b.w - 1)) * 4;
      col[k * 3] = d[q]; col[k * 3 + 1] = d[q + 1]; col[k * 3 + 2] = d[q + 2];
    }
    each(b, (x, y) => {
      const lx = x - b.x + 0.5, ly = y - b.y + 0.5, ci = Math.floor(lx / t), cj = Math.floor(ly / t), o = (y * W + x) * 4;
      let best = -1, top = -1;
      for (let j = Math.max(0, cj - 1); j <= Math.min(ny - 1, cj + 1); j++) for (let i = Math.max(0, ci - 1); i <= Math.min(nx - 1, ci + 1); i++) {
        const k = j * nx + i, dx = lx - cx[k], dy = ly - cy[k];
        if (pr[k] > top && Math.abs(dx * co[k] + dy * si[k]) <= half[k] && Math.abs(-dx * si[k] + dy * co[k]) <= half[k]) { top = pr[k]; best = k; }
      }
      if (best < 0) { out[o] = br; out[o + 1] = bgr; out[o + 2] = bb; } else for (let c = 0; c < 3; c++) out[o + c] = col[best * 3 + c];
    });
    return out;
  }
  const { L } = lum(src, b), avg = boxMean(L, b.w, b.h, int(p, 'size', 6, 1, 100)), thr = 1 - clamp(num(p, 'edge', 10), 1, 90) / 100;
  const q = 255 / (int(p, 'levels', 4, 2, 16) - 1);
  each(b, (x, y) => {
    const j = (y - b.y) * b.w + x - b.x, i = (y * W + x) * 4, line = L[j] < avg[j] * thr;
    for (let c = 0; c < 3; c++) out[i + c] = line ? 0 : m === 1 ? 255 : Math.round(d[i + c] / q) * q;
  });
  return out;
};
/** Dents (the picture pushed about by smooth noise, like dented glass) or mirror tiles (each square tile mirrors its own part). */
const dents: Fx = (src, p, b) => {
  const s = clamp(num(p, 'size', 40), 2, 400);
  if (look(p, 2) === 1) {
    const f = int(p, 'flip', 0, 0, 2);
    return warp(src, b, (x, y, o) => {
      o[0] = f === 2 ? x : 2 * tileCentre(x, b.x, b.w, s) - x;
      o[1] = f === 1 ? y : 2 * tileCentre(y, b.y, b.h, s) - y;
    });
  }
  const amt = clamp(num(p, 'amount', 8), 0, 100), sd = num(p, 'seed', 1);
  return warp(src, b, (x, y, o) => {
    const u = (x - b.x) / s, v = (y - b.y) / s;
    o[0] = x + (fbm(u, v, 3, sd) - 0.5) * 2 * amt;
    o[1] = y + (fbm(u + 5.2, v + 1.3, 3, sd + 9) - 0.5) * 2 * amt;
  });
};

// ---------- patterns ----------
/** A perfect maze on nx by ny cells (one path between any two): bit 1 opens a cell to the west, bit 2 to the north. */
function maze(nx: number, ny: number, sd: number): Uint8Array {
  const open = new Uint8Array(nx * ny), seen = new Uint8Array(nx * ny), stack = [0], nb: number[] = [];
  seen[0] = 1;
  for (let step = 0; stack.length; step++) {
    const k = stack[stack.length - 1], x = k % nx, y = (k - x) / nx;
    nb.length = 0;
    if (x > 0 && !seen[k - 1]) nb.push(k - 1);
    if (x < nx - 1 && !seen[k + 1]) nb.push(k + 1);
    if (y > 0 && !seen[k - nx]) nb.push(k - nx);
    if (y < ny - 1 && !seen[k + nx]) nb.push(k + nx);
    if (!nb.length) { stack.pop(); continue; }
    const n = nb[Math.floor(hash(k, step, sd) * nb.length)];
    seen[n] = 1;
    stack.push(n);
    if (n === k - 1) open[k] |= 1; else if (n === k + 1) open[n] |= 1; else if (n === k - nx) open[k] |= 2; else open[n] |= 2;
  }
  return open;
}
/** Patterns in the main colour over the second colour: grid, checkerboard, maze, spiral, sine waves, jigsaw. Fills the area. */
const patterns: Fx = (src, p, b) => {
  const W = src.width, out = src.data.slice(), m = look(p, 6), s = clamp(num(p, 'size', 24), 2, 400), wd = int(p, 'width', 2, 1, 100), sd = num(p, 'seed', 1);
  const F = rgbOf(num(p, 'fg', 0)), B = rgbOf(num(p, 'bg', 0xffffff));
  const cs = Math.max(2, Math.round(s)), mw = Math.min(wd, cs - 1), nx = Math.max(1, Math.floor((b.w - mw) / cs)), ny = Math.max(1, Math.floor((b.h - mw) / cs));
  const open = m === 2 ? maze(nx, ny, sd) : null, cx = (b.w - 1) / 2, cy = (b.h - 1) / 2, r = s * 0.2;
  const piece = (x: number, y: number): number => {
    const i = Math.floor(x / s), j = Math.floor(y / s);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ei = di < 0 ? i - 1 : i, ej = dj < 0 ? j - 1 : j, vert = di !== 0, dir = hash(ei, ej, sd + (vert ? 0 : 7)) < 0.5 ? 1 : -1;
      const tx = vert ? (ei + 1) * s + dir * r * 0.8 : (ei + 0.5) * s, ty = vert ? (ej + 0.5) * s : (ej + 1) * s + dir * r * 0.8;
      if ((x - tx) ** 2 + (y - ty) ** 2 > r * r) continue;
      const oi = dir > 0 || !vert ? ei : ei + 1, oj = dir > 0 || vert ? ej : ej + 1;
      if (oi !== i || oj !== j) return oi * 65537 + oj;
    }
    return i * 65537 + j;
  };
  each(b, (x, y) => {
    const lx = x - b.x, ly = y - b.y;
    let v: number;
    if (m === 0) v = lx % s < wd || ly % s < wd ? 1 : 0;
    else if (m === 1) v = (Math.floor(lx / s) + Math.floor(ly / s)) & 1;
    else if (m === 2) {
      const ci = Math.floor(lx / cs), cj = Math.floor(ly / cs), u = lx - ci * cs, w = ly - cj * cs, k = cj * nx + ci;
      v = ci >= nx || cj >= ny || (u < mw && w < mw) || (u < mw && !((open as Uint8Array)[k] & 1)) || (w < mw && !((open as Uint8Array)[k] & 2)) ? 1 : 0;
    } else if (m === 3) { const t = Math.atan2(ly - cy, lx - cx) / TAU + Math.hypot(lx - cx, ly - cy) / s; v = t - Math.floor(t) < 0.5 ? 1 : 0; }
    else if (m === 4) v = 0.5 + 0.25 * (Math.sin((TAU * lx) / s) + Math.sin((TAU * ly) / s));
    else {
      const px = lx + 0.5, py = ly + 0.5, me = piece(px, py);
      v = 0;
      for (let q = 1; q <= wd && !v; q++) if (piece(px + q, py) !== me || piece(px, py + q) !== me) v = 1;
    }
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = B[c] + (F[c] - B[c]) * v;
    out[i + 3] = 255;
  });
  return out;
};

// ---------- blurs ----------
/** Stroke blur: each colour becomes the middle value along a short brush stroke through the pixel, so it looks painted. */
const strokeBlur: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), len = int(p, 'length', 6, 1, 40), a = num(p, 'angle', 45) * DEG, jit = clamp(num(p, 'jitter', 20), 0, 90) * DEG;
  const sd = num(p, 'seed', 1), buf = [0, 1, 2].map(() => new Float32Array(2 * len + 1));
  each(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) return;
    const t = a + (hash(x, y, sd) - 0.5) * 2 * jit, dx = Math.cos(t), dy = -Math.sin(t);
    let m = 0;
    for (let k = -len; k <= len; k++) {
      const j = (clamp(Math.round(y + k * dy), b.y, b.y + b.h - 1) * W + clamp(Math.round(x + k * dx), b.x, b.x + b.w - 1)) * 4;
      if (!d[j + 3]) continue;
      buf[0][m] = d[j]; buf[1][m] = d[j + 1]; buf[2][m] = d[j + 2]; m++;
    }
    for (let c = 0; c < 3; c++) out[i + c] = buf[c].subarray(0, m).sort()[m >> 1];
  });
  return out;
};
/** Wrap-around blur: a box blur that treats the area as a tile, so the left edge blends with the right and the top with the bottom. */
const wrapBlur: Fx = (src, p, b) => {
  const W = src.width, pm = premul(src), out = src.data.slice(), r = int(p, 'radius', 8, 1, 200), edge = clamp(num(p, 'edges', 32), 0, 1000), n = b.w * b.h;
  const pl = [0, 1, 2, 3].map((c) => { const f = new Float32Array(n); for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) f[y * b.w + x] = pm[((b.y + y) * W + b.x + x) * 4 + c]; return f; });
  const tmp = new Float32Array(Math.max(b.w, b.h)), mod = (v: number, len: number): number => ((v % len) + len) % len;
  const pass = (f: Float32Array, len: number, count: number, step: number, lineStep: number): void => {
    for (let l = 0; l < count; l++) {
      const o = l * lineStep;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += f[o + mod(k, len) * step];
      for (let i = 0; i < len; i++) { tmp[i] = acc / (2 * r + 1); acc += f[o + mod(i + r + 1, len) * step] - f[o + mod(i - r, len) * step]; }
      for (let i = 0; i < len; i++) f[o + i * step] = tmp[i];
    }
  };
  for (const f of pl) { pass(f, b.w, b.h, 1, b.w); pass(f, b.h, b.w, b.w, 1); }
  each(b, (x, y) => {
    const lx = x - b.x, ly = y - b.y, j = ly * b.w + lx, i = (y * W + x) * 4, dist = Math.min(lx, b.w - 1 - lx, ly, b.h - 1 - ly);
    const k = edge > 0 ? clamp(1 - dist / edge, 0, 1) : 1, A = pm[i + 3] + (pl[3][j] - pm[i + 3]) * k;
    if (!(A > 0.5)) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; return; }
    for (let c = 0; c < 3; c++) out[i + c] = ((pm[i + c] + (pl[c][j] - pm[i + c]) * k) * 255) / A;
    out[i + 3] = A;
  });
  return out;
};

export const MORE3 = {
  outline, sketch, newsprint, linocut, cartoon, dents, patterns, 'stroke-blur': strokeBlur, 'wrap-blur': wrapBlur,
} satisfies Partial<Record<FxKind, Fx>>;
