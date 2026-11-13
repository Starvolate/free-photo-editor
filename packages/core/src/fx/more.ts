// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The batch-filters wave (13 Nov 2026): spin blur, lens fix, glass, ocean ripple, lens flare, lighting, colour to
 * see-through, dither, replace a colour, fewer colours and palette colour. They load with the other families on first
 * use. None reads past the edited box, so none needs a reach. All maths here is written for this project.
 */
import type { Bitmap } from '../document';
import { clamp, fbm, hash, luma, makeSampler, num, premul, rgbOf, smoothstep, warp, type Box, type Fx, type P } from './lib';
import type { FxKind } from './meta';

const TAU = Math.PI * 2;
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

// ---------- blur and lens ----------
const spinBlur: Fx = (src, p, b) => {
  const W = src.width, get = makeSampler(premul(src), W, b), res = src.data.slice(), px = new Float32Array(4), acc = new Float64Array(4);
  const [cx, cy] = spot(b, p, 50, 50), R = Math.max(1, ((clamp(num(p, 'size', 80), 1, 200) / 100) * Math.min(b.w, b.h)) / 2);
  const ang = (clamp(num(p, 'angle', 20), 0, 360) * Math.PI) / 180;
  each(b, (x, y) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), a = ang * (1 - smoothstep(R * 0.75, R, d));
    if (a * d < 0.05) return;
    const n = clamp(Math.ceil(a * d * 1.5) + 1, 2, 96);
    acc.fill(0);
    for (let k = 0; k < n; k++) {
      const t = -a / 2 + (a * k) / (n - 1), c = Math.cos(t), s = Math.sin(t);
      get(cx + dx * c - dy * s, cy + dx * s + dy * c, px);
      for (let q = 0; q < 4; q++) acc[q] += px[q];
    }
    put(res, (y * W + x) * 4, acc, n);
  });
  return res;
};
/** Lens fix: undoes barrel or pincushion bending, lightens or darkens the corners and pulls red and blue fringes back. */
const lensFix: Fx = (src, p, b) => {
  const W = src.width, get = makeSampler(premul(src), W, b), res = src.data.slice(), g = new Float32Array(4), rr = new Float32Array(4), bb = new Float32Array(4);
  const acc = new Float64Array(4), cx = b.x + (b.w - 1) / 2, cy = b.y + (b.h - 1) / 2, rn = Math.max(1, Math.hypot(b.w, b.h) / 2);
  const k = -(clamp(num(p, 'distort', 15), -100, 100) / 100) * 0.45, vig = clamp(num(p, 'vignette', 30), -100, 100) / 100;
  const mid = clamp(num(p, 'mid', 50), 0, 100) / 100, fr = (clamp(num(p, 'fringe', 0), -100, 100) / 100) * 0.012;
  each(b, (x, y) => {
    const u = (x - cx) / rn, v = (y - cy) / rn, r2 = u * u + v * v, s = 1 + k * r2;
    get(cx + u * s * rn, cy + v * s * rn, g);
    acc[0] = g[0]; acc[1] = g[1]; acc[2] = g[2]; acc[3] = g[3];
    if (fr !== 0 && g[3] > 0) {
      get(cx + u * s * (1 + fr) * rn, cy + v * s * (1 + fr) * rn, rr);
      get(cx + u * s * (1 - fr) * rn, cy + v * s * (1 - fr) * rn, bb);
      if (rr[3] > 0) acc[0] = (rr[0] / rr[3]) * g[3];
      if (bb[3] > 0) acc[2] = (bb[2] / bb[3]) * g[3];
    }
    if (vig !== 0) {
      const gain = 1 + vig * 0.9 * smoothstep(mid * 0.9, 1.05, Math.sqrt(r2));
      for (let c = 0; c < 3; c++) acc[c] = Math.min(acc[3], acc[c] * gain);
    }
    put(res, (y * W + x) * 4, acc);
  });
  return res;
};

