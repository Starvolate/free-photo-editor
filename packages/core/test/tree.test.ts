// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** W6 S2: folders and clipping. The tree rules, the recursive compositor worked out by hand, the stroke cache and PSD. */
import { describe, expect, it } from 'vitest';
import {
  BLEND_MODES, StrokeCache, addFolder, addLayer, arrangeNode, checkTree, compositeRect, createDocument, createFolder, createLayer,
  deleteLayer, duplicateActive, flatten, groupNode, mergeDown, mergeVisible, repairTree, toggleClip, ungroupNode,
  type Doc, type Layer, type RGBA,
} from '../src/index';
import { readPsdDocument, writePsdDocument } from '../src/psd';

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
const px = (doc: Doc, x = 0, y = 0): number[] => Array.from(compositeRect(doc.layers, { x, y, w: 1, h: 1 }));
const solid = (name: string, c: RGBA, w = 1, h = 1, extra: Partial<Layer> = {}): Layer => ({ ...createLayer(name, w, h, { fill: c }), ...extra });
const folder = (name: string, extra: Partial<Layer> = {}): Layer => ({ ...createFolder(name), ...extra });
/** A document from nodes listed bottom to top; `in` names the folder each one sits in. */
function docOf(nodes: [Layer, string?][], w = 1, h = 1): Doc {
  const byName = new Map(nodes.map(([l]) => [l.name, l]));
  const layers = nodes.map(([l, inside]) => { if (inside) l.parentId = (byName.get(inside) as Layer).id; return l; });
  expect(checkTree(layers)).toBeNull();
  return { width: w, height: h, layers, activeId: layers[layers.length - 1].id, selection: null };
}
const GREY: RGBA = { r: 128, g: 128, b: 128, a: 255 }, RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };

describe('the recursive compositor, worked out by hand', () => {
  it('pass through mixes the contents into what is below; a normal folder isolates them', () => {
    const mk = (pass: boolean) => docOf([[solid('B', GREY)], [solid('C', GREY, 1, 1, { blendMode: 'multiply' }), 'F'], [folder('F', { passThrough: pass })]]);
    expect(px(mk(true))).toEqual([64, 64, 64, 255]); // 128 × 128 / 255
    expect(px(mk(false))).toEqual([128, 128, 128, 255]); // multiply onto a clear sheet is plain
  });
  it('a clip group: the base shape (soft) cuts the clipped layer; a hidden base hides the group; a hidden clipped layer drops out', () => {
    const mk = (base: Partial<Layer>, top: Partial<Layer>) => docOf([[solid('W', WHITE)], [solid('S', { r: 0, g: 0, b: 0, a: 128 }, 1, 1, base)], [solid('C', RED, 1, 1, { clip: true, ...top })]]);
    expect(px(mk({}, {}))).toEqual([255, 127, 127, 255]);
    expect(px(mk({ visible: false }, {}))).toEqual([255, 255, 255, 255]);
    expect(px(mk({}, { visible: false }))).toEqual([127, 127, 127, 255]);
  });
  it('a clipped layer at the bottom of its folder is drawn unclipped', () => {
    const d = docOf([[solid('W', WHITE)], [solid('C', RED, 1, 1, { clip: true }), 'F'], [folder('F')]]);
    expect(px(d)).toEqual([255, 0, 0, 255]);
  });
  it('folder opacity and mask, pass through or isolated', () => {
    for (const pass of [true, false]) {
      const d = docOf([[solid('W', WHITE)], [solid('R', RED)], [folder('F', { passThrough: pass, opacity: 0.5 })]].map(([l], i) => [l, i === 1 ? 'F' : undefined] as [Layer, string?]));
      expect(px(d), String(pass)).toEqual([255, 128, 128, 255]);
      (d.layers[2] as Layer).mask = { x: 0, y: 0, width: 0, height: 0, data: new Uint8Array(0), outside: 0, enabled: true, linked: true, density: 1, feather: 0 };
      expect(px(d), String(pass)).toEqual([255, 255, 255, 255]);
    }
  });
  it('nesting 4 deep: pass through changes nothing; isolated halves multiply', () => {
    for (const [pass, want] of [[true, [255, 0, 0, 255]], [false, [255, 239, 239, 255]]] as const) {
      const F = [1, 2, 3, 4].map((n) => folder('F' + n, { passThrough: pass, opacity: pass ? 1 : 0.5 }));
      const d = docOf([[solid('W', WHITE)], [solid('R', RED), 'F4'], [F[3], 'F3'], [F[2], 'F2'], [F[1], 'F1'], [F[0]]]);
      expect(px(d), String(pass)).toEqual(want);
    }
  });
  it('plain pixel layers give the same bytes through the tree path, in every blend mode', () => {
    for (const mode of BLEND_MODES) {
      const a = solid('A', { r: 200, g: 40, b: 90, a: 200 }, 4, 3), b = solid('B', { r: 20, g: 180, b: 60, a: 160 }, 4, 3, { blendMode: mode, opacity: 0.7 });
      const flat = compositeRect([a, b], { x: 0, y: 0, w: 4, h: 3 }, WHITE);
      const tree = compositeRect([a, b, folder('empty')], { x: 0, y: 0, w: 4, h: 3 }, WHITE);
      expect(Array.from(tree), mode).toEqual(Array.from(flat));
    }
  });
});

