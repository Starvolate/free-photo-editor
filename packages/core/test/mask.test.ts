// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** W6 S1: layer masks. The compositor is unchanged for plain layers (V1 golden), masks draw as designed, every geometry
 * command carries them, painting on a mask folds back exactly and undoes exactly, and PSD keeps them. */
import { describe, expect, it } from 'vitest';
import {
  BLACK, BLEND_MODES, Stroke, addLayer, addMask, alignLayer, applyMask, applyToLayer, compositeRect, createDocument, createLayer,
  cropDocument, deleteMask, distributeLayers, duplicateLayer, fillGradient, fillSelection, flatten, gaussianBlur, growLayerToCover,
  invertLayerMask, maskAt, maskSummary, maskValue, mergeDown, mergeVisible, openMaskSurface, propsCommand, resizeCanvas, resizeDocument,
  revealAll, setLayerProps, setMaskSettings, transformLayer, trimDocument, turnDocument, turnLayer, withMaskSurface, featheredPlane,
  type BlendLayer, type BlendMode, type Doc, type Layer, type LayerMask, type Rect, type RGBA,
} from '../src/index';
import { SEPARABLE, hash01, nonSeparable } from '../src/blend';
import { readPsdDocument, writePsdDocument } from '../src/psd';

/** The compositor exactly as it was before W6 (origin/main 3282295), kept to prove plain documents draw byte for byte the same. */
function compositeRectV1(layers: readonly BlendLayer[], r: Rect, background: RGBA | null = null): Uint8ClampedArray {
  const w = Math.max(0, r.w), h = Math.max(0, r.h);
  const out = new Uint8ClampedArray(w * h * 4);
  if (!w || !h) return out;
  const acc = new Float32Array(w * 4);
  const mix = new Float64Array(3);
  const bR = background ? background.r / 255 : 0, bG = background ? background.g / 255 : 0;
  const bB = background ? background.b / 255 : 0, bA = background ? background.a / 255 : 0;
  const list = layers.filter((l) => l.visible && l.opacity > 0 && l.x < r.x + w && l.y < r.y + h && l.x + l.width > r.x && l.y + l.height > r.y);
  for (let row = 0; row < h; row++) {
    const y = r.y + row;
    for (let i = 0; i < w * 4; i += 4) { acc[i] = bR; acc[i + 1] = bG; acc[i + 2] = bB; acc[i + 3] = bA; }
    for (const L of list) {
      const ly = y - L.y;
      if (ly < 0 || ly >= L.height) continue;
      const x0 = Math.max(r.x, L.x), x1 = Math.min(r.x + w, L.x + L.width);
      if (x0 >= x1) continue;
      const mode = L.blendMode;
      const sep = SEPARABLE[mode];
      const plain = mode === 'normal' || mode === 'dissolve';
      const dissolve = mode === 'dissolve';
      const d = L.data;
      const k255 = L.opacity / 255;
      let si = (ly * L.width + (x0 - L.x)) * 4;
      let ai = (x0 - r.x) * 4;
      for (let x = x0; x < x1; x++, si += 4, ai += 4) {
        let as = d[si + 3] * k255;
        if (as <= 0) continue;
        if (dissolve) { if (hash01(x, y) >= as) continue; as = 1; }
        const sr = d[si] / 255, sg = d[si + 1] / 255, sb = d[si + 2] / 255;
        const ab = acc[ai + 3], br = acc[ai], bg = acc[ai + 1], bb = acc[ai + 2];
        let mr = sr, mg = sg, mb = sb;
        if (!plain && ab > 0) {
          if (sep) { mr = sep(br, sr); mg = sep(bg, sg); mb = sep(bb, sb); }
          else { nonSeparable(mode, br, bg, bb, sr, sg, sb, mix); mr = mix[0]; mg = mix[1]; mb = mix[2]; }
          mr = (1 - ab) * sr + ab * mr; mg = (1 - ab) * sg + ab * mg; mb = (1 - ab) * sb + ab * mb;
        }
        const k = ab * (1 - as);
        const ao = as + k;
        acc[ai] = (as * mr + k * br) / ao; acc[ai + 1] = (as * mg + k * bg) / ao;
        acc[ai + 2] = (as * mb + k * bb) / ao; acc[ai + 3] = ao;
      }
    }
    const o = row * w * 4;
    for (let i = 0; i < w * 4; i++) out[o + i] = acc[i] * 255;
  }
  return out;
}

