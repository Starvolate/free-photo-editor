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
import { Stroke, type BrushOptions, type StrokePoint } from './stroke';
import type { Doc, Layer, Selection } from './document';

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
}
export const RIG_DEFAULTS: RigSettings = {
  steady: 'off', lag: 50, string: 20, mirror: 'off', spokes: 6, wrap: false,
  dyn: false, sizeBy: 'pressure', strengthBy: 'off', minSize: 20, minStrength: 30, jitter: 0, scatter: 0,
};
/** True when any power-up is on, so the editor must make a `RigStroke` instead of a plain `Stroke`. */
export function rigOn(s: RigSettings): boolean {
  return s.steady !== 'off' || s.mirror !== 'off' || s.wrap || s.dyn;
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

  constructor(doc: Doc, layer: Layer, options: BrushOptions, settings: RigSettings, flush: (() => void) | null = null, selection: Selection | null = doc.selection) {
    super(doc, layer, options, selection);
    this.s = { ...settings };
    this.w = doc.width; this.hh = doc.height;
    this.maps = mirrorMaps(settings.mirror, settings.spokes, doc.width, doc.height);
    this.rnd = seeded(settings.seed ?? ((Math.random() * 2 ** 31) | 0));
    this.flush = flush;
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
    if (!this.s.wrap) { super.dab(x, y, d, f); return; }
    const W = this.w, H = this.hh, r = d / 2 + 1;
    x -= Math.floor(x / W) * W; y -= Math.floor(y / H) * H;
    const xs = x - r < 0 ? W : x + r > W ? -W : 0, ys = y - r < 0 ? H : y + r > H ? -H : 0;
    super.dab(x, y, d, f);
    if (xs) super.dab(x + xs, y, d, f);
    if (ys) super.dab(x, y + ys, d, f);
    if (xs && ys) super.dab(x + xs, y + ys, d, f);
  }
}
