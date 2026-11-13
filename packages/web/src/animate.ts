// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Animation, loaded the first time it is used: Make animation frames, and the Animation timeline under the picture.
 * One frame model, the export's own (formats/util `framesOf`): frame n is layer n, bottom first, and its time on screen is
 * written in the layer's name, as "Waves (120 ms)". How many times it plays is the picture's `loop` (none = forever,
 * 1 = once), which the GIF, PNG and WebP animation export read. Playing never changes the picture: it runs in the
 * timeline's own preview, so nothing is saved or undone by it.
 * The pure parts (names, making frames, showing one, moving one, the loop step) are exported for the unit tests.
 */
import { combineCommands, moveLayer, setLayerProps, type Command, type Doc, type Layer } from '@free-photoeditor/core';
import { delayOf } from '@free-photoeditor/formats/util';
import { h } from './dom';
import { toImageData } from './io';
import type { ToolHost } from './toolkit';

export const DEFAULT_DELAY = 100;
const TAIL = /\s*\(\d+\s*ms\)\s*$/i;
/** A frame's own name, without its time. */
export const frameName = (name: string): string => name.replace(TAIL, '') || 'Frame';
/** A time the export can keep: 20 ms to 10 s, in steps of 10 ms (GIF counts hundredths of a second). */
export const clampDelay = (ms: number): number => (Number.isFinite(ms) ? Math.min(10000, Math.max(20, Math.round(ms / 10) * 10)) : DEFAULT_DELAY);
export const withDelay = (name: string, ms: number): string => `${frameName(name)} (${clampDelay(ms)} ms)`;
/** Why these layers can't be frames, or null. Each frame is one layer, so folders are opened out first. */
export function cannotFrame(d: Doc): string | null {
  if (d.layers.length < 2) return 'Add a second layer first: each layer becomes one frame.';
  if (d.layers.some((l) => l.parentId || l.kind === 'folder')) return 'Take the layers out of folders first: each frame is one layer.';
  return null;
}
/** Make animation frames: every layer gets its time in its name (a time it already has is kept), and only frame 1 shows. */
export function makeFrames(d: Doc, delay = DEFAULT_DELAY): Command | null {
  if (cannotFrame(d)) return null;
  return combineCommands('Make animation frames', d.layers.map((l, i) => setLayerProps(d, l.id, { name: withDelay(l.name, delayOf(l.name, delay)), visible: i === 0 })));
}
/** A new time on screen for one frame. */
export function setDelay(d: Doc, id: string, ms: number): Command | null {
  const l = d.layers.find((x) => x.id === id);
  return l ? setLayerProps(d, id, { name: withDelay(l.name, ms) }, 'Frame time') : null;
}
/** Show only frame i, to look at it or paint on it, as one undo step. */
export const showOnly = (d: Doc, i: number): Command | null =>
  combineCommands(`Show frame ${i + 1}`, d.layers.map((l, k) => setLayerProps(d, l.id, { visible: k === i })));
/** Move frame `from` to place `to` (0 = first). */
export const moveFrame = (d: Doc, from: number, to: number): Command | null => (cannotFrame(d) ? null : moveLayer(d, from, to));
/** How many times the animation plays: 0 = forever, 1 = once. Kept on the picture for the export. */
export function setLoop(d: Doc, plays: number): Command | null {
  const before = d.loop ?? 0, after = Math.max(0, Math.round(plays) || 0);
  if (before === after) return null;
  const put = (x: Doc, v: number): void => { if (v) x.loop = v; else delete x.loop; };
  put(d, after);
  return { label: after === 1 ? 'Play once' : 'Play forever', bytes: 0, undo: (x) => put(x, before), redo: (x) => put(x, after) };
}

/** One layer alone, scaled into a canvas the shape of the picture: a frame's thumbnail or the preview. */
function drawFrame(c: HTMLCanvasElement, d: Doc, l: Layer | undefined, box: number): void {
  const s = box / Math.max(d.width, d.height), w = Math.max(1, Math.round(d.width * s)), hh = Math.max(1, Math.round(d.height * s));
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, hh);
  if (!l || l.width < 2 && l.height < 2) return;
  const src = document.createElement('canvas');
  src.width = l.width; src.height = l.height;
  src.getContext('2d')?.putImageData(toImageData({ width: l.width, height: l.height, data: l.data }), 0, 0);
  ctx.globalAlpha = l.opacity;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, l.x * s, l.y * s, l.width * s, l.height * s);
  src.width = 0;
}

