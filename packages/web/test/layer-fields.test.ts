// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { createLayer, type Doc } from '@free-photoeditor/core';
import { describe, expect, it } from 'vitest';
import { plainDoc } from '../src/autosave';

describe('layer colour label and notes', () => {
  it('autosave keeps the colour label and a copy of the notes and tags', () => {
    const l = createLayer('Sky', 1, 1), plain = createLayer('Plain', 1, 1);
    l.label = 'green';
    l.meta = { notes: 'Shot at noon', tags: ['sky', 'final'] };
    const d: Doc = { width: 1, height: 1, layers: [l, plain], activeId: l.id, selection: null };
    const out = plainDoc(d);
    expect(out.layers[0].label).toBe('green');
    expect(out.layers[0].meta).toEqual({ notes: 'Shot at noon', tags: ['sky', 'final'] });
    expect(out.layers[0].meta?.tags).not.toBe(l.meta.tags);
    expect('label' in out.layers[1] || 'meta' in out.layers[1]).toBe(false);
  });
});
