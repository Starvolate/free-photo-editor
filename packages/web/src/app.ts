// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The editor. One DOM, laid out by CSS: from 768 px wide a professional workspace (menu bar, options bar, tool column
 * with flyouts, picture tabs, rulers, docked tabbed panels, status bar); below that a phone layout (top bar, bottom tool
 * bar, bottom sheets, the menu tree as a sheet). Menus, tools, panels, search, shortcuts and help lines all come from the
 * function map (registry.ts) and run through one handler table (commands.ts); every pixel change goes through the engine.
 */
import {
  APP_NAME, APP_VERSION, AUTHOR, AUTHOR_URL, BLACK, BLEND_GROUPS, BLEND_LABELS, EXPORT_FORMATS, FORMAT_INFO, History, SOURCE_URL, Stroke, WHITE, jobBands, resizeBitmap,
  activeLayer, addEmptyLayer, addLayer, clamp, clearSelection, commitResult, compositeDoc, createDocument, createLayer, cropDocument, curveLut,
  deleteLayer, docFacts, docRect, documentFromBitmap, duplicateActive, editRegion, fillSelection, findLayer, flatten, flattenDocument, indexOfLayer,
  innerOf, intersect, inverseSelection, isBlendMode, jobPadding, layerRect, levelsLut, lossReport, formatDef, formatLossReport, mergeDown, mergeVisible, moveLayer, nextLayerName,
  paddedRegion, parseHex, pixelCommand, propsCommand, addMask, applyMask, deleteMask, expandRect, featherReach, invertLayerMask,
  adjust, applyToLayer, maskAt, maskSummary, openMaskSurface, setMaskSettings, withMaskSurface, type MaskSurface, readRegion, rectFromPoints, resizeCanvas, revealAll, samplePixel,
  selectionAlpha, setLayerProps, toHex, trimDocument, turnDocument, turnLayer, union, writeRegion,
  type Bitmap, type BlendMode, type Command, type Doc, type DocFacts, type ExportFormat, type JobParams, type JobSpec, type Layer, type LayerProps,
  type RGBA, type Rect, type Resample, type Selection, type StrokePoint, type Turn,
} from '@free-photoeditor/core';
import { ADJ, DOCK_PANELS, HANDLERS, JOBS, TOOLS, type AdjDef, type Job, type ToolId } from './commands';
import { errText, fmtBytes, focusInSheet, h, icon, iconButton, type Attrs } from './dom';
import type { DpiPanel } from './export-dpi';
import type { LastChange } from './image-more';
import { holdsDpi, n2, printText } from './print-text';
import { ensureSprite } from './icons';
import { CanvasInput, type PointerInfo, type Pt } from './input';
import { OPEN_ACCEPT, baseName, download, encodeDocument, historyBytesForDevice, maxPixelsForDevice, readImageFile, scaleBitmap, toImageData, exportList, fmtInfo, multiKind } from './io';
import { HANDLES, type Guides } from './handles';
import { JobRunner, JobStopped } from './jobs';
import { NOTICES } from './notices';
import { AppShell, type AppOptions } from './offline';
import { Autosave, namesText, type OpenPicture, type SavedPicture } from './autosave';
import { BY_ID, KEEP_TOOLS, MENU_INFO, MENU_ITEMS, ROWS, TOOL_GROUPS, TOP_MENUS, placeText, search, type MenuEntry, type Row } from './registry';
import { Canvas2DRenderer, type Renderer, type View } from './renderer';
import css from './styles.css?inline';
import { layerAt as w3LayerAt, selectionOutline as w3Outline } from '@free-photoeditor/core';
import { addFolder, addNode, hasLayerFx, hasPixels, layerFxReach, layerFxReady, layerPixelsChanged, skipMissingLayerFx, bandRows, createAdjustLayer, createFillLayer, SLICE_PX, ancestors, arrangeNode, carriesLocked, effectiveBox, groupNode, isFolder, lockedInTree, mergeDownRefusal, moveNode, placeSpots, siblingAbove, spotsOf, StrokeCache, subtreeOf, toggleClip, ungroupNode, type Spot } from '@free-photoeditor/core';
// The screen may draw a layer without its effects for the moment the effects module takes to load (design 6).
skipMissingLayerFx(true);
import { TK_TOOLS } from './commands';
import type { AiKit } from './ai';
import type { ToolHost, ToolKit } from './toolkit';
import type { Ribbon } from './ribbon';

type Layout = 'phone' | 'tablet' | 'desktop';
type Answer = 'primary' | 'secondary' | 'cancel';
type Screen = 'standard' | 'focus';
type Flag = 'rulers' | 'grid' | 'extras';
type DockState = 'closed' | 'half' | 'full';
export interface MountOptions {
  theme?: 'dark' | 'light' | 'system'; standalone?: boolean;
  /** Works offline and installs like an app (offline.ts): the standalone page passes the build's sw.js. Off when left out. */
  app?: AppOptions;
  /** Keep safety copies of open pictures in this browser (autosave.ts). On unless false. */
  autosave?: boolean;
}
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
  /** How selected one picture pixel is, 0 to 255 (for tests). */
  selectionAt(x: number, y: number): number;
  exportFile(format: string, quality?: number, multi?: boolean, delay?: number): Promise<Blob>;
  /** Every function of the map with its status, for automation and tests. */
  commands(): CommandInfo[];
  /** Run a function of the map by id. False when it is Planned, unknown or not available right now. */
  run(id: string): Promise<boolean>;
  /** Automation only: run an on-device AI command by id even while its row is Planned, so tests keep that code proven. Resolves once its sheet is open. */
  aiCmd(id: string): Promise<void>;
  /** A fingerprint of the composited pixels of a picture rectangle, so tests can tell whether anything changed. */
  checksum(x: number, y: number, w: number, h: number): number;
  /** Everything a person could notice changing, as plain data. */
  state(): Record<string, unknown>;
  /** SHA-256 (hex) of the page's own flattened pixels, no background: the same bytes the command line and PSD previews get. */
  flatHash(): Promise<string>;
  /** Open the practice photo; a `scale` below 1 opens a smaller copy (256 / 960 is the one Make it bigger starts with). */
  openSample(scale?: number): void;
  setZoom(zoom: number): void;
  select(x: number, y: number, w: number, h: number): void;
  /** Offline, install and safety-copy status, for automation and tests. */
  appState(): Record<string, unknown>;
  /** Write the safety copies now. */
  saveNow(): Promise<void>;
}

interface Session {
  id: string; def: AdjDef; label: string; spec: JobSpec; layerId: string; r: Rect; padded: Rect; source: Uint8ClampedArray; before: Uint8ClampedArray;
  hist: Uint32Array; running: Promise<void> | null; queued: boolean; ran: boolean;
  /** The last finished preview (cut to `r`), and whether the dialog shows the picture as it was. */
  after: Uint8ClampedArray | null; showBefore: boolean;
  /** Below 1 on a big picture: the preview runs on a copy this many times smaller (`small`), and Apply runs again at full size. */
  scale: number; small: Uint8ClampedArray | null; applying: boolean;
}
interface Tab { doc: Doc; history: History; name: string; savedId: number; view: View; fitted: boolean; lastSel: Selection | null; hole: Rect | null; }
interface Clip { width: number; height: number; data: Uint8ClampedArray; x: number; y: number; serial: number; }
type Drag = { kind: 'select' | 'crop' | 'pick' | 'pan'; start: Pt } | { kind: 'move'; start: Pt; x: number; y: number; id: string; spots: Spot[] };
interface PopItem { label: string; run: () => void; disabled?: boolean; cmd?: string; }

/** Over this many pixels a filter previews on a smaller copy of about PREVIEW_PX pixels, so sliders stay quick; Apply works at full size. */
const PREVIEW_MAX = 2_000_000, PREVIEW_PX = 1_000_000;
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const keyText = (k: string): string => (MAC ? k.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : k);
const hexNum = (hex: string): number => { const c = parseHex(hex) ?? BLACK; return (c.r << 16) | (c.g << 8) | c.b; };
import { field as ctlField, fmtNum, renderControls } from './controls';
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
/** The new Planned functions (registry-union.ts) join search the first time someone types; if that load fails (offline before first use), the next keystroke tries again. */
let moreRows: Promise<void> | null = null, moreLoaded = false;
const loadMoreRows = (): Promise<void> => (moreRows ??= import('./registry-union').then(() => { moreLoaded = true; }, () => { moreRows = null; }));
const KEYMAP = new Map<string, string>();
for (const r of ROWS) if (r.key) KEYMAP.set(r.key, r.id);
const ALIASES: Record<string, string> = { 'Ctrl+Y': 'edit.redo', Backspace: 'edit.clear', 'Ctrl+Shift+=': 'view.zoom-in' };
const GROUP_ICON: Record<string, string> = {
  'Tools > Move': 'move', 'Tools > Select box': 'select', 'Tools > Lasso': 'lasso', 'Tools > Smart select': 'wand', 'Tools > Crop': 'crop',
  'Tools > Measure': 'pipette', 'Tools > Retouch': 'bandage', 'Tools > Paint': 'brush', 'Tools > Clone': 'stamp', 'Tools > History brush': 'history',
  'Tools > Erase': 'eraser', 'Tools > Fill': 'bucket', 'Tools > Soften': 'droplet', 'Tools > Light': 'dodge', 'Tools > Pen': 'pen', 'Tools > Text': 'type',
  'Tools > Path select': 'pointer', 'Tools > Shapes': 'shapes', 'Tools > Hand': 'hand', 'Tools > Zoom': 'zoom-in',
};
// The dock as cards (layout A, a-deep): column 1 Properties, History and the small Tone graph card; column 2 Layers and Learn
// as you go. A less-used panel (QUIET) keeps no tab at rest: it opens from View or its card's "..." menu.
const GROUPS: { id: string; panels: string[] }[] = [
  { id: 'props', panels: ['properties', 'adjustments', 'character', 'paragraph'] }, { id: 'history', panels: ['history'] },
  { id: 'nav', panels: ['histogram', 'navigator', 'info', 'color', 'swatches'] }, { id: 'layers', panels: ['layers', 'channels', 'paths'] }];
const QUIET = new Set(['character', 'paragraph', 'paths', 'info', 'color', 'swatches']);
/** Below 1400 px wide the dock is one card with these three tabs; the other panels open from its "..." menu or View. */
const VIEWS: [string, string][] = [['layers', 'Layers'], ['props', 'Properties'], ['history', 'History']];
const SWATCHES = ['#000000', '#3a3a3a', '#7a7a7a', '#b8b8b8', '#ffffff', '#e4572e', '#f3a712', '#f9e04b', '#9bc53d', '#2e9e5b', '#17bebb', '#2d7dd2',
  '#3d348b', '#8e44ad', '#d81e5b', '#ff8fab', '#7f5539', '#b08968', '#ddb892', '#ede0d4', '#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#6fffe9',
  '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff', '#590d22', '#a4133c', '#ff4d6d', '#ffb3c1', '#264653', '#e9c46a'];
const RATIOS: [string, number][] = [['Free', 0], ['Square 1:1', 1], ['Post 4:5', 0.8], ['Story 9:16', 9 / 16], ['Wide 16:9', 16 / 9]];
const SUGGEST = ['image.adj-brightness', 'image.auto-tone', 'tool.crop', 'image.size', 'image.adj-bw', 'filter.blur-gaussian', 'layer.new', 'file.export'];
const CONTEXT = ['edit.undo', 'edit.redo', 'select.all', 'select.none', 'select.inverse', 'edit.clear', 'image.crop', 'layer.new', 'layer.duplicate', 'view.fit'];
let counter = 0;
let clipSerial = 0;

/**
 * A practice photo drawn in code: sky, hills, a lake, a white frame, and a sun on its own layer that pokes past the edge.
 * `k` scales it: every pixel is drawn from the 960 x 640 plan, so 256 / 960 gives the same picture at 256 x 171.
 */
