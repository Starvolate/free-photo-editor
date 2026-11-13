// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Opening and saving files. Browsers decode the common formats; the engine adds the credit and handles PSD (and PSB);
 * the format add-ons (packages/formats) open and save the rest, each loaded only when first used.
 */
import {
  CREDIT, EXPORT_FORMATS, FORMAT_INFO, WHITE, docDpi, flatten, formatDef, injectMetadata, jpegSampling, listFormats, readDpi, sniffFormat, webpInfo,
  type Bitmap, type Doc, type ExportFormat, type FormatHost,
} from '@free-photoeditor/core';
import { OPEN_EXTS, PLANNED_OPEN, registerAllFormats } from '@free-photoeditor/formats';

registerAllFormats();
export const OPEN_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/vnd.adobe.photoshop,' +
  'image/tiff,image/heic,image/heif,image/jxl,image/apng,image/x-tga,image/openraster,application/pdf,' +
  '.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg,.ico,.psd,.psb,' + OPEN_EXTS.map((e) => '.' + e).join(',');
export type Opened = { kind: 'bitmap'; bitmap: Bitmap; dpi?: number | null } | { kind: 'psd'; bytes: Uint8Array } | { kind: 'doc'; doc: Doc; notes: string[] } | { kind: 'none' };
/** How the open step asks a question (the PDF page, the RAW develop step). False means the person cancelled. */
export interface OpenUi { choose(title: string, body: HTMLElement, ok: string): Promise<boolean>; }
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
export function toImageData(b: Bitmap): ImageData {
  return new ImageData(b.data as unknown as Uint8ClampedArray<ArrayBuffer>, b.width, b.height);
}
/** The browser's own still-picture decoders and encoders, offered to the format add-ons. */
export const HOST: FormatHost = {
  async decodeStill(bytes, mime) {
    const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
    try { return draw(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
  },
  async encodeStill(b, mime, quality) {
    const c = document.createElement('canvas');
    c.width = b.width; c.height = b.height;
    c.getContext('2d')?.putImageData(toImageData(b), 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, quality));
    c.width = 0;
    if (!blob || blob.type !== mime) throw new Error(`This browser can't make ${mime.replace('image/', '').toUpperCase()} files. Try PNG instead.`);
    return new Uint8Array(await blob.arrayBuffer());
  },
};
/** Decode a picture file. PSD and PSB come back as bytes for the engine; add-on formats as a document; the rest as pixels. */
export async function readImageFile(file: Blob, name: string, ui?: OpenUi): Promise<Opened> {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (head[0] === 0x38 && head[1] === 0x42 && head[2] === 0x50 && head[3] === 0x53) return { kind: 'psd', bytes: new Uint8Array(await file.arrayBuffer()) };
  const planned = PLANNED_OPEN.find((p) => p.test(head, name));
  if (planned) throw new Error(planned.message);
  const def = sniffFormat(head, name);
  if (def) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ((def.id === 'pdf' || def.id === 'raw') && ui) {
      const m = await import('./open-options');
      const bmp = def.id === 'pdf' ? await m.openPdfPage(bytes, ui) : await m.developRaw(bytes, ui);
      return bmp ? { kind: 'bitmap', bitmap: bmp } : { kind: 'none' };
    }
    const res = await (await def.load()).decode?.(bytes, HOST);
    if (!res) throw new Error(`${def.label} files can't be opened yet.`);
    return { kind: 'doc', doc: res.doc, notes: res.notes };
  }
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(name);
  // The print resolution (DPI) is read from the file's own bytes: the browser's decoders drop it. WebP keeps it at the end.
  const webp = head[0] === 0x52 && head[1] === 0x49 && head[8] === 0x57 && head[9] === 0x45 && file.size > head.length;
  const dpi = svg ? null : readDpi(webp ? new Uint8Array(await file.arrayBuffer()) : head);
  if (!svg && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      try { return { kind: 'bitmap', bitmap: draw(bmp, bmp.width, bmp.height), dpi }; } finally { bmp.close(); }
    } catch { /* some formats only decode through <img> */ }
  }
  return { kind: 'bitmap', bitmap: await viaImg(file, svg), dpi };
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
export function scaleBitmap(b: Bitmap, w: number, h: number): Bitmap {
  const c = document.createElement('canvas');
  c.width = b.width; c.height = b.height;
  c.getContext('2d')?.putImageData(toImageData(b), 0, 0);
  const out = draw(c, w, h);
  c.width = 0;
  return out;
}
/** Every type the Export sheet offers: the built-in four, then the add-ons that can save. */
export const exportList = (): string[] => [...EXPORT_FORMATS, ...listFormats().filter((f) => f.save).map((f) => f.id)];
export function fmtInfo(id: string): { label: string; ext: string; mime: string; lossy: boolean } {
  const b = FORMAT_INFO[id as ExportFormat];
  if (b) return b;
  const d = formatDef(id);
  return d ? { label: d.label, ext: d.ext, mime: d.mime, lossy: !!d.caps.lossy } : { label: id.toUpperCase(), ext: id, mime: 'application/octet-stream', lossy: false };
}
/** Whether a type can hold the layers as animation frames or as pages. PNG and WebP move as APNG and animated WebP. */
export const multiKind = (id: string): 'frames' | 'pages' | null => (id === 'png' || id === 'webp' ? 'frames' : formatDef(id)?.caps.multi ?? null);
export interface SaveOptions { multi: boolean; delay: number; /** Print resolution to store; the picture's own when not given. */ dpi?: number; }
/**
 * Encode the picture. Every file carries the credit, and the print resolution (DPI), where the format has room for them.
 * A JPEG at the best quality (1) is checked: it should keep every colour pixel (4:4:4); if this browser cannot, the note says so.
 */
