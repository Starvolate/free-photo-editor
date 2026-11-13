// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The fourth filters wave (13 Nov 2026). Each kind is one row of the function map and builds every look its name lists:
 * seamless, repeated, mirrored and scattered paper tiles; a peeled corner and a curve bend; rotated copies and nested
 * copies (Droste); crumpled paper, a fractal remap and value spread; superpixels by colour clusters (SLIC) and by flooding
 * (watershed cells); cell, Perlin, simplex, cloud and plasma noise; and detail diffusion that sharpens, deblurs, softens
 * or blooms. Every read stays inside the edited box, so none needs a reach. All maths here is written for this project.
 */
import type { Bitmap } from '../document';
import { clamp, hash, luma, makeSampler, num, premul, rgbOf, unpremul, warp, type Box, type Fx, type P } from './lib';
import type { FxKind } from './meta';

const TAU = Math.PI * 2;
const each = (b: Box, f: (x: number, y: number) => void): void => {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) f(x, y);
};
/** Which look of the row is picked (the `look` setting, 0 to n - 1). */
const look = (p: P, n: number): number => clamp(Math.round(num(p, 'look', 0)), 0, n - 1);
const int = (p: P, k: string, d: number, lo: number, hi: number): number => clamp(Math.round(num(p, k, d)), lo, hi);
/** Pixels outside the box take back their old values (results built from premultiplied copies of the whole bitmap). */
function keepOutside(res: Uint8ClampedArray, src: Bitmap, b: Box): Uint8ClampedArray {
  const d = src.data, W = src.width;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < W; x++) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
    const i = (y * W + x) * 4;
    res[i] = d[i]; res[i + 1] = d[i + 1]; res[i + 2] = d[i + 2]; res[i + 3] = d[i + 3];
  }
  return res;
}
const setPx = (out: Uint8ClampedArray, i: number, r: number, g: number, bl: number, a: number): void => { out[i] = r; out[i + 1] = g; out[i + 2] = bl; out[i + 3] = a; };

// ---------- tiles ----------
/** Scattered paper tiles: square tiles each slid by a random whole number of pixels; gaps show the second colour. */
function paperTiles(src: Bitmap, p: P, b: Box): Uint8ClampedArray {
  const W = src.width, d = src.data, out = d.slice(), t = int(p, 'size', 32, 2, 1000), sd = num(p, 'seed', 1), B = rgbOf(num(p, 'bg', 0xffffff));
  const ms = Math.floor(((clamp(num(p, 'scatter', 30), 0, 100) / 100) * t) / 2);
  const shift = (i: number, j: number, s: number): number => Math.round((hash(i, j, sd + s) * 2 - 1) * ms);
  each(b, (x, y) => {
    const lx = x - b.x, ly = y - b.y, ci = Math.floor(lx / t), cj = Math.floor(ly / t), o = (y * W + x) * 4;
    let best = -1, sx = 0, sy = 0;
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || i * t >= b.w || j * t >= b.h) continue;
      const qx = lx - shift(i, j, 0), qy = ly - shift(i, j, 3);
      if (qx < i * t || qx >= Math.min((i + 1) * t, b.w) || qy < j * t || qy >= Math.min((j + 1) * t, b.h)) continue;
      const z = hash(i, j, sd + 7);
      if (z > best) { best = z; sx = qx; sy = qy; }
    }
    if (best < 0) { setPx(out, o, B[0], B[1], B[2], 255); return; }
    const k = ((b.y + sy) * W + b.x + sx) * 4;
    setPx(out, o, d[k], d[k + 1], d[k + 2], d[k + 3]);
  });
  return out;
}
/**
 * Seamless (four copies, shifted by half the area each way, blended so each copy fades out where its own seam lies),
 * repeated smaller copies, mirrored smaller copies (every other copy flipped, so they join), or scattered paper tiles.
 */
