// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The brush power-ups (paint-more.ts), checked on real pixels with hand-worked dab positions. */
import { describe, expect, it } from 'vitest';
import { Stroke, createLayer, type BrushOptions, type Doc, type Layer, type StrokePoint } from '../src/index';
import { RIG_DEFAULTS, RigStroke, applyPreset, builtInTips, colorizeCommand, colorizeFlats, encloseAmounts, growMask, layerIn, makePreset, mirrorMaps, patternFromPixels, rigOn, tipFromPixels, type Pattern, type RigSettings, type Tip } from '../src/paint-more';

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

describe('brush tips, patterns and saved tools (part 2)', () => {
  // An L: the left column and the bottom row of a 3 x 3 tip.
  const L3: Tip = { name: 'L', w: 3, h: 3, data: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255, 255]) };
  const painted = (l: Layer): string[] => {
    const out: string[] = [];
    for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) if (alpha(l, x, y) > 0) out.push(`${x},${y}`);
    return out;
  };
  it('stamps a custom tip at its own size, pixel for pixel, as one undo step', () => {
    expect(rigOn(rig({ tip: L3 }))).toBe(true);
    // Size 3 = the tip's own size. Centre 5.5: pixel x sits on tip column x - 4, pixel y on tip row y - 4.
    const { l, cmd } = paint(12, 12, brush(3), rig({ tip: L3 }), [{ x: 5.5, y: 5.5 }]);
    expect(painted(l).sort()).toEqual(['4,4', '4,5', '4,6', '5,6', '6,6'].sort());
    expect(alpha(l, 4, 6)).toBe(255);
    expect(l.data[(6 * 12 + 6) * 4]).toBe(255); // red, the brush colour
    expect(cmd).not.toBeNull();
  });
  it('turns the tip: 90 degrees puts the foot of the L along the top', () => {
    // Turned 90: pixel (x, y) reads tip row 6 - x, column y - 4, so the left column stays and the bottom row moves to the top.
    const { l } = paint(12, 12, brush(3), rig({ tip: L3, angle: 90 }), [{ x: 5.5, y: 5.5 }]);
    expect(painted(l).sort()).toEqual(['4,4', '4,5', '4,6', '5,4', '6,4'].sort());
  });
  it('a one-colour pattern with the round tip paints exactly like the plain brush', () => {
    const red: Pattern = { name: 'red', w: 1, h: 1, data: Uint8ClampedArray.from([255, 0, 0, 255]) };
    const pts = [{ x: 12, y: 15 }, { x: 40, y: 22 }, { x: 70, y: 9 }];
    const a = paint(100, 40, brush(9, { hardness: 0.4 }), null, pts), b = paint(100, 40, brush(9, { hardness: 0.4, color: { r: 0, g: 200, b: 0, a: 255 } }), rig({ pattern: red }), pts);
    expect(Buffer.from(b.l.data).equals(Buffer.from(a.l.data))).toBe(true);
  });
  it('pattern stamp: each pixel takes the pattern colour at that spot, not the brush colour', () => {
    // A 2 x 1 pattern, red then blue, from the picture's left edge: even columns red, odd columns blue.
    const rb: Pattern = { name: 'rb', w: 2, h: 1, data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255]) };
    const { l } = paint(20, 20, brush(4, { color: { r: 0, g: 200, b: 0, a: 255 } }), rig({ pattern: rb }), [{ x: 10.5, y: 10.5 }]);
    const px = (x: number, y: number): number[] => Array.from(l.data.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 4));
    expect(px(10, 10)).toEqual([255, 0, 0, 255]); // centre, column 10: red
    expect(px(11, 10)).toEqual([0, 0, 255, 255]); // 1 px right, column 11: blue
  });
  it('makes a tip from pixels: dark paints, white and see-through do not, the soft edge fades it, cropped to what paints', () => {
    // 2 x 2: black, white / mid grey (128), black but see-through.
    const px = Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 0]);
    expect(tipFromPixels('t', px, 2, 2)).toEqual({ name: 't', w: 1, h: 2, data: Uint8Array.from([255, 127]) });
    // The selection's edge at half on the grey pixel: 127 x 128 / 255 = 63.75 -> 64.
    expect(tipFromPixels('t', px, 2, 2, Uint8Array.from([255, 255, 128, 255]))?.data).toEqual(Uint8Array.from([255, 64]));
    expect(tipFromPixels('t', Uint8ClampedArray.from([255, 255, 255, 255]), 1, 1)).toBeNull();
    const p = patternFromPixels('p', Uint8ClampedArray.from([10, 20, 30, 200]), 1, 1, Uint8Array.from([128]));
    expect(Array.from(p?.data ?? [])).toEqual([10, 20, 30, 100]); // 200 x 128 / 255 = 100.4
  });
  it('has four built-in tips and keeps the settings of a tool to put back later', () => {
    const t = builtInTips();
    expect(t.map((x) => x.name)).toEqual(['Square', 'Flat', 'Chalk', 'Spatter']);
    expect(t[0].data.every((v) => v === 255)).toBe(true);
    const live = { size: 24, hardness: 0.5, opacity: 0.8 }, r = rig({ steady: 'lag', lag: 40, tip: t[1] });
    const p = makePreset('Brush 24 px', 'brush', live, r);
    Object.assign(live, { size: 3, hardness: 1, opacity: 0.1 });
    Object.assign(r, { steady: 'off', tip: null, mirror: 'radial' });
    applyPreset(p, live, r);
    expect(live).toEqual({ size: 24, hardness: 0.5, opacity: 0.8 });
    expect([r.steady, r.lag, r.tip?.name, r.mirror]).toEqual(['lag', 40, 'Flat', 'off']);
  });
});

