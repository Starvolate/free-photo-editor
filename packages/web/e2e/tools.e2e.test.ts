// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The W3 tools in a real headless Chrome, used the way a person uses them: with the mouse on the sample photo (and touch on
 * a phone for the lasso, the clone stamp and text). Each tool must change the expected pixels, selection or layers, and undo
 * must bring the picture back. Screenshots go to e2e/out (w3-*.png).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts tools
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Sel { x: number; y: number; w: number; h: number; }
interface Info { width: number; height: number; active: number; selection: Sel | null; layers: { name: string; x: number; y: number; width: number; height: number }[]; }
interface W3 { quickMask: boolean; transform: string | null; editingText: boolean; source: boolean; savedSel: boolean; shaped: boolean; selected: number; content: string | null; }
interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; select(x: number, y: number, w: number, h: number): void;
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
/** Open the sample photo and wait until the W3 tools have loaded. */
async function sample(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
  await p.waitForTimeout(150);
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const info = (p: Page): Promise<Info> => p.evaluate(() => (window as unknown as Win).fpe.getInfo() as Info);
const w3 = (p: Page): Promise<W3> => p.evaluate(() => (window as unknown as Win).fpe.state().w3 as W3);
const px = (p: Page, x: number, y: number, only = false): Promise<number[]> =>
  p.evaluate(([a, b, o]) => (window as unknown as Win).fpe.sample(a as number, b as number, o as boolean) ?? [], [x, y, only] as const);
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
async function setRange(p: Page, testid: string, v: number): Promise<void> {
  await p.$eval(`[data-testid="${testid}"]`, (el, val) => { const i = el as HTMLInputElement; i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
}
async function useBackground(p: Page): Promise<void> {
  await p.locator('[data-testid="layer-row"]').last().click();
  await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.active === 0);
}
const near = (a: number[], b: number[], tol: number): boolean => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const sat = (c: number[]): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
const lum = (c: number[]): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: join(OUT, name) });

