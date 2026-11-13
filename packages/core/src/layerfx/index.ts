// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Layer effects (design 2.7), loaded on first use so the first screen never downloads them. `installLayerFx()` hands the
 * compositor this engine; until then the screen draws layers plain and every flatten throws (composite.ts).
 *
 * S is the layer's shape: its alpha × its mask, from 0 to 1. Each effect makes a coverage plane from S (moved, grown,
 * blurred or measured from the edge) and is drawn in a fixed order, bottom to top: drop shadows and the outer glow behind
 * the layer; then the "unit": the layer's own pixels at Fill, the gradient and colour overlays, the inner glow, the inner
 * shadows and the outline, kept inside S, plus the outer part of the outline. All maths here is written for this project.
 *
 * Planes are made per 128 px tile of the document, over the tile grown by the layer's reach, so any split of the picture
 * into rows, bands or tiles gives the same bytes. Results are kept per settings object (a WeakMap; a change makes a new
 * object, so a moved slider never reads a stale entry) and dropped when pixels change in place (layerPixelsChanged).
 */
import type { BlendLayer, BlendMode } from '../blend';
import type { RGBA } from '../color';
import { blendSpan, layerFxGeneration, registerLayerFx, type FxRows, type LayerFxEngine } from '../composite';
import type { FxColor, FxGlow, FxGradient, FxShadow, FxStroke, LayerEffects } from '../document';
import type { Rect } from '../geometry';
import { maskRows } from '../mask';
import { distanceSquared } from '../selection';

export const FX_TILE = 128;
/** Tiles computed so far (tests count them to prove the cache). */
export const fxStats = { tiles: 0 };

const on = <T extends { on: boolean }>(e: T | undefined): e is T => !!e && e.on;
const px = (v: number): number => Math.max(0, Math.round(v));

/** How far past the layer's edge its effects can reach, in pixels (design 2.7's Reach column). */
export function fxReachOf(f: LayerEffects | undefined): number {
  if (!f || !f.on) return 0;
  let R = 0;
  for (const e of [...f.dropShadow, ...f.innerShadow]) if (e.on) R = Math.max(R, px(e.distance) + px(e.size) + 2);
  for (const e of [f.outerGlow, f.innerGlow]) if (on(e)) R = Math.max(R, px(e.size) + 2);
  for (const e of f.stroke) if (e.on) R = Math.max(R, px(e.size) + 1);
  return R;
}

// ---------- planes over the grown tile (gw × gh) ----------

