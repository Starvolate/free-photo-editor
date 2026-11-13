// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Develop RAW sheet (13 Nov 2026) in a real headless Chrome. Every develop command is reached through its ribbon
 * home with real clicks and opens the one sheet at its own section; sliders preview live and Apply keeps the change
 * as one undo step; the clipping warning shows but is never applied; a snapshot brings settings back. One 1440 shot of
 * the sheet on the sample photo goes to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts raw-looks
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reach } from './ribbon';

interface Fpe {
  commands(): { id: string; status: string }[]; run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void;
  select(x: number, y: number, w: number, h: number): void; checksum(x: number, y: number, w: number, h: number): number;
}
type Win = Window & { fpe: Fpe };
/** Each develop command and the section it opens (raw-more.ts FOCUS; not imported: commands.ts pulls in the app's CSS). */
const SECTION: Record<string, string> = {
  'raw.white-balance': 'light', 'raw.highlights': 'light', 'raw.black-white-points': 'light', 'raw.dehaze': 'light', 'raw.tone-equalizer': 'light',
  'raw.base-curve': 'light', 'raw.negative': 'light', 'raw.colour-mixer': 'colour', 'raw.colour-grading': 'colour', 'raw.clarity': 'detail',
  'raw.contrast-levels': 'detail', 'raw.hot-pixels': 'detail', 'raw.capture-sharpen': 'detail', 'raw.denoise-profiled': 'detail', 'raw.defish': 'lens',
  'raw.upright': 'lens', 'raw.vignette': 'effects', 'raw.clipping': 'check', 'raw.scopes': 'check', 'raw.snapshots': 'saved', 'raw.presets': 'saved',
};
const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};
/** Over the sun's edge, the hills and the sky of the sample photo (after flattening its two layers). */
const BOX: [number, number, number, number] = [600, 170, 320, 260];

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
const errors: string[] = [];
const sum = (p: Page): Promise<number> => p.evaluate((b) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]), BOX);
const step = async (p: Page): Promise<number> => (await p.evaluate(() => (window as unknown as Win).fpe.state().step)) as number;
async function fresh(p: Page): Promise<void> {
  await p.reload();
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.evaluate(async (b) => { const f = (window as unknown as Win).fpe; f.openSample(); await f.run('layer.flatten'); f.select(b[0], b[1], b[2], b[3]); }, BOX);
}
/** Moves a slider as a person does: its value changes and it says so. */
const slide = (p: Page, key: string, v: number): Promise<void> => p.$eval(`[data-testid="adjust-dialog"] [data-testid="ctl-${key}"]`, (el, x) => {
  (el as HTMLInputElement).value = String(x);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

const suite = CHROME ? describe : describe.skip;
suite('Develop RAW sheet (headless Chrome)', () => {
  let p: Page;
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('opens the one develop sheet at each command\'s own section, from its ribbon home', async () => {
    const ready = new Set((await p.evaluate(() => (window as unknown as Win).fpe.commands())).filter((c) => c.status === 'ready').map((c) => c.id));
    expect(Object.keys(SECTION).filter((id) => !ready.has(id))).toEqual([]);
    const wrong: string[] = [];
    for (const [id, sec] of Object.entries(SECTION)) {
      await fresh(p);
      await reach(p, id);
      await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
      const open = await p.waitForSelector(`[data-testid="dev-section-${sec}"]`, { timeout: 10_000 }).then(() => true, () => false);
      const tab = await p.getAttribute(`[data-testid="dev-tab-${sec}"]`, 'aria-selected').catch(() => null);
      if (!open || tab !== 'true') wrong.push(`${id}: ${sec}`);
      await p.click('[data-testid="adj-cancel"]');
    }
    expect(wrong).toEqual([]);
    expect(errors).toEqual([]);
  }, 300_000);

  it('previews white balance and a vignette live and applies them as one step', async () => {
    await fresh(p);
    const before = await sum(p), n = await step(p);
    await reach(p, 'raw.white-balance');
    await p.waitForSelector('[data-testid="dev-section-light"]');
    await slide(p, 'wbT', 3000);
    await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, before] as const, { timeout: 20_000 });
    await p.click('[data-testid="dev-tab-effects"]');
    await slide(p, 'vig', -80);
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(OUT, 'raw-develop-sheet.png') });
    await p.click('[data-testid="adj-apply"]');
    await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) === k + 1, n);
    expect(await sum(p)).not.toBe(before);
    expect(errors).toEqual([]);
  }, 120_000);

  it('shows the clipping warning while open and never applies it', async () => {
    await fresh(p);
    await reach(p, 'raw.clipping');
    await p.waitForSelector('[data-testid="dev-section-check"]');
    // Whites at 200 burn the bright sky, so the warning has something to mark.
    await p.click('[data-testid="dev-tab-light"]');
    await slide(p, 'wp', 200);
    await p.waitForTimeout(500);
    const marked = await sum(p);
    await p.click('[data-testid="dev-tab-check"]');
    await p.click('[data-testid="adjust-dialog"] [data-testid="ctl-clip"]');
    await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, marked] as const, { timeout: 20_000 });
    await p.waitForTimeout(500);
    const clean = await sum(p);
    await p.click('[data-testid="adjust-dialog"] [data-testid="ctl-clip"]');
    await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) === o, [BOX, marked] as const, { timeout: 20_000 });
    await p.click('[data-testid="adj-apply"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().adjust === null);
    await p.waitForTimeout(300);
    expect(await sum(p)).toBe(clean);
  }, 120_000);

  it('keeps a snapshot and brings its settings back', async () => {
    await fresh(p);
    await reach(p, 'raw.dehaze');
    await p.waitForSelector('[data-testid="dev-section-light"]');
    await slide(p, 'haze', 40);
    await p.click('[data-testid="dev-tab-saved"]');
    await p.click('[data-testid="dev-snap-keep"]');
    await p.click('[data-testid="dev-tab-light"]');
    await slide(p, 'haze', -30);
    await p.click('[data-testid="dev-tab-saved"]');
    await p.click('[data-testid="dev-snap-item"]');
    await p.click('[data-testid="dev-tab-light"]');
    expect(await p.inputValue('[data-testid="adjust-dialog"] [data-testid="ctl-haze"]')).toBe('40');
    await p.click('[data-testid="adj-cancel"]');
    expect(errors).toEqual([]);
  }, 120_000);
});
