// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The dock's picture-only parts (layout A, a-deep), loaded with the first picture so the first screen stays small: a
 * layer's plain and pro names (the status bar and Learn as you go), the Tone graph card, and (UI-D) each layer row's second
 * line, the effect rows under a layer with effects, and an icon on each History step.
 */
import { BLEND_LABELS, propsCommand, type Command, type Layer, type LayerEffects } from '@free-photoeditor/core';
import { h, icon } from './dom';
import { BY_ID } from './registry';

/** A layer's plain name, the name pros use, and one plain line about it (status bar and Learn as you go), from the map. */
export function layerNames(l: Layer): { plain: string; pro: string; pros: string; what: string } {
  const keep = 'Change it again at any time; the pixels under it stay as they were.';
  if (l.kind === 'adjust') {
    const r = BY_ID.get(l.adjust?.from ?? ''), pro = r?.pro ?? 'Adjustment';
    return { plain: (r?.plain ?? 'Light and colour') + ' layer', pro, pros: `${l.clip ? 'a clipped' : /^[AEIOU]/.test(pro) ? 'an' : 'a'} ${pro} layer`,
      what: (l.clip ? 'is clipped to the layer below, so it changes that layer only. ' : 'changes every layer below it. ') + keep };
  }
  if (l.kind === 'fill') return { plain: 'Colour layer', pro: 'Fill layer', pros: 'a Fill layer', what: 'is a flat colour. ' + keep };
  if (l.kind === 'folder') return { plain: 'Folder', pro: 'Group', pros: 'a Group', what: 'keeps layers together, so you can move, hide or fade them as one.' };
  return { plain: 'Picture layer', pro: 'Pixel layer', pros: 'a Pixel layer', what: 'is a sheet of pixels: paint, erase or move it without touching the layers below.' };
}
/** Learn as you go: the active layer in plain words, then what pros call it. */
export function renderLearn(el: HTMLElement, l: Layer | undefined): void {
  if (!l) { el.replaceChildren(); return; }
  const n = layerNames(l);
  el.replaceChildren(h('b', {}, l.name), ` ${n.what} Pros call it ${n.pros}.`);
}
/** The Tone graph card: dark to light, counted on the navigator's small copy of the picture (RGBA `px`), and one plain line about it. */
export function drawTone(body: HTMLElement, px: Uint8ClampedArray | null, ink: { bg: string; ac: string }): void {
  let c = body.querySelector('canvas'), note = body.querySelector<HTMLElement>('.fpe-tone-note');
  if (!c || !note) {
    c = h('canvas', { class: 'fpe-tone', width: 512, height: 96, 'data-testid': 'tone-graph', 'aria-label': 'Tone graph: how many pixels are dark, middle and light' });
    note = h('p', { class: 'fpe-note fpe-tone-note', 'data-testid': 'tone-note' });
    body.replaceChildren(c, note);
  }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  let hist: Uint32Array | null = null;
  if (px) {
    hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) hist[(px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8]++;
  }
  const W = c.width, H = c.height;
  ctx.fillStyle = ink.bg;
  ctx.fillRect(0, 0, W, H);
  let n = 0, sum = 0;
  for (let t = 0; hist && t < 256; t++) { n += hist[t]; sum += t * hist[t]; }
  if (!hist || !n) { note.textContent = ''; return; }
  const max = Math.max(1, ...hist), mean = sum / n, lost = [hist[0] / n > 0.005 ? 'black' : '', hist[255] / n > 0.005 ? 'white' : ''].filter(Boolean);
  ctx.fillStyle = ink.ac;
  for (let t = 0; t < 256; t++) { const bh = Math.sqrt(hist[t] / max) * (H - 4); ctx.fillRect((t * W) / 256, H - bh, W / 256 + 0.5, bh); }
  note.textContent = `Mostly ${mean < 85 ? 'dark' : mean > 170 ? 'light' : 'middle'} tones · ${lost.length ? 'some detail lost to pure ' + lost.join(' and ') : 'nothing lost to pure black or white'}`;
}

const CSS = `.fpe-fxrow{display:flex;align-items:center;gap:6px;min-height:30px;padding:0 8px 0 calc(var(--depth,0) * var(--step,16px) + 10px);border-bottom:1px solid var(--line);font-size:13px}
.fpe-fxrow:last-child{border-bottom:0}
.fpe-layer:has(+ .fpe-fxrow){border-bottom:0}
.fpe-fxrow[data-off]{color:var(--muted)}
.fpe-fxrow .fpe-icon-btn{flex:none}
.fpe-fxrow-ico{flex:none;width:14px;height:14px;color:var(--muted)}
.fpe-fxrow-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fpe-fxrow-tag{flex:none;font-size:12px;color:var(--muted)}
.fpe-hist-item .fpe-hico{flex:none;width:14px;height:14px;margin-right:8px;color:var(--muted)}
.fpe-hist-item[aria-current=step] .fpe-hico{color:inherit}
.fpe-hist-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fpe[data-layout=phone] .fpe-fxrow{min-height:44px}`;
const css = (): void => { if (!document.getElementById('fpe-cards-css')) document.head.append(h('style', { id: 'fpe-cards-css' }, CSS)); };

