// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Automate and batch: a recorded set plays back to the same pixels as the steps done by hand, names, sizes, the sheet's geometry. */
import { describe, expect, it } from 'vitest';
import { WHITE, createAdjustLayer, createDocument, flatten, runJob, turnDocument, type Doc, type Layer } from '@free-photoeditor/core';
import { runEffect } from '@free-photoeditor/core/fx';
import { BY_ID } from '../src/registry';
import { ADJ } from '../src/commands';
import { STARTERS, buildPassport, editsToSteps, collageLayout, cropToShape, fitIn, markPlace, mmPx, passportPlan, stampMark, freeName, loadSets, localJob, outputNames, playSteps, recordStep, sheetLayout, sizeFor, stepText, type Step } from '../src/automate';

/** A 40 × 30 picture with a colour ramp and a hard edge, so sharpening and grain both change it. */
function picture(): Doc {
  const d = createDocument(40, 30, WHITE), l = d.layers[0];
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
    const i = (y * 40 + x) * 4;
    l.data[i] = x * 6; l.data[i + 1] = x < 20 ? 40 : 210; l.data[i + 2] = y * 8; l.data[i + 3] = 255;
  }
  return d;
}
const env = { job: localJob, bg: WHITE };
const bmp = (d: Doc) => ({ width: d.layers[0].width, height: d.layers[0].height, data: d.layers[0].data.slice() });
/** The dialog's settings for an id: its defaults with `p` on top, as the dialog hands them to the engine. */
const settings = (id: string, p: Record<string, number> = {}): Record<string, number> =>
  Object.fromEntries(ADJ[id].controls.map((c) => [c.key, p[c.key] ?? c.value]));

