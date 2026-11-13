// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * W5 polish in a real headless Chrome, each proven by its result: the Character and Paragraph controls change the text
 * layer, the paint bucket fills the frame of the sample photo whichever layer is active, the view comes back after a
 * transform, Sharpen a little and Sharpen more open dialogs, and every button reads at WCAG AA contrast in both looks.
 * Screenshots go to e2e/out (w5-*.png).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts polish
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Layer { name: string; x: number; y: number; width: number; height: number; }
interface Info { width: number; height: number; active: number; layers: Layer[]; }
interface View { zoom: number; panX: number; panY: number; }
interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; getInfo(): Info | null;
  toClient(x: number, y: number): { x: number; y: number } | null; sample(x: number, y: number, only?: boolean): number[] | null;
  checksum(x: number, y: number, w: number, h: number): number; setZoom(zoom: number): void; openFile(b: Blob, name?: string): Promise<void>;
}
type Win = Window & { fpe: Fpe };
interface Ink { count: number; edges: { left: number; right: number }[]; strongest: number[]; }

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const FG = [228, 87, 46];

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

async function open(w: number, hgt: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}px: ${e.message}`));
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
/** Open the sample photo and wait until the tools have loaded. */
async function sample(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
  await p.waitForTimeout(150);
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const info = (p: Page): Promise<Info> => p.evaluate(() => (window as unknown as Win).fpe.getInfo() as Info);
const state = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
const view = async (p: Page): Promise<View> => (await state(p)).view as View;
const px = (p: Page, x: number, y: number): Promise<number[]> => p.evaluate(([a, b]) => (window as unknown as Win).fpe.sample(a, b) ?? [], [x, y] as const);
const sumAt = (p: Page, r: { x: number; y: number; w: number; h: number }): Promise<number> =>
  p.evaluate((b) => (window as unknown as Win).fpe.checksum(b.x, b.y, b.w, b.h), r);
async function click(p: Page, x: number, y: number): Promise<void> {
  const c = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as const);
  if (!c) throw new Error('no picture');
  await p.mouse.click(c.x, c.y);
  await p.waitForTimeout(100);
}
async function drag(p: Page, pts: [number, number][]): Promise<void> {
  const to = async (x: number, y: number): Promise<{ x: number; y: number }> => {
    const c = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as const);
    if (!c) throw new Error('no picture');
    return c;
  };
  const c0 = await to(pts[0][0], pts[0][1]);
  await p.mouse.move(c0.x, c0.y);
  await p.mouse.down();
  for (const [x, y] of pts.slice(1)) { const c = await to(x, y); await p.mouse.move(c.x, c.y, { steps: 6 }); }
  await p.mouse.up();
  await p.waitForTimeout(150);
}
/** The active layer's own ink (pixels at least half covered): how many, the left and right ink edge in each of `bands` bands of rows, and the colour of the most covered pixel. */
function ink(p: Page, li: number, bands: number): Promise<Ink> {
  return p.evaluate(([i, n]) => {
    const f = (window as unknown as Win).fpe, l = (f.getInfo() as Info).layers[i], edges = Array.from({ length: n }, () => ({ left: Infinity, right: -Infinity }));
    let count = 0, best = -1, strongest: number[] = [];
    for (let y = l.y; y < l.y + l.height; y++) {
      const e = edges[Math.min(n - 1, Math.floor(((y - l.y) / l.height) * n))];
      for (let x = l.x; x < l.x + l.width; x++) {
        const c = f.sample(x, y, true);
        if (!c || c[3] < 128) continue;
        count++;
        if (c[3] > best) { best = c[3]; strongest = c; }
        if (x < e.left) e.left = x;
        if (x > e.right) e.right = x;
      }
    }
    return { count, edges, strongest };
  }, [li, bands] as const);
}
const near = (a: number[], b: number[], tol: number): boolean => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const mid = (e: { left: number; right: number }): number => (e.left + e.right) / 2;
const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: join(OUT, name) });
const showTab = async (p: Page, pid: string): Promise<void> => {
  await p.$eval(`[data-tab="${pid}"]`, (el) => (el as HTMLElement).click());
  await p.waitForSelector(`[data-panel="${pid}"] .fpe-w3-panel`, { state: 'visible' });
};
async function setNumber(p: Page, sel: string, v: number): Promise<void> {
  await p.fill(sel, String(v));
  await p.press(sel, 'Enter');
  await p.waitForTimeout(150);
}

const suite = CHROME ? describe : describe.skip;
suite('W5 polish (headless Chrome)', () => {
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

  it('Character and Paragraph controls change the text layer: bold, slanted, font, colour, letter gap, line up and line gap', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await run(p, 'tool.type');
    await click(p, 160, 230);
    await p.waitForSelector('[data-testid="text-edit"]');
    await p.keyboard.type('Wide first line');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Short');
    await p.click('[data-testid="text-done"]');
    await p.waitForTimeout(150);
    await run(p, 'tool.move');
    const li = 2, box = async (): Promise<Layer> => (await info(p)).layers[li];
    expect((await box()).name).toBe('Wide first line');
    const b0 = await box(), area = { x: b0.x - 80, y: b0.y - 40, w: b0.width + 400, h: b0.height + 160 };
    await showTab(p, 'character');
    const C = '[data-panel="character"] ', P = '[data-panel="paragraph"] ';

    const ink0 = await ink(p, li, 2), sum0 = await sumAt(p, area);
    await p.click(C + '[data-testid="text-bold"]');
    await p.waitForTimeout(150);
    expect(await p.getAttribute(C + '[data-testid="text-bold"]', 'aria-pressed')).toBe('true');
    const ink1 = await ink(p, li, 2);
    expect(ink1.count, 'thicker letters cover more pixels').toBeGreaterThan(ink0.count * 1.1);
    expect(await sumAt(p, area)).not.toBe(sum0);

    const sum1 = await sumAt(p, area);
    await p.click(C + '[data-testid="text-italic"]');
    await p.waitForTimeout(150);
    expect(await p.getAttribute(C + '[data-testid="text-italic"]', 'aria-pressed')).toBe('true');
    expect(await sumAt(p, area), 'slanted letters change the pixels').not.toBe(sum1);

    const fonts = await p.$$eval(C + '[data-testid="text-font"] option', (o) => o.map((x) => (x as HTMLOptionElement).value));
    const now = await p.$eval(C + '[data-testid="text-font"]', (el) => (el as HTMLSelectElement).value);
    const pick = ['monospace', 'serif', ...fonts].find((f) => fonts.includes(f) && f !== now) as string;
    expect(pick).toBeTruthy();
    const wF = (await box()).width;
    await p.selectOption(C + '[data-testid="text-font"]', pick);
    await p.waitForTimeout(150);
    expect(Math.abs((await box()).width - wF), `font ${now} → ${pick} changes the width`).toBeGreaterThan(4);
    await shot(p, 'w5-text-bold-font.png');

    await p.$eval(C + '[data-testid="text-color"]', (el) => { const i = el as HTMLInputElement; i.value = '#00a000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(150);
    expect(near((await ink(p, li, 1)).strongest, [0, 160, 0], 6), 'the words take the new colour').toBe(true);

    const wT = (await box()).width;
    await setNumber(p, C + '[data-testid="text-tracking"]', 20);
    expect((await box()).width, 'a letter gap of 20 px widens the 15-letter line').toBeGreaterThan(wT + 150);

    await showTab(p, 'paragraph');
    const left = await ink(p, li, 2), x0 = (await box()).x;
    expect(Math.abs(left.edges[0].left - left.edges[1].left), 'lined up left').toBeLessThan(14);
    await p.click(P + '[data-testid="text-align-center"]');
    await p.waitForTimeout(150);
    expect(await p.getAttribute(P + '[data-testid="text-align-center"]', 'aria-pressed')).toBe('true');
    const centre = await ink(p, li, 2);
    expect(Math.abs(mid(centre.edges[0]) - mid(centre.edges[1])), 'centred lines share a middle').toBeLessThan(14);
    expect(centre.edges[1].left - centre.edges[0].left, 'the short line moves in').toBeGreaterThan(60);
    expect((await box()).x, 'centred text sits round its anchor').toBeLessThan(x0 - 60);
    await p.click(P + '[data-testid="text-align-right"]');
    await p.waitForTimeout(150);
    const right = await ink(p, li, 2);
    expect(Math.abs(right.edges[0].right - right.edges[1].right), 'lined up right').toBeLessThan(14);
    const h0 = (await box()).height;
    await setNumber(p, P + '[data-testid="text-leading"]', 2);
    expect((await box()).height, 'a line gap of 2 makes the block taller').toBeGreaterThan(h0 * 1.3);
    await shot(p, 'w5-text-paragraph.png');
    expect(errors).toEqual([]);
  }, 120_000);

  it('fills what you see: the bucket fills the frame of the sample photo while the sun layer is active, growing that layer', async () => {
    const p = await open(1440, 900);
    await sample(p);
    expect((await info(p)).active, 'the sun is the active layer').toBe(1);
    await run(p, 'tool.bucket');
    expect(await p.getAttribute('[data-testid="w3-all-on"]', 'aria-pressed')).toBe('true');
    await click(p, 5, 320);
    expect(near(await px(p, 5, 320), FG, 3), 'left side of the frame').toBe(true);
    expect(near(await px(p, 480, 5), FG, 3), 'top of the frame').toBe(true);
    expect(near(await px(p, 480, 320), FG, 3), 'the photo inside the frame stays').toBe(false);
    const sun = (await info(p)).layers[1];
    expect([sun.x, sun.y, sun.height]).toEqual([0, 0, 640]);
    expect(sun.width).toBeGreaterThanOrEqual(960);
    expect(await p.textContent('[data-testid="toast"]')).not.toContain('outside the layer');
    await shot(p, 'w5-bucket-frame.png');
    await run(p, 'edit.undo');
    expect((await info(p)).layers[1].width).toBe(180);

    await run(p, 'tool.quick-select');
    expect(await p.getAttribute('[data-testid="w3-all-on"]', 'aria-pressed')).toBe('true');
    await drag(p, [[300, 140], [380, 150]]);
    const seen = (await state(p)).w3 as { selected: number };
    expect(seen.selected, 'quick select grows over the sky it sees').toBeGreaterThan(2000);
    await run(p, 'select.none');
    await p.click('[data-testid="w3-all-off"]');
    await drag(p, [[300, 140], [380, 150]]);
    expect(((await state(p)).w3 as { selected: number }).selected, 'this layer only judges the sun layer instead').not.toBe(seen.selected);
    expect(errors).toEqual([]);
  }, 120_000);

  it('puts the view back where it was after a transform, and keeps a zoom chosen during it', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await p.evaluate(() => (window as unknown as Win).fpe.setZoom(3));
    await p.waitForTimeout(100);
    const v0 = await view(p);
    await run(p, 'edit.free-transform');
    await p.waitForFunction(() => !!((window as unknown as Win).fpe.state().w3 as { transform: string | null }).transform);
    const v1 = await view(p);
    expect(v1.zoom !== v0.zoom || v1.panX !== v0.panX || v1.panY !== v0.panY, 'the transform moved the view to show its handles').toBe(true);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    expect(((await state(p)).w3 as { transform: string | null }).transform).toBeNull();
    expect(await view(p)).toEqual(v0);

    await run(p, 'edit.free-transform');
    await p.waitForFunction(() => !!((window as unknown as Win).fpe.state().w3 as { transform: string | null }).transform);
    const z = (await view(p)).zoom * 1.5;
    await p.evaluate((x) => (window as unknown as Win).fpe.setZoom(x), z);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    expect(((await state(p)).w3 as { transform: string | null }).transform).toBeNull();
    expect((await view(p)).zoom, 'a zoom chosen during the transform stays').toBeCloseTo(z, 5);
    expect(errors).toEqual([]);
  }, 120_000);

  it('opens Sharpen a little and Sharpen more as dialogs, while Repeat the last effect applies at once', async () => {
    const p = await open(1440, 900);
    await sample(p);
    for (const id of ['filter.sharpen', 'filter.sharpen-more']) {
      await run(p, id);
      await p.waitForSelector('[data-testid="adjust-dialog"]', { state: 'visible' });
      expect((await state(p)).adjust).toBe(id);
      expect(await p.locator('[data-testid="adjust-dialog"] input[type=range]').count(), `${id} has sliders`).toBe(2);
      await p.click('[data-testid="adj-apply"]');
      await p.waitForFunction(() => (window as unknown as Win).fpe.state().adjust === null);
    }
    expect((await state(p)).lastFilter).toBe('filter.sharpen-more');
    const n = (await state(p)).step as number;
    await run(p, 'filter.last');
    await p.waitForFunction((k) => (window as unknown as Win).fpe.state().step === k + 1, n);
    expect(await p.isHidden('[data-testid="adjust-dialog"]')).toBe(true);
    expect(errors).toEqual([]);
  }, 120_000);

  it('the bucket never refuses on the picture: a text, locked or hidden layer gets the fill on a new layer just above, in one undo step', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await run(p, 'tool.type');
    await click(p, 160, 230);
    await p.waitForSelector('[data-testid="text-edit"]');
    await p.keyboard.type('Hello');
    await p.click('[data-testid="text-done"]');
    await p.waitForTimeout(150);
    const base = await info(p), ti = base.active, n = base.layers.length;
    await run(p, 'tool.bucket');
    const fills = async (why: string): Promise<void> => {
      await click(p, 480, 5);
      const now = await info(p);
      expect(now.layers.length, why).toBe(n + 1);
      expect(now.active, `${why}: the new layer sits just above`).toBe(ti + 1);
      expect(near(await px(p, 480, 5), FG, 3), `${why}: the frame is filled`).toBe(true);
      expect(await p.textContent('[data-testid="toast"]')).toContain(`because that layer ${why}`);
      await run(p, 'edit.undo');
      expect((await info(p)).layers.length, `${why}: one undo removes the new layer and the fill`).toBe(n);
      expect(near(await px(p, 480, 5), FG, 3)).toBe(false);
      expect((await info(p)).active).toBe(ti);
    };
    await fills('is a text layer');
    await run(p, 'layer.lock');
    await fills('is locked');
    await run(p, 'layer.lock');
    await run(p, 'layer.hide');
    await fills('is hidden');
    await run(p, 'layer.hide');
    await run(p, 'tool.select-rect');
    await drag(p, [[100, 100], [200, 200]]);
    await run(p, 'tool.bucket');
    await click(p, 480, 5);
    expect(await p.textContent('[data-testid="toast"]')).toContain('outside the selected area');
    await run(p, 'select.none');
    await p.evaluate(() => (window as unknown as Win).fpe.setZoom(0.5));
    await p.waitForTimeout(100);
    await click(p, -40, 200);
    expect(await p.textContent('[data-testid="toast"]')).toContain('outside the picture');
    expect((await info(p)).layers.length).toBe(n);
    expect(errors).toEqual([]);
  }, 120_000);

  it('the history brush paints back the step marked "Paint from here", and the mark stays through undo and redo', async () => {
    const p = await open(1440, 900);
    await sample(p);
    await p.locator('[data-testid="layer-row"]').last().click();
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.active === 0);
    await run(p, 'edit.history-brush-step');
    await p.waitForSelector('[data-testid="history-mark"]', { state: 'visible' });
    const marks = p.locator('[data-testid="history-mark"]');
    const pressed = async (): Promise<number[]> =>
      (await marks.evaluateAll((els) => els.map((e, k) => (e.getAttribute('aria-pressed') === 'true' ? k : -1)))).filter((k) => k >= 0);
    expect(await pressed(), 'at first the brush paints the picture as opened').toEqual([0]);
    const opened = await px(p, 620, 250);
    await run(p, 'tool.brush');
    await drag(p, [[600, 250], [640, 250]]);
    const first = await px(p, 620, 250);
    await run(p, 'tool.swap-colors');
    await drag(p, [[600, 250], [640, 250]]);
    const second = await px(p, 620, 250);
    expect(near(first, opened, 10), 'the first stroke changed the photo').toBe(false);
    expect(near(second, first, 10), 'the second stroke has the other colour').toBe(false);
    await marks.nth(1).click();
    expect(await pressed()).toEqual([1]);
    expect(await p.textContent('[data-testid="toast"]')).toContain('paints back');
    await run(p, 'tool.history-brush');
    await drag(p, [[590, 250], [650, 250]]);
    expect(near(await px(p, 620, 250), first, 12), 'it paints back the first stroke, not the photo as opened').toBe(true);
    await shot(p, 'w5-history-mark.png');
    await run(p, 'edit.undo');
    expect(near(await px(p, 620, 250), second, 2)).toBe(true);
    expect(await pressed(), 'the mark stays on its step through undo').toEqual([1]);
    await run(p, 'edit.redo');
    expect(await pressed(), 'and through redo').toEqual([1]);
    expect(near(await px(p, 620, 250), first, 12)).toBe(true);
    await run(p, 'edit.history-brush-step');
    expect(await pressed(), 'Edit > Paint back from this step marks the step you are at').toEqual([3]);
    expect(errors).toEqual([]);
  }, 120_000);

  it('a slow filter on a 4000 x 3000 photo previews on a smaller copy, then Apply works at full size with a progress bar and Cancel', async () => {
    const p = await open(1440, 900);
    const line = (w: number, hgt: number): Promise<void> => p.evaluate(async ([a, b]) => {
      const c = new OffscreenCanvas(a, b), x = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      x.fillStyle = '#000';
      x.fillRect(0, 0, a, b);
      x.fillStyle = '#fff';
      x.fillRect(a / 2, 0, 3, b);
      await (window as unknown as Win).fpe.openFile(await c.convertToBlob({ type: 'image/png' }), `line-${a}.png`);
    }, [w, hgt] as const);
    const row = (cx: number, y: number): Promise<number[]> => p.evaluate(([a, b]) => {
      const f = (window as unknown as Win).fpe, out: number[] = [];
      for (let x = a - 20; x <= a + 20; x++) out.push((f.sample(x, b) ?? [])[0]);
      return out;
    }, [cx, y] as const);
    type Pv = { scale: number; done: boolean; applying: boolean } | null;
    const pv = async (): Promise<Pv> => (await state(p)).preview as Pv;
    const ready = (): Promise<unknown> => p.waitForFunction(() => ((window as unknown as Win).fpe.state().preview as { done: boolean } | null)?.done === true, null, { timeout: 60_000 });
    const closed = (): Promise<unknown> => p.waitForFunction(() => (window as unknown as Win).fpe.state().adjust === null, null, { timeout: 90_000 });

    await line(400, 300);
    await run(p, 'filter.maximum');
    await ready();
    expect((await pv())?.scale, 'a small picture previews at full size').toBe(1);
    const exact = await row(200, 150);
    await p.click('[data-testid="adj-apply"]');
    await closed();

    await line(4000, 3000);
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.width === 4000);
    const steps = (await state(p)).step as number;
    await run(p, 'filter.maximum');
    await ready();
    expect((await pv())?.scale, 'a 12 MP picture previews on a smaller copy').toBeLessThan(0.5);
    expect(await p.textContent('[data-testid="adj-small"]')).toContain('smaller copy');
    expect(await row(2000, 1500), 'the quick preview is close, not exact').not.toEqual(exact);
    await p.evaluate(() => {
      const w = window as unknown as { seen: number[] };
      w.seen = [];
      new MutationObserver((ms) => { for (const m of ms) if ((m.target as HTMLElement).dataset.testid === 'job-bar') w.seen.push((m.target as HTMLProgressElement).value); })
        .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['value'] });
    });
    await p.click('[data-testid="adj-apply"]');
    await closed();
    expect(await row(2000, 1500), 'Apply did every pixel at full size: the same as on the small picture').toEqual(exact);
    const seen = await p.evaluate(() => (window as unknown as { seen: number[] }).seen);
    expect(seen.some((v) => v > 0 && v < 1), `the bar moved in steps: ${seen.join(', ')}`).toBe(true);
    expect((await state(p)).step).toBe(steps + 1);

    const kept = await sumAt(p, { x: 1800, y: 1300, w: 400, h: 400 });
    await run(p, 'filter.blur-surface');
    await p.waitForSelector('[data-testid="adjust-dialog"]', { state: 'visible' });
    await p.$eval('[data-testid="ctl-radius"]', (el) => { const i = el as HTMLInputElement; i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await ready();
    await p.click('[data-testid="adj-apply"]');
    await p.waitForSelector('[data-testid="job-progress"]', { state: 'visible' });
    expect((await pv())?.applying).toBe(true);
    await p.waitForFunction(() => Number((document.querySelector('[data-testid="job-bar"]') as HTMLProgressElement | null)?.value ?? 0) > 0, null, { timeout: 25_000 }).catch(() => undefined);
    await shot(p, 'w5-slow-filter-progress.png');
    await p.click('[data-testid="job-cancel"]');
    await closed();
    expect(await p.locator('[data-testid="job-progress"]').count()).toBe(0);
    expect(await sumAt(p, { x: 1800, y: 1300, w: 400, h: 400 }), 'Cancel keeps the picture as it was').toBe(kept);
    expect((await state(p)).step, 'and adds no step').toBe(steps + 1);
    expect(await p.textContent('[data-testid="toast"]')).toContain('stopped');

    await run(p, 'filter.blur-lens');
    await p.waitForSelector('[data-testid="adjust-dialog"]', { state: 'visible' });
    await p.$eval('[data-testid="ctl-radius"]', (el) => { const i = el as HTMLInputElement; i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await ready();
    await p.click('[data-testid="adj-apply"]');
    await p.waitForSelector('[data-testid="job-progress"]', { state: 'visible' });
    expect(await p.getAttribute('[data-testid="job-bar"]', 'value'), 'lens blur cannot be split exactly, so its bar moves without steps').toBeNull();
    await p.keyboard.press('Escape');
    await closed();
    expect(await p.locator('[data-testid="job-progress"]').count(), 'Escape works like Cancel').toBe(0);
    expect(await sumAt(p, { x: 1800, y: 1300, w: 400, h: 400 }), 'the picture is as it was').toBe(kept);
    expect((await state(p)).step, 'and no step was added').toBe(steps + 1);
    expect(errors).toEqual([]);
  }, 300_000);

  it('every button keeps its own text colour and reads at WCAG AA contrast in the dark and the light look', async () => {
    const p = await open(1440, 900);
    await sample(p);
    for (const theme of ['dark', 'light']) {
      if ((await state(p)).theme !== theme) await run(p, 'edit.pref-theme');
      await p.waitForTimeout(150);
      expect((await state(p)).theme).toBe(theme);
      const res = await p.evaluate(() => {
        const rgb = (c: string): number[] => {
          const m = /rgba?\(([^)]+)\)/.exec(c);
          if (!m) return [0, 0, 0, 0];
          const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
          return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
        };
        const hex = (s: string): number[] => { const t = s.trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16)); };
        const over = (top: number[], under: number[]): number[] => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
        const lum = (c: number[]): number => { const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ground = (el: Element): number[] => {
          const stack: number[][] = [];
          for (let e: Element | null = el; e; e = e.parentElement) {
            const c = rgb(getComputedStyle(e).backgroundColor);
            if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
          }
          return stack.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
        };
        const bad: string[] = [];
        let checked = 0;
        for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('.fpe button'))) {
          const cs = getComputedStyle(b), r = b.getBoundingClientRect();
          if (!r.width || !r.height || cs.visibility === 'hidden' || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
          const bg = ground(b), fg = over(rgb(cs.color), bg), a = lum(fg), z = lum(bg), ratio = (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05);
          const text = (b.textContent ?? '').trim(), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
          const need = !text ? 3 : size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
          checked++;
          if (ratio < need) bad.push(`${b.className || b.dataset.testid || b.tagName} "${text.slice(0, 24)}" ${ratio.toFixed(2)} < ${need}`);
        }
        const root = document.querySelector('.fpe') as HTMLElement, muted = hex(getComputedStyle(root).getPropertyValue('--muted'));
        const tab = document.querySelector<HTMLElement>('[data-tab][aria-selected="false"]'), search = document.querySelector<HTMLElement>('.fpe-search-btn');
        const own = [tab, search].filter((e): e is HTMLElement => !!e).map((e) => rgb(getComputedStyle(e).color).slice(0, 3).join(',') === muted.join(','));
        return { bad, checked, own };
      });
      expect(res.checked, theme).toBeGreaterThan(40);
      expect(res.own, `${theme}: muted tab and search text keep their own colour`).toEqual([true, true]);
      expect(res.bad, theme).toEqual([]);
    }
    expect(errors).toEqual([]);
  }, 120_000);
});
