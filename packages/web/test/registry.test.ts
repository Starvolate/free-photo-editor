// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The function map is the single source of menus, tools, panels, search and help lines. These checks keep it honest. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADJ, DOCK_PANELS, HANDLERS, JOBS, TOOLS } from '../src/commands';
import { ICON_NAMES } from '../src/icons';
import { BY_ID, KEEP_TOOLS, MENU_ITEMS, ROWS, TOOL_GROUPS, TOP_MENUS, counts, search } from '../src/registry';
import { iconFor } from '../src/ribbon';
// Loading the new Planned functions adds them to ROWS, as search does on first use, so every check below covers all of them.
import { NEW_PHASES, NEW_ROWS } from '../src/registry-union';
import { functionMapMarkdown } from '../src/function-map';
import { ALWAYS, CONTEXTUAL, TABS, firstTab, homes, reach, restingIds, spots } from '../src/ribbon-homes';

const MAP = fileURLToPath(new URL('../../../docs/function-map.md', import.meta.url));
const APP = readFileSync(fileURLToPath(new URL('../src/app.ts', import.meta.url)), 'utf8');

describe('the function map', () => {
  it('gives every function a plain name, a pro name and one short help line', () => {
    for (const r of ROWS) {
      expect(r.plain.trim(), r.id).not.toBe('');
      expect(r.pro.trim(), r.id).not.toBe('');
      expect(r.help.trim().length, r.id).toBeGreaterThan(8);
      expect(r.help.length, r.id).toBeLessThanOrEqual(160);
    }
  });
  it('has unique ids', () => {
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });
  it('runs every Ready function and no Planned one', () => {
    const missing = ROWS.filter((r) => r.status === 'ready' && !HANDLERS[r.id]).map((r) => r.id);
    const extra = ROWS.filter((r) => r.status !== 'ready' && HANDLERS[r.id]).map((r) => r.id);
    const unknown = Object.keys(HANDLERS).filter((id) => !BY_ID.has(id));
    expect({ missing, extra, unknown }).toEqual({ missing: [], extra: [], unknown: [] });
  });
  it('backs every adjustment dialog and tool with a Ready row', () => {
    for (const id of [...Object.keys(ADJ), ...Object.keys(TOOLS)]) expect(BY_ID.get(id)?.status, id).toBe('ready');
  });
  it('fills every menu, tool group, docked panel and start-screen job', () => {
    for (const m of TOP_MENUS) expect(MENU_ITEMS.get(m)?.length, m).toBeGreaterThan(0);
    expect(TOOL_GROUPS.length).toBeGreaterThanOrEqual(18);
    for (const p of DOCK_PANELS) expect(BY_ID.get('panel.' + p)?.status, p).toBe('ready');
    for (const j of JOBS) expect(BY_ID.has(j.cmd), j.cmd).toBe(true);
  });
  it('understands wishes in plain words', () => {
    expect(search('make it brighter')[0]?.id).toBe('image.adj-brightness');
    expect(search('black and white').slice(0, 3).map((r) => r.id)).toContain('image.adj-bw');
    expect(search('resize').slice(0, 3).map((r) => r.id)).toContain('image.size');
    expect(search('dpi').slice(0, 3).map((r) => r.id)).toEqual(expect.arrayContaining(['file.export-print', 'image.resolution']));
  });
  it('asks only for icons the sprite holds', () => {
    const used = new Set<string>();
    for (const re of [/icon(?:Button)?\('([a-z0-9-]+)'/g, /cmdBtn\('[a-z0-9.-]+', '([a-z0-9-]+)'/g, /\bbtn\('[a-z0-9.-]+', '([a-z0-9-]+)'/g,
      /'Tools > [A-Za-z ]+': '([a-z0-9-]+)'/g]) for (const m of APP.matchAll(re)) used.add(m[1]);
    for (const j of JOBS) used.add(j.icon);
    expect(used.size).toBeGreaterThan(30);
    expect([...used].filter((n) => !ICON_NAMES.includes(n))).toEqual([]);
  });
  it('gives every Ready shortcut to one command only, written the way a key press reads', () => {
    const owner = new Map<string, string>();
    const shared: string[] = [];
    for (const r of ROWS) {
      if (!r.key || r.status !== 'ready') continue;
      const had = owner.get(r.key);
      if (had) shared.push(`${r.key}: ${had} and ${r.id}`); else owner.set(r.key, r.id);
    }
    expect(shared).toEqual([]);
    // A Planned row must not take a Ready row's key either: the key map keeps the last row, so it would win.
    const shadow = ROWS.filter((r) => r.key && r.status !== 'ready' && owner.has(r.key)).map((r) => `${r.key}: ${owner.get(r.key)} and ${r.id}`);
    expect(shadow).toEqual([]);
    // Modifiers in the order the key handler builds them (Ctrl, Shift, Alt), or the shortcut never fires.
    const order = ['Ctrl', 'Shift', 'Alt'];
    const bad = ROWS.filter((r) => {
      if (!r.key) return false;
      const mods = r.key.split('+').slice(0, -1);
      return mods.some((m, i) => !order.includes(m) || (i > 0 && order.indexOf(m) <= order.indexOf(mods[i - 1])));
    }).map((r) => `${r.id}: ${r.key}`);
    expect(bad).toEqual([]);
  });
  it('keeps docs/function-map.md in step (WRITE_MAP=1 rewrites it)', () => {
    const md = functionMapMarkdown();
    if (process.env.WRITE_MAP) writeFileSync(MAP, md);
    expect(readFileSync(MAP, 'utf8')).toBe(md);
  });
  it('adds up', () => {
    const c = counts();
    expect(c.ready + c.planned).toBe(c.total);
    expect(c.total).toBe(ROWS.length);
  });
});

describe('the Task ribbon', () => {
  it('keeps exactly the always-on tools in the left column, and draws every ribbon command with an icon the editor has', () => {
    expect(KEEP_TOOLS).toEqual(ALWAYS.find((a) => a.group === 'Your tools')?.ids);
    const bad = spots().map((s) => [s.id, iconFor(s.id, s.tab)]).filter(([, ic]) => !ICON_NAMES.includes(ic));
    expect(bad).toEqual([]);
    for (const t of TABS) expect(ICON_NAMES).toContain(iconFor('', t.plain));
  });
  const ids = (): string[] => ROWS.map((r) => r.id);
  it('gives every function exactly one home', () => {
    const count = new Map<string, number>();
    for (const s of spots()) if (!s.again && s.place !== 'always') count.set(s.id, (count.get(s.id) ?? 0) + 1);
    const always = new Set(ALWAYS.flatMap((a) => a.ids));
    const none = ids().filter((id) => !count.has(id) && !always.has(id));
    const twice = [...count].filter(([, n]) => n > 1).map(([id]) => id);
    const unknown = spots().map((s) => s.id).filter((id) => !BY_ID.has(id));
    const againWithoutHome = spots().filter((s) => s.again && !count.has(s.id)).map((s) => s.id);
    const againNotShown = TABS.flatMap((t) => t.groups.flatMap((g) => g.again.filter((id) => ![...g.big, ...g.shown, ...g.more].includes(id))));
    expect({ none, twice, unknown, againWithoutHome, againNotShown }).toEqual({ none: [], twice: [], unknown: [], againWithoutHome: [], againNotShown: [] });
    expect(homes().size).toBe(ROWS.length);
  });
  it('names twelve tabs without repeating a word', () => {
    expect(TABS.map((t) => t.plain)).toEqual(['Effects & masks', 'Select & cut out', 'Retouch & remove', 'Develop RAW', 'AI tools', 'Paint & draw',
      'Shapes & text', 'Automate & batch', 'Arrange layers', 'Crop & resize', 'Light & colour', 'Filters & blur']);
    const seen = new Map<string, string>(), repeats: string[] = [];
    for (const t of TABS) for (const w of t.plain.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
      const had = seen.get(w);
      if (had) repeats.push(`${w}: ${had} and ${t.plain}`); else seen.set(w, t.plain);
    }
    expect(repeats).toEqual([]);
  });
  it('holds at most 70 commands on a tab, except Filters & blur, which nests its effects in family sheets', () => {
    const size = (t: (typeof TABS)[number]): number => t.groups.reduce((n, g) => n + g.big.length + g.shown.length + g.more.length, 0);
    expect(TABS.filter((t) => size(t) > 70).map((t) => t.plain)).toEqual(['Filters & blur']);
    const fx = TABS.find((t) => t.plain === 'Filters & blur')!;
    const loose = fx.groups.filter((g) => g.show !== 'family').reduce((n, g) => n + g.big.length + g.shown.length + g.more.length, 0);
    expect(loose).toBeLessThanOrEqual(20);
    for (const g of fx.groups.filter((x) => x.show === 'family')) expect(g.more.length, g.plain).toBeLessThanOrEqual(20);
  });
  it('opens on first run the first tab, in deep-first order, that is at least half Ready at rest, and moves to Effects & masks once it is', () => {
    const ready = (id: string): boolean => BY_ID.get(id)?.status === 'ready';
    const share = (t: (typeof TABS)[number]): number => restingIds(t).filter(ready).length / restingIds(t).length;
    const open = firstTab(ready), i = TABS.findIndex((t) => t.plain === open);
    expect(share(TABS[i]), open).toBeGreaterThanOrEqual(0.5);
    for (const t of TABS.slice(0, i)) expect(share(t), t.plain).toBeLessThan(0.5);
    // When wave 1 makes most of Effects & masks Ready, the first run opens it without any other change.
    const fx = new Set(restingIds(TABS[0]).slice(0, Math.ceil(restingIds(TABS[0]).length / 2)));
    expect(firstTab((id) => ready(id) || fx.has(id))).toBe(TABS[0].plain);
    expect(firstTab(() => false), 'nothing Ready: the first tab').toBe(TABS[0].plain);
  });
  it('reaches every function within three clicks, and writes the count into the map', () => {
    const r = reach(ids());
    expect(r.searchOnly).toBe(0);
    expect(r.one).toBe(new Set(ALWAYS.flatMap((a) => a.ids)).size);
    expect(r.one + r.two + r.three).toBe(ROWS.length);
    expect(functionMapMarkdown()).toContain(`| All functions | ${ROWS.length} | ${r.one} | ${r.two} | ${r.three} | ${r.searchOnly} |`);
  });
  it('puts only homed commands on the contextual tabs', () => {
    const h = homes();
    expect(CONTEXTUAL.flatMap((c) => c.ids).filter((id) => !h.has(id))).toEqual([]);
  });
  it('keeps the new Planned functions out of the menu bar, each with its names, wishes, phase and home', () => {
    const inMenus = new Set([...MENU_ITEMS.values()].flat().flatMap((e) => (e.type === 'item' ? [e.row.id] : [])));
    const h = homes();
    expect(NEW_ROWS.length).toBe(261);
    // Built so far (wave 4): a selection from an outline and an outline from the selection.
    const BUILT = new Set(['select.from-path', 'select.to-path', 'view.composition-guides', 'layer.fx-blur', 'layer.blend-if']);
    expect(NEW_ROWS.filter((r) => r.status === 'ready').map((r) => r.id).sort()).toEqual([...BUILT].sort());
    for (const r of NEW_ROWS) {
      expect(inMenus.has(r.id), r.id).toBe(false);
      expect([r.status, r.key, r.kind], r.id).toEqual([BUILT.has(r.id) ? 'ready' : 'planned', '', 'command']);
      expect(r.wish.split(',').length, r.id).toBeGreaterThanOrEqual(2);
      expect(NEW_PHASES[r.phase], r.id).toBeTruthy();
      const home = h.get(r.id)!;
      expect(r.place, r.id).toBe(home.place === 'sheet' ? `${home.tab} sheet` : `${home.tab} > ${home.group}`);
    }
    expect(search('select the sky')[0]?.id).toBe('select.sky');
    expect(search('remove haze')[0]?.id).toBe('raw.dehaze');
    expect(search('panorama').slice(0, 3).map((r) => r.id)).toContain('auto.panorama');
  });
});
