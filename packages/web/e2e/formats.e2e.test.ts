// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The format add-ons through the real editor in headless Chrome: the Export sheet's new types, TIFF pages as layers,
 * animations from layers (GIF, moving PNG, moving WebP), AVIF and JPEG XL through WebAssembly, the PDF page picker,
 * the camera RAW develop step, OpenRaster and PSB with their layers, and the credit in every saved file with room for it.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts formats
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePsd } from 'ag-psd';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDIT, addLayer, createDocument, createLayer, webpInfo, type Bitmap } from '@free-photoeditor/core';
import { writePsdDocument } from '@free-photoeditor/core/psd';
import { decodeGif, encodeGif, isAnimatedWebp, isApng } from '@free-photoeditor/formats/anim';
import { decodeOra, encodeOra } from '@free-photoeditor/formats/ora';
import { encodePdf } from '@free-photoeditor/formats/pdf';
import { decodePng, pngText } from '@free-photoeditor/formats/png';
import { tgaSoftware } from '@free-photoeditor/formats/tga';
import { decodeTiff, encodeTiffPages, readTiff, writeTiff, type TiffEntry } from '@free-photoeditor/formats/tiff';

interface Info { width: number; height: number; layers: { name: string; visible: boolean }[]; }
interface Fpe { getInfo(): Info | null; state(): Record<string, unknown>; sample(x: number, y: number): number[] | null; }
type Win = { fpe: Fpe };
const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const NAME = 'Free Photo Editor by Bhawesh Tibrewal';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
};
function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = normalize(join(DIST, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    readFile(file).then((body) => res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body), () => res.writeHead(404).end('Not found'));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const a = server.address();
    resolve({ server, url: `http://127.0.0.1:${a && typeof a === 'object' ? a.port : 0}/` });
  }));
}
// ---------- fixtures, made here ----------
function bmpOf(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Bitmap {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data: d };
}
const solid = (w: number, h: number, c: [number, number, number, number]): Bitmap => bmpOf(w, h, () => c);
function oraFile(): Buffer {
  const doc = createDocument(64, 40, { r: 30, g: 110, b: 190, a: 255 });
  const top = createLayer('Red note', 20, 12, { x: 8, y: 6, fill: { r: 220, g: 40, b: 40, a: 255 } });
  top.opacity = 0.7;
  addLayer(doc, top);
  return Buffer.from(encodeOra(doc));
}
const TIFF3 = Buffer.from(encodeTiffPages([{ bmp: solid(48, 36, [200, 30, 30, 255]), name: 'Sky' }, { bmp: solid(48, 36, [30, 160, 60, 255]), name: 'Sea' }, { bmp: solid(48, 36, [230, 200, 90, 255]), name: 'Sand' }]));
const GIF3 = Buffer.from(encodeGif([0, 1, 2].map((i) => ({ bmp: solid(20, 10, [i * 100, 50, 200 - i * 80, 255]), delay: 150, name: '' }))));
const PDF2 = Buffer.from(encodePdf([solid(40, 30, [220, 30, 30, 255]), solid(50, 20, [30, 60, 220, 255])]));
/** 24 x 16, red left half and blue right half: drawn by us, then encoded with macOS `sips -s format heic` (no outside picture). */
const HEIC = Buffer.from([
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAA',
  'AAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMx',
  'AAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAGAAAABAAAAAJaXJvdAAAAAAQcG',
  'l4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAAD',
  'ALAAAAMAAAMAHqAUIEHAiwziHuRZVNwICBgCogABAAlEAcBhcshAUyQAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQ',
  'ABAAAAAQAAAboAAABUAAAAAW1kYXQAAAAAAAAAZAAAAFAoAa+jcRpiI/6Vf/pfZYd0IX/so5TLZN3DNvxA9fhy7QtQcCk//9CxCxplHyiddN//',
  'CHi/+k+L5sl9soYhoD1jGrTr1CaETf9+4PcFsr1zgA==',
].join(''), 'base64');
function dngFile(w: number, h: number): Buffer {
  const px = new Uint8Array(w * h * 2), dv = new DataView(px.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = (y & 1) * 2 + (x & 1), left = x < w / 2;
    dv.setUint16((y * w + x) * 2, c === 0 ? (left ? 40000 : 8000) : c === 3 ? (left ? 8000 : 40000) : 16000, true);
  }
  const m = [32406, -15372, -4986, -9689, 18758, 415, 557, -2040, 10570].flatMap((v) => [v, 10000]);
  const e: TiffEntry[] = [
    { tag: 254, type: 4, value: [0] }, { tag: 256, type: 4, value: [w] }, { tag: 257, type: 4, value: [h] }, { tag: 258, type: 3, value: [16] },
    { tag: 259, type: 3, value: [1] }, { tag: 262, type: 3, value: [32803] }, { tag: 271, type: 2, value: 'Free Photo Editor' }, { tag: 272, type: 2, value: 'Test pattern' },
    { tag: 274, type: 3, value: [1] }, { tag: 277, type: 3, value: [1] }, { tag: 278, type: 4, value: [h] }, { tag: 284, type: 3, value: [1] },
    { tag: 33421, type: 3, value: [2, 2] }, { tag: 33422, type: 1, value: new Uint8Array([0, 1, 1, 2]) },
    { tag: 50706, type: 1, value: new Uint8Array([1, 4, 0, 0]) }, { tag: 50707, type: 1, value: new Uint8Array([1, 1, 0, 0]) },
    { tag: 50708, type: 2, value: 'Free Photo Editor Test' }, { tag: 50714, type: 4, value: [0] }, { tag: 50717, type: 4, value: [65535] },
    { tag: 50721, type: 10, value: m }, { tag: 50728, type: 5, value: [1, 1, 1, 1, 1, 1] }, { tag: 50778, type: 3, value: [21] },
  ];
  return Buffer.from(writeTiff([{ entries: e, strips: [px] }]));
}
function psbFile(): Buffer {
  writePsdDocument(createDocument(2, 2));
  const layer = (name: string, c: number) => ({ name, imageData: { width: 30, height: 20, data: new Uint8ClampedArray(30 * 20 * 4).fill(c) } });
  return Buffer.from(writePsd({ width: 30, height: 20, children: [layer('Bottom', 255), layer('Top', 120)] } as never, { psb: true } as never) as unknown as ArrayBuffer);
}
// ---------- page helpers ----------
let browser: Browser | null = null, server: Server | null = null, page: Page;
const info = (p: Page): Promise<Info | null> => p.evaluate(() => (window as unknown as Win).fpe.getInfo());
const tabs = (p: Page): Promise<number> => p.evaluate(() => (window as unknown as Win).fpe.state().tabs as number);
async function waitTabs(p: Page, before: number, timeout = 30_000): Promise<Info> {
  try { await p.waitForFunction((n) => ((window as unknown as Win).fpe.state().tabs as number) > n, before, { timeout }); }
  catch (e) { throw new Error(`No new picture opened; the editor said: "${(await p.textContent('[data-testid="toast"]')) ?? ''}"`, { cause: e }); }
  return (await info(p)) as Info;
}
async function open(p: Page, name: string, mimeType: string, buffer: Buffer): Promise<number> {
  const n = await tabs(p);
  await p.locator('[data-testid="file-input"]').setInputFiles({ name, mimeType, buffer });
  return n;
}
/** Export through the dialog; `multi` ticks "each layer as a frame or page", `delay` sets the time per frame (frames only). */
async function save(p: Page, format: string, multi?: { delay?: number }): Promise<Buffer> {
  await p.click('[data-testid="btn-export"]');
  await p.click(`[data-testid="export-format-${format}"]`);
  if (multi) await p.check('[data-testid="export-multi"]');
  if (multi?.delay) await p.fill('[data-testid="export-delay"]', String(multi.delay));
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }), p.click('[data-testid="export-go"]')]);
  return readFile(await dl.path());
}
const latin = (b: Buffer): string => b.toString('latin1');

