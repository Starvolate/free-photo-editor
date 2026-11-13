// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The Tone curve layer's graph (UI-D, the approved a-deep layout): five points, from the darks on the left to the lights on
 * the right, that drag up to brighten and down to darken; a ready shape to start from; and one curve for all colours plus
 * one each for red, green and blue. It loads with the layer's Properties (layerprops.ts), never on the first screen. The
 * five "Simple" sliders are the same all-colours points, so the two always agree.
 */
import { curveLut, type Doc } from '@free-photoeditor/core';
import { h } from './dom';

/** Where the five points sit, darks to lights (the engine's own inputs, core tone.ts). */
export const XS = [0, 64, 128, 192, 255] as const;
export type Chan = 'p' | 'r' | 'g' | 'b';
/** Each curve: its key prefix, plain name and pro name. 'p' is the all-colours curve the five sliders also move. */
export const CHANS: readonly (readonly [Chan, string, string])[] = [['p', 'All colours', 'RGB'], ['r', 'Red', 'Red channel'], ['g', 'Green', 'Green channel'], ['b', 'Blue', 'Blue channel']];
/** Ready shapes to start from, as the five points' values. */
export const PRESETS: readonly (readonly [string, readonly number[]])[] = [
  ['No change', [0, 64, 128, 192, 255]],
  ['Gentle lift', [0, 72, 140, 200, 255]],
  ['More contrast', [0, 52, 128, 204, 255]],
  ['Less contrast', [16, 74, 128, 182, 240]],
  ['Lighter', [0, 84, 152, 212, 255]],
  ['Darker', [0, 46, 104, 172, 255]],
  ['Faded blacks', [36, 80, 132, 194, 255]],
];
const STEP: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 16, PageDown: -16 };
const NAMES = ['Blacks', 'Shadows', 'Middle tones', 'Lights', 'Whites'];
const INK: Record<Chan, string> = { p: 'var(--accent)', r: '#d9665f', g: '#4fa86a', b: '#5b8ae6' };

/** The five values of one curve; a point never set keeps its place on the straight line (no change). */
export function pointsOf(params: Record<string, number | undefined>, c: Chan): number[] {
  return XS.map((x, i) => { const v = params[c + i]; return typeof v === 'number' && Number.isFinite(v) ? v : x; });
}
/** Which ready shape these values are, or -1 for a shape of the person's own. */
export const presetIndex = (ys: readonly number[]): number => PRESETS.findIndex(([, p]) => p.every((v, i) => v === ys[i]));
/** The value a point takes at `frac` of the graph's height from its top: the top is white (255), the bottom black (0). */
export const valueAt = (frac: number): number => Math.round(255 * (1 - Math.min(1, Math.max(0, frac))));
const plain = (ys: readonly number[]): boolean => ys.every((v, i) => v === XS[i]);

/** How many sampled pixels have each value, for all colours (brightness) and each of red, green and blue. */
function sample(d: Doc | null): Record<Chan, Uint32Array> | null {
  if (!d?.width || !d.height) return null;
  const out: Record<Chan, Uint32Array> = { p: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  const ls = d.layers.filter((l) => l.visible && (!l.kind || l.kind === 'pixel') && l.data), step = Math.max(1, Math.floor(Math.max(d.width, d.height) / 128));
  for (let y = 0; y < d.height; y += step) for (let x = 0; x < d.width; x += step) {
    let r = 0, g = 0, b = 0, cov = 0;
    for (const l of ls) {
      const lx = x - l.x, ly = y - l.y;
      if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) continue;
      const j = (ly * l.width + lx) * 4, a = (l.data[j + 3] / 255) * l.opacity;
      r = l.data[j] * a + r * (1 - a); g = l.data[j + 1] * a + g * (1 - a); b = l.data[j + 2] * a + b * (1 - a); cov = a + cov * (1 - a);
    }
    if (cov < 0.02) continue;
    r = Math.min(255, Math.round(r / cov)); g = Math.min(255, Math.round(g / cov)); b = Math.min(255, Math.round(b / cov));
    out.r[r]++; out.g[g]++; out.b[b]++; out.p[(r * 54 + g * 183 + b * 19) >> 8]++;
  }
  return out;
}