const CSS = `.fpe-tl{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:8px 16px;border-top:1px solid var(--line);background:var(--panel);color:var(--text);font-size:13px;max-height:40%;overflow:auto}
.fpe-tl-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fpe-tl-head select{height:32px;border:1px solid var(--line);border-radius:6px;background:var(--input);color:var(--text);padding:0 8px;font:inherit}
.fpe-tl-pro,.fpe-tl-count,.fpe-tl-row{color:var(--muted);font-size:12px}
.fpe-tl-sp{flex:1}
.fpe-tl-body{display:flex;gap:16px;align-items:flex-start;min-width:0}
.fpe-tl canvas{display:block;background:repeating-conic-gradient(var(--check-a) 0 25%,var(--check-b) 0 50%) 0 0/12px 12px;border-radius:4px}
.fpe-tl-preview{flex:none;height:96px;width:auto}
.fpe-tl-strip{display:flex;gap:8px;list-style:none;margin:0;padding:0 0 4px;overflow-x:auto;flex:1;min-width:0}
.fpe-tl-frame{flex:none;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2)}
.fpe-tl-frame[aria-current=true]{border-color:var(--accent)}
.fpe-tl-frame.fpe-tl-on{background:var(--sel)}
.fpe-tl-pick{position:relative;display:block;padding:0;border:0;background:none;cursor:pointer;color:inherit}
.fpe-tl-pick canvas{height:64px;width:auto}
.fpe-tl-n{position:absolute;left:4px;top:4px;padding:0 6px;border-radius:4px;background:var(--toast-bg);color:var(--toast-fg);font-size:12px;line-height:18px}
.fpe-tl-row{display:flex;align-items:center;gap:4px}
.fpe-tl-row input{width:64px;height:32px;border:1px solid var(--line);border-radius:6px;background:var(--input);color:var(--text);padding:0 6px;font:inherit}
.fpe-tl-row .fpe-btn{padding:0 8px}
@media (pointer:coarse){.fpe-tl .fpe-btn,.fpe-tl-row input,.fpe-tl-head select{height:44px;min-width:44px}}`;

/** What the animation commands need from the editor besides the tool host: the export sheet, set for an animation. */
export interface AnimHost extends ToolHost { exportAnim(): void; }
export interface AnimKit { run(id: string): void; refresh(): void; state(): { timeline: boolean; playing: boolean }; }

