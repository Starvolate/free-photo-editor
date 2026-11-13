// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Task ribbon on desktop (1024 px and wider; phones and narrow tablets keep the menu sheet): the app bar's sheets,
 * the twelve task tabs, the open tab's groups with their captions, More lists, and the contextual tab for the tool in
 * use, which shows that tool's options. Every place comes from ribbon-homes.ts, so what the screen shows and what
 * `clicks()` promises are the same data. app.ts loads this file lazily the first time the layout is desktop, so the
 * first-screen budget holds; it keeps today's menu bar for narrower screens.
 */
import { flatten, resizeBitmap, runJob, type Bitmap, type Doc, type JobSpec } from '@free-photoeditor/core';
import { ADJ } from './commands';
import { CONTEXTUAL, SHEETS, TABS, firstTab, homes, homeText, restOf, type Group, type Rest, type Tab } from './ribbon-homes';
// The new Planned rows must be in BY_ID before any label is drawn. A bare `import './registry-union'` is dropped by the
// build (package.json declares only CSS as having side effects), which left raw ids such as "layer.smart-filters" on
// screen; importing a name keeps the module, and the line below registers any row still missing.
import { NEW_ROWS } from './registry-union';
import { BY_ID, addRows } from './registry';
import { h, icon } from './dom';
import css from './ribbon.css?inline';

/** What the ribbon needs from the editor. Elements are moved, never copied, so their test ids and listeners stay. */
export interface RibbonHost {
  root: HTMLElement;
  appBar: HTMLElement;
  tabRow: HTMLElement;
  ribbon: HTMLElement;
  options: HTMLElement;
  docTabs: HTMLElement;
  toolId(): string | null;
  run(id: string): Promise<boolean>;
  enabled(id: string): boolean;
  sync(): void;
  keyText(k: string): string;
  toast(msg: string): void;
  /** The open picture, or a small sample when none is open: the gallery tiles preview their effect on it. */
  picture(): Doc;
}
export interface Ribbon {
  setActive(on: boolean): void;
  toolChanged(): void;
  optionsChanged(activity: boolean): void;
  place(id: string): string | null;
  reveal(id: string): HTMLElement | null;
  openTab(plain: string): void;
}

const KEY = 'fpe.ribbon.tab';
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ICON_BY_TAB: Record<string, string> = {
  'Effects & masks': 'layers', 'Select & cut out': 'select', 'Retouch & remove': 'bandage', 'Develop RAW': 'sun', 'AI tools': 'sparkles',
  'Paint & draw': 'brush', 'Shapes & text': 'type', 'Automate & batch': 'code', 'Arrange layers': 'layers', 'Crop & resize': 'crop',
  'Light & colour': 'contrast', 'Filters & blur': 'droplet',
};
/** An icon from the editor's own set for a command, by what its id says it does. */
export function iconFor(id: string, tab = ''): string {
  const rules: [RegExp, string][] = [
    [/mask/, 'scan'], [/adj-|levels|curves|exposure|tone/, 'sliders'], [/fx-|style|glow|shadow/, 'sparkles'], [/^ai\.|subject|sky|generat/, 'sparkles'],
    [/lasso/, 'lasso'], [/wand|quick-select|object/, 'wand'], [/^select\./, 'select'], [/crop/, 'crop'], [/heal|patch|red-eye|remove/, 'bandage'],
    [/clone|stamp/, 'stamp'], [/^type\.|tool\.type|text/, 'type'], [/pen|path/, 'pen'], [/brush|paint|pencil/, 'brush'], [/eraser/, 'eraser'],
    [/bucket|fill/, 'bucket'], [/blur|sharpen|smudge|filter\./, 'droplet'], [/dodge|burn|sponge/, 'dodge'], [/shape|rect|ellipse|polygon|line/, 'shapes'],
    [/copy|paste|cut|duplicate/, 'copy'], [/merge|flatten/, 'merge'], [/link/, 'link'], [/lock/, 'lock'], [/delete|clear/, 'trash'], [/new/, 'plus'],
    [/move|align|distribute|arrange/, 'move'], [/rotate|flip|transform|warp/, 'swap'], [/size|canvas|trim/, 'fit'], [/^image\.|colour|color|hue|bw/, 'contrast'],
    [/action|batch|script|macro/, 'code'], [/^view\.|zoom/, 'eye'], [/^file\./, 'open'], [/^help\.|^edit\.pref/, 'info'], [/eyedropper|sample|measure|ruler/, 'pipette'],
  ];
  for (const [re, name] of rules) if (re.test(id)) return name;
  return ICON_BY_TAB[tab] ?? 'square';
}
if (NEW_ROWS.some((r) => !BY_ID.has(r.id))) addRows(NEW_ROWS.filter((r) => !BY_ID.has(r.id)));
/** A command's plain name; never its id ("layer.smart-filters" reads "Smart filters" if a row is ever missing). */
const plainOf = (id: string): string => BY_ID.get(id)?.plain ?? (id.split('.').pop() ?? id).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** What the effect families (Filters & blur) are called as one group. */
const FAMILIES = 'Every effect, by kind';
/** The ribbon buttons that widen when their words would not show whole (fit() in mountRibbon). */
const WIDE = '.fpe-rbig, .fpe-rtile, .fpe-rsmall';
/**
 * True when a button's words do not show whole: a label, plain or pro name wider or taller than its own box, one sticking
 * out of the button at either side (a word longer than the button is wide), or the button's bottom below `room`.
 */
