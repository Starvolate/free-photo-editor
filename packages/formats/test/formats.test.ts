// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The format add-ons, with fixture files made here: round trips, files made by other tools, the credit inside, sniffing. */
import { writePsd } from 'ag-psd';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { CREDIT, DEFAULT_TEXT_STYLE, addLayer, createDocument, createLayer, docFacts, formatLossReport, listFormats, sniffFormat, webpInfo, type Bitmap, type Doc } from '@free-photoeditor/core';
import { readPsdDocument, writePsdDocument } from '@free-photoeditor/core/psd';
import { FORMATS, PLANNED_OPEN, hasDngTag, registerAllFormats } from '../src/index';
import { decodeAnimatedWebp, decodeApng, decodeGif, encodeAnimatedWebp, encodeApng, encodeGif, isAnimatedWebp, isApng } from '../src/anim';
import { encodeBmp } from '../src/bmp';
import { encodeIco } from '../src/ico';
import { decodeKra, decodeOra, encodeOra } from '../src/ora';
import { encodePdf } from '../src/pdf';
import { decodePng, encodePng, pngText } from '../src/png';
import { develop } from '../src/raw';
import { encodeSvg } from '../src/svg';
import { decodeTga, encodeTga, tgaSoftware } from '../src/tga';
import { decodeTiff, encodeTiffPages, lzwDecode, lzwEncode, readTiff, writeTiff, type TiffEntry } from '../src/tiff';
import { framesOf, riff } from '../src/util';
import { heifItems, isoBoxes, withHeifCredit, withJxlCredit } from '../src/wasm';
import { isoBox } from '../src/util';

registerAllFormats();
const NAME = 'Free Photo Editor by Bhawesh Tibrewal';
type Px = [number, number, number, number];
function bmpOf(w: number, h: number, f: (x: number, y: number) => Px): Bitmap {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data: d };
}
const GRAD = bmpOf(37, 23, (x, y) => [x * 6, y * 11, (x * y) & 255, 255]);
const CLEAR = bmpOf(19, 13, (x, y) => [200, x * 10, y * 15, (x + y) % 3 === 0 ? 0 : x * 12 + 10]);
const same = (a: Bitmap, b: Bitmap): boolean => a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]);
const text = (b: Uint8Array): string => Buffer.from(b).toString('latin1');
const layerBmp = (d: Doc, i: number): Bitmap => ({ width: d.layers[i].width, height: d.layers[i].height, data: d.layers[i].data });
function twoLayers(): Doc {
  const doc = createDocument(30, 20, { r: 10, g: 120, b: 200, a: 255 });
  const top = createLayer('Top & <tag>', 12, 8, { x: 5, y: 4, fill: { r: 230, g: 40, b: 30, a: 255 } });
  top.opacity = 0.5; top.blendMode = 'multiply'; top.visible = false;
  addLayer(doc, top);
  return doc;
}

describe('PNG', () => {
  it('round-trips colour and see-through pictures with the credit', () => {
    for (const b of [GRAD, CLEAR]) { const f = encodePng(b); expect(same(decodePng(f), b)).toBe(true); expect(pngText(f, 'Software')).toBe(CREDIT); }
  });
  it('reads PNGs made by another tool exactly as that tool reads them', () => {
    for (const [colorType, bitDepth] of [[0, 8], [2, 8], [4, 8], [6, 8], [6, 16], [2, 16]] as const) {
      const p = new PNG({ width: GRAD.width, height: GRAD.height });
      p.data.set(CLEAR.width === 0 ? [] : GRAD.data);
      const file = PNG.sync.write(p, { colorType, bitDepth });
      const theirs = PNG.sync.read(file), ours = decodePng(new Uint8Array(file));
      expect(Buffer.from(ours.data).equals(Buffer.from(theirs.data)), `type ${colorType}/${bitDepth}`).toBe(true);
    }
  });
  it('reads interlaced (Adam7) PNGs', async () => {
    const { zlibSync } = await import('fflate');
    const w = 5, h = 5, src = bmpOf(w, h, (x, y) => [x * 40, y * 40, 7, 255]), rows: number[] = [];
    for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
      for (let y = y0; y < h; y += dy) { if (x0 >= w) continue; rows.push(0); for (let x = x0; x < w; x += dx) rows.push(...src.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)); }
    }
    const { makePngChunk } = await import('@free-photoeditor/core');
    const head = new Uint8Array(13); new DataView(head.buffer).setUint32(0, w); new DataView(head.buffer).setUint32(4, h); head[8] = 8; head[9] = 6; head[12] = 1;
    const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), makePngChunk('IHDR', head), makePngChunk('IDAT', zlibSync(new Uint8Array(rows))), makePngChunk('IEND', new Uint8Array(0))]);
    expect(same(decodePng(new Uint8Array(file)), src)).toBe(true);
  });
});

