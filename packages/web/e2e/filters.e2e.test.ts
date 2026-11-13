// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * W2 filters in a real headless Chrome. Every filter dialog opens, its live preview changes the picture, "Show before"
 * shows the picture as it was and back, Apply keeps exactly the preview, and Undo restores the picture. The iris blur's
 * handles drag on the picture, one dialog works on a phone, and the start screen's "Blur the background" job is ready. Screenshots go to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts filters
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Cmd { id: string; status: string; }
interface Fpe {
  commands(): Cmd[]; run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; setZoom(z: number): void;
  select(x: number, y: number, w: number, h: number): void; checksum(x: number, y: number, w: number, h: number): number;
  toClient(x: number, y: number): { x: number; y: number } | null;
}
type Win = Window & { fpe: Fpe };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};
/** Over the sun's edge, the hills and the sky of the sample photo (after flattening its two layers). */
const BOX: [number, number, number, number] = [600, 170, 320, 260];
/** One-click filters with no dialog (the workspace test covers them). */
const INSTANT = new Set(['filter.last', 'filter.sharpen', 'filter.sharpen-more']);

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
async function open(w: number, hgt: number, touch = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}px: ${e.message}`));
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const step = async (p: Page): Promise<number> => (await p.evaluate(() => (window as unknown as Win).fpe.state().step)) as number;
const sum = (p: Page): Promise<number> => p.evaluate((b) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]), BOX);
type Box = readonly [number, number, number, number];
const sumAt = (p: Page, b: Box): Promise<number> => p.evaluate((x) => (window as unknown as Win).fpe.checksum(x[0], x[1], x[2], x[3]), b);
const changes = (p: Page, b: Box, was: number): Promise<unknown> =>
  p.waitForFunction(([x, o]) => (window as unknown as Win).fpe.checksum(x[0], x[1], x[2], x[3]) !== o, [b, was] as const, { timeout: 20_000 });
const select = (p: Page, b: Box): Promise<void> => p.evaluate((x) => (window as unknown as Win).fpe.select(x[0], x[1], x[2], x[3]), b);
/** The sample photo as one layer, with grain on it (so speck and grain filters have work), and the box selected. */
async function prepare(p: Page): Promise<void> {
  await p.evaluate(async (b) => {
    const f = (window as unknown as Win).fpe;
    f.openSample();
    await f.run('layer.flatten');
    f.select(b[0], b[1], b[2], b[3]);
  }, BOX);
  await apply(p, 'filter.add-noise');
}
async function dialog(p: Page, id: string): Promise<void> {
  expect(await run(p, id), id).toBe(true);
  await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
}
async function apply(p: Page, id: string): Promise<void> {
  const before = await sum(p), n = await step(p);
  await dialog(p, id);
  await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, before] as const, { timeout: 20_000 });
  await p.click('[data-testid="adj-apply"]');
  await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) > k, n);
}

const suite = CHROME ? describe : describe.skip;
suite('W2 filters (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
    server?.close();
  });

  it('every filter: dialog, live preview, before and after, apply, undo', async () => {
    const p = await open(1440, 900);
    await prepare(p);
    const original = await sum(p), bad: string[] = [];
    const ids = (await p.evaluate(() => (window as unknown as Win).fpe.commands()))
      .filter((c) => c.id.startsWith('filter.') && c.status === 'ready' && !INSTANT.has(c.id)).map((c) => c.id);
    expect(ids.length).toBe(53);
    for (const id of ids) {
      const n = await step(p);
      await dialog(p, id);
      const changed = await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, original] as const, { timeout: 20_000 })
        .then(() => true, () => false);
      if (!changed) { bad.push(`${id}: the preview did not change the picture`); await p.click('[data-testid="adj-cancel"]'); continue; }
      await p.waitForTimeout(30);
      const after = await sum(p);
      await p.click('[data-testid="adj-before"]');
      if ((await sum(p)) !== original) bad.push(`${id}: "Show before" did not show the picture as it was`);
      await p.click('[data-testid="adj-before"]');
      if ((await sum(p)) !== after) bad.push(`${id}: switching back did not show the change`);
      await p.click('[data-testid="adj-apply"]');
      await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) > k, n);
      if ((await sum(p)) !== after) bad.push(`${id}: Apply kept something other than the preview`);
      await run(p, 'edit.undo');
      if ((await sum(p)) !== original) bad.push(`${id}: Undo did not restore the picture`);
    }
    expect(bad).toEqual([]);
    expect(errors).toEqual([]);
  }, 420_000);

  it('applies the change even when Apply is pressed while showing "before"', async () => {
    const p = await open(1440, 900);
    await prepare(p);
    const original = await sum(p), n = await step(p);
    await dialog(p, 'filter.mosaic');
    await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, original] as const);
    const after = await sum(p);
    await p.click('[data-testid="adj-before"]');
    expect(await sum(p)).toBe(original);
    await p.click('[data-testid="adj-apply"]');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) > k, n);
    expect(await sum(p)).toBe(after);
    await run(p, 'edit.undo');
    expect(await sum(p)).toBe(original);
  }, 90_000);

  it('shows the Filter menu and the dialogs, and drags the iris blur handles on the picture', async () => {
    const p = await open(1440, 900);
    await p.waitForSelector('[data-testid="start"]');
    const job = p.locator('[data-testid="start"] [data-testid^="job-"]', { hasText: 'Blur the background' });
    expect(await job.count()).toBe(1);
    expect(await job.getAttribute('aria-disabled')).toBeNull();
    await prepare(p);
    await p.click('[data-testid="menu-top-filter"]');
    await p.hover('[data-testid="sub-filter-blur"]');
    await p.waitForSelector('[data-testid="mi-filter.blur-motion"]');
    await p.screenshot({ path: join(OUT, 'w2-filter-menu-1440.png') });
    await p.keyboard.press('Escape');
    // The dialog sits over the right of the picture, so the shots and the iris spot use the left half, in full view.
    const LEFT: Box = [80, 150, 320, 260];
    await select(p, LEFT);
    for (const [id, shot] of [['filter.blur-motion', 'w2-blur-1440.png'], ['filter.oil-paint', 'w2-oil-paint-1440.png'], ['filter.polar', 'w2-polar-1440.png']]) {
      const before = await sumAt(p, LEFT);
      await dialog(p, id);
      await changes(p, LEFT, before);
      await p.screenshot({ path: join(OUT, shot) });
      await p.click('[data-testid="adj-cancel"]');
    }
    await dialog(p, 'filter.blur-iris');
    const centre = await p.evaluate((b) => (window as unknown as Win).fpe.toClient(b[0] + b[2] / 2, b[1] + b[3] / 2), LEFT);
    if (!centre) throw new Error('no picture');
    const cx = Number(await p.inputValue('[data-testid="ctl-cx"]'));
    await p.mouse.move(centre.x, centre.y);
    await p.mouse.down();
    await p.mouse.move(centre.x - 60, centre.y + 30, { steps: 6 });
    await p.mouse.up();
    expect(Number(await p.inputValue('[data-testid="ctl-cx"]'))).toBeLessThan(cx);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'w2-iris-handles-1440.png') });
    await p.click('[data-testid="adj-cancel"]');
    expect(errors).toEqual([]);
  }, 120_000);

  it('works on a phone: the dialog fits, a slider previews and Apply keeps it', async () => {
    const p = await open(390, 844, true);
    await prepare(p);
    // The phone dialog covers the lower half of the stage, so the change is made in the top of the picture, in view.
    const TOP: Box = [40, 30, 420, 190];
    await select(p, TOP);
    const before = await sumAt(p, TOP), n = await step(p);
    await dialog(p, 'filter.blur-motion');
    const box = await p.locator('[data-testid="adjust-dialog"]').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await p.$eval('[data-testid="ctl-distance"]', (el) => { const i = el as HTMLInputElement; i.value = '60'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await changes(p, TOP, before);
    await p.screenshot({ path: join(OUT, 'w2-dialog-390.png') });
    await p.click('[data-testid="adj-apply"]');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) > k, n);
    expect(await sumAt(p, TOP)).not.toBe(before);
    expect(errors).toEqual([]);
  }, 90_000);
});
