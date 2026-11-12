// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Blur, camera blur, sharpen and grain filters, and the "other" family (high pass, maximum, minimum, offset, custom).
 * Blurs work on premultiplied pixels, so see-through areas never bleed dark edges into a layer.
 */
import type { Bitmap } from '../document';
import { boxH, boxV, gaussianBlur } from '../filters';
import type { FxKind } from './meta';
import {
  type Box, type Fx, type P, blurPlane, clamp, edgeMap, hash, luma, makeSampler, minMax, num, premul, rankFilter, smoothstep, unpremul,
} from './lib';

const whole = (s: Bitmap): Box => ({ x: 0, y: 0, w: s.width, h: s.height });

const boxBlur: Fx = (src, p) => {
  const { width: w, height: h, data } = src, n = data.length, r = clamp(Math.round(num(p, 'radius', 6)), 1, 500);
  const a = new Uint8ClampedArray(n), t = new Uint8ClampedArray(n), out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 4) { const al = data[i + 3]; a[i] = (data[i] * al) / 255; a[i + 1] = (data[i + 1] * al) / 255; a[i + 2] = (data[i + 2] * al) / 255; a[i + 3] = al; }
  boxH(a, t, w, h, r);
  boxV(t, a, w, h, r);
  for (let i = 0; i < n; i += 4) { const al = a[i + 3]; if (!al) continue; out[i] = (a[i] * 255) / al; out[i + 1] = (a[i + 1] * 255) / al; out[i + 2] = (a[i + 2] * 255) / al; out[i + 3] = al; }
  return out;
};
/** Averages samples along a path for every pixel of the box. `path(x, y, k, n, o)` names sample k of n. */
function pathBlur(src: Bitmap, b: Box, count: (x: number, y: number) => number, path: (x: number, y: number, t: number, o: Float64Array) => void): Uint8ClampedArray {
  const W = src.width, pm = premul(src), get = makeSampler(pm, W, whole(src)), out = pm.slice(), px = new Float32Array(4), o = new Float64Array(2);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const n = count(x, y), i = (y * W + x) * 4;
    if (n < 2) continue;
    let r = 0, g = 0, bl = 0, a = 0;
    for (let k = 0; k < n; k++) { path(x, y, k / (n - 1) - 0.5, o); get(o[0], o[1], px); r += px[0]; g += px[1]; bl += px[2]; a += px[3]; }
    out[i] = r / n; out[i + 1] = g / n; out[i + 2] = bl / n; out[i + 3] = a / n;
  }
  return unpremul(out);
}
const motionBlur: Fx = (src, p, b) => {
  const a = (num(p, 'angle', 0) * Math.PI) / 180, dist = clamp(num(p, 'distance', 20), 1, 2000), n = clamp(Math.round(dist), 2, 64), dx = Math.cos(a), dy = -Math.sin(a);
  return pathBlur(src, b, () => n, (x, y, t, o) => { o[0] = x + dx * t * dist; o[1] = y + dy * t * dist; });
};
const radialBlur: Fx = (src, p, b) => {
  const zoom = num(p, 'mode', 0) === 1, amt = clamp(num(p, 'amount', 10), 0, 100);
  const cx = b.x + (num(p, 'cx', 50) / 100) * b.w - 0.5, cy = b.y + (num(p, 'cy', 50) / 100) * b.h - 0.5;
  const spin = (amt * Math.PI) / 180, zf = amt / 200;
  const count = (x: number, y: number): number => clamp(Math.ceil((Math.hypot(x - cx, y - cy) * (zoom ? zf : spin)) / 1.5), 1, 48);
  return pathBlur(src, b, count, (x, y, t, o) => {
    const dx = x - cx, dy = y - cy;
    if (zoom) { const s = 1 - (t + 0.5) * zf; o[0] = cx + dx * s; o[1] = cy + dy * s; return; }
    const th = t * spin, c = Math.cos(th), sn = Math.sin(th);
    o[0] = cx + dx * c - dy * sn; o[1] = cy + dx * sn + dy * c;
  });
};
/** Blur that leaves edges alone: neighbours that differ too much count less (surface) or not at all (smart). */
function edgeAware(src: Bitmap, b: Box, rad: number, thr: number, surface: boolean): Uint8ClampedArray {
  const { width: W, height: H, data: d } = src, out = d.slice(), r = clamp(Math.round(rad), 1, 100), K = Math.min(r, 4), t = Math.max(1, thr), offs: number[] = [];
  for (let a = -K; a <= K; a++) for (let c = -K; c <= K; c++) {
    const dy = Math.round((a * r) / K), dx = Math.round((c * r) / K);
    if (dx * dx + dy * dy <= r * r + 1) offs.push(dx, dy);
  }
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    if (surface) {
      for (let c = 0; c < 3; c++) {
        const v = d[i + c];
        let s = 0, sw = 0;
        for (let k = 0; k < offs.length; k += 2) {
          const j = (clamp(y + offs[k + 1], 0, H - 1) * W + clamp(x + offs[k], 0, W - 1)) * 4;
          if (!d[j + 3]) continue;
          const w = 1 - Math.abs(d[j + c] - v) / (2.5 * t);
          if (w > 0) { s += w * d[j + c]; sw += w; }
        }
        if (sw) out[i + c] = s / sw;
      }
    } else {
      const L = luma(d[i], d[i + 1], d[i + 2]);
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let k = 0; k < offs.length; k += 2) {
        const j = (clamp(y + offs[k + 1], 0, H - 1) * W + clamp(x + offs[k], 0, W - 1)) * 4;
        if (!d[j + 3] || Math.abs(luma(d[j], d[j + 1], d[j + 2]) - L) >= t) continue;
        s0 += d[j]; s1 += d[j + 1]; s2 += d[j + 2]; n++;
      }
      if (n) { out[i] = s0 / n; out[i + 1] = s1 / n; out[i + 2] = s2 / n; }
    }
  }
  return out;
}
const surfaceBlur: Fx = (src, p, b) => edgeAware(src, b, num(p, 'radius', 5), num(p, 'threshold', 30), true);
const smartBlur: Fx = (src, p, b) => {
  const t = num(p, 'threshold', 40), mode = Math.round(num(p, 'mode', 0)), out = edgeAware(src, b, num(p, 'radius', 5), t, false);
  if (!mode) return out;
  const E = edgeMap(src), W = src.width;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const j = y * W + x, i = j * 4, edge = E[j] > t;
    if (mode === 1) { const v = edge ? 255 : 0; out[i] = v; out[i + 1] = v; out[i + 2] = v; } else if (edge) { out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; }
  }
  return out;
};
const average: Fx = (src, p, b) => {
  const { width: W, data: d } = src, out = d.slice(), s = clamp(num(p, 'strength', 100), 0, 100) / 100;
  let r = 0, g = 0, bl = 0, a = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = (y * W + x) * 4, al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; bl += d[i + 2] * al; a += al; }
  if (!a) return out;
  const ar = r / a, ag = g / a, ab = bl / a;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    out[i] = d[i] + (ar - d[i]) * s; out[i + 1] = d[i + 1] + (ag - d[i + 1]) * s; out[i + 2] = d[i + 2] + (ab - d[i + 2]) * s;
  }
  return out;
};
/** A round, camera-like blur: every pixel averages a disc (row sums), and bright spots bloom into discs. */
const lensBlur: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, r = clamp(Math.round(num(p, 'radius', 10)), 1, 100);
  const gain = clamp(num(p, 'bright', 40), 0, 100) / 25, thr = clamp(num(p, 'threshold', 200), 0, 254), pm = premul(src);
  if (gain > 0) for (let i = 0; i < pm.length; i += 4) for (let c = 0; c < 3; c++) { const v = d[i + c]; if (v > thr) pm[i + c] *= 1 + (gain * (v - thr)) / (255 - thr); }
  const K = 2 * r + 1, hw = new Int32Array(K);
  for (let k = -r; k <= r; k++) hw[k + r] = Math.floor(Math.sqrt(Math.max(0, r * r - k * k + r * 0.8)));
  const rows = new Float64Array(K * (W + 1) * 4), have = new Int32Array(K).fill(-1), acc = new Float64Array(b.w * 4), cnt = new Float64Array(b.w), out = pm.slice();
  const prefix = (yy: number): number => {
    const slot = yy % K, base = slot * (W + 1) * 4;
    if (have[slot] === yy) return base;
    have[slot] = yy;
    const row = yy * W * 4;
    for (let c = 0; c < 4; c++) rows[base + c] = 0;
    for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) rows[base + (x + 1) * 4 + c] = rows[base + x * 4 + c] + pm[row + x * 4 + c];
    return base;
  };
  for (let y = b.y; y < b.y + b.h; y++) {
    acc.fill(0); cnt.fill(0);
    for (let k = -r; k <= r; k++) {
      const yy = y + k;
      if (yy < 0 || yy >= H) continue;
      const base = prefix(yy), w = hw[k + r];
      for (let x = b.x; x < b.x + b.w; x++) {
        const xa = Math.max(0, x - w), xb = Math.min(W - 1, x + w), o = (x - b.x) * 4;
        for (let c = 0; c < 4; c++) acc[o + c] += rows[base + (xb + 1) * 4 + c] - rows[base + xa * 4 + c];
        cnt[x - b.x] += xb - xa + 1;
      }
    }
    for (let x = b.x; x < b.x + b.w; x++) { const o = (x - b.x) * 4, i = (y * W + x) * 4, n = cnt[x - b.x] || 1; for (let c = 0; c < 4; c++) out[i + c] = acc[o + c] / n; }
  }
  return unpremul(out);
};
/** Blur whose strength changes across the picture: `amount(x, y)` is 0 (sharp) to 1 (blurred by `sigma`). */
function variableBlur(src: Bitmap, b: Box, sigma: number, amount: (x: number, y: number) => number): Uint8ClampedArray {
  const { width: W, data: d } = src, L = 4, out = d.slice(), t = new Float32Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) t[y * b.w + x] = clamp(amount(x + b.x, y + b.y), 0, 1) * L;
  let prev: Uint8ClampedArray = d;
  for (let k = 1; k <= L; k++) {
    const next = gaussianBlur(src, (sigma * k) / L);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const v = t[y * b.w + x];
      if (v < k - 1 || v > k) continue;
      const f = v - (k - 1), i = ((y + b.y) * W + x + b.x) * 4, pa = prev[i + 3], na = next[i + 3], a = pa + (na - pa) * f;
      if (a <= 0) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) out[i + c] = (prev[i + c] * pa + (next[i + c] * na - prev[i + c] * pa) * f) / a;
      out[i + 3] = a;
    }
    prev = next;
  }
  return out;
}
const fieldBlur: Fx = (src, p, b) => {
  const b1 = clamp(num(p, 'b1', 0), 0, 300), b2 = clamp(num(p, 'b2', 20), 0, 300), mx = Math.max(b1, b2, 0.01);
  const x1 = b.x + (num(p, 'x1', 30) / 100) * b.w, y1 = b.y + (num(p, 'y1', 30) / 100) * b.h, x2 = b.x + (num(p, 'x2', 70) / 100) * b.w, y2 = b.y + (num(p, 'y2', 70) / 100) * b.h;
  const vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy || 1;
  return variableBlur(src, b, mx, (x, y) => (b1 + (b2 - b1) * clamp(((x - x1) * vx + (y - y1) * vy) / len2, 0, 1)) / mx);
};
const irisBlur: Fx = (src, p, b) => {
  const cx = b.x + (num(p, 'cx', 50) / 100) * b.w, cy = b.y + (num(p, 'cy', 50) / 100) * b.h;
  const rx = Math.max(1, (num(p, 'rw', 25) / 100) * b.w), ry = Math.max(1, (num(p, 'rh', 30) / 100) * b.h), f = clamp(num(p, 'feather', 50) / 100, 0.02, 1);
  return variableBlur(src, b, num(p, 'blur', 12), (x, y) => smoothstep(1 - f, 1, Math.hypot((x - cx) / rx, (y - cy) / ry)));
};
const tiltBlur: Fx = (src, p, b) => {
  const cx = b.x + (num(p, 'cx', 50) / 100) * b.w, cy = b.y + (num(p, 'cy', 50) / 100) * b.h, a = (num(p, 'angle', 0) * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a);
  const band = (num(p, 'band', 15) / 100) * b.h, fade = Math.max(1, (num(p, 'fade', 20) / 100) * b.h);
  return variableBlur(src, b, num(p, 'blur', 12), (x, y) => smoothstep(band, band + fade, Math.abs(-(x - cx) * s + (y - cy) * c)));
};
/** Unsharp mask that ignores grain below `noise` and keeps the result near its 3×3 neighbours' range (less halo). */
const smartSharpen: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, out = d.slice(), amt = num(p, 'amount', 150) / 100, bl = gaussianBlur(src, clamp(num(p, 'radius', 1.5), 0.3, 64));
  const nt = clamp(num(p, 'noise', 10), 0, 100) * 0.3, over = (1 - clamp(num(p, 'halo', 60), 0, 100) / 100) * 96;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) continue;
    for (let c = 0; c < 3; c++) {
      const v = d[i + c], df = v - bl[i + c], m = Math.abs(df) <= nt ? 0 : df - Math.sign(df) * nt;
      let lo = 255, hi = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = d[(clamp(y + dy, 0, H - 1) * W + clamp(x + dx, 0, W - 1)) * 4 + c];
        if (q < lo) lo = q;
        if (q > hi) hi = q;
      }
      out[i + c] = clamp(v + amt * m, lo - over, hi + over);
    }
  }
  return out;
};
const sharpenEdges: Fx = (src, p, b) => {
  const { width: W, data: d } = src, out = d.slice(), amt = num(p, 'amount', 150) / 100, bl = gaussianBlur(src, clamp(num(p, 'radius', 1), 0.3, 32)), e = num(p, 'edge', 20), E = edgeMap(src);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const j = y * W + x, i = j * 4, m = smoothstep(e * 0.5, e * 1.5, E[j]);
    if (!d[i + 3] || !m) continue;
    for (let c = 0; c < 3; c++) out[i + c] = d[i + c] + amt * m * (d[i + c] - bl[i + c]);
  }
  return out;
};
const addNoise: Fx = (src, p, b) => {
  const { width: W, data: d } = src, out = d.slice(), amt = (clamp(num(p, 'amount', 20), 0, 400) / 100) * 127, bell = num(p, 'dist', 0) === 1, mono = num(p, 'mono', 0) > 0;
  const s = Math.round(num(p, 'seed', 1)) * 977;
  const rnd = (x: number, y: number, k: number): number => (bell ? (hash(x, y, s + k) + hash(x, y, s + k + 3) + hash(x, y, s + k + 6) - 1.5) / 0.75 : hash(x, y, s + k) * 2 - 1);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4, x0 = x - b.x, y0 = y - b.y, n0 = rnd(x0, y0, 0);
    for (let c = 0; c < 3; c++) out[i + c] = d[i + c] + (mono ? n0 : rnd(x0, y0, c * 11 + 1)) * amt;
  }
  return out;
};
/** Edge-preserving smoothing of brightness (a small bilateral filter), blurred colour noise, and some detail put back. */
const reduceNoise: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, n = W * H, s = clamp(num(p, 'strength', 60), 0, 100), keep = (clamp(num(p, 'detail', 30), 0, 100) / 100) * 0.7, col = clamp(num(p, 'color', 50), 0, 100);
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), sr = 3 + s * 0.6, range = new Float32Array(256), space: number[] = [];
  for (let k = 0; k < 256; k++) range[k] = Math.exp(-(k * k) / (2 * sr * sr));
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) space.push(Math.exp(-(dx * dx + dy * dy) / 4.5));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const j = y * W + x, i = j * 4;
    if (!d[i + 3] || !s) { R[j] = d[i]; G[j] = d[i + 1]; B[j] = d[i + 2]; continue; }
    const L0 = luma(d[i], d[i + 1], d[i + 2]);
    let ws = 0, r = 0, g = 0, bl = 0, k = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++, k++) {
      const q = (clamp(y + dy, 0, H - 1) * W + clamp(x + dx, 0, W - 1)) * 4;
      if (!d[q + 3]) continue;
      const w = space[k] * range[Math.min(255, Math.round(Math.abs(luma(d[q], d[q + 1], d[q + 2]) - L0)))];
      ws += w; r += w * d[q]; g += w * d[q + 1]; bl += w * d[q + 2];
    }
    R[j] = r / ws; G[j] = g / ws; B[j] = bl / ws;
  }
  if (col > 0) {
    const Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n);
    for (let j = 0; j < n; j++) { Y[j] = luma(R[j], G[j], B[j]); U[j] = B[j] - Y[j]; V[j] = R[j] - Y[j]; }
    const U2 = blurPlane(U, W, H, (col / 100) * 4), V2 = blurPlane(V, W, H, (col / 100) * 4);
    for (let j = 0; j < n; j++) { R[j] = Y[j] + V2[j]; B[j] = Y[j] + U2[j]; G[j] = (Y[j] - 0.299 * R[j] - 0.114 * B[j]) / 0.587; }
  }
  const out = d.slice();
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const j = y * W + x, i = j * 4;
    if (!d[i + 3]) continue;
    out[i] = R[j] + (d[i] - R[j]) * keep; out[i + 1] = G[j] + (d[i + 1] - G[j]) * keep; out[i + 2] = B[j] + (d[i + 2] - B[j]) * keep;
  }
  return out;
};
const median: Fx = (src, p, b) => rankFilter(src, num(p, 'radius', 2), 0.5, b);
const dust: Fx = (src, p, b) => {
  const { width: W, data: d } = src, m = rankFilter(src, num(p, 'radius', 2), 0.5, b), t = num(p, 'threshold', 10), out = d.slice();
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] && Math.max(Math.abs(d[i] - m[i]), Math.abs(d[i + 1] - m[i + 1]), Math.abs(d[i + 2] - m[i + 2])) > t) { out[i] = m[i]; out[i + 1] = m[i + 1]; out[i + 2] = m[i + 2]; }
  }
  return out;
};
const despeckle: Fx = (src, p, b) => {
  const { width: W, data: d } = src, m = rankFilter(src, num(p, 'radius', 1), 0.5, b), E = edgeMap(src), e = num(p, 'edge', 30), out = d.slice();
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const j = y * W + x, i = j * 4;
    if (d[i + 3] && E[j] <= e) { out[i] = m[i]; out[i + 1] = m[i + 1]; out[i + 2] = m[i + 2]; }
  }
  return out;
};
const highPass: Fx = (src, p, b) => {
  const { width: W, data: d } = src, bl = gaussianBlur(src, clamp(num(p, 'radius', 4), 0.3, 250)), out = d.slice();
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) out[i + c] = 128 + d[i + c] - bl[i + c]; }
  return out;
};
const offset: Fx = (src, p, b) => {
  const { width: W, data: d } = src, out = d.slice(), ox = Math.round((num(p, 'dx', 25) / 100) * b.w), oy = Math.round((num(p, 'dy', 0) / 100) * b.h), mode = Math.round(num(p, 'edge', 0));
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4;
    let sx = x - b.x - ox, sy = y - b.y - oy;
    if (mode === 0) { sx = ((sx % b.w) + b.w) % b.w; sy = ((sy % b.h) + b.h) % b.h; } else if (mode === 1) { sx = clamp(sx, 0, b.w - 1); sy = clamp(sy, 0, b.h - 1); } else if (sx < 0 || sy < 0 || sx >= b.w || sy >= b.h) {
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
      continue;
    }
    const j = ((sy + b.y) * W + sx + b.x) * 4;
    out[i] = d[j]; out[i + 1] = d[j + 1]; out[i + 2] = d[j + 2]; out[i + 3] = d[j + 3];
  }
  return out;
};
/** Your own 5×5 grid of numbers (k0 top left … k24 bottom right), divided by `scale`, plus `offset`. Opacity is kept. */
const custom: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, k: number[] = [], out = d.slice(), pm = premul(src);
  for (let t = 0; t < 25; t++) k.push(num(p, 'k' + t, t === 12 ? 1 : 0));
  const sc = num(p, 'scale', 1) || 1, off = num(p, 'offset', 0);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * W + x) * 4, a = d[i + 3];
    if (!a) continue;
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let t = 0; t < 25; t++) {
        const w = k[t];
        if (w) s += w * pm[(clamp(y + ((t / 5) | 0) - 2, 0, H - 1) * W + clamp(x + (t % 5) - 2, 0, W - 1)) * 4 + c];
      }
      out[i + c] = ((s / sc) * 255) / a + off;
    }
  }
  return out;
};

export const BLURS = {
  'box-blur': boxBlur, 'motion-blur': motionBlur, 'radial-blur': radialBlur, 'surface-blur': surfaceBlur, 'smart-blur': smartBlur, average,
  'lens-blur': lensBlur, 'field-blur': fieldBlur, 'iris-blur': irisBlur, 'tilt-blur': tiltBlur, 'smart-sharpen': smartSharpen,
  'sharpen-edges': sharpenEdges, 'add-noise': addNoise, 'reduce-noise': reduceNoise, median, dust, despeckle, 'high-pass': highPass,
  maximum: (src, p, b) => minMax(src, num(p, 'radius', 2), true, b), minimum: (src, p, b) => minMax(src, num(p, 'radius', 2), false, b), offset, custom,
} satisfies Partial<Record<FxKind, Fx>>;
export type { P };