let seed = 7;
const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const RED: RGBA = { r: 220, g: 20, b: 30, a: 255 };
/** A 40 × 30 white picture with a red 20 × 16 layer at (10, 8), active. */
function doc2(): { doc: Doc; top: Layer } {
  const doc = createDocument(40, 30);
  const top = createLayer('Top', 20, 16, { x: 10, y: 8, fill: RED });
  addLayer(doc, top);
  return { doc, top };
}
const boxMask = (b: Rect, v: number, outside: 0 | 255): LayerMask =>
  ({ x: b.x, y: b.y, width: b.w, height: b.h, data: new Uint8Array(b.w * b.h).fill(v), outside, enabled: true, linked: true, density: 1, feather: 0 });
const flat = (d: Doc): number[] => Array.from(flatten(d).data);

describe('W6 S1 masks: the compositor', () => {
  it('draws plain documents byte for byte as before (V1 golden, all 27 blend modes, random documents)', () => {
    for (const mode of BLEND_MODES) {
      const layers: BlendLayer[] = [];
      for (let k = 0; k < 4; k++) {
        const w = 3 + Math.floor(rnd() * 20), h = 3 + Math.floor(rnd() * 15), data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
        layers.push({ visible: k !== 2 || rnd() > 0.3, opacity: 0.2 + rnd() * 0.8, blendMode: k ? mode : 'normal' as BlendMode, x: Math.floor(rnd() * 12) - 3, y: Math.floor(rnd() * 8) - 2, width: w, height: h, data });
      }
      const r = { x: -2, y: -1, w: 24, h: 18 };
      expect(Array.from(compositeRect(layers, r)), mode).toEqual(Array.from(compositeRectV1(layers, r)));
      expect(Array.from(compositeRect(layers, r, RED)), mode).toEqual(Array.from(compositeRectV1(layers, r, RED)));
    }
  });
  it('reads the mask value: outside, inside, density, switched off, soft edge', () => {
    const m = boxMask({ x: 5, y: 5, w: 10, h: 10 }, 0, 255);
    expect([maskValue(m, 0, 0), maskValue(m, 7, 7)]).toEqual([255, 0]);
    expect(maskValue({ ...m, density: 0.5 }, 7, 7)).toBeCloseTo(127.5, 3);
    expect(maskValue({ ...m, enabled: false }, 7, 7)).toBe(255);
    const soft = { ...m, feather: 3 };
    const edge = maskValue(soft, 5, 10), mid = maskValue(soft, 10, 10);
    expect(edge).toBeGreaterThan(40); expect(edge).toBeLessThan(215); expect(mid).toBeLessThan(5);
    // A soft edge read in pieces equals one whole read.
    const whole = featheredPlane(soft, { x: 0, y: 0, w: 20, h: 20 }), part = featheredPlane(soft, { x: 3, y: 4, w: 6, h: 7 });
    for (let y = 0; y < 7; y++) for (let x = 0; x < 6; x++) expect(part[y * 6 + x]).toBe(whole[(y + 4) * 20 + x + 3]);
  });
  it('hides what the mask hides, half shows grey, and a switched-off mask hides nothing', () => {
    const { doc, top } = doc2(), before = flat(doc);
    top.mask = boxMask({ x: 10, y: 8, w: 10, h: 16 }, 0, 255);
    const px = (x: number, y: number): number[] => Array.from(compositeRect(doc.layers, { x, y, w: 1, h: 1 }));
    expect(px(12, 10)).toEqual([255, 255, 255, 255]);
    expect(px(25, 10)).toEqual([220, 20, 30, 255]);
    top.mask = { ...top.mask, data: new Uint8Array(160).fill(128) };
    expect(px(12, 10)[1]).toBeGreaterThan(130); expect(px(12, 10)[1]).toBeLessThan(140);
    top.mask = { ...top.mask, enabled: false };
    expect(flat(doc)).toEqual(before);
  });
});