describe('Recorded steps', () => {
  it('records from the command bus: dialogs once applied with their settings, plain steps as they run, nothing for views', () => {
    const r = { steps: [] as Step[], passed: new Set<string>() };
    recordStep(r, 'filter.unsharp');
    recordStep(r, 'filter.unsharp', { amount: 1.5, radius: 2, threshold: 0, ix: 3, iy: 4, iw: 10, ih: 10 });
    recordStep(r, 'image.flip-h');
    recordStep(r, 'view.zoom-in');
    recordStep(r, 'edit.undo');
    recordStep(r, 'edit.free-transform');
    recordStep(r, 'image.size', { w: 20, h: 15, sw: 40, sh: 30 });
    expect(r.steps).toEqual([{ id: 'filter.unsharp', p: { amount: 1.5, radius: 2, threshold: 0 } }, { id: 'image.flip-h' },
      { id: 'image.size', p: { w: 20, h: 15, sw: 40, sh: 30, long: 20 } }]);
    expect([...r.passed]).toEqual([BY_ID.get('edit.free-transform')?.plain]);
  });

  it('plays a recorded set to the same pixels as doing the steps by hand, as one undo step', async () => {
    const steps: Step[] = [{ id: 'filter.unsharp', p: { amount: 1.5, radius: 2, threshold: 0 } }, { id: 'image.flip-h' },
      { id: 'filter.add-noise', p: { amount: 30, dist: 1, mono: 1, seed: 5 } }, { id: 'image.adj-invert' }];
    // By hand: each dialog's engine on the whole layer (no selection, so the edited box is the layer), then Flip.
    const hand = picture();
    hand.layers[0].data.set(runJob({ op: 'sharpen', params: settings('filter.unsharp', steps[0].p) }, bmp(hand)));
    turnDocument(hand, 'flip-h');
    hand.layers[0].data.set(runEffect({ op: 'fx', kind: 'add-noise', params: { ...settings('filter.add-noise', steps[2].p), ix: 0, iy: 0, iw: 40, ih: 30 } }, bmp(hand)));
    hand.layers[0].data.set(runJob({ op: 'adjust', kind: 'invert', params: {} }, bmp(hand)));

    const played = picture(), start = played.layers[0].data.slice();
    const { cmd, skipped } = await playSteps(played, steps, env, 'Test set');
    expect(skipped).toEqual([]);
    expect(cmd?.label).toBe('Test set');
    expect(Buffer.from(played.layers[0].data).equals(Buffer.from(hand.layers[0].data))).toBe(true);
    expect(Buffer.from(played.layers[0].data).equals(Buffer.from(start))).toBe(false);
    cmd?.undo(played);
    expect(Buffer.from(played.layers[0].data).equals(Buffer.from(start))).toBe(true);
    cmd?.redo(played);
    expect(Buffer.from(played.layers[0].data).equals(Buffer.from(hand.layers[0].data))).toBe(true);
  });

  it('keeps to the selected area, and skips an adjustment on a locked layer instead of changing it', async () => {
    const d = picture(), start = d.layers[0].data.slice();
    d.selection = { x: 0, y: 0, w: 10, h: 30 } as unknown as Doc['selection'];
    await playSteps(d, [{ id: 'image.adj-invert' }], env);
    const px = (x: number, y: number) => Array.from(d.layers[0].data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 3));
    expect(px(5, 5)).toEqual([255 - start[(5 * 40 + 5) * 4], 255 - start[(5 * 40 + 5) * 4 + 1], 255 - start[(5 * 40 + 5) * 4 + 2]]);
    expect(px(30, 5)).toEqual(Array.from(start.subarray((5 * 40 + 30) * 4, (5 * 40 + 30) * 4 + 3)));
    const locked = picture();
    locked.layers[0].locked = true;
    const r = await playSteps(locked, [{ id: 'image.adj-invert' }], env);
    expect(r.cmd).toBeNull();
    expect(r.skipped).toEqual([BY_ID.get('image.adj-invert')?.plain]);
  });

  it('sizes a picture: the same pixels where it was recorded, the same longest side elsewhere, never larger when asked', async () => {
    expect(sizeFor(40, 30, { w: 20, h: 15, sw: 40, sh: 30, long: 20 })).toEqual({ width: 20, height: 15 });
    expect(sizeFor(80, 60, { w: 20, h: 15, sw: 40, sh: 30, long: 20 })).toEqual({ width: 20, height: 15 });
    expect(sizeFor(4000, 3000, { long: 1600, shrink: 1 })).toEqual({ width: 1600, height: 1200 });
    expect(sizeFor(3000, 4000, { long: 1600, shrink: 1 })).toEqual({ width: 1200, height: 1600 });
    expect(sizeFor(1000, 800, { long: 1600, shrink: 1 })).toBeNull();
    expect(sizeFor(1000, 800, { long: 1600 })).toEqual({ width: 1600, height: 1280 });
    const d = picture();
    const { cmd } = await playSteps(d, STARTERS[0].steps.slice(0, 1).map((s) => ({ ...s, p: { long: 20 } })), env);
    expect([d.width, d.height, d.layers[0].width]).toEqual([20, 15, 20]);
    cmd?.undo(d);
    expect([d.width, d.height]).toEqual([40, 30]);
  });

  it('ships starter sets made only of Ready functions, and says each step in plain words', () => {
    expect(STARTERS.map((s) => s.name)).toEqual(['Web size and sharpen', 'Black and white with grain']);
    for (const s of STARTERS) for (const st of s.steps) expect(BY_ID.get(st.id)?.status, st.id).toBe('ready');
    expect(stepText(STARTERS[0].steps[0])).toBe(`${BY_ID.get('image.size')?.plain}: longest side 1600 px, only smaller`);
    expect(stepText({ id: 'filter.unsharp', p: { amount: 0.8, radius: 1, threshold: 2 } })).toBe(`${BY_ID.get('filter.unsharp')?.plain}: Strength 0.8 ×, Ignore small differences 2`);
    expect(stepText({ id: 'image.flip-h' })).toBe(BY_ID.get('image.flip-h')?.plain);
  });

  it('keeps sets in the browser, falls back to the starters, and drops what it cannot play', () => {
    expect(loadSets(null).map((s) => s.name)).toEqual(STARTERS.map((s) => s.name));
    expect(loadSets({ getItem: () => 'not json' }).length).toBe(2);
    expect(loadSets({ getItem: () => { throw new Error('blocked'); } }).length).toBe(2);
    const kept = loadSets({ getItem: () => JSON.stringify([{ name: 'Mine', steps: [{ id: 'image.flip-v' }, { id: 'evil.code' }, { id: 'view.zoom-in' }] }]) });
    expect(kept).toEqual([{ name: 'Mine', steps: [{ id: 'image.flip-v' }] }]);
    expect(freeName('Mine', kept)).toBe('Mine 2');
    expect(freeName('  ', [])).toBe('My steps');
  });
});