/** out(x, y) = P(x − dx, y − dy); `outside` past the edge. */
function shifted(P: Float32Array, gw: number, gh: number, dx: number, dy: number, outside: number): Float32Array {
  if (!dx && !dy) return P;
  const out = new Float32Array(P.length);
  for (let y = 0; y < gh; y++) {
    const sy = y - dy;
    for (let x = 0; x < gw; x++) {
      const sx = x - dx;
      out[y * gw + x] = sx >= 0 && sx < gw && sy >= 0 && sy < gh ? P[sy * gw + sx] : outside;
    }
  }
  return out;
}
/** Coverage within `r` pixels of the plane's solid part (≥ 0.5), with a soft one-pixel edge; 1 inside. */
function near(P: Float32Array, gw: number, gh: number, r: number, solid: (v: number) => boolean): Float32Array {
  const d2 = distanceSquared(gw, gh, (i) => solid(P[i])), out = new Float32Array(P.length);
  for (let i = 0; i < out.length; i++) { const g = r + 1 - Math.sqrt(d2[i]); out[i] = g >= 1 ? 1 : g <= 0 ? 0 : g; }
  return out;
}
/** The plane grown by r pixels (spread, or choke for the inner kinds). */
function grown(P: Float32Array, gw: number, gh: number, r: number): Float32Array {
  if (r <= 0) return P;
  const g = near(P, gw, gh, r, (v) => v >= 0.5);
  for (let i = 0; i < g.length; i++) if (P[i] > g[i]) g[i] = P[i];
  return g;
}
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horiz: boolean): void {
  const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, k = 1 / (2 * r + 1);
  for (let ln = 0; ln < lines; ln++) {
    const base = horiz ? ln * w : ln;
    const at = (i: number): number => (i >= 0 && i < len ? src[base + i * step] : 0);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += at(i);
    for (let i = 0; i < len; i++) { dst[base + i * step] = sum * k; sum += at(i + r + 1) - at(i - r); }
  }
}
/** Three box blurs whose radii add up to `size`: a soft, nearly Gaussian edge that reaches exactly `size` pixels. */
function blurred(P: Float32Array, gw: number, gh: number, size: number): Float32Array {
  const s = px(size);
  if (!s) return P;
  const a = Math.floor(s / 3), radii = [a + (s % 3 > 0 ? 1 : 0), a + (s % 3 > 1 ? 1 : 0), a];
  const cur = Float32Array.from(P), tmp = new Float32Array(P.length);
  for (const r of radii) if (r > 0) { boxPass(cur, tmp, gw, gh, r, true); boxPass(tmp, cur, gw, gh, r, false); }
  return cur;
}
/** Where the shadow falls: away from the light, which comes from `angle` degrees (0 = from the right, 90 = from above). */
export function fxOffset(angle: number, distance: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [Math.round(-Math.cos(a) * distance), Math.round(Math.sin(a) * distance)];
}
/** A soft shape plane: grown by size × spread %, then blurred by the rest of size. */
function soft(P: Float32Array, gw: number, gh: number, size: number, spread: number): Float32Array {
  const s = px(size), g = Math.min(s, px((s * Math.max(0, Math.min(100, spread))) / 100));
  return blurred(grown(P, gw, gh, g), gw, gh, s - g);
}
function gradientAt(e: FxGradient, t: number, out: Float32Array, o: number): void {
  const st = [...e.stops].sort((a, b) => a.at - b.at);
  if (e.reverse) t = 1 - t;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let c = st[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 }, d = c, f = 0;
  for (let i = 0; i < st.length; i++) {
    if (t <= st[i].at) { d = st[i].color; c = i ? st[i - 1].color : d; const span = i ? st[i].at - st[i - 1].at : 0; f = span > 0 ? (t - st[i - 1].at) / span : 0; break; }
    c = d = st[i].color; f = 0;
  }
  out[o] = (c.r + (d.r - c.r) * f) / 255; out[o + 1] = (c.g + (d.g - c.g) * f) / 255;
  out[o + 2] = (c.b + (d.b - c.b) * f) / 255; out[o + 3] = (c.a + (d.a - c.a) * f) / 255;
}

// ---------- one tile ----------

interface Behind { cov: Float32Array; color: RGBA; blend: BlendMode; }
interface Tile { behind: Behind[]; unit: Float32Array; bytes: number; }

