// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Develop RAW sheet (13 Nov 2026): one sheet with sections (Light, Colour, Detail, Lens, Effects, Check, Saved),
 * one live preview and one undo step on Apply, for any photo. Each raw.* command opens it at its own section, so the
 * ribbon's promise holds. Every slider shows its plain name, then its pro name. commands.ts loads this file the first
 * time a develop command runs (RAW_IDS); the maths is core/fx/raw.ts, which the worker loads with the other effects.
 */
import { ADJ, RAW_IDS, type AdjDef, type Ctl, type SheetApi } from './commands';
import { renderControls } from './controls';
import { h } from './dom';
import { HANDLES, type HandleSet } from './handles';

const N = (plain: string, pro: string): string => (pro && pro !== plain ? `${plain} · ${pro}` : plain);
const R = (key: string, plain: string, pro: string, help: string, min: number, max: number, value: number, step = 1, unit = ''): Ctl =>
  ({ key, label: N(plain, pro), help, min, max, value, step, unit });
const SEL = (key: string, plain: string, pro: string, help: string, options: readonly string[], value = 0): Ctl => ({ key, label: N(plain, pro), help, value, type: 'select', options });
const CHK = (key: string, plain: string, pro: string, help: string, value = 0): Ctl => ({ key, label: N(plain, pro), help, value, type: 'check' });

/** The sections, in order, each with its groups: a group's title is its plain name, then its pro name. */
export const SECTIONS = ['Light', 'Colour', 'Detail', 'Lens', 'Effects', 'Check', 'Saved'] as const;
export type Section = (typeof SECTIONS)[number];
interface Group { section: Section; title: string; ctls: Ctl[]; }
const BAND_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
const BAND_DOTS = ['#d33', '#e8801a', '#d9c21c', '#3a3', '#2bb', '#36d', '#83c', '#c3a'];

