// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * docs/function-map.md, written from the function map (registry.ts), the new Planned rows (registry-union.ts) and the
 * ribbon homes (ribbon-homes.ts). Only the tests import this file, so none of it ships to the browser.
 */
import { MENU_INFO, PHASES, ROWS, TOP_MENUS, counts, placeText, type Row } from './registry';
import { CENSUS, NEW_PHASES, NEW_ROWS } from './registry-union';
import { ALWAYS, CONTEXTUAL, SHEETS, TABS, homes, reach, spots, type Home, type Place } from './ribbon-homes';

const PLACE: Record<Place, string> = {
  big: 'big button', small: 'small button', gallery: 'live-preview gallery', more: 'More list', family: 'family sheet',
  sheet: 'sheet', always: 'always on screen',
};
/** "Effects & masks › New · big button", "File sheet", "Always on screen › History". */
export function livesIn(h: Home | undefined): string {
  if (!h) return 'no home';
  if (h.place === 'sheet') return `${h.tab} sheet`;
  if (h.place === 'always') return `${h.tab} › ${h.group}`;
  return `${h.tab} › ${h.group} · ${PLACE[h.place]}`;
}

export function functionMapMarkdown(): string {
  const c = counts();
  const home = homes();
  const fresh = new Set(NEW_ROWS.map((r) => r.id));
  const esc = (s: string): string => s.replace(/\|/g, '\\|');
  const status = (r: Row): string => (r.status === 'ready' ? 'Ready' : 'Planned');
  const all = reach(ROWS.map((r) => r.id)), ready = reach(ROWS.filter((r) => r.status === 'ready').map((r) => r.id));
  const mapRows = ROWS.filter((r) => !fresh.has(r.id));
  const out: string[] = [
    '# Free Photo Editor: function map', '',
    'Generated from `packages/web/src/registry.ts`, `registry-union.ts` and `ribbon-homes.ts` by `packages/web/test/registry.test.ts`;',
    'do not edit by hand. Every menu item, tool and panel of a professional editor, with a plain name first, the usual',
    'pro name second, one plain line of help, the wish words search understands, where it lives, and whether it works today.', '',
    `**${c.total} functions: ${c.ready} Ready, ${c.planned} Planned** (${c.tools} tools, ${c.panels} panels, ${c.menus} menus and submenus).`,
    `${mapRows.length} are today's menu, tool and panel rows; ${NEW_ROWS.length} are new functions from the feature census (U001 to U${NEW_ROWS.length}),`,
    'all Planned, which never join the menu bar: search lists them with their "Planned" tag, and the Task ribbon gives each one a home.', '',
    '## Reach on the Task ribbon', '',
    'Counted from the resting screen (a photo open, nothing else opened): what never leaves the screen is 1 click; a tab and',
    'its command, or an app-bar sheet and its item, is 2; a More list, a family sheet or a group shrunk to its button is 3.',
    'Scrolling is free, search and keys are not clicks, and contextual tabs are not counted. A function shown in two places',
    'counts once, at its best.', '',
    '| Functions | Count | 1 click | 2 clicks | 3 clicks | Search only |', '|---|---|---|---|---|---|',
    `| All functions | ${c.total} | ${all.one} | ${all.two} | ${all.three} | ${all.searchOnly} |`,
    `| Ready today | ${c.ready} | ${ready.one} | ${ready.two} | ${ready.three} | ${ready.searchOnly} |`, '',
    '## The Task ribbon', '',
    'Twelve task tabs, deep work first (the first is open by default), four sheets in the app bar, and the items that never',
    'leave the screen. "Commands" counts every command a tab shows, including ones shown again from another home.', '',
    '| Tab: plain · pro | Groups | Commands | Homed here | Shown on the tab (2 clicks) |', '|---|---|---|---|---|',
  ];
  const sp = spots();
  for (const t of TABS) {
    const on = sp.filter((s) => s.tab === t.plain);
    const shown = on.filter((s) => s.place === 'big' || s.place === 'small' || s.place === 'gallery').length;
    out.push(`| ${t.plain} · ${t.pro} | ${t.groups.map((g) => g.plain).join(', ')} | ${on.length} | ${on.filter((s) => !s.again).length} | ${shown} |`);
  }
  for (const s of SHEETS) out.push(`| ${s.plain} sheet · ${s.pro} | app-bar sheet | ${s.ids.length} | ${s.ids.filter((id) => home.get(id)?.tab === s.plain).length} | ${s.ids.length} |`);
  out.push('', 'Always on screen (1 click): ' + ALWAYS.map((a) => `${a.group} (${a.ids.join(', ')})`).join('; ') + '.', '',
    '## Contextual tabs', '', 'Shown only in context, as a filled chip in the app bar. Everything on them also has a home above, so the reach count never depends on them.', '',
    '| Tab: plain · pro | Shown when | Commands |', '|---|---|---|',
    ...CONTEXTUAL.map((x) => `| ${x.plain} · ${x.pro} | ${x.when} | ${x.ids.join(', ') || 'its own settings only'} |`), '',
    '## Phases', '', '| Phase | What ships |', '|---|---|',
    ...Object.entries({ ...PHASES, ...NEW_PHASES }).map(([k, v]) => `| ${k} | ${v} |`), '');
  const table = (rows: Row[], census: boolean): void => {
    out.push(census ? '| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |' : '| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |',
      census ? '|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const lives = livesIn(home.get(r.id));
      out.push(census
        ? `| ${r.id} | ${CENSUS.get(r.id)} | ${esc(r.plain)} | ${esc(r.pro)} | ${esc(r.help)} | ${esc(r.wish)} | ${lives} | ${status(r)} | ${r.phase} |`
        : `| ${r.id} | ${esc(r.plain)} | ${esc(r.pro)} | ${esc(r.help)} | ${esc(r.wish)} | ${placeText(r.place)} | ${lives} | ${status(r)} | ${r.phase} | ${esc(r.key)} |`);
    }
    out.push('');
  };
  const sections: [string, (r: Row) => boolean][] = [...TOP_MENUS.map((m) => [m, (r: Row) => r.kind !== 'panel' && (r.place === m || r.place.startsWith(m + ' > '))] as [string, (r: Row) => boolean]),
    ['Panels (Window menu and the dock)', (r: Row) => r.kind === 'panel'], ['Tools', (r: Row) => r.kind === 'tool' || r.place.startsWith('Tools')]];
  for (const [title, test] of sections) {
    const rows = mapRows.filter(test);
    const n = rows.filter((r) => r.status === 'ready').length;
    out.push(`## ${title} (${n} Ready, ${rows.length - n} Planned)`, '');
    const subs = [...MENU_INFO.values()].filter((m) => rows.some((r) => r.place === m.path) && m.path.includes(' > '));
    if (subs.length) out.push('Groups: ' + subs.map((m) => `${m.plain} · ${m.pro}`).join('; ') + '.', '');
    table(rows, false);
  }
  out.push(`## New functions from the feature census (${NEW_ROWS.length} Planned), by home`, '',
    'Not in the menu bar. Search finds them by plain name, pro name or wish words and shows them as Planned.', '');
  for (const where of [...TABS.map((t) => t.plain), ...SHEETS.map((s) => s.plain)]) {
    const rows = NEW_ROWS.filter((r) => home.get(r.id)?.tab === where);
    if (!rows.length) continue;
    out.push(`### ${where}${SHEETS.some((s) => s.plain === where) ? ' sheet' : ''} (${rows.length})`, '');
    table(rows, true);
  }
  return out.join('\n');
}
