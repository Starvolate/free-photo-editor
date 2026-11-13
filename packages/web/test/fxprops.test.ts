// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Batch effects 3, the Properties side: the raised edge's own settings, the ordered brightness ranges, and Saved looks. */
import { createLayer, hasLayerFx, type Doc, type LayerEffects } from '@free-photoeditor/core';
import { addLayerFx, newBevel, PATTERNS } from '@free-photoeditor/core/layerfx';
import { describe, expect, it } from 'vitest';
import { applyLook, BEVEL, lookToKeep, orderRanges, readLooks, starterLooks } from '../src/fxprops';

describe('fxprops (batch effects 3)', () => {
  it('reads and writes the raised edge, whose light and shade are two tones', () => {
    const e = newBevel(), p = BEVEL.read(e);
    expect(p).toEqual({ style: 0, method: 0, up: 0, depth: 100, size: 5, soften: 0, angle: 120, altitude: 30, lightOp: 75, darkOp: 75 });
    const n = BEVEL.write(e, { ...p, style: 3, method: 1, up: 1, size: 12, lightOp: 40 });
    expect([n.style, n.method, n.up, n.size, n.light.opacity, n.dark.opacity]).toEqual(['pillow', 'chisel', false, 12, 0.4, 0.75]);
    expect(n.light.color).toEqual(e.light.color);
    expect(e.size).toBe(5); // a value object: the old entry is untouched
    expect(BEVEL.read(n).up).toBe(1);
  });
  it('keeps the four points of each brightness range in order while one moves', () => {
    const prev = { s0: 0, s1: 0, s2: 128, s3: 255, u0: 0, u1: 0, u2: 255, u3: 255 };
    const a = { ...prev, s1: 200 };
    orderRanges(a, prev);
    expect([a.s0, a.s1, a.s2, a.s3]).toEqual([0, 200, 200, 255]);
    const b = { ...prev, s3: 50 };
    orderRanges(b, prev);
    expect([b.s0, b.s1, b.s2, b.s3]).toEqual([0, 0, 50, 50]);
    const c = { ...prev, u0: 90 };
    orderRanges(c, prev);
    expect([c.u0, c.u1, c.u2, c.u3, c.s2]).toEqual([90, 90, 255, 255, 128]);
  });
  it('puts a saved look on a layer as one undo step, as a copy, and undo brings the old effects back', () => {
    const l = createLayer('Shape', 4, 4), doc = { layers: [l] } as unknown as Doc;
    const own = addLayerFx(undefined, 'drop-shadow');
    l.fx = own;
    const look = starterLooks()[0];
    expect(look.name).toBe('Raised and shiny');
    const cmd = applyLook(l, look.fx);
    expect(l.fx?.bevel?.on && l.fx.satin?.on).toBe(true);
    expect(l.fx?.dropShadow).toEqual([]);
    expect(l.fx).not.toBe(look.fx);
    expect(l.fx?.bevel).not.toBe(look.fx.bevel);
    cmd.undo(doc);
    expect(l.fx).toBe(own);
    cmd.redo(doc);
    expect(l.fx?.bevel?.size).toBe(5);
    const bare = createLayer('Bare', 2, 2), d2 = { layers: [bare] } as unknown as Doc, c2 = applyLook(bare, starterLooks()[1].fx);
    expect(bare.fx?.dropShadow[0].distance).toBe(6);
    c2.undo(d2);
    expect('fx' in bare).toBe(false);
  });
  it('starts with five ready-made looks, each with effects switched on', () => {
    const looks = starterLooks();
    expect(looks.map((x) => x.name)).toEqual(['Raised and shiny', 'Soft shadow', 'Sticker', 'Soft glow', 'Carved in']);
    for (const x of looks) expect(hasLayerFx({ fx: x.fx }), x.name).toBe(true);
    expect(looks[2].fx.stroke[0]).toMatchObject({ size: 6, color: { r: 255, g: 255, b: 255, a: 255 } });
    expect(looks[4].fx.bevel?.up).toBe(false);
  });
  it('keeps a look in the browser without file-only details or a picture of its own, and reads back only sound looks', () => {
    const fx: LayerEffects = { ...addLayerFx(undefined, 'pattern-overlay'), psd: 1 } as unknown as LayerEffects;
    fx.patternOverlay = { ...fx.patternOverlay!, pattern: 'own', image: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4]) }, psd: { x: 1 } };
    const k = lookToKeep(fx);
    expect(k.lostPicture).toBe(true);
    expect(k.fx.patternOverlay).toEqual({ on: true, blend: 'normal', opacity: 1, pattern: PATTERNS[0].id, scale: 1 });
    expect('psd' in k.fx).toBe(false);
    const store = { getItem: () => JSON.stringify([{ name: 'Mine', fx: k.fx }, { name: 'Broken', fx: { on: true } }, 7]) };
    expect(readLooks(store).map((x) => x.name)).toEqual(['Mine']);
    expect(readLooks({ getItem: () => '{not json' })).toEqual([]);
    expect(readLooks(null)).toEqual([]);
    expect(lookToKeep(addLayerFx(undefined, 'stroke')).lostPicture).toBe(false);
  });
});
