// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The brush power-ups (paint-more.ts), checked on real pixels with hand-worked dab positions. */
import { describe, expect, it } from 'vitest';
import { Stroke, createLayer, type BrushOptions, type Doc, type Layer, type StrokePoint } from '../src/index';
import { RIG_DEFAULTS, RigStroke, mirrorMaps, rigOn, type RigSettings } from '../src/paint-more';

const RED = { r: 255, g: 0, b: 0, a: 255 };
function setup(w: number, h: number): { doc: Doc; l: Layer } {
  const l = createLayer('Paint', w, h);
  return { doc: { width: w, height: h, layers: [l], activeId: l.id, selection: null }, l };
}
const brush = (size: number, more: Partial<BrushOptions> = {}): BrushOptions => ({ size, hardness: 1, opacity: 1, color: RED, erase: false, ...more });
const rig = (more: Partial<RigSettings>): RigSettings => ({ ...RIG_DEFAULTS, seed: 7, ...more });
const alpha = (l: Layer, x: number, y: number): number => l.data[(y * l.width + x) * 4 + 3];
function paint(w: number, h: number, o: BrushOptions, s: RigSettings | null, pts: StrokePoint[]): { l: Layer; cmd: ReturnType<Stroke['end']>; st: Stroke } {
  const { doc, l } = setup(w, h);
  const st = s ? new RigStroke(doc, l, o, s) : new Stroke(doc, l, o);
  for (const p of pts) st.add(p);
  return { l, cmd: st.end(), st };
}