/** A layer row's second line, as in a-deep: what kind of layer it is, then how it blends ("Pixels · Normal", "Adjustment, clipped · Normal"). */
export function layerSub(l: Layer): string {
  const kind = l.kind === 'adjust' ? 'Adjustment' : l.kind === 'fill' ? 'Colour fill' : l.content?.kind === 'text' ? 'Text' : l.content?.kind === 'shape' ? 'Shape' : 'Pixels';
  return `${kind}${l.clip ? ', clipped' : ''} · ${BLEND_LABELS[l.blendMode] ?? 'Normal'}`;
}
export type FxKey = 'dropShadow' | 'innerShadow' | 'outerGlow' | 'innerGlow' | 'satin' | 'colorOverlay' | 'gradientOverlay' | 'patternOverlay' | 'stroke' | 'bevel';
const FX_NAMES: [FxKey, string][] = [['dropShadow', 'Drop shadow'], ['innerShadow', 'Inner shadow'], ['outerGlow', 'Outer glow'], ['innerGlow', 'Inner glow'],
  ['satin', 'Satin'], ['colorOverlay', 'Colour overlay'], ['gradientOverlay', 'Gradient overlay'], ['patternOverlay', 'Pattern overlay'], ['stroke', 'Outline'], ['bevel', 'Raised edge']];
export interface FxItem { key: FxKey; i: number; plain: string; on: boolean }
/** Every effect on the layer, one item per copy (the list kinds); `i` is the copy's place in its list, -1 for the single kinds. */
export function fxList(f: LayerEffects | undefined): FxItem[] {
  const out: FxItem[] = [];
  for (const [key, plain] of f ? FX_NAMES : []) {
    const v = (f as unknown as Record<string, unknown>)[key];
    const one = (e: unknown, i: number): void => { if (e && typeof e === 'object' && typeof (e as { on?: unknown }).on === 'boolean') out.push({ key, i, plain, on: (e as { on: boolean }).on }); };
    if (Array.isArray(v)) v.forEach((e, i) => one(e, i)); else one(v, -1);
  }
  return out;
}
/** The effects with one copy switched on or off: a new object (a value object), every other entry and setting kept as it was. */
export function toggleFx(f: LayerEffects, key: FxKey, i: number): LayerEffects {
  const o = { ...f } as unknown as Record<string, unknown>, v = o[key];
  const flip = (e: unknown): unknown => ({ ...(e as object), on: !(e as { on: boolean }).on });
  o[key] = Array.isArray(v) ? v.map((e, j) => (j === i ? flip(e) : e)) : flip(v);
  return o as unknown as LayerEffects;
}
/** The rows under a layer with effects (a-deep): an eye that switches the effect on or off in one undo step, its plain name, then "Effect". */
export function fxRows(l: Layer, depth: number, push: (c: Command) => void): HTMLElement[] {
  css();
  return fxList(l.fx).map((e) => h('li', { class: 'fpe-fxrow', style: `--depth:${depth}`, 'data-testid': 'fx-row', 'data-key': e.key, 'data-off': e.on && l.fx?.on ? null : '' },
    h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn', 'aria-pressed': String(e.on), 'aria-label': `${e.on ? 'Switch off' : 'Switch on'} ${e.plain} on ${l.name}`,
      'data-help-title': e.on ? 'Switch this effect off' : 'Switch this effect on', 'data-help': 'Its settings stay as they are. One step in History.', 'data-testid': 'fx-eye',
      onclick: () => {
        const from = l.fx;
        if (!from) return;
        // The push only records the step: the layer takes the change first.
        l.fx = toggleFx(from, e.key, e.i);
        push(propsCommand(l.id, { fx: from }, { fx: l.fx }, `${e.on ? 'Hide' : 'Show'} ${e.plain.toLowerCase()}`));
      } }, icon(e.on ? 'eye' : 'eye-off')),
    icon('sparkles', 'fpe-icon fpe-fxrow-ico'), h('span', { class: 'fpe-fxrow-name' }, e.plain), h('span', { class: 'fpe-fxrow-tag' }, 'Effect')));
}
const HIST: [RegExp, string][] = [[/^Opened/, 'image'], [/shadow|glow|outline|overlay|effect|bevel|satin/i, 'sparkles'], [/mask/i, 'scan'], [/clip/i, 'clip'],
  [/text|type|font|words/i, 'type'], [/curve|level|bright|contrast|hue|satur|exposure|tone|adjust|invert|vibrance|balance|colou?r|light/i, 'sliders'],
  [/blur|sharpen|noise|filter|smooth/i, 'droplet'], [/eras/i, 'eraser'], [/brush|paint|pencil|draw/i, 'brush'], [/heal|patch|spot/i, 'bandage'], [/clone|stamp/i, 'stamp'],
  [/fill|bucket|gradient/i, 'bucket'], [/crop|canvas|size|rotate|flip|trim|straighten/i, 'crop'], [/select|lasso|wand/i, 'select'],
  [/shape|\brect|ellipse|polygon|\bline\b|star|\bqr\b/i, 'shapes'], [/move|nudge|align|arrange|bring|send|order/i, 'move'], [/folder|group/i, 'folder'],
  [/delete|remove/i, 'trash'], [/duplicat|copy|paste/i, 'copy'], [/merge|flatten/i, 'merge'], [/layer|opacity|blend|rename|lock|hide|show/i, 'layers']];
/** The icon for a History step, from its words: what kind of change it was (a-deep). */
export const histIconName = (label: string): string => HIST.find(([re]) => re.test(label))?.[1] ?? 'history';
/** A History row's words with its icon in front; the icon is hidden from screen readers, so the row still reads as its words. */
export function histItem(label: string): DocumentFragment {
  css();
  const f = document.createDocumentFragment();
  f.append(icon(histIconName(label), 'fpe-icon fpe-hico'), h('span', { class: 'fpe-hist-text' }, label));
  return f;
}
