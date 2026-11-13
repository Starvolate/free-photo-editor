// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CREDIT, WHITE, addLayer, createDocument, createLayer, readJpegSoftware, readPngText, webpInfo } from '@free-photoeditor/core';
import { readPsdDocument, writePsdDocument } from '@free-photoeditor/core/psd';
import { findOperation, resolveParams } from '../src/catalog';
import { collectSettings, expandFiles, run } from '../src/cli';
import { bmp24, capture, ico32, icoPng, pattern, px, readPng, tempDir, writePng } from './helpers';

const W = 40, H = 30;
function setup(): { dir: string; src: { width: number; height: number; data: Uint8ClampedArray }; input: string } {
  const dir = tempDir(), src = { width: W, height: H, data: pattern(W, H) }, input = path.join(dir, 'photo.png');
  writePng(input, src);
  return { dir, src, input };
}
async function cli(dir: string, ...args: string[]): Promise<{ code: number; out: string; json: () => any }> {
  const c = capture(dir), code = await run(args, c.io);
  return { code, out: c.text(), json: () => JSON.parse(c.out.join('\n')) };
}
function psdFixture(file: string): void {
  const doc = createDocument(W, H, WHITE);
  addLayer(doc, createLayer('Logo', 10, 8, { x: 2, y: 3, fill: { r: 255, g: 0, b: 0, a: 255 } }));
  writeFileSync(file, writePsdDocument(doc));
}

describe('argument parsing', () => {
  it('collects settings from --settings, --set and name=value words', () => {
    expect(collectSettings({ settings: '{"c": true, "n": 2}', set: ['radius=8', 'a=1,b=two words'] }, ['d=4']))
      .toEqual({ c: true, n: 2, radius: '8', a: '1', b: 'two words', d: '4' });
    expect(() => collectSettings({ set: ['radius'] })).toThrow(/name=value/);
    expect(() => collectSettings({ settings: '[1]' })).toThrow(/JSON object/);
  });
  it('finds an operation by short id, pro name, plain name or the web app id', () => {
    expect(findOperation('Levels')?.id).toBe('levels');
    expect(findOperation('light and dark balance')?.id).toBe('levels');
    expect(findOperation('image.adj-levels')?.id).toBe('levels');
    expect(findOperation('Gaussian blur', 'filter')?.id).toBe('blur-gaussian');
    expect(findOperation('levels', 'filter')).toBeUndefined();
  });
  it('checks settings against the web app\'s controls', () => {
    const blur = findOperation('blur-gaussian')!;
    expect(resolveParams(blur).radius).toBe(4);
    expect(resolveParams(blur, { radius: '8px' }).radius).toBe(8);
    expect(resolveParams(blur, { 'blur amount': 6 }).radius).toBe(6);
    expect(() => resolveParams(blur, { radius: 500 })).toThrow(/from 0.5 to 100/);
    expect(() => resolveParams(blur, { nope: 1 })).toThrow(/no setting called "nope"/);
    const radial = findOperation('blur-radial')!;
    expect(resolveParams(radial, { mode: 'zoom' }).mode).toBe(1);
    expect(() => resolveParams(radial, { mode: 'twist' })).toThrow(/one of/);
    expect(resolveParams(findOperation('add-noise')!, { mono: 'yes' }).mono).toBe(1);
    const custom = findOperation('custom')!;
    expect(resolveParams(custom, { preset: 'blur' })).toMatchObject({ scale: 9, k12: 1, k0: 0 });
    expect(resolveParams(custom, { preset: 'blur', k12: 5 }).k12).toBe(5);
  });
  it('expands file patterns itself, so they work in every shell', () => {
    const { dir } = setup();
    mkdirSync(path.join(dir, 'sub'));
    for (const n of ['a.png', 'b.png', 'c.jpg']) writeFileSync(path.join(dir, 'sub', n), '');
    expect(expandFiles(['sub/*.png'], dir).map((f) => path.basename(f))).toEqual(['a.png', 'b.png']);
    expect(expandFiles(['**/*.{png,jpg}'], dir)).toHaveLength(4);
    expect(() => expandFiles(['sub/*.gif'], dir)).toThrow(/No files match/);
  });
  it('answers mistakes with exit code 2 and plain words', async () => {
    const { dir } = setup();
    expect((await cli(dir, '--nope')).code).toBe(2);
    expect((await cli(dir, 'dance')).out).toMatch(/no command called "dance"/);
    const typo = await cli(dir, 'filter', 'blurr', 'photo.png');
    expect(typo.code).toBe(2);
    expect(typo.out).toMatch(/Did you mean: blur-gaussian/);
    expect((await cli(dir, 'filter', 'levels', 'photo.png')).out).toMatch(/is an adjustment: run free-photo-editor adjust levels/);
    expect((await cli(dir, 'rotate', 'photo.png')).out).toMatch(/Say which way/);
    expect((await cli(dir, 'filter', 'blur-gaussian', 'photo.png', '--set', 'radius=0')).out).toMatch(/from 0.5 to 100/);
    const j = await cli(dir, 'crop', 'photo.png', '--json');
    expect(j.code).toBe(2);
    expect(j.json()).toMatchObject({ ok: false, command: 'crop' });
  });
});

