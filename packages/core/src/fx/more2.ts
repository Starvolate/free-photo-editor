// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The second filters wave (13 Nov 2026): kaleidoscope, weird colour shift, glow around lights, edge detectors, fix
 * interlace lines, remove stripes, old TV look, night eye, bump and normal maps, star burst, edge-keeping blur and smooth
 * jagged edges. Every read stays inside the edited box, so none needs a reach. All maths here is written for this project.
 */
import type { Bitmap } from '../document';
import { blurPlane, clamp, luma, makeSampler, num, premul, warp, type Box, type Fx, type P } from './lib';
import type { FxKind } from './meta';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const each = (b: Box, f: (x: number, y: number) => void): void => {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) f(x, y);
};
/** A point inside the box from two percentage settings (0 is the left or top edge). */
const spot = (b: Box, p: P, dx: number, dy: number): [number, number] =>
  [b.x + (clamp(num(p, 'x', dx), 0, 100) / 100) * (b.w - 1), b.y + (clamp(num(p, 'y', dy), 0, 100) / 100) * (b.h - 1)];
/** Writes the average of `n` premultiplied samples back as straight colour; a see-through result is (0, 0, 0, 0). */
function put(res: Uint8ClampedArray, i: number, acc: ArrayLike<number>, n = 1): void {
  if (!(acc[3] / n > 0.5)) { res[i] = res[i + 1] = res[i + 2] = res[i + 3] = 0; return; }
  const k = 255 / acc[3];
  res[i] = acc[0] * k; res[i + 1] = acc[1] * k; res[i + 2] = acc[2] * k; res[i + 3] = acc[3] / n;
}
/** The box's own pixels as planes, row by row: colour times opacity, opacity, and brightness times opacity. */
interface Planes { w: number; h: number; c: Float32Array[]; a: Float32Array; L: Float32Array; at: (x: number, y: number) => number; }
function planes(src: Bitmap, b: Box): Planes {
  const W = src.width, d = src.data, n = b.w * b.h, c = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], a = new Float32Array(n), L = new Float32Array(n);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = ((b.y + y) * W + b.x + x) * 4, j = y * b.w + x, k = d[i + 3] / 255;
    c[0][j] = d[i] * k; c[1][j] = d[i + 1] * k; c[2][j] = d[i + 2] * k; a[j] = d[i + 3]; L[j] = luma(d[i], d[i + 1], d[i + 2]) * k;
  }
  /** Brightness at a box position; past the box edge the edge repeats, so nothing outside the box is read. */
  const at = (x: number, y: number): number => L[(y < 0 ? 0 : y >= b.h ? b.h - 1 : y) * b.w + (x < 0 ? 0 : x >= b.w ? b.w - 1 : x)];
  return { w: b.w, h: b.h, c, a, L, at };
}
/** Brightness slopes across (gx) and down (gy) at a box position, with the 1-2-1 weights (Sobel), not yet scaled. */
const slopes = (at: Planes['at'], x: number, y: number, c = 2): [number, number] => [
  at(x + 1, y - 1) + c * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - c * at(x - 1, y) - at(x - 1, y + 1),
  at(x - 1, y + 1) + c * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - c * at(x, y - 1) - at(x + 1, y - 1),
];

// ---------- bend ----------
/** Kaleidoscope: one slice of the picture and its mirror image, repeated round the centre. */
const kaleidoscope: Fx = (src, p, b) => {
  const seg = TAU / (2 * clamp(Math.round(num(p, 'repeats', 3)), 1, 12)), turn = num(p, 'turn', 0) * DEG, [cx, cy] = spot(b, p, 50, 50);
  return warp(src, b, (x, y, o) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    let t = Math.atan2(dy, dx) - turn;
    t -= Math.floor(t / TAU) * TAU;
    const k = Math.floor(t / seg);
    let u = t - k * seg;
    if (k % 2 === 1) u = seg - u;
    o[0] = cx + r * Math.cos(u + turn); o[1] = cy + r * Math.sin(u + turn);
  });
};

