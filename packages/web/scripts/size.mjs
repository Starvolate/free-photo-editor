// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
// The size gate. The first screen (the entry, everything it imports up front, its CSS, and the files it fetches by URL
// such as the filter worker), brotli-compressed, must fit the budget. Every add-on loaded later (each file format, PSD)
// is listed on its own with its size, and is not counted, because nobody downloads it until they use it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const BUDGET = 600 * 1000;
const CEILING = 1000 * 1000;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const all = new Set();
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '.vite') walk(p); } else all.add(relative(dist, p)); } };
walk(dist);
const br = (f) => brotliCompressSync(readFileSync(join(dist, f)), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = (n) => `${(n / 1000).toFixed(1).padStart(8)} KB`;
const filesOf = (key, out, seen = new Set()) => {
  if (seen.has(key) || !manifest[key]) return out;
  seen.add(key);
  const m = manifest[key];
  for (const f of [m.file, ...(m.css ?? []), ...(m.assets ?? [])]) out.add(f);
  for (const i of m.imports ?? []) filesOf(i, out, seen);
  return out;
};
const first = filesOf(Object.keys(manifest).find((k) => manifest[k].isEntry), new Set());
const lazy = new Set();
for (const [k, m] of Object.entries(manifest)) if (m.isDynamicEntry) for (const f of filesOf(k, new Set())) if (!first.has(f)) lazy.add(f);
// A file's references: what it imports up front and what it fetches by URL (the filter worker). A dynamic import() is
// left out: that file loads only when the code runs. The filter worker's own effects chunk (fx-*.js) is one; a browser
// test (editor.e2e) checks that a first load with a photo open never asks for it. It is listed under add-ons.
const DYN = /import\(\s*["'`](?:\.\/|\/)?(?:assets\/)?([\w.-]+\.m?js)["'`]\s*\)/g;
const names = (t, re) => [...t.matchAll(re)].map((m) => 'assets/' + m[1]).filter((r) => all.has(r));
const refs = (f) => names(readFileSync(join(dist, f), 'utf8').replace(DYN, ''), /["'`](?:\.\/|\/)?(?:assets\/)?([\w.-]+\.(?:js|mjs|wasm))["'`]/g);
const later = (f) => names(readFileSync(join(dist, f), 'utf8'), DYN);
for (const f of [...first]) if (/\.m?js$/.test(f)) for (const r of refs(f)) if (!lazy.has(r) && !first.has(r)) first.add(r);
let total = 0;
const rows = [...first].filter((f) => /\.(m?js|css)$/.test(f)).sort().map((f) => { const s = br(f); total += s; return `${kb(s)}  ${f}`; });
console.log('First screen (counted):');
console.log(rows.join('\n'));
console.log(`Total first-screen JS + CSS, brotli: ${(total / 1000).toFixed(1)} KB (budget ${BUDGET / 1000} KB, ceiling ${CEILING / 1000} KB)`);
const owner = new Map();
for (const [k, m] of Object.entries(manifest)) {
  if (!m.isDynamicEntry) continue;
  const name = k.replace(/^(\.\.\/)+/, '').replace(/^node_modules\//, '');
  for (const f of filesOf(k, new Set())) if (!first.has(f) && !owner.has(f)) owner.set(f, name);
}
for (const [f, name] of [...owner]) if (/\.m?js$/.test(f)) for (const r of refs(f)) if (!first.has(r) && !owner.has(r)) owner.set(r, name);
for (const f of first) if (/\.m?js$/.test(f)) for (const r of later(f)) if (!first.has(r) && !owner.has(r)) owner.set(r, `loaded by ${f} on first use`);
for (const f of all) if (!first.has(f) && !owner.has(f) && /\.(m?js|css|wasm)$/.test(f)) owner.set(f, 'other');
const groups = new Map();
for (const [f, name] of owner) groups.set(name, [...(groups.get(name) ?? []), f]);
console.log('\nAdd-ons, fetched only when first used (not counted), brotli:');
for (const [name, files] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`${kb(files.reduce((a, f) => a + br(f), 0))}  ${name}  (${files.join(', ')})`);
if (total > BUDGET) { console.error('Over the size budget.'); process.exit(1); }
