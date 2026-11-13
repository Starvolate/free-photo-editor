// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Brush power-ups (the paint batch, 13 Nov 2026): a steady hand, symmetry, seamless tile painting and pen and speed
 * dynamics. They live in their own subpath (`@free-photoeditor/core/paint-more`) so the first screen never carries them,
 * and the plain brush (stroke.ts) is not changed at all: a stroke with every power-up off is a plain `Stroke`.
 * `RigStroke` is a `Stroke` that changes each point before it is painted (steady hand, dynamics) and each dab as it is
 * painted (symmetry, wrap-around, jitter). Every copy of a dab goes through the same coverage map, so mirrored paint never
 * builds up past the stroke's strength, and `end()` still makes one undo step.
 */
import { Stroke, type BrushOptions, type StrokePoint, type Tile } from './stroke';
import { selectionAlpha, type Doc, type Layer, type Selection } from './document';
import { clamp01, union } from './geometry';

/** What a dynamic setting follows: nothing, pen pressure, pen tilt, or how fast the brush moves. */
export type RigSource = 'off' | 'pressure' | 'tilt' | 'speed';
/** Mirror across the up-down line (left and right match), the left-right line (top and bottom match), both, or turn around the centre. */
export type RigMirror = 'off' | 'vertical' | 'horizontal' | 'both' | 'radial';
export interface RigSettings {
  /** Steady hand: off, a smoothing lag, or a pulled string. */ steady: 'off' | 'lag' | 'string';
  /** Lag amount, 0 (none) to 95 (%): how far behind the pointer the brush trails. */ lag: number;
  /** Pulled string length in picture pixels: the brush only moves once the pointer is this far away. */ string: number;
  mirror: RigMirror;
  /** Copies around the centre for 'radial' (2 to 24). */ spokes: number;
  /** Paint that leaves one edge comes back in at the opposite edge. */ wrap: boolean;
  /** Pen and speed dynamics on. */ dyn: boolean;
  sizeBy: RigSource; strengthBy: RigSource;
  /** The smallest size and strength the dynamics go down to, in % of the brush's own. */ minSize: number; minStrength: number;
  /** Size jitter, 0 to 100 %: each dab is up to this much smaller, at random. */ jitter: number;
  /** Scatter, 0 to 200 %: each dab moves up to this many brush sizes from the line, at random. */ scatter: number;
  /** Seed of the random jitter, so a test can repeat it. */ seed?: number;
  /** Brush tip: null is the plain round tip; otherwise a grey tip, built in or made from a selection. */ tip?: Tip | null;
  /** Turn of the tip, in degrees. */ angle?: number;
  /** Distance between dabs in % of the size; 0 keeps the brush's own (12 %). */ spacing?: number;
  /** Pattern stamp: paint a saved pattern instead of the brush colour. */ pattern?: Pattern | null;
}
/** A grey brush tip: 255 paints at full strength, 0 not at all. */
export interface Tip { name: string; w: number; h: number; data: Uint8Array; }
/** A saved pattern: RGBA pixels that repeat across the picture from its top-left corner. */
export interface Pattern { name: string; w: number; h: number; data: Uint8ClampedArray; }
export const RIG_DEFAULTS: RigSettings = {
  steady: 'off', lag: 50, string: 20, mirror: 'off', spokes: 6, wrap: false,
  dyn: false, sizeBy: 'pressure', strengthBy: 'off', minSize: 20, minStrength: 30, jitter: 0, scatter: 0,
  tip: null, angle: 0, spacing: 0, pattern: null,
};
/** True when any power-up is on, so the editor must make a `RigStroke` instead of a plain `Stroke`. */
export function rigOn(s: RigSettings): boolean {
  return s.steady !== 'off' || s.mirror !== 'off' || s.wrap || s.dyn || !!s.tip || !!s.pattern || !!s.spacing;
}
/** The copies of one point: x' = a x + b y + c, y' = d x + e y + f. Index 0 is the point itself. */
export function mirrorMaps(m: RigMirror, spokes: number, w: number, h: number): Float64Array {
  const out: number[] = [1, 0, 0, 0, 1, 0];
  if (m === 'vertical' || m === 'both') out.push(-1, 0, w, 0, 1, 0);
  if (m === 'horizontal' || m === 'both') out.push(1, 0, 0, 0, -1, h);
  if (m === 'both') out.push(-1, 0, w, 0, -1, h);
  if (m === 'radial') {
    const n = Math.max(2, Math.min(24, Math.round(spokes))), cx = w / 2, cy = h / 2;
    for (let k = 1; k < n; k++) {
      // Whole quarter turns are exact, so a 4-way pattern lands on the same pixel grid.
      const t = (2 * Math.PI * k) / n, q = (4 * k) % n === 0, c = q ? Math.round(Math.cos(t)) : Math.cos(t), s = q ? Math.round(Math.sin(t)) : Math.sin(t);
      out.push(c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy);
    }
  }
  return Float64Array.from(out);
}
/** A small seeded random number source (0 to 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A brush stroke with power-ups. Make one only when `rigOn(settings)`; otherwise a plain `Stroke` is the same and faster. */
export class RigStroke extends Stroke {
  private readonly s: RigSettings;
  private readonly maps: Float64Array;
  private readonly w: number;
  private readonly hh: number;
  private readonly rnd: () => number;
  /** Called after the steady hand catches up at the end, so the editor draws those last dabs too. */
  private readonly flush: (() => void) | null;
  /** One reused point, so nothing is made per pointer move. */
  private readonly pt: StrokePoint = { x: 0, y: 0, size: 1, flow: 1 };
  private started = false;
  private qx = 0; private qy = 0;
  private rx = 0; private ry = 0;
  private speed = 0;
  private readonly tip: Tip | null;
  private readonly pat: Pattern | null;
  /** Cosine and sine of the tip's turn. */
  private readonly cs: number; private readonly sn: number;