export async function encodeDocument(doc: Doc, format: string, quality: number, opts: SaveOptions = { multi: false, delay: 100 }): Promise<{ blob: Blob; note: string | null }> {
  const multi = opts.multi && doc.layers.length > 1, dpi = opts.dpi ?? docDpi(doc);
  if (multi && (format === 'png' || format === 'webp')) {
    const { apngCodec, webpAnimCodec } = await import('@free-photoeditor/formats/anim');
    const bytes = await (format === 'png' ? apngCodec : webpAnimCodec).encode?.(doc, { quality, multi: true, delay: opts.delay }, HOST);
    if (!bytes) throw new Error("The animation couldn't be made.");
    return { blob: new Blob([bytes as unknown as BlobPart], { type: FORMAT_INFO[format].mime }), note: null };
  }
  const def = formatDef(format);
  if (def) {
    const codec = await def.load();
    if (!codec.encode) throw new Error(`${def.label} files can't be saved yet.`);
    const bytes = await codec.encode(doc, { quality, multi, delay: opts.delay, dpi }, HOST);
    return { blob: new Blob([bytes as unknown as BlobPart], { type: def.mime }), note: null };
  }
  const fmt = format as ExportFormat, info = FORMAT_INFO[fmt];
  if (!info) throw new Error("This file type can't be saved.");
  if (fmt === 'psd') {
    const { writePsdDocument } = await import('@free-photoeditor/core/psd');
    return { blob: new Blob([writePsdDocument(doc, CREDIT, dpi) as unknown as BlobPart], { type: info.mime }), note: null };
  }
  const flat = flatten(doc, fmt === 'jpeg' ? WHITE : null);
  const c = document.createElement('canvas');
  c.width = flat.width; c.height = flat.height;
  c.getContext('2d')?.putImageData(toImageData(flat), 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, info.mime, fmt === 'png' ? undefined : quality));
  c.width = 0;
  if (!blob) throw new Error("This browser couldn't make the file.");
  if (blob.type !== info.mime) throw new Error(`This browser can't save ${info.label} files. Try PNG instead.`);
  const bytes = injectMetadata(new Uint8Array(await blob.arrayBuffer()), fmt, CREDIT, dpi);
  const chroma = fmt === 'jpeg' && quality >= 1 ? jpegSampling(bytes) : null;
  const note = fmt === 'webp' && quality >= 1 && !webpInfo(bytes).lossless ? 'This browser saved the WebP with light compression.'
    : chroma && chroma !== '4:4:4' && chroma !== 'grey' ? `This browser keeps JPEG colour at lower detail (${chroma}) even at the best quality. For every colour pixel, export PNG or TIFF.` : null;
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
