// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The editor. One DOM, laid out by CSS: from 768 px wide a professional workspace (menu bar, options bar, tool column
 * with flyouts, picture tabs, rulers, docked tabbed panels, status bar); below that a phone layout (top bar, bottom tool
 * bar, bottom sheets, the menu tree as a sheet). Menus, tools, panels, search, shortcuts and help lines all come from the
 * function map (registry.ts) and run through one handler table (commands.ts); every pixel change goes through the engine.
 */
import {
  APP_NAME, APP_VERSION, AUTHOR, AUTHOR_URL, BLACK, BLEND_GROUPS, BLEND_LABELS, EXPORT_FORMATS, FORMAT_INFO, History, SOURCE_URL, Stroke, WHITE,
  activeLayer, addEmptyLayer, addLayer, clamp, clearSelection, commitResult, compositeDoc, createDocument, createLayer, cropDocument, curveLut,
  deleteLayer, docFacts, docRect, documentFromBitmap, duplicateActive, editRegion, fillSelection, findLayer, flatten, flattenDocument, indexOfLayer,
  innerOf, intersect, inverseSelection, isBlendMode, jobPadding, layerRect, levelsLut, lossReport, mergeDown, mergeVisible, moveLayer, nextLayerName,
  paddedRegion, parseHex, pixelCommand, propsCommand, readRegion, rectFromPoints, resizeCanvas, resizeDocument, revealAll, samplePixel,
  selectionAlpha, setLayerProps, toHex, trimDocument, turnDocument, turnLayer, union, writeRegion,
  type Bitmap, type BlendMode, type Command, type Doc, type DocFacts, type ExportFormat, type JobParams, type JobSpec, type Layer, type LayerProps,
  type RGBA, type Rect, type Resample, type Selection, type StrokePoint, type Turn,
} from '@free-photoeditor/core';
import { ADJ, DOCK_PANELS, HANDLERS, JOBS, TOOLS, type AdjDef, type Job, type ToolId } from './commands';
import { errText, fmtBytes, h, icon, iconButton, type Attrs } from './dom';
import { ensureSprite } from './icons';
import { CanvasInput, type PointerInfo, type Pt } from './input';
import { OPEN_ACCEPT, baseName, download, encodeDocument, historyBytesForDevice, maxPixelsForDevice, readImageFile, scaleBitmap, toImageData } from './io';
import { JobRunner } from './jobs';
import { NOTICES } from './notices';
import { BY_ID, MENU_INFO, MENU_ITEMS, ROWS, TOOL_GROUPS, TOP_MENUS, placeText, search, type MenuEntry, type Row } from './registry';
import { Canvas2DRenderer, type Renderer, type View } from './renderer';
import css from './styles.css?inline';

type Layout = 'phone' | 'tablet' | 'desktop';
type Answer = 'primary' | 'secondary' | 'cancel';
type Screen = 'standard' | 'focus';
type Flag = 'rulers' | 'grid' | 'extras';
type DockState = 'closed' | 'half' | 'full';
export interface MountOptions { theme?: 'dark' | 'light' | 'system'; standalone?: boolean; }
export interface LayerInfo { name: string; visible: boolean; opacity: number; blendMode: BlendMode; x: number; y: number; width: number; height: number; locked: boolean; }
export interface DocInfo {
  width: number; height: number; layers: LayerInfo[]; active: number; canUndo: boolean; canRedo: boolean;
  zoom: number; tool: ToolId; layout: Layout | null; selection: Rect | null;
}
export interface CommandInfo { id: string; status: string; kind: string; enabled: boolean; checked: boolean | null; handler: boolean; }
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
  /** Every function of the map with its status, for automation and tests. */
  commands(): CommandInfo[];
  /** Run a function of the map by id. False when it is Planned, unknown or not available right now. */
  run(id: string): Promise<boolean>;
  /** Everything a person could notice changing, as plain data. */
  state(): Record<string, unknown>;
  openSample(): void;
  setZoom(zoom: number): void;
  select(x: number, y: number, w: number, h: number): void;
}

interface Session {
  id: string; def: AdjDef; label: string; spec: JobSpec; layerId: string; r: Rect; padded: Rect; source: Uint8ClampedArray; before: Uint8ClampedArray;
  hist: Uint32Array; running: Promise<void> | null; queued: boolean; ran: boolean;
}
interface Tab { doc: Doc; history: History; name: string; savedId: number; view: View; fitted: boolean; lastSel: Selection | null; hole: Rect | null; }
interface Clip { width: number; height: number; data: Uint8ClampedArray; x: number; y: number; serial: number; }
type Drag = { kind: 'select' | 'crop' | 'pick' | 'pan'; start: Pt } | { kind: 'move'; start: Pt; x: number; y: number; id: string };
interface PopItem { label: string; run: () => void; disabled?: boolean; cmd?: string; }

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const keyText = (k: string): string => (MAC ? k.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : k);
const fmtNum = (v: number): string => (Number.isInteger(v) ? String(v) : Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1));
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
const CODES: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Quote: "'", Comma: ',', Slash: '/', Period: '.' };
/** A key press as the function map writes it: "Ctrl+Shift+N", "Alt+Backspace", "V". Cmd counts as Ctrl. */
function keyOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let k = e.key;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) k = e.code.slice(5);
  else if (CODES[e.code]) k = CODES[e.code];
  else if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join('+');
}
const KEYMAP = new Map<string, string>();
for (const r of ROWS) if (r.key) KEYMAP.set(r.key, r.id);
const ALIASES: Record<string, string> = { 'Ctrl+Y': 'edit.redo', Backspace: 'edit.clear', 'Ctrl+Shift+=': 'view.zoom-in' };
const GROUP_ICON: Record<string, string> = {
  'Tools > Move': 'move', 'Tools > Select box': 'select', 'Tools > Lasso': 'lasso', 'Tools > Smart select': 'wand', 'Tools > Crop': 'crop',
  'Tools > Measure': 'pipette', 'Tools > Retouch': 'bandage', 'Tools > Paint': 'brush', 'Tools > Clone': 'stamp', 'Tools > History brush': 'history',
  'Tools > Erase': 'eraser', 'Tools > Fill': 'bucket', 'Tools > Soften': 'droplet', 'Tools > Light': 'dodge', 'Tools > Pen': 'pen', 'Tools > Text': 'type',
  'Tools > Path select': 'pointer', 'Tools > Shapes': 'shapes', 'Tools > Hand': 'hand', 'Tools > Zoom': 'zoom-in',
};
const GROUPS: { id: string; panels: string[] }[] = [
  { id: 'nav', panels: ['navigator', 'info'] }, { id: 'color', panels: ['color', 'swatches'] },
  { id: 'props', panels: ['properties', 'adjustments', 'history'] }, { id: 'layers', panels: ['layers', 'channels', 'paths'] }];
const MORE_PANELS = ['brushes', 'character', 'paragraph', 'histogram', 'actions', 'styles', 'tool-presets', 'glyphs', 'notes', 'timeline', 'layer-comps', 'vector-info'];
const SWATCHES = ['#000000', '#3a3a3a', '#7a7a7a', '#b8b8b8', '#ffffff', '#e4572e', '#f3a712', '#f9e04b', '#9bc53d', '#2e9e5b', '#17bebb', '#2d7dd2',
  '#3d348b', '#8e44ad', '#d81e5b', '#ff8fab', '#7f5539', '#b08968', '#ddb892', '#ede0d4', '#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#6fffe9',
  '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff', '#590d22', '#a4133c', '#ff4d6d', '#ffb3c1', '#264653', '#e9c46a'];
const RATIOS: [string, number][] = [['Free', 0], ['Square 1:1', 1], ['Post 4:5', 0.8], ['Story 9:16', 9 / 16], ['Wide 16:9', 16 / 9]];
const SUGGEST = ['image.adj-brightness', 'image.auto-tone', 'tool.crop', 'image.size', 'image.adj-bw', 'filter.blur-gaussian', 'layer.new', 'file.export'];
const CONTEXT = ['edit.undo', 'edit.redo', 'select.all', 'select.none', 'select.inverse', 'edit.clear', 'image.crop', 'layer.new', 'layer.duplicate', 'view.fit'];
let counter = 0;
let clipSerial = 0;

/** A practice photo drawn in code: sky, hills, a lake, a white frame, and a sun on its own layer that pokes past the edge. */
function makeSample(): Doc {
  const W = 960, H = 640, F = 16, hz = 0.58 * H, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let r: number, g: number, b: number;
    if (x < F || y < F || x >= W - F || y >= H - F) { r = 250; g = 250; b = 248; }
    else {
      const far = hz - 40 - 30 * Math.sin(x / 90) - 18 * Math.sin(x / 37 + 1), near = hz + 10 - 42 * Math.sin(x / 150 + 2) - 12 * Math.sin(x / 41);
      if (y < far) { const t = y / far; r = 52 + 150 * t; g = 92 + 110 * t; b = 158 + 60 * t; }
      else if (y < near) { const t = (y - far) / Math.max(1, near - far); r = 96 - 20 * t; g = 120 - 10 * t; b = 140 - 20 * t; }
      else if (y < hz + 70) { const t = (y - near) / 90; r = 58 - 18 * t; g = 112 - 30 * t; b = 58 - 16 * t; }
      else { const t = (y - hz - 70) / (H - hz - 70), rip = 8 * Math.sin(y * 0.9 + x * 0.02); r = 40 + 30 * (1 - t) + rip; g = 78 + 40 * (1 - t) + rip; b = 110 + 45 * (1 - t) + rip; }
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  const doc = documentFromBitmap({ width: W, height: H, data });
  const S = 180, sun = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dd = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2), a = dd < 0.8 ? 1 : dd < 1 ? (1 - dd) / 0.2 : 0, i = (y * S + x) * 4;
    sun[i] = 255; sun[i + 1] = 200 + 40 * Math.max(0, 1 - dd); sun[i + 2] = 110; sun[i + 3] = a * 255;
  }
  addLayer(doc, createLayer('Sun', S, S, { data: sun, x: W - S + 60, y: 90 }), 1, 'Sun');
  return doc;
}
function combine(label: string, cmds: (Command | null)[]): Command | null {
  const list = cmds.filter((c): c is Command => !!c);
  if (!list.length) return null;
  return { label, bytes: list.reduce((s, c) => s + c.bytes, 0),
    undo(d) { for (let i = list.length - 1; i >= 0; i--) list[i].undo(d); }, redo(d) { for (const c of list) c.redo(d); } };
}

export class Editor {
  readonly root: HTMLElement;
  private opts: MountOptions;
  private uid = ++counter;
  private shell!: HTMLElement;
  private menubar!: HTMLElement;
  private optionsBar!: HTMLElement;
  private toolsBar!: HTMLElement;
  private tabsEl!: HTMLElement;
  private viewEl!: HTMLElement;
  private stage!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private rulerH!: HTMLCanvasElement;
  private rulerV!: HTMLCanvasElement;
  private dock!: HTMLElement;
  private statusEl!: HTMLElement;
  private stat: Record<'zoom' | 'size' | 'pos' | 'sel' | 'hint', HTMLElement> = {} as Record<'zoom' | 'size' | 'pos' | 'sel' | 'hint', HTMLElement>;
  private startEl!: HTMLElement;
  private dropEl!: HTMLElement;
  private busyEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private scrim!: HTMLElement;
  private tipEl!: HTMLElement;
  private dlgEl!: HTMLElement;
  private dlgCanvas: HTMLCanvasElement | null = null;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private layerList!: HTMLElement;
  private layerProps!: HTMLElement;
  private histList!: HTMLElement;
  private propsBody!: HTMLElement;
  private colorBody!: HTMLElement;
  private infoBody!: HTMLElement;
  private navCanvas!: HTMLCanvasElement;
  private navZoom!: HTMLInputElement;
  private menuSheetBody!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchList!: HTMLElement;
  private exportName!: HTMLInputElement;
  private exportChips!: HTMLElement;
  private qualityRow!: HTMLElement;
  private lossBox!: HTMLElement;
  private exportGo!: HTMLButtonElement;
  private askBody!: HTMLElement;
  private sheets = new Map<string, HTMLElement>();
  private bodies = new Map<string, HTMLElement>();
  private groupEls = new Map<string, HTMLElement>();
  private groupBtns = new Map<string, HTMLElement>();
  private groupCur = new Map<string, string>();
  private renderer: Renderer;
  private input: CanvasInput;
  private jobs = new JobRunner();
  doc: Doc | null = null;
  history = new History(60, historyBytesForDevice());
  private name = 'image';
  private savedId = 0;
  private tabs: Tab[] = [];
  private cur = -1;
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
  private navTimer = 0;
  private busyCount = 0;
  tool: ToolId = 'brush';
  private brush = { size: 24, hardness: 0.85, opacity: 1, color: '#e4572e' };
  private pencil = { size: 4, hardness: 1, opacity: 1 };
  private eraser = { size: 48, hardness: 0.7, opacity: 1 };
  private bgColor = '#ffffff';
  private sampleAll = true;
  private ratio = 0;
  private stroke: Stroke | null = null;
  private drag: Drag | null = null;
  private crop: Rect | null = null;
  private hoverPt: Pt | null = null;
  private pointer: Pt | null = null;
  private space = false;
  private layout: Layout | null = null;
  private modal: string | null = null;
  private modalReturn: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private session: Session | null = null;
  clip: Clip | null = null;
  lastSel: Selection | null = null;
  private hole: Rect | null = null;
  lastFilter: { id: string; params: JobParams } | null = null;
  proNames = false;
  hints = true;
  screen: Screen = 'standard';
  flags: Record<Flag, boolean> = { rulers: true, grid: false, extras: true };
  private hidden = new Set<string>();
  private folded = new Set<string>(['nav', 'color', 'more']);
  private groupActive = new Map<string, string>();
  private dockState: DockState = 'closed';
  private phonePanel = 'layers';
  private menuOpen: string | null = null;
  private menuStack: HTMLElement[] = [];
  private exportFormat: ExportFormat = 'png';
  private exportQuality = 0.92;
  private exportFacts: DocFacts | null = null;
  private askResolve: ((v: Answer) => void) | null = null;
  private fileAsLayer = false;
  private opacityStart: number | null = null;
  private rulerInk = { bg: '#212228', fg: '#a6a9b3', ac: '#86b7ff' };
  private ro: ResizeObserver;
  private stageRo: ResizeObserver;
  private off: (() => void)[] = [];

  constructor(host: HTMLElement, opts: MountOptions) {
    this.opts = opts;
    this.root = h('div', { class: 'fpe', 'data-theme': 'dark', 'data-tool': 'brush', 'data-screen': 'standard', 'data-names': 'plain', 'data-hints': 'on' });
    this.loadPrefs();
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
      hover: (sx, sy, inside) => {
        this.hoverPt = inside ? { x: sx, y: sy } : null;
        this.pointer = inside ? { x: (sx - this.view.panX) / this.view.zoom, y: (sy - this.view.panY) / this.view.zoom } : null;
        this.requestRender();
      },
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
    this.load(-1);
  }

  // ---------- small builders ----------
  private names(plain: string, pro: string): HTMLElement {
    return h('span', { class: 'fpe-names' }, h('span', { class: 'fpe-plain' }, plain), pro && pro !== plain ? h('span', { class: 'fpe-pro' }, pro) : null);
  }
  private tag(): HTMLElement { return h('span', { class: 'fpe-tag' }, 'Planned'); }
  /** A button that runs a function of the map; its help line comes from the map too. */
  private cmdBtn(id: string, ic: string | null, text?: string | null, attrs: Attrs = {}): HTMLButtonElement {
    const r = BY_ID.get(id);
    const b = h('button', { type: 'button', class: 'fpe-btn' + (text ? ' fpe-btn-ghost' : ' fpe-icon-btn'), 'data-cmd': id, 'aria-label': text ? null : r?.plain ?? id, ...attrs },
      ic ? icon(ic) : null, text ? h('span', { class: 'fpe-btn-text' }, text) : null);
    b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') void this.run(id); });
    return b;
  }
  private field(id: string, label: string, help: string, control: HTMLElement, out?: HTMLElement | null): HTMLElement {
    return h('div', { class: 'fpe-field', 'data-help-title': label, 'data-help': help }, h('div', { class: 'fpe-field-top' }, h('label', { for: id }, label), out ?? null), control);
  }

