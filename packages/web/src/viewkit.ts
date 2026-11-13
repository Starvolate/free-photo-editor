// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The view helpers and the small tools, inside the tool kit's chunk: oval, one-row and one-column selections, Measure
 * (ruler), colour markers (colour sampler), sticky notes, guide lines with snapping, the pixel grid, print size, the
 * composition guides and Select the sharp parts (focus area). Nothing here touches the drawing path: guides, the pixel
 * grid, markers and notes are drawn on the overlay, and only while they are on. The maths is plain functions, tested
 * on numbers and pixels in node.
 */
import { compositeDoc, docRect, polygonMask, type Doc, type Mask, type Pixels, type SelMode } from '@free-photoeditor/core';
import type { ToolId } from './commands';
import { h } from './dom';
import type { PointerInfo, Pt } from './input';
import type { ToolHost } from './toolkit';

export const VIEW_TOOLS = new Set<ToolId>(['select-ellipse', 'select-row', 'select-column', 'ruler', 'color-sampler', 'note']);
/** The tools whose options bar lives here (the three selections use the kit's own mode and soft-edge controls). */
export const VIEW_BAR = new Set<ToolId>(['ruler', 'color-sampler', 'note']);
export const VIEW_CMDS = new Set(['view.pixel-grid', 'view.guide-new', 'view.guide-clear', 'view.guide-lock', 'view.snap', 'view.print-size',
  'view.composition-guides', 'select.focus']);
export interface Guide { dir: 'h' | 'v'; at: number; }
export interface Pin { at: Pt; text: string; }
export const MAX_MARKERS = 4;
/** How near, in screen pixels, a press must be to grab a guide, a marker or a note, and how far snapping reaches. */
const REACH = 6;

