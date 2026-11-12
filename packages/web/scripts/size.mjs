// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
// The size gate: every JS and CSS file of the production build, brotli-compressed, must fit the budget.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const BUDGET = 600 * 1000;
const CEILING = 1000 * 1000;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(dist);
const br = (p) => brotliCompressSync(readFileSync(p), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
let total = 0;
const rows = [];
for (const p of files.sort()) {
  const kind = /\.(js|css)$/.test(p) ? 'counted' : /\.html$/.test(p) ? 'html' : null;
  if (!kind) continue;
  const size = br(p);
  if (kind === 'counted') total += size;
  rows.push(`${(size / 1000).toFixed(1).padStart(8)} KB  ${kind === 'html' ? '(html, not counted) ' : ''}${relative(dist, p)}`);
}
console.log(rows.join('\n'));
console.log(`Total JS + CSS, brotli: ${(total / 1000).toFixed(1)} KB (budget ${BUDGET / 1000} KB, ceiling ${CEILING / 1000} KB)`);
if (total > BUDGET) { console.error('Over the size budget.'); process.exit(1); }