// ---------- colour ----------
/** Weird colour shift: each colour swings between dark and bright as the pixel gets lighter, each from its own start. */
const alienMap: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), f = (clamp(Math.round(num(p, 'cycles', 3)), 1, 10) * Math.PI) / 255;
  const ph = [num(p, 'red', 0) * DEG, num(p, 'green', 120) * DEG, num(p, 'blue', 240) * DEG];
  each(b, (x, y) => {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = 127.5 + 127.5 * Math.sin(d[i + c] * f + ph[c]);
  });
  return out;
};
/** Night eye: colour fades towards what the eye's dark-adapted cells see (best at blue-green), cooler and dimmer. */
const lowlight: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), m = clamp(num(p, 'dark', 70), 0, 100) / 100, blue = clamp(num(p, 'blue', 50), 0, 100) / 100;
  const tint = [1 - 0.25 * blue, 1 - 0.1 * blue, 1 + 0.25 * blue], dim = 1 - 0.5 * m;
  each(b, (x, y) => {
    const i = (y * W + x) * 4, V = 0.05 * d[i] + 0.45 * d[i + 1] + 0.5 * d[i + 2];
    for (let c = 0; c < 3; c++) out[i + c] = (d[i + c] * (1 - m) + V * tint[c] * m) * dim;
  });
  return out;
};
/** Old TV: colour stripes or dots (each cell keeps one colour, brighter) or dark scan lines. */
const videoDegrade: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), kind = clamp(Math.round(num(p, 'pattern', 0)), 0, 2), size = clamp(Math.round(num(p, 'size', 2)), 1, 16);
  const s = clamp(num(p, 'strength', 60), 0, 100) / 100;
  each(b, (x, y) => {
    const X = Math.floor((x - b.x) / size), Y = Math.floor((y - b.y) / size), i = (y * W + x) * 4;
    if (kind === 2) { if (Y % 2 === 1) for (let c = 0; c < 3; c++) out[i + c] = d[i + c] * (1 - s); return; }
    const on = (X + (kind === 1 ? Y : 0)) % 3;
    for (let c = 0; c < 3; c++) out[i + c] = d[i + c] * (c === on ? 1 + 0.5 * s : 1 - s);
  });
  return out;
};

// ---------- light ----------
/** Glow around lights: the parts brighter than the threshold are blurred and laid back over the picture as light. */
const bloom: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), P = planes(src, b), thr = clamp(num(p, 'threshold', 170), 0, 254);
  const sigma = clamp(num(p, 'size', 12), 1, 200) / 2, k = clamp(num(p, 'strength', 80), 0, 300) / 100;
  const glow = P.c.map((ch) => {
    const g = new Float32Array(ch.length);
    for (let j = 0; j < ch.length; j++) g[j] = ch[j] * clamp((P.L[j] - thr) / (255 - thr), 0, 1);
    return blurPlane(g, P.w, P.h, sigma);
  });
  each(b, (x, y) => {
    const i = (y * W + x) * 4, j = (y - b.y) * P.w + x - b.x;
    for (let c = 0; c < 3; c++) out[i + c] = 255 - ((255 - d[i + c]) * (255 - Math.min(255, glow[c][j] * k))) / 255;
  });
  return out;
};
/** Star burst: stars with rays on the brightest points of the area (at most one per small cell), added as light. */
const starBurst: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), P = planes(src, b), { w, h, L } = P;
  const top = clamp(num(p, 'top', 15), 1, 100) / 100, most = clamp(Math.round(num(p, 'count', 12)), 1, 50), rays = [4, 6, 8][clamp(Math.round(num(p, 'rays', 0)), 0, 2)];
  const len = Math.max(2, (clamp(num(p, 'length', 10), 1, 100) / 100) * Math.hypot(w, h)), k = clamp(num(p, 'bright', 100), 10, 300) / 100, rot = num(p, 'turn', 0) * DEG;
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < L.length; j++) { if (L[j] < lo) lo = L[j]; if (L[j] > hi) hi = L[j]; }
  if (!(hi > 0)) return out;
  const thr = hi - (hi - lo) * top, cell = Math.max(4, Math.round(Math.min(w, h) / 8)), stars: { x: number; y: number; v: number }[] = [];
  for (let cy = 0; cy < h; cy += cell) for (let cx = 0; cx < w; cx += cell) {
    let best = -1, bx = 0, by = 0;
    for (let y = cy; y < Math.min(h, cy + cell); y++) for (let x = cx; x < Math.min(w, cx + cell); x++) if (L[y * w + x] > best) { best = L[y * w + x]; bx = x; by = y; }
    if (best >= thr) stars.push({ x: bx, y: by, v: best });
  }
  stars.sort((s, t) => t.v - s.v);
  const add = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)], R = Math.ceil(len * 4), core = Math.max(1.5, len * 0.06);
  for (const s of stars.slice(0, most)) {
    const j0 = s.y * w + s.x, a = P.a[j0] / 255 || 1, col = [0, 1, 2].map((c) => P.c[c][j0] / a), m = Math.max(1, ...col);
    const tint = col.map((v) => 0.5 + (0.5 * v) / m), str = (s.v / 255) * k * 255;
    for (let y = Math.max(0, s.y - R); y <= Math.min(h - 1, s.y + R); y++) for (let x = Math.max(0, s.x - R); x <= Math.min(w - 1, s.x + R); x++) {
      const dx = x - s.x, dy = y - s.y, r = Math.hypot(dx, dy);
      if (r > R) continue;
      const ray = Math.abs(Math.cos(((Math.atan2(dy, dx) - rot) * rays) / 2)) ** 40, I = (ray * 0.9 * Math.exp(-r / len) + Math.exp(-((r / core) ** 2))) * str;
      if (I < 0.01) continue;
      for (let c = 0; c < 3; c++) add[c][y * w + x] += I * tint[c];
    }
  }
  each(b, (x, y) => {
    const i = (y * W + x) * 4, j = (y - b.y) * w + x - b.x;
    for (let c = 0; c < 3; c++) out[i + c] = 255 - ((255 - d[i + c]) * (255 - Math.min(255, add[c][j]))) / 255;
  });
  return out;
};
/** Bump map: light areas stand up; shows them lit from one side, or writes a normal map (green points up). */
const bumpMap: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), { at } = planes(src, b), mode = num(p, 'mode', 0) > 0 ? 1 : 0;
  const depth = clamp(num(p, 'depth', 20), 1, 100) / 10, ang = num(p, 'angle', 135) * DEG, lz = Math.SQRT1_2, lx = Math.cos(ang) * lz, ly = -Math.sin(ang) * lz;
  each(b, (X, Y) => {
    const x = X - b.x, y = Y - b.y, gx = ((at(x + 1, y) - at(x - 1, y)) / 510) * depth, gy = ((at(x, y + 1) - at(x, y - 1)) / 510) * depth;
    const nl = Math.hypot(gx, gy, 1), nx = -gx / nl, ny = -gy / nl, nz = 1 / nl, i = (Y * W + X) * 4;
    if (mode === 1) { out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (-ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; return; }
    const f = Math.max(0, nx * lx + ny * ly + nz * lz) / lz;
    for (let c = 0; c < 3; c++) out[i + c] = d[i + c] * f;
  });
  return out;
};