describe('TIFF', () => {
  it('round-trips one page and many pages (layers), LZW and Deflate, with the credit in Software and XMP', () => {
    const one = decodeTiff(encodeTiffPages([{ bmp: GRAD, name: '' }]));
    expect(one.doc.layers.map((l) => l.name)).toEqual(['Background']);
    expect(same(layerBmp(one.doc, 0), GRAD)).toBe(true);
    const file = encodeTiffPages([{ bmp: GRAD, name: 'First' }, { bmp: CLEAR, name: 'Second' }]);
    const many = decodeTiff(file);
    expect(many.doc.layers.map((l) => [l.name, l.visible])).toEqual([['First', true], ['Second', false]]);
    expect([many.doc.width, many.doc.height]).toEqual([37, 23]);
    expect(same(layerBmp(many.doc, 1), CLEAR)).toBe(true);
    expect(same(layerBmp(decodeTiff(encodeTiffPages([{ bmp: CLEAR, name: '' }], CREDIT, 'deflate')).doc, 0), CLEAR)).toBe(true);
    const t = readTiff(file);
    expect(t.ifds[0].text.get(305)).toBe(CREDIT);
    expect(String.fromCharCode(...(t.ifds[0].tags.get(700) ?? []))).toContain(CREDIT);
  });
  it('LZW survives long files that fill and reset the code table', () => {
    const src = new Uint8Array(300_000);
    let seed = 7;
    for (let i = 0; i < src.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; src[i] = i % 5000 < 2500 ? (seed >>> 24) & 255 : (i >> 6) & 3; }
    expect(Buffer.from(lzwDecode(lzwEncode(src), src.length)).equals(Buffer.from(src))).toBe(true);
  });
  it('reads 16-bit grey, 1-bit, 4-bit palette, PackBits, planes and tiles', () => {
    const base = (w: number, h: number, extra: TiffEntry[]): TiffEntry[] => [{ tag: 256, type: 4, value: [w] }, { tag: 257, type: 4, value: [h] }, { tag: 278, type: 4, value: [h] }, ...extra];
    const g16 = new Uint8Array(8); new DataView(g16.buffer).setUint16(0, 0xff00, true); new DataView(g16.buffer).setUint16(6, 0x1234, true);
    let d = decodeTiff(writeTiff([{ entries: base(2, 2, [{ tag: 258, type: 3, value: [16] }, { tag: 262, type: 3, value: [1] }]), strips: [g16] }])).doc;
    expect([...d.layers[0].data.subarray(0, 4), ...d.layers[0].data.subarray(12, 16)]).toEqual([255, 255, 255, 255, 18, 18, 18, 255]);
    d = decodeTiff(writeTiff([{ entries: base(8, 1, [{ tag: 258, type: 3, value: [1] }, { tag: 262, type: 3, value: [0] }]), strips: [new Uint8Array([0b10100000])] }])).doc;
    expect([d.layers[0].data[0], d.layers[0].data[4], d.layers[0].data[8]]).toEqual([0, 255, 0]);
    const map = new Array<number>(48).fill(0); map[1] = 0xff00; map[16 + 2] = 0x8000; map[32 + 3] = 0x4000;
    d = decodeTiff(writeTiff([{ entries: base(2, 1, [{ tag: 258, type: 3, value: [4] }, { tag: 262, type: 3, value: [3] }, { tag: 320, type: 3, value: map }]), strips: [new Uint8Array([0x13])] }])).doc;
    expect([...d.layers[0].data]).toEqual([255, 0, 0, 255, 0, 0, 64, 255]);
    d = decodeTiff(writeTiff([{ entries: base(6, 1, [{ tag: 258, type: 3, value: [8] }, { tag: 259, type: 3, value: [32773] }, { tag: 262, type: 3, value: [1] }]), strips: [new Uint8Array([0xfd, 9, 1, 50, 60])] }])).doc;
    expect([0, 1, 2, 3, 4, 5].map((i) => d.layers[0].data[i * 4])).toEqual([9, 9, 9, 9, 50, 60]);
    d = decodeTiff(writeTiff([{ entries: base(2, 1, [{ tag: 258, type: 3, value: [8, 8, 8] }, { tag: 262, type: 3, value: [2] }, { tag: 277, type: 3, value: [3] }, { tag: 284, type: 3, value: [2] }]),
      strips: [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])] }])).doc;
    expect([...d.layers[0].data]).toEqual([1, 3, 5, 255, 2, 4, 6, 255]);
    const tiles = [0, 1, 2, 3].map((k) => new Uint8Array(16).fill(k * 60));
    const tiled = (extra: TiffEntry[]): Uint8Array => writeTiff([{ entries: base(6, 6, [{ tag: 258, type: 3, value: [8] }, { tag: 262, type: 3, value: [1] }, { tag: 322, type: 3, value: [4] }, { tag: 323, type: 3, value: [4] }, ...extra]), strips: tiles }]);
    const first = readTiff(tiled([]));
    d = decodeTiff(tiled([{ tag: 324, type: 4, value: first.ifds[0].tags.get(273) ?? [] }, { tag: 325, type: 4, value: first.ifds[0].tags.get(279) ?? [] }])).doc;
    expect([[0, 0], [5, 0], [0, 5], [5, 5]].map(([x, y]) => d.layers[0].data[(y * 6 + x) * 4])).toEqual([0, 60, 120, 180]);
  });
});

