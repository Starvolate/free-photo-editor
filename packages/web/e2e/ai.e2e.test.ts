// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The on-device AI (W11) through the real editor in headless Chrome, with the real models downloaded from their pinned
 * public hosts. Select the main subject and Remove the background are Planned (on real photos the subject model still
 * cuts away parts of some subjects), so their kept code runs through the automation hook `fpe.aiCmd` on a real photo,
 * e2e/fixtures/mug.jpg (CC0): the mask must cover the jug and not the cloth. Remove an object (the sun painted over
 * disappears into the sky) and Make it bigger (2x) run as a person would. Each test starts on its own fresh tab and
 * presses Cancel in `finally`, so one failure never leaks into the next. Headless Chrome has no GPU, so this proves the
 * WebAssembly path. Needs the network. Screenshots: e2e/out/w11-*.png.
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
  getInfo(): Info | null; sample(x: number, y: number): number[] | null; run(id: string): Promise<boolean>; aiCmd(id: string): Promise<void>;
  selectionAt(x: number, y: number): number; toClient(x: number, y: number): { x: number; y: number } | null; openSample(): void;
  openFile(file: Blob, name?: string): Promise<void>; commands(): { id: string; status: string }[];
}
type Win = { fpe: Fpe };
type Box = [number, number, number, number];
const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const MUG = join(WEB, 'e2e', 'fixtures', 'mug.jpg');
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
const SUN = { x: 905, y: 180 };
/** [x, y, width, height] on the 480 x 640 mug photo, fixed before any model ran on it, with the bar: jug >= 179, cloth <= 38. */
const JUG: Box[] = [[180, 250, 100, 80], [205, 335, 80, 30]], CLOTH: Box[] = [[80, 20, 270, 80], [20, 480, 100, 140]];

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
  });
  afterAll(async () => { await browser?.close(); s?.server.close(); });
  const run = (id: string): Promise<void> => page.evaluate((x) => { void (window as unknown as Win).fpe.run(x); }, id);
  const aiCmd = (id: string): Promise<void> => page.evaluate((x) => { void (window as unknown as Win).fpe.aiCmd(x); }, id);
  const px = (p: { x: number; y: number }): Promise<number[]> => page.evaluate(([x, y]) => (window as unknown as Win).fpe.sample(x, y) ?? [], [p.x, p.y] as [number, number]);
  const info = (): Promise<Info | null> => page.evaluate(() => (window as unknown as Win).fpe.getInfo());
  const layers = async (): Promise<number> => (await info())?.layers.length ?? 0;
  /** How selected each box is on average, 0 to 255. */
  const means = (boxes: Box[]): Promise<number[]> => page.evaluate((list) => list.map(([x, y, w, hh]) => {
    const f = (window as unknown as Win).fpe;
    let sum = 0, n = 0;
    for (let yy = y; yy < y + hh; yy += 2) for (let xx = x; xx < x + w; xx += 2) { sum += f.selectionAt(xx, yy); n++; }
    return Math.round(sum / n);
  }), boxes);
  /** A fresh tab with the sample photo, so no test depends on what an earlier one left behind. */
  async function freshSample(): Promise<void> {
    await page.evaluate(() => (window as unknown as Win).fpe.openSample());
    await page.waitForFunction(() => { const i = (window as unknown as Win).fpe.getInfo(); return i?.width === 960 && i.layers.length === 2; });
  }
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
  /** Leave no AI sheet open, whatever happened in the test. */
  async function cleanUp(): Promise<void> {
    if (await page.isVisible('[data-testid="ai-cancel"]').catch(() => false)) await page.click('[data-testid="ai-cancel"]').catch(() => undefined);
    await settled(10_000).catch(() => undefined);
  }

  it('shows Select the main subject and Remove the background as Planned, on the start screen and in the Select menu', async () => {
    try {
      const st = await page.evaluate(() => (window as unknown as Win).fpe.commands().filter((c) => c.id === 'select.subject' || c.id === 'image.remove-bg').map((c) => c.status));
      expect(st).toEqual(['planned', 'planned']);
      expect(await page.getAttribute('[data-testid="start"] [data-testid="job-remove-the-background"]', 'aria-disabled')).toBe('true');
      await page.screenshot({ path: join(OUT, 'w11-planned-start.png') });
      await freshSample();
      await page.click('[data-testid="menu-top-select"]');
      await page.waitForSelector('[data-testid="mi-select.subject"]');
      await page.screenshot({ path: join(OUT, 'w11-planned-select-menu.png') });
      await page.keyboard.press('Escape');
      if (await page.locator('[data-testid="menu-drop"]').count()) await page.click('[data-testid="menu-top-select"]');
      expect(await page.evaluate(() => (window as unknown as Win).fpe.run('select.subject'))).toBe(false);
      expect(await page.textContent('[data-testid="toast"]')).toContain('planned');
    } finally { await cleanUp(); }
  }, 60_000);

  it('Select the main subject and Remove the background (Planned, code kept): on a real photo the mask covers the jug and not the cloth', async () => {
    try {
      const jpg = (await readFile(MUG)).toString('base64');
      await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await (window as unknown as Win).fpe.openFile(new Blob([bytes], { type: 'image/jpeg' }), 'mug.jpg');
      }, jpg);
      await page.waitForFunction(() => { const i = (window as unknown as Win).fpe.getInfo(); return i?.width === 480 && i.height === 640; });
      const t0 = Date.now();
      await aiCmd('select.subject');
      await download('w11-download-sheet.png');
      await settled(240_000);
      const jug = await means(JUG), cloth = await means(CLOTH);
      console.log(`W11 select subject on the mug: jug ${jug}, cloth ${cloth}, ${Date.now() - t0} ms with the download`);
      for (const v of jug) expect(v).toBeGreaterThanOrEqual(179);
      for (const v of cloth) expect(v).toBeLessThanOrEqual(38);
      const n = await layers();
      await aiCmd('image.remove-bg');
      await expect.poll(layers, { timeout: 120_000, interval: 250 }).toBe(n + 1);
      await settled(30_000);
      const a = await px({ x: 230, y: 290 }), b = await px({ x: 215, y: 60 }), i = await info();
      console.log(`W11 remove background on the mug: jug ${a}, cloth ${b}, layers ${JSON.stringify(i?.layers.map((l) => [l.name, l.visible]))}`);
      expect(a[3]).toBeGreaterThan(200);
      expect(b[3]).toBeLessThan(40);
      expect(i?.layers.filter((l) => l.visible).map((l) => l.name)).toEqual(['Background removed']);
      await page.screenshot({ path: join(OUT, 'w11-removed-background.png') });
    } finally { await cleanUp(); }
  }, 300_000);

  it('Remove an object: paint over the sun, let go, and it disappears into the sky', async () => {
    try {
      await freshSample();
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
    } finally { await cleanUp(); }
  }, 300_000);

  it('Make it bigger: twice as big doubles the picture', async () => {
    try {
      await freshSample();
      const t0 = Date.now();
      await run('image.upscale-2x');
      await download();
      await settled(400_000);
      const i = await info();
      console.log(`W11 make it bigger 2x: ${i?.width} x ${i?.height}, ${Date.now() - t0} ms with the download`);
      expect([i?.width, i?.height]).toEqual([1920, 1280]);
      await page.screenshot({ path: join(OUT, 'w11-bigger-2x.png') });
    } finally { await cleanUp(); }
  }, 420_000);
});
