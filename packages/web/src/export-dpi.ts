// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Export's "Print quality · Resolution (DPI/PPI)" section, on its own so the Task ribbon can host it later as it is.
 * The person picks the DPI (72 for screens, 300 for print, 500, 600 or any number) and sees the print size it gives.
 * Either every pixel stays and only the DPI is stored (the print size changes), or a copy is resampled to a print size
 * at that DPI. DPI alone never adds detail. "Best quality" saves lossy types at their top setting (a JPEG keeps every
 * colour pixel, 4:4:4). The plain helpers come first and run in Node; the panel touches `document` only when built.
 */
import {
  DPI_PICKS, MAX_DPI, MIN_DPI, PRINT_UNITS, docDpi, fromInches, isDpi, printSize, printTarget, resizeDocument, roundDpi, toInches,
  type Command, type Doc, type PrintRequest, type PrintUnit, type Resample,
} from '@free-photoeditor/core';
import { focusInSheet, h } from './dom';

/** Types with a place for the DPI in the file. GIF, ICO, TGA, SVG and OpenRaster have none. */
const HOLDS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp', 'psd', 'tiff', 'pdf', 'bmp', 'avif', 'jxl']);
/** Types that always keep every pixel, so "Best quality" has nothing to change. */
const LOSSLESS: ReadonlySet<string> = new Set(['png', 'tiff', 'bmp', 'psd', 'tga', 'ora']);
/** The most pixels a side may have, as in Picture size. */
const MAX_SIDE = 16384;
/** Whether the saved file stores the DPI. Moving (animated) PNG and WebP files keep none yet. */
export const holdsDpi = (fmt: string, multi = false): boolean => HOLDS.has(fmt) && !(multi && (fmt === 'png' || fmt === 'webp'));
export const n2 = (x: number): string => String(Math.round(x * 100) / 100);
export const UNIT_LABEL: Record<PrintUnit, string> = { cm: 'cm', in: 'inches', mm: 'mm' };
/** "5.08 × 3.39 cm (2 × 1.33 in)": how big these pixels print at this DPI. */
export function printText(width: number, height: number, dpi: number): string {
  const p = printSize(width, height, dpi);
  return `${n2(p.cm[0])} × ${n2(p.cm[1])} cm (${n2(p.in[0])} × ${n2(p.in[1])} in)`;
}
/** The plain note for a type that cannot store a DPI, or null when it can. */
export function dpiNote(fmt: string, label: string, multi = false): string | null {
  if (holdsDpi(fmt, multi)) return null;
  if (HOLDS.has(fmt)) return `Moving ${label} files don't keep a DPI yet. Every pixel is saved; choose the print size when you print.`;
  return `${label} files have no place to store a DPI, so none is saved. Every pixel is kept; choose the print size when you print, or pick PNG, JPEG, TIFF or PDF.`;
}
/** What "Best quality" does for this type, in plain words. */
export function bestText(fmt: string, label: string, lossy: boolean): string {
  if (fmt === 'jpeg') return 'JPEG at its top setting (100%), keeping every colour pixel (4:4:4). The file is bigger.';
  if (lossy) return `${label} with no loss at all (lossless). The file is bigger.`;
  if (LOSSLESS.has(fmt)) return `${label} always keeps every pixel (lossless).`;
  return `${label} has no quality setting; the note above says what it keeps.`;
}
/** The pixel size for a print size at this DPI. With the shape kept, only the side the person typed counts. */
export function resizeTarget(w: number, hgt: number, unit: PrintUnit, dpi: number, cur: { width: number; height: number }, keep: 'w' | 'h' | null): { width: number; height: number } {
  const r: PrintRequest = keep === 'w' ? { width: w, unit } : keep === 'h' ? { height: hgt, unit } : { width: w, height: hgt, unit };
  return printTarget(r, dpi, cur);
}
/** A resampled copy for the export. The picture itself is untouched: the copy gets new layers and keeps the DPI. */
export function printCopy(doc: Doc, width: number, height: number, mode: Resample): Doc {
  const copy: Doc = { ...doc, layers: doc.layers.slice(), selection: null };
  resizeDocument(copy, width, height, mode);
  return copy;
}
/** Two steps as one undo step (Picture size: new pixels and a new DPI together). */
export function joinCommands(a: Command | null, b: Command | null): Command | null {
  if (!a || !b) return a ?? b;
  return { label: a.label, bytes: a.bytes + b.bytes, undo: (d) => { b.undo(d); a.undo(d); }, redo: (d) => { a.redo(d); b.redo(d); } };
}

