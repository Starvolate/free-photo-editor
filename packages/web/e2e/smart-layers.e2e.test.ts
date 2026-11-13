// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Smart layers in a real headless Chrome, by real clicks from the ribbon: Make a smart layer, then Picture size at half and
 * back to full size gives back the original pixels exactly (a plain layer does not); the Layers panel marks the smart layer;
 * Turn back into pixels makes it a plain layer again; a brush on a smart layer refuses with a plain sentence.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts smart-layers
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reach } from './ribbon';

interface Fpe {
  commands(): { id: string; status: string }[]; run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void;
  checksum(x: number, y: number, w: number, h: number): number;
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
const errors: string[] = [];
// The document's size is in state().info (state() itself has no width or height).
type St = { info: { width: number; height: number }; step: number; layers: { kind: string }[] };
const st = (p: Page): Promise<St> => p.evaluate(() => (window as unknown as Win).fpe.state() as unknown as St);
const whole = (p: Page): Promise<number> => p.evaluate(() => { const s = (window as unknown as Win).fpe.state() as unknown as St; return (window as unknown as Win).fpe.checksum(0, 0, s.info.width, s.info.height); });
async function fresh(p: Page): Promise<void> {
  await p.reload();
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.evaluate(async () => { const f = (window as unknown as Win).fpe; f.openSample(); await f.run('layer.flatten'); });
}
/** Picture size by clicks: untick "keep the shape", type both sides, then Apply; waits for the new size. */
async function pictureSize(p: Page, w: number, h: number): Promise<void> {
  await reach(p, 'image.size');
  await p.waitForSelector('[data-testid="size-w"]');
  if (await p.isChecked('[data-testid="size-keep"]')) await p.click('[data-testid="size-keep"]');
  await p.fill('[data-testid="size-w"]', String(w));
  await p.fill('[data-testid="size-h"]', String(h));
  await p.click('[data-testid="size-apply"]');
  await p.waitForFunction((x) => { const s = (window as unknown as Win).fpe.state() as unknown as St; return s.info.width === x[0] && s.info.height === x[1]; }, [w, h]);
}

const suite = CHROME ? describe : describe.skip;
suite('Smart layers (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('a smart layer survives half size and back exactly; a plain layer does not; turning back into pixels works', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    const ready = new Set((await p.evaluate(() => (window as unknown as Win).fpe.commands())).filter((c) => c.status === 'ready').map((c) => c.id));
    expect(['layer.smart-convert', 'layer.smart-rasterize'].filter((id) => !ready.has(id))).toEqual([]);

    // A plain layer loses detail on the way down and back.
    await fresh(p);
    const orig = await whole(p), { width: W, height: H } = (await st(p)).info;
    await pictureSize(p, Math.round(W / 2), Math.round(H / 2));
    await pictureSize(p, W, H);
    expect(await whole(p)).not.toBe(orig);

    // A smart layer gives back its original pixels.
    await fresh(p);
    expect(await whole(p)).toBe(orig);
    let n = (await st(p)).step;
    await reach(p, 'layer.smart-convert');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state() as unknown as St).step > k, n);
    expect((await st(p)).layers[0].kind).toBe('smart');
    await p.waitForSelector('[data-testid="smart-tag"]');
    await pictureSize(p, Math.round(W / 2), Math.round(H / 2));
    expect(await whole(p)).not.toBe(orig);
    await pictureSize(p, W, H);
    expect(await whole(p)).toBe(orig);
    await p.screenshot({ path: join(OUT, 'smart-layer-1440.png') });

    // A brush refuses a smart layer with a plain sentence.
    await p.evaluate(() => { const t = document.querySelector('[data-testid="toast"]'); if (t) t.textContent = ''; });
    await p.evaluate(async () => { await (window as unknown as Win).fpe.run('tool.brush'); });
    const c = await p.locator('canvas.fpe-canvas, [data-testid="canvas"]').first().boundingBox();
    if (c) { await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await p.mouse.down(); await p.mouse.move(c.x + c.width / 2 + 30, c.y + c.height / 2); await p.mouse.up(); }
    expect(await p.textContent('[data-testid="toast"]')).toMatch(/smart layer/);
    expect(await whole(p)).toBe(orig);

    // Turn back into pixels: a plain layer again, the picture unchanged.
    n = (await st(p)).step;
    await reach(p, 'layer.smart-rasterize');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state() as unknown as St).step > k, n);
    expect((await st(p)).layers[0].kind).toBe('pixel');
    expect(await p.locator('[data-testid="smart-tag"]').count()).toBe(0);
    expect(await whole(p)).toBe(orig);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);

  it('a live blur is listed under the layer: its eye, Picture size, reopening and removing all redraw from the original', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await fresh(p);
    const orig = await whole(p), { width: W, height: H } = (await st(p)).info;
    const is = (v: number): Promise<unknown> => p.waitForFunction((x) => { const f = (window as unknown as Win).fpe, s = f.state() as unknown as St;
      return f.checksum(0, 0, s.info.width, s.info.height) === x; }, v, { timeout: 20_000 });
    // From a plain layer, "Effects you can reopen and edit" makes it smart and opens Smooth blur as a live filter.
    await reach(p, 'layer.smart-filters');
    await p.waitForSelector('[data-testid="adj-apply"]');
    await p.waitForFunction((o) => { const f = (window as unknown as Win).fpe, s = f.state() as unknown as St; return f.checksum(0, 0, s.info.width, s.info.height) !== o; }, orig, { timeout: 20_000 });
    await p.click('[data-testid="adj-apply"]');
    await p.waitForSelector('[data-testid="live-filter"]');
    expect((await st(p)).layers[0].kind).toBe('smart');
    expect(await p.textContent('[data-testid="live-filter"]')).toContain('Smooth blur');
    const blurred = await whole(p);
    expect(blurred).not.toBe(orig);
    await p.screenshot({ path: join(OUT, 'smart-live-blur-1440.png') });

    // Its eye: off gives the original exactly, on gives the same blur back.
    await p.click('[data-testid="live-eye"]');
    await is(orig);
    await p.click('[data-testid="live-eye"]');
    await is(blurred);
    // Half size and back redraws from the original, so the blur comes back to the same pixels.
    await pictureSize(p, Math.round(W / 2), Math.round(H / 2));
    await pictureSize(p, W, H);
    expect(await whole(p)).toBe(blurred);
    // Clicking its name reopens the dialog; Cancel keeps the picture as it was.
    await p.click('[data-testid="live-name"]');
    await p.waitForSelector('[data-testid="adj-apply"]');
    await p.click('[data-testid="adj-cancel"]');
    await is(blurred);
    // Remove: the row goes and the original is back.
    await p.click('[data-testid="live-remove"]');
    await is(orig);
    expect(await p.locator('[data-testid="live-filter"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 180_000);
});