/** An oval inside the box from a to b (a circle when `round`), as outline points in picture pixels. */
export function ovalPoints(a: Pt, b: Pt, round = false): Pt[] {
  let w = b.x - a.x, hh = b.y - a.y;
  if (round) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = (w < 0 ? -1 : 1) * s; hh = (hh < 0 ? -1 : 1) * s; }
  const cx = a.x + w / 2, cy = a.y + hh / 2, rx = Math.abs(w) / 2, ry = Math.abs(hh) / 2;
  const n = Math.max(48, Math.min(720, Math.round((rx + ry) * 2)));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }); }
  return pts;
}
export const ovalMask = (w: number, hgt: number, a: Pt, b: Pt, round = false): Mask => polygonMask(w, hgt, ovalPoints(a, b, round));
/** A one-pixel line right across the picture: the row at `at`, or the column when `column`. */
export function lineMask(w: number, hgt: number, at: number, column: boolean): Mask {
  const data = new Uint8Array(w * hgt), i = Math.max(0, Math.min((column ? w : hgt) - 1, Math.floor(at)));
  if (column) for (let y = 0; y < hgt; y++) data[y * w + i] = 255;
  else data.fill(255, i * w, i * w + w);
  return { width: w, height: hgt, data };
}
/** Length in pixels and angle in degrees from a to b: 0 points right, 90 straight up, as on a protractor. */
export function measure(a: Pt, b: Pt): { length: number; angle: number; dx: number; dy: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  return { length: Math.hypot(dx, dy), angle: dx === 0 && dy === 0 ? 0 : (Math.atan2(0 - dy, dx) * 180) / Math.PI, dx, dy };
}
/** Pull a point to the nearest guide line, picture edge or middle within `reach` picture pixels, each axis on its own. */
export function snapPoint(p: Pt, w: number, hgt: number, guides: readonly Guide[], reach: number): Pt {
  const pull = (v: number, lines: number[]): number => {
    let best = v, d = reach;
    for (const l of lines) { const e = Math.abs(v - l); if (e <= d) { d = e; best = l; } }
    return best;
  };
  const on = (dir: 'h' | 'v'): number[] => guides.filter((g) => g.dir === dir).map((g) => g.at);
  return { x: pull(p.x, [0, w / 2, w, ...on('v')]), y: pull(p.y, [0, hgt / 2, hgt, ...on('h')]) };
}
/** The guide a press at p grabs (within `reach` screen pixels at this zoom), or -1; locked guides cannot be grabbed. */
export function hitGuide(guides: readonly Guide[], p: Pt, zoom: number, locked: boolean, reach = REACH): number {
  if (locked) return -1;
  let best = -1, d = reach;
  guides.forEach((g, i) => { const e = Math.abs((g.dir === 'v' ? p.x : p.y) - g.at) * zoom; if (e <= d) { d = e; best = i; } });
  return best;
}
/** A new guide: down the middle first, then across it, then at the thirds, so each new one lands somewhere new. */
export function nextGuide(guides: readonly Guide[], w: number, hgt: number): Guide {
  const v = guides.filter((g) => g.dir === 'v').length, hz = guides.filter((g) => g.dir === 'h').length;
  const dir: 'h' | 'v' = v <= hz ? 'v' : 'h', size = dir === 'v' ? w : hgt;
  const taken = new Set(guides.filter((g) => g.dir === dir).map((g) => g.at));
  for (const f of [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4]) { const at = Math.round(size * f); if (!taken.has(at)) return { dir, at }; }
  return { dir, at: Math.round(size / 2) };
}
/** The nearest point pinned within `reach` screen pixels of p (a marker or a note), or -1. */
export function hitPin(pins: readonly Pt[], p: Pt, zoom: number, reach = REACH + 4): number {
  let best = -1, d = reach;
  pins.forEach((q, i) => { const e = Math.hypot(q.x - p.x, q.y - p.y) * zoom; if (e <= d) { d = e; best = i; } });
  return best;
}
/** The zoom that shows the picture at the size it prints: a screen inch is 96 CSS pixels. */
export const printZoom = (dpi: number | undefined): number => 96 / (dpi && dpi > 0 ? dpi : 72);
/** The picture columns and rows whose pixel edges are on screen, or null when the zoom is too far out to show them. */
export function pixelGridRange(zoom: number, panX: number, panY: number, cw: number, ch: number, w: number, hgt: number):
  { x0: number; x1: number; y0: number; y1: number } | null {
  if (zoom < 8) return null;
  const x0 = Math.max(0, Math.floor(-panX / zoom)), x1 = Math.min(w, Math.ceil((cw - panX) / zoom));
  const y0 = Math.max(0, Math.floor(-panY / zoom)), y1 = Math.min(hgt, Math.ceil((ch - panY) / zoom));
  return x0 > x1 || y0 > y1 ? null : { x0, x1, y0, y1 };
}
/** Where the composition lines fall, as fractions of the width and height: 1 = thirds, 2 = the golden ratio. */
export const compositionLines = (kind: number): number[] => (kind === 1 ? [1 / 3, 2 / 3] : kind === 2 ? [0.382, 0.618] : []);
export const hex = (c: ArrayLike<number>): string => '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
/**
 * Select the sharp parts: how much each pixel differs from its four neighbours (fine detail), averaged over an area, then
 * split into sharp and soft at the level that best separates the two (Otsu's method). A flat picture selects nothing.
 */
export function focusMask(px: Pixels, radius = Math.max(2, Math.round(Math.min(px.width, px.height) / 40))): Mask {
  const { width: w, height: hgt, data } = px, n = w * hgt, g = new Float32Array(n), e = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = ((data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) * data[j + 3]) / 255;
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, c = g[i];
    e[i] = Math.abs(4 * c - (x ? g[i - 1] : c) - (x < w - 1 ? g[i + 1] : c) - (y ? g[i - w] : c) - (y < hgt - 1 ? g[i + w] : c));
  }
  const W = w + 1, sat = new Float64Array(W * (hgt + 1));
  for (let y = 0; y < hgt; y++) { let row = 0; for (let x = 0; x < w; x++) { row += e[y * w + x]; sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row; } }
  const avg = new Float32Array(n);
  let max = 0;
  for (let y = 0; y < hgt; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(hgt, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const v = (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      avg[y * w + x] = v;
      if (v > max) max = v;
    }
  }
  const m: Mask = { width: w, height: hgt, data: new Uint8Array(n) };
  if (max < 1) return m;
  const bin = (v: number): number => Math.min(255, Math.floor((v / max) * 255)), hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[bin(avg[i])]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, t = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  for (let i = 0; i < n; i++) if (bin(avg[i]) > t) m.data[i] = 255;
  return m;
}

