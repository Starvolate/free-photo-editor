// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The on-device AI (W11, W2) through the real editor in headless Chrome, with the real models downloaded from their pinned
 * public hosts. On a real photo, e2e/fixtures/mug.jpg (CC0): Select an object (a tap, a box, Shift adds, Alt takes away),
 * Select the main subject (the mask covers the jug and not the cloth) and Remove the background (onto a layer mask:
 * switched off, the photo is back unchanged). Remove an object (the sun painted over
 * disappears into the sky) and Make it bigger (from the start screen, on the small sample) run as a person would. Last,
 * the AI works offline: with the server switched off and the internet cut, Remove an object runs again from the files
 * kept on the first use, with no Download button and no request to the server, jsDelivr or Hugging Face. Each test
 * presses Cancel in `finally`, so one failure never leaks into the next. Headless Chrome has no GPU; the AI runs on
 * WebAssembly. Needs the network. Screenshots: e2e/out/w11-*.png and w2-*.png.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts ai
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page, type Request } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface Info { width: number; height: number; layers: { name: string; visible: boolean }[]; }
interface Fpe {
  getInfo(): Info | null; sample(x: number, y: number): number[] | null; run(id: string): Promise<boolean>; aiCmd(id: string): Promise<void>;
  newDocument(w: number, h: number, bg?: string | null): void; select(x: number, y: number, w: number, h: number): void;
  state(): { layers: { mask: { w: number; h: number } | null }[] };
  selectionAt(x: number, y: number): number; toClient(x: number, y: number): { x: number; y: number } | null; openSample(): void;
  openFile(file: Blob, name?: string): Promise<void>; commands(): { id: string; status: string }[];
}
type Win = { fpe: Fpe; __sawDownload?: boolean; __said?: string[] };
type Box = [number, number, number, number];
const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const MUG = join(WEB, 'e2e', 'fixtures', 'mug.jpg');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
};
interface Srv { server: Server; url: string; hits: string[]; offline: boolean; sockets: Set<Socket>; }
/** The build on a local server that can be switched off, as in offline.e2e; every request it gets is counted. */
function serve(): Promise<Srv> {
  const st = { hits: [] as string[], offline: false, sockets: new Set<Socket>() } as Srv;
  st.server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    st.hits.push(`${req.method} ${path}`);
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = normalize(join(DIST, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    readFile(file).then((body) => res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body),
      () => res.writeHead(404).end('Not found'));
  });
  st.server.on('connection', (k: Socket) => {
    if (st.offline) { k.destroy(); return; }
    st.sockets.add(k);
    k.on('close', () => st.sockets.delete(k));
  });
  return new Promise((resolve) => st.server.listen(0, '127.0.0.1', () => {
    const a = st.server.address();
    st.url = `http://127.0.0.1:${a && typeof a === 'object' ? a.port : 0}/`;
    resolve(st);
  }));
}
const goOffline = (st: Srv): void => { st.offline = true; for (const k of st.sockets) k.destroy(); st.sockets.clear(); };
const OUTSIDE = /cdn\.jsdelivr\.net|huggingface\.co|\.hf\.co\//;
const SUN = { x: 905, y: 180 };
/** [x, y, width, height] on the 480 x 640 mug photo, fixed before any model ran on it, with the bar: jug >= 179, cloth <= 38. */
const JUG: Box[] = [[180, 250, 100, 80], [205, 335, 80, 30]], CLOTH: Box[] = [[80, 20, 270, 80], [20, 480, 100, 140]];

