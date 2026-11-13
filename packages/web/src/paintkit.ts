// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Brush extras (the paint batch, 13 Nov 2026), loaded the first time one is opened: a steady hand, symmetry, seamless
 * tile painting, and pen and speed dynamics, all in one "Brush extras" sheet. Turning one on hands the editor a maker
 * of brush strokes (core/paint-more.ts); with all off the editor goes back to its plain stroke, so the brush costs
 * nothing extra. The settings stay while the page is open and work with the brush, the pencil and the eraser.
 * Part 2 adds brush tips (built in, or made from a selection), patterns (made from a selection, to paint or fill with),
 * saved tool settings, and a thin guide on the canvas showing the symmetry lines. Tips, patterns and saved tools are
 * kept in this browser (IndexedDB, its own database), or for this visit only when the browser does not allow it.
 * Part 3 adds Fill what you circle (a lasso loop filled by a rule), Colour a line drawing (hint dabs become flat colours
 * on a layer under the line art) and Blend paint (a brush that mixes with the colour under it).
 */
import { RIG_DEFAULTS, RigStroke, applyPreset, builtInTips, colorizeCommand, colorizeFlats, encloseAmounts, layerIn, makePreset, patternAt, patternFromPixels, rigOn, tipFromPixels,
  type EncloseRule, type Pattern, type RigMirror, type RigSettings, type RigSource, type Tip, type ToolPreset } from '@free-photoeditor/core/paint-more';
import { activeLayer, addLayer, compositeDoc, createLayer, docRect, findLayer, intersect, over, paintArea, parseHex, selectionAlpha, type BrushOptions, type Doc, type Layer, type Stroke } from '@free-photoeditor/core';
import { h } from './dom';
import type { ToolHost } from './toolkit';

/** Makes the brush stroke for a layer while an extra is on; null gives the plain brush back. */
export type RigMaker = (d: Doc, l: Layer, o: BrushOptions) => Stroke | null;
export interface PaintHost extends ToolHost {
  setRig(f: RigMaker | null): void;
  /** Draws the stroke's last dabs (the steady hand finishes its line when the pointer lets go). */
  flush(): void;
  /** Draws on the overlay above the picture (the symmetry guide); null while there is nothing to draw. */
  setGuide(f: ((ctx: CanvasRenderingContext2D) => void) | null): void;
}
/** The commands this module runs; commands.ts gives each its handler. */
export const PAINT_IDS = ['paint.stabilizer', 'paint.symmetry', 'paint.wrap-around', 'paint.dynamics', 'panel.brushes', 'panel.tool-presets', 'edit.define-brush', 'edit.define-pattern', 'paint.enclose-fill', 'paint.colorize-mask'];
const SECTION: Record<string, string> = { 'paint.stabilizer': 'steady', 'paint.symmetry': 'mirror', 'paint.wrap-around': 'wrap', 'paint.dynamics': 'dyn' };

/** The settings, kept while the page is open. */
export const RIG: RigSettings = { ...RIG_DEFAULTS };
let host: PaintHost | null = null;
/** One body per sheet, refilled each time (the editor keeps the first body it is given for a sheet). */
const bodies: Record<string, HTMLElement> = {};
const holder = (id: string): HTMLElement => (bodies[id] ??= h('div', { 'data-testid': id, style: 'display:flex;flex-direction:column;gap:8px' }));

const STEADY: [RigSettings['steady'], string][] = [['off', 'Off'], ['lag', 'Smooth'], ['string', 'Pulled string']];
const MIRROR: [RigMirror, string][] = [['off', 'Off'], ['vertical', 'Left and right'], ['horizontal', 'Top and bottom'], ['both', 'Both'], ['radial', 'Around the centre']];
const SOURCE: [RigSource, string][] = [['off', 'Nothing'], ['pressure', 'Pen pressure'], ['tilt', 'Pen tilt'], ['speed', 'Speed']];
const ONOFF: [string, string][] = [['off', 'Off'], ['on', 'On']];

