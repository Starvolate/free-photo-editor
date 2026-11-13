// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Automate and batch in a real headless Chrome, each function reached with real clicks from its ribbon home:
 * Recorded steps (record a flip and a filter by hand, stop, play on the original: the same pixels, as one undo step),
 * Edit many pictures the same way and Resize many pictures (one ZIP, names in the picked order, the right sizes), and
 * the Sheet of small photos (one new picture, a layer per photo), Watermark (this picture and many), Collage and the
 * Passport photo sheet, and Line up layers automatically (a real photo turned 7° and moved goes back onto itself; the
 * practice photo's copy moved 100 px down goes back to the same pixels), Stitch a panorama (two overlapping pieces of the
 * real photo come back as the photo, one undo step) and Blend photos automatically (a seam mask, one undo step).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts automate
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reach } from './ribbon';
import { decodePng, encodePng } from '@free-photoeditor/formats/png';
import { unzipSync } from '@free-photoeditor/formats/zip';
import { addLayer, createLayer, documentFromBitmap, warpBitmap } from '@free-photoeditor/core';
import { writePsdDocument } from '@free-photoeditor/core/psd';

interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; flatHash(): Promise<string>;
  getInfo(): { layers: unknown[]; width: number; height: number } | null;
  select(x: number, y: number, w: number, h: number): void; sample(x: number, y: number, only?: boolean): number[] | null;
}
type Win = Window & { fpe: Fpe; __n: { dl: number }; __blob: Blob | null; __name: string };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

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
/** Downloads are kept in the page instead of happening: the last saved file's bytes and name. */
function stubs(): void {
  const w = window as unknown as Win, click = HTMLElement.prototype.click, make = URL.createObjectURL.bind(URL);
  w.__n = { dl: 0 }; w.__blob = null; w.__name = '';
  URL.createObjectURL = (b: Blob | MediaSource) => { if (b instanceof Blob) w.__blob = b; return make(b); };
  HTMLElement.prototype.click = function (this: HTMLElement): void {
    if (this instanceof HTMLAnchorElement && this.download) { w.__n.dl++; w.__name = this.download; return; }
    click.call(this);
  };
}
/** A solid picture file of this size, written for the file picker. */
async function pic(dir: string, name: string, w: number, hgt: number, rgb: [number, number, number]): Promise<string> {
  const data = new Uint8ClampedArray(w * hgt * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
  const file = join(dir, name);
  await writeFile(file, encodePng({ width: w, height: hgt, data }));
  return file;
}

let browser: Browser;
let server: Server;
let url = '';
let dir = '';
let files: string[] = [];
const contexts: BrowserContext[] = [];
const errors: string[] = [];
async function open(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(stubs);
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.click('[data-testid="start-sample"]');
  await p.waitForFunction(() => !!(window as unknown as Win).fpe.getInfo());
  return p;
}
const hash = (p: Page): Promise<string> => p.evaluate(() => (window as unknown as Win).fpe.flatHash());
const steps = async (p: Page): Promise<number> => Number((await p.evaluate(() => (window as unknown as Win).fpe.state())).step);
async function pickFiles(p: Page, id: string, list: string[]): Promise<void> {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(`[data-testid="${id}-pick"]`)]);
  await fc.setFiles(list);
  await p.waitForFunction((x) => /picked/.test(document.querySelector(`[data-testid="${x}-picked"]`)?.textContent ?? '') &&
    !/No pictures/.test(document.querySelector(`[data-testid="${x}-picked"]`)?.textContent ?? ''), id);
}
/** Wait for the ZIP, then unzip it here. */
async function zipOut(p: Page, before: number): Promise<{ name: string; files: Record<string, Uint8Array> }> {
  await p.waitForFunction((n) => (window as unknown as Win).__n.dl > n, before, { timeout: 30_000 });
  const got = await p.evaluate(async () => {
    const w = window as unknown as Win;
    return { name: w.__name, bytes: Array.from(new Uint8Array(await (w.__blob as Blob).arrayBuffer())) };
  });
  return { name: got.name, files: unzipSync(new Uint8Array(got.bytes)) };
}

