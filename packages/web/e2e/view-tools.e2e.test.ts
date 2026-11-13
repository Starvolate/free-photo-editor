// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Batch view-tools in a real headless Chrome, used as a person uses them: each new function runs once from the ribbon with
 * real clicks, and the picture or the state must change. Oval, row and column selections, Measure, colour markers, sticky
 * notes, guide lines (drag, lock, clear), snapping, the pixel grid, print size, composition guides and Select the sharp
 * parts at 1440; one row selection by touch on a phone at 390. Screenshots go to e2e/out (view-*.png).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts view-tools
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

interface ViewState { guides: number; lines: string[]; lock: boolean; snap: boolean; pixelGrid: boolean; comp: number; markers: string[]; notes: string[];
  ruler: { length: number; angle: number } | null; }
const vs = (p: Page): Promise<ViewState> => p.evaluate(() => ((window as unknown as Win).fpe.state().w3 as { view: ViewState }).view);
const st = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
/** Reach a command on the ribbon as a person does, and click it. */
async function pick(p: Page, id: string): Promise<void> {
  await show(p, id);
  await p.click(`[data-testid="ri-${id}"]`);
  await p.waitForTimeout(120);
}
/** The picture as it shows inside the canvas (never the ribbon, whose buttons change when pressed), to see what an overlay draws. */
async function area(p: Page): Promise<Buffer> {
  const i = await info(p), a = await at(p, 0, 0), b = await at(p, i.width, i.height);
  const c = await p.evaluate(() => { const r = (document.querySelector('[data-testid="canvas"]') as HTMLElement).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const x0 = Math.ceil(Math.max(a.x, c.l)), y0 = Math.ceil(Math.max(a.y, c.t)), x1 = Math.floor(Math.min(b.x, c.r)), y1 = Math.floor(Math.min(b.y, c.b));
  if (x1 - x0 < 20 || y1 - y0 < 20) throw new Error(`the picture is not on screen: ${JSON.stringify({ a, b, c })}`);
  return p.screenshot({ clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
}
/** A one-pixel row or column selection: its length exactly, its place within `tol` pixels (a click lands on a whole screen pixel). */
function line(s: Sel | null, want: Sel, tol: number): void {
  expect(s && s.w === want.w && s.h === want.h && near(s, want.x, want.y, tol), JSON.stringify(s)).toBe(true);
}

const suite = CHROME ? describe : describe.skip;
suite('View tools, guides and the small tools (headless Chrome)', () => {
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

  it('runs each new selection and measuring tool with the mouse at 1440', async () => {
    const p = await open(1440, 900);
    await sample(p);
    const { width: W, height: H } = await info(p);

    await pick(p, 'tool.select-ellipse');
    expect((await st(p)).tool).toBe('select-ellipse');
    await drag(p, [[W * 0.2, H * 0.2], [W * 0.5, H * 0.4], [W * 0.6, H * 0.7]]);
    const oval = (await info(p)).selection;
    expect(oval && Math.abs(oval.w - W * 0.4) < 6 && Math.abs(oval.h - H * 0.5) < 6, JSON.stringify(oval)).toBe(true);
    expect((await st(p)).w3).toMatchObject({ shaped: true });
    await shot(p, 'view-oval.png');

    await pick(p, 'tool.select-row');
    await click(p, W / 2, 40.5);
    line((await info(p)).selection, { x: 0, y: 40, w: W, h: 1 }, 2);
    await pick(p, 'tool.select-column');
    await click(p, 30.5, H / 2);
    line((await info(p)).selection, { x: 30, y: 0, w: 1, h: H }, 2);

    await pick(p, 'tool.ruler');
    await drag(p, [[100, 100], [250, 300], [400, 500]]);
    const r = (await vs(p)).ruler;
    expect(r && Math.abs(r.length - 500) < 3 && Math.abs(r.angle + 53.13) < 1, JSON.stringify(r)).toBe(true);
    expect(await p.textContent('[data-testid="ruler-readout"]')).toMatch(/^Length \d+\.\d px · Angle -?\d+\.\d°/);

    await pick(p, 'tool.color-sampler');
    await click(p, W * 0.3, H * 0.3);
    await click(p, W * 0.7, H * 0.8);
    expect((await vs(p)).markers).toHaveLength(2);
    for (const m of (await vs(p)).markers) expect(m).toMatch(/^#[0-9a-f]{6}$/);
    expect(await p.textContent('[data-testid="sampler-values"]')).toMatch(/^1: R \d+ G \d+ B \d+ · #/);
    await shot(p, 'view-markers.png');

    await pick(p, 'tool.note');
    await click(p, W * 0.4, H * 0.5);
    await p.waitForSelector('[data-testid="note-text"]', { state: 'visible' });
    await p.fill('[data-testid="note-text"]', 'Brighten the sky here');
    await p.click('[data-testid="note-save"]');
    await p.waitForTimeout(100);
    expect((await vs(p)).notes).toEqual(['Brighten the sky here']);
    await click(p, W * 0.4, H * 0.5);
    await p.waitForSelector('[data-testid="note-remove"]', { state: 'visible' });
    expect(await p.inputValue('[data-testid="note-text"]')).toBe('Brighten the sky here');
    await p.click('[data-testid="note-remove"]');
    await p.waitForTimeout(100);
    expect((await vs(p)).notes).toEqual([]);

    // Start from no selection, so the check sees the sharp parts and not the column picked above.
    await run(p, 'select.none');
    expect((await info(p)).selection).toBeNull();
    await pick(p, 'select.focus');
    await p.waitForFunction(() => ((window as unknown as Win).fpe.getInfo()?.selection ?? null) !== null);
    expect((await st(p)).w3).toMatchObject({ shaped: true });
  }, 120_000);

  it('adds, drags, locks and clears guide lines, snaps to them, and turns on the pixel grid, print size and composition guides', async () => {
    const p = await open(1440, 900);
    await sample(p);
    const { width: W, height: H } = await info(p);

    await pick(p, 'view.guide-new');
    expect((await vs(p)).lines).toEqual([`v${Math.round(W / 2)}`]);
    await p.evaluate(() => (window as unknown as Win).fpe.run('tool.move'));
    const x0 = (await info(p)).layers[0].x;
    await drag(p, [[W / 2, H / 2], [W / 2 + 60, H / 2], [W / 2 + 120, H / 2]]);
    const moved = Number((await vs(p)).lines[0].slice(1));
    expect(Math.abs(moved - (W / 2 + 120)) < 4, String(moved)).toBe(true);
    expect((await info(p)).layers[0].x).toBe(x0);

    await pick(p, 'view.guide-lock');
    expect((await vs(p)).lock).toBe(true);
    await drag(p, [[moved, H / 3], [moved + 80, H / 3]]);
    expect((await vs(p)).lines).toEqual([`v${moved}`]);

    await pick(p, 'view.snap');
    expect((await vs(p)).snap).toBe(true);
    await pick(p, 'tool.ruler');
    await drag(p, [[moved + 2, 200], [moved + 1, 300], [moved + 2, 400]]);
    const r = (await vs(p)).ruler;
    expect(r && Math.abs(Math.abs(r.angle) - 90) < 1e-6, JSON.stringify(r)).toBe(true);

    await pick(p, 'view.guide-clear');
    expect((await vs(p)).guides).toBe(0);

    await p.evaluate(() => (window as unknown as Win).fpe.setZoom(12));
    await p.waitForTimeout(100);
    const before = await area(p);
    await pick(p, 'view.pixel-grid');
    expect((await vs(p)).pixelGrid).toBe(true);
    await p.waitForTimeout(100);
    expect((await area(p)).equals(before), 'the pixel grid drew nothing').toBe(false);
    await shot(p, 'view-pixel-grid.png');

    const zoom = ((await st(p)).view as { zoom: number }).zoom;
    await pick(p, 'view.print-size');
    const z = ((await st(p)).view as { zoom: number }).zoom;
    expect(z).not.toBe(zoom);
    expect(Math.abs(96 / z - Math.round(96 / z)) < 0.01, String(z)).toBe(true);

    await run(p, 'view.fit');
    await p.waitForTimeout(100);
    const plain = await area(p);
    await pick(p, 'view.composition-guides');
    expect((await vs(p)).comp).toBe(1);
    await p.waitForTimeout(100);
    expect((await area(p)).equals(plain), 'the thirds drew nothing').toBe(false);
    await shot(p, 'view-thirds.png');
    expect(errors).toEqual([]);
  }, 120_000);

  it('selects one row by touch on a phone at 390', async () => {
    const p = await open(390, 844, true);
    await sample(p);
    const { width: W } = await info(p);
    await run(p, 'tool.select-row');
    const c = await at(p, W / 2, 60.5);
    await p.touchscreen.tap(c.x, c.y);
    await p.waitForTimeout(150);
    line((await info(p)).selection, { x: 0, y: 60, w: W, h: 1 }, 5);
    await shot(p, 'view-row-phone.png');
  }, 60_000);
});
