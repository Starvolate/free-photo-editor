// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The hook that lets more file formats plug in as add-ons (packages/formats). A format is a short description plus a
 * loader: its codec is fetched only when a file of that type is first opened or saved. The loss warning for an add-on
 * format is written here from what the format can keep, in the same plain words as the built-in four.
 */
import type { Bitmap, Doc } from './document';
import type { DocFacts, ExportFormat, Loss } from './loss';

export interface FormatCaps {
  /** Keeps every layer as its own layer. */ layers?: boolean;
  /** See-through areas: kept fully, kept only as fully clear or fully solid, or not at all. */ alpha: 'full' | 'binary' | 'none';
  /** Drops fine detail to make files smaller (the quality slider shows); keeps every pixel at 100%. */ lossy?: boolean;
  /** At most 256 colours per picture or frame. */ palette?: boolean;
  /** The largest picture side the format holds. */ maxSide?: number;
  /** Layers can be saved as the frames of an animation, or as pages. */ multi?: 'frames' | 'pages';
}
export interface FormatOptions { quality: number; multi: boolean; delay: number; }
export interface Decoded { doc: Doc; notes: string[]; }
/** What the app around the engine offers the codecs: the browser's own picture decoders and encoders. */
export interface FormatHost {
  decodeStill?(bytes: Uint8Array, mime: string): Promise<Bitmap>;
  encodeStill?(bmp: Bitmap, mime: string, quality: number): Promise<Uint8Array>;
}
export interface FormatCodec {
  decode?(bytes: Uint8Array, host: FormatHost): Promise<Decoded>;
  encode?(doc: Doc, opts: FormatOptions, host: FormatHost): Promise<Uint8Array>;
}
export interface FormatDef {
  id: string; label: string; mime: string; ext: string; exts: readonly string[];
  open: boolean; save: boolean; caps: FormatCaps;
  /** One plain line on what the format keeps, shown when nothing is lost. */ keeps: string;
  /** True when these first bytes (and the file name) are this format. */ sniff(head: Uint8Array, name: string): boolean;
  load(): Promise<FormatCodec>;
}
const REG = new Map<string, FormatDef>();
export function registerFormat(def: FormatDef): void { REG.set(def.id, def); }
export const formatDef = (id: string): FormatDef | undefined => REG.get(id);
export const listFormats = (): FormatDef[] => [...REG.values()];
export function sniffFormat(head: Uint8Array, name: string): FormatDef | undefined {
  for (const d of REG.values()) if (d.open && d.sniff(head, name)) return d;
  return undefined;
}

export interface FormatLossReport { format: string; losses: Loss[]; kept: string; suggest: ExportFormat | null; suggestText: string | null; }
/**
 * The loss warning for an add-on format, or for a built-in one saved as frames or pages. `side` is the picture's
 * longest side in pixels; `multi` is on when each layer becomes a frame or a page.
 */
export function formatLossReport(format: { id: string; label: string; caps: FormatCaps; keeps: string }, f: DocFacts, quality = 0.92, multi = false, side = 0): FormatLossReport {
  const { label, caps } = format, losses: Loss[] = [];
  const asMulti = multi && !!caps.multi && f.layers > 1;
  if (!caps.layers && !asMulti) {
    if (f.layers > 1) losses.push({ id: 'layers', keptBy: 'psd', text: `Your ${f.layers} layers are merged into one flat picture, so you can't change them one by one in this file.` });
    if (f.hidden > 0) losses.push({ id: 'hidden', keptBy: 'psd', text: f.hidden === 1 ? 'The hidden layer is left out.' : `The ${f.hidden} hidden layers are left out.` });
  }
  if (f.transparent && caps.alpha === 'none') losses.push({ id: 'transparency', keptBy: 'png', text: `See-through areas turn white, because ${label} can't store transparency.` });
  if (f.transparent && caps.alpha === 'binary') losses.push({ id: 'transparency', keptBy: 'png', text: `Soft see-through edges turn hard: ${label} keeps each pixel either fully clear or fully solid.` });
  if (caps.palette) losses.push({ id: 'quality', keptBy: 'png', text: `${label} keeps at most 256 colours${asMulti ? ' in each frame' : ''}, so smooth shades can look banded or speckled.` });
  if (caps.lossy && quality < 1) losses.push({ id: 'quality', keptBy: 'png', text: `Some fine detail is dropped to make the file smaller (quality ${Math.round(quality * 100)}%).` });
  if (caps.maxSide && side > caps.maxSide) losses.push({ id: 'quality', keptBy: 'png', text: `${label} holds pictures up to ${caps.maxSide} pixels a side, so this one is made smaller.` });
  const what = asMulti ? (caps.multi === 'frames'
    ? `Each of your ${f.layers} layers becomes one frame of the animation, bottom layer first (hidden ones too).`
    : `Each of your ${f.layers} layers becomes its own page, bottom layer first (hidden ones too).`) : format.keeps;
  const suggest: ExportFormat | null = losses.some((l) => l.keptBy === 'psd') ? 'psd' : losses.length ? 'png' : null;
  const suggestText = suggest === 'psd' ? 'PSD keeps every layer with its name, order, visibility, opacity and blend mode.'
    : suggest === 'png' ? (f.transparent ? 'PNG keeps every pixel exactly, transparency included.' : 'PNG keeps every pixel exactly.') : null;
  return { format: format.id, losses, kept: losses.length ? what : 'Nothing is lost. ' + what, suggest, suggestText };
}