const tiling: Fx = (src, p, b) => {
  const m = look(p, 4);
  if (m === 3) return paperTiles(src, p, b);
  const W = src.width, pm = premul(src), get = makeSampler(pm, W, b), out = pm.slice(), px = new Float32Array(4), n = int(p, 'count', 3, 2, 16);
  const tent = (v: number, len: number): number => (len <= 1 ? 1 : 1 - Math.abs((2 * v) / (len - 1) - 1));
  const hx = Math.floor(b.w / 2), hy = Math.floor(b.h / 2), at = (lx: number, ly: number): number => ((b.y + (ly % b.h)) * W + b.x + (lx % b.w)) * 4;
  const part = (len: number, v: number): number => {
    const u = ((v + 0.5) * n) / len, k = Math.floor(u), f = m === 2 && k & 1 ? 1 - (u - k) : u - k;
    return f * len - 0.5;
  };
  each(b, (x, y) => {
    const lx = x - b.x, ly = y - b.y, i = (y * W + x) * 4;
    if (m === 0) {
      const tx = tent(lx, b.w), ty = tent(ly, b.h), a = at(lx, ly), c = at(lx + hx, ly), e = at(lx, ly + hy), g = at(lx + hx, ly + hy);
      const wa = tx * ty, wc = (1 - tx) * ty, we = tx * (1 - ty), wg = (1 - tx) * (1 - ty);
      for (let q = 0; q < 4; q++) out[i + q] = pm[a + q] * wa + pm[c + q] * wc + pm[e + q] * we + pm[g + q] * wg;
      return;
    }
    get(b.x + part(b.w, lx), b.y + part(b.h, ly), px);
    out.set(px, i);
  });
  return keepOutside(unpremul(out), src, b);
};

// ---------- page curl ----------
/**
 * Peeled corner: the corner (within `size` % of the shorter side, measured along the diagonal) folds back. Under it the
 * layer turns see-through; the folded part shows the page's back, shaded from 191 at the crease to white at its tip.
 * Curve bend: each column (or row) slides along a curve, most in the middle; the gap it leaves turns see-through.
 */
const pageCurl: Fx = (src, p, b) => {
  const W = src.width, d = src.data;
  if (look(p, 2) === 1) {
    const bend = num(p, 'bend', 40), rows = int(p, 'dir', 0, 0, 1) === 1, pm = premul(src), get = makeSampler(pm, W, b), out = pm.slice(), px = new Float32Array(4);
    each(b, (x, y) => {
      const lx = x - b.x, ly = y - b.y, i = (y * W + x) * 4, len = rows ? b.h : b.w, t = rows ? ly : lx;
      const s = len <= 1 ? 0 : (2 * t) / (len - 1) - 1, off = bend * (1 - s * s), sx = rows ? lx - off : lx, sy = rows ? ly : ly - off;
      if (sx < -0.5 || sy < -0.5 || sx > b.w - 0.5 || sy > b.h - 0.5) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; return; }
      get(b.x + sx, b.y + sy, px);
      out.set(px, i);
    });
    return keepOutside(unpremul(out), src, b);
  }
  const out = d.slice(), r = Math.max(1, Math.round((clamp(num(p, 'size', 35), 1, 100) / 100) * Math.min(b.w, b.h))), corner = int(p, 'corner', 0, 0, 3);
  // Flip so the chosen corner is the bottom right: 1 bottom left, 2 top right, 3 top left.
  const fx = corner === 1 || corner === 3, fy = corner >= 2;
  each(b, (x, y) => {
    const lx = fx ? b.w - 1 - (x - b.x) : x - b.x, ly = fy ? b.h - 1 - (y - b.y) : y - b.y, u = b.w - 1 - lx + (b.h - 1 - ly), i = (y * W + x) * 4;
    if (u < r) { setPx(out, i, 0, 0, 0, 0); return; }
    // The fold line is u = r; the flap is the peeled corner mirrored over it, so (lx, ly) is on the flap if its mirror, k steps
    // further along the diagonal, is still inside the area.
    const k = u - r;
    if (u >= 2 * r || lx + k > b.w - 1 || ly + k > b.h - 1) return;
    const g = 255 - 64 * (1 - k / r);
    setPx(out, i, g, g, g, 255);
  });
  return out;
};