function computeTile(l: BlendLayer, f: LayerEffects, tx: number, ty: number, R: number): Tile {
  fxStats.tiles++;
  const T = FX_TILE, gx = tx * T - R, gy = ty * T - R, gw = T + 2 * R, gh = T + 2 * R, n = gw * gh;
  const S = new Float32Array(n);
  const bx0 = Math.max(gx, l.x), bx1 = Math.min(gx + gw, l.x + l.width), by0 = Math.max(gy, l.y), by1 = Math.min(gy + gh, l.y + l.height);
  if (bx0 < bx1 && by0 < by1) {
    const mk = l.mask ? maskRows(l.mask, { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }) : null, mrow = new Float32Array(bx1 - bx0);
    for (let y = by0; y < by1; y++) {
      if (mk) mk(y, bx0, bx1, mrow);
      let si = ((y - l.y) * l.width + (bx0 - l.x)) * 4, gi = (y - gy) * gw + (bx0 - gx);
      for (let j = 0; j < bx1 - bx0; j++, si += 4, gi++) S[gi] = (l.data[si + 3] / 255) * (mk ? mrow[j] : 1);
    }
  }
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = 1 - S[i];
  /** The tile's own T × T part of a plane (row-major), times k, knocked out under the shape when asked. */
  const crop = (P: Float32Array, k: number, knock: boolean): Float32Array => {
    const c = new Float32Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const gi = (y + R) * gw + x + R; c[y * T + x] = P[gi] * k * (knock ? 1 - S[gi] : 1); }
    return c;
  };
  const behind: Behind[] = [];
  for (const e of f.dropShadow.filter(on)) {
    const [dx, dy] = fxOffset(e.angle, e.distance);
    behind.push({ cov: crop(soft(shifted(S, gw, gh, dx, dy, 0), gw, gh, e.size, e.spread), e.opacity * (e.color.a / 255), true), color: e.color, blend: e.blend });
  }
  if (on(f.outerGlow)) { const e = f.outerGlow; behind.push({ cov: crop(soft(S, gw, gh, e.size, e.spread), e.opacity * (e.color.a / 255), true), color: e.color, blend: e.blend }); }

  // The unit: the own colour at Fill wherever the shape is, inside effects on top, then everything × the shape.
  const unit = new Float32Array(T * T * 4), fill = l.fillOpacity ?? 1, row = new Float32Array(T * 4), mix = new Float64Array(3);
  for (let y = 0; y < T; y++) {
    const dy = ty * T + y;
    if (dy < l.y || dy >= l.y + l.height) continue;
    for (let x = 0; x < T; x++) {
      const dx = tx * T + x;
      if (dx < l.x || dx >= l.x + l.width || !(S[(y + R) * gw + x + R] > 0)) continue;
      const si = ((dy - l.y) * l.width + (dx - l.x)) * 4, o = (y * T + x) * 4;
      unit[o] = l.data[si] / 255; unit[o + 1] = l.data[si + 1] / 255; unit[o + 2] = l.data[si + 2] / 255; unit[o + 3] = fill;
    }
  }
  /** One inside effect onto the unit: colour per pixel from `paint`, coverage from `cov` (T × T) or `k` alone. */
  const inside = (blend: BlendMode, k: number, cov: Float32Array | null, paint: (x: number, y: number, o: number) => void): void => {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) { paint(tx * T + x, ty * T + y, x * 4); row[x * 4 + 3] *= k * (cov ? cov[y * T + x] : 1); }
      blendSpan(unit, y * T * 4, row, 0, 1, 1, T, tx * T, ty * T + y, blend, null, mix);
    }
  };
  const flat = (c: RGBA) => (_x: number, _y: number, o: number): void => { row[o] = c.r / 255; row[o + 1] = c.g / 255; row[o + 2] = c.b / 255; row[o + 3] = c.a / 255; };
  for (const e of f.gradientOverlay.filter(on)) {
    const a = (e.angle * Math.PI) / 180, ca = Math.cos(a), sa = -Math.sin(a), cx = l.x + l.width / 2, cy = l.y + l.height / 2, sc = Math.max(0.01, e.scale);
    const half = ((Math.abs(l.width * ca) + Math.abs(l.height * sa)) / 2) * sc, rad = (Math.max(l.width, l.height) / 2) * sc;
    inside(e.blend, e.opacity, null, (x, y, o) => {
      const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
      gradientAt(e, e.shape === 'radial' ? Math.hypot(vx, vy) / Math.max(1e-6, rad) : 0.5 + (vx * ca + vy * sa) / Math.max(1e-6, 2 * half), row, o);
    });
  }
  for (const e of f.colorOverlay.filter(on)) inside(e.blend, e.opacity, null, flat(e.color));
  if (on(f.innerGlow)) {
    const e = f.innerGlow, P = soft(inv, gw, gh, e.size, e.spread), c = crop(P, 1, false);
    if (e.from === 'centre') for (let i = 0; i < c.length; i++) c[i] = 1 - c[i];
    inside(e.blend, e.opacity, c, flat(e.color));
  }
  for (const e of f.innerShadow.filter(on)) {
    const [dx, dy] = fxOffset(e.angle, e.distance);
    inside(e.blend, e.opacity, crop(soft(shifted(inv, gw, gh, dx, dy, 1), gw, gh, e.size, e.spread), 1, false), flat(e.color));
  }
  const strokes = f.stroke.filter(on);
  for (const e of strokes) {
    if (e.where === 'outside') continue;
    const r = e.where === 'centre' ? px(e.size) / 2 : px(e.size);
    inside(e.blend, e.opacity, crop(near(S, gw, gh, r, (v) => v < 0.5), 1, false), flat(e.color));
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) unit[(y * T + x) * 4 + 3] *= S[(y + R) * gw + x + R];
  // The outline's outer part lies beside the shape, so it adds to it: an exact fit at soft edges.
  for (const e of strokes) {
    if (e.where === 'inside') continue;
    const r = e.where === 'centre' ? px(e.size) / 2 : px(e.size), c = crop(near(S, gw, gh, r, (v) => v >= 0.5), e.opacity * (e.color.a / 255), true);
    const cr = e.color.r / 255, cg = e.color.g / 255, cb = e.color.b / 255;
    for (let i = 0; i < T * T; i++) {
      const s = c[i];
      if (!(s > 0)) continue;
      const o = i * 4, a = unit[o + 3], ao = Math.min(1, a + s), w = ao - a;
      unit[o] = (unit[o] * a + cr * w) / ao; unit[o + 1] = (unit[o + 1] * a + cg * w) / ao; unit[o + 2] = (unit[o + 2] * a + cb * w) / ao; unit[o + 3] = ao;
    }
  }
  return { behind, unit, bytes: unit.byteLength + behind.reduce((s, b) => s + b.cov.byteLength, 0) };
}

