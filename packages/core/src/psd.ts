// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * PSD open and save through ag-psd (MIT). Kept out of the main entry so apps can load it only when needed.
 * Layers keep name, order, visibility, opacity, blend mode and position. The credit goes into the file's XMP.
 */
import { initializeCanvas, readPsd, writePsd } from 'ag-psd';
import type { BlendMode } from './blend';
import { CREDIT } from './credit';
import { createDocument, createFolder, flatten, isFolder, newId, type Doc, type Layer, type LayerMask } from './document';
import { buildTree, repairTree, type TreeNode } from './tree';
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
interface AgMask {
  top?: number; left?: number; bottom?: number; right?: number; defaultColor?: number; disabled?: boolean; fromVectorData?: boolean;
  positionRelativeToLayer?: boolean; userMaskDensity?: number; userMaskFeather?: number; imageData?: AgPixels;
}
interface AgLayer {
  name?: string; hidden?: boolean; opacity?: number; blendMode?: string; left?: number; top?: number;
  imageData?: AgPixels; children?: AgLayer[]; opened?: boolean; clipping?: boolean; effects?: unknown; adjustment?: unknown; text?: unknown; mask?: AgMask; realMask?: AgMask; vectorMask?: unknown;
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

/**
 * The layer's pixel mask. With a shape (vector) mask as well, ag-psd gives the pixel mask as `realMask`; density and soft edge
 * always sit on `mask`. The PSD flag "position relative to layer" can't be confirmed as Photoshop's link, so every mask opens
 * linked (design 8.10). Density is stored in 1/255 steps, so it is read back to the nearest whole percent, as the slider sets it.
 */
function readMask(l: AgLayer, notes: Set<string>): LayerMask | undefined {
  if (l.vectorMask || l.mask?.fromVectorData) notes.add('Shape masks (vector masks) were left out.');
  const px = l.realMask ?? (l.mask && !l.mask.fromVectorData ? l.mask : undefined);
  if (!px) return undefined;
  const x = px.left ?? 0, y = px.top ?? 0, w = Math.max(0, (px.right ?? 0) - x), h = Math.max(0, (px.bottom ?? 0) - y);
  const rgba = w && h && px.imageData?.width === w && px.imageData.height === h ? toRgba8(px.imageData) : null;
  const data = new Uint8Array(rgba ? w * h : 0);
  if (rgba) for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  const p = l.mask ?? {}, dens = p.userMaskDensity === undefined ? 1 : Math.round(Math.max(0, Math.min(1, p.userMaskDensity)) * 100) / 100;
  return { x, y, width: rgba ? w : 0, height: rgba ? h : 0, data, outside: (px.defaultColor ?? 0) >= 128 ? 255 : 0, enabled: !px.disabled,
    linked: true, density: dens, feather: Math.max(0, p.userMaskFeather ?? 0) };
}
function writeMask(m: LayerMask): AgMask {
  const out: AgMask = { top: m.y, left: m.x, bottom: m.y + m.height, right: m.x + m.width, defaultColor: m.outside, disabled: !m.enabled };
  if (m.density !== 1) out.userMaskDensity = m.density;
  if (m.feather) out.userMaskFeather = m.feather;
  if (m.width && m.height) {
    const d = new Uint8ClampedArray(m.data.length * 4);
    for (let i = 0; i < m.data.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = m.data[i]; d[i * 4 + 3] = 255; }
    out.imageData = { width: m.width, height: m.height, data: d };
  }
  return out;
}

export interface PsdImport { doc: Doc; notes: string[]; credit: string | null; }
/** Read a PSD. `notes` lists, in plain words, anything that was simplified on the way in. */
export function readPsdDocument(bytes: Uint8Array | ArrayBuffer): PsdImport {
  init();
  const psd = readPsd(bytes as never, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, throwForMissingFeatures: false, logMissingFeatures: false } as never) as unknown as AgPsd;
  const notes = new Set<string>();
  const layers: Layer[] = [];
  // ag-psd lists children bottom to top; a folder's entry goes on top of its contents (tree.ts).
  const walk = (list: AgLayer[], parentId: string | undefined): void => {
    for (const l of list) {
      if (l.children) {
        const f = createFolder(l.name || 'Folder');
        if (parentId) f.parentId = parentId;
        f.visible = !l.hidden;
        f.opacity = Math.max(0, Math.min(1, l.opacity ?? 1));
        f.passThrough = l.blendMode === 'pass through';
        f.blendMode = f.passThrough ? 'normal' : FROM_PSD[l.blendMode ?? 'normal'] ?? 'normal';
        f.open = l.opened !== false;
        if (l.clipping) f.clip = true;
        if (l.effects) { f.psdKeep = { effects: l.effects }; notes.add('Effects on folders are kept for Photoshop but not shown here yet.'); }
        const fm = readMask(l, notes);
        if (fm) f.mask = fm;
        walk(l.children, f.id);
        layers.push(f);
        continue;
      }
      const data = toRgba8(l.imageData);
      if (!data || !l.imageData) { if (l.adjustment) notes.add('Adjustment layers were left out.'); continue; }
      if (l.text) notes.add('Text layers were opened as pixels.');
      const layer: Layer = {
        id: newId(), name: l.name || 'Layer', visible: !l.hidden, opacity: Math.max(0, Math.min(1, l.opacity ?? 1)),
        blendMode: FROM_PSD[l.blendMode ?? 'normal'] ?? 'normal', x: l.left ?? 0, y: l.top ?? 0,
        width: l.imageData.width, height: l.imageData.height, data,
      };
      if (parentId) layer.parentId = parentId;
      if (l.clipping) layer.clip = true;
      const mask = readMask(l, notes);
      if (mask) layer.mask = mask;
      layers.push(layer);
    }
  };
  walk(psd.children ?? [], undefined);
  let doc: Doc;
  if (layers.some((l) => !isFolder(l))) { const list = repairTree(layers); doc = { width: psd.width, height: psd.height, layers: list, activeId: list[list.length - 1].id, selection: null }; }
  else {
    doc = createDocument(psd.width, psd.height, null);
    const comp = toRgba8(psd.imageData);
    if (comp) { doc.layers[0].data = comp; doc.layers[0].name = 'Background'; }
  }
  const xmp = psd.imageResources?.xmpMetadata ?? '';
  const m = /CreatorTool="([^"]*)"/.exec(xmp);
  return { doc, notes: [...notes], credit: m ? m[1] : null };
}
/** One node as ag-psd writes it: folders with their contents (bottom to top), open or closed, pass through or a blend. */
function toAg(n: TreeNode<Layer>): Record<string, unknown> {
  const l = n.layer;
  const common = { name: l.name, hidden: !l.visible, opacity: l.opacity, ...(l.clip ? { clipping: true } : {}), ...(l.mask ? { mask: writeMask(l.mask) } : {}) };
  if (isFolder(l)) {
    return { ...common, ...(l.psdKeep ?? {}), blendMode: l.passThrough ? 'pass through' : TO_PSD[l.blendMode], opened: l.open !== false, children: n.children.map(toAg) };
  }
  return { ...common, blendMode: TO_PSD[l.blendMode], left: l.x, top: l.y, right: l.x + l.width, bottom: l.y + l.height,
    imageData: { width: l.width, height: l.height, data: l.data } };
}
/** Write a layered PSD with a flattened preview and the credit in its XMP file info. */
export function writePsdDocument(doc: Doc, credit: string = CREDIT): Uint8Array {
  init();
  const flat = flatten(doc);
  const psd = {
    width: doc.width, height: doc.height,
    imageData: { width: doc.width, height: doc.height, data: flat.data },
    imageResources: { xmpMetadata: buildXmp(credit) },
    children: buildTree(doc.layers).map(toAg),
  };
  const out = writePsd(psd as never, { generateThumbnail: false, trimImageData: false } as never) as unknown as ArrayBuffer;
  return new Uint8Array(out);
}
