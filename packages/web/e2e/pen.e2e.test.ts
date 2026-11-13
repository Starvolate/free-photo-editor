// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The pen and its outline tools in a real headless Chrome, used as a person uses them: draw a closed outline with the mouse at
 * 1440 and by touch on a phone at 390, move a point, make a selection from it, undo and redo, rename it in the Paths panel,
 * and bring it back with Restore after a reload. Screenshots go to e2e/out (pen-*.png).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts pen
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Sel { x: number; y: number; w: number; h: number; }
interface Info { width: number; height: number; active: number; selection: Sel | null; layers: { name: string; x: number; y: number; width: number; height: number }[]; }
interface PenPoint { x: number; y: number; smooth: boolean; inX: number; inY: number; outX: number; outY: number; }
interface Paths { count: number; names: string[]; picked: string | null; anchors: number; closed: boolean[]; drawing: boolean; points: PenPoint[]; }
interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; appState(): { autosave: { writes: number } }; openSample(): void; select(x: number, y: number, w: number, h: number): void;
  newDocument(w: number, h: number, bg?: string | null): void; getInfo(): Info | null; toClient(x: number, y: number): { x: number; y: number } | null;
  sample(x: number, y: number, only?: boolean): number[] | null;
}
type Win = Window & { fpe: Fpe };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const file = normalize(join(DIST, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    readFile(file).then((body) => res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body), () => res.writeHead(404).end());
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
/** Open the sample photo and wait until the tool kit (with the pen) has loaded. */
async function sample(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
  await p.waitForTimeout(150);
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const info = (p: Page): Promise<Info> => p.evaluate(() => (window as unknown as Win).fpe.getInfo() as Info);
const paths = (p: Page): Promise<Paths> => p.evaluate(() => ((window as unknown as Win).fpe.state().w3 as { paths: Paths }).paths);
async function at(p: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const c = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as const);
  if (!c) throw new Error('no picture');
  return c;
}
async function click(p: Page, x: number, y: number): Promise<void> {
  const c = await at(p, x, y);
  await p.mouse.click(c.x, c.y);
  await p.waitForTimeout(80);
}
async function drag(p: Page, pts: [number, number][], steps = 6): Promise<void> {
  const c0 = await at(p, pts[0][0], pts[0][1]);
  await p.mouse.move(c0.x, c0.y);
  await p.mouse.down();
  for (const [x, y] of pts.slice(1)) { const c = await at(p, x, y); await p.mouse.move(c.x, c.y, { steps }); }
  await p.mouse.up();
  await p.waitForTimeout(120);
}
const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: join(OUT, name) });
const near = (a: { x: number; y: number }, x: number, y: number, tol = 2): boolean => Math.abs(a.x - x) <= tol && Math.abs(a.y - y) <= tol;