describe('Many pictures', () => {
  it('names results in the order the pictures were picked, with the new type, never two alike', () => {
    expect(outputNames(['b.jpg', 'a.png', 'b.png', 'B.jpg', 'no type'], 'jpg')).toEqual(['b.jpg', 'a.jpg', 'b (2).jpg', 'B (3).jpg', 'no type.jpg']);
  });
  it('lays out the sheet of small photos: square cells, gaps, caption strips, photos fitted and centred', () => {
    const p = sheetLayout(5, 3, 1000, 20, true);
    expect(p.cell).toBe(306);
    expect([p.width, p.height]).toEqual([1000, 20 + 2 * (306 + 28 + 20)]);
    expect(p.cells[0]).toEqual({ x: 20, y: 20, w: 306, h: 306 });
    expect(p.cells[4]).toEqual({ x: 346, y: 374, w: 306, h: 306 });
    expect(p.captions[0]).toEqual({ x: 20, y: 326, w: 306, h: 28 });
    expect(sheetLayout(2, 4, 1000, 10, false).cells.length).toBe(2);
    expect(sheetLayout(2, 4, 1000, 10, false).cell).toBe(485);
    expect(fitIn(200, 100, { x: 20, y: 20, w: 306, h: 306 })).toEqual({ x: 20, y: 96, w: 306, h: 153 });
    expect(fitIn(50, 100, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });
});

describe('Watermark, collage and passport photo sheet', () => {
  it('places a mark in the nine places, a margin from the edges, kept on the picture, centred when bigger than it', () => {
    expect(markPlace(200, 100, 50, 20, 'br', 10)).toEqual({ x: 140, y: 70 });
    expect(markPlace(200, 100, 50, 20, 'tl', 10)).toEqual({ x: 10, y: 10 });
    expect(markPlace(200, 100, 50, 20, 'c', 10)).toEqual({ x: 75, y: 40 });
    expect(markPlace(200, 100, 50, 20, 't', 10)).toEqual({ x: 75, y: 10 });
    expect(markPlace(200, 100, 50, 20, 'r', 10)).toEqual({ x: 140, y: 40 });
    expect(markPlace(200, 100, 50, 20, 'bl', 500)).toEqual({ x: 150, y: 0 });
    expect(markPlace(200, 100, 300, 20, 'br', 10)).toEqual({ x: -50, y: 70 });
  });
  it('stamps the mark as its own top layer, sized to the picture width, at its opacity; one undo takes it away', () => {
    const d = createDocument(200, 100, WHITE), mark = { width: 40, height: 20, data: new Uint8ClampedArray(40 * 20 * 4) };
    for (let i = 0; i < mark.data.length; i += 4) mark.data.set([255, 0, 0, 255], i);
    const cmd = stampMark(d, mark, { size: 25, place: 'br', margin: 5, opacity: 50 }), l = d.layers[d.layers.length - 1];
    // 25 % of 200 = 50 wide, so 25 high; 5 % of the shorter side (100) = 5 px: x = 200 - 50 - 5, y = 100 - 25 - 5.
    expect([d.layers.length, l.name, l.x, l.y, l.width, l.height, l.opacity]).toEqual([2, 'Watermark', 145, 70, 50, 25, 0.5]);
    const px = flatten(d).data, at = (x: number, y: number): number[] => Array.from(px.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 4));
    expect(at(10, 10)).toEqual([255, 255, 255, 255]);
    const m = at(160, 80);
    expect([m[0], m[2], m[3]]).toEqual([255, m[1], 255]);
    expect(Math.abs(m[1] - 127.5)).toBeLessThanOrEqual(1);
    cmd.undo(d);
    expect(d.layers.length).toBe(1);
  });
  it('lays photos out in a grid, a row, a column, or one big beside the rest', () => {
    expect(collageLayout(5, 'grid', 1000, 800, 20)).toEqual([{ x: 20, y: 20, w: 306, h: 370 }, { x: 346, y: 20, w: 306, h: 370 }, { x: 672, y: 20, w: 306, h: 370 },
      { x: 20, y: 410, w: 306, h: 370 }, { x: 346, y: 410, w: 306, h: 370 }]);
    expect(collageLayout(3, 'feature', 1000, 600, 10)).toEqual([{ x: 10, y: 10, w: 646, h: 580 }, { x: 666, y: 10, w: 324, h: 285 }, { x: 666, y: 305, w: 324, h: 285 }]);
    expect(collageLayout(2, 'row', 500, 300, 10)).toEqual([{ x: 10, y: 10, w: 235, h: 280 }, { x: 255, y: 10, w: 235, h: 280 }]);
    expect(collageLayout(2, 'column', 300, 500, 0)).toEqual([{ x: 0, y: 0, w: 300, h: 250 }, { x: 0, y: 250, w: 300, h: 250 }]);
    expect(collageLayout(1, 'feature', 400, 300, 10)).toEqual([{ x: 10, y: 10, w: 380, h: 280 }]);
  });
  it('works out a passport page: 35 × 45 mm on a 6 × 4 inch print at 300 dpi holds 8 copies', () => {
    expect([mmPx(35, 300), mmPx(45, 300), mmPx(2, 300)]).toEqual([413, 531, 24]);
    const plan = passportPlan(35, 45, 152.4, 101.6, 300, 2);
    expect([plan.width, plan.height, plan.photo.w, plan.photo.h, plan.cells.length]).toEqual([1800, 1200, 413, 531, 8]);
    expect(plan.cells.slice(0, 2)).toEqual([{ x: 38, y: 57, w: 413, h: 531 }, { x: 475, y: 57, w: 413, h: 531 }]);
    expect(plan.cells[4]).toEqual({ x: 38, y: 612, w: 413, h: 531 });
    expect(passportPlan(50.8, 50.8, 152.4, 101.6, 300, 2).cells.length).toBe(2);
    expect(cropToShape({ x: 0, y: 0, w: 960, h: 640 }, 35 / 45)).toEqual({ x: 231, y: 0, w: 498, h: 640 });
  });
  it('fills the page with copies of the photo (or of the selected box), grey cutting lines around each, set to print at its dpi', () => {
    // At 50.8 dpi 1 mm is 2 px: a 35 × 45 mm copy is 70 × 90 px, the 6 × 4 inch page 305 × 203 px, the gap 4 px.
    const src = createDocument(70, 90, WHITE), l = src.layers[0];
    for (let i = 0; i < 70 * 90; i++) l.data.set((i % 70) < 35 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const { doc, copies } = buildPassport(src, 35, 45, 152.4, 101.6, 50.8, 2);
    expect([doc.width, doc.height, doc.layers.length, doc.dpi, copies]).toEqual([305, 203, 2, 50.8, 8]);
    const px = flatten(doc).data, at = (x: number, y: number): number[] => Array.from(px.subarray((y * 305 + x) * 4, (y * 305 + x) * 4 + 4));
    // The block of 4 × 2 copies is 292 × 184 px, centred: the first copy starts at (6, 9), the next 74 px to its right.
    expect([at(16, 19), at(66, 19), at(90, 19), at(140, 19)]).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [255, 0, 0, 255], [0, 0, 255, 255]]);
    expect([at(5, 19), at(76, 19), at(77, 19)]).toEqual([[200, 200, 200, 255], [200, 200, 200, 255], [255, 255, 255, 255]]);
    src.selection = { x: 35, y: 0, w: 35, h: 45 };
    const sel = flatten(buildPassport(src, 35, 45, 152.4, 101.6, 50.8, 2).doc).data;
    expect(Array.from(sel.subarray((19 * 305 + 16) * 4, (19 * 305 + 16) * 4 + 4))).toEqual([0, 0, 255, 255]);
  });
});