describe('TGA, BMP and ICO', () => {
  it('TGA round-trips with the credit in the ID and the software field, and reads bottom-up plain files', () => {
    for (const b of [GRAD, CLEAR]) { const f = encodeTga(b); expect(same(decodeTga(f), b)).toBe(true); expect(tgaSoftware(f)).toBe(NAME); expect(text(f)).toContain(CREDIT); }
    const plain = new Uint8Array(18 + 2 * 2 * 3);
    plain[2] = 2; plain[12] = 2; plain[14] = 2; plain[16] = 24;
    plain.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 18);
    expect([...decodeTga(plain).data.subarray(0, 4)]).toEqual([9, 8, 7, 255]);
  });
  it('BMP saves 24 bits for solid pictures and 32 bits with see-through', () => {
    const a = encodeBmp(GRAD), dv = new DataView(a.buffer);
    expect([text(a.subarray(0, 2)), dv.getUint32(2, true), dv.getInt32(18, true), dv.getInt32(22, true), dv.getUint16(28, true)]).toEqual(['BM', a.length, 37, 23, 24]);
    const row = Math.ceil((37 * 3) / 4) * 4, o = 54 + 22 * row;
    expect([a[o + 2], a[o + 1], a[o]]).toEqual([GRAD.data[0], GRAD.data[1], GRAD.data[2]]);
    const b = encodeBmp(CLEAR), bv = new DataView(b.buffer);
    expect([bv.getUint16(28, true), bv.getUint32(30, true), bv.getUint32(66, true)]).toEqual([32, 3, 0xff000000]);
    expect(b[bv.getUint32(10, true) + 12 * 19 * 4 + 3]).toBe(CLEAR.data[3]);
  });
  it('ICO holds square PNG icons up to the picture size, each with the credit', () => {
    const f = encodeIco(GRAD), dv = new DataView(f.buffer), n = dv.getUint16(4, true);
    expect(n).toBe(3);
    const png = f.subarray(dv.getUint32(6 + 12, true), dv.getUint32(6 + 12, true) + dv.getUint32(6 + 8, true));
    expect([decodePng(png).width, decodePng(png).height, pngText(png, 'Software')]).toEqual([16, 16, CREDIT]);
  });
});