const suite = CHROME ? describe : describe.skip;
suite('Pen and paths (headless Chrome)', () => {
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

  it('draws a closed outline with the pen at 1440, moves a point, makes a selection, undoes and redoes, and comes back after a reload', async () => {
    const p = await open(1440, 900);
    await sample(p);
    expect(await run(p, 'tool.pen')).toBe(true);
    await click(p, 200, 150);
    await drag(p, [[400, 150], [460, 210]]);
    await click(p, 300, 330);
    let s = await paths(p);
    expect([s.count, s.anchors, s.drawing]).toEqual([1, 3, true]);
    expect(s.points[1].smooth).toBe(true);
    expect(near({ x: s.points[1].outX, y: s.points[1].outY }, 460, 210, 3)).toBe(true);
    expect(near({ x: s.points[1].inX, y: s.points[1].inY }, 340, 90, 3)).toBe(true);
    const hover = await at(p, 240, 260);
    await p.mouse.move(hover.x, hover.y, { steps: 4 });
    await p.waitForTimeout(150);
    await shot(p, 'pen-drawing.png');
    await click(p, 200, 150);
    s = await paths(p);
    expect([s.anchors, s.closed, s.drawing]).toEqual([3, [true], false]);

    await run(p, 'tool.direct-select');
    await drag(p, [[300, 330], [320, 350]]);
    s = await paths(p);
    expect(near(s.points[2], 320, 350)).toBe(true);

    expect(await run(p, 'select.from-path')).toBe(true);
    await p.waitForTimeout(150);
    const sel = (await info(p)).selection as Sel;
    expect(sel).not.toBeNull();
    // The first side is a curve: the smooth point's in handle at (340,90) lifts it to y = 150 - 80/3 = 123.3 (path.test.ts),
    // so the selection's top is 123, not the anchors' 150. The left edge is the first corner; the bottom is the moved corner.
    expect(Math.abs(sel.x - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(sel.y - 123)).toBeLessThanOrEqual(2);
    expect(Math.abs(sel.y + sel.h - 350)).toBeLessThanOrEqual(2);

    await run(p, 'edit.undo');
    expect((await info(p)).selection).toBeNull();
    await run(p, 'edit.undo');
    expect(near((await paths(p)).points[2], 300, 330)).toBe(true);
    await run(p, 'edit.redo');
    expect(near((await paths(p)).points[2], 320, 350)).toBe(true);
    await run(p, 'edit.redo');
    expect((await info(p)).selection).not.toBeNull();

    // Open Outlines as a person does: its tab in the Layers card, or, when the row is too narrow for it, the card's "+n" button.
    // (panel.paths is the Window menu's show/hide switch: run while the panel is shown behind Layers, it would hide it.)
    const tab = p.locator('[data-testid="tab-paths"]');
    if (await tab.isVisible()) await tab.click();
    else { await p.click('[data-testid="gmore-layers"]'); await p.click('.fpe-pop button[data-tipcmd="panel.paths"]'); }
    await p.waitForSelector('[data-testid="tab-paths"][aria-selected="true"]', { timeout: 10_000 });
    await p.waitForSelector('[data-testid="path-row"]', { state: 'visible', timeout: 10_000 });
    expect(await p.locator('[data-testid="path-row"]').count()).toBe(1);
    await p.locator('[data-testid="path-row"]').first().dblclick();
    await p.fill('[data-testid="path-name-input"]', 'Hill outline');
    await p.press('[data-testid="path-name-input"]', 'Enter');
    await p.waitForTimeout(150);
    expect((await paths(p)).names).toEqual(['Hill outline']);
    await run(p, 'tool.pen');
    await p.waitForTimeout(150);
    await shot(p, 'pen-paths-panel.png');

    const writes = (await p.evaluate(() => (window as unknown as Win).fpe.appState().autosave.writes));
    await p.waitForFunction((n) => (window as unknown as Win).fpe.appState().autosave.writes > n, writes, { timeout: 15_000 }).catch(() => undefined);
    await p.waitForTimeout(500);
    await p.reload();
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    await p.click('[data-testid="restore-yes"]', { timeout: 15_000 });
    await run(p, 'tool.path-select');
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
    await click(p, 260, 220);
    s = await paths(p);
    expect([s.count, s.names, s.anchors, s.closed]).toEqual([1, ['Hill outline'], 3, [true]]);
    expect(near(s.points[2], 320, 350)).toBe(true);
    expect(errors).toEqual([]);
  }, 120_000);

  it('draws a closed outline by touch on a phone at 390', async () => {
    const p = await open(390, 844, true);
    await sample(p);
    const cdp = await p.context().newCDPSession(p);
    const touch = async (pts: [number, number][]): Promise<void> => {
      const c = await Promise.all(pts.map(([x, y]) => at(p, x, y)));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c[0].x, y: c[0].y }] });
      await p.waitForTimeout(60);
      for (const pt of c.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x, y: pt.y }] });
        await p.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(150);
    };
    expect(await run(p, 'tool.pen')).toBe(true);
    await touch([[200, 150]]);
    await touch([[600, 150], [650, 200], [700, 250]]);
    await touch([[400, 480]]);
    let s = await paths(p);
    expect([s.anchors, s.drawing]).toEqual([3, true]);
    expect(s.points[1].smooth).toBe(true);
    await touch([[200, 150]]);
    s = await paths(p);
    expect([s.anchors, s.closed, s.drawing]).toEqual([3, [true], false]);
    await shot(p, 'pen-phone.png');
    expect(errors).toEqual([]);
  }, 60_000);
});