// ---------- lines ----------
/** Edge detectors: grey lines where brightness changes, by four classic methods; optionally dark lines on white. */
const edgeDetect: Fx = (src, p, b) => {
  const W = src.width, out = src.data.slice(), { at } = planes(src, b), m = clamp(Math.round(num(p, 'method', 0)), 0, 3);
  const k = clamp(num(p, 'amount', 100), 10, 400) / 100, dark = num(p, 'dark', 0) > 0;
  each(b, (X, Y) => {
    const x = X - b.x, y = Y - b.y;
    let e: number;
    if (m <= 1) { const [gx, gy] = slopes(at, x, y, m === 0 ? 2 : 1); e = Math.hypot(gx, gy) / (m === 0 ? 4 : 3); }
    else if (m === 2) e = Math.hypot(at(x, y) - at(x + 1, y + 1), at(x + 1, y) - at(x, y + 1)) / Math.SQRT2;
    else e = Math.abs(4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1));
    const v = Math.min(255, e * k), i = (Y * W + X) * 4;
    out[i] = out[i + 1] = out[i + 2] = dark ? 255 - v : v;
  });
  return out;
};
/** Smooth jagged edges: on a strong edge, each pixel mixes with its neighbours along the edge, never across it. */
const antialias: Fx = (src, p, b) => {
  const W = src.width, pm = premul(src), get = makeSampler(pm, W, b), res = src.data.slice(), { at } = planes(src, b);
  const thr = clamp(num(p, 'edge', 24), 1, 255), k = clamp(num(p, 'strength', 80), 0, 100) / 100, A = new Float32Array(4), B = new Float32Array(4), acc = new Float64Array(4);
  each(b, (X, Y) => {
    const [gx, gy] = slopes(at, X - b.x, Y - b.y), g = Math.hypot(gx, gy);
    if (g / 4 < thr) return;
    const tx = -gy / g, ty = gx / g, i = (Y * W + X) * 4;
    get(X + tx, Y + ty, A); get(X - tx, Y - ty, B);
    for (let c = 0; c < 4; c++) acc[c] = pm[i + c] * (1 - (2 * k) / 3) + ((A[c] + B[c]) * k) / 3;
    put(res, i, acc);
  });
  return res;
};