describe('animation', () => {
  const red = bmpOf(8, 6, (x) => (x < 2 ? [0, 0, 0, 0] : [220, 20, 20, 255])), blue = bmpOf(8, 6, () => [20, 40, 230, 255]);
  it('GIF saves frames with their times and the credit, and opens every frame as a layer', () => {
    const f = encodeGif([{ bmp: red, delay: 120, name: 'a' }, { bmp: blue, delay: 300, name: 'b' }]);
    expect(text(f)).toContain(CREDIT);
    const m = decodeGif(f);
    expect(m.frames.map((x) => x.delay)).toEqual([120, 300]);
    expect([...m.frames[0].bmp.data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(Math.abs(m.frames[0].bmp.data[12] - 220)).toBeLessThan(20);
    expect(Math.abs(m.frames[1].bmp.data[2] - 230)).toBeLessThan(20);
    const two = Buffer.from(('474946383961 0100 0100 80 00 00 050404 000000 2c 0000 0000 0100 0100 00 02 02 4401 00' +
      ' 2c 0000 0000 0100 0100 80 ff0000 000000 02 02 4401 00 3b').replace(/\s/g, ''), 'hex');
    expect(decodeGif(new Uint8Array(two)).frames.map((x) => [...x.bmp.data])).toEqual([[5, 4, 4, 255], [255, 0, 0, 255]]);
  });
  it('moving PNG round-trips exactly, with the credit', () => {
    const f = encodeApng([{ bmp: red, delay: 80, name: 'a' }, { bmp: blue, delay: 250, name: 'b' }, { bmp: red, delay: 80, name: 'c' }]);
    expect([isApng(f), pngText(f, 'Software')]).toEqual([true, CREDIT]);
    const m = decodeApng(f);
    expect(m.frames.map((x) => x.delay)).toEqual([80, 250, 80]);
    expect(m.frames.every((x, i) => same(x.bmp, i === 1 ? blue : red))).toBe(true);
  });
  it('moving WebP joins the browser-made frames, with the credit in XMP, and opens them again', async () => {
    const still = (shade: number): Uint8Array => { const c = riff('VP8L', new Uint8Array([0x2f, 7, 0, 0, 0, shade])), body = Buffer.concat([Buffer.from('WEBP'), c]); const out = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), body]); out.writeUInt32LE(body.length, 4); return new Uint8Array(out); };
    const host = {
      encodeStill: async (b: Bitmap): Promise<Uint8Array> => still(b.data[2]),
      decodeStill: async (b: Uint8Array): Promise<Bitmap> => bmpOf(8, 6, () => [0, 0, b[b.length - 1], 255]),
    };
    const f = await encodeAnimatedWebp([{ bmp: red, delay: 90, name: 'a' }, { bmp: blue, delay: 400, name: 'b' }], 0.9, host);
    expect(isAnimatedWebp(f)).toBe(true);
    expect(webpInfo(f).xmp).toContain(CREDIT);
    const m = await decodeAnimatedWebp(f, host);
    expect(m.frames.map((x) => [x.delay, x.bmp.data[2]])).toEqual([[90, 0], [400, 230]]);
  });
  it('saves each layer as a frame, bottom first, with times from layer names', () => {
    const doc = twoLayers();
    doc.layers[1].name = 'Frame 2 (250 ms)';
    expect(framesOf(doc, true, 100).map((f) => [f.name, f.delay])).toEqual([['Background', 100], ['Frame 2', 250]]);
    expect(framesOf(doc, false, 100)).toHaveLength(1);
  });
});