// ---------- bend ----------
const glass: Fx = (src, p, b) => {
  const amt = clamp(num(p, 'distort', 5), 0, 20), sm = clamp(num(p, 'smooth', 3), 1, 15), tex = Math.round(num(p, 'texture', 0));
  const sc = clamp(num(p, 'scale', 100), 50, 200) / 100, s = Math.round(num(p, 'seed', 1)) * 101 + 7, cell = (4 + sm * 3) * sc, f = 1 / (1 + sm * 1.5 * sc);
  return warp(src, b, (x, y, o) => {
    const X = x - b.x, Y = y - b.y;
    let dx: number, dy: number;
    if (tex === 1 || tex === 2) {
      const sign = tex === 2 ? -1 : 1;
      dx = sign * ((X / cell) % 1 - 0.5) * 2; dy = sign * ((Y / cell) % 1 - 0.5) * 2;
    } else if (tex === 3) {
      dx = Math.sin((TAU * X) / cell) * 0.6 + fbm(X / 3, Y / 3, 2, s) - 0.5;
      dy = Math.sin((TAU * Y) / cell) * 0.6 + fbm(X / 3, Y / 3, 2, s + 9) - 0.5;
    } else {
      dx = (fbm(X * f, Y * f, 3, s) - 0.5) * 3; dy = (fbm(X * f, Y * f, 3, s + 17) - 0.5) * 3;
    }
    o[0] = x + dx * amt; o[1] = y + dy * amt;
  });
};
const oceanRipple: Fx = (src, p, b) => {
  const size = clamp(num(p, 'size', 9), 1, 15), amt = clamp(num(p, 'amount', 9), 0, 20), s = Math.round(num(p, 'seed', 1)) * 131 + 3, f = 1 / (3 + size * 2.5);
  return warp(src, b, (x, y, o) => {
    const X = (x - b.x) * f, Y = (y - b.y) * f;
    o[0] = x + Math.sin(fbm(X, Y, 2, s) * TAU * 4) * amt * 0.5;
    o[1] = y + Math.cos(fbm(X, Y, 2, s + 29) * TAU * 4) * amt * 0.5;
  });
};

// ---------- light ----------
/** Ghost discs along the line from the flare through the middle: [where (1 is the middle), size, red, green, blue]. */
const GHOSTS = [[0.55, 0.018, 0.5, 0.75, 1], [1.25, 0.035, 1, 0.65, 0.4], [1.6, 0.012, 0.6, 1, 0.6], [1.95, 0.06, 0.75, 0.55, 1]];
const lensFlare: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), kind = clamp(Math.round(num(p, 'kind', 0)), 0, 2), k = clamp(num(p, 'bright', 100), 10, 300) / 100;
  const [fx, fy] = spot(b, p, 30, 30), D = Math.max(1, Math.hypot(b.w, b.h)), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const ring = [0.11, 0.14, 0.08][kind], core = [0.05, 0.035, 0.07][kind], ghosts = GHOSTS.slice(0, kind === 2 ? 2 : 4);
  each(b, (x, y) => {
    const dx = (x - fx) / D, dy = (y - fy) / D, r = Math.hypot(dx, dy);
    let L = Math.exp(-((r / core) ** 2)) + 0.35 * Math.exp(-r / 0.22);
    if (kind !== 1) L += 0.18 * Math.abs(Math.cos(6 * Math.atan2(dy, dx))) ** 30 * Math.exp(-r / 0.18);
    const h = 0.22 * Math.exp(-(((r - ring) / 0.012) ** 2));
    let lr = L + h * 0.7, lg = L * 0.95 + h * 0.85, lb = L * 0.85 + h;
    for (const [t, rad, tr, tg, tb] of ghosts) {
      const q = Math.hypot((x - (fx + (cx - fx) * t)) / D, (y - (fy + (cy - fy) * t)) / D), gl = 0.16 * (1 - smoothstep(rad * 0.55, rad, q));
      lr += gl * tr; lg += gl * tg; lb += gl * tb;
    }
    const i = (y * W + x) * 4;
    out[i] = 255 - (255 - d[i]) * Math.max(0, 1 - lr * k);
    out[i + 1] = 255 - (255 - d[i + 1]) * Math.max(0, 1 - lg * k);
    out[i + 2] = 255 - (255 - d[i + 2]) * Math.max(0, 1 - lb * k);
  });
  return out;
};
/** Lighting: a spotlight, a lamp or flood light over a dimmed picture; "raised texture" lets the light catch light areas as bumps. */
const lighting: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), type = clamp(Math.round(num(p, 'type', 0)), 0, 2), k = clamp(num(p, 'bright', 100), 0, 200) / 100;
  const amb = clamp(num(p, 'ambient', 25), 0, 100) / 100, bump = clamp(num(p, 'bumps', 0), 0, 100) / 100;
  const [lx, ly] = spot(b, p, 40, 35), R = Math.max(1, ((clamp(num(p, 'size', 60), 5, 200) / 100) * Math.max(b.w, b.h)) / 2);
  const L = (x: number, y: number): number => { const i = (clamp(y, b.y, b.y + b.h - 1) * W + clamp(x, b.x, b.x + b.w - 1)) * 4; return luma(d[i], d[i + 1], d[i + 2]); };
  each(b, (x, y) => {
    const dx = x - lx, dy = y - ly, len = Math.hypot(dx, dy), nd = len / R;
    let I = type === 0 ? 1 - smoothstep(0.55, 1, nd) : type === 1 ? 1 / (1 + 2.5 * nd * nd) : 0.9;
    if (bump > 0) {
      const ux = type === 2 ? Math.SQRT1_2 : dx / (len || 1), uy = type === 2 ? Math.SQRT1_2 : dy / (len || 1);
      I *= clamp(1 - (bump * ((L(x + 1, y) - L(x - 1, y)) * ux + (L(x, y + 1) - L(x, y - 1)) * uy)) / 128, 0.2, 1.8);
    }
    const g = amb + I * k, i = (y * W + x) * 4;
    out[i] = d[i] * g; out[i + 1] = d[i + 1] * g; out[i + 2] = d[i + 2] * g;
  });
  return out;
};