// ---------- illusion ----------
/** Rotated copies: the average of `copies` copies turned evenly round the centre. Nested copies: the picture inside itself. */
const illusion: Fx = (src, p, b) => {
  const W = src.width, cx = b.x + (b.w - 1) / 2, cy = b.y + (b.h - 1) / 2;
  if (look(p, 2) === 1) {
    const s = clamp(num(p, 'scale', 50), 10, 90) / 100, hw = (b.w / 2) * s, hh = (b.h / 2) * s;
    // Inside the inner frame the picture is shown again at `s` of its size: zoom out until the point leaves the frame.
    return warp(src, b, (x, y, o) => {
      let qx = x - cx, qy = y - cy;
      for (let k = 0; k < 24 && Math.abs(qx) < hw && Math.abs(qy) < hh; k++) { qx /= s; qy /= s; }
      o[0] = cx + qx; o[1] = cy + qy;
    });
  }
  const n = int(p, 'copies', 4, 2, 12), pm = premul(src), get = makeSampler(pm, W, b), out = pm.slice(), px = new Float32Array(4), acc = new Float64Array(4);
  const cs = Array.from({ length: n }, (_, k) => Math.cos((TAU * k) / n)), sn = Array.from({ length: n }, (_, k) => Math.sin((TAU * k) / n));
  each(b, (x, y) => {
    const dx = x - cx, dy = y - cy, i = (y * W + x) * 4;
    acc.fill(0);
    for (let k = 0; k < n; k++) {
      get(cx + dx * cs[k] - dy * sn[k], cy + dx * sn[k] + dy * cs[k], px);
      for (let c = 0; c < 4; c++) acc[c] += px[c];
    }
    for (let c = 0; c < 4; c++) out[i + c] = acc[c] / n;
  });
  return keepOutside(unpremul(out), src, b);
};

// ---------- noise ----------
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
/** Gradient noise (Perlin): 0 on every whole-number point, about -0.7 to 0.7 between. */
function perlin(x: number, y: number, sd: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fade(fx), v = fade(fy);
  const g = (i: number, j: number, dx: number, dy: number): number => { const a = hash(i, j, sd) * TAU; return Math.cos(a) * dx + Math.sin(a) * dy; };
  const a = g(xi, yi, fx, fy), c = g(xi + 1, yi, fx - 1, fy), e = g(xi, yi + 1, fx, fy - 1), f = g(xi + 1, yi + 1, fx - 1, fy - 1);
  const top = a + (c - a) * u, bot = e + (f - e) * u;
  return top + (bot - top) * v;
}
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
/** Simplex noise on a triangle grid: 0 at the origin and every corner of the grid, about -1 to 1 between. */
function simplex(x: number, y: number, sd: number): number {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const corner = (ii: number, jj: number, dx: number, dy: number): number => {
    let q = 0.5 - dx * dx - dy * dy;
    if (q <= 0) return 0;
    q *= q;
    const a = hash(ii, jj, sd) * TAU;
    return q * q * (Math.cos(a) * dx + Math.sin(a) * dy);
  };
  return 70 * (corner(i, j, x0, y0) + corner(i + i1, j + j1, x0 - i1 + G2, y0 - j1 + G2) + corner(i + 1, j + 1, x0 - 1 + 2 * G2, y0 - 1 + 2 * G2));
}
/** Layers (octaves) of a noise, each twice as fine and half as strong; `abs` sums their sizes (turbulence). */
function layers(f: (x: number, y: number, s: number) => number, x: number, y: number, oct: number, sd: number, abs: boolean): number {
  let sum = 0, amp = 1, total = 0, k = 1;
  for (let o = 0; o < oct; o++) { const v = f(x * k, y * k, sd + o * 13); sum += amp * (abs ? Math.abs(v) : v); total += amp; amp *= 0.5; k *= 2; }
  return sum / total;
}
/** Diamond-square plasma on an N by N grid (N = 2^k + 1), values about 0 to 1; `rough` is how far each new point may stray. */
function plasmaGrid(N: number, rough: number, sd: number): Float32Array {
  const g = new Float32Array(N * N), L = N - 1, at = (x: number, y: number): number => y * N + x;
  g[at(0, 0)] = hash(0, 0, sd); g[at(L, 0)] = hash(1, 0, sd); g[at(0, L)] = hash(0, 1, sd); g[at(L, L)] = hash(1, 1, sd);
  let amp = rough;
  for (let step = L; step > 1; step >>= 1) {
    const h = step >> 1;
    for (let y = h; y < N; y += step) for (let x = h; x < N; x += step)
      g[at(x, y)] = (g[at(x - h, y - h)] + g[at(x + h, y - h)] + g[at(x - h, y + h)] + g[at(x + h, y + h)]) / 4 + (hash(x, y, sd + 3) - 0.5) * amp;
    for (let y = 0; y < N; y += h) for (let x = (y / h) % 2 === 0 ? h : 0; x < N; x += step) {
      let s = 0, c = 0;
      if (x >= h) { s += g[at(x - h, y)]; c++; }
      if (x + h < N) { s += g[at(x + h, y)]; c++; }
      if (y >= h) { s += g[at(x, y - h)]; c++; }
      if (y + h < N) { s += g[at(x, y + h)]; c++; }
      g[at(x, y)] = s / c + (hash(x, y, sd + 5) - 0.5) * amp;
    }
    amp *= 0.5;
  }
  return g;
}
/**
 * Generated textures that fill the area: cells (distance to the nearest random point), Perlin, simplex, cloud (the
 * sizes of Perlin noise added up, so it is 0 on the grid points) in the main colour over the second; plasma in its own colours.
 */