describe('W6 S1 masks: commands, undo and redo', () => {
  it('adds, inverts, switches, links, applies and removes, each one step that undoes and redoes exactly', () => {
    const { doc, top } = doc2();
    doc.selection = { x: 12, y: 10, w: 6, h: 4 };
    const steps = [
      () => addMask(doc, top, 'selection'), () => invertLayerMask(doc, top), () => setMaskSettings(doc, top, { enabled: false }),
      () => setMaskSettings(doc, top, { linked: false }), () => setMaskSettings(doc, top, { density: 0.4, feather: 2 }), () => applyMask(doc, top),
    ];
    for (const run of steps) {
      const a = { flat: flat(doc), mask: top.mask && maskSummary(top.mask), data: Array.from(top.data) };
      const cmd = run();
      expect(cmd).toBeTruthy();
      const b = { flat: flat(doc), mask: doc.layers[1].mask && maskSummary(doc.layers[1].mask), data: Array.from(doc.layers[1].data) };
      cmd?.undo(doc);
      expect({ flat: flat(doc), mask: doc.layers[1].mask && maskSummary(doc.layers[1].mask), data: Array.from(doc.layers[1].data) }).toEqual(a);
      cmd?.redo(doc);
      expect({ flat: flat(doc), mask: doc.layers[1].mask && maskSummary(doc.layers[1].mask), data: Array.from(doc.layers[1].data) }).toEqual(b);
    }
    expect(doc.layers[1].mask).toBeUndefined();
    const { doc: d2, top: t2 } = doc2();
    expect(addMask(d2, t2, 'hide')).toBeTruthy();
    expect(maskAt(t2.mask as LayerMask, 15, 12)).toBe(0);
    expect(deleteMask(d2, t2)).toBeTruthy();
    expect(t2.mask).toBeUndefined();
  });
  it('makes the mask permanent: hidden pixels become see-through', () => {
    const { doc, top } = doc2();
    doc.selection = { x: 10, y: 8, w: 5, h: 16 };
    addMask(doc, top, 'hide-selection');
    const before = flat(doc);
    applyMask(doc, top);
    expect(top.mask).toBeUndefined();
    expect(top.data[3]).toBe(0);
    expect(top.data[(0 * 20 + 10) * 4 + 3]).toBe(255);
    expect(flat(doc)).toEqual(before);
  });
  it('duplicating a layer copies its mask buffer and never shares it', () => {
    const { top } = doc2();
    top.mask = boxMask({ x: 0, y: 0, w: 4, h: 4 }, 9, 255);
    const c = duplicateLayer(top);
    expect(c.mask?.data).not.toBe(top.mask.data);
    expect(maskSummary(c.mask as LayerMask)).toEqual(maskSummary(top.mask));
  });
});

