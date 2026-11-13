// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Properties of a layer's mask (W6 S1) and of a folder (W6 S2), shown in the Properties panel (design 6). Loaded only when the
 * active layer has a mask or is a folder, so the first screen stays small. Each slider's label sits on its own line above the slider, plain name then pro name.
 * Sliders show their change live and add one undo step when released; buttons run the Layer menu's own functions.
 */
import {
  carriesLocked, effectiveBox, isFolder, moveNode, makeMask, maskCommand, subtreeOf,
  type Command, type Doc, type Layer, type LayerMask,
} from '@free-photoeditor/core';
import { h } from './dom';

export interface MaskPropsHost {
  uid: string | number;
  doc(): Doc | null;
  layer(): Layer | undefined;
  push(c: Command | null): void;
  run(id: string): void;
  /** Redraw the canvas after a live (not yet recorded) change. */
  live(): void;
  /** Say something short in plain words. */
  toast(msg: string): void;
}

function slider(host: MaskPropsHost, key: 'density' | 'feather', plain: string, pro: string, help: string, max: number, unit: string,
  get: (m: LayerMask) => number, set: (m: LayerMask, v: number) => LayerMask): HTMLElement {
  const l = host.layer(), m = l?.mask as LayerMask, id = `fpe-${host.uid}-mask-${key}`;
  const input = h('input', { id, type: 'range', min: 0, max, step: 1, value: get(m), 'data-testid': 'mask-' + key }) as HTMLInputElement;
  const out = h('output', { class: 'fpe-out', for: id }, get(m) + unit);
  let start: LayerMask | null = null;
  input.addEventListener('input', () => {
    const t = host.layer();
    if (!t?.mask) return;
    start ??= t.mask;
    t.mask = set(t.mask, Number(input.value));
    out.textContent = input.value + unit;
    host.live();
  });
  input.addEventListener('change', () => {
    const t = host.layer(), from = start;
    start = null;
    if (t?.mask && from && from !== t.mask) host.push(maskCommand(plain, t.id, from, t.mask));
  });
  return h('div', { class: 'fpe-row', 'data-help-title': `${plain} · ${pro}`, 'data-help': help },
    h('label', { for: id }, plain, ' ', h('small', { class: 'fpe-pro' }, pro)), input, out);
}

export function renderMaskProps(el: HTMLElement, host: MaskPropsHost): void {
  const l = host.layer(), m = l?.mask;
  if (!l || !m) return;
  const btn = (label: string, pro: string, help: string, testid: string, run: () => void): HTMLElement =>
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': testid, 'data-help-title': `${label} · ${pro}`, 'data-help': help, onclick: run }, label);
  const fromSel = (): void => {
    const d = host.doc(), t = host.layer();
    if (!d || !t?.mask) return;
    if (!d.selection) { host.toast('Select an area first: then this makes the mask show only that part.'); return; }
    const next = makeMask(d, 'selection');
    if (next) { next.linked = t.mask.linked; host.push(maskCommand('Mask from the selection', t.id, t.mask, next)); }
  };
  el.replaceChildren(
    h('div', { class: 'fpe-mask-head' }, `Mask of ${l.name} `, h('small', { class: 'fpe-pro' }, m.enabled ? 'on' : 'switched off')),
    slider(host, 'density', 'How strongly the mask hides', 'Density', 'At 100% hidden parts are fully hidden; lower lets them half show.', 100, '%',
      (x) => Math.round(x.density * 100), (x, v) => ({ ...x, density: v / 100 })),
    slider(host, 'feather', 'Soft edge', 'Feather', 'Softens the mask’s edges as it is drawn; the mask itself is not changed.', 100, ' px',
      (x) => Math.round(x.feather), (x, v) => ({ ...x, feather: v })),
    h('div', { class: 'fpe-mask-actions' },
      btn('Swap shown and hidden', 'Invert', 'What was hidden shows, and what showed is hidden.', 'mask-invert', invert),
      btn('From the selection', 'Reveal selection', 'Replace the mask: show only the selected part.', 'mask-from-sel', fromSel),
      btn('Make permanent', 'Apply mask', 'Erase what the mask hides and remove the mask.', 'mask-apply', () => host.run('layer.mask-apply')),
      btn('Remove', 'Delete mask', 'Throw the mask away and show the whole layer.', 'mask-delete', () => host.run('layer.mask-delete')),
      btn(m.enabled ? 'Switch off' : 'Switch on', 'Disable layer mask', 'See the whole layer without losing the mask.', 'mask-toggle', () => host.run('layer.mask-toggle')),
      btn(m.linked ? 'Unlink' : 'Link', 'Link layer mask', 'Linked, the mask moves and turns with the layer.', 'mask-link-btn', () => host.run('layer.mask-link'))));
  function invert(): void {
    const t = host.layer(), x = t?.mask;
    if (!t || !x) return;
    const data = new Uint8Array(x.data.length);
    for (let i = 0; i < data.length; i++) data[i] = 255 - x.data[i];
    host.push(maskCommand('Invert the mask', t.id, x, { ...x, data, outside: (255 - x.outside) as 0 | 255 }));
  }
}