const noisePattern: Fx = (src, p, b) => {
  const W = src.width, out = src.data.slice(), m = look(p, 5), s = clamp(num(p, 'size', 32), 2, 1000), oct = int(p, 'detail', 4, 1, 8), sd = num(p, 'seed', 1);
  if (m === 4) {
    let N = 3;
    while (N < Math.max(b.w, b.h) && N < 1025) N = (N - 1) * 2 + 1;
    const f = Math.max(b.w, b.h) > N ? (N - 1) / Math.max(b.w - 1, b.h - 1) : 1, rough = clamp(num(p, 'rough', 50), 0, 100) / 100;
    const grids = [0, 1, 2].map((c) => plasmaGrid(N, rough, sd * 3 + c * 101));
    each(b, (x, y) => {
      const gx = (x - b.x) * f, gy = (y - b.y) * f, x0 = Math.min(N - 2, Math.floor(gx)), y0 = Math.min(N - 2, Math.floor(gy)), tx = gx - x0, ty = gy - y0, i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const g = grids[c], k = y0 * N + x0;
        const v = (g[k] * (1 - tx) + g[k + 1] * tx) * (1 - ty) + (g[k + N] * (1 - tx) + g[k + N + 1] * tx) * ty;
        out[i + c] = clamp(v, 0, 1) * 255;
      }
      out[i + 3] = 255;
    });
    return out;
  }
  const F = rgbOf(num(p, 'fg', 0)), B = rgbOf(num(p, 'bg', 0xffffff)), jit = clamp(num(p, 'jitter', 100), 0, 100) / 100;
  each(b, (x, y) => {
    const u = (x - b.x) / s, w = (y - b.y) / s;
    let v: number;
    if (m === 0) {
      const ci = Math.floor(u), cj = Math.floor(w);
      let best = Infinity;
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        const fx = i + 0.5 + (hash(i, j, sd) - 0.5) * jit, fy = j + 0.5 + (hash(i, j, sd + 1) - 0.5) * jit, dd = (u - fx) ** 2 + (w - fy) ** 2;
        if (dd < best) best = dd;
      }
      v = Math.min(1, Math.sqrt(best));
    } else if (m === 1) v = 0.5 + 0.7 * layers(perlin, u, w, oct, sd, false);
    else if (m === 2) v = 0.5 + 0.5 * layers(simplex, u, w, oct, sd, false);
    else v = 1.6 * layers(perlin, u, w, oct, sd, true);
    v = clamp(v, 0, 1);
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = B[c] + (F[c] - B[c]) * v;
    out[i + 3] = 255;
  });
  return out;
};

// ---------- fractal looks ----------
/**
 * Crumpled paper: creases from folded noise light and shade the picture (light from the top right). Fractal remap: each
 * point, read as a number on the plane, is squared and added back `depth` times (z = z * z + c), and the picture is read
 * where it lands, folded back like a mirror at the edges. Value spread: lighter (or darker) colours grow into their
 * neighbours one pixel per step.
 */
