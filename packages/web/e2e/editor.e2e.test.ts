// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The headless browser test: the built editor (dist/) in a real Chrome, used the way a person uses it.
 * Run: CHROME_PATH=<path to a Chrome or Chromium binary> npm run e2e   (headless only; no window ever opens)
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTHOR_URL, CREDIT, SOURCE_URL, addLayer, createDocument, createLayer, readJpegSoftware, readJpegXmp, readPngText, webpInfo } from '@free-photoeditor/core';
import { readPsdDocument, writePsdDocument } from '@free-photoeditor/core/psd';

interface LayerInfo { name: string; visible: boolean; opacity: number; blendMode: string; x: number; y: number; width: number; height: number; }
interface Info { width: number; height: number; layers: LayerInfo[]; canUndo: boolean; canRedo: boolean; layout: string | null; active: number; zoom: number;
  selection: { x: number; y: number; w: number; h: number } | null; }
interface Fpe {
  getInfo(): Info | null; newDocument(w: number, h: number, bg?: string | null): void;
  sample(x: number, y: number, activeLayerOnly?: boolean): number[] | null; toClient(x: number, y: number): { x: number; y: number } | null;
}
type Win = { fpe: Fpe };
type Px = [number, number, number, number];

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const INPUT = '[data-testid="file-input"]';
const TOAST = '[data-testid="toast"]';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = normalize(join(DIST, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    readFile(file).then((body) => res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end('Not found'));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const a = server.address();
    resolve({ server, url: `http://127.0.0.1:${a && typeof a === 'object' ? a.port : 0}/` });
  }));
}

// ---------- fixtures, made here so the test needs no binary files ----------
function pngBytes(w: number, h: number, f: (x: number, y: number) => Px): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(f(x, y), (y * w + x) * 4);
  return PNG.sync.write(p);
}
function bmpBytes(w: number, h: number, f: (x: number, y: number) => Px): Buffer {
  const row = Math.ceil((w * 3) / 4) * 4, b = Buffer.alloc(54 + row * h);
  b.write('BM', 0, 'latin1'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, bl] = f(x, y), o = 54 + (h - 1 - y) * row + x * 3;
    b[o] = bl; b[o + 1] = g; b[o + 2] = r;
  }
  return b;
}
function icoBytes(png: Buffer, w: number, h: number): Buffer {
  const d = Buffer.alloc(22);
  d.writeUInt16LE(1, 2); d.writeUInt16LE(1, 4); d[6] = w; d[7] = h;
  d.writeUInt16LE(1, 10); d.writeUInt16LE(32, 12); d.writeUInt32LE(png.length, 14); d.writeUInt32LE(22, 18);
  return Buffer.concat([d, png]);
}
/** A 1 × 1 GIF with two frames: dark (5, 4, 4) first, red second. The editor must show the first. */
const GIF_TWO_FRAMES = Buffer.from(('474946383961 0100 0100 80 00 00 050404 000000' +
  ' 2c 0000 0000 0100 0100 00 02 02 4401 00' +
  ' 2c 0000 0000 0100 0100 80 ff0000 000000 02 02 4401 00 3b').replace(/\s/g, ''), 'hex');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30">' +
  '<rect width="40" height="30" fill="#2a9d8f"/><circle cx="20" cy="15" r="9" fill="#f4a261"/></svg>';
function twoLayerPsd(): Buffer {
  const doc = createDocument(90, 60, { r: 40, g: 110, b: 190, a: 255 });
  doc.layers[0].name = 'Background';
  const top = createLayer('Red square', 40, 30, { x: 10, y: 12, fill: { r: 220, g: 40, b: 40, a: 255 } });
  top.opacity = 0.6;
  top.blendMode = 'multiply';
  addLayer(doc, top);
  return Buffer.from(writePsdDocument(doc));
}
const PHOTO = pngBytes(120, 80, (x, y) => [x * 2, y * 3, 128, 255]);

// ---------- page helpers ----------
const info = (p: Page): Promise<Info | null> => p.evaluate(() => (window as unknown as Win).fpe.getInfo());
const sample = (p: Page, x: number, y: number): Promise<number[] | null> =>
  p.evaluate(([a, b]) => (window as unknown as Win).fpe.sample(a, b), [x, y] as [number, number]);