const G = (section: Section, title: string, ctls: Ctl[]): Group => ({ section, title, ctls: ctls.map((c) => ({ ...c, group: title })) });
export const GROUPS: Record<string, Group> = {
  negative: G('Light', N('Film negative', 'Negative to positive'), [
    CHK('neg', 'Turn a negative into a photo', 'Negative inversion', 'For a scan or photo of a film negative: removes the orange film base and turns it positive.')]),
  wb: G('Light', N('Light colour', 'White balance'), [
    R('wbT', 'Light was warm or cool', 'Temperature', 'Set the colour of the light the photo was taken in, in kelvin; lower cools a too-orange picture.', 2000, 12000, 6500, 50, ' K'),
    R('wbTint', 'Green or pink', 'Tint', 'Left adds green, right adds pink (magenta).', -100, 100, 0),
    CHK('wbPick', 'Pick a grey spot', 'Grey picker', 'Then click something in the picture that should be grey or white; the light is worked out from it.'),
    R('gx', 'Grey spot across', 'Picker x', 'Where the grey spot is, from the left edge, in percent.', 0, 100, 50, 1, '%'),
    R('gy', 'Grey spot down', 'Picker y', 'Where the grey spot is, from the top edge, in percent.', 0, 100, 50, 1, '%')]),
  points: G('Light', N('Black and white', 'Black and white points'), [
    R('bp', 'Darkest becomes black', 'Black point', 'Every tone this dark or darker becomes pure black.', 0, 100, 0),
    R('wp', 'Brightest becomes white', 'White point', 'Every tone this bright or brighter becomes pure white.', 150, 255, 255)]),
  curve: G('Light', N('Starting curve', 'Base curve'), [
    SEL('base', 'Curve shape', 'Base curve', 'A first brightness curve: more contrast darkens the darks and brightens the lights.', ['None', 'Gentle', 'Medium', 'Strong', 'Film-like'])]),
  hs: G('Light', N('Bright and dark areas', 'Highlights and shadows'), [
    R('hl', 'Bright areas', 'Highlights', 'Left calms bright areas so their detail shows; right brightens them.', -100, 100, 0),
    R('sh', 'Dark areas', 'Shadows', 'Right opens up dark areas; left deepens them.', -100, 100, 0)]),
  zones: G('Light', N('Brightness by zone', 'Tone equalizer'), [
    R('teB', 'Blacks', 'Zone 1', 'Brighten or darken the very darkest tones, up to two stops.', -100, 100, 0),
    R('teS', 'Darks', 'Zone 2', 'Brighten or darken the dark tones, up to two stops.', -100, 100, 0),
    R('teM', 'Middle tones', 'Zone 3', 'Brighten or darken the middle tones, up to two stops.', -100, 100, 0),
    R('teH', 'Lights', 'Zone 4', 'Brighten or darken the light tones, up to two stops.', -100, 100, 0),
    R('teW', 'Whites', 'Zone 5', 'Brighten or darken the very brightest tones, up to two stops.', -100, 100, 0)]),
  haze: G('Light', N('Haze', 'Dehaze'), [R('haze', 'Clear the haze', 'Dehaze', 'Right lifts fog and haze; left adds a soft haze.', -100, 100, 0)]),
  mixer: G('Colour', N('One colour at a time', 'Colour mixer'), BAND_NAMES.flatMap((b, k) => [
    R('mH' + k, `${b}: shift`, 'Hue', `Turn the ${b.toLowerCase()} colours towards their neighbours on the colour wheel.`, -100, 100, 0),
    R('mS' + k, `${b}: strength`, 'Saturation', `Make the ${b.toLowerCase()} colours stronger or weaker.`, -100, 100, 0),
    R('mL' + k, `${b}: lightness`, 'Luminance', `Make the ${b.toLowerCase()} colours lighter or darker.`, -100, 100, 0)])),
  wheels: G('Colour', N('Colour wheels', 'Colour grading'), [
    R('gSh', 'Colour of the darks', 'Shadows hue', 'Which colour tints the dark tones, round the colour wheel.', 0, 360, 210, 1, '°'),
    R('gSa', 'Darks tint', 'Shadows amount', 'How strongly the dark tones take that colour.', 0, 100, 0, 1, '%'),
    R('gMh', 'Colour of the middle', 'Midtones hue', 'Which colour tints the middle tones.', 0, 360, 40, 1, '°'),
    R('gMa', 'Middle tint', 'Midtones amount', 'How strongly the middle tones take that colour.', 0, 100, 0, 1, '%'),
    R('gHh', 'Colour of the lights', 'Highlights hue', 'Which colour tints the light tones.', 0, 360, 35, 1, '°'),
    R('gHa', 'Lights tint', 'Highlights amount', 'How strongly the light tones take that colour.', 0, 100, 0, 1, '%'),
    R('gBal', 'Darks or lights first', 'Balance', 'Left lets the darks colour more of the picture; right lets the lights.', -100, 100, 0)]),
  clarity: G('Detail', N('Punch', 'Clarity'), [R('clar', 'Mid-size punch', 'Clarity', 'Adds or softens contrast in mid-size detail, most in the middle tones.', -100, 100, 0)]),
  levels: G('Detail', N('Detail by size', 'Contrast levels'), [
    R('clvF', 'Fine texture', 'Fine', 'More or less contrast in the finest texture.', -100, 100, 0),
    R('clvM', 'Medium detail', 'Medium', 'More or less contrast in medium-size shapes.', -100, 100, 0),
    R('clvL', 'Large shapes', 'Coarse', 'More or less contrast between large areas.', -100, 100, 0)]),
  noise: G('Detail', N('Grain', 'Noise reduction'), [
    R('dn', 'Smooth grain', 'Luminance noise', 'Measures the grain in this photo and smooths it, keeping edges. No AI.', 0, 100, 0),
    R('dnC', 'Smooth colour speckles', 'Colour noise', 'Calms coloured speckles in dark or high-ISO photos.', 0, 100, 0)]),
  capture: G('Detail', N('Capture sharpening', 'Deconvolution'), [
    R('cs', 'Undo softness', 'Amount', 'Rounds of deconvolution that undo slight lens and sensor blur.', 0, 100, 0),
    R('csR', 'Blur size', 'Radius', 'How wide the softness was; most cameras need under 1 pixel.', 0.3, 3, 0.8, 0.1, ' px')]),
  hot: G('Detail', N('Stuck bright dots', 'Hot pixels'), [
    CHK('hot', 'Remove stuck dots', 'Hot pixel removal', 'Hides single pixels much brighter than all their neighbours.'),
    R('hotT', 'How bright a dot must be', 'Threshold', 'Lower finds fainter dots; higher only the brightest.', 5, 100, 40, 1, '%')]),
  fish: G('Lens', N('Fisheye to flat', 'De-fish'), [
    CHK('fish', 'Flatten a fisheye', 'De-fish', 'Makes curved lines from a fisheye lens straight.'),
    R('fov', 'Lens view', 'Field of view', 'How wide the fisheye saw across the corners, in degrees.', 100, 220, 180, 1, '°')]),
  level: G('Lens', N('Level', 'Upright'), [
    SEL('up', 'Level by itself', 'Auto upright', 'Finds the strongest straight lines and levels the picture by them.', ['Off', 'Level automatically']),
    R('ang', 'Turn by hand', 'Straighten angle', 'Turn the picture a little; it zooms in just enough to hide the corners.', -15, 15, 0, 0.1, '°')]),
  vignette: G('Effects', N('Dark or light corners', 'Post-crop vignette'), [
    R('vig', 'Corners darker or lighter', 'Amount', 'Left darkens the corners, right lightens them.', -100, 100, 0),
    R('vMid', 'How far in', 'Midpoint', 'Higher keeps the change closer to the corners.', 0, 100, 50),
    R('vRound', 'Shape', 'Roundness', 'Right makes it a circle, left a rounded box.', -100, 100, 0),
    R('vFea', 'Softness', 'Feather', 'How gently it fades in.', 0, 100, 50)]),
  clip: G('Check', N('Burnt and crushed areas', 'Clipping warning'), [
    CHK('clip', 'Show burnt and crushed areas', 'Clipping overlay', 'Marks pure white in red and pure black in blue while you edit; Apply never keeps the marks.')]),
  scopes: G('Check', N('Tone and colour scopes', 'Waveform and vectorscope'), []),
  snapshots: G('Saved', N('Snapshots', 'Snapshots'), []),
  presets: G('Saved', N('My looks', 'Presets'), []),
};
/** Where each command opens the sheet. */
export const FOCUS: Record<string, string> = {
  'raw.white-balance': 'wb', 'raw.highlights': 'hs', 'raw.black-white-points': 'points', 'raw.clarity': 'clarity', 'raw.dehaze': 'haze',
  'raw.vignette': 'vignette', 'raw.colour-mixer': 'mixer', 'raw.colour-grading': 'wheels', 'raw.contrast-levels': 'levels', 'raw.tone-equalizer': 'zones',
  'raw.base-curve': 'curve', 'raw.hot-pixels': 'hot', 'raw.capture-sharpen': 'capture', 'raw.denoise-profiled': 'noise', 'raw.defish': 'fish',
  'raw.upright': 'level', 'raw.clipping': 'clip', 'raw.scopes': 'scopes', 'raw.snapshots': 'snapshots', 'raw.presets': 'presets', 'raw.negative': 'negative',
};
export const CONTROLS: Ctl[] = Object.values(GROUPS).flatMap((g) => g.ctls);
const KEYS = CONTROLS.map((c) => c.key);

