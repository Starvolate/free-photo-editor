// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Effects run in bands of rows (so Apply can show real progress) give the same pixels, byte for byte, as one run. */
import { describe, expect, it } from 'vitest';
import { runEffect } from '../src/fx';
import { BANDED, FX_KINDS } from '../src/fx/meta';
import { jobBands, splitJob, type JobSpec } from '../src/jobs';

const W = 53, H = 140;
const src = new Uint8ClampedArray(W * H * 4);
let seed = 7;
for (let i = 0; i < src.length; i++) {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  const x = (i >> 2) % W, y = Math.floor(i / 4 / W);
  src[i] = (i & 3) === 3 ? 140 + (seed >>> 27) * 3 : ((seed >>> 24) & 127) + ((x * 5 + y * 3) & 127);
}
const SETS: Record<string, number>[] = [{}, { radius: 5, distance: 9, length: 8, height: 4, width: 3, smooth: 8, levels: 12, amount: 70, threshold: 6, color: 80, angle: 30 }];
const BOX = { ix: 4, iy: 6, iw: W - 9, ih: H - 13 };
const whole = (kind: string, p: Record<string, number>): Uint8ClampedArray => runEffect({ kind, params: { ...p, ...BOX } }, { width: W, height: H, data: src });
function inBands(kind: string, p: Record<string, number>, rows: number): Uint8ClampedArray {
  const spec: JobSpec = { op: 'fx', kind, params: { ...p, ...BOX } }, out = src.slice();
  for (const b of splitJob(spec, H, rows)) {
    const res = runEffect(b.spec, { width: W, height: b.sh, data: src.slice(b.sy * W * 4, (b.sy + b.sh) * W * 4) });
    out.set(res.subarray((b.y0 - b.sy) * W * 4, (b.y1 - b.sy) * W * 4), b.y0 * W * 4);
  }
  return out;
}

describe('effects in bands of rows', () => {
  it('every effect listed as banded gives the same pixels, byte for byte, as one run, at default and large settings', () => {
    const bad: string[] = [];
    for (const kind of BANDED) for (const p of SETS) for (const rows of [7, 23]) {
      const a = whole(kind, p), b = inBands(kind, p, rows);
      if (a.some((v, i) => v !== b[i])) bad.push(`${kind} ${Object.keys(p).length ? 'large' : 'default'} rows ${rows}`);
    }
    expect(bad).toEqual([]);
  });
  it('lists only real effects, and splits a big job into bands that cover every row once', () => {
    for (const k of BANDED) expect(FX_KINDS as readonly string[]).toContain(k);
    const bands = jobBands({ op: 'fx', kind: 'median', params: { radius: 3, ix: 0, iy: 0, iw: 4000, ih: 3000 } }, 3000) ?? [];
    expect(bands.length).toBeGreaterThan(4);
    let y = 0;
    for (const b of bands) {
      expect(b.y0).toBe(y);
      expect(b.sy).toBeLessThanOrEqual(b.y0);
      expect(b.sy + b.sh).toBeGreaterThanOrEqual(b.y1);
      y = b.y1;
    }
    expect(y).toBe(3000);
    expect(jobBands({ op: 'fx', kind: 'twirl', params: {} }, 3000), 'a twirl depends on where each pixel is').toBeNull();
    expect(jobBands({ op: 'gaussian-blur', params: { radius: 3 } }, 3000)).toBeNull();
    expect(jobBands({ op: 'fx', kind: 'median', params: { radius: 1 } }, 16), 'a small job runs in one go').toBeNull();
    expect(jobBands({ op: 'fx', kind: 'box-blur', params: { radius: 3 } }, 3000), 'box blur reads further than its reach').toBeNull();
  });
});