export interface FolderPropsHost extends MaskPropsHost {
  /** Open or close the folder's rows (a view choice, not an undo step). */
  toggleOpen(id: string): void;
}

/** A folder's section: where it sits (X and Y move everything inside), open or closed, and taking it apart. Blend and
 * opacity are at the top of the Layers card, so they show once. */
export function renderFolderProps(el: HTMLElement, host: FolderPropsHost): void {
  const d = host.doc(), f = host.layer();
  if (!d || !f || !isFolder(f)) return;
  const id = `fpe-${host.uid}-folder`, n = subtreeOf(d.layers, f.id).length - 1, open = f.open !== false, pass = !!f.passThrough;
  // X and Y are the top-left of everything inside; a change moves the folder with all its layers, as one undo step.
  const box = effectiveBox(d.layers, f);
  const num = (key: 'x' | 'y', label: string, help: string): HTMLElement => {
    const inp = h('input', { id: id + key, type: 'number', value: box ? box[key] : 0, step: 1, 'data-testid': 'prop-' + key }) as HTMLInputElement;
    if (!box) inp.disabled = true;
    inp.addEventListener('change', () => {
      const t = host.layer(), doc = host.doc(), b = t && doc ? effectiveBox(doc.layers, t) : null, v = Math.round(Number(inp.value));
      if (!t || !doc || !b || !Number.isFinite(v) || v === b[key]) return;
      if (carriesLocked(doc, t.id)) { host.toast('Something in this folder is locked: unlock it first.'); inp.value = String(b[key]); return; }
      host.push(moveNode(doc, t.id, key === 'x' ? v - b.x : 0, key === 'y' ? v - b.y : 0, 'Move layer'));
    });
    return h('div', { class: 'fpe-row', 'data-help-title': label, 'data-help': help }, h('label', { for: id + key }, label), inp);
  };
  const btn = (label: string, pro: string, help: string, testid: string, run: () => void): HTMLElement =>
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': testid, 'data-help-title': `${label} · ${pro}`, 'data-help': help, onclick: run }, label);
  el.replaceChildren(
    h('div', { class: 'fpe-mask-head' }, `Folder: ${f.name} `, h('small', { class: 'fpe-pro' }, `${n} layer${n === 1 ? '' : 's'} inside`)),
    num('x', 'Left (X)', 'Where everything in the folder starts from the left edge, in pixels. Change it to move the folder and all its layers.'),
    num('y', 'Top (Y)', 'Where everything in the folder starts from the top edge, in pixels. Change it to move the folder and all its layers.'),
    h('div', { class: 'fpe-mask-actions' },
      btn(open ? 'Close the folder' : 'Open the folder', 'Collapse group', 'Hides or shows the rows inside in the Layers panel. The picture does not change.', 'folder-toggle', () => host.toggleOpen(f.id)),
      btn('Take out of the folder', 'Ungroup layers', 'The layers inside move out, in the same order, and the folder goes.', 'folder-ungroup', () => host.run('layer.ungroup'))));
}
