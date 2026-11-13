// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * W6 S1 layer masks in a real headless Chrome (design 7, S1 "Browser"), each proven by its result:
 * - a mask painted black hides the pixels under it and keeps them in the layer; undo and redo bring back the exact picture;
 * - switching the mask off shows the pixels again;
 * - with the link off, moving the layer leaves the mask in place;
 * - Make the mask permanent bakes it in without changing the picture;
 * - the paint bucket, the colour fade and Fill from the surroundings refuse while the mask is the target;
 * - the shared fixture (packages/cli/test/fixtures/w6-layers.psd) flattens to its golden hash, and after a reload Restore
 *   brings its masks back intact;
 * - on a phone the mask controls are 44 px targets, and a long press on a layer opens its actions.
 * Screenshots go to e2e/out (w6-s1-*.png).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts layers
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface MaskInfo { x: number; y: number; w: number; h: number; outside: number; enabled: boolean; linked: boolean; density: number; feather: number; sum: number; }
interface LayerState { id: string; x: number; y: number; w: number; h: number; mask: MaskInfo | null; }
interface State { maskTarget: boolean; layers: LayerState[]; modal: string | null; w3: unknown; }
interface Fpe {
  run(id: string): Promise<boolean>; aiCmd(id: string): Promise<void>; state(): State; flatHash(): Promise<string>;
  newDocument(w: number, h: number, bg?: string | null): void; select(x: number, y: number, w: number, h: number): void;
  sample(x: number, y: number, only?: boolean): number[] | null; toClient(x: number, y: number): { x: number; y: number } | null;
  openFile(b: Blob, name?: string): Promise<void>; saveNow(): Promise<void>;
}
type Win = Window & { fpe: Fpe };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const FIXTURE = join(WEB, '..', 'cli', 'test', 'fixtures', 'w6-layers');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const WHITE = [255, 255, 255, 255], BLACK = [0, 0, 0, 255];

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
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: touch });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}px: ${e.message}`));
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const state = (p: Page): Promise<State> => p.evaluate(() => (window as unknown as Win).fpe.state());
const hash = (p: Page): Promise<string> => p.evaluate(() => (window as unknown as Win).fpe.flatHash());
const top = (s: State): LayerState => s.layers[s.layers.length - 1];
const px = (p: Page, x: number, y: number, only = false): Promise<number[]> =>
  p.evaluate(([a, b, o]) => (window as unknown as Win).fpe.sample(a as number, b as number, o as boolean) ?? [], [x, y, only] as const);
const select = (p: Page, x: number, y: number, w: number, h: number): Promise<void> =>
  p.evaluate(([a, b, c, d]) => (window as unknown as Win).fpe.select(a, b, c, d), [x, y, w, h] as const);
const toast = async (p: Page): Promise<string> => (await p.textContent('[data-testid="toast"]')) ?? '';
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
/** A white picture with a black box (20,20 to 100,60) on a second layer, which gets a mask; the mask is then the target. */
async function masked(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as Win).fpe.newDocument(120, 80, '#ffffff'));
  expect(await run(p, 'layer.new')).toBe(true);
  expect(await run(p, 'tool.default-colors')).toBe(true);
  await select(p, 20, 20, 80, 40);
  expect(await run(p, 'edit.fill')).toBe(true);
  expect(await run(p, 'select.none')).toBe(true);
  expect(await run(p, 'layer.mask-add')).toBe(true);
  expect((await state(p)).maskTarget).toBe(true);
}
/** Fill the area (50,30 to 80,50) of the target with the main colour (black), then select nothing. */
async function fillBlack(p: Page): Promise<void> {
  await select(p, 50, 30, 30, 20);
  expect(await run(p, 'edit.fill')).toBe(true);
  expect(await run(p, 'select.none')).toBe(true);
}

const suite = CHROME ? describe : describe.skip;
suite('W6 S1 layer masks in headless Chrome', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  let p: Page;
  it('paints the mask black: the picture loses what it hides, the layer keeps its pixels, and undo and redo are exact', async () => {
    p = await open(1440, 900);
    await masked(p);
    expect(top(await state(p)).mask).toMatchObject({ enabled: true, linked: true });
    expect(await px(p, 60, 40)).toEqual(BLACK);
    const h0 = await hash(p), s0 = top(await state(p)).mask?.sum;
    await fillBlack(p);
    expect(await px(p, 60, 40)).toEqual(WHITE);
    expect(await px(p, 60, 40, true)).toEqual(BLACK);
    expect(await px(p, 30, 40)).toEqual(BLACK);
    const h1 = await hash(p);
    expect(h1).not.toBe(h0);
    // The brush paints on the mask live, too.
    expect(await run(p, 'tool.brush')).toBe(true);
    await drag(p, [[26, 26], [44, 26]]);
    expect((await px(p, 35, 26))[0]).toBeGreaterThan(100);
    expect(await px(p, 35, 26, true)).toEqual(BLACK);
    const h2 = await hash(p), s2 = top(await state(p)).mask?.sum;
    await p.screenshot({ path: join(OUT, 'w6-s1-mask-painted-1440.png') });
    const seen: string[] = [];
    for (let i = 0; i < 6 && (await hash(p)) !== h0; i++) { expect(await run(p, 'edit.undo')).toBe(true); seen.push(await hash(p)); }
    expect(await hash(p)).toBe(h0);
    expect(top(await state(p)).mask?.sum).toBe(s0);
    expect(seen).toContain(h1);
    for (let i = 0; i < seen.length; i++) expect(await run(p, 'edit.redo')).toBe(true);
    expect(await hash(p)).toBe(h2);
    expect(top(await state(p)).mask?.sum).toBe(s2);
    expect(errors).toEqual([]);
  });

  it('switching the mask off shows the pixels again, and on hides them', async () => {
    expect(await run(p, 'layer.mask-toggle')).toBe(true);
    expect(top(await state(p)).mask?.enabled).toBe(false);
    expect(await px(p, 60, 40)).toEqual(BLACK);
    expect(await run(p, 'layer.mask-toggle')).toBe(true);
    expect(top(await state(p)).mask?.enabled).toBe(true);
    expect(await px(p, 60, 40)).toEqual(WHITE);
  });

  it('with the link off, moving the layer leaves the mask in place', async () => {
    expect(await run(p, 'layer.mask-link')).toBe(true);
    const before = top(await state(p));
    expect(before.mask?.linked).toBe(false);
    expect(await run(p, 'tool.move')).toBe(true);
    await drag(p, [[30, 40], [40, 40]]);
    const after = top(await state(p));
    expect(after.x).toBeGreaterThan(before.x + 4);
    expect(after.mask).toEqual(before.mask);
    // The hole stays put while the black box moves right.
    expect(await px(p, 60, 40)).toEqual(WHITE);
    expect(await px(p, 22, 40)).toEqual(WHITE);
    await p.screenshot({ path: join(OUT, 'w6-s1-unlinked-move-1440.png') });
  });

  it('Make the mask permanent bakes it in without changing the picture, and undo brings the mask back', async () => {
    const q = await open(1440, 900);
    await masked(q);
    await fillBlack(q);
    const h = await hash(q);
    expect(await run(q, 'layer.mask-apply')).toBe(true);
    expect(top(await state(q)).mask).toBeNull();
    expect(await hash(q)).toBe(h);
    expect((await px(q, 60, 40, true))[3]).toBe(0);
    expect(await px(q, 30, 40, true)).toEqual(BLACK);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect(top(await state(q)).mask).not.toBeNull();
    expect(await hash(q)).toBe(h);
    p = q;
  });

  it('the paint bucket, the colour fade and Fill from the surroundings refuse while the mask is the target', async () => {
    await p.click('[data-testid="layer-mask"]');
    expect((await state(p)).maskTarget).toBe(true);
    const h = await hash(p);
    expect(await run(p, 'tool.bucket')).toBe(true);
    await click(p, 30, 40);
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
    await click(p, 30, 40);
    expect(await toast(p)).toContain('You are editing the mask');
    expect(await hash(p)).toBe(h);
    expect(await run(p, 'tool.gradient')).toBe(true);
    await drag(p, [[25, 25], [95, 55]]);
    expect(await hash(p)).toBe(h);
    await select(p, 25, 25, 10, 10);
    await p.evaluate(() => (window as unknown as Win).fpe.aiCmd('edit.smart-fill'));
    expect(await toast(p)).toContain('You are editing the mask');
    expect(await hash(p)).toBe(h);
    await p.screenshot({ path: join(OUT, 'w6-s1-mask-target-1440.png') });
    expect(errors).toEqual([]);
  });

  it('the shared fixture flattens to its golden hash, and Restore after a reload brings its masks back intact', async () => {
    const gold = (await readFile(FIXTURE + '.flat.sha256', 'utf8')).trim(), b64 = (await readFile(FIXTURE + '.psd')).toString('base64');
    const q = await open(1440, 900);
    await q.evaluate(async (s) => {
      const bin = atob(s), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      await (window as unknown as Win).fpe.openFile(new Blob([u]), 'w6-layers.psd');
    }, b64);
    await q.waitForFunction(() => (window as unknown as Win).fpe.state().layers.length === 4, null, { timeout: 15_000 });
    expect(await hash(q)).toBe(gold);
    const shape = (s: State) => s.layers.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, mask: l.mask }));
    expect((await state(q)).layers.map((l) => !!l.mask)).toEqual([false, true, true, true]);
    // A PSD keeps every mask linked; the safety copy keeps an unlinked one as it is. The top row is the "Note" layer.
    await q.locator('[data-testid="layer-row"]').first().locator('[data-testid="layer-select"]').click();
    expect(await run(q, 'layer.mask-link')).toBe(true);
    const want = shape(await state(q)), h = await hash(q);
    expect(want[3].mask?.linked).toBe(false);
    await q.evaluate(() => (window as unknown as Win).fpe.saveNow());
    await q.screenshot({ path: join(OUT, 'w6-s1-fixture-1440.png') });
    await q.reload();
    await q.waitForFunction(() => !!(window as unknown as Win).fpe);
    await q.waitForSelector('[data-testid="restore"]:not([hidden])', { timeout: 15_000 });
    await q.click('[data-testid="restore-yes"]');
    await q.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent?.includes('Brought back'), null, { timeout: 15_000 });
    expect(shape(await state(q))).toEqual(want);
    expect(await hash(q)).toBe(h);
    expect(errors).toEqual([]);
  });

  it('on a phone the mask controls are 44 px targets, and a long press on a layer opens its actions', async () => {
    const q = await open(390, 844, true);
    await masked(q);
    await q.tap('[data-testid="btn-layers"]');
    await q.waitForSelector('[data-testid="dock"][data-state="half"]');
    for (const sel of ['mask-link', 'layer-mask', 'layer-pixels']) {
      const b = await q.locator(`[data-testid="${sel}"]`).first().boundingBox();
      expect(b, sel).not.toBeNull();
      expect(Math.min(b?.width ?? 0, b?.height ?? 0), sel).toBeGreaterThanOrEqual(44);
    }
    await q.screenshot({ path: join(OUT, 'w6-s1-phone-390-layers.png') });
    const name = await q.locator('[data-testid="layer-row"]').first().locator('[data-testid="layer-select"]').boundingBox();
    if (!name) throw new Error('no layer row');
    const x = name.x + name.width / 2, y = name.y + name.height / 2;
    // The rows sit at the top of the half-open sheet, so a thumb reaches the first one without scrolling.
    expect(await q.evaluate(([a, b]) => !!document.elementFromPoint(a, b)?.closest('[data-testid="layer-select"]'), [x, y] as const)).toBe(true);
    // A real touch held for 0.7 s (the press opens the sheet at 0.48 s).
    const cdp = await q.context().newCDPSession(q);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await q.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await q.waitForSelector('[data-testid="sheet-layer-actions"][data-state="open"]');
    const sheet = q.locator('[data-testid="sheet-layer-actions"]');
    expect(await sheet.textContent()).toContain('Switch the mask off');
    expect(await sheet.locator('.fpe-tag').count()).toBeGreaterThan(0);
    await q.waitForTimeout(250);
    await q.screenshot({ path: join(OUT, 'w6-s1-phone-390-layer-actions.png') });
    await q.tap('[data-testid="layer-action-mask-toggle"]');
    expect(top(await state(q)).mask?.enabled).toBe(false);
    expect(errors).toEqual([]);
  });
});
