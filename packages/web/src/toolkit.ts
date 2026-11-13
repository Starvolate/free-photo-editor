// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The W3 tools, loaded on first use in their own file: lasso, polygonal lasso, magic wand, quick select and the Select
 * menu's changes; free transform of a layer or the selection; colour fades, the paint bucket, the magic eraser and outlining;
 * the effect brushes (clone, heal, spot heal, patch, red eye, dodge, burn, sponge, blur, sharpen, smudge, colour replacement,
 * history brush, background eraser); text layers with the Character and Paragraph panels; and shape layers.
 * Every change goes through the engine and onto the History, in plain words.
 */
import {
  BLACK, DEFAULT_TEXT_STYLE, EffectStroke, activeLayer, addLayer, alignLayer, arrowHead, borderMask, bucketFill, clamp, colorRangeMask,
  combineCommands, combineMasks, compositeDoc, contentCommand, contractMask, countSelected, createLayer, currentContent, distributeLayers, docRect,
  expandMask, featherMask, fillGradient, findLayer, fontString, withMaskSurface, geomOf, growMask, indexOfLayer, layerOnCanvas, layerRect, layoutText, magicErase,
  maskFromSelection, nextLayerName, parseHex, patchArea, polygonMask, quadOfRect, quickSelectMask, redEye, selectionAlpha, selectionFromMask, setGeom, shapeBounds,
  shapePoints, similarMask, smoothMask, strokeSelection, transformLayer, transformSelection, union, wandMask, warpBitmap,
  type AlignEdge, type Command, type Doc, type EffectKind, type GradientKind, type History, type Layer, type LayerContent, type LayerGeom, type Mask,
  type Pixels, type Placed, type Quad, type RGBA, type Rect, type Selection, type SelMode, type ShapeContent, type ShapeKind, type TextContent, type TextStyle,
} from '@free-photoeditor/core';
import { TK_TOOLS, type ToolId } from './commands';
import type { AiKit } from './ai';
import { h } from './dom';
import { PEN_TOOLS, createPenKit } from './pen';
import { VIEW_BAR, VIEW_CMDS, VIEW_TOOLS, createViewKit } from './viewkit';
import { MORE_TOOLS, createMoreKit } from './toolkit-more';
import type { PointerInfo, Pt } from './input';
import type { View } from './renderer';

export interface ToolHost {
  readonly root: HTMLElement;
  readonly uid: number;
  doc(): Doc | null;
  history(): History;
  view(): View;
  canvas(): HTMLCanvasElement;
  /** The on-device AI commands (ai.ts), loaded on first use. */
  ai(): Promise<AiKit>;
  pointer(): Pt | null;
  fg(): string;
  bg(): string;
  push(cmd: Command | null, all?: boolean): void;
  dirty(r: Rect | null): void;
  all(): void;
  render(): void;
  selectionChanged(): void;
  refreshOptions(): void;
  toast(msg: string): void;
  /** `onMask` tools (the brush, the colour fade) also accept the mask while it is the target. */
  editable(l: Layer, pixels?: boolean, onMask?: boolean): boolean;
  /** True when tools edit this layer's mask rather than its pixels. */
  onMask(l: Layer): boolean;
  setTool(t: ToolId): void;
  tool(): ToolId;
  sheet(id: string, title: string, body: HTMLElement): void;
  closeSheet(): void;
  slider(label: string, help: string, min: number, max: number, value: number, unit: string, onInput: (v: number) => void, testid: string): HTMLElement;
  panels(): void;
  layout(): string | null;
  forgetHole(): void;
  rememberSel(s: Selection | null): void;
  showPanel(pid: string): void;
  paint(t: 'brush' | 'pencil' | 'eraser'): { size: number; hardness: number; opacity: number };
  /** Zoom out or pan so a picture rectangle, plus a margin of screen pixels, sits in the picture area. */
  fitBox(r: { x: number; y: number; w: number; h: number }, margin: number): void;
  /** Whether the view is fitted to the window; putting a saved view back (after a transform moved it). */
  fitted(): boolean;
  restoreView(v: View, fitted: boolean): void;
  /** The History step the history brush paints back, by id (0: the picture as opened). */
  paintFrom(): number;
  /** That step left History (a new change replaced it, or it was trimmed): go back to the oldest step, and say so. */
  paintFromGone(): void;
  /** Turn the view (toolkit-more.ts): the angle in radians, and setting it. The pixels never turn. */
  turn(): number;
  setTurn(r: number): void;
}
export interface ToolKit {
  claims(t: ToolId): boolean;
  start(p: Pt, i: PointerInfo): void;
  move(p: Pt, i: PointerInfo): void;
  end(p: Pt, i: PointerInfo): void;
  cancel(): void;
  options(bar: HTMLElement, t: ToolId): void;
  decorate(bar: HTMLElement, t: ToolId): void;
  overlay(ctx: CanvasRenderingContext2D): void;
  key(e: KeyboardEvent): boolean;
  cmd(id: string): unknown;
  /** Guides, snapping, the pixel grid and composition guides (viewkit.ts), cheap enough for menu ticks. */
  viewFlags(): { guides: number; lock: boolean; snap: boolean; pixelGrid: boolean; comp: number };
  toolChanged(prev: ToolId, next: ToolId): void;
  abort(): void;
  state(): Record<string, unknown>;
  cursorSize(t: ToolId): number | null;
  fillPanel(pid: string, body: HTMLElement): void;
  refresh(): void;
  /** What is going on instead of the tool (a transform, painting a selection), for the options bar and the status line. */
  activity(): { plain: string; pro: string; help: string } | null;
  /** Where a picture point shows on the page while the view is turned (toolkit-more.ts; the e2e helper). */
  toClient(x: number, y: number): Pt;
}

type XfMode = 'free' | 'skew' | 'distort' | 'perspective';
interface Snap { content: LayerContent | null; geom: LayerGeom; }
type Gesture =
  | { k: 'rm'; last: Pt; size: number }
  | { k: 'lasso'; pts: Pt[]; mode: SelMode; label: string }
  | { k: 'quick'; pts: Pt[]; mode: SelMode; base: Mask | null; before: Selection | null; src: Pixels; at: number }
  | { k: 'drag'; t: ToolId; a: Pt; b: Pt; shift: boolean }
  | { k: 'obj'; a: Pt; b: Pt; mode: SelMode }
  | { k: 'patch'; a: Pt; b: Pt }
  | { k: 'fx'; s: EffectStroke; t: ToolId; off?: Pt; l?: Layer; warned?: boolean }
  | { k: 'press'; p: Pt; i: PointerInfo; t: ToolId; timer: number }
  | { k: 'qm'; last: Pt; erase: boolean; size: number; hard: number }
  | { k: 'xf'; hd: string; p0: Pt; q0: Quad };
import { carryQuad, effectiveBox, hasPixels as hasPx, isFolder as isFolderNode, subtreeOf as subtreeNodes, transformNode } from '@free-photoeditor/core';

interface Xf { target: 'layer' | 'selection'; id: string; mode: XfMode; orig: LayerGeom | null; sel0: Selection | null; base: Quad; q: Quad; raf: number;
  /** A folder: every layer inside with its starting pixels, for the preview and Esc. */
  kids?: { id: string; orig: LayerGeom }[]; }
interface TextEdit { id: string; add: Command | null; before: Snap; content: TextContent; area: HTMLTextAreaElement; }

const FX: Partial<Record<ToolId, EffectKind>> = {
  clone: 'clone', heal: 'heal', 'spot-heal': 'spot-heal', dodge: 'dodge', burn: 'burn', sponge: 'sponge', blur: 'blur', sharpen: 'sharpen',
  smudge: 'smudge', 'color-replace': 'color-replace', 'history-brush': 'history', 'bg-eraser': 'bg-erase',
};
const FX_LABEL: Partial<Record<ToolId, string>> = {
  clone: 'Copy an area', heal: 'Heal from a source', 'spot-heal': 'Remove spots', dodge: 'Lighten by painting', burn: 'Darken by painting',
  sponge: 'Colour strength by painting', blur: 'Soften by painting', sharpen: 'Sharpen by painting', smudge: 'Smudge', 'color-replace': 'Recolour by painting',
  'history-brush': 'Paint back an earlier step', 'bg-eraser': 'Erase a background',
};
const SHAPES: Partial<Record<ToolId, [ShapeKind, string]>> = {
  rect: ['rect', 'Rectangle'], 'rounded-rect': ['rounded', 'Rounded rectangle'], ellipse: ['ellipse', 'Oval'], polygon: ['polygon', 'Polygon'], line: ['line', 'Line'],
};
const GRADS: [string, (fg: RGBA, bg: RGBA) => RGBA[]][] = [
  ['Main to second colour', (f, b) => [f, b]], ['Main colour to see-through', (f) => [f, { ...f, a: 0 }]],
  ['Black to white', () => [BLACK, { r: 255, g: 255, b: 255, a: 255 }]],
  ['Rainbow', () => [[255, 0, 0], [255, 160, 0], [255, 240, 0], [0, 200, 60], [0, 140, 255], [140, 0, 255]].map(([r, g, b]) => ({ r, g, b, a: 255 }))],
];
const GRAD_KINDS: [GradientKind, string, string][] = [['linear', 'Straight', 'Linear'], ['radial', 'Round', 'Radial'], ['angle', 'Sweep', 'Angle'],
  ['reflected', 'Mirrored', 'Reflected'], ['diamond', 'Diamond', 'Diamond']];
const XF_NAMES: Record<string, [string, string, string]> = {
  free: ['Resize and turn', 'Free transform', 'Drag a corner or an edge to resize, outside the box to turn.'],
  skew: ['Slant', 'Skew', 'Drag an edge to slant it sideways.'],
  distort: ['Pull corners', 'Distort', 'Drag any corner anywhere.'],
  perspective: ['Fix the angle', 'Perspective', 'Drag a corner to widen or narrow that side, like a photo taken at an angle.'],
};
const OFF_PICTURE = 'Nothing is copied here: the source is outside the picture. Alt-click (or press and hold) a new source inside the picture, or paint nearer to it.';
const FONT_CANDIDATES = ['system-ui', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Roboto', 'Georgia', 'Times New Roman',
  'Palatino', 'Garamond', 'Courier New', 'Menlo', 'Consolas', 'Impact', 'Comic Sans MS', 'serif', 'sans-serif', 'monospace', 'cursive'];
const GENERIC = new Set(['system-ui', 'serif', 'sans-serif', 'monospace', 'cursive']);