function notWhole(b: HTMLElement, room: number): boolean {
  const br = b.getBoundingClientRect();
  if (br.bottom > room + 0.5) return true;
  for (const e of b.querySelectorAll<HTMLElement>('.fpe-rlabel, .fpe-plain, .fpe-pro')) {
    const r = e.getBoundingClientRect();
    if (!r.width) continue;
    if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 || r.left < br.left - 0.5 || r.right > br.right + 0.5) return true;
    // A label taller than its button (a small button's label wrapping past its 27 px row) lies over the button below it
    // and takes its clicks (Develop RAW at fit 4 hid Exposure, 13 Nov 2026).
    if (r.top < br.top - 0.5 || r.bottom > br.bottom + 0.5) return true;
  }
  return false;
}
/** Gallery previews are drawn at this size (twice the tile's 64 x 40 box, for sharp screens). */
const TW = 128, TH = 80;
type Src = { key: number; w: number; h: number; bmp: Bitmap };
/**
 * A preview of one command on a small copy of the picture, from its own settings (commands.ts ADJ); a setting that rests
 * at zero is pushed a third of its way so the change shows. An adjustment layer previews as its image adjustment.
 * Null when the command has no settings to preview with (its icon stays).
 */
async function preview(id: string, s: Src): Promise<ImageData | null> {
  const def = ADJ[id] ?? ADJ[id.replace(/^layer\.adj-/, 'image.adj-')];
  if (!def || def.colors) return null;
  const params: Record<string, number> = {};
  for (const c of def.controls) params[c.key] = (!c.type || c.type === 'range') && c.value === 0 && (c.max ?? 0) > 0 ? Math.round((c.max ?? 0) / 3) : c.value;
  const spec = { op: def.op, kind: def.kind, params } as JobSpec;
  const out = def.op === 'fx' ? (await import('@free-photoeditor/core/fx')).runEffect(spec, s.bmp) : runJob(spec, s.bmp);
  return new ImageData(new Uint8ClampedArray(out), s.w, s.h);
}
const idle = (f: () => void): void => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 1000 }); else setTimeout(f, 80);
};
const readTab = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeTab = (t: string): void => { try { localStorage.setItem(KEY, t); } catch { /* private window: the tab is simply not remembered */ } };