export function animKit(host: AnimHost): AnimKit {
  let panel: HTMLElement | null = null, timer = 0, queued = 0, playing = false, at = 0, drag = -1;
  const preview = h('canvas', { class: 'fpe-tl-preview', 'data-testid': 'tl-preview', role: 'img', 'aria-label': 'Preview of the animation' });
  const strip = h('ol', { class: 'fpe-tl-strip', 'data-testid': 'tl-strip', 'aria-label': 'Frames, first to last' });
  const count = h('span', { class: 'fpe-tl-count', 'data-testid': 'tl-count' });
  const playBtn = h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'tl-play', 'aria-pressed': 'false',
    'data-help-title': 'Play or stop', 'data-help': 'Plays the frames in the preview, each for its own time. The picture itself does not change.', onclick: () => play() }, 'Play');
  const loopSel = h('select', { 'data-testid': 'tl-loop', 'aria-label': 'How many times it plays', 'data-help-title': 'How many times it plays',
    'data-help': 'Forever repeats the animation; once stops on the last frame. The exported GIF, PNG or WebP keeps this.',
    onchange: () => { const d = host.doc(); if (d) push(setLoop(d, Number(loopSel.value))); } },
  h('option', { value: '0' }, 'Play forever'), h('option', { value: '1' }, 'Play once'));
  const push = (c: Command | null, why?: string): void => { if (c) host.push(c, true); else if (why) host.toast(why); };
  const sync = (): void => { playBtn.textContent = playing ? 'Stop' : 'Play'; playBtn.setAttribute('aria-pressed', String(playing)); };
  const mark = (): void => { strip.querySelectorAll<HTMLElement>('.fpe-tl-frame').forEach((li, i) => li.classList.toggle('fpe-tl-on', i === at)); };
  const show = (i: number): void => { const d = host.doc(); if (!d) return; at = Math.max(0, Math.min(i, d.layers.length - 1)); drawFrame(preview, d, d.layers[at], 96); mark(); };
  const stop = (): void => { clearTimeout(timer); timer = 0; if (playing) { playing = false; sync(); } };
  const next = (): void => {
    const d = host.doc();
    if (!d || !playing) return;
    timer = window.setTimeout(() => {
      const dd = host.doc();
      if (!dd || !playing || dd.layers.length < 2) { stop(); return; }
      if (at + 1 >= dd.layers.length && dd.loop === 1) { stop(); return; }
      show((at + 1) % dd.layers.length);
      next();
    }, delayOf(d.layers[at]?.name ?? '', DEFAULT_DELAY));
  };
  const play = (): void => {
    if (playing) { stop(); return; }
    const d = host.doc();
    if (!d || d.layers.length < 2) { host.toast('An animation needs two frames or more: add a layer, then Make animation frames.'); return; }
    playing = true; sync(); show(0); next();
  };
  const pick = (i: number): void => {
    const d = host.doc(), l = d?.layers[i];
    if (!d || !l) return;
    stop();
    d.activeId = l.id;
    const c = showOnly(d, i);
    if (c) host.push(c, true); else host.panels();
    show(i);
  };
  const item = (d: Doc, l: Layer, i: number): HTMLElement => {
    const n = d.layers.length, thumb = h('canvas', { 'aria-hidden': 'true' });
    drawFrame(thumb, d, l, 64);
    const ms = h('input', { type: 'number', min: 20, max: 10000, step: 10, value: delayOf(l.name, DEFAULT_DELAY), inputmode: 'numeric', 'data-testid': 'tl-delay',
      'aria-label': `Frame ${i + 1}: time on screen in thousandths of a second`, 'data-help-title': 'Time on screen', 'data-help': 'How long this frame shows, in thousandths of a second: 100 is a tenth of a second.',
      onchange: () => { const dd = host.doc(); if (dd) push(setDelay(dd, l.id, Number(ms.value))); } });
    const mv = (txt: string, label: string, to: number, tid: string): HTMLButtonElement => h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': tid, 'aria-label': label,
      disabled: to < 0 || to >= n, onclick: () => { const dd = host.doc(); if (dd) push(moveFrame(dd, i, to), cannotFrame(dd) ?? undefined); } }, txt);
    const li = h('li', { class: 'fpe-tl-frame', draggable: 'true', 'data-testid': 'tl-frame', 'data-i': i, 'aria-current': String(l.id === d.activeId) },
      h('button', { type: 'button', class: 'fpe-tl-pick', 'data-testid': 'tl-pick', 'aria-label': `Show only frame ${i + 1}, ${frameName(l.name)}`, title: frameName(l.name), onclick: () => pick(i) },
        thumb, h('span', { class: 'fpe-tl-n' }, String(i + 1))),
      h('div', { class: 'fpe-tl-row' }, mv('‹', `Move frame ${i + 1} earlier`, i - 1, 'tl-left'), ms, 'ms', mv('›', `Move frame ${i + 1} later`, i + 1, 'tl-right')));
    li.addEventListener('dragstart', (ev) => { drag = i; ev.dataTransfer?.setData('text/plain', String(i)); });
    li.addEventListener('dragover', (ev) => { if (drag >= 0) ev.preventDefault(); });
    li.addEventListener('drop', (ev) => { ev.preventDefault(); const dd = host.doc(), from = drag; drag = -1; if (dd && from >= 0 && from !== i) push(moveFrame(dd, from, i), cannotFrame(dd) ?? undefined); });
    li.addEventListener('dragend', () => { drag = -1; });
    return li;
  };
  const fill = (): void => {
    if (!panel) return;
    const d = host.doc();
    if (!d) { close(); return; }
    const f = document.activeElement as HTMLElement | null, keep = f && strip.contains(f) ? [f.closest('li')?.dataset.i, f.dataset.testid] : null;
    strip.replaceChildren(...d.layers.map((l, i) => item(d, l, i)));
    count.textContent = `${d.layers.length} frame${d.layers.length === 1 ? '' : 's'}`;
    loopSel.value = d.loop === 1 ? '1' : '0';
    if (playing) mark(); else show(Math.max(0, d.layers.findIndex((l) => l.id === d.activeId)));
    if (keep) strip.querySelector<HTMLElement>(`li[data-i="${keep[0]}"] [data-testid="${keep[1]}"]`)?.focus();
  };
  const open = (): void => {
    if (panel) { fill(); return; }
    if (!document.getElementById('fpe-anim-css')) document.head.append(h('style', { id: 'fpe-anim-css' }, CSS));
    panel = h('section', { class: 'fpe-tl', 'data-testid': 'timeline', 'aria-label': 'Animation timeline' },
      h('div', { class: 'fpe-tl-head' }, h('b', {}, 'Animation timeline'), h('span', { class: 'fpe-tl-pro' }, 'Timeline'), count, h('span', { class: 'fpe-tl-sp' }),
        playBtn, loopSel,
        h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'tl-export', 'data-help-title': 'Export the animation', 'data-help': 'Opens Export with each frame as one frame of a GIF, PNG or WebP.', onclick: () => { stop(); host.exportAnim(); } }, 'Export animation'),
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'tl-close', 'aria-label': 'Close the timeline', onclick: () => close() }, 'Close')),
      h('div', { class: 'fpe-tl-body' }, preview, strip));
    (host.root.querySelector('.fpe-center') ?? host.root).append(panel);
    fill();
    host.panels();
  };
  const close = (): void => { stop(); if (!panel) return; panel.remove(); panel = null; host.panels(); };
  return {
    run(id) {
      const d = host.doc();
      if (id === 'panel.timeline') { if (panel) close(); else open(); return; }
      if (id !== 'layer.frames' || !d) return;
      const why = cannotFrame(d);
      if (why) { host.toast(why); return; }
      const c = makeFrames(d);
      if (c) host.push(c, true);
      open();
      host.toast(c ? `${d.layers.length} frames made, one per layer. Frame 1 shows; set each time in the timeline.` : 'These layers are frames already.');
    },
    refresh() { if (panel && !queued) queued = requestAnimationFrame(() => { queued = 0; fill(); }); },
    state: () => ({ timeline: !!panel, playing }),
  };
}