/** What is on now, in plain words (empty when nothing is). */
export function rigSummary(s: RigSettings): string[] {
  const on: string[] = [];
  if (s.steady !== 'off') on.push(s.steady === 'lag' ? `Steady hand (smooth ${s.lag}%)` : `Steady hand (string ${s.string} px)`);
  if (s.mirror !== 'off') on.push(s.mirror === 'radial' ? `Symmetry (${s.spokes} around the centre)` : `Symmetry (${MIRROR.find((m) => m[0] === s.mirror)?.[1].toLowerCase()})`);
  if (s.wrap) on.push('Seamless tile');
  if (s.dyn) on.push('Pen and speed');
  if (s.tip) on.push(`Tip: ${s.tip.name}`);
  if (s.pattern) on.push(`Pattern: ${s.pattern.name}`);
  if (s.spacing) on.push(`Spacing ${s.spacing}%`);
  if (s.mix) on.push(`Blend paint (wet ${s.wet ?? 50}%)`);
  return on;
}
/** Give the editor the stroke maker for the settings now (none while every extra is off). */
function apply(): void {
  const hst = host;
  if (!hst) return;
  hst.setRig(rigOn(RIG) ? (d, l, o) => new RigStroke(d, l, o, RIG, () => hst.flush()) : null);
  hst.setGuide(RIG.mirror !== 'off' ? guide : null);
}
/** The symmetry lines over the picture, 1 px, light under a dashed dark line so they show on any picture. */
function guide(ctx: CanvasRenderingContext2D): void {
  const hst = host, d = hst?.doc();
  if (!hst || !d || RIG.mirror === 'off') return;
  const v = hst.view(), z = v.zoom, m = RIG.mirror, L = v.panX, T = v.panY, R = L + d.width * z, B = T + d.height * z;
  const cx = Math.round(L + (d.width / 2) * z) + 0.5, cy = Math.round(T + (d.height / 2) * z) + 0.5;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (m === 'vertical' || m === 'both') { ctx.moveTo(cx, T); ctx.lineTo(cx, B); }
  if (m === 'horizontal' || m === 'both') { ctx.moveTo(L, cy); ctx.lineTo(R, cy); }
  if (m === 'radial') {
    const n = Math.max(2, Math.min(24, Math.round(RIG.spokes))), r = (Math.min(d.width, d.height) / 2) * z;
    for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + (2 * Math.PI * k) / n; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  }
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.stroke();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(30,80,170,.9)';
  ctx.stroke();
  ctx.restore();
}
function seg<T extends string>(label: string, help: string, opts: [T, string][], value: T, key: string, set: (v: T) => void, after: () => void = render): HTMLElement {
  const g = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': label });
  for (const [v, text] of opts) {
    g.append(h('button', { type: 'button', 'aria-pressed': String(v === value), 'data-testid': `pk-${key}-${v}`, 'data-help-title': `${label}: ${text}`, 'data-help': help,
      onclick: () => { set(v); apply(); after(); } }, text));
  }
  return h('div', { class: 'fpe-field' }, h('span', { class: 'fpe-label' }, label), g);
}
function section(id: string, plain: string, pro: string, help: string, kids: (HTMLElement | null)[]): HTMLElement {
  return h('section', { 'data-testid': 'pk-sec-' + id, id: 'pk-sec-' + id, style: 'padding:8px 0 16px' },
    h('h3', { class: 'fpe-label', style: 'font-size:14px;margin:0 0 4px' }, plain, h('span', { style: 'opacity:.7;font-weight:400' }, ' · ' + pro)),
    h('p', { class: 'fpe-note' }, help), ...kids.filter((k): k is HTMLElement => !!k));
}
function render(): void {
  const b = bodies['paint-extras'], hst = host;
  if (!b || !hst) return;
  const sl = (label: string, help: string, min: number, max: number, key: 'lag' | 'string' | 'spokes' | 'minSize' | 'minStrength' | 'jitter' | 'scatter', unit: string, testid: string): HTMLElement =>
    hst.slider(label, help, min, max, RIG[key], unit, (v) => { RIG[key] = v; apply(); status(); }, testid);
  const on = rigSummary(RIG);
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pk-status', role: 'status', 'aria-live': 'polite' },
      on.length ? 'On now: ' + on.join(', ') + '.' : 'All off: the brush paints as usual. Turn on a helper, then paint with the brush, the pencil or the eraser.'),
    on.length ? h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'pk-all-off', onclick: () => { Object.assign(RIG, { steady: 'off', mirror: 'off', wrap: false, dyn: false, tip: null, angle: 0, spacing: 0, pattern: null, mix: false }); apply(); render(); renderBrushes(); renderPatterns(); } }, 'Turn all off') : h('span'),
    section('steady', 'Steady hand', 'Stabiliser', 'Smooths a shaky hand or mouse. Smooth lets the brush trail behind the pointer; Pulled string only moves the brush once the pointer is a string\'s length away. The line always finishes where you let go.', [
      seg('Steady hand', 'How the brush follows the pointer.', STEADY, RIG.steady, 'steady', (v) => { RIG.steady = v; }),
      RIG.steady === 'lag' ? sl('Smoothing', 'More smoothing: steadier lines that trail further behind the pointer.', 0, 95, 'lag', '%', 'pk-lag') : null,
      RIG.steady === 'string' ? sl('String length', 'How far the pointer moves before the brush follows, in picture pixels.', 1, 200, 'string', ' px', 'pk-string') : null]),
    section('mirror', 'Symmetry', 'Paint symmetry', 'Paint once and the stroke is copied: mirrored across the middle of the picture, or turned around its centre like a mandala.', [
      seg('Mirror', 'Where the copies of each stroke go.', MIRROR, RIG.mirror, 'mirror', (v) => { RIG.mirror = v; }),
      RIG.mirror === 'radial' ? sl('Copies around the centre', 'How many times the stroke repeats around the centre of the picture.', 2, 24, 'spokes', '', 'pk-spokes') : null]),
    section('wrap', 'Seamless tile', 'Wrap around', 'Paint that leaves one edge comes back in at the opposite edge, so the picture repeats without a seam when you tile it.', [
      seg('Seamless tile', 'On: strokes wrap at the edges of the picture.', ONOFF, RIG.wrap ? 'on' : 'off', 'wrap', (v) => { RIG.wrap = v === 'on'; })]),
    section('dyn', 'Pen and speed', 'Brush dynamics', 'Pen pressure, pen tilt or how fast you move changes the size and strength of each dab. A mouse has no pressure or tilt: choose Speed, which thins the line as you move faster.', [
      seg('Pen and speed', 'On: the brush follows the settings below.', ONOFF, RIG.dyn ? 'on' : 'off', 'dyn', (v) => { RIG.dyn = v === 'on'; }),
      ...(RIG.dyn ? [
        seg('Size follows', 'What makes the brush smaller.', SOURCE, RIG.sizeBy, 'size', (v) => { RIG.sizeBy = v; }),
        sl('Smallest size', 'The size at the lightest press, the most tilt or the fastest move, in % of the brush size.', 0, 100, 'minSize', '%', 'pk-min-size'),
        seg('Strength follows', 'What makes the paint lighter.', SOURCE, RIG.strengthBy, 'strength', (v) => { RIG.strengthBy = v; }),
        sl('Lightest strength', 'The strength at the lightest press, the most tilt or the fastest move, in % of the brush strength.', 0, 100, 'minStrength', '%', 'pk-min-strength'),
        sl('Size jitter', 'Each dab is up to this much smaller, at random, for a rougher line.', 0, 100, 'jitter', '%', 'pk-jitter'),
        sl('Scatter', 'Each dab lands up to this many brush sizes off the line, at random, for spray and texture.', 0, 200, 'scatter', '%', 'pk-scatter')] : [])]),
    section('mix', 'Blend paint', 'Mixer brush', 'Each dab picks up the colour already under the brush and mixes it into the paint, like wet paint on a canvas.', [
      seg('Blend paint', 'On: the brush mixes with the colours under it.', ONOFF, RIG.mix ? 'on' : 'off', 'mix', (v) => { RIG.mix = v === 'on'; }),
      ...(RIG.mix ? [
        hst.slider('Wet', 'How much of the colour under the brush mixes into the paint.', 0, 100, RIG.wet ?? 50, '%', (v) => { RIG.wet = v; apply(); status(); }, 'pk-wet'),
        hst.slider('Load', 'How much fresh brush colour comes back after each dab. Low: long smears; high: mostly the brush colour.', 0, 100, RIG.load ?? 20, '%', (v) => { RIG.load = v; apply(); }, 'pk-load')] : [])]));
}
function status(): void {
  const el = bodies['paint-extras']?.querySelector('[data-testid="pk-status"]');
  const on = rigSummary(RIG);
  if (el) el.textContent = on.length ? 'On now: ' + on.join(', ') + '.' : 'All off: the brush paints as usual.';
}

