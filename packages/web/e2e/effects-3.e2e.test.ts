// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Batch effects 3 in a real headless Chrome, each reached through its ribbon home with real clicks (as a person does):
 * - a raised edge on a tile of the photo: its size changes in Properties, undo, redo, hide it, and Restore after a reload
 *   brings it back; then a satin sheen on top, and the 1440 shot (batch-effects-3-1440.png);
 * - blur as an effect, show by brightness (its points stay in order), a ready-made Saved look put on the layer (and undone),
 *   and a colour fade layer and a pattern layer with their settings in Properties.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts effects-3
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reach } from './ribbon';

interface State { layers: { id: string; kind: string }[]; modal: string | null; }
interface Fpe {
  run(id: string): Promise<boolean>; state(): State; flatHash(): Promise<string>; openSample(): void;
  select(x: number, y: number, w: number, h: number): void; saveNow(): Promise<void>;
}
type Win = Window & { fpe: Fpe };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const state = (p: Page): Promise<State> => p.evaluate(() => (window as unknown as Win).fpe.state());
const hash = (p: Page): Promise<string> => p.evaluate(() => (window as unknown as Win).fpe.flatHash());
/**
 * Polls the picture's hash from Node until `ok` holds (effects draw once their lazy module is in). Not waitForFunction: it
 * calls its predicate without awaiting it, so an async predicate's Promise counts as true on the first poll and nothing waits.
 */
async function until(p: Page, ok: (x: string) => boolean, what: string): Promise<string> {
  for (const end = Date.now() + 15_000; ; await p.waitForTimeout(100)) {
    const x = await hash(p);
    if (ok(x)) return x;
    if (Date.now() > end) throw new Error(`${what}: the picture is still ${x.slice(0, 12)} after 15 s`);
  }
}
/** Waits until the picture differs from `than`, and returns the new hash. */
const changed = (p: Page, than: string): Promise<string> => until(p, (x) => x !== than, `waiting for a change from ${than.slice(0, 12)}`);
/** Moves a range control the way a drag ends: input, then change. */
const slide = (p: Page, sel: string, v: number): Promise<void> => p.$eval(sel, (el, x) => {
  const i = el as HTMLInputElement;
  i.value = String(x);
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
/**
 * A tile of the sample photo on its own layer: the shape the effects light. The sample opens with its Sun layer active,
 * which is empty there, so it is flattened first and the tile is a real piece of the photo.
 */
async function tile(p: Page): Promise<string> {
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  expect(await run(p, 'layer.flatten')).toBe(true);
  await p.evaluate(() => (window as unknown as Win).fpe.select(300, 180, 300, 200));
  expect(await run(p, 'layer.new-copy')).toBe(true);
  await run(p, 'select.none');
  return hash(p);
}

const suite = CHROME ? describe : describe.skip;
suite('Batch effects 3 (headless Chrome)', () => {
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

  it('a raised edge from the ribbon: its size in Properties, undo, redo, hide it, Restore after a reload, then a satin sheen and the 1440 shot', async () => {
    const q = await open(1440, 900);
    const plain = await tile(q);
    await reach(q, 'layer.fx-bevel');
    const sec = '[data-testid="fx-props"] [data-testid="fx-bevel-0"]', size = `${sec} [data-testid="ctl-size"]`;
    await q.waitForSelector(size);
    const first = await changed(q, plain);
    await slide(q, size, 14);
    const bigger = await changed(q, first);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect(await hash(q)).toBe(first);
    expect(await run(q, 'edit.redo')).toBe(true);
    expect(await hash(q)).toBe(bigger);
    await q.waitForSelector(`${sec} [data-testid="fx-on"]`);
    await q.click(`${sec} [data-testid="fx-on"]`);
    expect(await hash(q)).toBe(plain);
    await q.waitForSelector(`${sec} [data-testid="fx-on"]`);
    await q.click(`${sec} [data-testid="fx-on"]`);
    expect(await hash(q)).toBe(bigger);
    await q.evaluate(() => (window as unknown as Win).fpe.saveNow());
    await q.reload();
    await q.waitForFunction(() => !!(window as unknown as Win).fpe);
    await q.waitForSelector('[data-testid="restore"]:not([hidden])', { timeout: 15_000 });
    await q.click('[data-testid="restore-yes"]');
    await q.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent?.includes('Brought back'), null, { timeout: 15_000 });
    await until(q, (x) => x === bigger, 'Restore bringing the raised edge back');
    await reach(q, 'layer.fx-satin');
    await q.waitForSelector('[data-testid="fx-props"] [data-testid="fx-satin-0"] [data-testid="ctl-distance"]');
    await changed(q, bigger);
    await q.waitForSelector(sec);
    await q.screenshot({ path: join(OUT, 'batch-effects-3-1440.png') });
    expect(errors).toEqual([]);
  });

  it('blur as an effect, show by brightness, a Saved look, and colour fade and pattern layers, each from the ribbon', async () => {
    const q = await open(1440, 900);
    const plain = await tile(q);
    await reach(q, 'layer.fx-blur');
    await q.waitForSelector('[data-testid="fx-props"] [data-testid="fx-blur-0"] [data-testid="ctl-size"]');
    const blurred = await changed(q, plain);
    await reach(q, 'layer.blend-if');
    const bi = '[data-testid="fx-props"] [data-testid="fx-blendIf-0"]';
    await q.waitForSelector(`${bi} [data-testid="ctl-s1"]`);
    const shown = await changed(q, blurred);
    // Moving "fully shown from" past "fully shown up to" pushes it along, so the range stays in order.
    await slide(q, `${bi} [data-testid="ctl-s1"]`, 200);
    await q.waitForSelector(`${bi} [data-testid="ctl-s2"]`);
    expect(await q.$eval(`${bi} [data-testid="ctl-s2"]`, (el) => Number((el as HTMLInputElement).value))).toBeGreaterThanOrEqual(200);
    await changed(q, shown);
    await reach(q, 'panel.styles');
    await q.waitForSelector('[data-testid="sheet-looks"] [data-testid="look-use-raised-and-shiny"]', { state: 'visible' });
    expect((await state(q)).modal).toBe('looks');
    const before = await hash(q);
    await q.click('[data-testid="sheet-looks"] [data-testid="look-use-raised-and-shiny"]');
    await q.waitForSelector('[data-testid="fx-props"] [data-testid="fx-bevel-0"]');
    expect(await q.$('[data-testid="fx-props"] [data-testid="fx-blur-0"]')).toBeNull();
    const looked = await changed(q, before);
    expect(await run(q, 'edit.undo')).toBe(true);
    expect(await hash(q)).toBe(before);
    expect(await run(q, 'edit.redo')).toBe(true);
    expect(await hash(q)).toBe(looked);
    const n = (await state(q)).layers.length;
    await reach(q, 'layer.fill-gradient');
    await q.waitForSelector('[data-testid="fill-props"] [data-testid="ctl-angle"]');
    const faded = await changed(q, looked);
    expect((await state(q)).layers.length).toBe(n + 1);
    await slide(q, '[data-testid="fill-props"] [data-testid="ctl-angle"]', 0);
    const turned = await changed(q, faded);
    await reach(q, 'layer.fill-pattern');
    await q.waitForSelector('[data-testid="fill-props"] [data-testid="ctl-pattern"]');
    await changed(q, turned);
    expect((await state(q)).layers.slice(-2).map((l) => l.kind)).toEqual(['fill', 'fill']);
    expect(errors).toEqual([]);
  });
});
