// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bend and twist (distort), graphic effects (stylize), blocks and dots (pixelate) and pattern makers (render).
 * Distortions centre on the edited box; random-looking effects use a seeded pattern so preview and apply agree.
 */
import type { Bitmap } from '../document';
import { gaussianBlur } from '../filters';
import type { FxKind } from './meta';
import {
  type Box, type Fx, clamp, extremePlane, fbm, hash, luma, makeSampler, num, planeOf, premul, rgbOf, sobel, unpremul, vnoise, warp,
} from './lib';

const centre = (b: Box): [number, number] => [b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.5];
const same = (o: Float64Array, x: number, y: number): void => { o[0] = x; o[1] = y; };
const seedOf = (p: Record<string, number | undefined>, k: number): number => Math.round(num(p, 'seed', 1)) * k;
function eachBox(b: Box, f: (x: number, y: number) => void): void { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) f(x, y); }

// ---------- bend and twist ----------
const pinch: Fx = (src, p, b) => {
  const [cx, cy] = centre(b), R = Math.min(b.w, b.h) / 2, a = clamp(num(p, 'amount', 50) / 100, -1, 1);
  return warp(src, b, (x, y, o) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d >= R || d < 1e-3) return same(o, x, y);
    const f = Math.pow(Math.sin((Math.PI / 2) * (d / R)), -a);
    o[0] = cx + dx * f; o[1] = cy + dy * f;
  });
};
const twirl: Fx = (src, p, b) => {
  const [cx, cy] = centre(b), R = Math.min(b.w, b.h) / 2, ang = (num(p, 'angle', 90) * Math.PI) / 180;
  return warp(src, b, (x, y, o) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d >= R) return same(o, x, y);
    const t = 1 - d / R, a = ang * t * t, c = Math.cos(a), s = Math.sin(a);
    o[0] = cx + dx * c - dy * s; o[1] = cy + dx * s + dy * c;
  });
};
const WAVES = [
  (t: number): number => Math.sin(2 * Math.PI * t),
  (t: number): number => 1 - 4 * Math.abs(((((t + 0.25) % 1) + 1) % 1) - 0.5),
  (t: number): number => (Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1),
];
const ripple: Fx = (src, p, b) => {
  const lam = [6, 12, 24][clamp(Math.round(num(p, 'size', 1)), 0, 2)], A = (num(p, 'amount', 100) / 100) * lam * 0.3;
  return warp(src, b, (x, y, o) => { o[0] = x + A * Math.sin((2 * Math.PI * y) / lam); o[1] = y + A * Math.sin((2 * Math.PI * x) / lam); });
};
const wave: Fx = (src, p, b) => {
  const lam = Math.max(2, num(p, 'wavelength', 60)), A = num(p, 'amplitude', 10), f = WAVES[clamp(Math.round(num(p, 'type', 0)), 0, 2)], dir = Math.round(num(p, 'dir', 0));
  return warp(src, b, (x, y, o) => { o[0] = dir === 2 ? x : x + A * f((y - b.y) / lam); o[1] = dir === 1 ? y : y + A * f((x - b.x) / lam); });
};
const polar: Fx = (src, p, b) => {
  const [cx, cy] = centre(b), hw = b.w / 2, hh = b.h / 2, TAU = Math.PI * 2;
  if (num(p, 'mode', 0) === 1) {
    return warp(src, b, (x, y, o) => {
      const th = ((x - b.x + 0.5) / b.w) * TAU, rr = (y - b.y + 0.5) / b.h;
      o[0] = cx + rr * Math.sin(th) * hw; o[1] = cy - rr * Math.cos(th) * hh;
    });
  }
  return warp(src, b, (x, y, o) => {
    const u = (x - cx) / hw, v = (y - cy) / hh, rr = Math.min(1, Math.hypot(u, v)), th = (Math.atan2(u, -v) / TAU + 1) % 1;
    o[0] = b.x + th * b.w - 0.5; o[1] = b.y + rr * (b.h - 1);
  }, true);
};
const spherize: Fx = (src, p, b) => {
  const [cx, cy] = centre(b), a = clamp(num(p, 'amount', 60) / 100, -1, 1), mode = Math.round(num(p, 'mode', 0)), hw = b.w / 2, hh = b.h / 2;
  const k = a >= 0 ? a * 0.6 : -a * 0.45, f = (d: number): number => (a >= 0 ? d * (1 - k) + k * d * d * d : d * (1 + k) - k * d * d * d);
  return warp(src, b, (x, y, o) => {
    let u = (x - cx) / hw, v = (y - cy) / hh;
    if (mode === 1) { if (Math.abs(u) < 1) u = Math.sign(u) * f(Math.abs(u)); } else if (mode === 2) { if (Math.abs(v) < 1) v = Math.sign(v) * f(Math.abs(v)); } else {
      const d = Math.hypot(u, v);
      if (d < 1 && d > 1e-6) { const s = f(d) / d; u *= s; v *= s; }
    }
    o[0] = cx + u * hw; o[1] = cy + v * hh;
  });
};
const zigzag: Fx = (src, p, b) => {
  const [cx, cy] = centre(b), R = Math.min(b.w, b.h) / 2, a = clamp(num(p, 'amount', 30), -100, 100) / 100, n = clamp(num(p, 'ridges', 5), 1, 20), style = Math.round(num(p, 'style', 0));
  return warp(src, b, (x, y, o) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d >= R || d < 1e-3) return same(o, x, y);
    const t = d / R, disp = a * (R / n) * 0.5 * Math.sin(2 * Math.PI * n * t) * (1 - t);
    const rad = style === 2 ? 0 : disp, ang = style === 1 ? 0 : (style === 2 ? disp : disp * 0.5) / d, s = (d + rad) / d, c = Math.cos(ang), sn = Math.sin(ang);
    o[0] = cx + (dx * c - dy * sn) * s; o[1] = cy + (dx * sn + dy * c) * s;
  });
};
const displace: Fx = (src, p, b) => {
  const { width: W, data: d } = src, sx = (num(p, 'hscale', 15) / 100) * 64, sy = (num(p, 'vscale', 15) / 100) * 64, own = num(p, 'map', 0) === 1, size = Math.max(2, num(p, 'size', 40)), s = seedOf(p, 131);
  return warp(src, b, (x, y, o) => {
    let mx: number, my: number;
    if (own) { const i = (y * W + x) * 4; mx = (luma(d[i], d[i + 1], d[i + 2]) / 255) * 2 - 1; my = mx; } else {
      const u = (x - b.x) / size, v = (y - b.y) / size;
      mx = clamp((fbm(u, v, 4, s) - 0.5) * 3, -1, 1); my = clamp((fbm(u, v, 4, s + 57) - 0.5) * 3, -1, 1);
    }
    o[0] = x + mx * sx; o[1] = y + my * sy;
  });
};
const shear: Fx = (src, p, b) => {
  const a = clamp(num(p, 'amount', 30), -100, 100) / 100, k = [1, 2, 4][clamp(Math.round(num(p, 'shape', 0)), 0, 2)], wrapEdges = Math.round(num(p, 'edge', 0)) === 0;
  return warp(src, b, (x, y, o) => { o[0] = x - a * (b.w / 4) * Math.sin(Math.PI * k * ((y - b.y) / Math.max(1, b.h - 1))); o[1] = y; }, wrapEdges);
};

