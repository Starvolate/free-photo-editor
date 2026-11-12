// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * PSD open and save through ag-psd (MIT). Kept out of the main entry so apps can load it only when needed.
 * Layers keep name, order, visibility, opacity, blend mode and position. The credit goes into the file's XMP.
 */
import { initializeCanvas, readPsd, writePsd } from 'ag-psd';
import type { BlendMode } from './blend';
import { CREDIT } from './credit';
import { createDocument, flatten, newId, type Doc, type Layer } from './document';
import { buildXmp } from './metadata';

const TO_PSD: Record<BlendMode, string> = {
  normal: 'normal', dissolve: 'dissolve', darken: 'darken', multiply: 'multiply', 'color-burn': 'color burn',
  'linear-burn': 'linear burn', 'darker-color': 'darker color', lighten: 'lighten', screen: 'screen',
  'color-dodge': 'color dodge', 'linear-dodge': 'linear dodge', 'lighter-color': 'lighter color', overlay: 'overlay',
  'soft-light': 'soft light', 'hard-light': 'hard light', 'vivid-light': 'vivid light', 'linear-light': 'linear light',
  'pin-light': 'pin light', 'hard-mix': 'hard mix', difference: 'difference', exclusion: 'exclusion', subtract: 'subtract',
  divide: 'divide', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};
const FROM_PSD: Record<string, BlendMode> = { subtraction: 'subtract' };
for (const [k, v] of Object.entries(TO_PSD)) FROM_PSD[v] = k as BlendMode;

interface AgPixels { width: number; height: number; data: unknown; }
interface AgLayer {
  name?: string; hidden?: boolean; opacity?: number; blendMode?: string; left?: number; top?: number;
  imageData?: AgPixels; children?: AgLayer[]; adjustment?: unknown; text?: unknown; mask?: unknown;
}
interface AgPsd { width: number; height: number; children?: AgLayer[]; imageData?: AgPixels; imageResources?: { xmpMetadata?: string }; }

let ready = false;
function init(): void {
  if (ready) return;
  ready = true;
  const noCanvas = (): never => { throw new Error('Free Photo Editor reads PSD pixels without a canvas'); };
  const pixels = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
  (initializeCanvas as unknown as (a: unknown, b?: unknown) => void)(noCanvas, pixels);
}
function toRgba8(p: AgPixels | undefined): Uint8ClampedArray | null {
  if (!p || !p.width || !p.height) return null;
  const d = p.data, n = p.width * p.height * 4;
  if (d instanceof Uint8ClampedArray) return d.length === n ? d : null;
  if (d instanceof Uint8Array) return d.length === n ? new Uint8ClampedArray(d.buffer, d.byteOffset, n) : null;
  const out = new Uint8ClampedArray(n);
  if (d instanceof Uint16Array) { for (let i = 0; i < n; i++) out[i] = d[i] >> 8; return out; }
  if (d instanceof Float32Array) { for (let i = 0; i < n; i++) out[i] = d[i] * 255; return out; }
  return null;
}

export interface PsdImport { doc: Doc; notes: string[]; credit: string | null; }
/** Read a PSD. `notes` lists, in plain words, anything that was simplified on the way in. */
export function readPsdDocument(bytes: Uint8Array | ArrayBuffer): PsdImport {
  init();
  const psd = readPsd(bytes as never, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, throwForMissingFeatures: false, logMissingFeatures: false } as never) as unknown as AgPsd;
  const notes = new Set<string>();
  const layers: Layer[] = [];
  const walk = (list: AgLayer[], visible: boolean, opacity: number): void => {
    for (const l of list) {
      if (l.children) {
        notes.add('Layer groups were opened as a plain list of layers.');
        walk(l.children, visible && !l.hidden, opacity * (l.opacity ?? 1));
        continue;
      }
      const data = toRgba8(l.imageData);
      if (!data || !l.imageData) { if (l.adjustment) notes.add('Adjustment layers were left out.'); continue; }
      if (l.text) notes.add('Text layers were opened as pixels.');
      if (l.mask) notes.add('Layer masks were left out.');
      layers.push({
        id: newId(), name: l.name || 'Layer', visible: visible && !l.hidden, opacity: Math.max(0, Math.min(1, opacity * (l.opacity ?? 1))),
        blendMode: FROM_PSD[l.blendMode ?? 'normal'] ?? 'normal', x: l.left ?? 0, y: l.top ?? 0,
        width: l.imageData.width, height: l.imageData.height, data,
      });
    }
  };
  walk(psd.children ?? [], true, 1);
  let doc: Doc;
  if (layers.length) doc = { width: psd.width, height: psd.height, layers, activeId: layers[layers.length - 1].id, selection: null };
  else {
    doc = createDocument(psd.width, psd.height, null);
    const comp = toRgba8(psd.imageData);
    if (comp) { doc.layers[0].data = comp; doc.layers[0].name = 'Background'; }
  }
  const xmp = psd.imageResources?.xmpMetadata ?? '';
  const m = /CreatorTool="([^"]*)"/.exec(xmp);
  return { doc, notes: [...notes], credit: m ? m[1] : null };
}
/** Write a layered PSD with a flattened preview and the credit in its XMP file info. */
export function writePsdDocument(doc: Doc, credit: string = CREDIT): Uint8Array {
  init();
  const flat = flatten(doc);
  const psd = {
    width: doc.width, height: doc.height,
    imageData: { width: doc.width, height: doc.height, data: flat.data },
    imageResources: { xmpMetadata: buildXmp(credit) },
    children: doc.layers.map((l) => ({
      name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: TO_PSD[l.blendMode],
      left: l.x, top: l.y, right: l.x + l.width, bottom: l.y + l.height,
      imageData: { width: l.width, height: l.height, data: l.data },
    })),
  };
  const out = writePsd(psd as never, { generateThumbnail: false, trimImageData: false } as never) as unknown as ArrayBuffer;
  return new Uint8Array(out);
}
