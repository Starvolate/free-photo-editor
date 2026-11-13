// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * More Select & cut out and Arrange layers commands, loaded the first time one is used (the select-and-layers batch,
 * 13 Nov 2026): select by brightness, by a colour channel or by a layer's solid parts; fill holes, round the corners or
 * roughen the edge of a selection; lift the selected pixels into a new layer; crop a layer to its content, fill or swap
 * its see-through parts, split it by colour, and reverse the layer order. Part 2: refine a selection's edge with a live
 * preview, clean edge colours, see and paint the selection as a grey picture, colour-label a layer, write notes and tags
 * on it, and find layers. Each change is one undo step. The maths lives in core (selection-more.ts) with its unit tests;
 * this file only asks and applies.
 */
import {
  applyProps, combineMasks, commitShape, compositeDoc, countSelected, createLayer, docCommand, docRect, emptyMask, featherMask, hasPixels,
  maskFromSelection, parseHex, propsCommand, selectionFromMask, snapshotDoc, type Command, type Doc, type Layer, type LayerLabel, type LayerProps,
  type Mask, type Pixels, type Selection, type SelMode,
} from '@free-photoeditor/core';
import {
  alphaMask, channelMask, cleanEdgeColours, cropToContent, dabMask, findLayers, floatSelection, geomOf, invertAlpha, layerDataCommand, layerKindOf,
  luminanceMask, refineEdge, removeAlpha, removeHoles, reversedOrder, roughenMask, roundCorners, splitByColour, type LayerFind,
} from '@free-photoeditor/core/selection-more';
import { h } from './dom';
import type { ToolHost } from './toolkit';

/** The commands this module runs; commands.ts gives each its handler. */
export const SELMORE_IDS = ['select.luminance', 'select.from-alpha', 'select.from-channel', 'select.remove-holes', 'select.round-corners',
  'select.distort', 'select.float', 'layer.crop-to-content', 'layer.remove-alpha', 'layer.invert-alpha', 'layer.split-by-colour', 'layer.reverse',
  'select.refine', 'layer.defringe', 'select.editor', 'layer.colour-label', 'layer.metadata', 'layer.filter', 'layer.select-by-state'];

const bodies = new Map<string, HTMLElement>();
const hex = (c: { r: number; g: number; b: number }): string => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
/** The last settings of Refine edge, Defringe and the selection editor's brush, kept while the page is open. */
const RF = { radius: 4, smooth: 0, feather: 1, shift: 0, clean: 0, view: 'dim' as 'dim' | 'white' | 'black' };
const DF = { width: 2 };
const ED = { size: 0 };
/** About this many pixels in the Refine edge preview, so it follows the sliders at once; Apply works at full size. */
const PREVIEW_PX = 160_000;
const LABELS: [LayerLabel | 'none', string, string][] = [['none', 'None', ''], ['red', 'Red', '#e5484d'], ['orange', 'Orange', '#f76b15'],
  ['yellow', 'Yellow', '#f5d90a'], ['green', 'Green', '#30a46c'], ['blue', 'Blue', '#0090ff'], ['violet', 'Violet', '#8e4ec6'], ['grey', 'Grey', '#8b8d98']];
const KIND_WORD: Record<string, string> = { pixel: 'picture', text: 'text', shape: 'shape', folder: 'folder', adjust: 'light and colour', fill: 'colour fill' };
const dot = (c: string): HTMLElement => h('span', { 'aria-hidden': 'true',
  style: `display:inline-block;flex:none;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:-1px;${c ? 'background:' + c : 'border:1px solid currentColor;opacity:.5'}` });