describe('brush power-ups', () => {
  it('is a plain stroke, pixel for pixel, with every power-up off', () => {
    expect(rigOn(RIG_DEFAULTS)).toBe(false);
    const pts = [{ x: 12, y: 15 }, { x: 40, y: 22 }, { x: 70, y: 9 }];
    const a = paint(100, 40, brush(9, { hardness: 0.4 }), null, pts), b = paint(100, 40, brush(9, { hardness: 0.4 }), rig({}), pts);
    expect(Buffer.from(b.l.data).equals(Buffer.from(a.l.data))).toBe(true);
  });

  it('mirrors left and right: a dab centred on pixel 20 also paints pixel 79 (100 px wide), with the same values', () => {
    const { l, cmd } = paint(100, 40, brush(10, { hardness: 0.5 }), rig({ mirror: 'vertical' }), [{ x: 20.5, y: 20.5 }]);
    expect(alpha(l, 20, 20)).toBe(255);
    expect(alpha(l, 50, 20)).toBe(0);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 100; x++) expect(alpha(l, 99 - x, y), `${x},${y}`).toBe(alpha(l, x, y));
    expect(cmd?.label).toBe('Brush stroke'); // one undo step for both sides
  });

  it('mirrors top and bottom, and both ways at once', () => {
    const v = paint(60, 40, brush(6), rig({ mirror: 'horizontal' }), [{ x: 10.5, y: 5.5 }]).l;
    expect([alpha(v, 10, 5), alpha(v, 10, 34), alpha(v, 49, 5)]).toEqual([255, 255, 0]);
    const b = paint(60, 40, brush(6), rig({ mirror: 'both' }), [{ x: 10.5, y: 5.5 }]).l;
    expect([alpha(b, 10, 5), alpha(b, 49, 5), alpha(b, 10, 34), alpha(b, 49, 34)]).toEqual([255, 255, 255, 255]);
  });

  it('turns 4 copies around the centre: pixel (x, y) matches pixel (99 - y, x) on a 100 px square', () => {
    const m = mirrorMaps('radial', 4, 100, 100);
    expect(m.length).toBe(24);
    // the quarter turn of (30.5, 20.5) about (50, 50) is (79.5, 30.5)
    expect([m[6] * 30.5 + m[7] * 20.5 + m[8], m[9] * 30.5 + m[10] * 20.5 + m[11]]).toEqual([79.5, 30.5]);
    const { l } = paint(100, 100, brush(8, { hardness: 0.3 }), rig({ mirror: 'radial', spokes: 4 }), [{ x: 30.5, y: 20.5 }, { x: 36.5, y: 24.5 }]);
    expect(alpha(l, 30, 20)).toBe(255);
    expect([alpha(l, 79, 30), alpha(l, 69, 79), alpha(l, 20, 69)]).toEqual([255, 255, 255]);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) expect(alpha(l, 99 - y, x), `${x},${y}`).toBe(alpha(l, x, y));
  });

  it('never builds up where the copies overlap: half strength stays half', () => {
    const { l } = paint(100, 40, brush(30, { opacity: 0.5 }), rig({ mirror: 'vertical' }), [{ x: 50, y: 20 }]);
    const plain = paint(100, 40, brush(30, { opacity: 0.5 }), null, [{ x: 50, y: 20 }]).l;
    expect(alpha(l, 50, 20)).toBe(alpha(plain, 50, 20));
    expect(alpha(l, 50, 20)).toBe(128);
  });

  it('wraps at the edges: a dab at x 2 with radius 10 also paints x 95 to 99 on a 100 px picture', () => {
    const on = paint(100, 40, brush(20), rig({ wrap: true }), [{ x: 2, y: 20 }]).l;
    const off = paint(100, 40, brush(20), null, [{ x: 2, y: 20 }]).l;
    // pixel 97's centre sits 4.5 px left of x 2 once wrapped; pixel 89's sits 12.5 px away, past the edge of the dab
    expect([alpha(on, 95, 20), alpha(on, 97, 20), alpha(on, 99, 20), alpha(on, 89, 20)]).toEqual([255, 255, 255, 0]);
    expect([alpha(off, 97, 20), alpha(off, 2, 20)]).toEqual([0, 255]);
    // a corner dab comes back in at all four corners; a point dragged past the edge paints inside again
    const c = paint(50, 50, brush(10), rig({ wrap: true }), [{ x: 1, y: 1 }]).l;
    expect([alpha(c, 1, 1), alpha(c, 48, 1), alpha(c, 1, 48), alpha(c, 48, 48)]).toEqual([255, 255, 255, 255]);
    const past = paint(50, 50, brush(4), rig({ wrap: true }), [{ x: 70.5, y: 10.5 }]).l;
    expect(alpha(past, 20, 10)).toBe(255);
  });

  it('pulled string: the brush waits until the pointer is 10 px away, then follows 10 px behind, and finishes at the pointer', () => {
    const { doc, l } = setup(100, 40);
    const st = new RigStroke(doc, l, brush(4), rig({ steady: 'string', string: 10 }));
    st.add({ x: 10, y: 20 });
    st.add({ x: 16, y: 20 });
    expect(st.brushAt).toEqual({ x: 10, y: 20 });
    st.add({ x: 40, y: 20 });
    expect(st.brushAt).toEqual({ x: 30, y: 20 });
    expect(alpha(l, 29, 20)).toBe(255);
    expect(alpha(l, 38, 20)).toBe(0);
    const cmd = st.end();
    expect(alpha(l, 38, 20)).toBe(255);
    expect(cmd?.label).toBe('Brush stroke');
  });

  it('lag: half way each move, so (10, 20) then (30, 20) puts the brush at (20, 20)', () => {
    const { doc, l } = setup(100, 40);
    let flushed = 0;
    const st = new RigStroke(doc, l, brush(4), rig({ steady: 'lag', lag: 50 }), () => { flushed++; });
    st.add({ x: 10, y: 20 });
    st.add({ x: 30, y: 20 });
    expect(st.brushAt).toEqual({ x: 20, y: 20 });
    expect(alpha(l, 28, 20)).toBe(0);
    st.end();
    expect([alpha(l, 28, 20), flushed]).toEqual([255, 1]);
  });

  it('dynamics: half pressure halves the size; half tilt halves the strength', () => {
    const half = paint(100, 40, brush(20), rig({ dyn: true, sizeBy: 'pressure', minSize: 0 }), [{ x: 50, y: 20, pressure: 0.5 }]).l;
    const full = paint(100, 40, brush(20), rig({ dyn: true, sizeBy: 'pressure', minSize: 0 }), [{ x: 50, y: 20, pressure: 1 }]).l;
    // radius 5 at half pressure: pixel 54's centre is 4.5 px away (painted), pixel 56's is 6.5 px (not); radius 10 paints both
    expect([alpha(half, 54, 20) > 0, alpha(half, 56, 20), alpha(full, 56, 20)]).toEqual([true, 0, 255]);
    const tilt = paint(100, 40, brush(20), rig({ dyn: true, sizeBy: 'off', strengthBy: 'tilt', minStrength: 0 }), [{ x: 50, y: 20, tilt: 0.5 }]).l;
    expect(alpha(tilt, 50, 20)).toBe(128);
    // a mouse has no pressure: the brush keeps its full size
    const mouse = paint(100, 40, brush(20), rig({ dyn: true, sizeBy: 'pressure', minSize: 0 }), [{ x: 50, y: 20 }]).l;
    expect(alpha(mouse, 56, 20)).toBe(255);
  });

  it('dynamics: a fast move thins the brush', () => {
    const { l } = paint(100, 40, brush(20), rig({ dyn: true, sizeBy: 'speed', minSize: 0 }), [{ x: 10, y: 20 }, { x: 90, y: 20 }]);
    // full size (radius 10) at the start; about half (radius 5) at the end, so 6.5 px off the line is bare there
    expect([alpha(l, 10, 26), alpha(l, 89, 26)]).toEqual([255, 0]);
    expect(alpha(l, 89, 20)).toBe(255);
  });

  it('jitter repeats with the same seed and moves the dabs', () => {
    const pts = [{ x: 10, y: 20 }, { x: 90, y: 20 }];
    const a = paint(100, 40, brush(8), rig({ dyn: true, sizeBy: 'off', jitter: 60, scatter: 100, seed: 3 }), pts).l;
    const b = paint(100, 40, brush(8), rig({ dyn: true, sizeBy: 'off', jitter: 60, scatter: 100, seed: 3 }), pts).l;
    const plain = paint(100, 40, brush(8), null, pts).l;
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(Buffer.from(a.data).equals(Buffer.from(plain.data))).toBe(false);
    let off = 0;
    for (let x = 0; x < 100; x++) for (let y = 0; y < 40; y++) if (Math.abs(y - 20) > 5 && alpha(a, x, y) > 0) off++;
    expect(off).toBeGreaterThan(0); // scatter put paint off the line
  });
});
