// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The loss warning: in plain words, what a file format will lose for this particular picture. */
import { compositeHasTransparency, type Doc } from './document';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'psd';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'jpeg', 'webp', 'psd'];
export const FORMAT_INFO: Record<ExportFormat, { label: string; mime: string; ext: string; lossy: boolean }> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
  psd: { label: 'PSD', mime: 'image/vnd.adobe.photoshop', ext: 'psd', lossy: false },
};
/** `masks` counts layers with a mask (optional, so older callers keep working). */
export interface DocFacts { layers: number; hidden: number; transparent: boolean; masks?: number; }
export type LossId = 'layers' | 'hidden' | 'structure' | 'transparency' | 'quality';
export interface Loss { id: LossId; text: string; keptBy: ExportFormat; }
export interface LossReport { format: ExportFormat; losses: Loss[]; kept: string; suggest: ExportFormat | null; suggestText: string | null; }

export const docFacts = (doc: Doc): DocFacts => ({
  layers: doc.layers.length, hidden: doc.layers.filter((l) => !l.visible).length, transparent: compositeHasTransparency(doc),
  ...(doc.layers.some((l) => l.mask) ? { masks: doc.layers.filter((l) => l.mask).length } : {}),
});
const pct = (q: number): number => Math.round(q * 100);
export function lossReport(f: DocFacts, format: ExportFormat, quality = 0.92): LossReport {
  const losses: Loss[] = [];
  if (format !== 'psd') {
    if (f.layers > 1) losses.push({ id: 'layers', keptBy: 'psd', text: `Your ${f.layers} layers are merged into one flat picture, so you can't change them one by one in this file.` });
    if ((f.masks ?? 0) > 0) losses.push({ id: 'structure', keptBy: 'psd', text: f.masks === 1 ? "Your mask is drawn into one flat picture, so you can't change it later in this file." : "Your masks are drawn into one flat picture, so you can't change them later in this file." });
    if (f.hidden > 0) losses.push({ id: 'hidden', keptBy: 'psd', text: f.hidden === 1 ? 'The hidden layer is left out.' : `The ${f.hidden} hidden layers are left out.` });
  }
  if (format === 'jpeg' && f.transparent) losses.push({ id: 'transparency', keptBy: 'png', text: "See-through areas turn white, because JPEG can't store transparency." });
  // Chrome writes lossless WebP (VP8L) at quality 1; the web app checks the real output and says so if a browser differs.
  if (format === 'jpeg' || (format === 'webp' && quality < 1)) {
    losses.push({ id: 'quality', keptBy: 'png', text: quality >= 1
      ? 'JPEG still drops a little fine detail, even at full quality.'
      : `Some fine detail is dropped to make the file smaller (quality ${pct(quality)}%).` });
  }
  const psdKeeps = (f.masks ?? 0) > 0 ? 'PSD keeps every layer with its mask, name, order, visibility, opacity and blend mode.'
    : 'PSD keeps every layer with its name, order, visibility, opacity and blend mode.';
  const suggest: ExportFormat | null = losses.some((l) => l.keptBy === 'psd') ? 'psd' : losses.length ? 'png' : null;
  const suggestText = suggest === 'psd' ? psdKeeps
    : suggest === 'png' ? (f.transparent ? 'PNG keeps every pixel exactly, transparency included.' : 'PNG keeps every pixel exactly.') : null;
  const keeps: Record<ExportFormat, string> = {
    psd: psdKeeps,
    png: 'PNG keeps every pixel exactly, transparency included.',
    webp: quality >= 1 ? 'WebP at 100% quality keeps every pixel, transparency included.' : 'WebP keeps transparency and makes small files.',
    jpeg: 'JPEG makes small files that open everywhere.',
  };
  const kept = losses.length ? keeps[format] : 'Nothing is lost. ' + keeps[format];
  return { format, losses, kept, suggest, suggestText };
}