const suite = CHROME ? describe : describe.skip;
suite('W3 tools (headless Chrome)', () => {
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

  it('selects with the lasso, the polygonal lasso, the magic wand and quick select, and undo drops the selection', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await run(p, 'tool.lasso');
    await drag(p, [[100, 100], [300, 100], [200, 250], [100, 100]]);
    let s = (await info(p)).selection as Sel;
    expect(Math.abs(s.x - 100) + Math.abs(s.y - 100) + Math.abs(s.w - 200) + Math.abs(s.h - 150)).toBeLessThan(10);
    expect((await w3(p)).shaped).toBe(true);
    await shot(p, 'w3-lasso.png');
    await run(p, 'edit.undo');
    expect((await info(p)).selection).toBeNull();
    await run(p, 'tool.lasso-poly');
    for (const [x, y] of [[400, 100], [600, 100], [500, 250]] as [number, number][]) { await click(p, x, y); await p.waitForTimeout(400); }
    await click(p, 400, 100);
    s = (await info(p)).selection as Sel;
    expect(Math.abs(s.x - 400) + Math.abs(s.w - 200) + Math.abs(s.h - 150)).toBeLessThan(10);
    await run(p, 'select.none');
    await useBackground(p);
    await run(p, 'tool.magic-wand');
    await p.click('[data-testid="w3-all-off"]');
    await click(p, 5, 320);
    const frame = (await w3(p)).selected;
    expect(Math.abs(frame - 50176)).toBeLessThan(1200);
    expect((await w3(p)).shaped).toBe(true);
    await shot(p, 'w3-wand.png');
    await run(p, 'select.none');
    await run(p, 'tool.quick-select');
    await drag(p, [[200, 560], [400, 560]]);
    const q = await info(p);
    expect((await w3(p)).selected).toBeGreaterThan(3000);
    expect((q.selection as Sel).y).toBeGreaterThan(330);
    expect(errors).toEqual([]);
  }, 120_000);

  it('changes the selection from the Select menu: expand, contract, feather, border, smooth, grow, similar, colour range, transform, quick mask, save and load', async () => {
    const p = await open(1440, 900);
    await sample(p);
    const amount = async (id: string, v: number): Promise<void> => {
      expect(await run(p, id)).toBe(true);
      await p.waitForSelector('[data-testid="w3-amount"]');
      await setRange(p, 'w3-amount', v);
      await p.click('[data-testid="sheet-w3-amount"] [data-testid="w3-apply"]');
      await p.waitForTimeout(120);
    };
    await p.evaluate(() => (window as unknown as Win).fpe.select(100, 100, 100, 100));
    await amount('select.expand', 10);
    expect((await info(p)).selection).toEqual({ x: 90, y: 90, w: 120, h: 120 });
    await amount('select.contract', 10);
    expect((await info(p)).selection).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    await amount('select.feather', 8);
    expect((await w3(p)).shaped).toBe(true);
    expect(((await info(p)).selection as Sel).w).toBeGreaterThan(100);
    await amount('select.border', 10);
    expect((await w3(p)).selected).toBeGreaterThan(2000);
    await p.evaluate(() => (window as unknown as Win).fpe.select(300, 40, 20, 20));
    await run(p, 'select.grow');
    const grown = (await w3(p)).selected;
    expect(grown).toBeGreaterThan(400);
    await run(p, 'select.similar');
    expect((await w3(p)).selected).toBeGreaterThanOrEqual(grown);
    await run(p, 'select.color-range');
    await p.$eval('[data-testid="w3-range-color"]', (el) => { const i = el as HTMLInputElement; i.value = '#486aa6'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.click('[data-testid="sheet-w3-range"] [data-testid="w3-apply"]');
    await p.waitForTimeout(150);
    expect((await w3(p)).selected).toBeGreaterThan(1000);
    await p.evaluate(() => (window as unknown as Win).fpe.select(100, 100, 100, 100));
    await run(p, 'select.transform');
    expect((await w3(p)).transform).toBe('free:selection');
    await drag(p, [[200, 200], [300, 300]]);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    const t = (await info(p)).selection as Sel;
    expect(Math.abs(t.w - 200) + Math.abs(t.h - 200)).toBeLessThan(8);
    await run(p, 'select.none');
    await run(p, 'select.quick-mask');
    expect((await w3(p)).quickMask).toBe(true);
    await drag(p, [[500, 400], [650, 400]]);
    await run(p, 'select.quick-mask');
    const m = (await info(p)).selection as Sel;
    expect(m.y).toBeLessThan(400);
    expect(m.y + m.h).toBeGreaterThan(400);
    await p.evaluate(() => (window as unknown as Win).fpe.select(10, 10, 50, 50));
    await run(p, 'select.save');
    await run(p, 'select.none');
    await run(p, 'select.load');
    expect((await info(p)).selection).toEqual({ x: 10, y: 10, w: 50, h: 50 });
    expect(errors).toEqual([]);
  }, 120_000);

  it('resizes and turns a layer with free transform handles, picks layers by clicking and lines them up', async () => {
    const p = await open(1440, 900);
    await sample(p);
    expect((await info(p)).layers[1].width).toBe(180);
    await run(p, 'edit.free-transform');
    expect((await w3(p)).transform).toBe('free:layer');
    await shot(p, 'w3-transform-handles.png');
    await drag(p, [[840, 180], [740, 180]]);
    await p.click('[data-testid="xf-apply"]');
    await p.waitForTimeout(150);
    let sun = (await info(p)).layers[1];
    expect(Math.abs(sun.width - 280)).toBeLessThan(4);
    await run(p, 'edit.undo');
    expect((await info(p)).layers[1].width).toBe(180);
    await run(p, 'edit.rotate');
    await drag(p, [[700, 180], [700, 300]]);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    sun = (await info(p)).layers[1];
    expect(sun.width).toBeGreaterThan(195);
    await run(p, 'edit.undo');
    await p.evaluate(() => (window as unknown as Win).fpe.select(100, 100, 300, 300));
    await run(p, 'layer.align-left');
    expect((await info(p)).layers[1].x).toBe(100);
    await run(p, 'select.none');
    await run(p, 'tool.move');
    await p.click('[data-testid="move-autopick"]');
    await drag(p, [[100, 500], [110, 500]]);
    const after = await info(p);
    expect(after.active).toBe(0);
    expect(after.layers[0].x).toBe(10);
    expect(errors).toEqual([]);
  }, 120_000);

  it('fills: colour fade, paint bucket, outline, magic eraser, colour replacement and the history brush', async () => {
    const p = await open(1440, 900);
    await p.evaluate(() => (window as unknown as Win).fpe.newDocument(400, 200, '#ffffff'));
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
    await run(p, 'tool.default-colors');
    await run(p, 'tool.gradient');
    await drag(p, [[0, 100], [400, 100]]);
    expect((await px(p, 5, 100))[0]).toBeLessThan(20);
    expect((await px(p, 395, 100))[0]).toBeGreaterThan(235);
    expect(Math.abs((await px(p, 200, 100))[0] - 128)).toBeLessThan(20);
    await shot(p, 'w3-gradient.png');
    await run(p, 'edit.undo');
    expect(await px(p, 5, 100)).toEqual([255, 255, 255, 255]);

    const q = await open(1440, 900);
    await sample(q);
    await useBackground(q);
    const fg = [228, 87, 46];
    await run(q, 'tool.bucket');
    await click(q, 5, 320);
    expect(near(await px(q, 5, 320), fg, 3)).toBe(true);
    expect(near(await px(q, 480, 320), [250, 250, 248], 3)).toBe(false);
    await q.evaluate(() => (window as unknown as Win).fpe.select(100, 100, 100, 100));
    await run(q, 'edit.stroke');
    await q.click('[data-testid="sheet-w3-stroke"] [data-testid="w3-apply"]');
    await q.waitForTimeout(150);
    expect(near(await px(q, 100, 150), fg, 6)).toBe(true);
    expect(near(await px(q, 150, 150), fg, 6)).toBe(false);
    await run(q, 'select.none');
    await run(q, 'tool.magic-eraser');
    await click(q, 480, 40);
    expect((await px(q, 480, 40))[3]).toBe(0);
    const sky = await px(q, 320, 200);
    expect(sky[2]).toBeGreaterThan(sky[0]);
    await run(q, 'tool.color-replace');
    await drag(q, [[300, 200], [340, 200]]);
    const re = await px(q, 320, 200);
    expect(re[0]).toBeGreaterThan(re[2]);
    const before = await px(q, 620, 250);
    await run(q, 'tool.brush');
    await drag(q, [[600, 250], [640, 250]]);
    expect(near(await px(q, 620, 250), before, 10)).toBe(false);
    await run(q, 'tool.history-brush');
    await drag(q, [[590, 250], [650, 250]]);
    expect(near(await px(q, 620, 250), before, 12)).toBe(true);
    expect(errors).toEqual([]);
  }, 120_000);

  it('retouches: clone stamp, spot healing, healing brush, patch, red eye, dodge, burn, sponge, blur, sharpen and smudge', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await useBackground(p);
    const src = await px(p, 303, 60);
    await run(p, 'tool.clone');
    await p.keyboard.down('Alt');
    await click(p, 300, 60);
    await p.keyboard.up('Alt');
    expect((await w3(p)).source).toBe(true);
    const lake = await px(p, 303, 500);
    await drag(p, [[300, 500], [306, 500]]);
    expect(near(await px(p, 303, 500), src, 14)).toBe(true);
    await shot(p, 'w3-clone.png');
    await run(p, 'edit.undo');
    expect(near(await px(p, 303, 500), lake, 1)).toBe(true);

    const clean = await px(p, 200, 150);
    await run(p, 'tool.brush');
    await click(p, 200, 150);
    expect(near(await px(p, 200, 150), clean, 20)).toBe(false);
    await shot(p, 'w3-spot-before.png');
    await run(p, 'tool.spot-heal');
    await click(p, 200, 150);
    expect(near(await px(p, 200, 150), clean, 30)).toBe(true);
    await shot(p, 'w3-spot-after.png');

    const clean2 = await px(p, 650, 150);
    await run(p, 'tool.brush');
    await click(p, 650, 150);
    await p.evaluate(() => (window as unknown as Win).fpe.select(630, 130, 40, 40));
    await run(p, 'tool.patch');
    await drag(p, [[650, 150], [720, 150]]);
    expect(near(await px(p, 650, 150), clean2, 30)).toBe(true);
    await run(p, 'select.none');

    const clean3 = await px(p, 450, 120);
    await run(p, 'tool.brush');
    await click(p, 450, 120);
    expect(near(await px(p, 450, 120), clean3, 20)).toBe(false);
    await run(p, 'tool.heal');
    await p.keyboard.down('Alt');
    await click(p, 450, 60);
    await p.keyboard.up('Alt');
    await drag(p, [[440, 120], [460, 120]]);
    expect(near(await px(p, 450, 120), clean3, 30)).toBe(true);

    for (const [tool, x, check] of [['tool.dodge', 400, (a: number[], b: number[]) => lum(b) > lum(a) + 3], ['tool.burn', 480, (a: number[], b: number[]) => lum(b) < lum(a) - 3],
      ['tool.sponge', 560, (a: number[], b: number[]) => sat(b) < sat(a)]] as [string, number, (a: number[], b: number[]) => boolean][]) {
      const a = await px(p, x, 520);
      await run(p, tool);
      await drag(p, [[x - 20, 520], [x + 20, 520], [x - 20, 522], [x + 20, 522]]);
      expect(check(a, await px(p, x, 520)), tool).toBe(true);
    }
    // Blur, sharpen and smudge change edges, not smooth colour fades, so they are tried on the edge of the 16 px frame.
    for (const [tool, y] of [['tool.blur', 220], ['tool.sharpen', 420]] as [string, number][]) {
      const a = await px(p, 17, y);
      await run(p, tool);
      await drag(p, [[16, y - 20], [16, y + 20], [16, y - 20]]);
      expect(near(a, await px(p, 17, y), 0), tool).toBe(false);
    }
    const sm = await px(p, 30, 460);
    await run(p, 'tool.smudge');
    await drag(p, [[6, 460], [40, 460]]);
    expect(near(await px(p, 30, 460), sm, 0)).toBe(false);

    const r = await open(1440, 900);
    await r.evaluate(() => (window as unknown as Win).fpe.newDocument(200, 200, '#808080'));
    await r.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
    await run(r, 'tool.brush');
    await click(r, 100, 100);
    expect((await px(r, 100, 100))[0]).toBeGreaterThan(200);
    await run(r, 'tool.red-eye');
    await click(r, 100, 100);
    expect((await px(r, 100, 100))[0]).toBeLessThan(150);
    expect(errors).toEqual([]);
  }, 150_000);

  it('adds editable text and shape layers, restyles them, turns them into pixels, and undo removes them', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await run(p, 'tool.type');
    await click(p, 300, 300);
    await p.waitForSelector('[data-testid="text-edit"]');
    await p.keyboard.type('Hello there');
    await p.click('[data-testid="text-done"]');
    await p.waitForTimeout(150);
    let inf = await info(p);
    expect(inf.layers).toHaveLength(3);
    expect(inf.layers[2].name).toBe('Hello there');
    expect((await w3(p)).content).toBe('text');
    const w0 = inf.layers[2].width;
    await p.fill('[data-testid="text-size"]', '96');
    await p.press('[data-testid="text-size"]', 'Enter');
    await p.waitForTimeout(150);
    expect((await info(p)).layers[2].width).toBeGreaterThan(w0 * 1.5);
    await shot(p, 'w3-text.png');
    await run(p, 'edit.undo');
    await run(p, 'edit.undo');
    expect((await info(p)).layers).toHaveLength(2);

    const fg = [228, 87, 46];
    await run(p, 'tool.rect');
    await drag(p, [[100, 100], [300, 250]]);
    expect(near(await px(p, 200, 175), fg, 3)).toBe(true);
    await run(p, 'tool.ellipse');
    await drag(p, [[400, 100], [600, 250]]);
    expect(near(await px(p, 500, 175), fg, 3)).toBe(true);
    expect(near(await px(p, 404, 104), fg, 3)).toBe(false);
    await run(p, 'tool.rounded-rect');
    await drag(p, [[100, 400], [300, 520]]);
    await run(p, 'tool.polygon');
    await drag(p, [[400, 380], [560, 540]]);
    await run(p, 'tool.line');
    await drag(p, [[620, 400], [900, 520]]);
    inf = await info(p);
    expect(inf.layers).toHaveLength(7);
    expect((await w3(p)).content).toBe('shape');
    await shot(p, 'w3-shapes.png');
    await run(p, 'tool.polygon');
    await p.click('[data-testid="w3-shape-stroke"]');
    await p.waitForTimeout(100);
    expect((await w3(p)).content).toBe('shape');
    await p.click('[data-testid="w3-rasterize"]');
    await p.waitForTimeout(100);
    expect((await w3(p)).content).toBeNull();
    for (let k = 0; k < 7; k++) await run(p, 'edit.undo');
    expect((await info(p)).layers).toHaveLength(2);
    expect(errors).toEqual([]);
  }, 120_000);

  it('works by touch on a phone: lasso, clone stamp with press-and-hold, and text', async () => {
    const p = await open(390, 844, true);
    await sample(p);
    const cdp = await p.context().newCDPSession(p);
    const touch = async (pts: [number, number][], holdMs = 160): Promise<void> => {
      const c = await Promise.all(pts.map(([x, y]) => at(p, x, y)));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c[0].x, y: c[0].y }] });
      await p.waitForTimeout(holdMs);
      for (const pt of c.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x, y: pt.y }] });
        await p.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(150);
    };
    await run(p, 'tool.lasso');
    await touch([[100, 100], [200, 100], [300, 100], [250, 200], [200, 300], [100, 200], [100, 100]]);
    const s = (await info(p)).selection as Sel;
    expect(s.w).toBeGreaterThan(150);
    expect(s.h).toBeGreaterThan(150);
    await run(p, 'select.none');
    await run(p, 'layer.flatten');
    expect((await info(p)).layers).toHaveLength(1);
    await run(p, 'tool.clone');
    await touch([[300, 60]], 900);
    expect((await w3(p)).source).toBe(true);
    const src = await px(p, 303, 60);
    await touch([[300, 500], [302, 500], [304, 500], [306, 500], [308, 500]]);
    expect(near(await px(p, 304, 500), src, 16)).toBe(true);
    await run(p, 'tool.type');
    await touch([[200, 300]], 120);
    await p.waitForSelector('[data-testid="text-edit"]');
    await p.keyboard.type('Hi');
    await p.click('[data-testid="text-done"]');
    await p.waitForTimeout(150);
    expect((await info(p)).layers).toHaveLength(2);
    await shot(p, 'w3-phone-390.png');
    expect(errors).toEqual([]);
  }, 120_000);

  // ---------- W3b: the fix round (item numbers from card-w3b-merge-fix.md) ----------
  it('frames free transform so every handle can be grabbed, and names the mode in the options bar and status line', async () => {
    for (const [w, hgt, touch] of [[1440, 900, false], [390, 844, true]] as const) {
      const p = await open(w, hgt, touch);
      await sample(p);
      for (let k = 0; k < 4; k++) await run(p, 'view.zoom-in');
      await run(p, 'edit.free-transform');
      await p.waitForTimeout(250);
      const r = await p.evaluate(() => {
        const hs = ((window as unknown as Win).fpe.state().w3 as { handles: { x: number; y: number }[] }).handles;
        const cv = (document.querySelector('.fpe-stage > canvas') as HTMLElement).getBoundingClientRect();
        const st = (document.querySelector('.fpe-stage') as HTMLElement).getBoundingClientRect();
        const shown = (s: string): DOMRect | null => {
          const el = document.querySelector<HTMLElement>(s);
          if (!el || el.hidden || el.closest('[data-state="closed"]')) return null;
          const cs = getComputedStyle(el), b = el.getBoundingClientRect();
          return cs.display === 'none' || cs.visibility === 'hidden' || !b.width || !b.height ? null : b;
        };
        const keep = ['.fpe-zoom', '[data-testid="dock"]', '[data-testid="tools"]', '[data-testid="options"]'].map(shown).filter((b): b is DOMRect => !!b);
        const bad: string[] = [];
        for (const hd of hs) {
          const x = cv.left + hd.x, y = cv.top + hd.y, where = `${Math.round(x)},${Math.round(y)}`;
          if (x < st.left + 8 || x > st.right - 8 || y < st.top + 8 || y > st.bottom - 8) bad.push('outside the picture area at ' + where);
          for (const b of keep) if (x > b.left - 8 && x < b.right + 8 && y > b.top - 8 && y < b.bottom + 8) bad.push('under a bar or the zoom buttons at ' + where);
        }
        return { n: hs.length, bad, tool: document.querySelector('[data-testid="opt-tool"]')?.textContent ?? '', status: document.querySelector('.fpe-status')?.textContent ?? '' };
      });
      expect(r.n).toBe(8);
      expect(r.bad, `${w} px`).toEqual([]);
      expect(r.tool).toContain('Resize and turn');
      expect(r.tool).not.toContain('brush');
      if (!touch) { expect(r.status).toContain('Resize and turn'); expect(r.status).not.toContain('Paint brush'); }
      await shot(p, `w3b-transform-handles-${w}.png`);
      await p.click('[data-testid="xf-mode-skew"]');
      expect(await p.textContent('[data-testid="opt-tool"]')).toContain('Slant');
      await p.click('[data-testid="xf-cancel"]');
      expect((await w3(p)).transform).toBe(null);
    }
    expect(errors).toEqual([]);
  }, 120_000);

  it('samples what you see with the magic wand on the sample photo, and warns when the clone source runs off the picture', async () => {
    const p = await open(1440, 900);
    await sample(p);
    expect((await info(p)).active).not.toBe(0);
    await run(p, 'tool.magic-wand');
    expect(await p.getAttribute('[data-testid="w3-all-on"]', 'aria-pressed')).toBe('true');
    await click(p, 5, 320);
    const seen = (await w3(p)).selected;
    expect(seen).toBeGreaterThan(40000);
    expect(seen).toBeLessThan(60000);
    await shot(p, 'w3b-wand-sample.png');
    await p.click('[data-testid="w3-all-off"]');
    await click(p, 5, 320);
    expect((await w3(p)).selected).toBeGreaterThan(seen * 3);
    await p.click('[data-testid="w3-all-on"]');
    await run(p, 'select.none');
    for (const id of ['tool.quick-select', 'tool.bucket']) {
      await run(p, id);
      expect(await p.getAttribute('[data-testid="w3-all-on"]', 'aria-pressed'), id).toBe('true');
    }
    await run(p, 'tool.magic-eraser');
    expect(await p.getAttribute('[data-testid="w3-all-off"]', 'aria-pressed')).toBe('true');
    await useBackground(p);
    await run(p, 'tool.magic-wand');
    await click(p, 5, 320);
    expect((await w3(p)).selected, 'what you see does not depend on the active layer').toBe(seen);
    await run(p, 'select.none');
    await run(p, 'tool.clone');
    const src = await at(p, 20, 300);
    await p.keyboard.down('Alt');
    await p.mouse.click(src.x, src.y);
    await p.keyboard.up('Alt');
    await p.waitForTimeout(100);
    expect((await w3(p)).source).toBe(true);
    await drag(p, [[100, 300], [40, 300]]);
    expect(await p.textContent('[data-testid="toast"]')).toContain('outside the picture');
    expect(errors).toEqual([]);
  }, 120_000);

  it('keeps every toast off the zoom buttons, dialogs, panels and bars', async () => {
    for (const [w, hgt, touch] of [[1440, 900, false], [390, 844, true]] as const) {
      const p = await open(w, hgt, touch);
      await sample(p);
      const clear = (): Promise<string[]> => p.evaluate(() => {
        const t = (document.querySelector('[data-testid="toast"]') as HTMLElement).getBoundingClientRect(), hit: string[] = [];
        for (const s of ['.fpe-zoom', '[data-testid="adjust-dialog"]', '[data-testid="dock"]', '[data-testid="tools"]', '[data-testid="options"]', '.fpe-top']) {
          const el = document.querySelector<HTMLElement>(s);
          if (!el || el.hidden || el.closest('[data-state="closed"]')) continue;
          const cs = getComputedStyle(el), b = el.getBoundingClientRect();
          if (cs.display === 'none' || cs.visibility === 'hidden' || !b.width || !b.height) continue;
          if (b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top) hit.push(s);
        }
        return hit;
      });
      await run(p, 'edit.history-brush-step');
      expect(await p.textContent('[data-testid="toast"]')).toContain('planned');
      expect(await clear(), `${w} px`).toEqual([]);
      await run(p, 'image.adj-brightness');
      await p.waitForSelector('[data-testid="adjust-dialog"]', { state: 'visible' });
      await run(p, 'edit.history-brush-step');
      expect(await clear(), `${w} px with a dialog open`).toEqual([]);
      await shot(p, `w3b-toast-${w}.png`);
      await p.click('[data-testid="dialog-head"] button');
    }
    expect(errors).toEqual([]);
  }, 120_000);

  it('moves a dialog by its title bar, off the part of the picture being changed', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await run(p, 'filter.blur-iris');
    await p.waitForSelector('[data-testid="adjust-dialog"]', { state: 'visible' });
    const box = (): Promise<{ x: number; y: number; w: number }> => p.$eval('[data-testid="adjust-dialog"]', (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; });
    const a = await box();
    const hb = await p.$eval('[data-testid="dialog-head"] h2', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
    await p.mouse.move(hb.x, hb.y);
    await p.mouse.down();
    await p.mouse.move(hb.x - 560, hb.y + 40, { steps: 8 });
    await p.mouse.up();
    const b = await box();
    expect(Math.abs(b.x - (a.x - 560))).toBeLessThan(4);
    expect(b.y).toBeGreaterThanOrEqual(a.y);
    expect(Math.abs(b.w - a.w)).toBeLessThan(2);
    await shot(p, 'w3b-dialog-moved.png');
    await p.click('[data-testid="dialog-head"] button');
    expect(await p.isHidden('[data-testid="adjust-dialog"]')).toBe(true);
    expect(errors).toEqual([]);
  }, 120_000);

  it('proves slant, pull corners, fix the angle, every align and distribute, the background eraser and smoothing a selection', async () => {
    const p = await open(1440, 900);
    await sample(p);
    const i0 = await info(p), sun0 = i0.layers[1];
    for (const m of ['skew', 'distort', 'perspective'] as const) {
      await run(p, 'edit.free-transform');
      await p.click(`[data-testid="xf-mode-${m}"]`);
      expect((await w3(p)).transform).toBe(`${m}:layer`);
      const hs = await p.evaluate(() => ((window as unknown as Win).fpe.state().w3 as { handles: { x: number; y: number }[] }).handles);
      const cv = await p.$eval('.fpe-stage > canvas', (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top }; });
      await p.mouse.move(cv.x + hs[1].x, cv.y + hs[1].y);
      await p.mouse.down();
      await p.mouse.move(cv.x + hs[1].x + 60, cv.y + hs[1].y + 30, { steps: 6 });
      await p.mouse.up();
      await p.click('[data-testid="xf-apply"]');
      await p.waitForTimeout(150);
      const s = (await info(p)).layers[1];
      expect(s.width !== sun0.width || s.height !== sun0.height, m).toBe(true);
      await run(p, 'edit.undo');
      expect((await info(p)).layers[1].width, m).toBe(sun0.width);
    }
    const W = i0.width, H = i0.height;
    for (const [id, key, want] of [['layer.align-left', 'x', 0], ['layer.align-hcenter', 'x', (W - sun0.width) / 2], ['layer.align-right', 'x', W - sun0.width],
      ['layer.align-top', 'y', 0], ['layer.align-vcenter', 'y', (H - sun0.height) / 2], ['layer.align-bottom', 'y', H - sun0.height]] as const) {
      await run(p, id);
      expect(Math.abs((await info(p)).layers[1][key] - want), id).toBeLessThanOrEqual(1);
    }
    await run(p, 'tool.rect');
    await drag(p, [[100, 420], [160, 470]]);
    await drag(p, [[330, 520], [370, 600]]);
    expect((await info(p)).layers.length).toBeGreaterThanOrEqual(4);
    for (const [id, key, size] of [['layer.distribute-h', 'x', 'width'], ['layer.distribute-v', 'y', 'height']] as const) {
      await run(p, id);
      const cs = (await info(p)).layers.slice(1).map((l) => l[key] + l[size] / 2).sort((a, b) => a - b);
      const gaps = cs.slice(1).map((c, k) => c - cs[k]);
      expect(Math.max(...gaps) - Math.min(...gaps), id).toBeLessThanOrEqual(2);
    }
    await useBackground(p);
    await run(p, 'tool.bg-eraser');
    expect((await px(p, 6, 200, true))[3]).toBeGreaterThan(200);
    await drag(p, [[6, 170], [6, 230]]);
    expect((await px(p, 6, 200, true))[3]).toBeLessThan(60);
    await run(p, 'edit.undo');
    expect((await px(p, 6, 200, true))[3]).toBeGreaterThan(200);
    await p.evaluate(() => (window as unknown as Win).fpe.select(100, 100, 100, 100));
    expect(await run(p, 'select.smooth')).toBe(true);
    await p.waitForSelector('[data-testid="w3-amount"]');
    await setRange(p, 'w3-amount', 20);
    await p.click('[data-testid="sheet-w3-amount"] [data-testid="w3-apply"]');
    await p.waitForTimeout(120);
    const sm = (await w3(p)).selected;
    expect(sm).toBeLessThan(10000);
    expect(sm).toBeGreaterThan(8500);
    expect(errors).toEqual([]);
  }, 120_000);

  for (const [w, hgt, touch] of [[1440, 900, false], [390, 844, true]] as const) {
    it(`keeps every word in each W3 options bar whole and 12 px or larger at ${w} px`, async () => {
      const p = await open(w, hgt, touch);
      await sample(p);
      const bad: string[] = [];
      for (const id of ['tool.lasso', 'tool.lasso-poly', 'tool.magic-wand', 'tool.quick-select', 'tool.gradient', 'tool.bucket', 'tool.magic-eraser', 'tool.bg-eraser',
        'tool.color-replace', 'tool.history-brush', 'tool.clone', 'tool.heal', 'tool.spot-heal', 'tool.patch', 'tool.red-eye', 'tool.dodge', 'tool.burn', 'tool.sponge',
        'tool.blur', 'tool.sharpen', 'tool.smudge', 'tool.type', 'tool.rect', 'tool.rounded-rect', 'tool.ellipse', 'tool.polygon', 'tool.line']) {
        await run(p, id);
        await p.waitForTimeout(40);
        bad.push(...(await p.evaluate((tool) => {
          const bar = document.querySelector('[data-testid="options"]') as HTMLElement, b = bar.getBoundingClientRect(), out: string[] = [];
          for (const el of Array.from(bar.querySelectorAll<HTMLElement>('button, label, span, output, select, input'))) {
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (!r.width || !r.height || cs.display === 'none' || cs.visibility === 'hidden') continue;
            const name = `${tool} ${el.getAttribute('data-testid') ?? el.className} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
            const text = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
            if (text && parseFloat(cs.fontSize) < 12) out.push('smaller than 12 px: ' + name);
            if (text && el.scrollWidth > el.clientWidth + 1) out.push('cut: ' + name);
            if (r.top < b.top - 1 || r.bottom > b.bottom + 1) out.push('clipped at the top or bottom: ' + name);
          }
          if (bar.scrollWidth > bar.clientWidth + 1 && !bar.dataset.more) out.push(tool + ': the bar scrolls without an edge cue');
          return out;
        }, id)));
      }
      expect(bad).toEqual([]);
      if (touch) {
        await run(p, 'tool.type');
        await click(p, 300, 420);
        await p.keyboard.type('Hello');
        await p.click('[data-testid="text-done"]');
        await p.waitForTimeout(150);
        await p.locator('[data-testid="w3-rasterize"]').scrollIntoViewIfNeeded();
        await p.waitForTimeout(100);
        const ok = await p.evaluate(() => {
          const el = document.querySelector('[data-testid="w3-rasterize"]') as HTMLElement, r = el.getBoundingClientRect();
          const bar = document.querySelector('[data-testid="options"]') as HTMLElement, b = bar.getBoundingClientRect();
          return { inView: r.left >= -1 && r.right <= innerWidth + 1, inBar: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, whole: el.scrollWidth <= el.clientWidth + 1, cue: !!bar.dataset.more };
        });
        expect(ok).toEqual({ inView: true, inBar: true, whole: true, cue: true });
        await shot(p, 'w3b-phone-text-bar.png');
      }
      expect(errors).toEqual([]);
    }, 180_000);
  }
});