  // ---------- building the interface ----------
  private build(): void {
    this.menubar = this.buildMenuBar();
    this.undoBtn = this.cmdBtn('edit.undo', 'undo', null, { 'data-testid': 'btn-undo' });
    this.redoBtn = this.cmdBtn('edit.redo', 'redo', null, { 'data-testid': 'btn-redo' });
    const search = h('button', { type: 'button', class: 'fpe-btn fpe-search-btn', 'data-cmd': 'help.search', 'data-testid': 'btn-search', 'aria-label': 'Search: what do you want to do?' },
      icon('search'), h('span', { class: 'fpe-search-text' }, 'What do you want to do?'), h('kbd', {}, keyText('Ctrl+K')));
    search.addEventListener('click', () => this.openSearch());
    const exp = h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary fpe-export-btn', 'data-cmd': 'file.export', 'data-testid': 'btn-export', 'aria-label': 'Export' },
      icon('download'), h('span', { class: 'fpe-btn-text' }, 'Export'));
    exp.addEventListener('click', () => void this.run('file.export'));
    const top = h('header', { class: 'fpe-top' },
      iconButton('menu', 'Menu: every command', { class: 'fpe-btn fpe-icon-btn fpe-menu-btn', 'data-testid': 'btn-menu', onclick: () => this.openModal('menu') }),
      h('a', { class: 'fpe-brand', href: AUTHOR_URL, target: '_blank', rel: 'noopener', 'data-testid': 'brand', title: 'Free Photo Editor by Bhawesh Tibrewal: bhaweshtibrewal.com' },
        h('span', { class: 'fpe-brand-name' }, APP_NAME), h('span', { class: 'fpe-brand-by' }, 'by ' + AUTHOR)),
      this.menubar, h('span', { class: 'fpe-spacer' }),
      (this.busyEl = h('div', { class: 'fpe-busy', role: 'status', hidden: true }, h('span', { class: 'fpe-spinner', 'aria-hidden': 'true' }), 'Working…')),
      search, this.undoBtn, this.redoBtn, exp);
    this.optionsBar = h('div', { class: 'fpe-options', role: 'toolbar', 'aria-label': 'Tool options', 'data-testid': 'options' });
    this.toolsBar = h('div', { class: 'fpe-tools', role: 'toolbar', 'aria-label': 'Tools', 'data-testid': 'tools' });
    this.buildTools();
    this.tabsEl = h('div', { class: 'fpe-tabs', role: 'tablist', 'aria-label': 'Open pictures', 'data-testid': 'doc-tabs' });
    this.canvas = h('canvas', { class: 'fpe-canvas', role: 'img', 'aria-label': 'The picture you are editing', 'data-testid': 'canvas' });
    this.startEl = this.buildStart(false);
    this.dropEl = h('div', { class: 'fpe-drop', hidden: true }, 'Drop to open');
    const zoom = h('div', { class: 'fpe-zoom', role: 'group', 'aria-label': 'Zoom' }, this.cmdBtn('view.zoom-out', 'zoom-out'), this.cmdBtn('view.fit', 'fit'), this.cmdBtn('view.zoom-in', 'zoom-in'));
    const unfocus = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost fpe-unfocus', 'data-testid': 'unfocus', onclick: () => this.setScreen('standard') }, icon('fit'), 'Show the tools');
    this.stage = h('div', { class: 'fpe-stage' }, this.canvas, this.startEl, this.dropEl, zoom, unfocus);
    this.rulerH = h('canvas', { class: 'fpe-ruler fpe-ruler-h', 'aria-hidden': 'true' });
    this.rulerV = h('canvas', { class: 'fpe-ruler fpe-ruler-v', 'aria-hidden': 'true' });
    this.viewEl = h('div', { class: 'fpe-view' }, h('div', { class: 'fpe-corner', 'aria-hidden': 'true' }), this.rulerH, this.rulerV, this.stage);
    const center = h('main', { class: 'fpe-center' }, this.tabsEl, this.viewEl);
    this.dock = h('aside', { class: 'fpe-dock', 'aria-label': 'Panels', 'data-testid': 'dock', 'data-state': 'closed' });
    this.buildDock();
    for (const k of ['zoom', 'size', 'pos', 'sel', 'hint'] as const) this.stat[k] = h('span', { class: 'fpe-stat fpe-stat-' + k, 'data-testid': 'status-' + k });
    this.stat.zoom = h('button', { type: 'button', class: 'fpe-stat fpe-stat-zoom', 'data-cmd': 'view.fit', 'data-testid': 'status-zoom', onclick: () => void this.run('view.fit') }, '100%');
    this.statusEl = h('footer', { class: 'fpe-status', 'data-testid': 'status' }, this.stat.zoom, this.stat.size, this.stat.pos, this.stat.sel, this.stat.hint);
    this.shell = h('div', { class: 'fpe-shell' }, top, this.optionsBar, this.toolsBar, center, this.dock, this.statusEl);
    this.makeSheet('export', 'Export', this.buildExport());
    this.makeSheet('new', 'New picture', this.buildNew());
    this.makeSheet('about', 'About Free Photo Editor', this.buildAbout());
    this.makeSheet('keys', 'Keyboard shortcuts', this.buildKeys());
    this.menuSheetBody = h('div', { class: 'fpe-msheet', 'data-testid': 'menu-sheet' });
    this.makeSheet('menu', 'Menu', this.menuSheetBody);
    this.makeSheet('search', 'Search', this.buildSearch());
    this.makeSheet('start', 'What do you want to do?', this.buildStart(true));
    this.makeSheet('size', 'Picture size · Image size', h('div', { class: 'fpe-stack' }));
    this.makeSheet('canvas', 'Canvas size', h('div', { class: 'fpe-stack' }));
    this.makeSheet('rename', 'Rename layer', h('div', { class: 'fpe-stack' }));
    this.askBody = h('div', {});
    this.makeSheet('ask', 'Please choose', this.askBody);
    this.dlgEl = h('section', { class: 'fpe-dlg', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Adjustment', 'data-testid': 'adjust-dialog', hidden: true });
    this.scrim = h('div', { class: 'fpe-scrim', onclick: () => this.closeModal() });
    this.toastEl = h('div', { class: 'fpe-toast', role: 'status', 'aria-live': 'polite', 'data-testid': 'toast' });
    this.tipEl = h('div', { class: 'fpe-tip', role: 'tooltip', hidden: true, 'data-testid': 'tip' });
    this.fileInput = h('input', { type: 'file', accept: OPEN_ACCEPT, hidden: true, tabindex: -1, 'aria-hidden': 'true', 'data-testid': 'file-input' });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0], asLayer = this.fileAsLayer && !!this.doc;
      this.fileAsLayer = false;
      this.fileInput.value = '';
      if (f) void this.openFile(f, f.name, asLayer);
    });
    this.root.append(this.shell, this.dlgEl, ...this.sheets.values(), this.scrim, this.toastEl, this.tipEl, this.fileInput);
    this.installTips();
  }
  private makeSheet(id: string, title: string, body: HTMLElement): void {
    const tid = `fpe-${this.uid}-t-${id}`;
    const handle = h('div', { class: 'fpe-handle', 'aria-hidden': 'true' }, h('span'));
    const sheet = h('section', { class: 'fpe-sheet fpe-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, 'data-sheet': id, 'data-state': 'closed', 'data-testid': 'sheet-' + id },
      handle, h('div', { class: 'fpe-sheet-head' }, h('h2', { class: 'fpe-sheet-title', id: tid }, title),
        iconButton('close', 'Close', { class: 'fpe-btn fpe-icon-btn fpe-sheet-close', 'data-testid': 'close-' + id, onclick: () => this.closeModal() })),
      h('div', { class: 'fpe-sheet-body' }, body));
    sheet.inert = true;
    this.sheets.set(id, sheet);
    let y0 = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => { if (this.layout !== 'phone') return; dragging = true; y0 = e.clientY; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', (e) => { if (dragging) sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
    const end = (e: PointerEvent): void => { if (!dragging) return; dragging = false; sheet.style.transform = ''; if (e.clientY - y0 > 80) this.closeModal(); };
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

  // ---------- the menu bar (desktop and tablet) ----------
  private buildMenuBar(): HTMLElement {
    const bar = h('nav', { class: 'fpe-menubar', role: 'menubar', 'aria-label': 'Menu bar' });
    for (const m of TOP_MENUS) {
      const info = MENU_INFO.get(m);
      const b = h('button', { type: 'button', class: 'fpe-mb', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu': m,
        'data-testid': 'menu-top-' + m.toLowerCase(), 'data-help-title': m, 'data-help': info?.help ?? '' }, m);
      b.addEventListener('click', () => (this.menuOpen === m ? this.closeMenus() : this.openMenu(m, b)));
      b.addEventListener('pointerenter', () => { if (this.menuOpen && this.menuOpen !== m) this.openMenu(m, b); });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openMenu(m, b, true); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.stepTop(m, e.key === 'ArrowRight' ? 1 : -1, false); }
      });
      bar.append(b);
    }
    return bar;
  }
  private stepTop(m: string, dir: number, open: boolean): void {
    const i = TOP_MENUS.indexOf(m as (typeof TOP_MENUS)[number]), next = TOP_MENUS[(i + dir + TOP_MENUS.length) % TOP_MENUS.length];
    const b = this.menubar.querySelector<HTMLElement>(`[data-menu="${next}"]`);
    if (!b) return;
    if (open) this.openMenu(next, b, true); else b.focus();
  }
  private openMenu(m: string, anchor: HTMLElement, focusFirst = false): void {
    this.closeMenus();
    this.hideTip();
    this.menuOpen = m;
    anchor.setAttribute('aria-expanded', 'true');
    const drop = this.buildDrop(m, 0);
    drop.setAttribute('data-testid', 'menu-drop');
    this.root.append(drop);
    const rr = this.root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    drop.style.left = clamp(ar.left - rr.left, 4, Math.max(4, rr.width - drop.offsetWidth - 4)) + 'px';
    drop.style.top = ar.bottom - rr.top + 'px';
    drop.style.maxHeight = Math.max(160, rr.height - (ar.bottom - rr.top) - 8) + 'px';
    this.menuStack = [drop];
    if (focusFirst) drop.querySelector<HTMLElement>('.fpe-mi')?.focus();
    document.addEventListener('pointerdown', this.outsideMenu, true);
  }
  private outsideMenu = (e: Event): void => {
    const t = e.target as Node;
    if (this.menuStack.some((m) => m.contains(t)) || this.menubar.contains(t)) return;
    this.closeMenus();
  };
  closeMenus(focusTop = false): void {
    const m = this.menuOpen;
    for (const d of this.menuStack) d.remove();
    this.menuStack = [];
    this.menuOpen = null;
    for (const b of this.menubar.querySelectorAll('[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.outsideMenu, true);
    if (focusTop && m) this.menubar.querySelector<HTMLElement>(`[data-menu="${m}"]`)?.focus();
  }
  private buildDrop(path: string, depth: number): HTMLElement {
    const drop = h('div', { class: 'fpe-drop-menu', role: 'menu', 'aria-label': MENU_INFO.get(path)?.plain ?? path, 'data-path': path, 'data-depth': depth });
    let first = true;
    for (const ent of MENU_ITEMS.get(path) ?? []) {
      const sep = ent.type === 'item' ? ent.row.sep : ent.info.sep;
      if (sep && !first) drop.append(h('div', { class: 'fpe-msep', role: 'separator' }));
      drop.append(this.menuItem(ent, depth));
      first = false;
    }
    drop.addEventListener('keydown', (e) => this.menuKey(e, drop, depth));
    return drop;
  }
  private subReady(path: string): boolean {
    return (MENU_ITEMS.get(path) ?? []).some((e) => (e.type === 'item' ? e.row.status === 'ready' : this.subReady(e.info.path)));
  }
  private menuItem(ent: MenuEntry, depth: number): HTMLElement {
    if (ent.type === 'sub') {
      const info = ent.info, ready = this.subReady(info.path);
      const b = h('button', { type: 'button', class: 'fpe-mi fpe-mi-sub', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        'data-sub': info.path, 'data-help-title': info.plain, 'data-help': info.help, 'data-testid': 'sub-' + slug(info.path) },
        h('span', { class: 'fpe-mi-check', 'aria-hidden': 'true' }), this.names(info.plain, info.pro), ready ? null : this.tag(), h('span', { class: 'fpe-mi-key' }),
        icon('chev-right', 'fpe-icon fpe-mi-chev'));
      b.addEventListener('pointerenter', () => this.openSub(b, info.path, depth, false));
      b.addEventListener('click', () => this.openSub(b, info.path, depth, true));
      return b;
    }
    const r = ent.row, hd = HANDLERS[r.id], planned = r.status !== 'ready', enabled = !planned && !!hd && hd.enabled(this);
    const checkable = !!hd?.checked, checked = !!hd?.checked?.(this);
    const b = h('button', { type: 'button', class: 'fpe-mi', role: checkable ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': checkable ? String(checked) : null,
      'aria-disabled': enabled ? null : 'true', 'data-cmd': r.id, 'data-status': r.status, 'data-testid': 'mi-' + r.id },
      h('span', { class: 'fpe-mi-check', 'aria-hidden': 'true' }, checked ? icon('check') : null), this.names(r.plain, r.pro), planned ? this.tag() : null,
      h('span', { class: 'fpe-mi-key' }, r.key ? keyText(r.key) : ''));
    b.addEventListener('pointerenter', () => this.closeSubs(depth + 1));
    b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true') return; this.closeMenus(); void this.run(r.id); });
    return b;
  }
  private closeSubs(depth: number): void {
    while (this.menuStack.length > depth) {
      const d = this.menuStack.pop() as HTMLElement;
      d.remove();
      this.menuStack[this.menuStack.length - 1]?.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
    }
  }
  private openSub(item: HTMLElement, path: string, depth: number, focus: boolean): void {
    if (this.menuStack[depth + 1]?.dataset.path === path) { if (focus) this.menuStack[depth + 1].querySelector<HTMLElement>('.fpe-mi')?.focus(); return; }
    this.closeSubs(depth + 1);
    item.setAttribute('aria-expanded', 'true');
    const sub = this.buildDrop(path, depth + 1);
    this.root.append(sub);
    const rr = this.root.getBoundingClientRect(), ir = item.getBoundingClientRect();
    let x = ir.right - rr.left - 2;
    if (x + sub.offsetWidth > rr.width - 4) x = Math.max(4, ir.left - rr.left - sub.offsetWidth + 2);
    sub.style.left = x + 'px';
    sub.style.top = clamp(ir.top - rr.top - 4, 4, Math.max(4, rr.height - sub.offsetHeight - 4)) + 'px';
    sub.style.maxHeight = rr.height - 8 + 'px';
    this.menuStack.push(sub);
    if (focus) sub.querySelector<HTMLElement>('.fpe-mi')?.focus();
  }
  private menuKey(e: KeyboardEvent, drop: HTMLElement, depth: number): void {
    const items = [...drop.querySelectorAll<HTMLElement>(':scope > .fpe-mi')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); items[(i + (k === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (k === 'ArrowRight') {
      e.preventDefault();
      const it = items[i];
      if (it?.dataset.sub) this.openSub(it, it.dataset.sub, depth, true); else if (this.menuOpen) this.stepTop(this.menuOpen, 1, true);
    } else if (k === 'ArrowLeft') {
      e.preventDefault();
      if (depth > 0) { this.closeSubs(depth); this.menuStack[depth - 1]?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus(); }
      else if (this.menuOpen) this.stepTop(this.menuOpen, -1, true);
    } else if (k === 'Home' || k === 'End') { e.preventDefault(); items[k === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (k === 'Tab') this.closeMenus();
  }

  // ---------- the phone menu sheet (the same tree, one level at a time) ----------
  private renderMenuSheet(path: string | null): void {
    const body = this.menuSheetBody, kids: Node[] = [];
    if (!path) {
      kids.push(h('button', { type: 'button', class: 'fpe-mrow fpe-mrow-strong', 'data-testid': 'ms-start', onclick: () => { this.closeModal(false); this.showStart(); } },
        icon('sparkles'), h('span', { class: 'fpe-mrow-main' }, h('span', { class: 'fpe-plain' }, 'What do you want to do?'), h('span', { class: 'fpe-mrow-help' }, 'Pick a job; the editor opens the right tool.'))),
      h('button', { type: 'button', class: 'fpe-mrow', 'data-testid': 'ms-search', onclick: () => { this.closeModal(false); this.openSearch(); } },
        icon('search'), h('span', { class: 'fpe-mrow-main' }, h('span', { class: 'fpe-plain' }, 'Search for a command'), h('span', { class: 'fpe-mrow-help' }, 'Type what you want, like "make it brighter".'))));
      for (const m of TOP_MENUS) {
        const info = MENU_INFO.get(m);
        kids.push(h('button', { type: 'button', class: 'fpe-mrow', 'data-testid': 'ms-top-' + m.toLowerCase(), onclick: () => this.renderMenuSheet(m) },
          h('span', { class: 'fpe-mrow-main' }, h('span', { class: 'fpe-plain' }, m), h('span', { class: 'fpe-mrow-help' }, info?.help ?? '')), icon('chev-right')));
      }
    } else {
      const cut = path.lastIndexOf(' > '), parent = cut > 0 ? path.slice(0, cut) : null, info = MENU_INFO.get(path);
      kids.push(h('button', { type: 'button', class: 'fpe-mrow fpe-mback', 'data-testid': 'ms-back', onclick: () => this.renderMenuSheet(parent) },
        icon('chev-left'), h('span', { class: 'fpe-plain' }, parent ?? 'All menus')),
      h('h3', { class: 'fpe-group-title' }, info ? `${info.plain}${info.pro !== info.plain ? ' · ' + info.pro : ''}` : path));
      for (const ent of MENU_ITEMS.get(path) ?? []) {
        if (ent.type === 'sub') {
          const s = ent.info, ready = this.subReady(s.path);
          kids.push(h('button', { type: 'button', class: 'fpe-mrow', 'data-testid': 'ms-sub-' + slug(s.path), onclick: () => this.renderMenuSheet(s.path) },
            h('span', { class: 'fpe-mrow-main' }, this.names(s.plain, s.pro), h('span', { class: 'fpe-mrow-help' }, s.help)), ready ? null : this.tag(), icon('chev-right')));
          continue;
        }
        const r = ent.row, hd = HANDLERS[r.id], planned = r.status !== 'ready', ok = !planned && !!hd && hd.enabled(this), checked = !!hd?.checked?.(this);
        const b = h('button', { type: 'button', class: 'fpe-mrow', 'aria-disabled': ok ? null : 'true', 'aria-pressed': hd?.checked ? String(checked) : null,
          'data-testid': 'ms-' + r.id, 'data-status': r.status },
          h('span', { class: 'fpe-mrow-main' }, this.names(r.plain, r.pro), h('span', { class: 'fpe-mrow-help' }, r.help)), planned ? this.tag() : null,
          r.key ? h('kbd', {}, keyText(r.key)) : null);
        b.addEventListener('click', () => { if (!ok) return; this.closeModal(false); void this.run(r.id); });
        kids.push(b);
      }
    }
    body.replaceChildren(...kids);
    body.scrollTop = 0;
  }

  // ---------- the tool column ----------
  private buildTools(): void {
    const bar = this.toolsBar;
    for (const g of TOOL_GROUPS) {
      const rows = (MENU_ITEMS.get(g.path) ?? []).flatMap((e) => (e.type === 'item' ? [e.row] : []));
      const first = rows.find((r) => r.status === 'ready') ?? rows[0];
      if (!first) continue;
      const ready = first.status === 'ready';
      const b = h('button', { type: 'button', class: 'fpe-tool', 'data-group': g.path, 'data-cmd': first.id, 'aria-pressed': 'false',
        'aria-label': `${first.plain} (${first.pro})${ready ? '' : ', planned'}`, 'aria-disabled': ready ? null : 'true', 'data-testid': 'tool-' + slug(g.path.slice(8)) },
        icon(GROUP_ICON[g.path] ?? 'square'), rows.length > 1 ? h('span', { class: 'fpe-tool-more', 'aria-hidden': 'true' }) : null);
      this.groupBtns.set(g.path, b);
      this.groupCur.set(g.path, first.id);
      this.longPress(b, () => this.flyout(g.path, b));
      b.addEventListener('click', () => {
        const id = this.groupCur.get(g.path) ?? first.id, r = BY_ID.get(id);
        if (r?.status === 'ready') void this.run(id); else this.flyout(g.path, b);
      });
      bar.append(b);
    }
    const fg = h('button', { type: 'button', class: 'fpe-chip-fg', 'data-swatch': '', 'data-testid': 'chip-fg', 'data-help-title': 'Main colour',
      'data-help': 'The colour the brush paints with. Tap to choose another.', 'aria-label': 'Main colour' });
    const bg = h('button', { type: 'button', class: 'fpe-chip-bg', 'data-swatch-bg': '', 'data-testid': 'chip-bg', 'data-help-title': 'Second colour',
      'data-help': 'The colour for filling and new space. Tap to choose another.', 'aria-label': 'Second colour' });
    const pick = (second: boolean): void => {
      const inp = h('input', { type: 'color', value: second ? this.bgColor : this.brush.color, style: 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px' });
      this.root.append(inp);
      inp.addEventListener('input', () => this.setColor(inp.value, second));
      inp.addEventListener('change', () => inp.remove());
      inp.addEventListener('blur', () => inp.remove());
      inp.click();
    };
    fg.addEventListener('click', () => pick(false));
    bg.addEventListener('click', () => pick(true));
    const chips = h('div', { class: 'fpe-chips-col' }, h('div', { class: 'fpe-chip-pair' }, bg, fg),
      h('div', { class: 'fpe-chip-btns' }, this.cmdBtn('tool.swap-colors', 'swap', null, { class: 'fpe-btn fpe-icon-btn fpe-mini' }),
        this.cmdBtn('tool.default-colors', 'contrast', null, { class: 'fpe-btn fpe-icon-btn fpe-mini' })));
    const qm = h('button', { type: 'button', class: 'fpe-tool fpe-tool-planned', 'data-cmd': 'select.quick-mask', 'aria-disabled': 'true', 'aria-label': 'Paint a selection (Quick mask), planned', 'data-testid': 'tool-quick-mask' }, icon('scan'));
    const sm = this.cmdBtn('view.screen-cycle', 'fit', null, { class: 'fpe-tool', 'data-testid': 'tool-screen-mode' });
    const phone = h('div', { class: 'fpe-phone-panels' },
      iconButton('layers', 'Layers', { 'data-testid': 'btn-layers', 'aria-expanded': 'false', onclick: () => this.togglePhonePanel('layers') }),
      iconButton('sliders', 'Panels: light and colour, history, properties, colour, navigator, info', { 'data-testid': 'btn-panels', 'aria-expanded': 'false',
        onclick: () => this.togglePhonePanel(this.phonePanel === 'layers' ? 'adjustments' : this.phonePanel) }));
    bar.append(h('span', { class: 'fpe-sep', 'aria-hidden': 'true' }), chips, qm, sm, phone);
  }
  private flyout(path: string, anchor: HTMLElement): void {
    const rows = (MENU_ITEMS.get(path) ?? []).flatMap((e) => (e.type === 'item' ? [e.row] : []));
    const pop = h('div', { class: 'fpe-pop fpe-flyout', role: 'menu', 'aria-label': MENU_INFO.get(path)?.plain ?? 'Tools', 'data-testid': 'flyout' });
    for (const r of rows) {
      const ok = r.status === 'ready';
      const b = h('button', { type: 'button', class: 'fpe-fly', role: 'menuitemradio', 'aria-checked': String(TOOLS[r.id] === this.tool), 'aria-disabled': ok ? null : 'true', 'data-testid': 'fly-' + r.id },
        h('span', { class: 'fpe-fly-main' }, this.names(r.plain, r.pro), r.key ? h('kbd', {}, keyText(r.key)) : null, ok ? null : this.tag()),
        h('span', { class: 'fpe-fly-help' }, r.help));
      b.addEventListener('click', () => { if (!ok) return; this.closePopover(); void this.run(r.id); });
      pop.append(b);
    }
    this.openPop(pop, anchor);
  }

  // ---------- the dock of panels ----------
  private buildDock(): void {
    const dock = this.dock;
    const handle = h('div', { class: 'fpe-handle', 'aria-hidden': 'true' }, h('span'));
    let y0 = 0, h0 = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => { if (this.layout !== 'phone') return; dragging = true; y0 = e.clientY; h0 = dock.getBoundingClientRect().height; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointermove', (e) => { if (dragging) dock.style.height = Math.max(60, h0 - (e.clientY - y0)) + 'px'; });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      dock.style.height = '';
      const dy = e.clientY - y0;
      if (Math.abs(dy) < 4) { this.setDock(this.dockState === 'full' ? 'half' : 'full'); return; }
      const ratio = (h0 - dy) / Math.max(1, this.root.clientHeight);
      this.setDock(ratio < 0.25 ? 'closed' : ratio < 0.7 ? 'half' : 'full');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    const ptabs = h('div', { class: 'fpe-ptabs', role: 'tablist', 'aria-label': 'Panels' }, ...DOCK_PANELS.map((pid) => {
      const r = BY_ID.get('panel.' + pid);
      return h('button', { type: 'button', class: 'fpe-ptab', role: 'tab', 'aria-selected': 'false', 'data-ptab': pid, 'data-testid': 'ptab-' + pid,
        onclick: () => this.setDock(this.dockState === 'closed' ? 'half' : this.dockState, pid) }, r?.plain ?? pid);
    }));
    dock.append(h('div', { class: 'fpe-dock-phonehead' }, handle, h('div', { class: 'fpe-dock-phonebar' }, ptabs,
      iconButton('close', 'Close panels', { class: 'fpe-btn fpe-icon-btn', 'data-testid': 'close-dock', onclick: () => this.setDock('closed') }))));
    for (const g of GROUPS) {
      const tabs = h('div', { class: 'fpe-gtabs', role: 'tablist' });
      const body = h('div', { class: 'fpe-gbody' });
      for (const pid of g.panels) {
        const r = BY_ID.get('panel.' + pid);
        if (!r) continue;
        const ok = r.status === 'ready';
        const t = h('button', { type: 'button', class: 'fpe-gtab', role: 'tab', 'aria-selected': 'false', 'aria-disabled': ok ? null : 'true', 'data-cmd': r.id,
          'data-tab': pid, 'data-testid': 'tab-' + pid }, h('span', {}, r.plain), ok ? null : this.tag());
        if (ok) { t.addEventListener('click', () => this.activateTab(g.id, pid)); body.append(this.panelBody(pid)); }
        tabs.append(t);
      }
      const fold = iconButton('chev-down', 'Fold or unfold this panel group', { class: 'fpe-btn fpe-icon-btn fpe-gfold', 'data-testid': 'fold-' + g.id, onclick: () => this.toggleGroup(g.id) });
      const sec = h('section', { class: 'fpe-group', 'data-group': g.id, 'data-testid': 'group-' + g.id }, h('div', { class: 'fpe-ghead' }, tabs, fold), body);
      this.groupEls.set(g.id, sec);
      dock.append(sec);
    }
    const more = h('section', { class: 'fpe-group fpe-more', 'data-group': 'more', 'data-testid': 'group-more' },
      h('div', { class: 'fpe-ghead' }, h('button', { type: 'button', class: 'fpe-gtab fpe-more-head', 'data-testid': 'more-panels', onclick: () => this.toggleGroup('more') },
        h('span', {}, 'More panels'), h('span', { class: 'fpe-tag' }, `${MORE_PANELS.length} planned`)),
      iconButton('chev-down', 'Fold or unfold', { class: 'fpe-btn fpe-icon-btn fpe-gfold', onclick: () => this.toggleGroup('more') })),
      h('div', { class: 'fpe-gbody' }, h('ul', { class: 'fpe-more-list' }, ...MORE_PANELS.map((pid) => {
        const r = BY_ID.get('panel.' + pid);
        return h('li', { 'data-cmd': 'panel.' + pid, tabindex: 0, 'aria-disabled': 'true' }, this.names(r?.plain ?? pid, r?.pro ?? ''), this.tag(), h('span', { class: 'fpe-more-help' }, r?.help ?? ''));
      }))));
    this.groupEls.set('more', more);
    dock.append(more);
    this.applyDock();
  }
  private panelBody(pid: string): HTMLElement {
    const b = h('div', { class: 'fpe-pbody', 'data-panel': pid, 'data-testid': 'panel-' + pid });
    if (pid === 'layers') {
      this.layerList = h('ul', { class: 'fpe-layer-list', 'aria-label': 'Layers, top first', 'data-testid': 'layer-list' });
      this.layerProps = h('div', { class: 'fpe-props' });
      b.append(this.layerProps, this.layerList, h('div', { class: 'fpe-layer-tools', role: 'toolbar', 'aria-label': 'Layer actions' },
        this.cmdBtn('layer.new', 'plus', null, { 'data-testid': 'layer-add' }), this.cmdBtn('layer.duplicate', 'copy', null, { 'data-testid': 'layer-duplicate' }),
        this.cmdBtn('file.open-layer', 'image-plus', null, { 'data-testid': 'layer-image' }), this.cmdBtn('layer.forward', 'arrow-up', null, { 'data-testid': 'layer-up' }),
        this.cmdBtn('layer.backward', 'arrow-down', null, { 'data-testid': 'layer-down' }), this.cmdBtn('layer.merge-down', 'merge', null, { 'data-testid': 'layer-merge' }),
        this.cmdBtn('layer.lock', 'lock', null, { 'data-testid': 'layer-lock' }), this.cmdBtn('layer.delete', 'trash', null, { 'data-testid': 'layer-delete' })));
    } else if (pid === 'history') {
      this.histList = h('ol', { class: 'fpe-hist', 'data-testid': 'history-list', 'aria-label': 'Steps, oldest first' });
      b.append(this.histList);
    } else if (pid === 'properties') {
      this.propsBody = h('div', { class: 'fpe-stack' });
      b.append(this.propsBody);
    } else if (pid === 'adjustments') {
      const grid = h('div', { class: 'fpe-adj-grid' });
      const ents = [...(MENU_ITEMS.get('Image > Adjustments') ?? []), ...(MENU_ITEMS.get('Image') ?? []).filter((e) => e.type === 'item' && e.row.id.startsWith('image.auto-'))];
      for (const ent of ents) {
        if (ent.type !== 'item') continue;
        const r = ent.row, planned = r.status !== 'ready';
        const btn = h('button', { type: 'button', class: 'fpe-adj', 'data-cmd': r.id, 'aria-disabled': planned ? 'true' : null, 'data-testid': 'adj-' + r.id },
          this.names(r.plain, r.pro), planned ? this.tag() : null);
        btn.addEventListener('click', () => { if (btn.getAttribute('aria-disabled') !== 'true') void this.run(r.id); });
        grid.append(btn);
      }
      b.append(h('p', { class: 'fpe-note' }, 'Each fix changes the selected area, or the whole active layer when nothing is selected.'), grid);
    } else if (pid === 'color') {
      this.colorBody = h('div', { class: 'fpe-color' });
      b.append(this.colorBody);
    } else if (pid === 'swatches') {
      b.append(h('div', { class: 'fpe-swatches', role: 'group', 'aria-label': 'Swatches' }, ...SWATCHES.map((c) => {
        const s = h('button', { type: 'button', class: 'fpe-sw', style: 'background:' + c, 'aria-label': 'Use colour ' + c, 'data-help-title': 'Colour ' + c,
          'data-help': 'Tap to paint with this colour. Alt-click or right-click to make it your second colour.' });
        s.addEventListener('click', (e) => this.setColor(c, (e as MouseEvent).altKey));
        s.addEventListener('contextmenu', (e) => { e.preventDefault(); this.setColor(c, true); });
        return s;
      })));
    } else if (pid === 'navigator') {
      this.navCanvas = h('canvas', { class: 'fpe-nav', width: 520, height: 300, 'data-testid': 'navigator', 'aria-label': 'Navigator: drag the box to move around the picture' });
      const go = (e: PointerEvent): void => {
        const d = this.doc;
        if (!d) return;
        const r = this.navCanvas.getBoundingClientRect(), k = Math.min(r.width / d.width, r.height / d.height);
        const ox = (r.width - d.width * k) / 2, oy = (r.height - d.height * k) / 2;
        const x = (e.clientX - r.left - ox) / k, y = (e.clientY - r.top - oy) / k, z = this.view.zoom;
        this.fitted = false;
        this.setView({ zoom: z, panX: this.stage.clientWidth / 2 - x * z, panY: this.stage.clientHeight / 2 - y * z });
      };
      let down = false;
      this.navCanvas.addEventListener('pointerdown', (e) => { down = true; this.navCanvas.setPointerCapture(e.pointerId); go(e); });
      this.navCanvas.addEventListener('pointermove', (e) => { if (down) go(e); });
      this.navCanvas.addEventListener('pointerup', () => { down = false; });
      const id = `fpe-${this.uid}-nz`;
      this.navZoom = h('input', { id, type: 'range', min: 0, max: 1000, step: 1, value: 500, 'data-testid': 'nav-zoom' });
      this.navZoom.addEventListener('input', () => {
        const z = Math.exp(Math.log(0.01) + (Number(this.navZoom.value) / 1000) * (Math.log(32) - Math.log(0.01)));
        this.fitted = false;
        this.zoomAt(z / this.view.zoom, this.stage.clientWidth / 2, this.stage.clientHeight / 2);
      });
      b.append(this.navCanvas, this.field(id, 'Zoom', 'Slide to zoom in or out around the middle of the view.', this.navZoom));
    } else if (pid === 'info') {
      this.infoBody = h('dl', { class: 'fpe-info', 'data-testid': 'info' });
      b.append(this.infoBody);
    }
    this.bodies.set(pid, b);
    return b;
  }
  private activateTab(group: string, pid: string): void {
    this.groupActive.set(group, pid);
    this.folded.delete(group);
    this.hidden.delete(pid);
    this.applyDock();
    this.renderPanels();
  }
  private toggleGroup(group: string): void {
    if (this.folded.has(group)) this.folded.delete(group); else this.folded.add(group);
    this.applyDock();
  }
  private applyDock(): void {
    for (const g of GROUPS) {
      const sec = this.groupEls.get(g.id);
      if (!sec) continue;
      const shown = g.panels.filter((p) => BY_ID.get('panel.' + p)?.status === 'ready' && !this.hidden.has(p));
      let act = this.groupActive.get(g.id);
      if (!act || !shown.includes(act)) act = shown[0];
      if (act) this.groupActive.set(g.id, act);
      sec.hidden = !shown.length;
      sec.toggleAttribute('data-folded', this.folded.has(g.id));
      for (const t of sec.querySelectorAll<HTMLElement>('[data-tab]')) {
        const p = t.dataset.tab as string;
        t.hidden = this.hidden.has(p);
        t.setAttribute('aria-selected', String(p === act));
      }
      for (const p of g.panels) this.bodies.get(p)?.toggleAttribute('data-active', p === act);
    }
    this.groupEls.get('more')?.toggleAttribute('data-folded', this.folded.has('more'));
  }
  togglePanelShown(pid: string): void {
    if (this.layout === 'phone') { this.togglePhonePanel(pid); return; }
    if (this.hidden.has(pid)) {
      this.hidden.delete(pid);
      const g = GROUPS.find((x) => x.panels.includes(pid));
      if (g) { this.groupActive.set(g.id, pid); this.folded.delete(g.id); }
    } else this.hidden.add(pid);
    this.applyDock();
    this.renderPanels();
  }
  panelShown(pid: string): boolean {
    return this.layout === 'phone' ? this.dockState !== 'closed' && this.phonePanel === pid : !this.hidden.has(pid);
  }
  resetWorkspace(): void {
    this.hidden.clear();
    this.folded = new Set(['nav', 'color', 'more']);
    this.groupActive.clear();
    this.setScreen('standard');
    this.flags = { rulers: true, grid: false, extras: true };
    this.root.dataset.rulers = 'on';
    this.applyDock();
    this.renderPanels();
    this.requestRender();
    this.toast('Panels are back where they started.');
  }
  collapseAll(): void {
    for (const g of GROUPS) this.folded.add(g.id);
    this.folded.add('more');
    this.applyDock();
  }
  private togglePhonePanel(pid: string): void {
    if (this.dockState !== 'closed' && this.phonePanel === pid) this.setDock('closed'); else this.setDock('half', pid);
  }
  private setDock(state: DockState, panel?: string): void {
    if (panel) this.phonePanel = panel;
    for (const [pid, b] of this.bodies) b.toggleAttribute('data-phone', pid === this.phonePanel);
    for (const t of this.dock.querySelectorAll<HTMLElement>('[data-ptab]')) t.setAttribute('aria-selected', String(t.dataset.ptab === this.phonePanel));
    this.dockState = state;
    this.dock.dataset.state = state;
    this.dock.inert = this.layout === 'phone' && state === 'closed';
    const open = state !== 'closed';
    this.root.querySelector('[data-testid="btn-layers"]')?.setAttribute('aria-expanded', String(open && this.phonePanel === 'layers'));
    this.root.querySelector('[data-testid="btn-panels"]')?.setAttribute('aria-expanded', String(open && this.phonePanel !== 'layers'));
    if (open) this.renderPanels();
  }

  // ---------- the start screen: "What do you want to do?" ----------
  private buildStart(modal: boolean): HTMLElement {
    const jobs = h('div', { class: 'fpe-jobs' }, ...JOBS.map((j) => {
      const r = BY_ID.get(j.cmd), planned = !r || r.status !== 'ready';
      const b = h('button', { type: 'button', class: 'fpe-job', 'data-tipcmd': j.cmd, 'aria-disabled': planned ? 'true' : null, 'data-testid': 'job-' + slug(j.title) },
        icon(j.icon, 'fpe-icon fpe-job-icon'), h('span', { class: 'fpe-job-title' }, j.title), h('span', { class: 'fpe-job-pro' }, j.ratio ? 'Crop 1:1' : r?.pro ?? ''),
        planned ? this.tag() : null);
      if (!planned) b.addEventListener('click', () => void this.runJob(j));
      return b;
    }));
    const btn = (id: string, ic: string, text: string, primary: boolean, testid: string): HTMLElement =>
      h('button', { type: 'button', class: 'fpe-btn ' + (primary ? 'fpe-btn-primary' : 'fpe-btn-ghost'), 'data-tipcmd': id, 'data-testid': testid, onclick: () => void this.run(id) }, icon(ic), text);
    return h('div', { class: modal ? 'fpe-start fpe-start-modal' : 'fpe-start', 'data-testid': modal ? 'start-modal' : 'start' },
      modal ? null : h('h2', { class: 'fpe-start-title' }, 'What do you want to do?'),
      h('p', { class: 'fpe-start-sub' }, modal ? 'Pick a job. The editor opens the right tool and shows you where it lives.'
        : 'Pick a job and the editor opens the right tool, then shows you where it lives. Or open a photo, drop one here, or paste one.'),
      modal ? null : h('div', { class: 'fpe-start-actions' }, btn('file.open', 'open', 'Open a photo', true, 'start-open'),
        btn('file.sample', 'image', 'Try a sample photo', false, 'start-sample'), btn('file.new', 'file-plus', 'New blank picture', false, 'start-new')),
      jobs, modal ? null : h('p', { class: 'fpe-fine' }, 'Your pictures stay on this device. Nothing is uploaded.'));
  }
  showStart(): void { if (this.doc) this.openModal('start'); else this.startEl.querySelector<HTMLElement>('.fpe-job')?.focus(); }
  private async runJob(j: Job): Promise<void> {
    if (this.modal) this.closeModal(false);
    if (!this.doc) this.openSample();
    if (j.ratio) {
      await this.run('tool.crop');
      this.ratio = j.ratio;
      this.startRatioCrop();
    } else await this.run(j.cmd);
    this.highlight(j.cmd);
  }
  private startRatioCrop(): void {
    const d = this.doc;
    if (!d || !this.ratio) return;
    let w = d.width, hh = Math.round(w / this.ratio);
    if (hh > d.height) { hh = d.height; w = Math.round(hh * this.ratio); }
    this.crop = { x: Math.round((d.width - w) / 2), y: Math.round((d.height - hh) / 2), w, h: hh };
    this.renderOptions();
    this.requestRender();
  }
  /** Show where a command lives: pulse its tool button or its menu, and say the path. */
  highlight(id: string): void {
    const r = BY_ID.get(id);
    if (!r) return;
    const el = r.kind === 'tool' ? this.groupBtns.get(r.place) ?? null
      : this.layout === 'phone' ? this.root.querySelector<HTMLElement>('[data-testid="btn-menu"]') : this.menubar.querySelector<HTMLElement>(`[data-menu="${r.place.split(' > ')[0]}"]`);
    if (el) { el.setAttribute('data-pulse', ''); window.setTimeout(() => el.removeAttribute('data-pulse'), 2600); }
    if (r.kind === 'command') this.toast(`Find it again in ${placeText(r.place)} › ${r.plain}`, 4000);
  }

  // ---------- search that understands wishes ----------
  private buildSearch(): HTMLElement {
    const id = `fpe-${this.uid}-q`;
    this.searchInput = h('input', { id, type: 'search', placeholder: 'For example: make it brighter', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'search-input', 'data-autofocus': '' });
    this.searchList = h('ul', { class: 'fpe-results', role: 'listbox', 'aria-label': 'Matching commands', 'data-testid': 'search-results' });
    this.searchInput.addEventListener('input', () => this.renderSearch());
    this.searchInput.addEventListener('keydown', (e) => {
      const items = [...this.searchList.querySelectorAll<HTMLElement>('[role="option"]')];
      let i = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        i = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length);
        items.forEach((x, k) => x.setAttribute('aria-selected', String(k === i)));
        items[i]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); items[Math.max(0, i)]?.click(); }
    });
    return h('div', { class: 'fpe-search' }, h('label', { for: id, class: 'fpe-label' }, 'What do you want to do? Type it in your own words.'), this.searchInput, this.searchList);
  }
  private renderSearch(): void {
    const q = this.searchInput.value;
    const rows = q.trim() ? search(q, 14) : SUGGEST.map((id) => BY_ID.get(id)).filter((r): r is Row => !!r);
    const firstReady = rows.findIndex((r) => r.status === 'ready');
    this.searchList.replaceChildren(...rows.map((r, k) => {
      const ok = r.status === 'ready';
      const li = h('li', { role: 'option', class: 'fpe-result', 'aria-selected': String(k === firstReady), 'aria-disabled': ok ? null : 'true', 'data-tipcmd': r.id, 'data-id': r.id, 'data-testid': 'search-result' },
        h('span', { class: 'fpe-result-top' }, this.names(r.plain, r.pro), ok ? null : this.tag(), r.key ? h('kbd', {}, keyText(r.key)) : null),
        h('span', { class: 'fpe-result-help' }, `${r.help} · ${r.kind === 'tool' ? 'Tool column' : r.kind === 'panel' ? 'Panel' : placeText(r.place)}`));
      li.addEventListener('click', () => { if (!ok) return; this.closeModal(false); void this.run(r.id).then((done) => { if (done) this.highlight(r.id); }); });
      return li;
    }));
    if (!q.trim()) this.searchList.prepend(h('li', { class: 'fpe-note' }, 'Popular:'));
    else if (!rows.length) this.searchList.append(h('li', { class: 'fpe-note' }, 'Nothing found. Try other words, like "lighter", "cut out" or "resize".'));
  }
  openSearch(): void { this.searchInput.value = ''; this.renderSearch(); this.openModal('search'); }

  // ---------- one plain line of help on hover, focus and long-press ----------
  private installTips(): void {
    const root = this.root;
    let timer = 0, press = 0, pressed = false, sx = 0, sy = 0, target: HTMLElement | null = null;
    const find = (el: EventTarget | null): HTMLElement | null => (el instanceof Element ? el.closest<HTMLElement>('[data-cmd],[data-help],[data-tipcmd]') : null);
    const show = (el: HTMLElement): void => {
      if (!this.hints || !el.isConnected || el.closest('.fpe-fly')) return;
      const id = el.dataset.cmd ?? el.dataset.tipcmd, r = id ? BY_ID.get(id) : undefined;
      const help = r?.help ?? el.dataset.help ?? '';
      if (!help) return;
      const title = r?.plain ?? el.dataset.helpTitle ?? el.getAttribute('aria-label') ?? '';
      this.tipEl.replaceChildren(...[h('span', { class: 'fpe-tip-head' }, h('strong', {}, title), r && r.pro !== r.plain ? h('span', { class: 'fpe-pro' }, r.pro) : null,
        r?.key ? h('kbd', {}, keyText(r.key)) : null, r && r.status !== 'ready' ? this.tag() : null), h('span', { class: 'fpe-tip-help' }, help),
        r && r.kind === 'command' ? h('span', { class: 'fpe-tip-place' }, 'In ' + placeText(r.place)) : null,
        el.getAttribute('aria-disabled') === 'true' && r?.status === 'ready' ? h('span', { class: 'fpe-tip-place' }, this.doc ? 'Not available right now.' : 'Open or create a picture first.') : null].filter((x): x is HTMLElement => !!x));
      this.tipEl.hidden = false;
      const rr = root.getBoundingClientRect(), er = el.getBoundingClientRect(), tw = this.tipEl.offsetWidth, th = this.tipEl.offsetHeight;
      let y = er.bottom - rr.top + 6;
      if (y + th > rr.height - 4) y = er.top - rr.top - th - 6;
      let x = er.left - rr.left;
      if (el.closest('.fpe-tools')) { x = er.right - rr.left + 8; y = er.top - rr.top; }
      this.tipEl.style.left = clamp(x, 4, Math.max(4, rr.width - tw - 4)) + 'px';
      this.tipEl.style.top = clamp(y, 4, Math.max(4, rr.height - th - 4)) + 'px';
      target = el;
    };
    root.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType !== 'mouse') return;
      const el = find(e.target);
      if (el === target) return;
      clearTimeout(timer);
      if (target) this.hideTip();
      if (el) timer = window.setTimeout(() => show(el), 450);
    });
    root.addEventListener('pointerout', (e) => {
      const el = find(e.target), to = (e as PointerEvent).relatedTarget;
      if (el && to instanceof Node && el.contains(to)) return;
      clearTimeout(timer);
      if (target && el === target) this.hideTip();
    });
    root.addEventListener('pointerdown', (e) => {
      clearTimeout(timer);
      this.hideTip();
      const pe = e as PointerEvent;
      if (pe.pointerType === 'mouse') return;
      const el = find(e.target);
      if (!el || el.closest('.fpe-tool')) return;
      pressed = false; sx = pe.clientX; sy = pe.clientY;
      press = window.setTimeout(() => { pressed = true; show(el); }, 520);
    });
    root.addEventListener('pointermove', (e) => { const pe = e as PointerEvent; if (press && Math.hypot(pe.clientX - sx, pe.clientY - sy) > 8) { clearTimeout(press); press = 0; } });
    root.addEventListener('pointerup', () => { clearTimeout(press); press = 0; });
    root.addEventListener('click', (e) => { if (pressed) { e.preventDefault(); e.stopPropagation(); pressed = false; } }, true);
    root.addEventListener('focusin', (e) => {
      const el = find(e.target);
      if (el && el === e.target && el.matches(':focus-visible')) show(el); else this.hideTip();
    });
    root.addEventListener('focusout', () => this.hideTip());
    this.hideTip = (): void => { this.tipEl.hidden = true; target = null; };
  }
  private hideTip = (): void => { this.tipEl.hidden = true; };

  // ---------- running commands ----------
  isEnabled(id: string): boolean {
    const r = BY_ID.get(id), hd = HANDLERS[id];
    return !!r && r.status === 'ready' && !!hd && hd.enabled(this);
  }
  async run(id: string): Promise<boolean> {
    const r = BY_ID.get(id);
    if (!r) return false;
    if (r.status !== 'ready') { this.toast(`${r.plain} (${r.pro}) is planned for a later version.`); return false; }
    const hd = HANDLERS[id];
    if (!hd) return false;
    if (!hd.enabled(this)) { this.toast(this.doc ? `${r.plain} is not available right now.` : 'Open or create a picture first.'); return false; }
    this.closeMenus();
    this.closePopover();
    await hd.run(this);
    this.syncChrome();
    return true;
  }
  /** Bring every always-visible control in line with the state: enabled, checked, pressed. */
  private syncChrome(): void {
    for (const b of this.shell.querySelectorAll<HTMLElement>('[data-cmd]')) {
      const id = b.dataset.cmd as string, r = BY_ID.get(id);
      if (!r || b.classList.contains('fpe-tool') || b.classList.contains('fpe-gtab') || b.tagName === 'LI') continue;
      const hd = HANDLERS[id], ok = r.status === 'ready' && !!hd && hd.enabled(this);
      if (ok) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
      if (hd?.checked && b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(hd.checked(this)));
    }
    for (const [path, b] of this.groupBtns) {
      const cur = this.groupCur.get(path) ?? '';
      b.setAttribute('aria-pressed', String(TOOLS[cur] === this.tool));
    }
    this.updateUndo();
  }

  // ---------- layout, theme, view ----------
  private onRootResize(): void {
    const w = this.root.clientWidth;
    const layout: Layout = w >= 1024 ? 'desktop' : w >= 768 ? 'tablet' : 'phone';
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.dataset.layout = layout;
    this.closeMenus();
    this.closePopover();
    this.toolsBar.setAttribute('aria-orientation', layout === 'phone' ? 'horizontal' : 'vertical');
    this.setDock('closed');
    this.dock.inert = layout === 'phone';
    this.renderOptions();
  }
  private onStageResize(): void {
    this.renderer.resize(this.stage.clientWidth, this.stage.clientHeight, window.devicePixelRatio || 1);
    if (this.doc && this.fitted) this.fit(); else this.requestRender();
  }
  private loadPrefs(): void {
    try {
      this.proNames = localStorage.getItem('fpe-names') === 'pro';
      this.hints = localStorage.getItem('fpe-hints') !== 'off';
    } catch { /* storage may be blocked */ }
    this.root.dataset.names = this.proNames ? 'pro' : 'plain';
    this.root.dataset.hints = this.hints ? 'on' : 'off';
  }
  setNames(pro: boolean, save = false): void {
    this.proNames = pro;
    this.root.dataset.names = pro ? 'pro' : 'plain';
    if (save) { try { localStorage.setItem('fpe-names', pro ? 'pro' : 'plain'); } catch { /* ignore */ } }
    this.toast(pro ? 'Pro names now come first.' : 'Plain names now come first.');
  }
  setHints(on: boolean, save = false): void {
    this.hints = on;
    this.root.dataset.hints = on ? 'on' : 'off';
    if (!on) this.hideTip();
    if (save) { try { localStorage.setItem('fpe-hints', on ? 'on' : 'off'); } catch { /* ignore */ } }
    this.toast(on ? 'Help lines are on.' : 'Help lines are off.');
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
    this.rulerInk = { bg: v('--panel-2', '#212228'), fg: v('--muted', '#a6a9b3'), ac: v('--accent', '#86b7ff') };
    this.queueThumbs();
    this.requestRender();
  }
  toggleTheme(): void { this.applyTheme(this.root.dataset.theme === 'dark' ? 'light' : 'dark', true); }
  setScreen(s: Screen): void {
    this.screen = s;
    this.root.dataset.screen = s;
    this.closePopover();
    if (s === 'focus') this.toast('Picture only. Press F or Esc to bring the tools back.');
  }
  toggleFlag(f: Flag): void {
    this.flags[f] = !this.flags[f];
    this.root.dataset.rulers = this.flags.rulers ? 'on' : 'off';
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
    this.queueNav();
  }
  private zoomAt(f: number, sx: number, sy: number): void {
    const v = this.view, z = clamp(v.zoom * f, 0.01, 32), k = z / v.zoom;
    this.setView({ zoom: z, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k });
  }
  zoomBy(f: number): void { this.fitted = false; this.zoomAt(f, this.stage.clientWidth / 2, this.stage.clientHeight / 2); }
  zoomTo(z: number): void { this.fitted = false; this.zoomAt(z / this.view.zoom, this.stage.clientWidth / 2, this.stage.clientHeight / 2); }
  fit(): void {
    const d = this.doc;
    if (!d) { this.requestRender(); return; }
    const W = this.stage.clientWidth, H = this.stage.clientHeight, m = this.layout === 'phone' ? 12 : 32;
    const z = clamp(Math.min((W - m * 2) / d.width, (H - m * 2) / d.height), 0.01, 16);
    this.fitted = true;
    this.view = { zoom: z, panX: Math.round((W - d.width * z) / 2), panY: Math.round((H - d.height * z) / 2) };
    this.requestRender();
    this.queueNav();
  }

  // ---------- rendering ----------
  private markDirty(r: Rect | null): void {
    if (!r || !this.doc) return;
    const c = intersect(r, docRect(this.doc));
    if (c) this.dirty = union(this.dirty, c);
    this.queueNav();
  }
  private markAll(): void { if (this.doc) { this.dirty = docRect(this.doc); this.queueNav(); } }
  private requestRender(): void { if (!this.raf) this.raf = requestAnimationFrame(() => this.renderNow()); }
  private gridSize(): number {
    const d = this.doc;
    if (!d) return 0;
    const target = Math.max(d.width, d.height) / 12;
    return [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s >= target) ?? 1000;
  }
  private renderNow(): void {
    this.raf = 0;
    const d = this.doc;
    if (d && (d.width !== this.rendW || d.height !== this.rendH)) {
      this.renderer.setDocumentSize(d.width, d.height);
      this.rendW = d.width; this.rendH = d.height;
      this.dirty = docRect(d);
    } else if (!d && this.rendW) { this.renderer.setDocumentSize(0, 0); this.rendW = 0; this.rendH = 0; }
    if (d && this.dirty) { const r = this.dirty; this.dirty = null; this.renderer.upload(r, compositeDoc(d, r)); }
    const t = this.tool, z = this.view.zoom, o = t === 'eraser' ? this.eraser : t === 'pencil' ? this.pencil : this.brush;
    const cursor = this.hoverPt && d && (t === 'brush' || t === 'eraser' || t === 'pencil') ? { x: this.hoverPt.x, y: this.hoverPt.y, r: (o.size / 2) * z } : null;
    this.renderer.render(this.view, { selection: d && this.flags.extras ? d.selection : null, hole: d && this.flags.extras ? this.hole : null,
      crop: t === 'crop' ? this.crop : null, cursor, ants: this.ants, grid: d && this.flags.grid ? this.gridSize() : 0 });
    if (this.flags.rulers && this.layout !== 'phone' && this.screen === 'standard') this.drawRulers();
    this.renderStatus();
    this.renderInfo();
    if (this.navZoom && document.activeElement !== this.navZoom) {
      this.navZoom.value = String(Math.round(((Math.log(z) - Math.log(0.01)) / (Math.log(32) - Math.log(0.01))) * 1000));
    }
  }
  private drawRulers(): void {
    const v = this.view, z = v.zoom, dpr = window.devicePixelRatio || 1, ink = this.rulerInk;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
    const step = steps.find((s) => s * z >= 64) ?? 10000, minor = step * z / 10 >= 5 ? step / 10 : step / 5 * z >= 5 ? step / 5 : step / 2;
    for (const [cv, horiz] of [[this.rulerH, true], [this.rulerV, false]] as const) {
      const w = cv.clientWidth, hh = cv.clientHeight;
      if (!w || !hh) continue;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = ink.bg;
      ctx.fillRect(0, 0, w, hh);
      if (!this.doc) continue;
      const len = horiz ? w : hh, pan = horiz ? v.panX : v.panY, depth = horiz ? hh : w;
      const start = Math.floor(-pan / z / minor) * minor, end = (len - pan) / z;
      ctx.strokeStyle = ink.fg; ctx.fillStyle = ink.fg; ctx.lineWidth = 1; ctx.font = '11px system-ui, sans-serif';
      ctx.beginPath();
      for (let u = start; u <= end; u += minor) {
        const p = Math.round(pan + u * z) + 0.5, major = Math.abs(u / step - Math.round(u / step)) < 1e-6, t = major ? depth : depth * 0.3;
        if (horiz) { ctx.moveTo(p, hh); ctx.lineTo(p, hh - t); } else { ctx.moveTo(w, p); ctx.lineTo(w - t, p); }
        if (major) {
          if (horiz) ctx.fillText(String(Math.round(u)), p + 3, 11);
          else { ctx.save(); ctx.translate(11, p + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(u)), 0, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
      if (this.pointer) {
        const pp = Math.round(pan + (horiz ? this.pointer.x : this.pointer.y) * z) + 0.5;
        ctx.strokeStyle = ink.ac;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(pp, 0); ctx.lineTo(pp, hh); } else { ctx.moveTo(0, pp); ctx.lineTo(w, pp); }
        ctx.stroke();
      }
    }
  }
  private renderStatus(): void {
    const d = this.doc, s = this.stat, p = this.pointer;
    s.zoom.textContent = Math.round(this.view.zoom * 100) + '%';
    s.size.textContent = d ? `${d.width} × ${d.height} px` : 'No picture open';
    s.pos.textContent = d && p ? `x ${Math.floor(p.x)}, y ${Math.floor(p.y)}` : '';
    s.sel.textContent = d?.selection ? (this.hole ? 'Everything except a box selected' : `Selected ${d.selection.w} × ${d.selection.h} px`) : '';
    const r = BY_ID.get(Object.keys(TOOLS).find((k) => TOOLS[k] === this.tool) ?? '');
    s.hint.textContent = r ? `${r.plain}: ${r.help}` : '';
  }
  private renderInfo(): void {
    const b = this.infoBody;
    if (!b || !b.isConnected || (this.layout !== 'phone' && this.hidden.has('info'))) return;
    const d = this.doc, p = this.pointer;
    const c = d && p ? samplePixel(d, p.x, p.y) : null;
    const rows: [string, string][] = [
      ['Pointer', d && p ? `x ${Math.floor(p.x)}, y ${Math.floor(p.y)}` : '–'],
      ['Colour there', c ? `${toHex(c)} · R ${c.r} G ${c.g} B ${c.b}${c.a < 255 ? ` · ${Math.round((c.a / 255) * 100)}% solid` : ''}` : '–'],
      ['Picture', d ? `${d.width} × ${d.height} px` : '–'],
      ['Selection', d?.selection ? `${d.selection.w} × ${d.selection.h} px at ${d.selection.x}, ${d.selection.y}` : 'None'],
      ['Zoom', Math.round(this.view.zoom * 100) + '%'],
      ['Main colour', this.brush.color]];
    const text = rows.map((r) => r.join(':')).join('|');
    if (b.dataset.text === text) return;
    b.dataset.text = text;
    b.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }
  private queueNav(): void { clearTimeout(this.navTimer); this.navTimer = window.setTimeout(() => this.drawNav(), 220); }
  private drawNav(): void {
    const c = this.navCanvas, ctx = c?.getContext('2d'), d = this.doc;
    if (!c || !ctx || !c.isConnected) return;
    const W = c.width, H = c.height;
    ctx.fillStyle = this.rulerInk.bg;
    ctx.fillRect(0, 0, W, H);
    if (!d) return;
    const k = Math.min(W / d.width, H / d.height), tw = Math.max(1, Math.round(d.width * k)), th = Math.max(1, Math.round(d.height * k));
    const ox = Math.round((W - tw) / 2), oy = Math.round((H - th) / 2), img = ctx.createImageData(tw, th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const dx = Math.floor(x / k), dy = Math.floor(y / k), i = (y * tw + x) * 4;
      let r = ((x >> 3) + (y >> 3)) & 1 ? 232 : 204, g = r, b = r;
      for (const l of d.layers) {
        if (!l.visible) continue;
        const lx = dx - l.x, ly = dy - l.y;
        if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) continue;
        const j = (ly * l.width + lx) * 4, a = (l.data[j + 3] / 255) * l.opacity;
        r = l.data[j] * a + r * (1 - a); g = l.data[j + 1] * a + g * (1 - a); b = l.data[j + 2] * a + b * (1 - a);
      }
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, ox, oy);
    const v = this.view;
    ctx.strokeStyle = this.rulerInk.ac;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + (-v.panX / v.zoom) * k, oy + (-v.panY / v.zoom) * k, (this.stage.clientWidth / v.zoom) * k, (this.stage.clientHeight / v.zoom) * k);
  }

  // ---------- tools ----------
  setTool(t: ToolId): void {
    if (this.stroke || this.drag) return;
    if (t !== 'crop') { this.crop = null; this.ratio = 0; }
    this.tool = t;
    this.root.dataset.tool = t;
    const id = Object.keys(TOOLS).find((k) => TOOLS[k] === t);
    const r = id ? BY_ID.get(id) : undefined;
    if (r && id) {
      this.groupCur.set(r.place, id);
      const b = this.groupBtns.get(r.place);
      if (b) { b.dataset.cmd = id; b.setAttribute('aria-label', `${r.plain} (${r.pro})`); }
    }
    this.renderOptions();
    this.syncChrome();
    this.requestRender();
  }
  private clampPt(p: Pt): Pt {
    const d = this.doc as Doc;
    return { x: clamp(Math.round(p.x), 0, d.width), y: clamp(Math.round(p.y), 0, d.height) };
  }
  private paintOpts(): { size: number; hardness: number; opacity: number } {
    return this.tool === 'eraser' ? this.eraser : this.tool === 'pencil' ? this.pencil : this.brush;
  }
  private strokePoint(p: Pt, i: PointerInfo): StrokePoint {
    if (i.type !== 'pen') return { x: p.x, y: p.y };
    const o = this.paintOpts(), pr = clamp(i.pressure, 0.05, 1), tilt = Math.min(1, Math.hypot(i.tiltX, i.tiltY) / 60);
    return { x: p.x, y: p.y, size: o.size * (0.2 + 0.8 * pr) * (1 + 0.5 * tilt), flow: (0.35 + 0.65 * pr) * (1 - 0.3 * tilt) };
  }
  private editable(l: Layer): boolean {
    if (!l.locked) return true;
    this.toast(`"${l.name}" is locked. Unlock it in the Layers panel to change it.`);
    return false;
  }
  private toolStart(p: Pt, i: PointerInfo): void {
    const d = this.doc;
    this.closePopover();
    this.closeMenus();
    if (!d) return;
    if (this.session) { this.toast('Apply or cancel the adjustment first.'); return; }
    const t: ToolId = i.alt && (this.tool === 'brush' || this.tool === 'pencil') ? 'eyedropper' : this.tool;
    if (t === 'hand') { this.drag = { kind: 'pan', start: p }; return; }
    if (t === 'zoom') { this.fitted = false; this.zoomAt(i.alt ? 0.8 : 1.25, p.x * this.view.zoom + this.view.panX, p.y * this.view.zoom + this.view.panY); return; }
    if (t === 'brush' || t === 'eraser' || t === 'pencil') {
      const l = activeLayer(d);
      if (!l || !this.editable(l)) return;
      if (!l.visible) { this.toast('This layer is hidden. Show it to paint on it.'); return; }
      const o = this.paintOpts();
      this.stroke = new Stroke(d, l, { size: o.size, hardness: o.hardness, opacity: o.opacity, color: parseHex(this.brush.color) ?? BLACK, erase: t === 'eraser' });
      this.stroke.add(this.strokePoint(p, i));
      this.flushStroke();
      return;
    }
    if (t === 'move') { const l = activeLayer(d); if (l && this.editable(l)) this.drag = { kind: 'move', start: p, x: l.x, y: l.y, id: l.id }; return; }
    if (t === 'eyedropper') { this.drag = { kind: 'pick', start: p }; this.pick(p); return; }
    this.drag = { kind: t, start: this.clampPt(p) };
    if (t === 'crop') this.crop = null; else { d.selection = null; this.hole = null; }
    this.updateAnts();
    this.requestRender();
  }
  private toolMove(p: Pt, i: PointerInfo): void {
    const d = this.doc;
    if (!d) return;
    if (this.stroke) { this.stroke.add(this.strokePoint(p, i)); this.flushStroke(); return; }
    const g = this.drag;
    if (!g) return;
    if (g.kind === 'pan') {
      const z = this.view.zoom;
      this.fitted = false;
      this.setView({ zoom: z, panX: this.view.panX + (p.x - g.start.x) * z, panY: this.view.panY + (p.y - g.start.y) * z });
      return;
    }
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
    if (g.kind === 'crop' && this.ratio) {
      const dx = p.x - g.start.x, dy = p.y - g.start.y;
      let w = Math.abs(dx), hh = Math.abs(dy);
      if (w / this.ratio > hh) hh = w / this.ratio; else w = hh * this.ratio;
      r = intersect(rectFromPoints(g.start, { x: g.start.x + Math.sign(dx || 1) * w, y: g.start.y + Math.sign(dy || 1) * hh }), docRect(d)) ?? r;
    } else if (i.shift) { const s = Math.min(r.w, r.h); r = { x: r.x, y: r.y, w: s, h: s }; }
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
    else if (g.kind === 'crop') { if (this.crop && (this.crop.w < 2 || this.crop.h < 2)) this.crop = null; this.renderOptions(); }
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
    this.setColor(toHex(c), false);
  }
  setColor(c: string, second: boolean, fromPanel = false): void {
    if (second) this.bgColor = c; else this.brush.color = c;
    this.syncColor();
    if (!fromPanel) this.renderColor();
  }
  private syncColor(): void {
    for (const el of this.root.querySelectorAll<HTMLInputElement>('input[data-color]')) el.value = this.brush.color;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-swatch]')) el.style.background = this.brush.color;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-swatch-bg]')) el.style.background = this.bgColor;
  }
  swapColors(): void { [this.brush.color, this.bgColor] = [this.bgColor, this.brush.color]; this.syncColor(); this.renderColor(); }
  defaultColors(): void { this.brush.color = '#000000'; this.bgColor = '#ffffff'; this.syncColor(); this.renderColor(); }
  private renderOptions(): void {
    const o = this.optionsBar, t = this.tool, d = this.doc;
    o.replaceChildren();
    const id = Object.keys(TOOLS).find((k) => TOOLS[k] === t), r = id ? BY_ID.get(id) : undefined;
    if (r) o.append(h('span', { class: 'fpe-opt-tool', 'data-tipcmd': r.id }, icon(GROUP_ICON[r.place] ?? 'square'), this.names(r.plain, r.pro)));
    const hint = (s: string): HTMLElement => h('span', { class: 'fpe-hint' }, s);
    const btn = (cmd: string, label: string, testid?: string): HTMLElement => this.cmdBtn(cmd, null, label, testid ? { 'data-testid': testid } : {});
    if (t === 'brush' || t === 'eraser' || t === 'pencil') {
      const b = this.paintOpts();
      if (t !== 'eraser') {
        const ci = h('input', { type: 'color', value: this.brush.color, 'aria-label': 'Main colour', 'data-color': '', 'data-testid': 'brush-color' });
        ci.addEventListener('input', () => this.setColor(ci.value, false));
        o.append(h('label', { class: 'fpe-swatch', 'data-help-title': 'Main colour', 'data-help': 'The colour you paint with. Tap to choose.' }, ci, h('span', { 'data-swatch': '', style: 'background:' + this.brush.color })));
      }
      o.append(...[
        this.slider('Size', 'How wide the brush is, in pixels. Keys [ and ] change it too.', 1, 500, Math.round(b.size), ' px', (v) => { b.size = v; this.requestRender(); }, 'opt-size'),
        t === 'pencil' ? null : this.slider('Softness', 'How soft the edge is: 0 is crisp, 100 fades out gently.', 0, 100, Math.round((1 - b.hardness) * 100), '%', (v) => { b.hardness = 1 - v / 100; }, 'opt-softness'),
        this.slider('Strength', t === 'eraser' ? 'How much each stroke rubs out.' : 'How solid the paint is: 100 covers fully, lower is see-through.', 1, 100, Math.round(b.opacity * 100), '%', (v) => { b.opacity = v / 100; }, 'opt-opacity')].filter((x): x is HTMLElement => !!x));
    } else if (t === 'select') {
      const s = d?.selection;
      o.append(hint(s ? `${s.w} × ${s.h} px selected` : 'Drag over the picture to select a box. Hold Shift for a square.'),
        btn('select.all', 'Select all', 'sel-all'), btn('select.none', 'Deselect', 'sel-none'), btn('select.inverse', 'Inverse', 'sel-inverse'),
        btn('edit.clear', 'Delete area', 'sel-delete'), btn('image.crop', 'Crop to selection', 'sel-crop'));
    } else if (t === 'crop') {
      const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Shape' });
      for (const [label, ratio] of RATIOS) {
        seg.append(h('button', { type: 'button', 'aria-pressed': String(this.ratio === ratio), 'data-testid': 'crop-ratio-' + slug(label), 'data-help-title': label,
          'data-help': ratio ? 'Keep this shape while you drag.' : 'Any shape you drag.', onclick: () => { this.ratio = ratio; if (ratio) this.startRatioCrop(); else this.renderOptions(); } }, label));
      }
      o.append(seg);
      if (this.crop) o.append(hint(`Keep ${this.crop.w} × ${this.crop.h} px`),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'crop-cancel', onclick: () => { this.crop = null; this.renderOptions(); this.requestRender(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'crop-apply', onclick: () => this.applyCrop() }, 'Apply crop'));
      else o.append(hint('Drag over the picture to choose the part to keep.'));
    } else if (t === 'move') o.append(hint('Drag to move the active layer. Arrow keys nudge it 1 px (Shift: 10 px).'), btn('edit.flip-layer-h', 'Mirror'), btn('edit.rotate-layer-cw', 'Turn right'));
    else if (t === 'hand') o.append(hint('Drag to move around the picture.'), btn('view.fit', 'Fit on screen'), btn('view.actual', '100%'));
    else if (t === 'zoom') o.append(hint('Click to zoom in; Alt-click to zoom out.'), btn('view.zoom-in', 'Zoom in'), btn('view.zoom-out', 'Zoom out'), btn('view.fit', 'Fit'), btn('view.actual', '100%'));
    else {
      const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Pick from' });
      for (const [all, label] of [[true, 'All layers'], [false, 'This layer']] as const) {
        seg.append(h('button', { type: 'button', 'aria-pressed': String(this.sampleAll === all), onclick: () => { this.sampleAll = all; this.renderOptions(); } }, label));
      }
      o.append(h('span', { class: 'fpe-dot', 'data-swatch': '', style: 'background:' + this.brush.color, role: 'img', 'aria-label': 'Main colour ' + this.brush.color }),
        hint('Tap the picture to pick a colour to paint with.'), seg);
    }
    this.syncChrome();
  }
  private slider(label: string, help: string, min: number, max: number, value: number, unit: string, onInput: (v: number) => void, testid: string): HTMLElement {
    const id = `fpe-${this.uid}-${testid}`;
    const out = h('output', { class: 'fpe-out', for: id }, value + unit);
    const inp = h('input', { id, type: 'range', min, max, step: 1, value, 'data-testid': testid });
    inp.addEventListener('input', () => { const v = Number(inp.value); out.textContent = v + unit; onInput(v); });
    return this.field(id, label, help, inp, out);
  }

  // ---------- selection and crop ----------
  selectAll(): void { const d = this.doc; if (!d) return this.needDoc(); d.selection = docRect(d); this.hole = null; this.afterSelection(); }
  deselect(): void {
    const d = this.doc;
    if (!d || !d.selection) return;
    this.lastSel = d.selection;
    d.selection = null;
    this.hole = null;
    this.afterSelection();
  }
  reselect(): void {
    const d = this.doc, s = this.lastSel;
    if (!d || !s) return;
    this.lastSel = d.selection;
    d.selection = { ...s };
    this.hole = null;
    this.afterSelection();
  }
  inverseSelect(): void {
    const d = this.doc, s = d?.selection;
    if (!d || !s) return;
    if (this.hole) { d.selection = { ...this.hole }; this.hole = null; this.afterSelection(); return; }
    const inv = inverseSelection(d);
    if (!inv) { this.toast('Everything is selected, so nothing is left to select.'); return; }
    this.hole = s.alpha ? null : { x: s.x, y: s.y, w: s.w, h: s.h };
    d.selection = inv;
    this.afterSelection();
  }
  private afterSelection(): void { this.updateAnts(); this.renderOptions(); this.renderProps(); this.requestRender(); }
  private updateAnts(): void {
    clearInterval(this.antsTimer);
    this.antsTimer = 0;
    if (this.doc?.selection && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.antsTimer = window.setInterval(() => { this.ants = (this.ants + 1) % 10; this.requestRender(); }, 120);
    }
  }
  deleteArea(): void {
    const d = this.doc;
    if (!d) return;
    if (!d.selection) { this.toast('Select an area first, then delete it.'); return; }
    const l = activeLayer(d);
    if (!l || !this.editable(l)) return;
    this.pushCmd(clearSelection(d, l), true);
  }
  fillArea(second: boolean): void {
    const d = this.doc, l = d ? activeLayer(d) : undefined;
    if (!d || !l || !this.editable(l)) return;
    const c = parseHex(second ? this.bgColor : this.brush.color) ?? BLACK;
    this.pushCmd(fillSelection(d, l, c, second ? 'Fill with second colour' : 'Fill'), true);
  }
  cropToSelection(): void { const s = this.doc?.selection; if (!s) { this.toast('Select an area first.'); return; } this.applyCropRect(s); }
  private applyCrop(): void { const r = this.crop; if (!r) return; this.crop = null; this.applyCropRect(r); }
  private applyCropRect(r: Rect): void {
    const d = this.doc;
    if (!d) return;
    this.cancelSession();
    const cmd = cropDocument(d, r);
    if (!cmd) return;
    this.hole = null;
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
  private afterEdit(): void { this.renderPanels(); this.renderTabs(); this.syncChrome(); this.requestRender(); }
  undo(gesture = false): void {
    const d = this.doc;
    if (!d || this.stroke) return;
    this.cancelSession();
    this.crop = null;
    const c = this.history.undo(d);
    if (!c) { if (gesture) this.toast('Nothing to undo.'); return; }
    this.afterHistory();
    if (gesture) this.toast('Undone: ' + c.label);
  }
  redo(gesture = false): void {
    const d = this.doc;
    if (!d || this.stroke) return;
    this.cancelSession();
    const c = this.history.redo(d);
    if (!c) { if (gesture) this.toast('Nothing to redo.'); return; }
    this.afterHistory();
    if (gesture) this.toast('Redone: ' + c.label);
  }
  private goToStep(k: number): void {
    const d = this.doc;
    if (!d) return;
    this.cancelSession();
    let i = this.history.entries().index;
    while (i > k && this.history.undo(d)) i--;
    while (i < k && this.history.redo(d)) i++;
    this.afterHistory();
  }
  revert(): void {
    const d = this.doc;
    if (!d) return;
    this.cancelSession();
    while (this.history.undo(d)) { /* back to the opened version */ }
    this.afterHistory();
    this.toast('Back to the opened version. Redo brings your changes back.');
  }
  private afterHistory(): void {
    const d = this.doc;
    const resized = !!d && (d.width !== this.rendW || d.height !== this.rendH);
    this.markAll();
    this.updateAnts();
    this.renderOptions();
    this.afterEdit();
    if (resized) this.fit();
  }
  private updateUndo(): void {
    const hs = this.history;
    this.undoBtn.setAttribute('aria-label', hs.undoLabel && this.doc ? `Undo: ${hs.undoLabel}` : 'Undo');
    this.redoBtn.setAttribute('aria-label', hs.redoLabel && this.doc ? `Redo: ${hs.redoLabel}` : 'Redo');
  }

  // ---------- panels ----------
  private renderPanels(): void {
    this.renderLayers();
    this.renderHistory();
    this.renderProps();
    this.renderColor();
    this.renderInfo();
    this.queueNav();
  }
  private renderLayers(): void {
    const d = this.doc, list = this.layerList;
    if (!list) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    list.replaceChildren();
    this.layerProps.replaceChildren();
    if (!d) { list.append(h('li', { class: 'fpe-note' }, 'Open or create a picture to see its layers.')); return; }
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i], on = l.id === d.activeId;
      list.append(h('li', { class: 'fpe-layer', 'data-testid': 'layer-row', 'data-name': l.name, 'aria-current': on ? 'true' : 'false' },
        h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn', 'aria-pressed': String(l.visible), 'aria-label': (l.visible ? 'Hide ' : 'Show ') + l.name,
          'data-help-title': l.visible ? 'Hide this layer' : 'Show this layer', 'data-help': 'The eye shows or hides a layer without deleting it.', 'data-testid': 'layer-eye',
          onclick: () => this.toggleVisible(l.id) }, icon(l.visible ? 'eye' : 'eye-off')),
        h('canvas', { class: 'fpe-layer-thumb', width: 80, height: 80, 'data-thumb': l.id, 'aria-hidden': 'true' }),
        h('button', { type: 'button', class: 'fpe-btn fpe-layer-name', 'aria-label': `Layer ${l.name}${l.visible ? '' : ', hidden'}${l.locked ? ', locked' : ''}${on ? ', active' : ''}`,
          'data-testid': 'layer-select', onclick: () => this.selectLayer(l.id), ondblclick: () => this.openModal('rename') }, h('span', {}, l.name)),
        l.locked ? icon('lock', 'fpe-icon fpe-layer-lock') : null));
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
        h('div', { class: 'fpe-row', 'data-help-title': 'Blend mode', 'data-help': 'How this layer mixes with the layers under it. Normal simply covers them.' },
          h('label', { for: id + 'b' }, 'Blend'), blend),
        h('div', { class: 'fpe-row', 'data-help-title': 'Opacity', 'data-help': 'How solid the layer is: 100% covers fully, lower lets the layers below show through.' },
          h('label', { for: id + 'o' }, 'Opacity'), op, opOut),
        h('div', { class: 'fpe-row', 'data-help-title': 'Layer name', 'data-help': 'A clear name helps you find the layer later.' }, h('label', { for: id + 'n' }, 'Name'), name));
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
  private renderHistory(): void {
    const ul = this.histList;
    if (!ul) return;
    if (!this.doc) { ul.replaceChildren(h('li', { class: 'fpe-note' }, 'Your steps appear here.')); return; }
    const { labels, index } = this.history.entries();
    ul.replaceChildren(...['Opened ' + this.name, ...labels].map((label, k) => h('li', {},
      h('button', { type: 'button', class: 'fpe-hist-item', 'aria-current': k === index ? 'step' : null, 'data-undone': k > index ? '' : null, 'data-testid': 'history-step',
        'data-help-title': label, 'data-help': k > index ? 'An undone step. Pick it to bring it back.' : 'Pick a step to go back to how the picture looked then.', onclick: () => this.goToStep(k) }, label))));
    ul.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }
  private renderProps(): void {
    const b = this.propsBody;
    if (!b) return;
    b.replaceChildren();
    const d = this.doc, l = d ? activeLayer(d) : undefined;
    if (!d || !l) { b.append(h('p', { class: 'fpe-note' }, 'Open or create a picture to see its properties.')); return; }
    const id = `fpe-${this.uid}-p`;
    const num = (key: 'x' | 'y', label: string, help: string): HTMLElement => {
      const inp = h('input', { id: id + key, type: 'number', value: l[key], step: 1, 'data-testid': 'prop-' + key });
      inp.addEventListener('change', () => {
        const v = Math.round(Number(inp.value));
        if (!Number.isFinite(v) || v === l[key]) return;
        if (!this.editable(l)) { inp.value = String(l[key]); return; }
        const old = layerRect(l);
        this.pushCmd(setLayerProps(d, l.id, { [key]: v } as LayerProps, 'Move layer'));
        this.markDirty(union(old, layerRect(l)));
      });
      return h('div', { class: 'fpe-row', 'data-help-title': label, 'data-help': help }, h('label', { for: id + key }, label), inp);
    };
    b.append(h('h3', { class: 'fpe-group-title' }, 'Layer: ' + l.name),
      num('x', 'Left (X)', 'How far the layer sits from the left edge, in pixels.'), num('y', 'Top (Y)', 'How far the layer sits from the top edge, in pixels.'),
      h('p', { class: 'fpe-kv' }, `${l.width} × ${l.height} px · opacity ${Math.round(l.opacity * 100)}% · ${BLEND_LABELS[l.blendMode]}${l.locked ? ' · locked' : ''}${l.visible ? '' : ' · hidden'}`),
      h('h3', { class: 'fpe-group-title' }, 'Picture'),
      h('p', { class: 'fpe-kv' }, `${d.width} × ${d.height} px · ${d.layers.length} layer${d.layers.length === 1 ? '' : 's'}`),
      h('div', { class: 'fpe-btnrow' }, this.cmdBtn('image.size', null, 'Picture size…'), this.cmdBtn('image.canvas-size', null, 'Canvas size…')));
  }
  private renderColor(): void {
    const b = this.colorBody;
    if (!b) return;
    const id = `fpe-${this.uid}-c`, c = parseHex(this.brush.color) ?? BLACK;
    const hex = h('input', { id: id + 'x', type: 'text', value: this.brush.color, maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'data-testid': 'color-hex' });
    hex.addEventListener('change', () => { const p = parseHex(hex.value); if (p) this.setColor(toHex(p), false); else hex.value = this.brush.color; });
    const wheel = h('input', { type: 'color', value: this.brush.color, 'data-color': '', 'aria-label': 'Choose the main colour from a colour wheel', 'data-testid': 'color-wheel' });
    wheel.addEventListener('input', () => this.setColor(wheel.value, false, true));
    const chan = (k: 'r' | 'g' | 'b', label: string): HTMLElement => {
      const out = h('output', { class: 'fpe-out', for: id + k }, String(c[k]));
      const inp = h('input', { id: id + k, type: 'range', min: 0, max: 255, step: 1, value: c[k], 'data-testid': 'color-' + k });
      inp.addEventListener('input', () => {
        const cur = parseHex(this.brush.color) ?? BLACK;
        cur[k] = Number(inp.value);
        out.textContent = inp.value;
        hex.value = toHex(cur);
        this.setColor(toHex(cur), false, true);
      });
      return this.field(id + k, label, `How much ${label.toLowerCase()} light is in the main colour, from 0 (none) to 255 (full).`, inp, out);
    };
    b.replaceChildren(h('div', { class: 'fpe-color-top' },
      h('label', { class: 'fpe-color-big', 'data-help-title': 'Main colour', 'data-help': 'Tap to choose from a colour wheel.' }, wheel, h('span', { 'data-swatch': '', style: 'background:' + this.brush.color })),
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'x' }, 'Hex'), hex),
      this.cmdBtn('tool.swap-colors', 'swap', null, { 'data-testid': 'color-swap' }),
      h('span', { class: 'fpe-color-second', 'data-swatch-bg': '', style: 'background:' + this.bgColor, role: 'img', 'aria-label': 'Second colour ' + this.bgColor })),
      chan('r', 'Red'), chan('g', 'Green'), chan('b', 'Blue'));
  }
  private addLayerAction0(): void { if (this.doc) this.pushCmd(addEmptyLayer(this.doc)); }
  addLayerAction(): void { if (!this.doc) return this.needDoc(); this.addLayerAction0(); }
  duplicateLayerAction(): void { if (!this.doc) return this.needDoc(); this.pushCmd(duplicateActive(this.doc), true); }
  deleteLayerAction(): void {
    const d = this.doc;
    if (!d) return this.needDoc();
    if (d.layers.length < 2) { this.toast('A picture needs at least one layer.'); return; }
    this.cancelSession();
    this.pushCmd(deleteLayer(d, d.activeId), true);
  }
  arrange(k: 'front' | 'forward' | 'backward' | 'back'): void {
    const d = this.doc;
    if (!d) return;
    const i = indexOfLayer(d, d.activeId), n = d.layers.length;
    const to = k === 'front' ? n - 1 : k === 'forward' ? i + 1 : k === 'backward' ? i - 1 : 0;
    this.pushCmd(moveLayer(d, i, to), true);
  }
  active(): Layer | undefined { return this.doc ? activeLayer(this.doc) : undefined; }
  activeIndex(): number { return this.doc ? indexOfLayer(this.doc, this.doc.activeId) : -1; }
  toggleLock(): void {
    const d = this.doc, l = this.active();
    if (!d || !l) return;
    this.pushCmd(setLayerProps(d, l.id, { locked: !l.locked }, l.locked ? 'Unlock layer' : 'Lock layer'));
  }
  toggleHidden(): void { const l = this.active(); if (l) this.toggleVisible(l.id); }
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
    this.renderProps();
    this.syncChrome();
  }
  mergeDownAction(): void { const d = this.doc; if (d) this.pushCmd(mergeDown(d), true); }
  mergeVisibleAction(): void { const d = this.doc; if (d) this.pushCmd(mergeVisible(d), true); }
  flattenAction(): void { const d = this.doc; if (d) this.pushCmd(flattenDocument(d, parseHex(this.bgColor) ?? WHITE), true); }
  turnLayerAction(t: Turn): void {
    const d = this.doc, l = this.active();
    if (!d || !l || !this.editable(l)) return;
    const old = layerRect(l), cmd = turnLayer(d, t);
    this.pushCmd(cmd);
    this.markDirty(union(old, layerRect(l)));
  }
  turnCanvas(t: Turn): void {
    const d = this.doc;
    if (!d) return;
    this.cancelSession();
    this.hole = null;
    this.pushCmd(turnDocument(d, t), true);
    this.updateAnts();
    this.fit();
  }
  trim(): void {
    const d = this.doc;
    if (!d) return;
    const cmd = trimDocument(d);
    if (!cmd) { this.toast('There are no empty edges to cut away.'); return; }
    this.hole = null;
    this.pushCmd(cmd, true);
    this.fit();
    this.toast(`Trimmed to ${d.width} × ${d.height} px.`);
  }
  revealAllAction(): void {
    const d = this.doc;
    if (!d) return;
    const cmd = revealAll(d);
    if (!cmd) { this.toast('Every layer already fits inside the canvas.'); return; }
    this.pushCmd(cmd, true);
    this.fit();
  }
  /** Pixels of one layer inside a document area (outside the layer is see-through), masked by a soft selection. */
  private readArea(l: Layer | null, area: Rect): Uint8ClampedArray {
    const d = this.doc as Doc;
    const out = l ? new Uint8ClampedArray(area.w * area.h * 4) : compositeDoc(d, area);
    if (l) {
      for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
        const lx = area.x + x - l.x, ly = area.y + y - l.y;
        if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) continue;
        const j = (ly * l.width + lx) * 4, i = (y * area.w + x) * 4;
        out[i] = l.data[j]; out[i + 1] = l.data[j + 1]; out[i + 2] = l.data[j + 2]; out[i + 3] = l.data[j + 3];
      }
    }
    const s = d.selection;
    if (s?.alpha) for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) out[(y * area.w + x) * 4 + 3] *= selectionAlpha(s, area.x + x, area.y + y) / 255;
    return out;
  }
  copy(merged: boolean, cut: boolean): void {
    const d = this.doc, l = this.active();
    if (!d || !l) return this.needDoc();
    const area = d.selection ? intersect(d.selection, docRect(d)) : merged ? docRect(d) : intersect(layerRect(l), docRect(d));
    if (!area) { this.toast('There is nothing to copy here.'); return; }
    if (cut && !this.editable(l)) return;
    this.clip = { width: area.w, height: area.h, data: this.readArea(merged ? null : l, area), x: area.x, y: area.y, serial: ++clipSerial };
    if (cut) this.pushCmd(clearSelection(d, l), true);
    this.toast(cut ? 'Cut. Paste puts it on a new layer.' : 'Copied. Paste puts it on a new layer.');
    try {
      const c = document.createElement('canvas');
      c.width = area.w; c.height = area.h;
      c.getContext('2d')?.putImageData(toImageData({ width: area.w, height: area.h, data: this.clip.data }), 0, 0);
      c.toBlob((b) => { if (b && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => undefined); });
    } catch { /* the in-editor clipboard still works */ }
  }
  paste(inPlace: boolean): void {
    const d = this.doc, c = this.clip;
    if (!d || !c) return;
    const x = inPlace ? c.x : Math.round((d.width - c.width) / 2), y = inPlace ? c.y : Math.round((d.height - c.height) / 2);
    this.pushCmd(addLayer(d, createLayer(nextLayerName(d), c.width, c.height, { data: c.data.slice(), x, y }), indexOfLayer(d, d.activeId) + 1, 'Paste'), true);
  }
  layerVia(cut: boolean): void {
    const d = this.doc, l = this.active();
    if (!d || !l) return;
    if (!d.selection) { this.duplicateLayerAction(); return; }
    const area = intersect(d.selection, docRect(d));
    if (!area || (cut && !this.editable(l))) return;
    const data = this.readArea(l, area);
    const clear = cut ? clearSelection(d, l) : null;
    const add = addLayer(d, createLayer(nextLayerName(d), area.w, area.h, { data, x: area.x, y: area.y }), indexOfLayer(d, l.id) + 1, cut ? 'Layer via cut' : 'Layer via copy');
    this.pushCmd(combine(cut ? 'Layer via cut' : 'Layer via copy', [clear, add]), true);
  }
  private needDoc(): void { this.toast('Open or create a picture first.'); }

  // ---------- adjustments and filters, with a live preview ----------
  async openAdjust(id: string, preset?: JobParams, instant = false): Promise<void> {
    const def = ADJ[id], r = BY_ID.get(id), d = this.doc;
    if (!def || !r) return;
    if (!d) return this.needDoc();
    if (this.stroke) return;
    this.cancelSession();
    const l = activeLayer(d);
    if (!l || !this.editable(l)) return;
    const reg = editRegion(d, l);
    if (!reg) { this.toast('The selected area is outside this layer.'); return; }
    const params: JobParams = {};
    for (const c of def.controls) params[c.key] = preset?.[c.key] ?? c.value;
    const spec: JobSpec = { op: def.op, kind: def.kind, params };
    const maxR = def.controls.find((c) => c.key === 'radius')?.max ?? 1;
    const padded = paddedRegion(l, reg, jobPadding({ op: def.op, kind: def.kind, params: { radius: maxR } }));
    const before = readRegion(l, reg), hist = new Uint32Array(256);
    for (let i = 0; i < before.length; i += 4) if (before[i + 3]) hist[Math.round(luma(before[i], before[i + 1], before[i + 2]))]++;
    this.session = { id, def, label: r.plain, spec, layerId: l.id, r: reg, padded, source: readRegion(l, padded), before, hist, running: null, queued: false, ran: false };
    this.preview();
    if (def.instant || instant) { await this.applySession(); return; }
    this.renderDialog();
  }
  runLastFilter(): void { const f = this.lastFilter; if (f) void this.openAdjust(f.id, f.params, true); }
  private renderDialog(): void {
    const s = this.session, dlg = this.dlgEl;
    if (!s || s.def.instant) { dlg.hidden = true; dlg.replaceChildren(); this.dlgCanvas = null; return; }
    const r = BY_ID.get(s.id) as Row, params = (s.spec.params ??= {}), id = `fpe-${this.uid}-a`;
    const kids: Node[] = [h('div', { class: 'fpe-dlg-head' }, h('h2', { class: 'fpe-dlg-title' }, this.names(r.plain, r.pro)),
      iconButton('close', 'Cancel', { class: 'fpe-btn fpe-icon-btn', onclick: () => this.cancelSession() })),
      h('p', { class: 'fpe-note' }, `${r.help} It changes ${this.doc?.selection ? 'the selected area of' : 'all of'} the active layer; the picture updates as you move the sliders.`)];
    this.dlgCanvas = null;
    if (s.id === 'image.adj-levels' || s.id === 'image.adj-curves') {
      this.dlgCanvas = h('canvas', { class: 'fpe-histo', width: 256, height: 96, 'aria-label': 'Graph of dark to light tones in the picture', 'data-testid': 'adj-graph' });
      kids.push(this.dlgCanvas);
    }
    let group = '';
    for (const c of s.def.controls) {
      if (c.group && c.group !== group) { group = c.group; kids.push(h('h3', { class: 'fpe-group-title' }, group)); }
      const cid = id + c.key;
      if (c.type === 'select') {
        const sel = h('select', { id: cid, 'data-testid': 'ctl-' + c.key }, ...(c.options ?? []).map((o, k) => h('option', { value: k, selected: k === params[c.key] }, o)));
        sel.addEventListener('change', () => { params[c.key] = Number(sel.value); this.preview(); });
        kids.push(h('div', { class: 'fpe-row', 'data-help-title': c.label, 'data-help': c.help }, h('label', { for: cid }, c.label), sel));
      } else if (c.type === 'check') {
        const cb = h('input', { id: cid, type: 'checkbox', checked: !!params[c.key], 'data-testid': 'ctl-' + c.key });
        cb.addEventListener('change', () => { params[c.key] = cb.checked ? 1 : 0; this.preview(); });
        kids.push(h('div', { class: 'fpe-check', 'data-help-title': c.label, 'data-help': c.help }, cb, h('label', { for: cid }, c.label)));
      } else {
        const val = Number(params[c.key] ?? c.value), unit = c.unit ?? '';
        const out = h('output', { class: 'fpe-out', for: cid }, fmtNum(val) + unit);
        const inp = h('input', { id: cid, type: 'range', min: c.min ?? 0, max: c.max ?? 100, step: c.step ?? 1, value: val, 'data-testid': 'ctl-' + c.key });
        inp.addEventListener('input', () => { const v = Number(inp.value); params[c.key] = v; out.textContent = fmtNum(v) + unit; this.preview(); this.drawGraph(); });
        kids.push(this.field(cid, c.label, c.help, inp, out));
      }
    }
    kids.push(h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'adj-reset', onclick: () => this.resetSession() }, 'Reset'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'adj-cancel', onclick: () => this.cancelSession() }, 'Cancel'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'adj-apply', onclick: () => void this.applySession() }, icon('check'), 'Apply')));
    dlg.replaceChildren(...kids);
    dlg.setAttribute('aria-label', r.plain);
    dlg.hidden = false;
    this.drawGraph();
    requestAnimationFrame(() => dlg.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true }));
  }
  private drawGraph(): void {
    const c = this.dlgCanvas, s = this.session, ctx = c?.getContext('2d');
    if (!c || !s || !ctx) return;
    const W = c.width, H = c.height, max = Math.max(1, ...s.hist), p = s.spec.params ?? {};
    ctx.fillStyle = this.rulerInk.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.rulerInk.fg;
    for (let t = 0; t < 256; t++) { const bh = Math.sqrt(s.hist[t] / max) * (H - 4); ctx.fillRect(t, H - bh, 1, bh); }
    const lut = s.id === 'image.adj-curves' ? curveLut([p.p0 ?? 0, p.p1 ?? 64, p.p2 ?? 128, p.p3 ?? 192, p.p4 ?? 255])
      : levelsLut(p.inB ?? 0, p.gamma ?? 1, p.inW ?? 255, p.outB ?? 0, p.outW ?? 255);
    ctx.strokeStyle = this.rulerInk.ac;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let t = 0; t < 256; t++) { const y = H - 2 - (lut[t] / 255) * (H - 4); if (t) ctx.lineTo(t, y); else ctx.moveTo(t, y); }
    ctx.stroke();
  }
  private resetSession(): void {
    const s = this.session;
    if (!s) return;
    for (const c of s.def.controls) (s.spec.params ??= {})[c.key] = c.value;
    this.renderDialog();
    this.preview();
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
      commitResult(d, l, s.r, s.before, innerOf(res, s.padded, s.r), s.label);
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
    this.renderDialog();
    if (s.ran) {
      this.history.push(pixelCommand(s.label, s.layerId, s.r, s.before));
      if (s.id.startsWith('filter.')) this.lastFilter = { id: s.id, params: { ...s.spec.params } };
      this.afterEdit();
      this.toast(`${s.label}: done.`);
    }
  }
  private cancelSession(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    const l = this.doc ? findLayer(this.doc, s.layerId) : undefined;
    if (l && s.ran) { writeRegion(l, s.r, s.before); this.markDirty({ x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h }); this.requestRender(); }
    this.renderDialog();
  }

  // ---------- dialogs ----------
  openModal(id: string): void {
    const s = this.sheets.get(id);
    if (!s) return;
    if (id === 'size' || id === 'canvas' || id === 'rename') { if (!this.doc) return this.needDoc(); this.renderForm(id); }
    if (id === 'menu') this.renderMenuSheet(null);
    this.closePopover();
    this.closeMenus();
    this.hideTip();
    if (this.modal && this.modal !== id) this.closeModal(false);
    else if (!this.modal) this.modalReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modal = id;
    s.dataset.state = 'open';
    s.inert = false;
    this.shell.inert = true;
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
    this.shell.inert = false;
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
  private renderForm(id: 'size' | 'canvas' | 'rename'): void {
    const body = this.sheets.get(id)?.querySelector('.fpe-sheet-body > .fpe-stack') as HTMLElement | null, d = this.doc;
    if (!body || !d) return;
    const fid = `fpe-${this.uid}-f${id}`;
    const num = (key: string, label: string, value: number, help: string): HTMLInputElement =>
      h('input', { id: fid + key, type: 'number', min: 1, max: 16384, value, inputmode: 'numeric', 'data-testid': `${id}-${key}`, 'aria-label': label, 'data-help-title': label, 'data-help': help });
    const actions = (label: string, go: () => void): HTMLElement => h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', onclick: () => this.closeModal() }, 'Cancel'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': `${id}-apply`, onclick: go }, label));
    if (id === 'rename') {
      const l = this.active();
      const inp = h('input', { id: fid + 'n', type: 'text', value: l?.name ?? '', maxlength: 100, autocomplete: 'off', 'data-testid': 'rename-input', 'data-autofocus': '' });
      const go = (): void => { const v = inp.value.trim(); if (l && v && v !== l.name) this.pushCmd(setLayerProps(d, l.id, { name: v })); this.closeModal(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      body.replaceChildren(h('div', { class: 'fpe-row' }, h('label', { for: fid + 'n' }, 'New name'), inp), actions('Rename', go));
      return;
    }
    const w = num('w', 'Width in pixels', d.width, 'How wide the picture will be.'), hh = num('h', 'Height in pixels', d.height, 'How tall the picture will be.');
    const keep = h('input', { id: fid + 'k', type: 'checkbox', checked: true, 'data-testid': `${id}-keep` });
    const link = (from: HTMLInputElement, to: HTMLInputElement, a: number, b: number): void => from.addEventListener('input', () => {
      if (keep.checked && id === 'size') to.value = String(Math.max(1, Math.round((Number(from.value) * b) / a)));
    });
    link(w, hh, d.width, d.height);
    link(hh, w, d.height, d.width);
    const rows: Node[] = [h('p', { class: 'fpe-note' }, id === 'size' ? `Now ${d.width} × ${d.height} px. The picture is redrawn to the new size.`
      : `Now ${d.width} × ${d.height} px. The picture keeps its size; space is added or cut around it.`),
      h('div', { class: 'fpe-row' }, h('label', { for: fid + 'w' }, 'Width (px)'), w), h('div', { class: 'fpe-row' }, h('label', { for: fid + 'h' }, 'Height (px)'), hh)];
    if (id === 'size') {
      const mode = h('select', { id: fid + 'm', 'data-testid': 'size-mode' }, h('option', { value: 'smooth' }, 'Smooth (photos)'), h('option', { value: 'pixel' }, 'Hard pixels (pixel art)'));
      const presets = h('div', { class: 'fpe-chips' }, ...([['Half', 0.5], ['1080 wide', 1080 / d.width], ['1920 wide', 1920 / d.width], ['Double', 2]] as const).map(([label, k]) =>
        h('button', { type: 'button', class: 'fpe-chip', onclick: () => { w.value = String(Math.max(1, Math.round(d.width * k))); hh.value = String(Math.max(1, Math.round(d.height * k))); } }, label)));
      rows.unshift(presets);
      rows.push(h('div', { class: 'fpe-check' }, keep, h('label', { for: fid + 'k' }, 'Keep the shape (width and height change together)')),
        h('div', { class: 'fpe-row', 'data-help-title': 'Quality', 'data-help': 'Smooth suits photos. Hard pixels keeps pixel art crisp.' }, h('label', { for: fid + 'm' }, 'Quality'), mode),
        actions('Resize', () => {
          const W = Math.round(Number(w.value)), H = Math.round(Number(hh.value));
          if (!(W >= 1 && H >= 1 && W <= 16384 && H <= 16384)) { this.toast('Width and height must be between 1 and 16384 pixels.'); return; }
          if (W * H > maxPixelsForDevice()) { this.toast('That size is too large for this device.'); return; }
          this.closeModal();
          this.cancelSession();
          this.hole = null;
          this.pushCmd(resizeDocument(d, W, H, mode.value as Resample), true);
          this.updateAnts();
          this.fit();
          this.toast(`Picture is now ${d.width} × ${d.height} px.`);
        }));
    } else {
      let ax = 0.5, ay = 0.5;
      const grid = h('div', { class: 'fpe-anchor', role: 'group', 'aria-label': 'Which side stays put' });
      const paint = (): void => { for (const b of grid.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.ax) === ax && Number(b.dataset.ay) === ay)); };
      for (const y of [0, 0.5, 1]) for (const x of [0, 0.5, 1]) {
        grid.append(h('button', { type: 'button', 'data-ax': x, 'data-ay': y, 'data-testid': `anchor-${x}-${y}`, 'aria-label': `Keep the picture ${y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} ${x === 0 ? 'left' : x === 1 ? 'right' : 'centre'}`,
          onclick: () => { ax = x; ay = y; paint(); } }));
      }
      paint();
      const fill = h('select', { id: fid + 'c', 'data-testid': 'canvas-fill' }, h('option', { value: 'none' }, 'See-through'), h('option', { value: 'bg' }, 'Second colour'),
        h('option', { value: 'white' }, 'White'), h('option', { value: 'black' }, 'Black'));
      rows.push(h('div', { class: 'fpe-row', 'data-help-title': 'Anchor', 'data-help': 'Pick the spot that stays put; new space is added on the other sides.' }, h('span', { class: 'fpe-label' }, 'Anchor'), grid),
        h('div', { class: 'fpe-row', 'data-help-title': 'New space', 'data-help': 'What the added space is filled with.' }, h('label', { for: fid + 'c' }, 'New space'), fill),
        actions('Change canvas', () => {
          const W = Math.round(Number(w.value)), H = Math.round(Number(hh.value));
          if (!(W >= 1 && H >= 1 && W <= 16384 && H <= 16384)) { this.toast('Width and height must be between 1 and 16384 pixels.'); return; }
          const f: RGBA | null = fill.value === 'bg' ? parseHex(this.bgColor) : fill.value === 'white' ? WHITE : fill.value === 'black' ? BLACK : null;
          this.closeModal();
          this.cancelSession();
          this.hole = null;
          this.pushCmd(resizeCanvas(d, W, H, ax, ay, f), true);
          this.updateAnts();
          this.fit();
          this.toast(`Canvas is now ${d.width} × ${d.height} px.`);
        }));
    }
    body.replaceChildren(...rows);
  }
  private openPop(pop: HTMLElement, at: HTMLElement | { x: number; y: number }): void {
    this.closePopover();
    this.hideTip();
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const all = [...pop.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"]):not(:disabled)')];
      const i = all.indexOf(document.activeElement as HTMLElement);
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
    pop.querySelector<HTMLElement>('button:not([aria-disabled="true"]):not(:disabled)')?.focus();
    setTimeout(() => document.addEventListener('pointerdown', this.outsidePop, true), 0);
  }
  private showPopover(items: PopItem[], at: HTMLElement | { x: number; y: number }): void {
    const pop = h('div', { class: 'fpe-pop', role: 'menu' }, ...items.map((it) => {
      const b = h('button', { type: 'button', class: 'fpe-btn', role: 'menuitem', 'aria-disabled': it.disabled ? 'true' : null, 'data-tipcmd': it.cmd ?? null }, it.label);
      b.addEventListener('click', () => { if (it.disabled) return; this.closePopover(); it.run(); });
      return b;
    }));
    this.openPop(pop, at);
  }
  private outsidePop = (e: Event): void => { if (this.popover && !this.popover.contains(e.target as Node)) this.closePopover(); };
  private closePopover(): void {
    if (!this.popover) return;
    this.popover.remove();
    this.popover = null;
    document.removeEventListener('pointerdown', this.outsidePop, true);
  }
  private contextMenu(x: number, y: number): void {
    if (!this.doc) return;
    this.showPopover(CONTEXT.map((id) => { const r = BY_ID.get(id) as Row; return { label: r.plain, cmd: id, disabled: !this.isEnabled(id), run: () => void this.run(id) }; }), { x, y });
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
    this.qualityRow = h('div', { class: 'fpe-row', 'data-help-title': 'Quality', 'data-help': 'Higher keeps more detail and makes a bigger file.' }, h('label', { for: id + 'q' }, 'Quality'), q, qOut);
    this.lossBox = h('div', { class: 'fpe-loss', 'data-testid': 'loss-warning', 'aria-live': 'polite' });
    this.exportGo = h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'export-go', onclick: () => void this.doExport() }, 'Export');
    return h('div', { class: 'fpe-stack' },
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'n' }, 'File name'), this.exportName),
      h('div', { class: 'fpe-field-col' }, h('span', { class: 'fpe-label' }, 'File type'), this.exportChips),
      this.qualityRow, this.lossBox,
      h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', onclick: () => this.closeModal() }, 'Cancel'), this.exportGo));
  }
  openExport(fmt?: ExportFormat): void {
    const d = this.doc;
    if (!d) return this.needDoc();
    if (this.session) { this.toast('Apply or cancel the adjustment first.'); return; }
    if (fmt) this.exportFormat = fmt;
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
      this.renderTabs();
      this.closeModal();
      this.toast(`Saved ${file} (${fmtBytes(blob.size)}).${note ? ' ' + note : ''}`);
    } catch (e) {
      this.toast(errText(e, "The file couldn't be made."));
    } finally {
      done();
      this.exportGo.disabled = false;
    }
  }
  async quickPng(): Promise<void> {
    const d = this.doc;
    if (!d) return;
    const done = this.busyAfter(100);
    try {
      const { blob } = await encodeDocument(d, 'png', 1);
      const file = baseName(this.name) + '.png';
      download(blob, file, this.root);
      this.savedId = this.history.stateId();
      this.renderTabs();
      this.toast(`Saved ${file} (${fmtBytes(blob.size)}).`);
    } catch (e) { this.toast(errText(e, "The file couldn't be made.")); } finally { done(); }
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
    for (const [v, label] of [['white', 'White'], ['transparent', 'See-through'], ['color', 'Colour']] as const) {
      seg.append(h('button', { type: 'button', 'data-bg': v, 'aria-pressed': String(v === 'white'), onclick: () => setBg(v) }, label));
    }
    const create = (): void => {
      const W = Math.round(Number(w.value)), H = Math.round(Number(hh.value));
      if (!(W >= 1 && H >= 1 && W <= 16384 && H <= 16384)) { this.toast('Width and height must be between 1 and 16384 pixels.'); return; }
      if (W * H > maxPixelsForDevice()) { this.toast('That size is too large for this device.'); return; }
      this.closeModal(false);
      this.addTab(createDocument(W, H, bg === 'transparent' ? null : bg === 'white' ? WHITE : parseHex(color.value) ?? WHITE), 'Untitled');
    };
    return h('div', { class: 'fpe-stack' },
      h('div', { class: 'fpe-chips' }, ...presets.map(([label, pw, ph]) =>
        h('button', { type: 'button', class: 'fpe-chip', onclick: () => { w.value = String(pw); hh.value = String(ph); } }, `${label} ${pw}×${ph}`))),
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'w' }, 'Width (px)'), w),
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'h' }, 'Height (px)'), hh),
      h('div', { class: 'fpe-row' }, h('span', { class: 'fpe-label' }, 'Background'), seg, color),
      h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', onclick: () => this.closeModal() }, 'Cancel'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'new-create', onclick: create }, 'Create')));
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
  private buildKeys(): HTMLElement {
    const rows: [string, string][] = ROWS.filter((r) => r.key && r.status === 'ready').map((r) => [keyText(r.key), r.plain === r.pro ? r.plain : `${r.plain} · ${r.pro}`]);
    rows.push(['[ and ]', 'Smaller or larger brush'], ['Space + drag', 'Move around the picture'], ['Arrow keys', 'Nudge the layer (Move tool)'],
      ['Enter, Esc', 'Apply or cancel a crop or adjustment'], ['Two-finger tap', 'Undo (touch)'], ['Three-finger tap', 'Redo (touch)']);
    return h('div', {}, h('p', { class: 'fpe-note' }, MAC ? 'On this Mac, ⌘ is Command, ⌥ is Option and ⇧ is Shift.' : 'On a Mac, Ctrl means Command.'),
      h('dl', { class: 'fpe-keys' }, ...rows.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])));
  }
  openLink(url: string): void { window.open(url, '_blank', 'noopener'); }

  // ---------- pictures and tabs ----------
  pickFile(asLayer: boolean): void { this.fileAsLayer = asLayer && !!this.doc; this.fileInput.click(); }
  openSample(): void { this.addTab(makeSample(), 'Sample photo'); this.toast('Sample photo opened: two layers, a landscape and a sun.'); }
  private stash(): void {
    const t = this.tabs[this.cur];
    if (!t || !this.doc) return;
    Object.assign(t, { doc: this.doc, history: this.history, name: this.name, savedId: this.savedId, view: this.view, fitted: this.fitted, lastSel: this.lastSel, hole: this.hole });
  }
  private load(i: number): void {
    this.cancelSession();
    this.stroke = null;
    this.drag = null;
    this.crop = null;
    const t = this.tabs[i];
    this.cur = t ? i : -1;
    if (t) Object.assign(this, { doc: t.doc, history: t.history, name: t.name, savedId: t.savedId, view: t.view, fitted: t.fitted, lastSel: t.lastSel, hole: t.hole });
    else Object.assign(this, { doc: null, history: new History(60, historyBytesForDevice()), name: 'image', savedId: 0, lastSel: null, hole: null, fitted: true });
    this.root.toggleAttribute('data-has-doc', !!this.doc);
    this.startEl.hidden = !!this.doc;
    this.rendW = -1;
    if (this.doc && this.fitted) this.fit();
    this.markAll();
    this.updateAnts();
    this.renderOptions();
    this.afterEdit();
  }
  private addTab(doc: Doc, name: string): void {
    this.stash();
    this.tabs.push({ doc, history: new History(60, historyBytesForDevice()), name, savedId: 0, view: { zoom: 1, panX: 0, panY: 0 }, fitted: true, lastSel: null, hole: null });
    this.load(this.tabs.length - 1);
  }
  private switchTab(i: number): void { if (i === this.cur) return; this.stash(); this.load(i); }
  async closeDoc(all: boolean): Promise<void> {
    if (!this.doc) return;
    this.stash();
    const targets = all ? this.tabs.map((_, i) => i) : [this.cur];
    const unsaved = targets.filter((i) => this.tabs[i].history.stateId() !== this.tabs[i].savedId).length;
    if (unsaved) {
      const a = await this.ask(all ? `Close every picture? ${unsaved} ${unsaved === 1 ? 'has' : 'have'} changes you have not exported.` : 'Close this picture? Changes you have not exported will be lost.',
        all ? 'Close all' : 'Close it', 'Keep editing');
      if (a !== 'primary') return;
    }
    if (all) this.tabs = []; else this.tabs.splice(this.cur, 1);
    this.load(Math.min(this.cur, this.tabs.length - 1));
  }
  duplicateDoc(): void {
    const d = this.doc;
    if (!d) return;
    this.addTab({ width: d.width, height: d.height, activeId: d.activeId, selection: null, layers: d.layers.map((l) => ({ ...l, data: l.data.slice() })) }, this.name + ' copy');
  }
  private renderTabs(): void {
    const el = this.tabsEl;
    el.replaceChildren(...this.tabs.map((t, i) => {
      const on = i === this.cur, hist = on ? this.history : t.history, saved = (on ? this.savedId : t.savedId) === hist.stateId(), name = on ? this.name : t.name;
      return h('div', { class: 'fpe-tab', role: 'tab', 'aria-selected': String(on), 'data-testid': 'doc-tab' },
        h('button', { type: 'button', class: 'fpe-tab-name', 'data-help-title': name, 'data-help': saved ? 'Everything in this picture is exported.' : 'This picture has changes you have not exported yet.',
          onclick: () => this.switchTab(i) }, name, saved ? null : h('span', { class: 'fpe-dirty', 'aria-label': 'not exported' }, ' •')),
        h('button', { type: 'button', class: 'fpe-tab-close', 'aria-label': 'Close ' + name, 'data-testid': 'doc-tab-close',
          onclick: () => { this.switchTab(i); void this.closeDoc(false); } }, icon('close')));
    }), this.cmdBtn('file.new', 'plus', null, { class: 'fpe-btn fpe-icon-btn fpe-tab-new', 'data-testid': 'doc-tab-new' }));
  }
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
          this.addTab(res.doc, baseName(name));
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
      this.addTab(documentFromBitmap(bmp), baseName(name));
    } catch (e) {
      this.toast(errText(e, "This file couldn't be opened."));
    } finally {
      done();
    }
  }
  private onPaste(e: ClipboardEvent): void {
    if (!this.isActive() || this.isTyping(document.activeElement)) return;
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); void this.openFile(f, f.name || 'pasted image', !!this.doc); return; }
    if (this.clip && this.doc) { e.preventDefault(); this.paste(false); }
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
      else if (this.menuOpen) this.closeMenus(true);
      else if (this.modal) this.closeModal();
      else if (this.session) this.cancelSession();
      else if (this.crop) { this.crop = null; this.renderOptions(); this.requestRender(); }
      else if (this.screen === 'focus') this.setScreen('standard');
      else if (this.layout === 'phone' && this.dockState !== 'closed') this.setDock('closed');
      else this.deselect();
      return;
    }
    if (this.menuOpen || this.modal || this.popover || this.isTyping(e.target as Element)) return;
    const onControl = e.target instanceof HTMLElement && /^(BUTTON|A|SUMMARY|SELECT|INPUT)$/.test(e.target.tagName);
    if (!mod && !e.altKey && !onControl) {
      if (k === ' ') { this.setSpace(true); e.preventDefault(); return; }
      if (k === 'Enter') { if (this.crop) this.applyCrop(); else if (this.session) void this.applySession(); return; }
      if (k.startsWith('Arrow') && this.tool === 'move' && this.doc) {
        e.preventDefault();
        const d = this.doc, l = activeLayer(d), n = e.shiftKey ? 10 : 1;
        if (!l || !this.editable(l)) return;
        const old = layerRect(l);
        const dx = k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, dy = k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0;
        this.pushCmd(setLayerProps(d, l.id, { x: l.x + dx, y: l.y + dy }, 'Move layer'));
        this.markDirty(union(old, layerRect(l)));
        return;
      }
    }
    if (!mod && !e.altKey && (k === '[' || k === ']')) {
      const b = this.paintOpts();
      b.size = clamp(Math.round(b.size * (k === ']' ? 1.15 : 1 / 1.15)) + (k === ']' ? 1 : -1), 1, 500);
      this.renderOptions();
      this.requestRender();
      return;
    }
    const combo = keyOf(e), id = KEYMAP.get(combo) ?? ALIASES[combo];
    if (!id || (onControl && !mod && (k === 'Enter' || k === ' '))) return;
    e.preventDefault();
    const r = BY_ID.get(id);
    if (r && r.status !== 'ready') { this.toast(`${r.plain} (${r.pro}) is planned for a later version.`); return; }
    if (this.session && id !== 'edit.undo') { this.toast('Apply or cancel the adjustment first.'); return; }
    void this.run(id);
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
  private infoOf(): DocInfo | null {
    const d = this.doc;
    if (!d) return null;
    return {
      width: d.width, height: d.height, active: indexOfLayer(d, d.activeId), canUndo: this.history.canUndo, canRedo: this.history.canRedo,
      zoom: this.view.zoom, tool: this.tool, layout: this.layout, selection: d.selection ? { x: d.selection.x, y: d.selection.y, w: d.selection.w, h: d.selection.h } : null,
      layers: d.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, x: l.x, y: l.y, width: l.width, height: l.height, locked: !!l.locked })),
    };
  }
  controller(): EditorController {
    return {
      destroy: () => this.destroy(),
      openFile: (f, n) => this.openFile(f, n ?? ((f as File).name || 'image')),
      newDocument: (w, hh, bg) => this.addTab(createDocument(w, hh, bg === null ? null : parseHex(bg ?? '#ffffff') ?? WHITE), 'Untitled'),
      getInfo: () => this.infoOf(),
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
      commands: () => ROWS.map((r) => {
        const hd = HANDLERS[r.id];
        return { id: r.id, status: r.status, kind: r.kind, enabled: this.isEnabled(r.id), checked: hd?.checked ? hd.checked(this) : null, handler: !!hd };
      }),
      run: (id) => this.run(id),
      state: () => {
        const e = this.history.entries();
        return {
          tabs: this.tabs.length, tab: this.cur, saved: !this.doc || this.history.stateId() === this.savedId, step: e.index, steps: e.labels.length,
          fg: this.brush.color, bg: this.bgColor, theme: this.root.dataset.theme, names: this.proNames, hints: this.hints, screen: this.screen, flags: { ...this.flags },
          hidden: [...this.hidden].sort(), folded: [...this.folded].sort(), dock: this.dockState, phonePanel: this.phonePanel, modal: this.modal,
          adjust: this.session?.id ?? null, clip: this.clip?.serial ?? null, lastSel: !!this.lastSel, lastFilter: this.lastFilter?.id ?? null, tool: this.tool,
          ratio: this.ratio, crop: this.crop, hole: this.hole, exportFormat: this.exportFormat, info: this.infoOf(),
        };
      },
      openSample: () => this.openSample(),
      setZoom: (z) => this.zoomTo(z),
      select: (x, y, w, hh) => { const d = this.doc; if (!d) return; this.lastSel = d.selection ?? this.lastSel; d.selection = { x, y, w, h: hh }; this.hole = null; this.afterSelection(); },
    };
  }
  private destroy(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.antsTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.thumbTimer);
    clearTimeout(this.navTimer);
    this.closePopover();
    this.closeMenus();
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
