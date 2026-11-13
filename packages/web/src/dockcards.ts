// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The dock's picture-only parts (layout A, a-deep), loaded with the first picture so the first screen stays small: a
 * layer's plain and pro names (the status bar and Learn as you go) and the Tone graph card.
 */
import type { Layer } from '@free-photoeditor/core';
import { h } from './dom';
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
