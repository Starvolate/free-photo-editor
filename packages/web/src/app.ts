// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The editor UI. One DOM, laid out by CSS for phones (bottom tool bar, bottom sheets), tablets (side rail, floating
 * panels) and desktops (tools left, options on top, panels right). Every pixel change goes through the engine.
 */
import {
  APP_NAME, APP_VERSION, AUTHOR, AUTHOR_URL, BLACK, BLEND_GROUPS, BLEND_LABELS, EXPORT_FORMATS, FORMAT_INFO, History, SOURCE_URL,
  Stroke, WHITE, activeLayer, addEmptyLayer, addLayer, clamp, clearSelection, commitResult, compositeDoc, createDocument, createLayer,
  cropDocument, deleteLayer, docFacts, docRect, documentFromBitmap, duplicateActive, editRegion, findLayer, flatten, indexOfLayer,
  innerOf, intersect, isBlendMode, jobPadding, layerRect, lossReport, moveLayer, paddedRegion, parseHex, pixelCommand, propsCommand,
  readRegion, rectFromPoints, samplePixel, setLayerProps, toHex, union, writeRegion,
  type Bitmap, type BlendMode, type Command, type Doc, type DocFacts, type ExportFormat, type JobParams, type JobSpec, type Rect, type StrokePoint,
} from '@free-photoeditor/core';
import { errText, fmtBytes, h, icon, iconButton } from './dom';
import { ensureSprite } from './icons';
import { CanvasInput, type PointerInfo, type Pt } from './input';
import { OPEN_ACCEPT, baseName, download, encodeDocument, historyBytesForDevice, maxPixelsForDevice, readImageFile, scaleBitmap } from './io';
import { JobRunner } from './jobs';
import { NOTICES } from './notices';
import { Canvas2DRenderer, type Renderer, type View } from './renderer';
import css from './styles.css?inline';

type Tool = 'move' | 'select' | 'crop' | 'brush' | 'eraser' | 'eyedropper';
type Layout = 'phone' | 'tablet' | 'desktop';
type PanelId = 'layers' | 'adjust';
type Answer = 'primary' | 'secondary' | 'cancel';
export interface MountOptions { theme?: 'dark' | 'light' | 'system'; standalone?: boolean; }
export interface LayerInfo { name: string; visible: boolean; opacity: number; blendMode: BlendMode; x: number; y: number; width: number; height: number; }
export interface DocInfo {
  width: number; height: number; layers: LayerInfo[]; active: number; canUndo: boolean; canRedo: boolean;
  zoom: number; tool: Tool; layout: Layout | null; selection: Rect | null;
}
export interface EditorController {
  destroy(): void;
  openFile(file: Blob, name?: string): Promise<void>;
  newDocument(width: number, height: number, background?: string | null): void;
  getInfo(): DocInfo | null;
  /** Composite pixel [r, g, b, a] at a document position (or the active layer's pixel). */
  sample(x: number, y: number, activeLayerOnly?: boolean): number[] | null;
  /** Page coordinates of a document position, for automation and tests. */
  toClient(x: number, y: number): { x: number; y: number } | null;
  exportFile(format: ExportFormat, quality?: number): Promise<Blob>;
}