describe('help', () => {
  it('names every command and operation plainly, with the pro name, and carries the credit and licence', async () => {
    const { dir } = setup();
    const main = (await cli(dir, '--help')).out;
    expect(main).toMatch(/Free Photo Editor by Bhawesh Tibrewal/);
    expect(main).toMatch(/Picture size · Image size/);
    expect(main).toMatch(/Light and colour · Adjustments/);
    expect(main).toMatch(/AGPL-3.0/);
    expect(main).toMatch(/no warranty/);
    expect((await cli(dir, 'filter', '--help')).out).toMatch(/Smooth blur · Gaussian blur/);
    const one = (await cli(dir, 'adjust', 'levels', '--help')).out;
    expect(one).toMatch(/Light and dark balance · Levels/);
    expect(one).toMatch(/gamma +Middle tones/);
    expect((await cli(dir, '--version')).out).toMatch(/Bhawesh Tibrewal[\s\S]*no warranty/);
    const list = (await cli(dir, 'list', '--json')).json();
    expect(list.operations.length).toBeGreaterThan(70);
    expect(list.operations.find((o: any) => o.id === 'levels')).toMatchObject({ name: 'Light and dark balance', proName: 'Levels' });
    expect((await cli(dir, 'search', 'blur the background', '--json')).json().results[0]).toMatchObject({ operation: 'blur-iris' });
  });
});

describe('editing', () => {
  it('turns, flips, crops and resizes pixel for pixel', async () => {
    const { dir, src } = setup();
    expect((await cli(dir, 'rotate', 'photo.png', '--turn', 'right')).code).toBe(0);
    const r = readPng(path.join(dir, 'photo-rotated.png'));
    expect([r.width, r.height]).toEqual([H, W]);
    expect(px(r, 0, 0)).toEqual(px(src, 0, H - 1));
    expect(px(r, 5, 7)).toEqual(px(src, 7, H - 1 - 5));
    await cli(dir, 'flip', 'photo.png', '--direction', 'horizontal');
    const f = readPng(path.join(dir, 'photo-flipped.png'));
    expect(px(f, 3, 4)).toEqual(px(src, W - 1 - 3, 4));
    await cli(dir, 'crop', 'photo.png', '--area', '5,6,10,8');
    const c = readPng(path.join(dir, 'photo-cropped.png'));
    expect([c.width, c.height, ...px(c, 0, 0)]).toEqual([10, 8, ...px(src, 5, 6)]);
    await cli(dir, 'crop', 'photo.png', '--aspect', '1:1', '-o', 'square.png');
    expect(readPng(path.join(dir, 'square.png')).width).toBe(30);
    await cli(dir, 'resize', 'photo.png', '--width', '20');
    const s = readPng(path.join(dir, 'photo-resized.png'));
    expect([s.width, s.height]).toEqual([20, 15]);
  });
  it('changes only the given area, and keeps the original', async () => {
    const { dir, src, input } = setup();
    const before = readFileSync(input);
    await cli(dir, 'adjust', 'invert', 'photo.png', '--area', '0,0,10,10');
    const o = readPng(path.join(dir, 'photo-invert.png'));
    expect(px(o, 2, 2).slice(0, 3)).toEqual(px(src, 2, 2).slice(0, 3).map((v) => 255 - v));
    expect(px(o, 20, 20)).toEqual(px(src, 20, 20));
    expect(readFileSync(input).equals(before)).toBe(true);
  });
  it('never replaces a file unless asked; names many outputs with {name} or a folder', async () => {
    const { dir } = setup();
    expect((await cli(dir, 'filter', 'mosaic', 'photo.png')).code).toBe(0);
    const again = await cli(dir, 'filter', 'mosaic', 'photo.png');
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/already exists/);
    expect((await cli(dir, 'filter', 'mosaic', 'photo.png', '--overwrite')).code).toBe(0);
    writePng(path.join(dir, 'second.png'), { width: 4, height: 4, data: pattern(4, 4) });
    expect((await cli(dir, 'convert', 'photo.png', 'second.png', '--to', 'webp', '-o', 'one.webp')).out).toMatch(/\{name\}/);
    expect((await cli(dir, 'convert', '*.png', '--to', 'webp', '-o', 'web/{name}.webp')).code).toBe(0);
    expect(existsSync(path.join(dir, 'web', 'second.webp'))).toBe(true);
    const j = (await cli(dir, 'convert', 'photo.png', 'second.png', '--to', 'jpeg', '--out-dir', 'jpg', '--json')).json();
    expect(j.ok).toBe(true);
    expect(j.results.map((r: any) => path.basename(r.output))).toEqual(['photo.jpg', 'second.jpg']);
    expect(j.credit).toBe(CREDIT);
  });
  it('works with the layers of a PSD file', async () => {
    const { dir } = setup();
    psdFixture(path.join(dir, 'design.psd'));
    const list = (await cli(dir, 'layers', 'list', 'design.psd', '--json')).json();
    expect(list.results[0].layers.map((l: any) => l.name)).toEqual(['Logo', 'Background']);
    const blur = await cli(dir, 'filter', 'blur-box', 'design.psd');
    expect(blur.out).toMatch(/Changed the layer "Logo"/);
    expect(readPsdDocument(readFileSync(path.join(dir, 'design-blur-box.psd'))).doc.layers).toHaveLength(2);
    await cli(dir, 'export', 'design.psd', '--layer', 'Logo', '--to', 'png');
    const logo = readPng(path.join(dir, 'design-Logo.png'));
    expect([px(logo, 0, 0)[3], ...px(logo, 3, 4)]).toEqual([0, 255, 0, 0, 255]);
    await cli(dir, 'layers', 'merge', 'design.psd');
    expect(readPsdDocument(readFileSync(path.join(dir, 'design-merged.psd'))).doc.layers).toHaveLength(1);
    await cli(dir, 'layers', 'flatten', 'design.psd', '--to', 'png');
    expect(px(readPng(path.join(dir, 'design-flat.png')), 0, 0)).toEqual([255, 255, 255, 255]);
    const jpg = await cli(dir, 'convert', 'design.psd', '--to', 'jpeg');
    expect(jpg.out).toMatch(/layers are merged into one flat picture/);
  });
  it('keeps to the pixel limit when opening and when resizing', async () => {
    const { dir } = setup();
    expect((await cli(dir, 'info', 'photo.png', '--max-pixels', '100')).out).toMatch(/more than 0 million pixels|million pixels/);
    expect((await cli(dir, 'resize', 'photo.png', '--width', '100000', '--max-pixels', '5000')).out).toMatch(/million pixels/);
  });
});