const now = (): number => performance.now();
/** Drag tools whose points jump to guides and the picture's edges and middle while Snap is on. */
const SNAPS = new Set<ToolId>(['rect', 'rounded-rect', 'ellipse', 'polygon', 'line', 'gradient']);
const unit = (a: Pt, b: Pt): Pt => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
const centroid = (q: Quad): Pt => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });
const inQuad = (q: Quad, p: Pt): boolean => {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  return inside;
};
function ctx2d(w: number, hgt: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.min(8192, Math.ceil(w)));
  c.height = Math.max(1, Math.min(8192, Math.ceil(hgt)));
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('This browser cannot draw here.');
  return x;
}
let measurer: CanvasRenderingContext2D | null = null;
const meas = (): CanvasRenderingContext2D => (measurer ??= ctx2d(4, 4));
function drawLine(x: CanvasRenderingContext2D, t: string, px: number, py: number, ls: number): void {
  if (!ls) { x.fillText(t, px, py); return; }
  let cx = px;
  for (const ch of t) { x.fillText(ch, cx, py); cx += x.measureText(ch).width + ls; }
}
/** Draw a text layer's words into pixels (the browser's own fonts). */
export function renderText(c: TextContent): Placed {
  const st = c.style, m = meas();
  m.font = fontString(st);
  const lay = layoutText(c, (s) => m.measureText(s).width), pad = Math.ceil(st.size * 0.35) + 2;
  const x0 = Math.floor(lay.box.x - pad), y0 = Math.floor(lay.box.y - pad), w = Math.ceil(lay.box.w + 2 * pad), hh = Math.ceil(lay.box.h + 2 * pad);
  const x = ctx2d(w, hh);
  x.font = fontString(st);
  x.fillStyle = st.color;
  x.textBaseline = 'alphabetic';
  const asc = st.size * 0.8 + (lay.advance - st.size) / 2;
  for (const ln of lay.lines) drawLine(x, ln.text, ln.x - x0, ln.y - y0 + asc, st.letterSpacing);
  return { x: x0, y: y0, width: x.canvas.width, height: x.canvas.height, data: x.getImageData(0, 0, x.canvas.width, x.canvas.height).data };
}
/** Draw a shape layer into pixels. */
export function renderShape(s: ShapeContent): Placed {
  const b = shapeBounds(s), x = ctx2d(b.w, b.h), pts = shapePoints(s);
  x.translate(-b.x, -b.y);
  x.lineJoin = 'round';
  x.lineCap = 'round';
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  if (s.shape === 'line') {
    x.strokeStyle = s.stroke ?? s.fill ?? '#000000';
    x.lineWidth = Math.max(1, s.strokeWidth);
    x.stroke();
    const ah = arrowHead(s);
    if (ah) { x.beginPath(); ah.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fillStyle = x.strokeStyle; x.fill(); }
  } else {
    x.closePath();
    if (s.fill) { x.fillStyle = s.fill; x.fill(); }
    if (s.stroke && s.strokeWidth > 0) { x.strokeStyle = s.stroke; x.lineWidth = s.strokeWidth; x.stroke(); }
  }
  return { x: b.x, y: b.y, width: x.canvas.width, height: x.canvas.height, data: x.getImageData(0, 0, x.canvas.width, x.canvas.height).data };
}
const renderContent = (c: LayerContent): Placed => (c.kind === 'text' ? renderText(c) : renderShape(c));
const snapOf = (c: LayerContent, p: Placed): Snap => ({ content: { ...c, at: { x: p.x, y: p.y } }, geom: { x: p.x, y: p.y, width: p.width, height: p.height, data: p.data } });
function applySnap(l: Layer, s: Snap): void { setGeom(l, s.geom); if (s.content) l.content = s.content; else delete l.content; }
/** A change already made to a layer's content and pixels, as an undoable step. */
function liveCommand(label: string, id: string, before: Snap, after: Snap): Command {
  const go = (d: Doc, s: Snap): void => { const l = findLayer(d, id); if (l) applySnap(l, s); };
  return { label, bytes: after.geom.data.length, undo: (d) => go(d, before), redo: (d) => go(d, after) };
}
function selCommand(label: string, before: Selection | null, after: Selection | null): Command {
  return { label, bytes: (before?.alpha?.length ?? 0) + (after?.alpha?.length ?? 0), undo(d) { d.selection = before; }, redo(d) { d.selection = after; } };
}

