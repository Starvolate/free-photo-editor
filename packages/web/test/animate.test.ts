// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Animation (animate.ts): frames from layers, a time per frame, the order, the loop setting, and that the GIF and moving
 * PNG export keep all of it. Every number below is worked out by hand from the frame model: frame n is layer n, bottom
 * first, its time is in its name, and a GIF stores times in hundredths of a second.
 */
import { createDocument, createLayer, type Doc } from '@free-photoeditor/core';
import { decodeGif, encodeApng, encodeGif, decodeApng } from '@free-photoeditor/formats/anim';
import { framesOf } from '@free-photoeditor/formats/util';
import { describe, expect, it } from 'vitest';
import { addFrames, byName, cannotFrame, clampDelay, frameName, framesDoc, makeFrames, moveFrame, neighbours, setDelay, setLoop, showOnly, tint, withDelay } from '../src/animate';

const RED = { r: 255, g: 0, b: 0, a: 255 }, GREEN = { r: 0, g: 255, b: 0, a: 255 }, BLUE = { r: 0, g: 0, b: 255, a: 255 };
function doc(names = ['Sky', 'Sun (250 ms)', 'Moon']): Doc {
  const fills = [RED, GREEN, BLUE];
  const layers = names.map((n, i) => createLayer(n, 2, 1, { fill: fills[i % 3] }));
  return { width: 2, height: 1, layers, activeId: layers[0].id, selection: null };
}
const names = (d: Doc): string[] => d.layers.map((l) => l.name);
const shown = (d: Doc): boolean[] => d.layers.map((l) => l.visible);
const count = (b: Uint8Array, s: string): number => { let n = 0; for (let i = b.indexOf(s.charCodeAt(0)); i >= 0; i = b.indexOf(s.charCodeAt(0), i + 1)) if ([...s].every((c, k) => b[i + k] === c.charCodeAt(0))) n++; return n; };
const at = (b: Uint8Array, s: string): number => { for (let i = 0; i < b.length; i++) if ([...s].every((c, k) => b[i + k] === c.charCodeAt(0))) return i; return -1; };

describe('frame names and times', () => {
  it('writes the time after the name, in steps of 10 ms from 20 ms to 10 s', () => {
    expect(withDelay('Waves', 123)).toBe('Waves (120 ms)');
    expect(withDelay('Frame 2 (80 ms)', 5)).toBe('Frame 2 (20 ms)');
    expect(clampDelay(99999)).toBe(10000);
    expect(clampDelay(Number.NaN)).toBe(100);
    expect(frameName('Sun (250 ms)')).toBe('Sun');
    expect(frameName(' (40 ms)')).toBe('Frame');
  });
});

describe('Make animation frames', () => {
  it('gives every layer its time (keeping one it has), shows frame 1 only, and is one undo step', () => {
    const d = doc(), before = names(d);
    const c = makeFrames(d);
    expect(c?.label).toBe('Make animation frames');
    expect(names(d)).toEqual(['Sky (100 ms)', 'Sun (250 ms)', 'Moon (100 ms)']);
    expect(shown(d)).toEqual([true, false, false]);
    // The export reads the same frames: bottom first, with these times.
    expect(framesOf(d, true, 100).map((f) => [f.name, f.delay])).toEqual([['Sky', 100], ['Sun', 250], ['Moon', 100]]);
    c?.undo(d);
    expect(names(d)).toEqual(before);
    expect(shown(d)).toEqual([true, true, true]);
    c?.redo(d);
    expect(names(d)[2]).toBe('Moon (100 ms)');
  });
  it('refuses one layer and layers in folders, in plain words', () => {
    expect(cannotFrame(doc(['Only']))).toMatch(/second layer/);
    const d = doc();
    d.layers[1].parentId = d.layers[2].id;
    expect(cannotFrame(d)).toMatch(/folders/);
    expect(makeFrames(d)).toBeNull();
  });
});

describe('the timeline steps', () => {
  it('sets one frame time, shows one frame, and moves a frame', () => {
    const d = doc(), [a, b, c] = d.layers.map((l) => l.id);
    makeFrames(d);
    setDelay(d, b, 333);
    expect(names(d)[1]).toBe('Sun (330 ms)');
    const s = showOnly(d, 2);
    expect(shown(d)).toEqual([false, false, true]);
    s?.undo(d);
    expect(shown(d)).toEqual([true, false, false]);
    const m = moveFrame(d, 0, 2);
    expect(d.layers.map((l) => l.id)).toEqual([b, c, a]);
    m?.undo(d);
    expect(d.layers.map((l) => l.id)).toEqual([a, b, c]);
    expect(moveFrame(d, 0, 0)).toBeNull();
  });
  it('keeps how many times it plays on the picture, as one undo step', () => {
    const d = doc(), c = setLoop(d, 1);
    expect(d.loop).toBe(1);
    expect(c?.label).toBe('Play once');
    c?.undo(d);
    expect('loop' in d).toBe(false);
    expect(setLoop(d, 0)).toBeNull();
  });
});

