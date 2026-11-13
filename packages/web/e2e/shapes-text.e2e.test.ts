// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shapes & text in a real headless Chrome, each path operation reached with real clicks from its ribbon home: combine
 * two shapes (merge, keep the overlap, undo), a star and a spiral, grow, mirror, copies round a centre, a wobble, and
 * join then split two outlines; then slice, in-between shapes, stitch lines, repeat and bend along a line, hatch lines, a
 * thick-and-thin line, and an outline drawn as a dashed line on a layer. The outlines are checked by their corner points.
 * Then type: words bent into an arc, a wave and straight again, and words run along an outline, each one undo step.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts shapes-text
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reach, show } from './ribbon';

interface Paths { count: number; names: string[]; picked: string | null; anchors: number; closed: boolean[]; points: { x: number; y: number }[]; }
interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; select(x: number, y: number, w: number, h: number): void;
  getInfo(): { layers: unknown[] } | null; toClient(x: number, y: number): { x: number; y: number } | null;
  checksum(x: number, y: number, w: number, h: number): number;
}
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
/** Reach a command on the ribbon and click the copy a person can see (type commands also sit in the Text tool's own strip). */
async function go(p: Page, id: string): Promise<void> {
  const n = await show(p, id);
  await p.locator(n ? `[data-testid="ri-${id}"]:visible` : `[data-cmd="${id}"]:visible`).first().click();
}
type L = { x: number; y: number; width: number; height: number };
/** Typing helpers: the top layer, waiting for it to change, and adding words with real clicks and keys. */
function typing(p: Page): { at: (i: number) => Promise<L>; last: () => Promise<L>; wait: (test: (l: L) => boolean, label: string, i?: number) => Promise<L>; write: (x: number, y: number, words: string) => Promise<L> } {
  const at = (i: number): Promise<L> => p.evaluate((k) => (window as unknown as Win).fpe.getInfo()!.layers.at(k) as L, i);
  const last = (): Promise<L> => at(-1);
  const wait = async (test: (l: L) => boolean, label: string, i = -1): Promise<L> => {
    for (let n = 0; n < 100; n++) { const l = await at(i); if (test(l)) return l; await p.waitForTimeout(50); }
    throw new Error(`${label}: ${JSON.stringify(await at(i))}`);
  };
  const write = async (x: number, y: number, words: string): Promise<L> => {
    await p.evaluate(() => (window as unknown as Win).fpe.run('tool.type'));
    const c = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as const);
    await p.mouse.click(c!.x, c!.y);
    await p.waitForSelector('[data-testid="text-edit"]');
    await p.keyboard.type(words);
    await p.click('[data-testid="text-done"]');
    await p.waitForTimeout(150);
    return last();
  };
  return { at, last, wait, write };
}
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
  it('slices, blends, stitches, repeats and bends with two outlines, each undone before the next', async () => {
    const p = await open();
    await outlines(p, [100, 100, 200, 200], [200, 200, 200, 200]);
    await click(p, 'path.divide');
    // The square 100..300 cut along the edge of 200..400: the part outside (an L, 6 corners) and the overlap 200..300.
    let s = await until(p, (x) => x.count === 2 && x.names.every((n) => n.includes('piece')), 'divide');
    expect([s.anchors, box(s)]).toEqual([6, [100, 100, 300, 300]]);
    await p.click('[data-testid="pathop-done"]');
    await undo(p);
    await until(p, (x) => x.count === 2 && !x.names.some((n) => n.includes('piece')), 'undo divide');

    const q = await open();
    await outlines(q, [100, 100, 200, 200], [150, 150, 100, 100]);
    await click(q, 'path.interpolate');
    // Three in-between squares from 100..300 to 150..250: 5 squares of 4 corners in one outline.
    s = await until(q, (x) => x.count === 1 && x.anchors === 20, 'interpolate');
    expect(box(s)).toEqual([100, 100, 300, 300]);
    await undo(q);
    await click(q, 'path.stitch');
    s = await until(q, (x) => x.count === 1 && x.closed.length === 14, 'stitch');
    expect(s.closed.filter((c) => !c).length).toBe(12);
    await undo(q);

    const r = await open();
    await outlines(r, [100, 100, 20, 20], [300, 100, 200, 200]);
    await click(r, 'path.pattern-along');
    // A 20 px square round a 200 px square ring (800 px round): 40 copies, all inside a band 10 px either side of the ring.
    s = await until(r, (x) => x.count === 1 && x.closed.length === 40, 'pattern');
    expect(near(box(s), [290, 90, 510, 310], 1)).toBe(true);
    await undo(r);
    await click(r, 'path.bend');
    s = await until(r, (x) => x.count === 1 && x.picked === 'Bent shape 1', 'bend');
    expect(near(box(s), [290, 90, 510, 310], 1)).toBe(true);
  });

  it('hatches a square, turns it into a thick-and-thin shape, and draws it as a dashed line on a new layer', async () => {
    const p = await open();
    await outlines(p, [300, 200, 300, 200]);
    await click(p, 'path.hatches');
    let s = await until(p, (x) => x.closed.length > 10, 'hatches');
    expect(s.closed[0]).toBe(true);
    expect(s.closed.slice(1).every((c) => !c)).toBe(true);
    expect(near(box(s), [300, 200, 600, 400], 1)).toBe(true);
    await undo(p);
    await click(p, 'path.power-stroke');
    // A closed ring becomes two rings (outside and inside edge of the band).
    s = await until(p, (x) => x.closed.length === 2, 'power stroke');
    expect(s.closed).toEqual([true, true]);
    await undo(p);
    const layers = (): Promise<number> => p.evaluate(() => (window as unknown as Win).fpe.getInfo()?.layers.length ?? 0);
    const before = await layers();
    await click(p, 'path.stroke-style');
    await p.waitForFunction((n) => ((window as unknown as Win).fpe.getInfo()?.layers.length ?? 0) === n + 1, before);
    // Another pattern redraws the same layer rather than adding one.
    await p.click('[data-testid="pathop-dash-dashdot"]');
    expect(await layers()).toBe(before + 1);
    await p.click('[data-testid="pathop-done"]');
    await p.screenshot({ path: join(OUT, 'shapes-text-paths2.png') });
  });

  it('bends words into an arc, a wave and straight again, then runs other words along an outline; one undo step each', async () => {
    const p = await open();
    await outlines(p, [520, 300, 200, 160]);
    const { last, wait, write } = typing(p);
    const flat = await write(80, 140, 'Bend me round');
    await go(p, 'type.warp');
    await p.waitForSelector('[data-testid="typewarp-sheet"][data-cmd="type.warp"]', { state: 'visible' });
    // A half-way arc drops both ends, so the layer grows taller than the straight words.
    const arc = await wait((l) => l.height > flat.height + 20, 'arc');
    await p.click('[data-testid="typewarp-wave"]');
    const wave = await wait((l) => l.height !== arc.height, 'wave');
    await p.click('[data-testid="typewarp-none"]');
    // Straight again draws exactly the words as they were: the text stayed text.
    await wait((l) => l.width === flat.width && l.height === flat.height && l.x === flat.x && l.y === flat.y, 'straight');
    expect(await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'))).toBe(true);
    await wait((l) => l.height === wave.height && l.width === wave.width, 'undo to the wave');
    await go(p, 'type.warp');
    await p.click('[data-testid="typewarp-arc"]');
    const arc2 = await wait((l) => l.height === arc.height && l.width === arc.width, 'arc again');
    await p.click('[data-testid="typewarp-done"]');
    // Typing in bent words: the picture keeps the bend while you type, and a plain note says so beside the straight box.
    await p.evaluate(() => (window as unknown as Win).fpe.run('tool.type'));
    const mid = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [arc2.x + arc2.width / 2, arc2.y + arc2.height / 2] as const);
    await p.mouse.click(mid!.x, mid!.y);
    await p.waitForSelector('[data-testid="text-bent-note"]', { state: 'visible' });
    await p.keyboard.press('Control+End');
    await p.keyboard.type(' now');
    await wait((l) => l.height > flat.height + 20 && l.width !== arc2.width, 'typing keeps the bend');
    await p.click('[data-testid="text-done"]');

    const line = await write(560, 520, 'Words along a line');
    await go(p, 'type.path');
    await p.waitForSelector('[data-testid="typewarp-sheet"][data-cmd="type.path"]', { state: 'visible' });
    // About 420 px of words round the 200 x 160 outline (520..720 x 300..460): they turn at least one corner.
    const run = await wait((l) => l.height > line.height + 40, 'along');
    expect(run.x).toBeGreaterThanOrEqual(450);
    expect(run.y).toBeGreaterThanOrEqual(230);
    expect(run.x + run.width).toBeLessThanOrEqual(950);
    expect(run.y + run.height).toBeLessThanOrEqual(610);
    expect(await p.evaluate(() => (window as unknown as Win).fpe.run('edit.undo'))).toBe(true);
    await wait((l) => l.x === line.x && l.height === line.height, 'undo along');
    expect(await p.evaluate(() => (window as unknown as Win).fpe.run('edit.redo'))).toBe(true);
    await wait((l) => l.x === run.x && l.height === run.height, 'redo along');
    await p.click('[data-testid="typewarp-done"]');
    await p.screenshot({ path: join(OUT, 'shapes-text-type.png') });
  });

  it('up-down text, sharp letter edges, find and replace across text layers, and letters traced into an outline; one undo step each', async () => {
    const p = await open();
    await p.evaluate(() => (window as unknown as Win).fpe.openSample());
    const { at, wait, write } = typing(p);
    const a = await write(80, 140, 'Find the cat');
    const b = await write(80, 420, 'cat and CAT');
    // Find and replace looks through every text layer; capitals are ignored by default, so three places change in two layers.
    await go(p, 'type.find');
    await p.waitForSelector('[data-testid="typewarp-sheet"][data-cmd="type.find"]', { state: 'visible' });
    await p.fill('[data-testid="typefind-find"]', 'cat');
    await p.fill('[data-testid="typefind-put"]', 'elephant');
    await p.click('[data-testid="typefind-go"]');
    expect(await p.textContent('[data-testid="typefind-result"]')).toContain('Changed 3 places in 2 text layers');
    await wait((l) => l.width > a.width + 40, 'first layer longer', -2);
    await wait((l) => l.width > b.width + 80, 'second layer longer');
    expect(await undo(p)).toBe(true);
    await wait((l) => l.width === a.width, 'one undo: first back', -2);
    await wait((l) => l.width === b.width, 'one undo: second back');
    await p.click('[data-testid="typewarp-done"]');
    // Sharp edges change the letters' pixels at once; Smooth edges brings back exactly the same pixels.
    const sum = (): Promise<number> => p.evaluate(([x, y, w, h]) => (window as unknown as Win).fpe.checksum(x, y, w, h), [b.x, b.y, b.width, b.height] as const);
    const soft = await sum();
    await go(p, 'type.smooth');
    await p.waitForSelector('[data-testid="typewarp-sheet"][data-cmd="type.smooth"]', { state: 'visible' });
    await expect.poll(sum).not.toBe(soft);
    await p.click('[data-testid="typesmooth-on"]');
    await expect.poll(sum).toBe(soft);
    await p.click('[data-testid="typewarp-done"]');
    // Up-down: the picked words stand one under another, so the layer grows taller than it is wide; undo lays them back.
    await go(p, 'type.add-vertical');
    await wait((l) => l.height > l.width && l.height > b.height * 4, 'up-down');
    expect(await undo(p)).toBe(true);
    await wait((l) => l.width === b.width && l.height === b.height, 'undo up-down');
    // Turn text into a shape: one new outline round the letters, the text layer unchanged.
    const before = await paths(p);
    await go(p, 'type.to-shape');
    const traced = await until(p, (s) => s.count === before.count + 1, 'traced');
    expect(traced.names.some((n) => n.startsWith('Letters: cat and'))).toBe(true);
    expect(traced.anchors).toBeGreaterThan(20);
    const [x0, y0, x1, y1] = box(traced);
    expect(x0).toBeGreaterThanOrEqual(b.x - 2);
    expect(x1).toBeLessThanOrEqual(b.x + b.width + 2);
    expect(y0).toBeGreaterThanOrEqual(b.y - 2);
    expect(y1).toBeLessThanOrEqual(b.y + b.height + 2);
    const kept = await at(-1);
    expect([kept.x, kept.y, kept.width, kept.height]).toEqual([b.x, b.y, b.width, b.height]);
    await p.screenshot({ path: join(OUT, 'shapes-text-type2.png') });
  });
});
