// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * What the command line and the MCP server share: open a picture, change it with the engine exactly as the web app
 * does, and save it with the credit. Nothing here prints: callers decide what to say (the MCP server's stdout is
 * reserved for its protocol).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FORMAT_INFO, activeLayer, commitResult, compositeHasTransparency, cropDocument, docFacts, editRegion, flatten, flattenDocument,
  innerOf, jobPadding, lossReport, mergeDown, mergeVisible, paddedRegion, parseHex, readRegion, resizeBitmap, resizeDocument, runJob,
  trimDocument, turnDocument, turnLayer, type Bitmap, type Doc, type JobParams, type JobSpec, type Layer, type Rect, type Resample,
  type Turn } from '@free-photoeditor/core';
import { runEffect } from '@free-photoeditor/core/fx';
import { resolveParams, type Operation, type SettingValue } from './catalog';
import { FORMAT_NAMES, WRITE_FORMATS, decodeImage, encodeImage, previewPng, tooBig, type ReadFormat, type WriteFormat } from './codecs';

export const DEFAULT_MAX_PIXELS = 64_000_000;
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export interface Picture { doc: Doc; format: ReadFormat; notes: string[]; credit: string | null; file: string; fileBytes: number; }

export async function openPicture(file: string, maxPixels = DEFAULT_MAX_PIXELS): Promise<Picture> {
  let st;
  try { st = await fs.stat(file); } catch { throw new Error(`There is no file at ${file}.`); }
  if (!st.isFile()) throw new Error(`${file} is a folder, not a picture file.`);
  if (st.size > MAX_FILE_BYTES) throw new Error(`${path.basename(file)} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB, the most the editor opens.`);
  const bytes = new Uint8Array(await fs.readFile(file));
  return { ...(await decodeImage(bytes, maxPixels)), file, fileBytes: bytes.length };
}

/** Layers by name, by number from the top (1 = the top layer, as the Layers list shows them), or "all". Default: the active (top) layer. */
export function pickLayers(doc: Doc, which?: string | number): Layer[] {
  if (which === undefined || which === '') { const l = activeLayer(doc); return l ? [l] : []; }
  const s = String(which).trim();
  if (s.toLowerCase() === 'all') return doc.layers.slice();
  if (/^\d+$/.test(s)) {
    const n = Number(s), l = doc.layers[doc.layers.length - n];
    if (n >= 1 && l) return [l];
    throw new Error(`There is no layer ${n}: this picture has ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}, numbered from the top.`);
  }
  const named = doc.layers.filter((l) => l.name.toLowerCase() === s.toLowerCase());
  if (named.length) return [named[named.length - 1]];
  throw new Error(`No layer is called "${s}". The layers are: ${doc.layers.slice().reverse().map((l) => `"${l.name}"`).join(', ')}.`);
}
export const layerList = (doc: Doc) => doc.layers.slice().reverse().map((l, i) => ({
  number: i + 1, name: l.name, visible: l.visible, opacity: Math.round(l.opacity * 100), blendMode: l.blendMode,
  x: l.x, y: l.y, width: l.width, height: l.height, active: l.id === doc.activeId , ...(l.mask ? { mask: l.mask.enabled ? 'on' : 'off' } : {}) }));

export function colorNumber(hex: string | undefined, fallback: string): number {
  const c = parseHex(hex ?? fallback);
  if (!c) throw new Error(`"${hex}" is not a colour. Use a hex colour such as #ff8800.`);
  return (c.r << 16) | (c.g << 8) | c.b;
}
export function parseArea(s: string): Rect {
  const n = s.split(/[\s,x×]+/).filter(Boolean).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) throw new Error(`"${s}" is not an area. Give four numbers: x,y,width,height (for example 0,0,800,600).`);
  return checkArea({ x: n[0], y: n[1], w: n[2], h: n[3] });
}
export function checkArea(r: Rect): Rect {
  const a = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  if (a.w < 1 || a.h < 1) throw new Error('An area needs a width and a height of at least 1 pixel.');
  return a;
}

export interface EditTarget { layer?: string | number; area?: Rect | null; }
export interface Colors { main?: string; second?: string; }
/**
 * Run an adjustment or filter the way the web app's dialog does: settings from the dialog's controls, the working area
 * padded by how far the effect reads, the edited box and the two colours passed to effects, then the engine's own job.
 */
