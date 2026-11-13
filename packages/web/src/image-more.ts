// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Image extras, loaded the first time one is used (filters batch 2, part 4): soften the last filter or colour fix right after
 * it (Fade), turn every picture layer to shades of grey, and turn the whole picture by any angle with a live preview. Each
 * change is one undo step. The maths is in the exported functions, which test/image-more.test.ts checks by hand.
 */
import {
  compositeDoc, docCommand, docRect, findLayer, hasPixels, readRegion, snapshotDoc, warpBitmap, warpMask, writeRegion, pixelCommand,
  type Command, type Doc, type Quad, type Rect,
} from '@free-photoeditor/core';
import { h } from './dom';
import type { ToolHost } from './toolkit';

/** The last filter or colour fix, as the editor kept it when Apply pushed it (`step` is the History step it became). */
export interface LastChange { layerId: string; r: Rect; before: Uint8ClampedArray; step: number; label: string; }
export interface ImageHost extends ToolHost { lastChange(): LastChange | null; fit(): void; }

/**
 * `amount` per cent of the change stays: 100 is the filtered pixels, 0 the pixels as they were. Colour mixes weighted by
 * how solid each side is, so a pixel that was see-through does not drag in its hidden colour.
 */
export function fadeMix(before: Uint8ClampedArray, after: Uint8ClampedArray, amount: number): Uint8ClampedArray {
  const t = Math.max(0, Math.min(100, amount)) / 100, out = new Uint8ClampedArray(after.length);
  for (let i = 0; i < out.length; i += 4) {
    const ab = before[i + 3], aa = after[i + 3], a = ab + (aa - ab) * t;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = (before[i + c] * ab + (after[i + c] * aa - before[i + c] * ab) * t) / a;
    out[i + 3] = a;
  }
  return out;
}
/** Brightness as grey (0.299 red + 0.587 green + 0.114 blue); see-through is kept. */
export function grayData(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = src.slice();
  for (let i = 0; i < out.length; i += 4) out[i] = out[i + 1] = out[i + 2] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  return out;
}
/** Every picture layer in shades of grey, as one undo step; null when there is no picture layer. */
export function grayDocument(doc: Doc): Command | null {
  if (!doc.layers.some((l) => hasPixels(l))) return null;
  const before = snapshotDoc(doc), layers = doc.layers.map((l) => (hasPixels(l) ? { ...l, data: grayData(l.data) } : { ...l }));
  const cmd = docCommand('Shades of grey', before, { width: doc.width, height: doc.height, layers, activeId: doc.activeId, selection: doc.selection });
  cmd.redo(doc);
  return cmd;
}
/** The canvas that holds a w × h picture turned by `deg` degrees, every corner inside. */
export function turnedSize(w: number, hh: number, deg: number): { w: number; h: number } {
  const a = (deg * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  // cos 90° is 6e-17, not 0: the small margin keeps a quarter turn from growing by one pixel.
  return { w: Math.max(1, Math.ceil(w * c + hh * s - 1e-6)), h: Math.max(1, Math.ceil(w * s + hh * c - 1e-6)) };
}
/** Turn the whole picture by `deg` degrees (more than 0 turns clockwise); the canvas grows to hold every corner. */
export function rotateDocument(doc: Doc, deg: number): Command | null {
  if (!Number.isFinite(deg) || deg % 360 === 0) return null;
  const W = doc.width, H = doc.height, n = turnedSize(W, H, deg), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const r9 = (v: number): number => Math.round(v * 1e9) / 1e9 + 0; // + 0 turns -0 into 0
  const map = (x: number, y: number) => ({ x: r9(n.w / 2 + (x - W / 2) * c - (y - H / 2) * s), y: r9(n.h / 2 + (x - W / 2) * s + (y - H / 2) * c) });
  const pad = Math.max(n.w, n.h), limit = { x: -pad, y: -pad, w: n.w + 2 * pad, h: n.h + 2 * pad }, before = snapshotDoc(doc);
  const layers = doc.layers.map((l) => {
    if (!hasPixels(l) || !l.width || !l.height) return { ...l };
    const to = [map(l.x, l.y), map(l.x + l.width, l.y), map(l.x + l.width, l.y + l.height), map(l.x, l.y + l.height)] as Quad;
    const g = warpBitmap({ width: l.width, height: l.height, data: l.data }, to, true, limit), mask = l.mask ? { mask: warpMask(l.mask, l, to, true, limit) } : {};
    if (!g) return { ...l, x: 0, y: 0, width: 1, height: 1, data: new Uint8ClampedArray(4), ...mask };
    return { ...l, x: g.x, y: g.y, width: g.width, height: g.height, data: g.data, ...mask };
  });
  const cmd = docCommand(`Turn by ${Math.round(deg * 10) / 10}°`, before, { width: n.w, height: n.h, layers, activeId: doc.activeId, selection: null });
  cmd.redo(doc);
  return cmd;
}

const bodies = new Map<string, HTMLElement>();
const later = (draw: () => void): (() => void) => {
  let queued = false;
  return () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
};
/** A sheet with Cancel and Apply. `closed` runs when it closes any other way (Esc, the cross, a tap outside). */
function dialog(host: ImageHost, key: string, title: string, fields: HTMLElement[], apply: () => void, closed: () => void): void {
  let body = bodies.get(key);
  if (!body) { body = h('div', { class: 'fpe-stack', 'data-testid': 'im-' + key }); bodies.set(key, body); }
  let done = false;
  const finish = (ok: boolean): void => { if (done) return; done = true; obs?.disconnect(); host.closeSheet(); if (ok) apply(); else closed(); };
  body.replaceChildren(...fields, h('div', { class: 'fpe-actions' },
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'im-cancel', onclick: () => finish(false) }, 'Cancel'),
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'im-apply', onclick: () => finish(true) }, 'Apply')));
  host.sheet('im-' + key, title, body);
  const sheet = body.closest<HTMLElement>('[data-state]');
  const obs = sheet && typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => { if (sheet.dataset.state === 'closed' && !done) { done = true; obs?.disconnect(); closed(); } }) : null;
  obs?.observe(sheet as HTMLElement, { attributes: true, attributeFilter: ['data-state'] });
}

