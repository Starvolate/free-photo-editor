// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
// The help lines leave the first screen at build time (scripts/help-split.ts) and come back after it (registry.ts
// applyHelp): every row's line reaches the help chunk exactly, the rows keep their ids and order, and search finds a
// command by its name before the lines arrive and by its help words after.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splitHelp } from '../scripts/help-split';
import { ROWS, applyHelp, helpReady, loadHelp, search, stem, words } from '../src/registry';

const code = readFileSync(fileURLToPath(new URL('../src/registry.ts', import.meta.url)), 'utf8');
const srcOf = (c: string): string[] => c.slice(c.indexOf('String.raw`') + 11, c.indexOf('\n`;')).split('\n').map((l) => l.trim())
  .filter((l) => l && l !== '--' && !l.startsWith('@'));

describe('the help lines leave the first screen', () => {
  const out = splitHelp(code);
  it('puts every row\'s help line in the chunk exactly, in order', () => {
    expect(Object.keys(out.help)).toEqual(ROWS.map((r) => r.id));
    for (const r of ROWS) expect(out.help[r.id], r.id).toBe(r.help);
    expect(ROWS.every((r) => r.help.length > 0)).toBe(true);
  });
  it('leaves no help line in the rows and changes nothing else', () => {
    const before = srcOf(code), after = srcOf(out.code);
    expect(after.length).toBe(before.length);
    after.forEach((l, i) => {
      const f = l.split(' | '), g = before[i].split(' | ');
      expect(f.length, l).toBe(g.length);
      expect(f[3], l).toBe('');
      expect([...f.slice(0, 3), ...f.slice(4)], l).toEqual([...g.slice(0, 3), ...g.slice(4)].map((x) => x.trim()));
    });
    expect(out.code).toContain("(() => import('virtual:fpe-help')) as HelpChunk;");
    expect(out.code.length).toBeLessThan(code.length - 15_000);
  });
  it('stops the build on a row it cannot read', () => {
    expect(() => splitHelp(code.replace(' | blank, empty canvas, start fresh, new document | R | 1 | Ctrl+N', ''))).toThrow(/cannot read/);
    expect(() => splitHelp(code.replace('null as HelpChunk; // fpe:help-chunk', 'null'))).toThrow(/exactly once/);
  });
});

describe('search before and after the help lines arrive', () => {
  it('finds a command by its name with the lines blank, and by a help-only word once they are back', async () => {
    expect(helpReady()).toBe(true);
    expect(await loadHelp()).toBe(true);
    const saved = new Map(ROWS.map((r) => [r.id, r.help] as const));
    const named = ROWS.flatMap((r) => words(`${r.plain} ${r.pro} ${r.wish} ${r.place}`).map(stem));
    let pick: [string, string] | null = null;
    for (const r of ROWS) {
      const w = words(r.help).find((x) => x.length > 5 && /^[a-z]+$/.test(x) && !named.some((n) => n.startsWith(stem(x))));
      if (w && search(w, 1000).some((x) => x.id === r.id)) { pick = [r.id, w]; break; }
    }
    if (!pick) throw new Error('no help-only word');
    const [id, word] = pick, r = ROWS.find((x) => x.id === id)!;
    for (const x of ROWS) x.help = '';
    applyHelp({});
    expect(search(word, 1000).map((x) => x.id), 'a help-only word finds nothing while the lines are out').not.toContain(id);
    expect(search(r.plain, 1000).map((x) => x.id), 'a name still finds its row').toContain(id);
    applyHelp(Object.fromEntries(saved));
    expect(ROWS.every((x) => x.help === saved.get(x.id))).toBe(true);
    expect(search(word, 1000).map((x) => x.id), 'the help word finds it again').toContain(id);
    applyHelp({ [id]: 'something else' });
    expect(r.help, 'a row that has its line keeps it').toBe(saved.get(id));
  });
});