function makeSample(k = 1): Doc {
  const Ws = Math.round(960 * k), Hs = Math.round(640 * k), data = new Uint8ClampedArray(Ws * Hs * 4);
  for (let py = 0; py < Hs; py++) for (let px = 0; px < Ws; px++) {
    const W = 960, H = 640, F = 16, hz = 0.58 * H, x = (px + 0.5) / k - 0.5, y = (py + 0.5) / k - 0.5, i = (py * Ws + px) * 4;
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
  const doc = documentFromBitmap({ width: Ws, height: Hs, data });
  const S = Math.round(180 * k), sun = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dd = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2), a = dd < 0.8 ? 1 : dd < 1 ? (1 - dd) / 0.2 : 0, i = (y * S + x) * 4;
    sun[i] = 255; sun[i + 1] = 200 + 40 * Math.max(0, 1 - dd); sun[i + 2] = 110; sun[i + 3] = a * 255;
  }
  addLayer(doc, createLayer('Sun', S, S, { data: sun, x: Ws - S + Math.round(60 * k), y: Math.round(90 * k) }), 1, 'Sun');
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
  /** The Task ribbon (desktop only): its tab row and body are always in the shell; ribbon.ts fills them when it loads. */
  private ribbon: Ribbon | null = null;
  private ribbonLoad: Promise<void> | null = null;
  private tabRow!: HTMLElement;
  private ribbonEl!: HTMLElement;
  private topEl!: HTMLElement;
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
  private stat: Record<'zoom' | 'size' | 'space' | 'pos' | 'color' | 'sel' | 'hint' | 'layer' | 'saved', HTMLElement> = {} as Record<'zoom' | 'size' | 'space' | 'pos' | 'color' | 'sel' | 'hint' | 'layer' | 'saved', HTMLElement>;
  private startEl!: HTMLElement;
  private restoreEl!: HTMLElement;
  private installBody!: HTMLElement;
  private appShell!: AppShell;
  private saver!: Autosave;
  /** Pictures left by an editor window that closed or crashed, waiting for Restore or Discard. */
  private left: SavedPicture[] = [];
  private dropEl!: HTMLElement;
  private busyEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private scrim!: HTMLElement;
  private tipEl!: HTMLElement;
  private dlgEl!: HTMLElement;
  private dlgCanvas: HTMLCanvasElement | null = null;
  /** The develop sheet's redraw after each preview (its scopes). */
  private sheetHook: (() => void) | null = null;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private layerList!: HTMLElement;
  private layerProps!: HTMLElement;
  private layerTop!: HTMLElement;
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
  /** Export's DPI section, loaded when Export first opens (it is not needed on the first screen). */
  private dpiPanel: DpiPanel | null = null;
  private dpiHost!: HTMLElement;
  private dpiMod: Promise<typeof import('./export-dpi')> | null = null;
  /** export-dpi.ts once loaded: Picture size's DPI half builds from it. */
  private dpiLib: typeof import('./export-dpi') | null = null;
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
  /** Bands of a big redraw still to draw (design 3.3). */
  private pend: Rect[] = [];
  private raf = 0;
  private ants = 0;
  private antsTimer = 0;
  private toastTimer = 0;
  private histCount: HTMLElement | null = null;
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
  /** While a pixel stroke runs, the rows below the painted layer per tile, so a frame redraws only what changed (core composite.ts). */
  private strokeCache: StrokeCache | null = null;
  /** True while the active layer's mask (not its pixels) is what tools edit. View state, not an undo step. */
  private maskTarget = false;
  private maskSurf: MaskSurface | null = null;
  private drag: Drag | null = null;
  private crop: Rect | null = null;
  private hoverPt: Pt | null = null;
  private pointer: Pt | null = null;
  private space = false;
  private layout: Layout | null = null;
  private modal: string | null = null;
  private modalReturn: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  /** The body of the layer actions sheet (phones and tablets), refilled on each long press. */
  private layerActBody: HTMLElement | null = null;
  private session: Session | null = null;
  /** Per tab (each has its own History): the step the history brush paints back, by id; none means as opened. */
  private marks = new WeakMap<History, number>();
  /** While a filter works at full size: its Cancel, which Escape also presses. */
  private jobCancel: (() => void) | null = null;
  private hdrag: string | null = null;
  clip: Clip | null = null;
  lastSel: Selection | null = null;
  private hole: Rect | null = null;
  lastFilter: { id: string; params: JobParams } | null = null;
  /** The last filter or colour fix applied, for Soften the last change (image-more.ts). */
  lastChange: LastChange | null = null;
  /** Recorded steps (automate.ts): while recording, each command that ran, with a dialog's settings once applied. */
  onStep: ((id: string, p?: JobParams) => void) | null = null;
  proNames = false;
  hints = true;
  screen: Screen = 'standard';
  flags: Record<Flag, boolean> = { rulers: true, grid: false, extras: true };
  private hidden = new Set<string>();
  private folded = new Set<string>();
  /** Below 1400 px: the card the dock shows (layers, props, history or nav). */
  private dview = 'layers';
  private dswitch: HTMLElement | null = null;
  private learnEl: HTMLElement | null = null;
  /** The Tone graph card's body: the dock cards module draws its graph and its line. */
  private toneBody: HTMLElement | null = null;
  /** The dock's picture-only parts (Learn as you go, the Tone graph, a layer's names), loaded with the first picture. */
  private cards: typeof import('./dockcards') | null = null;
  private cardsLoad: Promise<void> | null = null;
  private groupActive = new Map<string, string>();
  private dockState: DockState = 'closed';
  private ptabs!: HTMLElement;
  private ptabsWrap!: HTMLElement;
  private stageSize = { w: 0, h: 0 };
  private dockRo!: ResizeObserver;
  private phonePanel = 'layers';
  private menuOpen: string | null = null;
  private menuStack: HTMLElement[] = [];
  private exportFormat = 'png';
  private exportMulti = false;
  private exportDelay = 100;
  private multiRow!: HTMLElement;
  private multiBox!: HTMLInputElement;
  private multiText!: HTMLElement;
  private delayRow!: HTMLElement;
  private optionsBody!: HTMLElement;
  private optionsResolve: ((v: boolean) => void) | null = null;
  private exportQuality = 0.92;
  private exportFacts: DocFacts | null = null;
  private askResolve: ((v: Answer) => void) | null = null;
  private fileAsLayer = false;
  private opacityStart: number | null = null;
  private rulerInk = { bg: '#212228', fg: '#a6a9b3', ac: '#86b7ff' };
  private ro: ResizeObserver;
  private stageRo: ResizeObserver;
  private off: (() => void)[] = [];
  /** True from a long press firing until the click that ends it (see longPress). */
  private liftEaten = false;
  tk: ToolKit | null = null;
  private tkLoad: Promise<ToolKit> | null = null;
  private aiLoad: Promise<AiKit> | null = null;
  private tkDown = false;
  autoPick = false;
  private olSel: Selection | null = null;
  private olSegs: Float32Array | null = null;

  constructor(host: HTMLElement, opts: MountOptions) {
    this.opts = opts;
    this.root = h('div', { class: 'fpe', 'data-theme': 'dark', 'data-tool': 'brush', 'data-screen': 'standard', 'data-names': 'plain', 'data-hints': 'on' });
    this.eatLift(this.root);
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
      const files = [...((e as DragEvent).dataTransfer?.files ?? [])];
      if (files.length) void this.openFiles(files, !!this.doc);
    });
    this.ro = new ResizeObserver(() => this.onRootResize());
    this.ro.observe(this.root);
    this.stageRo = new ResizeObserver(() => this.onStageResize());
    this.stageRo.observe(this.stage);
    this.dockRo = new ResizeObserver(() => { this.fitTabs(); this.ptabsCue(); });
    this.dockRo.observe(this.dock);
    this.onRootResize();
    this.onStageResize();
    this.setTool('brush');
    this.load(-1);
    this.initApp(opts);
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
    return ctlField(id, label, help, control, out);
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
    const top = this.topEl = h('header', { class: 'fpe-top' },
      iconButton('menu', 'Menu: every command', { class: 'fpe-btn fpe-icon-btn fpe-menu-btn', 'data-testid': 'btn-menu', onclick: () => this.openModal('menu') }),
      h('a', { class: 'fpe-brand', href: AUTHOR_URL, target: '_blank', rel: 'noopener', 'data-testid': 'brand', title: 'Free Photo Editor by Bhawesh Tibrewal: bhaweshtibrewal.com' },
        h('span', { class: 'fpe-brand-name' }, APP_NAME), h('span', { class: 'fpe-brand-by' }, 'by ' + AUTHOR)),
      this.menubar, h('span', { class: 'fpe-spacer' }),
      (this.busyEl = h('div', { class: 'fpe-busy', role: 'status', hidden: true }, h('span', { class: 'fpe-spinner', 'aria-hidden': 'true' }), 'Working…')),
      search, this.undoBtn, this.redoBtn, exp);
    this.optionsBar = h('div', { class: 'fpe-options', role: 'toolbar', 'aria-label': 'Tool options', 'data-testid': 'options' });
    this.optionsBar.addEventListener('scroll', () => this.cueOptions(), { passive: true });
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
    for (const k of ['zoom', 'size', 'space', 'pos', 'color', 'sel', 'hint', 'layer', 'saved'] as const) this.stat[k] = h('span', { class: 'fpe-stat fpe-stat-' + k, 'data-testid': 'status-' + k });
    this.stat.zoom = h('button', { type: 'button', class: 'fpe-stat fpe-stat-zoom', 'data-cmd': 'view.fit', 'data-testid': 'status-zoom', onclick: () => void this.run('view.fit') }, '100%');
    this.statusEl = h('footer', { class: 'fpe-status', 'data-testid': 'status' }, ...(['zoom', 'size', 'space', 'pos', 'color', 'sel', 'hint', 'layer', 'saved'] as const).map((k) => this.stat[k]));
    this.tabRow = h('nav', { class: 'fpe-rtabs', role: 'tablist', 'aria-label': 'Task tabs', 'data-testid': 'ribbon-tabs' });
    this.ribbonEl = h('section', { class: 'fpe-ribbon', 'aria-label': 'Ribbon', 'data-testid': 'ribbon' });
    this.shell = h('div', { class: 'fpe-shell' }, top, this.tabRow, this.ribbonEl, this.optionsBar, this.toolsBar, center, this.dock, this.statusEl);
    this.makeSheet('export', 'Export', this.buildExport());
    this.makeSheet('open-options', 'Open', this.optionsBody = h('div', { class: 'fpe-stack' }));
    this.makeSheet('new', 'New picture', this.buildNew());
    this.makeSheet('about', 'About Free Photo Editor', this.buildAbout());
    this.makeSheet('keys', 'Keyboard shortcuts', this.buildKeys());
    this.makeSheet('install', 'Install as an app', this.installBody = h('div', {}));
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
  /**
   * Press and hold (or right-click) runs `fn`. The click that ends a held press is swallowed by `eatLift` wherever it lands:
   * what the press opened (the layer actions sheet, a tool's flyout) now sits under the finger, and that click would run the
   * item under it and close the sheet (on a phone it ran "Add a mask", 13 Nov 2026).
   */
  private longPress(el: HTMLElement, fn: () => void): void {
    let t = 0, fired = false, down = false;
    const fire = (): void => { fired = true; if (down) this.liftEaten = true; fn(); };
    el.addEventListener('pointerdown', () => { fired = false; down = true; t = window.setTimeout(fire, 480); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => { clearTimeout(t); down = false; });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(t); if (!fired) fire(); });
  }
  /** Swallow the one click that ends a long press (see longPress). A new press, or 400 ms after the lift, clears it. */
  private eatLift(root: HTMLElement): void {
    let timer = 0;
    root.addEventListener('click', (e) => {
      // A keyboard click (detail 0) never ends a press.
      if (!this.liftEaten || e.detail === 0) return;
      this.liftEaten = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
    root.addEventListener('pointerdown', () => { this.liftEaten = false; clearTimeout(timer); }, true);
    const lift = (): void => { if (this.liftEaten) { clearTimeout(timer); timer = window.setTimeout(() => { this.liftEaten = false; }, 400); } };
    root.addEventListener('pointerup', lift, true);
    root.addEventListener('pointercancel', lift, true);
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
        'aria-label': `${first.plain} (${first.pro})${ready ? '' : ', planned'}`, 'aria-disabled': ready ? null : 'true', 'data-testid': 'tool-' + slug(g.path.slice(8)),
        'data-keep': rows.some((r) => KEEP_TOOLS.includes(r.id)) ? '' : null },
        icon(GROUP_ICON[g.path] ?? 'square'), h('span', { class: 'fpe-tool-name', 'aria-hidden': 'true' }, g.path.slice(8).split(' ')[0]),
        rows.length > 1 ? h('span', { class: 'fpe-tool-more', 'aria-hidden': 'true' }) : null);
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
    const qm = this.cmdBtn('select.quick-mask', 'scan', null, { class: 'fpe-tool', 'aria-pressed': 'false', 'data-testid': 'tool-quick-mask' });
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
    this.ptabs = ptabs;
    this.ptabsWrap = h('div', { class: 'fpe-ptabs-wrap' }, ptabs,
      h('span', { class: 'fpe-pcue fpe-pcue-l', 'aria-hidden': 'true' }, icon('chev-left')), h('span', { class: 'fpe-pcue fpe-pcue-r', 'aria-hidden': 'true' }, icon('chev-right')));
    ptabs.addEventListener('scroll', () => this.ptabsCue(), { passive: true });
    dock.append(h('div', { class: 'fpe-dock-phonehead' }, handle, h('div', { class: 'fpe-dock-phonebar' }, this.ptabsWrap,
      iconButton('close', 'Close panels', { class: 'fpe-btn fpe-icon-btn', 'data-testid': 'close-dock', onclick: () => this.setDock('closed') }))));
    // Two columns at 1400 px and wider; below that the columns fold away (display: contents) and one tab strip picks the card.
    const col1 = h('div', { class: 'fpe-dcol', 'data-testid': 'dock-col-1' }), col2 = h('div', { class: 'fpe-dcol', 'data-testid': 'dock-col-2' });
    const others = h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn fpe-gmore', 'aria-haspopup': 'menu', 'aria-label': 'More panels', 'data-testid': 'dview-more',
      'data-help-title': 'More panels', 'data-help': 'The tone graph, navigator, colours and the other panels. Pick one to show it here.' }, icon('more'));
    others.addEventListener('click', () => this.showPopover(GROUPS.flatMap((g) => g.panels).filter((p) => p !== 'layers' && p !== 'properties' && p !== 'history' && BY_ID.has('panel.' + p))
      .map((p) => this.panelItem(p)), others));
    this.dswitch = h('div', { class: 'fpe-dswitch', role: 'tablist', 'aria-label': 'Panels', 'data-testid': 'dock-views' }, ...VIEWS.map(([id, label]) =>
      h('button', { type: 'button', class: 'fpe-dview', role: 'tab', 'aria-selected': 'false', 'data-view': id, 'data-testid': 'dview-' + id,
        onclick: () => { this.dview = id; this.applyDock(); this.renderPanels(); } }, label)), others);
    for (const g of GROUPS) {
      const tabs = h('div', { class: 'fpe-gtabs', role: 'tablist' });
      const body = h('div', { class: 'fpe-gbody' });
      for (const pid of g.panels) {
        const r = BY_ID.get('panel.' + pid);
        if (!r) continue;
        const ok = r.status === 'ready';
        // A planned panel never has a tab at rest; it shows as planned in the card's "..." menu and in search.
        const t = h('button', { type: 'button', class: 'fpe-gtab', role: 'tab', 'aria-selected': 'false', 'data-cmd': r.id, 'data-tab': pid, 'data-testid': 'tab-' + pid, hidden: !ok },
          h('span', {}, r.plain));
        if (ok) { t.addEventListener('click', () => this.activateTab(g.id, pid)); body.append(this.panelBody(pid)); }
        tabs.append(t);
      }
      // The card's "..." menu: every panel of the card, so one without a tab at rest is one tap away, then folding the card.
      const names = g.panels.map((p) => BY_ID.get('panel.' + p)?.plain).filter(Boolean).join(', ');
      const more = h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn fpe-gmore', 'aria-haspopup': 'menu', 'aria-label': 'More in this card: ' + names, 'data-testid': 'gmore-' + g.id,
        'data-help-title': 'More in this card', 'data-help': names + '. Pick one to show it here.' }, icon('more'));
      more.addEventListener('click', () => this.showPopover([...g.panels.filter((p) => BY_ID.has('panel.' + p)).map((p) => this.panelItem(p)),
        { label: this.folded.has(g.id) ? 'Unfold this card' : 'Fold this card', run: () => this.toggleGroup(g.id) }], more));
      const steps = g.id === 'history' ? [this.histCount = h('span', { class: 'fpe-hist-count', 'data-testid': 'history-count' }),
        this.cmdBtn('edit.history-back', 'undo', null, { class: 'fpe-btn fpe-icon-btn fpe-hist-step', 'data-testid': 'history-back' }),
        this.cmdBtn('edit.history-forward', 'redo', null, { class: 'fpe-btn fpe-icon-btn fpe-hist-step', 'data-testid': 'history-forward' })] : [];
      const sec = h('section', { class: 'fpe-group', 'data-group': g.id, 'data-testid': 'group-' + g.id }, h('div', { class: 'fpe-ghead' }, tabs, ...steps, more), body);
      this.groupEls.set(g.id, sec);
      (g.id === 'layers' ? col2 : col1).append(sec);
    }
    this.learnEl = h('p', { class: 'fpe-learn-text', 'data-testid': 'learn-text' });
    col2.append(h('section', { class: 'fpe-learn', 'aria-label': 'Learn as you go', 'data-testid': 'learn-card' },
      h('h3', { class: 'fpe-learn-head' }, icon('idea'), 'Learn as you go'), this.learnEl));
    // With no picture the dock is hidden (the root has no data-has-doc) and the start screen takes the full width.
    dock.append(this.dswitch, col1, col2);
    this.applyDock();
  }
  private panelBody(pid: string): HTMLElement {
    const b = h('div', { class: 'fpe-pbody', 'data-panel': pid, 'data-testid': 'panel-' + pid });
    if (pid === 'layers') {
      this.layerList = h('ul', { class: 'fpe-layer-list', 'aria-label': 'Layers, top first', 'data-testid': 'layer-list' });
      this.layerProps = h('div', { class: 'fpe-props' });
      // As in the approved layout: Blend and Opacity on top, then the rows, then New, Mask, Copy and Delete with words and
      // More for the rest, then the name. The count sits beside the panel's title.
      this.layerTop = h('div', { class: 'fpe-layer-top', 'data-testid': 'layer-top' });
      const act = (cmd: string, ic: string, text: string, testid: string): HTMLButtonElement => {
        const btn = this.cmdBtn(cmd, ic, text, { 'data-testid': testid });
        btn.classList.replace('fpe-btn-ghost', 'fpe-layer-act');
        return btn;
      };
      const more = h('button', { type: 'button', class: 'fpe-btn fpe-layer-act', 'aria-haspopup': 'menu', 'data-testid': 'layer-more',
        'data-help-title': 'More layer actions', 'data-help': 'Add a picture as a layer, move up or down, merge, lock, folders and clipping.' },
        icon('chev-down'), h('span', { class: 'fpe-btn-text' }, 'More'));
      more.addEventListener('click', () => this.layerMore(more));
      b.append(this.layerTop, this.layerList, h('div', { class: 'fpe-layer-tools', role: 'toolbar', 'aria-label': 'Layer actions' },
        act('layer.new', 'plus', 'New', 'layer-add'), act('layer.mask-add', 'contrast', 'Mask', 'layer-mask-add'),
        act('layer.duplicate', 'copy', 'Copy', 'layer-duplicate'), act('layer.delete', 'trash', 'Delete', 'layer-delete'), more), this.layerProps);
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
    } else if (pid === 'histogram') {
      this.toneBody = b;
    } else if (pid === 'info') {
      this.infoBody = h('dl', { class: 'fpe-info', 'data-testid': 'info' });
      b.append(this.infoBody);
    }
    if (pid === 'character' || pid === 'paragraph' || pid === 'paths') {
      b.append(h('p', { class: 'fpe-note' }, pid === 'paths' ? 'Getting the outlines ready…' : 'Getting the text settings ready…'));
      void this.toolkit().then((tk) => tk.fillPanel(pid, b));
    }
    this.bodies.set(pid, b);
    return b;
  }
  private activateTab(group: string, pid: string): void {
    this.groupActive.set(group, pid);
    this.dview = group;
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
    const narrow = this.layout !== 'phone' && !this.root.hasAttribute('data-wide');
    const shownOf = (id: string): string[] => (GROUPS.find((g) => g.id === id)?.panels ?? []).filter((p) => BY_ID.get('panel.' + p)?.status === 'ready' && !this.hidden.has(p));
    if (!shownOf(this.dview).length) this.dview = ['layers', 'props', 'history', 'nav'].find((id) => shownOf(id).length) ?? 'layers';
    for (const g of GROUPS) {
      const sec = this.groupEls.get(g.id);
      if (!sec) continue;
      const shown = shownOf(g.id);
      let act = this.groupActive.get(g.id);
      if (!act || !shown.includes(act)) act = shown.find((p) => !QUIET.has(p)) ?? shown[0];
      if (act) this.groupActive.set(g.id, act);
      sec.hidden = !shown.length || (narrow && g.id !== this.dview);
      sec.toggleAttribute('data-folded', this.folded.has(g.id) && !narrow);
      let n = 0;
      for (const t of sec.querySelectorAll<HTMLElement>('[data-tab]')) {
        const p = t.dataset.tab as string;
        t.hidden = !shown.includes(p) || (QUIET.has(p) && p !== act);
        if (!t.hidden) n++;
        t.setAttribute('aria-selected', String(p === act));
      }
      sec.toggleAttribute('data-single', n < 2);
      for (const p of g.panels) this.bodies.get(p)?.toggleAttribute('data-active', p === act);
    }
    for (const b of this.dswitch?.querySelectorAll<HTMLElement>('[data-view]') ?? []) b.setAttribute('aria-selected', String(b.dataset.view === this.dview));
    this.fitTabs();
  }
  togglePanelShown(pid: string): void {
    if (this.layout === 'phone') { this.togglePhonePanel(pid); return; }
    if (!this.panelShown(pid)) { this.hidden.delete(pid); this.showPanelTab(pid); return; }
    this.hidden.add(pid);
    this.applyDock();
    this.renderPanels();
  }
  /** On screen now: a quiet panel only while it is its card's open tab; below 1400 px only the card the dock shows. */
  panelShown(pid: string): boolean {
    if (this.layout === 'phone') return this.dockState !== 'closed' && this.phonePanel === pid;
    const g = GROUPS.find((x) => x.panels.includes(pid));
    if (!g || this.hidden.has(pid)) return false;
    const on = this.groupActive.get(g.id) === pid;
    return this.root.hasAttribute('data-wide') ? !QUIET.has(pid) || on : this.dview === g.id && on;
  }
  resetWorkspace(): void {
    this.hidden.clear();
    this.folded = new Set();
    this.dview = 'layers';
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
    this.root.dataset.dock = state;
    this.dock.inert = this.layout === 'phone' && state === 'closed';
    const open = state !== 'closed';
    this.root.querySelector('[data-testid="btn-layers"]')?.setAttribute('aria-expanded', String(open && this.phonePanel === 'layers'));
    this.root.querySelector('[data-testid="btn-panels"]')?.setAttribute('aria-expanded', String(open && this.phonePanel !== 'layers'));
    if (open) this.renderPanels();
    if (open && this.layout === 'phone') this.revealPtab();
  }
  /** Desktop and tablet: each card's tabs stay one row. A tab that does not fit hides; the card's "..." menu still has it, and the open tab always stays. */
  private fitTabs(): void {
    if (!this.layout || this.layout === 'phone') return;
    for (const g of GROUPS) {
      const sec = this.groupEls.get(g.id), strip = sec?.querySelector<HTMLElement>('.fpe-gtabs');
      if (!sec || !strip) continue;
      const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab]')), act = this.groupActive.get(g.id);
      for (const t of tabs) t.removeAttribute('data-overflow');
      if (sec.hidden || !strip.clientWidth) continue;
      for (let i = tabs.length - 1; i >= 0 && strip.scrollWidth > strip.clientWidth + 1; i--) if (tabs[i].dataset.tab !== act && !tabs[i].hidden) tabs[i].setAttribute('data-overflow', '');
    }
  }
  /** Phone: marks which side of the panel tab strip has more tabs, so a fade and an arrow show at that edge. */
  private ptabsCue(): void {
    const s = this.ptabs, w = this.ptabsWrap;
    if (!s || !w) return;
    const max = s.scrollWidth - s.clientWidth, more = [s.scrollLeft > 1 ? 'left' : '', s.scrollLeft < max - 1 ? 'right' : ''].filter(Boolean).join(' ');
    if (more) w.dataset.more = more; else delete w.dataset.more;
  }
  /** Phone: scrolls only the panel tab strip (never the page) so the open tab is fully in view, clear of the edge cue. */
  private revealPtab(): void {
    const s = this.ptabs, t = s?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (s && t && s.clientWidth) {
      const a = t.getBoundingClientRect(), b = s.getBoundingClientRect(), pad = 36;
      if (a.left < b.left + pad) s.scrollLeft -= b.left + pad - a.left;
      else if (a.right > b.right - pad) s.scrollLeft += a.right - b.right + pad;
    }
    this.ptabsCue();
  }

  // ---------- the start screen: "What do you want to do?" ----------
  private buildStart(modal: boolean): HTMLElement {
    // The start screen shows the first eight jobs as a 4 x 2 grid that fits 1440 x 900; the sheet shows them all.
    const jobs = h('div', { class: 'fpe-jobs' }, ...(modal ? JOBS : JOBS.slice(0, 8)).map((j) => {
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
      modal ? null : (this.restoreEl = h('section', { class: 'fpe-restore', hidden: true, 'aria-label': 'Bring back your last pictures', 'data-testid': 'restore' })),
      modal ? null : h('h2', { class: 'fpe-start-title' }, 'What do you want to do?'),
      h('p', { class: 'fpe-start-sub' }, modal ? 'Pick a job. The editor opens the right tool and shows you where it lives.'
        : 'Pick a job and the editor opens the right tool, then shows you where it lives. Or open a photo, drop one here, or paste one.'),
      modal ? null : h('div', { class: 'fpe-start-actions' }, btn('file.open', 'open', 'Open a photo', true, 'start-open'),
        btn('file.sample', 'image', 'Try a sample photo', false, 'start-sample'), btn('file.new', 'file-plus', 'New blank picture', false, 'start-new')),
      jobs, modal ? null : h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost fpe-start-all', 'data-testid': 'start-all', onclick: () => this.openModal('start') },
        `See all ${JOBS.length} jobs`),
      modal ? null : h('p', { class: 'fpe-fine' }, 'Your pictures stay on this device. Nothing is uploaded.'));
  }
  showStart(): void { if (this.doc) this.openModal('start'); else this.startEl.querySelector<HTMLElement>('.fpe-job')?.focus(); }
  private async runJob(j: Job): Promise<void> {
    if (this.modal) this.closeModal(false);
    const opened = !this.doc;
    if (opened) this.openSample(j.sample);
    if (j.ratio) {
      await this.run('tool.crop');
      this.ratio = j.ratio;
      this.startRatioCrop();
    } else await this.run(j.cmd);
    this.highlight(j.cmd);
    if (opened && j.hint) this.toast(j.hint, 6000);
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
    const onRibbon = this.layout === 'desktop' && this.ribbon ? this.ribbon.reveal(id) : null;
    const el = onRibbon ?? (r.kind === 'tool' ? this.groupBtns.get(r.place) ?? null
      : this.layout === 'phone' ? this.root.querySelector<HTMLElement>('[data-testid="btn-menu"]') : this.menubar.querySelector<HTMLElement>(`[data-menu="${r.place.split(' > ')[0]}"]`));
    if (el) { el.setAttribute('data-pulse', ''); window.setTimeout(() => el.removeAttribute('data-pulse'), 2600); }
    if (r.kind === 'command') this.toast(`Find it again in ${this.placeOf(r)} › ${r.plain}`, 4000);
  }
  /** Where a command lives on this screen: its ribbon home on desktop, its menu path elsewhere. */
  private placeOf(r: Row): string {
    return (this.layout === 'desktop' && this.ribbon?.place(r.id)) || placeText(r.place);
  }

  // ---------- search that understands wishes ----------
  private buildSearch(): HTMLElement {
    const id = `fpe-${this.uid}-q`;
    this.searchInput = h('input', { id, type: 'search', placeholder: 'For example: make it brighter', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'search-input', 'data-autofocus': '' });
    this.searchList = h('ul', { class: 'fpe-results', role: 'listbox', 'aria-label': 'Matching commands', 'data-testid': 'search-results' });
    this.searchInput.addEventListener('input', () => {
      this.renderSearch();
      if (!moreLoaded) void loadMoreRows().then(() => { if (moreLoaded && this.searchInput.value.trim()) this.renderSearch(); });
    });
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
        // Where to find it again: every command, and a tool too when it is hovered on the ribbon (its home is a ribbon group).
        r && (r.kind === 'command' || el.closest('.fpe-ribbon, .fpe-rlist')) ? h('span', { class: 'fpe-tip-place' }, 'In ' + this.placeOf(r)) : null,
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
      // Tools and layer names have their own long press (variants, the layer actions sheet), so no tip there.
      if (!el || el.closest('.fpe-tool, .fpe-layer-name')) return;
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
    if (this.session?.applying) return false;
    const r = BY_ID.get(id);
    if (!r) return false;
    if (r.status !== 'ready') { this.toast(`${r.plain} (${r.pro}) is planned for a later version.`); return false; }
    const hd = HANDLERS[id];
    if (!hd) return false;
    if (!hd.enabled(this)) { this.toast(this.doc ? `${r.plain} is not available right now.` : 'Open or create a picture first.'); return false; }
    this.closeMenus();
    this.closePopover();
    await hd.run(this);
    this.onStep?.(id);
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
    const layout: Layout = w >= 1024 ? 'desktop' : w >= 768 ? 'tablet' : 'phone', wide = layout === 'desktop' && w >= 1400;
    if (wide !== this.root.hasAttribute('data-wide')) {
      this.root.toggleAttribute('data-wide', wide);
      if (layout === this.layout) { this.applyDock(); this.renderPanels(); }
    }
    if (layout === this.layout) return;
    this.layout = layout;
    this.root.dataset.layout = layout;
    this.root.toggleAttribute('data-ribbon', layout === 'desktop');
    if (layout === 'desktop') this.loadRibbon(); else this.ribbon?.setActive(false);
    this.closeMenus();
    this.closePopover();
    this.toolsBar.setAttribute('aria-orientation', layout === 'phone' ? 'horizontal' : 'vertical');
    this.setDock('closed');
    this.dock.inert = layout === 'phone';
    this.applyDock();
    this.renderOptions();
  }
  /** The Task ribbon loads the first time the screen is desktop-wide; if it cannot load (offline before it was cached), today's menu bar stays. */
  private loadRibbon(): void {
    if (this.ribbon) { this.ribbon.setActive(true); return; }
    this.ribbonLoad ??= import('./ribbon').then((m) => {
      let sample: Doc | null = null;
      this.ribbon = m.mountRibbon({ picture: () => this.doc ?? (sample ??= makeSample(0.15)), root: this.root, appBar: this.topEl, tabRow: this.tabRow, ribbon: this.ribbonEl, options: this.optionsBar, docTabs: this.tabsEl,
        toolId: () => Object.keys(TOOLS).find((k) => TOOLS[k] === this.tool) ?? null, run: (id) => this.run(id), enabled: (id) => this.isEnabled(id),
        sync: () => this.syncChrome(), keyText, toast: (msg) => this.toast(msg) });
      this.ribbon.setActive(this.layout === 'desktop');
    }, () => { this.ribbonLoad = null; if (!this.ribbon) this.root.removeAttribute('data-ribbon'); });
  }
  private onStageResize(): void {
    const W = this.stage.clientWidth, H = this.stage.clientHeight, was = this.stageSize, v = this.view;
    this.stageSize = { w: W, h: H };
    this.renderer.resize(W, H, window.devicePixelRatio || 1);
    if (this.doc && this.fitted) this.fit();
    // A zoomed view keeps the same spot in the middle when the space changes (a phone panel sheet opening, rulers on or off).
    else if (this.doc && was.w && was.h && W && H) this.setView({ zoom: v.zoom, panX: v.panX + (W - was.w) / 2, panY: v.panY + (H - was.h) / 2 });
    else this.requestRender();
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

  /** Keeps a picture rectangle, plus a margin of screen pixels round it, inside the picture area and clear of the zoom buttons. */
  fitBox(r: { x: number; y: number; w: number; h: number }, m: number): void {
    const v = this.view, zb = this.stage.querySelector('.fpe-zoom')?.getBoundingClientRect().height ?? 0;
    const W = this.stage.clientWidth, H = this.stage.clientHeight - (zb ? zb + 10 : 0);
    const z = clamp(Math.min((W - m * 2) / Math.max(1, r.w), (H - m * 2) / Math.max(1, r.h), v.zoom), 0.01, 16);
    // The smallest move that brings the box and its margin into view; centred on the box only when the view had to zoom out.
    const shift = (pan: number, a: number, size: number, room: number): number => {
      if (z !== v.zoom) return Math.round(room / 2 - (a + size / 2) * z);
      const lo = pan + a * z, hi = lo + size * z;
      return Math.round(lo < m ? pan + (m - lo) : hi > room - m ? pan - (hi - (room - m)) : pan);
    };
    const panX = shift(v.panX, r.x, r.w, W), panY = shift(v.panY, r.y, r.h, H);
    if (z === v.zoom && panX === v.panX && panY === v.panY) return;
    this.fitted = false;
    this.setView({ zoom: z, panX, panY });
  }

  // ---------- rendering ----------
  private markDirty(r: Rect | null): void {
    if (!r || !this.doc) return;
    let R = 0;
    for (const l of this.doc.layers) R = Math.max(R, layerFxReach(l));
    if (R) r = { x: r.x - R, y: r.y - R, w: r.w + 2 * R, h: r.h + 2 * R }; // effects reach past the changed pixels
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
  /** Split a redraw into bands: the ones in view first, then the rest; older bands inside it are dropped (it redraws them). */
  private queueBands(r: Rect): void {
    const rows = bandRows(r.w), v = this.view, top = -v.panY / v.zoom, bot = (this.stage.clientHeight - v.panY) / v.zoom, bands: Rect[] = [];
    for (let y = r.y; y < r.y + r.h; y += rows) bands.push({ x: r.x, y, w: r.w, h: Math.min(rows, r.y + r.h - y) });
    const seen = (b: Rect): boolean => b.y < bot && b.y + b.h > top;
    const inside = (b: Rect): boolean => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    this.pend = [...bands.filter(seen), ...bands.filter((b) => !seen(b)), ...this.pend.filter((b) => !inside(b))];
  }
  private renderNow(): void {
    this.raf = 0;
    const d = this.doc;
    if (d && (d.width !== this.rendW || d.height !== this.rendH)) {
      this.renderer.setDocumentSize(d.width, d.height);
      this.rendW = d.width; this.rendH = d.height;
      this.dirty = docRect(d);
      this.pend = [];
    } else if (!d && this.rendW) { this.renderer.setDocumentSize(0, 0); this.rendW = 0; this.rendH = 0; this.pend = []; }
    if (d && !layerFxReady() && d.layers.some(hasLayerFx)) void this.layerFx();
    if (d && this.dirty) {
      const r = this.dirty;
      this.dirty = null;
      if (this.strokeCache) this.renderer.upload(r, this.strokeCache.composite(r));
      else if (r.w * r.h <= SLICE_PX && !this.pend.length) this.renderer.upload(r, compositeDoc(d, r));
      else this.queueBands(r);
    }
    if (d && this.pend.length) {
      const t0 = performance.now();
      do { const b = this.pend.shift() as Rect; this.renderer.upload(b, compositeDoc(d, b)); } while (this.pend.length && performance.now() - t0 < 12);
      if (this.pend.length) this.requestRender();
    }
    const t = this.tool, z = this.view.zoom, o = t === 'eraser' ? this.eraser : t === 'pencil' ? this.pencil : this.brush;
    const tks = this.tk?.cursorSize(t) ?? null;
    const cursor = this.hoverPt && d && (t === 'brush' || t === 'eraser' || t === 'pencil' || tks) ? { x: this.hoverPt.x, y: this.hoverPt.y, r: ((tks ?? o.size) / 2) * z } : null;
    this.renderer.render(this.view, { selection: d && this.flags.extras ? d.selection : null, hole: d && this.flags.extras ? this.hole : null,
      crop: t === 'crop' ? this.crop : null, cursor, ants: this.ants, grid: d && this.flags.grid ? this.gridSize() : 0, guides: this.sessionGuides(),
      outline: d && this.flags.extras && d.selection?.alpha ? this.outline(d.selection) : null, draw: this.tk ? (ctx) => this.tk?.overlay(ctx) : null });
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
      ctx.strokeStyle = ink.fg; ctx.fillStyle = ink.fg; ctx.lineWidth = 1; ctx.font = '12px system-ui, sans-serif';
      ctx.beginPath();
      for (let u = start; u <= end; u += minor) {
        const p = Math.round(pan + u * z) + 0.5, major = Math.abs(u / step - Math.round(u / step)) < 1e-6, t = major ? depth : depth * 0.3;
        if (horiz) { ctx.moveTo(p, hh); ctx.lineTo(p, hh - t); } else { ctx.moveTo(w, p); ctx.lineTo(w - t, p); }
        if (major) {
          if (horiz) ctx.fillText(String(Math.round(u)), p + 3, 12);
          else { ctx.save(); ctx.translate(12, p + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(u)), 0, 0); ctx.restore(); }
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
    const r = BY_ID.get(Object.keys(TOOLS).find((k) => TOOLS[k] === this.tool) ?? ''), act = this.tk?.activity() ?? null;
    const tip = act ? `${act.plain}: ${act.help}` : r ? `${r.plain}: ${r.help}` : '', ml = d ? activeLayer(d) : undefined;
    // While the mask is the target the status line says so first, in plain words (design 6), then the tool's own line.
    s.hint.textContent = ml && this.onMask(ml) ? `Editing the mask of ${ml.name}: black hides, white shows, grey half shows. ${tip}` : tip;
    s.space.textContent = d ? 'sRGB · 8 bits a channel' : '';
    const c = d && p ? samplePixel(d, p.x, p.y) : null, hex = c ? toHex(c).toUpperCase() : '', key = c ? `${hex} ${c.r} ${c.g} ${c.b}` : '';
    if (s.color.dataset.k !== key) {
      s.color.dataset.k = key;
      s.color.replaceChildren(...(c ? [h('i', { class: 'fpe-stat-sw', style: 'background:' + hex }), `Under the pointer ${hex} · R ${c.r} G ${c.g} B ${c.b}`] : []));
    }
    const n = ml && this.cards ? this.cards.layerNames(ml) : null;
    s.layer.textContent = n ? `${n.plain} · pros call it ${n.pro}` : '';
    s.saved.textContent = d ? (this.saver?.enabled ? 'Saved on this device' : 'Safety copies off') : '';
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
  private panelItem(pid: string): PopItem {
    const r = BY_ID.get('panel.' + pid), ok = r?.status === 'ready';
    return { label: (r?.plain ?? pid) + (ok ? '' : ' (planned)'), cmd: 'panel.' + pid, disabled: !ok, run: () => this.showPanelTab(pid) };
  }
  private renderLearn(): void {
    const d = this.doc;
    if (this.learnEl) this.cards?.renderLearn(this.learnEl, d ? activeLayer(d) : undefined);
  }
  private drawTone(px: Uint8ClampedArray | null): void {
    if (this.toneBody) this.cards?.drawTone(this.toneBody, px, this.rulerInk);
  }
  /** Loads the dock's picture-only parts with the first picture, then draws them. */
  private loadCards(): void {
    this.cardsLoad ??= import('./dockcards').then((m) => {
      this.cards = m;
      this.renderLearn();
      if (this.stat.hint) this.renderStatus();
      this.queueNav();
    }, () => { this.cardsLoad = null; });
  }
  private queueNav(): void { clearTimeout(this.navTimer); this.navTimer = window.setTimeout(() => this.drawNav(), 220); }
  private drawNav(): void {
    const c = this.navCanvas, ctx = c?.getContext('2d'), d = this.doc;
    if (!c || !ctx || !c.isConnected) return;
    // The navigator draws at twice its own size on screen, so the drawn picture and the pointer maths share one shape.
    const cw = Math.round(c.clientWidth * 2), ch = Math.round(c.clientHeight * 2);
    if (cw && ch && (c.width !== cw || c.height !== ch)) { c.width = cw; c.height = ch; }
    const W = c.width, H = c.height;
    ctx.fillStyle = this.rulerInk.bg;
    ctx.fillRect(0, 0, W, H);
    if (!d) { this.drawTone(null); return; }
    const k = Math.min(W / d.width, H / d.height), tw = Math.max(1, Math.round(d.width * k)), th = Math.max(1, Math.round(d.height * k));
    const ox = Math.round((W - tw) / 2), oy = Math.round((H - th) / 2), img = ctx.createImageData(tw, th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const dx = Math.floor(x / k), dy = Math.floor(y / k), i = (y * tw + x) * 4;
      let r = ((x >> 3) + (y >> 3)) & 1 ? 232 : 204, g = r, b = r;
      for (const l of d.layers) {
        if (!l.visible || (l.kind && l.kind !== 'pixel')) continue;
        const lx = dx - l.x, ly = dy - l.y;
        if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) continue;
        const j = (ly * l.width + lx) * 4, a = (l.data[j + 3] / 255) * l.opacity;
        r = l.data[j] * a + r * (1 - a); g = l.data[j + 1] * a + g * (1 - a); b = l.data[j + 2] * a + b * (1 - a);
      }
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, ox, oy);
    this.drawTone(img.data);
    const v = this.view;
    ctx.strokeStyle = this.rulerInk.ac;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + (-v.panX / v.zoom) * k, oy + (-v.panY / v.zoom) * k, (this.stage.clientWidth / v.zoom) * k, (this.stage.clientHeight / v.zoom) * k);
  }

  // ---------- W3 tools (toolkit.ts, loaded on first use) ----------
  toolkit(): Promise<ToolKit> {
    return (this.tkLoad ??= import('./toolkit').then((m) => {
      this.tk = m.createToolKit(this.toolHost());
      this.renderOptions();
      this.renderPanels();
      this.requestRender();
      return this.tk;
    }));
  }
  // ---------- W11 on-device AI (ai.ts and packages/ai, loaded on first use) ----------
  ai(): Promise<AiKit> { return (this.aiLoad ??= import('./ai').then((m) => m.createAiKit(this.toolHost()))); }
  private toolHost(): ToolHost {
    return {
      root: this.root, uid: this.uid, doc: () => this.doc, history: () => this.history, view: () => this.view, canvas: () => this.canvas, pointer: () => this.pointer,
      fg: () => this.brush.color, bg: () => this.bgColor, push: (c, all) => this.pushCmd(c, all), dirty: (r) => { this.markDirty(r); this.requestRender(); },
      all: () => { this.markAll(); this.requestRender(); }, render: () => this.requestRender(), selectionChanged: () => this.afterSelection(),
      refreshOptions: () => this.renderOptions(), toast: (m) => this.toast(m), editable: (l, px, om) => this.editable(l, px, om), onMask: (l) => this.onMask(l), setTool: (t) => this.setTool(t),
      tool: () => this.tool, sheet: (id, title, body) => this.toolSheet(id, title, body), closeSheet: () => this.closeModal(),
      slider: (a, b, c, d, e, f, g, k) => this.slider(a, b, c, d, e, f, g, k), panels: () => this.renderPanels(), layout: () => this.layout,
      forgetHole: () => { this.hole = null; }, rememberSel: (s) => { if (s) this.lastSel = s; }, showPanel: (pid) => this.showPanelTab(pid),
      paintFrom: () => this.marks.get(this.history) ?? 0, paintFromGone: () => this.paintFromGone(),
      paint: (t) => (t === 'eraser' ? this.eraser : t === 'pencil' ? this.pencil : this.brush), fitBox: (r, m) => this.fitBox(r, m),
      fitted: () => this.fitted, restoreView: (v, f) => { this.setView(v); this.fitted = f; },
      ai: () => this.ai(),
    };
  }
  private toolSheet(id: string, title: string, body: HTMLElement): void {
    if (!this.sheets.has(id)) { this.makeSheet(id, title, body); this.root.insertBefore(this.sheets.get(id) as HTMLElement, this.scrim); }
    const t = this.sheets.get(id)?.querySelector('.fpe-sheet-title');
    if (t) t.textContent = title;
    this.openModal(id);
  }
  private showPanelTab(pid: string): void {
    if (this.layout === 'phone') { this.setDock(this.dockState === 'closed' ? 'half' : this.dockState, pid); return; }
    const g = GROUPS.find((x) => x.panels.includes(pid));
    if (g) this.activateTab(g.id, pid);
  }
  private outline(s: Selection): Float32Array {
    if (this.olSel !== s) { this.olSel = s; this.olSegs = w3Outline(s); }
    return this.olSegs as Float32Array;
  }

  // ---------- tools ----------
  setTool(t: ToolId): void {
    if (this.stroke || this.drag) return;
    if (t !== 'crop') { this.crop = null; this.ratio = 0; }
    const prevTool = this.tool;
    this.tool = t;
    this.root.dataset.tool = t;
    if (prevTool !== t) { this.tk?.toolChanged(prevTool, t); this.ribbonTool = true; }
    if (TK_TOOLS.has(t) && !this.tk) void this.toolkit();
    const id = Object.keys(TOOLS).find((k) => TOOLS[k] === t);
    const r = id ? BY_ID.get(id) : undefined;
    if (r && id) {
      this.groupCur.set(r.place, id);
      const b = this.groupBtns.get(r.place);
      if (b) { b.dataset.cmd = id; b.setAttribute('aria-label', `${r.plain} (${r.pro})`); }
    }
    this.renderOptions();
    if (this.ribbonTool) { this.ribbonTool = false; this.ribbon?.toolChanged(); }
    this.syncChrome();
    this.requestRender();
  }
  /** Set when the tool changes, so the ribbon opens the new tool's options once they are built. */
  private ribbonTool = false;
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
  /** Tools that work on the mask pass `onMask`; every other pixel tool refuses while the mask is the target. */
  private editable(l: Layer, pixels = true, onMask = false): boolean {
    // A folder has no pixels of its own: painting refuses it; Move, X/Y, Align and Free transform carry everything inside.
    if (isFolder(l)) {
      if (pixels) { this.toast('This is a folder: pick a layer inside it.'); return false; }
      if (this.doc && carriesLocked(this.doc, l.id)) { this.toast('Something in this folder is locked: unlock it first.'); return false; }
      return true;
    }
    if ((l.kind === 'adjust' || l.kind === 'fill') && !(this.maskTarget && l.mask)) {
      this.toast(`${l.name} is ${l.kind === 'adjust' ? 'an editable light and colour layer' : 'a colour layer'} with no pixels of its own: change it in Properties, or pick a picture layer.`);
      return false;
    }
    const locked = this.doc ? lockedInTree(this.doc.layers, l) : !!l.locked;
    const mask = this.maskTarget && !!l.mask;
    if (pixels && mask && !onMask && !locked) {
      this.toast('You are editing the mask. Brush, pencil, eraser, Fill, Delete, Colour fade (Gradient) and Negative (Invert) work on it; for this one, click the picture thumbnail in the Layers panel to edit pixels.');
      return false;
    }
    if (pixels && !mask && l.content && !locked) {
      this.toast(`"${l.name}" is a ${l.content.kind === 'text' ? 'text' : 'shape'} layer: change it with its own tool, or choose Layer › Turn into plain pixels to paint on it.`);
      return false;
    }
    if (!locked) return true;
    this.toast(l.locked ? `"${l.name}" is locked. Unlock it in the Layers panel to change it.` : `"${l.name}" is in a locked folder. Unlock the folder in the Layers panel to change it.`);
    return false;
  }
  private toolStart(p: Pt, i: PointerInfo): void {
    this.pointer = p; // a touch has no hover before it, and the tool kit's claims read the pointer
    const d = this.doc;
    this.closePopover();
    this.closeMenus();
    if (!d) return;
    if (this.session && this.handleStart(p)) return;
    if (this.session) { this.toast('Apply or cancel the adjustment first.'); return; }
    if (this.tk?.claims(this.tool) || TK_TOOLS.has(this.tool)) {
      if (!this.tk) { this.toast('Getting the tool ready…'); void this.toolkit(); return; }
      this.tkDown = true;
      this.tk.start(p, i);
      return;
    }
    const t: ToolId = i.alt && (this.tool === 'brush' || this.tool === 'pencil') ? 'eyedropper' : this.tool;
    if (t === 'hand') { this.drag = { kind: 'pan', start: p }; return; }
    if (t === 'zoom') { this.fitted = false; this.zoomAt(i.alt ? 0.8 : 1.25, p.x * this.view.zoom + this.view.panX, p.y * this.view.zoom + this.view.panY); return; }
    if (t === 'brush' || t === 'eraser' || t === 'pencil') {
      const l = activeLayer(d);
      if (!l || !this.editable(l, true, true)) return;
      if (!l.visible) { this.toast('This layer is hidden. Show it to paint on it.'); return; }
      const o = this.paintOpts(), opts = { size: o.size, hardness: o.hardness, opacity: o.opacity, color: parseHex(this.brush.color) ?? BLACK, erase: t === 'eraser' };
      if (this.onMask(l)) { this.maskSurf = openMaskSurface(d, l); this.stroke = new Stroke(this.maskSurf.doc, this.maskSurf.layer, opts); }
      else { this.stroke = new Stroke(d, l, opts); this.strokeCache = new StrokeCache(d.layers, l); }
      this.stroke.add(this.strokePoint(p, i));
      this.flushStroke();
      return;
    }
    if (t === 'move') {
      if (this.autoPick) { const hit = w3LayerAt(d, p.x, p.y); if (hit && hit.id !== d.activeId) this.selectLayer(hit.id); }
      const l = activeLayer(d);
      if (l && this.editable(l, false)) this.drag = { kind: 'move', start: p, x: l.x, y: l.y, id: l.id, spots: spotsOf(d, l.id) };
      return;
    }
    if (t === 'eyedropper') { this.drag = { kind: 'pick', start: p }; this.pick(p); return; }
    this.drag = { kind: t as 'select' | 'crop', start: this.clampPt(p) };
    if (t === 'crop') this.crop = null; else { d.selection = null; this.hole = null; }
    this.updateAnts();
    this.requestRender();
  }
  /** The edited box of the open filter dialog, in picture pixels. */
  private sessionBox(): Rect | null {
    const s = this.session, d = this.doc, l = s && d ? findLayer(d, s.layerId) : undefined;
    return s && l ? { x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h } : null;
  }
  private sessionGuides(): Guides | null {
    const s = this.session, set = s?.def.handles ? HANDLES[s.def.handles] : undefined, b = this.sessionBox();
    return s && set && b ? set.draw(s.spec.params ?? {}, b) : null;
  }
  /** A press near one of the open filter's handles starts dragging it (a generous, touch-sized target). */
  private handleStart(p: Pt): boolean {
    const g = this.sessionGuides();
    if (!g) return false;
    let best: string | null = null, bd = 24 / this.view.zoom;
    for (const hd of g.handles) { const dd = Math.hypot(hd.x - p.x, hd.y - p.y); if (dd < bd) { bd = dd; best = hd.key; } }
    this.hdrag = best;
    const s = this.session, set = s?.def.handles ? HANDLES[s.def.handles] : undefined, b = this.sessionBox();
    if (!best && s && set?.press && b && set.press(p.x, p.y, (s.spec.params ??= {}), b)) { this.syncControls(); this.preview(); this.requestRender(); return true; }
    return !!best;
  }
  private handleMove(p: Pt): void {
    const s = this.session, set = s?.def.handles ? HANDLES[s.def.handles] : undefined, b = this.sessionBox();
    if (!s || !set || !b || !this.hdrag) return;
    set.drag(this.hdrag, p.x, p.y, (s.spec.params ??= {}), b);
    this.syncControls();
    this.preview();
    this.requestRender();
  }
  /** Moves the dialog's sliders to the session's settings (after a handle drag). */
  private syncControls(): void {
    const s = this.session;
    if (!s) return;
    const params = s.spec.params ?? {};
    for (const c of s.def.controls) {
      if (c.type && c.type !== 'range') continue;
      const inp = this.dlgEl.querySelector<HTMLInputElement>(`[data-testid="ctl-${c.key}"]`), v = Number(params[c.key] ?? c.value);
      if (!inp) continue;
      inp.value = String(v);
      const out = inp.closest('.fpe-field')?.querySelector('output');
      if (out) out.textContent = fmtNum(v) + (c.unit ?? '');
    }
  }
  private toolMove(p: Pt, i: PointerInfo): void {
    const d = this.doc;
    if (!d) return;
    if (this.tkDown) { this.tk?.move(p, i); return; }
    if (this.hdrag) { this.handleMove(p); return; }
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
      // A folder carries every layer inside it; each node goes to its own start plus the same offset.
      const r = placeSpots(d, g.spots, Math.round(p.x - g.start.x), Math.round(p.y - g.start.y));
      if (r) this.markDirty(r);
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
    if (this.tkDown) { this.tkDown = false; this.tk?.end(p, i); return; }
    const d = this.doc;
    if (this.hdrag) { this.hdrag = null; this.requestRender(); return; }
    if (this.stroke) {
      this.stroke.add(this.strokePoint(p, i));
      this.flushStroke();
      const cmd = this.stroke.end(), surf = this.maskSurf;
      this.stroke = null; this.strokeCache = null;
      this.maskSurf = null;
      this.pushCmd(surf ? surf.finish(cmd?.label === 'Eraser' ? 'Erase on the mask' : 'Paint on the mask') : cmd);
      return;
    }
    const g = this.drag;
    this.drag = null;
    if (!g || !d) return;
    if (g.kind === 'move') {
      const l = findLayer(d, g.id);
      if (l && (l.x !== g.x || l.y !== g.y)) { const dx = l.x - g.x, dy = l.y - g.y; placeSpots(d, g.spots, 0, 0); this.pushCmd(moveNode(d, g.id, dx, dy, 'Move layer')); }
    } else if (g.kind === 'pick') this.toast('Colour picked: ' + this.brush.color);
    else if (g.kind === 'select') { if (d.selection && (d.selection.w < 2 || d.selection.h < 2)) d.selection = null; this.afterSelection(); }
    else if (g.kind === 'crop') { if (this.crop && (this.crop.w < 2 || this.crop.h < 2)) this.crop = null; this.renderOptions(); }
    this.requestRender();
  }
  private toolCancel(): void {
    if (this.tkDown) { this.tkDown = false; this.tk?.cancel(); }
    this.hdrag = null;
    if (this.stroke) { const r = this.stroke.cancel(); this.stroke = null; this.strokeCache = null; this.markDirty(r); this.requestRender(); }
    const g = this.drag;
    this.drag = null;
    if (g && g.kind === 'move' && this.doc) {
      const l = findLayer(this.doc, g.id);
      if (l) { const r = placeSpots(this.doc, g.spots, 0, 0); if (r) this.markDirty(r); this.requestRender(); }
    }
  }
  private flushStroke(): void {
    const r = this.stroke?.takeDirty() ?? null;
    if (!r) return;
    if (this.maskSurf) { this.maskSurf.fold(r); const f = this.active()?.mask?.feather ?? 0; this.markDirty(f ? expandRect(r, featherReach(f)) : r); }
    else this.markDirty(r);
    this.requestRender();
  }
  /** True when tools edit this layer's mask. */
  private onMask(l: Layer): boolean { return this.maskTarget && !!l.mask; }
  /** Choose what tools edit: the mask (true) or the pixels (false). View state, not an undo step. */
  targetMask(id: string, mask: boolean): void {
    const d = this.doc, l = d ? findLayer(d, id) : undefined;
    if (!d || !l) return;
    if (d.activeId !== id) this.selectLayer(id);
    this.maskTarget = mask && !!l.mask;
    this.renderPanels();
    this.renderOptions();
    if (this.maskTarget) this.toast('Painting on the mask: black hides, white shows, grey half shows.');
  }
  /** The mask functions of the Layer menu and the Layers panel. */
  maskAction(kind: 'reveal' | 'hide' | 'selection' | 'hide-selection' | 'apply' | 'delete' | 'toggle' | 'link' | 'invert'): boolean {
    const d = this.doc, l = this.active();
    if (!d || !l) return false;
    if (l.locked) { this.toast(`"${l.name}" is locked. Unlock it in the Layers panel to change it.`); return true; }
    let cmd: Command | null = null, msg = '';
    if (kind === 'reveal' || kind === 'hide' || kind === 'selection' || kind === 'hide-selection') {
      if (l.mask) { this.toast('This layer already has a mask.'); return true; }
      cmd = addMask(d, l, kind);
      if (cmd) { this.maskTarget = true; msg = 'Mask added. Painting on the mask: black hides, white shows, grey half shows.'; }
    } else if (kind === 'apply') {
      if (l.content) { this.toast(`"${l.name}" is a ${l.content.kind === 'text' ? 'text' : 'shape'} layer: choose Layer › Turn into plain pixels first, then make the mask permanent.`); return true; }
      cmd = applyMask(d, l); this.maskTarget = false; msg = 'The mask is now part of the pixels.';
    } else if (kind === 'delete') { cmd = deleteMask(d, l); this.maskTarget = false; msg = 'Mask removed: the whole layer shows.'; }
    else if (kind === 'toggle' && l.mask) { cmd = setMaskSettings(d, l, { enabled: !l.mask.enabled }); msg = l.mask.enabled ? 'Mask switched on.' : 'Mask switched off: the whole layer shows; the mask is kept.'; }
    else if (kind === 'link' && l.mask) { cmd = setMaskSettings(d, l, { linked: !l.mask.linked }); msg = l.mask.linked ? 'Mask linked: it moves with the layer.' : 'Mask unlinked: the layer moves on its own.'; }
    else if (kind === 'invert') cmd = invertLayerMask(d, l);
    if (!cmd) return false;
    this.pushCmd(cmd, true);
    if (msg) this.toast(msg);
    return true;
  }
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
    const act = this.tk?.activity() ?? null;
    if (act) o.append(h('span', { class: 'fpe-opt-tool', 'data-testid': 'opt-tool', 'data-help-title': `${act.plain} · ${act.pro}`, 'data-help': act.help }, icon('move'), this.names(act.plain, act.pro)));
    else if (r) o.append(h('span', { class: 'fpe-opt-tool', 'data-testid': 'opt-tool', 'data-tipcmd': r.id }, icon(GROUP_ICON[r.place] ?? 'square'), this.names(r.plain, r.pro)));
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
    } else if (t === 'move') {
      const pick = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'aria-pressed': String(this.autoPick), 'data-testid': 'move-autopick',
        'data-help-title': 'Pick the layer under the pointer · Auto-select', 'data-help': 'When on, dragging moves whichever layer you press on, not only the active one.',
        onclick: () => { this.autoPick = !this.autoPick; this.renderOptions(); } }, 'Pick by clicking');
      const line = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'aria-haspopup': 'menu', 'data-testid': 'move-align', 'data-help-title': 'Line up · Align',
        'data-help': 'Line the layer up with the selection or the picture, or space layers out evenly.' }, 'Line up');
      line.addEventListener('click', () => this.showPopover(['layer.align-left', 'layer.align-hcenter', 'layer.align-right', 'layer.align-top', 'layer.align-vcenter',
        'layer.align-bottom', 'layer.distribute-h', 'layer.distribute-v'].map((id) => ({ label: BY_ID.get(id)?.plain ?? id, cmd: id, run: () => void this.run(id) })), line));
      o.append(hint('Drag to move the active layer. Arrow keys nudge it 1 px (Shift: 10 px).'), pick, btn('edit.free-transform', 'Resize and turn'), line,
        btn('edit.flip-layer-h', 'Mirror'), btn('edit.rotate-layer-cw', 'Turn right'));
    }
    else if (t === 'hand') o.append(hint('Drag to move around the picture.'), btn('view.fit', 'Fit on screen'), btn('view.actual', '100%'));
    else if (t === 'zoom') o.append(hint('Click to zoom in; Alt-click to zoom out.'), btn('view.zoom-in', 'Zoom in'), btn('view.zoom-out', 'Zoom out'), btn('view.fit', 'Fit'), btn('view.actual', '100%'));
    else if (TK_TOOLS.has(t)) { if (this.tk) this.tk.options(o, t); else o.append(hint('Getting the tool ready…')); }
    else {
      const seg = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Pick from' });
      for (const [all, label] of [[true, 'All layers'], [false, 'This layer']] as const) {
        seg.append(h('button', { type: 'button', 'aria-pressed': String(this.sampleAll === all), onclick: () => { this.sampleAll = all; this.renderOptions(); } }, label));
      }
      o.append(h('span', { class: 'fpe-dot', 'data-swatch': '', style: 'background:' + this.brush.color, role: 'img', 'aria-label': 'Main colour ' + this.brush.color }),
        hint('Tap the picture to pick a colour to paint with.'), seg);
    }
    this.tk?.decorate(o, t);
    this.ribbon?.optionsChanged(!!act);
    this.syncChrome();
    this.cueOptions();
  }
  /** The options bar scrolls sideways when it is too long (phones), with a soft fade on the side that has more, like the panel tabs. */
  private cueOptions(): void {
    const o = this.optionsBar, max = o.scrollWidth - o.clientWidth;
    const more = max <= 1 ? '' : o.scrollLeft <= 1 ? 'right' : o.scrollLeft >= max - 1 ? 'left' : 'both';
    if (more) o.dataset.more = more; else delete o.dataset.more;
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
    if (!l || !this.editable(l, true, true)) return;
    this.pushCmd(this.onMask(l) ? withMaskSurface(d, l, 'Hide the selected part', (sd, s) => clearSelection(sd, s)) : clearSelection(d, l), true);
  }
  fillArea(second: boolean): void {
    const d = this.doc, l = d ? activeLayer(d) : undefined;
    if (!d || !l || !this.editable(l, true, true)) return;
    const c = parseHex(second ? this.bgColor : this.brush.color) ?? BLACK, label = second ? 'Fill with second colour' : 'Fill';
    this.pushCmd(this.onMask(l) ? withMaskSurface(d, l, label, (sd, s) => fillSelection(sd, s, c, label)) : fillSelection(d, l, c, label), true);
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
    layerPixelsChanged();
    if (all) this.markAll();
    this.afterEdit();
  }
  private afterEdit(): void { this.renderPanels(); this.renderTabs(); this.syncChrome(); this.requestRender(); this.saver?.touch(); }
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
    layerPixelsChanged();
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
    this.tk?.refresh();
    this.renderLayers();
    this.renderHistory();
    this.renderProps();
    this.renderColor();
    this.renderInfo();
    this.renderLearn();
    if (this.doc) this.loadCards();
    this.queueNav();
    if (this.stat.hint) this.renderStatus();
  }
  private renderLayers(): void {
    const d = this.doc, list = this.layerList;
    if (!list) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    list.replaceChildren();
    this.layerProps.replaceChildren();
    this.layerTop.replaceChildren();
    const tab = this.root.querySelector<HTMLElement>('[data-testid="tab-layers"]');
    if (tab) {
      let c = tab.querySelector<HTMLElement>('.fpe-count');
      if (!c) tab.append(c = h('span', { class: 'fpe-count', 'data-testid': 'layer-count' }));
      c.textContent = d ? String(d.layers.length) : '';
    }
    if (!d) { list.append(h('li', { class: 'fpe-note' }, 'Open or create a picture to see its layers.')); return; }
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i], on = l.id === d.activeId, folder = isFolder(l), open = l.open !== false, up = ancestors(d.layers, l.id);
      // A closed folder hides every row inside it, however deep (design 6).
      if (up.some((a) => a.open === false)) continue;
      let clipped = 0;
      for (let s = siblingAbove(d.layers, l.id); s?.clip; s = siblingAbove(d.layers, s.id)) clipped++;
      const n = folder ? subtreeOf(d.layers, l.id).length - 1 : 0, nl = (k: number): string => `${k} layer${k === 1 ? '' : 's'}`;
      const sub = folder ? `Folder, ${open ? 'open' : 'closed'} · ${nl(n)}` : l.clip ? 'Clipped to the layer below' : clipped ? `${nl(clipped)} clipped to it` : '';
      const nameBtn = h('button', { type: 'button', class: 'fpe-btn fpe-layer-name' + (sub ? ' fpe-layer-two' : ''),
        'aria-label': `${folder ? 'Folder' : 'Layer'} ${l.name}${folder ? `, ${open ? 'open' : 'closed'}, ${nl(n)} inside` : ''}${l.clip ? ', clipped to the layer below' : ''}${clipped ? `, ${nl(clipped)} clipped to it` : ''}${l.visible ? '' : ', hidden'}${l.locked ? ', locked' : ''}${on ? ', active' : ''}`,
        'data-help-title': folder ? 'Choose this folder' : 'Choose this layer', 'data-help': 'Tap to work on this layer. Press and hold, or right-click, for its actions.',
        'data-testid': 'layer-select', onclick: () => this.selectLayer(l.id), ondblclick: () => this.openModal('rename') },
        h('span', {}, l.name), sub ? h('small', { class: 'fpe-layer-sub' }, sub) : null);
      this.longPress(nameBtn, () => this.layerActions(l.id));
      list.append(h('li', { class: 'fpe-layer' + (l.clip ? ' fpe-clipped' : ''), style: `--depth:${up.length}`, 'data-testid': 'layer-row', 'data-name': l.name, 'data-id': l.id,
        'data-depth': up.length, 'data-kind': folder ? 'folder' : 'layer', 'aria-current': on ? 'true' : 'false' },
        h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn', 'aria-pressed': String(l.visible), 'aria-label': (l.visible ? 'Hide ' : 'Show ') + l.name,
          'data-help-title': l.visible ? 'Hide this layer' : 'Show this layer', 'data-help': 'The eye shows or hides a layer without deleting it.', 'data-testid': 'layer-eye',
          onclick: () => this.toggleVisible(l.id) }, icon(l.visible ? 'eye' : 'eye-off')),
        // One indent step per depth, then one fixed slot for the folder arrow or the clip arrow, so every depth lines up.
        up.length ? h('span', { class: 'fpe-indent', 'aria-hidden': 'true' }) : null,
        h('span', { class: 'fpe-twist' }, l.clip ? h('span', { class: 'fpe-clip-arrow', 'aria-hidden': 'true', 'data-testid': 'clip-arrow' }, icon('clip')) : null,
        folder ? h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn fpe-layer-arrow', 'aria-expanded': String(open), 'aria-label': `${open ? 'Close' : 'Open'} the folder ${l.name}`,
          'data-help-title': open ? 'Close the folder' : 'Open the folder', 'data-help': 'Shows or hides the rows inside. The picture does not change.', 'data-testid': 'folder-arrow',
          onclick: () => this.toggleOpen(l.id) }, icon(open ? 'chev-down' : 'chev-right')) : null),
        ...this.layerThumbs(l, on),
        nameBtn,
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
        this.markDirty(intersect((isFolder(a) ? effectiveBox(d.layers, a) : layerRect(a)) ?? docRect(d), docRect(d)) ?? docRect(d));
        this.requestRender();
      });
      op.addEventListener('change', () => {
        const from = this.opacityStart;
        this.opacityStart = null;
        if (from !== null && from !== a.opacity) this.pushCmd(propsCommand(a.id, { opacity: from }, { opacity: a.opacity }, 'Layer opacity'));
      });
      // A folder's first choice is Pass through: the layers inside mix with everything below as if there were no folder.
      const fa = isFolder(a), pass = fa && !!a.passThrough;
      const blend = h('select', { id: id + 'b', 'data-testid': 'layer-blend' }, fa ? h('option', { value: 'pass', selected: pass }, 'Pass through') : null,
        ...BLEND_GROUPS.map((g) => h('optgroup', { label: g.label }, ...g.modes.map((m) => h('option', { value: m, selected: !pass && m === a.blendMode }, BLEND_LABELS[m])))));
      blend.addEventListener('change', () => {
        const v = blend.value;
        if (v === 'pass') this.pushCmd(setLayerProps(d, a.id, { passThrough: true }, 'Folder mixes: pass through'), true);
        else if (isBlendMode(v)) this.pushCmd(setLayerProps(d, a.id, fa ? { passThrough: false, blendMode: v } : { blendMode: v }), true);
      });
      this.layerTop.append(
        h('div', { class: 'fpe-row', 'data-help-title': 'Blend mode', 'data-help': fa ? 'Pass through lets the layers inside mix with everything below. Any other choice first makes the folder one picture, then mixes it.' : 'How this layer mixes with the layers under it. Normal simply covers them.' },
          h('label', { for: id + 'b' }, 'Blend'), blend),
        h('div', { class: 'fpe-row', 'data-help-title': 'Opacity', 'data-help': 'How solid the layer is: 100% covers fully, lower lets the layers below show through.' },
          h('label', { for: id + 'o' }, 'Opacity'), op, opOut), ...(hasPixels(a) ? [this.fillRow(a, id)] : []));
      this.layerProps.append(h('div', { class: 'fpe-row', 'data-help-title': 'Layer name', 'data-help': 'A clear name helps you find the layer later.' }, h('label', { for: id + 'n' }, 'Name'), name));
    }
    if (focused) (this.root.querySelector<HTMLElement>(`.fpe-props [data-testid="${focused}"]`) ?? this.layerTop.querySelector<HTMLElement>(`[data-testid="${focused}"]`))?.focus({ preventScroll: true });
    this.queueThumbs();
  }
  /** The Layers card's More list: every layer action that is not one of the four with words. */
  private layerMore(at: HTMLElement): void {
    const items: [string, string][] = [['file.open-layer', 'Add a picture as a layer'], ['layer.forward', 'Move up'], ['layer.backward', 'Move down'],
      ['layer.merge-down', 'Merge down'], ['layer.lock', 'Lock or unlock'], ['layer.group', 'Put in a folder'], ['layer.ungroup', 'Take out of the folder'],
      ['layer.new-group', 'New empty folder'], ['layer.clip', 'Clip to the layer below'],
      ['layer.fx-shadow', 'Add a drop shadow'], ['layer.fx-outer-glow', 'Add an outer glow'], ['layer.fx-stroke', 'Add an outline'], ['layer.fx-color', 'Add a colour overlay'],
      ['layer.fx-gradient', 'Add a gradient overlay'], ['layer.fx-inner-shadow', 'Add an inner shadow'], ['layer.fx-inner-glow', 'Add an inner glow']];
    this.showPopover(items.filter(([cmd]) => BY_ID.has(cmd)).map(([cmd, label]) => ({ label, cmd,
      disabled: BY_ID.get(cmd)?.status !== 'ready' || !this.isEnabled(cmd), run: () => void this.run(cmd) })), at);
  }
  /** The row's picture thumbnail and, when the layer has a mask, the link button and the mask thumbnail. */
  private layerThumbs(l: Layer, on: boolean): HTMLElement[] {
    const swatch = (): HTMLElement => { const s = h('span', { class: 'fpe-layer-thumb fpe-layer-folder', 'aria-hidden': 'true', 'data-testid': 'fill-swatch' }); if (l.fill) s.style.background = toHex(l.fill.color); return s; };
    const pic = isFolder(l) ? h('span', { class: 'fpe-layer-thumb fpe-layer-folder', 'aria-hidden': 'true' }, icon(l.open === false ? 'folder' : 'open'))
      : l.kind === 'adjust' ? h('span', { class: 'fpe-layer-thumb fpe-layer-folder', 'aria-hidden': 'true', 'data-testid': 'adjust-thumb' }, icon('sliders'))
      : l.kind === 'fill' ? swatch()
      : h('canvas', { class: 'fpe-layer-thumb', width: 80, height: 80, 'data-thumb': l.id, 'aria-hidden': 'true' });
    const m = l.mask;
    if (!m) return [pic];
    const maskOn = on && this.maskTarget;
    return [
      h('button', { type: 'button', class: 'fpe-btn fpe-thumb-btn' + (on && !maskOn ? ' fpe-target' : ''), 'aria-pressed': String(on && !maskOn), 'data-testid': 'layer-pixels',
        'aria-label': `Edit the pixels of ${l.name}`, 'data-help-title': 'Edit the pixels', 'data-help': 'Click to paint on the picture itself instead of its mask.',
        onclick: () => this.targetMask(l.id, false) }, pic),
      h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn fpe-chain', 'aria-pressed': String(m.linked), 'data-testid': 'mask-link',
        'aria-label': `${m.linked ? 'Unlink' : 'Link'} the mask of ${l.name}`, 'data-help-title': 'Link the mask to the layer · Link layer mask',
        'data-help': 'Linked, the mask moves and turns with the layer; unlinked, they move apart.',
        onclick: () => { if (this.doc?.activeId !== l.id) this.selectLayer(l.id); this.maskAction('link'); } }, icon(m.linked ? 'link' : 'unlink')),
      h('button', { type: 'button', class: 'fpe-btn fpe-thumb-btn fpe-mask-thumb' + (maskOn ? ' fpe-target' : '') + (m.enabled ? '' : ' fpe-mask-off'),
        'aria-pressed': String(maskOn), 'data-testid': 'layer-mask', 'aria-label': `Edit the mask of ${l.name}${m.enabled ? '' : ', switched off'}`,
        'data-help-title': 'Layer mask', 'data-help': 'Click to paint on the mask: black hides, white shows, grey half shows. Shift+click switches it off or on.',
        onclick: (ev: Event) => { if ((ev as MouseEvent).shiftKey) { if (this.doc?.activeId !== l.id) this.selectLayer(l.id); this.maskAction('toggle'); } else this.targetMask(l.id, true); } },
      h('canvas', { width: 80, height: 80, 'data-mask-thumb': l.id, 'aria-hidden': 'true' })),
    ];
  }
  /** Open or close a folder's rows: a view choice, not an undo step. The safety copy keeps it. */
  private toggleOpen(id: string): void {
    const d = this.doc, l = d ? findLayer(d, id) : undefined;
    if (!d || !l || !isFolder(l)) return;
    l.open = l.open === false;
    // Closing the folder that holds the active layer makes the folder active, so the active row stays in view.
    if (!l.open && ancestors(d.layers, d.activeId).some((a) => a.id === id)) this.selectLayer(id);
    this.renderLayers();
    this.saver?.touch();
  }
  /**
   * A layer row's actions (design 6, phones): a bottom sheet on phones and tablets after a long press, a small menu on a
   * desktop after a right-click. Rows still Planned show visibly disabled with the Planned tag.
   */
  private layerActions(id: string): void {
    const d = this.doc, l = d ? findLayer(d, id) : undefined;
    if (!d || !l) return;
    if (d.activeId !== id) this.selectLayer(id);
    const m = l.mask;
    const items: [string, string][] = [
      ['layer.mask-add', 'Add a mask'], ['layer.mask-toggle', m && !m.enabled ? 'Switch the mask on' : 'Switch the mask off'],
      ['layer.mask-link', m && !m.linked ? 'Link the mask' : 'Unlink the mask'], ['layer.clip', 'Clip to the layer below'],
      ['layer.fx-shadow', 'Effects…'], ['layer.group', 'Put in a folder'], ['layer.ungroup', 'Take out of the folder'], ['layer.delete', 'Delete'],
    ];
    const rows = items.filter(([cmd]) => BY_ID.has(cmd)).map(([cmd, label]) => {
      const planned = BY_ID.get(cmd)?.status !== 'ready';
      return { cmd, label, planned, off: planned || !this.isEnabled(cmd) };
    });
    if (this.layout === 'desktop') {
      const at = this.layerList?.querySelector<HTMLElement>(`[data-id="${id}"] [data-testid="layer-select"]`);
      if (at) this.showPopover(rows.map((r) => ({ label: r.planned ? `${r.label} · Planned` : r.label, cmd: r.cmd, disabled: r.off, run: () => void this.run(r.cmd) })), at);
      return;
    }
    const body = this.layerActBody ?? (this.layerActBody = h('div', { class: 'fpe-sheet-list', role: 'menu', 'aria-label': 'Layer actions' }));
    body.replaceChildren(...rows.map((r) => {
      const b = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost fpe-sheet-item', role: 'menuitem', 'data-tipcmd': r.cmd, 'data-testid': 'layer-action-' + r.cmd.slice(6),
        'aria-disabled': r.off ? 'true' : null }, h('span', { class: 'fpe-btn-text' }, r.label), r.planned ? this.tag() : null);
      b.addEventListener('click', () => { if (r.off) return; this.closeModal(); void this.run(r.cmd); });
      return b;
    }));
    this.toolSheet('layer-actions', l.name, body);
  }
  /** Mask thumbnails in grey: the canvas area of each mask, scaled down. */
  private drawMaskThumbs(): void {
    const d = this.doc;
    if (!d) return;
    for (const l of d.layers) {
      const m = l.mask, c = m ? this.root.querySelector<HTMLCanvasElement>(`canvas[data-mask-thumb="${l.id}"]`) : null, ctx = c?.getContext('2d');
      if (!m || !c || !ctx) continue;
      const S = c.width, img = ctx.createImageData(S, S), k = Math.max(d.width, d.height) / S, ox = (S - d.width / k) / 2, oy = (S - d.height / k) / 2;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = Math.floor((x - ox) * k), dy = Math.floor((y - oy) * k), i = (y * S + x) * 4;
        const v = dx < 0 || dy < 0 || dx >= d.width || dy >= d.height ? 128 : maskAt(m, dx, dy);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      c.dataset.drawn = '1';
    }
  }
  private queueThumbs(): void { clearTimeout(this.thumbTimer); this.thumbTimer = window.setTimeout(() => { this.drawThumbs(); this.drawMaskThumbs(); }, 180); }
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
      c.dataset.drawn = '1';
    }
  }
  private renderHistory(): void {
    const ul = this.histList;
    if (!ul) return;
    if (!this.doc) { ul.replaceChildren(h('li', { class: 'fpe-note' }, 'Your steps appear here.')); if (this.histCount) this.histCount.textContent = ''; return; }
    const { labels, index } = this.history.entries(), ids = [0, ...this.history.stepIds()], m = this.marks.get(this.history) ?? 0, mark = ids.includes(m) ? m : 0;
    ul.replaceChildren(...['Opened ' + this.name, ...labels].map((label, k) => h('li', { class: 'fpe-hist-row' },
      h('button', { type: 'button', class: 'fpe-hist-item', 'aria-current': k === index ? 'step' : null, 'data-undone': k > index ? '' : null, 'data-testid': 'history-step',
        'data-help-title': label, 'data-help': k > index ? 'An undone step. Pick it to bring it back.' : 'Pick a step to go back to how the picture looked then.', onclick: () => this.goToStep(k) }, label),
      h('button', { type: 'button', class: 'fpe-hist-mark', 'aria-pressed': ids[k] === mark ? 'true' : 'false', 'aria-label': `Paint from here: ${label}`, 'data-testid': 'history-mark',
        'data-help-title': 'Paint from here · History brush source', 'data-help': 'The history brush paints back the step marked with this brush. Pick the brush beside another step to paint from that one.',
        onclick: () => this.markStep(ids[k], label) }, icon('brush')))));
    if (this.histCount) this.histCount.textContent = labels.length ? `${labels.length} step${labels.length === 1 ? '' : 's'}` : '';
    ul.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }
  /** Edit › Paint back from this step: the step you are at becomes the one the history brush paints back. */
  paintFromHere(): void {
    if (!this.doc) return this.needDoc();
    const { labels, index } = this.history.entries();
    this.markStep(index ? this.history.stepIds()[index - 1] : 0, index ? labels[index - 1] : 'Opened ' + this.name);
    this.showPanelTab('history');
  }
  private markStep(id: number, label: string): void {
    this.marks.set(this.history, id);
    this.renderHistory();
    this.toast(`The history brush now paints back “${label}”.`);
  }
  private paintFromGone(): void {
    this.marks.delete(this.history);
    this.renderHistory();
    this.toast('The step marked in History is gone (a newer change replaced it), so the history brush paints from the oldest step.');
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
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    const parts: HTMLElement[] = [h('h3', { class: 'fpe-group-title' }, 'Layer: ' + l.name),
      num('x', 'Left (X)', 'How far the layer sits from the left edge, in pixels.'), num('y', 'Top (Y)', 'How far the layer sits from the top edge, in pixels.'),
      h('p', { class: 'fpe-kv' }, `${l.width} × ${l.height} px · opacity ${Math.round(l.opacity * 100)}% · ${BLEND_LABELS[l.blendMode]}${l.locked ? ' · locked' : ''}${l.visible ? '' : ' · hidden'}`),
      h('h3', { class: 'fpe-group-title' }, 'Picture'),
      h('p', { class: 'fpe-kv' }, `${d.width} × ${d.height} px · ${d.layers.length} layer${d.layers.length === 1 ? '' : 's'}`),
      h('div', { class: 'fpe-btnrow' }, this.cmdBtn('image.size', null, 'Picture size…'), this.cmdBtn('image.canvas-size', null, 'Canvas size…'))];
    const own = parts[1];
    if (l.mask) {
      // The mask's settings live here (design 6): first while the mask is the target, after the layer's own otherwise.
      const box = h('div', { class: 'fpe-mask-props', 'data-testid': 'mask-props' });
      if (this.onMask(l)) parts.unshift(box); else parts.splice(4, 0, box);
      void import('./layerprops').then((m) => {
        m.renderMaskProps(box, {
          uid: this.uid, doc: () => this.doc, layer: () => this.active(), push: (c) => this.pushCmd(c, true), run: (cmd) => void this.run(cmd),
          live: () => { this.markAll(); this.requestRender(); }, toast: (msg) => this.toast(msg),
        });
        if (focused && box.isConnected) box.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({ preventScroll: true });
      });
    }
    if (isFolder(l)) {
      // A folder has no pixels of its own: its section (how it mixes, opacity, open) replaces X, Y and size, loaded lazily.
      const box = h('div', { class: 'fpe-mask-props', 'data-testid': 'folder-props' });
      parts.splice(parts.indexOf(own) - 1, 4, box);
      void import('./layerprops').then((m) => {
        m.renderFolderProps(box, {
          uid: this.uid, doc: () => this.doc, layer: () => this.active(), push: (c) => this.pushCmd(c, true), run: (cmd) => void this.run(cmd),
          live: () => { this.markAll(); this.requestRender(); }, toast: (msg) => this.toast(msg), toggleOpen: (fid) => this.toggleOpen(fid),
        });
        if (focused && box.isConnected) box.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({ preventScroll: true });
      });
    }
    if (l.kind === 'adjust' || l.kind === 'fill') {
      // Editable light and colour, or a colour layer (W6 S3): its settings replace X, Y and size; the same controls as its dialog.
      const kind = l.kind, box = h('div', { class: 'fpe-mask-props', 'data-testid': kind === 'adjust' ? 'adjust-props' : 'fill-props' });
      parts.splice(parts.indexOf(own) - 1, 4, box);
      void import('./layerprops').then((m) => {
        const host: import('./layerprops').MaskPropsHost = { uid: this.uid, doc: () => this.doc, layer: () => this.active(), push: (c) => this.pushCmd(c, true),
          run: (cmd) => void this.run(cmd), live: () => { this.markAll(); this.requestRender(); }, toast: (msg) => this.toast(msg) };
        if (kind === 'adjust') m.renderAdjustProps(box, host); else m.renderFillProps(box, host);
        if (focused && box.isConnected) box.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({ preventScroll: true });
      });
    }
    if (l.fx) {
      // Layer effects (W6 S4): one section per effect, the adjustments' control renderer, live while dragging; loaded lazily.
      const box = h('div', { class: 'fpe-mask-props', 'data-testid': 'fx-props' });
      parts.splice(Math.min(parts.length, 4), 0, box);
      void Promise.all([import('./fxprops'), this.layerFx()]).then(([m]) => {
        m.renderFxProps(box, { uid: this.uid, doc: () => this.doc, layer: () => this.active(), push: (c) => this.pushCmd(c, true), run: (cmd) => void this.run(cmd),
          live: () => { this.markAll(); this.requestRender(); }, toast: (msg) => this.toast(msg) });
        if (focused && box.isConnected) box.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({ preventScroll: true });
      });
    }
    b.append(...parts);
  }
  private fillStart: number | null = null;
  /** Fill, beside Opacity (W6 S4): how solid the layer's own pixels are; its effects stay. One undo step on release. */
  private fillRow(a: import('@free-photoeditor/core').Layer, id: string): HTMLElement {
    const v = Math.round((a.fillOpacity ?? 1) * 100);
    const inp = h('input', { id: id + 'f', type: 'range', min: 0, max: 100, step: 1, value: v, 'data-testid': 'layer-fill' }) as HTMLInputElement;
    const out = h('output', { class: 'fpe-out', for: id + 'f' }, v + '%');
    inp.addEventListener('input', () => {
      if (this.fillStart === null) this.fillStart = a.fillOpacity ?? 1;
      const f = Number(inp.value) / 100;
      if (f >= 1) delete a.fillOpacity; else a.fillOpacity = f;
      out.textContent = inp.value + '%';
      this.markDirty(layerRect(a));
      this.requestRender();
    });
    inp.addEventListener('change', () => {
      const from = this.fillStart, to = a.fillOpacity ?? 1;
      this.fillStart = null;
      if (from !== null && from !== to) this.pushCmd(propsCommand(a.id, { fillOpacity: from >= 1 ? undefined : from }, { fillOpacity: a.fillOpacity }, 'Layer fill'));
    });
    return h('div', { class: 'fpe-row', 'data-help-title': 'Fill', 'data-help': 'Fill: how solid the layer’s own pixels are; effects stay.' }, h('label', { for: id + 'f' }, 'Fill'), inp, out);
  }
  private fxMod: Promise<typeof import('@free-photoeditor/core/layerfx')> | null = null;
  /** The layer effects engine (core/layerfx), loaded on first use; the screen draws again with the effects once it is in. */
  layerFx(): Promise<typeof import('@free-photoeditor/core/layerfx')> {
    this.fxMod ??= import('@free-photoeditor/core/layerfx').then((m) => { m.installLayerFx(); this.markAll(); this.requestRender(); return m; });
    return this.fxMod;
  }
  /** Layer › Shadows, glows and outlines: the effect with its starting settings, one undo step, then its settings in Properties. */
  async addEffect(kind: import('@free-photoeditor/core/layerfx').LayerFxKind): Promise<void> {
    const a = this.active();
    if (!this.doc || !a) return this.needDoc();
    this.cancelSession();
    const m = await this.layerFx(), t = this.active(), c = parseHex(this.brush.color) ?? BLACK;
    if (!t || t.id !== a.id) return;
    // History.push only records the step, so the layer takes its effect here first (as Opacity and Fill do).
    const fx = t.fx;
    t.fx = m.addLayerFx(fx, kind, { r: c.r, g: c.g, b: c.b, a: 255 });
    this.pushCmd(propsCommand(t.id, { fx }, { fx: t.fx }, 'Add ' + kind.replace('-', ' ')), true);
    this.showPanelTab('properties');
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
    this.cancelSession();
    const cmd = deleteLayer(d, d.activeId);
    if (!cmd) { this.toast('A picture needs at least one layer.'); return; }
    this.pushCmd(cmd, true);
  }
  arrange(k: 'front' | 'forward' | 'backward' | 'back'): void {
    const d = this.doc;
    if (!d) return;
    this.pushCmd(arrangeNode(d, d.activeId, k), true);
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
    if (id !== this.doc?.activeId) this.maskTarget = false;
    const d = this.doc;
    if (!d || d.activeId === id) return;
    this.cancelSession();
    d.activeId = id;
    this.renderLayers();
    this.renderProps();
    this.syncChrome();
  }
  mergeDownAction(): void {
    const d = this.doc;
    if (!d) return;
    const why = mergeDownRefusal(d);
    if (why) { this.toast(why); return; }
    this.pushCmd(mergeDown(d), true);
  }
  /** New empty folder, put the active node in a new folder, or take its folder apart (design 2.4). */
  /** Layer › Editable light and colour › (kind): above the active node, in its folder, with the dialog's starting settings (design 2.5). */
  addAdjustLayer(from: string): void {
    const d = this.doc, def = ADJ[from], row = BY_ID.get(from);
    if (!d) return this.needDoc();
    if (!def || !row) return;
    this.cancelSession();
    const params: JobParams = {};
    for (const c of def.controls) params[c.key] = c.value;
    this.pushCmd(addNode(d, createAdjustLayer(nextLayerName(d, row.plain), from, { op: def.op, kind: def.kind, params }), row.plain + ' layer'), true);
    this.showPanelTab('properties');
  }
  /** Layer › Colour layer › Solid colour: the main colour over the whole canvas, changeable at any time in Properties. */
  addFillLayer(): void {
    const d = this.doc;
    if (!d) return this.needDoc();
    this.cancelSession();
    const c = parseHex(this.brush.color) ?? BLACK;
    this.pushCmd(addNode(d, createFillLayer(nextLayerName(d, 'Colour'), { r: c.r, g: c.g, b: c.b, a: 255 }), 'Solid colour layer'), true);
    this.showPanelTab('properties');
  }
  folderAction(k: 'new' | 'group' | 'ungroup'): void {
    const d = this.doc;
    if (!d) return this.needDoc();
    this.cancelSession();
    const cmd = k === 'new' ? addFolder(d) : k === 'group' ? groupNode(d, d.activeId) : ungroupNode(d, d.activeId);
    if (!cmd && k === 'ungroup') { this.toast('This layer is not in a folder.'); return; }
    this.pushCmd(cmd, true);
  }
  /** Show only inside the layer below · Create clipping mask, on or off. */
  clipAction(): void {
    const d = this.doc, a = this.active();
    if (!d || !a) return this.needDoc();
    const cmd = toggleClip(d, a.id);
    if (!cmd) { this.toast('There is no layer below it in this folder to clip to.'); return; }
    this.pushCmd(cmd, true);
  }
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
    // Negative on the mask (W6 S1): the grey-surface route the brush uses, so only the mask changes and one undo step comes back.
    if (l && id === 'image.adj-invert' && this.onMask(l) && !l.locked) {
      this.pushCmd(withMaskSurface(d, l, 'Negative on the mask', (sd, s) => applyToLayer(sd, s, 'Negative', (b) => adjust(b.data, 'invert'))), true);
      return;
    }
    if (!l || !this.editable(l)) return;
    const reg = editRegion(d, l);
    if (!reg) { this.toast('The selected area is outside this layer.'); return; }
    const params: JobParams = {};
    for (const c of def.controls) params[c.key] = preset?.[c.key] ?? c.value;
    const spec: JobSpec = { op: def.op, kind: def.kind, params };
    const most: JobParams = {};
    for (const c of def.controls) most[c.key] = !c.type || c.type === 'range' ? c.max ?? c.value : c.value;
    const padded = paddedRegion(l, reg, jobPadding({ op: def.op, kind: def.kind, params: most }));
    if (def.op === 'fx') { params.ix = reg.x - padded.x; params.iy = reg.y - padded.y; params.iw = reg.w; params.ih = reg.h; }
    if (def.colors) { params.fg = hexNum(this.brush.color); params.bg = hexNum(this.bgColor); }
    const before = readRegion(l, reg), hist = new Uint32Array(256);
    for (let i = 0; i < before.length; i += 4) if (before[i + 3]) hist[Math.round(luma(before[i], before[i + 1], before[i + 2]))]++;
    const area = padded.w * padded.h, scale = def.op !== 'adjust' && area > PREVIEW_MAX ? Math.sqrt(PREVIEW_PX / area) : 1, now = !!def.instant || instant;
    this.session = { id, def, label: r.plain, spec, layerId: l.id, r: reg, padded, source: readRegion(l, padded), before, hist, running: null, queued: false, ran: false, after: null, showBefore: false,
      scale, small: null, applying: false };
    if (!(now && scale < 1)) this.preview();
    if (now) { await this.applySession(); return; }
    this.renderDialog();
  }
  runLastFilter(): void { const f = this.lastFilter; if (f) void this.openAdjust(f.id, f.params, true); }
  private renderDialog(): void {
    const s = this.session, dlg = this.dlgEl;
    if (!s || s.def.instant || s.applying) { dlg.hidden = true; dlg.replaceChildren(); this.dlgCanvas = null; return; }
    const r = BY_ID.get(s.id) as Row, params = (s.spec.params ??= {}), id = `fpe-${this.uid}-a`;
    const kids: Node[] = [this.dragHead(h('div', { class: 'fpe-dlg-head', 'data-testid': 'dialog-head', 'data-help-title': 'Move this box',
      'data-help': 'Drag the title to move this box off the part of the picture you are changing.' }, h('h2', { class: 'fpe-dlg-title' }, this.names(r.plain, r.pro)),
      iconButton('close', 'Cancel', { class: 'fpe-btn fpe-icon-btn', onclick: () => this.cancelSession() }))),
      h('p', { class: 'fpe-note' }, `${r.help} It changes ${this.doc?.selection ? 'the selected area of' : 'all of'} the active layer; the picture updates as you move the sliders.${s.def.handles ? ' Drag the round handles on the picture to place it.' : ''}`)];
    this.dlgCanvas = null;
    if (s.scale < 1) kids.push(h('p', { class: 'fpe-note', 'data-testid': 'adj-small' }, 'This picture is big, so the preview uses a smaller copy to stay quick. Apply then works on every pixel at full size, with a progress bar.'));
    if (s.id === 'image.adj-levels' || s.id === 'image.adj-curves') {
      this.dlgCanvas = h('canvas', { class: 'fpe-histo', width: 256, height: 96, 'aria-label': 'Graph of dark to light tones in the picture', 'data-testid': 'adj-graph' });
      kids.push(this.dlgCanvas);
    }
    this.sheetHook = null;
    kids.push(...(s.def.sheet ? s.def.sheet({ id: s.id, params, idBase: id, input: () => this.preview(), rerender: () => this.renderDialog(),
      result: () => ({ width: s.r.w, height: s.r.h, data: s.after ?? s.before }), onResult: (f) => { this.sheetHook = f; } })
      : renderControls(s.def.controls, params, id, { input: () => { this.preview(); this.drawGraph(); }, rerender: () => this.renderDialog() })));
    kids.push(h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost fpe-before', 'aria-pressed': s.showBefore ? 'true' : 'false', 'data-testid': 'adj-before',
        'data-help-title': 'Before and after', 'data-help': 'Show the picture as it was, to compare. Press again to see the change.', onclick: () => this.toggleBefore() },
        s.showBefore ? 'Showing before' : 'Show before'),
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
    if (!s || s.applying) return;
    if (s.running) { s.queued = true; return; }
    const spec: JobSpec = { op: s.spec.op, kind: s.spec.kind, params: { ...s.spec.params } };
    const small = s.scale < 1 ? this.smallCopy(s, spec) : null;
    const done = this.busyAfter(150);
    s.running = this.jobs.run(spec, small ?? { width: s.padded.w, height: s.padded.h, data: s.source }).then((res) => {
      const d = this.doc;
      if (this.session !== s || !d) return;
      const l = findLayer(d, s.layerId);
      if (!l) return;
      s.after = innerOf(small ? resizeBitmap({ width: small.width, height: small.height, data: res }, s.padded.w, s.padded.h) : res, s.padded, s.r);
      s.ran = true;
      if (s.showBefore) return;
      commitResult(d, l, s.r, s.before, s.after, s.label);
      this.markDirty({ x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h });
      this.requestRender();
      this.sheetHook?.();
    }).catch((e: unknown) => { if (!(e instanceof JobStopped)) this.toast(errText(e)); }).finally(() => {
      done();
      s.running = null;
      if (s.queued && this.session === s) { s.queued = false; this.preview(); }
    });
  }
  private async applySession(): Promise<void> {
    const s = this.session;
    if (!s || s.applying) return;
    while (s.running) await s.running;
    if (this.session !== s) return;
    if (s.showBefore) { s.showBefore = false; this.showResult(s, false); }
    // A setting that only shows something while editing (the clipping warning) is switched off, and Apply runs once more without it.
    const shown = s.def.viewOnly?.filter((k) => s.spec.params?.[k]) ?? [];
    for (const k of shown) (s.spec.params ??= {})[k] = 0;
    if ((s.scale < 1 || shown.length > 0) && !(await this.applyFull(s))) return;
    this.session = null;
    this.renderDialog();
    if (s.ran) {
      this.history.push(pixelCommand(s.label, s.layerId, s.r, s.before));
      this.lastChange = { layerId: s.layerId, r: s.r, before: s.before, step: this.history.stateId(), label: s.label };
      if (s.id.startsWith('filter.')) this.lastFilter = { id: s.id, params: { ...s.spec.params } };
      this.onStep?.(s.id, { ...s.spec.params });
      this.afterEdit();
      this.toast(`${s.label}: done.`);
    }
  }
  /** The dialog's working copy at preview size, with every pixel-sized setting (radius, distance, length) scaled to match. */
  private smallCopy(s: Session, spec: JobSpec): Bitmap {
    const w = Math.max(1, Math.round(s.padded.w * s.scale)), hh = Math.max(1, Math.round(s.padded.h * s.scale)), fx = w / s.padded.w, fy = hh / s.padded.h;
    s.small ??= resizeBitmap({ width: s.padded.w, height: s.padded.h, data: s.source }, w, hh);
    const p = (spec.params ??= {});
    for (const c of s.def.controls) {
      const v = p[c.key];
      if (c.unit === ' px' && typeof v === 'number') p[c.key] = Math.sign(v) * Math.max(Math.min(Math.abs(v), 1), Math.abs(v) * s.scale);
    }
    if (spec.op === 'fx') {
      p.ix = Math.round((p.ix ?? 0) * fx); p.iy = Math.round((p.iy ?? 0) * fy);
      p.iw = Math.max(1, Math.round((p.iw ?? s.padded.w) * fx)); p.ih = Math.max(1, Math.round((p.ih ?? s.padded.h) * fy));
    }
    return { width: w, height: hh, data: s.small };
  }
  /** Apply after a preview on a smaller copy: the filter runs again on every pixel in the worker, with a progress bar and Cancel. */
  private async applyFull(s: Session): Promise<boolean> {
    s.applying = true;
    this.renderDialog();
    const W = s.padded.w, spec: JobSpec = { op: s.spec.op, kind: s.spec.kind, params: { ...s.spec.params } }, bands = jobBands(spec, s.padded.h);
    let stopped = false;
    const bar = this.progress(s.id, !!bands, () => { stopped = true; this.jobs.stop(); });
    try {
      let out: Uint8ClampedArray;
      if (bands) {
        out = s.source.slice();
        for (let k = 0; k < bands.length; k++) {
          const b = bands[k], res = await this.jobs.run(b.spec, { width: W, height: b.sh, data: s.source.subarray(b.sy * W * 4, (b.sy + b.sh) * W * 4) });
          if (stopped) throw new JobStopped();
          out.set(res.subarray((b.y0 - b.sy) * W * 4, (b.y1 - b.sy) * W * 4), b.y0 * W * 4);
          bar.set((k + 1) / bands.length);
        }
      } else out = await this.jobs.run(spec, { width: W, height: s.padded.h, data: s.source });
      if (stopped) throw new JobStopped();
      const d = this.doc, l = d ? findLayer(d, s.layerId) : undefined;
      if (!d || !l || this.session !== s) return false;
      s.after = innerOf(out, s.padded, s.r);
      s.ran = true;
      commitResult(d, l, s.r, s.before, s.after, s.label);
      this.markDirty({ x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h });
      this.requestRender();
      return true;
    } catch (e: unknown) {
      s.applying = false;
      if (this.session === s) this.cancelSession();
      this.toast(stopped || e instanceof JobStopped ? `${s.label} stopped. The picture is as it was.` : errText(e));
      return false;
    } finally {
      s.applying = false;
      bar.close();
    }
  }
  /** A progress bar with Cancel over the editor while a filter works at full size; without steps it shows a moving bar. */
  private progress(id: string, steps: boolean, cancel: () => void): { set(v: number): void; close(): void } {
    const r = BY_ID.get(id) as Row, label = r.plain;
    const bar = h('progress', { max: 1, 'data-testid': 'job-bar', 'aria-label': `${label}: how much is done` }) as HTMLProgressElement;
    if (steps) bar.value = 0;
    const pct = h('p', { class: 'fpe-note', 'data-testid': 'job-pct' }, steps ? '0% done' : 'Working on every pixel…');
    const box = h('div', { class: 'fpe-job', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Applying ${label}`, 'data-testid': 'job-progress' },
      h('h2', { class: 'fpe-dlg-title' }, this.names(r.plain, r.pro)),
      h('p', { class: 'fpe-note' }, 'Applying it to the whole picture. The preview used a smaller copy to stay quick; now every pixel is done at full size. Big pictures and big settings take longer.'),
      bar, pct,
      h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'job-cancel', 'data-help-title': 'Cancel',
        'data-help': 'Stop now and keep the picture as it was.', onclick: cancel }, 'Cancel')));
    const veil = h('div', { class: 'fpe-job-veil' }, box);
    this.root.append(veil);
    this.jobCancel = cancel;
    requestAnimationFrame(() => box.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }));
    return { set: (v) => { bar.value = v; pct.textContent = `${Math.round(v * 100)}% done`; }, close: () => { this.jobCancel = null; veil.remove(); } };
  }
  /** Shows the dialog's result, or the picture as it was, without ending the dialog. */
  private showResult(s: Session, before: boolean): void {
    const d = this.doc, l = d ? findLayer(d, s.layerId) : undefined;
    if (!d || !l) return;
    if (before) writeRegion(l, s.r, s.before); else if (s.after) commitResult(d, l, s.r, s.before, s.after, s.label);
    this.markDirty({ x: s.r.x + l.x, y: s.r.y + l.y, w: s.r.w, h: s.r.h });
    this.requestRender();
  }
  private toggleBefore(): void {
    const s = this.session;
    if (!s) return;
    s.showBefore = !s.showBefore;
    this.showResult(s, s.showBefore);
    const b = this.dlgEl.querySelector('[data-testid="adj-before"]');
    if (b) { b.setAttribute('aria-pressed', String(s.showBefore)); b.textContent = s.showBefore ? 'Showing before' : 'Show before'; }
  }
  private cancelSession(): void {
    this.tk?.abort();
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
    if (id === 'size' && !this.dpiLib) { void this.openSize(); return; }
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
    if (id === 'open-options' && this.optionsResolve) { const r = this.optionsResolve; this.optionsResolve = null; r(false); }
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
      // Resolution (DPI), print size and Resample live in export-dpi.ts, loaded before the sheet opens (openSize).
      const lib = this.dpiLib;
      if (!lib) return;
      const out = lib.sizeRows(d, { fid, w, hh, keep, note: rows[0] as HTMLElement, actions }, {
        toast: (m) => this.toast(m),
        setDpi: (make) => { this.closeModal(); this.pushCmd(make()); },
        resize: (make) => {
          const sw = d.width, sh = d.height;
          this.closeModal(); this.cancelSession(); this.hole = null; this.pushCmd(make(), true); this.updateAnts(); this.fit();
          this.onStep?.('image.size', { w: d.width, h: d.height, sw, sh });
        },
      }, maxPixelsForDevice());
      rows.unshift(out.presets);
      rows.push(...out.rows);
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
      ...exportList().map((f) => h('button', { type: 'button', class: 'fpe-chip', role: 'radio', 'aria-checked': 'false', 'data-format': f, 'data-testid': 'export-format-' + f,
        onclick: () => { this.exportFormat = f; this.renderExport(); } }, fmtInfo(f).label)));
    this.exportChips.addEventListener('keydown', (e) => {
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown', back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      if (!fwd && !back) return;
      e.preventDefault();
      const list = exportList(), n = list.length, i = list.indexOf(this.exportFormat);
      this.exportFormat = list[(i + (fwd ? 1 : n - 1)) % n];
      this.renderExport();
      focusInSheet(this.exportChips.querySelector<HTMLElement>('[aria-checked="true"]'));
    });
    const q = h('input', { id: id + 'q', type: 'range', min: 10, max: 100, step: 1, value: 92, 'data-testid': 'export-quality' });
    const qOut = h('output', { class: 'fpe-out', for: id + 'q' }, '92%');
    q.addEventListener('input', () => { this.exportQuality = Number(q.value) / 100; qOut.textContent = q.value + '%'; this.renderExport(); });
    this.qualityRow = h('div', { class: 'fpe-row', 'data-help-title': 'Quality', 'data-help': 'Higher keeps more detail and makes a bigger file.' }, h('label', { for: id + 'q' }, 'Quality'), q, qOut);
    this.lossBox = h('div', { class: 'fpe-loss', 'data-testid': 'loss-warning', 'aria-live': 'polite' });
    this.multiBox = h('input', { id: id + 'm', type: 'checkbox', 'data-testid': 'export-multi' });
    this.multiBox.addEventListener('change', () => { this.exportMulti = this.multiBox.checked; this.renderExport(); });
    this.multiText = h('label', { for: id + 'm' }, 'Make an animation: each layer is one frame');
    this.multiBox.style.flex = 'none';
    this.multiText.style.flex = '1 1 auto';
    this.multiRow = h('div', { class: 'fpe-row', 'data-help-title': 'Layers as frames or pages', 'data-help': 'Turn each layer into one frame of an animation, or into its own page.' }, this.multiBox, this.multiText);
    const dl = h('input', { id: id + 'd', type: 'number', min: 20, max: 10000, step: 10, value: 100, inputmode: 'numeric', 'data-testid': 'export-delay' });
    dl.addEventListener('input', () => { const v = Number(dl.value); if (v >= 10) this.exportDelay = Math.min(10000, Math.round(v)); });
    this.delayRow = h('div', { class: 'fpe-row', 'data-help-title': 'Time per frame', 'data-help': 'How long each frame shows, in thousandths of a second: 100 shows ten frames a second.' }, h('label', { for: id + 'd' }, 'Time per frame (ms)'), dl);
    this.dpiHost = h('div', { style: 'display:contents' });
    this.exportGo = h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'export-go', onclick: () => void this.doExport() }, 'Export');
    return h('div', { class: 'fpe-stack' },
      h('div', { class: 'fpe-row' }, h('label', { for: id + 'n' }, 'File name'), this.exportName),
      h('div', { class: 'fpe-field-col' }, h('span', { class: 'fpe-label' }, 'File type'), this.exportChips),
      this.qualityRow, this.multiRow, this.delayRow, this.lossBox, this.dpiHost,
      h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', onclick: () => this.closeModal() }, 'Cancel'), this.exportGo));
  }
  /** A sheet that asks how to open a file (the PDF page, the RAW develop step). Resolves false when closed. */
  openOptions(title: string, body: HTMLElement, ok: string): Promise<boolean> {
    if (this.optionsResolve) { const r = this.optionsResolve; this.optionsResolve = null; r(false); }
    return new Promise<boolean>((res) => {
      this.optionsResolve = res;
      const done = (v: boolean): void => { const r = this.optionsResolve; this.optionsResolve = null; this.closeModal(); r?.(v); };
      const t = this.sheets.get('open-options')?.querySelector('.fpe-sheet-title');
      if (t) t.textContent = title;
      this.optionsBody.replaceChildren(body, h('div', { class: 'fpe-actions' },
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'options-cancel', onclick: () => done(false) }, 'Cancel'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'options-ok', onclick: () => done(true) }, ok)));
      this.openModal('open-options');
    });
  }
  /**
   * Picture size, with the cursor in Resolution (DPI) when asked. "Print resolution" opens it with Resample off, so a
   * beginner who types 300 keeps every pixel and only the print size changes; ticking Resample is the pro path.
   */
  async openSize(focus?: 'dpi'): Promise<void> {
    if (!this.doc) return this.needDoc();
    try { await this.loadDpi(); } catch (e) { this.toast(errText(e, "Picture size couldn't load. Check the connection and try again.")); return; }
    this.openModal('size');
    if (!focus || this.modal !== 'size') return;
    const s = this.sheets.get('size'), re = s?.querySelector<HTMLInputElement>('[data-testid="size-resample"]');
    if (re?.checked) { re.checked = false; re.dispatchEvent(new Event('change')); }
    requestAnimationFrame(() => requestAnimationFrame(() => focusInSheet(s?.querySelector<HTMLElement>('[data-testid="size-dpi"]'))));
  }
  /** Export; `focus` opens it at the DPI choice or with Best quality ticked. */
  /** Load Export's DPI section once and put it in the sheet. */
  private loadDpi(): Promise<typeof import('./export-dpi')> {
    return (this.dpiMod ??= import('./export-dpi').then((m) => {
      this.dpiLib = m;
      this.dpiPanel ??= m.buildDpiPanel(String(this.uid), () => this.renderExport(), maxPixelsForDevice());
      if (!this.dpiPanel.el.isConnected) this.dpiHost.replaceChildren(this.dpiPanel.el);
      return m;
    }, (e: unknown) => { this.dpiMod = null; throw e; }));
  }
  async openExport(fmt?: string, multi?: boolean, focus?: 'dpi' | 'best'): Promise<void> {
    if (!this.doc) return this.needDoc();
    if (this.session) { this.toast('Apply or cancel the adjustment first.'); return; }
    try { await this.loadDpi(); } catch (e) { this.toast(errText(e, "Export couldn't load. Check the connection and try again.")); return; }
    const d = this.doc, panel = this.dpiPanel;
    if (!d || !panel) return;
    if (fmt) this.exportFormat = fmt;
    if (multi !== undefined) this.exportMulti = multi;
    this.exportFacts = docFacts(d);
    this.exportName.value = this.name;
    panel.reset(d);
    if (focus === 'best') panel.setBest(true);
    this.renderExport();
    this.openModal('export');
    if (focus) panel.focus(focus);
  }
  private renderExport(): void {
    const f = this.exportFacts, panel = this.dpiPanel;
    if (!f || !panel) return;
    const fmt = this.exportFormat, info = fmtInfo(fmt), label = info.label, kind = multiKind(fmt), def = formatDef(fmt), d = this.doc;
    const multi = this.exportMulti && !!kind && f.layers > 1;
    this.multiRow.hidden = !kind || f.layers < 2;
    this.multiText.textContent = kind === 'pages' ? 'Each layer as its own page' : 'Make an animation: each layer is one frame';
    this.multiBox.checked = this.exportMulti;
    this.delayRow.hidden = !multi || kind !== 'frames';
    panel.render(fmt, label, info.lossy, multi);
    const best = panel.choice().best, q = best ? 1 : this.exportQuality;
    const rep = def || multi ? formatLossReport(def ?? { id: fmt, label, caps: { alpha: 'full', lossy: info.lossy, multi: kind ?? undefined }, keeps: '' }, f, q, multi, d ? Math.max(d.width, d.height) : 0)
      : lossReport(f, fmt as ExportFormat, q);
    for (const b of this.exportChips.querySelectorAll<HTMLElement>('[data-format]')) {
      const on = b.dataset.format === fmt;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.qualityRow.hidden = !info.lossy || best;
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
    const d = this.doc, panel = this.dpiPanel, mod = this.dpiMod;
    if (!d || !panel || !mod) return;
    const fmt = this.exportFormat, info = fmtInfo(fmt), file = baseName(this.exportName.value || this.name) + '.' + info.ext;
    const pc = panel.choice(), bad = panel.problem(), multi = this.exportMulti && d.layers.length > 1 && !!multiKind(fmt);
    if (bad) { this.toast(bad); return; }
    const done = this.busyAfter(100);
    this.exportGo.disabled = true;
    try {
      // "Resize to a print size" redraws a copy; the picture itself keeps its pixels.
      const src = pc.resize ? (await mod).printCopy(d, pc.resize.width, pc.resize.height, pc.resize.mode) : d;
      const { blob, note } = await encodeDocument(src, fmt, pc.best ? 1 : this.exportQuality, { multi, delay: this.exportDelay, dpi: pc.dpi });
      download(blob, file, this.root);
      this.savedId = this.history.stateId();
      this.renderTabs();
      this.closeModal();
      const at = holdsDpi(fmt, multi) ? ` ${src.width} × ${src.height} px at ${n2(pc.dpi)} DPI: prints ${printText(src.width, src.height, pc.dpi)}.` : '';
      this.toast(`Saved ${file} (${fmtBytes(blob.size)}).${at}${note ? ' ' + note : ''}`);
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
      h('p', {}, `Version ${APP_VERSION}. A free photo editor that runs fully in your browser. Your pictures stay on this device: nothing is uploaded. The AI tools (remove an object, make it bigger) download their models once, then run right here on this device.`),
      h('p', { 'data-testid': 'about-offline' }, h('strong', {}, 'Works offline. '), 'After your first visit, the editor and every add-on you have used keep working without the internet. '
        + 'Install it from File, Install as an app, to open it like any other app. Safety copies of open pictures stay in this browser and are never uploaded.'),
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
  openSample(k = 1): void {
    const small = k < 1;
    this.addTab(makeSample(k), small ? 'Small sample photo' : 'Sample photo');
    this.toast(small ? 'Small sample photo opened: a landscape and a sun, small enough to make bigger in seconds.' : 'Sample photo opened: two layers, a landscape and a sun.');
  }
  private stash(): void {
    this.tk?.abort();
    const t = this.tabs[this.cur];
    if (!t || !this.doc) return;
    Object.assign(t, { doc: this.doc, history: this.history, name: this.name, savedId: this.savedId, view: this.view, fitted: this.fitted, lastSel: this.lastSel, hole: this.hole });
  }
  private load(i: number): void {
    this.cancelSession();
    this.stroke = null; this.strokeCache = null;
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
    const busy = this.busyAfter(120);
    let ended = false;
    const done = (): void => { if (!ended) { ended = true; busy(); } };
    try {
      const o = await readImageFile(file, name, { choose: (t, b, ok) => { done(); return this.openOptions(t, b, ok); } });
      if (o.kind === 'none') return;
      let bmp: Bitmap;
      if (o.kind === 'doc') {
        if (asLayer && this.doc) bmp = flatten(o.doc);
        else {
          this.addTab(o.doc, baseName(name));
          const n = o.doc.layers.length;
          this.toast(`Opened ${name}${n > 1 ? `: ${n} layers` : ''}.${o.notes.length ? ' ' + o.notes.join(' ') : ''}`, o.notes.length ? 6000 : 2800);
          return;
        }
      } else if (o.kind === 'psd') {
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
      const opened = documentFromBitmap(bmp);
      if (o.kind === 'bitmap' && o.dpi) opened.dpi = o.dpi;
      this.addTab(opened, baseName(name));
    } catch (e) {
      this.toast(errText(e, "This file couldn't be opened."));
    } finally {
      done();
    }
  }
  /** The File extras (file-more.ts), loaded on first use: open from a web link, take a photo, print, save each layer. */
  async fileMore(id: string): Promise<void> {
    try {
      const m = await import('./file-more');
      m.runFileMore(id, { ...this.toolHost(), name: () => this.name, open: (f, n) => this.openFile(f, n) });
    } catch (e) { this.toast(errText(e, "This couldn't load. Check the connection and try again.")); }
  }
  /** Recorded steps and the many-pictures functions (automate.ts), loaded on first use. */
  async automate(id: string): Promise<void> {
    try {
      const m = await import('./automate');
      m.runAutomate(id, { ...this.toolHost(), job: (s, b) => this.jobs.run(s, b), openDoc: (d, n) => this.addTab(d, n), fit: () => this.fit(), record: (f) => { this.onStep = f; } });
    } catch (e) { this.toast(errText(e, "This couldn't load. Check the connection and try again.")); }
  }
  /** More Select & cut out and Arrange layers commands (selmore.ts), loaded on first use. */
  async selMore(id: string): Promise<void> {
    try { (await import('./selmore')).runSelMore(id, this.toolHost()); } catch (e) { this.toast(errText(e, "This couldn't load. Check the connection and try again.")); }
  }
  /** Soften the last change, grey mode and turn by any angle (image-more.ts), loaded on first use. */
  async imageMore(id: string): Promise<void> {
    this.cancelSession();
    try { (await import('./image-more')).runImageMore(id, { ...this.toolHost(), lastChange: () => this.lastChange, fit: () => this.fit() }); }
    catch (e) { this.toast(errText(e, "This couldn't load. Check the connection and try again.")); }
  }
  /** Several pictures at once (dropped, opened with the installed app, or shared to it): each in its own tab, or as layers. */
  async openFiles(files: File[], asLayer = false): Promise<void> {
    for (const f of files) await this.openFile(f, f.name || 'Picture', asLayer && !!this.doc);
  }

  // ---------- offline, install and safety copies (offline.ts, autosave.ts) ----------
  private initApp(opts: MountOptions): void {
    this.appShell = new AppShell({ root: this.root, openFiles: (f) => this.openFiles(f), toast: (m, ms) => this.toast(m, ms),
      openModal: (id) => this.openModal(id), beforeReload: () => this.saver.flush() }, opts.app);
    this.installBody.replaceChildren(this.appShell.installSheet());
    this.saver = new Autosave({ pictures: () => this.pictures(), busy: () => !!(this.stroke || this.drag || this.session) });
    let on = true;
    try { on = localStorage.getItem('fpe-autosave') !== 'off'; } catch { /* storage may be blocked */ }
    this.saver.enabled = opts.autosave !== false && on && typeof indexedDB !== 'undefined';
    if (!this.saver.enabled) return;
    this.saver.start();
    const hidden = (): void => { if (document.visibilityState === 'hidden') void this.saver.flush(); };
    const gone = (): void => { void this.saver.flush(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', gone);
    this.off.push(() => document.removeEventListener('visibilitychange', hidden), () => window.removeEventListener('pagehide', gone));
    void this.saver.leftBehind().then((l) => { this.left = l; this.renderRestore(); this.syncChrome(); });
  }
  private pictures(): OpenPicture[] {
    return this.tabs.map((t, i) => (i === this.cur && this.doc ? { tab: t, doc: this.doc, name: this.name, state: this.history.stateId() }
      : { tab: t, doc: t.doc, name: t.name, state: t.history.stateId() }));
  }
  private renderRestore(): void {
    const el = this.restoreEl, list = this.left;
    el.hidden = !list.length;
    if (!list.length) { el.replaceChildren(); return; }
    el.replaceChildren(h('h3', { class: 'fpe-restore-title' }, 'Bring back your last pictures?'),
      h('p', {}, `${list.length === 1 ? 'This picture was' : 'These pictures were'} open when the editor last closed. The copies stayed in this browser; nothing left your device.`),
      h('ul', { class: 'fpe-restore-list' }, ...list.map((m) => h('li', {}, h('span', { class: 'fpe-restore-name' }, m.name),
        h('span', { class: 'fpe-restore-size' }, ` · ${m.width} × ${m.height} px${m.layers > 1 ? `, ${m.layers} layers` : ''}`)))),
      h('div', { class: 'fpe-actions' },
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'restore-discard', onclick: () => void this.discardLeft() }, 'Discard'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'restore-yes', onclick: () => void this.restoreLeft() }, 'Restore')));
  }
  hasLeft(): boolean { return this.left.length > 0; }
  /** File > Bring back last pictures, for when a picture is already open and the start screen is hidden. */
  async offerRestore(): Promise<void> {
    const list = this.left;
    if (!list.length) { this.toast('Nothing to bring back: no pictures were left open last time.'); return; }
    const a = await this.ask(`Bring back your last pictures? ${namesText(list)} ${list.length === 1 ? 'was' : 'were'} open when the editor last closed. Nothing left your device.`, 'Restore', 'Discard');
    if (a === 'primary') await this.restoreLeft();
    else if (a === 'secondary') await this.discardLeft();
  }
  async restoreLeft(): Promise<void> {
    const list = this.left;
    if (!list.length) return;
    this.left = [];
    this.renderRestore();
    try {
      const got = await this.saver.load(list);
      for (const g of got) {
        this.stash();
        this.tabs.push({ doc: g.doc, history: new History(60, historyBytesForDevice()), name: g.name, savedId: -1, view: { zoom: 1, panX: 0, panY: 0 }, fitted: true, lastSel: null, hole: null });
        this.load(this.tabs.length - 1);
      }
      await this.saver.flush();
      await this.saver.forget(list);
      this.toast(got.length === 1 ? `Brought back ${got[0].name}. Undo starts fresh from here.` : `Brought back ${got.length} pictures. Undo starts fresh from here.`, 4000);
    } catch (e) {
      this.left = list;
      this.renderRestore();
      this.toast(errText(e, "The pictures couldn't be brought back."));
    }
  }
  async discardLeft(): Promise<void> {
    const list = this.left;
    this.left = [];
    this.renderRestore();
    await this.saver.forget(list).catch(() => undefined);
    this.toast('Discarded. Those copies are gone from this browser.');
  }
  autosaveOn(): boolean { return !!this.saver?.enabled; }
  toggleAutosave(): void {
    const on = !this.saver.enabled;
    try { localStorage.setItem('fpe-autosave', on ? 'on' : 'off'); } catch { /* storage may be blocked */ }
    if (on) { this.saver.start(); this.saver.enable(); this.toast('Safety copies are on: open pictures are kept in this browser, never sent anywhere.'); }
    else { void this.saver.disable(); this.toast('Safety copies are off. Open pictures are no longer kept in this browser.'); }
  }
  canInstall(): boolean { return !!this.appShell?.enabled && !this.appShell.installed(); }
  installApp(): void { this.appShell.install(); }

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
    if (this.session?.applying) { e.preventDefault(); if (e.key === 'Escape') this.jobCancel?.(); return; }
    if (this.tk?.key(e)) { e.preventDefault(); return; }
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
        if (!l || !this.editable(l, false)) return;
        const dx = k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, dy = k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0;
        // A folder carries everything inside it. placeSpots with no offset only reads the area each node covers now.
        const spots = spotsOf(d, l.id), was = placeSpots(d, spots, 0, 0);
        this.pushCmd(moveNode(d, l.id, dx, dy, 'Move layer'));
        const now = placeSpots(d, spots, dx, dy), r = was && now ? union(was, now) : was ?? now;
        if (r) this.markDirty(r);
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
    this.placeToast();
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.removeAttribute('data-on'), ms);
  }

  /**
   * One rule for every toast: inside the picture area, never over the zoom buttons, an open dialog, a panel sheet or any bar.
   * Tried at the top of the picture area, then at its bottom, across its width or beside an open dialog.
   */
  private placeToast(): void {
    const t = this.toastEl, host = (t.offsetParent as HTMLElement | null) ?? this.root, hr = host.getBoundingClientRect(), st = this.stage.getBoundingClientRect();
    const box = (el: Element | null | undefined): DOMRect | null => {
      if (!el || (el as HTMLElement).hidden) return null;
      const cs = getComputedStyle(el), b = el.getBoundingClientRect();
      return cs.display === 'none' || cs.visibility === 'hidden' || !b.width || !b.height ? null : b;
    };
    const dlg = box(this.dlgEl);
    const avoid = [this.stage.querySelector('.fpe-zoom'), this.dlgEl, this.dock, this.toolsBar, this.optionsBar, this.root.querySelector('.fpe-top'), this.tabRow, this.ribbonEl,
      ...this.sheets.values()].map(box).filter((b): b is DOMRect => !!b);
    const pad = 8, spans: [number, number][] = [[st.left + pad, st.right - pad]];
    if (dlg) spans.push([st.left + pad, dlg.left - pad], [dlg.right + pad, st.right - pad]);
    spans.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
    Object.assign(t.style, { transform: 'none', bottom: 'auto', right: 'auto' });
    const put = (x: number, y: number): void => { t.style.left = Math.round(x - hr.left) + 'px'; t.style.top = Math.round(y - hr.top) + 'px'; };
    for (const [L, R] of spans) {
      const w = R - L;
      if (w < 140) continue;
      t.style.maxWidth = Math.min(560, w) + 'px';
      const tw = t.offsetWidth, th = t.offsetHeight, x = L + (w - tw) / 2;
      for (const y of [st.top + pad, st.bottom - pad - th]) {
        if (y < st.top || y + th > st.bottom) continue;
        if (avoid.some((a) => a.left < x + tw && a.right > x && a.top < y + th && a.bottom > y)) continue;
        put(x, y);
        return;
      }
    }
    // No clear spot (a full panel sheet covers the picture): at the very top, over the top bar, as on phones before.
    t.style.maxWidth = Math.min(560, Math.max(140, hr.width - 32)) + 'px';
    put(hr.left + (hr.width - t.offsetWidth) / 2, hr.top + 3);
  }
  /** Lets a dialog be dragged by its title bar, so it never has to cover the part of the picture being changed. */
  private dragHead(head: HTMLElement): HTMLElement {
    head.addEventListener('pointerdown', (e) => {
      const box = head.closest<HTMLElement>('.fpe-dlg');
      if (!box || e.button > 0 || (e.target as Element).closest('button, input, select, a')) return;
      const host = (box.offsetParent as HTMLElement | null) ?? this.root, hr = host.getBoundingClientRect(), b = box.getBoundingClientRect();
      const dx = e.clientX - b.left, dy = e.clientY - b.top;
      Object.assign(box.style, { left: Math.round(b.left - hr.left) + 'px', top: Math.round(b.top - hr.top) + 'px', width: Math.round(b.width) + 'px', right: 'auto', bottom: 'auto' });
      box.dataset.moved = '';
      head.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        box.style.left = Math.round(clamp(ev.clientX - hr.left - dx, 0, Math.max(0, hr.width - b.width))) + 'px';
        box.style.top = Math.round(clamp(ev.clientY - hr.top - dy, 0, Math.max(0, hr.height - b.height))) + 'px';
      };
      const up = (): void => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    return head;
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
      exportFile: async (f, q = 0.92, m = false, dl = 100) => {
        if (!this.doc) throw new Error('No picture is open.');
        return (await encodeDocument(this.doc, f, q, { multi: m, delay: dl })).blob;
      },
      commands: () => ROWS.map((r) => {
        const hd = HANDLERS[r.id];
        return { id: r.id, status: r.status, kind: r.kind, enabled: this.isEnabled(r.id), checked: hd?.checked ? hd.checked(this) : null, handler: !!hd };
      }),
      run: (id) => this.run(id),
      aiCmd: async (id) => { if (this.doc) await (await this.ai()).cmd(id); },
      selectionAt: (x, y) => { const s = this.doc?.selection; if (!s || x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) return 0; return s.alpha ? s.alpha[(y - s.y) * s.w + (x - s.x)] : 255; },
      checksum: (x, y, w, hh) => {
        const d = this.doc, r = d ? intersect({ x, y, w, h: hh }, docRect(d)) : null;
        if (!d || !r) return 0;
        const px = compositeDoc(d, r);
        let sum = 0x811c9dc5;
        for (let i = 0; i < px.length; i++) sum = Math.imul(sum ^ px[i], 0x01000193);
        return sum >>> 0;
      },
      state: () => {
        const e = this.history.entries();
        return {
          tabs: this.tabs.length, tab: this.cur, saved: !this.doc || this.history.stateId() === this.savedId, step: e.index, steps: e.labels.length,
          fg: this.brush.color, bg: this.bgColor, theme: this.root.dataset.theme, names: this.proNames, hints: this.hints, screen: this.screen, flags: { ...this.flags },
          hidden: [...this.hidden].sort(), folded: [...this.folded].sort(), panelTabs: [...this.groupActive].map((x) => x.join(':')).sort(), dockView: this.dview, dock: this.dockState, phonePanel: this.phonePanel, modal: this.modal,
          adjust: this.session?.id ?? null,
          preview: this.session ? { scale: this.session.scale, done: this.session.ran && !this.session.running, applying: this.session.applying } : null, clip: this.clip?.serial ?? null, lastSel: !!this.lastSel, lastFilter: this.lastFilter?.id ?? null, tool: this.tool,
          ratio: this.ratio, crop: this.crop, hole: this.hole, exportFormat: this.exportFormat, info: this.infoOf(),
          w3: this.tk?.state() ?? null, autoPick: this.autoPick, view: { ...this.view },
          maskTarget: !!this.active()?.mask && this.maskTarget,
          layers: this.doc ? this.doc.layers.map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.width, h: l.height, mask: l.mask ? maskSummary(l.mask) : null,
            name: l.name, kind: l.kind ?? 'pixel', parentId: l.parentId ?? null, clip: !!l.clip, open: l.open !== false, passThrough: !!l.passThrough, opacity: l.opacity, blendMode: l.blendMode })) : [],
        };
      },
      openSample: (k?: number) => this.openSample(k),
      setZoom: (z) => this.zoomTo(z),
      appState: () => ({ ...this.appShell.info(), autosave: { enabled: this.saver.enabled, writes: this.saver.writes, error: this.saver.lastError }, left: this.left.map((m) => m.name) }),
      saveNow: () => this.saver.flush(),
      flatHash: async () => {
        const d = this.doc;
        if (!d) return '';
        if (d.layers.some(hasLayerFx)) await this.layerFx();
        const dg = await crypto.subtle.digest('SHA-256', compositeDoc(d, docRect(d)) as BufferSource);
        return Array.from(new Uint8Array(dg), (b) => b.toString(16).padStart(2, '0')).join('');
      },
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
    this.dockRo.disconnect();
    this.jobs.dispose();
    this.renderer.dispose();
    this.appShell?.dispose();
    void this.saver?.flush().finally(() => this.saver.stop());
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
