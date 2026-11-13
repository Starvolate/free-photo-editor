// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** W6 S2 follow-up: a folder carries its contents. Move, X/Y, nudge, Align and Free transform on a folder are one undo step. */
import { describe, expect, it } from 'vitest';
import {
  alignLayer, carriedNodes, carriesLocked, carryQuad, checkTree, createDocument, createFolder, createLayer, makeMask, moveNode,
  nodeContentBounds, placeSpots, quadOfRect, spotsOf, transformNode, type Doc, type Layer, type RGBA,
} from '../src/index';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const at = (d: Doc, name: string): Layer => d.layers.find((l) => l.name === name) as Layer;
const where = (d: Doc): string[] => d.layers.map((l) => `${l.name}@${l.x},${l.y} ${l.width}x${l.height}`);
/** Bottom to top: Background, A in F, B in N, N in F, F; plus a loose layer C on top. */
function docWithFolders(): Doc {
  const d = createDocument(64, 48, null);
  const f = createFolder('F'), n = { ...createFolder('N'), parentId: f.id };
  const a = { ...createLayer('A', 4, 4, { fill: RED, x: 10, y: 10 }), parentId: f.id };
  const b = { ...createLayer('B', 6, 6, { fill: RED, x: 30, y: 20 }), parentId: n.id };
  const c = createLayer('C', 2, 2, { fill: RED, x: 50, y: 40 });
  d.layers.push(a, b, n, f, c);
  d.activeId = f.id;
  expect(checkTree(d.layers)).toBeNull();
  return d;
}

describe('a folder carries its contents', () => {
  it('a move carries every layer inside, a nested folder too, and leaves the rest; one undo puts all back exactly', () => {
    const d = docWithFolders(), before = where(d), f = at(d, 'F');
    expect(carriedNodes(d, f.id).map((l) => l.name)).toEqual(['A', 'B', 'N', 'F']);
    const cmd = moveNode(d, f.id, 7, -3);
    if (!cmd) throw new Error('no step');
    expect([at(d, 'A').x, at(d, 'A').y, at(d, 'B').x, at(d, 'B').y]).toEqual([17, 7, 37, 17]);
    expect([at(d, 'C').x, at(d, 'C').y, d.layers[0].x]).toEqual([50, 40, 0]);
    cmd.undo(d);
    expect(where(d)).toEqual(before);
    cmd.redo(d);
    expect([at(d, 'A').x, at(d, 'B').y]).toEqual([17, 17]);
    expect(moveNode(d, f.id, 0, 0)).toBeNull();
  });

  it('a plain layer still moves alone, and a linked mask on a layer inside follows', () => {
    const d = docWithFolders(), a = at(d, 'A');
    const m = makeMask(d, 'reveal');
    if (!m) throw new Error('no mask');
    a.mask = { ...m, linked: true };
    const mx = m.x;
    const cmd = moveNode(d, at(d, 'F').id, 5, 0);
    expect(at(d, 'A').mask?.x).toBe(mx + 5);
    cmd?.undo(d);
    expect(at(d, 'A').mask?.x).toBe(mx);
    moveNode(d, at(d, 'C').id, 1, 1);
    expect([at(d, 'C').x, at(d, 'A').x]).toEqual([51, 10]);
  });

  it('a live drag places every carried node from its start, and back to zero restores them', () => {
    const d = docWithFolders(), before = where(d), spots = spotsOf(d, at(d, 'F').id);
    const r = placeSpots(d, spots, 4, 4);
    expect([at(d, 'A').x, at(d, 'B').x]).toEqual([14, 34]);
    expect(r).toEqual({ x: 10, y: 10, w: 30, h: 20 });
    placeSpots(d, spots, 0, 0);
    expect(where(d)).toEqual(before);
  });

  it('a locked layer inside, or a locked folder around it, stops the move', () => {
    const d = docWithFolders(), f = at(d, 'F');
    expect(carriesLocked(d, f.id)).toBe(false);
    at(d, 'B').locked = true;
    expect(carriesLocked(d, f.id)).toBe(true);
    expect(carriesLocked(d, at(d, 'A').id)).toBe(false);
    at(d, 'B').locked = false;
    f.locked = true;
    expect(carriesLocked(d, at(d, 'A').id)).toBe(true);
  });

  it('Align on a folder lines up the union of everything inside, as one step', () => {
    const d = docWithFolders(), f = at(d, 'F'), before = where(d);
    expect(nodeContentBounds(d, f)).toEqual({ x: 10, y: 10, w: 26, h: 16 });
    const cmd = alignLayer(d, f.id, null, 'left');
    if (!cmd) throw new Error('no step');
    expect([at(d, 'A').x, at(d, 'B').x, at(d, 'C').x]).toEqual([0, 20, 50]);
    alignLayer(d, f.id, null, 'bottom')?.undo(d);
    cmd.undo(d);
    expect(where(d)).toEqual(before);
    expect(alignLayer(d, f.id, { x: 0, y: 0, w: 64, h: 48 }, 'right')).not.toBeNull();
    expect(at(d, 'B').x + at(d, 'B').width).toBe(64);
  });

  it('Free transform on a folder warps every layer inside by one map, and one undo restores the pixels', () => {
    const d = docWithFolders(), f = at(d, 'F'), before = where(d), data = at(d, 'B').data.slice();
    // The box is (10,10)-(36,26); doubling it about its corner sends A to (10,10) 8x8 and B to (50,30) 12x12.
    const box = quadOfRect({ x: 10, y: 10, w: 26, h: 16 }), to = quadOfRect({ x: 10, y: 10, w: 52, h: 32 });
    expect(carryQuad(box, to, { x: 30, y: 20, w: 6, h: 6 })?.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[50, 30], [62, 30], [62, 42], [50, 42]]);
    const cmd = transformNode(d, f.id, to);
    if (!cmd) throw new Error('no step');
    const a = at(d, 'A'), b = at(d, 'B');
    // Smooth resampling may add one soft pixel on an edge, so each side is checked to within a pixel.
    const near = (v: number, want: number): boolean => Math.abs(v - want) <= 1;
    expect([near(a.x, 10), near(a.y, 10), near(a.x + a.width, 18), near(a.y + a.height, 18)]).toEqual([true, true, true, true]);
    expect([near(b.x, 50), near(b.y, 30), near(b.x + b.width, 62), near(b.y + b.height, 42)]).toEqual([true, true, true, true]);
    expect([at(d, 'C').x, at(d, 'C').width]).toEqual([50, 2]);
    cmd.undo(d);
    expect(where(d)).toEqual(before);
    expect(Array.from(at(d, 'B').data)).toEqual(Array.from(data));
  });
});
