// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The animate batch (13 Nov 2026) in a real headless Chrome: Make animation frames is reached through its ribbon home
 * with real clicks, the Animation timeline (loaded on first use) opens under the picture with one frame per layer, a
 * frame's time and the order change by typing, by its buttons and by dragging, Play runs in the preview without
 * changing the picture, and Export animation saves a GIF that plays once with the times set here. The 1440 shot goes to
 * e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts animate
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeGif } from '../../formats/src/anim';
import { reach, show } from './ribbon';

interface Fpe { run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; }
type Win = Window & { fpe: Fpe };
interface L { id: string; name: string }

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};

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
const state = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
const layers = async (p: Page): Promise<L[]> => (await state(p)).layers as L[];
const playing = async (p: Page): Promise<boolean> => ((await state(p)).anim as { playing: boolean } | null)?.playing ?? false;
const firstIs = (p: Page, id: string): Promise<unknown> => p.waitForFunction((x) => ((window as unknown as Win).fpe.state().layers as L[])[0].id === x, id);

const suite = CHROME ? describe : describe.skip;
suite('Animate batch (headless Chrome)', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    ({ server, url } = await serve());
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('makes frames by ribbon clicks; the timeline sets times, reorders, plays and exports a GIF that plays once', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    // The sample's two layers (the landscape and the sun), plus a mirrored copy of the sun: three frames.
    await p.evaluate(async () => { const f = (window as unknown as Win).fpe; f.openSample(); await f.run('layer.duplicate'); await f.run('edit.flip-layer-h'); });
    expect((await layers(p)).length).toBe(3);
    const step0 = (await state(p)).step as number;

    expect(await reach(p, 'layer.frames')).toBeLessThanOrEqual(2);
    await p.waitForSelector('[data-testid="timeline"] [data-testid="tl-frame"]');
    expect((await layers(p)).map((l) => / \(100 ms\)$/.test(l.name))).toEqual([true, true, true]);
    expect((await state(p)).step).toBe(step0 + 1);
    expect(await p.locator('[data-testid="tl-frame"]').count()).toBe(3);
    expect(await p.textContent('[data-testid="tl-count"]')).toBe('3 frames');

    // Frame 2 shows for a quarter of a second.
    const ms = p.locator('[data-testid="tl-delay"]').nth(1);
    await ms.fill('250');
    await ms.press('Tab');
    await p.waitForFunction(() => ((window as unknown as Win).fpe.state().layers as L[])[1].name.endsWith('(250 ms)'));

    // Frame 1 one place later with its button, then frame 3 dragged to the front.
    const [a, b, c] = (await layers(p)).map((l) => l.id);
    await p.locator('[data-testid="tl-right"]').first().click();
    await firstIs(p, b);
    expect((await layers(p)).map((l) => l.id)).toEqual([b, a, c]);
    await p.dragAndDrop('[data-testid="tl-frame"][data-i="2"]', '[data-testid="tl-frame"][data-i="0"]');
    await firstIs(p, c);
    expect((await layers(p)).map((l) => l.id)).toEqual([c, b, a]);

    // Play runs in the preview and never adds an undo step.
    const steps = (await state(p)).steps;
    await p.click('[data-testid="tl-play"]');
    expect(await playing(p)).toBe(true);
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(OUT, 'animate-timeline-1440.png') });
    // The timeline sits between the picture and the status bar and leaves the picture room.
    const box = await p.evaluate(() => {
      const r = (s: string): DOMRect => (document.querySelector(s) as HTMLElement).getBoundingClientRect();
      return { tl: r('[data-testid="timeline"]'), status: r('[data-testid="status"]'), stage: r('.fpe-stage'), wide: document.documentElement.scrollWidth };
    });
    expect(box.tl.bottom).toBeLessThanOrEqual(box.status.top + 1);
    expect(box.tl.height).toBeLessThanOrEqual(240);
    expect(box.stage.height).toBeGreaterThanOrEqual(300);
    expect(box.wide).toBeLessThanOrEqual(1440);
    await p.click('[data-testid="tl-play"]');
    expect(await playing(p)).toBe(false);
    expect((await state(p)).steps).toBe(steps);

    // Play once, then Export animation: the export sheet opens on GIF with each layer as a frame.
    await p.selectOption('[data-testid="tl-loop"]', '1');
    await p.click('[data-testid="tl-export"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().modal === 'export');
    expect((await state(p)).exportFormat).toBe('gif');
    await p.waitForTimeout(500);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid="export-go"]')]);
    const gif = new Uint8Array(await readFile(await dl.path()));
    expect(Buffer.from(gif.subarray(0, 6)).toString('latin1')).toBe('GIF89a');
    expect(Buffer.from(gif).includes(Buffer.from('NETSCAPE2.0'))).toBe(false);
    expect(decodeGif(gif).frames.map((f) => f.delay)).toEqual([100, 250, 100]);

    // Close, then open the timeline again from its own ribbon home.
    await p.keyboard.press('Escape');
    await p.click('[data-testid="tl-close"]');
    expect(await p.locator('[data-testid="timeline"]').count()).toBe(0);
    // The Arrange layers tab is still open from Make animation frames; otherwise open it the way a person does.
    if (!(await p.locator('[data-testid="ribbon-body"] [data-testid="ri-panel.timeline"]').isVisible())) await show(p, 'panel.timeline');
    await p.click('[data-testid="ribbon-body"] [data-testid="ri-panel.timeline"]');
    await p.waitForSelector('[data-testid="timeline"] [data-testid="tl-frame"]');
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});
