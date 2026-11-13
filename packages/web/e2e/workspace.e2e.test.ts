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
import { show } from './ribbon';
import { addLayer, createDocument, createLayer } from '@free-photoeditor/core';
import { writePsdDocument } from '@free-photoeditor/core/psd';

interface Cmd { id: string; status: string; kind: string; enabled: boolean; checked: boolean | null; handler: boolean; }
interface Fpe {
  commands(): Cmd[]; run(id: string): Promise<boolean>; state(): Record<string, unknown>; openSample(): void; setZoom(z: number): void;
  select(x: number, y: number, w: number, h: number): void; newDocument(w: number, h: number, bg?: string | null): void;
  getInfo(): { layers: unknown[]; width: number; height: number } | null; toClient(x: number, y: number): { x: number; y: number } | null;
}
interface Box { top: number; bottom: number; }
type Win = Window & { fpe: Fpe; __n: { dl: number; open: number; pick: number } };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};
/** The on-device AI commands. Run here, each must open its sheet with the download question; nothing is downloaded. */
const AI = ['select.subject', 'image.remove-bg', 'edit.smart-fill', 'image.upscale-2x', 'image.upscale-4x'];
/** After "open the sample and select a box over the sun": what a function needs first before it can change anything. */
const PREP: Record<string, string[]> = {
  'file.revert': ['layer.new'], 'edit.undo': ['layer.new'], 'edit.history-back': ['layer.new'],
  'edit.redo': ['layer.new', 'edit.undo'], 'edit.history-forward': ['layer.new', 'edit.undo'],
  'edit.paste': ['edit.copy-merged'], 'edit.paste-in-place': ['edit.copy-merged'], 'select.reselect': ['select.none'],
  'filter.last': ['filter.sharpen', 'apply'], 'edit.fade': ['filter.sharpen', 'apply'], 'layer.front': ['layer.backward'], 'layer.forward': ['layer.backward'], 'view.fit': ['view.zoom-in'],
  'view.screen-standard': ['view.screen-focus'], 'window.reset': ['panel.info'], 'tool.brush': ['tool.move'],
  'layer.mask-apply': ['layer.mask-from-sel'], 'layer.mask-delete': ['layer.mask-add'], 'layer.mask-toggle': ['layer.mask-add'], 'layer.mask-link': ['layer.mask-add'],
  'layer.clip': ['layer.new'], 'layer.ungroup': ['layer.group'],
  // An outline from the box over the sun, then nothing selected, so the selection made from the outline is a visible change.
  'select.from-path': ['select.to-path', 'select.none'],
  // Shapes & text: an outline round the box over the sun; combining adds a second from everything else (a frame with a hole).
  'path.boolean': ['select.to-path', 'select.inverse', 'select.to-path'], 'path.combine': ['select.to-path', 'select.inverse', 'select.to-path'],
  'path.offset': ['select.to-path'], 'path.mirror': ['select.to-path'], 'path.rotate-copies': ['select.to-path'], 'path.roughen': ['select.to-path'],
  // Shapes & text, part 2: two outlines (the box, then a frame with a hole) or one outline round the box.
  'path.divide': ['select.to-path', 'select.inverse', 'select.to-path'], 'path.stitch': ['select.to-path', 'select.inverse', 'select.to-path'], 'path.interpolate': ['select.to-path', 'select.inverse', 'select.to-path'], 'path.pattern-along': ['select.to-path', 'select.inverse', 'select.to-path'], 'path.bend': ['select.to-path', 'select.inverse', 'select.to-path'],
  'path.hatches': ['select.to-path'], 'path.power-stroke': ['select.to-path'], 'path.stroke-style': ['select.to-path'], 'path.envelope': ['select.to-path'],
  // A guide line first, so removing the guides is a visible change.
  'view.guide-clear': ['view.guide-new'],
  // A light and colour layer first, so its .cube file can be saved.
  'image.export-lut': ['layer.adj-invert'],
  // A second layer, so reversing the order is a visible change.
  'layer.reverse': ['layer.new'],
  // The sun merged in, a copy of the photo, and the copy moved 100 px down (its top to the box's): Line up puts it back.
  'edit.auto-align': ['layer.merge-down', 'layer.duplicate', 'layer.align-top'],
  // The same copy 100 px down: Blend photos gives it a seam mask, so the lower part of the overlap shows the copy.
  'edit.auto-blend': ['layer.merge-down', 'layer.duplicate', 'layer.align-top'],
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
/**
 * Nothing in a dock card is cut: every control and line sits inside its card and inside each box around it that clips,
 * unless that box scrolls and shows its calm fade on that edge (data-fade), so a person sees there is more.
 */
const clipped = (p: Page): Promise<string[]> => p.evaluate(() => {
  const out: string[] = [];
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="dock"] :is(.fpe-group, .fpe-learn)')).filter((c) => c.getBoundingClientRect().height > 0);
  for (const card of cards) {
    for (const el of Array.from(card.querySelectorAll<HTMLElement>('button, input, select, label, canvas, p, li, h3, output, .fpe-field, .fpe-row'))) {
      const a = el.getBoundingClientRect();
      if (!a.width || !a.height || getComputedStyle(el).visibility === 'hidden') continue;
      const name = `${card.dataset.group ?? 'learn'}: ${el.dataset.testid ?? ((el.textContent ?? '').trim().slice(0, 30) || el.tagName)}`;
      // What can still be seen of it, walking outwards. A scroller that shows a fade on an edge hides what lies past that
      // edge on purpose (app.ts fade), so from there on only its visible part counts: the card around the scroller then
      // judges that part. Without this, a fading scroller inside a card could never pass, and a scroller cut by its own
      // card is still caught.
      let top = a.top, bottom = a.bottom;
      for (let up = el.parentElement; up && up !== card.parentElement; up = up.parentElement) {
        const cs = getComputedStyle(up);
        if (up !== card && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = up.getBoundingClientRect(), f = up.dataset.fade ?? '', scrolls = up.scrollHeight > up.clientHeight + 1 && /auto|scroll/.test(cs.overflowY);
        if (top < b.top - 0.5 && !(scrolls && f.includes('top'))) { out.push('cut at the top: ' + name); break; }
        if (bottom > b.bottom + 0.5 && !(scrolls && f.includes('bottom'))) { out.push('cut at the bottom: ' + name); break; }
        if (a.left < b.left - 0.5 || a.right > b.right + 0.5) { out.push('cut at a side: ' + name); break; }
        top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom);
        if (bottom <= top) break;
      }
    }
  }
  return out;
});
/** The first-run tip and a toast never sit over a ruler; a toast sits no lower than the top of the zoom buttons. */
const overRulers = (p: Page): Promise<string[]> => p.evaluate(() => {
  const out: string[] = [];
  const rect = (s: string): DOMRect | null => {
    const e = document.querySelector<HTMLElement>(s), r = e?.getBoundingClientRect();
    return e && r && !e.hidden && r.width && r.height && getComputedStyle(e).visibility !== 'hidden' ? r : null;
  };
  const hit = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const rulers = Array.from(document.querySelectorAll('.fpe-ruler')).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  if (!rulers.length) out.push('no rulers on screen');
  for (const [name, sel] of [['tip', '[data-testid="rhint"]'], ['toast', '[data-testid="toast"][data-on]']]) {
    const a = rect(sel);
    if (a && rulers.some((r) => hit(a, r))) out.push(name + ' over a ruler');
  }
  const t = rect('[data-testid="toast"][data-on]'), z = rect('.fpe-zoom');
  if (!t) out.push('no toast to check');
  if (t && z && t.bottom > z.top + 0.5) out.push('toast lower than the top of the zoom buttons');
  return out;
});
const state = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => (window as unknown as Win).fpe.state());
const sig = (p: Page): Promise<string> => p.evaluate(() => {
  const w = window as unknown as Win;
  return JSON.stringify([w.fpe.state(), document.querySelector('[data-testid="toast"]')?.textContent ?? '', w.__n]);
});
/**
 * A fresh page set up for one row. Each set-up step must really run: run() comes back true and the state changes. A step
 * that is refused or changes nothing is not retried: the row fails with that step's id and the message the person saw.
 * Returns '' when every step ran.
 */