describe('W6 S1 masks: painting through the mask surface', () => {
  const setup = (): { doc: Doc; top: Layer } => { const s = doc2(); s.top.mask = boxMask({ x: 10, y: 8, w: 20, h: 16 }, 255, 255); return s; };
  const check = (label: string, edit: (d: Doc, l: Layer) => unknown, expectHidden: [number, number] | null): void => {
    const { doc, top } = setup(), m0 = maskSummary(top.mask as LayerMask), px0 = Array.from(top.data);
    const cmd = withMaskSurface(doc, top, label, edit);
    expect(cmd, label).toBeTruthy();
    expect(Array.from(top.data), label + ': the pixels stay').toEqual(px0);
    if (expectHidden) expect(maskAt(top.mask as LayerMask, ...expectHidden), label).toBeLessThan(40);
    const m1 = maskSummary(top.mask as LayerMask);
    cmd?.undo(doc);
    expect(maskSummary(doc.layers[1].mask as LayerMask), label + ' undo').toEqual(m0);
    cmd?.redo(doc);
    expect(maskSummary(doc.layers[1].mask as LayerMask), label + ' redo').toEqual(m1);
  };
  it('brush, eraser, fill, gradient, Gaussian blur and invert each fold back and undo exactly', () => {
    check('brush', (d, s) => { const k = new Stroke(d, s, { size: 6, hardness: 1, opacity: 1, color: BLACK, erase: false }); k.add({ x: 12, y: 12 }); k.add({ x: 20, y: 12 }); k.end(); }, [15, 12]);
    check('eraser hides', (d, s) => { const k = new Stroke(d, s, { size: 6, hardness: 1, opacity: 1, color: BLACK, erase: true }); k.add({ x: 15, y: 15 }); k.end(); }, [15, 15]);
    check('fill', (d, s) => { d.selection = { x: 12, y: 10, w: 4, h: 4 }; fillSelection(d, s, BLACK); }, [13, 11]);
    check('gradient', (d, s) => fillGradient(d, s, { kind: 'linear', from: { x: 10, y: 0 }, to: { x: 30, y: 0 }, stops: [BLACK, { r: 255, g: 255, b: 255, a: 255 }], opacity: 1 }), [10, 12]);
    check('invert', (d, s) => applyToLayer(d, s, 'Invert', (b) => { const o = b.data.slice(); for (let i = 0; i < o.length; i += 4) { o[i] = 255 - o[i]; o[i + 1] = 255 - o[i + 1]; o[i + 2] = 255 - o[i + 2]; } return o; }), [15, 12]);
    const { doc, top } = setup();
    top.mask = { ...(top.mask as LayerMask), data: new Uint8Array(320).fill(255).fill(0, 0, 160) };
    const cmd = withMaskSurface(doc, top, 'blur', (d, s) => applyToLayer(d, s, 'Blur', (b) => gaussianBlur(b, 3), 9));
    expect(cmd).toBeTruthy();
    const v = maskAt(top.mask as LayerMask, 20, 16);
    expect(v).toBeGreaterThan(20); expect(v).toBeLessThan(235);
  });
  it('a stroke past the mask box grows the box; undo gives back the very same mask', () => {
    const { doc, top } = doc2();
    top.mask = boxMask({ x: 10, y: 8, w: 4, h: 4 }, 255, 255);
    const first = top.mask, s = openMaskSurface(doc, top);
    const k = new Stroke(s.doc, s.layer, { size: 4, hardness: 1, opacity: 1, color: BLACK, erase: false });
    k.add({ x: 11, y: 9 }); s.fold(k.takeDirty());
    k.add({ x: 25, y: 20 }); s.fold(k.takeDirty());
    const cmd = s.finish('Paint on the mask');
    expect((top.mask as LayerMask).width).toBeGreaterThan(4);
    expect(maskAt(top.mask as LayerMask, 25, 20)).toBe(0);
    cmd?.undo(doc);
    expect(doc.layers[1].mask).toBe(first);
    expect(Array.from(first.data)).toEqual(new Array(16).fill(255));
  });
});

