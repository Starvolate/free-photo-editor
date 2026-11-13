// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * W6 parity between Node and the browser (design 5): the fixture `fixtures/w6-layers.psd` flattens to the SHA-256 in
 * `fixtures/w6-layers.flat.sha256` through core, through the command line's `layers flatten` and `convert`, through the
 * MCP server (packages/mcp/test/w6-layers.test.ts) and in headless Chrome (packages/web/e2e/layers.e2e.test.ts).
 * `WRITE_GOLDEN=1` rebuilds the PSD and the hash from make-w6-fixture.ts; `W6_PNG=<file>` also writes the flattened
 * picture, four times as big, to look at first.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPsdDocument, writePsdDocument } from '@free-photoeditor/core/psd';
import { run } from '../src/cli';
import { capture, readPng, tempDir, writePng } from './helpers';
import { W6_HEIGHT, W6_WIDTH, flatBytes, makeW6Doc, sha256 } from './make-w6-fixture';

const BASE = fileURLToPath(new URL('./fixtures/w6-layers', import.meta.url));
const PSD = BASE + '.psd', GOLD = BASE + '.flat.sha256';

if (process.env.WRITE_GOLDEN) {
  const bytes = writePsdDocument(makeW6Doc()), back = readPsdDocument(bytes).doc;
  writeFileSync(PSD, bytes);
  writeFileSync(GOLD, sha256(flatBytes(back)) + '\n');
  const out = process.env.W6_PNG;
  if (out) {
    const f = 4, src = flatBytes(back), big = new Uint8ClampedArray(W6_WIDTH * f * W6_HEIGHT * f * 4);
    for (let y = 0; y < W6_HEIGHT * f; y++) for (let x = 0; x < W6_WIDTH * f; x++) {
      const s = ((Math.floor(y / f) * W6_WIDTH) + Math.floor(x / f)) * 4, d = (y * W6_WIDTH * f + x) * 4;
      big.set(src.subarray(s, s + 4), d);
    }
    writePng(out, { width: W6_WIDTH * f, height: W6_HEIGHT * f, data: big });
  }
}

describe('W6 layers fixture: the same flattened pixels everywhere', () => {
  const gold = existsSync(GOLD) ? readFileSync(GOLD, 'utf8').trim() : '';
  it('has a golden hash, and core reads the PSD back with every mask and no notes', () => {
    expect(gold).toMatch(/^[0-9a-f]{64}$/);
    const { doc, notes } = readPsdDocument(readFileSync(PSD));
    expect(notes).toEqual([]);
    expect(doc.layers.map((l) => l.name)).toEqual(['Sky', 'Sun', 'Sea', 'Note']);
    expect(doc.layers.map((l) => !!l.mask)).toEqual([false, true, true, true]);
    expect(doc.layers.map((l) => l.mask?.enabled ?? null)).toEqual([null, true, true, false]);
    expect(doc.layers[2].mask).toMatchObject({ outside: 255, density: 0.6, feather: 2.5 });
    const sky = doc.layers[0];
    expect([sky.x, sky.y, sky.width, sky.height]).toEqual([0, 0, W6_WIDTH, W6_HEIGHT]);
    expect(sky.data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });
  it('core: the checked-in PSD, and the maker built afresh, flatten to the golden hash', () => {
    expect(sha256(flatBytes(readPsdDocument(readFileSync(PSD)).doc))).toBe(gold);
    expect(sha256(flatBytes(readPsdDocument(writePsdDocument(makeW6Doc())).doc))).toBe(gold);
  });
  it('command line: layers flatten and convert to PNG give the golden pixels', async () => {
    const dir = tempDir(), src = path.join(dir, 'w6-layers.psd');
    copyFileSync(PSD, src);
    for (const [args, out] of [[['layers', 'flatten', src], 'flat.png'], [['convert', src], 'conv.png']] as const) {
      const c = capture(dir), file = path.join(dir, out), code = await run([...args, '-o', file, '--quiet'], c.io);
      expect(c.err).toEqual([]);
      expect(code).toBe(0);
      const png = readPng(file);
      expect([png.width, png.height]).toEqual([W6_WIDTH, W6_HEIGHT]);
      expect(sha256(png.data)).toBe(gold);
    }
  });
});
