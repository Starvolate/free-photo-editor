// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Automate and batch in a real headless Chrome, each function reached with real clicks from its ribbon home:
 * Recorded steps (record a flip and a filter by hand, stop, play on the original: the same pixels, as one undo step),
 * Edit many pictures the same way and Resize many pictures (one ZIP, names in the picked order, the right sizes), and
 * the Sheet of small photos (one new picture, a layer per photo).
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

interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; flatHash(): Promise<string>;
  getInfo(): { layers: unknown[]; width: number; height: number } | null;
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
});