describe('Copy edits', () => {
  const KINDS = ['brightness', 'levels', 'curves', 'exposure', 'vibrance', 'hue', 'color-balance', 'bw', 'photo-filter', 'channel-mixer', 'invert', 'posterize',
    'threshold', 'gradient-map', 'selective-color'];
  /** The dialog's defaults with its first slider moved halfway towards its far end, so the layer really changes the picture. */
  const moved = (from: string): Record<string, number> => {
    const p = settings(from), c = ADJ[from].controls.find((x) => !x.type || x.type === 'range');
    if (c) { const far = c.value >= (c.max ?? c.value) ? c.min ?? c.value : c.max ?? c.value; p[c.key] = c.value + (far - c.value) / 2; }
    return p;
  };
  const adjLayer = (name: string, from: string, p = settings(from)): Layer => createAdjustLayer(name, from, { op: ADJ[from].op, kind: ADJ[from].kind, params: p });

  it('pastes each kind of light-and-colour layer as a step that gives exactly the pixels of the layer itself', async () => {
    let changed = 0;
    for (const k of KINDS) {
      const from = 'image.adj-' + k, src = picture();
      src.layers.push(adjLayer('Edit', from, moved(from)));
      const { steps, skipped } = editsToSteps(src, null);
      expect(skipped, k).toEqual([]);
      expect(steps.map((s) => s.id), k).toEqual([from]);
      const target = picture(), before = Buffer.from(flatten(target).data);
      const played = await playSteps(target, steps, env, 'Pasted edits');
      expect(played.skipped, k).toEqual([]);
      const got = Buffer.from(flatten(target).data);
      expect(got.equals(Buffer.from(flatten(src).data)), k).toBe(true);
      if (!got.equals(before)) changed++;
      // Hand-checked: Invert turns the top-left pixel (0, 40, 0) into (255, 215, 255).
      if (k === 'invert') expect([...got.subarray(0, 4)]).toEqual([255, 215, 255, 255]);
    }
    expect(changed).toBeGreaterThanOrEqual(13);
  });

  it('copies the last filter first, then the layers from the bottom up, and names each layer it cannot copy, with why', () => {
    const d = picture(), add = (l: Layer, f: (x: Layer) => void = () => undefined): void => { f(l); d.layers.push(l); };
    add(adjLayer('Invert', 'image.adj-invert'));
    add(adjLayer('Masked', 'image.adj-invert'), (l) => { l.mask = { x: 0, y: 0, width: 1, height: 1, data: new Uint8ClampedArray(1) } as unknown as Layer['mask']; });
    add(adjLayer('Half', 'image.adj-invert'), (l) => { l.opacity = 0.5; });
    add(adjLayer('Multiply', 'image.adj-invert'), (l) => { l.blendMode = 'multiply'; });
    add(adjLayer('Hidden', 'image.adj-invert'), (l) => { l.visible = false; });
    add(adjLayer('Clipped', 'image.adj-invert'), (l) => { l.clip = true; });
    add(adjLayer('Foreign', 'image.adj-invert'), (l) => { l.adjust = { from: 'psd.unknown', job: null }; });
    add(adjLayer('Levels', 'image.adj-levels', settings('image.adj-levels', { gamma: 1.4 })));
    const r = editsToSteps(d, { id: 'filter.unsharp', params: { amount: 1.5, radius: 2, threshold: 0, ix: 1, iy: 1, iw: 5, ih: 5 } });
    expect(r.steps).toEqual([{ id: 'filter.unsharp', p: { amount: 1.5, radius: 2, threshold: 0 } }, { id: 'image.adj-invert', p: {} },
      { id: 'image.adj-levels', p: settings('image.adj-levels', { gamma: 1.4 }) }]);
    expect(r.skipped).toEqual([
      { name: 'Masked', why: 'it has a mask, so it changes only part of the picture' }, { name: 'Half', why: 'its opacity is below 100 %' },
      { name: 'Multiply', why: 'its blend mode is not Normal' }, { name: 'Hidden', why: 'it is hidden' }, { name: 'Clipped', why: 'it changes only the layer under it' },
      { name: 'Foreign', why: 'it came from another program and cannot be played here' }]);
    expect(editsToSteps(picture(), null)).toEqual({ steps: [], skipped: [] });
    expect(editsToSteps(null, null)).toEqual({ steps: [], skipped: [] });
  });
});