export interface PrintChoice { dpi: number; resize: { width: number; height: number; mode: Resample } | null; best: boolean; }
export interface DpiPanel {
  readonly el: HTMLElement;
  /** Start from this picture: its own DPI, its print size, every pixel kept. Called each time Export opens. */
  reset(doc: Doc): void;
  /** Fit the section to the chosen type: the note for types without a DPI and what "Best quality" means for it. */
  render(fmt: string, label: string, lossy: boolean, multi: boolean): void;
  choice(): PrintChoice;
  setBest(on: boolean): void;
  focus(what: 'dpi' | 'best'): void;
  /** Why the export can't go ahead (a print size too large for this device), or null. */
  problem(): string | null;
}

/** Build the section. `onChange` runs after every change the person makes, so the dialog can update around it. */
export function buildDpiPanel(uid: string, onChange: () => void, maxPixels: number): DpiPanel {
  const id = `fpe-${uid}-dpi`;
  let dpi = 72, W = 1, H = 1, resize = false, unit: PrintUnit = 'cm', edited: 'w' | 'h' = 'w', best = false, lossy = false;
  let target = { width: 1, height: 1 };
  const chips = h('div', { class: 'fpe-chips', role: 'radiogroup', 'aria-label': 'Quick DPI picks' }, ...DPI_PICKS.map((p) =>
    h('button', { type: 'button', class: 'fpe-chip', role: 'radio', 'aria-checked': 'false', 'data-dpi': p.dpi, 'data-testid': `export-dpi-${p.dpi}`,
      'data-help-title': `${p.dpi} DPI`, 'data-help': `${p.dpi} pixels in each printed inch: for ${p.use}.`, onclick: () => { dpi = p.dpi; paint(true); } },
    p.dpi === 72 || p.dpi === 300 ? `${p.dpi} · ${p.use}` : String(p.dpi))));
  const any = h('input', { id: id + 'n', type: 'number', min: MIN_DPI, max: MAX_DPI, step: 'any', inputmode: 'decimal', 'data-testid': 'export-dpi-input' });
  any.addEventListener('input', () => {
    const v = Number(any.value), ok = any.value !== '' && isDpi(v);
    any.setAttribute('aria-invalid', String(!ok));
    if (ok) { dpi = roundDpi(v); paint(false); }
  });
  const size = h('p', { class: 'fpe-dpi-size', 'data-testid': 'export-print-size', 'aria-live': 'polite' });
  const radio = (v: 'keep' | 'resize', text: string, help: string): HTMLElement => {
    const r = h('input', { id: id + v, type: 'radio', name: id + 'mode', value: v, checked: v === 'keep', 'data-testid': 'export-dpi-' + v });
    r.addEventListener('change', () => { resize = v === 'resize'; paint(true); });
    return h('div', { class: 'fpe-check', 'data-help-title': text, 'data-help': help }, r, h('label', { for: id + v }, text));
  };
  const keepRadio = radio('keep', 'Keep every pixel, only set the DPI (changes the print size)', 'The picture is saved exactly as it is; the file says how many pixels go into each inch.');
  const resizeRadio = radio('resize', 'Resize to a print size at this DPI', 'A copy is redrawn with the pixels that print size needs. Your picture stays as it is.');
  const num = (k: 'w' | 'h', label: string): HTMLInputElement => {
    const el = h('input', { id: id + k, type: 'number', min: 0.01, step: 'any', inputmode: 'decimal', 'aria-label': label, 'data-testid': 'export-dpi-' + k });
    el.addEventListener('input', () => { edited = k; paint(true, k); });
    return el;
  };
  const pw = num('w', 'Print width'), ph = num('h', 'Print height');
  const unitSel = h('select', { id: id + 'u', 'aria-label': 'Unit', 'data-testid': 'export-dpi-unit' }, ...PRINT_UNITS.map((u) => h('option', { value: u }, UNIT_LABEL[u])));
  unitSel.addEventListener('change', () => {
    const old = unit;
    unit = unitSel.value as PrintUnit;
    for (const f of [pw, ph]) if (Number(f.value) > 0) f.value = n2(fromInches(toInches(Number(f.value), old), unit));
    paint(true);
  });
  const keep = h('input', { id: id + 'k', type: 'checkbox', checked: true, 'data-testid': 'export-dpi-shape' });
  keep.addEventListener('change', () => paint(true));
  const method = h('select', { id: id + 'm', 'data-testid': 'export-dpi-method' }, h('option', { value: 'smooth' }, 'Smooth (photos)'), h('option', { value: 'pixel' }, 'Hard pixels (pixel art)'));
  const px = h('p', { class: 'fpe-note', 'data-testid': 'export-dpi-pixels', 'aria-live': 'polite' });
  const fields = h('div', { class: 'fpe-dpi-resize', hidden: true },
    h('div', { class: 'fpe-row' }, h('label', { for: id + 'w' }, 'Print size'), pw, h('span', { class: 'fpe-out', 'aria-hidden': 'true' }, '×'), ph, unitSel),
    h('div', { class: 'fpe-check' }, keep, h('label', { for: id + 'k' }, 'Keep the shape')),
    h('div', { class: 'fpe-row', 'data-help-title': 'How to redraw', 'data-help': 'Smooth suits photos. Hard pixels keeps pixel art crisp.' }, h('label', { for: id + 'm' }, 'Redraw'), method),
    px);
  const note = h('p', { class: 'fpe-note', 'data-testid': 'export-dpi-note', hidden: true });
  const bestBox = h('input', { id: id + 'b', type: 'checkbox', 'data-testid': 'export-best' });
  bestBox.addEventListener('change', () => { best = bestBox.checked; onChange(); });
  const bestLine = h('span', { class: 'fpe-dpi-best-line' });
  const el = h('section', { class: 'fpe-dpi', 'data-testid': 'export-dpi', 'aria-labelledby': id + 't' },
    h('h3', { id: id + 't' }, 'Print quality · Resolution (DPI/PPI)'),
    h('p', { class: 'fpe-note' }, 'How many pixels go into one printed inch: 300 for print, 72 for screens. DPI alone never adds detail; it only sets how big the pixels print.'),
    chips,
    h('div', { class: 'fpe-row', 'data-help-title': 'Any DPI', 'data-help': `Type any number from ${MIN_DPI} to ${MAX_DPI}.` }, h('label', { for: id + 'n' }, 'Any DPI'), any),
    size, keepRadio, resizeRadio, fields, note,
    h('div', { class: 'fpe-check fpe-dpi-best' }, bestBox, h('label', { for: id + 'b' }, h('strong', {}, 'Best quality'), bestLine)));

  /** Redraw from the state. `rewrite` puts the DPI back in the number box; `typed` is the print side being typed. */
  function paint(rewrite: boolean, typed?: 'w' | 'h'): void {
    for (const c of chips.querySelectorAll<HTMLElement>('[data-dpi]')) {
      const on = Number(c.dataset.dpi) === dpi;
      c.setAttribute('aria-checked', String(on));
    }
    if (rewrite) { any.value = n2(dpi); any.setAttribute('aria-invalid', 'false'); }
    fields.hidden = !resize;
    let outW = W, outH = H;
    if (resize) {
      const a = Number(pw.value), b = Number(ph.value), k = keep.checked ? edited : null;
      if (k === 'w' ? a > 0 : k === 'h' ? b > 0 : a > 0 && b > 0) target = resizeTarget(a, b, unit, dpi, { width: W, height: H }, k);
      if (k === 'w' && typed !== 'h') ph.value = n2(fromInches(target.height / dpi, unit));
      if (k === 'h' && typed !== 'w') pw.value = n2(fromInches(target.width / dpi, unit));
      outW = target.width; outH = target.height;
      const more = outW * outH > W * H;
      px.dataset.px = `${outW}x${outH}`;
      px.textContent = `Becomes ${outW} × ${outH} pixels (now ${W} × ${H}).` +
        (more ? ' The new pixels are drawn in between the old ones: it looks smoother, never more detailed.' : '') +
        (problem() ? ' That is too many pixels for this device: pick a smaller size or a lower DPI.' : '');
    }
    const p = printSize(outW, outH, dpi);
    size.dataset.printCm = `${p.cm[0]}x${p.cm[1]}`;
    size.dataset.printIn = `${p.in[0]}x${p.in[1]}`;
    size.textContent = `At ${n2(dpi)} DPI this prints ${printText(outW, outH, dpi)}.`;
    onChange();
  }
  function problem(): string | null {
    if (!resize) return null;
    const { width, height } = target;
    return width > MAX_SIDE || height > MAX_SIDE || width * height > maxPixels ? 'That print size needs too many pixels for this device. Pick a smaller size or a lower DPI.' : null;
  }
  const later = (f: () => void): void => { requestAnimationFrame(() => requestAnimationFrame(f)); };
  return {
    el,
    reset(doc) {
      W = doc.width; H = doc.height; dpi = docDpi(doc); resize = false; edited = 'w';
      (keepRadio.querySelector('input') as HTMLInputElement).checked = true;
      pw.value = n2(fromInches(W / dpi, unit));
      ph.value = n2(fromInches(H / dpi, unit));
      target = { width: W, height: H };
      paint(true);
    },
    render(fmt, label, isLossy, multi) {
      lossy = isLossy;
      const n = dpiNote(fmt, label, multi);
      note.hidden = !n;
      note.textContent = n ?? '';
      el.dataset.holds = String(!n);
      bestBox.disabled = !lossy;
      bestBox.checked = lossy ? best : LOSSLESS.has(fmt);
      bestLine.textContent = bestText(fmt, label, lossy);
    },
    choice: () => ({ dpi, resize: resize ? { ...target, mode: method.value as Resample } : null, best: best && lossy }),
    setBest(on) { best = on; bestBox.checked = on; },
    focus(what) {
      const t = what === 'best' ? bestBox : any;
      later(() => focusInSheet(t));
    },
    problem,
  };
}
