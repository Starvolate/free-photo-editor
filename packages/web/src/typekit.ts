// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shapes & text, part 3: bend text (arc, arch, bulge, wave, flag, circle) and run text along an outline. The tool kit
 * loads this file the first time one of them runs, so neither the first screen nor the tool kit carries it. The text stays
 * text: the bend is kept on the layer next to the words (core textwarp.ts) and drawn with them each time, so the words,
 * the font and the bend can all change later. Each change is one undo step.
 */
import { combineCommands, currentContent, newPathId, type Command, type Doc, type Layer, type Placed, type TextContent, type TextStyle, type VectorPath } from '@free-photoeditor/core';
import { ringPoints, traceAlpha } from '@free-photoeditor/core/pathops';
import { applyLook, replaceText, STRETCHES, type LookPart, type TextWarp, type WarpStyle } from '@free-photoeditor/core/textwarp';
import type { ToolHost } from './toolkit';
import { h } from './dom';

/** What the tool kit lends this file: the picked text layer, its bend now, changing it (one undo step), the picked outline. */
export interface TypeKit {
  host: ToolHost;
  layer(): Layer | null;
  warp(): TextWarp | null;
  set(w: TextWarp | undefined, label: string): boolean;
  outline(d: Doc): VectorPath | null;
  /** Part 4: draw words to pixels; redraw a text layer and give back its undo step; restyle the picked text (one step). */
  render(c: TextContent): Placed;
  change(l: Layer, next: TextContent, label: string): Command;
  restyle(patch: Partial<TextStyle>): void;
  style(): TextStyle;
  /** Add a traced outline and pick it (one step); make the next new words up-down; finish an open text edit. */
  addPath(p: VectorPath, label: string): void;
  vertical(): void;
  commit(): void;
}
type Bend = Exclude<WarpStyle, 'path' | 'vertical' | 'shape'>;
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

const NO_WORDS = 'There are no words to look through yet: add some with the Text tool (T) first.';

/** Every type command the tool kit hands this file. */
export function runType(id: string, k: TypeKit): void {
  const host = k.host, d = host.doc();
  if (!d) return;
  if (id === 'type.warp' || id === 'type.path') { runTypeWarp(id, k); return; }
  if (id === 'type.find') { findSheet(k); return; }
  if (id === 'type.styles') { looksSheet(k); return; }
  if (id === 'type.add-vertical') {
    if (k.layer()) { if (k.set({ style: 'vertical', bend: 0 }, 'Up-down text')) host.toast('The letters now run top to bottom. Bend text, Straight again, lays them back in a line.'); return; }
    k.vertical();
    host.toast('Click the picture and type: the letters run top to bottom, and each new line starts a column to the left.');
    return;
  }
  if (!k.layer()) { host.toast(NO_TEXT); return; }
  if (id === 'type.smooth') smoothSheet(k);
  else if (id === 'type.to-shape') toShape(k);
  else if (id === 'type.opentype') fontSheet(k);
  else if (id === 'type.in-shape') inShape(k, d);
}