// ---------- snapshots and presets ----------
export interface Look { name: string; params: Record<string, number>; }
/** Keeps a look under its name (a same-named one is replaced), newest first, at most 20. */
export function keepLook(list: readonly Look[], name: string, params: Record<string, number | undefined>): Look[] {
  const clean = name.trim().slice(0, 40) || 'Look', p: Record<string, number> = {};
  for (const k of KEYS) { const v = params[k]; if (typeof v === 'number' && Number.isFinite(v)) p[k] = v; }
  return [{ name: clean, params: p }, ...list.filter((l) => l.name !== clean)].slice(0, 20);
}
/** Puts a kept look's settings back (settings it does not name go back to rest). */
export function recallLook(look: Look, params: Record<string, number | undefined>): void {
  for (const c of CONTROLS) params[c.key] = look.params[c.key] ?? c.value;
}
let snaps: Look[] = [];
const PRESET_KEY = 'fpe-develop-presets';
let presetsMem: Look[] = [];
function loadPresets(): Look[] {
  try { const v = JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') as Look[]; if (Array.isArray(v)) presetsMem = v.filter((l) => l && typeof l.name === 'string' && l.params); } catch { /* memory copy */ }
  return presetsMem;
}
function savePresets(list: Look[]): void { presetsMem = list; try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { /* kept for this visit */ } }

// ---------- scopes ----------
/**
 * Scope counts on a W x H grid. Waveform (mode 0): each column of the picture lands in its column of the grid, at the
 * height of its brightness. Vectorscope (mode 1): each pixel lands at its colour's direction and strength (Cb right, Cr up).
 */
export function scopeCounts(data: Uint8ClampedArray, w: number, hh: number, mode: number, W: number, H: number): Uint32Array {
  const out = new Uint32Array(W * H), stepPx = Math.max(1, Math.floor(Math.sqrt((w * hh) / 60000)));
  for (let y = 0; y < hh; y += stepPx) for (let x = 0; x < w; x += stepPx) {
    const i = (y * w + x) * 4;
    if (!data[i + 3]) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    let cx: number, cy: number;
    if (mode === 0) { cx = Math.min(W - 1, Math.floor((x / w) * W)); cy = Math.round((1 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) * (H - 1)); }
    else {
      const cb = -0.1146 * r - 0.3854 * g + 0.5 * b, cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
      cx = Math.round((W - 1) / 2 + cb * (W - 2)); cy = Math.round((H - 1) / 2 - cr * (H - 2));
    }
    out[cy * W + cx]++;
  }
  return out;
}
let scopeMode = 0;
function drawScope(c: HTMLCanvasElement, api: SheetApi): void {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const res = api.result(), W = c.width, H = c.height, counts = scopeCounts(res.data, res.width, res.height, scopeMode, W, H);
  let max = 1;
  for (const v of counts) if (v > max) max = v;
  const ink = getComputedStyle(c).color || '#888', img = ctx.createImageData(W, H), m = /(\d+)\D+(\d+)\D+(\d+)/.exec(ink), rgb = m ? [+m[1], +m[2], +m[3]] : [136, 136, 136];
  for (let i = 0; i < counts.length; i++) if (counts[i]) { img.data.set(rgb, i * 4); img.data[i * 4 + 3] = 60 + Math.round(195 * Math.sqrt(counts[i] / max)); }
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(img, 0, 0);
}

// ---------- the sheet ----------
let tab: Section = 'Light', band = 0, sessionParams: object | null = null, focusGroup = '';
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function lookList(kind: 'snap' | 'preset', api: SheetApi): HTMLElement {
  const list = kind === 'snap' ? snaps : loadPresets(), title = kind === 'snap' ? GROUPS.snapshots.title : GROUPS.presets.title;
  const name = h('input', { type: 'text', maxlength: 40, value: kind === 'snap' ? `Snapshot ${snaps.length + 1}` : `My look ${list.length + 1}`,
    'aria-label': kind === 'snap' ? 'Snapshot name' : 'Look name', 'data-testid': `dev-${kind}-name` }) as HTMLInputElement;
  const save = h('button', { type: 'button', class: 'fpe-btn', 'data-testid': `dev-${kind}-keep`, onclick: () => {
    if (kind === 'snap') snaps = keepLook(snaps, name.value, api.params); else savePresets(keepLook(loadPresets(), name.value, api.params));
    api.rerender();
  } }, kind === 'snap' ? 'Keep a snapshot' : 'Save as my look');
  const items = list.map((l) => h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': `dev-${kind}-item`,
    'data-help-title': l.name, 'data-help': kind === 'snap' ? 'Go back to these settings.' : 'Apply this look to the picture.',
    onclick: () => { recallLook(l, api.params); api.rerender(); api.input(); } }, l.name));
  return h('div', { class: 'fpe-dev-looks', 'data-testid': `dev-${kind}s` }, h('h3', { class: 'fpe-group-title', 'data-group-title': title }, title),
    h('p', { class: 'fpe-note' }, kind === 'snap' ? 'Keep the settings as they are now under a name, and go back to them any time while this page is open.'
      : 'Save your settings as a look you can apply to any photo; looks stay in this browser.'),
    h('div', { class: 'fpe-row' }, name, save), items.length ? h('div', { class: 'fpe-dev-items' }, ...items) : h('p', { class: 'fpe-note' }, 'None kept yet.'));
}
function sheet(api: SheetApi): Node[] {
  if (api.params !== sessionParams) {
    sessionParams = api.params;
    const g = GROUPS[FOCUS[api.id] ?? 'wb'];
    tab = g.section; focusGroup = g.title; band = 0;
  }
  const tabs = h('div', { class: 'fpe-seg fpe-dev-tabs', role: 'tablist', 'aria-label': 'Develop sections' }, ...SECTIONS.map((s) =>
    h('button', { type: 'button', role: 'tab', class: 'fpe-btn fpe-btn-ghost', 'aria-selected': s === tab ? 'true' : 'false', 'aria-pressed': s === tab ? 'true' : 'false',
      'data-testid': 'dev-tab-' + slug(s), onclick: () => { tab = s; focusGroup = ''; api.rerender(); } }, s)));
  const body: Node[] = [];
  const hooks = { input: () => api.input(), rerender: () => api.rerender() };
  for (const [key, g] of Object.entries(GROUPS)) {
    if (g.section !== tab) continue;
    if (key === 'mixer') {
      const pick = h('div', { class: 'fpe-seg fpe-dev-bands', role: 'group', 'aria-label': 'Colour band' }, ...BAND_NAMES.map((b, k) =>
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'aria-pressed': k === band ? 'true' : 'false', 'data-testid': 'dev-band-' + k, title: b,
          onclick: () => { band = k; api.rerender(); } }, h('span', { class: 'fpe-dev-dot', style: `background:${BAND_DOTS[k]}` }), b)));
      body.push(h('h3', { class: 'fpe-group-title', 'data-group-title': g.title }, g.title), pick,
        ...renderControls(g.ctls.filter((c) => c.key.slice(2) === String(band)).map((c) => ({ ...c, group: undefined })), api.params, api.idBase, hooks));
    } else if (key === 'scopes') {
      const c = h('canvas', { class: 'fpe-histo', width: 256, height: 128, 'aria-label': scopeMode ? 'Vectorscope of the colours' : 'Waveform of the tones, left to right', 'data-testid': 'dev-scope' }) as HTMLCanvasElement;
      const mode = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Scope' }, ...['Waveform', 'Vectorscope'].map((m, k) =>
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'aria-pressed': k === scopeMode ? 'true' : 'false', 'data-testid': 'dev-scope-' + k,
          onclick: () => { scopeMode = k; api.rerender(); } }, m)));
      body.push(h('h3', { class: 'fpe-group-title', 'data-group-title': g.title }, g.title), mode, c,
        h('p', { class: 'fpe-note' }, scopeMode ? 'Each dot is a colour: further from the middle is stronger, and its direction is its hue.'
          : 'Left to right as in the picture; higher is brighter. A flat line at the top or bottom means burnt or crushed areas.'));
      api.onResult(() => drawScope(c, api));
      requestAnimationFrame(() => drawScope(c, api));
    } else if (key === 'snapshots') body.push(lookList('snap', api));
    else if (key === 'presets') body.push(lookList('preset', api));
    else body.push(...renderControls(g.ctls, api.params, api.idBase, hooks));
  }
  const sec = h('div', { class: 'fpe-dev-section', role: 'tabpanel', 'aria-label': tab, 'data-testid': 'dev-section-' + slug(tab) }, ...body);
  if (focusGroup) {
    const want = focusGroup;
    requestAnimationFrame(() => {
      const head = [...sec.querySelectorAll<HTMLElement>('.fpe-group-title')].find((e) => (e.dataset.groupTitle ?? e.textContent) === want);
      head?.setAttribute('data-focus', 'true');
      head?.scrollIntoView({ block: 'start' });
      let n = head?.nextElementSibling;
      // One frame later, after the dialog has focused its first control: the command's own first control takes the focus.
      requestAnimationFrame(() => {
        while (n && !n.matches('.fpe-group-title')) { const f = n.matches('input, select, button') ? n as HTMLElement : n.querySelector<HTMLElement>('input, select, button'); if (f) { f.focus({ preventScroll: true }); break; } n = n.nextElementSibling; }
      });
    });
    focusGroup = '';
  }
  return [tabs, sec];
}

