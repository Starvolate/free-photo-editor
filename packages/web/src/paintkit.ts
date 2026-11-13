// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Brush extras (the paint batch, 13 Nov 2026), loaded the first time one is opened: a steady hand, symmetry, seamless
 * tile painting, and pen and speed dynamics, all in one "Brush extras" sheet. Turning one on hands the editor a maker
 * of brush strokes (core/paint-more.ts); with all off the editor goes back to its plain stroke, so the brush costs
 * nothing extra. The settings stay while the page is open and work with the brush, the pencil and the eraser.
 */
import { RIG_DEFAULTS, RigStroke, rigOn, type RigMirror, type RigSettings, type RigSource } from '@free-photoeditor/core/paint-more';
import type { BrushOptions, Doc, Layer, Stroke } from '@free-photoeditor/core';
import { h } from './dom';
import type { ToolHost } from './toolkit';

/** Makes the brush stroke for a layer while an extra is on; null gives the plain brush back. */
export type RigMaker = (d: Doc, l: Layer, o: BrushOptions) => Stroke | null;
export interface PaintHost extends ToolHost {
  setRig(f: RigMaker | null): void;
  /** Draws the stroke's last dabs (the steady hand finishes its line when the pointer lets go). */
  flush(): void;
}
/** The commands this module runs; commands.ts gives each its handler. */
export const PAINT_IDS = ['paint.stabilizer', 'paint.symmetry', 'paint.wrap-around', 'paint.dynamics'];
const SECTION: Record<string, string> = { 'paint.stabilizer': 'steady', 'paint.symmetry': 'mirror', 'paint.wrap-around': 'wrap', 'paint.dynamics': 'dyn' };

/** The settings, kept while the page is open. */
export const RIG: RigSettings = { ...RIG_DEFAULTS };
let host: PaintHost | null = null;
let body: HTMLElement | null = null;

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
  return on;
}
/** Give the editor the stroke maker for the settings now (none while every extra is off). */
function apply(): void {
  const hst = host;
  if (!hst) return;
  hst.setRig(rigOn(RIG) ? (d, l, o) => new RigStroke(d, l, o, RIG, () => hst.flush()) : null);
}
function seg<T extends string>(label: string, help: string, opts: [T, string][], value: T, key: string, set: (v: T) => void): HTMLElement {
  const g = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': label });
  for (const [v, text] of opts) {
    g.append(h('button', { type: 'button', 'aria-pressed': String(v === value), 'data-testid': `pk-${key}-${v}`, 'data-help-title': `${label}: ${text}`, 'data-help': help,
      onclick: () => { set(v); apply(); render(); } }, text));
  }
  return h('div', { class: 'fpe-field' }, h('span', { class: 'fpe-label' }, label), g);
}
function section(id: string, plain: string, pro: string, help: string, kids: (HTMLElement | null)[]): HTMLElement {
  return h('section', { 'data-testid': 'pk-sec-' + id, id: 'pk-sec-' + id, style: 'padding:8px 0 16px' },
    h('h3', { class: 'fpe-label', style: 'font-size:14px;margin:0 0 4px' }, plain, h('span', { style: 'opacity:.7;font-weight:400' }, ' · ' + pro)),
    h('p', { class: 'fpe-note' }, help), ...kids.filter((k): k is HTMLElement => !!k));
}
function render(): void {
  const b = body, hst = host;
  if (!b || !hst) return;
  const sl = (label: string, help: string, min: number, max: number, key: 'lag' | 'string' | 'spokes' | 'minSize' | 'minStrength' | 'jitter' | 'scatter', unit: string, testid: string): HTMLElement =>
    hst.slider(label, help, min, max, RIG[key], unit, (v) => { RIG[key] = v; apply(); status(); }, testid);
  const on = rigSummary(RIG);
  b.replaceChildren(
    h('p', { class: 'fpe-note', 'data-testid': 'pk-status', role: 'status', 'aria-live': 'polite' },
      on.length ? 'On now: ' + on.join(', ') + '.' : 'All off: the brush paints as usual. Turn on a helper, then paint with the brush, the pencil or the eraser.'),
    on.length ? h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'pk-all-off', onclick: () => { Object.assign(RIG, { steady: 'off', mirror: 'off', wrap: false, dyn: false }); apply(); render(); } }, 'Turn all off') : h('span'),
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
        sl('Scatter', 'Each dab lands up to this many brush sizes off the line, at random, for spray and texture.', 0, 200, 'scatter', '%', 'pk-scatter')] : [])]));
}
function status(): void {
  const el = body?.querySelector('[data-testid="pk-status"]');
  const on = rigSummary(RIG);
  if (el) el.textContent = on.length ? 'On now: ' + on.join(', ') + '.' : 'All off: the brush paints as usual.';
}

/** Open the Brush extras sheet at the command's own section. */
export function runPaintKit(id: string, hst: PaintHost): void {
  host = hst;
  const t = hst.tool();
  if (t !== 'brush' && t !== 'pencil' && t !== 'eraser') hst.setTool('brush');
  body ??= h('div', { 'data-testid': 'paint-extras', style: 'display:flex;flex-direction:column;gap:8px' });
  render();
  hst.sheet('paint-extras', 'Brush extras · Brush settings', body);
  const sec = body.querySelector<HTMLElement>('#pk-sec-' + (SECTION[id] ?? 'steady'));
  sec?.scrollIntoView?.({ block: 'start' });
  apply();
}