const CSS = `.fpe-mask-props .fpe-curve-head{justify-content:space-between;flex-wrap:wrap}
.fpe-curve-head .fpe-mask-head{margin:0}
.fpe-curve-head select{min-width:0;max-width:60%}
.fpe-mask-props .fpe-curve-chan{flex-wrap:nowrap;gap:0;min-height:0;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.fpe-curve-chan button{flex:1 1 0;min-width:0;height:28px;padding:0 4px;border:0;background:none;color:var(--muted);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.fpe-curve-chan button+button{border-left:1px solid var(--line)}
.fpe-curve-chan button[aria-pressed=true]{background:var(--sel);color:var(--text);font-weight:600}
.fpe-curve{margin:4px 0 0;padding:8px 8px 0;border:1px solid var(--line);border-radius:6px;background:var(--input)}
.fpe-curve-plot{position:relative;height:112px;touch-action:none;cursor:ns-resize}
.fpe-curve-plot svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
.fpe-curve-pt{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;padding:0;border-radius:50%;border:2px solid var(--text);background:var(--panel);cursor:ns-resize}
.fpe-curve-pt[aria-current=true]{background:var(--accent-bg);border-color:var(--accent-fg)}
.fpe-curve-pt:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fpe-curve-axis{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--dim);padding:8px 0 6px}
.fpe-mask-props .fpe-curve-read{gap:16px;font-size:12px;color:var(--muted);flex-wrap:nowrap}
.fpe-curve-read b{color:var(--text);font-weight:600}
.fpe-curve-simple>summary{cursor:pointer;font-size:12px;color:var(--muted);padding:6px 0}
.fpe[data-layout=phone] .fpe-curve{padding:14px 14px 0}
.fpe[data-layout=phone] .fpe-curve-pt{width:28px;height:28px;margin:-14px 0 0 -14px}`;

const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
const Y = (v: number): string => (128 - (v / 255) * 128).toFixed(1);
const lineOf = (lut: Uint8ClampedArray): string => { let d = ''; for (let t = 0; t < 256; t++) d += (t ? 'L' : 'M') + t + ',' + Y(lut[t]); return d; };
const areaOf = (hist: Uint32Array | undefined): string => {
  if (!hist) return '';
  const max = Math.max(1, ...hist);
  let d = 'M0,128';
  for (let t = 0; t < 256; t++) d += 'L' + t + ',' + (128 - Math.sqrt(hist[t] / max) * 120).toFixed(1);
  return d + 'L255,128Z';
};

/** The curve a person sees and the one a point move changes; kept here so a redraw of the panel keeps them. */
let shown: Chan = 'p', active = 2;

export interface CurveHost {
  doc(): Doc | null;
  /** A live change, not yet one undo step. */
  input(): void;
  /** Letting go: one undo step. */
  commit(): void;
}

/**
 * The graph's parts for the Properties panel, in order: the name with its ready shapes, the colour switch, the graph and
 * the before-and-after line. `sync()` redraws them after the Simple sliders move.
 */