/** Runs one of the commands this module owns; commands.ts gives each its handler. */
export function runImageMore(id: string, host: ImageHost): void {
  const d = host.doc();
  if (!d) { host.toast('Open or create a picture first.'); return; }
  if (id === 'edit.fade') return fade(host, d);
  if (id === 'image.mode-gray') {
    const cmd = grayDocument(d);
    if (!cmd) { host.toast('There is no picture layer to turn grey.'); return; }
    host.push(cmd, true);
    host.toast('Every picture layer is now shades of grey. New paint can still add colour: a browser always keeps colour.');
    return;
  }
  if (id === 'image.rotate-any') return rotateAny(host, d);
}

function fade(host: ImageHost, d: Doc): void {
  const c = host.lastChange(), l = c ? findLayer(d, c.layerId) : undefined;
  if (!c || !l || host.history().stateId() !== c.step) {
    host.toast('Soften works right after a filter or a colour fix: apply one, then come here before any other change.');
    return;
  }
  const after = readRegion(l, c.r), box = { x: c.r.x + l.x, y: c.r.y + l.y, w: c.r.w, h: c.r.h };
  let amount = 50;
  const show = (v: number): void => { writeRegion(l, c.r, v >= 100 ? after : fadeMix(c.before, after, v)); host.dirty(box); };
  const redo = later(() => show(amount));
  dialog(host, 'fade', `Soften ${c.label} · Fade`, [
    h('p', { class: 'fpe-note' }, `The picture shows the change at the strength you pick. Apply keeps it as its own step, so Undo removes the softening first, then ${c.label}.`),
    host.slider('How much of the change stays · Opacity', '100% keeps the full change; 0% puts the picture back as it was.', 0, 100, amount, '%', (v) => { amount = v; redo(); }, 'im-fade'),
  ], () => {
    show(amount);
    if (amount < 100) host.push(pixelCommand(`Soften ${c.label}`, l.id, c.r, after), true);
  }, () => show(100));
  show(amount);
}

function rotateAny(host: ImageHost, d: Doc): void {
  const W = d.width, H = d.height, s = Math.min(1, 240 / Math.max(W, H)), sw = Math.max(1, Math.round(W * s)), sh = Math.max(1, Math.round(H * s));
  const full = compositeDoc(d, docRect(d)), small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (Math.min(H - 1, Math.floor(y / s)) * W + Math.min(W - 1, Math.floor(x / s))) * 4;
    small.set(full.subarray(i, i + 4), (y * sw + x) * 4);
  }
  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  src.getContext('2d')?.putImageData(new ImageData(small, sw, sh), 0, 0);
  const cv = h('canvas', { 'data-testid': 'im-rotate-preview', role: 'img', 'aria-label': 'Preview of the turned picture',
    style: 'display:block;margin:0 auto;max-width:100%;height:auto;outline:1px dashed currentColor' }) as HTMLCanvasElement;
  let deg = 0;
  const size = h('p', { class: 'fpe-note', 'data-testid': 'im-rotate-size' });
  const draw = (): void => {
    const n = turnedSize(sw, sh, deg), ctx = cv.getContext('2d'), big = turnedSize(W, H, deg);
    cv.width = n.w; cv.height = n.h;
    size.textContent = `The canvas becomes ${big.w} × ${big.h} px; the corners it uncovers are see-through.`;
    if (!ctx) return;
    ctx.translate(n.w / 2, n.h / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src, -sw / 2, -sh / 2);
  };
  const redo = later(draw);
  const fine = h('input', { type: 'number', min: -180, max: 180, step: 0.1, value: 0, 'aria-label': 'Exact angle in degrees', 'data-testid': 'im-angle-exact',
    style: 'width:7em;font-size:13px', oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { deg = Math.max(-180, Math.min(180, v)); redo(); } } }) as HTMLInputElement;
  dialog(host, 'rotate', 'Turn by any angle · Arbitrary rotation', [
    h('p', { class: 'fpe-note' }, 'Above 0 turns clockwise, below 0 the other way. To straighten a horizon, turn until it lines up with the dashed frame.'),
    cv, size,
    host.slider('Angle', 'How far the whole picture turns, in degrees.', -180, 180, deg, '°', (v) => { deg = v; fine.value = String(v); redo(); }, 'im-angle'),
    h('label', { class: 'fpe-field', 'data-help-title': 'Exact angle', 'data-help': 'Type an angle with tenths of a degree, such as 2.5, for a fine straighten.' },
      h('span', {}, 'Exact angle (°)'), fine),
  ], () => {
    const dd = host.doc();
    if (!dd || deg % 360 === 0) return;
    host.push(rotateDocument(dd, deg), true);
    host.selectionChanged();
    host.fit();
  }, () => undefined);
  draw();
}
