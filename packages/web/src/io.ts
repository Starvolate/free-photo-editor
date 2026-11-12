// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Opening and saving files. Browsers decode the common formats; the engine adds the credit and handles PSD. */
import { CREDIT, FORMAT_INFO, WHITE, flatten, injectMetadata, webpInfo, type Bitmap, type Doc, type ExportFormat } from '@free-photoeditor/core';

export const OPEN_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/vnd.adobe.photoshop,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg,.ico,.psd';
export type Opened = { kind: 'bitmap'; bitmap: Bitmap } | { kind: 'psd'; bytes: Uint8Array };
export const baseName = (n: string): string => n.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'image';

function draw(src: CanvasImageSource, w: number, h: number): Bitmap {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw on a canvas.');
  ctx.drawImage(src, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  c.width = 0; c.height = 0;
  return { width: w, height: h, data };
}
async function viaImg(file: Blob, svg: boolean): Promise<Bitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("This file couldn't be opened as a picture.")); });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { w = 1024; h = 1024; }
    if (svg && Math.max(w, h) < 1024) { const k = 1024 / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    return draw(img, w, h);
  } finally { URL.revokeObjectURL(url); }
}
/** Decode a picture file. PSD comes back as bytes for the engine; everything else as pixels. */
export async function readImageFile(file: Blob, name: string): Promise<Opened> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x38 && head[1] === 0x42 && head[2] === 0x50 && head[3] === 0x53) return { kind: 'psd', bytes: new Uint8Array(await file.arrayBuffer()) };
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(name);
  if (!svg && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      try { return { kind: 'bitmap', bitmap: draw(bmp, bmp.width, bmp.height) }; } finally { bmp.close(); }
    } catch { /* some formats only decode through <img> */ }
  }
  return { kind: 'bitmap', bitmap: await viaImg(file, svg) };
}
/** How many pixels this device can comfortably edit, from navigator.deviceMemory when the browser shares it. */
export function maxPixelsForDevice(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const m = typeof gb === 'number' ? gb : 4;
  return m >= 8 ? 64e6 : m >= 4 ? 36e6 : m >= 2 ? 16e6 : 8e6;
}
export function historyBytesForDevice(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const m = typeof gb === 'number' ? gb : 4;
  return Math.min(1024, Math.max(128, m * 96)) * 1024 * 1024;
}
export function toImageData(b: Bitmap): ImageData {
  return new ImageData(b.data as unknown as Uint8ClampedArray<ArrayBuffer>, b.width, b.height);
}
export function scaleBitmap(b: Bitmap, w: number, h: number): Bitmap {
  const c = document.createElement('canvas');
  c.width = b.width; c.height = b.height;
  c.getContext('2d')?.putImageData(toImageData(b), 0, 0);
  const out = draw(c, w, h);
  c.width = 0;
  return out;
}
/** Encode the picture. Every file carries the credit in its metadata. */
export async function encodeDocument(doc: Doc, format: ExportFormat, quality: number): Promise<{ blob: Blob; note: string | null }> {
  const info = FORMAT_INFO[format];
  if (format === 'psd') {
    const { writePsdDocument } = await import('@free-photoeditor/core/psd');
    return { blob: new Blob([writePsdDocument(doc, CREDIT) as unknown as BlobPart], { type: info.mime }), note: null };
  }
  const flat = flatten(doc, format === 'jpeg' ? WHITE : null);
  const c = document.createElement('canvas');
  c.width = flat.width; c.height = flat.height;
  c.getContext('2d')?.putImageData(toImageData(flat), 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, info.mime, format === 'png' ? undefined : quality));
  c.width = 0;
  if (!blob) throw new Error("This browser couldn't make the file.");
  if (blob.type !== info.mime) throw new Error(`This browser can't save ${info.label} files. Try PNG instead.`);
  const bytes = injectMetadata(new Uint8Array(await blob.arrayBuffer()), format, CREDIT);
  const note = format === 'webp' && quality >= 1 && !webpInfo(bytes).lossless ? 'This browser saved the WebP with light compression.' : null;
  return { blob: new Blob([bytes as unknown as BlobPart], { type: info.mime }), note };
}
export function download(blob: Blob, filename: string, host: HTMLElement): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  host.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