describe('W6 S1 masks: every geometry command carries masks', () => {
  /** Red layer with a mask that hides its left half; linked or not. */
  const setup = (linked = true): { doc: Doc; top: Layer } => {
    const s = doc2();
    s.top.mask = { ...boxMask({ x: 10, y: 8, w: 10, h: 16 }, 0, 255), linked };
    return s;
  };
  const m = (l: Layer): LayerMask => l.mask as LayerMask;
  it('move (setLayerProps and propsCommand, the move tool, nudge and Properties X and Y): linked follows, unlinked stays', () => {
    const a = setup(true), cmd = setLayerProps(a.doc, a.top.id, { x: 13, y: 9 });
    expect([m(a.top).x, m(a.top).y]).toEqual([13, 9]);
    cmd?.undo(a.doc); expect([m(a.top).x, m(a.top).y]).toEqual([10, 8]);
    cmd?.redo(a.doc); expect([m(a.top).x, m(a.top).y]).toEqual([13, 9]);
    const b = setup(false);
    setLayerProps(b.doc, b.top.id, { x: 13, y: 9 });
    expect([m(b.top).x, m(b.top).y]).toEqual([10, 8]);
    const c = setup(true), p = propsCommand(c.top.id, { x: 10, y: 8 }, { x: 4, y: 2 });
    p.redo(c.doc); expect([m(c.top).x, m(c.top).y]).toEqual([4, 2]);
  });
  it('align and distribute move linked masks with their layers', () => {
    const a = setup(true);
    alignLayer(a.doc, a.top.id, null, 'left');
    expect(m(a.top).x).toBe(a.top.x);
    const b = setup(true), l2 = createLayer('B', 4, 4, { x: 0, y: 0, fill: RED }), l3 = createLayer('C', 4, 4, { x: 36, y: 0, fill: RED });
    addLayer(b.doc, l2); addLayer(b.doc, l3);
    const dx0 = m(b.top).x - b.top.x;
    distributeLayers(b.doc, [l2.id, b.top.id, l3.id], 'h');
    expect(m(b.top).x - b.top.x).toBe(dx0);
  });
  it('free transform: a linked mask is redrawn with its layer; an unlinked one stays', () => {
    const a = setup(true), before = maskSummary(m(a.top));
    const q = (l: Layer) => [{ x: l.x, y: l.y }, { x: l.x + 40, y: l.y }, { x: l.x + 40, y: l.y + 32 }, { x: l.x, y: l.y + 32 }] as [any, any, any, any];
    const cmd = transformLayer(a.doc, a.top, q(a.top));
    expect([m(a.top).width, m(a.top).height]).toEqual([20, 32]);
    cmd?.undo(a.doc); expect(maskSummary(m(a.doc.layers[1]))).toEqual(before);
    const b = setup(false);
    transformLayer(b.doc, b.top, q(b.top));
    expect(maskSummary(m(b.top))).toEqual({ ...before, linked: false });
  });
  it('turn and flip the layer: a linked mask stays on the same pixels, four turns give it back', () => {
    const a = setup(true), seen = flat(a.doc), start = maskSummary(m(a.top));
    turnLayer(a.doc, 'flip-h');
    expect(maskAt(m(a.top), a.top.x + a.top.width - 1, a.top.y)).toBe(0);
    turnLayer(a.doc, 'flip-h');
    expect(flat(a.doc)).toEqual(seen);
    for (let i = 0; i < 4; i++) turnLayer(a.doc, 'cw');
    expect({ ...maskSummary(m(a.top)), x: 0, y: 0 }).toEqual({ ...start, x: 0, y: 0 });
    expect([m(a.top).x - a.top.x, m(a.top).y - a.top.y]).toEqual([0, 0]);
    const b = setup(false);
    turnLayer(b.doc, 'cw');
    expect(maskSummary(m(b.top))).toEqual({ ...start, linked: false });
  });
  it('crop, picture size, canvas size, turn picture, trim and reveal all change every mask, linked or not', () => {
    for (const linked of [true, false]) {
      const a = setup(linked);
      cropDocument(a.doc, { x: 5, y: 4, w: 30, h: 20 });
      expect([m(a.doc.layers[1]).x, m(a.doc.layers[1]).y]).toEqual([5, 4]);
      const b = setup(linked);
      resizeDocument(b.doc, 80, 60);
      expect([m(b.doc.layers[1]).x, m(b.doc.layers[1]).width, m(b.doc.layers[1]).height]).toEqual([20, 20, 32]);
      const c = setup(linked);
      resizeCanvas(c.doc, 50, 40, 0, 0);
      expect(m(c.doc.layers[1]).x).toBe(10);
      const c2 = setup(linked);
      resizeCanvas(c2.doc, 50, 40, 1, 1);
      expect(m(c2.doc.layers[1]).x).toBe(20);
      const d = setup(linked), before = compositeRect(d.doc.layers, { x: 12, y: 10, w: 1, h: 1 });
      turnDocument(d.doc, 'cw');
      expect(Array.from(compositeRect(d.doc.layers, { x: 30 - 1 - 10, y: 12, w: 1, h: 1 }))).toEqual(Array.from(before));
      const e = setup(linked);
      e.doc.layers[0].data.fill(0);
      trimDocument(e.doc);
      expect([e.doc.width, m(e.doc.layers[1]).width, m(e.doc.layers[1]).outside]).toEqual([10, 0, 255]);
      const f = setup(linked);
      f.top.x = -6;
      revealAll(f.doc);
      expect(m(f.doc.layers[1]).x).toBe(16);
    }
  });
  it('growing a layer to cover an area changes the layer only', () => {
    const a = setup(true), before = maskSummary(m(a.top));
    growLayerToCover(a.top, { x: 0, y: 0, w: 40, h: 30 });
    expect(maskSummary(m(a.top))).toEqual(before);
  });
  it('merge down and merge visible draw the masks into the result and keep no mask', () => {
    const a = setup(true), seen = flat(a.doc);
    mergeDown(a.doc);
    expect(a.doc.layers[0].mask).toBeUndefined();
    expect(flat(a.doc)).toEqual(seen);
    const b = setup(true), seen2 = flat(b.doc);
    mergeVisible(b.doc);
    expect(b.doc.layers[0].mask).toBeUndefined();
    expect(flat(b.doc)).toEqual(seen2);
  });
});

