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
import { addLayer, combineCommands, createLayer, documentFromBitmap, moveLayer, setLayerProps, type Command, type Doc, type Layer } from '@free-photoeditor/core';
import { delayOf } from '@free-photoeditor/formats/util';
import { h } from './dom';
import { baseName, OPEN_ACCEPT, readImageFile, toImageData } from './io';
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

/** Onion skin: a frame's pixels pulled towards one colour (red for the frame before, green for the next); see-through parts stay see-through. */
export function tint(src: Uint8ClampedArray, rgb: readonly [number, number, number], strength = 0.6): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length), k = Math.max(0, Math.min(1, strength));
  for (let i = 0; i < src.length; i += 4) {
    out[i] = src[i] + (rgb[0] - src[i]) * k;
    out[i + 1] = src[i + 1] + (rgb[1] - src[i + 1]) * k;
    out[i + 2] = src[i + 2] + (rgb[2] - src[i + 2]) * k;
    out[i + 3] = src[i + 3];
  }
  return out;
}
/** The frame just before and just after the one being worked on (frame n is layer n, bottom first). */
export function neighbours(d: Doc): { prev: Layer | null; next: Layer | null } {
  const i = d.layers.findIndex((l) => l.id === d.activeId);
  return i < 0 || d.layers.length < 2 ? { prev: null, next: null } : { prev: d.layers[i - 1] ?? null, next: d.layers[i + 1] ?? null };
}
/** One picked picture, ready to be a frame. */
export interface FramePic { name: string; width: number; height: number; data: Uint8ClampedArray; x?: number; y?: number; }
/** Picked files in the order a person expects: by name, with numbers counted (walk2 before walk10). */
export const byName = <T extends { name: string }>(list: T[]): T[] => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
/**
 * Import animation frames: each picture becomes one new frame at the end, centred and hidden until picked, as one undo step.
 * The layer that was picked stays picked (adding a layer would pick it), so the timeline and onion skin follow the frame shown.
 */
export function addFrames(d: Doc, pics: FramePic[], delay = DEFAULT_DELAY): Command | null {
  if (!pics.length) return null;
  const keep = d.activeId;
  const adds = pics.map((p) => {
    const l = createLayer(withDelay(p.name, delayOf(p.name, delay)), p.width, p.height, { data: p.data, x: p.x ?? Math.round((d.width - p.width) / 2), y: p.y ?? Math.round((d.height - p.height) / 2) });
    l.visible = false;
    return addLayer(d, l, d.layers.length, 'Import animation frames');
  });
  const last = d.activeId;
  d.activeId = keep;
  return combineCommands('Import animation frames', [...adds, { label: 'Keep the picked frame', bytes: 0, undo: (x) => { x.activeId = last; }, redo: (x) => { x.activeId = keep; } }]);
}
/** No picture open: a new one the size of the first frame, every picture one frame, frame 1 showing. */
export function framesDoc(pics: FramePic[], delay = DEFAULT_DELAY): Doc | null {
  const [first, ...rest] = pics;
  if (!first) return null;
  const d = documentFromBitmap({ width: first.width, height: first.height, data: first.data }, withDelay(first.name, delayOf(first.name, delay)));
  addFrames(d, rest, delay);
  return d;
}
/** How many in-between frames Make in-between frames adds. */
export const TWEENS = 3;
/** The two frames to go between: the picked frame and the next, or the one before and the picked frame when it is the last. */
export function tweenPair(d: Doc): [number, number] | null {
  const i = d.layers.findIndex((l) => l.id === d.activeId);
  if (i < 0 || d.layers.length < 2) return null;
  return i + 1 < d.layers.length ? [i, i + 1] : [i - 1, i];
}
/** Why in-between frames can't be made, in plain words, or null. */
export function cannotTween(d: Doc): string | null {
  const why = cannotFrame(d), p = tweenPair(d);
  if (why) return why;
  if (!p) return 'Pick a frame in the timeline first.';
  const a = d.layers[p[0]], b = d.layers[p[1]];
  if (a.mask) return `Apply or delete the mask on frame ${p[0] + 1} first: in-between frames copy its pixels only.`;
  if (a.x === b.x && a.y === b.y && a.opacity === b.opacity) {
    return `Frames ${p[0] + 1} and ${p[1] + 1} are in the same place with the same opacity, so every in-between would look the same. Move one of them or change its opacity first.`;
  }
  return null;
}
/**
 * Make in-between frames (keyframes, tween): `n` new frames between the two of `tweenPair`. Each is a copy of the earlier
 * frame's pixels, placed a step further towards the later frame's place and opacity (step k of n sits at k / (n + 1) of
 * the way), with the earlier frame's time. They are new layers, hidden like every frame not being looked at, so the
 * export's one-layer-per-frame model holds. One undo step; the picked frame stays picked.
 */