export function mountRibbon(host: RibbonHost): Ribbon {
  const { root, appBar, tabRow, ribbon, options } = host;
  const style = document.createElement('style');
  style.textContent = css;
  const rn = root.getRootNode();
  (rn instanceof ShadowRoot ? rn : document.head).append(style);
  const home = homes();
  const tag = (): HTMLElement => h('span', { class: 'fpe-tag' }, 'Planned');
  const ready = (id: string): boolean => BY_ID.get(id)?.status === 'ready';
  const names = (plain: string, pro: string, cls = 'fpe-names'): HTMLElement =>
    h('span', { class: cls }, h('span', { class: 'fpe-plain' }, plain), pro && pro !== plain ? h('span', { class: 'fpe-pro' }, pro) : null);
  const hasDoc = (): boolean => root.hasAttribute('data-has-doc');
  /**
   * With no picture open, a command that needs one looks like any other; clicking it brings the start screen's "Open a
   * photo" choice forward (focused, with a short line), never nothing at all.
   */
  const askForPhoto = (id: string): void => {
    const open = root.querySelector<HTMLElement>('[data-testid="start-open"]');
    open?.focus({ preventScroll: true });
    host.toast(`Open a photo first, or try the sample photo. Then ${plainOf(id)} is ready to use.`);
  };
  const press = (id: string, b: HTMLElement, planned: boolean): void => {
    if (b.getAttribute('aria-disabled') !== 'true') { closeList(); void host.run(id); } else if (!planned && !hasDoc()) { closeList(); askForPhoto(id); }
  };

  // ---------- the app bar: File, View, Help and Export sheets; the contextual chip; the document tabs ----------
  const sheetBtn = (plain: string, ids: string[], label = plain): HTMLButtonElement => {
    const s = SHEETS.find((x) => x.plain === plain);
    const b = h('button', { type: 'button', class: 'fpe-btn fpe-rsheet', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-testid': 'rsheet-' + slug(plain),
      'data-help-title': `${plain} · ${s?.pro ?? plain}`, 'data-help': `${ids.length} commands, two clicks away.` }, label ? h('span', {}, label) : null, icon('chev-down'));
    b.addEventListener('click', () => (openList === b ? closeList() : showList(s?.plain ?? plain, s?.pro ?? '', ids.filter(ready), b, 'sheet', ids.filter((x) => !ready(x)))));
    return b;
  };
  const fileBtn = sheetBtn('File', SHEETS.find((s) => s.plain === 'File')?.ids ?? []);
  const viewBtn = sheetBtn('View', SHEETS.find((s) => s.plain === 'View')?.ids ?? []);
  const helpBtn = sheetBtn('Help', SHEETS.find((s) => s.plain === 'Help')?.ids ?? []);
  const exportMore = sheetBtn('Export', SHEETS.find((s) => s.plain === 'Export')?.ids ?? [], '');
  exportMore.classList.add('fpe-rexport-more');
  exportMore.setAttribute('aria-label', 'Every way to export');
  const chip = h('button', { type: 'button', class: 'fpe-btn fpe-rctx', 'data-testid': 'rctx', 'aria-pressed': 'false', hidden: true });
  chip.addEventListener('click', () => (view === 'ctx' ? showTab(current) : showCtx()));
  const q = (t: string): HTMLElement | null => appBar.querySelector<HTMLElement>(`[data-testid="${t}"]`);
  const marks = new Map<HTMLElement, Comment>(), fresh = new Set<HTMLElement>();
  const moveTo = (el: HTMLElement | null, parent: HTMLElement, before: Node | null = null): void => {
    if (!el) return;
    if (!el.parentNode) fresh.add(el);
    else if (!marks.has(el) && !fresh.has(el)) { const m = document.createComment('ribbon'); el.before(m); marks.set(el, m); }
    parent.insertBefore(el, before);
  };
  /** Put every moved element back where it was, then take away what the ribbon added. */
  const restore = (): void => {
    for (const [el, m] of marks) m.replaceWith(el);
    marks.clear();
    for (const el of fresh) el.remove();
    fresh.clear();
  };
  const appSlots = h('div', { class: 'fpe-rapp' }, fileBtn);
  const right = h('div', { class: 'fpe-rapp-right' }, viewBtn, helpBtn);

  // ---------- the tab row ----------
  // First run: the first tab, deep-first, that is at least half Ready at rest (firstTab); after that, the tab used last.
  let current = TABS.some((t) => t.plain === readTab()) ? (readTab() as string) : firstTab(ready);
  let view: 'tab' | 'ctx' = 'tab';
  const tabBtns = new Map<string, HTMLButtonElement>();
  for (const t of TABS) {
    const b = h('button', { type: 'button', role: 'tab', class: 'fpe-rtab', 'aria-selected': 'false', 'data-testid': 'rtab-' + slug(t.plain),
      'data-help-title': t.plain, 'data-help': `Pros call this ${t.pro}.` }, t.plain);
    b.addEventListener('click', () => { showTab(t.plain); writeTab(t.plain); });
    tabBtns.set(t.plain, b);
    tabRow.append(b);
  }
  tabRow.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = [...tabBtns.values()], i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.focus();
    next.click();
  });

  // ---------- the ribbon body ----------
  const body = h('div', { class: 'fpe-rbody', role: 'tabpanel', 'data-testid': 'ribbon-body' });
  const ctxWrap = h('div', { class: 'fpe-rctxbody', 'data-testid': 'ribbon-ctx', hidden: true });
  const ctxMore = h('div', { class: 'fpe-rgroup fpe-rctxmore' });
  ribbon.append(body, ctxWrap);

  const cmd = (id: string, kind: 'big' | 'small' | 'tile', tab: string): HTMLButtonElement => {
    const r = BY_ID.get(id), plain = plainOf(id), pro = r?.pro ?? '', planned = !ready(id);
    // A tile sits under a caption that already says what kind it is ("Editable light and colour"), so it drops " layer".
    const short = kind === 'tile' ? plain.replace(/ layer$/, '') : plain;
    const attrs = { type: 'button', class: 'fpe-r' + kind, 'data-cmd': id, 'data-testid': 'ri-' + id, 'data-status': planned ? 'planned' : 'ready',
      'aria-disabled': planned || !host.enabled(id) ? 'true' : null, 'aria-label': `${plain}${pro && pro !== plain ? ' · ' + pro : ''}${planned ? ', planned' : ''}` };
    const b = kind === 'small'
      ? h('button', attrs, icon(iconFor(id, tab)), h('span', { class: 'fpe-rlabel' }, plain), planned ? tag() : null)
      : h('button', attrs, h('span', { class: 'fpe-rico' }, icon(iconFor(id, tab))), kind === 'big' ? names(plain, pro, 'fpe-names fpe-rlabel') : h('span', { class: 'fpe-rlabel' }, short), planned ? tag() : null);
    b.addEventListener('click', () => press(id, b, planned));
    return b;
  };
  /** A group at rest (ribbon-homes.ts restOf): its Ready commands, then one "More" at its end; with nothing Ready, one "Coming soon" tile. */
  const groupEl = (t: Tab, g: Group): HTMLElement => {
    const items = h('div', { class: 'fpe-ritems' }), r = restOf(g, ready);
    for (const id of r.big) items.append(cmd(id, 'big', t.plain));
    if (g.show === 'gallery' && r.shown.length) items.append(h('div', { class: 'fpe-rgal' }, ...r.shown.map((id) => cmd(id, 'tile', t.plain))));
    else if (r.shown.length) items.append(h('div', { class: 'fpe-rsmalls' }, ...r.shown.map((id) => cmd(id, 'small', t.plain))));
    if (r.more.length || r.coming.length) items.append(moreBtn(t, g, r));
    return h('div', { class: 'fpe-rgroup', role: 'group', 'aria-label': g.plain, 'data-testid': 'rgroup-' + slug(t.plain) + '-' + slug(g.plain) },
      items, h('div', { class: 'fpe-rcap', 'data-help-title': g.plain, 'data-help': `Pros call this ${g.pro}.` }, g.plain));
  };
  /**
   * A group's More list opener: one "More" at the end of its buttons, a whole-group button ("4 commands"), a family's
   * named button, or, when nothing in the group works yet, one quiet "Coming soon" tile. The list holds the Ready
   * commands first and the Planned ones under "Coming".
   */
  const moreBtn = (t: Tab, g: Group, r: Rest): HTMLButtonElement => {
    const gid = slug(t.plain) + '-' + slug(g.plain), all = [...r.more, ...r.coming];
    const kind = g.show === 'family' ? 'family' : !r.big.length && !r.shown.length && !r.more.length ? 'soon' : g.show === 'button' ? 'button' : 'more';
    const help = kind === 'soon' ? `Planned: ${all.slice(0, 4).map(plainOf).join(', ')}${all.length > 4 ? '…' : ''}`
      : `${all.length} ${kind === 'family' ? 'kinds' : 'more'}: ${all.slice(0, 4).map(plainOf).join(', ')}${all.length > 4 ? '…' : ''}`;
    const cls = { family: 'fpe-rpill', soon: 'fpe-rsoon', button: 'fpe-rbig fpe-rgroupbtn', more: 'fpe-rmore' }[kind];
    const m = h('button', { type: 'button', class: cls, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-testid': 'rmore-' + gid,
      'data-help-title': `${g.plain} · ${g.pro}`, 'data-help': help,
      'aria-label': kind === 'soon' ? `${g.plain}: coming soon, ${all.length} planned` : `More in ${g.plain}: ${all.length}` },
    ...(kind === 'family' ? [icon(iconFor(all[0], t.plain)), h('span', { class: 'fpe-rlabel' }, g.plain), icon('chev-down')]
      : kind === 'soon' ? [h('span', { class: 'fpe-rlabel' }, 'Coming soon'), h('span', { class: 'fpe-rsoon-n' }, `${all.length} planned`)]
        : kind === 'button' ? [h('span', { class: 'fpe-rico' }, icon(iconFor(all[0], t.plain))), h('span', { class: 'fpe-names fpe-rlabel' },
          h('span', { class: 'fpe-plain' }, `${r.more.length} commands`, icon('chev-down')), h('span', { class: 'fpe-pro' }, g.pro))]
          : [icon('chev-down'), h('span', { class: 'fpe-rlabel' }, 'More')]));
    m.addEventListener('click', () => (openList === m ? closeList() : showList(g.plain, g.pro, r.more, m, 'more', r.coming)));
    return m;
  };
  /** The effect families (Blur, Sharpen, …) as one group of named buttons in three rows, so none repeats its caption. */
  const familiesEl = (t: Tab, gs: Group[]): HTMLElement => {
    const rows: HTMLElement[] = [];
    for (let r = 0, i = 0; r < 3 && i < gs.length; r++) {
      const n = Math.floor(gs.length / 3) + (r < gs.length % 3 ? 1 : 0);
      rows.push(h('div', { class: 'fpe-rfamrow' }, ...gs.slice(i, i + n).map((g) =>
        h('div', { class: 'fpe-rfamily', role: 'group', 'aria-label': g.plain, 'data-testid': 'rgroup-' + slug(t.plain) + '-' + slug(g.plain) }, moreBtn(t, g, restOf(g, ready))))));
      i += n;
    }
    return h('div', { class: 'fpe-rgroup fpe-rfams', role: 'group', 'aria-label': FAMILIES },
      h('div', { class: 'fpe-ritems' }, h('div', { class: 'fpe-rfamrows' }, ...rows)),
      h('div', { class: 'fpe-rcap', 'data-help-title': FAMILIES, 'data-help': 'Each opens its own list. Pros call this the Filter menu.' }, FAMILIES));
  };
  /**
   * Tightens the ribbon a step at a time (ribbon.css: spacing, narrower buttons, packed small buttons, two-line small
   * labels) until the open tab fits its width without scrolling and its height with every group caption showing. At each
   * step a big button or tile whose words would not show whole is widened first (`widen`). The ribbon's height never
   * changes between tabs; only what is inside it tightens.
   */
  const fit = (): void => {
    for (const lvl of ['0', '1', '2', '3', '4']) {
      body.dataset.fit = lvl;
      for (const b of body.querySelectorAll<HTMLElement>(WIDE)) b.style.width = b.style.minWidth = b.style.maxWidth = '';
      if (!body.clientWidth) return;
      widen();
      if (body.scrollWidth <= body.clientWidth + 1 && body.scrollHeight <= body.clientHeight + 1) return;
    }
  };
  /**
   * Labels wrap at spaces and are never cut short. A big button or tile grows 8 px at a time (up to 240 px) while its words
   * do not show whole: a label or name wider or taller than its own box, a word sticking out of the button, or a button so
   * tall that its group caption would drop below the ribbon. The e2e test (ribbon.e2e.test.ts) checks the same things.
   */
  const widen = (): void => {
    body.scrollTop = 0;
    const floor = body.getBoundingClientRect().top + body.clientTop + body.clientHeight;
    for (const b of body.querySelectorAll<HTMLElement>(WIDE)) {
      const cap = b.closest('.fpe-rgroup')?.querySelector<HTMLElement>(':scope > .fpe-rcap');
      const room = floor - (cap?.offsetHeight ?? 0);
      for (let w = b.offsetWidth; w < 240 && notWhole(b, room);) {
        w += 8;
        b.style.width = b.style.minWidth = b.style.maxWidth = w + 'px';
      }
    }
  };
  new ResizeObserver(() => { if (!body.hidden) fit(); }).observe(ribbon);
  function showTab(plain: string): void {
    closeList();
    const t = TABS.find((x) => x.plain === plain) ?? TABS[0];
    current = t.plain;
    view = 'tab';
    for (const [p, b] of tabBtns) b.setAttribute('aria-selected', String(p === current));
    const els: HTMLElement[] = [];
    let fams: Group[] = [];
    for (const g of [...t.groups, null]) {
      if (g?.show === 'family') { fams.push(g); continue; }
      if (fams.length) els.push(familiesEl(t, fams));
      fams = [];
      if (g) els.push(groupEl(t, g));
    }
    body.replaceChildren(...els);
    body.dataset.tab = slug(t.plain);
    body.hidden = false;
    ctxWrap.hidden = true;
    chip.setAttribute('aria-pressed', 'false');
    body.scrollLeft = 0;
    fit();
    host.sync();
    thumbs();
  }

  // ---------- live gallery previews: drawn lazily, when the browser is idle, and kept per picture ----------
  const keys = new WeakMap<object, number>(), made = new Map<string, ImageData | null>();
  let seq = 0, src: Src | null = null, drawing = false;
  /** A small copy of the open picture (or the sample), made once per picture. */
  const source = (): Src => {
    const d = host.picture();
    let k = keys.get(d);
    if (k === undefined) { k = ++seq; keys.set(d, k); }
    if (src?.key !== k) {
      const f = flatten(d), sc = Math.max(TW / f.width, TH / f.height), w = Math.max(TW, Math.ceil(f.width * sc)), hh = Math.max(TH, Math.ceil(f.height * sc));
      src = { key: k, w, h: hh, bmp: { width: w, height: hh, data: resizeBitmap(f, w, hh) } as Bitmap };
      made.clear();
    }
    return src;
  };
  /** Draws the next tile on the open tab whose preview is missing or of another picture; one per idle moment. */
  const drawNext = async (): Promise<boolean> => {
    const s = source();
    const tile = [...body.querySelectorAll<HTMLElement>('.fpe-rtile[data-cmd]')].find((x) => x.dataset.thumb !== String(s.key));
    if (!tile) return false;
    tile.dataset.thumb = String(s.key);
    const id = tile.dataset.cmd as string, ck = s.key + ' ' + id;
    if (!made.has(ck)) made.set(ck, await preview(id, s).catch(() => null));
    const img = made.get(ck), box = tile.querySelector<HTMLElement>('.fpe-rico');
    if (img && box && tile.isConnected) {
      const c = document.createElement('canvas');
      c.width = TW; c.height = TH; c.className = 'fpe-rthumb'; c.setAttribute('aria-hidden', 'true');
      c.getContext('2d')?.putImageData(img, -Math.round((s.w - TW) / 2), -Math.round((s.h - TH) / 2));
      box.replaceChildren(c);
    }
    return true;
  };
  function thumbs(): void {
    if (drawing || body.hidden || !body.querySelector('.fpe-rtile[data-cmd]')) return;
    drawing = true;
    idle(() => void drawNext().catch(() => false).then((again) => { drawing = false; if (again) thumbs(); }));
  }

  // ---------- the first photo of a first run: one line on what to try first ----------
  const coach = h('div', { class: 'fpe-rcoach', role: 'status', 'data-testid': 'rhint', hidden: true });
  let hadDoc = hasDoc();
  const endCoach = (): void => {
    coach.hidden = true;
    root.querySelector('[data-coach]')?.removeAttribute('data-coach');
    document.removeEventListener('pointerdown', endCoach, true);
    document.removeEventListener('keydown', endCoach, true);
  };
  function coachFirst(): void {
    if (readTab() !== null || view !== 'tab' || !hasDoc()) return;
    const b = body.querySelector<HTMLElement>('[data-cmd][data-status="ready"]:not([aria-disabled="true"])');
    if (!b) return;
    const r = BY_ID.get(b.dataset.cmd as string);
    coach.textContent = `Try this first: ${plainOf(b.dataset.cmd as string)}${r?.help ? ' · ' + r.help : ''}`;
    root.append(coach);
    coach.hidden = false;
    b.setAttribute('data-coach', '');
    const rr = root.getBoundingClientRect(), br = b.getBoundingClientRect();
    coach.style.top = br.bottom - rr.top + 8 + 'px';
    coach.style.left = Math.min(Math.max(8, br.left - rr.left), Math.max(8, rr.width - coach.offsetWidth - 8)) + 'px';
    document.addEventListener('pointerdown', endCoach, true);
    document.addEventListener('keydown', endCoach, true);
    setTimeout(endCoach, 15000);
  }

  // ---------- the contextual tab: the tool in use ----------
  const ctxFor = (id: string | null) => (id ? CONTEXTUAL.find((c) => c.when.split(' ').includes(id)) : undefined);
  function labelChip(): void {
    const id = host.toolId(), r = id ? BY_ID.get(id) : undefined, c = ctxFor(id);
    // The tool chip shows only with a picture open: before that there is nothing to set.
    if (!r || !hasDoc()) { chip.hidden = true; return; }
    const plain = c?.plain ?? `${r.plain} options`, pro = c?.pro ?? r.pro;
    chip.replaceChildren(icon(iconFor(r.id)), h('span', { class: 'fpe-rlabel' }, plain), h('span', { class: 'fpe-pro' }, pro));
    chip.dataset.helpTitle = `${plain} · ${pro}`;
    chip.dataset.help = `The settings of ${r.plain.toLowerCase()}, shown in the ribbon.`;
    chip.hidden = false;
    const extra = c?.ids.filter((x) => BY_ID.has(x) && ready(x)) ?? [];
    ctxMore.replaceChildren();
    if (extra.length) {
      ctxMore.append(h('div', { class: 'fpe-ritems' }, h('div', { class: 'fpe-rsmalls' }, ...extra.map((x) => cmd(x, 'small', '')))),
        h('div', { class: 'fpe-rcap' }, `More for ${r.plain.toLowerCase()}`));
    }
  }
  function showCtx(): void {
    closeList();
    labelChip();
    if (chip.hidden) return;
    view = 'ctx';
    for (const b of tabBtns.values()) b.setAttribute('aria-selected', 'false');
    body.hidden = true;
    ctxWrap.hidden = false;
    chip.setAttribute('aria-pressed', 'true');
    host.sync();
  }

  // ---------- More lists and sheets ----------
  let openList: HTMLElement | null = null, listEl: HTMLElement | null = null;
  const outside = (e: Event): void => {
    const t = e.target as Node;
    if (listEl?.contains(t) || openList?.contains(t)) return;
    closeList();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { const a = openList; closeList(); a?.focus(); } };
  function closeList(): void {
    listEl?.remove();
    openList?.setAttribute('aria-expanded', 'false');
    listEl = openList = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function showList(plain: string, pro: string, ids: string[], at: HTMLElement, kind: 'more' | 'sheet', coming: string[] = []): void {
    closeList();
    const rows = [...ids, ...coming].map((id) => {
      const r = BY_ID.get(id), planned = !ready(id), off = planned || !host.enabled(id);
      const b = h('button', { type: 'button', role: 'menuitem', class: 'fpe-rrow', 'data-cmd': id, 'data-testid': 'ri-' + id, 'data-status': planned ? 'planned' : 'ready',
        'aria-disabled': off ? 'true' : null },
      icon(iconFor(id)), h('span', { class: 'fpe-names fpe-rline' }, h('span', { class: 'fpe-plain' }, plainOf(id)), r && r.pro !== r.plain ? h('span', { class: 'fpe-pro' }, ' · ' + r.pro) : null),
      planned ? tag() : null, r?.key ? h('kbd', {}, host.keyText(r.key)) : null);
      b.addEventListener('click', () => press(id, b, planned));
      return b;
    });
    // Planned commands wait under a quiet "Coming" heading, after every working one; search still finds them.
    const head = coming.length ? h('div', { class: 'fpe-rcoming', role: 'presentation', 'data-testid': 'rcoming' }, 'Coming') : null;
    const list = h('div', { class: 'fpe-pop fpe-rlist' + (kind === 'sheet' ? ' fpe-rsheetlist' : ''), role: 'menu', 'aria-label': plain, 'data-testid': 'rlist' },
      h('div', { class: 'fpe-rlisthead' }, names(plain, pro)), ...rows.slice(0, ids.length), head, ...rows.slice(ids.length));
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = rows.indexOf(document.activeElement as HTMLButtonElement);
      rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
    });
    root.append(list);
    const rr = root.getBoundingClientRect(), ar = at.getBoundingClientRect();
    list.style.maxHeight = Math.max(160, rr.bottom - ar.bottom - 12) + 'px';
    const x = Math.min(Math.max(4, ar.left - rr.left), Math.max(4, rr.width - list.offsetWidth - 4));
    list.style.left = x + 'px';
    list.style.top = ar.bottom - rr.top + 4 + 'px';
    openList = at;
    listEl = list;
    at.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    rows.find((b) => b.getAttribute('aria-disabled') !== 'true')?.focus({ preventScroll: true });
  }

  // ---------- switching between the ribbon (desktop) and today's bars (narrower) ----------
  let active = false;
  const api: Ribbon = {
    setActive(on) {
      if (on === active) return;
      active = on;
      closeList();
      if (on) {
        const brand = q('brand'), undo = q('btn-undo'), redo = q('btn-redo'), search = q('btn-search'), exp = q('btn-export');
        moveTo(appSlots, appBar, brand?.nextSibling ?? appBar.firstChild);
        if (undo) moveTo(undo, appSlots);
        if (redo) moveTo(redo, appSlots);
        moveTo(host.docTabs, appSlots);
        appSlots.append(chip);
        if (search) moveTo(search, appBar, exp);
        moveTo(right, appBar, exp);
        if (exp) exp.after(exportMore);
        moveTo(options, ctxWrap);
        ctxWrap.append(ctxMore);
        labelChip();
        if (view === 'ctx') showCtx(); else showTab(current);
      } else {
        exportMore.remove();
        restore();
      }
    },
    toolChanged() { if (active) showCtx(); else labelChip(); },
    optionsChanged(activity) {
      const has = hasDoc(), opened = has && !hadDoc;
      hadDoc = has;
      if (!active) return;
      labelChip();
      if (!has && view === 'ctx') showTab(current);
      else if (activity && view !== 'ctx') showCtx();
      if (opened) { thumbs(); requestAnimationFrame(coachFirst); }
      if (!has) endCoach();
    },
    place(id) { const p = home.get(id); return p ? homeText(p) : null; },
    reveal(id) {
      const p = home.get(id);
      if (!p || !active) return null;
      if (p.place === 'sheet') return root.querySelector<HTMLElement>(`[data-testid="rsheet-${slug(p.tab)}"]`);
      if (p.place === 'always') return root.querySelector<HTMLElement>(`.fpe-tools [data-cmd="${id}"], [data-cmd="${id}"]`);
      showTab(p.tab);
      writeTab(p.tab);
      const sel = p.place === 'more' || p.place === 'family' ? `[data-testid="rmore-${slug(p.tab)}-${slug(p.group)}"]` : `[data-testid="ri-${id}"]`;
      const el = body.querySelector<HTMLElement>(sel);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return el;
    },
    openTab(plain) { showTab(plain); },
  };
  return api;
}