describe('layered files', () => {
  it('OpenRaster keeps names, order, place, opacity, visibility and blend mode, with the credit in each picture', () => {
    const doc = twoLayers(), f = encodeOra(doc), back = decodeOra(f).doc;
    expect(text(f.subarray(30, 54))).toBe('mimetypeimage/openraster');
    expect(back.layers.map((l) => [l.name, l.x, l.y, l.opacity, l.visible, l.blendMode])).toEqual(doc.layers.map((l) => [l.name, l.x, l.y, l.opacity, l.visible, l.blendMode]));
    expect(back.layers.every((l, i) => same(layerBmp(back, i), layerBmp(doc, i)))).toBe(true);
    expect(pngText(unzipSync(f)['mergedimage.png'], 'Software')).toBe(CREDIT);
    expect(sniffFormat(f.subarray(0, 4096), 'any-name')?.id).toBe('ora');
  });
  it('Krita files open as their flat picture', () => {
    const kra = zipSync({ mimetype: [strToU8('application/x-krita'), { level: 0 }], 'maindoc.xml': strToU8('<DOC/>'), 'mergedimage.png': encodePng(GRAD) });
    expect(sniffFormat(kra.subarray(0, 4096), 'x')?.id).toBe('kra');
    expect(same(layerBmp(decodeKra(kra).doc, 0), GRAD)).toBe(true);
  });
  it('PSB (large PSD) opens with its layers', () => {
    writePsdDocument(createDocument(2, 2));
    const psb = new Uint8Array(writePsd({ width: 4, height: 3, children: [{ name: 'Only', imageData: { width: 4, height: 3, data: new Uint8ClampedArray(48).fill(200) } }] } as never, { psb: true } as never) as unknown as ArrayBuffer);
    expect([psb[4], psb[5]]).toEqual([0, 2]);
    const r = readPsdDocument(psb);
    expect([r.doc.width, r.doc.height, r.doc.layers.map((l) => l.name)]).toEqual([4, 3, ['Only']]);
  });
  it('SVG keeps each layer, text and shapes as real vectors, and the credit', () => {
    const doc = twoLayers();
    const t = createLayer('Words', 10, 10); t.content = { kind: 'text', text: 'Hi <you>', x: 3, y: 4, style: DEFAULT_TEXT_STYLE };
    const s = createLayer('Box', 10, 10); s.content = { kind: 'shape', shape: 'ellipse', x0: 1, y0: 2, x1: 11, y1: 8, fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 0, sides: 5, star: false, arrow: false };
    addLayer(doc, t); addLayer(doc, s);
    const svg = Buffer.from(encodeSvg(doc)).toString('utf8');
    for (const part of ['<image', 'display="none"', 'mix-blend-mode:multiply', '>Hi &lt;you&gt;</tspan>', '<ellipse cx="6" cy="5" rx="5" ry="3"', `xmp:CreatorTool="${CREDIT}"`]) expect(svg).toContain(part);
  });
});

describe('PDF, JPEG XL and camera RAW', () => {
  it('PDF pages hold the picture, with the credit as Producer, and another reader agrees', async () => {
    const f = encodePdf([GRAD, CLEAR]);
    expect(text(f.subarray(0, 8))).toBe('%PDF-1.7');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: f.slice() }), doc = await task.promise;
    expect(doc.numPages).toBe(2);
    expect(((await doc.getMetadata()).info as { Producer?: string }).Producer).toBe(CREDIT);
    const v = (await doc.getPage(1)).getViewport({ scale: 1 });
    expect([v.width, v.height]).toEqual([37, 23]);
    await task.destroy();
  });
  it('JPEG XL files carry the credit in an XMP box', () => {
    const f = withJxlCredit(new Uint8Array([0xff, 0x0a, 1, 2, 3]));
    expect(isoBoxes(f).map((b) => b.type)).toEqual(['JXL ', 'ftyp', 'xml ', 'jxlc']);
    expect(text(f)).toContain(CREDIT);
    expect(sniffFormat(f, 'x')?.id).toBe('jxl');
  });
  it('AVIF files get the credit as an XMP item, and every picture item still points at its own bytes', () => {
    const B = (t: string, ...p: (number[] | string | Uint8Array)[]): Uint8Array => isoBox(t, new Uint8Array(Buffer.concat(p.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from(x))))));
    const ftyp = B('ftyp', 'avif', [0, 0, 0, 0], 'avifmif1'), payload = [9, 8, 7, 6, 5];
    const meta = (off: number): Uint8Array => B('meta', [0, 0, 0, 0], B('hdlr', [0, 0, 0, 0, 0, 0, 0, 0], 'pict', new Uint8Array(13)), B('pitm', [0, 0, 0, 0, 0, 1]),
      B('iloc', [0, 0, 0, 0, 0x44, 0, 0, 1, 0, 1, 0, 0, 0, 1, off >>> 24, (off >> 16) & 255, (off >> 8) & 255, off & 255, 0, 0, 0, 5]),
      B('iinf', [0, 0, 0, 0, 0, 1], B('infe', [2, 0, 0, 0, 0, 1, 0, 0], 'av01\0')), B('iprp', B('ipco'), B('ipma', [0, 0, 0, 0, 0, 0, 0, 0])));
    const file = new Uint8Array(Buffer.concat([ftyp, meta(ftyp.length + meta(0).length + 8), B('mdat', payload)]));
    expect([...heifItems(file)[0].data]).toEqual(payload);
    const out = withHeifCredit(file), items = heifItems(out);
    expect(items.map((i) => [i.id, i.type])).toEqual([[1, 'av01'], [2, 'mime']]);
    expect([...items[0].data]).toEqual(payload);
    expect(Buffer.from(items[1].data).toString('utf8')).toContain(CREDIT);
    expect(text(out)).toContain('cdsc');
  });
  it('the develop step brightens and warms in plain steps', () => {
    const img = { width: 2, height: 1, rgb: new Uint8Array([128, 128, 128, 90, 90, 90]), bits: 8, colors: 3 };
    expect([...develop(img, { exposure: 0, warmth: 0, tint: 0 }).data.subarray(0, 4)]).toEqual([128, 128, 128, 255]);
    expect(develop(img, { exposure: 1, warmth: 0, tint: 0 }).data[0]).toBeGreaterThan(165);
    const warm = develop(img, { exposure: 0, warmth: 100, tint: 0 }).data;
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });
});

