// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * W8 in headless Chrome: the editor works offline (the server is switched off, the page reloads, a filter and a file
 * type used once before still work, export works), passes Chrome's install checks, opens pictures handed to the
 * installed app (Open with, a phone's share sheet, several dropped at once), brings back the last pictures after a
 * reload, and shows "A new version is ready · Reload" when a new build waits.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts offline
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Info { width: number; height: number; }
interface Fpe {
  getInfo(): Info | null; state(): Record<string, unknown>; appState(): Record<string, any>; checksum(x: number, y: number, w: number, h: number): number;
  run(id: string): Promise<boolean>; openSample(): void; exportFile(f: string): Promise<Blob>; newDocument(w: number, h: number, bg?: string | null): void;
  select(x: number, y: number, w: number, h: number): void; saveNow(): Promise<void>; commands(): { id: string; enabled: boolean }[];
}
type Win = { fpe: Fpe; __lq?: (p: unknown) => void };
const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** A static server that can be switched off (every connection dropped) and can serve a changed sw.js, like a new build. */
interface Srv { server: Server; url: string; hits: string[]; offline: boolean; swExtra: string; sockets: Set<Socket>; refused: number; }
function serve(): Promise<Srv> {
  const st = { hits: [] as string[], offline: false, swExtra: '', sockets: new Set<Socket>(), refused: 0 } as Srv;
  st.server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    st.hits.push(`${req.method} ${path}`);
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = normalize(join(DIST, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    readFile(file).then((body) => {
      const b = path === '/sw.js' && st.swExtra ? Buffer.concat([body, Buffer.from(st.swExtra)]) : body;
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(b);
    }, () => res.writeHead(404).end('Not found'));
  });
  st.server.on('connection', (s: Socket) => {
    if (st.offline) { st.refused++; s.destroy(); return; }
    st.sockets.add(s);
    s.on('close', () => st.sockets.delete(s));
  });
  return new Promise((resolve) => st.server.listen(0, '127.0.0.1', () => {
    const a = st.server.address();
    st.url = `http://127.0.0.1:${a && typeof a === 'object' ? a.port : 0}/`;
    resolve(st);
  }));
}
const goOffline = (s: Srv): void => { s.offline = true; for (const k of s.sockets) k.destroy(); s.sockets.clear(); };

let browser: Browser, srv: Srv;
const contexts: BrowserContext[] = [];
const errors: string[] = [];
async function open(opts: Parameters<Browser['newContext']>[0] = { viewport: { width: 1280, height: 800 } }, init?: string): Promise<Page> {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce', ...opts });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  if (init) await p.addInitScript(init);
  await p.goto(srv.url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
const fpe = <T>(p: Page, f: (x: Fpe) => T | Promise<T>): Promise<T> => p.evaluate(`(${f.toString()})(window.fpe)`) as Promise<T>;
const controlled = (p: Page): Promise<unknown> => p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
const whole = (p: Page): Promise<number> => fpe(p, (x) => { const i = x.getInfo(); return i ? x.checksum(0, 0, i.width, i.height) : 0; });
/** The Gaussian blur through its dialog: the preview runs in the filter worker, then Apply. */
async function blur(p: Page): Promise<void> {
  const before = await whole(p);
  await fpe(p, (x) => x.run('filter.blur-gaussian'));
  await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
  await p.waitForFunction((b) => { const f = (window as unknown as Win).fpe, i = f.getInfo(); return !!i && f.checksum(0, 0, i.width, i.height) !== b; }, before, { timeout: 30_000 });
  await p.click('[data-testid="adj-apply"]');
  await p.waitForSelector('[data-testid="adjust-dialog"]', { state: 'hidden', timeout: 30_000 });
  expect(await whole(p)).not.toBe(before);
}
const tiffBytes = (p: Page): Promise<number[]> => fpe(p, async (x) => [...new Uint8Array(await (await x.exportFile('tiff')).arrayBuffer()).slice(0, 4)]);
const cachedUrls = (p: Page): Promise<string[]> => p.evaluate(async () => {
  const out: string[] = [];
  for (const k of await caches.keys()) if (k.startsWith('fpe:')) for (const r of await (await caches.open(k)).keys()) out.push(r.url.split('?')[0]);
  return out;
});
async function until(f: () => Promise<boolean>, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return f();
}

describe.skipIf(!CHROME)('works offline, installs like an app, never loses work', () => {
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    srv = await serve();
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    srv?.server.close();
    srv?.server.closeAllConnections?.();
  });

  let page: Page;
  it('saves the app on the first visit, then works with the server off: reload, sample photo, a filter and a file type used before, export', async () => {
    page = await open();
    await controlled(page);
    expect((await fpe(page, (x) => x.appState())).status).toBe('ready');
    await fpe(page, (x) => x.openSample());
    await blur(page);
    expect(await tiffBytes(page)).toEqual(expect.arrayContaining([0x2a]));
    // Everything the server handed out while online is now in the editor's own caches (add-ons are saved as they are used).
    const want = (): string[] => [...new Set(srv.hits.filter((x) => x.startsWith('GET ')).map((x) => x.slice(4)))]
      .filter((x) => x !== '/sw.js' && x !== '/favicon.ico').map((x) => srv.url + (x === '/' ? 'index.html' : x.slice(1)));
    const ok = await until(async () => { const have = new Set(await cachedUrls(page)); return want().every((u) => have.has(u)); });
    const have = new Set(await cachedUrls(page));
    expect(ok, 'not saved: ' + want().filter((u) => !have.has(u)).join(', ')).toBe(true);
    expect(want().filter((u) => /\.js$/.test(u)).length, 'the entry, the filter worker and at least one add-on').toBeGreaterThan(2);

    goOffline(srv);
    const served = srv.hits.length;
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as Win).fpe);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await fpe(page, (x) => x.openSample());
    await blur(page);
    const tiff = await tiffBytes(page);
    expect(tiff, 'a TIFF file starts with II*0 or MM0*').toEqual(tiff[0] === 0x49 ? [0x49, 0x49, 0x2a, 0] : [0x4d, 0x4d, 0, 0x2a]);
    const png = await fpe(page, async (x) => (await x.exportFile('png')).size);
    expect(png).toBeGreaterThan(1000);
    expect(srv.hits.length, 'nothing reached the server while it was off').toBe(served);
    await page.screenshot({ path: join(OUT, 'w8-offline-desktop.png') });
    srv.offline = false;
  }, 180_000);

  it("passes Chrome's install checks: manifest, icons and the offline worker", async () => {
    const cdp = await page.context().newCDPSession(page);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    expect(inst.installabilityErrors).toEqual([]);
    const man = await cdp.send('Page.getAppManifest') as { url: string; errors: { message: string; critical: number }[] };
    expect(man.url).toBe(srv.url + 'manifest.webmanifest');
    expect(man.errors.filter((e) => e.critical)).toEqual([]);
    const m = JSON.parse(await (await fetch(man.url)).text());
    expect(m.name).toBe('Free Photo Editor');
    expect(m.description).toContain('Bhawesh Tibrewal');
    for (const i of m.icons) expect((await fetch(srv.url + i.src)).status, i.src).toBe(200);
    expect((await fpe(page, (x) => x.commands())).find((c) => c.id === 'file.install')?.enabled).toBe(true);
    expect(await page.textContent('[data-testid="about-offline"]')).toContain('Works offline');
  }, 60_000);

  it('opens pictures handed to the app: Open with (file handlers), the share sheet (share target), several dropped at once', async () => {
    const lq = 'window.launchQueue = { setConsumer(f) { window.__lq = f; } };';
    const p = await open(undefined, lq);
    await controlled(p);
    const made = (name: string, color: string) => `(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 30;
      const g = c.getContext('2d'); g.fillStyle = '${color}'; g.fillRect(0, 0, 40, 30);
      return new File([await new Promise((r) => c.toBlob(r, 'image/png'))], '${name}', { type: 'image/png' }); })()`;
    await p.evaluate(`(async () => { const f = await ${made('from-the-desktop.png', '#2d6fd6')}; window.__lq({ files: [{ getFile: async () => f }] }); })()`);
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().tabs === 1);
    expect(await p.textContent('[data-testid="doc-tab"]')).toContain('from-the-desktop');
    await p.evaluate(`(async () => { const dt = new DataTransfer(); dt.items.add(await ${made('one.png', '#d33')}); dt.items.add(await ${made('two.png', '#3d3')});
      document.querySelector('.fpe').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.layers.length === 3);
    await p.evaluate(`(async () => { const dt = new DataTransfer(); dt.items.add(await ${made('shared-photo.png', '#f3a712')});
      const f = document.createElement('form'); f.method = 'post'; f.enctype = 'multipart/form-data'; f.action = './share-target';
      const i = document.createElement('input'); i.type = 'file'; i.name = 'photos'; i.files = dt.files; f.append(i); document.body.append(f); f.submit(); })()`);
    await p.waitForURL((u) => !u.search.includes('shared'), { timeout: 30_000 }).catch(() => undefined);
    await p.waitForFunction(() => !!(window as unknown as Win).fpe && [...document.querySelectorAll('[data-testid="doc-tab"]')].some((t) => t.textContent?.includes('shared-photo')), null, { timeout: 30_000 });
    expect(new URL(p.url()).search).toBe('');
  }, 120_000);

  it('brings back the last pictures after a reload ("Bring back your last pictures?", Restore and Discard)', async () => {
    const p = await open();
    await fpe(p, async (x) => { x.newDocument(120, 80, '#ffffff'); x.select(10, 10, 50, 40); await x.run('edit.fill'); await x.saveNow(); });
    const sum = await whole(p);
    expect((await fpe(p, (x) => x.appState())).autosave.writes).toBeGreaterThan(0);
    await p.reload();
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    await p.waitForSelector('[data-testid="restore"]:not([hidden])', { timeout: 15_000 });
    expect(await p.textContent('[data-testid="restore"]')).toContain('Bring back your last pictures?');
    await p.screenshot({ path: join(OUT, 'w8-restore-prompt-desktop.png') });
    await p.click('[data-testid="restore-yes"]');
    await p.waitForFunction(() => (window as unknown as Win).fpe.state().tabs === 1);
    expect(await whole(p)).toBe(sum);
    expect(await fpe(p, (x) => x.getInfo()?.width)).toBe(120);
    await p.reload();
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    await p.waitForSelector('[data-testid="restore"]:not([hidden])', { timeout: 15_000 });
    expect(await p.$$eval('[data-testid="restore"] li', (l) => l.length)).toBe(1);
    await p.click('[data-testid="restore-discard"]');
    await p.reload();
    await p.waitForFunction(() => !!(window as unknown as Win).fpe);
    await p.waitForTimeout(1500);
    expect(await p.isHidden('[data-testid="restore"]')).toBe(true);
  }, 120_000);

  it('shows "A new version is ready · Reload" when a new build waits, and Reload starts it', async () => {
    srv.swExtra = '\n// a newer build\n';
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await page.waitForSelector('[data-testid="update-note"]', { timeout: 30_000 });
    expect(await page.textContent('[data-testid="update-note"]')).toContain('A new version is ready');
    await page.screenshot({ path: join(OUT, 'w8-update-note-desktop.png') });
    await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), page.click('[data-testid="update-reload"]')]);
    await page.waitForFunction(() => !!(window as unknown as Win).fpe);
    expect(await page.isVisible('[data-testid="update-note"]')).toBe(false);
    expect(await page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
  }, 90_000);

  it('shows the install steps on an iPhone: Share, then Add to Home Screen', async () => {
    const p = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE });
    await fpe(p, (x) => x.run('file.install'));
    await p.waitForSelector('[data-testid="sheet-install"][data-state="open"]');
    const text = await p.textContent('[data-testid="install-steps"]');
    expect(text).toContain('Add to Home Screen');
    expect(text).toContain('Share');
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(OUT, 'w8-install-sheet-iphone.png') });
    expect(errors).toEqual([]);
  }, 60_000);
});