describe('the export keeps the times and the loop setting', () => {
  const frames = () => { const d = doc(); makeFrames(d); return framesOf(d, true, 100); };
  it('GIF: forever writes one loop block with 0 repeats; once writes none; 3 times writes 2 repeats', () => {
    const forever = encodeGif(frames()), once = encodeGif(frames(), undefined, 1), three = encodeGif(frames(), undefined, 3);
    expect(count(forever, 'NETSCAPE2.0')).toBe(1);
    const i = at(forever, 'NETSCAPE2.0');
    expect([...forever.subarray(i + 11, i + 16)]).toEqual([3, 1, 0, 0, 0]);
    expect(count(once, 'NETSCAPE2.0')).toBe(0);
    const k = at(three, 'NETSCAPE2.0');
    expect([...three.subarray(k + 11, k + 16)]).toEqual([3, 1, 2, 0, 0]);
    // Read back: three frames, red, green, blue, at 100, 250 and 100 ms.
    const m = decodeGif(once);
    expect(m.frames.map((f) => f.delay)).toEqual([100, 250, 100]);
    expect(m.frames.map((f) => [...f.bmp.data.subarray(0, 4)])).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
  });
  it('moving PNG: the plays count is 0 for forever and 1 for once, after the frame count', () => {
    for (const [loop, plays] of [[0, 0], [1, 1]]) {
      const b = encodeApng(frames(), undefined, loop), i = at(b, 'acTL') + 4;
      expect([...b.subarray(i, i + 8)]).toEqual([0, 0, 0, 3, 0, 0, 0, plays]);
      expect(decodeApng(b).frames.map((f) => f.delay)).toEqual([100, 250, 100]);
    }
  });
});

describe('onion skin and import frames', () => {
  it('pulls a frame towards red or green and keeps its see-through parts', () => {
    // 100 + (255 - 100) * 0.6 = 193; 50 - 50 * 0.6 = 20; 200 - 200 * 0.6 = 80; alpha kept. A clear pixel stays clear.
    expect([...tint(new Uint8ClampedArray([100, 50, 200, 128, 0, 0, 0, 0]), [255, 0, 0], 0.6)]).toEqual([193, 20, 80, 128, 153, 0, 0, 0]);
    // 100 - 60 = 40; 50 + 205 * 0.6 = 173; 80.
    expect([...tint(new Uint8ClampedArray([100, 50, 200, 255]), [0, 255, 0], 0.6)]).toEqual([40, 173, 80, 255]);
  });
  it('finds the frame before and the frame after the one being worked on', () => {
    const d = doc();
    d.activeId = d.layers[1].id;
    expect([neighbours(d).prev?.id, neighbours(d).next?.id]).toEqual([d.layers[0].id, d.layers[2].id]);
    d.activeId = d.layers[0].id;
    expect([neighbours(d).prev, neighbours(d).next?.id]).toEqual([null, d.layers[1].id]);
  });
  it('sorts picked files by name, numbers counted, and adds them as hidden frames at the end in one undo step', () => {
    expect(byName([{ name: 'walk10.png' }, { name: 'walk2.png' }, { name: 'Walk1.png' }]).map((f) => f.name)).toEqual(['Walk1.png', 'walk2.png', 'walk10.png']);
    const d = createDocument(6, 4, null), before = d.layers.length;
    const px = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
    const c = addFrames(d, [{ name: 'a', width: 2, height: 2, data: px }, { name: 'b (40 ms)', width: 2, height: 2, data: px }]);
    // Centred in 6 x 4: x = (6 - 2) / 2 = 2, y = (4 - 2) / 2 = 1.
    expect(d.layers.slice(before).map((l) => [l.name, l.visible, l.x, l.y, l.width, l.data[4]])).toEqual([['a (100 ms)', false, 2, 1, 2, 4], ['b (40 ms)', false, 2, 1, 2, 4]]);
    c?.undo(d);
    expect(d.layers.length).toBe(before);
    expect(addFrames(d, [])).toBeNull();
  });
  it('keeps the picked layer picked after an import, through undo and redo', () => {
    const d = createDocument(6, 4, null), picked = d.activeId, n = d.layers.length;
    const px = new Uint8ClampedArray(2 * 2 * 4).fill(9);
    const c = addFrames(d, [{ name: 'a', width: 2, height: 2, data: px }, { name: 'b', width: 2, height: 2, data: px }]);
    // Two frames added at the end, yet the layer picked before stays picked (adding a layer would pick the last, hidden one).
    expect([d.layers.length, d.activeId]).toEqual([n + 2, picked]);
    c?.undo(d);
    expect([d.layers.length, d.activeId]).toEqual([n, picked]);
    c?.redo(d);
    expect([d.layers.length, d.activeId, d.layers[n + 1].name]).toEqual([n + 2, picked, 'b (100 ms)']);
  });
  it('makes a new picture from the first frame when none is open, frame 1 showing', () => {
    const px = new Uint8ClampedArray(2 * 3 * 4).fill(200);
    const d = framesDoc([{ name: 'f1', width: 2, height: 3, data: px }, { name: 'f2', width: 2, height: 3, data: px }]);
    expect([d?.width, d?.height, d?.layers.map((l) => [l.name, l.visible])]).toEqual([2, 3, [['f1 (100 ms)', true], ['f2 (100 ms)', false]]]);
    // Frame 1 is the one showing, so it is also the picked one, and onion skin's next frame is frame 2.
    expect(d?.activeId).toBe(d?.layers[0].id);
    expect(d && neighbours(d).next?.name).toBe('f2 (100 ms)');
    expect(framesDoc([])).toBeNull();
  });
});
