// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Help lines after the first screen. Every row of the function map (registry.ts SRC) carries one plain line of help,
 * about 5 KB brotli in all, and the first screen needs none of them. At build time this takes each row's help line out
 * of SRC into a chunk of its own and points registry.ts's HELP_CHUNK at it; the app loads it on idle, on the first
 * search keystroke and from a tooltip. Rows stay written as they are, and tests and dev keep the help inline.
 * Menu help ("@Path = plain | pro | help") stays inline: the top menus build their hints at boot.
 */
import type { Plugin } from 'vite';

export const HELP_ID = 'virtual:fpe-help';
const MARK = 'null as HelpChunk; // fpe:help-chunk';
const OPEN = 'const SRC = String.raw`';

/** registry.ts with every row's help field blanked and HELP_CHUNK pointed at the help chunk, plus the help by id. Throws on anything it cannot read. */
export function splitHelp(code: string): { code: string; help: Record<string, string> } {
  const a = code.indexOf(OPEN), b = a < 0 ? -1 : code.indexOf('\n`;', a);
  if (a < 0 || b < 0) throw new Error('help-split: registry.ts has no SRC block');
  if (code.split(MARK).length !== 2) throw new Error(`help-split: registry.ts must hold "${MARK}" exactly once`);
  const help: Record<string, string> = {};
  const body = code.slice(a + OPEN.length, b).split('\n').map((raw) => {
    const line = raw.trim();
    if (!line || line === '--' || line.startsWith('@')) return raw;
    const f = line.split(' | ');
    if (f.length < 7) throw new Error('help-split: cannot read this row: ' + line);
    const id = f[0].trim();
    if (!id || id in help) throw new Error('help-split: a missing or repeated id: ' + line);
    help[id] = f[3].trim();
    f[3] = '';
    return raw.slice(0, raw.length - raw.trimStart().length) + f.join(' | ');
  }).join('\n');
  return { code: code.slice(0, a + OPEN.length) + body + code.slice(b).replace(MARK, `(() => import('${HELP_ID}')) as HelpChunk; // fpe:help-chunk`), help };
}

/** Build only: dev, vitest and the e2e runner's own imports read registry.ts with its help inline. */
export function helpSplit(): Plugin {
  let help: Record<string, string> | null = null;
  return {
    name: 'fpe:help-split',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) { return id === HELP_ID ? '\0' + HELP_ID : null; },
    load(id) {
      if (id !== '\0' + HELP_ID) return null;
      if (!help) this.error('help-split: the help chunk was asked for before registry.ts was read');
      return `export default ${JSON.stringify(help)};`;
    },
    transform(code, id) {
      if (!/[\\/]packages[\\/]web[\\/]src[\\/]registry\.ts$/.test(id.split('?')[0])) return null;
      const out = splitHelp(code);
      help = out.help;
      return { code: out.code, map: null };
    },
    buildEnd(e) { if (!e && !help) this.error('help-split: registry.ts was never read, so its help lines are still on the first screen'); },
  };
}
