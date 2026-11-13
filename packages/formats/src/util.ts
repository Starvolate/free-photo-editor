// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Small helpers shared by the format add-ons. */
import { compositeRect, createLayer, flatten, latin1Encode, type Bitmap, type BlendMode, type Doc, type Layer } from '@free-photoeditor/core';

export const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
export function isOpaque(d: ArrayLike<number>): boolean { for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false; return true; }
export function startsWith(b: Uint8Array, sig: ArrayLike<number> | string, at = 0): boolean {
  const s = typeof sig === 'string' ? [...sig].map((c) => c.charCodeAt(0)) : sig;
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s[i]) return false;
  return true;
}
export interface LayerSpec { name: string; bmp: Bitmap; x?: number; y?: number; visible?: boolean; opacity?: number; blendMode?: BlendMode; }
/** A document from pictures listed bottom first. `active` picks the active layer (the top one by default). */
export function docOf(width: number, height: number, items: LayerSpec[], active = items.length - 1): Doc {
  const layers = items.map((i) => {
    const data = i.bmp.data instanceof Uint8ClampedArray ? i.bmp.data : new Uint8ClampedArray(i.bmp.data);
    const l = createLayer(i.name, i.bmp.width, i.bmp.height, { data, x: i.x ?? 0, y: i.y ?? 0 });
    l.visible = i.visible ?? true; l.opacity = i.opacity ?? 1; l.blendMode = i.blendMode ?? 'normal';
    return l;
  });
  return { width, height, layers, activeId: layers[Math.max(0, Math.min(layers.length - 1, active))].id, selection: null };
}
/** Frames or pages as layers: the first at the bottom and showing, the others hidden, so the picture shows the first. */
export function docFromFrames(width: number, height: number, frames: { bmp: Bitmap; delay?: number; name?: string }[], word = 'Frame'): Doc {
  if (frames.length === 1) return docOf(width, height, [{ name: frames[0].name ?? 'Background', bmp: frames[0].bmp }]);
  return docOf(width, height, frames.map((f, i) => ({
    name: f.name ?? `${word} ${i + 1}${f.delay ? ` (${Math.round(f.delay)} ms)` : ''}`, bmp: f.bmp, visible: i === 0 })), 0);
}
/** One layer on its own, on a clear picture the size of the document. */
export function layerAlone(doc: Doc, l: Layer): Bitmap {
  return { width: doc.width, height: doc.height, data: compositeRect([{ ...l, visible: true }], { x: 0, y: 0, w: doc.width, h: doc.height }, null) };
}
/** A frame time written in a layer name, as "Frame 2 (120 ms)". */
export const delayOf = (name: string, fallback: number): number => {
  const m = /\((\d+)\s*ms\)/i.exec(name);
  return m ? Math.max(10, Number(m[1])) : fallback;
};
export interface Frame { bmp: Bitmap; delay: number; name: string; }
/** The frames (or pages) to save: every layer, bottom first, when `multi` is on and there is more than one. */
export function framesOf(doc: Doc, multi: boolean, delay: number): Frame[] {
  if (!multi || doc.layers.length < 2) return [{ bmp: flatten(doc), delay, name: 'Picture' }];
  return doc.layers.map((l) => ({ bmp: layerAlone(doc, l), delay: delayOf(l.name, delay), name: l.name.replace(/\s*\(\d+\s*ms\)\s*$/i, '') }));
}
/** Paint `src` onto `dst` (straight RGBA). `over` blends with what is there; otherwise it replaces. */
export function blit(dst: Uint8ClampedArray, dw: number, dh: number, src: Bitmap, x0: number, y0: number, over: boolean): void {
  const s = src.data;
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dh) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dw) continue;
      const i = (y * src.width + x) * 4, o = (dy * dw + dx) * 4, sa = s[i + 3];
      if (!over || sa === 255) { dst[o] = s[i]; dst[o + 1] = s[i + 1]; dst[o + 2] = s[i + 2]; dst[o + 3] = sa; continue; }
      if (sa === 0) continue;
      const a = sa / 255, da = dst[o + 3] / 255, oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) dst[o + k] = (s[i + k] * a + dst[o + k] * da * (1 - a)) / oa;
      dst[o + 3] = oa * 255;
    }
  }
}
export function clearRect(dst: Uint8ClampedArray, dw: number, dh: number, x0: number, y0: number, w: number, h: number): void {
  const xa = Math.max(0, x0), xb = Math.min(dw, x0 + w);
  if (xb <= xa) return;
  for (let y = Math.max(0, y0); y < Math.min(dh, y0 + h); y++) dst.fill(0, (y * dw + xa) * 4, (y * dw + xb) * 4);
}
/** A RIFF chunk (WebP): four letters, a little-endian size, the data and a pad byte when the size is odd. */
export function riff(fourcc: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(8 + data.length + (data.length & 1));
  c.set(latin1Encode(fourcc), 0);
  new DataView(c.buffer).setUint32(4, data.length, true);
  c.set(data, 8);
  return c;
}
/** An ISO box (AVIF, JPEG XL): a big-endian size, four letters and the data. */
export function isoBox(type: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(8 + data.length);
  new DataView(c.buffer).setUint32(0, c.length);
  c.set(latin1Encode(type), 4);
  c.set(data, 8);
  return c;
}
export function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