interface Per { guides: Guide[]; markers: Pt[]; notes: Pin[]; ruler: { a: Pt; b: Pt } | null; }
type Grab = { k: 'oval'; a: Pt; b: Pt; mode: SelMode; round: boolean } | { k: 'ruler' } | { k: 'guide'; g: Guide } | { k: 'marker'; i: number };
export interface ViewKit {
  claims(t: ToolId): boolean;
  busy(): boolean;
  start(p: Pt, i: PointerInfo): void;
  move(p: Pt, i: PointerInfo): void;
  end(p: Pt, i: PointerInfo): void;
  cancel(): void;
  options(bar: HTMLElement, t: ToolId): void;
  overlay(ctx: CanvasRenderingContext2D): void;
  cmd(id: string): unknown;
  /** Pull a point to the guides and the picture's edges and middle, when Snap is on. */
  snap(p: Pt): Pt;
  /** Cheap: the switches, for menu ticks. */
  flags(): { guides: number; lock: boolean; snap: boolean; pixelGrid: boolean; comp: number };
  state(): Record<string, unknown>;
}

export function createViewKit(host: ToolHost, applyMask: (m: Mask, mode: SelMode, label: string) => void, modeOf: (i: PointerInfo) => SelMode): ViewKit {
  const per = new WeakMap<Doc, Per>();
  const S = { pixelGrid: false, lock: false, snap: false, comp: 0 };
  let g: Grab | null = null, readout: HTMLElement | null = null;
  const doc = (): Doc | null => host.doc();
  const of = (d: Doc): Per => { let x = per.get(d); if (!x) per.set(d, (x = { guides: [], markers: [], notes: [], ruler: null })); return x; };
  const z = (): number => host.view().zoom;
  const clampPt = (d: Doc, p: Pt): Pt => ({ x: Math.max(0, Math.min(d.width - 1, Math.floor(p.x))), y: Math.max(0, Math.min(d.height - 1, Math.floor(p.y))) });
  const snapIn = (d: Doc, p: Pt, guides: readonly Guide[]): Pt => (S.snap ? snapPoint(p, d.width, d.height, guides, REACH / z()) : p);
  const colourAt = (d: Doc, p: Pt): Uint8ClampedArray => compositeDoc(d, { x: p.x, y: p.y, w: 1, h: 1 });
  const rulerText = (r: { a: Pt; b: Pt }): string => {
    const m = measure(r.a, r.b);
    return `Length ${m.length.toFixed(1)} px · Angle ${m.angle.toFixed(1)}° · Across ${Math.round(Math.abs(m.dx))} px · Down ${Math.round(Math.abs(m.dy))} px`;
  };
  const btn = (text: string, testid: string, run: () => void, help: string): HTMLElement =>
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': testid, 'data-help-title': text, 'data-help': help, onclick: run }, text);
  const hint = (s: string): HTMLElement => h('span', { class: 'fpe-hint' }, s);
  const redraw = (): void => { host.render(); host.refreshOptions(); };
  const flags = (): ReturnType<ViewKit['flags']> => {
    const d = doc();
    return { guides: d ? per.get(d)?.guides.length ?? 0 : 0, lock: S.lock, snap: S.snap, pixelGrid: S.pixelGrid, comp: S.comp };
  };

  function openNote(d: Doc, idx: number, at: Pt): void {
    const notes = of(d).notes, n = idx >= 0 ? notes[idx] : null;
    const text = h('textarea', { rows: 5, class: 'fpe-input', 'data-testid': 'note-text', 'aria-label': 'Note', placeholder: 'Write your note here' });
    text.value = n?.text ?? '';
    const save = (): void => {
      const t = text.value.trim();
      if (!t) { host.toast('Write something in the note first.'); return; }
      if (n) n.text = t; else notes.push({ at: clampPt(d, at), text: t });
      host.closeSheet();
      redraw();
    };
    const kids: HTMLElement[] = [h('p', { class: 'fpe-note' }, 'Notes stay with this picture while it is open. They are not saved into exported files.'), text,
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'note-save', onclick: save }, 'Save the note')];
    if (n) kids.push(btn('Remove this note', 'note-remove', () => { notes.splice(idx, 1); host.closeSheet(); redraw(); }, 'Take this note off the picture.'));
    host.sheet('note', n ? `Sticky note ${idx + 1} · Note` : 'New sticky note · Note', h('div', { class: 'fpe-sheet-body' }, ...kids));
    queueMicrotask(() => text.focus());
  }

  function start(p: Pt, i: PointerInfo): void {
    const d = doc();
    if (!d) return;
    const o = of(d), t = host.tool();
    if (t === 'move') {
      const k = hitGuide(o.guides, p, z(), S.lock);
      if (k >= 0) g = { k: 'guide', g: o.guides[k] };
      return;
    }
    switch (t) {
      case 'select-ellipse': { const q = snapIn(d, p, o.guides); g = { k: 'oval', a: q, b: q, mode: modeOf(i), round: false }; break; }
      case 'select-row': case 'select-column':
        applyMask(lineMask(d.width, d.height, t === 'select-row' ? p.y : p.x, t === 'select-column'), modeOf(i), t === 'select-row' ? 'Select one row' : 'Select one column');
        break;
      case 'ruler': { const q = snapIn(d, p, o.guides); o.ruler = { a: q, b: q }; g = { k: 'ruler' }; host.render(); break; }
      case 'color-sampler': {
        const k = hitPin(o.markers, p, z());
        if (k >= 0 && i.alt) { o.markers.splice(k, 1); redraw(); return; }
        if (k >= 0) { g = { k: 'marker', i: k }; return; }
        if (o.markers.length >= MAX_MARKERS) { host.toast('Four colour markers is the most. Drag one to move it, or Alt-click one to remove it.'); return; }
        o.markers.push(clampPt(d, p));
        g = { k: 'marker', i: o.markers.length - 1 };
        redraw();
        break;
      }
      case 'note': { const k = hitPin(o.notes.map((n) => n.at), p, z()); openNote(d, k, p); break; }
      default:
    }
  }
  function move(p: Pt, i: PointerInfo): void {
    const d = doc();
    if (!d || !g) return;
    const o = of(d);
    if (g.k === 'oval') { g.b = snapIn(d, p, o.guides); g.round = i.shift; }
    else if (g.k === 'ruler' && o.ruler) { o.ruler.b = snapIn(d, p, o.guides); if (readout) readout.textContent = rulerText(o.ruler); }
    else if (g.k === 'guide') {
      const gd = g.g, q = snapIn(d, p, o.guides.filter((x) => x !== gd));
      gd.at = Math.round(gd.dir === 'v' ? q.x : q.y);
    } else if (g.k === 'marker' && o.markers[g.i]) o.markers[g.i] = clampPt(d, p);
    host.render();
  }
  function end(p: Pt, i: PointerInfo): void {
    move(p, i);
    const d = doc(), q = g;
    g = null;
    if (!d || !q) return;
    const o = of(d);
    if (q.k === 'oval') {
      const big = Math.abs(q.b.x - q.a.x) * z() >= 2 && Math.abs(q.b.y - q.a.y) * z() >= 2;
      if (big) applyMask(ovalMask(d.width, d.height, q.a, q.b, q.round), q.mode, 'Select an oval');
      else if (q.mode === 'new' && d.selection) applyMask({ width: d.width, height: d.height, data: new Uint8Array(d.width * d.height) }, 'new', 'Select nothing');
    } else if (q.k === 'guide') {
      const size = q.g.dir === 'v' ? d.width : d.height;
      if (q.g.at < 0 || q.g.at > size) { o.guides.splice(o.guides.indexOf(q.g), 1); host.toast('Guide line removed.'); }
    }
    redraw();
  }

  function options(bar: HTMLElement, t: ToolId): void {
    const d = doc(), o = d ? of(d) : null;
    readout = null;
    if (t === 'ruler') {
      readout = h('span', { class: 'fpe-hint', 'data-testid': 'ruler-readout' }, o?.ruler ? rulerText(o.ruler) : 'Drag across the picture to measure a distance and an angle.');
      bar.append(readout);
      if (o?.ruler) bar.append(btn('Clear', 'ruler-clear', () => { o.ruler = null; redraw(); }, 'Take the measuring line away.'));
    } else if (t === 'color-sampler') {
      const list = h('span', { class: 'fpe-hint', 'data-testid': 'sampler-values' });
      if (d && o?.markers.length) {
        list.textContent = o.markers.map((m, k) => { const c = colourAt(d, m); return `${k + 1}: R ${c[0]} G ${c[1]} B ${c[2]} · ${hex(c)}`; }).join('   ');
        bar.append(list, btn('Clear all', 'sampler-clear', () => { o.markers.length = 0; redraw(); }, 'Take every colour marker away.'));
      } else bar.append(hint('Click the picture to pin up to four colour markers. Drag one to move it; Alt-click one to remove it. Their values follow your edits.'));
    } else if (t === 'note') {
      bar.append(hint(o?.notes.length ? `${o.notes.length} note${o.notes.length > 1 ? 's' : ''} on this picture. Click one to read, change or remove it; click elsewhere for a new one.`
        : 'Click the picture to pin a written note there.'));
    }
  }

  function overlay(ctx: CanvasRenderingContext2D): void {
    const d = doc();
    if (!d) return;
    const o = per.get(d);
    if (!S.pixelGrid && !S.comp && !g && (!o || (!o.guides.length && !o.markers.length && !o.notes.length && !o.ruler))) return;
    const v = host.view(), zz = v.zoom, X = (x: number): number => v.panX + x * zz, Y = (y: number): number => v.panY + y * zz, c = host.canvas();
    const cw = c.clientWidth, ch = c.clientHeight;
    ctx.save();
    ctx.lineWidth = 1;
    const line = (x0: number, y0: number, x1: number, y1: number): void => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };
    if (S.pixelGrid) {
      const r = pixelGridRange(zz, v.panX, v.panY, cw, ch, d.width, d.height);
      if (r) {
        ctx.beginPath();
        for (let x = r.x0; x <= r.x1; x++) { const sx = Math.round(X(x)) + 0.5; line(sx, Y(r.y0), sx, Y(r.y1)); }
        for (let y = r.y0; y <= r.y1; y++) { const sy = Math.round(Y(y)) + 0.5; line(X(r.x0), sy, X(r.x1), sy); }
        ctx.strokeStyle = 'rgba(128,128,128,.4)';
        ctx.stroke();
      }
    }
    if (S.comp) {
      ctx.beginPath();
      for (const f of compositionLines(S.comp)) { line(X(d.width * f), Y(0), X(d.width * f), Y(d.height)); line(X(0), Y(d.height * f), X(d.width), Y(d.height * f)); }
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (o?.guides.length) {
      ctx.beginPath();
      for (const gd of o.guides) {
        if (gd.dir === 'v') { const sx = Math.round(X(gd.at)) + 0.5; line(sx, 0, sx, ch); } else { const sy = Math.round(Y(gd.at)) + 0.5; line(0, sy, cw, sy); }
      }
      ctx.strokeStyle = S.lock ? 'rgba(0,200,255,.6)' : '#00c8ff';
      ctx.stroke();
    }
    if (o?.ruler) {
      const a = { x: X(o.ruler.a.x), y: Y(o.ruler.a.y) }, b = { x: X(o.ruler.b.x), y: Y(o.ruler.b.y) };
      ctx.beginPath(); line(a.x, a.y, b.x, b.y);
      for (const q of [a, b]) { line(q.x - 5, q.y, q.x + 5, q.y); line(q.x, q.y - 5, q.x, q.y + 5); }
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.25; ctx.stroke();
    }
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    o?.markers.forEach((m, k) => {
      const sx = X(m.x + 0.5), sy = Y(m.y + 0.5);
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); line(sx - 9, sy, sx + 9, sy); line(sx, sy - 9, sx, sy + 9);
      ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.25; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3;
      ctx.strokeText(String(k + 1), sx + 9, sy + 9); ctx.fillText(String(k + 1), sx + 9, sy + 9);
    });
    o?.notes.forEach((n, k) => {
      const sx = X(n.at.x + 0.5), sy = Y(n.at.y + 0.5);
      ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(sx - 8, sy - 8, 16, 16); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), sx, sy + 0.5); ctx.textAlign = 'start';
    });
    if (g?.k === 'oval') {
      const pts = ovalPoints(g.a, g.b, g.round);
      ctx.beginPath();
      pts.forEach((q, k) => (k ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
      ctx.closePath();
      ctx.setLineDash([5, 5]); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.lineDashOffset = 5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function cmd(id: string): unknown {
    const d = doc();
    switch (id) {
      case 'view.pixel-grid':
        S.pixelGrid = !S.pixelGrid;
        host.toast(S.pixelGrid ? (z() >= 8 ? 'Pixel grid on.' : 'Pixel grid on: it shows when you zoom in to 800% or more.') : 'Pixel grid off.');
        break;
      case 'view.guide-lock': S.lock = !S.lock; host.toast(S.lock ? 'Guide lines are locked: they stay where they are.' : 'Guide lines can be dragged again with Move.'); break;
      case 'view.snap': S.snap = !S.snap; host.toast(S.snap ? 'Snap on: guides, ovals, measures, shapes and colour fades jump to guide lines and the picture\'s edges and middle.' : 'Snap off.'); break;
      case 'view.composition-guides':
        S.comp = (S.comp + 1) % 3;
        host.toast(['Composition guides off.', 'Rule of thirds: put the subject where the lines cross. Run again for the golden ratio.', 'Golden ratio lines. Run again to hide them.'][S.comp]);
        break;
      case 'view.guide-new': {
        if (!d) return false;
        const gd = nextGuide(of(d).guides, d.width, d.height);
        of(d).guides.push(gd);
        host.toast(`Guide line added ${gd.dir === 'v' ? 'down' : 'across'} the picture at ${gd.at} px. Drag it with Move to place it, or off the picture to remove it.`);
        break;
      }
      case 'view.guide-clear': {
        if (!d) return false;
        const n = of(d).guides.length;
        of(d).guides.length = 0;
        host.toast(n ? `Removed ${n} guide line${n > 1 ? 's' : ''}.` : 'There are no guide lines to remove.');
        break;
      }
      case 'view.print-size': {
        if (!d) return false;
        const zoom = printZoom(d.dpi), c = host.canvas(), dpi = d.dpi && d.dpi > 0 ? d.dpi : 72;
        host.restoreView({ zoom, panX: Math.round((c.clientWidth - d.width * zoom) / 2), panY: Math.round((c.clientHeight - d.height * zoom) / 2) }, false);
        host.toast(`Print size at ${dpi} dpi: ${(d.width / dpi).toFixed(2)} × ${(d.height / dpi).toFixed(2)} inches. Screens differ, so hold a ruler to it to be sure.`);
        break;
      }
      case 'select.focus': {
        if (!d) return false;
        const m = focusMask({ width: d.width, height: d.height, data: compositeDoc(d, docRect(d)) });
        if (!m.data.some((x) => x)) { host.toast('Nothing here is sharper than the rest, so nothing was selected.'); return false; }
        applyMask(m, 'new', 'Select the sharp parts');
        break;
      }
      default: return false;
    }
    host.render();
    host.refreshOptions();
    return true;
  }

  return {
    claims: (t) => VIEW_TOOLS.has(t) || (t === 'move' && ((): boolean => {
      const d = doc(), p = host.pointer(), o = d ? per.get(d) : undefined;
      return !!(o && p && hitGuide(o.guides, p, z(), S.lock) >= 0);
    })()),
    busy: () => !!g,
    start, move, end,
    cancel: () => { if (g) { g = null; host.render(); } },
    options, overlay, cmd,
    snap: (p) => { const d = doc(); return d ? snapIn(d, p, of(d).guides) : p; },
    flags,
    state() {
      const d = doc(), o = d ? per.get(d) : undefined;
      return { ...flags(), lines: o?.guides.map((x) => `${x.dir}${x.at}`) ?? [], markers: d && o ? o.markers.map((m) => hex(colourAt(d, m))) : [], notes: o?.notes.map((n) => n.text) ?? [],
        ruler: o?.ruler ? { ...measure(o.ruler.a, o.ruler.b) } : null, grabbing: g?.k ?? null };
    },
  };
}