/** Find and replace (kept for the next run in this tab). Capitals are ignored unless "Match capitals" is ticked. */
export const F = { find: '', put: '', matchCase: false };
const texts = (d: Doc): Layer[] => d.layers.filter((l) => l.content?.kind === 'text');
function findSheet(k: TypeKit): void {
  const host = k.host;
  k.commit();
  const d = host.doc();
  if (!d || !texts(d).length) { host.toast(NO_WORDS); return; }
  const box = (testid: string, label: string, v: string): HTMLInputElement => h('input', { type: 'text', value: v, 'data-testid': testid, 'aria-label': label, style: 'width:180px' });
  const find = box('typefind-find', 'Find', F.find), put = box('typefind-put', 'Replace with', F.put);
  const mc = h('input', { type: 'checkbox', 'data-testid': 'typefind-case' });
  mc.checked = F.matchCase;
  const out = h('p', { 'data-testid': 'typefind-result', role: 'status', style: 'margin:0;font-size:13px' }, '');
  const go = (): void => {
    F.find = find.value; F.put = put.value; F.matchCase = mc.checked;
    const dd = host.doc();
    if (!dd) return;
    if (!F.find) { out.textContent = 'Type the words to find first.'; return; }
    const steps: Command[] = [];
    let places = 0, emptied = 0;
    for (const l of texts(dd)) {
      const c = currentContent(l);
      if (c?.kind !== 'text') continue;
      const r = replaceText(c.text, F.find, F.put, F.matchCase);
      if (!r.count) continue;
      // A text layer is never emptied: it would vanish. Those are left as they are, and said so.
      if (!r.text.trim()) { emptied++; continue; }
      places += r.count;
      steps.push(k.change(l, { ...c, text: r.text }, 'Find and replace'));
    }
    const skip = emptied ? ` ${emptied} text layer${emptied === 1 ? ' was' : 's were'} left alone, as nothing would be left of ${emptied === 1 ? 'it' : 'them'}.` : '';
    if (!steps.length) { out.textContent = `No text layer has “${F.find}”${F.matchCase ? ' with those capitals' : ''}.` + skip; return; }
    host.push(steps.length === 1 ? steps[0] : combineCommands('Find and replace', steps), true);
    out.textContent = `Changed ${places} place${places === 1 ? '' : 's'} in ${steps.length} text layer${steps.length === 1 ? '' : 's'}. Undo (Ctrl+Z) puts them all back at once.` + skip;
  };
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.find', style: 'display:grid;gap:8px;min-width:min(340px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' }, 'Change words in every text layer at once. The layers stay text.'),
    row('Find', find), row('Replace with', put), row('Match capitals (Match case)', mc), out,
    h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'typewarp-done', onclick: () => k.host.closeSheet() }, 'Done'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'typefind-go', onclick: go }, 'Replace all')));
  show(host, 'Find and replace text', body);
}

/** Smooth or sharp letter edges. Opening it switches the picked words to the other one at once; the sheet switches back. */
function smoothSheet(k: TypeKit): void {
  k.restyle({ smooth: k.style().smooth === false });
  const set = (on: boolean): void => {
    k.restyle({ smooth: on });
    for (const b of btns) b.setAttribute('aria-pressed', String((b.dataset.testid === 'typesmooth-on') === on));
  };
  const on = k.style().smooth !== false;
  const btns = [
    h('button', { type: 'button', class: 'fpe-btn', 'aria-pressed': String(on), 'data-testid': 'typesmooth-on', title: 'Letter edges blend softly into the picture.', onclick: () => set(true) }, 'Smooth edges'),
    h('button', { type: 'button', class: 'fpe-btn', 'aria-pressed': String(!on), 'data-testid': 'typesmooth-off', title: 'Every pixel is either text or not: crisp for pixel art and tiny icons.', onclick: () => set(false) }, 'Sharp edges'),
  ];
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.smooth', style: 'display:grid;gap:8px;min-width:min(340px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' }, 'Smooth edges blend the letters into the picture. Sharp edges keep every pixel either text or not, for pixel art. Each switch is one undo step.'),
    h('div', { role: 'group', 'aria-label': 'Letter edges', style: 'display:flex;flex-wrap:wrap;gap:6px' }, ...btns),
    h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'typewarp-done', onclick: () => k.host.closeSheet() }, 'Done')));
  show(k.host, 'Text edges (Anti-aliasing)', body);
}