export function curveEditor(params: Record<string, number | undefined>, host: CurveHost, name: string, pro: string): { parts: HTMLElement[]; sync(): void } {
  if (!document.getElementById('fpe-curve-css')) document.head.append(h('style', { id: 'fpe-curve-css' }, CSS));
  const hist = sample(host.doc());
  const preset = h('select', { 'data-testid': 'curve-preset', 'aria-label': 'Start from a ready shape (preset)', 'data-help-title': 'Start from a ready shape · Preset',
    'data-help': 'Sets the five points of the curve you see to a ready shape. Change any point afterwards.' },
  ...PRESETS.map(([n], k) => h('option', { value: k }, n)), h('option', { value: 'own', disabled: true }, 'Your own shape'));
  preset.addEventListener('change', () => {
    const p = PRESETS[Number(preset.value)];
    if (!p) return;
    p[1].forEach((v, i) => { params[shown + i] = v; });
    host.input();
    host.commit();
    redraw();
  });
  const chans = CHANS.map(([c, n, pn]) => h('button', { type: 'button', 'data-testid': 'curve-chan-' + c, 'aria-pressed': 'false', 'data-help-title': `${n} · ${pn}`,
    'data-help': c === 'p' ? 'The curve changes the brightness of every colour together.' : `The curve changes only the ${n.toLowerCase()} in the picture, to warm, cool or tint it.`,
    onclick: () => { shown = c; redraw(); } }, n));
  const grid = s('path', { d: 'M64,0V128M128,0V128M192,0V128M0,32H255M0,64H255M0,96H255', fill: 'none', stroke: 'var(--line)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  const base = s('path', { d: 'M0,128L255,0', fill: 'none', stroke: 'var(--dim)', 'stroke-width': 1, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' });
  const area = s('path', { d: '', fill: 'var(--dim)', 'fill-opacity': 0.28 });
  const others = (['p', 'r', 'g', 'b'] as Chan[]).map((c) => s('path', { d: '', fill: 'none', stroke: INK[c], 'stroke-width': 1.5, 'stroke-opacity': 0.5, 'vector-effect': 'non-scaling-stroke' }));
  const line = s('path', { d: '', fill: 'none', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
  const svg = s('svg', { viewBox: '0 0 255 128', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  svg.append(grid, area, base, ...others, line);
  const pts = XS.map((_, i) => {
    const b = h('button', { type: 'button', class: 'fpe-curve-pt', role: 'slider', 'data-testid': 'curve-pt-' + i, 'aria-label': NAMES[i] + ' point',
      'aria-valuemin': 0, 'aria-valuemax': 255, 'aria-orientation': 'vertical' });
    let keyed = false;
    b.addEventListener('focus', () => { active = i; redraw(); });
    b.addEventListener('keydown', (e) => {
      const d = STEP[e.key];
      if (!d) return;
      e.preventDefault();
      set(i, pointsOf(params, shown)[i] + (e.shiftKey ? d * 10 : d));
      keyed = true;
    });
    b.addEventListener('keyup', () => { if (keyed) { keyed = false; host.commit(); } });
    return b;
  });
  const plot = h('div', { class: 'fpe-curve-plot' }, svg, ...pts);
  let drag = -1;
  const fromY = (clientY: number): number => { const r = plot.getBoundingClientRect(); return valueAt((clientY - r.top) / Math.max(1, r.height)); };
  plot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = plot.getBoundingClientRect(), fx = ((e.clientX - r.left) / Math.max(1, r.width)) * 255;
    let i = 0;
    for (let k = 1; k < XS.length; k++) if (Math.abs(XS[k] - fx) < Math.abs(XS[i] - fx)) i = k;
    e.preventDefault();
    drag = i;
    plot.setPointerCapture(e.pointerId);
    pts[i].focus({ preventScroll: true });
    set(i, fromY(e.clientY));
  });
  plot.addEventListener('pointermove', (e) => { if (drag >= 0) set(drag, fromY(e.clientY)); });
  const end = (): void => { if (drag < 0) return; drag = -1; host.commit(); };
  plot.addEventListener('pointerup', end);
  plot.addEventListener('pointercancel', end);
  const before = h('b', {}), after = h('b', {});
  const read = h('div', { class: 'fpe-row fpe-curve-read', 'data-testid': 'curve-readout', 'aria-live': 'polite' }, h('span', {}, 'Before ', before), h('span', {}, 'After ', after));
  function set(i: number, v: number): void {
    const n = Math.round(Math.min(255, Math.max(0, v)));
    active = i;
    if (pointsOf(params, shown)[i] === n) { redraw(); return; }
    params[shown + i] = n;
    host.input();
    redraw();
  }
  function redraw(): void {
    const ys = pointsOf(params, shown);
    chans.forEach((b, k) => b.setAttribute('aria-pressed', String(CHANS[k][0] === shown)));
    area.setAttribute('d', areaOf(hist?.[shown]));
    others.forEach((p, k) => { const c = CHANS[k][0], o = pointsOf(params, c); p.setAttribute('d', c === shown || plain(o) ? '' : lineOf(curveLut(o))); });
    line.setAttribute('d', lineOf(curveLut(ys)));
    line.setAttribute('stroke', INK[shown]);
    pts.forEach((b, i) => {
      b.style.left = (XS[i] / 255) * 100 + '%';
      b.style.top = (1 - ys[i] / 255) * 100 + '%';
      b.setAttribute('aria-valuenow', String(ys[i]));
      b.setAttribute('aria-valuetext', `${NAMES[i]}: ${XS[i]} becomes ${ys[i]}`);
      b.setAttribute('aria-current', String(i === active));
    });
    before.textContent = String(XS[active]);
    after.textContent = String(ys[active]);
    const k = presetIndex(ys);
    preset.value = k < 0 ? 'own' : String(k);
  }
  const head = h('div', { class: 'fpe-row fpe-curve-head' }, h('span', { class: 'fpe-mask-head' }, name + ' ', h('small', { class: 'fpe-pro' }, pro)), preset);
  const chan = h('div', { class: 'fpe-row fpe-curve-chan', role: 'group', 'aria-label': 'Which colours the curve changes', 'data-testid': 'curve-channels' }, ...chans);
  const graph = h('div', { class: 'fpe-curve', 'data-testid': 'curve-graph', 'data-help-title': 'Tone curve graph · Curves',
    'data-help': 'Drag a point up to brighten those tones or down to darken them: darks on the left, lights on the right. The shaded hills show how much of the picture has each tone.' },
  plot, h('div', { class: 'fpe-curve-axis', 'aria-hidden': 'true' }, h('span', {}, 'Darks'), h('span', {}, 'Middle tones'), h('span', {}, 'Lights')));
  redraw();
  return { parts: [head, chan, graph, read], sync: redraw };
}