describe('W6 S1 masks: PSD', () => {
  it('round-trips masks: box, pixels, outside, on or off, density and soft edge, and the flat picture', () => {
    const { doc, top } = doc2();
    const data = new Uint8Array(8 * 6);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 255;
    top.mask = { x: 12, y: 9, width: 8, height: 6, data, outside: 0, enabled: true, linked: true, density: 0.73, feather: 2.5 };
    const l3 = createLayer('Off', 10, 10, { x: 2, y: 2, fill: { r: 0, g: 90, b: 200, a: 255 } });
    l3.mask = { ...boxMask({ x: 0, y: 0, w: 0, h: 0 }, 0, 255), data: new Uint8Array(0), width: 0, height: 0, enabled: false };
    addLayer(doc, l3);
    const back = readPsdDocument(writePsdDocument(doc));
    expect(back.notes).toEqual([]);
    const strip = (d: Doc) => d.layers.map(({ id: _id, ...rest }) => ({ ...rest, data: Array.from(rest.data), mask: rest.mask && { ...rest.mask, data: Array.from(rest.mask.data) } }));
    expect(strip(back.doc)).toEqual(strip(doc));
    expect(flat(back.doc)).toEqual(flat(doc));
  });
});

describe('W6 S1 masks: the loss words', () => {
  it('says masks are drawn flat in PNG, JPEG and WebP, and that PSD keeps them', async () => {
    const { lossReport, docFacts } = await import('../src/index');
    const { doc, top } = doc2();
    top.mask = boxMask({ x: 10, y: 8, w: 4, h: 4 }, 0, 255);
    const f = docFacts(doc);
    expect(f.masks).toBe(1);
    expect(lossReport(f, 'png').losses.find((l) => l.id === 'structure')?.text).toBe("Your mask is drawn into one flat picture, so you can't change it later in this file.");
    expect(lossReport(f, 'psd').kept).toContain('with its mask');
  });
});
