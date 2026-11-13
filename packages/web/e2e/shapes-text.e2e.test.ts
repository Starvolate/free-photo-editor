// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shapes & text in a real headless Chrome, each path operation reached with real clicks from its ribbon home: combine
 * two shapes (merge, keep the overlap, undo), a star and a spiral, grow, mirror, copies round a centre, a wobble, and
 * join then split two outlines. The outlines are checked by their corner points.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts shapes-text
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reach } from './ribbon';

interface Paths { count: number; names: string[]; picked: string | null; anchors: number; closed: boolean[]; points: { x: number; y: number }[]; }
interface Fpe { run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; select(x: number, y: number, w: number, h: number): void; }
type Win = Window & { fpe: Fpe };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

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
const contexts: BrowserContext[] = [];
const errors: string[] = [];
async function open(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
const paths = (p: Page): Promise<Paths> => p.evaluate(() => ((window as unknown as Win).fpe.state().w3 as { paths: Paths }).paths);
const box = (s: Paths): number[] => {
  const xs = s.points.map((q) => q.x), ys = s.points.map((q) => q.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v));
};
const near = (a: number[], b: number[], tol: number): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Outlines from picture boxes (through the selection), then nothing selected. */
async function outlines(p: Page, ...boxes: [number, number, number, number][]): Promise<void> {
  await p.evaluate(async (bs) => {
    const f = (window as unknown as Win).fpe;
    f.openSample();
    for (const b of bs) { f.select(b[0], b[1], b[2], b[3]); await f.run('select.to-path'); }
    await f.run('select.none');
  }, boxes);
}
/** Run a command from its ribbon home and wait for its sheet. */
async function click(p: Page, id: string): Promise<void> {
  if (await p.isVisible('[data-testid="pathop-done"]')) await p.click('[data-testid="pathop-done"]');
  await reach(p, id);
  await p.waitForSelector(`[data-testid="pathop-sheet"][data-cmd="${id}"]`, { state: 'visible' });
}
const until = (p: Page, test: (s: Paths) => boolean, label: string): Promise<Paths> =>
  (async () => { for (let i = 0; i < 100; i++) { const s = await paths(p); if (test(s)) return s; await p.waitForTimeout(50); } throw new Error(`${label}: ${JSON.stringify(await paths(p))}`); })();
const undo = (p: Page): Promise<boolean> => p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'));

const suite = CHROME ? describe : describe.skip;
suite('Shapes & text: path operations (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
    server?.close();
    expect(errors).toEqual([]);
  });

  it('combines two overlapping squares: merge gives 8 corners round 100..400, keep the overlap gives 200..300, undo brings the merge back', async () => {
    const p = await open();
    await outlines(p, [100, 100, 200, 200], [200, 200, 200, 200]);
    expect((await paths(p)).count).toBe(2);
    await click(p, 'path.boolean');
    let s = await until(p, (x) => x.count === 1 && x.anchors === 8, 'merge');
    expect(box(s)).toEqual([100, 100, 400, 400]);
    await p.click('[data-testid="pathop-op-intersect"]');
    s = await until(p, (x) => x.count === 1 && x.anchors === 4, 'overlap');
    expect(box(s)).toEqual([200, 200, 300, 300]);
    await p.click('[data-testid="pathop-done"]');
    expect(await undo(p)).toBe(true);
    s = await until(p, (x) => x.anchors === 8, 'undo');
    expect(box(s)).toEqual([100, 100, 400, 400]);
    await p.screenshot({ path: join(OUT, 'shapes-text-boolean.png') });
  });

  it('draws a 5-point star (10 corners) and turns it into a 3-turn spiral (25 points, open)', async () => {
    const p = await open();
    await p.evaluate(() => (window as unknown as Win).fpe.openSample());
    await click(p, 'shape.spiral-star');
    let s = await until(p, (x) => x.picked === 'Star 1', 'star');
    expect([s.anchors, s.closed]).toEqual([10, [true]]);
    await p.click('[data-testid="pathop-kind-spiral"]');
    s = await until(p, (x) => x.picked === 'Spiral 1', 'spiral');
    expect([s.count, s.anchors, s.closed]).toEqual([1, 25, [false]]);
  });

  it('grows, mirrors, spins copies of and roughens a 100 px square outline, each undone before the next', async () => {
    const p = await open();
    await outlines(p, [300, 200, 100, 100]);
    await click(p, 'path.offset');
    let s = await until(p, (x) => x.anchors > 4, 'grow');
    expect(near(box(s), [290, 190, 410, 310], 1)).toBe(true);
    await undo(p);
    await click(p, 'path.mirror');
    s = await until(p, (x) => x.anchors === 4 && box(x)[2] > 450, 'mirror');
    expect(box(s)).toEqual([300, 200, 500, 300]);
    await undo(p);
    await click(p, 'path.rotate-copies');
    s = await until(p, (x) => x.anchors > 4, 'copies');
    // Six copies at 60° steps: the 60° and 120° turns reach 50·(cos 60° + sin 60°) = 68.3 px from the centre (350, 250).
    expect(near(box(s), [282, 182, 418, 318], 2)).toBe(true);
    await undo(p);
    await click(p, 'path.roughen');
    s = await until(p, (x) => x.anchors === 50, 'wobble');
    expect(s.points.every((q) => Math.min(Math.abs(q.x - 300), Math.abs(q.x - 400), Math.abs(q.y - 200), Math.abs(q.y - 300)) <= 4.01)).toBe(true);
  });

  it('joins two outlines into one, then splits it back into two', async () => {
    const p = await open();
    await outlines(p, [100, 100, 100, 100], [300, 100, 50, 50]);
    await click(p, 'path.combine');
    let s = await until(p, (x) => x.count === 1, 'join');
    expect(s.anchors).toBe(8);
    // Run again on the joined outline: one outline in two pieces, so it splits.
    await click(p, 'path.combine');
    s = await until(p, (x) => x.count === 2, 'split');
    expect(s.names.length).toBe(2);
  });
});