// ---------- colour ----------
/** Colour to see-through: each pixel keeps only what differs from the colour, so edges and glows fade softly. */
const colorToAlpha: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), which = clamp(Math.round(num(p, 'which', 0)), 0, 3);
  const C = which === 0 ? [255, 255, 255] : which === 1 ? [0, 0, 0] : rgbOf(num(p, which === 2 ? 'fg' : 'bg', 0xffffff));
  const t = clamp(num(p, 'clear', 0), 0, 99) / 100;
  each(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) return;
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const v = d[i + c], kc = C[c];
      a = Math.max(a, v > kc ? (v - kc) / (255 - kc) : v < kc ? (kc - v) / kc : 0);
    }
    const a2 = clamp((a - t) / (1 - t), 0, 1);
    if (!(a2 > 0)) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; return; }
    for (let c = 0; c < 3; c++) out[i + c] = C[c] + (d[i + c] - C[c]) / a2;
    out[i + 3] = d[i + 3] * a2;
  });
  return out;
};
/** Threshold of an 8 by 8 ordered pattern, 0 to 63, built by the usual doubling rule. */
const B2 = [0, 2, 3, 1];
const bayer = (x: number, y: number): number => 16 * B2[(y & 1) * 2 + (x & 1)] + 4 * B2[((y >> 1) & 1) * 2 + ((x >> 1) & 1)] + B2[((y >> 2) & 1) * 2 + ((x >> 2) & 1)];
/** Spreads each pixel's rounding error onto the pixels to its right and below, one row at a time. */
function diffuse(src: Bitmap, b: Box, out: Uint8ClampedArray, pick: (r: number, g: number, bl: number, o: number[]) => void, spread: boolean): void {
  const W = src.width, d = src.data, o = [0, 0, 0];
  let cur = new Float32Array((b.w + 2) * 3), nxt = new Float32Array((b.w + 2) * 3);
  for (let y = b.y; y < b.y + b.h; y++) {
    nxt.fill(0);
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = (y * W + x) * 4, j = (x - b.x + 1) * 3;
      if (!d[i + 3]) continue;
      const r = d[i] + cur[j], g = d[i + 1] + cur[j + 1], bl = d[i + 2] + cur[j + 2];
      pick(r, g, bl, o);
      out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2];
      if (!spread) continue;
      const e = [r - o[0], g - o[1], bl - o[2]];
      for (let c = 0; c < 3; c++) { cur[j + 3 + c] += (e[c] * 7) / 16; nxt[j - 3 + c] += (e[c] * 3) / 16; nxt[j + c] += (e[c] * 5) / 16; nxt[j + 3 + c] += e[c] / 16; }
    }
    [cur, nxt] = [nxt, cur];
  }
}
const dither: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), n = clamp(Math.round(num(p, 'tones', 4)), 2, 32), step = 255 / (n - 1);
  const how = Math.round(num(p, 'method', 0)), grey = num(p, 'grey', 0) > 0, s = Math.round(num(p, 'seed', 1)) * 37 + 5;
  const q = (v: number): number => clamp(Math.round(v / step), 0, n - 1) * step;
  if (how === 0) {
    diffuse(src, b, out, (r, g, bl, o) => {
      if (grey) { const v = q(luma(r, g, bl)); o[0] = o[1] = o[2] = v; } else { o[0] = q(r); o[1] = q(g); o[2] = q(bl); }
    }, true);
    return out;
  }
  each(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) return;
    const t = (how === 1 ? (bayer((x - b.x) & 7, (y - b.y) & 7) + 0.5) / 64 : hash(x - b.x, y - b.y, s)) - 0.5, g = luma(d[i], d[i + 1], d[i + 2]);
    for (let c = 0; c < 3; c++) out[i + c] = q((grey ? g : d[i + c]) + t * step);
  });
  return out;
};
function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dd = mx - mn;
  if (!dd) return [0, 0, l];
  const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [h / 6, s, l];
}
function fromHsl(h: number, s: number, l: number, o: number[]): void {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, m = 2 * l - q;
  const f = (t: number): number => {
    t = ((t % 1) + 1) % 1;
    return t < 1 / 6 ? m + (q - m) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? m + (q - m) * (2 / 3 - t) * 6 : m;
  };
  o[0] = f(h + 1 / 3) * 255; o[1] = f(h) * 255; o[2] = f(h - 1 / 3) * 255;
}
/** Replace a colour: pixels near the chosen colour turn round the colour wheel and change strength and lightness, fading out at the range's edge. */
const replaceColor: Fx = (src, p, b) => {
  const W = src.width, d = src.data, out = d.slice(), fuzz = clamp(num(p, 'fuzz', 60), 0, 200), o = [0, 0, 0];
  const mi = ((b.y + (b.h >> 1)) * W + b.x + (b.w >> 1)) * 4;
  const C = Math.round(num(p, 'from', 0)) === 1 ? rgbOf(num(p, 'fg', 0)) : [d[mi], d[mi + 1], d[mi + 2]];
  const dh = num(p, 'hue', 120) / 360, ds = clamp(num(p, 'sat', 0), -100, 100) / 100, dl = clamp(num(p, 'light', 0), -100, 100) / 100;
  each(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) return;
    const dist = Math.hypot(d[i] - C[0], d[i + 1] - C[1], d[i + 2] - C[2]) / Math.sqrt(3);
    const w = fuzz <= 0 ? (dist < 0.5 ? 1 : 0) : clamp((fuzz - dist) / (fuzz * 0.5), 0, 1);
    if (!w) return;
    const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]);
    fromHsl(h + dh, ds >= 0 ? s + (1 - s) * ds : s * (1 + ds), dl >= 0 ? l + (1 - l) * dl : l * (1 + dl), o);
    for (let c = 0; c < 3; c++) out[i + c] = d[i + c] + (o[c] - d[i + c]) * w;
  });
  return out;
};
interface Bucket { px: number[][]; c: number; range: number; }
const bucket = (px: number[][]): Bucket => {
  let c = 0, range = -1;
  for (let k = 0; k < 3; k++) {
    let lo = 255, hi = 0;
    for (const q of px) { if (q[k] < lo) lo = q[k]; if (q[k] > hi) hi = q[k]; }
    if (hi - lo > range) { range = hi - lo; c = k; }
  }
  return { px, c, range };
};
/** Median cut: up to `n` colours fitted to the box's own pixels (see-through ones left out; big areas are sampled). */
export function fitPalette(src: Bitmap, b: Box, n: number): number[][] {
  const W = src.width, d = src.data, total = b.w * b.h, stride = Math.max(1, Math.floor(total / 60000)), px: number[][] = [];
  for (let k = 0; k < total; k += stride) {
    const i = ((b.y + Math.floor(k / b.w)) * W + b.x + (k % b.w)) * 4;
    if (d[i + 3]) px.push([d[i], d[i + 1], d[i + 2]]);
  }
  if (!px.length) return [[0, 0, 0]];
  const boxes = [bucket(px)];
  while (boxes.length < n) {
    let best = -1;
    for (let j = 0; j < boxes.length; j++) if (boxes[j].px.length > 1 && boxes[j].range > 0 && (best < 0 || boxes[j].range > boxes[best].range)) best = j;
    if (best < 0) break;
    const { px: all, c } = boxes[best], sorted = all.slice().sort((u, v) => u[c] - v[c]), m = sorted.length >> 1;
    boxes.splice(best, 1, bucket(sorted.slice(0, m)), bucket(sorted.slice(m)));
  }
  return boxes.map(({ px: all }) => {
    const s = [0, 0, 0];
    for (const q of all) for (let c = 0; c < 3; c++) s[c] += q[c];
    return s.map((v) => Math.round(v / all.length));
  });
}
/** Every pixel of the box becomes its nearest palette colour (found once per small colour cell), optionally with dots. */
function toPalette(src: Bitmap, b: Box, pal: number[][], spread: boolean): Uint8ClampedArray {
  const out = src.data.slice(), cache = new Int16Array(32768).fill(-1);
  diffuse(src, b, out, (r, g, bl, o) => {
    const R = clamp(Math.round(r), 0, 255) >> 3, G = clamp(Math.round(g), 0, 255) >> 3, B = clamp(Math.round(bl), 0, 255) >> 3, key = (R << 10) | (G << 5) | B;
    let j = cache[key];
    if (j < 0) {
      let best = Infinity;
      const tr = R * 8 + 4, tg = G * 8 + 4, tb = B * 8 + 4;
      for (let k = 0; k < pal.length; k++) {
        const e = (pal[k][0] - tr) ** 2 + (pal[k][1] - tg) ** 2 + (pal[k][2] - tb) ** 2;
        if (e < best) { best = e; j = k; }
      }
      cache[key] = j;
    }
    o[0] = pal[j][0]; o[1] = pal[j][1]; o[2] = pal[j][2];
  }, spread);
  return out;
}
const reduceColors: Fx = (src, p, b) => toPalette(src, b, fitPalette(src, b, clamp(Math.round(num(p, 'count', 8)), 2, 256)), num(p, 'dither', 0) > 0);
const WEB = Array.from({ length: 216 }, (_, i) => [Math.floor(i / 36) * 51, (Math.floor(i / 6) % 6) * 51, (i % 6) * 51]);
const GREYS = Array.from({ length: 16 }, (_, i) => [i * 17, i * 17, i * 17]);
const indexed: Fx = (src, p, b) => {
  const which = clamp(Math.round(num(p, 'palette', 0)), 0, 3);
  const pal = which === 1 ? WEB : which === 2 ? GREYS : which === 3 ? [[0, 0, 0], [255, 255, 255]] : fitPalette(src, b, 256);
  return toPalette(src, b, pal, num(p, 'dither', 1) > 0);
};

export const MORE = {
  'spin-blur': spinBlur, 'lens-fix': lensFix, glass, 'ocean-ripple': oceanRipple, 'lens-flare': lensFlare, lighting, 'color-to-alpha': colorToAlpha,
  dither, 'replace-color': replaceColor, 'reduce-colors': reduceColors, indexed,
} satisfies Partial<Record<FxKind, Fx>>;
