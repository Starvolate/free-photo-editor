// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The filter dialogs: every W2 filter is Ready, speaks in plain words, and its starting settings visibly change a photo. */
import { describe, expect, it } from 'vitest';
import { FX_KINDS, runEffect } from '@free-photoeditor/core/fx';
import { ADJ } from '../src/commands';
import { HANDLES } from '../src/handles';
import { BY_ID, ROWS } from '../src/registry';
// The batch filters' dialogs load on first use; loading them here adds them to ADJ, so every effect kind has its dialog.
import '../src/adj-more';
import '../src/light-more';

const CARD = [
  'blur-box', 'blur-motion', 'blur-radial', 'blur-surface', 'blur-smart', 'blur-average', 'blur-lens', 'blur-field', 'blur-iris', 'blur-tilt',
  'unsharp', 'smart-sharpen', 'sharpen-edges', 'sharpen-more', 'sharpen', 'blur-gaussian',
  'add-noise', 'reduce-noise', 'median', 'dust', 'despeckle', 'pinch', 'twirl', 'ripple', 'wave', 'polar', 'spherize', 'zigzag', 'displace', 'shear',
  'emboss', 'find-edges', 'solarize', 'oil-paint', 'wind', 'diffuse', 'tiles', 'extrude', 'trace-contour', 'glowing-edges',
  'mosaic', 'crystallize', 'pointillize', 'halftone', 'mezzotint', 'facet', 'fragment', 'clouds', 'difference-clouds', 'fibers',
  'high-pass', 'maximum', 'minimum', 'offset', 'custom',
].map((s) => 'filter.' + s);
const W = 40, H = 30, photo = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ring = Math.hypot(x - 20, y - 15) < 8 ? 100 : 0;
  photo.set([(x * 6 + ring) % 256, (y * 8 + (x % 5) * 20) % 256, ((x * y) % 7) * 30, x < 3 && y < 3 ? 0 : 255], (y * W + x) * 4);
}
const fxIds = Object.keys(ADJ).filter((id) => ADJ[id].op === 'fx');

describe('W2 filter dialogs', () => {
  it('makes every filter of the card Ready, with a dialog', () => {
    for (const id of CARD) { expect(BY_ID.get(id)?.status, id).toBe('ready'); expect(ADJ[id], id).toBeTruthy(); }
    expect(BY_ID.get('filter.liquify')?.status).toBe('ready');
    // The bends, Stretch without squashing (seam-scale) and deblur (core/warp.ts) have their dialogs or sheets in warpkit.ts,
    // loaded on first use and tested in warpkit.test.ts.
    const kinds = FX_KINDS.filter((k) => !k.endsWith('-warp') && k !== 'seam-scale' && k !== 'deblur');
    expect(new Set(fxIds.map((id) => ADJ[id].kind))).toEqual(new Set(kinds));
    expect(fxIds.length).toBe(kinds.length);
  });
  it('labels every setting in plain words with one help line', () => {
    for (const id of fxIds) for (const c of ADJ[id].controls) {
      expect(c.label.trim().length, `${id} ${c.key}`).toBeGreaterThan(1);
      expect(c.help.length, `${id} ${c.key}`).toBeGreaterThan(8);
      expect(c.help.length, `${id} ${c.key}`).toBeLessThanOrEqual(160);
      if (!c.type || c.type === 'range' || c.type === 'num') expect(c.value, `${id} ${c.key}`).toBeGreaterThanOrEqual(c.min ?? -Infinity);
      if (!c.type || c.type === 'range' || c.type === 'num') expect(c.value, `${id} ${c.key}`).toBeLessThanOrEqual(c.max ?? Infinity);
    }
  });
  it.each(fxIds)('%s changes a photo with its starting settings', (id) => {
    const params: Record<string, number> = { fg: 0x203040, bg: 0xf0e8d8 };
    for (const c of ADJ[id].controls) params[c.key] = c.value;
    const out = runEffect({ kind: ADJ[id].kind, params }, { width: W, height: H, data: photo });
    let changed = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i] !== photo[i] || out[i + 1] !== photo[i + 1] || out[i + 2] !== photo[i + 2] || out[i + 3] !== photo[i + 3]) changed++;
    expect(changed, id).toBeGreaterThan(W * H * 0.02);
  });
  it('moves each on-picture handle to where it is dragged, and keeps the sliders in range', () => {
    const box = { x: 100, y: 50, w: 400, h: 300 };
    for (const [name, set] of Object.entries(HANDLES)) {
      const id = fxIds.find((k) => ADJ[k].handles === name);
      expect(id, name).toBeTruthy();
      const p: Record<string, number> = {};
      for (const c of ADJ[id as string].controls) p[c.key] = c.value;
      const first = set.draw(p, box).handles[0];
      set.drag(first.key, 220, 140, p, box);
      const moved = set.draw(p, box).handles[0];
      expect(Math.abs(moved.x - 220)).toBeLessThanOrEqual(4);
      expect(Math.abs(moved.y - 140)).toBeLessThanOrEqual(3);
      for (const h of set.draw(p, box).handles) set.drag(h.key, 9999, -9999, p, box);
      for (const c of ADJ[id as string].controls) if (c.max !== undefined) { expect(p[c.key]).toBeLessThanOrEqual(c.max); expect(p[c.key]).toBeGreaterThanOrEqual(c.min ?? 0); }
    }
  });
  it('fills the whole grid from each ready-made custom filter', () => {
    const pick = ADJ['filter.custom'].controls.find((c) => c.key === 'preset');
    expect(pick?.fills?.length).toBe(pick?.options?.length);
    for (const f of pick?.fills ?? []) for (const k of ['scale', 'offset', ...Array.from({ length: 25 }, (_, i) => 'k' + i)]) expect(typeof f[k], k).toBe('number');
  });
  it('counts the Filter menu', () => {
    const rows = ROWS.filter((r) => r.id.startsWith('filter.'));
    expect(rows.filter((r) => r.status === 'ready').length).toBe(65);
  });
});