async function prepared(p: Page, id: string): Promise<string> {
  await p.reload();
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  const miss = await p.evaluate(async ([trim, pre, s]) => {
    const f = (window as unknown as Win).fpe, said = (): string => document.querySelector('[data-testid="toast"]')?.textContent?.trim() || 'no message';
    const wait = async (done: () => boolean): Promise<boolean> => { for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 50)); return done(); };
    if (trim) { f.newDocument(200, 100, null); f.select(20, 20, 50, 40); } else { f.openSample(); f.select(s[0], s[1], s[2], s[3]); }
    for (const x of pre) {
      if (x === 'apply') {
        await wait(() => !!document.querySelector('[data-testid="adj-apply"]'));
        (document.querySelector('[data-testid="adj-apply"]') as HTMLElement | null)?.click();
        if (!(await wait(() => !!f.state().lastFilter))) return `apply: no filter was applied (${said()})`;
        continue;
      }
      const t = document.querySelector('[data-testid="toast"]');
      if (t) t.textContent = '';
      const before = JSON.stringify(f.state());
      if (!(await f.run(x))) return `${x} was refused: ${said()}`;
      if (!(await wait(() => JSON.stringify(f.state()) !== before))) return `${x} changed nothing: ${said()}`;
    }
    return '';
  }, [id === 'image.trim', id === 'image.trim' ? ['edit.fill'] : PREP[id] ?? [], SEL] as const);
  await p.evaluate(() => { const t = document.querySelector('[data-testid="toast"]'); if (t) t.textContent = ''; });
  return miss;
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
    const bad: string[] = [], aiSeen: string[] = [], fetched: string[] = [];
    p.on('request', (r) => { if (/huggingface\.co|\.hf\.co\/|cdn\.jsdelivr\.net/.test(r.url())) fetched.push(r.url()); });
    for (const c of ready) {
      const miss = await prepared(p, c.id);
      if (miss) { bad.push(`${c.id}: set-up step ${miss}`); continue; }
      const before = await sig(p), ok = await run(p, c.id);
      await p.waitForTimeout(60);
      if (!ok) bad.push(`${c.id}: not available`);
      else if ((await sig(p)) === before) bad.push(`${c.id}: nothing changed`);
      if (AI.includes(c.id)) {
        // run() came back, so the command did not wait for the person; its sheet asks before any download.
        const asked = await p.waitForSelector('[data-testid="ai-download"]', { state: 'visible', timeout: 15_000 }).then(() => true, () => false);
        if ((await state(p)).modal !== 'ai' || !asked) bad.push(`${c.id}: the AI sheet did not open with its download question`);
        else aiSeen.push(c.id);
      }
    }
    expect(bad).toEqual([]);
    expect(aiSeen.length, 'AI commands checked').toBeGreaterThanOrEqual(3);
    expect(fetched, 'nothing downloaded from the AI hosts').toEqual([]);
    expect(await prepared(p, 'none')).toBe('');
    const accepted: string[] = [];
    for (const c of planned) if (await run(p, c.id)) accepted.push(c.id);
    expect(accepted).toEqual([]);
  }, 400_000);

  it('opens a ribbon tab, a sheet and an adjustment dialog, by mouse and by keyboard', async () => {
    const p = await open(1440, 900);
    await p.click('[data-testid="start-sample"]');
    await show(p, 'image.adj-brightness');
    await p.screenshot({ path: join(OUT, 'w1-desktop-1440-menu.png') });
    await p.click('[data-testid="ri-image.adj-brightness"]');
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
    await p.focus('[data-testid="rtab-effects-masks"]');
    await p.keyboard.press('ArrowRight');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')).toBe('rtab-select-cut-out');
    expect(await p.getAttribute('[data-testid="rtab-select-cut-out"]', 'aria-selected')).toBe('true');
    await p.focus('[data-testid="rsheet-file"]');
    await p.keyboard.press('Enter');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')).toMatch(/^ri-file\./);
    await p.keyboard.press('Escape');
    expect(await p.locator('[data-testid="rlist"]').count()).toBe(0);
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

  it('phone: a half-open sheet leaves the whole picture above it, toasts never cover the sheet or the tool bar, panel tabs scroll with an edge cue', async () => {
    const p = await open(390, 844, true);
    await p.tap('[data-testid="start-sample"]');
    const geo = (): Promise<{ pic: Box; stage: Box; dock: Box; tools: Box; toast: Box }> => p.evaluate(() => {
      const w = window as unknown as Win, i = w.fpe.getInfo(), a = w.fpe.toClient(0, 0), b = i ? w.fpe.toClient(i.width, i.height) : null;
      const box = (s: string): Box => { const r = document.querySelector(s)?.getBoundingClientRect(); return { top: r?.top ?? NaN, bottom: r?.bottom ?? NaN }; };
      return { pic: { top: a?.y ?? NaN, bottom: b?.y ?? NaN }, stage: box('.fpe-stage'), dock: box('[data-testid="dock"]'), tools: box('[data-testid="tools"]'), toast: box('[data-testid="toast"]') };
    });
    const toast = async (): Promise<void> => {
      await p.evaluate(() => document.querySelector('[data-testid="toast"]')?.removeAttribute('data-on'));
      expect(await run(p, 'edit.pref-pro-names')).toBe(true);
      await p.waitForSelector('[data-testid="toast"][data-on]');
    };
    const tabs = (): Promise<string[]> => p.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('.fpe-ptabs-wrap'), strip = document.querySelector<HTMLElement>('.fpe-ptabs');
      if (!wrap || !strip) return ['no panel tab strip'];
      const s = strip.getBoundingClientRect(), more = wrap.dataset.more ?? '', bad: string[] = [];
      const all = Array.from(strip.querySelectorAll<HTMLElement>('.fpe-ptab'));
      if (new Set(all.map((t) => Math.round(t.getBoundingClientRect().top))).size !== 1) bad.push('the panel tabs are not one row');
      for (const side of ['left', 'right']) {
        const cue = wrap.querySelector<HTMLElement>('.fpe-pcue-' + side[0]), shown = !!cue && getComputedStyle(cue).display !== 'none';
        if (more.includes(side) !== shown) bad.push(`the ${side} edge cue is ${shown ? 'shown with nothing there' : 'missing'}`);
      }
      for (const t of all) {
        const a = t.getBoundingClientRect(), name = (t.textContent ?? '').trim(), cutL = a.left < s.left - 1, cutR = a.right > s.right + 1;
        if (t.scrollWidth > t.clientWidth + 1 || parseFloat(getComputedStyle(t).fontSize) < 12) bad.push('label cut or too small: ' + name);
        if (t.getAttribute('aria-selected') === 'true' && (cutL || cutR)) bad.push('the open tab is cut: ' + name);
        if (cutL && !more.includes('left')) bad.push('cut at the left edge with no cue: ' + name);
        if (cutR && !more.includes('right')) bad.push('cut at the right edge with no cue: ' + name);
      }
      return bad;
    });
    await toast();
    let g = await geo();
    expect(g.toast.bottom, 'toast above the tool bar').toBeLessThanOrEqual(g.tools.top);
    await p.screenshot({ path: join(OUT, 'w1b-phone-390-toast.png') });
    const full0 = g.pic.bottom - g.pic.top;
    await p.tap('[data-testid="btn-layers"]');
    await p.waitForSelector('[data-testid="dock"][data-state="half"]');
    await p.waitForTimeout(200);
    await toast();
    g = await geo();
    expect(g.pic.top, 'picture inside the space above the sheet').toBeGreaterThanOrEqual(g.stage.top - 1);
    expect(g.pic.bottom, 'picture never under the sheet').toBeLessThanOrEqual(g.dock.top + 1);
    expect(g.stage.bottom, 'the picture space ends where the sheet starts').toBeLessThanOrEqual(g.dock.top + 1);
    expect(g.pic.bottom - g.pic.top, 'the picture refits, it is not cut').toBeLessThanOrEqual(full0 + 1);
    expect(g.toast.top).toBeGreaterThanOrEqual(0);
    expect(g.toast.bottom, 'toast above the half sheet').toBeLessThanOrEqual(g.dock.top);
    expect(await rowsVisible(p)).toMatchObject({ rows: 2, visible: 2 });
    await p.screenshot({ path: join(OUT, 'w1b-phone-390-dock-half.png') });
    expect(await tabs()).toEqual([]);
    expect(await p.getAttribute('.fpe-ptabs-wrap', 'data-more')).toContain('right');
    await p.tap('[data-testid="ptab-info"]');
    await p.waitForSelector('[data-testid="ptab-info"][aria-selected="true"]');
    expect(await tabs()).toEqual([]);
    expect(await p.getAttribute('.fpe-ptabs-wrap', 'data-more')).toContain('left');
    await p.screenshot({ path: join(OUT, 'w1b-phone-390-tabs.png') });
    const hb = await p.locator('[data-testid="dock"] .fpe-handle').boundingBox();
    if (!hb) throw new Error('no sheet handle');
    await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await p.mouse.down();
    await p.mouse.up();
    await p.waitForSelector('[data-testid="dock"][data-state="full"]');
    await toast();
    g = await geo();
    expect(g.toast.top).toBeGreaterThanOrEqual(0);
    expect(g.toast.bottom, 'toast above the full sheet').toBeLessThanOrEqual(g.dock.top);
    await p.screenshot({ path: join(OUT, 'w1b-phone-390-dock-full.png') });
    await p.tap('[data-testid="close-dock"]');
    await p.waitForSelector('[data-testid="dock"][data-state="closed"]', { state: 'attached' });
    await p.waitForTimeout(200);
    g = await geo();
    expect(Math.abs(g.pic.bottom - g.pic.top - full0), 'the picture fills the space again once the sheet closes').toBeLessThanOrEqual(1);
  }, 60_000);

  it('desktop and tablet: the dock is calm cards, two columns at 1400 px and wider, one tabbed card below, no "+n" chip, nothing cut', async () => {
    const check = (p: Page): Promise<string[]> => p.evaluate(() => {
      const out: string[] = [];
      for (const strip of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="dock"] :is(.fpe-gtabs, .fpe-dswitch)'))) {
        const s = strip.getBoundingClientRect();
        if (!s.width || !s.height || getComputedStyle(strip).visibility === 'hidden') continue;
        const tabs = Array.from(strip.querySelectorAll<HTMLElement>('.fpe-gtab, .fpe-dview')).filter((t) => t.getBoundingClientRect().width > 0);
        const label = tabs.map((t) => (t.textContent ?? '').trim()).join(' | ');
        if (!tabs.length) out.push('a tab strip shows no tab');
        if (new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size > 1) out.push('two rows: ' + label);
        for (const t of tabs) {
          const a = t.getBoundingClientRect(), name = (t.textContent ?? '').trim();
          if (a.left < s.left - 1 || a.right > s.right + 1 || t.scrollWidth > t.clientWidth + 1) out.push('cut: ' + name);
          if (parseFloat(getComputedStyle(t).fontSize) < 12) out.push('smaller than 12 px: ' + name);
          if (t.querySelector('.fpe-tag')) out.push('a Planned tab at rest: ' + name);
        }
      }
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="dock"] *'))) {
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
        if (/^\+\d+$/.test(own) && el.getBoundingClientRect().width > 0) out.push('a "+n" chip: ' + own);
      }
      return out;
    });
    const cards = (p: Page): Promise<string[]> => p.locator('[data-testid="dock"] .fpe-group').evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getAttribute('data-group') ?? ''));
    for (const [w, hgt] of [[1440, 900], [1280, 800], [1024, 768], [820, 1180]] as const) {
      const p = await open(w, hgt);
      // No picture: no dock at all, and the start screen takes the full width; the dock comes with the first picture.
      expect(await p.isVisible('[data-testid="dock"]'), `${w} px: no dock with no picture`).toBe(false);
      expect(await cards(p), `${w} px: no empty panels`).toEqual([]);
      expect(await p.$eval('.fpe-center', (e) => e.getBoundingClientRect().right), `${w} px: the start screen reaches the right edge`).toBeGreaterThanOrEqual(w - 2);
      if (w === 1440) await p.screenshot({ path: join(OUT, 'ui-b-1440-empty.png') });
      await p.evaluate(() => (window as unknown as Win).fpe.openSample());
      await p.waitForSelector('[data-testid="dock"]', { state: 'visible' });
      await p.waitForTimeout(150);
      expect(await check(p), `${w} px`).toEqual([]);
      if (w === 1440) {
        // Two columns as in a-deep: Properties, History and the Tone graph card on the left; Layers and Learn as you go on the right.
        const c1 = await p.locator('[data-testid="dock-col-1"]').boundingBox(), c2 = await p.locator('[data-testid="dock-col-2"]').boundingBox();
        expect(!!c1 && !!c2 && c1.x + c1.width <= c2.x, 'two columns side by side').toBe(true);
        for (const id of ['group-props', 'group-history', 'group-nav']) expect(await p.isVisible(`[data-testid="dock-col-1"] [data-testid="${id}"]`), id).toBe(true);
        for (const id of ['group-layers', 'learn-card']) expect(await p.isVisible(`[data-testid="dock-col-2"] [data-testid="${id}"]`), id).toBe(true);
        expect(await p.isVisible('[data-testid="dock-views"]'), 'no tab strip over two columns').toBe(false);
        expect(await p.isVisible('[data-testid="tab-histogram"]') && await p.isVisible('[data-testid="tab-navigator"]'), 'Tone graph and Navigator tabs').toBe(true);
        await p.waitForFunction(() => /^Mostly (dark|middle|light) tones · /.test(document.querySelector('[data-testid="tone-note"]')?.textContent ?? ''));
        await p.waitForFunction(() => /Pros call it/.test(document.querySelector('[data-testid="learn-text"]')?.textContent ?? ''));
        expect((await p.textContent('[data-testid="learn-text"]'))?.trim()).toMatch(/Pros call it an? [A-Z]/);
        await p.screenshot({ path: join(OUT, 'w1b-desktop-1440-tabs.png') });
        await p.screenshot({ path: join(OUT, 'w1b-desktop-1440-dock.png'), clip: { x: 1440 - 660, y: 200, width: 660, height: 700 } });
        continue;
      }
      // Below 1400 px: one card at a time, picked from Layers, Properties and History.
      expect(await cards(p), `${w} px: one card`).toEqual(['layers']);
      expect(await p.locator('[data-testid="dock-views"] [role="tab"]').allTextContents()).toEqual(['Layers', 'Properties', 'History']);
      await p.click('[data-testid="dview-history"]');
      await p.waitForSelector('[data-testid="history-list"]', { state: 'visible' });
      expect(await cards(p), `${w} px: History alone`).toEqual(['history']);
      expect(await check(p), `${w} px, History`).toEqual([]);
      if (w !== 820) continue;
      // The Properties card's "..." menu reaches Text style; the three tabs stay.
      await p.click('[data-testid="dview-props"]');
      const more = p.locator('[data-testid="gmore-props"]');
      expect(await more.isVisible(), 'the Properties card has its "..." menu on a 252 px dock').toBe(true);
      expect(await more.getAttribute('aria-label')).toContain('Text style');
      await more.click();
      await p.click('.fpe-pop button:has-text("Text style")');
      await p.waitForSelector('[data-testid="tab-character"][aria-selected="true"]');
      expect(await p.isVisible('[data-testid="tab-character"]')).toBe(true);
      await p.waitForSelector('[data-testid="panel-character"]', { state: 'visible' });
      expect(await p.isVisible('[data-testid="dock-views"]'), 'the Layers, Properties and History tabs stay').toBe(true);
      expect(await check(p), `${w} px after picking Text style`).toEqual([]);
      await p.screenshot({ path: join(OUT, 'w1b-tablet-820-tabs.png') });
    }
  }, 120_000);

  it('1440 x 900, the sample with a Tone curve layer: the Layers card shows its four action words and Properties its first four controls in full; 1280 is one tabbed card', async () => {
    const p = await open(1440, 900);
    await p.evaluate(() => (window as unknown as Win).fpe.openSample());
    // "Sample photo opened" sits at the bottom centre of the picture area, above the zoom buttons; neither it nor the tip covers a ruler.
    await p.waitForSelector('[data-testid="toast"][data-on]');
    await p.waitForTimeout(250);
    expect(await overRulers(p), 'tip and toast clear of the rulers').toEqual([]);
    expect(await run(p, 'layer.adj-curves')).toBe(true);
    await p.waitForSelector('[data-testid="panel-properties"] [data-testid="adjust-props"] :is(.fpe-field, .fpe-row)', { state: 'visible' });
    await p.waitForTimeout(300);
    // A slider is an .fpe-field (controls.ts), a list an .fpe-row: both are controls.
    // Fully in view: inside the window, not cut by any card or scroll box around it, and no word cut short.
    const fully = (sel: string, k: number): Promise<string[]> => p.evaluate(([s, n]) => {
      const out: string[] = [], els = Array.from(document.querySelectorAll<HTMLElement>(s)).filter((e) => e.getBoundingClientRect().width > 0).slice(0, n);
      if (els.length < n) out.push(`only ${els.length} of ${n}: ${s}`);
      for (const el of els) {
        const a = el.getBoundingClientRect(), name = el.getAttribute('data-testid') ?? (el.textContent ?? '').trim().slice(0, 30);
        if (a.top < 0 || a.bottom > innerHeight || a.left < 0 || a.right > innerWidth) out.push('off screen: ' + name);
        for (let up = el.parentElement; up; up = up.parentElement) {
          const cs = getComputedStyle(up);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const b = up.getBoundingClientRect();
          if (a.top < b.top - 0.5 || a.bottom > b.bottom + 0.5 || a.left < b.left - 0.5 || a.right > b.right + 0.5) { out.push('cut by its card: ' + name); break; }
        }
        if (el.scrollWidth > el.clientWidth + 1) out.push('words cut: ' + name);
      }
      return out;
    }, [sel, k] as const);
    const acts = ['layer-add', 'layer-mask-add', 'layer-duplicate', 'layer-delete'].map((t) => `[data-testid="${t}"] .fpe-btn-text`).join(', ');
    const props = '[data-testid="panel-properties"] [data-testid="adjust-props"] :is(.fpe-field, .fpe-row)';
    expect(await fully(acts, 4), 'New, Mask, Copy and Delete in full').toEqual([]);
    expect(await fully(props, 4), 'the first four controls in full').toEqual([]);
    expect(await clipped(p), '1440: nothing in a dock card is cut').toEqual([]);
    // The Layers card: no Name field (rename happens in the row), and the list hugs its rows.
    expect(await p.isVisible('[data-testid="layer-name"]'), 'no Name field under the actions').toBe(false);
    expect(await p.$eval('[data-testid="layer-list"]', (l) => l.clientHeight - Array.from(l.children).reduce((s, r) => s + r.getBoundingClientRect().height, 0)),
      'the list hugs its rows').toBeLessThanOrEqual(4);
    // Read in the page: inside a quoted CSS selector "\\d" is a hex escape, so a :text-matches regex never ran.
    expect(await p.$$eval('[data-testid="dock"] *', (els) => els.filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && /^\+\d+$/.test((e.textContent ?? '').trim())).length),
      'no "+n" chip on the resting dock').toBe(0);
    // The status bar as in a-deep: size, colour space, the layer's plain and pro names, saved on this device.
    expect(await p.textContent('[data-testid="status-layer"]')).toBe('Tone curve layer · pros call it Curves');
    expect(await p.textContent('[data-testid="status-space"]')).toBe('sRGB · 8 bits a channel');
    expect(await p.textContent('[data-testid="learn-text"]')).toContain('Pros call it a Curves layer.');
    await p.screenshot({ path: join(OUT, 'ui-b-1440-adjust.png') });
    await p.screenshot({ path: join(OUT, 'ui-c-1440-adjust.png') });
    // Below 1400 px the dock is one card with three tabs; nothing in it is cramped.
    await p.setViewportSize({ width: 1280, height: 800 });
    await p.waitForSelector('[data-testid="dock-views"]', { state: 'visible' });
    await p.click('[data-testid="dview-layers"]');
    await p.waitForTimeout(200);
    expect(await fully(acts, 4), '1280: New, Mask, Copy and Delete in full').toEqual([]);
    expect(await clipped(p), '1280 Layers: nothing cut').toEqual([]);
    // One tab in the card: its "..." sits in the switch row and the card has no empty header strip over Blend.
    expect(await p.isVisible('[data-testid="group-layers"] .fpe-ghead'), '1280: no empty header strip').toBe(false);
    expect(await p.isVisible('[data-testid="dock-views"] [data-testid="gmore-layers"]'), "1280: the card's ... in the switch row").toBe(true);
    await p.screenshot({ path: join(OUT, 'ui-b-1280-tabs.png') });
    await p.screenshot({ path: join(OUT, 'ui-c-1280-tabs.png') });
    await p.click('[data-testid="dview-props"]');
    await p.waitForSelector(props, { state: 'visible' });
    expect(await fully(props, 4), '1280: the first four controls in full').toEqual([]);
    await p.waitForTimeout(150);
    expect(await clipped(p), '1280 Properties: nothing cut').toEqual([]);
    await p.screenshot({ path: join(OUT, 'ui-b-1280-props.png') });
    await p.click('[data-testid="dview-history"]');
    await p.waitForSelector('[data-testid="history-list"]', { state: 'visible' });
    expect(await clipped(p), '1280 History: nothing cut').toEqual([]);
    // A folder's Blend reads "Pass through" in full.
    await p.click('[data-testid="dview-layers"]');
    expect(await run(p, 'layer.group')).toBe(true);
    await p.waitForTimeout(150);
    const fit = await p.$eval('[data-testid="layer-top"] [data-testid="layer-blend"]', (el) => {
      const s = el as HTMLSelectElement, cs = getComputedStyle(s), ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = s.selectedOptions[0]?.text ?? '';
      return { text, need: ctx.measureText(text).width + 28, have: s.clientWidth };
    });
    expect(fit.text).toBe('Pass through');
    expect(fit.need, 'Blend shows "Pass through" in full').toBeLessThanOrEqual(fit.have);
  }, 60_000);

  it('phone: Blend has a line of its own, so a folder\'s "Pass through" shows in full', async () => {
    const p = await open(390, 844, true);
    await p.tap('[data-testid="start-sample"]');
    await p.waitForSelector('[data-testid="btn-layers"]', { state: 'visible' });
    expect(await run(p, 'layer.group')).toBe(true);
    await p.tap('[data-testid="btn-layers"]');
    await p.waitForSelector('[data-testid="layer-top"] [data-testid="layer-blend"]', { state: 'visible' });
    const fit = await p.$eval('[data-testid="layer-top"] [data-testid="layer-blend"]', (el) => {
      const s = el as HTMLSelectElement, cs = getComputedStyle(s), ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = s.selectedOptions[0]?.text ?? '', op = document.querySelector('[data-testid="layer-opacity"]')?.getBoundingClientRect(), b = s.getBoundingClientRect();
      return { text, need: ctx.measureText(text).width + 28, have: s.clientWidth, ownLine: !op || op.top >= b.bottom - 1 };
    });
    expect(fit.text).toBe('Pass through');
    expect(fit.need, 'phone: Blend shows "Pass through" in full').toBeLessThanOrEqual(fit.have);
    expect(fit.ownLine, 'phone: Opacity sits below Blend, not beside it').toBe(true);
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
        const bar = document.querySelector('[data-testid="options"]')?.getBoundingClientRect();
        if (bar) for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="options"] :is(label, output, input, button)'))) {
          const a = el.getBoundingClientRect();
          if (a.width && a.height && (a.top < bar.top - 1 || a.bottom > bar.bottom + 1)) tabsOut.push(`clipped in the options bar: ${(el.textContent ?? el.getAttribute('data-testid') ?? '').trim()}`);
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