const fractal: Fx = (src, p, b) => {
  const W = src.width, d = src.data, m = look(p, 3);
  if (m === 1) {
    const depth = int(p, 'depth', 3, 1, 20);
    const fold = (t: number, len: number): number => { const per = 2 * len, q = ((t % per) + per) % per; return (q < len ? q : per - q) - 0.5; };
    return warp(src, b, (x, y, o) => {
      const cr = -2 + (3 * (x - b.x + 0.5)) / b.w, ci = -1.5 + (3 * (y - b.y + 0.5)) / b.h;
      let zr = cr, zi = ci;
      for (let k = 0; k < depth && zr * zr + zi * zi <= 4; k++) { const t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; }
      o[0] = b.x + fold(((zr + 2) / 3) * b.w, b.w);
      o[1] = b.y + fold(((zi + 1.5) / 3) * b.h, b.h);
    });
  }
  const out = d.slice();
  if (m === 0) {
    const s = clamp(num(p, 'size', 40), 4, 1000), a = clamp(num(p, 'amount', 50), 0, 100) / 100, sd = num(p, 'seed', 1), gw = b.w + 2, hgt = new Float32Array(gw * (b.h + 2));
    for (let y = 0; y < b.h + 2; y++) for (let x = 0; x < gw; x++) {
      let v = 0, amp = 1, k = 1;
      for (let o = 0; o < 4; o++) { v += amp * (1 - Math.abs(perlin(((x - 1) * k) / s, ((y - 1) * k) / s, sd + o * 17))); amp *= 0.5; k *= 2; }
      hgt[y * gw + x] = v;
    }
    each(b, (x, y) => {
      const j = (y - b.y + 1) * gw + x - b.x + 1, slope = (hgt[j + 1] - hgt[j - 1] + hgt[j - gw] - hgt[j + gw]) * s * 0.25;
      const k = 1 + clamp(slope, -1, 1) * a, i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = d[i + c] * k;
    });
    return out;
  }
  const steps = int(p, 'steps', 3, 1, 30), dark = int(p, 'spread', 0, 0, 1) === 1;
  let cur = out;
  for (let st = 0; st < steps; st++) {
    const next = cur.slice();
    each(b, (x, y) => {
      const i = (y * W + x) * 4;
      let best = i, bl = cur[i + 3] ? luma(cur[i], cur[i + 1], cur[i + 2]) : dark ? Infinity : -Infinity;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < b.x || ny < b.y || nx >= b.x + b.w || ny >= b.y + b.h) continue;
        const j = (ny * W + nx) * 4;
        if (!cur[j + 3]) continue;
        const L = luma(cur[j], cur[j + 1], cur[j + 2]);
        if (dark ? L < bl : L > bl) { bl = L; best = j; }
      }
      if (best !== i) setPx(next, i, cur[best], cur[best + 1], cur[best + 2], cur[best + 3]);
    });
    cur = next;
  }
  return cur;
};