/** A seeded random number source, so a failure can be replayed. */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function noise(name: string, w: number, h: number, r: () => number, extra: Partial<Layer> = {}): Layer {
  const l = createLayer(name, w, h, { x: Math.floor(r() * 30) - 5, y: Math.floor(r() * 20) - 5 });
  for (let i = 0; i < l.data.length; i++) l.data[i] = Math.floor(r() * 256);
  return { ...l, ...extra };
}
/** A random document built only through the public structure edits. */
function randomDoc(seed: number, steps = 40): { doc: Doc; r: () => number } {
  const r = rng(seed), doc = createDocument(40, 30, WHITE);
  for (let s = 0; s < steps; s++) {
    doc.activeId = doc.layers[Math.floor(r() * doc.layers.length)].id;
    const k = r();
    if (k < 0.3) addLayer(doc, noise('n' + s, 4 + Math.floor(r() * 20), 4 + Math.floor(r() * 16), r, {
      blendMode: BLEND_MODES[Math.floor(r() * BLEND_MODES.length)], opacity: 0.3 + r() * 0.7,
      ...(r() < 0.3 ? { mask: { x: 5, y: 5, width: 10, height: 8, data: new Uint8Array(80).map(() => Math.floor(r() * 256)), outside: r() < 0.5 ? 0 : 255, enabled: true, linked: true, density: 1, feather: r() < 0.5 ? 2 : 0 } as Layer['mask'] } : {}),
    }));
    else if (k < 0.4) addFolder(doc);
    else if (k < 0.5) groupNode(doc, doc.activeId);
    else if (k < 0.55) ungroupNode(doc, doc.activeId);
    else if (k < 0.75) arrangeNode(doc, doc.activeId, (['front', 'forward', 'backward', 'back'] as const)[Math.floor(r() * 4)]);
    else if (k < 0.82) toggleClip(doc, doc.activeId);
    else if (k < 0.87) duplicateActive(doc);
    else if (k < 0.9) deleteLayer(doc, doc.activeId);
    else {
      const f = doc.layers.filter((l) => l.kind === 'folder');
      if (f.length) { const x = f[Math.floor(r() * f.length)]; if (r() < 0.5) x.passThrough = !x.passThrough; else x.open = !x.open; if (r() < 0.3) x.blendMode = 'multiply'; if (r() < 0.3) x.opacity = 0.6; }
    }
  }
  return { doc, r };
}

describe('the tree rules', () => {
  it('stays a sound tree after 500 random arrange, group, ungroup, duplicate and delete steps, and undo brings each back', () => {
    const r = rng(7), doc = createDocument(20, 20, WHITE);
    const shape = (d: Doc) => JSON.stringify(d.layers.map((l) => [l.id, l.parentId ?? '', !!l.clip]));
    for (let s = 0; s < 500; s++) {
      doc.activeId = doc.layers[Math.floor(r() * doc.layers.length)].id;
      const before = shape(doc), k = r();
      const cmd = k < 0.2 ? addLayer(doc, createLayer('L' + s, 2, 2)) : k < 0.3 ? addFolder(doc) : k < 0.45 ? groupNode(doc, doc.activeId)
        : k < 0.55 ? ungroupNode(doc, doc.activeId) : k < 0.8 ? arrangeNode(doc, doc.activeId, (['front', 'forward', 'backward', 'back'] as const)[Math.floor(r() * 4)])
          : k < 0.88 ? duplicateActive(doc) : deleteLayer(doc, doc.activeId);
      expect(checkTree(doc.layers), `step ${s}`).toBeNull();
      if (cmd && r() < 0.3) {
        const after = shape(doc);
        cmd.undo(doc); expect(shape(doc), `undo ${s}`).toBe(before);
        cmd.redo(doc); expect(shape(doc), `redo ${s}`).toBe(after);
      }
      if (r() < 0.1) { const f = doc.layers.filter((l) => l.kind === 'folder'); if (f.length) f[0].open = !f[0].open; }
    }
  });
  it('arranging goes into an open folder, jumps over a closed one, and leaves at the edge', () => {
    const d = docOf([[solid('A', RED)], [solid('in', RED), 'F'], [folder('F')], [solid('T', RED)]]);
    const names = () => d.layers.map((l) => l.name + (l.parentId ? '<' : '')).join(' ');
    d.activeId = d.layers[3].id;
    arrangeNode(d, d.activeId, 'backward'); expect(names()).toBe('A in< T< F');
    arrangeNode(d, d.activeId, 'backward'); expect(names()).toBe('A T< in< F');
    arrangeNode(d, d.activeId, 'backward'); expect(names()).toBe('A T in< F');
    (d.layers.find((l) => l.name === 'F') as Layer).open = false;
    arrangeNode(d, d.activeId, 'forward'); expect(names()).toBe('A in< F T');
    expect(checkTree(d.layers)).toBeNull();
  });
  it('repairs a broken list: missing parents go to the top level and a split run is regrouped', () => {
    const f = folder('F'), a = solid('a', RED), b = solid('b', RED), c = solid('c', RED, 1, 1, { parentId: 'gone' });
    a.parentId = f.id; b.parentId = f.id;
    const fixed = repairTree([a, c, b, f]);
    expect(fixed.map((l) => l.name)).toEqual(['c', 'a', 'b', 'F']);
    expect(checkTree(fixed)).toBeNull();
  });
  it('merge down bakes a clipped layer into its base; an active folder merges into one layer; merge visible keeps hidden layers', () => {
    const d = docOf([[solid('W', WHITE)], [solid('S', { r: 0, g: 0, b: 0, a: 128 })], [solid('C', RED, 1, 1, { clip: true })]]);
    const want = px(d);
    expect(mergeDown(d)).not.toBeNull();
    expect(d.layers.length).toBe(2);
    expect(px(d)).toEqual(want);
    const e = docOf([[solid('W', WHITE)], [solid('R', RED, 1, 1, { blendMode: 'multiply' }), 'F'], [solid('H', RED, 1, 1, { visible: false }), 'F'], [folder('F', { passThrough: false, opacity: 0.6 })]]);
    const look = px(e);
    e.activeId = e.layers[3].id;
    const cmd = mergeDown(e);
    expect(e.layers.map((l) => l.name)).toEqual(['W', 'F']);
    expect(px(e)).toEqual(look);
    cmd?.undo(e);
    expect(e.layers.map((l) => l.name)).toEqual(['W', 'R', 'H', 'F']);
    mergeVisible(e);
    expect(e.layers.map((l) => [l.name, l.parentId ?? ''])).toEqual([['W', ''], ['H', '']]);
    expect(checkTree(e.layers)).toBeNull();
  });
});

