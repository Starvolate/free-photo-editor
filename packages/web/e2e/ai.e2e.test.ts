// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The on-device AI (W11) through the real editor in headless Chrome, with the real models downloaded from their pinned
 * public hosts: Select the main subject and Remove the background on the sample photo (the mask must cover the sun and
 * not the sky), Remove an object (the sun painted over disappears into the sky) and Make it bigger (2x). Headless Chrome
 * has no GPU, so this proves the WebAssembly path. Needs the network. Screenshots: e2e/out/w11-*.png.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts ai
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Info { width: number; height: number; layers: { name: string; visible: boolean }[]; }
interface Fpe {
  getInfo(): Info | null; sample(x: number, y: number): number[] | null; run(id: string): unknown; selectionAt(x: number, y: number): number;
  toClient(x: number, y: number): { x: number; y: number } | null;
}
type Win = { fpe: Fpe };
const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
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
const SUN = { x: 905, y: 180 }, SKY = { x: 300, y: 100 };

describe.skipIf(!CHROME)('on-device AI (W11), real models', () => {
  let s: { server: Server; url: string }, browser: Browser, page: Page;
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    s = await serve();
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
    page.on('pageerror', (e) => console.log('[page error]', e.message));
    await page.goto(s.url);
    await page.waitForFunction(() => !!(window as unknown as Win).fpe, undefined, { timeout: 30_000 });
    await page.click('[data-testid="start-sample"]');
    await page.waitForFunction(() => ((window as unknown as Win).fpe.getInfo()?.layers.length ?? 0) === 2);
  });
  afterAll(async () => { await browser?.close(); s?.server.close(); });
  const run = (id: string): Promise<void> => page.evaluate((x) => { void (window as unknown as Win).fpe.run(x); }, id);
  const sel = (p: { x: number; y: number }): Promise<number> => page.evaluate(([x, y]) => (window as unknown as Win).fpe.selectionAt(x, y), [p.x, p.y] as [number, number]);
  const px = (p: { x: number; y: number }): Promise<number[]> => page.evaluate(([x, y]) => (window as unknown as Win).fpe.sample(x, y) ?? [], [p.x, p.y] as [number, number]);
  const info = (): Promise<Info | null> => page.evaluate(() => (window as unknown as Win).fpe.getInfo());
  const layers = async (): Promise<number> => (await info())?.layers.length ?? 0;
  /** The first use of a model: the sheet says the size in plain words; then download. */
  async function download(shot?: string): Promise<void> {
    await page.waitForSelector('[data-testid="ai-download"]', { state: 'visible', timeout: 30_000 });
    const said = await page.textContent('[data-testid="ai-message"]');
    console.log('W11 download sheet:', said);
    expect(said).toMatch(/^This downloads once, about \d+(\.\d)? MB\. Your photo never leaves this device\.$/);
    if (shot) await page.screenshot({ path: join(OUT, shot) });
    await page.click('[data-testid="ai-download"]');
  }
  const settled = (ms: number): Promise<unknown> => page.waitForSelector('[data-testid="ai-sheet"]', { state: 'hidden', timeout: ms });

  it('Select the main subject: the mask covers the sun and not the sky', async () => {
    const t0 = Date.now();
    await run('select.subject');
    await download('w11-download-sheet.png');
    await settled(240_000);
    const sun = await sel(SUN), sky = await sel(SKY), edge = await sel({ x: 868, y: 180 });
    console.log(`W11 select subject: sun ${sun}, sky ${sky}, sun edge ${edge}, ${Date.now() - t0} ms with the download`);
    expect(sun).toBeGreaterThan(127);
    expect(sky).toBeLessThan(64);
  }, 300_000);

  it('Remove the background: the sun stays solid, the sky becomes see-through, the original is kept hidden', async () => {
    const t0 = Date.now();
    await run('image.remove-bg');
    await expect.poll(layers, { timeout: 120_000, interval: 250 }).toBe(3);
    await settled(30_000);
    const sun = await px(SUN), sky = await px(SKY), i = await info();
    console.log(`W11 remove background: sun ${sun}, sky ${sky}, ${Date.now() - t0} ms, layers ${JSON.stringify(i?.layers)}`);
    expect(sun[3]).toBeGreaterThan(200);
    expect(sky[3]).toBeLessThan(40);
    expect(i?.layers.filter((l) => l.visible).map((l) => l.name)).toEqual(['Background removed']);
    await page.screenshot({ path: join(OUT, 'w11-removed-background.png') });
    await run('edit.undo');
    await expect.poll(layers).toBe(2);
  }, 180_000);

  it('Remove an object: paint over the sun, let go, and it disappears into the sky', async () => {
    await run('select.none');
    await run('tool.remove');
    const before = await px(SUN), pts: { x: number; y: number }[] = [];
    for (let k = 0, y = 100; y <= 260; y += 20, k++) for (const x of k % 2 ? [957, 846] : [846, 957]) pts.push({ x, y });
    const c = await page.evaluate((list) => list.map((p) => (window as unknown as Win).fpe.toClient(p.x, p.y)), pts);
    expect(c.every(Boolean)).toBe(true);
    await page.mouse.move(c[0]!.x, c[0]!.y);
    await page.mouse.down();
    for (const p of c.slice(1)) await page.mouse.move(p!.x, p!.y, { steps: 6 });
    await page.mouse.up();
    await download();
    await settled(240_000);
    const after = await px(SUN);
    console.log(`W11 remove object: sun before ${before}, after ${after}, layers ${await layers()}`);
    expect(before[0]).toBeGreaterThan(before[2]);
    expect(after[2]).toBeGreaterThan(after[0]);
    await page.screenshot({ path: join(OUT, 'w11-removed-object.png') });
  }, 300_000);

  it('Make it bigger: twice as big doubles the picture', async () => {
    const t0 = Date.now();
    await run('image.upscale-2x');
    await download();
    await settled(400_000);
    const i = await info();
    console.log(`W11 make it bigger 2x: ${i?.width} x ${i?.height}, ${Date.now() - t0} ms with the download`);
    expect([i?.width, i?.height]).toEqual([1920, 1280]);
    await page.screenshot({ path: join(OUT, 'w11-bigger-2x.png') });
  }, 420_000);
});