// ---------- superpixels ----------
/** Colour clusters (SLIC): centres on a grid, then 4 rounds of "each pixel joins the nearest centre in colour and place". */
function slic(d: Uint8ClampedArray, W: number, b: Box, S: number, compact: number, lab: Int32Array): number {
  const gx = Math.max(1, Math.round(b.w / S)), gy = Math.max(1, Math.round(b.h / S)), sx = b.w / gx, sy = b.h / gy, k = gx * gy, step = (sx + sy) / 2;
  const cx = new Float64Array(k), cy = new Float64Array(k), cc = new Float64Array(k * 3), wgt = ((compact * 2.55) / step) ** 2, n = b.w * b.h;
  const col = (lx: number, ly: number, c: number): number => d[((b.y + ly) * W + b.x + lx) * 4 + c];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const q = j * gx + i;
    cx[q] = (i + 0.5) * sx - 0.5; cy[q] = (j + 0.5) * sy - 0.5;
    const px = clamp(Math.round(cx[q]), 0, b.w - 1), py = clamp(Math.round(cy[q]), 0, b.h - 1);
    for (let c = 0; c < 3; c++) cc[q * 3 + c] = col(px, py, c);
  }
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) lab[y * b.w + x] = Math.min(gy - 1, Math.floor(y / sy)) * gx + Math.min(gx - 1, Math.floor(x / sx));
  const dist = new Float64Array(n), sum = new Float64Array(k * 6);
  for (let round = 0; round < 4; round++) {
    dist.fill(Infinity);
    for (let q = 0; q < k; q++) {
      const x0 = Math.max(0, Math.floor(cx[q] - 2 * step)), x1 = Math.min(b.w - 1, Math.ceil(cx[q] + 2 * step));
      const y0 = Math.max(0, Math.floor(cy[q] - 2 * step)), y1 = Math.min(b.h - 1, Math.ceil(cy[q] + 2 * step));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let dc = 0;
        for (let c = 0; c < 3; c++) { const e = col(x, y, c) - cc[q * 3 + c]; dc += e * e; }
        const D = dc + wgt * ((x - cx[q]) ** 2 + (y - cy[q]) ** 2), j = y * b.w + x;
        if (D < dist[j]) { dist[j] = D; lab[j] = q; }
      }
    }
    sum.fill(0);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const q = lab[y * b.w + x], o = q * 6;
      sum[o] += x; sum[o + 1] += y; sum[o + 2] += 1;
      for (let c = 0; c < 3; c++) sum[o + 3 + c] += col(x, y, c);
    }
    for (let q = 0; q < k; q++) {
      const o = q * 6, m = sum[o + 2];
      if (!m) continue;
      cx[q] = sum[o] / m; cy[q] = sum[o + 1] / m;
      for (let c = 0; c < 3; c++) cc[q * 3 + c] = sum[o + 3 + c] / m;
    }
  }
  return k;
}
/** Flooded cells (watershed): one seed at the calmest pixel of each grid square; patches grow from the calmest edges first. */
function watershed(d: Uint8ClampedArray, W: number, b: Box, S: number, lab: Int32Array): number {
  const w = b.w, h = b.h, n = w * h, L = new Float32Array(n), G = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((b.y + y) * W + b.x + x) * 4; L[y * w + x] = (luma(d[i], d[i + 1], d[i + 2]) * d[i + 3]) / 255; }
  const at = (x: number, y: number): number => L[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    G[y * w + x] = Math.hypot(gx, gy) / 4;
  }
  // A binary heap of pixels, calmest first; ties go to the pixel queued first.
  const heap = new Int32Array(n), ord = new Int32Array(n);
  let size = 0, counter = 0;
  const less = (a: number, c: number): boolean => G[a] < G[c] || (G[a] === G[c] && ord[a] < ord[c]);
  const push = (j: number): void => {
    ord[j] = counter++;
    let i = size++;
    heap[i] = j;
    while (i > 0) { const up = (i - 1) >> 1; if (!less(heap[i], heap[up])) break; const t = heap[i]; heap[i] = heap[up]; heap[up] = t; i = up; }
  };
  const pop = (): number => {
    const top = heap[0];
    heap[0] = heap[--size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < size && less(heap[l], heap[m])) m = l;
      if (r < size && less(heap[r], heap[m])) m = r;
      if (m === i) break;
      const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m;
    }
    return top;
  };
  lab.fill(-1);
  let k = 0;
  for (let y0 = 0; y0 < h; y0 += S) for (let x0 = 0; x0 < w; x0 += S) {
    let seed = -1;
    for (let y = y0; y < Math.min(h, y0 + S); y++) for (let x = x0; x < Math.min(w, x0 + S); x++) { const j = y * w + x; if (seed < 0 || G[j] < G[seed]) seed = j; }
    lab[seed] = k++;
    push(seed);
  }
  while (size) {
    const j = pop(), x = j % w, y = (j - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (lab[q] < 0) { lab[q] = lab[j]; push(q); }
    }
  }
  return k;
}
/** Each patch takes its mean colour (weighted by opacity); opacity is kept. `lines` outlines the patches in the main colour. */
const superpixels: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), S = int(p, 'size', 24, 2, 400), lab = new Int32Array(b.w * b.h);
  const k = look(p, 2) === 0 ? slic(d, W, b, S, clamp(num(p, 'compact', 20), 1, 100), lab) : watershed(d, W, b, S, lab);
  const sum = new Float64Array(k * 4);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = ((b.y + y) * W + b.x + x) * 4, o = lab[y * b.w + x] * 4, a = d[i + 3];
    for (let c = 0; c < 3; c++) sum[o + c] += d[i + c] * a;
    sum[o + 3] += a;
  }
  const lines = num(p, 'lines', 0) > 0, F = rgbOf(num(p, 'fg', 0));
  each(b, (x, y) => {
    const lx = x - b.x, ly = y - b.y, j = ly * b.w + lx, o = lab[j] * 4, a = sum[o + 3], i = (y * W + x) * 4;
    if (lines && ((lx + 1 < b.w && lab[j + 1] !== lab[j]) || (ly + 1 < b.h && lab[j + b.w] !== lab[j]))) { out[i] = F[0]; out[i + 1] = F[1]; out[i + 2] = F[2]; return; }
    if (a) for (let c = 0; c < 3; c++) out[i + c] = sum[o + c] / a;
  });
  return out;
};