describe.skipIf(!CHROME)('file formats in the real editor', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    const s = await serve();
    server = s.server;
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await page.goto(s.url);
    await page.waitForFunction(() => !!(window as unknown as Win).fpe, undefined, { timeout: 30_000 });
  });
  afterAll(async () => { await browser?.close(); server?.close(); });

  it('offers every save type in Export, with the loss warning in plain words', async () => {
    await waitTabs(page, await open(page, 'two-layers.ora', 'image/openraster', oraFile()));
    await page.click('[data-testid="btn-export"]');
    for (const f of ['png', 'jpeg', 'webp', 'psd', 'tiff', 'gif', 'avif', 'jxl', 'tga', 'bmp', 'ico', 'pdf', 'svg', 'ora']) expect(await page.locator(`[data-testid="export-format-${f}"]`).count(), f).toBe(1);
    await page.click('[data-testid="export-format-gif"]');
    expect(await page.textContent('[data-testid="loss-warning"]')).toContain('256 colours');
    await page.check('[data-testid="export-multi"]');
    expect(await page.textContent('[data-testid="loss-warning"]')).toContain('becomes one frame');
    await page.screenshot({ path: join(OUT, 'formats-export-dialog.png') });
    await page.uncheck('[data-testid="export-multi"]');
    await page.click('[data-testid="close-export"]');
  });
  it('opens a TIFF with its pages as layers, and saves TIFF with the credit', async () => {
    const i = await waitTabs(page, await open(page, 'pages.tif', 'image/tiff', TIFF3));
    expect(i.layers.map((l) => [l.name, l.visible])).toEqual([['Sky', true], ['Sea', false], ['Sand', false]]);
    await page.screenshot({ path: join(OUT, 'formats-tiff-pages.png') });
    const t = readTiff(new Uint8Array(await save(page, 'tiff')));
    expect(t.ifds[0].text.get(305)).toBe(CREDIT);
    expect(t.ifds).toHaveLength(1);
  });
  it('saves animations from layers: GIF, moving PNG and moving WebP, with the frame time', async () => {
    const gif = decodeGif(new Uint8Array(await save(page, 'gif', { delay: 250 })));
    expect(gif.frames.map((f) => f.delay)).toEqual([250, 250, 250]);
    expect(isApng(new Uint8Array(await save(page, 'png', { delay: 250 })))).toBe(true);
    const webp = new Uint8Array(await save(page, 'webp', { delay: 250 }));
    expect(isAnimatedWebp(webp)).toBe(true);
    expect(webpInfo(webp).xmp).toContain(CREDIT);
    const t = decodeTiff(new Uint8Array(await save(page, 'tiff', {})));
    expect(t.doc.layers).toHaveLength(3);
  });
  it('opens every frame of a moving GIF as a layer', async () => {
    const i = await waitTabs(page, await open(page, 'moving.gif', 'image/gif', GIF3));
    expect([i.width, i.height, i.layers.length, i.layers.map((l) => l.visible)]).toEqual([20, 10, 3, [true, false, false]]);
  });
  it('saves AVIF and JPEG XL through WebAssembly, and opens the JPEG XL again', async () => {
    const avif = await save(page, 'avif');
    expect(latin(avif.subarray(4, 12))).toBe('ftypavif');
    expect(latin(avif)).toContain(CREDIT);
    const back = await waitTabs(page, await open(page, 'back.avif', 'image/avif', avif));
    expect([back.width, back.height]).toEqual([20, 10]);
    const jxl = await save(page, 'jxl');
    expect(latin(jxl)).toContain(CREDIT);
    const i = await waitTabs(page, await open(page, 'back.jxl', 'image/jxl', jxl), 60_000);
    expect([i.width, i.height]).toEqual([20, 10]);
  });
  it('opens HEIC (iPhone photos) through WebAssembly, since the browser has no HEIC decoder of its own', async () => {
    const i = await waitTabs(page, await open(page, 'tiny.heic', 'image/heic', HEIC), 60_000);
    expect([i.width, i.height, i.layers.length]).toEqual([24, 16, 1]);
  });
  it('opens a PDF page through the page picker, and saves PDF with the credit', async () => {
    const before = await open(page, 'two-pages.pdf', 'application/pdf', PDF2);
    await page.waitForSelector('[data-testid="pdf-picker"]', { state: 'visible', timeout: 60_000 });
    await page.fill('[data-testid="pdf-page"]', '2');
    await page.selectOption('[data-testid="pdf-dpi"]', '72');
    await page.waitForFunction(() => (document.querySelector('[data-testid="pdf-size"]')?.textContent ?? '').includes('50 × 20'));
    await page.screenshot({ path: join(OUT, 'formats-pdf-picker.png') });
    await page.click('[data-testid="options-ok"]');
    const i = await waitTabs(page, before);
    expect([i.width, i.height]).toEqual([50, 20]);
    const px = await page.evaluate(() => (window as unknown as Win).fpe.sample(25, 10));
    expect(px && Math.abs(px[2] - 220) < 12 && Math.abs(px[0] - 30) < 12).toBe(true);
    const pdf = latin(await save(page, 'pdf'));
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain(`/Producer (${CREDIT})`);
  });
  it('develops a camera RAW (DNG) file in plain steps before opening it', async () => {
    const before = await open(page, 'camera.dng', 'image/x-adobe-dng', dngFile(64, 48));
    await page.waitForSelector('[data-testid="raw-develop"]', { state: 'visible', timeout: 90_000 });
    await page.locator('[data-testid="raw-exposure"]').evaluate((el) => { (el as HTMLInputElement).value = '0.7'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'formats-raw-develop.png') });
    await page.click('[data-testid="options-ok"]');
    const i = await waitTabs(page, before);
    expect(i.width).toBeGreaterThan(40);
  });
  it('saves SVG, TGA, BMP, ICO and OpenRaster, with the credit where the format has room', async () => {
    await waitTabs(page, await open(page, 'again.ora', 'image/openraster', oraFile()));
    const svg = (await save(page, 'svg')).toString('utf8');
    expect(svg).toContain(`xmp:CreatorTool="${CREDIT}"`);
    expect(svg).toContain('<image');
    expect(tgaSoftware(new Uint8Array(await save(page, 'tga')))).toBe(NAME);
    expect(latin((await save(page, 'bmp')).subarray(0, 2))).toBe('BM');
    const ico = new Uint8Array(await save(page, 'ico')), dv = new DataView(ico.buffer, ico.byteOffset);
    const png = ico.subarray(dv.getUint32(18, true), dv.getUint32(18, true) + dv.getUint32(14, true));
    expect([decodePng(png).width, pngText(png, 'Software')]).toEqual([16, CREDIT]);
    expect(decodeOra(new Uint8Array(await save(page, 'ora'))).doc.layers.map((l) => l.name)).toEqual(['Background', 'Red note']);
  });
  it('opens PSB (large PSD) files with their layers', async () => {
    const i = await waitTabs(page, await open(page, 'big.psb', 'image/vnd.adobe.photoshop', psbFile()));
    expect(i.layers.map((l) => l.name)).toEqual(['Bottom', 'Top']);
  });
});
