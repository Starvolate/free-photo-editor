// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import type { Layer } from '@free-photoeditor/core';
import { fxWhy } from '../src/ribbon';

const L = (o: Partial<Layer>): Layer => ({ id: 'a', name: 'Tone curve', blendMode: 'normal', ...o }) as Layer;
describe('why a layer effect is off (UI-D fix 5)', () => {
  it('names the active layer and says what to pick instead', () => {
    expect(fxWhy('Drop shadow', L({ kind: 'adjust' }))).toBe("Drop shadow follows the edges of a layer's own pixels. Tone curve is a light and colour layer with no pixels of its own, so pick a picture, text or shape layer in Layers.");
    expect(fxWhy('Outline', L({ kind: 'fill', name: 'Backdrop' }))).toContain('Backdrop is a colour layer that covers the whole picture');
    expect(fxWhy('Outer glow', L({ kind: 'folder', name: 'Product' }))).toBe('Outer glow goes on one layer, not a folder: open Product and pick a layer inside it.');
    expect(fxWhy('Drop shadow', L({ locked: true, name: 'Jug' }))).toBe('Jug is locked: unlock it in Layers, then Drop shadow can go on it.');
    expect(fxWhy('Drop shadow', undefined)).toBe('Drop shadow goes on an unlocked picture layer: pick one in Layers.');
  });
});
