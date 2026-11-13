// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * OpenRaster (.ora, the open layered format of Krita, GIMP and MyPaint) open and save, and Krita (.kra) open, written
 * for Free Photo Editor. Zip handling by fflate (MIT). Every stored PNG carries the credit.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { CREDIT, flatten, resizeBitmap, xmlEscape, type BlendMode, type Decoded, type Doc, type FormatCodec } from '@free-photoeditor/core';
import { decodePng, encodePng } from './png';
import { docOf, type LayerSpec } from './util';

const TO_ORA: Partial<Record<BlendMode, string>> = {
  normal: 'svg:src-over', multiply: 'svg:multiply', screen: 'svg:screen', overlay: 'svg:overlay', darken: 'svg:darken', lighten: 'svg:lighten',
  'color-dodge': 'svg:color-dodge', 'color-burn': 'svg:color-burn', 'hard-light': 'svg:hard-light', 'soft-light': 'svg:soft-light',
  difference: 'svg:difference', exclusion: 'svg:exclusion', hue: 'svg:hue', saturation: 'svg:saturation', color: 'svg:color', luminosity: 'svg:luminosity', 'linear-dodge': 'svg:plus',
};
const FROM_ORA: Record<string, BlendMode> = {};
for (const [k, v] of Object.entries(TO_ORA)) FROM_ORA[v as string] = k as BlendMode;
const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unxml = (s: string): string => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
  ENT[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] = unxml(m[2] ?? m[3] ?? '');
  return o;
}
const num = (s: string | undefined, d: number): number => { const v = Number(s); return s !== undefined && s !== '' && Number.isFinite(v) ? v : d; };

export function decodeOra(b: Uint8Array): Decoded {
  const files = unzipSync(b), stack = files['stack.xml'];
  if (!stack) throw new Error('This OpenRaster file has no layer list inside.');
  const xml = strFromU8(stack), img = attrs(/<image\b([^>]*)>/.exec(xml)?.[1] ?? ''), notes = new Set<string>(), items: LayerSpec[] = [];
  const parents = [{ visible: true, opacity: 1, x: 0, y: 0 }];
  if ((xml.match(/<stack\b/g) ?? []).length > 1) notes.add('Layer groups were opened as a plain list of layers.');
  for (const m of xml.matchAll(/<(\/?)(stack|layer)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, self] = m, top = parents[parents.length - 1];
    if (tag === 'stack') {
      if (close) { if (parents.length > 1) parents.pop(); }
      else if (!self) { const a = attrs(rest); parents.push({ visible: top.visible && a.visibility !== 'hidden', opacity: top.opacity * num(a.opacity, 1), x: top.x + num(a.x, 0), y: top.y + num(a.y, 0) }); }
      continue;
    }
    if (close) continue;
    const a = attrs(rest), png = a.src ? files[a.src] : undefined;
    if (!png) { notes.add('A layer that is not a picture was left out.'); continue; }
    const mode = a['composite-op'] ?? 'svg:src-over';
    if (!FROM_ORA[mode]) notes.add('Some blend modes were opened as Normal.');
    items.push({ name: a.name || 'Layer', bmp: decodePng(png), x: top.x + num(a.x, 0), y: top.y + num(a.y, 0), visible: top.visible && a.visibility !== 'hidden',
      opacity: Math.max(0, Math.min(1, top.opacity * num(a.opacity, 1))), blendMode: FROM_ORA[mode] ?? 'normal' });
  }
  if (!items.length) throw new Error('This OpenRaster file has no layers this editor can read.');
  items.reverse();
  const w = num(img.w, 0) || Math.max(...items.map((i) => (i.x ?? 0) + i.bmp.width)), h = num(img.h, 0) || Math.max(...items.map((i) => (i.y ?? 0) + i.bmp.height));
  return { doc: docOf(w, h, items), notes: [...notes] };
}
export function encodeOra(doc: Doc, credit: string = CREDIT): Uint8Array {
  const files: Zippable = { mimetype: [strToU8('image/openraster'), { level: 0 }] }, rows: string[] = [];
  doc.layers.forEach((l, i) => {
    const src = `data/layer${i + 1}.png`;
    files[src] = [encodePng({ width: l.width, height: l.height, data: l.data }, credit), { level: 0 }];
    rows.unshift(`  <layer name="${xmlEscape(l.name)}" src="${src}" x="${l.x}" y="${l.y}" opacity="${Math.round(l.opacity * 1000) / 1000}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="${TO_ORA[l.blendMode] ?? 'svg:src-over'}"/>`);
  });
  files['stack.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- Saved with ${xmlEscape(credit)} -->\n<image version="0.0.5" w="${doc.width}" h="${doc.height}" xres="72" yres="72">\n <stack>\n${rows.join('\n')}\n </stack>\n</image>\n`);
  const flat = flatten(doc), k = Math.min(1, 256 / Math.max(flat.width, flat.height)), tw = Math.max(1, Math.round(flat.width * k)), th = Math.max(1, Math.round(flat.height * k));
  files['mergedimage.png'] = [encodePng(flat, credit), { level: 0 }];
  files['Thumbnails/thumbnail.png'] = [encodePng(k < 1 ? { width: tw, height: th, data: resizeBitmap(flat, tw, th, 'smooth') } : flat, credit), { level: 0 }];
  return zipSync(files);
}
/** Krita: the flat picture Krita stores inside every file. Its layers are planned. */
export function decodeKra(b: Uint8Array): Decoded {
  const files = unzipSync(b, { filter: (f) => f.name === 'mergedimage.png' }), merged = files['mergedimage.png'];
  if (!merged) throw new Error("This Krita file has no flat picture inside, so it can't be opened yet. In Krita, save it as PSD or OpenRaster (.ora).");
  const bmp = decodePng(merged);
  return { doc: docOf(bmp.width, bmp.height, [{ name: 'Background', bmp }]), notes: ["Krita's layers were opened as one flat picture; opening them as layers is planned. Saving as OpenRaster (.ora) in Krita keeps them."] };
}
export const oraCodec: FormatCodec = { decode: async (b) => decodeOra(b), encode: async (doc) => encodeOra(doc) };
export const kraCodec: FormatCodec = { decode: async (b) => decodeKra(b) };