const toClient = async (p: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  (await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as [number, number])) as { x: number; y: number };
const blank = (p: Page): Promise<void> => p.evaluate(() => (window as unknown as Win).fpe.newDocument(11, 13));
const near = (a: number[] | null, b: readonly number[], tol: number): boolean => !!a && b.every((v, i) => Math.abs(a[i] - v) <= tol);
async function waitDoc(p: Page, w: number, h: number): Promise<Info> {
  try {
    await p.waitForFunction(([a, b]) => { const i = (window as unknown as Win).fpe.getInfo(); return !!i && i.width === a && i.height === b; },
      [w, h] as [number, number], { timeout: 15_000 });
  } catch (e) {
    throw new Error(`Expected a ${w} × ${h} picture; the editor said: "${(await p.textContent(TOAST)) ?? ''}"`, { cause: e });
  }
  return (await info(p)) as Info;
}
async function openFile(p: Page, name: string, mimeType: string, buffer: Buffer, w: number, h: number): Promise<Info> {
  await p.locator(INPUT).setInputFiles({ name, mimeType, buffer });
  return waitDoc(p, w, h);
}
async function download(p: Page): Promise<{ bytes: Buffer; name: string }> {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid="export-go"]')]);
  return { bytes: await readFile(await dl.path()), name: dl.suggestedFilename() };
}
async function exportAs(p: Page, format: string): Promise<{ bytes: Buffer; name: string }> {
  await p.click('[data-testid="btn-export"]');
  await p.click(`[data-testid="export-format-${format}"]`);
  return download(p);
}

