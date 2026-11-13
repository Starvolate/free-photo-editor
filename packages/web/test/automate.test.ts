// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Automate and batch: a recorded set plays back to the same pixels as the steps done by hand, names, sizes, the sheet's geometry. */
import { describe, expect, it } from 'vitest';
import { WHITE, createDocument, runJob, turnDocument, type Doc } from '@free-photoeditor/core';
import { runEffect } from '@free-photoeditor/core/fx';
import { BY_ID } from '../src/registry';
import { ADJ } from '../src/commands';
import { STARTERS, fitIn, freeName, loadSets, localJob, outputNames, playSteps, recordStep, sheetLayout, sizeFor, stepText, type Step } from '../src/automate';

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