const TOOLS: ReadonlyArray<{ id: Tool; label: string; key: string; icon: string }> = [
  { id: 'move', label: 'Move layer', key: 'V', icon: 'move' },
  { id: 'select', label: 'Rectangle select', key: 'M', icon: 'select' },
  { id: 'crop', label: 'Crop', key: 'C', icon: 'crop' },
  { id: 'brush', label: 'Brush', key: 'B', icon: 'brush' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { id: 'eyedropper', label: 'Eyedropper: pick a colour', key: 'I', icon: 'pipette' },
];
interface Ctl { key: keyof JobParams; label: string; min: number; max: number; step: number; unit: string; }
interface AdjItem { id: string; label: string; group: 'Adjustments' | 'Filters'; spec: JobSpec; instant?: boolean; controls?: Ctl[]; }
const ITEMS: AdjItem[] = [
  { id: 'brightness', label: 'Brightness and contrast', group: 'Adjustments', spec: { op: 'adjust', kind: 'brightness-contrast', params: { brightness: 0, contrast: 0 } },
    controls: [{ key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, unit: '' }, { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, unit: '' }] },
  { id: 'hue', label: 'Hue and saturation', group: 'Adjustments', spec: { op: 'adjust', kind: 'hue-saturation', params: { hue: 0, saturation: 0, lightness: 0 } },
    controls: [{ key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, unit: '°' }, { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, unit: '' },
      { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, unit: '' }] },
  { id: 'bw', label: 'Black and white', group: 'Adjustments', spec: { op: 'adjust', kind: 'black-white' }, instant: true },
  { id: 'invert', label: 'Invert colours', group: 'Adjustments', spec: { op: 'adjust', kind: 'invert' }, instant: true },
  { id: 'blur', label: 'Gaussian blur', group: 'Filters', spec: { op: 'gaussian-blur', params: { radius: 4 } },
    controls: [{ key: 'radius', label: 'Radius', min: 0.5, max: 100, step: 0.5, unit: ' px' }] },
  { id: 'sharpen', label: 'Sharpen', group: 'Filters', spec: { op: 'sharpen', params: { amount: 1, radius: 1 } },
    controls: [{ key: 'amount', label: 'Amount', min: 0, max: 5, step: 0.1, unit: '×' }, { key: 'radius', label: 'Radius', min: 0.5, max: 10, step: 0.5, unit: ' px' }] },
];
interface Session {
  item: AdjItem; spec: JobSpec; layerId: string; r: Rect; padded: Rect; source: Uint8ClampedArray; before: Uint8ClampedArray;
  running: Promise<void> | null; queued: boolean; ran: boolean;
}
type Drag = { kind: 'select' | 'crop' | 'pick'; start: Pt } | { kind: 'move'; start: Pt; x: number; y: number; id: string };
const fmtNum = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
let counter = 0;

class Editor {
  readonly root: HTMLElement;
  private opts: MountOptions;
  private uid = ++counter;
  private stage!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private dock!: HTMLElement;
  private optionsBar!: HTMLElement;
  private shell!: HTMLElement;
  private toolsBar!: HTMLElement;
  private emptyEl!: HTMLElement;
  private dropEl!: HTMLElement;
  private busyEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private scrim!: HTMLElement;
  private zoomLabel!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private layerList!: HTMLElement;
  private layerProps!: HTMLElement;
  private adjustBody!: HTMLElement;
  private exportName!: HTMLInputElement;
  private exportChips!: HTMLElement;
  private qualityRow!: HTMLElement;
  private lossBox!: HTMLElement;
  private exportGo!: HTMLButtonElement;
  private askBody!: HTMLElement;
  private renderer: Renderer;
  private input: CanvasInput;
  private jobs = new JobRunner();
  private doc: Doc | null = null;
  private history = new History(60, historyBytesForDevice());
  private name = 'image';
  private savedId = 0;
  private view: View = { zoom: 1, panX: 0, panY: 0 };
  private fitted = true;
  private rendW = 0;
  private rendH = 0;
  private dirty: Rect | null = null;
  private raf = 0;
  private ants = 0;
  private antsTimer = 0;
  private toastTimer = 0;
  private thumbTimer = 0;
  private busyCount = 0;
  private tool: Tool = 'brush';
  private brush = { size: 24, hardness: 0.85, opacity: 1, color: '#e4572e' };
  private eraser = { size: 48, hardness: 0.7, opacity: 1 };
  private sampleAll = true;
  private stroke: Stroke | null = null;
  private drag: Drag | null = null;
  private crop: Rect | null = null;
  private hoverPt: Pt | null = null;
  private space = false;
  private layout: Layout | null = null;
  private sheets = new Map<string, HTMLElement>();
  private modal: string | null = null;
  private modalReturn: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private session: Session | null = null;
  private exportFormat: ExportFormat = 'png';
  private exportQuality = 0.92;
  private exportFacts: DocFacts | null = null;
  private askResolve: ((v: Answer) => void) | null = null;
  private fileAsLayer = false;
  private opacityStart: number | null = null;
  private ro: ResizeObserver;
  private stageRo: ResizeObserver;
  private off: (() => void)[] = [];

  constructor(host: HTMLElement, opts: MountOptions) {
    this.opts = opts;
    this.root = h('div', { class: 'fpe', 'data-theme': 'dark', 'data-tool': 'brush', 'data-panels': 'open' });
    this.build();
    host.append(this.root);
    this.renderer = new Canvas2DRenderer(this.canvas);
    this.applyTheme(this.initialTheme());
    this.input = new CanvasInput(this.canvas, {
      toDoc: (sx, sy) => ({ x: (sx - this.view.panX) / this.view.zoom, y: (sy - this.view.panY) / this.view.zoom }),
      getView: () => this.view,
      setView: (v) => { this.fitted = false; this.setView(v); },
      pan: (dx, dy) => { this.fitted = false; this.setView({ zoom: this.view.zoom, panX: this.view.panX + dx, panY: this.view.panY + dy }); },
      zoomAt: (f, sx, sy) => { this.fitted = false; this.zoomAt(f, sx, sy); },
      toolStart: (p, i) => this.toolStart(p, i),
      toolMove: (p, i) => this.toolMove(p, i),
      toolEnd: (p, i) => this.toolEnd(p, i),
      toolCancel: () => this.toolCancel(),
      hover: (sx, sy, inside) => { this.hoverPt = inside ? { x: sx, y: sy } : null; if (this.tool === 'brush' || this.tool === 'eraser') this.requestRender(); },
      gestureUndo: () => this.undo(true),
      gestureRedo: () => this.redo(true),
      contextMenu: (x, y) => this.contextMenu(x, y),
      spaceHeld: () => this.space,
    });
    const on = (t: EventTarget, type: string, f: (e: Event) => void): void => { t.addEventListener(type, f); this.off.push(() => t.removeEventListener(type, f)); };
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    on(window, 'keyup', (e) => { if ((e as KeyboardEvent).key === ' ') this.setSpace(false); });
    on(window, 'blur', () => this.setSpace(false));
    on(window, 'paste', (e) => this.onPaste(e as ClipboardEvent));
    on(this.root, 'dragover', (e) => {
      const dt = (e as DragEvent).dataTransfer;
      if (!dt || !dt.types.includes('Files')) return;
      e.preventDefault();
      dt.dropEffect = 'copy';
      this.dropEl.textContent = this.doc ? 'Drop to add as a new layer' : 'Drop to open';
      this.dropEl.hidden = false;
    });
    on(this.root, 'dragleave', (e) => { const r = (e as DragEvent).relatedTarget; if (!(r instanceof Node) || !this.root.contains(r)) this.dropEl.hidden = true; });
    on(this.root, 'drop', (e) => {
      e.preventDefault();
      this.dropEl.hidden = true;
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) void this.openFile(f, f.name, !!this.doc);
    });
    this.ro = new ResizeObserver(() => this.onRootResize());
    this.ro.observe(this.root);
    this.stageRo = new ResizeObserver(() => this.onStageResize());
    this.stageRo.observe(this.stage);
    this.onRootResize();
    this.onStageResize();
    this.setTool('brush');
    this.renderLayers();
    this.renderAdjust();
    this.updateUndo();
  }

  // ---------- building the interface ----------
  private build(): void {
    const top = h('header', { class: 'fpe-top' },
      iconButton('menu', 'Menu', { 'data-testid': 'btn-menu', onclick: () => this.openModal('menu') }),
      h('a', { class: 'fpe-brand', href: AUTHOR_URL, target: '_blank', rel: 'noopener', 'data-testid': 'brand', title: 'Free Photo Editor by Bhawesh Tibrewal: bhaweshtibrewal.com' },
        h('span', { class: 'fpe-brand-name' }, APP_NAME), h('span', { class: 'fpe-brand-sep', 'aria-hidden': 'true' }, ' · '),
        h('span', { class: 'fpe-brand-by' }, 'by ' + AUTHOR)),
      (this.busyEl = h('div', { class: 'fpe-busy', role: 'status', hidden: true }, h('span', { class: 'fpe-spinner', 'aria-hidden': 'true' }), 'Working…')),
      (this.undoBtn = iconButton('undo', 'Undo', { 'data-testid': 'btn-undo', onclick: () => this.undo() })),
      (this.redoBtn = iconButton('redo', 'Redo', { 'data-testid': 'btn-redo', onclick: () => this.redo() })),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary fpe-export-btn', 'aria-label': 'Export', title: 'Export (Ctrl+S)', 'data-testid': 'btn-export', onclick: () => this.openExport() },
        icon('download'), h('span', { class: 'fpe-btn-text' }, 'Export')));
    this.toolsBar = h('div', { class: 'fpe-tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'horizontal' });
    for (const t of TOOLS) {
      const b = iconButton(t.icon, `${t.label} (${t.key})`, { class: 'fpe-btn fpe-icon-btn fpe-tool', 'data-tool': t.id, 'data-testid': 'tool-' + t.id, 'aria-pressed': 'false' });
      this.longPress(b, () => this.showVariants(t.id, b));
      b.addEventListener('click', () => this.setTool(t.id));
      this.toolsBar.append(b);
    }
    this.toolsBar.append(h('span', { class: 'fpe-sep', 'aria-hidden': 'true' }),
      iconButton('layers', 'Layers', { 'data-testid': 'btn-layers', 'data-panel': 'layers', 'aria-expanded': 'false', onclick: () => this.togglePanel('layers') }),
      iconButton('sliders', 'Adjustments and filters', { 'data-testid': 'btn-adjust', 'data-panel': 'adjust', 'aria-expanded': 'false', onclick: () => this.togglePanel('adjust') }));
    this.optionsBar = h('div', { class: 'fpe-options', role: 'toolbar', 'aria-label': 'Tool options' });
    this.optionsBar.addEventListener('scroll', () => this.syncOptionsFade(), { passive: true });
    this.canvas = h('canvas', { class: 'fpe-canvas', role: 'img', 'aria-label': 'The picture you are editing', 'data-testid': 'canvas' });
    this.emptyEl = h('div', { class: 'fpe-empty', 'data-testid': 'empty' },
      icon('image', 'fpe-icon fpe-empty-icon'), h('h2', {}, 'Open a photo to start'),
      h('p', {}, 'Choose a file, drop one here or paste an image. Or start with a blank picture.'),
      h('div', { class: 'fpe-empty-actions' },
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'empty-open', onclick: () => this.pickFile(false) }, icon('open'), 'Open image'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'empty-new', onclick: () => this.openModal('new') }, icon('file-plus'), 'New blank picture')),
      h('p', { class: 'fpe-fine' }, 'Your pictures stay on this device. Nothing is uploaded.'));
    this.dropEl = h('div', { class: 'fpe-drop', hidden: true }, 'Drop to open');
    this.zoomLabel = h('button', { type: 'button', class: 'fpe-btn fpe-zoom-label', title: 'Fit to screen (Ctrl+0)', 'aria-label': 'Zoom level; select to fit the picture to the screen', onclick: () => this.fit() }, '100%');
    const zoom = h('div', { class: 'fpe-zoom', role: 'group', 'aria-label': 'Zoom' },
      iconButton('zoom-out', 'Zoom out (Ctrl+-)', { onclick: () => this.zoomBy(1 / 1.25) }), this.zoomLabel,
      iconButton('zoom-in', 'Zoom in (Ctrl+=)', { onclick: () => this.zoomBy(1.25) }));
    this.stage = h('div', { class: 'fpe-stage' }, this.canvas, this.emptyEl, this.dropEl, zoom);
    this.dock = h('aside', { class: 'fpe-panels', 'aria-label': 'Panels' });
    const shell = (this.shell = h('div', { class: 'fpe-shell' }, top, this.stage, this.optionsBar, this.toolsBar, this.dock));

    this.layerList = h('ul', { class: 'fpe-layer-list', 'aria-label': 'Layers, top first' });
    this.layerProps = h('div', { class: 'fpe-props' });
    const layerTools = h('div', { class: 'fpe-layer-tools', role: 'toolbar', 'aria-label': 'Layer actions' },
      iconButton('plus', 'New layer (Ctrl+Shift+N)', { 'data-testid': 'layer-add', onclick: () => this.addLayerAction() }),
      iconButton('copy', 'Duplicate layer (Ctrl+J)', { 'data-testid': 'layer-duplicate', onclick: () => this.duplicateLayerAction() }),
      iconButton('image-plus', 'Add an image as a new layer', { onclick: () => this.pickFile(true) }),
      iconButton('arrow-up', 'Move layer up', { 'data-testid': 'layer-up', onclick: () => this.moveLayerAction(1) }),
      iconButton('arrow-down', 'Move layer down', { 'data-testid': 'layer-down', onclick: () => this.moveLayerAction(-1) }),
      iconButton('trash', 'Delete layer', { 'data-testid': 'layer-delete', onclick: () => this.deleteLayerAction() }));
    this.makeSheet('layers', 'Layers', h('div', {}, layerTools, this.layerList, this.layerProps), false);
    this.adjustBody = h('div', { class: 'fpe-adjust' });
    this.makeSheet('adjust', 'Adjust and filters', this.adjustBody, false);
    this.makeSheet('export', 'Export', this.buildExport(), true);
    this.makeSheet('new', 'New picture', this.buildNew(), true);
    this.makeSheet('about', 'About Free Photo Editor', this.buildAbout(), true);
    this.makeSheet('menu', 'Menu', this.buildMenu(), true);
    this.makeSheet('keys', 'Keyboard shortcuts', this.buildKeys(), true);
    this.askBody = h('div', {});
    this.makeSheet('ask', 'Please choose', this.askBody, true);
    this.scrim = h('div', { class: 'fpe-scrim', onclick: () => this.closeModal() });
    this.toastEl = h('div', { class: 'fpe-toast', role: 'status', 'aria-live': 'polite', 'data-testid': 'toast' });
    this.fileInput = h('input', { type: 'file', accept: OPEN_ACCEPT, hidden: true, tabindex: -1, 'aria-hidden': 'true', 'data-testid': 'file-input' });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0], asLayer = this.fileAsLayer && !!this.doc;
      this.fileAsLayer = false;
      this.fileInput.value = '';
      if (f) void this.openFile(f, f.name, asLayer);
    });
    this.root.append(shell, ...this.sheets.values(), this.scrim, this.toastEl, this.fileInput);
  }
  private makeSheet(id: string, title: string, body: HTMLElement, modal: boolean): void {
    const tid = `fpe-${this.uid}-t-${id}`;
    const handle = h('div', { class: 'fpe-handle', 'aria-hidden': 'true' }, h('span'));
    const close = iconButton('close', 'Close', { class: 'fpe-btn fpe-icon-btn fpe-sheet-close', 'data-testid': 'close-' + id,
      onclick: () => (modal ? this.closeModal() : this.setPanel(id as PanelId, 'closed')) });
    const sheet = h('section', { class: 'fpe-sheet ' + (modal ? 'fpe-modal' : 'fpe-panel'), role: modal ? 'dialog' : 'region', 'aria-modal': modal ? 'true' : null,
      'aria-labelledby': tid, 'data-sheet': id, 'data-state': 'closed', 'data-testid': 'sheet-' + id },
      handle, h('div', { class: 'fpe-sheet-head' }, h('h2', { class: 'fpe-sheet-title', id: tid }, title), close), h('div', { class: 'fpe-sheet-body' }, body));
    sheet.inert = true;
    this.sheets.set(id, sheet);
    let y0 = 0, h0 = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if (this.layout !== 'phone') return;
      dragging = true; y0 = e.clientY; h0 = sheet.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      sheet.setAttribute('data-dragging', '');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - y0;
      if (modal) sheet.style.transform = `translateY(${Math.max(0, dy)}px)`; else sheet.style.height = Math.max(48, h0 - dy) + 'px';
    });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      sheet.removeAttribute('data-dragging');
      const dy = e.clientY - y0;
      sheet.style.transform = '';
      sheet.style.height = '';
      if (modal) { if (dy > 80) this.closeModal(); return; }
      if (Math.abs(dy) < 4) { this.setPanel(id as PanelId, sheet.dataset.state === 'full' ? 'half' : 'full'); return; }
      const ratio = (h0 - dy) / Math.max(1, this.root.clientHeight);
      this.setPanel(id as PanelId, ratio < 0.25 ? 'closed' : ratio < 0.7 ? 'half' : 'full');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  private longPress(el: HTMLElement, fn: () => void): void {
    let t = 0, fired = false;
    el.addEventListener('pointerdown', () => { fired = false; t = window.setTimeout(() => { fired = true; fn(); }, 480); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(t));
    el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(t); if (!fired) fn(); fired = true; });
  }

  // ---------- layout, theme, view ----------
  private onRootResize(): void {
    this.syncOptionsFade();
    const w = this.root.clientWidth;
    const layout: Layout = w >= 1200 ? 'desktop' : w >= 768 ? 'tablet' : 'phone';
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.dataset.layout = layout;
    this.toolsBar.setAttribute('aria-orientation', layout === 'phone' ? 'horizontal' : 'vertical');
    const panels = (['layers', 'adjust'] as const).map((id) => this.sheets.get(id) as HTMLElement);
    if (layout === 'desktop') {
      this.dock.append(...panels);
      for (const p of panels) p.dataset.state = 'open';
    } else {
      (layout === 'tablet' ? this.stage : this.root).append(...panels);
      for (const p of panels) p.dataset.state = 'closed';
    }
    this.syncInert();
    this.syncPanelButtons();
    this.syncOptionsFade();
  }
  private onStageResize(): void {
    this.renderer.resize(this.stage.clientWidth, this.stage.clientHeight, window.devicePixelRatio || 1);
    if (this.doc && this.fitted) this.fit(); else this.requestRender();
  }
  private initialTheme(): 'dark' | 'light' {
    let saved: string | null = null;
    try { saved = localStorage.getItem('fpe-theme'); } catch { /* storage may be blocked */ }
    if (saved === 'dark' || saved === 'light') return saved;
    if (this.opts.theme === 'light') return 'light';
    if (this.opts.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  }
  private applyTheme(t: 'dark' | 'light', save = false): void {
    this.root.dataset.theme = t;
    if (save) { try { localStorage.setItem('fpe-theme', t); } catch { /* ignore */ } }
    const cs = getComputedStyle(this.root);
    const v = (n: string, d: string): string => cs.getPropertyValue(n).trim() || d;
    this.renderer.setColors({ stage: v('--stage', '#0b0c0e'), checkA: v('--check-a', '#2a2b30'), checkB: v('--check-b', '#202126'), edge: v('--edge', 'rgba(255,255,255,.18)') });
    this.queueThumbs();
    this.requestRender();
  }
  private setView(v: View): void {
    const z = clamp(v.zoom, 0.01, 32);
    let { panX, panY } = v;
    if (this.doc) {
      const W = this.stage.clientWidth, H = this.stage.clientHeight, dw = this.doc.width * z, dh = this.doc.height * z, m = 48;
      panX = clamp(panX, Math.min(m - dw, W - m), Math.max(m - dw, W - m));
      panY = clamp(panY, Math.min(m - dh, H - m), Math.max(m - dh, H - m));
    }
    this.view = { zoom: z, panX, panY };
    this.requestRender();
  }
  private zoomAt(f: number, sx: number, sy: number): void {
    const v = this.view, z = clamp(v.zoom * f, 0.01, 32), k = z / v.zoom;
    this.setView({ zoom: z, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k });
  }
  private zoomBy(f: number): void { this.fitted = false; this.zoomAt(f, this.stage.clientWidth / 2, this.stage.clientHeight / 2); }
  private fit(): void {
    const d = this.doc;
    if (!d) { this.requestRender(); return; }
    const W = this.stage.clientWidth, H = this.stage.clientHeight, m = this.layout === 'phone' ? 12 : 32;
    const z = clamp(Math.min((W - m * 2) / d.width, (H - m * 2) / d.height), 0.01, 16);
    this.fitted = true;
    this.view = { zoom: z, panX: Math.round((W - d.width * z) / 2), panY: Math.round((H - d.height * z) / 2) };
    this.requestRender();
  }

  // ---------- rendering ----------
  private markDirty(r: Rect | null): void {
    if (!r || !this.doc) return;
    const c = intersect(r, docRect(this.doc));
    if (c) this.dirty = union(this.dirty, c);
  }
  private markAll(): void { if (this.doc) this.dirty = docRect(this.doc); }
  private requestRender(): void { if (!this.raf) this.raf = requestAnimationFrame(() => this.renderNow()); }
  private renderNow(): void {
    this.raf = 0;
    const d = this.doc;
    if (d && (d.width !== this.rendW || d.height !== this.rendH)) {
      this.renderer.setDocumentSize(d.width, d.height);
      this.rendW = d.width; this.rendH = d.height;
      this.dirty = docRect(d);
    }
    if (d && this.dirty) { const r = this.dirty; this.dirty = null; this.renderer.upload(r, compositeDoc(d, r)); }
    const t = this.tool, z = this.view.zoom;
    const size = t === 'eraser' ? this.eraser.size : this.brush.size;
    const cursor = this.hoverPt && d && (t === 'brush' || t === 'eraser') ? { x: this.hoverPt.x, y: this.hoverPt.y, r: (size / 2) * z } : null;
    this.renderer.render(this.view, { selection: d?.selection ?? null, crop: t === 'crop' ? this.crop : null, cursor, ants: this.ants });
    this.zoomLabel.textContent = Math.round(z * 100) + '%';
  }

  // ---------- tools ----------
  private setTool(t: Tool): void {
    if (this.stroke || this.drag) return;
    if (t !== 'crop') this.crop = null;
    this.tool = t;
    this.root.dataset.tool = t;
    for (const b of this.toolsBar.querySelectorAll<HTMLElement>('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    this.renderOptions();
    this.requestRender();
  }
  private clampPt(p: Pt): Pt {
    const d = this.doc as Doc;
    return { x: clamp(Math.round(p.x), 0, d.width), y: clamp(Math.round(p.y), 0, d.height) };
  }
  private strokePoint(p: Pt, i: PointerInfo): StrokePoint {
    if (i.type !== 'pen') return { x: p.x, y: p.y };
    const o = this.tool === 'eraser' ? this.eraser : this.brush;
    const pr = clamp(i.pressure, 0.05, 1), tilt = Math.min(1, Math.hypot(i.tiltX, i.tiltY) / 60);
    return { x: p.x, y: p.y, size: o.size * (0.2 + 0.8 * pr) * (1 + 0.5 * tilt), flow: (0.35 + 0.65 * pr) * (1 - 0.3 * tilt) };
  }
  private toolStart(p: Pt, i: PointerInfo): void {
    const d = this.doc;
    this.closePopover();
    if (!d) return;
    if (this.session) { this.toast('Apply or cancel the adjustment first.'); return; }
    const t: Tool = i.alt && this.tool === 'brush' ? 'eyedropper' : this.tool;
    if (t === 'brush' || t === 'eraser') {
      const l = activeLayer(d);
      if (!l) return;
      if (!l.visible) { this.toast('This layer is hidden. Show it to paint on it.'); return; }
      const o = t === 'brush' ? this.brush : this.eraser;
      this.stroke = new Stroke(d, l, { size: o.size, hardness: o.hardness, opacity: o.opacity, color: parseHex(this.brush.color) ?? BLACK, erase: t === 'eraser' });
      this.stroke.add(this.strokePoint(p, i));
      this.flushStroke();
      return;
    }
    if (t === 'move') { const l = activeLayer(d); if (l) this.drag = { kind: 'move', start: p, x: l.x, y: l.y, id: l.id }; return; }
    if (t === 'eyedropper') { this.drag = { kind: 'pick', start: p }; this.pick(p); return; }
    this.drag = { kind: t, start: this.clampPt(p) };
    if (t === 'crop') this.crop = null; else d.selection = null;
    this.updateAnts();
    this.requestRender();
  }
  private toolMove(p: Pt, i: PointerInfo): void {
    const d = this.doc;
    if (!d) return;
    if (this.stroke) { this.stroke.add(this.strokePoint(p, i)); this.flushStroke(); return; }
    const g = this.drag;
    if (!g) return;
    if (g.kind === 'move') {
      const l = findLayer(d, g.id);
      if (!l) return;
      const old = layerRect(l);
      l.x = Math.round(g.x + p.x - g.start.x);
      l.y = Math.round(g.y + p.y - g.start.y);
      this.markDirty(union(old, layerRect(l)));
      this.requestRender();
      return;
    }
    if (g.kind === 'pick') { this.pick(p); return; }
    let r = rectFromPoints(g.start, this.clampPt(p));
    if (i.shift) { const s = Math.min(r.w, r.h); r = { x: r.x, y: r.y, w: s, h: s }; }
    const ok = r.w > 0 && r.h > 0 ? r : null;
    if (g.kind === 'select') d.selection = ok; else this.crop = ok;
    this.requestRender();
  }
  private toolEnd(p: Pt, i: PointerInfo): void {
    const d = this.doc;
    if (this.stroke) {
      this.stroke.add(this.strokePoint(p, i));
      this.flushStroke();
      const cmd = this.stroke.end();
      this.stroke = null;
      this.pushCmd(cmd);
      return;
    }
    const g = this.drag;
    this.drag = null;
    if (!g || !d) return;
    if (g.kind === 'move') {
      const l = findLayer(d, g.id);
      if (l && (l.x !== g.x || l.y !== g.y)) this.pushCmd(propsCommand(l.id, { x: g.x, y: g.y }, { x: l.x, y: l.y }, 'Move layer'));
    } else if (g.kind === 'pick') this.toast('Colour picked: ' + this.brush.color);
    else if (g.kind === 'select') { if (d.selection && (d.selection.w < 2 || d.selection.h < 2)) d.selection = null; this.afterSelection(); }
    else { if (this.crop && (this.crop.w < 2 || this.crop.h < 2)) this.crop = null; this.renderOptions(); }
    this.requestRender();
  }
  private toolCancel(): void {
    if (this.stroke) { const r = this.stroke.cancel(); this.stroke = null; this.markDirty(r); this.requestRender(); }
    const g = this.drag;
    this.drag = null;
    if (g && g.kind === 'move' && this.doc) {
      const l = findLayer(this.doc, g.id);
      if (l) { const old = layerRect(l); l.x = g.x; l.y = g.y; this.markDirty(union(old, layerRect(l))); this.requestRender(); }
    }
  }
  private flushStroke(): void { const r = this.stroke?.takeDirty() ?? null; if (r) { this.markDirty(r); this.requestRender(); } }
  private pick(p: Pt): void {
    const d = this.doc;
    if (!d) return;
    const c = samplePixel(d, p.x, p.y, this.sampleAll ? undefined : activeLayer(d));
    if (!c || c.a === 0) return;
    this.brush.color = toHex(c);
    this.syncColor();
  }
  private syncColor(): void {
    for (const el of this.root.querySelectorAll<HTMLInputElement>('input[data-color]')) el.value = this.brush.color;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-swatch]')) el.style.background = this.brush.color;
  }
  private renderOptions(): void {
    const o = this.optionsBar, t = this.tool, d = this.doc;
    o.replaceChildren();
    const hint = (s: string): HTMLElement => h('span', { class: 'fpe-hint' }, s);
    if (t === 'brush' || t === 'eraser') {
      const b = t === 'brush' ? this.brush : this.eraser;
      if (t === 'brush') {
        const ci = h('input', { type: 'color', value: this.brush.color, 'aria-label': 'Brush colour', 'data-color': '', 'data-testid': 'brush-color' });
        ci.addEventListener('input', () => { this.brush.color = ci.value; this.syncColor(); });
        o.append(h('label', { class: 'fpe-swatch', title: 'Brush colour' }, ci, h('span', { 'data-swatch': '', style: 'background:' + this.brush.color })));
      }
      o.append(
        this.slider('Size', 1, 500, Math.round(b.size), ' px', (v) => { b.size = v; this.requestRender(); }, 'opt-size'),
        this.slider('Hardness', 0, 100, Math.round(b.hardness * 100), '%', (v) => { b.hardness = v / 100; }, 'opt-hardness'),
        this.slider('Opacity', 1, 100, Math.round(b.opacity * 100), '%', (v) => { b.opacity = v / 100; }, 'opt-opacity'));
    } else if (t === 'select') {
      const s = d?.selection;
      o.append(hint(s ? `${s.w} × ${s.h} px selected` : 'Drag over the picture to select an area.'),
        this.optBtn('Select all', () => this.selectAll(), false, 'sel-all'), this.optBtn('Deselect', () => this.deselect(), !s),
        this.optBtn('Delete area', () => this.deleteArea(), !s, 'sel-delete'), this.optBtn('Crop to selection', () => this.cropToSelection(), !s, 'sel-crop'));
    } else if (t === 'crop') {
      if (this.crop) o.append(hint(`Keep ${this.crop.w} × ${this.crop.h} px`),
        this.optBtn('Cancel', () => { this.crop = null; this.renderOptions(); this.requestRender(); }, false, 'crop-cancel'),
        this.optBtn('Apply crop', () => this.applyCrop(), false, 'crop-apply', true));
      else o.append(hint('Drag over the picture to choose the part to keep.'));
    } else if (t === 'move') o.append(hint('Drag to move the active layer. Arrow keys nudge it 1 px (Shift: 10 px).'));
    else {
      const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Sample from' });
      for (const [all, label] of [[true, 'All layers'], [false, 'This layer']] as const) {
        seg.append(h('button', { type: 'button', 'aria-pressed': String(this.sampleAll === all), onclick: () => { this.sampleAll = all; this.renderOptions(); } }, label));
      }
      o.append(h('span', { class: 'fpe-dot', 'data-swatch': '', style: 'background:' + this.brush.color, role: 'img', 'aria-label': 'Brush colour ' + this.brush.color }),
        hint('Tap the picture to pick a colour for the brush.'), seg);
    }
    this.syncOptionsFade();
  }
  private slider(label: string, min: number, max: number, value: number, unit: string, onInput: (v: number) => void, testid: string): HTMLElement {
    const id = `fpe-${this.uid}-${testid}`;
    const out = h('output', { class: 'fpe-out', for: id }, value + unit);
    const inp = h('input', { id, type: 'range', min, max, step: 1, value, 'data-testid': testid });
    inp.addEventListener('input', () => { const v = Number(inp.value); out.textContent = v + unit; onInput(v); });
    return h('div', { class: 'fpe-field' }, h('label', { for: id }, label), inp, out);
  }
  private optBtn(label: string, run: () => void, disabled = false, testid?: string, primary = false): HTMLButtonElement {
    return h('button', { type: 'button', class: 'fpe-btn ' + (primary ? 'fpe-btn-primary' : 'fpe-btn-ghost'), disabled, 'data-testid': testid, onclick: run }, label);
  }
  private showVariants(t: Tool, anchor: HTMLElement): void {
    const items: { label: string; run: () => void }[] = [];
    if (t === 'brush') items.push({ label: 'Soft round brush', run: () => { this.brush.hardness = 0.1; } }, { label: 'Hard round brush', run: () => { this.brush.hardness = 1; } },
      { label: 'Fine liner (4 px)', run: () => Object.assign(this.brush, { size: 4, hardness: 1 }) }, { label: 'Large soft (160 px)', run: () => Object.assign(this.brush, { size: 160, hardness: 0 }) });
    else if (t === 'eraser') items.push({ label: 'Soft eraser', run: () => { this.eraser.hardness = 0.1; } }, { label: 'Hard eraser', run: () => { this.eraser.hardness = 1; } });
    else if (t === 'select') items.push({ label: 'Select all', run: () => this.selectAll() }, { label: 'Deselect', run: () => this.deselect() });
    else if (t === 'eyedropper') items.push({ label: 'Sample all layers', run: () => { this.sampleAll = true; } }, { label: 'Sample the active layer only', run: () => { this.sampleAll = false; } });
    else return;
    this.showPopover(items.map((it) => ({ label: it.label, run: () => { it.run(); this.setTool(t); } })), anchor);
  }

  // ---------- selection and crop ----------
  private selectAll(): void { const d = this.doc; if (!d) return this.needDoc(); d.selection = docRect(d); this.afterSelection(); }
  private deselect(): void { const d = this.doc; if (!d || !d.selection) return; d.selection = null; this.afterSelection(); }
  private afterSelection(): void { this.updateAnts(); this.renderOptions(); this.requestRender(); }
  private updateAnts(): void {
    clearInterval(this.antsTimer);
    this.antsTimer = 0;
    if (this.doc?.selection && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.antsTimer = window.setInterval(() => { this.ants = (this.ants + 1) % 10; this.requestRender(); }, 120);
    }
  }
  private deleteArea(): void {
    const d = this.doc;
    if (!d) return;
    if (!d.selection) { this.toast('Select an area first, then delete it.'); return; }
    const l = activeLayer(d);
    if (!l) return;
    const r = { x: d.selection.x, y: d.selection.y, w: d.selection.w, h: d.selection.h };
    this.pushCmd(clearSelection(d, l));
    this.markDirty(r);
  }
  private cropToSelection(): void { const s = this.doc?.selection; if (!s) { this.toast('Select an area first.'); return; } this.applyCropRect(s); }
  private applyCrop(): void { const r = this.crop; if (!r) return; this.crop = null; this.applyCropRect(r); }
  private applyCropRect(r: Rect): void {
    const d = this.doc;
    if (!d) return;
    this.cancelSession();
    const cmd = cropDocument(d, r);
    if (!cmd) return;
    this.pushCmd(cmd, true);
    this.updateAnts();
    this.fit();
    this.renderOptions();
    this.toast(`Cropped to ${d.width} × ${d.height} px.`);
  }

  // ---------- history ----------
  private pushCmd(cmd: Command | null, all = false): void {
    if (!cmd) return;
    this.history.push(cmd);
    if (all) this.markAll();
    this.afterEdit();
  }
  private afterEdit(): void { this.updateUndo(); this.renderLayers(); this.requestRender(); }
  private undo(gesture = false): void {
    const d = this.doc;
    if (!d || this.stroke) return;
    this.cancelSession();
    this.crop = null;
    const c = this.history.undo(d);
    if (!c) { if (gesture) this.toast('Nothing to undo.'); return; }
    this.afterHistory();
    if (gesture) this.toast('Undone: ' + c.label);
  }
  private redo(gesture = false): void {
    const d = this.doc;
    if (!d || this.stroke) return;
    this.cancelSession();
    const c = this.history.redo(d);
    if (!c) { if (gesture) this.toast('Nothing to redo.'); return; }
    this.afterHistory();
    if (gesture) this.toast('Redone: ' + c.label);
  }
  private afterHistory(): void {
    const d = this.doc;
    const resized = !!d && (d.width !== this.rendW || d.height !== this.rendH);
    this.markAll();
    this.updateAnts();
    this.updateUndo();
    this.renderLayers();
    this.renderOptions();
    if (resized) this.fit();
    this.requestRender();
  }
  private updateUndo(): void {
    const hs = this.history;
    this.undoBtn.disabled = !hs.canUndo;
    this.redoBtn.disabled = !hs.canRedo;
    this.undoBtn.title = hs.undoLabel ? `Undo: ${hs.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    this.redoBtn.title = hs.redoLabel ? `Redo: ${hs.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  }

  // ---------- layers ----------
  private renderLayers(): void {
    const d = this.doc, list = this.layerList;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    list.replaceChildren();
    this.layerProps.replaceChildren();
    if (!d) { list.append(h('li', { class: 'fpe-note' }, 'Open or create a picture to see its layers.')); return; }
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i], on = l.id === d.activeId;
      list.append(h('li', { class: 'fpe-layer', 'data-testid': 'layer-row', 'aria-current': on ? 'true' : 'false' },
        h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn', 'aria-pressed': String(l.visible), 'aria-label': (l.visible ? 'Hide ' : 'Show ') + l.name,
          title: l.visible ? 'Hide layer' : 'Show layer', 'data-testid': 'layer-eye', onclick: () => this.toggleVisible(l.id) }, icon(l.visible ? 'eye' : 'eye-off')),
        h('canvas', { class: 'fpe-layer-thumb', width: 80, height: 80, 'data-thumb': l.id, 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'fpe-btn fpe-layer-name', 'aria-label': `Layer ${l.name}${l.visible ? '' : ', hidden'}${on ? ', active' : ''}`,
          'data-testid': 'layer-select', onclick: () => this.selectLayer(l.id), ondblclick: () => this.focusRename() }, h('span', {}, l.name))));
    }
    const a = activeLayer(d);
    if (a) {
      const id = `fpe-${this.uid}-l`;
      const name = h('input', { id: id + 'n', type: 'text', value: a.name, maxlength: 100, autocomplete: 'off', spellcheck: 'false', 'data-testid': 'layer-name' });
      name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== a.name) this.pushCmd(setLayerProps(d, a.id, { name: v })); else name.value = a.name; });
      const op = h('input', { id: id + 'o', type: 'range', min: 0, max: 100, step: 1, value: Math.round(a.opacity * 100), 'data-testid': 'layer-opacity' });
      const opOut = h('output', { class: 'fpe-out', for: id + 'o' }, Math.round(a.opacity * 100) + '%');
      op.addEventListener('input', () => {
        if (this.opacityStart === null) this.opacityStart = a.opacity;
        a.opacity = Number(op.value) / 100;
        opOut.textContent = op.value + '%';
        this.markAll();
        this.requestRender();
      });
      op.addEventListener('change', () => {
        const from = this.opacityStart;
        this.opacityStart = null;
        if (from !== null && from !== a.opacity) this.pushCmd(propsCommand(a.id, { opacity: from }, { opacity: a.opacity }, 'Layer opacity'));
      });
      const blend = h('select', { id: id + 'b', 'data-testid': 'layer-blend' },
        ...BLEND_GROUPS.map((g) => h('optgroup', { label: g.label }, ...g.modes.map((m) => h('option', { value: m, selected: m === a.blendMode }, BLEND_LABELS[m])))));
      blend.addEventListener('change', () => { const v = blend.value; if (isBlendMode(v)) this.pushCmd(setLayerProps(d, a.id, { blendMode: v }), true); });
      this.layerProps.append(
        h('div', { class: 'fpe-row' }, h('label', { for: id + 'n' }, 'Name'), name),
        h('div', { class: 'fpe-row' }, h('label', { for: id + 'o' }, 'Opacity'), op, opOut),
        h('div', { class: 'fpe-row' }, h('label', { for: id + 'b' }, 'Blend mode'), blend));
    }
    if (focused) this.root.querySelector<HTMLElement>(`.fpe-props [data-testid="${focused}"]`)?.focus({ preventScroll: true });
    this.queueThumbs();
  }
  private queueThumbs(): void { clearTimeout(this.thumbTimer); this.thumbTimer = window.setTimeout(() => this.drawThumbs(), 180); }
  private drawThumbs(): void {
    const d = this.doc;
    if (!d) return;
    for (const l of d.layers) {
      const c = this.root.querySelector<HTMLCanvasElement>(`canvas[data-thumb="${l.id}"]`);
      const ctx = c?.getContext('2d');
      if (!c || !ctx) continue;
      const S = c.width, img = ctx.createImageData(S, S), k = Math.max(d.width, d.height) / S;
      const ox = (S - d.width / k) / 2, oy = (S - d.height / k) / 2;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = Math.floor((x - ox) * k), dy = Math.floor((y - oy) * k), i = (y * S + x) * 4;
        if (dx < 0 || dy < 0 || dx >= d.width || dy >= d.height) continue;
        const bg = ((x >> 3) + (y >> 3)) & 1 ? 232 : 204;
        let r = bg, g = bg, b = bg;
        const lx = dx - l.x, ly = dy - l.y;
        if (lx >= 0 && ly >= 0 && lx < l.width && ly < l.height) {
          const j = (ly * l.width + lx) * 4, a = l.data[j + 3] / 255;
          r = l.data[j] * a + bg * (1 - a); g = l.data[j + 1] * a + bg * (1 - a); b = l.data[j + 2] * a + bg * (1 - a);
        }
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
  }
  private addLayerAction(): void { if (!this.doc) return this.needDoc(); this.pushCmd(addEmptyLayer(this.doc)); }
  private duplicateLayerAction(): void { if (!this.doc) return this.needDoc(); this.pushCmd(duplicateActive(this.doc), true); }
  private deleteLayerAction(): void {
    const d = this.doc;
    if (!d) return this.needDoc();
    if (d.layers.length < 2) { this.toast('A picture needs at least one layer.'); return; }
    this.cancelSession();
    this.pushCmd(deleteLayer(d, d.activeId), true);
  }
  private moveLayerAction(dir: 1 | -1): void {
    const d = this.doc;
    if (!d) return;
    const i = indexOfLayer(d, d.activeId);
    this.pushCmd(moveLayer(d, i, i + dir), true);
  }
  private toggleVisible(id: string): void {
    const d = this.doc, l = d ? findLayer(d, id) : undefined;
    if (!d || !l) return;
    this.pushCmd(setLayerProps(d, id, { visible: !l.visible }), true);
  }
  private selectLayer(id: string): void {
    const d = this.doc;
    if (!d || d.activeId === id) return;
    this.cancelSession();
    d.activeId = id;
    this.renderLayers();
  }
  private focusRename(): void { this.layerProps.querySelector<HTMLInputElement>('[data-testid="layer-name"]')?.select(); }
  private needDoc(): void { this.toast('Open or create a picture first.'); }

  // ---------- adjustments and filters ----------
  private renderAdjust(): void {
    const b = this.adjustBody, s = this.session;
    b.replaceChildren();
    if (!s) {
      for (const group of ['Adjustments', 'Filters'] as const) {
        b.append(h('h3', { class: 'fpe-group-title' }, group), h('div', { class: 'fpe-list' },
          ...ITEMS.filter((it) => it.group === group).map((it) => h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'adj-' + it.id, onclick: () => void this.startItem(it) }, it.label))));
      }
      b.append(h('p', { class: 'fpe-note' }, 'Changes apply to the selected area, or to the whole active layer when nothing is selected.'));
      return;
    }
    const d = this.doc, l = d ? findLayer(d, s.layerId) : undefined;
    b.append(h('h3', { class: 'fpe-group-title' }, s.item.label),
      h('p', { class: 'fpe-note' }, `${d?.selection ? 'The selected part of' : 'The whole of'} "${l?.name ?? 'the layer'}". The picture updates as you move the sliders.`));
    const params = (s.spec.params ??= {});
    for (const c of s.item.controls ?? []) {
      const id = `fpe-${this.uid}-c-${c.key}`, val = Number(params[c.key] ?? 0);
      const out = h('output', { class: 'fpe-out', for: id }, fmtNum(val) + c.unit);
      const inp = h('input', { id, type: 'range', min: c.min, max: c.max, step: c.step, value: val, 'data-testid': 'ctl-' + c.key });
      inp.addEventListener('input', () => { const v = Number(inp.value); params[c.key] = v; out.textContent = fmtNum(v) + c.unit; this.preview(); });
      b.append(h('div', { class: 'fpe-row' }, h('label', { for: id }, c.label), inp, out));
    }
    b.append(h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'adj-cancel', onclick: () => this.cancelSession() }, 'Cancel'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'adj-apply', onclick: () => void this.applySession() }, icon('check'), 'Apply')));
  }
  private async startItem(it: AdjItem): Promise<void> {
    const d = this.doc;
    if (!d) return this.needDoc();
    if (this.stroke) return;
    this.cancelSession();
    const l = activeLayer(d);
    if (!l) return;
    const r = editRegion(d, l);
    if (!r) { this.toast('The selected area is outside this layer.'); return; }
    const spec: JobSpec = { op: it.spec.op, kind: it.spec.kind, params: { ...it.spec.params } };
    const maxR = Math.max(1, ...(it.controls ?? []).filter((c) => c.key === 'radius').map((c) => c.max));
    const padded = paddedRegion(l, r, jobPadding({ op: spec.op, params: { radius: maxR } }));
    this.session = { item: it, spec, layerId: l.id, r, padded, source: readRegion(l, padded), before: readRegion(l, r), running: null, queued: false, ran: false };
    this.renderAdjust();
    if (this.layout !== 'desktop' && !it.instant) this.setPanel('adjust', 'half');
    this.preview();
    if (it.instant) await this.applySession();
  }
  private preview(): void {
    const s = this.session;
    if (!s) return;
    if (s.running) { s.queued = true; return; }
    const spec: JobSpec = { op: s.spec.op, kind: s.spec.kind, params: { ...s.spec.params } };
    const done = this.busyAfter(150);
    s.running = this.jobs.run(spec, { width: s.padded.w, height: s.padded.h, data: s.source }).then((res) => {
      const d = this.doc;
      if (this.session !== s || !d) return;
      const l = findLayer(d, s.layerId);
      if (!l) return;
      commitResult(d, l, s.r, s.before, innerOf(res, s.padded, s.r), s.item.label);
      s.ran = true;
      this.markDirty({ x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h });
      this.requestRender();
    }).catch((e: unknown) => this.toast(errText(e))).finally(() => {
      done();
      s.running = null;
      if (s.queued && this.session === s) { s.queued = false; this.preview(); }
    });
  }
  private async applySession(): Promise<void> {
    const s = this.session;
    if (!s) return;
    while (s.running) await s.running;
    if (this.session !== s) return;
    this.session = null;
    if (s.ran) {
      this.history.push(pixelCommand(s.item.label, s.layerId, s.r, s.before));
      this.afterEdit();
      this.toast(`${s.item.label}: done.`);
    }
    this.renderAdjust();
  }
  private cancelSession(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    const l = this.doc ? findLayer(this.doc, s.layerId) : undefined;
    if (l && s.ran) { writeRegion(l, s.r, s.before); this.markDirty({ x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h }); this.requestRender(); }
    this.renderAdjust();
  }

  // ---------- panels, dialogs, menus ----------
  private setPanel(id: PanelId, state: 'closed' | 'half' | 'full'): void {
    if (this.layout === 'desktop') return;
    for (const other of ['layers', 'adjust'] as const) {
      const s = this.sheets.get(other) as HTMLElement;
      const st = other === id ? state : state === 'closed' ? s.dataset.state ?? 'closed' : 'closed';
      s.dataset.state = st;
    }
    this.syncInert();
    if (id === 'adjust' && state === 'closed') this.cancelSession();
    this.syncPanelButtons();
  }
  private togglePanel(id: PanelId): void {
    if (this.layout === 'desktop') { this.root.dataset.panels = this.root.dataset.panels === 'closed' ? 'open' : 'closed'; this.syncPanelButtons(); return; }
    this.setPanel(id, this.sheets.get(id)?.dataset.state === 'closed' ? 'half' : 'closed');
  }
  private syncPanelButtons(): void {
    for (const b of this.toolsBar.querySelectorAll<HTMLElement>('[data-panel]')) {
      const open = this.layout === 'desktop' ? this.root.dataset.panels !== 'closed' : this.sheets.get(b.dataset.panel ?? '')?.dataset.state !== 'closed';
      b.setAttribute('aria-expanded', String(open));
      b.classList.toggle('fpe-on', open);
    }
  }
  /** While a dialog is open, everything behind it is inert, so keyboard focus stays in the dialog. */
  private syncInert(): void {
    this.shell.inert = !!this.modal;
    for (const id of ['layers', 'adjust'] as const) {
      const p = this.sheets.get(id) as HTMLElement;
      p.inert = !!this.modal || (this.layout !== 'desktop' && p.dataset.state === 'closed');
    }
  }
  /** Fades the options bar's edge while more options sit off screen (phones), so people know to swipe it. */
  private syncOptionsFade(): void {
    const o = this.optionsBar, rest = o.scrollWidth - o.clientWidth - o.scrollLeft;
    o.toggleAttribute('data-more', rest > 2);
    o.toggleAttribute('data-less', o.scrollLeft > 2);
  }
  private openModal(id: string): void {
    const s = this.sheets.get(id);
    if (!s) return;
    this.closePopover();
    if (this.modal && this.modal !== id) this.closeModal(false);
    else if (!this.modal) this.modalReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modal = id;
    s.dataset.state = 'open';
    s.inert = false;
    this.syncInert();
    this.scrim.setAttribute('data-on', '');
    requestAnimationFrame(() => (s.querySelector<HTMLElement>('[data-autofocus]') ?? s.querySelector<HTMLElement>('.fpe-sheet-body .fpe-btn-primary')
      ?? s.querySelector<HTMLElement>('.fpe-sheet-body button'))?.focus({ preventScroll: true }));
  }
  private closeModal(restore = true): void {
    const id = this.modal;
    if (!id) return;
    const s = this.sheets.get(id);
    if (s) { s.dataset.state = 'closed'; s.inert = true; }
    this.modal = null;
    this.syncInert();
    this.scrim.removeAttribute('data-on');
    if (id === 'ask' && this.askResolve) { const r = this.askResolve; this.askResolve = null; r('cancel'); }
    if (restore) { this.modalReturn?.focus({ preventScroll: true }); this.modalReturn = null; }
  }
  private ask(message: string, primary: string, secondary: string): Promise<Answer> {
    if (this.askResolve) { const r = this.askResolve; this.askResolve = null; r('cancel'); }
    return new Promise<Answer>((res) => {
      this.askResolve = res;
      const done = (v: Answer): void => { const r = this.askResolve; this.askResolve = null; this.closeModal(); r?.(v); };
      this.askBody.replaceChildren(h('p', {}, message), h('div', { class: 'fpe-actions' },
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-autofocus': '', 'data-testid': 'ask-secondary', onclick: () => done('secondary') }, secondary),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'ask-primary', onclick: () => done('primary') }, primary)));
      this.openModal('ask');
    });
  }
  private async confirmReplace(): Promise<boolean> {
    if (!this.doc || this.history.stateId() === this.savedId) return true;
    return (await this.ask('Replace the current picture? Changes you have not exported will be lost.', 'Replace it', 'Keep editing')) === 'primary';
  }
  private showPopover(items: { label: string; run: () => void; disabled?: boolean }[], at: HTMLElement | { x: number; y: number }): void {
    this.closePopover();
    const pop = h('div', { class: 'fpe-pop', role: 'menu' }, ...items.map((it) =>
      h('button', { type: 'button', class: 'fpe-btn', role: 'menuitem', disabled: !!it.disabled, onclick: () => { this.closePopover(); it.run(); } }, it.label)));
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const all = [...pop.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
    });
    this.root.append(pop);
    const rr = this.root.getBoundingClientRect();
    let x: number, y: number;
    if (at instanceof HTMLElement) {
      const ar = at.getBoundingClientRect();
      if (this.layout === 'phone') { x = ar.left - rr.left; y = ar.top - rr.top - pop.offsetHeight - 6; } else { x = ar.right - rr.left + 6; y = ar.top - rr.top; }
    } else { x = at.x - rr.left; y = at.y - rr.top; }
    pop.style.left = clamp(x, 8, Math.max(8, rr.width - pop.offsetWidth - 8)) + 'px';
    pop.style.top = clamp(y, 8, Math.max(8, rr.height - pop.offsetHeight - 8)) + 'px';
    this.popover = pop;
    pop.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    setTimeout(() => document.addEventListener('pointerdown', this.outsidePop, true), 0);
  }
  private outsidePop = (e: Event): void => { if (this.popover && !this.popover.contains(e.target as Node)) this.closePopover(); };
  private closePopover(): void {
    if (!this.popover) return;
    this.popover.remove();
    this.popover = null;
    document.removeEventListener('pointerdown', this.outsidePop, true);
  }
  private contextMenu(x: number, y: number): void {
    const d = this.doc;
    if (!d) return;
    const s = !d.selection;
    this.showPopover([
      { label: 'Undo', run: () => this.undo(), disabled: !this.history.canUndo },
      { label: 'Redo', run: () => this.redo(), disabled: !this.history.canRedo },
      { label: 'Select all', run: () => this.selectAll() },
      { label: 'Deselect', run: () => this.deselect(), disabled: s },
      { label: 'Delete selected area', run: () => this.deleteArea(), disabled: s },
      { label: 'Crop to selection', run: () => this.cropToSelection(), disabled: s },
      { label: 'New layer', run: () => this.addLayerAction() },
      { label: 'Duplicate layer', run: () => this.duplicateLayerAction() },
      { label: 'Fit to screen', run: () => this.fit() },
    ], { x, y });
  }
  private buildExport(): HTMLElement {
    const id = `fpe-${this.uid}-x`;
    this.exportName = h('input', { id: id + 'n', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'export-name' });
    this.exportChips = h('div', { class: 'fpe-chips', role: 'radiogroup', 'aria-label': 'File format' },
      ...EXPORT_FORMATS.map((f) => h('button', { type: 'button', class: 'fpe-chip', role: 'radio', 'aria-checked': 'false', 'data-format': f, 'data-testid': 'export-format-' + f,
        onclick: () => { this.exportFormat = f; this.renderExport(); } }, FORMAT_INFO[f].label)));
    this.exportChips.addEventListener('keydown', (e) => {
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown', back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      if (!fwd && !back) return;
      e.preventDefault();
      const n = EXPORT_FORMATS.length, i = EXPORT_FORMATS.indexOf(this.exportFormat);
      this.exportFormat = EXPORT_FORMATS[(i + (fwd ? 1 : n - 1)) % n];
      this.renderExport();
      this.exportChips.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
    const q = h('input', { id: id + 'q', type: 'range', min: 10, max: 100, step: 1, value: 92, 'data-testid': 'export-quality' });
    const qOut = h('output', { class: 'fpe-out', for: id + 'q' }, '92%');
    q.addEventListener('input', () => { this.exportQuality = Number(q.value) / 100; qOut.textContent = q.value + '%'; this.renderExport(); });
    this.qualityRow = h('div', { class: 'fpe-row' }, h('label', { for: id + 'q' }, 'Quality'), q, qOut);
    this.lossBox = h('div', { class: 'fpe-loss', 'data-testid': 'loss-warning', 'aria-live': 'polite' });
    this.exportGo = h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'export-go', onclick: () => void this.doExport() }, 'Export');
    return h('div', { class: 'fpe-stack' },
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'n' }, 'File name'), this.exportName),
      h('div', { class: 'fpe-field-col' }, h('span', { class: 'fpe-label' }, 'Format'), this.exportChips),
      this.qualityRow, this.lossBox,
      h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', onclick: () => this.closeModal() }, 'Cancel'), this.exportGo));
  }
  private openExport(): void {
    const d = this.doc;
    if (!d) return this.needDoc();
    if (this.session) { this.toast('Apply or cancel the adjustment first.'); return; }
    this.exportFacts = docFacts(d);
    this.exportName.value = this.name;
    this.renderExport();
    this.openModal('export');
  }
  private renderExport(): void {
    const f = this.exportFacts;
    if (!f) return;
    const fmt = this.exportFormat, label = FORMAT_INFO[fmt].label, rep = lossReport(f, fmt, this.exportQuality);
    for (const b of this.exportChips.querySelectorAll<HTMLElement>('[data-format]')) {
      const on = b.dataset.format === fmt;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.qualityRow.hidden = !FORMAT_INFO[fmt].lossy;
    const kids: Node[] = [h('h3', {}, icon('info'), rep.losses.length ? `What ${label} loses for this picture` : `${label} keeps everything in this picture`)];
    if (rep.losses.length) kids.push(h('ul', {}, ...rep.losses.map((l) => h('li', {}, l.text))));
    kids.push(h('p', { class: 'fpe-kept' }, rep.kept));
    const sg = rep.suggest;
    if (sg) kids.push(h('p', {}, rep.suggestText ?? ''), h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'loss-switch',
      onclick: () => { this.exportFormat = sg; this.renderExport(); } }, `Use ${FORMAT_INFO[sg].label} instead`));
    this.lossBox.replaceChildren(...kids);
    this.lossBox.dataset.losses = String(rep.losses.length);
    this.exportGo.textContent = rep.losses.length ? `Export ${label} anyway` : `Export ${label}`;
  }
  private async doExport(): Promise<void> {
    const d = this.doc;
    if (!d) return;
    const fmt = this.exportFormat, info = FORMAT_INFO[fmt], file = baseName(this.exportName.value || this.name) + '.' + info.ext;
    const done = this.busyAfter(100);
    this.exportGo.disabled = true;
    try {
      const { blob, note } = await encodeDocument(d, fmt, this.exportQuality);
      download(blob, file, this.root);
      this.savedId = this.history.stateId();
      this.closeModal();
      this.toast(`Saved ${file} (${fmtBytes(blob.size)}).${note ? ' ' + note : ''}`);
    } catch (e) {
      this.toast(errText(e, "The file couldn't be made."));
    } finally {
      done();
      this.exportGo.disabled = false;
    }
  }
  private buildNew(): HTMLElement {
    const id = `fpe-${this.uid}-new`;
    const w = h('input', { id: id + 'w', type: 'number', min: 1, max: 16384, value: 1080, inputmode: 'numeric', 'data-testid': 'new-width' });
    const hh = h('input', { id: id + 'h', type: 'number', min: 1, max: 16384, value: 1080, inputmode: 'numeric', 'data-testid': 'new-height' });
    const presets: [string, number, number][] = [['Square post', 1080, 1080], ['Phone wallpaper', 1080, 1920], ['HD screen', 1920, 1080], ['A4 print', 2480, 3508], ['Small', 800, 600]];
    let bg: 'white' | 'transparent' | 'color' = 'white';
    const color = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'Background colour', hidden: true });
    const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Background' });
    const setBg = (v: typeof bg): void => {
      bg = v;
      for (const b of seg.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.bg === v));
      color.hidden = v !== 'color';
    };
    for (const [v, label] of [['white', 'White'], ['transparent', 'Transparent'], ['color', 'Colour']] as const) {
      seg.append(h('button', { type: 'button', 'data-bg': v, 'aria-pressed': String(v === 'white'), onclick: () => setBg(v) }, label));
    }
    const create = async (): Promise<void> => {
      const W = Math.round(Number(w.value)), H = Math.round(Number(hh.value));
      if (!(W >= 1 && H >= 1 && W <= 16384 && H <= 16384)) { this.toast('Width and height must be between 1 and 16384 pixels.'); return; }
      if (W * H > maxPixelsForDevice()) { this.toast('That size is too large for this device.'); return; }
      if (!(await this.confirmReplace())) return;
      this.closeModal(false);
      this.setDocument(createDocument(W, H, bg === 'transparent' ? null : bg === 'white' ? WHITE : parseHex(color.value) ?? WHITE), 'Untitled');
    };
    return h('div', { class: 'fpe-stack' },
      h('div', { class: 'fpe-chips' }, ...presets.map(([label, pw, ph]) =>
        h('button', { type: 'button', class: 'fpe-chip', onclick: () => { w.value = String(pw); hh.value = String(ph); } }, `${label} ${pw}×${ph}`))),
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'w' }, 'Width (px)'), w),
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'h' }, 'Height (px)'), hh),
      h('div', { class: 'fpe-row' }, h('span', { class: 'fpe-label' }, 'Background'), seg, color),
      h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', onclick: () => this.closeModal() }, 'Cancel'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'new-create', onclick: () => void create() }, 'Create')));
  }
  private buildAbout(): HTMLElement {
    const link = (href: string, text: string, testid?: string): HTMLElement => h('a', { href, target: '_blank', rel: 'noopener', 'data-testid': testid }, text);
    return h('div', { class: 'fpe-about', 'data-testid': 'about' },
      h('p', { class: 'fpe-about-credit' }, h('strong', {}, 'Free Photo Editor by Bhawesh Tibrewal'), h('br'), link(AUTHOR_URL, 'bhaweshtibrewal.com', 'about-site')),
      h('p', {}, `Version ${APP_VERSION}. A free photo editor that runs fully in your browser. Your pictures stay on this device.`),
      h('h3', {}, 'Licence'),
      h('p', {}, 'Copyright (C) 2026 Bhawesh Tibrewal. This program is free software: you may share and change it under the GNU Affero General Public License, version 3 (AGPL-3.0-only), with additional terms: every copy must keep the credit "Free Photo Editor by Bhawesh Tibrewal" with a link to bhaweshtibrewal.com, and changed versions must say that they are changed. It comes with no warranty of any kind.'),
      h('p', {}, link(SOURCE_URL, 'Source code', 'about-source'), ' · ', link(SOURCE_URL + '/blob/main/LICENSE', 'Licence text'), ' · ', link(SOURCE_URL + '/blob/main/ADDITIONAL-TERMS.md', 'Additional terms')),
      h('h3', {}, 'Open-source parts'),
      ...NOTICES.map((n) => h('details', {}, h('summary', {}, `${n.name}: ${n.licence}`), h('p', {}, n.copyright, ' · ', link(n.url, 'project page')), h('pre', {}, n.text))));
  }
  private buildMenu(): HTMLElement {
    const item = (ic: string, label: string, kbd: string, run: () => void, testid?: string): HTMLElement =>
      h('button', { type: 'button', class: 'fpe-btn', 'data-testid': testid, onclick: () => { this.closeModal(false); run(); } }, icon(ic), h('span', {}, label), kbd ? h('kbd', {}, kbd) : null);
    return h('div', { class: 'fpe-menu-list' },
      item('file-plus', 'New picture', 'Ctrl+N', () => this.openModal('new'), 'menu-new'),
      item('open', 'Open image', 'Ctrl+O', () => this.pickFile(false), 'menu-open'),
      item('image-plus', 'Add an image as a layer', '', () => this.pickFile(true)),
      item('download', 'Export', 'Ctrl+S', () => this.openExport()),
      item('select', 'Select all', 'Ctrl+A', () => this.selectAll()),
      item('close', 'Deselect', 'Ctrl+D', () => this.deselect()),
      item('fit', 'Fit to screen', 'Ctrl+0', () => this.fit()),
      item('sun', 'Switch light or dark look', '', () => this.applyTheme(this.root.dataset.theme === 'dark' ? 'light' : 'dark', true), 'menu-theme'),
      item('keyboard', 'Keyboard shortcuts', '', () => this.openModal('keys')),
      item('info', 'About Free Photo Editor', '', () => this.openModal('about'), 'menu-about'));
  }
  private buildKeys(): HTMLElement {
    const rows: [string, string][] = [['V', 'Move layer'], ['M', 'Rectangle select'], ['C', 'Crop'], ['B', 'Brush'], ['E', 'Eraser'], ['I', 'Eyedropper'],
      ['[ and ]', 'Smaller or larger brush'], ['Space + drag', 'Pan'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z or Ctrl+Y', 'Redo'], ['Ctrl+O', 'Open'],
      ['Ctrl+S', 'Export'], ['Ctrl+N', 'New picture'], ['Ctrl+Shift+N', 'New layer'], ['Ctrl+J', 'Duplicate layer'], ['Ctrl+A, Ctrl+D', 'Select all, deselect'],
      ['Delete', 'Delete the selected area'], ['Ctrl+I', 'Invert colours'], ['Ctrl+0, Ctrl+1', 'Fit, actual size'], ['Ctrl+=, Ctrl+-', 'Zoom in, zoom out'],
      ['Enter, Esc', 'Apply or cancel a crop or adjustment'], ['Two-finger tap', 'Undo (touch)'], ['Three-finger tap', 'Redo (touch)']];
    return h('div', {}, h('p', { class: 'fpe-note' }, 'On a Mac, Ctrl means Cmd.'),
      h('dl', { class: 'fpe-keys' }, ...rows.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])));
  }

  // ---------- files ----------
  private pickFile(asLayer: boolean): void { this.fileAsLayer = asLayer && !!this.doc; this.fileInput.click(); }
  async openFile(file: Blob, name: string, asLayer = false): Promise<void> {
    const done = this.busyAfter(120);
    try {
      const o = await readImageFile(file, name);
      let bmp: Bitmap;
      if (o.kind === 'psd') {
        const { readPsdDocument } = await import('@free-photoeditor/core/psd');
        const res = readPsdDocument(o.bytes);
        if (asLayer && this.doc) bmp = flatten(res.doc);
        else {
          if (!(await this.confirmReplace())) return;
          this.setDocument(res.doc, baseName(name));
          const n = res.doc.layers.length;
          this.toast(`Opened ${name}: ${n} layer${n === 1 ? '' : 's'}.${res.notes.length ? ' ' + res.notes.join(' ') : ''}`, res.notes.length ? 6000 : 2800);
          return;
        }
      } else bmp = o.bitmap;
      const max = maxPixelsForDevice();
      if (bmp.width * bmp.height > max) {
        const k = Math.sqrt(max / (bmp.width * bmp.height)), w = Math.max(1, Math.floor(bmp.width * k)), hh = Math.max(1, Math.floor(bmp.height * k));
        const c = await this.ask(`This picture is very large (${bmp.width} × ${bmp.height} px). Editing it at full size may be slow or run out of memory on this device.`,
          `Open a smaller copy (${w} × ${hh})`, 'Open full size');
        if (c === 'cancel') return;
        if (c === 'primary') bmp = scaleBitmap(bmp, w, hh);
      }
      if (asLayer && this.doc) {
        const d = this.doc, l = createLayer(baseName(name), bmp.width, bmp.height, { data: bmp.data, x: Math.round((d.width - bmp.width) / 2), y: Math.round((d.height - bmp.height) / 2) });
        this.pushCmd(addLayer(d, l, d.layers.length, 'Add image as layer'), true);
        this.toast(`Added ${baseName(name)} as a new layer.`);
        return;
      }
      if (!(await this.confirmReplace())) return;
      this.setDocument(documentFromBitmap(bmp), baseName(name));
    } catch (e) {
      this.toast(errText(e, "This file couldn't be opened."));
    } finally {
      done();
    }
  }
  private setDocument(doc: Doc, name: string): void {
    this.cancelSession();
    this.stroke = null;
    this.drag = null;
    this.crop = null;
    this.doc = doc;
    this.name = name;
    this.history.clear();
    this.savedId = this.history.stateId();
    this.emptyEl.hidden = true;
    this.root.setAttribute('data-has-doc', '');
    this.rendW = 0;
    this.rendH = 0;
    this.fit();
    this.markAll();
    this.updateUndo();
    this.renderLayers();
    this.renderOptions();
    this.updateAnts();
    this.requestRender();
  }
  private onPaste(e: ClipboardEvent): void {
    if (!this.isActive() || this.isTyping(document.activeElement)) return;
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    void this.openFile(f, f.name || 'pasted image', !!this.doc);
  }

  // ---------- keyboard ----------
  private isTyping(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && !['range', 'color', 'button', 'checkbox', 'radio', 'file'].includes((el as HTMLInputElement).type);
  }
  private isActive(): boolean {
    if (!this.root.isConnected) return false;
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || this.root.contains(a);
  }
  private setSpace(on: boolean): void { this.space = on; this.root.toggleAttribute('data-space', on); }
  private onKey(e: KeyboardEvent): void {
    if (!this.isActive()) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === 'Escape') {
      if (this.popover) this.closePopover();
      else if (this.modal) this.closeModal();
      else if (this.session) this.cancelSession();
      else if (this.crop) { this.crop = null; this.renderOptions(); this.requestRender(); }
      else if (this.layout !== 'desktop' && [...this.sheets.values()].some((s) => s.classList.contains('fpe-panel') && s.dataset.state !== 'closed')) {
        this.setPanel('layers', 'closed'); this.setPanel('adjust', 'closed');
      } else this.deselect();
      return;
    }
    if (this.isTyping(e.target as Element) || this.popover) return;
    if (this.modal && !mod) return;
    if (mod) {
      const c = k.toLowerCase();
      let handled = true;
      if (c === 'z') { if (e.shiftKey) this.redo(); else this.undo(); }
      else if (c === 'y') this.redo();
      else if (c === 's') this.openExport();
      else if (c === 'o') this.pickFile(false);
      else if (c === 'n') { if (e.shiftKey) this.addLayerAction(); else this.openModal('new'); }
      else if (c === 'j') this.duplicateLayerAction();
      else if (c === 'a') this.selectAll();
      else if (c === 'd') this.deselect();
      else if (c === 'i') { const it = ITEMS.find((x) => x.id === 'invert'); if (it) void this.startItem(it); }
      else if (c === '0') this.fit();
      else if (c === '1') { this.fitted = false; this.zoomAt(1 / this.view.zoom, this.stage.clientWidth / 2, this.stage.clientHeight / 2); }
      else if (c === '=' || c === '+') this.zoomBy(1.25);
      else if (c === '-') this.zoomBy(1 / 1.25);
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const onControl = e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY|SELECT|INPUT)$/.test(e.target.tagName);
    const tools: Record<string, Tool> = { v: 'move', m: 'select', c: 'crop', b: 'brush', e: 'eraser', i: 'eyedropper' };
    const t = tools[k.toLowerCase()];
    if (t) { this.setTool(t); e.preventDefault(); return; }
    if (onControl) return;
    if (k === ' ') { this.setSpace(true); e.preventDefault(); return; }
    if (k === '[' || k === ']') {
      const b = this.tool === 'eraser' ? this.eraser : this.brush;
      b.size = clamp(Math.round(b.size * (k === ']' ? 1.15 : 1 / 1.15)) + (k === ']' ? 1 : -1), 1, 500);
      this.renderOptions();
      this.requestRender();
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteArea(); return; }
    if (k === 'Enter') { if (this.crop) this.applyCrop(); else if (this.session) void this.applySession(); return; }
    if (k.startsWith('Arrow') && this.tool === 'move' && this.doc) {
      e.preventDefault();
      const d = this.doc, l = activeLayer(d), n = e.shiftKey ? 10 : 1;
      if (!l) return;
      const old = layerRect(l);
      const dx = k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, dy = k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0;
      this.pushCmd(setLayerProps(d, l.id, { x: l.x + dx, y: l.y + dy }, 'Move layer'));
      this.markDirty(union(old, layerRect(l)));
    }
  }

  // ---------- feedback ----------
  private busyAfter(ms: number): () => void {
    let shown = false;
    const t = window.setTimeout(() => { shown = true; this.busyCount++; this.busyEl.hidden = false; }, ms);
    return () => {
      clearTimeout(t);
      if (!shown) return;
      this.busyCount = Math.max(0, this.busyCount - 1);
      if (!this.busyCount) this.busyEl.hidden = true;
    };
  }
  private toast(msg: string, ms = 2800): void {
    const t = this.toastEl;
    t.textContent = msg;
    t.setAttribute('data-on', '');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.removeAttribute('data-on'), ms);
  }

  // ---------- public API ----------
  controller(): EditorController {
    return {
      destroy: () => this.destroy(),
      openFile: (f, n) => this.openFile(f, n ?? ((f as File).name || 'image')),
      newDocument: (w, hh, bg) => this.setDocument(createDocument(w, hh, bg === null ? null : parseHex(bg ?? '#ffffff') ?? WHITE), 'Untitled'),
      getInfo: () => {
        const d = this.doc;
        if (!d) return null;
        return {
          width: d.width, height: d.height, active: indexOfLayer(d, d.activeId), canUndo: this.history.canUndo, canRedo: this.history.canRedo,
          zoom: this.view.zoom, tool: this.tool, layout: this.layout, selection: d.selection ? { x: d.selection.x, y: d.selection.y, w: d.selection.w, h: d.selection.h } : null,
          layers: d.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, x: l.x, y: l.y, width: l.width, height: l.height })),
        };
      },
      sample: (x, y, only) => {
        const d = this.doc;
        if (!d) return null;
        const p = samplePixel(d, x, y, only ? activeLayer(d) : undefined);
        return p ? [p.r, p.g, p.b, p.a] : null;
      },
      toClient: (x, y) => {
        if (!this.doc) return null;
        const r = this.canvas.getBoundingClientRect();
        return { x: r.left + this.view.panX + x * this.view.zoom, y: r.top + this.view.panY + y * this.view.zoom };
      },
      exportFile: async (f, q = 0.92) => {
        if (!this.doc) throw new Error('No picture is open.');
        return (await encodeDocument(this.doc, f, q)).blob;
      },
    };
  }
  private destroy(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.antsTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.thumbTimer);
    this.closePopover();
    this.input.destroy();
    this.ro.disconnect();
    this.stageRo.disconnect();
    this.jobs.dispose();
    this.renderer.dispose();
    for (const f of this.off) f();
    this.off = [];
    this.root.remove();
    this.doc = null;
  }
}

/** Mount the editor inside `element` (it fills the element; the host page decides the height). */
export function mount(element: HTMLElement, options: MountOptions = {}): EditorController {
  const d = element.ownerDocument;
  if (!d.getElementById('fpe-styles')) {
    const s = d.createElement('style');
    s.id = 'fpe-styles';
    s.textContent = css;
    d.head.append(s);
  }
  ensureSprite(d);
  return new Editor(element, options).controller();
}