/** Trace the letters into an outline: the words drawn up to 4 times larger, their edge traced and brought back to size. */
function toShape(k: TypeKit): void {
  k.commit();
  const l = k.layer(), c = l ? currentContent(l) : null;
  if (!l || c?.kind !== 'text') { k.host.toast(NO_TEXT); return; }
  const s = Math.max(1, Math.min(4, Math.floor(Math.sqrt(16e6 / Math.max(1, l.width * l.height)))));
  const w = c.warp;
  const big: TextContent = {
    ...c, x: c.x * s, y: c.y * s, style: { ...c.style, size: c.style.size * s, letterSpacing: c.style.letterSpacing * s },
    ...(w ? { warp: { ...w, ...(w.path ? { path: w.path.map((p) => ({ x: p.x * s, y: p.y * s })) } : {}), ...(w.start ? { start: w.start * s } : {}) } } : {}),
  };
  const px = k.render(big), a = new Uint8Array(px.width * px.height);
  for (let i = 0; i < a.length; i++) a[i] = px.data[i * 4 + 3];
  const subs = traceAlpha(a, px.width, px.height, px.x / s, px.y / s, s, 0.4);
  if (!subs.length) { k.host.toast('These words have no letters to trace, only spaces.'); return; }
  const name = 'Letters: ' + c.text.trim().split('\n')[0].slice(0, 24);
  k.addPath({ id: newPathId(), name, subpaths: subs }, 'Text into a shape');
  k.host.toast(`“${name}” is an outline now, in Outlines: reshape it with Draw curves (Pen), fill it or draw its line. The text layer stays as it was.`);
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

// ---- Saved text looks (Character and paragraph styles) ---------------------------------------------------------------
/** The looks saved in this browser: a name and a whole text style. They stay for later visits when the browser allows it. */
export const LOOKS: { name: string; style: TextStyle }[] = [];
const LOOK_KEY = 'fpe-text-looks';
let loaded = false;
function loadLooks(): void {
  if (loaded) return;
  loaded = true;
  try { const v = JSON.parse(localStorage.getItem(LOOK_KEY) ?? '[]'); if (Array.isArray(v)) for (const x of v) if (x && typeof x.name === 'string' && x.style) LOOKS.push(x); } catch { /* private window: this tab only */ }
}
function saveLooks(): void { try { localStorage.setItem(LOOK_KEY, JSON.stringify(LOOKS)); } catch { /* kept for this tab */ } }
const PARTS: [LookPart, string, string][] = [
  ['all', 'Everything', 'Font, size, colour, weight, spacing, alignment and line gap.'],
  ['letters', 'Only the letters (Character style)', 'Font, size, colour, weight and spacing; each layer keeps its alignment and line gap.'],
  ['lines', 'Only the lines (Paragraph style)', 'Alignment and line gap; each layer keeps its letters.'],
];
const L = { part: 'all' as LookPart };
/** A chip behind a look's name that its colour reads on: light behind dark colours, dark behind light ones. */
function chipFor(color: string): string {
  let hex = color.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, '$&$&');
  const n = /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0x808080;
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 140 ? '#1a1f29' : '#eef0f3';
}
function looksSheet(k: TypeKit): void {
  const host = k.host;
  k.commit();
  loadLooks();
  const d = host.doc();
  if (!k.layer() && !LOOKS.length) { host.toast(NO_TEXT); return; }
  if (!k.layer()) host.toast('No text layer is picked: a look you use now is kept for the next words you type.');
  const name = h('input', { type: 'text', 'data-testid': 'typelook-name', 'aria-label': 'Name for this look', placeholder: 'Title, Caption…', style: 'width:180px' });
  const out = h('p', { 'data-testid': 'typelook-result', role: 'status', style: 'margin:0;font-size:13px' }, '');
  const list = h('div', { 'data-testid': 'typelook-list', style: 'display:grid;gap:6px' });
  const btn = (testid: string, text: string, title: string, run: () => void): HTMLElement =>
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': testid, title, onclick: run }, text);
  const useOn = (i: number, every: boolean): void => {
    const look = LOOKS[i], dd = host.doc();
    if (!look || !dd) return;
    if (!every) {
      const l = k.layer(), c = l ? currentContent(l) : null;
      k.restyle(applyLook(c?.kind === 'text' ? c.style : k.style(), look.style, L.part));
      out.textContent = l ? `“${look.name}” is on the picked words.` : `Your next words will use “${look.name}”.`;
      return;
    }
    const steps: Command[] = [];
    for (const l of texts(dd)) {
      const c = currentContent(l);
      if (c?.kind === 'text') steps.push(k.change(l, { ...c, style: applyLook(c.style, look.style, L.part) }, 'Use a text look'));
    }
    if (!steps.length) { out.textContent = NO_WORDS; return; }
    host.push(steps.length === 1 ? steps[0] : combineCommands('Use a text look', steps), true);
    out.textContent = `“${look.name}” is on ${steps.length} text layer${steps.length === 1 ? '' : 's'}. Undo (Ctrl+Z) puts them all back at once.`;
  };
  const paint = (): void => {
    list.replaceChildren(...(LOOKS.length ? LOOKS.map((lk, i) => {
      const st = lk.style;
      // The name is shown in its own look (at a readable size), so the list reads like a menu of styles.
      const sample = h('span', { 'data-testid': 'typelook-sample', style: `flex:0 1 auto;min-width:0;max-width:100%;padding:2px 10px;border-radius:999px;background:${chipFor(st.color)};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-family:${JSON.stringify(st.font)};font-weight:${st.weight ?? (st.bold ? 700 : 400)};font-style:${st.italic ? 'italic' : 'normal'};color:${st.color}` }, lk.name);
      return h('div', { 'data-testid': 'typelook-row', style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2)' },
        sample,
        btn('typelook-use', 'Use on picked', 'Put this look on the picked text layer (one undo step).', () => useOn(i, false)),
        btn('typelook-all', 'Use on every text layer', 'Put this look on every text layer at once (one undo step).', () => useOn(i, true)),
        btn('typelook-delete', 'Remove', 'Forget this look (text that has it keeps it).', () => { LOOKS.splice(i, 1); saveLooks(); paint(); }));
    }) : [h('p', { style: 'margin:0;font-size:13px' }, 'No looks saved yet: pick some styled words and save their look.')]));
  };
  const save = (): void => {
    const l = k.layer(), c = l ? currentContent(l) : null;
    if (c?.kind !== 'text') { out.textContent = NO_TEXT; return; }
    const n = name.value.trim() || `Look ${LOOKS.length + 1}`, at = LOOKS.findIndex((x) => x.name === n);
    const st = { ...c.style };
    if (at >= 0) LOOKS[at] = { name: n, style: st }; else LOOKS.push({ name: n, style: st });
    saveLooks();
    paint();
    out.textContent = `Saved “${n}”. Use it on other text layers below.`;
  };
  const part = h('select', { 'data-testid': 'typelook-part', 'aria-label': 'What a look changes', onchange: () => { L.part = part.value as LookPart; } },
    ...PARTS.map(([v, text, help]) => h('option', { value: v, title: help }, text)));
  part.value = L.part;
  paint();
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.styles', style: 'display:grid;gap:8px;min-width:min(380px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' }, 'Save how some words look (font, size, colour, spacing, alignment) under a name, then put that look on other text with one click. Saved looks stay in this browser.'),
    row('Name', name),
    h('div', { class: 'fpe-actions' }, btn('typelook-save', 'Save the picked words\u2019 look', 'Keep the picked text layer\u2019s look under this name.', save)),
    row('What a look changes', part), list, out,
    h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'typewarp-done', onclick: () => host.closeSheet() }, 'Done')));
  show(host, 'Text looks (Character and paragraph styles)', body);
}

