// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Same pixels as the web app. Every Ready adjustment and filter, run through the command line (a PNG file in, a PNG file
 * out, read back with a different PNG library), must give exactly the pixels the web app's dialog gives at the same
 * settings. The web side below repeats the web app's own steps for a whole-layer edit (openAdjust and preview in
 * packages/web/src/app.ts, the dispatch in packages/web/src/worker.ts) on the web app's own control table.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitResult, documentFromBitmap, innerOf, jobPadding, paddedRegion, readRegion, resizeDocument, runJob, turnDocument,
  type Bitmap, type JobParams, type JobSpec } from '@free-photoeditor/core';
import { runEffect } from '@free-photoeditor/core/fx';
import { ADJ } from '../../web/src/commands';
import { BY_ID } from '../../web/src/registry';
import { OPERATIONS, isOperation } from '../src/catalog';
import { run } from '../src/cli';
import { capture, pattern, readPng, tempDir, writePng } from './helpers';

const W = 23, H = 17, MAIN = '#e4572e', SECOND = '#ffffff';
function webApp(src: Bitmap, id: string, preset: JobParams = {}): Uint8ClampedArray {
  const def = ADJ[id], doc = documentFromBitmap({ ...src, data: src.data.slice() }), l = doc.layers[0], reg = { x: 0, y: 0, w: l.width, h: l.height };
  const params: JobParams = {};
  for (const c of def.controls) params[c.key] = preset[c.key] ?? c.value;
  const most: JobParams = {};
  for (const c of def.controls) most[c.key] = !c.type || c.type === 'range' ? c.max ?? c.value : c.value;
  const padded = paddedRegion(l, reg, jobPadding({ op: def.op, kind: def.kind, params: most }));
  if (def.op === 'fx') { params.ix = reg.x - padded.x; params.iy = reg.y - padded.y; params.iw = reg.w; params.ih = reg.h; }
  if (def.colors) { params.fg = parseInt(MAIN.slice(1), 16); params.bg = parseInt(SECOND.slice(1), 16); }
  const spec: JobSpec = { op: def.op, kind: def.kind, params: { ...params } }, work = { width: padded.w, height: padded.h, data: readRegion(l, padded) };
  const res = spec.op !== 'fx' ? runJob(spec, work) : runEffect(spec, work);
  commitResult(doc, l, reg, readRegion(l, reg), innerOf(res, padded, reg), id);
  return l.data;
}
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean => Buffer.from(a).equals(Buffer.from(b));

describe('the command line gives the same pixels as the web app', () => {
  const dir = tempDir(), input = path.join(dir, 'in.png'), src: Bitmap = { width: W, height: H, data: pattern(W, H) };
  writePng(input, src);
  const cli = async (args: string[], out: string): Promise<Bitmap> => {
    const c = capture(dir), code = await run([...args, '-o', out, '--quiet'], c.io);
    expect(c.err).toEqual([]);
    expect(code).toBe(0);
    return readPng(out);
  };
  it('offers every Ready adjustment and filter of the web app, and nothing else', () => {
    const ready = Object.keys(ADJ).filter((id) => isOperation(id, ADJ[id])).sort();
    expect(Object.keys(ADJ).filter((id) => /^(image|filter)\./.test(id) && BY_ID.get(id)?.status === 'ready').sort()).toEqual(ready);
    expect(OPERATIONS.map((o) => o.registryId).sort()).toEqual(ready);
    expect(ready.length).toBeGreaterThan(70);
  });
  it.each(OPERATIONS.map((o) => [o.group, o.id, o.registryId] as const))('%s %s at its default settings', async (group, id, rid) => {
    const got = await cli([group, id, input, '--color', MAIN, '--color2', SECOND], path.join(dir, `${id}.png`));
    expect(same(got.data, webApp(src, rid))).toBe(true);
  });
  it('with settings changed, the same as the dialog with those settings', async () => {
    const got = await cli(['filter', 'blur-gaussian', input, '--set', 'radius=2.5'], path.join(dir, 'blur25.png'));
    expect(same(got.data, webApp(src, 'filter.blur-gaussian', { radius: 2.5 }))).toBe(true);
    const lv = await cli(['adjust', 'levels', input, 'gamma=1.6', 'inW=200'], path.join(dir, 'lv.png'));
    expect(same(lv.data, webApp(src, 'image.adj-levels', { gamma: 1.6, inW: 200 }))).toBe(true);
  });
  it('picture size and turning are the engine\'s own', async () => {
    const d1 = documentFromBitmap({ ...src, data: src.data.slice() });
    resizeDocument(d1, 11, 8, 'smooth');
    expect(same((await cli(['resize', input, '--width', '11'], path.join(dir, 'small.png'))).data, d1.layers[0].data)).toBe(true);
    const d2 = documentFromBitmap({ ...src, data: src.data.slice() });
    turnDocument(d2, 'cw');
    expect(same((await cli(['rotate', input, '--turn', 'right'], path.join(dir, 'turned.png'))).data, d2.layers[0].data)).toBe(true);
  });
});