const suite = CHROME ? describe : describe.skip;
suite('Automate and batch (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    dir = join(tmpdir(), `fpe-automate-${process.pid}`);
    await mkdir(dir, { recursive: true });
    files = [await pic(dir, 'wide.png', 120, 60, [200, 40, 40]), await pic(dir, 'tall.png', 50, 100, [40, 200, 40]), await pic(dir, 'small.png', 30, 20, [40, 40, 200])];
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
    server?.close();
  });

  it('Recorded steps: record by hand, stop, and play on the original to the same pixels as one undo step', async () => {
    const p = await open();
    const original = await hash(p), n0 = await steps(p);
    await reach(p, 'panel.actions');
    await p.waitForSelector('[data-testid="rec-start"]');
    await p.fill('[data-testid="rec-name"]', 'Flip and sharpen');
    await p.click('[data-testid="rec-start"]');
    await p.waitForSelector('[data-testid="rec-chip"]');
    // By hand, from the ribbon: flip the picture, then Sharpen with its dialog.
    await reach(p, 'image.flip-h');
    await p.waitForFunction((n) => Number((window as unknown as Win).fpe.state().step) > n, n0);
    await reach(p, 'filter.sharpen');
    await p.waitForSelector('[data-testid="adj-apply"]');
    await p.click('[data-testid="adj-apply"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().lastFilter === 'filter.sharpen');
    const byHand = await hash(p);
    expect(byHand).not.toBe(original);
    expect(await p.textContent('[data-testid="rec-chip"]')).toContain('2 steps');
    // Stop from the sheet, as a person would.
    await reach(p, 'panel.actions');
    await p.waitForSelector('[data-testid="rec-steps"] li >> nth=1');
    await p.click('[data-testid="rec-stop"]');
    await p.waitForSelector('[data-testid="set-steps"]');
    expect(await p.$('[data-testid="rec-chip"]')).toBeNull();
    const listed = await p.$$eval('[data-testid="set-steps"] li', (li) => li.map((x) => x.textContent ?? ''));
    expect(listed.length).toBe(2);
    await p.screenshot({ path: join(OUT, 'automate-recorded-steps-1440.png') });
    await p.click('[data-testid="close-panel.actions"]');
    await p.waitForFunction(() => !(window as unknown as Win).fpe.state().modal);
    // Back to the original, then Play: the same pixels, and only one more step in History.
    await p.evaluate(async () => { const f = (window as unknown as Win).fpe; await f.run('edit.undo'); await f.run('edit.undo'); });
    expect(await hash(p)).toBe(original);
    const n1 = await steps(p);
    await reach(p, 'panel.actions');
    await p.click('[data-testid="set-play"]');
    await p.waitForFunction((n) => Number((window as unknown as Win).fpe.state().step) === n + 1, n1, { timeout: 20_000 });
    expect(await hash(p)).toBe(byHand);
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));
    expect(await hash(p)).toBe(original);
    // A step can be deleted from a saved set.
    await reach(p, 'panel.actions');
    await p.click('[data-testid="step-delete-0"]');
    expect((await p.$$('[data-testid="set-steps"] li')).length).toBe(1);
    expect(errors).toEqual([]);
  }, 90_000);

  it('Edit many pictures the same way: one ZIP, names in the picked order, the steps done on each', async () => {
    const p = await open();
    await reach(p, 'file.batch');
    await p.waitForSelector('[data-testid="file.batch-start"]');
    await pickFiles(p, 'file.batch', files);
    await p.selectOption('[data-testid="file.batch-set"]', { label: 'Black and white with grain (2 steps)' });
    await p.selectOption('[data-testid="file.batch-format"]', 'png');
    const before = await p.evaluate(() => (window as unknown as Win).__n.dl);
    await p.click('[data-testid="file.batch-start"]');
    const z = await zipOut(p, before);
    expect(z.name).toBe('Edited pictures.zip');
    expect(Object.keys(z.files)).toEqual(['wide.png', 'tall.png', 'small.png']);
    const wide = decodePng(z.files['wide.png']);
    expect([wide.width, wide.height]).toEqual([120, 60]);
    const px = Array.from(wide.data.subarray(0, 3));
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(await p.textContent('[data-testid="file.batch-status"]')).toContain('Saved 3 pictures');
    expect(errors).toEqual([]);
  }, 60_000);

  it('Resize many pictures: the same longest side for each, small ones left alone', async () => {
    const p = await open();
    await reach(p, 'file.resize-many');
    await pickFiles(p, 'file.resize-many', files);
    await p.fill('[data-testid="file.resize-many-long"]', '40');
    await p.selectOption('[data-testid="file.resize-many-format"]', 'png');
    const before = await p.evaluate(() => (window as unknown as Win).__n.dl);
    await p.click('[data-testid="file.resize-many-start"]');
    const z = await zipOut(p, before);
    const sizes = Object.entries(z.files).map(([n, b]) => { const d = decodePng(b); return [n, d.width, d.height]; });
    expect(sizes).toEqual([['wide.png', 40, 20], ['tall.png', 20, 40], ['small.png', 30, 20]]);
  }, 60_000);

  it('Sheet of small photos: one new picture, each photo on its own layer in its cell', async () => {
    const p = await open();
    await reach(p, 'file.contact-sheet');
    await pickFiles(p, 'file.contact-sheet', files);
    await p.fill('[data-testid="file.contact-sheet-cols"]', '2');
    await p.fill('[data-testid="file.contact-sheet-width"]', '440');
    await p.fill('[data-testid="file.contact-sheet-gap"]', '20');
    await p.click('[data-testid="file.contact-sheet-make"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.layers.length === 4);
    const info = await p.evaluate(() => (window as unknown as Win).fpe.getInfo());
    // Two columns of 190 px cells, 20 px apart: two rows with 28 px caption strips.
    expect([info?.width, info?.height]).toEqual([440, 20 + 2 * (190 + 28 + 20)]);
    expect(await p.evaluate(() => Number((window as unknown as Win).fpe.state().tabs))).toBe(2);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Watermark: text stamped on this picture as its own layer (one undo step), and on many pictures in one ZIP', async () => {
    const p = await open();
    const original = await hash(p), n0 = await steps(p), layers0 = (await p.evaluate(() => (window as unknown as Win).fpe.getInfo()))?.layers.length ?? 0;
    await reach(p, 'auto.watermark');
    await p.waitForSelector('[data-testid="auto.watermark-here"]');
    await p.fill('[data-testid="auto.watermark-text"]', '© Free Photo Editor');
    await p.fill('[data-testid="auto.watermark-size"]', '30');
    await p.fill('[data-testid="auto.watermark-opacity"]', '90');
    await p.screenshot({ path: join(OUT, 'automate-watermark-sheet-1440.png') });
    await p.click('[data-testid="auto.watermark-here"]');
    await p.waitForFunction((n) => Number((window as unknown as Win).fpe.state().step) === n + 1, n0);
    expect((await p.evaluate(() => (window as unknown as Win).fpe.getInfo()))?.layers.length).toBe(layers0 + 1);
    expect(await hash(p)).not.toBe(original);
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));
    expect(await hash(p)).toBe(original);
    await reach(p, 'auto.watermark');
    await pickFiles(p, 'auto.watermark', files);
    await p.selectOption('[data-testid="auto.watermark-format"]', 'png');
    const before = await p.evaluate(() => (window as unknown as Win).__n.dl);
    await p.click('[data-testid="auto.watermark-start"]');
    const z = await zipOut(p, before);
    expect(z.name).toBe('Watermarked pictures.zip');
    expect(Object.keys(z.files)).toEqual(['wide.png', 'tall.png', 'small.png']);
    const wide = decodePng(z.files['wide.png']);
    expect([wide.width, wide.height]).toEqual([120, 60]);
    let marked = 0;
    for (let i = 0; i < wide.data.length; i += 4) if (wide.data[i] !== 200 || wide.data[i + 1] !== 40 || wide.data[i + 2] !== 40) marked++;
    expect(marked).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Collage: one new picture, each photo on its own layer in its place', async () => {
    const p = await open();
    await reach(p, 'auto.collage');
    await pickFiles(p, 'auto.collage', files);
    await p.selectOption('[data-testid="auto.collage-layout"]', 'feature');
    await p.selectOption('[data-testid="auto.collage-page"]', '2400x1600');
    await p.click('[data-testid="auto.collage-make"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.layers.length === 4);
    const info = await p.evaluate(() => (window as unknown as Win).fpe.getInfo());
    expect([info?.width, info?.height]).toEqual([2400, 1600]);
    expect(await p.evaluate(() => Number((window as unknown as Win).fpe.state().tabs))).toBe(2);
    // Every layer row shows its thumbnail (they draw on a short timer), then the view has a moment to finish the big picture.
    await p.waitForFunction(() => { const c = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb]')]; return c.length > 0 && c.every((x) => x.dataset.drawn === '1'); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'automate-collage-1440.png') });
    expect(errors).toEqual([]);
  }, 60_000);

  it('Passport photo sheet: copies at 35 × 45 mm on a 6 × 4 inch page at 300 dpi, with the check-your-rules line', async () => {
    const p = await open();
    await reach(p, 'auto.passport');
    await p.waitForSelector('[data-testid="auto.passport-rule"]');
    expect(await p.textContent('[data-testid="auto.passport-rule"]')).toContain("Check your own country's rules");
    await p.selectOption('[data-testid="auto.passport-size"]', '35x45');
    await p.selectOption('[data-testid="auto.passport-paper"]', '6x4');
    await p.click('[data-testid="auto.passport-make"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.width === 1800);
    const info = await p.evaluate(() => (window as unknown as Win).fpe.getInfo());
    expect([info?.width, info?.height, info?.layers.length]).toEqual([1800, 1200, 2]);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Copy edits: a light-and-colour layer pasted onto another open picture gives the same pixels there, as one undo step', async () => {
    const p = await open();
    const f = (): Promise<void> => p.evaluate(async () => { await (window as unknown as Win).fpe.run('layer.flatten'); });
    await f();
    const original = await hash(p), n0 = await steps(p);
    // A second picture, the same photo, with an Invert light-and-colour layer on top.
    await p.evaluate(() => (window as unknown as Win).fpe.openSample());
    await p.waitForFunction(() => Number((window as unknown as Win).fpe.state().tabs) === 2);
    await f();
    await p.evaluate(async () => { await (window as unknown as Win).fpe.run('layer.adj-invert'); });
    const target = await hash(p);
    expect(target).not.toBe(original);
    await reach(p, 'auto.copy-edits');
    await p.waitForSelector('[data-testid="auto.copy-edits-tab-0"]');
    expect((await p.$$('[data-testid="auto.copy-edits-steps"] li')).length).toBe(1);
    await p.waitForTimeout(3200); // the toasts of the opened photo clear, so the shot shows the whole sheet
    await p.screenshot({ path: join(OUT, 'automate-copy-edits-1440.png') });
    await p.click('[data-testid="auto.copy-edits-paste"]');
    await p.waitForFunction(() => !(window as unknown as Win).fpe.state().modal);
    await p.locator('[data-testid="doc-tab"] .fpe-tab-name').first().click();
    await p.waitForFunction(() => Number((window as unknown as Win).fpe.state().tab) === 0);
    expect(await hash(p)).toBe(target);
    expect(await steps(p)).toBe(n0 + 1);
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));
    expect(await hash(p)).toBe(original);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Recent pictures: an opened file is kept in this browser, opens again with one click, and Clear list empties it', async () => {
    const p = await open();
    await p.setInputFiles('[data-testid="file-input"]', files[0]);
    await p.waitForFunction(() => Number((window as unknown as Win).fpe.state().tabs) === 2);
    // Keeping the file is quiet and after the open, so wait until the browser holds it (never creating the store here).
    await p.waitForFunction(() => new Promise<boolean>((res) => {
      const r = indexedDB.open('free-photo-editor-recent', 1);
      r.onupgradeneeded = () => r.transaction?.abort();
      r.onerror = () => res(false);
      r.onsuccess = () => {
        const q = r.result.transaction('files', 'readonly').objectStore('files').count();
        q.onsuccess = () => { r.result.close(); res(q.result > 0); };
        q.onerror = () => { r.result.close(); res(false); };
      };
    }), undefined, { timeout: 15_000 });
    await reach(p, 'file.recent');
    await p.waitForSelector('[data-testid="recent-item"]');
    expect(await p.textContent('[data-testid="recent-list"]')).toContain('wide.png');
    // The row reads as one line: name, size and date take the room, and Open sits at the right at its own size.
    const row = await p.evaluate(() => {
      const li = document.querySelector('[data-testid="recent-item"]') as HTMLElement, sp = li.querySelector('span') as HTMLElement, b = li.querySelector('button') as HTMLElement;
      return { li: li.getBoundingClientRect().width, span: sp.getBoundingClientRect().width, spanH: sp.getBoundingClientRect().height, btn: b.getBoundingClientRect().width };
    });
    expect(row.btn).toBeLessThan(row.li / 3);
    expect(row.span).toBeGreaterThan(row.li / 2);
    expect(row.spanH).toBeLessThan(48);
    await p.screenshot({ path: join(OUT, 'automate-recent-1440.png') });
    await p.click('[data-testid="recent-open"]');
    await p.waitForFunction(() => Number((window as unknown as Win).fpe.state().tabs) === 3);
    expect((await p.evaluate(() => (window as unknown as Win).fpe.getInfo()))?.width).toBe(120);
    await reach(p, 'file.recent');
    await p.waitForSelector('[data-testid="recent-item"]');
    expect((await p.$$('[data-testid="recent-item"]')).length).toBe(1);
    await p.click('[data-testid="recent-clear"]');
    await p.waitForSelector('[data-testid="recent-empty"]');
    expect(errors).toEqual([]);
  }, 60_000);
  it('Line up layers automatically: a real photo turned 7° and moved goes back onto the photo, as one undo step', async () => {
    const png = decodePng(await readFile(join(WEB, 'e2e', 'fixtures', 'mug.png')));
    const photo = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, W = photo.width, H = photo.height;
    const a = 7 * Math.PI / 180, cx = W / 2, cy = H / 2;
    const T = (x: number, y: number): { x: number; y: number } => ({ x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a) + 12, y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) - 8 });
    const g = warpBitmap(photo, [T(0, 0), T(W, 0), T(W, H), T(0, H)]);
    if (!g) throw new Error('The test shot could not be made');
    const doc = documentFromBitmap(photo);
    addLayer(doc, createLayer('Second shot', g.width, g.height, { data: g.data, x: g.x, y: g.y }), 1);
    const p = await open();
    await p.setInputFiles('[data-testid="file-input"]', { name: 'two-shots.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from(writePsdDocument(doc)) });
    await p.waitForFunction(() => Number((window as unknown as Win).fpe.state().tabs) === 2 && (window as unknown as Win).fpe.getInfo()?.layers.length === 2);
    // The mean red difference from the photo over an inner grid of the picture: large while the shot is turned, small once lined up.
    const pts: [number, number][] = [];
    for (let y = 60; y < H - 60; y += 20) for (let x = 60; x < W - 60; x += 20) pts.push([x, y]);
    const ref = pts.map(([x, y]) => photo.data[(y * W + x) * 4]);
    const off = (): Promise<number> => p.evaluate(([q, r]) => {
      const f = (window as unknown as Win).fpe;
      return q.reduce((s, [x, y], i) => s + Math.abs((f.sample(x, y)?.[0] ?? 0) - r[i]), 0) / q.length;
    }, [pts, ref] as const);
    const before = await off(), h0 = await hash(p), n0 = await steps(p);
    expect(before).toBeGreaterThan(15);
    await reach(p, 'edit.auto-align');
    await p.waitForFunction((n) => Number((window as unknown as Win).fpe.state().step) === n + 1, n0, { timeout: 20_000 });
    expect(await off()).toBeLessThan(6);
    expect(await p.textContent('[data-testid="toast"]')).toContain('Lined up');
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'automate-auto-align-1440.png') });
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));
    expect(await hash(p)).toBe(h0);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Line up layers automatically: the practice photo, its copy moved 100 px down, goes back to the very same pixels', async () => {
    const p = await open();
    type S = { info: { active: number }; layers: { x: number; y: number }[] };
    const act = (): Promise<{ x: number; y: number }> => p.evaluate(() => { const s = (window as unknown as Win).fpe.state() as unknown as S; return s.layers[s.info.active]; });
    await p.evaluate(async () => { const f = (window as unknown as Win).fpe; f.select(850, 100, 100, 100); await f.run('layer.merge-down'); await f.run('layer.duplicate'); });
    const lined = await hash(p);
    await p.evaluate(() => (window as unknown as Win).fpe.run('layer.align-top'));
    expect(await act()).toMatchObject({ x: 0, y: 100 });
    expect(await hash(p)).not.toBe(lined);
    const n0 = await steps(p);
    await reach(p, 'edit.auto-align');
    await p.waitForFunction((n) => Number((window as unknown as Win).fpe.state().step) === n + 1, n0, { timeout: 20_000 });
    expect(await act()).toMatchObject({ x: 0, y: 0 });
    expect(await hash(p)).toBe(lined);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Stitch a panorama: two overlapping pieces of a real photo become the photo again, as one undo step', async () => {
    const png = decodePng(await readFile(join(WEB, 'e2e', 'fixtures', 'mug.png'))), W = png.width, H = png.height;
    const piece = async (name: string, x0: number, w: number): Promise<string> => {
      const data = new Uint8ClampedArray(w * H * 4);
      for (let y = 0; y < H; y++) data.set(png.data.subarray((y * W + x0) * 4, (y * W + x0 + w) * 4), y * w * 4);
      const file = join(dir, name);
      await writeFile(file, encodePng({ width: w, height: H, data }));
      return file;
    };
    const two = [await piece('left.png', 0, 230), await piece('right.png', 130, 230)];
    const p = await open();
    await reach(p, 'auto.panorama');
    await pickFiles(p, 'auto.panorama', two);
    await p.click('[data-testid="auto.panorama-make"]');
    await p.waitForFunction((w) => (window as unknown as Win).fpe.getInfo()?.width === w, W, { timeout: 20_000 });
    const info = await p.evaluate(() => (window as unknown as Win).fpe.getInfo());
    expect([info?.width, info?.height, info?.layers.length]).toEqual([W, H, 2]);
    expect(await p.textContent('[data-testid="toast"]')).toContain('Stitched 2 photos');
    // Across the whole picture, seam included, the pixels are the photo's (mean red difference under 2 on a 20 px grid).
    const pts: [number, number][] = [];
    for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) pts.push([x, y]);
    const ref = pts.map(([x, y]) => png.data[(y * W + x) * 4]);
    const off = await p.evaluate(([q, r]) => {
      const f = (window as unknown as Win).fpe;
      return q.reduce((s, [x, y], i) => s + Math.abs((f.sample(x, y)?.[0] ?? 0) - r[i]), 0) / q.length;
    }, [pts, ref] as const);
    expect(off).toBeLessThan(2);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'automate-panorama-1440.png') });
    const h1 = await hash(p);
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));
    expect((await p.evaluate(() => (window as unknown as Win).fpe.getInfo()))?.width).toBe(230);
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.redo'));
    expect(await hash(p)).toBe(h1);
    expect(errors).toEqual([]);
  }, 60_000);

  it('Blend photos automatically: the practice photo\'s copy 100 px down gets a seam mask, as one undo step', async () => {
    const p = await open();
    await p.evaluate(async () => { const f = (window as unknown as Win).fpe; f.select(850, 100, 100, 100); await f.run('layer.merge-down'); await f.run('layer.duplicate'); await f.run('layer.align-top'); });
    const h0 = await hash(p), n0 = await steps(p);
    await reach(p, 'edit.auto-blend');
    await p.waitForFunction((n) => Number((window as unknown as Win).fpe.state().step) === n + 1, n0, { timeout: 20_000 });
    expect(await p.textContent('[data-testid="toast"]')).toContain('Blended');
    expect(await hash(p)).not.toBe(h0);
    await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));
    expect(await hash(p)).toBe(h0);
    expect(errors).toEqual([]);
  }, 60_000);
});