// ---- Kept in this browser: tips, patterns and saved tools ----
type Kind = 'tips' | 'patterns' | 'presets';
const KINDS: Kind[] = ['tips', 'patterns', 'presets'];
let tips: Tip[] = [], pats: Pattern[] = [], presets: ToolPreset[] = [];
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((res) => {
    try {
      const r = indexedDB.open('fpe-paint', 1);
      r.onupgradeneeded = () => { for (const k of KINDS) if (!r.result.objectStoreNames.contains(k)) r.result.createObjectStore(k, { keyPath: 'name' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch { res(null); }
  }));
}
async function store(k: Kind, write: ((s: IDBObjectStore) => void) | null): Promise<unknown[]> {
  const d = await db();
  if (!d) return [];
  return new Promise((res) => {
    try {
      const t = d.transaction(k, write ? 'readwrite' : 'readonly'), s = t.objectStore(k);
      if (write) { write(s); t.oncomplete = t.onerror = () => res([]); return; }
      const q = s.getAll();
      q.onsuccess = () => res(q.result as unknown[]);
      q.onerror = () => res([]);
    } catch { res([]); }
  });
}
let loaded: Promise<void> | null = null;
const loadAll = (): Promise<void> => (loaded ??= Promise.all(KINDS.map((k) => store(k, null))).then(([a, b, c]) => {
  tips = [...(a as Tip[]), ...tips.filter((t) => !(a as Tip[]).some((x) => x.name === t.name))];
  pats = [...(b as Pattern[]), ...pats.filter((t) => !(b as Pattern[]).some((x) => x.name === t.name))];
  presets = [...(c as ToolPreset[]), ...presets.filter((t) => !(c as ToolPreset[]).some((x) => x.name === t.name))];
}));
const keep = (k: Kind, v: { name: string }): Promise<unknown> => store(k, (s) => s.put(v));
const forget = (k: Kind, name: string): Promise<unknown> => store(k, (s) => s.delete(name));
/** `base 1`, `base 2`, ... the first name not taken. */
function uniq(base: string, list: { name: string }[]): string {
  for (let n = list.length + 1; ; n++) if (!list.some((x) => x.name === `${base} ${n}`)) return `${base} ${n}`;
}
const paintTool = (t: string): t is 'brush' | 'pencil' | 'eraser' => t === 'brush' || t === 'pencil' || t === 'eraser';
function brushTool(hst: PaintHost): void { if (!paintTool(hst.tool())) hst.setTool('brush'); }
/** Open a sheet with its own body, filled now and again once saved items have loaded. */
function openSheet(id: string, title: string, fill: () => void): void {
  const hst = host;
  if (!hst) return;
  holder(id);
  fill();
  hst.sheet(id, title, bodies[id]);
  void loadAll().then(fill);
}
/** The picture inside the selection (all visible layers), with the selection's soft edge. */
function grab(hst: PaintHost, what: string): { rgba: Uint8ClampedArray; w: number; h: number; a: Uint8Array | null } | null {
  const d = hst.doc(), s = d?.selection, r = d && s ? intersect(s, docRect(d)) : null;
  if (!d || !s || !r) { hst.toast(`Select an area of the picture first, then make the ${what} from it.`); return null; }
  let a: Uint8Array | null = null;
  if (s.alpha) { a = new Uint8Array(r.w * r.h); for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) a[y * r.w + x] = selectionAlpha(s, r.x + x, r.y + y); }
  return { rgba: compositeDoc(d, r), w: r.w, h: r.h, a };
}
const btn = (text: string, testid: string, onclick: () => void, help = '', extra: Record<string, string> = {}): HTMLElement =>
  h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': testid, 'data-help-title': text, 'data-help': help || text, onclick, ...extra }, text);
function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = h('canvas', { width: '40', height: '40', style: 'width:40px;height:40px;background:#fff;border-radius:6px;border:1px solid rgba(128,128,128,.4)' });
  return [c, c.getContext('2d')];
}
function tipPreview(t: Tip | null): HTMLCanvasElement {
  const [c, x] = canvas();
  if (!x) return c;
  x.fillStyle = '#222';
  if (!t) { x.beginPath(); x.arc(20, 20, 14, 0, 2 * Math.PI); x.fill(); return c; }
  const img = new ImageData(t.w, t.h), tmp = h('canvas', { width: String(t.w), height: String(t.h) }), k = 34 / Math.max(t.w, t.h);
  for (let i = 0; i < t.w * t.h; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 34; img.data[i * 4 + 3] = t.data[i]; }
  tmp.getContext('2d')?.putImageData(img, 0, 0);
  x.drawImage(tmp, 20 - (t.w * k) / 2, 20 - (t.h * k) / 2, t.w * k, t.h * k);
  return c;
}
function patPreview(p: Pattern): HTMLCanvasElement {
  const [c, x] = canvas(), tmp = h('canvas', { width: String(p.w), height: String(p.h) });
  tmp.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.w, p.h), 0, 0);
  const f = x?.createPattern(tmp, 'repeat');
  if (x && f) { x.fillStyle = f; x.fillRect(0, 0, 40, 40); }
  return c;
}