describe('the format list', () => {
  it('knows each format by its first bytes or its name', () => {
    const tif = encodeTiffPages([{ bmp: GRAD, name: '' }]);
    const dng = writeTiff([{ entries: [{ tag: 256, type: 4, value: [1] }, { tag: 257, type: 4, value: [1] }, { tag: 50706, type: 1, value: new Uint8Array([1, 4, 0, 0]) }], strips: [new Uint8Array(2)] }]);
    const ftyp = (brand: string): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp' + brand + '\0\0\0\0mif1' + brand, 'latin1')]));
    expect(hasDngTag(dng)).toBe(true);
    const cases: [Uint8Array, string, string | undefined][] = [
      [tif, 'a.tif', 'tiff'], [dng, 'a.tif', 'raw'], [new Uint8Array(4), 'IMG_1.CR2', 'raw'], [encodeGif([{ bmp: GRAD, delay: 100, name: '' }]), 'x', 'gif'],
      [encodeApng([{ bmp: GRAD, delay: 100, name: '' }, { bmp: GRAD, delay: 100, name: '' }]), 'x.png', 'apng'], [encodePng(GRAD), 'x.png', undefined],
      [ftyp('avif'), 'x', 'avif'], [ftyp('heic'), 'x', 'heic'], [encodePdf([GRAD]), 'x', 'pdf'], [new Uint8Array(20), 'x.tga', 'tga'],
    ];
    for (const [b, n, id] of cases) expect(sniffFormat(b.subarray(0, 65536), n)?.id, n + ' ' + id).toBe(id);
    expect(PLANNED_OPEN.some((p) => p.test(new Uint8Array(Buffer.from('gimp xcf v011')), 'x'))).toBe(true);
    expect(listFormats().filter((f) => f.save).map((f) => f.id)).toEqual(['tiff', 'gif', 'avif', 'jxl', 'tga', 'bmp', 'ico', 'pdf', 'svg', 'ora']);
    expect(FORMATS.every((f) => !f.save || f.keeps.length > 10)).toBe(true);
  });
  it('writes the loss warning from what each format keeps', () => {
    const doc = twoLayers(), f = docFacts(doc), gif = FORMATS.find((x) => x.id === 'gif');
    if (!gif) throw new Error('no gif');
    const flat = formatLossReport(gif, f, 0.9, false);
    expect(flat.losses.map((l) => l.id)).toEqual(['layers', 'hidden', 'quality']);
    const moving = formatLossReport(gif, f, 0.9, true);
    expect(moving.losses.map((l) => l.id)).toEqual(['quality']);
    expect(moving.kept).toContain('becomes one frame');
    const svg = FORMATS.find((x) => x.id === 'svg');
    if (!svg) throw new Error('no svg');
    expect(formatLossReport(svg, f).losses).toEqual([]);
    const ico = FORMATS.find((x) => x.id === 'ico');
    if (!ico) throw new Error('no ico');
    expect(formatLossReport(ico, { layers: 1, hidden: 0, transparent: false }, 1, false, 1024).losses[0].text).toContain('256 pixels');
  });
});
