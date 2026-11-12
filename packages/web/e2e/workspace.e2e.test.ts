// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The W1 workspace in a real headless Chrome. Every Ready function of the map runs and changes something a person can
 * see; every Planned one refuses. Menus, flyouts, help lines, search, the start screen, layer rows that stay visible,
 * the phone sheets, and no word, control or panel tab off screen at 1440, 1024, 820, 390 and 360 px wide. Screenshots go to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts workspace
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addLayer, createDocument, createLayer } from '@free-photoeditor/core';
import { writePsdDocument } from '@free-photoeditor/core/psd';

interface Cmd { id: string; status: string; kind: string; enabled: boolean; checked: boolean | null; handler: boolean; }
interface Fpe {
  commands(): Cmd[]; run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; setZoom(z: number): void;
  select(x: number, y: number, w: number, h: number): void; newDocument(w: number, h: number, bg?: string | null): void;
  getInfo(): { layers: unknown[]; width: number; height: number } | null;
}
type Win = Window & { fpe: Fpe; __n: { dl: number; open: number; pick: number } };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};
/** After "open the sample and select a box over the sun": what a function needs first before it can change anything. */
const PREP: Record<string, string[]> = {
  'file.revert': ['layer.new'], 'edit.undo': ['layer.new'], 'edit.history-back': ['layer.new'],
  'edit.redo': ['layer.new', 'edit.undo'], 'edit.history-forward': ['layer.new', 'edit.undo'],
  'edit.paste': ['edit.copy-merged'], 'edit.paste-in-place': ['edit.copy-merged'], 'select.reselect': ['select.none'],
  'filter.last': ['filter.sharpen'], 'layer.front': ['layer.backward'], 'layer.forward': ['layer.backward'], 'view.fit': ['view.zoom-in'],
  'view.screen-standard': ['view.screen-focus'], 'window.reset': ['panel.info'], 'tool.brush': ['tool.move'],
};
const SEL: [number, number, number, number] = [850, 100, 100, 100];

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
/** Counts what would leave the page (downloads, new tabs, the file picker) instead of letting it happen. */
function stubs(): void {
  const w = window as unknown as Win, click = HTMLElement.prototype.click;
  w.__n = { dl: 0, open: 0, pick: 0 };
  window.open = () => { w.__n.open++; return null; };
  HTMLElement.prototype.click = function (this: HTMLElement): void {
    if (this instanceof HTMLInputElement && (this.type === 'file' || this.type === 'color')) { if (this.type === 'file') w.__n.pick++; return; }
    if (this instanceof HTMLAnchorElement && this.download) { w.__n.dl++; return; }
    click.call(this);
  };
}

