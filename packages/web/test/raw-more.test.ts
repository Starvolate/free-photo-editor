// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The Develop RAW sheet (raw-more.ts): every command opens it at its own section, every slider has both names, looks keep and come back, scopes count. */
import { describe, expect, it } from 'vitest';
import { ADJ, HANDLERS, RAW_IDS } from '../src/commands';
import { HANDLES } from '../src/handles';
import { CONTROLS, FOCUS, GROUPS, SECTIONS, keepLook, recallLook, scopeCounts } from '../src/raw-more';
import { BY_ID } from '../src/registry';
import '../src/registry-union';

describe('Develop RAW sheet', () => {
  it('gives every develop command a handler, the one sheet and its own section', () => {
    expect(RAW_IDS.length).toBe(21);
    for (const id of RAW_IDS) {
      expect(BY_ID.get(id)?.status, id).toBe('ready');
      expect(HANDLERS[id], id).toBeTruthy();
      expect(ADJ[id]?.kind, id).toBe('develop');
      expect(ADJ[id]?.sheet, id).toBe(ADJ['raw.white-balance'].sheet);
      expect(SECTIONS, id).toContain(GROUPS[FOCUS[id]]?.section);
    }
    for (const id of ['raw.ai-denoise', 'raw.camera-profile', 'raw.colour-checker', 'raw.community-looks']) {
      expect(BY_ID.get(id)?.status, id).toBe('planned');
      expect(BY_ID.get(id)?.help, id).toMatch(/Not built yet: /);
    }
    expect(ADJ['raw.clipping'].controls.find((c) => c.key === 'clip')?.value).toBe(1);
    expect(ADJ['raw.vignette'].viewOnly).toEqual(['clip']);
  });
  it('names every setting plainly, then by its pro name, with one help line', () => {
    const keys = new Set<string>();
    for (const c of CONTROLS) {
      expect(c.label, c.key).toMatch(/^[^·]{2,} · [^·]{2,}$/);
      expect(c.help.length, c.key).toBeGreaterThan(8);
      expect(c.help.length, c.key).toBeLessThanOrEqual(160);
      expect(keys.has(c.key), c.key).toBe(false);
      keys.add(c.key);
    }
    expect(keys.size).toBe(CONTROLS.length);
  });
  it('keeps a look under its name and brings it back', () => {
    const p: Record<string, number | undefined> = {};
    for (const c of CONTROLS) p[c.key] = c.value;
    p.wbT = 4200; p.vig = -40;
    let list = keepLook([], 'Warm ', p);
    p.wbT = 9000;
    list = keepLook(list, 'Cool', p);
    list = keepLook(list, 'Warm', { ...p, wbT: 3300 });
    expect(list.map((l) => l.name)).toEqual(['Warm', 'Cool']);
    recallLook(list[1], p);
    expect([p.wbT, p.vig]).toEqual([9000, -40]);
    recallLook({ name: 'x', params: { haze: 30 } }, p);
    expect([p.wbT, p.vig, p.haze]).toEqual([6500, 0, 30]);
    for (let i = 0; i < 25; i++) list = keepLook(list, 'L' + i, p);
    expect(list.length).toBe(20);
  });
  it('counts a waveform and a vectorscope', () => {
    // A 4 x 1 picture: black, white, mid grey and pure red.
    const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 255, 0, 0, 255]), W = 8, H = 11;
    const wave = scopeCounts(d, 4, 1, 0, W, H), hit = (c: Uint32Array): number[] => [...c.keys()].filter((i) => c[i]);
    // Column x lands in grid column 2x; brightness 0 at the bottom row (10), 1 at the top (0), 0.502 at row 5, red (0.2126) at row 8.
    expect(hit(wave)).toEqual([0 * W + 2, 5 * W + 4, 8 * W + 6, 10 * W + 0]);
    const vec = scopeCounts(d, 4, 1, 1, 11, 11);
    // Black, white and grey sit in the middle (5, 5); red (Cb -0.115, Cr 0.5) lands at x 5 - 1.0, y 5 - 4.5.
    expect(vec[5 * 11 + 5]).toBe(3);
    expect(vec[Math.round(5 - 0.5 * 9) * 11 + Math.round(5 - 0.1146 * 9)]).toBe(1);
  });
  it('lets the grey picker take a press on the picture only while it is on', () => {
    const set = HANDLES.spot, b = { x: 100, y: 50, w: 200, h: 100 }, p: Record<string, number | undefined> = { wbPick: 0, gx: 50, gy: 50 };
    expect(set?.press?.(150, 75, p, b)).toBe(false);
    p.wbPick = 1;
    expect(set?.press?.(150, 75, p, b)).toBe(true);
    expect([p.gx, p.gy]).toEqual([25, 25]);
    expect(set?.draw(p, b).handles[0]).toMatchObject({ x: 150, y: 75 });
  });
});