/** A smaller copy of a picture (nearest pixel), `s` times the size. */
function shrinkPx(p: Pixels, s: number): Pixels {
  const w = Math.max(1, Math.round(p.width * s)), hh = Math.max(1, Math.round(p.height * s)), out = new Uint8ClampedArray(w * hh * 4);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const i = (Math.min(p.height - 1, Math.floor(y / s)) * p.width + Math.min(p.width - 1, Math.floor(x / s))) * 4;
    out.set(p.data.subarray(i, i + 4), (y * w + x) * 4);
  }
  return { width: w, height: hh, data: out };
}
function shrinkMask(m: Mask, w: number, hh: number): Mask {
  const out = emptyMask(w, hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++)
    out.data[y * w + x] = m.data[Math.min(m.height - 1, Math.floor((y * m.height) / hh)) * m.width + Math.min(m.width - 1, Math.floor((x * m.width) / w))];
  return out;
}
/** The picture with the selection shown: the rest dimmed, or the selected part laid on white or black. */
function paintPreview(cv: HTMLCanvasElement, px: Pixels, m: Mask, view: string): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(px.width, px.height), o = img.data, bg = view === 'white' ? 255 : 0;
  for (let i = 0; i < m.data.length; i++) {
    const a = m.data[i] / 255;
    for (let c = 0; c < 3; c++) { const v = px.data[i * 4 + c]; o[i * 4 + c] = view === 'dim' ? v * (0.25 + 0.75 * a) : v * a + bg * (1 - a); }
    o[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function selCommand(label: string, before: Selection | null, after: Selection | null): Command {
  return { label, bytes: (before?.alpha?.length ?? 0) + (after?.alpha?.length ?? 0), undo(d) { d.selection = before; }, redo(d) { d.selection = after; } };
}

export function runSelMore(id: string, host: ToolHost): void {
  const doc = (): Doc | null => host.doc();
  const active = (d: Doc): Layer | undefined => d.layers.find((l) => l.id === d.activeId);
  const picture = (d: Doc) => ({ width: d.width, height: d.height, data: compositeDoc(d, docRect(d)) });
  const current = (d: Doc): Mask | null => (d.selection ? maskFromSelection(d.selection, d.width, d.height) : null);

  function setSel(next: Selection | null, label: string): void {
    const d = doc();
    if (!d) return;
    const before = d.selection;
    host.rememberSel(before);
    host.forgetHole();
    d.selection = next;
    host.push(selCommand(label, before, next));
    host.selectionChanged();
  }
  /** Use `m` as the selection, or combine it with the one there is. An empty result says so instead of selecting nothing. */
  function useMask(m: Mask, mode: SelMode, label: string): void {
    const d = doc();
    if (!d) return;
    const out = combineMasks(mode === 'new' ? null : current(d), m, mode);
    if (!countSelected(out)) { host.toast('Nothing matched, so the selection did not change. Try a wider range.'); return; }
    setSel(selectionFromMask(out), label);
  }
  /** The active layer when its pixels may change; otherwise says why and gives null. */
  function pixelLayer(): Layer | null {
    const d = doc(), l = d ? active(d) : undefined;
    if (!d || !l) return null;
    if (!hasPixels(l)) { host.toast('Pick a picture layer first. Folders and light and colour layers have no pixels of their own.'); return null; }
    if (!host.editable(l, true)) return null;
    if (!l.visible) { host.toast('This layer is hidden. Show it to change it.'); return null; }
    return l;
  }
  function needSel(): Mask | null {
    const d = doc();
    if (!d) return null;
    if (!d.selection) { host.toast('Select an area first.'); return null; }
    return current(d);
  }
  /** A sheet with Cancel and Apply, or with Done alone when its changes happen as you click (`apply` null). */
  function dialog(key: string, title: string, fields: HTMLElement[], apply: (() => void) | null): void {
    let body = bodies.get(key);
    if (!body) { body = h('div', { class: 'fpe-stack', 'data-testid': 'sm-' + key }); bodies.set(key, body); }
    body.replaceChildren(...fields, h('div', { class: 'fpe-actions' }, ...(apply ? [
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'sm-cancel', onclick: () => host.closeSheet() }, 'Cancel'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'sm-apply', onclick: () => { host.closeSheet(); apply(); } }, 'Apply')]
      : [h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'sm-done', onclick: () => host.closeSheet() }, 'Done')])));
    host.sheet('sm-' + key, title, body);
  }
  /** Set properties of the active layer as one undo step; false when nothing changes. */
  function setProps(p: LayerProps, label: string): boolean {
    const dd = doc(), l = dd ? active(dd) : undefined;
    if (!dd || !l) return false;
    const before: Record<string, unknown> = {}, after = p as Record<string, unknown>;
    for (const k of Object.keys(p)) before[k] = (l as unknown as Record<string, unknown>)[k];
    if (Object.keys(p).every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k]))) return false;
    applyProps(l, p);
    host.push(propsCommand(l.id, before as LayerProps, p, label));
    host.panels();
    return true;
  }
  const field = (label: string, help: string, ...kids: HTMLElement[]): HTMLElement =>
    h('label', { class: 'fpe-field', 'data-help-title': label, 'data-help': help }, h('span', {}, label), ...kids);
  const later = (draw: () => void): (() => void) => {
    let queued = false;
    return () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
  };
  function seg<T extends string>(label: string, help: string, opts: [T, string][], value: T, pick: (v: T) => void, testid: string): HTMLElement {
    const g = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': label });
    const paint = (): void => { for (const b of g.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === value)); };
    for (const [v, text] of opts) g.append(h('button', { type: 'button', 'data-v': v, 'data-testid': `${testid}-${v}`, onclick: () => { value = v; pick(v); paint(); } }, text));
    paint();
    return h('div', { class: 'fpe-field', 'data-help-title': label, 'data-help': help }, h('span', {}, label), g);
  }
  const MODES: [SelMode, string][] = [['new', 'Replace'], ['add', 'Add'], ['subtract', 'Take away'], ['intersect', 'Keep the overlap']];
  const modeSeg = (pick: (m: SelMode) => void): HTMLElement =>
    seg('Combine', 'Replace the selection, add to it, take away from it, or keep only where both overlap.', MODES, 'new' as SelMode, pick, 'sm-mode');

  const d = doc();
  if (!d) return;
  switch (id) {
    case 'select.luminance': {
      let lo = 170, hi = 255, soft = 32;
      dialog('luminance', 'Select by brightness · Luminance range', [
        h('p', { class: 'fpe-note' }, 'Light parts: 170 to 255. Middle: 85 to 170. Dark parts: 0 to 85.'),
        host.slider('From', 'The darkest level that is fully selected (0 black, 255 white).', 0, 255, lo, '', (v) => { lo = v; }, 'sm-lum-lo'),
        host.slider('To', 'The lightest level that is fully selected.', 0, 255, hi, '', (v) => { hi = v; }, 'sm-lum-hi'),
        host.slider('Soft edge', 'How many levels the selection fades over outside the range (0 is a hard edge).', 0, 128, soft, '', (v) => { soft = v; }, 'sm-lum-soft'),
      ], () => { const dd = doc(); if (dd) useMask(luminanceMask(picture(dd), lo, hi, soft), 'new', 'Select by brightness'); });
      return;
    }
    case 'select.from-channel': {
      let ch: 'r' | 'g' | 'b' = 'r';
      dialog('channel', 'Select from a colour channel · Channel to selection', [
        seg('Channel', 'The brighter this colour is in a pixel, the more of that pixel is selected.', [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], ch, (v) => { ch = v; }, 'sm-ch'),
      ], () => { const dd = doc(); if (dd) useMask(channelMask(picture(dd), ch === 'r' ? 0 : ch === 'g' ? 1 : 2), 'new', 'Select from a channel'); });
      return;
    }
    case 'select.from-alpha': {
      if (!active(d) || !hasPixels(active(d) as Layer)) { host.toast('Pick a picture layer first.'); return; }
      let mode: SelMode = 'new';
      dialog('alpha', "Select this layer's solid parts · Alpha to selection", [modeSeg((m) => { mode = m; })], () => {
        const dd = doc(), l = dd ? active(dd) : undefined;
        if (dd && l) useMask(alphaMask(l, dd.width, dd.height), mode, "Select the layer's solid parts");
      });
      return;
    }
    case 'select.remove-holes': {
      if (!needSel()) return;
      let n = 400;
      dialog('holes', 'Fill holes in the selection · Remove holes', [
        host.slider('Largest hole', 'Gaps inside the selection up to this many pixels are filled. Gaps that reach the picture edge stay.', 1, 20000, n, ' px', (v) => { n = v; }, 'sm-holes'),
      ], () => {
        const m = needSel();
        if (!m) return;
        const out = removeHoles(m, n);
        if (countSelected(out) === countSelected(m) && out.data.every((v, i) => v === m.data[i])) { host.toast('There are no holes that small inside the selection.'); return; }
        setSel(selectionFromMask(out), 'Fill holes');
      });
      return;
    }
    case 'select.round-corners': {
      if (!needSel()) return;
      let r = 16;
      dialog('round', 'Round the corners · Rounded selection', [
        host.slider('Radius', 'How round the corners become, in pixels.', 1, 200, r, ' px', (v) => { r = v; }, 'sm-round'),
      ], () => { const m = needSel(); if (m) useMask(roundCorners(m, r), 'new', 'Round the corners'); });
      return;
    }
    case 'select.distort': {
      if (!needSel()) return;
      let amount = 8, grain = 12;
      dialog('distort', 'Roughen the edge · Distort selection', [
        host.slider('Roughness', 'How far, in pixels, the edge may wander from where it was.', 1, 100, amount, ' px', (v) => { amount = v; }, 'sm-rough'),
        host.slider('Grain', 'How far apart the bumps are: small numbers give a fine tear, big ones gentle waves.', 1, 100, grain, ' px', (v) => { grain = v; }, 'sm-grain'),
      ], () => { const m = needSel(); if (m) useMask(roughenMask(m, amount, grain, 1 + Math.floor(Math.random() * 1e6)), 'new', 'Roughen the edge'); });
      return;
    }
    case 'select.float': {
      const m = needSel(), l = m ? pixelLayer() : null;
      if (!m || !l) return;
      const cmd = floatSelection(d, l, m, 'Lifted pixels');
      if (!cmd) { host.toast("The selection holds none of this layer's pixels."); return; }
      host.push(cmd, true);
      host.toast('The selected pixels are now their own layer, above the one they came from.');
      return;
    }
    case 'layer.crop-to-content': {
      const l = pixelLayer();
      if (!l) return;
      const g = cropToContent(l);
      if (!g) { host.toast(l.data.some((v, i) => i % 4 === 3 && v > 0) ? 'This layer already fits its content.' : 'This layer is empty.'); return; }
      const cmd = layerDataCommand('Crop the layer to its content', l.id, geomOf(l), g);
      cmd.redo(d);
      host.push(cmd, true);
      return;
    }
    case 'layer.remove-alpha': case 'layer.invert-alpha': {
      const l = pixelLayer();
      if (!l) return;
      const data = id === 'layer.invert-alpha' ? invertAlpha(l.data) : removeAlpha(l.data, parseHex(host.bg()) ?? { r: 255, g: 255, b: 255, a: 255 });
      if (!data) { host.toast('This layer has no see-through parts.'); return; }
      const cmd = layerDataCommand(id === 'layer.invert-alpha' ? 'Swap see-through and solid' : 'Fill the see-through parts', l.id, geomOf(l), { ...geomOf(l), data });
      cmd.redo(d);
      host.push(cmd, true);
      return;
    }
    case 'layer.split-by-colour': {
      if (!pixelLayer()) return;
      let n = 4;
      dialog('split', 'Split the layer by colour · Split layer', [
        host.slider('Colours', 'At most this many layers, one per main colour. The original layer is hidden, not deleted.', 2, 16, n, '', (v) => { n = v; }, 'sm-split'),
      ], () => {
        const dd = doc(), l = pixelLayer();
        if (!dd || !l) return;
        const groups = splitByColour(l, n);
        if (groups.length < 2) { host.toast('This layer has only one colour, so there is nothing to split.'); return; }
        const before = snapshotDoc(dd), at = dd.layers.indexOf(l);
        const made = groups.map((g, i) => {
          const nl = createLayer(`Colour ${i + 1} (${hex(g.color)})`, l.width, l.height, { x: l.x, y: l.y, data: g.data });
          if (l.parentId) nl.parentId = l.parentId;
          return nl;
        });
        dd.layers.splice(at + 1, 0, ...made.reverse());
        l.visible = false;
        dd.activeId = made[made.length - 1].id;
        host.push(docCommand('Split by colour', before, snapshotDoc(dd)), true);
      });
      return;
    }
    case 'layer.reverse': {
      const order = reversedOrder(d.layers, d.activeId);
      if (!order) { host.toast('There is only one layer here, so there is nothing to reverse.'); return; }
      host.push(commitShape(d, 'Reverse the layer order', order, new Map()), true);
      return;
    }
    case 'select.refine': {
      const m0 = needSel();
      if (!m0) return;
      const s = Math.min(1, Math.sqrt(PREVIEW_PX / (d.width * d.height))), small = shrinkPx(picture(d), s), sm = shrinkMask(m0, small.width, small.height);
      const cv = h('canvas', { width: small.width, height: small.height, 'data-testid': 'sm-refine-preview', role: 'img', 'aria-label': 'Preview of the refined selection over the picture',
        style: 'width:100%;height:auto;display:block;border-radius:6px' }) as HTMLCanvasElement;
      const draw = (): void => paintPreview(cv, small, refineEdge(small, sm, { radius: RF.radius * s, smooth: RF.smooth * s, feather: RF.feather * s, shift: RF.shift * s }), RF.view);
      const redo = later(draw);
      const set = (k: 'radius' | 'smooth' | 'feather' | 'shift' | 'clean') => (v: number): void => { RF[k] = v; redo(); };
      dialog('refine', 'Smooth the selection edge · Refine edge', [
        h('p', { class: 'fpe-note' }, s < 1 ? 'The preview uses a smaller copy of the picture to stay quick; Apply works on every pixel.' : 'The preview follows the sliders; Apply makes it the selection.'),
        cv,
        seg('Show', 'How the preview shows what is selected: the rest dimmed, or the selected part on white or on black.', [['dim', 'Dim the rest'], ['white', 'On white'], ['black', 'On black']],
          RF.view, (v) => { RF.view = v; redo(); }, 'sm-rf-view'),
        host.slider('Edge width · Radius', 'Within this many pixels of the edge the selection follows the picture: pixels that look like the inside join it, pixels that look like the outside leave it. Good for hair and fur.',
          0, 64, RF.radius, ' px', set('radius'), 'sm-rf-radius'),
        host.slider('Smooth', 'Rounds off a jagged edge and drops tiny specks.', 0, 50, RF.smooth, ' px', set('smooth'), 'sm-rf-smooth'),
        host.slider('Soft edge · Feather', 'How many pixels the edge fades over.', 0, 100, RF.feather, ' px', set('feather'), 'sm-rf-feather'),
        host.slider('Move the edge · Shift edge', 'Grows the selection outward (above 0) or pulls it inward (below 0), in pixels.', -50, 50, RF.shift, ' px', set('shift'), 'sm-rf-shift'),
        host.slider('Clean edge colours · Decontaminate', 'Above 0, Apply also puts the cut-out on a new layer and gives its edge pixels the colour of the solid part next to them, so none of the old background shows. The original layer is hidden, not deleted.',
          0, 100, RF.clean, '%', set('clean'), 'sm-rf-clean'),
      ], () => {
        const dd = doc(), cur = dd ? current(dd) : null;
        if (!dd || !cur) return;
        const out = refineEdge(picture(dd), cur, RF);
        if (!countSelected(out)) { host.toast('Nothing would stay selected. Move the edge in less far.'); return; }
        const sel = selectionFromMask(out);
        if (RF.clean <= 0) { setSel(sel, 'Refine edge'); return; }
        const l = pixelLayer();
        if (!l) return;
        const W = dd.width, H = dd.height, data = l.data.slice();
        for (let i = 0; i < l.width * l.height; i++) {
          const x = l.x + (i % l.width), y = l.y + ((i / l.width) | 0);
          data[i * 4 + 3] = Math.round((l.data[i * 4 + 3] * (x < 0 || y < 0 || x >= W || y >= H ? 0 : out.data[y * W + x])) / 255);
        }
        const clean = cleanEdgeColours(data, l.width, l.height, (i) => data[i * 4 + 3], Math.max(2, Math.ceil(RF.radius + RF.feather)), RF.clean / 100) ?? data;
        const before = snapshotDoc(dd), nl = createLayer(l.name + ' cut-out', l.width, l.height, { x: l.x, y: l.y, data: clean });
        if (l.parentId) nl.parentId = l.parentId;
        host.rememberSel(dd.selection);
        host.forgetHole();
        dd.selection = sel;
        l.visible = false;
        dd.layers.splice(dd.layers.indexOf(l) + 1, 0, nl);
        dd.activeId = nl.id;
        host.push(docCommand('Refine edge', before, snapshotDoc(dd)), true);
        host.selectionChanged();
        host.toast('The cut-out is on a new layer with clean edge colours. The original layer is hidden, not deleted.');
      });
      draw();
      return;
    }
    case 'layer.defringe': {
      if (!pixelLayer()) return;
      dialog('defringe', 'Clean up edge colour · Defringe', [
        h('p', { class: 'fpe-note' }, 'Pixels at the edge of a cut-out take the colour of the solid part next to them, so a halo of the old background goes. How see-through they are does not change.'),
        host.slider('Width', 'How many pixels in from the edge get the new colour.', 1, 20, DF.width, ' px', (v) => { DF.width = v; }, 'sm-df-width'),
      ], () => {
        const dd = doc(), l = pixelLayer();
        if (!dd || !l) return;
        const data = cleanEdgeColours(l.data, l.width, l.height, (i) => l.data[i * 4 + 3], DF.width);
        if (!data) { host.toast('This layer has no see-through edge, so there is no halo to clean. Cut something out first.'); return; }
        const cmd = layerDataCommand('Clean up edge colour', l.id, geomOf(l), { ...geomOf(l), data });
        cmd.redo(dd);
        host.push(cmd, true);
      });
      return;
    }
    case 'select.editor': {
      const W = d.width, H = d.height, s = Math.min(1, 480 / W, 360 / H), dw = Math.max(1, Math.round(W * s)), dh = Math.max(1, Math.round(H * s));
      const start = (): Mask => { const dd = doc(), m = dd ? current(dd) : null; return m ? { ...m, data: m.data.slice() } : emptyMask(W, H); };
      let work = start(), add = true, size = ED.size || Math.max(8, Math.round(Math.min(W, H) / 16)), blur = 4, last: { x: number; y: number } | null = null;
      const cv = h('canvas', { width: dw, height: dh, 'data-testid': 'sm-editor-canvas', role: 'img', 'aria-label': 'The selection as a grey picture: white is selected, black is not. Paint on it.',
        style: 'width:100%;height:auto;display:block;border-radius:6px;touch-action:none;cursor:crosshair' }) as HTMLCanvasElement;
      const draw = (): void => {
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        const img = ctx.createImageData(dw, dh);
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
          const v = work.data[Math.min(H - 1, Math.floor(y / s)) * W + Math.min(W - 1, Math.floor(x / s))], i = (y * dw + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      };
      const redo = later(draw);
      const pt = (e: PointerEvent): { x: number; y: number } => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
      const stroke = (p: { x: number; y: number }): void => {
        const r = size / 2, from = last ?? p, n = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, r / 2)));
        for (let k = 1; k <= n; k++) dabMask(work, from.x + ((p.x - from.x) * k) / n, from.y + ((p.y - from.y) * k) / n, r, add);
        last = p;
        redo();
      };
      cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch { /* not captured: painting still works inside the box */ } last = null; stroke(pt(e)); });
      cv.addEventListener('pointermove', (e) => { if (last) stroke(pt(e)); });
      for (const ev of ['pointerup', 'pointercancel'] as const) cv.addEventListener(ev, () => { last = null; });
      const btn = (text: string, testid: string, help: string, run: () => void): HTMLElement =>
        h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': testid, 'data-help-title': text, 'data-help': help, onclick: () => { run(); redo(); } }, text);
      dialog('editor', 'See and paint the selection · Selection editor', [
        h('p', { class: 'fpe-note' }, 'White is selected, black is not, grey is partly selected. Paint on the picture below, then Apply to turn it back into a selection.'),
        cv,
        seg('Paint', 'White adds to the selection; black takes away from it.', [['add', 'White: add'], ['sub', 'Black: take away']], 'add', (v) => { add = v === 'add'; }, 'sm-ed-paint'),
        host.slider('Brush size', 'How wide the brush is, in picture pixels.', 1, 400, size, ' px', (v) => { size = v; ED.size = v; }, 'sm-ed-size'),
        host.slider('Blur amount', 'How far, in pixels, Blur softens the grey picture.', 1, 50, blur, ' px', (v) => { blur = v; }, 'sm-ed-blur-amount'),
        h('div', { class: 'fpe-actions' },
          btn('Blur', 'sm-ed-blur', 'Soften every edge of the grey picture by the blur amount.', () => { work = featherMask(work, blur); }),
          btn('Invert', 'sm-ed-invert', 'White becomes black and black becomes white.', () => { for (let i = 0; i < work.data.length; i++) work.data[i] = 255 - work.data[i]; }),
          btn('Start over', 'sm-ed-reset', 'Go back to the selection as it was when this opened.', () => { work = start(); })),
      ], () => {
        if (countSelected(work)) { setSel(selectionFromMask(work), 'Edit the selection as a picture'); return; }
        if (doc()?.selection) setSel(null, 'Edit the selection as a picture');
        else host.toast('Nothing is white, so there is nothing to select. Paint with white first.');
      });
      draw();
      return;
    }
    case 'layer.colour-label': {
      const l = active(d);
      if (!l) { host.toast('Pick a layer first.'); return; }
      const g = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Colour label', style: 'flex-wrap:wrap' });
      const paint = (): void => { const cur = (doc() && active(doc() as Doc)?.label) || 'none'; for (const b of g.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === cur)); };
      for (const [v, text, c] of LABELS) g.append(h('button', { type: 'button', 'data-v': v, 'data-testid': 'sm-label-' + v, onclick: () => { setProps({ label: v === 'none' ? undefined : v }, 'Colour label'); paint(); } }, dot(c), text));
      dialog('label', 'Colour label · Layer colour label', [
        h('p', { class: 'fpe-note' }, `For the layer "${l.name}". It does not change the picture; Find layers lists the layers with each colour.`),
        field('Colour', 'A colour tag to find this layer again.', g),
      ], null);
      paint();
      return;
    }
    case 'layer.metadata': {
      const l = active(d);
      if (!l) { host.toast('Pick a layer first.'); return; }
      const notes = h('textarea', { rows: 4, 'data-testid': 'sm-meta-notes', style: 'width:100%;min-height:72px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--input);color:var(--text);font:inherit;resize:vertical' }) as HTMLTextAreaElement;
      const tags = h('input', { type: 'text', 'data-testid': 'sm-meta-tags', placeholder: 'sky, final, client' }) as HTMLInputElement;
      notes.value = l.meta?.notes ?? '';
      tags.value = l.meta?.tags.join(', ') ?? '';
      dialog('meta', 'Notes and tags · Layer metadata', [
        h('p', { class: 'fpe-note' }, `For the layer "${l.name}". They stay with the layer while you work and in this browser's autosave, and Find layers searches them. Saved files do not carry them yet.`),
        field('Notes', 'Anything worth remembering about this layer.', notes),
        field('Tags', 'Words to find this layer by, separated by commas.', tags),
      ], () => {
        const meta = { notes: notes.value.trim(), tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) };
        if (setProps({ meta: meta.notes || meta.tags.length ? meta : undefined }, 'Layer notes and tags')) host.toast('Saved with the layer.');
        else host.toast('Nothing changed.');
      });
      return;
    }
    case 'layer.filter': case 'layer.select-by-state': {
      const q: LayerFind = id === 'layer.select-by-state' ? { state: 'hidden' } : {};
      const count = h('p', { class: 'fpe-note', role: 'status', 'data-testid': 'sm-find-count' });
      const list = h('div', { class: 'fpe-sheet-list', role: 'list', 'data-testid': 'sm-find-list' });
      const found = (): Layer[] => findLayers(doc()?.layers ?? [], q).reverse();
      const refresh = (): void => {
        const f = found(), on = doc()?.activeId;
        count.textContent = f.length ? `${f.length} ${f.length === 1 ? 'layer matches' : 'layers match'}. Click one to work on it.` : 'No layer matches. Try fewer conditions.';
        list.replaceChildren(...f.map((l) => h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost fpe-sheet-item', role: 'listitem', 'aria-current': String(l.id === on), 'data-testid': 'sm-find-item',
          onclick: () => { const x = doc(); if (!x || !x.layers.includes(l)) return; x.activeId = l.id; host.panels(); host.refreshOptions(); refresh(); } },
          dot(LABELS.find(([v]) => v === l.label)?.[2] ?? ''), `${l.name} · ${KIND_WORD[layerKindOf(l)]}${l.visible ? '' : ', hidden'}${l.locked ? ', locked' : ''}`)));
      };
      const pick = (label: string, help: string, testid: string, opts: [string, string][], value: string, set: (v: string) => void): HTMLElement => {
        const sel = h('select', { 'data-testid': testid }) as HTMLSelectElement;
        for (const [v, t] of opts) sel.append(h('option', { value: v }, t));
        sel.value = value;
        sel.addEventListener('change', () => { set(sel.value); refresh(); });
        return field(label, help, sel);
      };
      const text = h('input', { type: 'search', 'data-testid': 'sm-find-text', placeholder: 'Name, note or tag' }) as HTMLInputElement;
      text.addEventListener('input', () => { q.text = text.value; refresh(); });
      const bulk = (label: string, pickOne: (l: Layer) => boolean, change: (l: Layer) => void, none: string, said: string): void => {
        const dd = doc(), f = found().filter(pickOne);
        if (!dd || !f.length) { host.toast(none); return; }
        const before = snapshotDoc(dd);
        for (const l of f) change(l);
        host.push(docCommand(label, before, snapshotDoc(dd)), true);
        host.panels();
        refresh();
        host.toast(`${f.length} ${said}`);
      };
      const any = (v: string): string | undefined => (v === 'any' ? undefined : v);
      dialog('find', 'Find layers · Layers filter', [
        field('Words', 'Finds layers whose name, notes or tags hold these words.', text),
        pick('Kind', 'Only layers of this kind.', 'sm-find-kind', [['any', 'Any kind'], ['pixel', 'Picture'], ['text', 'Text'], ['shape', 'Shape'], ['folder', 'Folder'],
          ['adjust', 'Light and colour'], ['fill', 'Colour fill']], q.kind ?? 'any', (v) => { q.kind = any(v) as LayerFind['kind']; }),
        pick('Colour label', 'Only layers with this colour label.', 'sm-find-label', [['any', 'Any label'], ...LABELS.map(([v, t]): [string, string] => [v, v === 'none' ? 'No label' : t])],
          q.label ?? 'any', (v) => { q.label = any(v) as LayerFind['label']; }),
        pick('State', 'Only hidden, shown, locked or unlocked layers.', 'sm-find-state', [['any', 'Any state'], ['hidden', 'Hidden'], ['visible', 'Shown'], ['locked', 'Locked'], ['unlocked', 'Unlocked']],
          q.state ?? 'any', (v) => { q.state = any(v) as LayerFind['state']; }),
        pick('Effects', 'Only layers with layer effects switched on.', 'sm-find-fx', [['any', 'With or without'], ['on', 'With effects']], 'any', (v) => { q.fx = v === 'on' || undefined; }),
        count, list,
        h('div', { class: 'fpe-actions' },
          h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'sm-find-show', onclick: () => bulk('Show the found layers', (l) => !l.visible, (l) => { l.visible = true; }, 'Every layer found is already shown.', 'hidden layers are shown now.') }, 'Show them all'),
          h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'sm-find-unlock', onclick: () => bulk('Unlock the found layers', (l) => !!l.locked, (l) => { delete l.locked; }, 'No layer found is locked.', 'layers are unlocked now.') }, 'Unlock them all')),
      ], null);
      refresh();
      return;
    }
  }
}