export function tweenFrames(d: Doc, n = TWEENS): Command | null {
  const p = cannotTween(d) ? null : tweenPair(d);
  if (!p) return null;
  const a = d.layers[p[0]], b = d.layers[p[1]], keep = d.activeId, ms = delayOf(a.name, DEFAULT_DELAY), steps = Math.max(1, Math.min(30, Math.round(n) || 1));
  const adds: Command[] = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1), at = (u: number, v: number): number => u + (v - u) * t;
    const l = createLayer(withDelay(`${frameName(a.name)} in-between ${k}`, ms), a.width, a.height, { data: new Uint8ClampedArray(a.data), x: Math.round(at(a.x, b.x)), y: Math.round(at(a.y, b.y)) });
    l.opacity = Math.round(at(a.opacity, b.opacity) * 1000) / 1000;
    l.blendMode = a.blendMode;
    l.visible = false;
    adds.push(addLayer(d, l, p[0] + k, 'Make in-between frames'));
  }
  const last = d.activeId;
  d.activeId = keep;
  return combineCommands('Make in-between frames', [...adds, { label: 'Keep the picked frame', bytes: 0, undo: (x) => { x.activeId = last; }, redo: (x) => { x.activeId = keep; } }]);
}
async function readFrames(files: File[]): Promise<{ pics: FramePic[]; skipped: string[] }> {
  const pics: FramePic[] = [], skipped: string[] = [];
  for (const f of byName(files)) {
    try {
      const o = await readImageFile(f, f.name);
      if (o.kind === 'bitmap') pics.push({ name: baseName(f.name), width: o.bitmap.width, height: o.bitmap.height, data: o.bitmap.data });
      else if (o.kind === 'doc') { for (const l of o.doc.layers) if (l.kind !== 'folder') pics.push({ name: l.name, width: l.width, height: l.height, data: l.data, x: l.x, y: l.y }); }
      else skipped.push(f.name);
    } catch { skipped.push(f.name); }
  }
  return { pics, skipped };
}
const RED = [230, 40, 40] as const, GREEN = [40, 190, 80] as const;

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
export interface AnimHost extends ToolHost { exportAnim(): void; openDoc(d: Doc, name: string): void; }
export interface AnimKit { run(id: string): void; refresh(): void; overlay(ctx: CanvasRenderingContext2D): void; state(): { timeline: boolean; playing: boolean; onion: boolean }; }

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
  let onion = false;
  const ghosts = new Map<'prev' | 'next', { l: Layer; data: Uint8ClampedArray; cv: HTMLCanvasElement }>();
  const ghost = (k: 'prev' | 'next', l: Layer): HTMLCanvasElement => {
    const g = ghosts.get(k);
    if (g && g.l === l && g.data === l.data) return g.cv;
    const cv = g?.cv ?? document.createElement('canvas');
    cv.width = l.width; cv.height = l.height;
    cv.getContext('2d')?.putImageData(toImageData({ width: l.width, height: l.height, data: tint(l.data, k === 'prev' ? RED : GREEN) }), 0, 0);
    ghosts.set(k, { l, data: l.data, cv });
    return cv;
  };
  const onionBtn = h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'tl-onion', 'aria-pressed': 'false', 'data-help-title': 'See neighbour frames · Onion skin',
    'data-help': 'Shows the frame before in faint red and the next one in faint green, so you can draw the one in between.', onclick: () => toggleOnion() }, 'See neighbour frames');
  const toggleOnion = (): void => {
    const d = host.doc();
    if (!onion && (!d || d.layers.length < 2)) { host.toast('Seeing neighbour frames needs two frames or more: add a layer first.'); return; }
    onion = !onion; ghosts.clear(); onionBtn.setAttribute('aria-pressed', String(onion));
    host.render(); host.panels();
    host.toast(onion ? 'Onion skin on: the frame before shows in faint red, the next one in faint green.' : 'Onion skin off.');
  };
  const files = h('input', { type: 'file', multiple: '', accept: OPEN_ACCEPT, hidden: true, 'aria-hidden': 'true', 'data-testid': 'tl-files' }) as HTMLInputElement;
  const pickFiles = (): void => { if (!files.isConnected) host.root.append(files); files.click(); };
  const importFiles = async (list: File[]): Promise<void> => {
    if (!list.length) return;
    const { pics, skipped } = await readFrames(list);
    const why = skipped.length ? ` Skipped, not a picture this can open: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}.` : '';
    if (!pics.length) { host.toast(`No frames added.${why}`); return; }
    const d = host.doc();
    if (d) push(addFrames(d, pics)); else { const nd = framesDoc(pics); if (nd) host.openDoc(nd, frameName(pics[0].name)); }
    open();
    host.toast(`${pics.length} frame${pics.length === 1 ? '' : 's'} added at the end, ${DEFAULT_DELAY} ms each. Pick one in the timeline to see it.${why}`);
  };
  files.addEventListener('change', () => { const list = Array.from(files.files ?? []); files.value = ''; void importFiles(list); });
  const addBtn = h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'tl-import', 'data-help-title': 'Import animation frames · Image sequence',
    'data-help': 'Pick several pictures: each becomes one frame at the end, in name order.', onclick: () => pickFiles() }, 'Add pictures as frames');
  const open = (): void => {
    if (panel) { fill(); return; }
    if (!document.getElementById('fpe-anim-css')) document.head.append(h('style', { id: 'fpe-anim-css' }, CSS));
    panel = h('section', { class: 'fpe-tl', 'data-testid': 'timeline', 'aria-label': 'Animation timeline' },
      h('div', { class: 'fpe-tl-head' }, h('b', {}, 'Animation timeline'), h('span', { class: 'fpe-tl-pro' }, 'Timeline'), count, h('span', { class: 'fpe-tl-sp' }),
        playBtn, loopSel, onionBtn, addBtn,
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
      if (id === 'layer.onion-skin') { toggleOnion(); return; }
      if (id === 'layer.import-frames') { pickFiles(); return; }
      if (id === 'layer.keyframes' && d) {
        const why = cannotTween(d), p = tweenPair(d);
        if (why || !p) { host.toast(why ?? 'Pick a frame in the timeline first.'); return; }
        push(tweenFrames(d));
        open();
        host.toast(`${TWEENS} in-between frames made between frame ${p[0] + 1} and the next one, now frame ${p[1] + 1 + TWEENS}. Press Play in the timeline to see the move.`);
        return;
      }
      if (id !== 'layer.frames' || !d) return;
      const why = cannotFrame(d);
      if (why) { host.toast(why); return; }
      const c = makeFrames(d);
      if (c) host.push(c, true);
      open();
      host.toast(c ? `${d.layers.length} frames made, one per layer. Frame 1 shows; set each time in the timeline.` : 'These layers are frames already.');
    },
    refresh() { ghosts.clear(); if (panel && !queued) queued = requestAnimationFrame(() => { queued = 0; fill(); }); },
    overlay(ctx) {
      const d = onion ? host.doc() : null;
      if (!d) return;
      const v = host.view(), nb = neighbours(d);
      ctx.save(); ctx.globalAlpha = 0.45; ctx.imageSmoothingEnabled = v.zoom < 1;
      for (const [k, l] of [['prev', nb.prev], ['next', nb.next]] as const) {
        if (l && l.width > 0 && l.height > 0 && l.kind !== 'folder') ctx.drawImage(ghost(k, l), v.panX + l.x * v.zoom, v.panY + l.y * v.zoom, l.width * v.zoom, l.height * v.zoom);
      }
      ctx.restore();
    },
    state: () => ({ timeline: !!panel, playing, onion }),
  };
}