let browser: Browser;
let server: Server;
let url = '';
const contexts: BrowserContext[] = [];
const errors: string[] = [];
async function open(w: number, hgt: number, touch = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}px: ${e.message}`));
  await p.addInitScript(stubs);
  await p.goto(url);
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  return p;
}
const run = (p: Page, id: string): Promise<boolean> => p.evaluate((x) => (window as unknown as Win).fpe.run(x), id);
const state = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
const sig = (p: Page): Promise<string> => p.evaluate(() => {
  const w = window as unknown as Win;
  return JSON.stringify([w.fpe.state(), document.querySelector('[data-testid="toast"]')?.textContent ?? '', w.__n]);
});
async function prepared(p: Page, id: string): Promise<void> {
  await p.reload();
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  if (id === 'image.trim') {
    await p.evaluate(async () => {
      const f = (window as unknown as Win).fpe;
      f.newDocument(200, 100, null);
      f.select(20, 20, 50, 40);
      await f.run('edit.fill');
    });
  } else {
    await p.evaluate(async ([pre, s]) => {
      const f = (window as unknown as Win).fpe;
      f.openSample();
      f.select(s[0], s[1], s[2], s[3]);
      for (const x of pre) await f.run(x);
    }, [PREP[id] ?? [], SEL] as const);
  }
  await p.evaluate(() => { const t = document.querySelector('[data-testid="toast"]'); if (t) t.textContent = ''; });
}
function rowsVisible(p: Page): Promise<{ rows: number; layers: number; visible: number }> {
  return p.evaluate(() => {
    const w = window as unknown as Win, rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="layer-row"]'));
    let visible = 0;
    for (const r of rows) {
      const list = r.closest('.fpe-layer-list'), a = r.getBoundingClientRect(), b = list?.getBoundingClientRect();
      if (b && a.height > 20 && a.width > 60 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && getComputedStyle(r).visibility !== 'hidden') visible++;
    }
    return { rows: rows.length, layers: w.fpe.getInfo()?.layers.length ?? 0, visible };
  });
}

const suite = CHROME ? describe : describe.skip;
suite('W1 workspace (headless Chrome)', () => {
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

  it('runs every Ready function, and each one changes something a person can see', async () => {
    const p = await open(1440, 900);
    const cmds = await p.evaluate(() => (window as unknown as Win).fpe.commands());
    const ready = cmds.filter((c) => c.status === 'ready'), planned = cmds.filter((c) => c.status !== 'ready');
    expect(ready.length).toBeGreaterThanOrEqual(120);
    expect(planned.every((c) => !c.handler)).toBe(true);
    const bad: string[] = [];
    for (const c of ready) {
      await prepared(p, c.id);
      const before = await sig(p), ok = await run(p, c.id);
      await p.waitForTimeout(60);
      if (!ok) bad.push(`${c.id}: not available`);
      else if ((await sig(p)) === before) bad.push(`${c.id}: nothing changed`);
    }
    expect(bad).toEqual([]);
    await prepared(p, 'none');
    const accepted: string[] = [];
    for (const c of planned) if (await run(p, c.id)) accepted.push(c.id);
    expect(accepted).toEqual([]);
  }, 400_000);

  it('opens menus, a submenu and an adjustment dialog, by mouse and by keyboard', async () => {
    const p = await open(1440, 900);
    await p.click('[data-testid="start-sample"]');
    await p.click('[data-testid="menu-top-image"]');
    await p.hover('[data-testid="sub-image-adjustments"]');
    await p.waitForSelector('[data-testid="mi-image.adj-brightness"]');
    await p.screenshot({ path: join(OUT, 'w1-desktop-1440-menu.png') });
    await p.click('[data-testid="mi-image.adj-brightness"]');
    await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
    const steps = (await state(p)).steps as number;
    await p.$eval('[data-testid="adjust-dialog"] input[type=range]', (el) => {
      const i = el as HTMLInputElement;
      i.value = String(Number(i.max) * 0.4);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.screenshot({ path: join(OUT, 'w1-desktop-1440-adjust.png') });
    await p.click('[data-testid="adj-apply"]');
    await p.waitForFunction((n) => ((window as unknown as Win).fpe.state().steps as number) > n, steps);
    await p.focus('[data-testid="menu-top-file"]');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')).toMatch(/^mi-file\./);
    await p.keyboard.press('Escape');
    expect(await p.locator('[data-testid="menu-drop"]').count()).toBe(0);
    await p.hover('[data-testid="tool-move"]');
    await p.waitForSelector('[data-testid="tip"]:not([hidden])');
    expect(((await p.textContent('[data-testid="tip"]')) ?? '').length).toBeGreaterThan(20);
    const box = await p.locator('[data-testid="tool-paint"]').boundingBox();
    if (!box) throw new Error('no paint tool button');
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(650);
    await p.mouse.up();
    await p.waitForSelector('[data-testid="flyout"]');
    await p.click('[data-testid="fly-tool.pencil"]');
    expect((await state(p)).tool).toBe('pencil');
  }, 90_000);

  it('starts from a job and from a wish typed in plain words', async () => {
    const p = await open(1440, 900);
    await p.waitForSelector('[data-testid="start"]');
    await p.screenshot({ path: join(OUT, 'w1-desktop-1440-start.png') });
    await p.click('[data-testid="start"] [data-testid^="job-"]:not([aria-disabled])');
    expect((await state(p)).tabs).toBe(1);
    await p.keyboard.press('Escape');
    await p.click('[data-testid="btn-search"]');
    await p.fill('[data-testid="search-input"]', 'make it brighter');
    expect(await p.getAttribute('[data-testid="search-result"] >> nth=0', 'data-id')).toBe('image.adj-brightness');
    await p.keyboard.press('Enter');
    await p.waitForSelector('[data-testid="adjust-dialog"]:not([hidden])');
  }, 60_000);

  it('keeps layer rows visible after opening a PSD, dropping, pasting, adding and duplicating', async () => {
    const p = await open(1440, 900);
    const d = createDocument(64, 48, { r: 255, g: 255, b: 255, a: 255 });
    addLayer(d, createLayer('Red box', 20, 20, { data: new Uint8ClampedArray(1600).fill(200), x: 10, y: 10 }), 1, 'Add');
    await p.setInputFiles('[data-testid="file-input"]', { name: 'two.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from(writePsdDocument(d)) });
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.layers.length === 2);
    expect(await rowsVisible(p)).toEqual({ rows: 2, layers: 2, visible: 2 });
    await p.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 30; c.height = 20;
      const x = c.getContext('2d');
      if (x) { x.fillStyle = '#2d7dd2'; x.fillRect(0, 0, 30, 20); }
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
      document.querySelector('.fpe')?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await p.waitForFunction(() => (window as unknown as Win).fpe.getInfo()?.layers.length === 3);
    for (const id of ['edit.copy-merged', 'edit.paste', 'layer.new', 'layer.duplicate']) expect(await run(p, id), id).toBe(true);
    const v = await rowsVisible(p);
    expect([v.rows, v.layers]).toEqual([6, 6]);
    expect(v.visible).toBeGreaterThanOrEqual(3);
    await p.screenshot({ path: join(OUT, 'w1-desktop-1440-layers.png') });
  }, 60_000);

  it('works on a phone: layers sheet, panel tabs and the menu tree', async () => {
    const p = await open(390, 844, true);
    await p.tap('[data-testid="start-sample"]');
    await p.tap('[data-testid="btn-layers"]');
    await p.waitForSelector('[data-testid="dock"][data-state="half"]');
    expect((await rowsVisible(p)).visible).toBe(2);
    await p.screenshot({ path: join(OUT, 'w1-phone-390-layers.png') });
    await p.tap('[data-testid="ptab-history"]');
    await p.waitForSelector('[data-testid="history-list"]', { state: 'visible' });
    await p.tap('[data-testid="close-dock"]');
    await p.tap('[data-testid="btn-menu"]');
    await p.tap('[data-testid="ms-top-image"]');
    await p.tap('[data-testid="ms-sub-image-adjustments"]');
    await p.screenshot({ path: join(OUT, 'w1-phone-390-menu.png') });
    const steps = (await state(p)).steps as number;
    await p.tap('[data-testid="ms-image.adj-invert"]');
    await p.waitForFunction((n) => ((window as unknown as Win).fpe.state().steps as number) > n, steps);
  }, 60_000);

  for (const [w, hgt, touch] of [[1440, 900, false], [1024, 768, false], [820, 1180, true], [390, 844, true], [360, 740, true]] as const) {
    it(`keeps every word and control on screen at ${w} px, text 12 px or larger`, async () => {
      const p = await open(w, hgt, touch);
      await p.evaluate(() => (window as unknown as Win).fpe.openSample());
      await p.waitForTimeout(250);
      const r = await p.evaluate(() => {
        const W = innerWidth, out: string[] = [], small: string[] = [];
        const scrolls = (el: Element): boolean => {
          for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true; }
          return false;
        };
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('.fpe button, .fpe a, .fpe input, .fpe select, .fpe label, .fpe span, .fpe h2, .fpe p, .fpe output'))) {
          const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (!b.width || !b.height || cs.visibility === 'hidden' || el.closest('[data-state="closed"], [hidden]')) continue;
          const name = `${el.getAttribute('data-testid') ?? el.className} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
          if ((b.left < -1 || b.right > W + 1) && !scrolls(el)) out.push(name);
          if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(cs.fontSize) < 12) small.push(`${name} ${cs.fontSize}`);
        }
        const tabsOut: string[] = [];
        if (document.querySelector('.fpe')?.getAttribute('data-layout') !== 'phone') {
          for (const t of Array.from(document.querySelectorAll<HTMLElement>('.fpe-gtab'))) {
            const strip = t.closest('.fpe-gtabs'), a = t.getBoundingClientRect(), b = strip?.getBoundingClientRect();
            if (!b || !a.width || !a.height) continue;
            if (a.left < b.left - 1 || a.right > b.right + 1 || a.top < b.top - 1 || a.bottom > b.bottom + 1) tabsOut.push((t.textContent ?? '').trim());
          }
        }
        return { pageScroll: document.documentElement.scrollWidth - W, out, small, tabsOut };
      });
      await p.screenshot({ path: join(OUT, `w1-${w}.png`) });
      expect(r.pageScroll).toBeLessThanOrEqual(0);
      expect(r.out).toEqual([]);
      expect(r.small).toEqual([]);
      expect(r.tabsOut).toEqual([]);
    }, 60_000);
  }

  it('raised no page errors', () => {
    expect(errors).toEqual([]);
  });
});