export function createToolKit(host: ToolHost): ToolKit {
  const S = {
    mode: 'new' as SelMode, tolerance: 32, contiguous: true, allLayers: true, eraseAll: false, feather: 0, qs: 24, rm: 50,
    grad: { kind: 'linear' as GradientKind, preset: 0, opacity: 1, reverse: false }, bucketOpacity: 1,
    fx: {
      clone: [40, 0.6, 1], heal: [40, 0.6, 1], 'spot-heal': [30, 0.7, 1], dodge: [60, 0.2, 0.5], burn: [60, 0.2, 0.5], sponge: [60, 0.2, 0.6],
      blur: [40, 0.3, 0.7], sharpen: [40, 0.3, 0.5], smudge: [30, 0.3, 0.6], 'color-replace': [40, 0.6, 1], 'history-brush': [40, 0.5, 1], 'bg-eraser': [50, 0.8, 1],
    } as Record<string, [number, number, number]>,
    range: 'midtones' as 'shadows' | 'midtones' | 'highlights', spongeMore: false, replTol: 48, bgTol: 40, aligned: true,
    redEye: { size: 24, darken: 0.6 },
    text: { ...DEFAULT_TEXT_STYLE } as TextStyle,
    shape: { fill: true, stroke: false, strokeWidth: 4, radius: 24, sides: 5, star: false, arrow: true, lineWidth: 6 },
  };
  let g: Gesture | null = null, poly: { pts: Pt[]; mode: SelMode } | null = null, xf: Xf | null = null, te: TextEdit | null = null;
  let rm: { mask: Mask; cv: HTMLCanvasElement; busy: boolean } | null = null;
  let qm: { mask: Mask; cv: HTMLCanvasElement } | null = null, src: { pt: Pt; offset: Pt | null } | null = null, pickSource = false;
  let lastClick = { t: 0, x: 0, y: 0 }, fonts: string[] | null = null;
  const saved = new WeakMap<Doc, Selection>(), bodies = new Map<string, HTMLElement>(), panels = new Map<string, HTMLElement>();

  const doc = (): Doc | null => host.doc();
  const z = (): number => host.view().zoom;
  const scr = (p: Pt): Pt => { const v = host.view(); return { x: v.panX + p.x * v.zoom, y: v.panY + p.y * v.zoom }; };
  const fgc = (): RGBA => parseHex(host.fg()) ?? BLACK;
  const fxo = (t: ToolId): [number, number, number] => S.fx[t] ?? [40, 0.5, 1];
  const xfHandles = (x: Xf): Pt[] => [...x.q, ...x.q.map((a, k) => { const b = x.q[(k + 1) % 4]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })];
  /** Clone and heal copy from point + offset: true when that source falls outside the layer or the picture (nothing to copy). */
  const srcOut = (d: Doc, l: Layer, p: Pt, off: Pt): boolean => {
    const x = p.x + off.x, y = p.y + off.y, r = layerRect(l);
    return x < Math.max(0, r.x) || y < Math.max(0, r.y) || x >= Math.min(d.width, r.x + r.w) || y >= Math.min(d.height, r.y + r.h);
  };
  const inLayer = (l: Layer, p: Pt): boolean => { const r = layerRect(l); return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h; };
  const modeOf = (i: PointerInfo, fallback = S.mode): SelMode => (i.shift && i.alt ? 'intersect' : i.shift ? 'add' : i.alt ? 'subtract' : fallback);
  const pixelsFor = (d: Doc, all: boolean): Pixels => {
    const l = activeLayer(d);
    return all || !l ? { width: d.width, height: d.height, data: compositeDoc(d, docRect(d)) } : layerOnCanvas(l, d.width, d.height);
  };
  function target(onMask = false): Layer | null {
    const d = doc(), l = d ? activeLayer(d) : undefined;
    if (!d || !l || !host.editable(l, true, onMask)) return null;
    if (!l.visible) { host.toast('This layer is hidden. Show it to change it.'); return null; }
    return l;
  }
  function setSel(next: Selection | null, label: string): void {
    const d = doc();
    if (!d) return;
    const before = d.selection;
    host.rememberSel(before);
    host.forgetHole();
    d.selection = next;
    host.push(selCommand(label, before, next));
    host.selectionChanged();
  }
  function applyMask(m: Mask, mode: SelMode, label: string): void {
    const d = doc();
    if (!d) return;
    if (S.feather > 0) m = featherMask(m, S.feather);
    setSel(selectionFromMask(combineMasks(mode === 'new' || !d.selection ? null : maskFromSelection(d.selection, d.width, d.height), m, mode)), label);
  }

  // ---------- quick mask ----------
  function tint(r: Rect): void {
    if (!qm) return;
    const { mask, cv } = qm, x = cv.getContext('2d'), d = doc();
    const c = d ? r && { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(mask.width, r.x + r.w) - Math.max(0, r.x), h: Math.min(mask.height, r.y + r.h) - Math.max(0, r.y) } : null;
    if (!x || !c || c.w <= 0 || c.h <= 0) return;
    const img = x.createImageData(c.w, c.h);
    for (let y = 0; y < c.h; y++) for (let xx = 0; xx < c.w; xx++) {
      const v = mask.data[(c.y + y) * mask.width + c.x + xx], i = (y * c.w + xx) * 4;
      img.data[i] = 230; img.data[i + 1] = 40; img.data[i + 2] = 60; img.data[i + 3] = (255 - v) * 0.55;
    }
    x.putImageData(img, c.x, c.y);
  }
  function toggleQm(): void {
    const d = doc();
    if (!d) return;
    if (qm) {
      const m = qm.mask;
      qm = null;
      setSel(selectionFromMask(m), 'Paint a selection');
      host.toast('Back to a selection.');
    } else {
      const cv = h('canvas', { width: d.width, height: d.height });
      qm = { mask: maskFromSelection(d.selection, d.width, d.height), cv };
      tint(docRect(d));
      if (!['brush', 'pencil', 'eraser'].includes(host.tool())) host.setTool('brush');
      host.toast('Paint to add to the selection; the eraser takes away. Press Q or Done to finish.');
    }
    syncQmButton();
    host.refreshOptions();
    host.render();
  }
  function syncQmButton(): void { host.root.querySelector('[data-testid="tool-quick-mask"]')?.setAttribute('aria-pressed', String(!!qm)); }
  /** Remove an object: paint what should go into a mask, shown over the picture in red. */
  function rmDab(cx: number, cy: number, size: number): void {
    if (!rm) return;
    const m = rm.mask, r = Math.max(1, size / 2);
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(m.width, Math.ceil(cx + r)), y1 = Math.min(m.height, Math.ceil(cy + r));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) m.data[y * m.width + x] = 255;
    const c = rm.cv.getContext('2d');
    if (c) { c.fillStyle = '#ff3b30'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); }
  }
  function qmDab(cx: number, cy: number, size: number, hard: number, erase: boolean): void {
    if (!qm) return;
    const m = qm.mask, r = Math.max(0.5, size / 2), feather = Math.max(1, r * (1 - hard)), start = r - feather;
    const x0 = Math.max(0, Math.floor(cx - r - 1)), y0 = Math.max(0, Math.floor(cy - r - 1)), x1 = Math.min(m.width, Math.ceil(cx + r + 1)), y1 = Math.min(m.height, Math.ceil(cy + r + 1));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      let cov = 1;
      if (dd > start) { const t = (dd - start) / (feather + 0.5); if (t >= 1) continue; cov = 1 - t * t * (3 - 2 * t); }
      const p = y * m.width + x, v = cov * 255;
      m.data[p] = erase ? Math.min(m.data[p], 255 - v) : Math.max(m.data[p], v);
    }
    tint({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  // ---------- free transform ----------
  /** The view before a transform moved it to show its handles, and the zoom right after: put back when the transform ends unless the zoom changed. */
  let xfBack: { v: View; fitted: boolean; zoom: number } | null = null;
  function startXf(target: 'layer' | 'selection', mode: XfMode): void {
    const d = doc();
    if (!d) return;
    if (xf) commitXf();
    if (target === 'selection') {
      const s = d.selection;
      if (!s) { host.toast('Select an area first.'); return; }
      xf = { target, id: '', mode, orig: null, sel0: s, base: quadOfRect(s), q: quadOfRect(s), raf: 0 };
    } else {
      const l = activeLayer(d);
      if (!l || !host.editable(l, false)) return;
      if (l.locked) return;
      if (isFolderNode(l)) {
        // A folder: one box around everything inside; each layer keeps its starting pixels for the preview and Esc.
        const box = effectiveBox(d.layers, l);
        if (!box) { host.toast('This folder has nothing in it to transform yet.'); return; }
        const kids = subtreeNodes(d.layers, l.id).filter((c) => hasPx(c)).map((c) => ({ id: c.id, orig: { ...geomOf(c) } }));
        xf = { target, id: l.id, mode, orig: null, kids, sel0: null, base: quadOfRect(box), q: quadOfRect(box), raf: 0 };
      } else xf = { target, id: l.id, mode, orig: { ...geomOf(l) }, sel0: null, base: quadOfRect(layerRect(l)), q: quadOfRect(layerRect(l)), raf: 0 };
    }
    const xs = (xf as Xf).q.map((c) => c.x), ys = (xf as Xf).q.map((c) => c.y), bx = Math.min(...xs), by = Math.min(...ys), v0 = { ...host.view() }, f0 = host.fitted();
    host.fitBox({ x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by }, host.layout() === 'phone' ? 44 : 36);
    xfBack = { v: v0, fitted: f0, zoom: host.view().zoom };
    host.toast('Drag the handles to resize, outside the box to turn. Enter applies, Esc cancels.');
    host.refreshOptions();
    host.render();
  }
  function previewXf(): void {
    const x = xf;
    if (!x || x.raf) return;
    x.raf = requestAnimationFrame(() => {
      x.raf = 0;
      const d = doc();
      if (!d || xf !== x) return;
      if (x.target === 'selection' && x.sel0) { d.selection = transformSelection(x.sel0, x.q, d.width, d.height); host.render(); return; }
      if (x.kids) {
        const pad = Math.max(d.width, d.height), lim = { x: -pad, y: -pad, w: d.width + 2 * pad, h: d.height + 2 * pad };
        let r: ReturnType<typeof layerRect> | null = null;
        for (const k of x.kids) {
          const c = findLayer(d, k.id), g = k.orig, q = carryQuad(x.base, x.q, { x: g.x, y: g.y, w: g.width, h: g.height });
          const pl = c && q ? warpBitmap({ width: g.width, height: g.height, data: g.data }, q, false, lim) : null;
          if (!c || !pl) continue;
          const old = layerRect(c);
          setGeom(c, pl);
          r = union(r, union(old, layerRect(c)));
        }
        if (r) host.dirty(r);
        return;
      }
      const l = findLayer(d, x.id), o = x.orig;
      if (!l || !o) return;
      const old = layerRect(l), pad = Math.max(d.width, d.height);
      const pl = warpBitmap({ width: o.width, height: o.height, data: o.data }, x.q, false, { x: -pad, y: -pad, w: d.width + 2 * pad, h: d.height + 2 * pad });
      if (!pl) return;
      setGeom(l, pl);
      host.dirty(union(old, layerRect(l)));
    });
  }
  function endXf(apply: boolean): void {
    const x = xf, d = doc();
    if (!x || !d) { xf = null; return; }
    xf = null;
    if (x.raf) cancelAnimationFrame(x.raf);
    const same = x.q.every((p, i) => Math.abs(p.x - x.base[i].x) < 0.01 && Math.abs(p.y - x.base[i].y) < 0.01);
    if (x.target === 'selection') {
      d.selection = x.sel0;
      if (apply && !same && x.sel0) setSel(transformSelection(x.sel0, x.q, d.width, d.height), 'Transform selection');
      else host.selectionChanged();
    } else {
      const l = findLayer(d, x.id);
      if (x.kids) {
        for (const k of x.kids) { const c = findLayer(d, k.id); if (c) setGeom(c, k.orig); }
        const had = x.kids.some((k) => !!findLayer(d, k.id)?.content);
        if (apply && !same) {
          host.push(transformNode(d, x.id, x.q, 'Free transform', true), true);
          if (had) host.toast('Transformed. Text and shapes in the folder are plain pixels now.');
        } else host.all();
      } else if (l && x.orig) {
        setGeom(l, x.orig);
        if (apply && !same) {
          const hadContent = !!l.content, cmd = transformLayer(d, l, x.q, 'Free transform', true);
          host.push(hadContent ? combineCommands('Free transform', [cmd, contentCommand(d, l.id, null, null, 'Turn into pixels')]) : cmd, true);
          if (hadContent) host.toast('Transformed. The layer is plain pixels now.');
        } else host.all();
      }
    }
    const back = xfBack;
    xfBack = null;
    if (back && Math.abs(host.view().zoom - back.zoom) < 1e-9) host.restoreView(back.v, back.fitted);
    host.refreshOptions();
    host.render();
  }
  const commitXf = (): void => endXf(true);
  function hitXf(p: Pt, touch: boolean): string {
    const x = xf as Xf, s = scr(p), R = touch ? 22 : 10;
    for (let k = 0; k < 4; k++) { const c = scr(x.q[k]); if (Math.hypot(c.x - s.x, c.y - s.y) <= R) return 'c' + k; }
    for (let k = 0; k < 4; k++) {
      const a = x.q[k], b = x.q[(k + 1) % 4], c = scr({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (Math.hypot(c.x - s.x, c.y - s.y) <= R) return 'e' + k;
    }
    return inQuad(x.q, p) ? 'move' : 'rotate';
  }
  function dragXf(hd: string, p0: Pt, p: Pt, q0: Quad, i: PointerInfo): Quad {
    const dx = p.x - p0.x, dy = p.y - p0.y, q = q0.map((c) => ({ ...c })) as Quad;
    if (hd === 'move') return q0.map((c) => ({ x: c.x + dx, y: c.y + dy })) as Quad;
    const C = centroid(q0);
    if (hd === 'rotate') {
      let a = Math.atan2(p.y - C.y, p.x - C.x) - Math.atan2(p0.y - C.y, p0.x - C.x);
      if (i.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const cs = Math.cos(a), sn = Math.sin(a);
      return q0.map((c) => ({ x: C.x + (c.x - C.x) * cs - (c.y - C.y) * sn, y: C.y + (c.x - C.x) * sn + (c.y - C.y) * cs })) as Quad;
    }
    const corner = hd[0] === 'c', k = Number(hd[1]);
    let mode = (xf as Xf).mode;
    if (mode === 'free' && i.ctrl) mode = corner ? (i.alt && i.shift ? 'perspective' : 'distort') : 'skew';
    if (mode === 'distort') {
      if (corner) q[k] = { x: q0[k].x + dx, y: q0[k].y + dy };
      else for (const j of [k, (k + 1) % 4]) q[j] = { x: q0[j].x + dx, y: q0[j].y + dy };
      return q;
    }
    if (mode === 'skew' || mode === 'perspective') {
      const e = corner ? (k < 2 ? 0 : 2) : k, dir = unit(q0[e], q0[(e + 1) % 4]), s = dx * dir.x + dy * dir.y;
      if (!corner) { for (const j of [k, (k + 1) % 4]) q[j] = { x: q0[j].x + dir.x * s, y: q0[j].y + dir.y * s }; return q; }
      q[k] = { x: q0[k].x + dir.x * s, y: q0[k].y + dir.y * s };
      if (mode === 'perspective') { const o = e === 0 ? (k === 0 ? 1 : 0) : k === 2 ? 3 : 2; q[o] = { x: q0[o].x - dir.x * s, y: q0[o].y - dir.y * s }; }
      return q;
    }
    const ux = unit(q0[0], q0[1]), uy = { x: -ux.y, y: ux.x };
    const A = corner ? q0[(k + 2) % 4] : { x: (q0[(k + 2) % 4].x + q0[(k + 3) % 4].x) / 2, y: (q0[(k + 2) % 4].y + q0[(k + 3) % 4].y) / 2 };
    const dot = (v: Pt, u: Pt): number => v.x * u.x + v.y * u.y, v0 = { x: p0.x - A.x, y: p0.y - A.y }, v = { x: p.x - A.x, y: p.y - A.y };
    let sx = Math.abs(dot(v0, ux)) > 1e-6 ? dot(v, ux) / dot(v0, ux) : 1, sy = Math.abs(dot(v0, uy)) > 1e-6 ? dot(v, uy) / dot(v0, uy) : 1;
    if (corner) { if (!i.shift) { const s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; sx = s; sy = s; } }
    else if (k === 0 || k === 2) sx = 1; else sy = 1;
    return q0.map((c) => { const a = dot({ x: c.x - A.x, y: c.y - A.y }, ux), b = dot({ x: c.x - A.x, y: c.y - A.y }, uy);
      return { x: A.x + ux.x * a * sx + uy.x * b * sy, y: A.y + ux.y * a * sx + uy.y * b * sy }; }) as Quad;
  }

  // ---------- text ----------
  function availableFonts(): string[] {
    if (fonts) return fonts;
    const m = meas(), probe = 'mmmmmmmmmmlli1WQ@#';
    const width = (f: string): number => { m.font = `40px ${f}`; return m.measureText(probe).width; };
    const mono = width('monospace'), serif = width('serif');
    fonts = FONT_CANDIDATES.filter((f) => GENERIC.has(f) || width(`"${f}", monospace`) !== mono || width(`"${f}", serif`) !== serif);
    return fonts;
  }
  const textLayer = (): Layer | null => { const d = doc(), l = d ? activeLayer(d) : undefined; return l?.content?.kind === 'text' ? l : null; };
  const styleNow = (): TextStyle => te?.content.style ?? (textLayer()?.content as TextContent | undefined)?.style ?? S.text;
  function placeArea(): void {
    const t = te, d = doc();
    if (!t || !d) return;
    const cv = host.canvas().getBoundingClientRect(), rr = host.root.getBoundingClientRect(), st = t.content.style, m = meas();
    m.font = fontString(st);
    const lay = layoutText(t.content, (s) => m.measureText(s).width), zz = z(), w = Math.max(lay.box.w, st.size * 3) * zz + 24;
    const anchor = scr({ x: t.content.x, y: t.content.y }), left = st.align === 'center' ? anchor.x - w / 2 : st.align === 'right' ? anchor.x - w + 12 : anchor.x - 2;
    Object.assign(t.area.style, {
      left: cv.left - rr.left + left + 'px', top: cv.top - rr.top + anchor.y + 'px', width: w + 'px', height: lay.box.h * zz + st.size * zz * 0.4 + 'px',
      font: fontString(st, st.size * zz), lineHeight: st.size * st.lineHeight * zz + 'px', letterSpacing: st.letterSpacing * zz + 'px', textAlign: st.align,
    });
  }
  function drawText(): void {
    const t = te, d = doc(), l = t && d ? findLayer(d, t.id) : undefined;
    if (!t || !l) return;
    const old = layerRect(l), sn = snapOf(t.content, renderText(t.content));
    applySnap(l, sn);
    host.dirty(union(old, layerRect(l)));
    placeArea();
  }
  function openArea(t: TextEdit): void {
    const a = t.area;
    a.value = t.content.text;
    a.addEventListener('input', () => { if (te === t) { t.content = { ...t.content, text: a.value }; drawText(); } });
    host.root.append(a);
    placeArea();
    requestAnimationFrame(() => a.focus({ preventScroll: true }));
  }
  const newArea = (): HTMLTextAreaElement => h('textarea', { class: 'fpe-textedit', 'aria-label': 'Your words', 'data-testid': 'text-edit', spellcheck: 'false',
    style: 'position:absolute;z-index:6;margin:0;padding:0;border:0;outline:1px dashed rgba(120,170,255,.9);background:transparent;color:transparent;caret-color:#78aaff;resize:none;overflow:hidden;white-space:pre' });
  function beginText(p: Pt): void {
    const d = doc();
    if (!d) return;
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i], r = layerRect(l);
      if (l.content?.kind === 'text' && l.visible && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h) { editText(l); return; }
    }
    const style: TextStyle = { ...S.text, color: host.fg() };
    const c: TextContent = { kind: 'text', text: '', x: Math.round(p.x), y: Math.round(p.y - style.size * 0.8 - (style.size * style.lineHeight - style.size) / 2), style };
    const layer = createLayer('Text', 1, 1, { x: c.x, y: c.y }), add = addLayer(d, layer, indexOfLayer(d, d.activeId) + 1, 'Add text');
    te = { id: layer.id, add, before: { content: null, geom: geomOf(layer) }, content: c, area: newArea() };
    openArea(te);
    drawText();
    host.panels();
    host.refreshOptions();
  }
  function editText(l: Layer): void {
    const d = doc(), c = currentContent(l);
    if (!d || c?.kind !== 'text') return;
    d.activeId = l.id;
    te = { id: l.id, add: null, before: { content: l.content ?? null, geom: geomOf(l) }, content: c, area: newArea() };
    openArea(te);
    host.panels();
    host.refreshOptions();
    host.render();
  }
  function commitText(): void {
    const t = te, d = doc();
    if (!t) return;
    te = null;
    t.area.remove();
    const l = d ? findLayer(d, t.id) : undefined;
    if (!d || !l) return;
    if (!t.content.text.trim()) {
      if (t.add) t.add.undo(d); else applySnap(l, t.before);
      host.all(); host.panels(); host.refreshOptions();
      return;
    }
    if (t.add) l.name = t.content.text.trim().split('\n')[0].slice(0, 28);
    const cmd = liveCommand(t.add ? 'Add text' : 'Edit text', t.id, t.before, { content: l.content ?? null, geom: geomOf(l) });
    host.push(t.add ? combineCommands('Add text', [t.add, cmd]) : cmd, true);
    host.refreshOptions();
  }
  function restyle(patch: Partial<TextStyle>): void {
    S.text = { ...S.text, ...patch };
    if (te) { te.content = { ...te.content, style: { ...te.content.style, ...patch } }; drawText(); return; }
    const l = textLayer(), d = doc(), c = l ? currentContent(l) : null;
    if (!l || !d || c?.kind !== 'text') return;
    const before = { content: l.content ?? null, geom: geomOf(l) }, sn = snapOf({ ...c, style: { ...c.style, ...patch } }, renderText({ ...c, style: { ...c.style, ...patch } }));
    applySnap(l, sn);
    host.push(liveCommand('Text style', l.id, before, sn), true);
  }
  function textControls(which: 'char' | 'para' | 'bar'): HTMLElement[] {
    const st = styleNow(), out: HTMLElement[] = [], u = host.uid;
    const field = (label: string, help: string, control: HTMLElement): HTMLElement =>
      h('label', { class: 'fpe-field fpe-w3-field', 'data-help-title': label, 'data-help': help }, h('span', { class: 'fpe-w3-label' }, label), control);
    const num = (testid: string, v: number, min: number, max: number, step: number, set: (n: number) => void): HTMLInputElement => {
      const i = h('input', { type: 'number', min, max, step, value: String(v), 'data-testid': testid, id: `fpe-${u}-${which}-${testid}`, class: 'fpe-w3-num' });
      i.addEventListener('change', () => { const n = Number(i.value); if (Number.isFinite(n)) set(clamp(n, min, max)); });
      return i;
    };
    const toggle = (testid: string, label: string, on: boolean, help: string, set: () => void, now: () => boolean): HTMLElement => {
      const b: HTMLElement = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'aria-pressed': String(on), 'data-testid': testid, 'data-help-title': label, 'data-help': help,
        onclick: () => { set(); b.setAttribute('aria-pressed', String(now())); } }, label);
      return b;
    };
    if (which !== 'para') {
      const sel = h('select', { 'data-testid': 'text-font', 'aria-label': 'Font' }, ...availableFonts().map((f) => h('option', { value: f }, f)));
      sel.value = st.font;
      sel.addEventListener('change', () => restyle({ font: sel.value }));
      const col = h('input', { type: 'color', value: st.color, 'data-testid': 'text-color', 'aria-label': 'Text colour' });
      col.addEventListener('input', () => restyle({ color: col.value }));
      out.push(field('Font', 'The typeface. Fonts on this device are listed.', sel),
        field('Size', 'How tall the letters are, in pixels.', num('text-size', st.size, 4, 1000, 1, (n) => restyle({ size: n }))),
        field('Colour', 'The colour of the words.', col),
        toggle('text-bold', 'Bold', st.bold, 'Thicker letters.', () => restyle({ bold: !styleNow().bold }), () => styleNow().bold),
        toggle('text-italic', 'Slanted · Italic', st.italic, 'Slanted letters (italic).', () => restyle({ italic: !styleNow().italic }), () => styleNow().italic),
        field('Letter gap', 'Extra space between letters, in pixels (tracking).', num('text-tracking', st.letterSpacing, -50, 200, 1, (n) => restyle({ letterSpacing: n }))));
    }
    if (which !== 'char') {
      const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Line up' });
      for (const [a, label] of [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as const) {
        seg.append(h('button', { type: 'button', 'aria-pressed': String(st.align === a), 'data-testid': 'text-align-' + a, onclick: () => {
          restyle({ align: a });
          for (const b of seg.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.testid === 'text-align-' + styleNow().align));
        } }, label));
      }
      out.push(seg, field('Line gap', 'Distance between lines, as a multiple of the size (leading).', num('text-leading', st.lineHeight, 0.5, 4, 0.05, (n) => restyle({ lineHeight: n }))));
    }
    return out;
  }
  function fillPanel(pid: string, body: HTMLElement): void {
    panels.set(pid, body);
    if (body.contains(document.activeElement)) return;
    const which = pid === 'character' ? 'char' : 'para';
    body.replaceChildren(h('p', { class: 'fpe-note' }, textLayer() || te ? 'Changes apply to the selected text layer.' : 'Settings for the next text you add. Pick the Text tool and click the picture.'),
      h('div', { class: 'fpe-stack fpe-w3-panel' }, ...textControls(which)));
  }

  // ---------- shapes ----------
  function shapeOf(kind: ShapeKind, a: Pt, b: Pt, shift: boolean): ShapeContent {
    let x1 = b.x, y1 = b.y;
    if (shift && kind === 'line') {
      const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(b.x - a.x, b.y - a.y);
      x1 = a.x + Math.cos(ang) * len; y1 = a.y + Math.sin(ang) * len;
    } else if (shift) { const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); x1 = a.x + Math.sign(b.x - a.x || 1) * s; y1 = a.y + Math.sign(b.y - a.y || 1) * s; }
    const sh = S.shape, line = kind === 'line';
    const fill = line ? null : sh.fill ? host.fg() : null, stroke = line ? host.fg() : sh.stroke ? host.bg() : null;
    return { kind: 'shape', shape: kind, x0: a.x, y0: a.y, x1, y1, fill: fill ?? (stroke ? null : host.fg()), stroke, strokeWidth: line ? sh.lineWidth : sh.strokeWidth,
      radius: sh.radius, sides: sh.sides, star: sh.star, arrow: sh.arrow };
  }
  function makeShape(t: ToolId, a: Pt, b: Pt, shift: boolean): void {
    const d = doc(), def = SHAPES[t];
    if (!d || !def || Math.hypot(b.x - a.x, b.y - a.y) < 3) return;
    const s = shapeOf(def[0], a, b, shift), pl = renderShape(s), layer = createLayer(def[1], pl.width, pl.height, { x: pl.x, y: pl.y, data: pl.data });
    layer.content = { ...s, at: { x: pl.x, y: pl.y } };
    host.push(addLayer(d, layer, indexOfLayer(d, d.activeId) + 1, def[1]), true);
    host.panels();
    host.refreshOptions();
  }
  function reshape(patch: Partial<ShapeContent>): void {
    const d = doc(), l = d ? activeLayer(d) : undefined, c = l ? currentContent(l) : null;
    if (!d || !l || c?.kind !== 'shape') return;
    const next = { ...c, ...patch }, before = { content: l.content ?? null, geom: geomOf(l) }, sn = snapOf(next, renderShape(next));
    applySnap(l, sn);
    host.push(liveCommand('Shape settings', l.id, before, sn), true);
  }
  function rasterize(): void {
    const d = doc(), l = d ? activeLayer(d) : undefined;
    if (!d || !l) return;
    if (!l.content) { host.toast('This layer is already plain pixels.'); return; }
    if (te?.id === l.id) commitText();
    host.push(contentCommand(d, l.id, null, null, 'Turn into plain pixels'), true);
    host.toast(`"${l.name}" is plain pixels now: paint, erase and filter it like a photo.`);
    host.refreshOptions();
  }

  // ---------- one-click tools ----------
  /**
   * Paint bucket: fills what you see at the spot with the main colour, growing the layer when the spot lies outside it.
   * A layer it may not paint (text, shape, hidden or locked) is left alone: the fill goes on a new layer just above it,
   * in the same undo step. Only a spot off the picture, or outside the selected area, is turned down, with the reason.
   */
  function bucket(d: Doc, p: Pt): void {
    const x = Math.floor(p.x), y = Math.floor(p.y), l = activeLayer(d);
    if (!l) return;
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) { host.toast('That spot is outside the picture. Click on the picture to fill there.'); return; }
    if (d.selection && !selectionAlpha(d.selection, x, y)) {
      host.toast('That spot is outside the selected area. Click inside it, or choose Select › Select nothing to fill anywhere.');
      return;
    }
    const o = { color: fgc(), tolerance: S.tolerance, contiguous: S.contiguous, allLayers: S.allLayers, opacity: S.bucketOpacity };
    const why = l.locked ? 'is locked' : !l.visible ? 'is hidden' : l.content?.kind === 'text' ? 'is a text layer' : l.content ? 'is a shape layer' : '';
    if (!why) {
      // The layer is unlocked, shown and plain pixels, so editable() can only refuse here: the mask is the target.
      if (!host.editable(l, true)) return;
      const cmd = bucketFill(d, l, x, y, o);
      if (cmd) host.push(cmd, true); else host.toast('Nothing to fill there.');
      return;
    }
    const add = addLayer(d, createLayer(nextLayerName(d), d.width, d.height), indexOfLayer(d, l.id) + 1, 'New layer');
    const nl = activeLayer(d), fill = nl ? bucketFill(d, nl, x, y, { ...o, allLayers: true }) : null;
    if (!fill) { add.undo(d); host.toast('Nothing to fill there.'); return; }
    host.push(combineCommands('Fill an area', [add, fill]), true);
    host.panels();
    host.toast(`Filled on a new layer above “${l.name}”, because that layer ${why}.`);
  }
  function clickTool(t: ToolId, p: Pt, i: PointerInfo): void {
    const d = doc();
    if (!d) return;
    if (t === 'wand') { applyMask(wandMask(pixelsFor(d, S.allLayers), p.x, p.y, S.tolerance, S.contiguous), modeOf(i), 'Select similar colour'); return; }
    if (t === 'bucket') { bucket(d, p); return; }
    const l = target();
    if (!l) return;
    if (t === 'magic-eraser') {
      const cmd = magicErase(d, l, p.x, p.y, S.tolerance, S.contiguous, S.eraseAll);
      if (cmd) host.push(cmd, true); else host.toast('Nothing to erase there.');
    } else if (t === 'red-eye') {
      const cmd = redEye(d, l, p.x, p.y, S.redEye);
      if (cmd) { host.push(cmd, true); host.toast('Red eye fixed.'); } else host.toast('No red eye found here. Click right on the red part of the eye.');
    }
  }
  function setSource(p: Pt): void {
    src = { pt: { x: Math.round(p.x), y: Math.round(p.y) }, offset: null };
    pickSource = false;
    host.toast('Source picked. Now paint where you want the copy.');
    host.refreshOptions();
    host.render();
  }
  /** The active layer as it looked at the History step marked "Paint from here" (at first, as the picture was opened). */
  function stepLayer(d: Doc, id: string): Placed | null {
    const hist = host.history(), n = hist.entries().index, want = host.paintFrom();
    const t = want ? hist.stepIds().indexOf(want) + 1 : 0;
    if (want && !t) host.paintFromGone();
    let k = n;
    const go = (to: number): void => { while (k > to && hist.undo(d)) k--; while (k < to && hist.redo(d)) k++; };
    go(t);
    const l = findLayer(d, id), snap = l ? { x: l.x, y: l.y, width: l.width, height: l.height, data: l.data.slice() } : null;
    go(n);
    return snap;
  }
  function startFx(t: ToolId, p: Pt, i: PointerInfo): void {
    const d = doc(), kind = FX[t];
    if (!d || !kind) return;
    if ((kind === 'clone' || kind === 'heal') && (i.alt || pickSource)) { setSource(p); return; }
    let l = target();
    if (!l) return;
    if ((kind === 'clone' || kind === 'heal') && !src) { host.toast('First pick where to copy from: Alt-click there, or press and hold on a touch screen.'); return; }
    let offset: Pt | undefined;
    if (src && (kind === 'clone' || kind === 'heal')) { if (!src.offset || !S.aligned) src.offset = { x: src.pt.x - p.x, y: src.pt.y - p.y }; offset = src.offset; }
    let source: Placed | null = null;
    if (kind === 'history') {
      source = stepLayer(d, l.id);
      l = findLayer(d, l.id) ?? null;
      if (!source || !l) { host.toast('This layer did not exist yet at the step marked in History, so there is nothing to paint back.'); return; }
      host.all();
    }
    const [size, hardness, strength] = fxo(t);
    const s = new EffectStroke(d, l, { kind, size, hardness, strength, offset, range: S.range, more: S.spongeMore, color: fgc(),
      tolerance: kind === 'bg-erase' ? S.bgTol : S.replTol, source });
    const warned = !!offset && srcOut(d, l, p, offset);
    g = { k: 'fx', s, t, off: offset, l, warned };
    if (warned) host.toast(OFF_PICTURE);
    s.add(sp(p, i, size));
    flush();
  }
  const sp = (p: Pt, i: PointerInfo, size: number): { x: number; y: number; size?: number } =>
    i.type === 'pen' ? { x: p.x, y: p.y, size: size * (0.2 + 0.8 * clamp(i.pressure, 0.05, 1)) } : { x: p.x, y: p.y };
  function flush(): void { if (g?.k === 'fx') { const r = g.s.takeDirty(); if (r) host.dirty(r); } }
  function quickUpdate(final: boolean): void {
    const d = doc();
    if (!d || g?.k !== 'quick') return;
    const q = g;
    if (!final && now() - q.at < 45) return;
    q.at = now();
    const m = quickSelectMask(q.src, q.pts, S.qs / 2);
    d.selection = selectionFromMask(combineMasks(q.base, m, q.base ? q.mode : 'new'));
    host.forgetHole();
    if (final) { const after = d.selection; d.selection = q.before; setSel(after, 'Paint to select'); } else host.selectionChanged();
  }

  // ---------- pointer ----------
  function start(p: Pt, i: PointerInfo): void {
    const d = doc(), t = host.tool();
    if (!d) return;
    if (xf) { g = { k: 'xf', hd: hitXf(p, i.type === 'touch'), p0: p, q0: xf.q.map((c) => ({ ...c })) as Quad }; return; }
    if (qm && (t === 'brush' || t === 'pencil' || t === 'eraser')) {
      const o = host.paint(t);
      g = { k: 'qm', last: p, erase: t === 'eraser', size: o.size, hard: t === 'pencil' ? 1 : o.hardness };
      qmDab(p.x, p.y, o.size, g.hard, g.erase);
      host.render();
      return;
    }
    if (te && t === 'type') {
      const r = findLayer(d, te.id), b = r ? layerRect(r) : null;
      if (b && p.x >= b.x && p.y >= b.y && p.x < b.x + b.w && p.y < b.y + b.h) { te.area.focus(); return; }
      commitText();
    }
    switch (t) {
      case 'remove': {
        if (rm?.busy) { host.toast('Wait a moment: the last removal is still working.'); return; }
        // Removing changes pixels only: while the mask is the target it refuses before any painting (text, shape and locked
        // layers keep their fill on a new layer).
        const al = activeLayer(d);
        if (al?.mask && !al.content && !al.locked && !host.editable(al, true)) return;
        const cv = document.createElement('canvas');
        cv.width = d.width;
        cv.height = d.height;
        rm = { mask: { width: d.width, height: d.height, data: new Uint8Array(d.width * d.height) }, cv, busy: false };
        g = { k: 'rm', last: p, size: S.rm };
        rmDab(p.x, p.y, S.rm);
        host.render();
        break;
      }
      case 'object-select': g = { k: 'obj', a: p, b: p, mode: modeOf(i) }; break;
      case 'lasso': g = { k: 'lasso', pts: [p], mode: modeOf(i), label: 'Draw around it' }; break;
      case 'lasso-poly': polyClick(p, i); break;
      case 'quick-select': {
        const base = d.selection ? maskFromSelection(d.selection, d.width, d.height) : null;
        g = { k: 'quick', pts: [p], mode: modeOf(i, 'add'), base, before: d.selection, src: pixelsFor(d, S.allLayers), at: 0 };
        quickUpdate(false);
        break;
      }
      case 'patch':
        if (d.selection && selectionAlpha(d.selection, Math.floor(p.x), Math.floor(p.y)) >= 128) g = { k: 'patch', a: p, b: p };
        else g = { k: 'lasso', pts: [p], mode: 'new', label: 'Patch: draw around it' };
        break;
      case 'gradient': case 'rect': case 'rounded-rect': case 'ellipse': case 'polygon': case 'line':
        g = { k: 'drag', t, a: p, b: p, shift: i.shift }; break;
      case 'wand': case 'bucket': case 'magic-eraser': case 'red-eye': clickTool(t, p, i); break;
      case 'type': beginText(p); break;
      default:
        if (FX[t]) {
          if ((t === 'clone' || t === 'heal') && i.type === 'touch' && !pickSource) {
            const timer = window.setTimeout(() => { if (g?.k === 'press') { g = null; setSource(p); } }, 520);
            g = { k: 'press', p, i, t, timer };
          } else startFx(t, p, i);
        }
    }
    host.render();
  }
  /**
   * Select an object: a tap (a drag under 4 screen pixels) finds the thing under it, a drag finds the thing inside the box.
   * The AI answers with a mask, which meets the old selection the way Shift (adds) and Alt (takes away) say.
   */
  const boxed = (q: { a: Pt; b: Pt }): boolean => Math.max(Math.abs(q.b.x - q.a.x), Math.abs(q.b.y - q.a.y)) * z() >= 4;
  function objSelect(d: Doc, q: { a: Pt; b: Pt; mode: SelMode }): void {
    const box = boxed(q);
    if (!box && (q.a.x < 0 || q.a.y < 0 || q.a.x >= d.width || q.a.y >= d.height)) return;
    const prompt = box
      ? { points: [], box: { x: Math.min(q.a.x, q.b.x), y: Math.min(q.a.y, q.b.y), w: Math.abs(q.b.x - q.a.x), h: Math.abs(q.b.y - q.a.y) } }
      : { points: [{ x: q.a.x, y: q.a.y, add: true }] };
    void host.ai().then((k) => k.objectSelect(prompt)).then((m) => { if (m && doc() === d) applyMask(m, q.mode, 'Select an object'); },
      () => host.toast('The AI tools could not load. Check the connection and try again.'));
  }
  function move(p: Pt, i: PointerInfo): void {
    const q = g;
    if (!q) return;
    if (q.k === 'xf' && xf) { xf.q = dragXf(q.hd, q.p0, p, q.q0, i); previewXf(); host.refreshOptions(); host.render(); return; }
    if (q.k === 'qm') {
      const dist = Math.hypot(p.x - q.last.x, p.y - q.last.y), step = Math.max(1, q.size * 0.2), n = Math.ceil(dist / step);
      for (let k = 1; k <= n; k++) qmDab(q.last.x + ((p.x - q.last.x) * k) / n, q.last.y + ((p.y - q.last.y) * k) / n, q.size, q.hard, q.erase);
      q.last = p;
      host.render();
      return;
    }
    if (q.k === 'rm') {
      const n = Math.ceil(Math.hypot(p.x - q.last.x, p.y - q.last.y) / Math.max(1, q.size * 0.25));
      for (let k = 1; k <= n; k++) rmDab(q.last.x + ((p.x - q.last.x) * k) / n, q.last.y + ((p.y - q.last.y) * k) / n, q.size);
      q.last = p;
      host.render();
      return;
    }
    if (q.k === 'lasso') { const l = q.pts[q.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * z() >= 2) q.pts.push(p); host.render(); return; }
    if (q.k === 'quick') { q.pts.push(p); quickUpdate(false); return; }
    if (q.k === 'drag') { q.b = p; q.shift = i.shift; host.render(); return; }
    if (q.k === 'obj') { q.b = p; host.render(); return; }
    if (q.k === 'patch') { q.b = p; host.render(); return; }
    if (q.k === 'press') {
      if (Math.hypot(p.x - q.p.x, p.y - q.p.y) * z() < 8) return;
      clearTimeout(q.timer);
      g = null;
      startFx(q.t, q.p, q.i);
    }
    const f = g;
    if (f?.k === 'fx') {
      const dd = doc();
      if (!f.warned && f.off && f.l && dd && srcOut(dd, f.l, p, f.off)) { f.warned = true; host.toast(OFF_PICTURE); }
      f.s.add(sp(p, i, fxo(f.t)[0]));
      flush();
    }
  }
  function end(p: Pt, i: PointerInfo): void {
    const q = g, d = doc();
    g = null;
    if (!q || !d) return;
    if (q.k === 'xf') { host.render(); return; }
    if (q.k === 'qm') { host.render(); return; }
    if (q.k === 'rm') {
      const r = rm;
      if (!r) return;
      r.busy = true;
      host.render();
      void host.ai().then((k) => k.removeObject(r.mask)).finally(() => { if (rm === r) rm = null; host.render(); });
      return;
    }
    if (q.k === 'lasso') {
      if (q.pts.length < 3) { if (q.mode === 'new' && d.selection) setSel(null, 'Deselect'); return; }
      applyMask(polygonMask(d.width, d.height, q.pts), q.mode, q.label);
      return;
    }
    if (q.k === 'obj') { objSelect(d, q); return; }
    if (q.k === 'quick') { q.pts.push(p); quickUpdate(true); return; }
    if (q.k === 'patch') {
      const l = target();
      if (!l || Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) < 2) { host.render(); return; }
      const cmd = patchArea(d, l, { x: q.b.x - q.a.x, y: q.b.y - q.a.y });
      if (cmd) host.push(cmd, true);
      return;
    }
    if (q.k === 'drag') {
      if (q.t === 'gradient') {
        const l = target(true);
        if (!l || Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) < 2) { host.render(); return; }
        let b = q.b;
        if (i.shift) { const ang = Math.round(Math.atan2(b.y - q.a.y, b.x - q.a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(b.x - q.a.x, b.y - q.a.y); b = { x: q.a.x + Math.cos(ang) * len, y: q.a.y + Math.sin(ang) * len }; }
        const bg = parseHex(host.bg()) ?? BLACK;
        const g = { kind: S.grad.kind, from: q.a, to: b, stops: GRADS[S.grad.preset][1](fgc(), bg), opacity: S.grad.opacity, reverse: S.grad.reverse };
        // On the mask (W6 S1) the fade is drawn in greys through the mask's grey surface, so the layer's pixels stay.
        host.push(host.onMask(l) ? withMaskSurface(d, l, 'Colour fade on the mask', (sd, s) => fillGradient(sd, s, g)) : fillGradient(d, l, g), true);
      } else makeShape(q.t, q.a, q.b, i.shift);
      return;
    }
    if (q.k === 'press') {
      clearTimeout(q.timer);
      if (src) { startFx(q.t, q.p, q.i); endFx(p, i); } else host.toast('Press and hold where to copy from, then paint.');
      return;
    }
    if (q.k === 'fx') { g = q; endFx(p, i); }
  }
  function endFx(p: Pt, i: PointerInfo): void {
    const q = g;
    g = null;
    if (q?.k !== 'fx') return;
    q.s.add(sp(p, i, fxo(q.t)[0]));
    if (q.s.o.kind === 'heal' || q.s.o.kind === 'spot-heal') q.s.finishHeal();
    const r = q.s.takeDirty();
    if (r) host.dirty(r);
    host.push(q.s.end(FX_LABEL[q.t] ?? 'Retouch'));
  }
  function cancel(): void {
    const q = g;
    g = null;
    if (!q) return;
    if (q.k === 'press') clearTimeout(q.timer);
    if (q.k === 'fx') host.dirty(q.s.cancel());
    if (q.k === 'quick') { const d = doc(); if (d) d.selection = q.before; host.selectionChanged(); }
    host.render();
  }
  function polyClick(p: Pt, i: PointerInfo): void {
    const t = now(), zz = z();
    const dbl = t - lastClick.t < 380 && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) * zz < 8;
    lastClick = { t, x: p.x, y: p.y };
    if (!poly) { poly = { pts: [p], mode: modeOf(i) }; host.refreshOptions(); return; }
    const f = poly.pts[0];
    if (poly.pts.length >= 3 && (dbl || Math.hypot(p.x - f.x, p.y - f.y) * zz < 12)) { closePoly(); return; }
    poly.pts.push(p);
  }
  function closePoly(): void {
    const d = doc(), pl = poly;
    poly = null;
    if (d && pl && pl.pts.length >= 3) applyMask(polygonMask(d.width, d.height, pl.pts), pl.mode, 'Click around it');
    host.refreshOptions();
    host.render();
  }

  // ---------- menus and dialogs ----------
  function dialog(id: string, title: string, fields: HTMLElement[], apply: () => void): void {
    let body = bodies.get(id);
    if (!body) { body = h('div', { class: 'fpe-stack', 'data-testid': 'w3-dialog-' + id }); bodies.set(id, body); }
    body.replaceChildren(...fields, h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'w3-cancel', onclick: () => host.closeSheet() }, 'Cancel'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'w3-apply', onclick: () => { host.closeSheet(); apply(); } }, 'Apply')));
    host.sheet(id, title, body);
  }
  const AMOUNT: Record<string, [string, string, number, number, (m: Mask, n: number) => Mask]> = {
    'select.expand': ['Grow by pixels · Expand', 'How many pixels to add all round.', 8, 200, expandMask],
    'select.contract': ['Shrink by pixels · Contract', 'How many pixels to take off all round.', 8, 200, contractMask],
    'select.feather': ['Soften the edge · Feather', 'How many pixels the edge fades over.', 6, 250, featherMask],
    'select.border': ['Edge band · Border', 'How wide the band along the edge is.', 8, 200, borderMask],
    'select.smooth': ['Round off · Smooth', 'How big a corner or speck gets rounded away.', 4, 100, smoothMask],
  };
  function amountDialog(id: string): void {
    const d = doc(), a = AMOUNT[id];
    if (!d || !a) return;
    if (!d.selection) { host.toast('Select an area first.'); return; }
    let n = a[2];
    dialog('w3-amount', a[0], [host.slider('Pixels', a[1], 1, a[3], n, ' px', (v) => { n = v; }, 'w3-amount')], () => {
      const dd = doc();
      if (!dd?.selection) return;
      setSel(selectionFromMask(a[4](maskFromSelection(dd.selection, dd.width, dd.height), n)), a[0].split(' · ')[0]);
    });
  }
  function rangeDialog(): void {
    const d = doc();
    if (!d) return;
    let fuzz = 40;
    const col = h('input', { type: 'color', value: host.fg(), 'data-testid': 'w3-range-color', 'aria-label': 'Colour to select' });
    dialog('w3-range', 'Select by colour · Colour range', [
      h('label', { class: 'fpe-field', 'data-help-title': 'Colour', 'data-help': 'The colour to select. It starts as your main colour; pick one with the eyedropper first.' }, h('span', {}, 'Colour'), col),
      host.slider('Closeness', 'How far a colour may be from the chosen one and still be selected (fuzziness).', 1, 200, fuzz, '', (v) => { fuzz = v; }, 'w3-range-fuzz')], () => {
      const dd = doc();
      if (!dd) return;
      applyMask(colorRangeMask(pixelsFor(dd, true), parseHex(col.value) ?? BLACK, fuzz), 'new', 'Select by colour');
    });
  }
  function strokeDialog(): void {
    const d = doc();
    if (!d) return;
    if (!d.selection) { host.toast('Select an area first.'); return; }
    let width = 4, op = 100, where: 'inside' | 'center' | 'outside' = 'center';
    const col = h('input', { type: 'color', value: host.fg(), 'data-testid': 'w3-stroke-color', 'aria-label': 'Line colour' });
    const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Where' });
    const paintSeg = (): void => { for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.where === where)); };
    for (const [w, label] of [['inside', 'Inside'], ['center', 'On the edge'], ['outside', 'Outside']] as const) {
      seg.append(h('button', { type: 'button', 'data-where': w, 'data-testid': 'w3-stroke-' + w, onclick: () => { where = w; paintSeg(); } }, label));
    }
    paintSeg();
    dialog('w3-stroke', 'Outline the selection · Stroke', [host.slider('Line width', 'How thick the line is.', 1, 250, width, ' px', (v) => { width = v; }, 'w3-stroke-width'),
      h('label', { class: 'fpe-field' }, h('span', {}, 'Colour'), col), seg, host.slider('Strength', 'How solid the line is.', 1, 100, op, '%', (v) => { op = v; }, 'w3-stroke-opacity')], () => {
      const dd = doc(), l = target();
      if (!dd || !l) return;
      host.push(strokeSelection(dd, l, { width, color: parseHex(col.value) ?? BLACK, where, opacity: op / 100 }), true);
    });
  }
  function align(how: AlignEdge): void {
    const d = doc(), l = d ? activeLayer(d) : undefined;
    if (!d || !l || !host.editable(l, false)) return;
    const cmd = alignLayer(d, l.id, d.selection ? { x: d.selection.x, y: d.selection.y, w: d.selection.w, h: d.selection.h } : null, how);
    if (cmd) host.push(cmd, true); else host.toast(`Already lined up with the ${d.selection ? 'selection' : 'picture'}.`);
  }
  function distribute(axis: 'h' | 'v'): void {
    const d = doc();
    if (!d) return;
    const ids = d.layers.slice(1).filter((l) => l.visible && !l.locked).map((l) => l.id);
    const cmd = distributeLayers(d, ids, axis);
    if (cmd) host.push(cmd, true); else host.toast('Spacing out needs three or more shown, unlocked layers above the bottom one.');
  }
  function cmd(id: string): unknown {
    const d = doc();
    if (!d) return null;
    if (id.startsWith('layer.align-')) { align(id.slice(12) as AlignEdge); return null; }
    switch (id) {
      case 'select.color-range': rangeDialog(); break;
      case 'select.expand': case 'select.contract': case 'select.feather': case 'select.border': case 'select.smooth': amountDialog(id); break;
      case 'select.grow': case 'select.similar': {
        if (!d.selection) { host.toast('Select an area first.'); break; }
        const m = maskFromSelection(d.selection, d.width, d.height), px = pixelsFor(d, true);
        setSel(selectionFromMask(id === 'select.grow' ? growMask(px, m, S.tolerance) : similarMask(px, m, S.tolerance)), id === 'select.grow' ? 'Grow into similar colours' : 'Select similar colours');
        break;
      }
      case 'select.transform': startXf('selection', 'free'); break;
      case 'select.quick-mask': toggleQm(); break;
      case 'select.save':
        if (!d.selection) host.toast('Select an area first, then save it.');
        else { saved.set(d, d.selection); host.toast('Selection saved. Select › Load a saved selection brings it back.'); }
        break;
      case 'select.load': { const s = saved.get(d); if (s) setSel(s, 'Load selection'); else host.toast('No saved selection yet: choose Select › Save the selection first.'); break; }
      case 'edit.stroke': strokeDialog(); break;
      case 'edit.free-transform': case 'edit.scale': case 'edit.rotate': startXf('layer', 'free'); break;
      case 'edit.skew': startXf('layer', 'skew'); break;
      case 'edit.distort': startXf('layer', 'distort'); break;
      case 'edit.perspective': startXf('layer', 'perspective'); break;
      case 'layer.distribute-h': distribute('h'); break;
      case 'layer.distribute-v': distribute('v'); break;
      case 'layer.rasterize': case 'type.rasterize': rasterize(); break;
      case 'type.fonts':
        host.showPanel('character');
        requestAnimationFrame(() => panels.get('character')?.querySelector<HTMLElement>('[data-testid="text-font"]')?.focus());
        host.toast('Pick a font in the Text style panel.');
        break;
    }
    return null;
  }

  // ---------- options bar ----------
  function options(bar: HTMLElement, t: ToolId): void {
    const hint = (s: string): HTMLElement => h('span', { class: 'fpe-hint' }, s);
    const seg = (label: string, items: [string, string, boolean, () => void, string?][]): HTMLElement =>
      h('div', { class: 'fpe-seg', role: 'group', 'aria-label': label }, ...items.map(([text, testid, on, run, help]) =>
        h('button', { type: 'button', 'aria-pressed': String(on), 'data-testid': testid, 'data-help-title': text, 'data-help': help ?? text, onclick: () => { run(); host.refreshOptions(); } }, text)));
    const btn = (text: string, testid: string, run: () => void, primary = false): HTMLElement =>
      h('button', { type: 'button', class: 'fpe-btn ' + (primary ? 'fpe-btn-primary' : 'fpe-btn-ghost'), 'data-testid': testid, onclick: run }, text);
    const sl = (label: string, help: string, min: number, max: number, v: number, u: string, set: (n: number) => void, testid: string): HTMLElement =>
      host.slider(label, help, min, max, Math.round(v), u, set, testid);
    const modes = (): HTMLElement => seg('How it meets the old selection', [
      ['New', 'w3-mode-new', S.mode === 'new', () => { S.mode = 'new'; }, 'Replace the selection.'], ['Add', 'w3-mode-add', S.mode === 'add', () => { S.mode = 'add'; }, 'Add to it (or hold Shift).'],
      ['Take away', 'w3-mode-subtract', S.mode === 'subtract', () => { S.mode = 'subtract'; }, 'Take away from it (or hold Alt).'],
      ['Overlap', 'w3-mode-intersect', S.mode === 'intersect', () => { S.mode = 'intersect'; }, 'Keep only where they overlap (or hold Shift and Alt).']]);
    const colourOpts = (key: 'allLayers' | 'eraseAll' = 'allLayers'): HTMLElement[] => [
      sl('Closeness', 'How different a colour may be and still count (tolerance).', 0, 255, S.tolerance, '', (v) => { S.tolerance = v; }, 'w3-tolerance'),
      seg('Area', [['Touching only', 'w3-contig-on', S.contiguous, () => { S.contiguous = true; }, 'Only the area connected to where you click (contiguous).'],
        ['Everywhere', 'w3-contig-off', !S.contiguous, () => { S.contiguous = false; }, 'Every matching pixel in the picture.']]),
      seg('Look at', [['What you see', 'w3-all-on', S[key], () => { S[key] = true; }, 'Judge colours by the picture as you see it, every shown layer together (sample all layers).'],
        ['This layer only', 'w3-all-off', !S[key], () => { S[key] = false; }, 'Judge colours by the active layer alone.']])];
    const fxSliders = (tt: ToolId, strengthLabel = 'Strength', strengthHelp = 'How strong each stroke is.'): HTMLElement[] => {
      const o = fxo(tt);
      return [sl('Size', 'How wide the brush is, in pixels. Keys [ and ] change it too.', 1, 500, o[0], ' px', (v) => { o[0] = v; host.render(); }, 'w3-size'),
        sl('Softness', 'How soft the edge is.', 0, 100, (1 - o[1]) * 100, '%', (v) => { o[1] = 1 - v / 100; }, 'w3-softness'),
        sl(strengthLabel, strengthHelp, 1, 100, o[2] * 100, '%', (v) => { o[2] = v / 100; }, 'w3-strength')];
    };
    const d = doc(), al = d ? activeLayer(d) : undefined;
    switch (t) {
      case 'select-ellipse': bar.append(modes(), sl('Soft edge', 'Feather new selections by this many pixels.', 0, 100, S.feather, ' px', (v) => { S.feather = v; }, 'w3-feather'),
        hint('Drag to select an oval; hold Shift while dragging for a circle. Shift or Alt at the start adds or takes away.')); break;
      case 'select-row': case 'select-column': bar.append(modes(), hint(t === 'select-row' ? 'Click to select that one-pixel row right across the picture.' : 'Click to select that one-pixel column right down the picture.')); break;
      case 'object-select': bar.append(modes(), hint('Tap a thing, or drag a box round it. Shift adds, Alt takes away.')); break;
      case 'lasso': bar.append(modes(), sl('Soft edge', 'Feather new selections by this many pixels.', 0, 100, S.feather, ' px', (v) => { S.feather = v; }, 'w3-feather'), hint('Drag around what you want. Shift adds, Alt takes away.')); break;
      case 'lasso-poly':
        bar.append(modes(), hint(poly ? `${poly.pts.length} corners. Tap the first corner, double-click or press Enter to close.` : 'Click from corner to corner. Close at the first corner.'));
        if (poly) bar.append(btn('Close the outline', 'w3-poly-close', closePoly, true), btn('Cancel', 'w3-poly-cancel', () => { poly = null; host.refreshOptions(); host.render(); }));
        break;
      case 'wand': bar.append(modes(), ...colourOpts()); break;
      case 'quick-select': bar.append(sl('Size', 'How wide the selecting brush is.', 2, 300, S.qs, ' px', (v) => { S.qs = v; host.render(); }, 'w3-size'),
        colourOpts()[2], hint('Paint over the area; the selection grows to its edges. Alt takes away.')); break;
      case 'gradient': {
        const pre = h('select', { 'data-testid': 'w3-grad-preset', 'aria-label': 'Colours' }, ...GRADS.map(([n], k) => h('option', { value: String(k) }, n)));
        pre.value = String(S.grad.preset);
        pre.addEventListener('change', () => { S.grad.preset = Number(pre.value); });
        bar.append(seg('Shape of the fade', GRAD_KINDS.map(([k, plain, pro]) => [plain, 'w3-grad-' + k, S.grad.kind === k, () => { S.grad.kind = k; }, `${plain} fade · ${pro}`] as [string, string, boolean, () => void, string])),
          h('label', { class: 'fpe-field fpe-w3-field', 'data-help-title': 'Colours', 'data-help': 'Which colours the fade runs between.' }, h('span', { class: 'fpe-w3-label' }, 'Colours'), pre),
          sl('Strength', 'How solid the fade is.', 1, 100, S.grad.opacity * 100, '%', (v) => { S.grad.opacity = v / 100; }, 'w3-strength'),
          seg('Direction', [['Swap ends', 'w3-grad-reverse', S.grad.reverse, () => { S.grad.reverse = !S.grad.reverse; }, 'Start with the other colour (reverse).']]),
          hint('Drag across the picture. Shift keeps the line straight.'));
        break;
      }
      case 'bucket': bar.append(...colourOpts(), sl('Strength', 'How solid the fill is.', 1, 100, S.bucketOpacity * 100, '%', (v) => { S.bucketOpacity = v / 100; }, 'w3-strength')); break;
      case 'magic-eraser': bar.append(...colourOpts('eraseAll'), hint('Click a colour to make that area see-through.')); break;
      case 'red-eye': bar.append(sl('Pupil size', 'How far round the click to look for red.', 4, 200, S.redEye.size, ' px', (v) => { S.redEye.size = v; }, 'w3-pupil'),
        sl('Darken', 'How dark the pupil becomes.', 1, 100, S.redEye.darken * 100, '%', (v) => { S.redEye.darken = v / 100; }, 'w3-darken'), hint('Click the red part of each eye.')); break;
      case 'clone': case 'heal':
        bar.append(...fxSliders(t), seg('Source', [['Aligned', 'w3-aligned', S.aligned, () => { S.aligned = !S.aligned; }, 'Keep the same distance to the source for every stroke.']]),
          btn(pickSource ? 'Tap the source…' : 'Pick the source', 'w3-pick-source', () => { pickSource = true; host.refreshOptions(); }),
          hint(src ? 'Paint to copy from the source.' : 'Alt-click, or press and hold, where to copy from.'));
        break;
      case 'spot-heal': bar.append(...fxSliders(t).slice(0, 2), hint('Paint over a spot; it blends into its surroundings.')); break;
      case 'remove': bar.append(sl('Size', 'How wide the brush is.', 4, 500, S.rm, ' px', (v) => { S.rm = v; host.render(); }, 'w3-size'), hint('Paint over what you want gone, then let go. AI on this device fills the gap.')); break;
      case 'patch': bar.append(hint(d?.selection ? 'Drag the selected flaw onto a clean area.' : 'Draw around the flaw, then drag it onto a clean area.')); break;
      case 'dodge': case 'burn':
        bar.append(...fxSliders(t, 'Strength', 'How much each stroke lightens or darkens (exposure).'), seg('Tones', [
          ['Darks', 'w3-range-shadows', S.range === 'shadows', () => { S.range = 'shadows'; }], ['Middle tones', 'w3-range-midtones', S.range === 'midtones', () => { S.range = 'midtones'; }],
          ['Lights', 'w3-range-highlights', S.range === 'highlights', () => { S.range = 'highlights'; }]]));
        break;
      case 'sponge': bar.append(...fxSliders(t), seg('Colour', [['More colour', 'w3-sponge-more', S.spongeMore, () => { S.spongeMore = true; }], ['Less colour', 'w3-sponge-less', !S.spongeMore, () => { S.spongeMore = false; }]])); break;
      case 'color-replace': bar.append(...fxSliders(t), sl('Closeness', 'How different a colour may be and still change.', 1, 255, S.replTol, '', (v) => { S.replTol = v; }, 'w3-tolerance'),
        hint('Paints your main colour over the colour under the first touch, keeping the detail.')); break;
      case 'bg-eraser': bar.append(...fxSliders(t), sl('Closeness', 'How different a colour may be and still be erased.', 1, 255, S.bgTol, '', (v) => { S.bgTol = v; }, 'w3-tolerance')); break;
      case 'history-brush': bar.append(...fxSliders(t), hint('Paints back how this layer looked at the step marked with the brush in History; at first, as the picture was opened.')); break;
      case 'blur': case 'sharpen': case 'smudge': bar.append(...fxSliders(t)); break;
      case 'type':
        bar.append(...textControls('bar'));
        if (te) bar.append(btn('Done', 'text-done', commitText, true));
        else if (al?.content) bar.append(btn('Turn into pixels', 'w3-rasterize', rasterize));
        if (!te) bar.append(hint('Click the picture to add words; click words to change them.'));
        break;
      default: {
        const def = SHAPES[t];
        if (!def) break;
        const sh = S.shape, live = al?.content?.kind === 'shape';
        const set = (patch: Partial<typeof sh>, shapePatch: Partial<ShapeContent>): void => { Object.assign(sh, patch); if (live) reshape(shapePatch); };
        if (def[0] !== 'line') bar.append(seg('Fill', [['Fill', 'w3-shape-fill', sh.fill, () => set({ fill: !sh.fill }, { fill: !sh.fill ? host.fg() : null }), 'Fill the shape with your main colour.'],
          ['Outline', 'w3-shape-stroke', sh.stroke, () => set({ stroke: !sh.stroke }, { stroke: !sh.stroke ? host.bg() : null }), 'Draw its edge in your second colour.']]),
          sl('Outline width', 'How thick the outline is.', 1, 100, sh.strokeWidth, ' px', (v) => set({ strokeWidth: v }, { strokeWidth: v }), 'w3-stroke-width'));
        if (def[0] === 'rounded') bar.append(sl('Corner radius', 'How round the corners are.', 0, 500, sh.radius, ' px', (v) => set({ radius: v }, { radius: v }), 'w3-radius'));
        if (def[0] === 'polygon') bar.append(sl('Sides', 'How many sides, or points of a star.', 3, 24, sh.sides, '', (v) => set({ sides: v }, { sides: v }), 'w3-sides'),
          seg('Star', [['Star', 'w3-star', sh.star, () => set({ star: !sh.star }, { star: !sh.star }), 'Make it a star.']]));
        if (def[0] === 'line') bar.append(sl('Line width', 'How thick the line is.', 1, 200, sh.lineWidth, ' px', (v) => set({ lineWidth: v }, { strokeWidth: v }), 'w3-line-width'),
          seg('Arrow', [['Arrow', 'w3-arrow', sh.arrow, () => set({ arrow: !sh.arrow }, { arrow: !sh.arrow }), 'Draw an arrow head at the end.']]));
        if (live) bar.append(btn('Use main colour', 'w3-shape-recolor', () => reshape(def[0] === 'line' ? { stroke: host.fg() } : { fill: host.fg() })), btn('Turn into pixels', 'w3-rasterize', rasterize));
        bar.append(hint(live ? 'Settings change the selected shape layer. Drag to draw another.' : 'Drag to draw. Shift keeps it even.'));
      }
    }
  }
  function decorate(bar: HTMLElement, t: ToolId): void {
    if (xf) {
      const x = xf, sx = Math.hypot(x.q[1].x - x.q[0].x, x.q[1].y - x.q[0].y) / Math.max(1, Math.hypot(x.base[1].x - x.base[0].x, x.base[1].y - x.base[0].y));
      const ang = (Math.atan2(x.q[1].y - x.q[0].y, x.q[1].x - x.q[0].x) * 180) / Math.PI;
      const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Transform' }, ...([['free', 'Resize and turn', 'Free transform'], ['skew', 'Slant', 'Skew'],
        ['distort', 'Pull corners', 'Distort'], ['perspective', 'Fix the angle', 'Perspective']] as const).map(([m, plain, pro]) =>
        h('button', { type: 'button', 'aria-pressed': String(x.mode === m), 'data-testid': 'xf-mode-' + m, 'data-help-title': `${plain} · ${pro}`, 'data-help': 'How the handles change the shape.',
          onclick: () => { x.mode = m; host.refreshOptions(); } }, plain)));
      bar.replaceChildren(...Array.from(bar.querySelectorAll(':scope > .fpe-opt-tool')), seg, h('span', { class: 'fpe-hint', 'data-testid': 'xf-readout' }, `Width ${Math.round(sx * 100)}% · turned ${Math.round(ang)}°`),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'xf-cancel', onclick: () => endXf(false) }, 'Cancel'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'xf-apply', onclick: () => endXf(true) }, 'Apply'));
      return;
    }
    if (qm && (t === 'brush' || t === 'pencil' || t === 'eraser')) {
      bar.append(h('span', { class: 'fpe-hint', 'data-testid': 'qm-hint' }, 'Painting a selection: paint adds, the eraser takes away.'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'qm-done', onclick: toggleQm }, 'Done'));
    }
  }

  // ---------- drawing on top of the picture ----------
  function overlay(ctx: CanvasRenderingContext2D): void {
    const d = doc(), v = host.view();
    if (!d) return;
    const path = (pts: Pt[], close: boolean): void => {
      ctx.beginPath();
      pts.forEach((p, k) => { const s = scr(p); if (k) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      if (close) ctx.closePath();
    };
    const ants = (): void => { ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineDashOffset = 5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; };
    if (qm) { ctx.imageSmoothingEnabled = false; ctx.drawImage(qm.cv, v.panX, v.panY, d.width * v.zoom, d.height * v.zoom); }
    if (rm) { ctx.save(); ctx.globalAlpha = rm.busy ? 0.3 : 0.45; ctx.imageSmoothingEnabled = false; ctx.drawImage(rm.cv, v.panX, v.panY, d.width * v.zoom, d.height * v.zoom); ctx.restore(); }
    const q = g;
    if (q?.k === 'lasso') { path(q.pts, false); ants(); }
    if (q?.k === 'obj' && boxed(q)) { path([q.a, { x: q.b.x, y: q.a.y }, q.b, { x: q.a.x, y: q.b.y }], true); ants(); }
    if (poly) {
      const ptr = host.pointer();
      path(ptr ? [...poly.pts, ptr] : poly.pts, false); ants();
      const f = scr(poly.pts[0]);
      ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (q?.k === 'drag') {
      if (q.t === 'gradient') {
        path([q.a, q.b], false); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        for (const p of [q.a, q.b]) { const s = scr(p); ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
      } else {
        const def = SHAPES[q.t];
        if (def) { const s = shapeOf(def[0], q.a, q.b, q.shift); path(shapePoints(s), def[0] !== 'line'); ants(); }
      }
    }
    if (q?.k === 'patch' && d.selection) {
      const s = d.selection;
      path([{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }].map((p) => ({ x: p.x + q.b.x - q.a.x, y: p.y + q.b.y - q.a.y })), true);
      ants();
    }
    const t = host.tool(), ptr = host.pointer();
    if (src && (t === 'clone' || t === 'heal')) {
      const at = q?.k === 'fx' && src.offset && ptr ? { x: ptr.x + src.offset.x, y: ptr.y + src.offset.y } : src.pt, s = scr(at);
      ctx.beginPath(); ctx.moveTo(s.x - 9, s.y); ctx.lineTo(s.x + 9, s.y); ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x, s.y + 9);
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.25; ctx.stroke();
    }
    if (xf) {
      path(xf.q, true); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#78aaff'; ctx.lineWidth = 1.5; ctx.stroke();
      const hs = host.layout() === 'phone' ? 14 : 9;
      const pts = [...xf.q, ...xf.q.map((a, k) => { const b = (xf as Xf).q[(k + 1) % 4]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })];
      for (const p of pts) { const s = scr(p); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1d22'; ctx.lineWidth = 1.5; ctx.fillRect(s.x - hs / 2, s.y - hs / 2, hs, hs); ctx.strokeRect(s.x - hs / 2, s.y - hs / 2, hs, hs); }
      const c = scr(centroid(xf.q));
      ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    if (te) {
      const l = findLayer(d, te.id);
      if (l && !te.content.text) { const s = scr({ x: te.content.x, y: te.content.y }); ctx.strokeStyle = '#78aaff'; ctx.setLineDash([4, 3]); ctx.strokeRect(s.x - 2, s.y, te.content.style.size * 3 * v.zoom, te.content.style.size * te.content.style.lineHeight * v.zoom); ctx.setLineDash([]); }
      placeArea();
    }
  }

  // The pen and its outline tools (pen.ts) ride along in this file's chunk.
  const pen = createPenKit(host, setSel), penOn = (): boolean => PEN_TOOLS.has(host.tool());
  // Batch view-tools (viewkit.ts): oval, row and column selections, Measure, colour markers, notes, guides and snapping.
  const view = createViewKit(host, applyMask, (i) => modeOf(i)), viewOn = (): boolean => VIEW_TOOLS.has(host.tool()) || view.busy();
  const snapped = (p: Pt): Pt => (SNAPS.has(host.tool()) ? view.snap(p) : p);
  // Batch tools (toolkit-more.ts): Turn the view and Crop and straighten.
  const more = createMoreKit(host), moreOn = (): boolean => MORE_TOOLS.has(host.tool()) || more.busy();
  return {
    claims: (t) => TK_TOOLS.has(t) || view.claims(t) || !!xf || (!!qm && (t === 'brush' || t === 'pencil' || t === 'eraser')),
    start: (p, i) => (MORE_TOOLS.has(host.tool()) ? more.start(p, i) : penOn() ? pen.start(p, i) : !xf && view.claims(host.tool()) ? view.start(p, i) : start(snapped(p), i)),
    move: (p, i) => (moreOn() ? more.move(p, i) : penOn() ? pen.move(p, i) : viewOn() ? view.move(p, i) : move(snapped(p), i)),
    end: (p, i) => (moreOn() ? more.end(p, i) : penOn() ? pen.end(p, i) : viewOn() ? view.end(p, i) : end(snapped(p), i)),
    cancel: () => { more.cancel(); pen.cancel(); view.cancel(); cancel(); },
    options: (bar, t) => (MORE_TOOLS.has(t) ? more.options(bar, t) : PEN_TOOLS.has(t) ? pen.options(bar, t) : VIEW_BAR.has(t) ? view.options(bar, t) : options(bar, t)),
    overlay: (ctx) => { overlay(ctx); pen.overlay(ctx); view.overlay(ctx); more.overlay(ctx); },
    cmd: (id) => (id === 'select.from-path' || id === 'select.to-path' ? pen.cmd(id) : VIEW_CMDS.has(id) ? view.cmd(id) : cmd(id)),
    viewFlags: () => view.flags(),
    toClient: (x, y) => more.toClient(x, y),
    fillPanel: (pid, body) => (pid === 'paths' ? pen.fillPanel(body) : fillPanel(pid, body)),
    decorate,
    key(e) {
      if (more.key(e) || pen.key(e)) return true;
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (te && (k === 'Escape' || (k === 'Enter' && mod))) { commitText(); return true; }
      if (xf && (k === 'Enter' || k === 'Escape')) { endXf(k === 'Enter'); return true; }
      if (poly && !te && (k === 'Enter' || k === 'Escape' || k === 'Backspace')) {
        if (k === 'Enter') closePoly(); else if (k === 'Escape' || poly.pts.length <= 1) { poly = null; host.refreshOptions(); } else poly.pts.pop();
        host.render();
        return true;
      }
      if (qm && k === 'Escape') { toggleQm(); return true; }
      return false;
    },
    toolChanged(prev, next) {
      pen.toolChanged(prev, next);
      more.toolChanged(prev, next);
      view.cancel();
      if (prev === 'type' && te) commitText();
      if (prev === 'lasso-poly') poly = null;
      if (prev === 'remove' && rm && !rm.busy) rm = null;
      if (prev === next) return;
      host.render();
    },
    abort() { cancel(); if (te) commitText(); if (xf) endXf(false); poly = null; },
    state() {
      const d = doc(), sel = d?.selection, l = d ? activeLayer(d) : undefined;
      return { quickMask: !!qm, transform: xf ? `${xf.mode}:${xf.target}` : null, polygon: poly?.pts.length ?? 0, editingText: !!te, source: !!src,
        savedSel: !!(d && saved.get(d)), shaped: !!sel?.alpha, selected: sel && d ? countSelected(maskFromSelection(sel, d.width, d.height)) : 0,
        content: l?.content?.kind ?? null, mode: S.mode, allLayers: S.allLayers, handles: xf ? xfHandles(xf).map(scr) : [], paths: pen.state(), view: view.state(), more: more.state() };
    },
    cursorSize(t) { return FX[t] ? fxo(t)[0] : t === 'quick-select' ? S.qs : t === 'remove' ? S.rm : null; },
    refresh() { for (const [pid, b] of panels) fillPanel(pid, b); pen.refresh(); },
    activity() {
      if (xf) {
        const [plain, pro, help] = XF_NAMES[xf.mode] ?? XF_NAMES.free;
        return { plain: xf.target === 'selection' ? plain + ' the selection' : plain, pro, help: help + ' Enter applies, Esc cancels.' };
      }
      if (qm) return { plain: 'Painting a selection', pro: 'Quick mask', help: 'The brush adds to the selection and the eraser takes it away; press Done to finish.' };
      return null;
    },
  };
}