export function applyOperation(doc: Doc, op: Operation, settings: Record<string, SettingValue> = {}, target: EditTarget = {}, colors: Colors = {}): Layer[] {
  const params = resolveParams(op, settings), layers = pickLayers(doc, target.layer), def = op.def;
  const fg = colorNumber(colors.main, '#000000'), bg = colorNumber(colors.second, '#ffffff');
  const most: JobParams = {};
  for (const c of def.controls) most[c.key] = !c.type || c.type === 'range' ? c.max ?? c.value : c.value;
  const pad = jobPadding({ op: def.op, kind: def.kind, params: most }), keep = doc.selection;
  doc.selection = target.area ? checkArea(target.area) : null;
  try {
    for (const l of layers) {
      const reg = editRegion(doc, l);
      if (!reg) throw new Error(`The area is outside the layer "${l.name}".`);
      const padded = paddedRegion(l, reg, pad), p: JobParams = { ...params };
      if (def.op === 'fx') { p.ix = reg.x - padded.x; p.iy = reg.y - padded.y; p.iw = reg.w; p.ih = reg.h; }
      if (def.colors) { p.fg = fg; p.bg = bg; }
      const spec: JobSpec = { op: def.op, kind: def.kind, params: p }, src: Bitmap = { width: padded.w, height: padded.h, data: readRegion(l, padded) };
      const res = def.op === 'fx' ? runEffect(spec, src) : runJob(spec, src);
      commitResult(doc, l, reg, readRegion(l, reg), innerOf(res, padded, reg), op.plain);
    }
  } finally { doc.selection = keep; }
  return layers;
}

export interface SizeRequest { width?: number; height?: number; scale?: number; mode?: Resample; }
/** Picture size: one side keeps the proportions; scale is a percentage. */
export function resizePicture(doc: Doc, r: SizeRequest, maxPixels = DEFAULT_MAX_PIXELS): void {
  for (const [k, v] of Object.entries({ width: r.width, height: r.height, scale: r.scale })) {
    if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw new Error(`The ${k} must be a number above 0.`);
  }
  let w = r.width, h = r.height;
  if (r.scale !== undefined) { w = (doc.width * r.scale) / 100; h = (doc.height * r.scale) / 100; }
  else if (w && !h) h = (doc.height * w) / doc.width;
  else if (h && !w) w = (doc.width * h) / doc.height;
  if (!w || !h) throw new Error('Give a new width, a new height, or a scale such as 50 (per cent).');
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (w * h > maxPixels) throw tooBig(maxPixels);
  resizeDocument(doc, w, h, r.mode ?? 'smooth');
}
/** The biggest centred area with this shape, such as 1:1 for a square or 9:16 for a story. */
export function aspectArea(doc: Doc, aspect: string): Rect {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x/×]\s*(\d+(?:\.\d+)?)\s*$/.exec(aspect);
  if (!m || !+m[1] || !+m[2]) throw new Error(`"${aspect}" is not a shape. Use width:height, such as 1:1, 4:5 or 16:9.`);
  const k = +m[1] / +m[2];
  let w = doc.width, h = Math.round(w / k);
  if (h > doc.height) { h = doc.height; w = Math.max(1, Math.round(h * k)); }
  return { x: Math.floor((doc.width - w) / 2), y: Math.floor((doc.height - h) / 2), w, h: Math.max(1, h) };
}
export interface CropRequest { area?: Rect; aspect?: string; trim?: boolean; }
export function cropPicture(doc: Doc, c: CropRequest): string[] {
  if (c.trim) return trimDocument(doc) ? [] : ['There were no empty edges to cut away.'];
  const area = c.aspect ? aspectArea(doc, c.aspect) : c.area ? checkArea(c.area) : null;
  if (!area) throw new Error('Say which part to keep: an area (x,y,width,height), a shape such as 1:1, or trim.');
  if (!cropDocument(doc, area)) throw new Error('That area is outside the picture.');
  return [];
}
export const TURNS: Record<string, Turn> = { right: 'cw', cw: 'cw', '90': 'cw', left: 'ccw', ccw: 'ccw', '-90': 'ccw', '270': 'ccw', '180': '180', half: '180' };
export const FLIPS: Record<string, Turn> = { horizontal: 'flip-h', h: 'flip-h', 'left-right': 'flip-h', mirror: 'flip-h', vertical: 'flip-v', v: 'flip-v', 'top-bottom': 'flip-v', 'upside-down': 'flip-v' };
export function turnPicture(doc: Doc, t: Turn, layer?: string | number): void {
  if (layer === undefined || layer === '') { turnDocument(doc, t); return; }
  for (const l of pickLayers(doc, layer)) { doc.activeId = l.id; turnLayer(doc, t); }
}
export function mergeLayers(doc: Doc, layer?: string | number): string {
  if (layer === undefined || layer === '') {
    if (!mergeVisible(doc)) throw new Error('There is nothing to merge: fewer than two layers are shown.');
    return 'Every shown layer was merged into one.';
  }
  const [l] = pickLayers(doc, layer);
  doc.activeId = l.id;
  if (!mergeDown(doc)) throw new Error(`"${l.name}" is the bottom layer, so there is no layer below to merge it into.`);
  return `"${l.name}" was merged into the layer below it.`;
}
export function flattenLayers(doc: Doc, background = '#ffffff'): string {
  const bg = background.toLowerCase() === 'transparent' || background.toLowerCase() === 'none' ? null : parseHex(background);
  if (bg === undefined || (bg === null && !/^(transparent|none)$/i.test(background))) throw new Error(`"${background}" is not a colour. Use a hex colour or transparent.`);
  return flattenDocument(doc, bg) ? 'Every layer was combined into one.' : 'The picture already has one layer.';
}
/** Keep only one layer, shown: for saving a single layer of a PSD as its own file. */
export function keepOnlyLayer(doc: Doc, which: string | number): string {
  const [l] = pickLayers(doc, which);
  doc.layers = [{ ...l, visible: true }];
  doc.activeId = l.id;
  return `Only the layer "${l.name}" was kept.`;
}

