// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { cageOf, gridOf, pinsOf } from '@free-photoeditor/core/warp';
import type { JobParams } from '@free-photoeditor/core';
import { ADJ, HANDLERS, WARP_IDS } from '../src/commands';
import { HANDLES } from '../src/handles';
import { SHAPE_FILLS, WARP_HANDLES, nearestEdge, pctOf } from '../src/warpkit';

// A box 101 pixels wide and 51 high: one percent is one pixel across and half a pixel down.
const B = { x: 10, y: 20, w: 101, h: 51 };

describe('Bend and push dialogs (warpkit)', () => {
  it('adds every bend to the dialogs and its handles to the picture, each with a handler', () => {
    for (const id of WARP_IDS) { expect(ADJ[id], id).toBeTruthy(); expect(HANDLERS[id], id).toBeTruthy(); }
    for (const k of ['mesh', 'plane', 'pins', 'cage']) expect(HANDLES[k]).toBe(WARP_HANDLES[k]);
    expect(HANDLERS['image.fit-canvas'] && HANDLERS['edit.transform-again']).toBeTruthy();
  });
  it('turns picture pixels into handle percentages and back', () => {
    expect(pctOf(B, 60, 45)).toEqual([50, 50]);
    expect(pctOf(B, 10_000, -10_000)).toEqual([150, -50]);
  });
  it('starts the grid where the core starts it, and drags one handle to the pointer', () => {
    const p: JobParams = { ...SHAPE_FILLS[0] };
    expect(gridOf(p)).toEqual(gridOf({}));
    const hs = WARP_HANDLES.mesh.draw(p, B).handles;
    expect(hs).toHaveLength(16);
    expect([hs[5].x, hs[5].y].map((v) => +v.toFixed(6))).toEqual([10 + 100 / 3, 20 + 50 / 3].map((v) => +v.toFixed(6)));
    WARP_HANDLES.mesh.drag('g5', 60, 45, p, B);
    expect([p.g5x, p.g5y]).toEqual([50, 50]);
    // Arc lifts the two middle columns by 15%; the corners stay.
    expect([SHAPE_FILLS[1].g1y, SHAPE_FILLS[1].g0y, SHAPE_FILLS[1].g12y]).toEqual([-15, 0, 100]);
  });
  it('places pins with a press and drags them', () => {
    const p: JobParams = {}, set = WARP_HANDLES.pins;
    expect(set.draw(p, B).handles).toEqual([]);
    expect(set.add?.(60, 45, p, B)).toBe('q0');
    expect(set.add?.(20, 20, p, B)).toBe('q1');
    set.drag('q1', 30, 20, p, B);
    expect(pinsOf(p)).toEqual({ from: [[50, 50], [10, 0]], to: [[50, 50], [20, 0]] });
  });
  it('marks the flat surface and carries its re-angled corner along', () => {
    const p: JobParams = { step: 1 }, set = WARP_HANDLES.plane;
    set.drag('b0', 40, 30, p, B);
    expect([p.b0x, p.b0y]).toEqual([30, 20]);
    p.step = 0;
    expect(set.draw(p, B).handles.map((h) => h.key)).toEqual(['a0', 'a1', 'a2', 'a3']);
    set.drag('a0', 20, 20, p, B);
    expect([p.a0x, p.a0y, p.b0x, p.b0y]).toEqual([10, 0, 15, -5]);
  });
  it('shapes the cage, adds a point on the nearest edge, then moves only the moved cage', () => {
    const p: JobParams = { n: 4 }, set = WARP_HANDLES.cage;
    [[0, 0], [100, 0], [100, 100], [0, 100]].forEach(([x, y], i) => { p[`o${i}x`] = p[`c${i}x`] = x; p[`o${i}y`] = p[`c${i}y`] = y; });
    expect(nearestEdge(cageOf(p).drawn, 50, 2)).toBe(0);
    expect(set.add?.(60, 21, p, B)).toBe('o1');
    expect(cageOf(p).drawn.map((q) => q.map((v) => Math.round(v)))).toEqual([[0, 0], [50, 2], [100, 0], [100, 100], [0, 100]]);
    p.step = 1;
    expect(set.add?.(60, 45, p, B)).toBeNull();
    set.drag('c0', 20, 20, p, B);
    expect([cageOf(p).drawn[0], cageOf(p).moved[0]]).toEqual([[0, 0], [10, 0]]);
  });
});
