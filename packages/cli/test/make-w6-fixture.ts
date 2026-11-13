// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The W6 layers fixture (design 5, "Parity between the browser and Node"): a small picture built with core's own
 * operations and saved with `writePsdDocument` as `fixtures/w6-layers.psd`. Each W6 slice adds its structures here and
 * regenerates the golden hash (`WRITE_GOLDEN=1 npx vitest run packages/cli/test/w6-layers.test.ts`) after looking at the
 * flattened picture. The hash in `fixtures/w6-layers.flat.sha256` is the SHA-256 of the flattened RGBA bytes with no
 * background; the bottom layer covers the whole canvas, fully solid and with no mask, so the command line's flatten on
 * white gives the same bytes.
 *
 * S1 (masks), bottom to top:
 * - "Sky": a solid colour ramp over the whole canvas; no mask.
 * - "Sun": a mask that fades from hidden on the left to shown on the right, hidden beyond its box.
 * - "Sea": Multiply, with a hidden hole in a shown mask, a soft edge of 2.5 px and a density of 60%.
 * - "Note": 80% opacity, with its mask switched off (kept, saved, not applied), so the whole note shows.
 */
import { createHash } from 'node:crypto';
import { addLayer, compositeDoc, createLayer, docRect, documentFromBitmap, type Doc } from '@free-photoeditor/core';

export const W6_WIDTH = 64, W6_HEIGHT = 48;

export function makeW6Doc(): Doc {
  const W = W6_WIDTH, H = W6_HEIGHT, sky = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    sky[i] = 40 + Math.round((x * 150) / (W - 1));
    sky[i + 1] = 120 + Math.round((y * 100) / (H - 1));
    sky[i + 2] = 230 - Math.round((x * 60) / (W - 1));
    sky[i + 3] = 255;
  }
  const doc = documentFromBitmap({ width: W, height: H, data: sky });
  doc.layers[0].name = 'Sky';

  const sun = createLayer('Sun', 30, 20, { x: 8, y: 6, fill: { r: 245, g: 170, b: 40, a: 255 } });
  const ramp = new Uint8Array(24 * 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) ramp[y * 24 + x] = Math.round((x * 255) / 23);
  sun.mask = { x: 10, y: 8, width: 24, height: 16, data: ramp, outside: 0, enabled: true, linked: true, density: 1, feather: 0 };
  addLayer(doc, sun);

  const sea = createLayer('Sea', 44, 16, { x: 12, y: 28, fill: { r: 30, g: 90, b: 200, a: 255 } });
  sea.blendMode = 'multiply';
  sea.mask = { x: 22, y: 31, width: 14, height: 8, data: new Uint8Array(14 * 8), outside: 255, enabled: true, linked: true, density: 0.6, feather: 2.5 };
  addLayer(doc, sea);

  const note = createLayer('Note', 14, 12, { x: 44, y: 6, fill: { r: 20, g: 150, b: 90, a: 255 } });
  note.opacity = 0.8;
  note.mask = { x: 44, y: 6, width: 14, height: 12, data: new Uint8Array(14 * 12), outside: 0, enabled: false, linked: true, density: 1, feather: 0 };
  addLayer(doc, note);
  return doc;
}

/** The flattened picture's RGBA bytes with no background, as the web app's `fpe.flatHash()` reads them. */
export const flatBytes = (doc: Doc): Uint8ClampedArray => compositeDoc(doc, docRect(doc));
export const sha256 = (b: Uint8Array | Uint8ClampedArray): string => createHash('sha256').update(Buffer.from(b.buffer, b.byteOffset, b.byteLength)).digest('hex');
