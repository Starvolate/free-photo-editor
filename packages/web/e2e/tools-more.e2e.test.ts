// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Batch tools in a real headless Chrome, used as a person uses them: Turn the view (rotate view), Crop and straighten
 * (perspective crop) and Trace along edges (edge-snapping lasso), each reached from the ribbon with real clicks at 1440. Screenshots go to e2e/out (tools-*.png).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts tools-more
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { show } from './ribbon';

interface Sel { x: number; y: number; w: number; h: number; }
interface Info { width: number; height: number; active: number; selection: Sel | null; layers: { name: string; x: number; y: number; width: number; height: number }[]; }
interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; appState(): { autosave: { writes: number } }; openSample(): void; select(x: number, y: number, w: number, h: number): void;
  newDocument(w: number, h: number, bg?: string | null): void; getInfo(): Info | null; toClient(x: number, y: number): { x: number; y: number } | null;
  setZoom(z: number): void;
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
  // Toasts change between two screenshots of the same overlay; hide them so a compare sees only what the tool drew.
  await p.addStyleTag({ content: '[data-testid="toast"]{visibility:hidden!important}' });
  return p;
}
/** Open the sample photo and wait until the tool kit has loaded. */
async function sample(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
  await p.waitForTimeout(150);
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const info = (p: Page): Promise<Info> => p.evaluate(() => (window as unknown as Win).fpe.getInfo() as Info);
async function at(p: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const c = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as const);
  if (!c) throw new Error('no picture');
  return c;
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

const st = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
/** Reach a command on the ribbon as a person does, and click it. */
async function pick(p: Page, id: string): Promise<void> {
  await show(p, id);
  await p.click(`[data-testid="ri-${id}"]`);
  await p.waitForTimeout(120);
}
interface MoreState { turn: number; quad: { x: number; y: number }[] | null; }
const more = (p: Page): Promise<MoreState> => p.evaluate(() => ((window as unknown as Win).fpe.state().w3 as { more: MoreState }).more);
const px = (p: Page, x: number, y: number): Promise<number[] | null> => p.evaluate(([a, b]) => (window as unknown as Win).fpe.sample(a, b), [x, y] as const);
const span = async (p: Page, W: number): Promise<number> => { const a = await at(p, 0, 0), b = await at(p, W, 0); return Math.hypot(b.x - a.x, b.y - a.y); };

const suite = CHROME ? describe : describe.skip;
suite('Batch tools (headless Chrome)', () => {
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

  it('turns the view by dragging, keeps every pointer on its picture pixel, and puts it level again at 1440', async () => {
    const p = await open(1440, 900);
    await sample(p);
    const { width: W, height: H } = await info(p);
    const before = await px(p, Math.round(W * 0.3), Math.round(H * 0.6));
    await pick(p, 'tool.rotate-view');
    expect((await st(p)).tool).toBe('turn');
    // Drag a twelfth of a turn (30°) round the middle of the picture area.
    const c = await p.evaluate(() => { const r = (document.querySelector('[data-testid="canvas"]') as HTMLElement).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(c.x + 200, c.y);
    await p.mouse.down();
    for (let k = 1; k <= 12; k++) { const a = (k / 12) * (Math.PI / 6); await p.mouse.move(c.x + 200 * Math.cos(a), c.y + 200 * Math.sin(a)); }
    await p.mouse.up();
    await p.waitForTimeout(150);
    const t = (await more(p)).turn;
    expect(Math.abs(t - 30), String(t)).toBeLessThan(1.5);
    expect(await p.textContent('[data-testid="turn-readout"]')).toMatch(/^Turned \d+(\.\d)?°$/);
    await shot(p, 'tools-turn.png');
    // Only the view turned: the picture's pixels are the same.
    expect(await px(p, Math.round(W * 0.3), Math.round(H * 0.6))).toEqual(before);

    // A box selection dragged between two picture points while the view is turned lands on those picture points.
    await pick(p, 'tool.select-rect');
    await drag(p, [[W * 0.2, H * 0.25], [W * 0.4, H * 0.4], [W * 0.5, H * 0.65]]);
    const s = (await info(p)).selection;
    expect(s && near(s, W * 0.2, H * 0.25, 3) && Math.abs(s.w - W * 0.3) <= 4 && Math.abs(s.h - H * 0.4) <= 4, JSON.stringify(s)).toBe(true);

    // The wheel zooms in about the picture point under the pointer, turned or not.
    const a = await at(p, W * 0.6, H * 0.4), z0 = await span(p, W);
    await p.mouse.move(a.x, a.y);
    await p.mouse.wheel(0, -100);
    await p.waitForTimeout(200);
    expect(await span(p, W)).toBeGreaterThan(z0 * 1.05);
    const a2 = await at(p, W * 0.6, H * 0.4);
    expect(near(a2, a.x, a.y, 2), JSON.stringify([a, a2])).toBe(true);

    // One click puts it level; the 15° button turns it; Esc puts it level again.
    await pick(p, 'tool.rotate-view');
    await p.click('[data-testid="turn-reset"]');
    expect((await more(p)).turn).toBe(0);
    await p.click('[data-testid="turn-right"]');
    expect((await more(p)).turn).toBe(15);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(80);
    expect((await more(p)).turn).toBe(0);
    expect(errors).toEqual([]);
  });

  it('straightens a slanted area from four dragged corners, and one undo puts it back, at 1440', async () => {
    const p = await open(1440, 900);
    await sample(p);
    const { width: W, height: H } = await info(p);
    await pick(p, 'tool.crop-perspective');
    expect((await st(p)).tool).toBe('crop-quad');
    let q = (await more(p)).quad ?? [];
    expect(q).toHaveLength(4);
    expect(near(q[0], W * 0.1, H * 0.1, 1), JSON.stringify(q)).toBe(true);
    // Pull the two top corners inwards and down: a trapezoid, as a slanted sign looks.
    await drag(p, [[q[0].x, q[0].y], [W * 0.2, H * 0.15], [W * 0.25, H * 0.2]]);
    await drag(p, [[q[1].x, q[1].y], [W * 0.8, H * 0.15], [W * 0.75, H * 0.2]]);
    q = (await more(p)).quad ?? [];
    expect(near(q[0], W * 0.25, H * 0.2, 3) && near(q[1], W * 0.75, H * 0.2, 3), JSON.stringify(q)).toBe(true);
    await shot(p, 'tools-perspective-crop.png');
    const d = (i: number, j: number): number => Math.hypot(q[j].x - q[i].x, q[j].y - q[i].y);
    const want = { w: Math.round(Math.max(d(0, 1), d(3, 2))), h: Math.round(Math.max(d(0, 3), d(1, 2))) };
    await p.click('[data-testid="quad-apply"]');
    await p.waitForFunction((w) => (window as unknown as Win).fpe.getInfo()?.width !== w, W, { timeout: 15000 });
    const after = await info(p);
    expect(Math.abs(after.width - want.w) <= 1 && Math.abs(after.height - want.h) <= 1, JSON.stringify([after.width, after.height, want])).toBe(true);
    await shot(p, 'tools-perspective-done.png');
    await run(p, 'edit.undo');
    await p.waitForTimeout(150);
    const back = await info(p);
    expect([back.width, back.height]).toEqual([W, H]);
    // Enter does the same as the button, as its help line says (the corners start again at the 10% inset).
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await p.keyboard.press('Enter');
    await p.waitForFunction((w) => (window as unknown as Win).fpe.getInfo()?.width !== w, W, { timeout: 15000 });
    expect((await info(p)).width).toBe(Math.round(W * 0.8));
    expect(errors).toEqual([]);
  });
  it('traces a loose drag onto the edges of a black box on white, at 1440', async () => {
    const p = await open(1440, 900);
    // A built picture, not the sample: white, with a black box from (250, 150) to (550, 350).
    await p.evaluate(async () => {
      const f = (window as unknown as Win).fpe;
      f.newDocument(800, 500, '#ffffff');
      await f.run('tool.default-colors');
      f.select(250, 150, 300, 200);
      await f.run('edit.fill');
      await f.run('select.none');
    });
    expect(await px(p, 400, 250)).toEqual([0, 0, 0, 255]);
    await pick(p, 'tool.lasso-magnetic');
    expect((await st(p)).tool).toBe('lasso-edge');
    // Round the box by hand, 5 to 6 px outside it all the way, and let go near the start.
    await drag(p, [[244, 160], [245, 145], [400, 144], [556, 145], [556, 250], [555, 356], [400, 355], [245, 356], [244, 250], [245, 170]], 10);
    const s = (await info(p)).selection;
    expect(s && near(s, 250, 150, 2) && Math.abs(s.x + s.w - 550) <= 2 && Math.abs(s.y + s.h - 350) <= 2, JSON.stringify(s)).toBe(true);
    await shot(p, 'tools-edge-lasso.png');
    expect(errors).toEqual([]);
  });
});
