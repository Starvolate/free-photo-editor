// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Automate and batch, loaded the first time one is used: Recorded steps (record what you do once, play it again on this
 * picture as one undo step), Edit many pictures the same way, Resize many pictures, and a Sheet of small photos.
 * Steps are recorded from the command bus (a function's id plus its settings), never from mouse positions, and every
 * step is played by one player (`playSteps`) that does exactly what the editor's own dialog does, so a played set gives
 * the same pixels as doing the steps by hand. Many-picture work holds one picture in memory at a time.
 * The pure parts (the player, names, sizes, the sheet's geometry) are exported for the unit tests.
 */
import { WHITE, activeLayer, addLayer, combineCommands, commitResult, createDocument, documentFromBitmap, editRegion, findLayer, flatten, flattenDocument, hasPixels,
  innerOf, jobPadding, mergeVisible, paddedRegion, parseHex, readRegion, resizeBitmap, resizeDocument, runJob, trimDocument, turnDocument, turnLayer,
  createLayer, type Bitmap, type Command, type Doc, type JobParams, type JobSpec, type RGBA, type Rect, type Turn } from '@free-photoeditor/core';
import { zipSync, type Zippable } from '@free-photoeditor/formats/zip';
import { ADJ, BATCH_IDS } from './commands';
import { BY_ID } from './registry';
import type { ToolHost } from './toolkit';
import { fmtBytes, h } from './dom';
import { OPEN_ACCEPT, baseName, download, encodeDocument, fmtInfo, maxPixelsForDevice, readImageFile, scaleBitmap } from './io';

/** One recorded step: the function's id and, for a dialog, its settings. */
export interface Step { id: string; p?: Record<string, number>; }
export interface StepSet { name: string; steps: Step[]; }
/** What the player needs from its surroundings: who runs heavy pixel work (the editor's worker) and the second colour. */
export interface Env { job(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray>; bg: RGBA; }
/** What the automate sheets need from the editor. */
export interface AutoHost extends ToolHost {
  job(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray>;
  openDoc(doc: Doc, name: string): void;
  fit(): void;
  /** Point the editor's command bus at a recorder, or at nothing. */
  record(fn: ((id: string, p?: JobParams) => void) | null): void;
}

// ---- The player ------------------------------------------------------------------------------------------------------
const TURNS: Record<string, Turn> = { 'image.rotate-cw': 'cw', 'image.rotate-ccw': 'ccw', 'image.rotate-180': '180', 'image.flip-h': 'flip-h', 'image.flip-v': 'flip-v' };
const LAYER_TURNS: Record<string, Turn> = { 'edit.flip-layer-h': 'flip-h', 'edit.flip-layer-v': 'flip-v', 'edit.rotate-layer-cw': 'cw', 'edit.rotate-layer-ccw': 'ccw',
  'edit.rotate-layer-180': '180' };
/** Functions without a dialog that a set can hold, each done the way its menu command does it. */
const PLAIN: Record<string, (d: Doc, env: Env) => Command | null> = {
  ...Object.fromEntries(Object.entries(TURNS).map(([id, t]) => [id, (d: Doc) => turnDocument(d, t)])),
  ...Object.fromEntries(Object.entries(LAYER_TURNS).map(([id, t]) => [id, (d: Doc) => { const l = activeLayer(d); return l && hasPixels(l) && !l.locked ? turnLayer(d, t) : null; }])),
  'image.trim': (d) => trimDocument(d),
  'layer.flatten': (d, e) => (d.layers.length > 1 ? flattenDocument(d, e.bg) : null),
  'layer.merge-visible': (d) => mergeVisible(d),
};
/** Commands that never change the picture, so recording passes them by without a note. */
const QUIET = /^(view|panel|help|window|tool|file)\.|^edit\.(undo|redo|history-|pref-)|^select\./;
export const isDialog = (id: string): boolean => !!ADJ[id] || BATCH_IDS.includes(id) || id === 'image.size';
export const canRecord = (id: string): boolean => isDialog(id) || id in PLAIN;
const plainName = (id: string): string => BY_ID.get(id)?.plain ?? id;
/** The engine for effects and the dialogs of the batch filters load on first use; the player waits for them. */
async function ready(id: string): Promise<void> { if (!ADJ[id] && BATCH_IDS.includes(id)) await import('./adj-more'); }
/** Heavy pixel work on this thread, for tests and when no worker is offered. */
export async function localJob(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray> {
  if (spec.op !== 'fx') return runJob(spec, src);
  const { runEffect } = await import('@free-photoeditor/core/fx');
  return runEffect(spec, src);
}

/** The new size for a recorded Picture size step: the same pixels on the picture it was recorded on, else the same longest side. */
export function sizeFor(w: number, hgt: number, p: Record<string, number>): { width: number; height: number } | null {
  let W: number, H: number;
  if (p.w && p.h && p.sw === w && p.sh === hgt) { W = p.w; H = p.h; }
  else {
    const long = p.long ?? Math.max(p.w ?? 0, p.h ?? 0);
    if (!(long > 0)) return null;
    const k = long / Math.max(w, hgt);
    if (p.shrink && k >= 1) return null;
    W = Math.max(1, Math.round(w * k)); H = Math.max(1, Math.round(hgt * k));
  }
  return W === w && H === hgt ? null : { width: W, height: H };
}

/** One dialog step on the active layer, exactly as the editor's dialog applies it (the selected area, the padding, the edited box). */
async function adjustStep(doc: Doc, s: Step, env: Env): Promise<Command | null | 'skip'> {
  const def = ADJ[s.id], l = activeLayer(doc);
  if (!def || !l || !hasPixels(l) || l.locked) return 'skip';
  const reg = editRegion(doc, l);
  if (!reg) return 'skip';
  const params: JobParams = {};
  for (const c of def.controls) params[c.key] = s.p?.[c.key] ?? c.value;
  const most: JobParams = {};
  for (const c of def.controls) most[c.key] = !c.type || c.type === 'range' ? c.max ?? c.value : c.value;
  const padded = paddedRegion(l, reg, jobPadding({ op: def.op, kind: def.kind, params: most }));
  if (def.op === 'fx') { params.ix = reg.x - padded.x; params.iy = reg.y - padded.y; params.iw = reg.w; params.ih = reg.h; }
  if (def.colors) { params.fg = s.p?.fg ?? 0; params.bg = s.p?.bg ?? 0xffffff; }
  const res = await env.job({ op: def.op, kind: def.kind, params }, { width: padded.w, height: padded.h, data: readRegion(l, padded) });
  const now = findLayer(doc, l.id);
  return now ? commitResult(doc, now, reg, readRegion(now, reg), innerOf(res, padded, reg), plainName(s.id)) : 'skip';
}

/**
 * Play a set's steps on a picture. Returns one command for the whole set (one undo step) and the plain names of the
 * steps that could not run here (for example an adjustment when the active layer is locked or holds no pixels).
 */
export async function playSteps(doc: Doc, steps: readonly Step[], env: Env, label = 'Recorded steps'): Promise<{ cmd: Command | null; skipped: string[] }> {
  const cmds: (Command | null)[] = [], skipped: string[] = [];
  for (const s of steps) {
    await ready(s.id);
    if (ADJ[s.id]) {
      const c = await adjustStep(doc, s, env);
      if (c === 'skip') skipped.push(plainName(s.id)); else cmds.push(c);
    } else if (s.id === 'image.size') {
      const t = sizeFor(doc.width, doc.height, s.p ?? {});
      if (t) cmds.push(resizeDocument(doc, t.width, t.height, 'smooth'));
    } else if (PLAIN[s.id]) cmds.push(PLAIN[s.id](doc, env));
    else skipped.push(plainName(s.id));
  }
  return { cmd: combineCommands(label, cmds), skipped };
}

/** A short plain line of a step's settings, such as "Strength 0.8, Edge width 1 px". */
export function stepText(s: Step): string {
  const name = plainName(s.id), p = s.p ?? {};
  if (s.id === 'image.size') {
    if (p.long) return `${name}: longest side ${p.long} px${p.shrink ? ', only smaller' : ''}`;
    return `${name}: ${p.w} × ${p.h} px`;
  }
  const def = ADJ[s.id];
  const bits = (def?.controls ?? []).filter((c) => p[c.key] !== undefined && p[c.key] !== c.value && c.key !== 'seed').slice(0, 3).map((c) => {
    const v = p[c.key] as number;
    if (c.type === 'check') return `${c.label} ${v ? 'on' : 'off'}`;
    if (c.type === 'select') return `${c.label}: ${c.options?.[v] ?? v}`;
    return `${c.label} ${Math.round(v * 100) / 100}${(c.unit ?? '').trim() ? ' ' + (c.unit ?? '').trim() : ''}`;
  });
  return bits.length ? `${name}: ${bits.join(', ')}` : name;
}

// ---- Saved sets --------------------------------------------------------------------------------------------------------
/** Ready-made sets, there on first use. */
export const STARTERS: StepSet[] = [
  { name: 'Web size and sharpen', steps: [{ id: 'image.size', p: { long: 1600, shrink: 1 } }, { id: 'filter.unsharp', p: { amount: 0.8, radius: 1, threshold: 2 } }] },
  { name: 'Black and white with grain', steps: [{ id: 'image.adj-bw' }, { id: 'filter.add-noise', p: { amount: 12, dist: 1, mono: 1, seed: 7 } }] },
];
const KEY = 'fpe-step-sets-1';
/** Saved sets from this browser (the starters when nothing is saved yet). Storage may be off: then the starters, unsaved. */
export function loadSets(store: Pick<Storage, 'getItem'> | null = safeStore()): StepSet[] {
  try {
    const raw = store?.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) return v.filter((x): x is StepSet => !!x && typeof x.name === 'string' && Array.isArray(x.steps))
        .map((x) => ({ name: x.name.slice(0, 80), steps: x.steps.filter((s) => s && typeof s.id === 'string' && canRecord(s.id)) }));
    }
  } catch { /* fall back to the starters */ }
  return STARTERS.map((s) => ({ name: s.name, steps: s.steps.map((x) => ({ ...x })) }));
}
export function saveSets(sets: StepSet[], store: Pick<Storage, 'setItem'> | null = safeStore()): boolean {
  try { store?.setItem(KEY, JSON.stringify(sets)); return !!store; } catch { return false; }
}
function safeStore(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
/** A name not yet taken: "My steps", then "My steps 2". */
export function freeName(want: string, sets: readonly StepSet[]): string {
  const base = want.trim().slice(0, 60) || 'My steps', taken = new Set(sets.map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

// ---- Recording ---------------------------------------------------------------------------------------------------------
interface Recording { name: string; steps: Step[]; passed: Set<string>; chip: HTMLElement | null; }
let rec: Recording | null = null;
/** What the command bus hands the recorder: dialog functions with their settings once applied, others as they run. */
export function recordStep(r: { steps: Step[]; passed: Set<string> }, id: string, p?: JobParams): void {
  if (isDialog(id)) {
    if (!p) return; // the dialog only opened; it is recorded when applied
    const keep: Record<string, number> = {};
    for (const [k, v] of Object.entries(p)) if (typeof v === 'number' && !['ix', 'iy', 'iw', 'ih'].includes(k)) keep[k] = v;
    if (id === 'image.size') keep.long = Math.max(keep.w ?? 0, keep.h ?? 0);
    r.steps.push({ id, p: keep });
  } else if (PLAIN[id]) r.steps.push({ id });
  else if (!QUIET.test(id)) r.passed.add(plainName(id));
}

// ---- Shared bits of the sheets -------------------------------------------------------------------------------------------
const bodies = new WeakMap<HTMLElement, Map<string, HTMLElement>>();
function sheetBody(host: AutoHost, id: string): HTMLElement {
  let m = bodies.get(host.root);
  if (!m) bodies.set(host.root, (m = new Map()));
  let b = m.get(id);
  if (!b) m.set(id, (b = h('div', { class: 'fpe-stack', 'data-testid': id + '-body' })));
  return b;
}
const btn = (text: string, primary: boolean, testid: string, onclick: () => void): HTMLButtonElement =>
  h('button', { type: 'button', class: 'fpe-btn ' + (primary ? 'fpe-btn-primary' : 'fpe-btn-ghost'), 'data-testid': testid, onclick }, text) as HTMLButtonElement;
const note = (text: string, testid?: string): HTMLElement => h('p', { class: 'fpe-note', ...(testid ? { 'data-testid': testid, role: 'status', 'aria-live': 'polite' } : {}) }, text);
const envOf = (host: AutoHost): Env => ({ job: (s, b) => host.job(s, b), bg: parseHex(host.bg()) ?? WHITE });
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A "Choose pictures" button with its own file input; the person may pick many at once. */
function picker(id: string): { el: HTMLElement; files(): File[] } {
  const input = h('input', { type: 'file', multiple: '', accept: OPEN_ACCEPT, hidden: true, 'data-testid': id + '-files' }) as HTMLInputElement;
  const said = note('No pictures picked yet.', id + '-picked');
  let files: File[] = [];
  input.addEventListener('change', () => {
    files = Array.from(input.files ?? []);
    said.textContent = files.length ? `${plural(files.length, 'picture')} picked: ${files.slice(0, 3).map((f) => f.name).join(', ')}${files.length > 3 ? '…' : ''}` : 'No pictures picked yet.';
  });
  return { el: h('div', { class: 'fpe-stack' }, input, btn('Choose pictures…', false, id + '-pick', () => input.click()), said), files: () => files };
}
function field(label: string, control: HTMLElement): HTMLElement { return h('label', { class: 'fpe-field' }, h('span', {}, label), control); }
function choice(testid: string, options: [string, string][], value = options[0][0]): HTMLSelectElement {
  const s = h('select', { 'data-testid': testid }, ...options.map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
  s.value = value;
  return s;
}
const num = (testid: string, value: number, min: number, max: number): HTMLInputElement =>
  h('input', { type: 'number', inputmode: 'numeric', min: String(min), max: String(max), step: '1', value: String(value), 'data-testid': testid }) as HTMLInputElement;
const FORMATS: [string, string][] = [['jpeg', 'JPEG (small files, for photos)'], ['png', 'PNG (exact, keeps see-through parts)'], ['webp', 'WebP (small files, for the web)']];

// ---- Many pictures, one at a time -------------------------------------------------------------------------------------------
/** Result names in the order the pictures were picked: the picture's name with the new type, "(2)" added when two clash. */
export function outputNames(names: readonly string[], ext: string): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = baseName(n);
    let out = `${base}.${ext}`;
    for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base} (${i}).${ext}`;
    used.add(out.toLowerCase());
    return out;
  });
}
/** Open one picture file as a picture, without asking anything; very large pictures get a smaller copy that fits this device. */
export async function openQuietly(file: Blob, name: string): Promise<{ doc: Doc; smaller: boolean } | null> {
  const o = await readImageFile(file, name, { choose: async () => true });
  if (o.kind === 'none') return null;
  if (o.kind === 'doc') return { doc: o.doc, smaller: false };
  if (o.kind === 'psd') { const { readPsdDocument } = await import('@free-photoeditor/core/psd'); return { doc: readPsdDocument(o.bytes).doc, smaller: false }; }
  let bmp = o.bitmap, smaller = false;
  const max = maxPixelsForDevice();
  if (bmp.width * bmp.height > max) {
    const k = Math.sqrt(max / (bmp.width * bmp.height));
    bmp = scaleBitmap(bmp, Math.max(1, Math.floor(bmp.width * k)), Math.max(1, Math.floor(bmp.height * k)));
    smaller = true;
  }
  const doc = documentFromBitmap(bmp);
  if (o.dpi) doc.dpi = o.dpi;
  return { doc, smaller };
}
export interface Batch { stop: boolean; }
export interface BatchResult { zip: Uint8Array | null; names: string[]; failed: string[]; smaller: string[]; stopped: boolean; }
/**
 * Open each picture, change it with `work`, save it in `format` and let it go before the next one. The results go into
 * one ZIP (stored as they are: they are already compressed). Cancel stops before the next picture and saves nothing.
 */
export async function runBatch(files: readonly File[], work: (doc: Doc) => Promise<void>, format: string, quality: number, ctl: Batch,
  progress: (i: number, n: number, name: string) => void): Promise<BatchResult> {
  const info = fmtInfo(format), out = outputNames(files.map((f) => f.name), info.ext), zipped: Zippable = {}, names: string[] = [], failed: string[] = [], smaller: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(i, files.length, files[i].name);
    await new Promise((r) => setTimeout(r, 0));
    if (ctl.stop) return { zip: null, names, failed, smaller, stopped: true };
    try {
      const o = await openQuietly(files[i], files[i].name);
      if (!o) { failed.push(files[i].name); continue; }
      if (o.smaller) smaller.push(files[i].name);
      await work(o.doc);
      const { blob } = await encodeDocument(o.doc, format, quality);
      zipped[out[i]] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      names.push(out[i]);
    } catch { failed.push(files[i].name); }
  }
  progress(files.length, files.length, '');
  return { zip: names.length ? zipSync(zipped) : null, names, failed, smaller, stopped: false };
}

/** The sheet shared by Edit many pictures and Resize many pictures: pick, choose, Start, a progress bar, Cancel. */
function manySheet(host: AutoHost, id: string, title: string, intro: string, extra: HTMLElement[], work: () => ((doc: Doc) => Promise<void>) | string, zipName: string): void {
  const b = sheetBody(host, id), pick = picker(id), format = choice(id + '-format', FORMATS), ctl: Batch = { stop: false };
  const bar = h('progress', { max: '1', value: '0', hidden: true, 'data-testid': id + '-progress', style: 'width:100%' }) as HTMLProgressElement;
  const status = note('', id + '-status');
  let busy = false;
  const cancel = btn('Cancel', false, id + '-cancel', () => { if (busy) { ctl.stop = true; status.textContent = 'Stopping after this picture…'; } else host.closeSheet(); });
  const start = btn('Start', true, id + '-start', () => void go());
  const go = async (): Promise<void> => {
    const files = pick.files(), w = work();
    if (!files.length) { status.textContent = 'Choose the pictures first.'; return; }
    if (typeof w === 'string') { status.textContent = w; return; }
    busy = true; ctl.stop = false; start.disabled = true; bar.hidden = false;
    const r = await runBatch(files, w, format.value, 0.9, ctl, (i, n, name) => {
      bar.max = n; bar.value = i;
      status.textContent = i < n ? `Working on ${i + 1} of ${n}: ${name}` : 'Making the ZIP…';
    });
    busy = false; start.disabled = false;
    if (r.stopped) { status.textContent = `Stopped after ${plural(r.names.length, 'picture')}. Nothing was saved.`; return; }
    const tail = (r.failed.length ? ` ${plural(r.failed.length, 'file')} could not be opened: ${r.failed.join(', ')}.` : '') +
      (r.smaller.length ? ` ${r.smaller.join(', ')} ${r.smaller.length === 1 ? 'was' : 'were'} too large for this device, so a smaller copy was used.` : '');
    if (!r.zip) { status.textContent = 'None of the files could be opened as pictures.' + tail; return; }
    const blob = new Blob([r.zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    download(blob, zipName, host.root);
    status.textContent = `Saved ${plural(r.names.length, 'picture')} in ${zipName} (${fmtBytes(blob.size)}).` + tail;
  };
  b.replaceChildren(note(intro), pick.el, ...extra, field('Save as', format), bar, status, h('div', { class: 'fpe-actions' }, cancel, start));
  host.sheet(id, title, b);
}

function batch(host: AutoHost): void {
  const sets = loadSets(), which = choice('file.batch-set', sets.map((s, i) => [String(i), `${s.name} (${plural(s.steps.length, 'step')})`]));
  manySheet(host, 'file.batch', 'Edit many pictures the same way',
    'Pick the pictures, pick a set of recorded steps, and get one ZIP of the results. Your pictures on this device are not changed, and nothing is uploaded.',
    [field('Steps to run', which)], () => {
      const s = sets[Number(which.value)];
      if (!s?.steps.length) return 'That set has no steps. Record some in Recorded steps first.';
      return async (doc) => { await playSteps(doc, s.steps, envOf(host), s.name); };
    }, 'Edited pictures.zip');
}

function resizeMany(host: AutoHost): void {
  const long = num('file.resize-many-long', 1600, 16, 16384), shrink = h('input', { type: 'checkbox', checked: '', 'data-testid': 'file.resize-many-shrink' }) as HTMLInputElement;
  manySheet(host, 'file.resize-many', 'Resize many pictures',
    'Every picture gets the same longest side, keeping its shape, and is saved in the type you pick. One ZIP comes back; nothing is uploaded.',
    [field('Longest side (px)', long), h('label', { class: 'fpe-check' }, shrink, h('span', {}, 'Only make pictures smaller (never blow up small ones)'))], () => {
      const n = Math.round(Number(long.value));
      if (!(n >= 16 && n <= 16384)) return 'The longest side must be a number from 16 to 16384 pixels.';
      const steps: Step[] = [{ id: 'image.size', p: { long: n, shrink: shrink.checked ? 1 : 0 } }];
      return async (doc) => { await playSteps(doc, steps, envOf(host)); };
    }, 'Resized pictures.zip');
}

// ---- Sheet of small photos (contact sheet) ------------------------------------------------------------------------------------
export interface SheetPlan { width: number; height: number; cell: number; cells: Rect[]; captions: Rect[]; }
export const CAPTION_H = 28;
/** Square cells in `cols` columns across a page `width` wide, `gap` apart and from the edges, a caption strip under each when asked. */
export function sheetLayout(n: number, cols: number, width: number, gap: number, captions: boolean): SheetPlan {
  const c = Math.max(1, Math.min(Math.round(cols), Math.max(1, n))), g = Math.max(0, Math.round(gap)), cap = captions ? CAPTION_H : 0;
  const cell = Math.max(8, Math.floor((width - g * (c + 1)) / c)), rows = Math.max(1, Math.ceil(n / c));
  const cells: Rect[] = [], caps: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const x = g + (i % c) * (cell + g), y = g + Math.floor(i / c) * (cell + cap + g);
    cells.push({ x, y, w: cell, h: cell });
    if (captions) caps.push({ x, y: y + cell, w: cell, h: cap });
  }
  return { width: Math.max(width, g + c * (cell + g)), height: g + rows * (cell + cap + g), cell, cells, captions: caps };
}
/** A picture `w` × `hgt` fitted inside a box, keeping its shape, centred. */
export function fitIn(w: number, hgt: number, box: Rect): Rect {
  const k = Math.min(box.w / w, box.h / hgt), fw = Math.max(1, Math.round(w * k)), fh = Math.max(1, Math.round(hgt * k));
  return { x: box.x + Math.floor((box.w - fw) / 2), y: box.y + Math.floor((box.h - fh) / 2), w: fw, h: fh };
}
/** Write a file name into a caption strip of the background (only where a browser can draw text). */
function caption(bg: { width: number; data: Uint8ClampedArray }, r: Rect, text: string): void {
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = r.w; c.height = r.h;
  const x = c.getContext('2d');
  if (!x) return;
  x.fillStyle = '#fff'; x.fillRect(0, 0, r.w, r.h);
  x.fillStyle = '#222'; x.font = '15px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let t = text;
  while (t.length > 1 && x.measureText(t).width > r.w - 8) t = t.slice(0, -2) + '…';
  x.fillText(t, r.w / 2, r.h / 2);
  const px = x.getImageData(0, 0, r.w, r.h).data;
  for (let y = 0; y < r.h; y++) bg.data.set(px.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * bg.width + r.x) * 4);
}
/** Build the sheet: a white page, each photo fitted into its cell as its own layer (named after its file), captions on the page. */
export async function buildSheet(files: readonly File[], cols: number, width: number, gap: number, captions: boolean,
  progress: (i: number, n: number) => void = () => undefined): Promise<{ doc: Doc; failed: string[] }> {
  const plan = sheetLayout(files.length, cols, width, gap, captions), doc = createDocument(plan.width, plan.height, WHITE), bg = doc.layers[0], failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(i, files.length);
    await new Promise((r) => setTimeout(r, 0));
    const o = await openQuietly(files[i], files[i].name).catch(() => null);
    if (!o) { failed.push(files[i].name); continue; }
    const flat = flatten(o.doc), r = fitIn(flat.width, flat.height, plan.cells[i]);
    addLayer(doc, createLayer(baseName(files[i].name), r.w, r.h, { data: resizeBitmap(flat, r.w, r.h), x: r.x, y: r.y }), doc.layers.length);
    if (captions) caption(bg, plan.captions[i], files[i].name);
  }
  return { doc, failed };
}

function contactSheet(host: AutoHost): void {
  const id = 'file.contact-sheet', b = sheetBody(host, id), pick = picker(id);
  const cols = num(id + '-cols', 4, 1, 12), width = num(id + '-width', 2400, 200, 12000), gap = num(id + '-gap', 24, 0, 400);
  const caps = h('input', { type: 'checkbox', checked: '', 'data-testid': id + '-captions' }) as HTMLInputElement;
  const status = note('', id + '-status');
  const make = btn('Make the sheet', true, id + '-make', () => void go());
  const go = async (): Promise<void> => {
    const files = pick.files(), c = Math.round(Number(cols.value)), w = Math.round(Number(width.value)), g = Math.round(Number(gap.value));
    if (!files.length) { status.textContent = 'Choose the pictures first.'; return; }
    if (!(c >= 1 && c <= 12 && w >= 200 && w <= 12000 && g >= 0 && g <= 400)) { status.textContent = 'Columns go from 1 to 12, the page width from 200 to 12000 px and the gap from 0 to 400 px.'; return; }
    const plan = sheetLayout(files.length, c, w, g, caps.checked);
    if (plan.width * plan.height > maxPixelsForDevice()) { status.textContent = 'That sheet would be too large for this device. Use fewer pictures, more columns or a narrower page.'; return; }
    make.disabled = true;
    const r = await buildSheet(files, c, w, g, caps.checked, (i, n) => { status.textContent = `Placing ${i + 1} of ${n}…`; });
    make.disabled = false;
    host.closeSheet();
    host.openDoc(r.doc, 'Sheet of small photos');
    host.toast(`Placed ${plural(files.length - r.failed.length, 'photo')}, each on its own layer.${r.failed.length ? ` Could not open: ${r.failed.join(', ')}.` : ''}`);
  };
  b.replaceChildren(note('Pick the photos. Each is fitted into a square cell, keeping its shape, on its own layer of one new picture, so you can still move any of them.'),
    pick.el, field('Columns', cols), field('Page width (px)', width), field('Gap between photos (px)', gap),
    h('label', { class: 'fpe-check' }, caps, h('span', {}, 'Write each file name under its photo')), status,
    h('div', { class: 'fpe-actions' }, btn('Cancel', false, id + '-cancel', () => host.closeSheet()), make));
  host.sheet(id, 'Sheet of small photos', b);
}

// ---- Recorded steps (the Actions sheet) ------------------------------------------------------------------------------------------
let chosen = 0;
function stopRecording(host: AutoHost, save: boolean): void {
  const r = rec;
  if (!r) return;
  rec = null;
  host.record(null);
  r.chip?.remove();
  if (save && r.steps.length) {
    const sets = loadSets(), name = freeName(r.name, sets);
    sets.push({ name, steps: r.steps });
    chosen = sets.length - 1;
    host.toast(saveSets(sets) ? `Saved "${name}" with ${plural(r.steps.length, 'step')}.` : `"${name}" is ready, but this browser would not keep it for next time.`);
  } else if (save) host.toast('Nothing was recorded: no step that changes the picture ran.');
}
function startRecording(host: AutoHost, name: string): void {
  stopRecording(host, false);
  const r: Recording = { name, steps: [], passed: new Set(), chip: null };
  rec = r;
  const chip = btn('Stop recording', true, 'rec-chip', () => stopRecording(host, true));
  chip.setAttribute('style', 'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:60;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.25)');
  const upd = (): void => { chip.textContent = `Stop recording (${plural(r.steps.length, 'step')})`; };
  upd();
  r.chip = chip;
  host.root.append(chip);
  host.record((id, p) => { if (rec === r) { recordStep(r, id, p); upd(); } });
  host.closeSheet();
  host.toast('Recording. Use the editor as usual; press Stop recording when you are done.');
}

function actions(host: AutoHost): void {
  const b = sheetBody(host, 'panel.actions'), sets = loadSets();
  if (chosen >= sets.length) chosen = 0;
  const draw = (): void => host.sheet('panel.actions', 'Recorded steps', b);
  const kids: Node[] = [];
  if (rec) {
    const r = rec;
    kids.push(note(`Recording "${r.name}": ${plural(r.steps.length, 'step')} so far.`, 'rec-status'),
      h('ol', { class: 'fpe-steps', 'data-testid': 'rec-steps' }, ...r.steps.map((s) => h('li', {}, stepText(s)))));
    if (r.passed.size) kids.push(note(`Not recorded, because they need your hands each time: ${[...r.passed].join(', ')}.`));
    kids.push(h('div', { class: 'fpe-actions' }, btn('Throw away', false, 'rec-cancel', () => { stopRecording(host, false); actions(host); }),
      btn('Stop and save', true, 'rec-stop', () => { stopRecording(host, true); actions(host); })));
  } else {
    const nameIn = h('input', { type: 'text', value: freeName('My steps', sets), maxlength: '60', 'data-testid': 'rec-name', 'aria-label': 'Name of the new set' }) as HTMLInputElement;
    kids.push(note('Record what you do once, then play it again on this picture, or on many pictures with Edit many pictures the same way. ' +
      'Adjustments, filters, Picture size, turning and flipping are recorded with their settings.'),
      h('div', { class: 'fpe-row' }, field('New set', nameIn), btn('Record', true, 'rec-start', () => startRecording(host, nameIn.value))));
    const list = h('div', { class: 'fpe-stack', role: 'radiogroup', 'aria-label': 'Saved sets', 'data-testid': 'set-list' });
    sets.forEach((s, i) => {
      const r = h('input', { type: 'radio', name: `fpe-${host.uid}-set`, value: String(i), 'data-testid': 'set-' + i }) as HTMLInputElement;
      r.checked = i === chosen;
      r.addEventListener('change', () => { chosen = i; actions(host); });
      list.append(h('label', { class: 'fpe-check' }, r, h('span', {}, h('strong', {}, s.name), ' · ', plural(s.steps.length, 'step'))));
    });
    kids.push(h('h3', { class: 'fpe-label' }, 'Saved sets'), sets.length ? list : note('No saved sets. Record one above.'));
    const cur = sets[chosen];
    if (cur) {
      kids.push(h('ol', { class: 'fpe-steps', 'data-testid': 'set-steps' }, ...cur.steps.map((s, j) => h('li', { class: 'fpe-row' }, h('span', {}, stepText(s)),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'step-delete-' + j, 'aria-label': `Delete step ${j + 1}: ${stepText(s)}`,
          onclick: () => { cur.steps.splice(j, 1); saveSets(sets); actions(host); } }, 'Delete')))));
      const status = note('', 'play-status');
      const play = btn('Play on this picture', true, 'set-play', () => void (async () => {
        const d = host.doc();
        if (!d) { status.textContent = 'Open or create a picture first.'; return; }
        play.disabled = true;
        status.textContent = 'Playing…';
        const w = d.width, hh = d.height, { cmd, skipped } = await playSteps(d, cur.steps, envOf(host), cur.name);
        play.disabled = false;
        if (cmd) { host.push(cmd, true); if (d.width !== w || d.height !== hh) host.fit(); }
        host.closeSheet();
        host.toast(`${cur.name}: done, as one step you can undo.${skipped.length ? ` Skipped here: ${skipped.join(', ')} (the active layer is locked or holds no pixels).` : ''}`);
      })());
      play.disabled = !host.doc() || !cur.steps.length;
      kids.push(status, h('div', { class: 'fpe-actions' },
        btn('Delete set', false, 'set-delete', () => { sets.splice(chosen, 1); chosen = 0; saveSets(sets); actions(host); }), play));
    }
  }
  b.replaceChildren(...kids);
  draw();
}

/** Run one of the automate functions. */
export function runAutomate(id: string, host: AutoHost): void {
  if (id === 'panel.actions') actions(host);
  else if (id === 'file.batch') batch(host);
  else if (id === 'file.resize-many') resizeMany(host);
  else if (id === 'file.contact-sheet') contactSheet(host);
}
