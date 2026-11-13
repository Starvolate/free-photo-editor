// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * More File commands, loaded the first time one is used: Open from a web link, Take a photo, Print, and Save each
 * layer as a file. Each opens the editor's own sheet (or saves one ZIP), so nothing happens behind the person's back:
 * the camera starts only after they picked Take a photo, and a web link is fetched only after they pressed Open.
 * The pure parts (names, sizes, plain messages) are exported for the unit tests.
 */
import { flatten, hasPixels, type Bitmap, type Doc } from '@free-photoeditor/core';
import { encodePng } from '@free-photoeditor/formats/png';
import { zipSync, type Zippable } from '@free-photoeditor/formats/zip';
import type { ToolHost } from './toolkit';
import { fmtBytes, h } from './dom';
import { baseName, download } from './io';
import { printText } from './print-text';

/** What the File extras need from the editor: the tool host, the picture's name, and opening a file in a new tab. */
export interface FileHost extends ToolHost { name(): string; open(file: Blob, name: string): Promise<void>; }

// ---- Open from a web link -------------------------------------------------------------------------------------------
export const URL_BLOCKED = 'This site does not let other web pages load its pictures (browsers call this rule CORS), so the editor cannot ' +
  'open it from here. Save the picture to your device, then open it with Open a photo.';
export const URL_OFFLINE = 'This device is offline. Connect to the internet, then try again.';
export const URL_PAGE = 'That link is a web page, not a picture. On the page, right-click the picture, pick "Copy image address" and paste that here.';
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/jxl': 'jxl' };

