// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Task ribbon on desktop (1024 px and wider; phones and narrow tablets keep the menu sheet): the app bar's sheets,
 * the twelve task tabs, the open tab's groups with their captions, More lists, and the contextual tab for the tool in
 * use, which shows that tool's options. Every place comes from ribbon-homes.ts, so what the screen shows and what
 * `clicks()` promises are the same data. app.ts loads this file lazily the first time the layout is desktop, so the
 * first-screen budget holds; it keeps today's menu bar for narrower screens.
 */
import { CONTEXTUAL, SHEETS, TABS, firstTab, homes, homeText, type Group, type Tab } from './ribbon-homes';
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

  // ---------- the app bar: File, View, Help and Export sheets; the contextual chip; the document tabs ----------
  const sheetBtn = (plain: string, ids: string[], label = plain): HTMLButtonElement => {
    const s = SHEETS.find((x) => x.plain === plain);
    const b = h('button', { type: 'button', class: 'fpe-btn fpe-rsheet', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-testid': 'rsheet-' + slug(plain),
      'data-help-title': `${plain} · ${s?.pro ?? plain}`, 'data-help': `${ids.length} commands, two clicks away.` }, label ? h('span', {}, label) : null, icon('chev-down'));
    b.addEventListener('click', () => (openList === b ? closeList() : showList(s?.plain ?? plain, s?.pro ?? '', ids, b, 'sheet')));
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
    b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') void host.run(id); });
    return b;
  };
  const groupEl = (t: Tab, g: Group): HTMLElement => {
    const items = h('div', { class: 'fpe-ritems' });
    for (const id of g.big) items.append(cmd(id, 'big', t.plain));
    if (g.show === 'gallery' && g.shown.length) items.append(h('div', { class: 'fpe-rgal' }, ...g.shown.map((id) => cmd(id, 'tile', t.plain))));
    else if (g.shown.length) items.append(h('div', { class: 'fpe-rsmalls' }, ...g.shown.map((id) => cmd(id, 'small', t.plain))));
    if (g.more.length) items.append(moreBtn(t, g));
    return h('div', { class: 'fpe-rgroup', role: 'group', 'aria-label': g.plain, 'data-testid': 'rgroup-' + slug(t.plain) + '-' + slug(g.plain) },
      items, h('div', { class: 'fpe-rcap', 'data-help-title': g.plain, 'data-help': `Pros call this ${g.pro}.` }, g.plain));
  };
  /** A group's More list opener: "+n" beside its buttons, a whole-group button ("4 commands"), or a family's named button. */
  const moreBtn = (t: Tab, g: Group): HTMLButtonElement => {
    const gid = slug(t.plain) + '-' + slug(g.plain), kind = g.show === 'family' ? 'family' : g.show === 'button' ? 'button' : 'more';
    const help = `${g.more.length} ${kind === 'family' ? 'kinds' : 'more'}: ${g.more.slice(0, 4).map(plainOf).join(', ')}${g.more.length > 4 ? '…' : ''}`;
    const m = h('button', { type: 'button', class: kind === 'family' ? 'fpe-rpill' : kind === 'button' ? 'fpe-rbig fpe-rgroupbtn' : 'fpe-rmore', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      'data-testid': 'rmore-' + gid, 'data-help-title': `${g.plain} · ${g.pro}`, 'data-help': help, 'aria-label': `More in ${g.plain}: ${g.more.length}` },
    ...(kind === 'family' ? [icon(iconFor(g.more[0], t.plain)), h('span', { class: 'fpe-rlabel' }, g.plain), icon('chev-down')]
      : kind === 'button' ? [h('span', { class: 'fpe-rico' }, icon(iconFor(g.more[0], t.plain))), h('span', { class: 'fpe-names fpe-rlabel' },
        h('span', { class: 'fpe-plain' }, `${g.more.length} commands`, icon('chev-down')), h('span', { class: 'fpe-pro' }, g.pro))]
        : [icon('chev-down'), h('span', { class: 'fpe-rlabel' }, `+${g.more.length}`)]));
    m.addEventListener('click', () => (openList === m ? closeList() : showList(g.plain, g.pro, g.more, m, 'more')));
    return m;
  };
  /** The effect families (Blur, Sharpen, …) as one group of named buttons in three rows, so none repeats its caption. */
  const familiesEl = (t: Tab, gs: Group[]): HTMLElement => {
    const rows: HTMLElement[] = [];
    for (let r = 0, i = 0; r < 3 && i < gs.length; r++) {
      const n = Math.floor(gs.length / 3) + (r < gs.length % 3 ? 1 : 0);
      rows.push(h('div', { class: 'fpe-rfamrow' }, ...gs.slice(i, i + n).map((g) =>
        h('div', { class: 'fpe-rfamily', role: 'group', 'aria-label': g.plain, 'data-testid': 'rgroup-' + slug(t.plain) + '-' + slug(g.plain) }, moreBtn(t, g)))));
      i += n;
    }
    return h('div', { class: 'fpe-rgroup fpe-rfams', role: 'group', 'aria-label': FAMILIES },
      h('div', { class: 'fpe-ritems' }, h('div', { class: 'fpe-rfamrows' }, ...rows)),
      h('div', { class: 'fpe-rcap', 'data-help-title': FAMILIES, 'data-help': 'Each opens its own list. Pros call this the Filter menu.' }, FAMILIES));
  };
  /** Tightens the ribbon a step at a time (spacing, then narrower buttons) until the open tab fits without scrolling. */
  const fit = (): void => {
    body.dataset.fit = '0';
    for (const lvl of ['1', '2']) {
      if (!body.clientWidth || body.scrollWidth <= body.clientWidth + 1) return;
      body.dataset.fit = lvl;
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
  }

  // ---------- the contextual tab: the tool in use ----------
  const ctxFor = (id: string | null) => (id ? CONTEXTUAL.find((c) => c.when.split(' ').includes(id)) : undefined);
  function labelChip(): void {
    const id = host.toolId(), r = id ? BY_ID.get(id) : undefined, c = ctxFor(id);
    if (!r) { chip.hidden = true; return; }
    const plain = c?.plain ?? `${r.plain} options`, pro = c?.pro ?? r.pro;
    chip.replaceChildren(icon(iconFor(r.id)), h('span', { class: 'fpe-rlabel' }, plain), h('span', { class: 'fpe-pro' }, pro));
    chip.dataset.helpTitle = `${plain} · ${pro}`;
    chip.dataset.help = `The settings of ${r.plain.toLowerCase()}, shown in the ribbon.`;
    chip.hidden = false;
    const extra = c?.ids.filter((x) => BY_ID.has(x)) ?? [];
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
  function showList(plain: string, pro: string, ids: string[], at: HTMLElement, kind: 'more' | 'sheet'): void {
    closeList();
    const rows = ids.map((id) => {
      const r = BY_ID.get(id), planned = !ready(id), off = planned || !host.enabled(id);
      const b = h('button', { type: 'button', role: 'menuitem', class: 'fpe-rrow', 'data-cmd': id, 'data-testid': 'ri-' + id, 'data-status': planned ? 'planned' : 'ready',
        'aria-disabled': off ? 'true' : null },
      icon(iconFor(id)), h('span', { class: 'fpe-names fpe-rline' }, h('span', { class: 'fpe-plain' }, plainOf(id)), r && r.pro !== r.plain ? h('span', { class: 'fpe-pro' }, ' · ' + r.pro) : null),
      planned ? tag() : null, r?.key ? h('kbd', {}, host.keyText(r.key)) : null);
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true') return; closeList(); void host.run(id); });
      return b;
    });
    const list = h('div', { class: 'fpe-pop fpe-rlist' + (kind === 'sheet' ? ' fpe-rsheetlist' : ''), role: 'menu', 'aria-label': plain, 'data-testid': 'rlist' },
      h('div', { class: 'fpe-rlisthead' }, names(plain, pro)), ...rows);
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
    optionsChanged(activity) { if (!active) return; labelChip(); if (activity && view !== 'ctx') showCtx(); },
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