// ---------- clean-up ----------
/** Fix interlace lines: every other line of the area is rebuilt from the lines above and below it. */
const deinterlace: Fx = (src, p, b) => {
  const W = src.width, pm = premul(src), res = src.data.slice(), keep = num(p, 'keep', 0) > 0 ? 1 : 0, acc = new Float64Array(4);
  each(b, (x, y) => {
    if (((y - b.y) & 1) === keep) return;
    acc.fill(0);
    let n = 0;
    for (const r of [y - 1, y + 1]) {
      if (r < b.y || r >= b.y + b.h) continue;
      const j = (r * W + x) * 4;
      for (let c = 0; c < 4; c++) acc[c] += pm[j + c];
      n++;
    }
    if (n) put(res, (y * W + x) * 4, acc, n);
  });
  return res;
};
/** Remove stripes: each column's average colour is pulled to the average of the columns around it. */
const destripe: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), r = clamp(Math.round(num(p, 'width', 10)), 1, 200), k = clamp(num(p, 'strength', 100), 0, 100) / 100;
  const mean = [0, 1, 2].map(() => new Float64Array(b.w)), ok = new Uint8Array(b.w);
  for (let x = 0; x < b.w; x++) {
    let s0 = 0, s1 = 0, s2 = 0, ws = 0;
    for (let y = b.y; y < b.y + b.h; y++) { const i = (y * W + b.x + x) * 4, a = d[i + 3]; s0 += d[i] * a; s1 += d[i + 1] * a; s2 += d[i + 2] * a; ws += a; }
    if (ws > 0) { mean[0][x] = s0 / ws; mean[1][x] = s1 / ws; mean[2][x] = s2 / ws; ok[x] = 1; }
  }
  const shift = [0, 1, 2].map((c) => {
    const s = new Float64Array(b.w);
    for (let x = 0; x < b.w; x++) {
      if (!ok[x]) continue;
      let sum = 0, n = 0;
      for (let q = Math.max(0, x - r); q <= Math.min(b.w - 1, x + r); q++) if (ok[q]) { sum += mean[c][q]; n++; }
      s[x] = (mean[c][x] - sum / n) * k;
    }
    return s;
  });
  each(b, (x, y) => { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) out[i + c] = d[i + c] - shift[c][x - b.x]; });
  return out;
};
/** Edge-keeping blur: each pixel averages its neighbours, but only those of a similar colour, so edges stay sharp. */
const edgeKeepBlur: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), r = clamp(Math.round(num(p, 'radius', 4)), 1, 10), t = clamp(num(p, 'keep', 30), 1, 255);
  const ss = 2 * Math.max(1, r / 2) ** 2, near = new Float64Array((2 * r + 1) ** 2), far = new Float32Array(3 * 255 * 255 + 1);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) near[(dy + r) * (2 * r + 1) + dx + r] = Math.exp(-(dx * dx + dy * dy) / ss);
  for (let q = 0; q < far.length; q++) far[q] = Math.exp(-q / (2 * t * t));
  each(b, (x, y) => {
    const i = (y * W + x) * 4;
    let R = 0, G = 0, Bl = 0, S = 0;
    for (let yy = Math.max(b.y, y - r); yy <= Math.min(b.y + b.h - 1, y + r); yy++) for (let xx = Math.max(b.x, x - r); xx <= Math.min(b.x + b.w - 1, x + r); xx++) {
      const j = (yy * W + xx) * 4, a = d[j + 3];
      if (!a) continue;
      const dr = d[j] - d[i], dg = d[j + 1] - d[i + 1], db = d[j + 2] - d[i + 2];
      const wt = near[(yy - y + r) * (2 * r + 1) + xx - x + r] * far[dr * dr + dg * dg + db * db] * a;
      R += d[j] * wt; G += d[j + 1] * wt; Bl += d[j + 2] * wt; S += wt;
    }
    if (S > 0) { out[i] = R / S; out[i + 1] = G / S; out[i + 2] = Bl / S; }
  });
  return out;
};

export const MORE2 = {
  kaleidoscope, 'alien-map': alienMap, bloom, 'edge-detect': edgeDetect, deinterlace, destripe, 'video-degrade': videoDegrade, lowlight,
  'bump-map': bumpMap, 'star-burst': starBurst, 'edge-keep-blur': edgeKeepBlur, antialias,
} satisfies Partial<Record<FxKind, Fx>>;
