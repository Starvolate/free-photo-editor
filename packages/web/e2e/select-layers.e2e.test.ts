// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The select-and-layers batch in a real headless Chrome, each reached with real clicks from its ribbon home: Select by
 * brightness on the sample photo (the 1440 shot), Round the corners of a selection, Lift the selection into a new layer,
 * Reverse the layer order and Crop a layer to its content; part 2: Refine edge with its live preview (the 1440 shot), paint
 * the selection as a grey picture, colour-label a layer and find it. Each change is one undo step.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts select-layers
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { show } from './ribbon';

interface Info { active: number; selection: { x: number; y: number; w: number; h: number } | null; layers: { name: string; x: number; y: number; width: number; height: number }[] }
interface Fpe { run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; select(x: number, y: number, w: number, h: number): void; getInfo(): Info | null; }
type Win = Window & { fpe: Fpe };

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

let browser: Browser;
let server: Server;
let url = '';
const contexts: BrowserContext[] = [];
const errors: string[] = [];
async function open(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  return p;
}
const info = async (p: Page): Promise<Info> => (await p.evaluate(() => (window as unknown as Win).fpe.getInfo())) as Info;
const steps = async (p: Page): Promise<number> => (await p.evaluate(() => (window as unknown as Win).fpe.state())).steps as number;
const select = (p: Page, x: number, y: number, w: number, h: number) => p.evaluate(([a, b, c, d]) => (window as unknown as Win).fpe.select(a, b, c, d), [x, y, w, h]);
async function clickHome(p: Page, id: string): Promise<void> {
  await show(p, id);
  await p.click(`[data-testid="ri-${id}"]`);
}
/** Click Apply in the batch's sheet `key` once it is on screen. */
async function apply(p: Page, key: string): Promise<void> {
  const b = p.locator(`[data-testid="sm-${key}"] [data-testid="sm-apply"]`);
  await b.waitFor({ state: 'visible' });
  await b.click();
}

const suite = CHROME ? describe : describe.skip;
suite('Select and layers batch (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
    server?.close();
    expect(errors).toEqual([]);
  });

  it('selects the light parts of the sample photo by brightness, in one undo step', async () => {
    const p = await open();
    const n = await steps(p);
    await clickHome(p, 'select.luminance');
    await apply(p, 'luminance');
    await p.waitForFunction(() => !!(window as unknown as Win).fpe.getInfo()?.selection);
    const s = (await info(p)).selection!;
    expect(s.w * s.h).toBeGreaterThan(1000);
    expect(await steps(p)).toBe(n + 1);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'select-luminance-1440.png') });
  }, 60_000);

  it('rounds the corners of a box selection and keeps its size', async () => {
    const p = await open();
    await select(p, 100, 100, 200, 150);
    const n = await steps(p);
    await clickHome(p, 'select.round-corners');
    await apply(p, 'round');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().steps as number) === k, n + 1);
    expect((await info(p)).selection).toEqual({ x: 100, y: 100, w: 200, h: 150 });
  }, 60_000);

  it('lifts the selection into its own layer, reverses the order, and crops a layer to its content', async () => {
    const p = await open();
    // The sample opens with more than one layer: lift a 40 x 40 box from the middle of the active one.
    const first = await info(p), src = first.layers[first.active];
    const cx = Math.round(src.x + src.width / 2) - 20, cy = Math.round(src.y + src.height / 2) - 20;
    await select(p, cx, cy, 40, 40);
    await clickHome(p, 'select.float');
    await p.waitForFunction((k) => (window as unknown as Win).fpe.getInfo()?.layers.length === k, first.layers.length + 1);
    let d = await info(p);
    expect(d.layers[d.active]).toMatchObject({ name: 'Lifted pixels', x: cx, y: cy, width: 40, height: 40 });
    const upside = JSON.stringify(d.layers.map((l) => l.name).reverse());
    await clickHome(p, 'layer.reverse');
    await p.waitForFunction((k) => JSON.stringify((window as unknown as Win).fpe.getInfo()?.layers.map((l) => l.name)) === k, upside);
    // A new layer with a 30 x 20 patch painted on it shrinks to that patch.
    await p.evaluate(async () => {
      const f = (window as unknown as Win).fpe;
      await f.run('layer.new');
      f.select(10, 10, 30, 20);
      await f.run('edit.fill');
      await f.run('select.none');
    });
    const n = await steps(p);
    await clickHome(p, 'layer.crop-to-content');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().steps as number) === k, n + 1);
    d = await info(p);
    expect(d.layers[d.active]).toMatchObject({ x: 10, y: 10, width: 30, height: 20 });
  }, 60_000);

  it('refines the edge of a selection with a live preview over the picture (the 1440 shot), in one undo step', async () => {
    const p = await open();
    await select(p, 300, 120, 360, 300);
    const n = await steps(p);
    await clickHome(p, 'select.refine');
    const cv = p.locator('[data-testid="sm-refine"] [data-testid="sm-refine-preview"]');
    await cv.waitFor({ state: 'visible' });
    // The preview is drawn and follows its Show control: far outside the box, 'On white' is pure white and 'Dim the rest'
    // keeps a quarter of the picture at most.
    const corner = () => cv.evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(2, 2, 1, 1).data; return d[0] + d[1] + d[2]; });
    await p.locator('[data-testid="sm-refine"] [data-testid="sm-rf-view-white"]').click();
    await expect.poll(corner).toBe(765);
    await p.locator('[data-testid="sm-refine"] [data-testid="sm-rf-view-dim"]').click();
    await expect.poll(corner).toBeLessThanOrEqual(192);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'refine-edge-1440.png') });
    await apply(p, 'refine');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().steps as number) === k, n + 1);
    expect((await info(p)).selection).not.toBeNull();
  }, 60_000);

  it('paints the selection as a grey picture and turns it back into a selection', async () => {
    const p = await open();
    await select(p, 100, 100, 200, 150);
    const n = await steps(p);
    await clickHome(p, 'select.editor');
    const cv = p.locator('[data-testid="sm-editor"] [data-testid="sm-editor-canvas"]');
    await cv.waitFor({ state: 'visible' });
    const b = (await cv.boundingBox())!;
    await p.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width * 0.9, b.y + b.height * 0.7, { steps: 8 });
    await p.mouse.up();
    await apply(p, 'editor');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().steps as number) === k, n + 1);
    const s = (await info(p)).selection!;
    expect(s.x + s.w).toBeGreaterThan(400);
  }, 60_000);

  it('tags a layer green and finds it by its label', async () => {
    const p = await open();
    const n = await steps(p);
    await clickHome(p, 'layer.colour-label');
    await p.locator('[data-testid="sm-label"] [data-testid="sm-label-green"]').click();
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().steps as number) === k, n + 1);
    await p.locator('[data-testid="sm-label"] [data-testid="sm-done"]').click();
    await clickHome(p, 'layer.filter');
    await p.locator('[data-testid="sm-find"] [data-testid="sm-find-label"]').selectOption('green');
    await expect.poll(() => p.locator('[data-testid="sm-find"] [data-testid="sm-find-item"]').count()).toBe(1);
  }, 60_000);
});
