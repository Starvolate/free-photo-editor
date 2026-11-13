// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The second filters batch (13 Nov 2026), census filters on the Filters & blur tab, in a real headless Chrome. Each one is reached through its ribbon home with real
 * clicks, its dialog (loaded on first use) opens, its preview changes the picture, and Apply keeps the change as one
 * undo step. Screenshots go to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts batch-filters-2
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
/** The batch, as commands.ts BATCH2_IDS lists it (not imported: commands.ts pulls in the app's CSS imports). */
const BATCH_IDS = ['filter.kaleidoscope', 'filter.alien-map', 'filter.bloom', 'filter.edge-detect', 'filter.deinterlace', 'filter.destripe',
  'filter.video-degrade', 'filter.lowlight', 'filter.bump-map', 'filter.star-burst', 'filter.blur-edge-keep', 'filter.antialias'];

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

const suite = CHROME ? describe : describe.skip;
suite('Filters batch 2 (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('reaches each batch filter by clicks, previews it, applies it as one step', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    // The census rows join the command list when the ribbon loads.
    await p.waitForFunction(() => (window as unknown as Win).fpe.commands().some((c) => c.id === 'filter.kaleidoscope'));
    const ready = new Set((await p.evaluate(() => (window as unknown as Win).fpe.commands())).filter((c) => c.status === 'ready').map((c) => c.id));
    expect(BATCH_IDS.filter((id) => !ready.has(id))).toEqual([]);
    const done: string[] = [];
    for (const id of BATCH_IDS) {
      // A fresh page and sample each time, so every filter starts from the same picture and the resting ribbon.
      await p.reload();
      await p.waitForFunction(() => !!(window as unknown as Win).fpe);
      await p.evaluate(async (b) => {
        const f = (window as unknown as Win).fpe;
        f.openSample();
        await f.run('layer.flatten');
        f.select(b[0], b[1], b[2], b[3]);
      }, BOX);
      const before = await sum(p), n = await step(p);
      await reach(p, id);
      await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
      await p.waitForFunction(([b, o]) => (window as unknown as Win).fpe.checksum(b[0], b[1], b[2], b[3]) !== o, [BOX, before] as const, { timeout: 20_000 });
      if (done.length === 0 || id === 'filter.star-burst') await p.screenshot({ path: join(OUT, `batch2-${id}.png`) });
      await p.click('[data-testid="adj-apply"]');
      await p.waitForFunction((k) => ((window as unknown as Win).fpe.state().step as number) > k, n);
      expect(await sum(p), id).not.toBe(before);
      done.push(id);
    }
    expect(done).toEqual(BATCH_IDS);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 300_000);
});