describe.skipIf(!CHROME)('on-device AI (W11), real models', () => {
  let s: Srv, browser: Browser, page: Page;
  const listen = (p: Page): void => {
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
    p.on('pageerror', (e) => console.log('[page error]', e.message));
  };
  beforeAll(async () => {
    await mkdir(OUT, { recursive: true });
    s = await serve();
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    listen(page);
    await page.goto(s.url);
    await page.waitForFunction(() => !!(window as unknown as Win).fpe, undefined, { timeout: 30_000 });
  });
  afterAll(async () => { await browser?.close(); s?.server.close(); });
  const run = (id: string): Promise<void> => page.evaluate((x) => { void (window as unknown as Win).fpe.run(x); }, id);
  const px = (p: { x: number; y: number }): Promise<number[]> => page.evaluate(([x, y]) => (window as unknown as Win).fpe.sample(x, y) ?? [], [p.x, p.y] as [number, number]);
  const info = (): Promise<Info | null> => page.evaluate(() => (window as unknown as Win).fpe.getInfo());
  const layers = async (): Promise<number> => (await info())?.layers.length ?? 0;
  /** How selected each box is on average, 0 to 255. */
  const means = (boxes: Box[]): Promise<number[]> => page.evaluate((list) => list.map(([x, y, w, hh]) => {
    const f = (window as unknown as Win).fpe;
    let sum = 0, n = 0;
    for (let yy = y; yy < y + hh; yy += 2) for (let xx = x; xx < x + w; xx += 2) { sum += f.selectionAt(xx, yy); n++; }
    return Math.round(sum / n);
  }), boxes);
  /** A fresh tab with the sample photo, so no test depends on what an earlier one left behind. */
  async function freshSample(): Promise<void> {
    await page.evaluate(() => (window as unknown as Win).fpe.openSample());
    await page.waitForFunction(() => { const i = (window as unknown as Win).fpe.getInfo(); return i?.width === 960 && i.layers.length === 2; });
  }
  /** The first use of a model: the sheet says the size in plain words; then download. */
  async function download(shot?: string, p: Page = page): Promise<void> {
    await p.waitForSelector('[data-testid="ai-download"]', { state: 'visible', timeout: 30_000 });
    const said = await p.textContent('[data-testid="ai-message"]');
    console.log('W11 download sheet:', said);
    expect(said).toMatch(/^This downloads once, about \d+(\.\d)? MB\. Your photo never leaves this device\.$/);
    if (shot) await p.screenshot({ path: join(OUT, shot) });
    await p.click('[data-testid="ai-download"]');
  }
  const settled = (ms: number, p: Page = page): Promise<unknown> => p.waitForSelector('[data-testid="ai-sheet"]', { state: 'hidden', timeout: ms });
  /** Leave no AI sheet open, whatever happened in the test. */
  async function cleanUp(p: Page = page): Promise<void> {
    if (await p.isVisible('[data-testid="ai-cancel"]').catch(() => false)) await p.click('[data-testid="ai-cancel"]').catch(() => undefined);
    await settled(10_000, p).catch(() => undefined);
  }
  /** Paint over the sun with the Remove tool, as a person would, and let go. */
  async function paintSun(): Promise<void> {
    const pts: { x: number; y: number }[] = [];
    for (let k = 0, y = 100; y <= 260; y += 20, k++) for (const x of k % 2 ? [957, 846] : [846, 957]) pts.push({ x, y });
    const c = await page.evaluate((list) => list.map((p) => (window as unknown as Win).fpe.toClient(p.x, p.y)), pts);
    expect(c.every(Boolean)).toBe(true);
    await page.mouse.move(c[0]!.x, c[0]!.y);
    await page.mouse.down();
    for (const p of c.slice(1)) await page.mouse.move(p!.x, p!.y, { steps: 6 });
    await page.mouse.up();
  }
  /**
   * Requests from the separate Make it bigger tab, as [first, end) indexes into the server's hits. That tab has its own
   * browser context and so its own caches: what it fetched (the mask settings, for its masked layer) is not page's to keep.
   */
  const otherTab: [number, number][] = [];
  /** Every file the server handed out to page, named as the editor's caches name it. */
  const served = (): string[] => [...new Set(s.hits.filter((x, i) => x.startsWith('GET ') && !otherTab.some(([a, b]) => i >= a && i < b)).map((x) => x.slice(4)))]
    .filter((x) => x !== '/sw.js' && x !== '/favicon.ico').map((x) => s.url + (x === '/' ? 'index.html' : x.slice(1)));
  const cachedUrls = (): Promise<string[]> => page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) if (k.startsWith('fpe:')) for (const r of await (await caches.open(k)).keys()) out.push(r.url.split('?')[0]);
    return out;
  });
  async function until(f: () => Promise<boolean>, ms = 20_000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 250)); }
    return f();
  }

  it('shows Select an object, Select the main subject and Remove the background as Ready, with the job on the start screen', async () => {
    try {
      const ids = ['select.subject', 'image.remove-bg', 'tool.object-select'];
      const st = await page.evaluate((list) => (window as unknown as Win).fpe.commands().filter((c) => list.includes(c.id)).map((c) => `${c.id}:${c.status}`), ids);
      expect(st.sort()).toEqual(ids.map((id) => `${id}:ready`).sort());
      expect(await page.getAttribute('[data-testid="start"] [data-testid="job-remove-the-background"]', 'aria-disabled')).not.toBe('true');
    } finally { await cleanUp(); }
  }, 60_000);

  /** The mug photo in this tab, at picture pixel (x, y) on the screen. */
  async function openMug(): Promise<void> {
    const jpg = (await readFile(MUG)).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await (window as unknown as Win).fpe.openFile(new Blob([bytes], { type: 'image/jpeg' }), 'mug.jpg');
    }, jpg);
    await page.waitForFunction(() => { const i = (window as unknown as Win).fpe.getInfo(); return i?.width === 480 && i.height === 640; });
  }
  async function at(x: number, y: number): Promise<{ x: number; y: number }> {
    const c = await page.evaluate(([xx, yy]) => (window as unknown as Win).fpe.toClient(xx, yy), [x, y] as [number, number]);
    expect(c).toBeTruthy();
    return c!;
  }
  const lowest = async (boxes: Box[]): Promise<number> => Math.min(...(await means(boxes)));
  const highest = async (boxes: Box[]): Promise<number> => Math.max(...(await means(boxes)));

  it('Select an object on a real photo: a tap finds the jug, a box finds it too, Shift adds the wall and Alt takes it away', async () => {
    try {
      await openMug();
      await run('select.none');
      await run('tool.object-select');
      await page.getByText('Tap a thing, or drag a box round it. Shift adds', { exact: false }).first().waitFor({ timeout: 30_000 });
      const t0 = Date.now(), jug = await at(230, 290);
      await page.mouse.click(jug.x, jug.y);
      await download('w2-tap-download-sheet.png');
      await settled(240_000);
      await expect.poll(() => lowest(JUG), { timeout: 30_000, interval: 250 }).toBeGreaterThanOrEqual(179);
      console.log(`W2 tap on the jug: jug ${await means(JUG)}, cloth ${await means(CLOTH)}, ${Date.now() - t0} ms with the download`);
      expect(await highest(CLOTH)).toBeLessThanOrEqual(38);
      await page.screenshot({ path: join(OUT, 'w2-tap-selection.png') });

      await run('select.none');
      await expect.poll(() => highest(JUG), { timeout: 10_000, interval: 250 }).toBe(0);
      const a = await at(50, 140), b = await at(395, 400);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => lowest(JUG), { timeout: 60_000, interval: 250 }).toBeGreaterThanOrEqual(179);
      console.log(`W2 box round the jug: jug ${await means(JUG)}, cloth ${await means(CLOTH)}`);
      expect(await highest(CLOTH)).toBeLessThanOrEqual(38);

      const wall = await at(215, 60);
      await page.keyboard.down('Shift');
      await page.mouse.click(wall.x, wall.y);
      await page.keyboard.up('Shift');
      await expect.poll(async () => (await means([CLOTH[0]]))[0], { timeout: 60_000, interval: 250 }).toBeGreaterThanOrEqual(128);
      console.log(`W2 Shift adds the wall: jug ${await means(JUG)}, wall ${await means([CLOTH[0]])}`);
      expect(await lowest(JUG)).toBeGreaterThanOrEqual(179);
      await page.keyboard.down('Alt');
      await page.mouse.click(wall.x, wall.y);
      await page.keyboard.up('Alt');
      await expect.poll(async () => (await means([CLOTH[0]]))[0], { timeout: 60_000, interval: 250 }).toBeLessThanOrEqual(38);
      expect(await lowest(JUG)).toBeGreaterThanOrEqual(179);
    } finally {
      await page.keyboard.up('Shift').catch(() => undefined);
      await page.keyboard.up('Alt').catch(() => undefined);
      await cleanUp();
    }
  }, 300_000);

  it('Select the main subject and Remove the background: the jug and not the cloth, and the cut-out sits on a layer mask over the unchanged photo', async () => {
    try {
      if ((await info())?.width !== 480) await openMug();
      await run('select.none');
      const t0 = Date.now();
      await run('select.subject');
      await download();
      await settled(240_000);
      await expect.poll(() => lowest(JUG), { timeout: 30_000, interval: 250 }).toBeGreaterThanOrEqual(179);
      const jug = await means(JUG), cloth = await means(CLOTH);
      console.log(`W2 select the main subject on the mug: jug ${jug}, cloth ${cloth}, ${Date.now() - t0} ms with the download`);
      for (const v of cloth) expect(v).toBeLessThanOrEqual(38);
      const n = await layers();
      await run('image.remove-bg');
      await expect.poll(layers, { timeout: 120_000, interval: 250 }).toBe(n + 1);
      await settled(30_000);
      const a = await px({ x: 230, y: 290 }), b = await px({ x: 215, y: 60 }), i = await info();
      const masks = await page.evaluate(() => (window as unknown as Win).fpe.state().layers.map((l) => !!l.mask));
      console.log(`W2 remove the background on the mug: jug ${a}, wall ${b}, layers ${JSON.stringify(i?.layers.map((l) => [l.name, l.visible]))}, masks ${masks}`);
      expect(a[3]).toBeGreaterThan(200);
      expect(b[3]).toBeLessThan(40);
      expect(i?.layers.filter((l) => l.visible).map((l) => l.name)).toEqual(['Background removed']);
      expect(masks.filter(Boolean).length).toBe(1);
      await page.screenshot({ path: join(OUT, 'w2-cutout-on-mask.png') });
      // Nothing was deleted: with the mask switched off the wall is back, as it was; switched on again it hides.
      await run('layer.mask-toggle');
      await expect.poll(async () => (await px({ x: 215, y: 60 }))[3], { timeout: 10_000, interval: 250 }).toBe(255);
      await run('layer.mask-toggle');
      await expect.poll(async () => (await px({ x: 215, y: 60 }))[3], { timeout: 10_000, interval: 250 }).toBeLessThan(40);
    } finally { await cleanUp(); }
  }, 300_000);

  it('Remove an object: paint over the sun, let go, and it disappears into the sky', async () => {
    try {
      await freshSample();
      await run('select.none');
      await run('tool.remove');
      const before = await px(SUN);
      await paintSun();
      await download();
      await settled(240_000);
      const after = await px(SUN);
      console.log(`W11 remove object: sun before ${before}, after ${after}, layers ${await layers()}`);
      expect(before[0]).toBeGreaterThan(before[2]);
      expect(after[2]).toBeGreaterThan(after[0]);
      await page.screenshot({ path: join(OUT, 'w11-removed-object.png') });
    } finally { await cleanUp(); }
  }, 300_000);

  it('Make it bigger from the start screen: the small sample opens, and twice as big takes it from 256 x 171 to 512 x 342', async () => {
    // A page made by browser.newPage() owns its context, so context().newPage() is refused: open its own tab instead.
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    listen(p);
    const first = s.hits.length;
    try {
      await p.goto(s.url);
      await p.waitForFunction(() => !!(window as unknown as Win).fpe, undefined, { timeout: 30_000 });
      const t0 = Date.now();
      await p.click('[data-testid="start"] [data-testid="job-make-it-bigger"]');
      await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.width === 256);
      await download(undefined, p);
      await settled(180_000, p);
      const i = await p.evaluate(() => (window as unknown as Win).fpe.getInfo());
      console.log(`W11 make it bigger 2x from the start screen: ${i?.width} x ${i?.height}, ${Date.now() - t0} ms with the download`);
      expect([i?.width, i?.height]).toEqual([512, 342]);
      await p.screenshot({ path: join(OUT, 'w11-bigger-2x.png') });
      // W6 S1: on a layer with a mask, the mask grows with the picture. The model is on this device by now, so it is quick.
      const m0 = await p.evaluate(async () => {
        const f = (window as unknown as Win).fpe;
        f.newDocument(40, 30, '#ffffff');
        for (const id of ['layer.new', 'tool.default-colors']) await f.run(id);
        f.select(10, 10, 20, 10);
        for (const id of ['edit.fill', 'select.none', 'layer.mask-add']) await f.run(id);
        f.select(16, 12, 8, 6);
        for (const id of ['edit.fill', 'select.none']) await f.run(id);
        return f.state().layers[1].mask;
      });
      expect(m0?.w).toBeGreaterThan(0);
      await p.evaluate(() => { void (window as unknown as Win).fpe.aiCmd('image.upscale-2x'); });
      await p.waitForFunction(() => {
        if ((window as unknown as Win).fpe.getInfo()?.width === 80) return true;
        const b = document.querySelector<HTMLElement>('[data-testid="ai-download"]');
        if (b?.offsetParent) b.click();
        return false;
      }, undefined, { timeout: 120_000, polling: 250 });
      await settled(60_000, p);
      const m1 = await p.evaluate(() => (window as unknown as Win).fpe.state().layers[1].mask);
      console.log(`W6 make it bigger on a masked layer: mask ${m0?.w} x ${m0?.h} became ${m1?.w} x ${m1?.h}`);
      expect([m1?.w, m1?.h]).toEqual([(m0?.w ?? 0) * 2, (m0?.h ?? 0) * 2]);
    } finally { await cleanUp(p); await p.close(); otherTab.push([first, s.hits.length]); }
  }, 240_000);

  it('works offline after the first use: with the server off and the internet cut, Remove an object runs again with no Download button', async () => {
    const ctx = page.context(), outside: string[] = [];
    const watch = (r: Request): void => { if (OUTSIDE.test(r.url())) outside.push(r.url()); };
    try {
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });
      // a. Online: Remove an object (its files may already be on this device from the test above).
      await freshSample();
      await run('select.none');
      await run('tool.remove');
      await paintSun();
      await page.waitForSelector('[data-testid="ai-sheet"]', { state: 'visible', timeout: 30_000 });
      await page.waitForFunction(() => !(document.querySelector('[data-testid="ai-message"]')?.textContent ?? 'Checking').startsWith('Checking'), undefined, { timeout: 30_000 });
      if (await page.isVisible('[data-testid="ai-download"]')) await page.click('[data-testid="ai-download"]');
      await settled(240_000);
      const online = await px(SUN);
      expect(online[2]).toBeGreaterThan(online[0]);
      // Everything the server handed out is in the editor's own caches by now, the AI worker's file included.
      const ok = await until(async () => { const have = new Set(await cachedUrls()); return served().every((u) => have.has(u)); });
      const have = new Set(await cachedUrls());
      console.log(`W11 offline: ${served().length} files served online, all kept: ${ok}`);
      expect(ok, 'not saved: ' + served().filter((u) => !have.has(u)).join(', ')).toBe(true);

      // b. Offline: the server is switched off, the internet is cut, and the page reloads.
      goOffline(s);
      await ctx.setOffline(true);
      ctx.on('request', watch);
      const hits = s.hits.length;
      await page.reload();
      await page.waitForFunction(() => !!(window as unknown as Win).fpe, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

      // c. Again: it works from the files kept on this device, and no Download button appears.
      await freshSample();
      await run('select.none');
      await run('tool.remove');
      const before = await px(SUN);
      await page.evaluate(() => {
        const w = window as unknown as Win;
        w.__sawDownload = false;
        w.__said = [];
        window.setInterval(() => {
          const b = document.querySelector<HTMLElement>('[data-testid="ai-download"]'), m = document.querySelector('[data-testid="ai-message"]')?.textContent ?? '';
          if (b && !b.hidden && b.getClientRects().length > 0) w.__sawDownload = true;
          if (m && !w.__said?.includes(m)) w.__said?.push(m);
        }, 20);
      });
      const t0 = Date.now();
      await paintSun();
      await page.waitForSelector('[data-testid="ai-sheet"]', { state: 'visible', timeout: 30_000 });
      const end = await Promise.race([
        settled(240_000).then(() => 'ended', () => 'still open'),
        page.waitForFunction(() => (window as unknown as Win).__sawDownload === true, undefined, { timeout: 240_000 }).then(() => 'download button', () => 'still open'),
      ]);
      const after = await px(SUN), said = await page.evaluate(() => (window as unknown as Win).__said ?? []);
      const toast = await page.textContent('[data-testid="toast"]').catch(() => '');
      console.log(`W11 offline rerun: ${end} in ${Date.now() - t0} ms; sun before ${before}, after ${after}; the sheet said ${JSON.stringify(said)}; toast "${toast}"; `
        + `server requests while off ${s.hits.length - hits}; requests to jsDelivr or Hugging Face ${outside.length}`);
      expect(end, 'no Download button while offline').toBe('ended');
      expect(before[0]).toBeGreaterThan(before[2]);
      expect(after[2]).toBeGreaterThan(after[0]);
      expect(s.hits.length, 'nothing reached the server while it was off').toBe(hits);
      expect(outside, 'nothing went to jsDelivr or Hugging Face').toEqual([]);
      await page.screenshot({ path: join(OUT, 'w11-offline-rerun.png') });
    } finally {
      ctx.off('request', watch);
      await ctx.setOffline(false).catch(() => undefined);
      s.offline = false;
      await cleanUp();
    }
  }, 420_000);
});