// ---- Brush tips (panel.brushes, edit.define-brush) ----
const BUILT_IN = builtInTips();
function renderBrushes(): void {
  const b = bodies['paint-brushes'], hst = host;
  if (!b || !hst) return;
  const cur = RIG.tip?.name ?? 'Round';
  const cell = (t: Tip | null, mine: boolean): HTMLElement => {
    const name = t?.name ?? 'Round';
    return h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:4px' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'aria-pressed': String(name === cur), 'data-testid': 'pb-tip', 'data-name': name,
        'data-help-title': 'Brush tip: ' + name, 'data-help': mine ? 'A tip you made from a selection.' : 'A built-in tip.',
        style: 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;height:auto',
        onclick: () => { RIG.tip = t; brushTool(hst); apply(); renderBrushes(); } }, tipPreview(t), h('span', { style: 'font-size:12px' }, name)),
      mine ? btn('Remove', 'pb-remove', () => { if (RIG.tip?.name === name) RIG.tip = null; tips = tips.filter((x) => x.name !== name); void forget('tips', name); apply(); renderBrushes(); }, 'Remove this tip from this browser.') : null);
  };
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pb-status', role: 'status' }, `Tip now: ${cur}. Paint with the brush, the pencil or the eraser; the brush size sets the tip's longer side.`),
    h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px' }, cell(null, false), ...BUILT_IN.map((t) => cell(t, false)), ...tips.map((t) => cell(t, true))),
    h('p', { class: 'fpe-note' }, 'Make your own: select an area of the picture, then press the button. Dark parts paint, white or see-through parts do not.'),
    btn('Make a brush from the selection', 'pb-make', () => void defineBrush()),
    hst.slider('Turn', 'Turns the tip, in degrees.', 0, 359, RIG.angle ?? 0, '°', (v) => { RIG.angle = v; apply(); }, 'pb-angle'),
    hst.slider('Spacing', 'Distance between dabs in % of the size. 0 keeps the usual 12 %; more leaves gaps, for dotted or stamped lines.', 0, 300, RIG.spacing ?? 0, '%', (v) => { RIG.spacing = v; apply(); }, 'pb-spacing'));
}
async function defineBrush(): Promise<void> {
  const hst = host;
  if (!hst) return;
  openSheet('paint-brushes', 'Brush tips · Brushes', renderBrushes);
  const g = grab(hst, 'brush');
  if (!g) return;
  await loadAll();
  const t = tipFromPixels(uniq('My tip', tips), g.rgba, g.w, g.h, g.a);
  if (!t) { hst.toast('Nothing dark there to make a tip from: dark parts of the selection become the tip.'); return; }
  tips.push(t);
  RIG.tip = t;
  brushTool(hst);
  apply();
  renderBrushes();
  hst.toast(`Made the brush tip "${t.name}" and chose it. Paint with the brush.`);
  await keep('tips', t);
}

// ---- Patterns (edit.define-pattern): paint with one, or fill the selection with it ----
function renderPatterns(): void {
  const b = bodies['paint-patterns'], hst = host;
  if (!b || !hst) return;
  const cur = RIG.pattern?.name ?? '';
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pp-status', role: 'status' }, cur ? `Painting with "${cur}": the brush lays the pattern down instead of its colour.`
      : pats.length ? 'Paint with a pattern, or fill the selection with it.' : 'No patterns yet. Select an area of the picture, then press the button.'),
    btn('Make a pattern from the selection', 'pp-make', () => void definePattern()),
    ...(cur ? [btn('Paint with the brush colour again', 'pp-stop', () => { RIG.pattern = null; apply(); renderPatterns(); })] : []),
    ...pats.map((p) => h('div', { 'data-testid': 'pp-item', style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
      patPreview(p), h('span', { style: 'font-size:12px;min-width:72px' }, p.name),
      btn('Paint with it', 'pp-paint', () => { RIG.pattern = p; brushTool(hst); apply(); renderPatterns(); }, 'The brush paints this pattern instead of its colour (a pattern stamp).', { 'aria-pressed': String(p.name === cur) }),
      btn('Fill the selection with it', 'pp-fill', () => fillWith(hst, p), 'Fills the selection, or the whole layer when nothing is selected.'),
      btn('Remove', 'pp-remove', () => { if (RIG.pattern?.name === p.name) RIG.pattern = null; pats = pats.filter((x) => x !== p); void forget('patterns', p.name); apply(); renderPatterns(); }, 'Remove this pattern from this browser.'))));
}
function fillWith(hst: PaintHost, p: Pattern): void {
  const d = hst.doc(), l = d ? activeLayer(d) : undefined;
  if (!d || !l || !hst.editable(l)) return;
  const c = { r: 0, g: 0, b: 0, a: 0 };
  hst.push(paintArea(d, l, 'Fill with a pattern', null, (x, y, px, i) => over(px, i, patternAt(p, x, y, c), 1)));
  hst.all();
  hst.render();
}
async function definePattern(): Promise<void> {
  const hst = host;
  if (!hst) return;
  openSheet('paint-patterns', 'Patterns · Define pattern', renderPatterns);
  const g = grab(hst, 'pattern');
  if (!g) return;
  await loadAll();
  const p = patternFromPixels(uniq('My pattern', pats), g.rgba, g.w, g.h, g.a);
  if (!p) return;
  pats.push(p);
  renderPatterns();
  hst.toast(`Made the pattern "${p.name}". Paint with it, or fill the selection with it.`);
  await keep('patterns', p);
}

// ---- Saved tool settings (panel.tool-presets) ----
function renderPresets(): void {
  const b = bodies['paint-presets'], hst = host;
  if (!b || !hst) return;
  const t = hst.tool(), ok = paintTool(t);
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pt-status', role: 'status' }, ok ? `Saves the ${t} with its size, hardness, strength, tip and brush extras, to use again later.`
      : 'Pick the brush, the pencil or the eraser first: their settings are what this saves.'),
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'pt-save', disabled: !ok, 'data-help-title': 'Save the current tool', 'data-help': 'Keeps the tool and its settings in this browser.', onclick: () => void savePreset() }, 'Save the current tool'),
    ...(presets.length ? [] : [h('p', { class: 'fpe-note' }, 'Nothing saved yet.')]),
    ...presets.map((p) => h('div', { 'data-testid': 'pt-item', style: 'display:flex;align-items:center;gap:8px' },
      h('span', { style: 'font-size:12px;flex:1' }, p.name),
      btn('Use', 'pt-use', () => usePreset(p), 'Switch to this tool with these settings.'),
      btn('Remove', 'pt-remove', () => { presets = presets.filter((x) => x !== p); void forget('presets', p.name); renderPresets(); }, 'Remove this saved tool.'))));
}
async function savePreset(): Promise<void> {
  const hst = host, t = hst?.tool();
  if (!hst || !t || !paintTool(t)) return;
  await loadAll();
  const o = hst.paint(t), extras = rigSummary(RIG);
  const base = `${t[0].toUpperCase() + t.slice(1)} ${Math.round(o.size)} px${extras.length ? ', ' + extras.join(', ') : ''}`;
  const p = makePreset(presets.some((x) => x.name === base) ? uniq(base, presets) : base, t, o, RIG);
  presets.push(p);
  renderPresets();
  hst.toast(`Saved "${p.name}".`);
  await keep('presets', p);
}
function usePreset(p: ToolPreset): void {
  const hst = host;
  if (!hst) return;
  hst.setTool(p.tool);
  applyPreset(p, hst.paint(p.tool), RIG);
  apply();
  hst.refreshOptions();
  renderPresets();
  hst.toast(`Using "${p.name}".`);
}

// ---- Fill what you circle (paint.enclose-fill) ----
const RULES: [EncloseRule, string][] = [['all', 'Everything inside'], ['clear', 'Only empty parts of this layer'], ['colour', 'Only the colour at its middle'], ['lines', 'Between the lines']];
const EF = { rule: 'all' as EncloseRule, tol: 10, dark: 128 };
function renderEnclose(): void {
  const b = bodies['paint-enclose'], hst = host;
  if (!b || !hst) return;
  const has = !!hst.doc()?.selection;
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pe-status', role: 'status' }, has ? 'Your loop is ready. Choose what to fill inside it, then press Fill: it takes the main colour.'
      : 'Draw a loop around the area with the lasso (close this sheet, then drag around it), open this again and press Fill.'),
    seg('Fill', 'Which parts inside the loop take the main colour.', RULES, EF.rule, 'pe-rule', (v) => { EF.rule = v; }, renderEnclose),
    ...(EF.rule === 'colour' ? [hst.slider('Colour match', 'How close a colour must be to the one at the middle of the loop, in %.', 0, 100, EF.tol, '%', (v) => { EF.tol = v; }, 'pe-tol')] : []),
    ...(EF.rule === 'lines' ? [hst.slider('Line darkness', 'Pixels darker than this count as lines and are left alone (0 is black, 255 white).', 1, 255, EF.dark, '', (v) => { EF.dark = v; }, 'pe-dark')] : []),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      btn('Draw a loop', 'pe-lasso', () => { hst.setTool('lasso'); hst.closeSheet(); }, 'Switches to the lasso: drag around the area you want to fill.'),
      h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'pe-fill', 'data-help-title': 'Fill', 'data-help': 'Fills inside the loop with the main colour, by the rule above. One undo step.', onclick: () => encloseFill(hst) }, 'Fill')));
}
function encloseFill(hst: PaintHost): void {
  const d = hst.doc(), l = d ? activeLayer(d) : undefined, s = d?.selection, r = d && s ? intersect(s, docRect(d)) : null;
  if (!d || !l || !hst.editable(l)) return;
  if (!r) { hst.toast('Draw a loop with the lasso first, then press Fill.'); return; }
  const m = encloseAmounts(EF.rule, compositeDoc(d, r), layerIn(l, r), r.w, r.h, EF.tol, EF.dark);
  if (!m.includes(255)) { hst.toast('Nothing inside the loop matches that choice.'); return; }
  const c = parseHex(hst.fg()) ?? { r: 0, g: 0, b: 0, a: 255 };
  hst.push(paintArea(d, l, 'Fill what you circle', r, (x, y, px, i) => { if (m[(y - r.y) * r.w + (x - r.x)]) over(px, i, c, 1); }));
  hst.all();
  hst.render();
  hst.toast('Filled inside the loop. Undo takes it back in one step.');
}

// ---- Colour a line drawing (paint.colorize-mask) ----
const CZ = { line: '', hints: '', dark: 128, gap: 2 };
function renderColorize(): void {
  const b = bodies['paint-colorize'], hst = host, d = hst?.doc();
  if (!b || !hst) return;
  const line = d && CZ.line ? findLayer(d, CZ.line) : undefined, hints = d && CZ.hints ? findLayer(d, CZ.hints) : undefined;
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pc-status', role: 'status' }, !line ? 'Step 1: choose the layer with your line drawing in Layers, then press the first button.'
      : !hints ? `Line art: "${line.name}". Step 2: add a hints layer, then dab a little colour inside each area.`
        : `Line art: "${line.name}". Dab colours on "${hints.name}", then press Fill the areas. Areas with no dab stay empty.`),
    btn('Use the selected layer as the line art', 'pc-line', () => { const dd = hst.doc(), a = dd ? activeLayer(dd) : undefined; if (!a) return; CZ.line = a.id; CZ.hints = ''; renderColorize(); },
      'The layer with your drawing: dark lines on white paper or on a see-through layer.'),
    btn('Add a hints layer', 'pc-hints', () => addHints(hst), 'A new layer above the line art for colour dabs. It multiplies, so dabs show over white paper.'),
    hst.slider('Line darkness', 'Pixels darker than this count as lines (0 is black, 255 white).', 1, 255, CZ.dark, '', (v) => { CZ.dark = v; }, 'pc-dark'),
    hst.slider('Close gaps', 'Gaps in the lines up to this wide are closed, so colour does not leak into the next area.', 0, 8, CZ.gap, ' px', (v) => { CZ.gap = v; }, 'pc-gap'),
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'pc-fill', 'data-help-title': 'Fill the areas', 'data-help': 'Each closed area takes the colour dabbed in it, on a new layer under the line art. One undo step.',
      onclick: () => colorize(hst) }, 'Fill the areas'));
}
function addHints(hst: PaintHost): void {
  const d = hst.doc(), line = d && CZ.line ? findLayer(d, CZ.line) : undefined;
  if (!d || !line) { hst.toast('First choose the line art layer and press "Use the selected layer as the line art".'); return; }
  const l = createLayer('Colour hints', d.width, d.height);
  l.blendMode = 'multiply';
  hst.push(addLayer(d, l, d.layers.indexOf(line) + 1, 'Add a hints layer'), true);
  CZ.hints = l.id;
  hst.setTool('brush');
  hst.panels();
  hst.render();
  renderColorize();
  hst.toast('Hints layer added above the line art. Dab a colour inside each area, then press Fill the areas.');
}
function colorize(hst: PaintHost): void {
  const d = hst.doc(), line = d && CZ.line ? findLayer(d, CZ.line) : undefined, hints = d && CZ.hints ? findLayer(d, CZ.hints) : undefined;
  if (!d || !line) { hst.toast('First choose the line art layer and press "Use the selected layer as the line art".'); return; }
  if (!hints) { hst.toast('Add a hints layer and dab some colour inside the areas first.'); return; }
  const r = docRect(d), f = colorizeFlats(layerIn(line, r), layerIn(hints, r), d.width, d.height, CZ.dark, CZ.gap);
  if (!f) { hst.toast('No colour dabs found inside an area yet. Dab colour on the hints layer, away from the lines.'); return; }
  hst.push(colorizeCommand(d, line, hints, createLayer('Flat colours', d.width, d.height, { data: f })), true);
  hst.panels();
  hst.render();
  renderColorize();
  hst.toast('Filled each area on a new layer, "Flat colours", under the line art, and hid the hints. Undo takes it all back in one step.');
}

/** Open the sheet for a command: Brush extras at its own section, Brush tips, Patterns, Saved tool settings, Fill what you circle or Colour a line drawing. */
export function runPaintKit(id: string, hst: PaintHost): void {
  host = hst;
  if (id === 'panel.brushes') { brushTool(hst); openSheet('paint-brushes', 'Brush tips · Brushes', renderBrushes); }
  else if (id === 'edit.define-brush') void defineBrush();
  else if (id === 'edit.define-pattern') void definePattern();
  else if (id === 'panel.tool-presets') openSheet('paint-presets', 'Saved tool settings · Tool presets', renderPresets);
  else if (id === 'paint.enclose-fill') { if (!hst.doc()?.selection) hst.setTool('lasso'); openSheet('paint-enclose', 'Fill what you circle · Enclose and fill', renderEnclose); }
  else if (id === 'paint.colorize-mask') {
    const d = hst.doc(), a = d ? activeLayer(d) : undefined;
    if (!CZ.line && a) CZ.line = a.id;
    openSheet('paint-colorize', 'Colour a line drawing · Colorize mask', renderColorize);
  }
  else {
    brushTool(hst);
    const body = holder('paint-extras');
    render();
    hst.sheet('paint-extras', 'Brush extras · Brush settings', body);
    body.querySelector<HTMLElement>('#pk-sec-' + (SECTION[id] ?? 'steady'))?.scrollIntoView?.({ block: 'start' });
  }
  apply();
}
