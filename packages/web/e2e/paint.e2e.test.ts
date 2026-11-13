// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Batch paint in a real headless Chrome, used as a person uses it: each brush extra is opened from its ribbon home with
 * real clicks, and real mouse strokes paint the picture. Symmetry around the centre and a steady-hand line at 1440 (shot
 * paint-radial-stabilized-1440.png), then seamless tile painting and speed dynamics. Screenshots go to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts paint
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { show } from './ribbon';

interface Fpe {
  run(id: string): Promise<boolean>; state(): Record<string, unknown>; newDocument(w: number, h: number, bg?: string | null): void;
  toClient(x: number, y: number): { x: number; y: number } | null; sample(x: number, y: number, only?: boolean): number[] | null;
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

async function open(w: number, hgt: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}px: ${e.message}`));
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.addStyleTag({ content: '[data-testid="toast"]{visibility:hidden!important}' });
  return p;
}
/** A new white picture, w x h. */
async function blank(p: Page, w: number, hgt: number): Promise<void> {
  await p.evaluate(([a, b]) => (window as unknown as Win).fpe.newDocument(a, b, '#ffffff'), [w, hgt] as const);
  await p.waitForTimeout(150);
}
const state = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
async function at(p: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const c = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.toClient(a, b), [x, y] as const);
  if (!c) throw new Error('no picture');
  return c;
}
/** A real mouse stroke through picture points: one pointer event per point. */
async function stroke(p: Page, pts: [number, number][]): Promise<void> {
  const first = await at(p, pts[0][0], pts[0][1]);
  await p.mouse.move(first.x, first.y);
  await p.mouse.down();
  for (const [x, y] of pts.slice(1)) { const c = await at(p, x, y); await p.mouse.move(c.x, c.y); }
  await p.mouse.up();
  await p.waitForTimeout(120);
}
/** True when the picture at x, y is no longer the white it started as. */
async function painted(p: Page, x: number, y: number): Promise<boolean> {
  const px = await p.evaluate(([a, b]) => (window as unknown as Win).fpe.sample(a, b), [x, y] as const);
  return !!px && px[0] + px[1] + px[2] < 700;
}
/** Open the Brush extras sheet from the command's ribbon home. */
async function extras(p: Page, id: string): Promise<void> {
  await show(p, id);
  await p.click(`[data-testid="ri-${id}"]`);
  await p.waitForSelector('[data-testid="sheet-paint-extras"] [data-testid="pk-status"]', { state: 'visible' });
}
async function setSlider(p: Page, testid: string, v: number): Promise<void> {
  await p.$eval(`[data-testid="${testid}"]`, (el, val) => {
    const i = el as HTMLInputElement;
    i.value = String(val);
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
}
const close = (p: Page): Promise<void> => p.click('[data-testid="close-paint-extras"]');

const suite = CHROME ? describe : describe.skip;
suite('Paint & draw: brush extras (headless Chrome)', () => {
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

  it('symmetry around the centre and a steady-hand line, from the ribbon, one undo step per stroke', async () => {
    const p = await open(1440, 900);
    await blank(p, 800, 600);
    await extras(p, 'paint.symmetry');
    await p.click('[data-testid="pk-mirror-radial"]');
    expect(await p.textContent('[data-testid="pk-status"]')).toContain('6 around the centre');
    await close(p);
    expect((await state(p)).tool).toBe('brush');
    const s0 = (await state(p)).steps as number;
    await stroke(p, [[520, 150], [530, 160], [540, 170], [550, 185], [560, 200]]);
    expect((await state(p)).steps).toBe(s0 + 1);
    // the half-turn copy of (520, 150) about the centre (400, 300) is (280, 450); a 4-way mirror would also paint (520, 450)
    expect([await painted(p, 520, 150), await painted(p, 280, 450), await painted(p, 520, 450), await painted(p, 400, 300)]).toEqual([true, true, false, false]);

    // Steady hand, pulled string 30 px: a zig-zag 25 px either side of y 520 comes out as a calm line near 520.
    await extras(p, 'paint.stabilizer');
    await p.click('[data-testid="pk-mirror-off"]');
    await p.click('[data-testid="pk-steady-string"]');
    await setSlider(p, 'pk-string', 30);
    expect(await p.textContent('[data-testid="pk-status"]')).toContain('string 30 px');
    await close(p);
    const zig: [number, number][] = [];
    for (let i = 0; i <= 30; i++) zig.push([100 + i * 8, 520 + (i === 0 ? 0 : i % 2 ? -25 : 25)]);
    await stroke(p, zig);
    expect((await state(p)).steps).toBe(s0 + 2);
    // A plain brush (24 px) would paint (188, 491) at the zig-zag's peak there (y 495); the steady line stays near 520,
    // and finishes where the mouse let go, (340, 545).
    expect([await painted(p, 188, 520), await painted(p, 188, 491), await painted(p, 188, 549), await painted(p, 340, 545)]).toEqual([true, false, false, true]);
    await p.screenshot({ path: join(OUT, 'paint-radial-stabilized-1440.png') });
    expect(errors).toEqual([]);
  }, 90_000);

  it('seamless tile painting wraps at the edge, and speed thins a fast stroke', async () => {
    const p = await open(1440, 900);
    await blank(p, 400, 300);
    await extras(p, 'paint.wrap-around');
    await p.click('[data-testid="pk-wrap-on"]');
    await close(p);
    const s0 = (await state(p)).steps as number;
    await stroke(p, [[370, 150], [385, 150], [400, 150], [415, 150], [430, 150]]);
    expect((await state(p)).steps).toBe(s0 + 1);
    // what left the right edge came back in at the left
    expect([await painted(p, 390, 150), await painted(p, 10, 150), await painted(p, 200, 150)]).toEqual([true, true, false]);

    await extras(p, 'paint.dynamics');
    await p.click('[data-testid="pk-wrap-off"]');
    await p.click('[data-testid="pk-dyn-on"]');
    await p.click('[data-testid="pk-size-speed"]');
    await setSlider(p, 'pk-min-size', 10);
    expect(await p.textContent('[data-testid="pk-status"]')).toContain('Pen and speed');
    await close(p);
    const slow: [number, number][] = [];
    for (let x = 50; x <= 150; x += 2) slow.push([x, 60]);
    await stroke(p, slow);
    await stroke(p, [[50, 220], [110, 220], [170, 220], [230, 220], [290, 220], [350, 220]]);
    expect((await state(p)).steps).toBe(s0 + 3);
    // slow: nearly the full 24 px, so 8 px off the line is painted; fast: a few px wide, so 8 px off is bare
    expect([await painted(p, 100, 68), await painted(p, 290, 220), await painted(p, 290, 228)]).toEqual([true, true, false]);
    await p.screenshot({ path: join(OUT, 'paint-wrap-speed-1440.png') });
    expect(errors).toEqual([]);
  }, 90_000);
});