  constructor(doc: Doc, layer: Layer, options: BrushOptions, settings: RigSettings, flush: (() => void) | null = null, selection: Selection | null = doc.selection) {
    super(doc, layer, options, selection);
    this.s = { ...settings };
    this.w = doc.width; this.hh = doc.height;
    this.maps = mirrorMaps(settings.mirror, settings.spokes, doc.width, doc.height);
    this.rnd = seeded(settings.seed ?? ((Math.random() * 2 ** 31) | 0));
    this.flush = flush;
    this.tip = settings.tip ?? null; this.pat = settings.pattern ?? null;
    const a = ((settings.angle ?? 0) * Math.PI) / 180;
    this.cs = Math.cos(a); this.sn = Math.sin(a);
    if (settings.spacing) this.o.spacing = Math.max(1, Math.min(300, settings.spacing)) / 100;
  }
  /** Where the brush itself is now (after the steady hand). */
  get brushAt(): { x: number; y: number } { return { x: this.qx, y: this.qy }; }

  override add(p: StrokePoint): void {
    const s = this.s, pt = this.pt;
    let x = p.x, y = p.y;
    const moved = this.started ? Math.hypot(x - this.rx, y - this.ry) : 0;
    this.rx = x; this.ry = y;
    if (!this.started) { this.qx = x; this.qy = y; }
    else if (s.steady === 'lag') {
      const k = 1 - Math.max(0, Math.min(95, s.lag)) / 100;
      this.qx += (x - this.qx) * k; this.qy += (y - this.qy) * k;
      x = this.qx; y = this.qy;
    } else if (s.steady === 'string') {
      const L = Math.max(0, s.string), dx = x - this.qx, dy = y - this.qy, d = Math.hypot(dx, dy);
      if (d <= L) return;
      this.qx = x - (dx / d) * L; this.qy = y - (dy / d) * L;
      x = this.qx; y = this.qy;
    } else { this.qx = x; this.qy = y; }
    pt.x = x; pt.y = y; pt.size = p.size; pt.flow = p.flow;
    if (s.dyn) {
      const base = this.o.size;
      // Speed: brush widths travelled per pointer event, smoothed; 1 at two widths or more.
      this.speed = this.speed * 0.5 + Math.min(1, moved / (2 * Math.max(1, base))) * 0.5;
      pt.size = base * this.level(s.sizeBy, s.minSize, p);
      pt.flow = this.level(s.strengthBy, s.minStrength, p);
    }
    this.started = true;
    super.add(pt);
  }
  /** 1 when the source is off; otherwise between the minimum (%) and 1 as the pen presses, tilts or the brush slows. */
  private level(src: RigSource, min: number, p: StrokePoint): number {
    if (src === 'off') return 1;
    const t = src === 'pressure' ? (p.pressure ?? 1) : src === 'tilt' ? (p.tilt ?? 0) : 1 - this.speed;
    const lo = Math.max(0, Math.min(100, min)) / 100;
    return lo + (1 - lo) * Math.max(0, Math.min(1, t));
  }
  override end(label?: string): ReturnType<Stroke['end']> {
    // The steady hand trails the pointer; finish the line where the pointer let go.
    if (this.started && this.s.steady !== 'off' && (this.qx !== this.rx || this.qy !== this.ry)) {
      const pt = this.pt;
      this.qx = pt.x = this.rx; this.qy = pt.y = this.ry;
      super.add(pt);
      this.flush?.();
    }
    return super.end(label);
  }
  protected override dab(cx: number, cy: number, diameter: number, flow: number): void {
    const s = this.s;
    if (s.jitter > 0 || s.scatter > 0) {
      const r = this.rnd, d0 = diameter;
      diameter *= 1 - (Math.min(100, s.jitter) / 100) * r();
      const k = (Math.min(200, s.scatter) / 100) * d0;
      cx += (r() * 2 - 1) * k; cy += (r() * 2 - 1) * k;
    }
    const m = this.maps;
    for (let i = 0; i < m.length; i += 6) this.put(m[i] * cx + m[i + 1] * cy + m[i + 2], m[i + 3] * cx + m[i + 4] * cy + m[i + 5], diameter, flow);
  }
  private put(x: number, y: number, d: number, f: number): void {
    if (!this.s.wrap) { this.one(x, y, d, f); return; }
    const W = this.w, H = this.hh, r = (this.tip ? d * 0.71 : d / 2) + 1;
    x -= Math.floor(x / W) * W; y -= Math.floor(y / H) * H;
    const xs = x - r < 0 ? W : x + r > W ? -W : 0, ys = y - r < 0 ? H : y + r > H ? -H : 0;
    this.one(x, y, d, f);
    if (xs) this.one(x + xs, y, d, f);
    if (ys) this.one(x, y + ys, d, f);
    if (xs && ys) this.one(x + xs, y + ys, d, f);
  }
  /** One dab: the plain round dab, or the tip or pattern dab below. */
  private one(x: number, y: number, d: number, f: number): void {
    if (this.tip || this.pat) this.shaped(x, y, d, f); else super.dab(x, y, d, f);
  }
  /**
   * A dab with a custom tip (its longer side is the brush size, turned by the angle) and/or the pattern's colour. It
   * writes through the same coverage map and undo tiles as the plain dab (stroke.ts), so paint never builds up.
   */
  private shaped(cx: number, cy: number, diameter: number, flow: number): void {
    const c = this.clip;
    if (!c) return;
    const tip = this.tip, pat = this.pat, cs = this.cs, sn = this.sn;
    const k = tip ? diameter / Math.max(tip.w, tip.h) : 1;
    const R = tip ? (Math.hypot(tip.w, tip.h) * k) / 2 : Math.max(0.5, diameter / 2);
    const x0 = Math.max(c.x, Math.floor(cx - R - 1)), y0 = Math.max(c.y, Math.floor(cy - R - 1));
    const x1 = Math.min(c.x + c.w, Math.ceil(cx + R + 1)), y1 = Math.min(c.y + c.h, Math.ceil(cy + R + 1));
    if (x0 >= x1 || y0 >= y1) return;
    const L = this.layer, data = L.data, lw = L.width, o = this.o, sel = this.sel;
    const feather = Math.max(1, R * (1 - clamp01(o.hardness))), start = R - feather;
    const op = clamp01(o.opacity), erase = o.erase;
    let cr = o.color.r, cg = o.color.g, cb = o.color.b, ca = 1;
    let tile: Tile | null = null, tkey = -1, any = false;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy, ly = y - L.y, ty = (ly / TILE) | 0;
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        let cov: number;
        if (tip) {
          const u = (dx * cs + dy * sn) / k + tip.w / 2, v = (dy * cs - dx * sn) / k + tip.h / 2;
          if (u < 0 || v < 0 || u >= tip.w || v >= tip.h) continue;
          cov = tip.data[(v | 0) * tip.w + (u | 0)] / 255;
        } else {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d <= start) cov = 1;
          else { const t = (d - start) / (feather + 0.5); if (t >= 1) continue; cov = 1 - t * t * (3 - 2 * t); }
        }
        let m = cov * flow * 255;
        if (sel) m = (m * selectionAlpha(sel, x, y)) / 255;
        m = Math.round(m);
        if (m <= 0) continue;
        const lx = x - L.x, tx = (lx / TILE) | 0, key = ty * this.cols + tx;
        if (key !== tkey) { tile = this.tiles.get(key) ?? this.tile(tx, ty, key); tkey = key; }
        const t = tile as Tile, ti = (ly - t.r.y) * t.r.w + (lx - t.r.x);
        if (m <= t.mask[ti]) continue;
        t.mask[ti] = m;
        any = true;
        if (pat) {
          const pi = ((((y % pat.h) + pat.h) % pat.h) * pat.w + (((x % pat.w) + pat.w) % pat.w)) * 4, pd = pat.data;
          cr = pd[pi]; cg = pd[pi + 1]; cb = pd[pi + 2]; ca = pd[pi + 3] / 255;
        }
        const oi = ti * 4, di = (ly * lw + lx) * 4, ob = t.orig, sa = (m / 255) * op * ca;
        if (erase) {
          data[di] = ob[oi]; data[di + 1] = ob[oi + 1]; data[di + 2] = ob[oi + 2]; data[di + 3] = ob[oi + 3] * (1 - sa);
        } else {
          const da = ob[oi + 3] / 255, kk = da * (1 - sa), oa = sa + kk;
          if (oa <= 0) { data[di + 3] = 0; continue; }
          data[di] = (cr * sa + ob[oi] * kk) / oa; data[di + 1] = (cg * sa + ob[oi + 1] * kk) / oa;
          data[di + 2] = (cb * sa + ob[oi + 2] * kk) / oa; data[di + 3] = oa * 255;
        }
      }
    }
    if (any) { const d = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; this.dirty = union(this.dirty, d); this.all = union(this.all, d); }
  }
}
/** The undo tile size of stroke.ts (64 px); the shaped dab finds the same tiles. */
const TILE = 64;
const MAX_TIP = 512, MAX_PATTERN = 1024;

