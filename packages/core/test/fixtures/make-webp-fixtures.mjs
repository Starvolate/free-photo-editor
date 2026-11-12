// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
// Captures real WebP files from Chrome's encoder for the metadata tests (Node has no WebP encoder).
// Run: CHROME_PATH=/path/to/chrome node packages/core/test/fixtures/make-webp-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const exe = process.env.CHROME_PATH;
if (!exe) { console.error('Set CHROME_PATH to a Chrome or Chromium binary.'); process.exit(1); }
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const out = await page.evaluate(async () => {
  const make = async (alpha, quality) => {
    const c = document.createElement('canvas');
    c.width = 7; c.height = 5;
    const x = c.getContext('2d');
    x.fillStyle = alpha ? 'rgba(200, 40, 40, 0.5)' : '#c82828';
    x.fillRect(0, 0, 7, 5);
    x.fillStyle = '#2050f0';
    x.fillRect(2, 1, 3, 3);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', quality));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const v of bytes) s += String.fromCharCode(v);
    return btoa(s);
  };
  return { lossyOpaque: await make(false, 0.8), lossyAlpha: await make(true, 0.8), fullQualityOpaque: await make(false, 1), fullQualityAlpha: await make(true, 1) };
});
await browser.close();
writeFileSync(new URL('./webp-samples.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
for (const [k, v] of Object.entries(out)) {
  const b = Buffer.from(v, 'base64');
  const chunks = [];
  for (let p = 12; p + 8 <= b.length; p += 8 + b.readUInt32LE(p + 4) + (b.readUInt32LE(p + 4) & 1)) chunks.push(b.toString('latin1', p, p + 4));
  console.log(k, b.length, 'bytes', chunks.join(','));
}
