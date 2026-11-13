// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shapes & text, part 3: bend text (arc, arch, bulge, wave, flag, circle) and run text along an outline. The tool kit
 * loads this file the first time one of them runs, so neither the first screen nor the tool kit carries it. The text stays
 * text: the bend is kept on the layer next to the words (core textwarp.ts) and drawn with them each time, so the words,
 * the font and the bend can all change later. Each change is one undo step.
 */
import type { Doc, Layer, VectorPath } from '@free-photoeditor/core';
import { ringPoints } from '@free-photoeditor/core/pathops';
import type { TextWarp, WarpStyle } from '@free-photoeditor/core/textwarp';
import type { ToolHost } from './toolkit';
import { h } from './dom';

/** What the tool kit lends this file: the picked text layer, its bend now, changing it (one undo step), the picked outline. */
export interface TypeKit {
  host: ToolHost;
  layer(): Layer | null;
  warp(): TextWarp | null;
  set(w: TextWarp | undefined, label: string): boolean;
  outline(d: Doc): VectorPath | null;
}
type Bend = Exclude<WarpStyle, 'path'>;
/** The bend used last (it stays for the next run in this tab). */
export const W = { style: 'arc' as Bend, bend: 50, start: 0 };
const STYLES: [Bend, string, string][] = [
  ['arc', 'Arc', 'Letters sit round part of a circle, each turned to follow it.'],
  ['arch', 'Arch', 'Letters rise and fall on the same curve but stay upright.'],
  ['bulge', 'Bulge', 'Letters in the middle grow taller; a negative bend shrinks them.'],
  ['wave', 'Wave', 'Two waves run through the words, each letter turned with them.'],
  ['flag', 'Flag', 'One and a half waves, letters upright, like a flag in the wind.'],
  ['circle', 'Circle', 'At full bend the words run right round a circle.'],
];
export const NO_TEXT = 'Pick a text layer first: add words with the Text tool (T), or pick a text layer in Layers.';
const NO_LINE = 'Draw an outline first: the words run along it. Use Draw curves (Pen), or make one from a selection in Outlines.';

/** The editor keeps the first body it is given for a sheet, so both commands refill one holder. */
let holder: HTMLElement | null = null;
function show(host: ToolHost, title: string, body: HTMLElement): void {
  holder ??= h('div', { 'data-testid': 'typewarp-holder' });
  holder.replaceChildren(body);
  host.sheet('typewarp', title, holder);
}
const row = (label: string, control: HTMLElement): HTMLElement =>
  h('label', { style: 'display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:13px' }, label, control);
function num(testid: string, v: number, min: number, max: number, step: number, set: (n: number) => void): HTMLInputElement {
  const i = h('input', { type: 'number', min, max, step, value: String(v), 'data-testid': testid, class: 'fpe-w3-num', style: 'width:96px' });
  i.addEventListener('change', () => { const n = Number(i.value); if (Number.isFinite(n)) { const c = Math.max(min, Math.min(max, n)); i.value = String(c); set(c); } });
  return i;
}
function actions(k: TypeKit, kind: string): HTMLElement {
  return h('div', { class: 'fpe-actions' },
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'typewarp-none', title: 'Take the bend off: the words go back to one straight line (one undo step).',
      onclick: () => { k.set(undefined, 'Straight text'); k.host.closeSheet(); } }, 'Straight again'),
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'typewarp-done', 'data-kind': kind, onclick: () => k.host.closeSheet() }, 'Done'));
}

/** Bend text, or run it along the picked outline: at once with the last settings, then the sheet to try others. */
export function runTypeWarp(id: string, k: TypeKit): void {
  const host = k.host, d = host.doc();
  if (!d) return;
  if (!k.layer()) { host.toast(NO_TEXT); return; }
  if (id === 'type.path') { onLine(k, d); return; }
  const go = (): void => { if (!k.set({ style: W.style, bend: W.bend }, 'Bend text')) host.toast(NO_TEXT); };
  go();
  const btns: HTMLElement[] = STYLES.map(([s, label, help]) => h('button', {
    type: 'button', class: 'fpe-btn', 'aria-pressed': String(s === W.style), 'data-testid': 'typewarp-' + s, title: help,
    onclick: () => { W.style = s; for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.testid === 'typewarp-' + s)); go(); },
  }, label));
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.warp', style: 'display:grid;gap:8px;min-width:min(340px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' }, 'Bend the words. They stay words: change them with the Text tool any time and the bend follows.'),
    h('div', { role: 'group', 'aria-label': 'Kind of bend', style: 'display:flex;flex-wrap:wrap;gap:6px' }, ...btns),
    row('How far (−100 to 100; below 0 bends the other way)', num('typewarp-bend', W.bend, -100, 100, 5, (n) => { W.bend = n; go(); })),
    actions(k, 'warp'));
  show(host, 'Bend text (Warp text)', body);
}

/** Run the words along the picked outline: its first piece with two or more points. */
function onLine(k: TypeKit, d: Doc): void {
  const host = k.host, p = k.outline(d), sub = p?.subpaths.find((s) => s.anchors.length > 1);
  if (!p || !sub) { host.toast(NO_LINE); return; }
  const path = ringPoints(sub), closed = sub.closed;
  const go = (): void => { if (!k.set({ style: 'path', bend: 0, path, closed, start: W.start }, 'Text along a line')) host.toast(NO_TEXT); };
  go();
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.path', style: 'display:grid;gap:8px;min-width:min(340px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' },
      `The words run along “${p.name}”${closed ? ', round the ring' : ''}. Letters past the end of an open line are hidden: start earlier, or make the text smaller. The words stay words.`),
    row('Start along the line (pixels)', num('typepath-start', W.start, 0, 100000, 10, (n) => { W.start = n; go(); })),
    actions(k, 'path'));
  show(host, 'Text along a line (Type on a path)', body);
}