/** A w x h RGBA picture from a function of x, y. */
function pic(w: number, h: number, f: (x: number, y: number) => number[]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return d;
}
const sum = (m: Uint8Array): number => m.reduce((a, v) => a + (v ? 1 : 0), 0);
const at = (d: Uint8ClampedArray, w: number, x: number, y: number): number[] => [...d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe('fill what you circle (enclose and fill)', () => {
  // 6 x 6: white paper, a black line down column 2, one light grey pixel at (4, 4). The layer itself is solid in rows 0-2 only.
  const W6 = pic(6, 6, (x, y) => (x === 2 ? [0, 0, 0, 255] : x === 4 && y === 4 ? [200, 200, 200, 255] : [255, 255, 255, 255]));
  const own = pic(6, 6, (_x, y) => [10, 20, 30, y < 3 ? 255 : 0]);
  it('fills everything inside the loop', () => {
    expect(sum(encloseAmounts('all', W6, own, 6, 6))).toBe(36);
  });
  it('fills only the empty parts of the layer', () => {
    const m = encloseAmounts('clear', W6, own, 6, 6);
    expect(sum(m)).toBe(18);
    expect([m[0], m[2 * 6 + 5], m[3 * 6], m[5 * 6 + 5]]).toEqual([0, 0, 255, 255]);
  });
  it('fills only the colour at the middle, within the match', () => {
    // The middle (3, 3) is white: the 6 black and the grey (55 off, over 10 % = 25.5) stay; 40 % takes the grey too.
    const m = encloseAmounts('colour', W6, own, 6, 6, 10);
    expect(sum(m)).toBe(29);
    expect([m[2], m[3], m[4 * 6 + 4]]).toEqual([0, 255, 0]);
    expect(sum(encloseAmounts('colour', W6, own, 6, 6, 40))).toBe(30);
  });
  it('fills between the lines and leaves the line art alone', () => {
    const m = encloseAmounts('lines', W6, own, 6, 6, 10, 128);
    expect(sum(m)).toBe(30);
    expect([m[2], m[5 * 6 + 2], m[4 * 6 + 4]]).toEqual([0, 0, 255]);
    // A darkness setting above the grey's brightness (200) counts it as a line too.
    expect(sum(encloseAmounts('lines', W6, own, 6, 6, 10, 201))).toBe(29);
  });
  it('reads a layer inside a rectangle, see-through where it does not reach', () => {
    const l = createLayer('L', 2, 2, { x: 1, y: 1, fill: { r: 9, g: 8, b: 7, a: 255 } });
    const d = layerIn(l, { x: 0, y: 0, w: 3, h: 3 });
    expect([at(d, 3, 0, 0), at(d, 3, 1, 1), at(d, 3, 2, 2)]).toEqual([[0, 0, 0, 0], [9, 8, 7, 255], [9, 8, 7, 255]]);
  });
});

describe('colour a line drawing (colorize mask)', () => {
  // 10 x 10 line art: a border box and a wall down column 5 with a 1 px gap at row 5. Left area x 1-4, right area x 6-8.
  const lines = pic(10, 10, (x, y) => (x === 0 || x === 9 || y === 0 || y === 9 || (x === 5 && y !== 5) ? [0, 0, 0, 255] : [0, 0, 0, 0]));
  const RED4 = [255, 0, 0, 255], BLUE4 = [0, 0, 255, 255];
  const hints = (both: boolean): Uint8ClampedArray => pic(10, 10, (x, y) => (x === 2 && y === 4 ? RED4 : both && x === 7 && y === 4 ? BLUE4 : [0, 0, 0, 0]));
  it('grows a mask by whole pixels each way', () => {
    const m = new Uint8Array(25); m[12] = 1;
    expect(sum(growMask(m, 5, 5, 1))).toBe(9);
    expect(sum(growMask(m, 5, 5, 2))).toBe(25);
    expect(sum(growMask(m, 5, 5, 0))).toBe(1);
  });
  it('fills each closed area with its own hint, the 1 px gap closed', () => {
    const f = colorizeFlats(lines, hints(true), 10, 10, 128, 1)!;
    expect([at(f, 10, 3, 3), at(f, 10, 2, 7), at(f, 10, 1, 1)]).toEqual([RED4, RED4, RED4]);
    expect([at(f, 10, 7, 7), at(f, 10, 8, 2), at(f, 10, 6, 6)]).toEqual([BLUE4, BLUE4, BLUE4]);
    // The colour runs under the lines: the border and the wall are coloured, not see-through.
    expect([at(f, 10, 0, 4), at(f, 10, 9, 4)]).toEqual([RED4, BLUE4]);
    expect(at(f, 10, 5, 3)[3]).toBe(255);
  });
  it('leaves an area with no hint see-through, and leaks through the gap when it is not closed', () => {
    const f = colorizeFlats(lines, hints(false), 10, 10, 128, 1)!;
    expect([at(f, 10, 2, 4), at(f, 10, 7, 4), at(f, 10, 7, 7)]).toEqual([RED4, [0, 0, 0, 0], [0, 0, 0, 0]]);
    const leak = colorizeFlats(lines, hints(false), 10, 10, 128, 0)!;
    expect(at(leak, 10, 7, 4)).toEqual(RED4);
    expect(colorizeFlats(lines, new Uint8ClampedArray(400), 10, 10, 128, 1)).toBeNull();
  });
  it('puts the flats under the line art, hides the hints and multiplies white paper, as one undo step', () => {
    const line = createLayer('Lines', 4, 4, { fill: { r: 255, g: 255, b: 255, a: 255 } }), hint = createLayer('Hints', 4, 4);
    const doc: Doc = { width: 4, height: 4, layers: [line, hint], activeId: hint.id, selection: null };
    const cmd = colorizeCommand(doc, line, hint, createLayer('Flat colours', 4, 4));
    const state = (): unknown[] => [doc.layers.map((l) => l.name), doc.layers.find((l) => l.name === 'Hints')!.visible, doc.layers.find((l) => l.name === 'Lines')!.blendMode];
    expect(state()).toEqual([['Flat colours', 'Lines', 'Hints'], false, 'multiply']);
    cmd.undo(doc);
    expect(state()).toEqual([['Lines', 'Hints'], true, 'normal']);
    cmd.redo(doc);
    expect(state()).toEqual([['Flat colours', 'Lines', 'Hints'], false, 'multiply']);
  });
});

describe('blend paint (mixer brush)', () => {
  it('mixes the colour under the dab into the brush colour by the wet amount', () => {
    const { doc, l } = setup(10, 10);
    l.data.set(pic(10, 10, () => [0, 0, 255, 255]));
    const st = new RigStroke(doc, l, brush(4), rig({ mix: true, wet: 50, load: 0 }));
    st.add({ x: 5, y: 5 });
    st.end();
    // Red brush, blue paper, half wet: purple 127.5 / 0 / 127.5, solid.
    const p = at(l.data, 10, 5, 5);
    expect(Math.abs(p[0] - 127.5)).toBeLessThanOrEqual(0.5);
    expect([p[1], p[3]]).toEqual([0, 255]);
    expect(Math.abs(p[2] - 127.5)).toBeLessThanOrEqual(0.5);
    expect(rigOn(rig({ mix: true }))).toBe(true);
  });
  it('paints the plain brush colour on empty paper, and dry (wet 0) never picks up colour', () => {
    const a = paint(10, 10, brush(4), rig({ mix: true, wet: 80 }), [{ x: 5, y: 5 }]);
    expect(at(a.l.data, 10, 5, 5)).toEqual([255, 0, 0, 255]);
    const { doc, l } = setup(10, 10);
    l.data.set(pic(10, 10, () => [0, 0, 255, 255]));
    const st = new RigStroke(doc, l, brush(4), rig({ mix: true, wet: 0 }));
    st.add({ x: 5, y: 5 }); st.end();
    expect(at(l.data, 10, 5, 5)).toEqual([255, 0, 0, 255]);
  });
});