describe('the stroke cache', () => {
  it('cached frames equal uncached ones, frame after frame, at every depth of folders and clip groups', () => {
    let live = 0, deep = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { doc, r } = randomDoc(seed);
      const pixels = doc.layers.filter((l) => !l.kind);
      const target = pixels[Math.floor(r() * pixels.length)];
      const cache = new StrokeCache(doc.layers, target, WHITE, 16);
      for (let f = 0; f < 6; f++) {
        for (let i = 0; i < 40; i++) target.data[Math.floor(r() * target.data.length)] = Math.floor(r() * 256);
        const x = Math.floor(r() * 36) - 2, y = Math.floor(r() * 26) - 2, rect = { x, y, w: 1 + Math.floor(r() * 30), h: 1 + Math.floor(r() * 20) };
        expect(Array.from(cache.composite(rect)), `seed ${seed} frame ${f}`).toEqual(Array.from(compositeRect(doc.layers, rect, WHITE)));
      }
      const st = cache.stats;
      if (!st.dead && st.tiles) live++;
      if (st.depth > 1) deep++;
    }
    // most runs really resume from kept rows, and many go through folders or clip groups
    expect(live).toBeGreaterThan(25);
    expect(deep).toBeGreaterThan(8);
  });
});

describe('PSD keeps folders and clipping', () => {
  it('round trip: nesting, order, pass through or blend, open or closed, clip, folder mask; the same flattened bytes', () => {
    const d = docOf([
      [solid('B', WHITE, 6, 4)],
      [solid('A', { r: 10, g: 200, b: 30, a: 255 }, 4, 3), 'P'],
      [solid('C', { r: 200, g: 0, b: 90, a: 200 }, 3, 3, { clip: true, x: 1 }), 'P'],
      [folder('P')],
      [solid('D', { r: 90, g: 90, b: 250, a: 255 }, 2, 2, { x: 3, y: 1 }), 'M'],
      [folder('M', { passThrough: false, blendMode: 'screen' }), 'N'],
      [folder('N', { passThrough: false, blendMode: 'multiply', opacity: 0.6, open: false, mask: { x: 0, y: 0, width: 2, height: 2, data: new Uint8Array([255, 0, 128, 255]), outside: 255, enabled: true, linked: true, density: 1, feather: 0 } })],
    ], 6, 4);
    const back = readPsdDocument(writePsdDocument(d)).doc;
    const view = (x: Doc) => x.layers.map((l) => {
      const p = x.layers.find((q) => q.id === l.parentId);
      return [l.name, l.kind ?? 'pixel', p?.name ?? '', !!l.clip, !!l.passThrough, l.open !== false || l.kind !== 'folder', l.blendMode, l.opacity, l.visible, !!l.mask];
    });
    expect(view(back)).toEqual(view(d));
    expect(checkTree(back.layers)).toBeNull();
    expect(Array.from(flatten(back).data)).toEqual(Array.from(flatten(d).data));
  });
});