/** The grey picker: with "Pick a grey spot" on, a press on the picture moves the spot there; its handle can be dragged too. */
const spot: HandleSet = {
  draw(p, b) {
    if (!p.wbPick) return { guides: [], handles: [] };
    return { guides: [], handles: [{ key: 'grey', x: b.x + ((p.gx ?? 50) / 100) * b.w, y: b.y + ((p.gy ?? 50) / 100) * b.h, big: true }] };
  },
  drag(_k, x, y, p, b) { p.gx = Math.round(Math.max(0, Math.min(100, ((x - b.x) / Math.max(1, b.w)) * 100))); p.gy = Math.round(Math.max(0, Math.min(100, ((y - b.y) / Math.max(1, b.h)) * 100))); },
  press(x, y, p, b) {
    if (!p.wbPick || x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) return false;
    spot.drag('grey', x, y, p, b);
    return true;
  },
};
HANDLES.spot = spot;

// The sheet's few styles load with it, so the first screen never carries them.
if (typeof document !== 'undefined' && !document.getElementById('fpe-dev-css')) {
  document.head.append(h('style', { id: 'fpe-dev-css' }, `.fpe-dev-tabs,.fpe-dev-bands{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.fpe-dev-tabs .fpe-btn,.fpe-dev-bands .fpe-btn{font-size:12px;padding:4px 8px;min-height:28px}
.fpe-dev-tabs [aria-pressed="true"],.fpe-dev-bands [aria-pressed="true"]{background:var(--sel,var(--line));font-weight:600}
.fpe-dev-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.fpe-dev-section{display:flex;flex-direction:column;gap:4px}
.fpe-dev-items{display:flex;flex-wrap:wrap;gap:4px}
.fpe-dev-looks input[type=text]{flex:1;min-width:0;font-size:13px}`));
}

const DEV = (id: string): AdjDef => ({ op: 'fx', kind: 'develop', handles: 'spot', sheet, viewOnly: ['clip'],
  // The clipping warning opens switched on, so the command shows its marks at once.
  controls: id === 'raw.clipping' ? CONTROLS.map((c) => (c.key === 'clip' ? { ...c, value: 1 } : c)) : CONTROLS });
for (const id of RAW_IDS) ADJ[id] = DEV(id);