/** The address as typed, made whole ("example.com/a.png" gains https://); null when it cannot be a web address. */
export function checkUrl(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  if (!/^(https?|data|blob):/i.test(t)) t = 'https://' + t.replace(/^\/+/, '');
  try {
    const u = new URL(t);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return u.href;
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0 ? u.href : null;
  } catch { return null; }
}
/** A file name for a picture from the web: the last part of its address, with a type added from the answer when it has none. */
export function nameFromUrl(url: string, mime = ''): string {
  let last = '';
  try { const u = new URL(url); last = u.protocol === 'data:' ? '' : decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? ''); } catch { /* keep the default */ }
  last = last.replace(/[\\/:*?"<>|]+/g, '-').trim();
  const ext = MIME_EXT[mime.toLowerCase()];
  if (!last) return 'web picture' + (ext ? '.' + ext : '');
  return /\.[a-z0-9]{2,5}$/i.test(last) || !ext ? last : last + '.' + ext;
}
/** A plain sentence for a site's answer that is not a picture. */
export function statusText(status: number): string {
  if (status === 404 || status === 410) return `Nothing is at that address (the site answered ${status}). Check the link.`;
  if (status === 401 || status === 403) return `The site refused to share it (it answered ${status}). It may want you signed in there: save the picture from the site, then open it.`;
  return `The site answered ${status}, so the picture could not be loaded. Try again later.`;
}
/** Fetch a picture across the web. Only sites that allow sharing (CORS) work; every failure comes back as a plain sentence. */
export async function fetchPicture(url: string, get: typeof fetch = fetch): Promise<{ blob: Blob; name: string }> {
  let res: Response;
  try {
    res = await get(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error(typeof navigator !== 'undefined' && navigator.onLine === false ? URL_OFFLINE : URL_BLOCKED);
  }
  if (!res.ok) throw new Error(statusText(res.status));
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'text/html' || type === 'application/xhtml+xml') throw new Error(URL_PAGE);
  const blob = await res.blob();
  if (!blob.size) throw new Error('The site sent an empty file. Check the link.');
  return { blob, name: nameFromUrl(url, type) };
}

// ---- Print -----------------------------------------------------------------------------------------------------------
/** The size on paper in millimetres at the picture's print resolution (72 DPI when none is set), to tenths. */
export function printMm(width: number, height: number, dpi = 72): { w: number; h: number } {
  const k = 25.4 / (dpi > 0 ? dpi : 72), r = (v: number): number => Math.round(v * 10) / 10;
  return { w: r(width * k), h: r(height * k) };
}
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * The page the printer gets: the picture alone, either fitted to the paper (turned to landscape for wide pictures) or at
 * its real print size from the DPI.
 */
export function printHtml(src: string, title: string, width: number, height: number, mode: 'fit' | 'size', dpi = 72): string {
  const mm = printMm(width, height, dpi);
  const img = mode === 'fit' ? 'max-width:100%;max-height:100vh;width:auto;height:auto' : `width:${mm.w}mm;height:${mm.h}mm`;
  const page = mode === 'fit' ? `size:${width > height ? 'landscape' : 'portrait'};margin:10mm` : 'margin:10mm';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{${page}}html,body{margin:0;background:#fff}` +
    `img{display:block;margin:0 auto;${img}}</style></head><body><img alt="${esc(title)}" src="${esc(src)}"></body></html>`;
}

// ---- Save each layer as a file -----------------------------------------------------------------------------------------
/**
 * One picture per layer that has pixels (pixel, text and shape layers; folders, light-and-colour and colour layers have
 * none), each the canvas size with the layer in its place, its mask and opacity kept, hidden layers included. Names
 * start with the layer's place counted from the bottom, so they sort in stack order and never clash.
 */
export function layerFiles(doc: Doc): { name: string; bmp: Bitmap }[] {
  const out: { name: string; bmp: Bitmap }[] = [], n = doc.layers.length, pad = String(n).length;
  doc.layers.forEach((l, i) => {
    if (!hasPixels(l)) return;
    const one: Doc = { ...doc, selection: null, paths: [], layers: [{ ...l, visible: true, blendMode: 'normal', clip: false, parentId: undefined }] };
    out.push({ name: `${String(i + 1).padStart(Math.max(2, pad), '0')} ${baseName(l.name)}.png`, bmp: flatten(one) });
  });
  return out;
}
/** The ZIP of every layer as a PNG (stored, not squeezed again: PNG is already compressed). */
export function layersZip(doc: Doc): { bytes: Uint8Array; count: number } {
  const files: Zippable = {};
  const list = layerFiles(doc);
  for (const f of list) files[f.name] = [encodePng(f.bmp), { level: 0 }];
  return { bytes: zipSync(files), count: list.length };
}

// ---- Take a photo ------------------------------------------------------------------------------------------------------
/** A plain sentence for why the camera did not start. */
export function cameraProblem(e: unknown): string {
  const n = (e as { name?: string } | null)?.name ?? '';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The camera is blocked for this page. Allow the camera from the icon in the address bar, then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'The camera is busy in another app. Close that app, then try again.';
  if (n === 'NoMedia') return 'This browser cannot use a camera here. It needs a secure (https) page and a browser with camera support.';
  return 'The camera could not start. Try again.';
}
/** A name for a new camera photo, from the time it was taken. */
export function photoName(d: Date): string {
  const p = (v: number): string => String(v).padStart(2, '0');
  return `Camera photo ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

// ---- The sheets ----------------------------------------------------------------------------------------------------------
const bodies = new WeakMap<HTMLElement, Map<string, HTMLElement>>();
/** The editor keeps a sheet's first body, so each sheet gets one lasting body whose contents are replaced on every open. */
function sheetBody(host: FileHost, id: string): HTMLElement {
  let m = bodies.get(host.root);
  if (!m) bodies.set(host.root, (m = new Map()));
  let b = m.get(id);
  if (!b) m.set(id, (b = h('div', { class: 'fpe-stack', 'data-testid': id + '-body' })));
  return b;
}
const btn = (text: string, primary: boolean, testid: string, onclick: () => void): HTMLButtonElement =>
  h('button', { type: 'button', class: 'fpe-btn ' + (primary ? 'fpe-btn-primary' : 'fpe-btn-ghost'), 'data-testid': testid, onclick }, text) as HTMLButtonElement;
const say = (el: HTMLElement, text: string, bad = false): void => { el.textContent = text; el.toggleAttribute('data-bad', bad); };

function openUrl(host: FileHost): void {
  const b = sheetBody(host, 'open-url');
  const input = h('input', { type: 'url', inputmode: 'url', autocomplete: 'url', spellcheck: 'false', placeholder: 'https://…/picture.jpg',
    'data-testid': 'url-input', 'data-autofocus': '', 'aria-label': 'Web address of the picture' }) as HTMLInputElement;
  const status = h('p', { class: 'fpe-note', role: 'status', 'aria-live': 'polite', 'data-testid': 'url-status' });
  const go = btn('Open', true, 'url-open', () => void load());
  const load = async (): Promise<void> => {
    const url = checkUrl(input.value);
    if (!url) { say(status, 'Type or paste a web address that starts with https://, for a picture file.', true); return; }
    go.disabled = true;
    say(status, 'Loading the picture…');
    try {
      const { blob, name } = await fetchPicture(url);
      host.closeSheet();
      await host.open(blob, name);
    } catch (e) {
      say(status, e instanceof Error ? e.message : URL_BLOCKED, true);
    } finally { go.disabled = false; }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void load(); } });
  b.replaceChildren(
    h('p', { class: 'fpe-note' }, 'Paste the address of a picture file. It loads straight into this browser: nothing is sent anywhere else. ' +
      'Some sites do not allow their pictures to be loaded by other pages; the editor then says so.'),
    h('label', { class: 'fpe-field' }, h('span', {}, 'Picture address'), input), status,
    h('div', { class: 'fpe-actions' }, btn('Cancel', false, 'url-cancel', () => host.closeSheet()), go));
  host.sheet('open-url', 'Open from a web link', b);
}

let live: MediaStream | null = null;
const stopCamera = (): void => { live?.getTracks().forEach((t) => t.stop()); live = null; };
function camera(host: FileHost): void {
  stopCamera();
  const b = sheetBody(host, 'camera');
  const video = h('video', { class: 'fpe-camera', playsinline: '', muted: '', autoplay: '', 'data-testid': 'camera-video', 'aria-label': 'What the camera sees',
    style: 'width:100%;max-height:60vh;background:#000;border-radius:8px' }) as HTMLVideoElement;
  video.muted = true;
  const status = h('p', { class: 'fpe-note', role: 'status', 'aria-live': 'polite', 'data-testid': 'camera-status' }, 'Starting the camera… your browser may ask first.');
  const take = btn('Take photo', true, 'camera-take', () => void shoot());
  take.disabled = true;
  const shoot = async (): Promise<void> => {
    const w = video.videoWidth, hh = video.videoHeight;
    if (!w || !hh) return;
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    c.getContext('2d')?.drawImage(video, 0, 0, w, hh);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    stopCamera();
    host.closeSheet();
    if (blob) await host.open(blob, photoName(new Date()));
  };
  b.replaceChildren(video, status, h('div', { class: 'fpe-actions' }, btn('Cancel', false, 'camera-cancel', () => { stopCamera(); host.closeSheet(); }), take));
  host.sheet('camera', 'Take a photo', b);
  const sheet = b.closest<HTMLElement>('[data-sheet]');
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) { say(status, cameraProblem({ name: 'NoMedia' }), true); return; }
  md.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(async (s) => {
    // Closed while the browser was still asking: hand the camera straight back.
    if (sheet?.dataset.state !== 'open') { s.getTracks().forEach((t) => t.stop()); return; }
    live = s;
    video.srcObject = s;
    await video.play().catch(() => undefined);
    take.disabled = false;
    say(status, 'Frame the picture, then press Take photo. It opens in a new tab.');
    // However the sheet closes (Cancel, the close button, Escape, another sheet), the camera light goes off with it.
    const watch = window.setInterval(() => {
      if (live !== s) { window.clearInterval(watch); return; }
      if (!sheet || sheet.dataset.state !== 'open' || !b.isConnected) { window.clearInterval(watch); stopCamera(); }
    }, 300);
  }, (e: unknown) => say(status, cameraProblem(e), true));
}

function print(host: FileHost): void {
  const d = host.doc();
  if (!d) return;
  const dpi = d.dpi ?? 72, b = sheetBody(host, 'print');
  const radio = (value: string, text: string, help: string, on: boolean): HTMLElement => {
    const r = h('input', { type: 'radio', name: `fpe-${host.uid}-print`, value, 'data-testid': 'print-' + value }) as HTMLInputElement;
    r.checked = on;
    return h('label', { class: 'fpe-check' }, r, h('span', {}, h('strong', {}, text), h('br'), h('small', {}, help)));
  };
  const go = btn('Print', true, 'print-go', () => {
    const mode = (b.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value === 'size' ? 'size' : 'fit') as 'fit' | 'size';
    void printNow(host, d, mode, dpi);
  });
  b.replaceChildren(
    radio('fit', 'Fit the page', 'As big as the paper allows, turned sideways for a wide picture.', true),
    radio('size', `Real print size: ${printText(d.width, d.height, dpi)}`, `${d.width} × ${d.height} px at ${dpi} DPI. Change the DPI with Picture size.`, false),
    h('p', { class: 'fpe-note' }, "Your browser's print window opens next: pick the printer, paper and copies there, or save as PDF."),
    h('div', { class: 'fpe-actions' }, btn('Cancel', false, 'print-cancel', () => host.closeSheet()), go));
  host.sheet('print', 'Print', b);
}
async function printNow(host: FileHost, d: Doc, mode: 'fit' | 'size', dpi: number): Promise<void> {
  const bmp = flatten(d), c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(bmp.data), bmp.width, bmp.height), 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) { host.toast('The picture could not be prepared for printing.'); return; }
  host.root.querySelector('[data-testid="print-frame"]')?.remove();
  const url = URL.createObjectURL(blob);
  const fr = h('iframe', { 'data-testid': 'print-frame', 'data-mode': mode, title: 'Print', 'aria-hidden': 'true', tabindex: '-1',
    style: 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;opacity:0' }) as HTMLIFrameElement;
  const done = (): void => { fr.remove(); URL.revokeObjectURL(url); };
  fr.addEventListener('load', () => {
    const w = fr.contentWindow, img = fr.contentDocument?.images[0];
    void (img?.decode() ?? Promise.resolve()).catch(() => undefined).then(() => {
      fr.dataset.ready = '1';
      host.closeSheet();
      w?.addEventListener('afterprint', () => window.setTimeout(done, 1000));
      try { w?.focus(); w?.print(); fr.dataset.printed = '1'; } catch { host.toast('This browser would not open its print window.'); }
      window.setTimeout(done, 120000);
    });
  }, { once: true });
  fr.srcdoc = printHtml(url, host.name(), d.width, d.height, mode, dpi);
  host.root.append(fr);
}

function exportLayers(host: FileHost): void {
  const d = host.doc();
  if (!d) return;
  const { bytes, count } = layersZip(d);
  if (!count) { host.toast('This picture has no layers with pixels to save. Folders and light-and-colour layers hold none.'); return; }
  const file = baseName(host.name()) + ' layers.zip', blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  download(blob, file, host.root);
  host.toast(`Saved ${count} layer${count === 1 ? '' : 's'} as PNG pictures in ${file} (${fmtBytes(blob.size)}).`);
}

/** Run one of the File extras. */
export function runFileMore(id: string, host: FileHost): void {
  if (id === 'file.open-url') openUrl(host);
  else if (id === 'file.camera') camera(host);
  else if (id === 'file.print') print(host);
  else if (id === 'file.export-layers') exportLayers(host);
}