describe('Free Photo Editor in a real browser (headless Chrome)', () => {
  let browser: Browser | undefined;
  let server: Server | undefined;
  let page: Page;
  const errors: string[] = [];

  beforeAll(async () => {
    if (!CHROME) throw new Error('Set CHROME_PATH to a Chrome or Chromium binary to run the browser test (it runs headless).');
    if (!existsSync(join(DIST, 'index.html'))) throw new Error('Build first: npm run build');
    await mkdir(OUT, { recursive: true });
    const s = await serve();
    server = s.server;
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('page error: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
    await page.goto(s.url);
    await page.locator('[data-testid="empty"]').waitFor({ state: 'visible' });
  });
  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    server?.close();
  });

  it('starts with a plain empty state and opens a PNG from the file picker', async () => {
    expect(await page.textContent('[data-testid="empty"]')).toContain('Your pictures stay on this device');
    await page.screenshot({ path: join(OUT, 'empty-1440.png') });
    const i = await openFile(page, 'photo.png', 'image/png', PHOTO, 120, 80);
    expect(i.layers.length).toBe(1);
    expect(await page.isVisible('[data-testid="empty"]')).toBe(false);
    expect(await sample(page, 10, 10)).toEqual([20, 30, 128, 255]);
  });

  it('paints a brush stroke with the mouse', async () => {
    const before = await sample(page, 60, 40);
    const a = await toClient(page, 20, 40), b = await toClient(page, 100, 40);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.canUndo === true);
    const after = await sample(page, 60, 40);
    expect(after).not.toEqual(before);
    expect(near(after, [228, 87, 46, 255], 8)).toBe(true);
    expect(await sample(page, 60, 5)).toEqual([120, 15, 128, 255]);
  });

  it('applies adjustments (instant invert, live-preview brightness), then undo and redo by button and keyboard', async () => {
    const p0 = (await sample(page, 10, 10)) as number[];
    await page.click('[data-testid="adj-invert"]');
    await expect.poll(() => page.getAttribute('[data-testid="btn-undo"]', 'title')).toContain('Invert');
    const p1 = (await sample(page, 10, 10)) as number[];
    expect(p1).toEqual([...p0.slice(0, 3).map((v) => 255 - v), 255]);
    await page.click('[data-testid="btn-undo"]');
    expect(await sample(page, 10, 10)).toEqual(p0);
    await page.click('[data-testid="btn-redo"]');
    expect(await sample(page, 10, 10)).toEqual(p1);
    await page.keyboard.press('Control+z');
    expect(await sample(page, 10, 10)).toEqual(p0);
    await page.keyboard.press('Control+Shift+z');
    expect(await sample(page, 10, 10)).toEqual(p1);

    await page.click('[data-testid="adj-brightness"]');
    await page.locator('[data-testid="ctl-brightness"]').fill('60');
    await page.waitForFunction((prev) => JSON.stringify((window as unknown as Win).fpe.sample(10, 10)) !== prev, JSON.stringify(p1));
    await page.click('[data-testid="adj-apply"]');
    await expect.poll(() => page.getAttribute('[data-testid="btn-undo"]', 'title')).toContain('Brightness');
    expect(page.workers().length, 'filters and adjustments run in a Web Worker').toBeGreaterThan(0);
    expect(await sample(page, 10, 10)).not.toEqual(p1);
    await page.click('[data-testid="btn-undo"]');
    expect(await sample(page, 10, 10)).toEqual(p1);
  });

  it('exports PNG, JPEG and WebP with his credit inside each file, and re-opens PNG and JPEG', async () => {
    const p1 = (await sample(page, 10, 10)) as number[];
    const png = await exportAs(page, 'png');
    expect(png.name).toBe('photo.png');
    expect(readPngText(new Uint8Array(png.bytes)).Software).toBe(CREDIT);
    await expect.poll(() => page.textContent(TOAST)).toMatch(/Saved photo\.png/);

    await page.click('[data-testid="btn-export"]');
    await page.click('[data-testid="export-format-jpeg"]');
    expect(Number(await page.getAttribute('[data-testid="loss-warning"]', 'data-losses'))).toBeGreaterThanOrEqual(1);
    const jpg = await download(page);
    expect(jpg.name).toBe('photo.jpg');
    expect([jpg.bytes[0], jpg.bytes[1]]).toEqual([0xff, 0xd8]);
    expect(readJpegSoftware(new Uint8Array(jpg.bytes))).toBe(CREDIT);
    expect(readJpegXmp(new Uint8Array(jpg.bytes))).toContain('Bhawesh Tibrewal');

    const webp = await exportAs(page, 'webp');
    const wi = webpInfo(new Uint8Array(webp.bytes));
    expect([wi.width, wi.height]).toEqual([120, 80]);
    expect(wi.xmp).toContain('Bhawesh Tibrewal');

    await blank(page);
    await openFile(page, 'photo.png', 'image/png', png.bytes, 120, 80);
    expect(await sample(page, 10, 10)).toEqual(p1);
    await blank(page);
    await openFile(page, 'photo.jpg', 'image/jpeg', jpg.bytes, 120, 80);
    expect(near(await sample(page, 10, 10), p1, 16)).toBe(true);
  });

  it('opens a 2-layer PSD with names, order, offsets, opacity and blend mode', async () => {
    const i = await openFile(page, 'two-layers.psd', 'image/vnd.adobe.photoshop', twoLayerPsd(), 90, 60);
    expect(i.layers.map((l) => l.name)).toEqual(['Background', 'Red square']);
    const t = i.layers[1];
    expect([t.x, t.y, t.width, t.height]).toEqual([10, 12, 40, 30]);
    expect(t.blendMode).toBe('multiply');
    expect(t.opacity).toBeCloseTo(0.6, 2);
    expect(await page.locator('[data-testid="layer-row"]').count()).toBe(2);
  });

  it('warns that JPEG merges the layers, switches to PSD in one click, and the PSD keeps both layers', async () => {
    await page.click('[data-testid="btn-export"]');
    await page.click('[data-testid="export-format-jpeg"]');
    const box = page.locator('[data-testid="loss-warning"]');
    expect(Number(await box.getAttribute('data-losses'))).toBeGreaterThanOrEqual(1);
    expect(await box.textContent()).toMatch(/layer/i);
    expect(await page.textContent('[data-testid="export-go"]')).toMatch(/anyway/i);
    await page.click('[data-testid="loss-switch"]');
    expect(await page.getAttribute('[data-testid="export-format-psd"]', 'aria-checked')).toBe('true');
    const psd = await download(page);
    expect(psd.name).toBe('two-layers.psd');
    const back = readPsdDocument(new Uint8Array(psd.bytes));
    expect(back.doc.layers.map((l) => l.name)).toEqual(['Background', 'Red square']);
    expect(back.credit).toBe(CREDIT);
    await blank(page);
    const i = await openFile(page, 'two-layers.psd', 'image/vnd.adobe.photoshop', psd.bytes, 90, 60);
    expect(i.layers.length).toBe(2);
    expect(i.layers[1].blendMode).toBe('multiply');
  });

  it('opens BMP, GIF (first frame), ICO, SVG and WebP', async () => {
    const webp = Buffer.from(JSON.parse(await readFile(join(WEB, '../core/test/fixtures/webp-samples.json'), 'utf8')).lossyOpaque, 'base64');
    const wi = webpInfo(new Uint8Array(webp));
    const cases: { name: string; type: string; bytes: Buffer; w: number; h: number; at?: [number, number]; px?: Px; tol?: number }[] = [
      { name: 'tiny.bmp', type: 'image/bmp', bytes: bmpBytes(3, 2, (x, y) => [x * 80, y * 120, 30, 255]), w: 3, h: 2, at: [2, 1], px: [160, 120, 30, 255] },
      { name: 'two-frames.gif', type: 'image/gif', bytes: GIF_TWO_FRAMES, w: 1, h: 1, at: [0, 0], px: [5, 4, 4, 255] },
      { name: 'icon.ico', type: 'image/x-icon', bytes: icoBytes(pngBytes(5, 4, () => [10, 200, 60, 255]), 5, 4), w: 5, h: 4, at: [2, 2], px: [10, 200, 60, 255] },
      { name: 'shape.svg', type: 'image/svg+xml', bytes: Buffer.from(SVG), w: 1024, h: 768, at: [512, 384], px: [244, 162, 97, 255] },
      { name: 'photo.webp', type: 'image/webp', bytes: webp, w: wi.width, h: wi.height },
    ];
    for (const c of cases) {
      await blank(page);
      const i = await openFile(page, c.name, c.type, c.bytes, c.w, c.h);
      expect(i.layers.length, c.name).toBe(1);
      if (c.at && c.px) expect(await sample(page, c.at[0], c.at[1]), c.name).toSatisfy((v: number[] | null) => near(v, c.px as Px, c.tol ?? 2));
    }
  });

  it('shows his name in the header and the About screen, with the licence and the source link', async () => {
    const brand = page.locator('[data-testid="brand"]');
    expect(await brand.textContent()).toContain('by Bhawesh Tibrewal');
    expect(await brand.getAttribute('href')).toBe(AUTHOR_URL);
    await page.click('[data-testid="btn-menu"]');
    await page.click('[data-testid="menu-about"]');
    const about = page.locator('[data-testid="about"]');
    await about.waitFor({ state: 'visible' });
    const text = (await about.textContent()) ?? '';
    expect(text).toContain('Free Photo Editor by Bhawesh Tibrewal');
    expect(text).toContain('GNU Affero General Public License');
    expect(text).toContain('ag-psd');
    expect(await page.getAttribute('[data-testid="about-source"]', 'href')).toBe(SOURCE_URL);
    expect(await page.getAttribute('[data-testid="about-site"]', 'href')).toBe(AUTHOR_URL);
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="sheet-about"]').waitFor({ state: 'hidden' });
  });

  it('fits a 360 px phone and a 1440 px desktop with no sideways scrolling', async () => {
    const check = async (where: string, w: number): Promise<void> => {
      const m = await page.evaluate(() => {
        const t = document.querySelector('.fpe-tools') as HTMLElement;
        return { doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, view: document.documentElement.clientWidth, tools: t.scrollWidth - t.clientWidth };
      });
      expect(m.doc, `${where} at ${w} px`).toBeLessThanOrEqual(m.view);
      expect(m.body, `${where} at ${w} px`).toBeLessThanOrEqual(m.view);
      expect(m.tools, `tool bar at ${w} px`).toBeLessThanOrEqual(0);
    };
    for (const [w, h, layout] of [[360, 740, 'phone'], [1024, 768, 'tablet'], [1440, 900, 'desktop']] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction((l) => (window as unknown as Win).fpe.getInfo()?.layout === l, layout);
      await check('editor', w);
      const bb = await page.locator('[data-testid="brand"]').boundingBox();
      expect(!!bb && bb.x >= 0 && bb.x + bb.width <= w && bb.width > 0).toBe(true);
      await page.screenshot({ path: join(OUT, `editor-${w}.png`) });
      if (layout === 'tablet') {
        await page.click('[data-testid="btn-layers"]');
        await page.locator('[data-testid="sheet-layers"]').waitFor({ state: 'visible' });
        await check('layers panel', w);
        await page.screenshot({ path: join(OUT, `layers-${w}.png`) });
        await page.click('[data-testid="close-layers"]');
      }
      if (layout !== 'phone') continue;
      await page.click('[data-testid="btn-layers"]');
      await page.locator('[data-testid="sheet-layers"]').waitFor({ state: 'visible' });
      await check('layers sheet', w);
      await page.screenshot({ path: join(OUT, `layers-${w}.png`) });
      await page.click('[data-testid="close-layers"]');
      await page.click('[data-testid="btn-export"]');
      await page.locator('[data-testid="sheet-export"]').waitFor({ state: 'visible' });
      await check('export sheet', w);
      expect(await page.evaluate(() => (document.querySelector('.fpe-shell') as HTMLElement).inert), 'the editor behind a dialog is inert').toBe(true);
      await page.screenshot({ path: join(OUT, `export-${w}.png`) });
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => (document.querySelector('.fpe-shell') as HTMLElement).inert)).toBe(false);
    }
  });

  it('makes a new picture from the menu; a selection limits delete and paint; eyedropper, move layer and crop', async () => {
    await page.click('[data-testid="btn-menu"]');
    await page.click('[data-testid="menu-new"]');
    await page.locator('[data-testid="new-width"]').fill('200');
    await page.locator('[data-testid="new-height"]').fill('150');
    await page.click('[data-testid="new-create"]');
    await waitDoc(page, 200, 150);
    expect(await sample(page, 5, 5)).toEqual([255, 255, 255, 255]);
    const drag = async (from: [number, number], to: [number, number]): Promise<void> => {
      const a = await toClient(page, ...from), b = await toClient(page, ...to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      await page.mouse.up();
    };

    await page.click('[data-testid="tool-select"]');
    await drag([20, 20], [80, 60]);
    const sel = (await info(page))?.selection ?? null;
    expect(sel && near([sel.x, sel.y, sel.w, sel.h], [20, 20, 60, 40], 1), JSON.stringify(sel)).toBe(true);
    await page.click('[data-testid="sel-delete"]');
    expect(await sample(page, 50, 40)).toEqual([0, 0, 0, 0]);
    expect(await sample(page, 120, 40)).toEqual([255, 255, 255, 255]);

    await page.click('[data-testid="tool-brush"]');
    await drag([5, 40], [195, 40]);
    expect(near(await sample(page, 50, 40), [228, 87, 46, 255], 8), 'painted inside the selection').toBe(true);
    expect(await sample(page, 120, 40), 'untouched outside the selection').toEqual([255, 255, 255, 255]);

    await page.click('[data-testid="tool-eyedropper"]');
    const white = await toClient(page, 120, 40);
    await page.mouse.click(white.x, white.y);
    await page.click('[data-testid="tool-brush"]');
    expect(await page.inputValue('[data-testid="brush-color"]')).toBe('#ffffff');

    await page.keyboard.press('Control+d');
    expect((await info(page))?.selection).toBeNull();
    await page.click('[data-testid="tool-move"]');
    await drag([100, 100], [120, 110]);
    const moved = (await info(page))?.layers[0];
    expect(!!moved && near([moved.x, moved.y], [20, 10], 1), JSON.stringify(moved)).toBe(true);
    await page.click('[data-testid="btn-undo"]');
    expect((await info(page))?.layers[0].x).toBe(0);

    await page.click('[data-testid="tool-crop"]');
    await drag([0, 0], [100, 75]);
    await page.click('[data-testid="crop-apply"]');
    const c = await info(page);
    expect(!!c && near([c.width, c.height], [100, 75], 1), JSON.stringify(c && [c.width, c.height])).toBe(true);
    await page.click('[data-testid="btn-undo"]');
    await waitDoc(page, 200, 150);
  });

  it('layers panel: add, rename, duplicate, reorder, hide, opacity, blend mode, delete; then the eraser and the zoom buttons', async () => {
    const now = async (): Promise<Info> => (await info(page)) as Info;
    await page.click('[data-testid="layer-add"]');
    expect((await now()).layers.length).toBe(2);
    const name = page.locator('[data-testid="layer-name"]');
    await name.fill('Sky');
    await name.press('Enter');
    let i = await now();
    expect(i.layers[i.active].name).toBe('Sky');
    await page.click('[data-testid="layer-duplicate"]');
    i = await now();
    expect(i.layers.length).toBe(3);
    const a0 = i.active;
    expect(a0).toBeGreaterThan(0);
    await page.click('[data-testid="layer-down"]');
    expect((await now()).active).toBe(a0 - 1);
    await page.locator('[data-testid="layer-eye"]').first().click();
    i = await now();
    expect(i.layers[i.layers.length - 1].visible).toBe(false);
    await page.locator('[data-testid="layer-opacity"]').fill('40');
    i = await now();
    expect(i.layers[i.active].opacity).toBeCloseTo(0.4, 2);
    await page.selectOption('[data-testid="layer-blend"]', 'screen');
    i = await now();
    expect(i.layers[i.active].blendMode).toBe('screen');
    await page.click('[data-testid="layer-delete"]');
    expect((await now()).layers.length).toBe(2);

    await page.locator('[data-testid="layer-select"]').last().click();
    expect((await now()).active).toBe(0);
    await page.click('[data-testid="tool-eraser"]');
    const a = await toClient(page, 5, 120), b = await toClient(page, 195, 120);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    expect(((await sample(page, 100, 120)) as number[])[3], 'erased to transparent').toBeLessThan(10);
    expect(await sample(page, 100, 20)).toEqual([255, 255, 255, 255]);

    const z0 = (await now()).zoom;
    await page.click('.fpe-zoom button:last-child');
    expect((await now()).zoom).toBeCloseTo(z0 * 1.25, 3);
    await page.click('.fpe-zoom-label');
    expect((await now()).zoom).toBeCloseTo(z0, 3);
  });

  it('adds a dropped image and a pasted image as new layers', async () => {
    const data = PHOTO.toString('base64');
    const before = ((await info(page)) as Info).layers.length;
    await page.evaluate((b64) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as BlobPart], 'dropped.png', { type: 'image/png' }));
      document.querySelector('.fpe')?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, data);
    await page.waitForFunction((n) => (window as unknown as Win).fpe.getInfo()?.layers.length === n, before + 1);
    await page.evaluate((b64) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as BlobPart], 'pasted.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, data);
    await page.waitForFunction((n) => (window as unknown as Win).fpe.getInfo()?.layers.length === n, before + 2);
    expect(((await info(page)) as Info).layers.map((l) => l.name)).toEqual(expect.arrayContaining(['dropped', 'pasted']));
  });

  it('keeps the primary button readable (WCAG AA) in the dark and the light look', async () => {
    const ratio = (): Promise<number> => page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-testid="btn-export"]') as HTMLElement);
      const lum = (c: string): number => {
        const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => { const s = Number(v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const a = lum(cs.color), b = lum(cs.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(await ratio(), 'dark look').toBeGreaterThanOrEqual(4.5);
    await page.click('[data-testid="btn-menu"]');
    await page.click('[data-testid="menu-theme"]');
    expect(await page.getAttribute('.fpe', 'data-theme')).toBe('light');
    expect(await ratio(), 'light look').toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: join(OUT, 'light-1440.png') });
    await page.click('[data-testid="btn-menu"]');
    await page.click('[data-testid="menu-theme"]');
    expect(await page.getAttribute('.fpe', 'data-theme')).toBe('dark');
    await page.waitForFunction(() => !document.querySelector('[data-testid="toast"]')?.hasAttribute('data-on'), undefined, { timeout: 8000 });
  });

  it('had zero page errors', () => {
    expect(errors).toEqual([]);
  });
});