// ---------- the cache (WeakMap per settings object, L5) ----------

interface Entry { gen: number; data: Uint8ClampedArray; mask: unknown; x: number; y: number; w: number; h: number; fill: number | undefined; tiles: Map<string, Tile>; }
const cache = new WeakMap<LayerEffects, Entry>();
const lru = new Map<Tile, Map<string, Tile>>();
const CAP = 192 * 1024 * 1024;
let bytes = 0;
function entryFor(l: BlendLayer): Entry {
  const f = l.fx as LayerEffects, gen = layerFxGeneration();
  let e = cache.get(f);
  if (!e || e.gen !== gen || e.data !== l.data || e.mask !== l.mask || e.x !== l.x || e.y !== l.y || e.w !== l.width || e.h !== l.height || e.fill !== l.fillOpacity) {
    e = { gen, data: l.data, mask: l.mask, x: l.x, y: l.y, w: l.width, h: l.height, fill: l.fillOpacity, tiles: new Map() };
    cache.set(f, e);
  }
  return e;
}
function keep(m: Map<string, Tile>, k: string, t: Tile): void {
  m.set(k, t); lru.set(t, m); bytes += t.bytes;
  for (const [old, owner] of lru) {
    if (bytes <= CAP) break;
    lru.delete(old); bytes -= old.bytes;
    for (const [kk, v] of owner) if (v === old) { owner.delete(kk); break; }
  }
}

