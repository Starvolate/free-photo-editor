// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Bend and push (13 Nov 2026) in a real headless Chrome: Bend, Re-angle a surface, Bend around pins and the Cage are
 * reached through the ribbon with real clicks, their handles are dragged on the picture with the mouse, the preview
 * changes while they move, and Apply keeps the bend as one undo step. Then Fit canvas and Repeat the last transform.
 * Screenshots go to e2e/out (the pins shot at 1440 is the card's shot).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts crop-warp
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
  select(x: number, y: number, w: number, h: number): void; checksum(x: number, y: number, w: number, h: number): number;
  toClient(x: number, y: number): { x: number; y: number } | null; getInfo(): { width: number; height: number; active: number; layers: { width: number }[] } | null;
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
const sum = (p: Page): Promise<number> => p.evaluate((b) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]), BOX);
const step = async (p: Page): Promise<number> => (await p.evaluate(() => (window as unknown as Win).fpe.state().step)) as number;
/** A point of the selected box, in percent across and down, as a screen position. */
const spot = async (p: Page, ax: number, ay: number): Promise<{ x: number; y: number }> =>
  (await p.evaluate(([b, x, y]) => (window as unknown as Win).fpe.toClient(b[0] + (x / 100) * (b[2] - 1), b[1] + (y / 100) * (b[3] - 1)), [BOX, ax, ay] as const))!;
/** A real mouse drag on the picture, in small moves so the preview runs while the handle moves. */
async function drag(p: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let k = 1; k <= 6; k++) await p.mouse.move(from.x + (dx * k) / 6, from.y + (dy * k) / 6);
  await p.mouse.up();
}
async function fresh(p: Page): Promise<void> {
  await p.reload();
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.evaluate(async (b) => {
    const f = (window as unknown as Win).fpe;
    f.openSample();
    await f.run('layer.flatten');
    f.select(b[0], b[1], b[2], b[3]);
  }, BOX);
}
/** What each bend needs from the person after its dialog opens: a step picked, pins placed, handles dragged. */
const ACT: Record<string, (p: Page) => Promise<void>> = {
  'edit.warp': async (p) => { await drag(p, await spot(p, 100 / 3, 100 / 3), 60, 45); },
  'edit.perspective-warp': async (p) => {
    await drag(p, await spot(p, 25, 25), -20, -15);
    await p.selectOption('[data-testid="ctl-step"]', '1');
    await drag(p, await spot(p, 75, 75), 50, 30);
  },
  'edit.pin-warp': async (p) => {
    await p.mouse.click((await spot(p, 20, 50)).x, (await spot(p, 20, 50)).y);
    await p.mouse.click((await spot(p, 50, 80)).x, (await spot(p, 50, 80)).y);
    await drag(p, await spot(p, 80, 30), 0, 0);
    await drag(p, await spot(p, 80, 30), -40, 60);
  },
  'edit.cage': async (p) => {
    await p.selectOption('[data-testid="ctl-step"]', '1');
    await drag(p, await spot(p, 50, 20), 30, -25);
  },
};
const BENDS = Object.keys(ACT);

const suite = CHROME ? describe : describe.skip;
suite('Bend and push (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('reaches each bend by clicks, drags its handles with a live preview, applies it as one step', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    const done: string[] = [];
    for (const id of BENDS) {
      await fresh(p);
      const before = await sum(p), n = await step(p);
      await reach(p, id);
      await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
      await ACT[id](p);
      await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, before] as const, { timeout: 20_000 });
      if (id === 'edit.pin-warp') await p.screenshot({ path: join(OUT, 'crop-warp-pins-1440.png') });
      if (id === 'edit.warp') await p.screenshot({ path: join(OUT, 'crop-warp-grid-1440.png') });
      await p.click('[data-testid="adj-apply"]');
      await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) === k + 1, n);
      expect(await sum(p), id).not.toBe(before);
      done.push(id);
    }
    expect(done).toEqual(BENDS);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 300_000);

  it('fits the canvas to the selection, then repeats a free transform from the ribbon', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    await fresh(p);
    let n = await step(p);
    await reach(p, 'image.fit-canvas');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) === k + 1, n);
    expect(await p.evaluate(() => (window as unknown as Win).fpe.getInfo())).toMatchObject({ width: BOX[2], height: BOX[3] });
    // Undo brings the whole picture back: fitting deleted nothing.
    await p.keyboard.press('Control+z');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) === k, n);
    expect((await p.evaluate(() => (window as unknown as Win).fpe.getInfo()))?.width).toBeGreaterThan(BOX[2]);

    // A free transform made by dragging a corner, then the same again from the ribbon.
    await fresh(p);
    await p.evaluate(() => (window as unknown as Win).fpe.run('select.none'));
    const w0 = await p.evaluate(() => (window as unknown as Win).fpe.getInfo()?.width ?? 0);
    await reach(p, 'edit.free-transform');
    await p.waitForFunction(() => !!((window as unknown as Win).fpe.state().w3 as { transform: string | null } | null)?.transform);
    // The handles in state() are canvas positions; the mouse needs page positions, read after the transform refit the view.
    // The flattened sample layer fills the picture, so its bottom-right handle sits on the picture's bottom-right corner.
    const [c0, c1] = await p.evaluate(() => { const f = (window as unknown as Win).fpe, i = f.getInfo(); return [f.toClient(0, 0), f.toClient(i?.width ?? 0, i?.height ?? 0)]; });
    await drag(p, c1!, -(c1!.x - c0!.x) / 4, -(c1!.y - c0!.y) / 4);
    n = await step(p);
    await p.click('[data-testid="xf-apply"]');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) === k + 1, n);
    const box1 = await p.evaluate(() => { const i = (window as unknown as Win).fpe.getInfo(); return i ? i.layers[i.active] : null; });
    expect(box1?.width ?? w0, 'the corner drag resized the layer').toBeLessThan(w0 * 0.9);
    await reach(p, 'edit.transform-again');
    await p.waitForFunction(() => !!((window as unknown as Win).fpe.state().w3 as { transform: string | null } | null)?.transform);
    n = await step(p);
    await p.click('[data-testid="xf-apply"]');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) === k + 1, n);
    const box2 = await p.evaluate(() => { const i = (window as unknown as Win).fpe.getInfo(); return i ? i.layers[i.active] : null; });
    expect(w0).toBeGreaterThan(0);
    expect(box1 && box2 && box2.width < box1.width * 0.9, `${box1?.width} then ${box2?.width}`).toBe(true);

    // Each picture remembers its own last transform: a second picture in a new tab has nothing to repeat yet, so
    // Transform again starts a plain free transform there and the layer keeps its size.
    await p.evaluate(async () => { const f = (window as unknown as Win).fpe; f.openSample(); await f.run('layer.flatten'); });
    const w2 = await p.evaluate(() => { const i = (window as unknown as Win).fpe.getInfo(); return i ? i.layers[i.active].width : 0; });
    await reach(p, 'edit.transform-again');
    await p.waitForFunction(() => !!((window as unknown as Win).fpe.state().w3 as { transform: string | null } | null)?.transform);
    await p.waitForTimeout(250);
    expect(await p.evaluate(() => { const i = (window as unknown as Win).fpe.getInfo(); return i ? i.layers[i.active].width : 0; }), 'the other picture was not resized').toBe(w2);
    await p.keyboard.press('Escape');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});