/** Nearest-pixel shrink of `ch`-channel pixels so neither side is over `max`. */
function shrink<A extends Uint8Array | Uint8ClampedArray>(src: A, w: number, h: number, ch: number, max: number, make: (n: number) => A): { w: number; h: number; data: A } {
  const s = Math.max(1, Math.max(w, h) / max);
  if (s === 1) return { w, h, data: src };
  const ow = Math.max(1, Math.round(w / s)), oh = Math.max(1, Math.round(h / s)), out = make(ow * oh * ch);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const si = (Math.min(h - 1, (y * s) | 0) * w + Math.min(w - 1, (x * s) | 0)) * ch, oi = (y * ow + x) * ch;
    for (let c = 0; c < ch; c++) out[oi + c] = src[si + c];
  }
  return { w: ow, h: oh, data: out };
}
/**
 * A brush tip from picture pixels (RGBA, w x h): dark, solid pixels paint at full strength, white or see-through ones not
 * at all. `a` is an extra 0-255 amount per pixel (the selection's soft edge). Cropped to what paints and shrunk to 512 px
 * at most. Null when nothing in the area is dark enough to paint.
 */
export function tipFromPixels(name: string, rgba: Uint8ClampedArray, w: number, h: number, a: Uint8Array | null = null): Tip | null {
  const v = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4, lum = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    const val = Math.round(((255 - lum) * rgba[p + 3]) / 255 * (a ? a[i] / 255 : 1));
    v[i] = val;
    if (val > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) crop.set(v.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + cw), y * cw);
  return { name, ...shrink(crop, cw, ch, 1, MAX_TIP, (n) => new Uint8Array(n)) };
}
/** A pattern from picture pixels (RGBA, w x h); `a` fades it at the selection's soft edge. Shrunk to 1024 px at most. */
export function patternFromPixels(name: string, rgba: Uint8ClampedArray, w: number, h: number, a: Uint8Array | null = null): Pattern | null {
  if (w < 1 || h < 1) return null;
  const data = new Uint8ClampedArray(rgba);
  if (a) for (let i = 0; i < w * h; i++) data[i * 4 + 3] = (data[i * 4 + 3] * a[i]) / 255;
  return { name, ...shrink(data, w, h, 4, MAX_PATTERN, (n) => new Uint8ClampedArray(n)) };
}
/** The pattern's colour at picture point x, y (it repeats from the top-left corner), written into `out`. */
export function patternAt(p: Pattern, x: number, y: number, out: { r: number; g: number; b: number; a: number }): typeof out {
  const i = ((((y % p.h) + p.h) % p.h) * p.w + (((x % p.w) + p.w) % p.w)) * 4;
  out.r = p.data[i]; out.g = p.data[i + 1]; out.b = p.data[i + 2]; out.a = p.data[i + 3];
  return out;
}
/** The built-in tips besides the plain round one: square, flat, chalk and spatter. */
export function builtInTips(): Tip[] {
  const make = (name: string, w: number, h: number, f: (x: number, y: number) => number): Tip => {
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(f(x + 0.5, y + 0.5))));
    return { name, w, h, data };
  };
  const r1 = seeded(7), chalk = Array.from({ length: 32 * 32 }, () => r1());
  const r2 = seeded(11), dots = Array.from({ length: 16 }, () => [4 + r2() * 40, 4 + r2() * 40, 1.5 + r2() * 3.5]);
  return [
    make('Square', 32, 32, () => 255),
    make('Flat', 32, 10, (x, y) => (((x - 16) / 16) ** 2 + ((y - 5) / 5) ** 2 <= 1 ? 255 : 0)),
    make('Chalk', 32, 32, (x, y) => (Math.hypot(x - 16, y - 16) <= 15 && chalk[(y | 0) * 32 + (x | 0)] > 0.4 ? 120 + 135 * chalk[(y | 0) * 32 + (x | 0)] : 0)),
    make('Spatter', 48, 48, (x, y) => (dots.some(([a, b, r]) => Math.hypot(x - a, y - b) <= r) ? 255 : 0)),
  ];
}

/** A saved tool: the brush, pencil or eraser with its size, hardness, strength and brush extras. */
export interface ToolPreset { name: string; tool: 'brush' | 'pencil' | 'eraser'; size: number; hardness: number; opacity: number; rig: RigSettings; }
/** Save the tool's settings now (a copy, so later changes do not touch it). */
export function makePreset(name: string, tool: ToolPreset['tool'], paint: { size: number; hardness: number; opacity: number }, rig: RigSettings): ToolPreset {
  return { name, tool, size: paint.size, hardness: paint.hardness, opacity: paint.opacity, rig: { ...rig } };
}
/** Put a saved tool's settings back into the live brush settings and brush extras. */
export function applyPreset(p: ToolPreset, paint: { size: number; hardness: number; opacity: number }, rig: RigSettings): void {
  paint.size = p.size; paint.hardness = p.hardness; paint.opacity = p.opacity;
  Object.assign(rig, RIG_DEFAULTS, p.rig);
}