const engine: LayerFxEngine = {
  reach: (l) => fxReachOf(l.fx),
  rows(l: BlendLayer, _r: Rect, live: boolean): FxRows {
    const f = l.fx as LayerEffects, R = fxReachOf(f), T = FX_TILE, e = live ? null : entryFor(l), local = new Map<string, Tile>();
    const get = (tx: number, ty: number): Tile => {
      const k = tx + ',' + ty, m = e ? e.tiles : local;
      let t = m.get(k);
      if (!t) { t = computeTile(l, f, tx, ty, R); if (e) keep(m, k, t); else m.set(k, t); }
      return t;
    };
    const buf = new Float32Array(T * 4);
    return {
      behind(acc, ai, y, x0, x1, opacity, mix) {
        const ty = Math.floor(y / T), ry = y - ty * T;
        for (let x = x0; x < x1;) {
          const tx = Math.floor(x / T), xe = Math.min(x1, (tx + 1) * T), n = xe - x, t = get(tx, ty);
          for (const b of t.behind) {
            const cr = b.color.r / 255, cg = b.color.g / 255, cb = b.color.b / 255;
            for (let j = 0, k = ry * T + (x - tx * T); j < n; j++, k++) { buf[j * 4] = cr; buf[j * 4 + 1] = cg; buf[j * 4 + 2] = cb; buf[j * 4 + 3] = b.cov[k]; }
            blendSpan(acc, ai + (x - x0) * 4, buf, 0, opacity, 1, n, x, y, b.blend, null, mix);
          }
          x = xe;
        }
      },
      unit(y, x0, x1, out) {
        const ty = Math.floor(y / T), ry = y - ty * T;
        for (let x = x0; x < x1;) {
          const tx = Math.floor(x / T), xe = Math.min(x1, (tx + 1) * T), s = (ry * T + (x - tx * T)) * 4;
          out.set(get(tx, ty).unit.subarray(s, s + (xe - x) * 4), (x - x0) * 4);
          x = xe;
        }
      },
    };
  },
};
/** Hands the compositor this engine. Safe to call more than once. */
export function installLayerFx(): LayerFxEngine { registerLayerFx(engine); return engine; }

// ---------- new effects with their starting settings ----------

export type LayerFxKind = 'drop-shadow' | 'inner-shadow' | 'outer-glow' | 'inner-glow' | 'color-overlay' | 'gradient-overlay' | 'stroke';
export const LAYER_FX_KINDS: readonly LayerFxKind[] = ['drop-shadow', 'outer-glow', 'stroke', 'color-overlay', 'inner-shadow', 'inner-glow', 'gradient-overlay'];
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 }, WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 }, GLOW: RGBA = { r: 255, g: 255, b: 190, a: 255 };
export const emptyEffects = (): LayerEffects => ({ on: true, dropShadow: [], innerShadow: [], colorOverlay: [], gradientOverlay: [], stroke: [] });
const shadow = (distance: number, size: number): FxShadow => ({ on: true, blend: 'multiply', opacity: 0.75, color: BLACK, angle: 120, distance, spread: 0, size });
const glow = (from?: 'edge'): FxGlow => ({ on: true, blend: 'screen', opacity: 0.75, color: GLOW, spread: 0, size: 10, ...(from ? { from } : {}) });
/** A new effects object with one more effect of `kind` (the main colour for the overlay and the outline). Lists grow; single kinds are replaced. */
export function addLayerFx(f: LayerEffects | undefined, kind: LayerFxKind, color: RGBA = BLACK): LayerEffects {
  const x: LayerEffects = { ...(f ?? emptyEffects()), on: true };
  if (kind === 'drop-shadow') x.dropShadow = [...x.dropShadow, shadow(10, 10)];
  else if (kind === 'inner-shadow') x.innerShadow = [...x.innerShadow, shadow(5, 5)];
  else if (kind === 'outer-glow') x.outerGlow = glow();
  else if (kind === 'inner-glow') x.innerGlow = glow('edge');
  else if (kind === 'color-overlay') x.colorOverlay = [...x.colorOverlay, { on: true, blend: 'normal', opacity: 1, color } as FxColor];
  else if (kind === 'gradient-overlay') x.gradientOverlay = [...x.gradientOverlay, { on: true, blend: 'normal', opacity: 1, stops: [{ at: 0, color: BLACK }, { at: 1, color: WHITE }], shape: 'linear', angle: 90, scale: 1, reverse: false } as FxGradient];
  else x.stroke = [...x.stroke, { on: true, blend: 'normal', opacity: 1, size: 3, where: 'outside', color } as FxStroke];
  return x;
}
