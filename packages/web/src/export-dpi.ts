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
  DPI_PICKS, MAX_DPI, MIN_DPI, PRINT_UNITS, docDpi, dpiForPrint, fromInches, isDpi, printPixels, printSize, printTarget, resizeDocument, roundDpi,
  setDocDpi, toInches, type Command, type Doc, type PrintRequest, type PrintUnit, type Resample,
} from '@free-photoeditor/core';
import { focusInSheet, h } from './dom';
import { HOLDS, UNIT_LABEL, holdsDpi, joinCommands, n2, printText } from './print-text';

export { UNIT_LABEL, holdsDpi, joinCommands, n2, printText };

/** Types that always keep every pixel, so "Best quality" has nothing to change. */
const LOSSLESS: ReadonlySet<string> = new Set(['png', 'tiff', 'bmp', 'psd', 'tga', 'ora']);
/** The most pixels a side may have, as in Picture size. */
const MAX_SIDE = 16384;
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

/** What Picture size needs from the editor. */
export interface SizeHost {
  toast(msg: string): void;
  /** Close the sheet and record a DPI-only change (the pixels stay). */
  setDpi(make: () => Command | null): void;
  /** Close the sheet, end any open session, record the resize, then refit the view. */
  resize(make: () => Command | null): void;
}
/** The fields Picture size shares with Canvas size, made by the editor's form. */
export interface SizeFields {
  fid: string;
  w: HTMLInputElement;
  hh: HTMLInputElement;
  keep: HTMLInputElement;
  note: HTMLElement;
  actions: (label: string, go: () => void) => HTMLElement;
}
/**
 * Picture size's DPI half: Resolution (DPI), print size and unit, Resample and its Quality, the size presets, and Apply.
 * Resample on: the picture gets new pixels. Off: the pixels stay, and width, height and DPI change the print size only
 * (dpiForPrint), saved as one undoable step (setDocDpi). Lazy with Export's section, so the first screen stays small.
 */
