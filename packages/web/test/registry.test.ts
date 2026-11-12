// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The function map is the single source of menus, tools, panels, search and help lines. These checks keep it honest. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADJ, DOCK_PANELS, HANDLERS, JOBS, TOOLS } from '../src/commands';
import { ICON_NAMES } from '../src/icons';
import { BY_ID, MENU_ITEMS, ROWS, TOOL_GROUPS, TOP_MENUS, counts, functionMapMarkdown, search } from '../src/registry';

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
  });
  it('asks only for icons the sprite holds', () => {
    const used = new Set<string>();
    for (const re of [/icon(?:Button)?\('([a-z0-9-]+)'/g, /cmdBtn\('[a-z0-9.-]+', '([a-z0-9-]+)'/g, /\bbtn\('[a-z0-9.-]+', '([a-z0-9-]+)'/g,
      /'Tools > [A-Za-z ]+': '([a-z0-9-]+)'/g]) for (const m of APP.matchAll(re)) used.add(m[1]);
    for (const j of JOBS) used.add(j.icon);
    expect(used.size).toBeGreaterThan(30);
    expect([...used].filter((n) => !ICON_NAMES.includes(n))).toEqual([]);
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