// ---------- graphic effects ----------
const emboss: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, out = d.slice(), a = (num(p, 'angle', 135) * Math.PI) / 180, h = clamp(num(p, 'height', 3), 1, 100), amt = num(p, 'amount', 100) / 100;
  const colour = num(p, 'color', 0) > 0, ox = Math.round(Math.cos(a) * h), oy = Math.round(-Math.sin(a) * h);
  const at = (x: number, y: number): number => { const i = (clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4; return luma(d[i], d[i + 1], d[i + 2]); };
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4, dl = (at(x + ox, y + oy) - at(x - ox, y - oy)) * amt;
    if (colour) for (let c = 0; c < 3; c++) out[i + c] = d[i + c] + dl;
    else { out[i] = 128 + dl; out[i + 1] = 128 + dl; out[i + 2] = 128 + dl; }
  });
  return out;
};
const findEdges: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, k = num(p, 'strength', 100) / 100, out = d.slice();
  for (let c = 0; c < 3; c++) { const e = sobel(planeOf(src, c), W, H); eachBox(b, (x, y) => { const j = y * W + x; out[j * 4 + c] = 255 - e[j] * k; }); }
  return out;
};
const solarize: Fx = (src, p, b) => {
  const { width: W, data: d } = src, t = num(p, 'level', 128), out = d.slice();
  eachBox(b, (x, y) => { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) { const v = d[i + c]; out[i + c] = v > t ? 255 - v : v; } });
  return out;
};
/** Oil paint: each pixel takes the average colour of the most common brightness in its neighbourhood, plus a raised shine. */
const oilPaint: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, r = clamp(Math.round(num(p, 'radius', 4)), 1, 20), L = clamp(Math.round(num(p, 'levels', 20)), 4, 64), shine = clamp(num(p, 'shine', 40), 0, 100) / 100;
  const lev = new Uint8Array(W * H), out = d.slice(), cnt = new Int32Array(L), sr = new Float64Array(L), sg = new Float64Array(L), sb = new Float64Array(L);
  for (let j = 0; j < W * H; j++) lev[j] = Math.min(L - 1, Math.floor((luma(d[j * 4], d[j * 4 + 1], d[j * 4 + 2]) * L) / 256));
  const add = (j: number, s: number): void => { const i = j * 4; if (!d[i + 3]) return; const k = lev[j]; cnt[k] += s; sr[k] += s * d[i]; sg[k] += s * d[i + 1]; sb[k] += s * d[i + 2]; };
  for (let y = b.y; y < b.y + b.h; y++) {
    cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let yy = y0; yy <= y1; yy++) for (let xx = Math.max(0, b.x - r); xx <= Math.min(W - 1, b.x + r); xx++) add(yy * W + xx, 1);
    for (let x = b.x; x < b.x + b.w; x++) {
      if (x > b.x) { const xo = x - r - 1, xi = x + r; for (let yy = y0; yy <= y1; yy++) { if (xo >= 0) add(yy * W + xo, -1); if (xi < W) add(yy * W + xi, 1); } }
      const i = (y * W + x) * 4;
      if (!d[i + 3]) continue;
      let best = 0;
      for (let k = 1; k < L; k++) if (cnt[k] > cnt[best]) best = k;
      const n = cnt[best];
      if (n > 0) { out[i] = sr[best] / n; out[i + 1] = sg[best] / n; out[i + 2] = sb[best] / n; }
    }
  }
  if (!shine) return out;
  const Lp = new Float32Array(W * H), res = out.slice();
  for (let j = 0; j < W * H; j++) Lp[j] = luma(out[j * 4], out[j * 4 + 1], out[j * 4 + 2]);
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) return;
    const dl = (Lp[clamp(y - 1, 0, H - 1) * W + clamp(x - 1, 0, W - 1)] - Lp[clamp(y + 1, 0, H - 1) * W + clamp(x + 1, 0, W - 1)]) * shine * 0.6;
    for (let c = 0; c < 3; c++) res[i + c] = out[i + c] + dl;
  });
  return res;
};
/** Wind: bright colours stream downwind into darker areas and fade out. */
const wind: Fx = (src, p, b) => {
  const { width: W, data: d } = src, out = d.slice(), len = clamp(num(p, 'length', 30), 2, 400), fromLeft = num(p, 'dir', 0) === 1, method = Math.round(num(p, 'method', 0)), s = seedOf(p, 71);
  for (let y = b.y; y < b.y + b.h; y++) {
    const Lr = method === 2 ? len * (0.4 + hash(0, y, s) * 1.2) : method === 1 ? len * 2 : len, decay = 1 - 1 / Math.max(2, Lr), strong = method === 1 ? 1 : 0.85;
    let tr = 0, tg = 0, tb = 0, tl = -1, w = 0;
    const step = fromLeft ? 1 : -1, end = fromLeft ? b.x + b.w : b.x - 1;
    for (let x = fromLeft ? 0 : W - 1; x !== end; x += step) {
      const i = (y * W + x) * 4;
      w *= decay;
      if (!d[i + 3]) continue;
      const l = luma(d[i], d[i + 1], d[i + 2]);
      if (l >= tl || w < 0.05) { tr = d[i]; tg = d[i + 1]; tb = d[i + 2]; tl = l; w = method === 1 ? 1 : 0.6 + 0.4 * hash(x, y, s); continue; }
      if (x < b.x || x >= b.x + b.w) continue;
      const k = w * strong;
      out[i] = d[i] + (tr - d[i]) * k; out[i + 1] = d[i + 1] + (tg - d[i + 1]) * k; out[i + 2] = d[i + 2] + (tb - d[i + 2]) * k;
    }
  }
  return out;
};
const diffuse: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, out = d.slice(), r = clamp(num(p, 'radius', 4), 1, 100), mode = Math.round(num(p, 'mode', 0)), s = seedOf(p, 37);
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4, j = (clamp(Math.round(y + (hash(x, y, s + 1) * 2 - 1) * r), 0, H - 1) * W + clamp(Math.round(x + (hash(x, y, s) * 2 - 1) * r), 0, W - 1)) * 4;
    if (mode) { const lp = luma(d[i], d[i + 1], d[i + 2]), lq = luma(d[j], d[j + 1], d[j + 2]); if (mode === 1 ? lq >= lp : lq <= lp) return; }
    out[i] = d[j]; out[i + 1] = d[j + 1]; out[i + 2] = d[j + 2]; out[i + 3] = d[j + 3];
  });
  return out;
};
const tiles: Fx = (src, p, b) => {
  const { width: W, data: d } = src, out = d.slice(), n = clamp(Math.round(num(p, 'count', 8)), 1, 99), size = Math.max(1, Math.ceil(b.w / n));
  const m = (clamp(num(p, 'offset', 10), 0, 99) / 100) * size, fill = Math.round(num(p, 'fill', 0)), s = seedOf(p, 53), [br, bg, bb] = rgbOf(num(p, 'bg', 0xffffff));
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (fill === 0) { out[i] = br; out[i + 1] = bg; out[i + 2] = bb; out[i + 3] = 255; } else if (fill === 1) { out[i] = 255 - d[i]; out[i + 1] = 255 - d[i + 1]; out[i + 2] = 255 - d[i + 2]; } else if (fill === 3) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0; }
  });
  for (let ty = 0; ty * size < b.h; ty++) for (let tx = 0; tx * size < b.w; tx++) {
    const jx = hash(tx, ty, s) * 2 - 1, jy = hash(tx, ty, s + 1) * 2 - 1;
    const ox = m > 0 ? Math.round(jx * m) || (jx < 0 ? -1 : 1) : 0, oy = m > 0 ? Math.round(jy * m) || (jy < 0 ? -1 : 1) : 0;
    for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      const sx = b.x + tx * size + xx, sy = b.y + ty * size + yy, dx = sx + ox, dy = sy + oy;
      if (sx >= b.x + b.w || sy >= b.y + b.h || dx < b.x || dy < b.y || dx >= b.x + b.w || dy >= b.y + b.h) continue;
      const si = (sy * W + sx) * 4, di = (dy * W + dx) * 4;
      out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = d[si + 3];
    }
  }
  return out;
};
/** Blocks or pyramids: block colours from the average of each square; blocks rise toward you by their brightness. */
const extrude: Fx = (src, p, b) => {
  const { width: W, data: d } = src, s = clamp(Math.round(num(p, 'size', 16)), 2, 255), depth = clamp(num(p, 'depth', 30), 1, 255), pyr = num(p, 'type', 0) === 1, solid = num(p, 'solid', 0) > 0;
  const nx = Math.ceil(b.w / s), ny = Math.ceil(b.h / s), mean = new Float32Array(nx * ny * 5), out = d.slice();
  const blockOf = (x: number, y: number): number => (((y - b.y) / s) | 0) * nx + (((x - b.x) / s) | 0);
  eachBox(b, (x, y) => { const i = (y * W + x) * 4, k = blockOf(x, y) * 5, a = d[i + 3]; mean[k] += d[i] * a; mean[k + 1] += d[i + 1] * a; mean[k + 2] += d[i + 2] * a; mean[k + 3] += a; mean[k + 4]++; });
  for (let k = 0; k < nx * ny * 5; k += 5) { const a = mean[k + 3]; if (a) { mean[k] /= a; mean[k + 1] /= a; mean[k + 2] /= a; } mean[k + 3] = a / Math.max(1, mean[k + 4]); }
  const put = (o: number, k: number, f: number): void => { out[o] = mean[k] * f; out[o + 1] = mean[k + 1] * f; out[o + 2] = mean[k + 2] * f; out[o + 3] = mean[k + 3]; };
  if (pyr) {
    const kk = Math.min(1, depth / 100);
    eachBox(b, (x, y) => {
      const bx = ((x - b.x) / s) | 0, by = ((y - b.y) / s) | 0, bw = Math.min(s, b.w - bx * s), bh = Math.min(s, b.h - by * s);
      const u = (x - b.x - bx * s + 0.5) / bw - 0.5, v = (y - b.y - by * s + 0.5) / bh - 0.5;
      const f = Math.abs(u) > Math.abs(v) ? (u < 0 ? 1 + 0.15 * kk : 1 - 0.25 * kk) : v < 0 ? 1 + 0.35 * kk : 1 - 0.45 * kk;
      put((y * W + x) * 4, (by * nx + bx) * 5, f);
    });
    return out;
  }
  eachBox(b, (x, y) => put((y * W + x) * 4, blockOf(x, y) * 5, 0.45));
  const order = Array.from({ length: nx * ny }, (_, k) => k).sort((a, c) => luma(mean[a * 5], mean[a * 5 + 1], mean[a * 5 + 2]) - luma(mean[c * 5], mean[c * 5 + 1], mean[c * 5 + 2]));
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, md = Math.hypot(b.w, b.h) / 2 || 1;
  for (const k of order) {
    const x0 = b.x + (k % nx) * s, y0 = b.y + ((k / nx) | 0) * s, bw = Math.min(s, b.x + b.w - x0), bh = Math.min(s, b.y + b.h - y0), k5 = k * 5;
    const hgt = luma(mean[k5], mean[k5 + 1], mean[k5 + 2]) / 255, vx = ((x0 + bw / 2 - cx) / md) * depth * hgt, vy = ((y0 + bh / 2 - cy) / md) * depth * hgt;
    const steps = Math.max(1, Math.ceil(Math.hypot(vx, vy)));
    for (let t = 0; t <= steps; t++) {
      const f = t / steps, ox = Math.round(vx * f), oy = Math.round(vy * f), front = t === steps;
      for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
        const X = x0 + xx + ox, Y = y0 + yy + oy;
        if (X < b.x || Y < b.y || X >= b.x + b.w || Y >= b.y + b.h) continue;
        const o = (Y * W + X) * 4, si = ((y0 + yy) * W + x0 + xx) * 4;
        if (front && !solid) { out[o] = d[si]; out[o + 1] = d[si + 1]; out[o + 2] = d[si + 2]; out[o + 3] = d[si + 3]; } else put(o, k5, front ? 1 : 0.5 + 0.35 * f);
      }
    }
  }
  return out;
};
const traceContour: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, t = num(p, 'level', 128), upper = num(p, 'edge', 1) === 1, out = d.slice();
  const inside = (i: number): boolean => (upper ? d[i] >= t : d[i] <= t);
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const a = inside(i + c), r = x + 1 < W ? inside(i + 4 + c) : a, dn = y + 1 < H ? inside(i + W * 4 + c) : a;
      out[i + c] = a !== r || a !== dn ? 0 : 255;
    }
  });
  return out;
};
const glowingEdges: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, width = clamp(Math.round(num(p, 'width', 2)), 1, 14), k = clamp(num(p, 'bright', 8), 0, 20) / 6;
  const soft: Bitmap = { width: W, height: H, data: gaussianBlur(src, clamp(num(p, 'smooth', 5), 1, 15) * 0.3) }, out = d.slice();
  for (let c = 0; c < 3; c++) {
    let e = sobel(planeOf(soft, c), W, H);
    if (width > 1) e = extremePlane(e, W, H, width - 1, true);
    eachBox(b, (x, y) => { const j = y * W + x; out[j * 4 + c] = e[j] * k; });
  }
  return out;
};

