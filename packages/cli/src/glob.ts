// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** File patterns such as photos/*.jpg or shoot/**\/*.{jpg,png}, expanded here because some shells (Windows) do not. */
import { readdirSync } from 'node:fs';
import path from 'node:path';

export const hasGlob = (s: string): boolean => /[*?[{]/.test(s);
export function globToRegExp(glob: string): RegExp {
  let re = '', brace = 0, inClass = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (inClass) { if (ch === ']') inClass = false; re += ch === '\\' ? '\\\\' : ch; continue; }
    if (ch === '*') {
      if (glob[i + 1] === '*') { const dir = glob[i + 2] === '/'; re += dir ? '(?:[^/]*/)*' : '.*'; i += dir ? 2 : 1; } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if (ch === '[') { inClass = true; re += '['; if (glob[i + 1] === '!') { re += '^'; i++; } }
    else if (ch === '{') { brace++; re += '(?:'; }
    else if (ch === '}' && brace) { brace--; re += ')'; }
    else if (ch === ',' && brace) re += '|';
    else re += /[.+^$()|\\]/.test(ch) ? '\\' + ch : ch;
  }
  return new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
}
/** Matching files, sorted. Hidden files, node_modules and .git are skipped; linked folders are not followed. */
export function expandGlob(pattern: string, cwd: string): string[] {
  const parts = pattern.split(path.sep).join('/').split('/'), fixed: string[] = [];
  for (const p of parts) { if (hasGlob(p)) break; fixed.push(p); }
  const rest = parts.slice(fixed.length).join('/'), re = globToRegExp(rest), deep = rest.includes('**'), depth = rest.split('/').length;
  const base = path.resolve(cwd, fixed.length === 1 && fixed[0] === '' ? '/' : fixed.join('/') || '.'), out: string[] = [];
  const walk = (dir: string, rel: string, level: number): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || out.length >= 100_000) continue;
      const r = rel ? rel + '/' + e.name : e.name, full = path.join(dir, e.name);
      if (e.isDirectory()) { if (deep || level + 1 < depth) walk(full, r, level + 1); } else if (re.test(r)) out.push(full);
    }
  };
  walk(base, '', 0);
  return out.sort();
}
