// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * More Select & cut out and Arrange layers commands, loaded the first time one is used (the select-and-layers batch,
 * 13 Nov 2026): select by brightness, by a colour channel or by a layer's solid parts; fill holes, round the corners or
 * roughen the edge of a selection; lift the selected pixels into a new layer; crop a layer to its content, fill or swap
 * its see-through parts, split it by colour, and reverse the layer order. Each change is one undo step. The maths lives
 * in core (selection-more.ts) with its unit tests; this file only asks and applies.
 */
import {
  combineMasks, commitShape, compositeDoc, countSelected, createLayer, docCommand, docRect, hasPixels, maskFromSelection, parseHex,
  selectionFromMask, snapshotDoc, type Command, type Doc, type Layer, type Mask, type Selection, type SelMode,
} from '@free-photoeditor/core';
import {
  alphaMask, channelMask, cropToContent, floatSelection, geomOf, invertAlpha, layerDataCommand, luminanceMask, removeAlpha, removeHoles,
  reversedOrder, roughenMask, roundCorners, splitByColour,
} from '@free-photoeditor/core/selection-more';
import { h } from './dom';
import type { ToolHost } from './toolkit';

/** The commands this module runs; commands.ts gives each its handler. */
export const SELMORE_IDS = ['select.luminance', 'select.from-alpha', 'select.from-channel', 'select.remove-holes', 'select.round-corners',
  'select.distort', 'select.float', 'layer.crop-to-content', 'layer.remove-alpha', 'layer.invert-alpha', 'layer.split-by-colour', 'layer.reverse'];

const bodies = new Map<string, HTMLElement>();
const hex = (c: { r: number; g: number; b: number }): string => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
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
  function dialog(key: string, title: string, fields: HTMLElement[], apply: () => void): void {
    let body = bodies.get(key);
    if (!body) { body = h('div', { class: 'fpe-stack', 'data-testid': 'sm-' + key }); bodies.set(key, body); }
    body.replaceChildren(...fields, h('div', { class: 'fpe-actions' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'sm-cancel', onclick: () => host.closeSheet() }, 'Cancel'),
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'sm-apply', onclick: () => { host.closeSheet(); apply(); } }, 'Apply')));
    host.sheet('sm-' + key, title, body);
  }
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
  }
}