// ---------- detail diffusion ----------
/** Mean of a plane over the (2r + 1) square round each point, counting only pixels whose weight is 1 (summed-area tables). */
function weightedMean(f: Float32Array, wt: Uint8Array, w: number, h: number, r: number): Float32Array {
  const S = new Float64Array((w + 1) * (h + 1)), C = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let row = 0, cnt = 0;
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      row += wt[j] ? f[j] : 0; cnt += wt[j];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; C[(y + 1) * (w + 1) + x + 1] = C[y * (w + 1) + x + 1] + cnt;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const box = (A: Float64Array): number => A[y1 * (w + 1) + x1] - A[y0 * (w + 1) + x1] - A[y1 * (w + 1) + x0] + A[y0 * (w + 1) + x0];
    const c = box(C);
    out[y * w + x] = c ? box(S) / c : f[y * w + x];
  }
  return out;
}
/**
 * Detail diffusion, `steps` passes, colour channels only (opacity kept; see-through pixels take no part):
 * sharpen runs heat flow backwards (u - k x Laplacian), soften forwards (u + k x Laplacian), bloom lets only the
 * brightening part through, and deblur undoes a box blur of `radius` (each pass adds back what blurring takes away).
 */
const detailDiffuse: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), m = look(p, 4), amt = clamp(num(p, 'amount', 50), 0, 100) / 100, k = amt * 0.25;
  const steps = int(p, 'steps', 2, 1, 30), r = int(p, 'radius', 2, 1, 20), w = b.w, h = b.h, n = w * h, op = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) op[y * w + x] = d[((b.y + y) * W + b.x + x) * 4 + 3] ? 1 : 0;
  for (let c = 0; c < 3; c++) {
    const s0 = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s0[y * w + x] = d[((b.y + y) * W + b.x + x) * 4 + c];
    let u = s0.slice();
    for (let st = 0; st < steps; st++) {
      const nx = new Float32Array(n), bl = m === 1 ? weightedMean(u, op, w, h, r) : null;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = y * w + x, v = u[j];
        if (!op[j]) { nx[j] = v; continue; }
        if (bl) { nx[j] = clamp(v + (s0[j] - bl[j]) * amt, 0, 255); continue; }
        // Neighbours outside the box or see-through count as the pixel itself.
        const nb = (q: number, ok: boolean): number => (ok && op[q] ? u[q] : v);
        const lap = nb(j - 1, x > 0) + nb(j + 1, x < w - 1) + nb(j - w, y > 0) + nb(j + w, y < h - 1) - 4 * v;
        const t = m === 0 ? v - k * lap : v + k * lap;
        nx[j] = clamp(m === 3 ? Math.max(v, t) : t, 0, 255);
      }
      u = nx;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[((b.y + y) * W + b.x + x) * 4 + c] = u[y * w + x];
  }
  return out;
};

export const MORE4 = {
  tiling, 'page-curl': pageCurl, illusion, fractal, superpixels, 'noise-pattern': noisePattern, 'detail-diffuse': detailDiffuse,
} satisfies Partial<Record<FxKind, Fx>>;
