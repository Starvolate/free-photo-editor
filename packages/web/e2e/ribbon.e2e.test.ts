// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Task ribbon on desktop (R2) in a real headless Chrome at 1440 x 900: switching tabs by mouse and by keys, the tab
 * that opens on first run and the one remembered after a reload, Planned items kept out of the resting rows (they wait,
 * disabled and tagged, under "Coming" in their group's More), nothing greyed before a picture is open, the start screen
 * fitting 1440 x 900, live gallery previews, the hover card with both names and the ribbon home, and every Ready command
 * reached with real clicks within the count its home promises (`clicks()` in ribbon-homes.ts). Screenshots go to e2e/out.
 * Run: npm run build && CHROME_PATH=<Chrome binary> npx vitest run --config packages/web/vitest.e2e.config.ts ribbon
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cost, open as openSpot, ways } from './ribbon';
import { SHEETS, TABS, clicks, firstTab, homeText, homes, restOf } from '../src/ribbon-homes';
import { BY_ID, stem, words } from '../src/registry';

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
    // The first photo of a first run says, in one line, what to try first, under that command.
    await p.waitForSelector('[data-testid="rhint"]:not([hidden])');
    expect((await p.textContent('[data-testid="rhint"]'))?.startsWith('Try this first: '), 'the one-line hint').toBe(true);
    expect(await p.$eval('[data-testid="rhint"]', (e) => e.getBoundingClientRect().height < 40), 'one line').toBe(true);
    // It sits in the ribbon's own row, over no ruler and none of the picture area.
    expect(await p.$eval('[data-testid="rhint"]', (e) => {
      const a = e.getBoundingClientRect(), r = document.querySelector('[data-testid="ribbon-body"]')?.getBoundingClientRect();
      const over = Array.from(document.querySelectorAll('.fpe-ruler, .fpe-stage')).some((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; });
      return !over && !!r && a.top >= r.top - 0.5 && a.bottom <= r.bottom + 0.5;
    }), 'the tip covers nothing').toBe(true);
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
      // A group shows when it has a Ready command (a family when one of its "more" commands is Ready, ribbon.ts familiesEl);
      // a group with nothing Ready stays off the resting ribbon and must be absent, not merely hidden.
      for (const g of t.groups) {
        const r = restOf(g), want = (g.show === 'family' ? r.more.length : r.big.length + r.shown.length + r.more.length) ? 1 : 0;
        expect(await p.locator(`[data-testid="rgroup-${slug(t.plain)}-${slug(g.plain)}"]`).count(), `${t.plain} › ${g.plain}${want ? '' : ' (nothing Ready)'}`).toBe(want);
      }
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

  it('keeps every Planned item out of the resting rows; it waits under "Coming" in its group\'s More, disabled with its tag', async () => {
    step = 'planned';
    const p = await open();
    await rest(p);
    const resting: string[] = [], soon: string[] = [];
    for (const t of TABS) {
      await p.click(`[data-testid="rtab-${slug(t.plain)}"]`);
      // A group with working commands shows only those; a group with none is off the resting ribbon: never a "Coming soon" tile.
      if (await p.$$eval('[data-testid="ribbon-body"] .fpe-rsoon', (els) => els.length) || (await p.textContent('[data-testid="ribbon-body"]'))?.includes('Coming soon')) soon.push(t.plain);
      resting.push(...(await p.$$eval('[data-testid="ribbon-body"] [data-status="planned"], [data-testid="ribbon-body"] .fpe-tag',
        (els) => els.map((e) => e.getAttribute('data-testid') ?? e.textContent ?? ''))).map((x) => `${t.plain}: ${x}`));
    }
    expect(resting, 'Planned items in a resting row').toEqual([]);
    expect(soon, 'a "Coming soon" tile on a resting tab').toEqual([]);
    // A command still Planned whose group has working ones (raw.filmic sat in Develop RAW's row until 13 Nov).
    const id = 'raw.filmic', home = homes().get(id);
    expect(BY_ID.get(id)?.status).not.toBe('ready');
    expect(home?.place).toBe('more');
    await p.click(`[data-testid="rtab-${slug(home?.tab ?? '')}"]`);
    await p.click(`[data-testid="rmore-${slug(home?.tab ?? '')}-${slug(home?.group ?? '')}"]`);
    const sel = `[data-testid="rlist"] [data-testid="ri-${id}"]`;
    await p.waitForSelector(sel);
    expect(await p.getAttribute(sel, 'aria-disabled')).toBe('true');
    expect(await p.getAttribute(sel, 'data-status')).toBe('planned');
    expect((await p.textContent(`${sel} .fpe-tag`))?.trim()).toBe('Planned');
    // Ready rows above the quiet "Coming" heading, Planned rows below it.
    expect(await p.$eval('[data-testid="rlist"]', (l) => {
      const kids = [...l.children], c = kids.findIndex((k) => k.getAttribute('data-testid') === 'rcoming');
      return c > 0 && kids.every((k, i) => (k.getAttribute('data-status') === 'planned' ? i > c : k.getAttribute('data-status') === 'ready' ? i < c : true));
    }), 'Ready above "Coming", Planned below').toBe(true);
    const before = JSON.stringify(await p.evaluate(() => (window as unknown as Win).fpe.state()));
    await p.$eval(sel, (el) => (el as HTMLElement).click());
    await p.waitForTimeout(300);
    expect(JSON.stringify(await p.evaluate(() => (window as unknown as Win).fpe.state()))).toBe(before);
    expect(await p.locator('[aria-modal="true"]:visible').count()).toBe(0);
  }, 60_000);

  it('with no picture: nothing on the ribbon reads greyed, a click brings "Open a photo" forward, no tool chip, and the start screen fits', async () => {
    step = 'no picture';
    const p = await open();
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(OUT, 'ui-a-nopic-1440.png') });
    expect(await p.isHidden('[data-testid="rctx"]'), 'no tool chip before a picture').toBe(true);
    expect(await p.getAttribute('[data-testid="btn-export"]', 'aria-disabled'), 'Export reads disabled with no picture').toBe('true');
    // The start screen: eight jobs in a 4 x 2 grid under the three buttons, all inside the stage at 1440 x 900.
    const start = await p.$eval('[data-testid="start"]', (s) => {
      const cards = [...s.querySelectorAll<HTMLElement>('.fpe-jobs > .fpe-job')], sr = s.getBoundingClientRect();
      const acts = s.querySelector('.fpe-start-actions')?.getBoundingClientRect();
      return { cards: cards.length, cols: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size, over: s.scrollHeight - s.clientHeight,
        below: cards.filter((c) => c.getBoundingClientRect().bottom > sr.bottom + 0.5).length, under: !!acts && cards.every((c) => c.getBoundingClientRect().top >= acts.bottom) };
    });
    expect({ ...start, over: Math.max(0, start.over) }, 'no scrolling: over is how far the start screen would scroll').toEqual({ cards: 8, cols: 4, over: 0, below: 0, under: true });
    const grey: string[] = [];
    for (const t of TABS) {
      await p.click(`[data-testid="rtab-${slug(t.plain)}"]`);
      grey.push(...(await p.$$eval('[data-testid="ribbon-body"] [data-cmd]', (els) => {
        const text = getComputedStyle(document.querySelector('.fpe-rtab[aria-selected="true"]') as HTMLElement).color;
        return els.filter((e) => getComputedStyle(e).color !== text || [...e.querySelectorAll('.fpe-icon, .fpe-rico')].some((i) => getComputedStyle(i).opacity !== '1'))
          .map((e) => e.getAttribute('data-testid') ?? '');
      })).map((x) => `${t.plain}: ${x}`));
    }
    expect(grey, 'greyed on the ribbon with no picture').toEqual([]);
    const need = await p.$eval('[data-testid="ribbon-body"] [data-cmd][aria-disabled="true"]', (e) => e.getAttribute('data-testid') ?? '');
    // It still says aria-disabled to a screen reader (it cannot run yet), so Playwright's click would wait: click it as a person's click does.
    await p.$eval(`[data-testid="${need}"]`, (el) => (el as HTMLElement).click());
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-testid')), `${need} brings "Open a photo" forward`).toBe('start-open');
    // Every job is still one click away: "See all 16 jobs" opens the full list.
    await p.click('[data-testid="start-all"]');
    await p.waitForSelector('[data-testid="start-modal"]');
    expect(await p.locator('[data-testid="start-modal"] .fpe-job').count()).toBeGreaterThan(8);
    await p.keyboard.press('Escape');
    expect(await p.locator('[data-testid="doc-tab"]').count(), 'and opens nothing by itself').toBe(0);
    // With a picture: the tool chip shows, Export works, and the gallery tiles preview their effect on the picture.
    await rest(p);
    expect(await p.isVisible('[data-testid="rctx"]')).toBe(true);
    expect(await p.getAttribute('[data-testid="btn-export"]', 'aria-disabled')).toBeNull();
    await p.click('[data-testid="rtab-light-colour"]');
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="ribbon-body"] .fpe-rthumb').length >= 3, null, { timeout: 20_000 });
    await p.mouse.move(720, 600);
    await p.waitForTimeout(200);
    await p.screenshot({ path: join(OUT, 'ui-a-gallery-1440.png') });
  }, 90_000);

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
        // A word cut, by the same test fit() uses to widen a button (notWhole in ribbon.ts): a label, plain or pro name wider or
        // taller than its own box, or one sticking out of its big button or tile (a word longer than the button is wide).
        const clipped = [...b.querySelectorAll<HTMLElement>('.fpe-rlabel, .fpe-plain, .fpe-pro')].filter((e) => {
          const r = e.getBoundingClientRect(), br = e.closest<HTMLElement>('.fpe-rbig, .fpe-rtile')?.getBoundingClientRect();
          return !!r.width && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 || (!!br && (r.left < br.left - 0.5 || r.right > br.right + 0.5)));
        }).map((e) => 'word cut: ' + e.textContent);
        return { over: b.scrollWidth - b.clientWidth, fit: b.dataset.fit ?? '', height: Math.round(document.querySelector<HTMLElement>('.fpe-ribbon')!.getBoundingClientRect().height),
          cut: [...b.querySelectorAll<HTMLElement>('.fpe-rcap')].filter((c) => c.getBoundingClientRect().bottom > floor + 0.5).map((c) => 'caption below the ribbon: ' + c.textContent), clipped };
      });
      heights.add(m.height);
      log.push(`${t.plain}: fit ${m.fit}, ribbon ${m.height} px tall, ${m.over > 1 ? m.over + ' px too wide' : `fits, ${-m.over} px to spare`}${m.cut.length + m.clipped.length ? ', ' + [...m.cut, ...m.clipped].join('; ') : ''}`);
      // Every group caption is inside the ribbon and no word is cut on every tab. Filters & blur and the first-run tab must
      // also fit their width; the other tabs' width is logged.
      bad.push(...[...m.cut, ...m.clipped].map((x) => `${t.plain}: ${x}`));
      if ((t.plain === 'Filters & blur' || 'rtab-' + slug(t.plain) === FIRST) && m.over > 1) bad.push(`${t.plain}: ${m.over} px too wide`);
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

  it('a sheet opened again under the same name with a new body shows the new body\'s own controls', async () => {
    step = 'sheet body';
    const p = await open();
    const shown = (): Promise<{ title: string; ids: string[] }> => p.evaluate(() => {
      const s = document.querySelector<HTMLElement>('[data-testid="sheet-probe"]');
      return { title: s?.querySelector('.fpe-sheet-title')?.textContent ?? '', ids: Array.from(s?.querySelectorAll('[data-testid^="probe-"]') ?? [], (e) => e.getAttribute('data-testid') ?? '') };
    });
    type Fpe = { sheet(id: string, title: string, body: HTMLElement): void };
    const openWith = (title: string, ids: string[]): Promise<void> => p.evaluate(([t, list]) => {
      const body = document.createElement('div');
      for (const x of list) { const b = document.createElement('button'); b.dataset.testid = x; b.textContent = x; body.append(b); }
      (window as unknown as { fpe: Fpe }).fpe.sheet('probe', t, body);
    }, [title, ids] as const);
    await openWith('First', ['probe-a', 'probe-b']);
    expect(await shown()).toEqual({ title: 'First', ids: ['probe-a', 'probe-b'] });
    await p.keyboard.press('Escape');
    await openWith('Second', ['probe-c']);
    expect(await shown(), 'the second body replaces the first').toEqual({ title: 'Second', ids: ['probe-c'] });
    expect(await p.isVisible('[data-testid="probe-c"]')).toBe(true);
  }, 60_000);

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
    // The help lines come in their own chunk after the first screen; the tip fills its line in when they arrive.
    await p.waitForSelector('[data-testid="tip"]:not([hidden]) .fpe-tip-help');
    expect((await p.textContent('[data-testid="tip"] .fpe-tip-head strong'))?.trim()).toBe(r.plain);
    expect((await p.textContent('[data-testid="tip"] .fpe-tip-head .fpe-pro'))?.trim()).toBe(r.pro);
    expect((await p.textContent('[data-testid="tip"] .fpe-tip-help'))?.trim()).toBe(r.help);
    const home = homes().get(id);
    if (home) expect(await p.textContent('[data-testid="tip"]')).toContain(homeText(home));
    await p.screenshot({ path: join(OUT, 'r2-tip-1440.png') });
  }, 60_000);

  it('search finds a Ready command by a word only its help line holds, once the help lines arrive', async () => {
    step = 'help search';
    // A word no name, pro name, wish word or place of any row starts with, and only one row's help line has.
    const rows = [...BY_ID.values()];
    const named = rows.flatMap((r) => words(`${r.plain} ${r.pro} ${r.wish} ${r.place}`).map(stem));
    const text = rows.map((r) => `${r.plain} ${r.pro} ${r.wish}`.toLowerCase());
    let pick: [string, string] | null = null;
    for (const r of rows) {
      if (r.status !== 'ready' || pick) continue;
      const w = words(r.help).find((x) => {
        const t = stem(x);
        return x.length > 5 && /^[a-z]+$/.test(x) && !named.some((n) => n.startsWith(t)) && !text.some((s) => s.includes(x)) &&
          rows.filter((o) => words(o.help).map(stem).some((n) => n.startsWith(t))).length === 1;
      });
      if (w) pick = [r.id, w];
    }
    if (!pick) throw new Error('no word in the map that only one help line holds');
    const [id, word] = pick;
    const p = await open();
    await p.click('[data-testid="btn-search"]');
    await p.fill('[data-testid="search-input"]', word);
    await p.waitForSelector(`[data-testid="search-result"][data-id="${id}"]`, { timeout: 15_000 });
    expect(await p.$$eval('[data-testid="search-result"]', (els) => els.map((e) => e.getAttribute('data-id'))), `"${word}" finds ${id}`).toEqual([id]);
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
      const sel = got.sel, el = p.locator(sel).first();
      if ((await el.getAttribute('aria-disabled')) === 'true') off++;
      else await el.click({ timeout: 5000 }).catch(async (e: Error) => {
        // Say why: the spot tried, the end of Playwright's own log (not stable, not enabled, or what intercepts the click),
        // and what sits at the command's centre with the ribbon's fit level and scroll.
        const at = await p.evaluate((sel) => {
          const c = document.querySelector<HTMLElement>(sel), b = document.querySelector<HTMLElement>('[data-testid="ribbon-body"]');
          if (!c) return 'gone';
          const r = c.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const name = (x: Element | null): string => !x ? 'nothing' : x.getAttribute('data-testid') ?? `${x.tagName.toLowerCase()}.${[...x.classList].join('.')}`;
          return `box ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}, aria-disabled ${c.getAttribute('aria-disabled')}, centre hits ${hit && (hit === c || c.contains(hit)) ? 'itself' : name(hit)}, fit ${b?.dataset.fit}, scroll ${b?.scrollLeft},${b?.scrollTop}, body hidden ${b?.hidden}`;
        }, sel.replace(/:visible$/, '')).catch((x: Error) => 'probe failed: ' + x.message.split('\n')[0]);
        missed.push(`${id} at ${sel}: ${e.message.split('\n').map((x) => x.trim()).filter(Boolean).slice(-4).join(' / ')} | ${at}`);
      });
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