describe('formats', () => {
  it('opens every format the web app opens, the way a browser shows it', async () => {
    const { dir, src } = setup(), raw = { raw: { width: W, height: H, channels: 4 as const } }, opaque = { width: W, height: H, data: pattern(W, H, false) };
    await sharp(src.data, raw).webp({ lossless: true }).toFile(path.join(dir, 'a.webp'));
    await sharp(src.data, raw).gif().toFile(path.join(dir, 'a.gif'));
    await sharp(src.data, raw).avif().toFile(path.join(dir, 'a.avif'));
    await sharp(opaque.data, raw).jpeg().withMetadata({ orientation: 6 }).toFile(path.join(dir, 'turned.jpg'));
    writeFileSync(path.join(dir, 'a.bmp'), bmp24(opaque));
    writeFileSync(path.join(dir, 'a.ico'), ico32(src));
    writeFileSync(path.join(dir, 'b.ico'), icoPng(readFileSync(path.join(dir, 'photo.png')), W, H));
    writeFileSync(path.join(dir, 'a.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#00aa00"/></svg>`);
    psdFixture(path.join(dir, 'a.psd'));
    const info = (await cli(dir, 'info', 'a.webp', 'a.gif', 'a.avif', 'turned.jpg', 'a.bmp', 'a.ico', 'b.ico', 'a.svg', 'a.psd', '--json')).json();
    expect(info.ok).toBe(true);
    expect(info.results.map((r: any) => [r.format, r.width, r.height])).toEqual([['webp', W, H], ['gif', W, H], ['avif', W, H], ['jpeg', H, W],
      ['bmp', W, H], ['ico', W, H], ['ico', W, H], ['svg', 1024, 768], ['psd', W, H]]);
    for (const [name, want] of [['a.webp', src], ['a.bmp', opaque], ['a.ico', src], ['b.ico', src]] as const) {
      await cli(dir, 'convert', name, '--to', 'png', '-o', name + '.png');
      expect(Buffer.from(readPng(path.join(dir, name + '.png')).data).equals(Buffer.from(want.data))).toBe(true);
    }
    writeFileSync(path.join(dir, 'notes.txt'), 'hello, not a picture'); expect((await cli(dir, 'info', 'notes.txt')).out).toMatch(/not a picture the editor can open/);
  });
  it('writes the credit into every file type it saves', async () => {
    const { dir } = setup();
    for (const t of ['png', 'jpeg', 'webp', 'psd']) expect((await cli(dir, 'convert', 'photo.png', '--to', t, '-o', `out.${t}`)).code).toBe(0);
    expect(readPngText(readFileSync(path.join(dir, 'out.png'))).Software).toBe(CREDIT);
    expect(readJpegSoftware(readFileSync(path.join(dir, 'out.jpeg')))).toBe(CREDIT);
    expect(webpInfo(readFileSync(path.join(dir, 'out.webp'))).xmp).toContain(`CreatorTool="${CREDIT}"`);
    expect(readPsdDocument(readFileSync(path.join(dir, 'out.psd'))).credit).toBe(CREDIT);
    expect((await cli(dir, 'info', 'out.webp', '--json')).json().results[0].madeWith).toBe(CREDIT);
  });
  it('never follows a link planted at the output name', async () => {
    const { dir } = setup(), outside = tempDir(), victim = path.join(outside, 'keep.png');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, path.join(dir, 'photo-invert.png'));
    expect((await cli(dir, 'adjust', 'invert', 'photo.png', '--overwrite')).code).toBe(0);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  });
});
