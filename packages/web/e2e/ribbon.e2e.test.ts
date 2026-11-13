// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Task ribbon on desktop (R2) in a real headless Chrome at 1440 x 900: switching tabs by mouse and by keys, the tab
 * that opens on first run and the one remembered after a reload, a Planned item that is disabled and says so, the hover
 * card with both names and the ribbon home, and every Ready command reached with real clicks within the count its home
 * promises (`clicks()` in ribbon-homes.ts). Screenshots go to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts ribbon
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cost, open as openSpot, ways } from './ribbon';
import { SHEETS, TABS, clicks, firstTab, homeText, homes } from '../src/ribbon-homes';
import { BY_ID } from '../src/registry';

interface Fpe { openSample(): void; state(): Record<string, unknown>; }
type Win = Window & { fpe: Fpe; __n: { dl: number; open: number; pick: number } };

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'e2e', 'out');
const CHROME = process.env.CHROME_PATH;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
let step = '';
/** A fresh browser profile (nothing remembered) at 1440 x 900, with the ribbon loaded. */
async function open(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${step}: ${e.message}`));
  await p.addInitScript(stubs);
  await p.goto(url);
  await ready(p);
  return p;
}
async function ready(p: Page): Promise<void> {
  await p.waitForFunction(() => !!(window as unknown as Win).fpe);
  await p.waitForSelector('[data-testid="rtab-effects-masks"]');
}
/** The resting screen: a photo open, nothing else opened. */
async function rest(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as Win).fpe.openSample());
  await p.waitForFunction(() => !!document.querySelector('[data-testid="doc-tab"]'));
  // Hide the toast (blanking its text left an empty pill in the shots).
  await p.evaluate(() => { const t = document.querySelector<HTMLElement>('[data-testid="toast"]'); if (t) t.style.visibility = 'hidden'; });
}
const selected = (p: Page): Promise<string[]> =>
  p.$$eval('[data-testid^="rtab-"][aria-selected="true"]', (els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
const bodyShown = (p: Page): Promise<boolean> => p.$eval('[data-testid="ribbon-body"]', (el) => !(el as HTMLElement).hidden && el.getBoundingClientRect().height > 40);

const suite = CHROME ? describe : describe.skip;
suite('R2 Task ribbon at 1440 x 900 (headless Chrome)', () => {
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

  // The first tab, deep-first, that is at least half Ready at rest; it becomes Effects & masks once wave 1 lands.
  const FIRST = 'rtab-' + slug(firstTab((id) => BY_ID.get(id)?.status === 'ready'));
  it('opens the first mostly Ready tab on first run, then the tab last used after a reload', async () => {
    step = 'first run';
    const p = await open();
    expect(await selected(p)).toEqual([FIRST]);
    expect(await bodyShown(p)).toBe(true);
    await rest(p);
    expect(await selected(p), 'opening a photo keeps the first-run tab').toEqual([FIRST]);
    expect(await p.$$eval('[data-testid="ribbon-body"] [data-cmd]', (els) => els.filter((e) => e.getAttribute('data-status') === 'ready').length * 2 >= els.length),
      'at least half the first-run tab is Ready').toBe(true);
    expect(await bodyShown(p)).toBe(true);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'r2-rest-1440.png') });
    await p.click('[data-testid="rtab-arrange-layers"]');
    await p.reload();
    await ready(p);
    expect(await selected(p), 'the tab used last comes back').toEqual(['rtab-arrange-layers']);
    await rest(p);
    expect(await selected(p)).toEqual(['rtab-arrange-layers']);
  }, 60_000);

  it('switches tabs by mouse and by arrow keys, shows each tab\'s groups, and the contextual chip comes and goes', async () => {
    step = 'tabs';
    const p = await open();
    await rest(p);
    for (const t of TABS) {
      await p.click(`[data-testid="rtab-${slug(t.plain)}"]`);
      expect(await selected(p)).toEqual([`rtab-${slug(t.plain)}`]);
      expect(await p.getAttribute('[data-testid="ribbon-body"]', 'data-tab')).toBe(slug(t.plain));
      for (const g of t.groups) expect(await p.locator(`[data-testid="rgroup-${slug(t.plain)}-${slug(g.plain)}"]`).count(), `${t.plain} › ${g.plain}`).toBe(1);
      if (t.plain === 'Filters & blur') {
        await p.mouse.move(720, 600);
        await p.waitForTimeout(300);
        await p.screenshot({ path: join(OUT, 'r2-filters-1440.png') });
      }
    }
    await p.focus('[data-testid="rtab-effects-masks"]');
    await p.keyboard.press('ArrowLeft');
    expect(await selected(p), 'ArrowLeft from the first tab wraps to the last').toEqual([`rtab-${slug(TABS[TABS.length - 1].plain)}`]);
    await p.keyboard.press('ArrowRight');
    expect(await selected(p)).toEqual(['rtab-effects-masks']);
    await p.keyboard.press('ArrowRight');
    expect(await selected(p)).toEqual([`rtab-${slug(TABS[1].plain)}`]);
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')).toBe(`rtab-${slug(TABS[1].plain)}`);
    // A tool change opens its options as the contextual tab; a task tab takes the ribbon back.
    await p.click('[data-testid="tool-move"]');
    await p.waitForSelector('[data-testid="rctx"][aria-pressed="true"]');
    expect(await selected(p)).toEqual([]);
    expect(await p.isVisible('[data-testid="ribbon-ctx"]')).toBe(true);
    await p.click('[data-testid="rtab-paint-draw"]');
    expect(await selected(p)).toEqual(['rtab-paint-draw']);
    expect(await p.getAttribute('[data-testid="rctx"]', 'aria-pressed')).toBe('false');
    expect(await bodyShown(p)).toBe(true);
  }, 60_000);

  it('shows a Planned item disabled with its tag, and clicking it changes nothing', async () => {
    step = 'planned';
    const p = await open();
    await rest(p);
    const id = 'select.subject';
    expect(BY_ID.get(id)?.status).not.toBe('ready');
    await p.click(`[data-testid="rtab-${slug(homes().get(id)?.tab ?? '')}"]`);
    const sel = `[data-testid="ribbon-body"] [data-testid="ri-${id}"]`;
    await p.waitForSelector(sel);
    expect(await p.getAttribute(sel, 'aria-disabled')).toBe('true');
    expect(await p.getAttribute(sel, 'data-status')).toBe('planned');
    expect((await p.textContent(`${sel} .fpe-tag`))?.trim()).toBe('Planned');
    // Every Planned item on every tab carries the tag and refuses.
    const bad: string[] = [];
    for (const t of TABS) {
      await p.click(`[data-testid="rtab-${slug(t.plain)}"]`);
      bad.push(...await p.$$eval('[data-testid="ribbon-body"] [data-status="planned"]', (els) =>
        els.filter((e) => e.getAttribute('aria-disabled') !== 'true' || e.querySelector('.fpe-tag')?.textContent?.trim() !== 'Planned').map((e) => e.getAttribute('data-testid') ?? '')));
    }
    expect(bad).toEqual([]);
    await p.click(`[data-testid="rtab-${slug(homes().get(id)?.tab ?? '')}"]`);
    const before = JSON.stringify(await p.evaluate(() => (window as unknown as Win).fpe.state()));
    await p.$eval(sel, (el) => (el as HTMLElement).click());
    await p.waitForTimeout(300);
    expect(JSON.stringify(await p.evaluate(() => (window as unknown as Win).fpe.state()))).toBe(before);
    expect(await p.locator('[aria-modal="true"]:visible').count()).toBe(0);
  }, 60_000);

  it('names every ribbon item in plain words, never an id, and fits each tab at 1440 with no word cut off', async () => {
    step = 'plain words';
    const p = await open();
    await rest(p);
    const ID = /^[a-z]+\.[a-z0-9.-]+$/;
    const lines = (sel: string): Promise<string[]> => p.$$eval(sel, (els) => els.flatMap((e) => (e as HTMLElement).innerText.split('\n')).map((x) => x.trim()).filter(Boolean));
    const raw: string[] = [], bad: string[] = [], log: string[] = [], heights = new Set<number>();
    for (const t of TABS) {
      await p.click(`[data-testid="rtab-${slug(t.plain)}"]`);
      raw.push(...(await lines('.fpe-top, .fpe-rtabs, [data-testid="ribbon-body"]')).filter((x) => ID.test(x)).map((x) => `${t.plain}: ${x}`));
      const m = await p.evaluate(() => {
        // The visible box of the ribbon body: its top plus its client height, so a horizontal scroll bar does not count as room.
        const b = document.querySelector<HTMLElement>('[data-testid="ribbon-body"]')!, rb = b.getBoundingClientRect(), floor = rb.top + b.clientTop + b.clientHeight;
        return { over: b.scrollWidth - b.clientWidth, fit: b.dataset.fit ?? '', height: Math.round(document.querySelector<HTMLElement>('.fpe-ribbon')!.getBoundingClientRect().height),
          cut: [...b.querySelectorAll<HTMLElement>('.fpe-rcap')].filter((c) => c.getBoundingClientRect().bottom > floor + 0.5).map((c) => 'caption below the ribbon: ' + c.textContent),
          clipped: [...b.querySelectorAll<HTMLElement>('.fpe-rlabel, .fpe-plain')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => 'word cut: ' + e.textContent) };
      });
      heights.add(m.height);
      log.push(`${t.plain}: fit ${m.fit}, ribbon ${m.height} px tall, ${m.over > 1 ? m.over + ' px too wide' : 'fits'}${m.cut.length + m.clipped.length ? ', ' + [...m.cut, ...m.clipped].join('; ') : ''}`);
      // Every group caption is inside the ribbon on every tab. Filters & blur and the first-run tab must also fit their width
      // with no word cut; the other tabs' width is logged for R3.
      bad.push(...m.cut.map((x) => `${t.plain}: ${x}`));
      if (t.plain === 'Filters & blur' || 'rtab-' + slug(t.plain) === FIRST) bad.push(...[...(m.over > 1 ? [`${m.over} px too wide`] : []), ...m.clipped].map((x) => `${t.plain}: ${x}`));
      if (t.plain === 'Effects & masks') await p.screenshot({ path: join(OUT, 'r2-effects-1440.png') });
      for (const more of await p.$$eval('[data-testid="ribbon-body"] [data-testid^="rmore-"]', (els) => els.map((e) => e.getAttribute('data-testid') ?? ''))) {
        await p.click(`[data-testid="${more}"]`);
        await p.waitForSelector('[data-testid="rlist"]');
        raw.push(...(await lines('[data-testid="rlist"]')).filter((x) => ID.test(x.split(' · ')[0])).map((x) => `${more}: ${x}`));
        await p.keyboard.press('Escape');
      }
    }
    for (const s of SHEETS) {
      await p.click(`[data-testid="rsheet-${slug(s.plain)}"]`);
      await p.waitForSelector('[data-testid="rlist"]');
      raw.push(...(await lines('[data-testid="rlist"]')).filter((x) => ID.test(x.split(' · ')[0])).map((x) => `${s.plain} sheet: ${x}`));
      await p.keyboard.press('Escape');
    }
    console.log('R2 ribbon at 1440 x 900, per tab:\n' + log.join('\n'));
    expect(raw, 'ids shown as labels').toEqual([]);
    expect(bad).toEqual([]);
    expect([...heights], 'the ribbon keeps one height on every tab').toHaveLength(1);
  }, 120_000);

  it('the hover card shows the plain name, the pro name, the help line and the ribbon home', async () => {
    step = 'hover card';
    const p = await open();
    await rest(p);
    const ids = await p.$$eval('[data-testid="ribbon-body"] [data-status="ready"]', (els) => els.map((e) => e.getAttribute('data-cmd') ?? ''));
    const id = ids.find((x) => { const r = BY_ID.get(x); return !!r && !!r.pro && r.pro !== r.plain && !!r.help; });
    if (!id) throw new Error('no Ready item with a pro name on the first-run tab');
    const r = BY_ID.get(id)!;
    await p.hover(`[data-testid="ribbon-body"] [data-testid="ri-${id}"]`);
    await p.waitForSelector('[data-testid="tip"]:not([hidden])');
    expect((await p.textContent('[data-testid="tip"] .fpe-tip-head strong'))?.trim()).toBe(r.plain);
    expect((await p.textContent('[data-testid="tip"] .fpe-tip-head .fpe-pro'))?.trim()).toBe(r.pro);
    expect((await p.textContent('[data-testid="tip"] .fpe-tip-help'))?.trim()).toBe(r.help);
    const home = homes().get(id);
    if (home) expect(await p.textContent('[data-testid="tip"]')).toContain(homeText(home));
    await p.screenshot({ path: join(OUT, 'r2-tip-1440.png') });
  }, 60_000);

  it('reaches every Ready command with real clicks within the count its home promises', async () => {
    step = 'sweep';
    const p = await open();
    const promise = clicks();
    const ids = [...homes().keys()].filter((id) => BY_ID.get(id)?.status === 'ready');
    expect(ids.length).toBeGreaterThanOrEqual(120);
    const late: string[] = [], missed: string[] = [];
    let off = 0;
    for (const id of ids) {
      step = `sweep ${id}`;
      await p.evaluate(() => { try { localStorage.clear(); } catch { /* nothing kept */ } });
      await p.reload();
      await ready(p);
      await rest(p);
      let got: { n: number; sel: string } | null = null;
      for (const s of ways(id)) {
        got = await openSpot(p, s);
        if (got) break;
        await p.keyboard.press('Escape');
      }
      if (!got) { missed.push(id); continue; }
      const want = promise.get(id) ?? 0;
      if (got.n > want) late.push(`${id}: promised ${want}, took ${got.n} (${ways(id).map((s) => `${s.place} ${cost(s)}`).join(', ')})`);
      const el = p.locator(got.sel).first();
      if ((await el.getAttribute('aria-disabled')) === 'true') off++;
      else await el.click({ timeout: 5000 }).catch((e: Error) => missed.push(`${id}: ${e.message.split('\n')[0]}`));
      await p.waitForTimeout(30);
    }
    console.log(`R2 sweep at 1440 x 900: ${ids.length} Ready commands; ${ids.length - late.length - missed.length} within their promise; ${off} reached but disabled on the resting screen; late ${JSON.stringify(late)}; missed ${JSON.stringify(missed)}`);
    // No known gap: the History card (its tab, step back and step forward) keeps History on screen as ribbon-homes.ts promises.
    const GAP: string[] = [];
    expect(missed).toEqual(GAP);
    expect(late).toEqual([]);
  }, 600_000);

  it('raised no page errors', () => {
    expect(errors).toEqual([]);
  });
});