// ---------- blocks and dots ----------
const mosaic: Fx = (src, p, b) => {
  const { width: W, data: d } = src, s = clamp(Math.round(num(p, 'size', 12)), 1, 2000), out = d.slice();
  for (let by = b.y; by < b.y + b.h; by += s) for (let bx = b.x; bx < b.x + b.w; bx += s) {
    const ex = Math.min(bx + s, b.x + b.w), ey = Math.min(by + s, b.y + b.h);
    let r = 0, g = 0, bl = 0, a = 0, n = 0;
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * W + x) * 4, al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; bl += d[i + 2] * al; a += al; n++; }
    const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? bl / a : 0, A = a / n;
    for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * W + x) * 4; out[i] = R; out[i + 1] = G; out[i + 2] = B; out[i + 3] = A; }
  }
  return out;
};
/** Seed points on a jittered grid over the box, and the nearest one for any pixel. */
function cells(b: Box, s: number, seed: number): { nx: number; sx: Float32Array; sy: Float32Array; nearest: (x: number, y: number, r2?: number, pr?: Float32Array) => number } {
  const nx = Math.ceil(b.w / s) + 1, ny = Math.ceil(b.h / s) + 1, sx = new Float32Array(nx * ny), sy = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { sx[j * nx + i] = b.x + (i + 0.15 + 0.7 * hash(i, j, seed)) * s; sy[j * nx + i] = b.y + (j + 0.15 + 0.7 * hash(i, j, seed + 1)) * s; }
  const nearest = (x: number, y: number, r2 = Infinity, pr?: Float32Array): number => {
    const ci = Math.floor((x - b.x) / s), cj = Math.floor((y - b.y) / s);
    let best = -1, bd = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i, dd = (x - sx[k]) ** 2 + (y - sy[k]) ** 2;
      if (dd >= r2) continue;
      const score = pr ? -pr[k] : dd;
      if (score < bd) { bd = score; best = k; }
    }
    return best;
  };
  return { nx, sx, sy, nearest };
}
const crystallize: Fx = (src, p, b) => {
  const { width: W, data: d } = src, s = clamp(num(p, 'size', 16), 3, 500), cs = cells(b, s, seedOf(p, 29)), sum = new Float64Array(cs.sx.length * 5), cell = new Int32Array(b.w * b.h), out = d.slice();
  eachBox(b, (x, y) => {
    const k = cs.nearest(x, y), i = (y * W + x) * 4, a = d[i + 3];
    cell[(y - b.y) * b.w + x - b.x] = k;
    sum[k * 5] += d[i] * a; sum[k * 5 + 1] += d[i + 1] * a; sum[k * 5 + 2] += d[i + 2] * a; sum[k * 5 + 3] += a; sum[k * 5 + 4]++;
  });
  eachBox(b, (x, y) => {
    const k = cell[(y - b.y) * b.w + x - b.x] * 5, a = sum[k + 3], i = (y * W + x) * 4;
    out[i] = a ? sum[k] / a : 0; out[i + 1] = a ? sum[k + 1] / a : 0; out[i + 2] = a ? sum[k + 2] / a : 0; out[i + 3] = a / sum[k + 4];
  });
  return out;
};
const pointillize: Fx = (src, p, b) => {
  const { width: W, data: d } = src, s = clamp(num(p, 'size', 10), 3, 500), sd = seedOf(p, 41), cs = cells(b, s, sd), n = cs.sx.length, [br, bg, bb] = rgbOf(num(p, 'bg', 0xffffff));
  const col = new Float32Array(n * 3), pr = new Float32Array(n), out = d.slice();
  for (let k = 0; k < n; k++) {
    const x = clamp(Math.round(cs.sx[k]), b.x, b.x + b.w - 1), y = clamp(Math.round(cs.sy[k]), b.y, b.y + b.h - 1), i = (y * W + x) * 4, f = 0.92 + 0.16 * hash(k, 3, sd);
    col[k * 3] = d[i] * f; col[k * 3 + 1] = d[i + 1] * f; col[k * 3 + 2] = d[i + 2] * f; pr[k] = hash(k, 7, sd);
  }
  const r2 = (s * 0.62) ** 2;
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4;
    if (!d[i + 3]) return;
    const k = cs.nearest(x, y, r2, pr);
    if (k < 0) { out[i] = br; out[i + 1] = bg; out[i + 2] = bb; } else { out[i] = col[k * 3]; out[i + 1] = col[k * 3 + 1]; out[i + 2] = col[k * 3 + 2]; }
  });
  return out;
};
/** Colour halftone: each colour channel becomes a screen of round dots at its own angle, bigger where it is darker. */
const halftone: Fx = (src, p, b) => {
  const { width: W, data: d } = src, cell = clamp(num(p, 'radius', 8), 2, 127) * 1.414, ANG = [108, 162, 90], out = d.slice();
  for (let c = 0; c < 3; c++) {
    const a = (ANG[c] * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    eachBox(b, (x, y) => {
      const i = (y * W + x) * 4;
      if (!d[i + 3]) return;
      const lx = x - b.x, ly = y - b.y, u = lx * cs + ly * sn, v = -lx * sn + ly * cs, cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
      const px = clamp(Math.round(b.x + cu * cs - cv * sn), b.x, b.x + b.w - 1), py = clamp(Math.round(b.y + cu * sn + cv * cs), b.y, b.y + b.h - 1);
      const rr = cell * 0.7072 * Math.sqrt(1 - d[(py * W + px) * 4 + c] / 255);
      out[i + c] = 255 * clamp(Math.hypot(u - cu, v - cv) - rr + 0.5, 0, 1);
    });
  }
  return out;
};
const mezzotint: Fx = (src, p, b) => {
  const { width: W, data: d } = src, type = clamp(Math.round(num(p, 'type', 0)), 0, 3), s = seedOf(p, 17), out = d.slice();
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const n = type === 0 ? hash(x, y, s + c) : type === 1 ? 0.5 * hash(x >> 1, y >> 1, s + c) + 0.5 * hash(x, y, s + c + 7) : hash(Math.floor(x / (type === 2 ? 4 : 16)), y, s + c);
      out[i + c] = d[i + c] > n * 255 ? 255 : 0;
    }
  });
  return out;
};
/** Mean of every (r+1)×(r+1) window whose top-left pixel is (x, y), clamped to the bitmap. */
function windowMean(f: Float32Array, W: number, H: number, r: number): Float32Array {
  const t = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = 0; x <= Math.min(W - 1, r); x++) acc += f[y * W + x];
    for (let x = 0; x < W; x++) { t[y * W + x] = acc / (Math.min(W - 1, x + r) - x + 1); acc -= f[y * W + x]; if (x + r + 1 < W) acc += f[y * W + x + r + 1]; }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = 0; y <= Math.min(H - 1, r); y++) acc += t[y * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = acc / (Math.min(H - 1, y + r) - y + 1); acc -= t[y * W + x]; if (y + r + 1 < H) acc += t[(y + r + 1) * W + x]; }
  }
  return out;
}
/** Facet (a Kuwahara filter): each pixel takes the average of whichever corner patch around it is the most even. */
const facet: Fx = (src, p, b) => {
  const { width: W, height: H, data: d } = src, r = clamp(Math.round(num(p, 'radius', 3)), 1, 20), L = planeOf(src, 3), L2 = new Float32Array(W * H), out = d.slice();
  for (let j = 0; j < W * H; j++) L2[j] = L[j] * L[j];
  const mL = windowMean(L, W, H, r), mL2 = windowMean(L2, W, H, r), pick = new Int32Array(b.w * b.h);
  const at = (x: number, y: number): number => clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1);
  eachBox(b, (x, y) => {
    let best = 0, bv = Infinity;
    for (const [qx, qy] of [[x - r, y - r], [x, y - r], [x - r, y], [x, y]]) { const k = at(qx, qy), v = mL2[k] - mL[k] * mL[k]; if (v < bv) { bv = v; best = k; } }
    pick[(y - b.y) * b.w + x - b.x] = best;
  });
  const A = windowMean(alphaPlane(d, W * H), W, H, r);
  for (let c = 0; c < 3; c++) {
    const m = windowMean(planeOf(src, c), W, H, r);
    eachBox(b, (x, y) => { const i = (y * W + x) * 4, k = pick[(y - b.y) * b.w + x - b.x]; if (d[i + 3] && A[k] > 0) out[i + c] = (m[k] * 255) / A[k]; });
  }
  return out;
};
function alphaPlane(d: Uint8ClampedArray, n: number): Float32Array { const f = new Float32Array(n); for (let j = 0; j < n; j++) f[j] = d[j * 4 + 3]; return f; }
const fragment: Fx = (src, p, b) => {
  const W = src.width, dd = clamp(num(p, 'distance', 4), 1, 200), pm = premul(src), get = makeSampler(pm, W, { x: 0, y: 0, w: W, h: src.height }), out = pm.slice(), px = new Float32Array(4);
  eachBox(b, (x, y) => {
    const i = (y * W + x) * 4;
    let r = 0, g = 0, bl = 0, a = 0;
    for (const [ox, oy] of [[dd, dd], [-dd, dd], [dd, -dd], [-dd, -dd]]) { get(x + ox, y + oy, px); r += px[0]; g += px[1]; bl += px[2]; a += px[3]; }
    out[i] = r / 4; out[i + 1] = g / 4; out[i + 2] = bl / 4; out[i + 3] = a / 4;
  });
  return unpremul(out);
};