export const EXT_FORMAT: Record<string, WriteFormat> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', psd: 'psd' };
export function parseFormat(s: string): WriteFormat {
  const f = EXT_FORMAT[s.trim().toLowerCase().replace(/^\./, '')];
  if (!f) throw new Error(`"${s}" is not a file type the editor saves. Use png, jpeg, webp or psd.`);
  return f;
}
export interface OutputPlan { output?: string; outDir?: string; to?: string; suffix?: string; cwd: string; many?: boolean; }
/**
 * Where a result goes and in which type. A named output decides the type by its ending; otherwise the result sits next
 * to the original (or in the output folder) with a suffix, in the original's type when the editor can save it, else PNG.
 */
export function planOutput(input: string, inputFormat: ReadFormat, o: OutputPlan): { file: string; format: WriteFormat } {
  const base = path.basename(input).replace(/\.[^.]+$/, '') || 'image';
  const to = o.to ? parseFormat(o.to) : undefined;
  if (o.output) {
    if (o.many && !o.output.includes('{name}')) throw new Error('With more than one picture, put {name} in the output name (for example out/{name}.png) or use an output folder.');
    const file = path.resolve(o.cwd, o.output.replace(/\{name\}/g, base)), ext = path.extname(file).slice(1).toLowerCase(), byExt = EXT_FORMAT[ext];
    if (!byExt) throw new Error(`The output name must end in .png, .jpg, .webp or .psd (not "${path.basename(file)}").`);
    if (to && to !== byExt) throw new Error(`The output name ends in .${ext} but the type asked for is ${FORMAT_NAMES[to]}. Make them match.`);
    return { file, format: byExt };
  }
  const format = to ?? ((WRITE_FORMATS as readonly string[]).includes(inputFormat) ? (inputFormat as WriteFormat) : 'png');
  const name = `${base}${o.suffix && !o.outDir ? '-' + o.suffix : ''}.${FORMAT_INFO[format].ext}`;
  return { file: path.join(o.outDir ? path.resolve(o.cwd, o.outDir) : path.dirname(path.resolve(o.cwd, input)), name), format };
}

/** Write through a fresh temporary file and a rename, so an existing link at the target is replaced, never followed. */
export async function writeFileSafely(file: string, bytes: Uint8Array, overwrite = false): Promise<void> {
  const exists = await fs.lstat(file).then(() => true, () => false);
  if (exists && !overwrite) throw new Error(`${file} already exists, so nothing was replaced. Choose another output name, or allow overwriting (--overwrite on the command line, overwrite: true for agents).`);
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.part`);
  await fs.writeFile(tmp, bytes, { flag: 'wx' });
  try { await fs.rename(tmp, file); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
}
export const normQuality = (q?: number): number => (q === undefined || !Number.isFinite(q) ? 0.92 : q > 1 ? Math.min(100, q) / 100 : Math.max(0.01, q));

export interface Saved { output: string; format: WriteFormat; width: number; height: number; layers: number; bytes: number; notes: string[]; }
/** Save with the credit in the file, and say in plain words what this file type loses for this picture. */
export async function savePicture(doc: Doc, file: string, format: WriteFormat, o: { quality?: number; overwrite?: boolean } = {}): Promise<Saved> {
  const quality = normQuality(o.quality), report = lossReport(docFacts(doc), format, quality);
  const bytes = await encodeImage(doc, format, quality);
  await writeFileSafely(file, bytes, o.overwrite);
  return { output: file, format, width: doc.width, height: doc.height, layers: format === 'psd' ? doc.layers.length : 1, bytes: bytes.length,
    notes: report.losses.map((l) => l.text) };
}
export function describePicture(p: Picture) {
  const d = p.doc;
  return { file: p.file, format: p.format, type: FORMAT_NAMES[p.format], width: d.width, height: d.height, megapixels: +((d.width * d.height) / 1e6).toFixed(2),
    fileBytes: p.fileBytes, transparent: compositeHasTransparency(d), layers: layerList(d), madeWith: p.credit, notes: p.notes };
}
/** A preview at most `max` pixels on its long side, scaled by the engine. */
export async function previewOf(doc: Doc, max = 512): Promise<Uint8Array> {
  const flat = flatten(doc), k = Math.min(1, max / Math.max(flat.width, flat.height));
  const w = Math.max(1, Math.round(flat.width * k)), h = Math.max(1, Math.round(flat.height * k));
  return previewPng(k < 1 ? { width: w, height: h, data: resizeBitmap(flat, w, h) } : flat);
}