export function sizeRows(d: Doc, f: SizeFields, host: SizeHost, maxPixels: number): { presets: HTMLElement; rows: Node[] } {
  const { fid, w, hh, keep, note } = f;
  let dpi = docDpi(d), unit: PrintUnit = 'cm';
  const dec = (k: string, label: string, help: string): HTMLInputElement => h('input', { id: fid + k, type: 'number', min: 0.01, step: 'any', inputmode: 'decimal',
    'data-testid': `size-${k}`, 'aria-label': label, 'data-help-title': label, 'data-help': help });
  const res = dec('dpi', 'Resolution in DPI', 'How many pixels go into one printed inch: 300 for print, 72 for screens.');
  res.value = n2(dpi);
  const pw = dec('pw', 'Print width', 'How wide the picture prints.'), ph = dec('ph', 'Print height', 'How tall the picture prints.');
  const unitSel = h('select', { id: fid + 'u', 'aria-label': 'Print unit', 'data-testid': 'size-unit' }, ...PRINT_UNITS.map((u) => h('option', { value: u }, UNIT_LABEL[u])));
  const resample = h('input', { id: fid + 's', type: 'checkbox', checked: true, 'data-testid': 'size-resample' });
  const px = (): [number, number] => [Math.max(1, Math.round(Number(w.value))), Math.max(1, Math.round(Number(hh.value)))];
  const showPrint = (): void => { const [W, H] = px(); pw.value = n2(fromInches(W / dpi, unit)); ph.value = n2(fromInches(H / dpi, unit)); };
  w.addEventListener('input', showPrint);
  hh.addEventListener('input', showPrint);
  res.addEventListener('input', () => {
    const v = Number(res.value);
    if (!isDpi(v)) return;
    dpi = roundDpi(v);
    // Resample on keeps the print size, so the pixels follow; off keeps the pixels, so the print size follows.
    if (resample.checked) { w.value = String(printPixels(Number(pw.value), unit, dpi)); hh.value = String(printPixels(Number(ph.value), unit, dpi)); } else showPrint();
  });
  const fromPrint = (side: 'w' | 'h'): void => {
    const v = Number((side === 'w' ? pw : ph).value), [W, H] = px();
    if (!(v > 0)) return;
    if (resample.checked) {
      const a = side === 'w' ? w : hh, b = side === 'w' ? hh : w, na = side === 'w' ? d.width : d.height, nb = side === 'w' ? d.height : d.width;
      a.value = String(printPixels(v, unit, dpi));
      if (keep.checked) b.value = String(Math.max(1, Math.round((Number(a.value) * nb) / na)));
      (side === 'w' ? ph : pw).value = n2(fromInches(Number(b.value) / dpi, unit));
    } else {
      const nd = dpiForPrint(side === 'w' ? W : H, v, unit);
      if (!isDpi(nd)) return;
      dpi = nd;
      res.value = n2(dpi);
      (side === 'w' ? ph : pw).value = n2(fromInches((side === 'w' ? H : W) / dpi, unit));
    }
  };
  pw.addEventListener('input', () => fromPrint('w'));
  ph.addEventListener('input', () => fromPrint('h'));
  unitSel.addEventListener('change', () => { unit = unitSel.value as PrintUnit; showPrint(); });
  const mode = h('select', { id: fid + 'm', 'data-testid': 'size-mode' }, h('option', { value: 'smooth' }, 'Smooth (photos)'), h('option', { value: 'pixel' }, 'Hard pixels (pixel art)'));
  const modeRow = h('div', { class: 'fpe-row', 'data-help-title': 'Quality', 'data-help': 'Smooth suits photos. Hard pixels keeps pixel art crisp.' }, h('label', { for: fid + 'm' }, 'Quality'), mode);
  const presets = h('div', { class: 'fpe-chips' }, ...([['Half', 0.5], ['1080 wide', 1080 / d.width], ['1920 wide', 1920 / d.width], ['Double', 2]] as const).map(([label, k]) =>
    h('button', { type: 'button', class: 'fpe-chip', onclick: () => { w.value = String(Math.max(1, Math.round(d.width * k))); hh.value = String(Math.max(1, Math.round(d.height * k))); showPrint(); } }, label)));
  const apply = (): void => {
    const nd = Number(res.value);
    if (!isDpi(nd)) { host.toast('The DPI must be a number from 1 to 10000, for example 300.'); return; }
    if (!resample.checked) {
      host.setDpi(() => setDocDpi(d, nd));
      const k = docDpi(d);
      host.toast(`The pixels stay ${d.width} × ${d.height}. At ${n2(k)} DPI the picture prints ${printText(d.width, d.height, k)}.`);
      return;
    }
    const W = Math.round(Number(w.value)), H = Math.round(Number(hh.value));
    if (!(W >= 1 && H >= 1 && W <= MAX_SIDE && H <= MAX_SIDE)) { host.toast('Width and height must be between 1 and 16384 pixels.'); return; }
    if (W * H > maxPixels) { host.toast('That size is too large for this device.'); return; }
    const before = docDpi(d);
    host.resize(() => joinCommands(resizeDocument(d, W, H, mode.value as Resample), setDocDpi(d, nd)));
    const k = docDpi(d);
    host.toast(`Picture is now ${d.width} × ${d.height} px.${k !== before ? ` At ${n2(k)} DPI it prints ${printText(d.width, d.height, k)}.` : ''}`);
  };
  const act = f.actions('Resize', apply), goBtn = act.lastElementChild as HTMLElement;
  resample.addEventListener('change', () => {
    const on = resample.checked;
    if (!on) { w.value = String(d.width); hh.value = String(d.height); keep.checked = true; showPrint(); }
    w.disabled = hh.disabled = keep.disabled = !on;
    for (const b of presets.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !on;
    modeRow.hidden = !on;
    goBtn.textContent = on ? 'Resize' : 'Set the DPI';
    note.textContent = on ? `Now ${d.width} × ${d.height} px. The picture is redrawn to the new size.`
      : `Now ${d.width} × ${d.height} px. The pixels stay as they are: only the DPI and the print size change. DPI alone never adds detail.`;
  });
  showPrint();
  return {
    presets,
    rows: [h('div', { class: 'fpe-check' }, keep, h('label', { for: fid + 'k' }, 'Keep the shape (width and height change together)')),
      h('div', { class: 'fpe-row' }, h('label', { for: fid + 'dpi' }, 'Resolution (DPI)'), res),
      h('div', { class: 'fpe-row fpe-size-print' }, h('label', { for: fid + 'pw' }, 'Print size'), pw, h('span', { class: 'fpe-out', 'aria-hidden': 'true' }, '×'), ph, unitSel),
      h('div', { class: 'fpe-check', 'data-help-title': 'Resample', 'data-help': 'On: the picture gets more or fewer pixels. Off: the pixels stay; width, height and DPI change the print size only.' },
        resample, h('label', { for: fid + 's' }, 'Resample: change the number of pixels')),
      modeRow, act],
  };
}