// ---------- pattern makers ----------
function cloudsFx(diff: boolean): Fx {
  return (src, p, b) => {
    const { width: W, data: d } = src, size = Math.max(2, num(p, 'size', 120)), oct = clamp(Math.round(num(p, 'detail', 5)), 1, 10), s = seedOf(p, 101), out = d.slice();
    const [fr, fg, fb] = rgbOf(num(p, 'fg', 0)), [br, bg, bb] = rgbOf(num(p, 'bg', 0xffffff));
    eachBox(b, (x, y) => {
      const i = (y * W + x) * 4, v = clamp((fbm((x - b.x) / size, (y - b.y) / size, oct, s) - 0.5) * 1.8 + 0.5, 0, 1);
      const r = fr + (br - fr) * v, g = fg + (bg - fg) * v, bl = fb + (bb - fb) * v;
      if (diff) { out[i] = Math.abs(d[i] - r); out[i + 1] = Math.abs(d[i + 1] - g); out[i + 2] = Math.abs(d[i + 2] - bl); } else { out[i] = r; out[i + 1] = g; out[i + 2] = bl; out[i + 3] = 255; }
    });
    return out;
  };
}
const fibers: Fx = (src, p, b) => {
  const { width: W, data: d } = src, variance = clamp(num(p, 'variance', 16), 1, 64), strength = clamp(num(p, 'strength', 4), 1, 64), s = seedOf(p, 61), out = d.slice();
  const fx = 0.12 + (strength / 64) * 0.9, fy = 1 / (2 + variance * 3), [fr, fg, fb] = rgbOf(num(p, 'fg', 0)), [br, bg, bb] = rgbOf(num(p, 'bg', 0xffffff));
  eachBox(b, (x, y) => {
    const X = x - b.x, Y = y - b.y, i = (y * W + x) * 4;
    const v = clamp((0.7 * fbm(X * fx, Y * fy, 4, s) + 0.3 * vnoise(X * 0.9, Y * fy * 0.5, s + 9) - 0.5) * 2.2 + 0.5, 0, 1);
    out[i] = fr + (br - fr) * v; out[i + 1] = fg + (bg - fg) * v; out[i + 2] = fb + (bb - fb) * v; out[i + 3] = 255;
  });
  return out;
};

export const LOOKS = {
  pinch, twirl, ripple, wave, polar, spherize, zigzag, displace, shear, emboss, 'find-edges': findEdges, solarize, 'oil-paint': oilPaint, wind, diffuse,
  tiles, extrude, 'trace-contour': traceContour, 'glowing-edges': glowingEdges, mosaic, crystallize, pointillize, halftone, mezzotint, facet, fragment,
  clouds: cloudsFx(false), 'diff-clouds': cloudsFx(true), fibers,
} satisfies Partial<Record<FxKind, Fx>>;
