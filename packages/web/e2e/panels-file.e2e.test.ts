// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The panels-and-file batch in a real headless Chrome, each new function once with real clicks from its ribbon home:
 * Open from a web link (a picture the site shares opens; a site that blocks sharing and a web page each get their plain
 * sentence), Print (the printer gets the picture at its real size), Save each layer as a file (one ZIP, one PNG per
 * layer), Take a photo (Chrome's fake camera; the camera stops when the photo is taken and when the sheet is closed).
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts panels-file
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { show } from './ribbon';
import { decodePng, encodePng } from '@free-photoeditor/formats/png';
import { unzipSync } from '@free-photoeditor/formats/zip';

interface Fpe { run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; getInfo(): { layers: unknown[]; width: number; height: number } | null; }
type Win = Window & { fpe: Fpe; __n: { dl: number; print: number }; __last: string };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const PIC = (() => {
  const data = new Uint8ClampedArray(24 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 40; data[i + 1] = 160; data[i + 2] = 220; data[i + 3] = 255; }
  return Buffer.from(encodePng({ width: 24, height: 16, data }));
})();

/** The editor and its test picture, plus a second origin that serves the same picture without allowing sharing (no CORS). */
function serve(root: boolean): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/web-pic.png') { res.writeHead(200, { 'content-type': 'image/png' }).end(PIC); return; }
    if (path === '/a-page') { res.writeHead(200, { 'content-type': 'text/html' }).end('<p>A page</p>'); return; }
    if (!root) { res.writeHead(404).end(); return; }
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
/** Runs in every frame: downloads and the print window are counted instead of happening. */
function stubs(): void {
  const top = window.top as unknown as Win, click = HTMLElement.prototype.click;
  if (window === window.top) { top.__n = { dl: 0, print: 0 }; top.__last = ''; }
  window.print = () => { top.__n.print++; };
  HTMLElement.prototype.click = function (this: HTMLElement): void {
    if (this instanceof HTMLAnchorElement && this.download) { top.__n.dl++; top.__last = this.href; return; }
    click.call(this);
  };
}

let browser: Browser;
let main: Server;
let other: Server;
let url = '';
let away = '';
const contexts: BrowserContext[] = [];
const errors: string[] = [];
async function open(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  await ctx.grantPermissions(['camera'], { origin: url.replace(/\/$/, '') });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(stubs);
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
const info = (p: Page) => p.evaluate(() => (window as unknown as Win).fpe.getInfo());
const tabs = async (p: Page): Promise<number> => (await p.evaluate(() => (window as unknown as Win).fpe.state())).tabs as number;
async function clickHome(p: Page, id: string): Promise<void> {
  await show(p, id);
  await p.click(`[data-testid="ri-${id}"]`);
}

const suite = CHROME ? describe : describe.skip;
suite('Panels and file batch (headless Chrome)', () => {
  beforeAll(async () => {
    ({ server: main, url } = await serve(true));
    ({ server: other, url: away } = await serve(false));
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
    main?.close();
    other?.close();
    expect(errors).toEqual([]);
  });

  it('opens a picture from a web link, and says plainly when a site blocks it or the link is a page', async () => {
    const p = await open();
    const ask = async (link: string): Promise<void> => {
      if (!(await p.isVisible('[data-testid="url-input"]'))) await clickHome(p, 'file.open-url');
      await p.fill('[data-testid="url-input"]', link);
      await p.click('[data-testid="url-open"]');
    };
    await ask(away + 'web-pic.png');
    await p.waitForFunction(() => /CORS/.test(document.querySelector('[data-testid="url-status"]')?.textContent ?? ''));
    expect(await tabs(p)).toBe(0);
    await ask(url + 'a-page');
    await p.waitForFunction(() => /web page, not a picture/.test(document.querySelector('[data-testid="url-status"]')?.textContent ?? ''));
    await ask(url + 'web-pic.png');
    await p.waitForFunction(() => ((window as unknown as Win).fpe.state().tabs as number) === 1);
    expect(await info(p)).toMatchObject({ width: 24, height: 16 });
  }, 60_000);

  it('prints the picture at its real size', async () => {
    const p = await open();
    await p.evaluate(() => (window as unknown as Win).fpe.openSample());
    const d = await info(p);
    await clickHome(p, 'file.print');
    await p.click('[data-testid="print-size"]');
    await p.click('[data-testid="print-go"]');
    await p.waitForSelector('[data-testid="print-frame"][data-ready="1"]', { state: 'attached' });
    const printed = await p.evaluate(() => {
      const fr = document.querySelector<HTMLIFrameElement>('[data-testid="print-frame"]'), img = fr?.contentDocument?.images[0];
      return { w: img?.naturalWidth, h: img?.naturalHeight, css: fr?.contentDocument?.querySelector('style')?.textContent ?? '', n: Number(fr?.dataset.printed ?? 0) };
    });
    expect([printed.w, printed.h, printed.n]).toEqual([d?.width, d?.height, 1]);
    expect(printed.css).toMatch(/width:[\d.]+mm;height:[\d.]+mm/);
  }, 60_000);

  it('saves each layer as its own PNG in one ZIP', async () => {
    const p = await open();
    await p.evaluate(async () => { const f = (window as unknown as Win).fpe; f.openSample(); await f.run('layer.new'); });
    const d = await info(p);
    await clickHome(p, 'file.export-layers');
    await p.waitForFunction(() => (window as unknown as Win).__n.dl === 1);
    const bytes = await p.evaluate(async () => Array.from(new Uint8Array(await (await fetch((window as unknown as Win).__last)).arrayBuffer())));
    const files = unzipSync(new Uint8Array(bytes)), names = Object.keys(files).sort();
    expect(names.length).toBe(d?.layers.length);
    expect(names.every((n) => n.endsWith('.png'))).toBe(true);
    const first = decodePng(files[names[0]]);
    expect([first.width, first.height]).toEqual([d?.width, d?.height]);
  }, 60_000);

  it('takes a photo with the camera into a new tab, and stops the camera when the sheet closes', async () => {
    const p = await open();
    const ended = () => p.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="camera-video"]'), s = v?.srcObject as MediaStream | null;
      return !!s && s.getTracks().every((t) => t.readyState === 'ended');
    });
    await clickHome(p, 'file.camera');
    await p.waitForSelector('[data-testid="camera-take"]:not([disabled])', { timeout: 20_000 });
    await p.click('[data-testid="camera-take"]');
    await p.waitForFunction(() => ((window as unknown as Win).fpe.state().tabs as number) === 1, undefined, { timeout: 20_000 });
    expect((await info(p))?.width ?? 0).toBeGreaterThan(100);
    expect(await ended()).toBe(true);
    await clickHome(p, 'file.camera');
    await p.waitForSelector('[data-testid="camera-take"]:not([disabled])', { timeout: 20_000 });
    await p.click('[data-testid="close-camera"]');
    await p.waitForFunction(() => {
      const s = document.querySelector<HTMLVideoElement>('[data-testid="camera-video"]')?.srcObject as MediaStream | null;
      return !!s && s.getTracks().every((t) => t.readyState === 'ended');
    }, undefined, { timeout: 5_000 });
    expect(await tabs(p)).toBe(1);
  }, 90_000);
});