// ---- Weight, width and font features (Variable fonts and OpenType features) -----------------------------------------
const WIDTH_NAMES = ['Narrowest', 'Very narrow', 'Narrow', 'A little narrow', 'Normal', 'A little wide', 'Wide', 'Very wide', 'Widest'];
function fontSheet(k: TypeKit): void {
  const st = k.style(), weight = st.weight ?? (st.bold ? 700 : 400);
  const shown = h('output', { 'data-testid': 'typefont-weight-out', style: 'min-width:3ch;font-size:13px' }, String(weight));
  const w = h('input', { type: 'range', min: 100, max: 900, step: 50, value: String(weight), 'data-testid': 'typefont-weight', 'aria-label': 'Weight', style: 'width:160px' });
  w.addEventListener('input', () => { shown.textContent = w.value; });
  w.addEventListener('change', () => { const n = Number(w.value); k.restyle({ weight: n, bold: n >= 600 }); });
  const width = h('select', { 'data-testid': 'typefont-width', 'aria-label': 'Letter width', onchange: () => k.restyle({ stretch: Number(width.value) }) },
    ...STRETCHES.map(([pct], i) => h('option', { value: String(pct) }, `${WIDTH_NAMES[i]} (${pct}%)`)));
  width.value = String(STRETCHES.find(([pct]) => pct === (st.stretch ?? 100))?.[0] ?? 100);
  const kern = h('input', { type: 'checkbox', 'data-testid': 'typefont-kerning', onchange: () => k.restyle({ kerning: kern.checked }) });
  kern.checked = st.kerning !== false;
  const caps = h('select', { 'data-testid': 'typefont-caps', 'aria-label': 'Small capitals', onchange: () => k.restyle({ caps: caps.value as TextStyle['caps'] }) },
    h('option', { value: 'normal' }, 'Off'), h('option', { value: 'small-caps' }, 'Small letters as small capitals'), h('option', { value: 'all-small-caps' }, 'Every letter a small capital'));
  caps.value = st.caps ?? 'normal';
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.opentype', style: 'display:grid;gap:8px;min-width:min(380px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' }, 'Thicker or thinner letters, narrower or wider ones, and the font\u2019s own extras. Each change is one undo step.'),
    row('Weight: thin 100 to heavy 900 (Font weight)', h('span', { style: 'display:flex;gap:6px;align-items:center' }, w, shown)),
    row('Letter width (Width axis)', width),
    row('Fit letter pairs (Kerning)', kern),
    row('Small capitals (Small caps)', caps),
    h('p', { style: 'margin:0;font-size:12px;opacity:.8' }, 'Variable fonts take any weight; others jump to their nearest face. Width works only when the font has narrow or wide faces. Joined letters and alternate shapes (ligatures and stylistic sets) are not offered: a browser canvas cannot switch them, so fonts keep their standard ones.'),
    h('div', { class: 'fpe-actions' }, h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'typewarp-done', onclick: () => k.host.closeSheet() }, 'Done')));
  show(k.host, 'Weight, width and font extras (Variable fonts and OpenType)', body);
}

// ---- Text that fills a shape (Shape text) ---------------------------------------------------------------------------
const NO_SHAPE = 'Draw a closed outline first: the words fill it. Use the shape tools or Draw curves (Pen), or make one from a selection in Outlines.';
function inShape(k: TypeKit, d: Doc): void {
  const host = k.host, p = k.outline(d), sub = p?.subpaths.find((s) => s.closed && s.anchors.length > 2);
  if (!p || !sub) { host.toast(NO_SHAPE); return; }
  const path = ringPoints(sub);
  if (!k.set({ style: 'shape', bend: 0, path, closed: true }, 'Text in a shape')) { host.toast(NO_TEXT); return; }
  const body = h('div', { 'data-testid': 'typewarp-sheet', 'data-cmd': 'type.in-shape', style: 'display:grid;gap:8px;min-width:min(340px,100%)' },
    h('p', { style: 'margin:0;font-size:13px' },
      `The words fill “${p.name}”, line by line from its top, each line as wide as the shape is there. Words that do not fit are hidden: make the text smaller or the shape bigger. Change alignment in Text style. The words stay words.`),
    actions(k, 'shape'));
  show(host, 'Text that fills a shape (Shape text)', body);
}
