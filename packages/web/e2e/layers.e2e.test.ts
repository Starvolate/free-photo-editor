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
interface LayerState {
  id: string; x: number; y: number; w: number; h: number; mask: MaskInfo | null;
  name: string; kind: string; parentId: string | null; clip: boolean; open: boolean; passThrough: boolean; opacity: number; blendMode: string;
}
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
/** Wait until every layer and mask thumbnail is drawn, so a screenshot never catches an empty square. */
const thumbs = (p: Page): Promise<unknown> => p.waitForFunction(() =>
  [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-thumb], canvas[data-mask-thumb]')].every((c) => c.dataset.drawn === '1'));
/** A checksum of the active layer's own pixels (its mask left out), read at every second pixel of a w x h picture. */
const ownPixels = (p: Page, w: number, hgt: number): Promise<number> => p.evaluate(([W, H]) => {
  const f = (window as unknown as Win).fpe;
  let s = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const v = f.sample(x, y, true);
    if (v) s = (s * 31 + v[0] + 3 * v[1] + 5 * v[2] + 7 * v[3]) % 2147483647;
  }
  return s;
}, [w, hgt] as const);
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
    await thumbs(p);
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
    await thumbs(p);
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

  it('on the mask the colour fade and Negative change only the mask; the paint bucket and Fill from the surroundings still refuse', async () => {
    await p.click('[data-testid="layer-mask"]');
    expect((await state(p)).maskTarget).toBe(true);
    expect(await p.textContent('[data-testid="status"]')).toContain('Editing the mask of Layer 2');
    const h = await hash(p), own = await ownPixels(p, 120, 80), m0 = top(await state(p)).mask;
    expect(await run(p, 'tool.bucket')).toBe(true);
    await click(p, 30, 40);
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().w3 !== null);
    await click(p, 30, 40);
    // The refusal lists exactly what works on the mask.
    expect(await toast(p)).toContain('Brush, pencil, eraser, Fill, Delete, Colour fade (Gradient) and Negative (Invert) work on it');
    expect(await hash(p)).toBe(h);
    // Colour fade: black to white across the picture, drawn in greys on the mask; the layer's own pixels stay.
    expect(await run(p, 'tool.gradient')).toBe(true);
    await drag(p, [[25, 40], [95, 40]]);
    const m1 = top(await state(p)).mask;
    expect(m1?.sum).not.toBe(m0?.sum);
    expect(await hash(p)).not.toBe(h);
    expect(await ownPixels(p, 120, 80)).toBe(own);
    expect(await run(p, 'edit.undo')).toBe(true);
    expect(top(await state(p)).mask).toEqual(m0);
    expect(await hash(p)).toBe(h);
    // Negative (Invert, Ctrl+I) swaps what the mask shows and hides; the pixels stay.
    expect(await run(p, 'image.adj-invert')).toBe(true);
    const m2 = top(await state(p)).mask;
    expect(m2?.sum).not.toBe(m0?.sum);
    expect(await hash(p)).not.toBe(h);
    expect(await ownPixels(p, 120, 80)).toBe(own);
    expect(await run(p, 'edit.undo')).toBe(true);
    expect(top(await state(p)).mask).toEqual(m0);
    expect(await hash(p)).toBe(h);
    await select(p, 25, 25, 10, 10);
    await p.evaluate(() => (window as unknown as Win).fpe.aiCmd('edit.smart-fill'));
    expect(await toast(p)).toContain('You are editing the mask');
    expect(await hash(p)).toBe(h);
    expect(errors).toEqual([]);
  });

  it('at 1440 x 900 Blend and Opacity sit above the layer rows and three rows are fully in view; the mask settings sit in Properties, one line per label', async () => {
    const q = await open(1440, 900);
    await masked(q);
    expect(await run(q, 'layer.new')).toBe(true);
    await q.locator('[data-testid="layer-row"][data-name="Layer 2"] [data-testid="layer-mask"]').click();
    expect((await state(q)).maskTarget).toBe(true);
    expect(await run(q, 'tool.gradient')).toBe(true);
    await drag(q, [[10, 40], [110, 40]]);
    const list = await q.locator('[data-testid="layer-list"]').boundingBox(), rows = q.locator('[data-testid="layer-row"]');
    if (!list) throw new Error('no layer list');
    expect(await rows.count()).toBe(3);
    for (let i = 0; i < 3; i++) {
      const b = await rows.nth(i).boundingBox();
      expect(!!b && b.y >= list.y - 0.5 && b.y + b.height <= list.y + list.height + 0.5 && b.y + b.height <= 900, `row ${i + 1} fully in view`).toBe(true);
    }
    // Blend and Opacity sit in one strip at the top of the card, above the rows, as in the approved picture (a-deep,
    // 13 Nov 2026); the three rows above stay fully in view.
    const top = await q.locator('[data-testid="layer-top"]').boundingBox();
    expect(!!top && top.y + top.height <= list.y + 0.5, 'Blend and Opacity above the rows').toBe(true);
    // The mask's settings are in the Properties panel, each label plain name then pro name on one line, at 12 px or more.
    const props = q.locator('[data-testid="panel-properties"] [data-testid="mask-props"]');
    await props.locator('label').first().waitFor();
    expect(await q.locator('[data-testid="panel-layers"] [data-testid="mask-props"]').count()).toBe(0);
    const labels = await props.locator('label').evaluateAll((ls) => ls.map((l) => ({
      text: l.textContent ?? '', h: l.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(l).fontSize), cut: l.scrollWidth > l.clientWidth + 1,
    })));
    expect(labels.map((l) => l.text)).toEqual(['How strongly the mask hides Density', 'Soft edge Feather']);
    for (const l of labels) {
      expect(l.fs, l.text).toBeGreaterThanOrEqual(12);
      expect(l.h, l.text + ': one line').toBeLessThan(l.fs * 2);
      expect(l.cut, l.text + ': not cut off').toBe(false);
    }
    expect(await q.textContent('[data-testid="status"]')).toContain('Editing the mask of Layer 2');
    await thumbs(q);
    await q.screenshot({ path: join(OUT, 'w6-s1-mask-target-1440.png') });
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
    await thumbs(q);
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
    await thumbs(q);
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
    expect((await sheet.locator('.fpe-sheet-title').textContent())?.trim()).toBe('Layer 2');
    expect(await sheet.locator('.fpe-tag').count()).toBeGreaterThan(0);
    await q.waitForTimeout(250);
    await thumbs(q);
    await q.screenshot({ path: join(OUT, 'w6-s1-phone-390-layer-actions.png') });
    await q.tap('[data-testid="layer-action-mask-toggle"]');
    expect(top(await state(q)).mask?.enabled).toBe(false);
    expect(errors).toEqual([]);
  });

  /** Click a row's name (desktop), found by a test on the layer. */
  async function pick(q: Page, test: (l: LayerState) => boolean): Promise<LayerState> {
    const l = (await state(q)).layers.find(test);
    if (!l) throw new Error('no such layer');
    await q.click(`[data-testid="layer-row"][data-id="${l.id}"] [data-testid="layer-select"]`);
    return l;
  }
  const rowIds = (q: Page): Promise<string[]> => q.$$eval('[data-testid="layer-row"]', (r) => r.map((e) => (e as HTMLElement).dataset.id ?? ''));
  /** A grey picture with a black Screen layer in a folder: pass through shows grey there, a Normal folder shows black. */
  async function folderDoc(q: Page, blend = true): Promise<void> {
    await q.evaluate(() => (window as unknown as Win).fpe.newDocument(120, 80, '#808080'));
    expect(await run(q, 'layer.new')).toBe(true);
    expect(await run(q, 'tool.default-colors')).toBe(true);
    await fillBlack(q);
    if (blend) await q.selectOption('[data-testid="layer-blend"]', 'screen');
    expect(await run(q, 'layer.group')).toBe(true);
  }

  it('folders: put in, pass through against Normal, close and open, clip, arrange out and in, undo and redo each, and Restore after a reload', async () => {
    const q = await open(1440, 900);
    await folderDoc(q);
    let s = await state(q);
    const f = s.layers.find((l) => l.kind === 'folder'), kid = s.layers.find((l) => l.blendMode === 'screen');
    if (!f || !kid) throw new Error('no folder');
    expect(kid.parentId).toBe(f.id);
    expect(f.passThrough).toBe(true);
    // Rows: the folder, then its layer one step in, then the background.
    expect(await rowIds(q)).toEqual([f.id, kid.id, s.layers[0].id]);
    expect(await q.getAttribute(`[data-id="${kid.id}"]`, 'data-depth')).toBe('1');
    expect(await q.getAttribute(`[data-id="${f.id}"] [data-testid="layer-select"]`, 'aria-label')).toContain('Folder Folder');
    // Pass through: the Screen layer mixes with the grey below and black changes nothing. Normal: the folder is one picture first.
    const grey = await px(q, 60, 40), passHash = await hash(q);
    expect(grey.slice(0, 3)).toEqual([128, 128, 128]);
    await pick(q, (l) => l.id === f.id);
    await q.waitForSelector('[data-testid="folder-props"] [data-testid="prop-x"]');
    // Blend shows once for a folder: at the top of the Layers card, where Pass through is its first choice.
    expect(await q.locator('[data-testid="folder-mix"]').count()).toBe(0);
    expect(await q.inputValue('[data-testid="layer-top"] [data-testid="layer-blend"]')).toBe('pass');
    await q.selectOption('[data-testid="layer-blend"]', 'normal');
    expect((await px(q, 60, 40)).slice(0, 3)).toEqual([0, 0, 0]);
    const normalHash = await hash(q);
    expect(normalHash).not.toBe(passHash);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect(await hash(q)).toBe(passHash);
    expect(await run(q, 'edit.redo')).toBe(true);
    expect(await hash(q)).toBe(normalHash);
    await q.selectOption('[data-testid="layer-blend"]', 'pass');
    expect(top(await state(q)).passThrough).toBe(true);
    expect(await hash(q)).toBe(passHash);
    // The folder's opacity is one undo step.
    await q.fill('[data-testid="layer-opacity"]', '50');
    expect(top(await state(q)).opacity).toBe(0.5);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect(top(await state(q)).opacity).toBe(1);
    // Close and open: a view choice, the picture is the same.
    await q.click(`[data-id="${f.id}"] [data-testid="folder-arrow"]`);
    expect(await rowIds(q)).toEqual([f.id, s.layers[0].id]);
    expect(await q.getAttribute(`[data-id="${f.id}"] [data-testid="folder-arrow"]`, 'aria-expanded')).toBe('false');
    expect(await hash(q)).toBe(passHash);
    await q.click(`[data-id="${f.id}"] [data-testid="folder-arrow"]`);
    expect(await rowIds(q)).toHaveLength(3);
    // A new layer over the folder's layer joins the folder; clipped, it shows only where that layer has pixels.
    await pick(q, (l) => l.id === kid.id);
    expect(await run(q, 'layer.new')).toBe(true);
    await select(q, 10, 10, 100, 60);
    expect(await run(q, 'edit.fill')).toBe(true);
    expect(await run(q, 'select.none')).toBe(true);
    s = await state(q);
    const cl = s.layers.find((l) => l.id !== kid.id && l.parentId === f.id && l.blendMode === 'normal');
    if (!cl) throw new Error('the new layer is not in the folder');
    expect((await px(q, 15, 15)).slice(0, 3)).toEqual([0, 0, 0]);
    expect(await run(q, 'layer.clip')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === cl.id)?.clip).toBe(true);
    expect((await px(q, 15, 15)).slice(0, 3)).toEqual([128, 128, 128]);
    expect(await q.locator(`[data-id="${cl.id}"] [data-testid="clip-arrow"]`).count()).toBe(1);
    expect(await q.getAttribute(`[data-id="${kid.id}"] [data-testid="layer-select"]`, 'aria-label')).toContain('1 layer clipped to it');
    const clipHash = await hash(q);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === cl.id)?.clip).toBe(false);
    expect(await run(q, 'edit.redo')).toBe(true);
    expect(await hash(q)).toBe(clipHash);
    await thumbs(q);
    await q.screenshot({ path: join(OUT, 'w6-s2-clipped-1440.png') });
    await pick(q, (l) => l.id === f.id);
    await q.waitForSelector('[data-testid="folder-props"] [data-testid="prop-x"]');
    await thumbs(q);
    await q.screenshot({ path: join(OUT, 'w6-s2-folder-open-1440.png') });
    // Arrange: up from the top of the folder leaves it; down again goes back in. Each is one undo step.
    await pick(q, (l) => l.id === cl.id);
    expect(await run(q, 'layer.forward')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === cl.id)?.parentId).toBeNull();
    expect(await run(q, 'layer.backward')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === cl.id)?.parentId).toBe(f.id);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === cl.id)?.parentId).toBeNull();
    expect(await run(q, 'edit.undo')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === cl.id)?.parentId).toBe(f.id);
    expect(await hash(q)).toBe(clipHash);
    // Restore after a reload brings the folder back closed, with its clipped layer and its pass through.
    await q.click(`[data-id="${f.id}"] [data-testid="folder-arrow"]`);
    const shape = (x: State) => x.layers.map((l) => ({ id: l.id, kind: l.kind, parentId: l.parentId, clip: l.clip, open: l.open, passThrough: l.passThrough, blendMode: l.blendMode }));
    const want = shape(await state(q));
    await q.evaluate(() => (window as unknown as Win).fpe.saveNow());
    await q.reload();
    await q.waitForFunction(() => !!(window as unknown as Win).fpe);
    await q.waitForSelector('[data-testid="restore"]:not([hidden])', { timeout: 15_000 });
    await q.click('[data-testid="restore-yes"]');
    await q.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent?.includes('Brought back'), null, { timeout: 15_000 });
    expect(shape(await state(q))).toEqual(want);
    expect(await hash(q)).toBe(clipHash);
    expect(await rowIds(q)).toEqual([f.id, s.layers[0].id]);
    expect(errors).toEqual([]);
  });

  it('Put in a folder from the Layer menu; the folder carries its layer through X in Properties and Align, one undo each; the card has labelled actions', async () => {
    const q = await open(1440, 900);
    await q.evaluate(() => (window as unknown as Win).fpe.newDocument(120, 80, '#808080'));
    expect(await run(q, 'layer.new')).toBe(true);
    expect(await run(q, 'tool.default-colors')).toBe(true);
    await select(q, 10, 10, 20, 20);
    expect(await run(q, 'edit.fill')).toBe(true);
    expect(await run(q, 'select.none')).toBe(true);
    // The Layers card as in the approved layout: Blend and Opacity on top, the count by the title, four actions with words and More.
    for (const [t, w] of [['layer-add', 'New'], ['layer-mask-add', 'Mask'], ['layer-duplicate', 'Copy'], ['layer-delete', 'Delete'], ['layer-more', 'More']]) {
      expect((await q.textContent(`[data-testid="${t}"]`))?.trim()).toBe(w);
    }
    expect(await q.locator('[data-testid="layer-top"] [data-testid="layer-blend"]').count()).toBe(1);
    expect(await q.locator('[data-testid="layer-top"] [data-testid="layer-opacity"]').count()).toBe(1);
    expect(await q.textContent('[data-testid="layer-count"]')).toBe('2');
    // Put in a folder from the menu bar: Layer > New > Put in a new folder.
    await q.click('[data-testid="menu-top-layer"]');
    await q.hover('[data-testid="sub-layer-new"]');
    await q.click('[data-testid="mi-layer.group"]');
    const s = await state(q), f = s.layers.find((l) => l.kind === 'folder'), kid = s.layers.find((l) => !!f && l.parentId === f.id);
    if (!f || !kid) throw new Error('no folder from the menu');
    expect(await q.textContent('[data-testid="layer-count"]')).toBe('3');
    const start = await hash(q), x0 = kid.x;
    expect((await px(q, 12, 12)).slice(0, 3)).toEqual([0, 0, 0]);
    // X in Properties moves the folder with its layer: one step, and undo brings the exact picture back.
    await pick(q, (l) => l.id === f.id);
    const xs = '[data-testid="folder-props"] [data-testid="prop-x"]';
    await q.waitForSelector(xs);
    expect(await q.inputValue(xs)).toBe(String(x0));
    await q.fill(xs, String(x0 + 15));
    await q.locator(xs).dispatchEvent('change');
    await expect.poll(async () => (await state(q)).layers.find((l) => l.id === kid.id)?.x).toBe(x0 + 15);
    expect((await px(q, 12, 12)).slice(0, 3)).toEqual([128, 128, 128]);
    expect((await px(q, 40, 15)).slice(0, 3)).toEqual([0, 0, 0]);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect((await state(q)).layers.find((l) => l.id === kid.id)?.x).toBe(x0);
    expect(await hash(q)).toBe(start);
    // Align right on the folder lines up what is inside it with the picture's right edge.
    expect(await run(q, 'layer.align-right')).toBe(true);
    await expect.poll(async () => (await state(q)).layers.find((l) => l.id === kid.id)?.x).toBe(x0 + 90);
    expect((await px(q, 115, 15)).slice(0, 3)).toEqual([0, 0, 0]);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect(await hash(q)).toBe(start);
    // The rest of the actions sit behind More.
    await q.click('[data-testid="layer-more"]');
    expect(await q.locator('.fpe-pop [data-tipcmd="layer.backward"]').count()).toBe(1);
    expect(await q.locator('.fpe-pop [data-tipcmd="layer.group"]').count()).toBe(1);
    await q.keyboard.press('Escape');
  });

  it('on a phone a long press on a layer inside a folder offers Take out of the folder, and it works', async () => {
    const q = await open(390, 844, true);
    await folderDoc(q, false);
    await q.tap('[data-testid="btn-layers"]');
    await q.waitForSelector('[data-testid="dock"][data-state="half"]');
    // Press only once the row has stopped moving (the same box at two looks 120 ms apart), a thumb at its centre lands on it,
    // the thumbnails are drawn and the tap that opened the sheet is well over (the S1 phone test pressed only after a shot).
    const inner = '[data-testid="layer-row"][data-depth="1"] [data-testid="layer-select"]';
    await q.waitForFunction((s) => {
      const el = document.querySelector(s), w = window as unknown as { lastBox?: string };
      if (!el) return false;
      const r = el.getBoundingClientRect(), k = `${r.x},${r.y},${r.width},${r.height}`, still = w.lastBox === k;
      w.lastBox = k;
      return still && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-testid="layer-select"]') === el;
    }, inner, { polling: 120, timeout: 10_000 });
    await thumbs(q);
    await q.waitForTimeout(400);
    const name = await q.locator(inner).boundingBox();
    if (!name) throw new Error('no row inside the folder');
    const x = name.x + name.width / 2, y = name.y + name.height / 2;
    const cdp = await q.context().newCDPSession(q);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await q.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // If the sheet does not open, keep a picture of the screen for the next look.
    await q.waitForSelector('[data-testid="sheet-layer-actions"][data-state="open"]', { timeout: 8_000 })
      .catch(async (e: unknown) => { await q.screenshot({ path: join(OUT, 'w6-s2-phone-390-no-sheet.png') }); throw e; });
    // The lift that ends the press must not reach the sheet now under the finger: before the fix it ran "Add a mask" and
    // closed the sheet (CI 43409787484). So the sheet stays open and the pressed layer gains no mask.
    await q.waitForTimeout(300);
    expect(await q.getAttribute('[data-testid="sheet-layer-actions"]', 'data-state')).toBe('open');
    expect((await state(q)).layers.some((l) => !!l.mask)).toBe(false);
    const out = q.locator('[data-testid="layer-action-ungroup"]');
    expect(await out.getAttribute('aria-disabled')).toBeNull();
    expect(await q.locator('[data-testid="layer-action-group"]').getAttribute('aria-disabled')).toBeNull();
    expect(await q.textContent('[data-testid="sheet-layer-actions"]')).toContain('Clip to the layer below');
    await q.waitForTimeout(250);
    await thumbs(q);
    await q.screenshot({ path: join(OUT, 'w6-s2-phone-390-layer-actions.png') });
    await out.tap();
    expect((await state(q)).layers.some((l) => l.kind === 'folder')).toBe(false);
    expect(errors).toEqual([]);
  });
});
