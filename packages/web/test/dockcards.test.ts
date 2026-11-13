// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import type { Layer, LayerEffects } from '@free-photoeditor/core';
import { fxList, histIconName, layerNames, layerSub, toggleFx } from '../src/dockcards';

const L = (o: Partial<Layer>): Layer => ({ id: 'a', name: 'A', blendMode: 'normal', ...o }) as Layer;
const TEXT = { kind: 'text' } as Layer['content'], SHAPE = { kind: 'shape' } as Layer['content'];

describe('dock rows (UI-D)', () => {
  it('a layer row says what kind of layer it is, then how it blends', () => {
    expect(layerSub(L({}))).toBe('Pixels · Normal');
    expect(layerSub(L({ kind: 'adjust', clip: true }))).toBe('Adjustment, clipped · Normal');
    expect(layerSub(L({ blendMode: 'multiply', content: TEXT }))).toBe('Text · Multiply');
    expect(layerSub(L({ content: SHAPE }))).toBe('Shape · Normal');
    expect(layerSub(L({ kind: 'fill', blendMode: 'screen' }))).toBe('Colour fill · Screen');
  });
  it('lists each effect once per copy and switches one copy without touching the rest', () => {
    const black = { r: 0, g: 0, b: 0, a: 255 }, sh = { on: true, opacity: 0.75, color: black, angle: 120, distance: 10, spread: 0, size: 10 };
    const f = { on: true, dropShadow: [sh, { ...sh, on: false }], innerShadow: [], colorOverlay: [], gradientOverlay: [], stroke: [],
      outerGlow: { on: true, opacity: 1, color: black, spread: 0, size: 8 } } as LayerEffects;
    expect(fxList(f).map((e) => [e.plain, e.i, e.on])).toEqual([['Drop shadow', 0, true], ['Drop shadow', 1, false], ['Outer glow', -1, true]]);
    const g = toggleFx(f, 'dropShadow', 1);
    expect(g).not.toBe(f);
    expect(f.dropShadow[1].on, 'the old value is never changed').toBe(false);
    expect(g.dropShadow.map((e) => e.on)).toEqual([true, true]);
    expect(g.dropShadow[0]).toBe(f.dropShadow[0]);
    expect(g.dropShadow[1].size).toBe(10);
    expect(toggleFx(f, 'outerGlow', -1).outerGlow?.on).toBe(false);
    expect(fxList(undefined)).toEqual([]);
  });
  it('gives each History step an icon for its kind of change', () => {
    expect(['Opened jug.png', 'Add drop shadow', 'Hide outer glow', 'Paint on the mask', 'Clip to the layer below', 'New tone curve layer', 'Add text "Marbled jug"',
      'Smooth blur, kept editable', 'Brush', 'Eraser', 'Crop', 'Move layer', 'Layer opacity', 'Make a smart layer', 'Something new'].map(histIconName))
      .toEqual(['image', 'sparkles', 'sparkles', 'scan', 'clip', 'sliders', 'type', 'droplet', 'brush', 'eraser', 'crop', 'move', 'layers', 'layers', 'history']);
  });
});
