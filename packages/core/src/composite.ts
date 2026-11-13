// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The compositor: every layer that meets a rectangle, mixed bottom to top. Everything that reads the stack goes through
 * here (the screen, the eyedropper, export, PSD previews, the command line and MCP), so all of them see the same picture.
 * Pass 1 prepares each mask over the rectangle; pass 2 is the row loop. Layers without masks give the same bytes as before.
 */
import { SEPARABLE, hash01, nonSeparable, type BlendLayer } from './blend';
import type { RGBA } from './color';
import { intersect, type Rect } from './geometry';
import { maskRows } from './mask';

/** Composite layers (index 0 = bottom) for one document rectangle. Returns rect-sized RGBA. */
export function compositeRect(layers: readonly BlendLayer[], r: Rect, background: RGBA | null = null): Uint8ClampedArray {
  const w = Math.max(0, r.w), h = Math.max(0, r.h);
  const out = new Uint8ClampedArray(w * h * 4);
  if (!w || !h) return out;
  const acc = new Float32Array(w * 4);
  const mix = new Float64Array(3);
  const bR = background ? background.r / 255 : 0, bG = background ? background.g / 255 : 0;
  const bB = background ? background.b / 255 : 0, bA = background ? background.a / 255 : 0;
  const list = layers.filter((l) => l.visible && l.opacity > 0 && l.x < r.x + w && l.y < r.y + h && l.x + l.width > r.x && l.y + l.height > r.y);
  // Pass 1: each mask is prepared once over the part of the layer this rectangle needs (soft edges read their neighbours).
  const masks = list.map((l) => (l.mask ? maskRows(l.mask, intersect(r, { x: l.x, y: l.y, w: l.width, h: l.height }) as Rect) : null));
  const mrow = new Float32Array(w);
  for (let row = 0; row < h; row++) {
    const y = r.y + row;
    for (let i = 0; i < w * 4; i += 4) { acc[i] = bR; acc[i + 1] = bG; acc[i + 2] = bB; acc[i + 3] = bA; }
    for (let j = 0; j < list.length; j++) {
      const L = list[j], mk = masks[j];
      const ly = y - L.y;
      if (ly < 0 || ly >= L.height) continue;
      const x0 = Math.max(r.x, L.x), x1 = Math.min(r.x + w, L.x + L.width);
      if (x0 >= x1) continue;
      const mode = L.blendMode;
      const sep = SEPARABLE[mode];
      const plain = mode === 'normal' || mode === 'dissolve';
      const dissolve = mode === 'dissolve';
      const d = L.data;
      const k255 = L.opacity / 255;
      let si = (ly * L.width + (x0 - L.x)) * 4;
      let ai = (x0 - r.x) * 4;
      if (mk) mk(y, x0, x1, mrow);
      for (let x = x0; x < x1; x++, si += 4, ai += 4) {
        let as = d[si + 3] * k255;
        if (mk) as *= mrow[x - x0];
        if (as <= 0) continue;
        if (dissolve) { if (hash01(x, y) >= as) continue; as = 1; }
        const sr = d[si] / 255, sg = d[si + 1] / 255, sb = d[si + 2] / 255;
        const ab = acc[ai + 3], br = acc[ai], bg = acc[ai + 1], bb = acc[ai + 2];
        let mr = sr, mg = sg, mb = sb;
        if (!plain && ab > 0) {
          if (sep) { mr = sep(br, sr); mg = sep(bg, sg); mb = sep(bb, sb); }
          else { nonSeparable(mode, br, bg, bb, sr, sg, sb, mix); mr = mix[0]; mg = mix[1]; mb = mix[2]; }
          mr = (1 - ab) * sr + ab * mr; mg = (1 - ab) * sg + ab * mg; mb = (1 - ab) * sb + ab * mb;
        }
        const k = ab * (1 - as);
        const ao = as + k;
        acc[ai] = (as * mr + k * br) / ao; acc[ai + 1] = (as * mg + k * bg) / ao;
        acc[ai + 2] = (as * mb + k * bb) / ao; acc[ai + 3] = ao;
      }
    }
    const o = row * w * 4;
    for (let i = 0; i < w * 4; i++) out[o + i] = acc[i] * 255;
  }
  return out;
}
