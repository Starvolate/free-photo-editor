// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Properties of a layer's mask (W6 S1) and of a folder (W6 S2), shown in the Properties panel (design 6). Loaded only when the
 * active layer has a mask or is a folder, so the first screen stays small. Each slider's label sits on its own line above the slider, plain name then pro name.
 * Sliders show their change live and add one undo step when released; buttons run the Layer menu's own functions.
 */
import {
  BLEND_GROUPS, BLEND_LABELS, isBlendMode, isFolder, makeMask, maskCommand, propsCommand, setLayerProps, subtreeOf,
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

/** A folder's section: how it mixes (Pass through or a blend), how solid it is, open or closed, and taking it apart. */
export function renderFolderProps(el: HTMLElement, host: FolderPropsHost): void {
  const d = host.doc(), f = host.layer();
  if (!d || !f || !isFolder(f)) return;
  const id = `fpe-${host.uid}-folder`, n = subtreeOf(d.layers, f.id).length - 1, open = f.open !== false, pass = !!f.passThrough;
  const mix = h('select', { id: id + 'm', 'data-testid': 'folder-mix' }, h('option', { value: 'pass', selected: pass }, 'Pass through'),
    ...BLEND_GROUPS.map((g) => h('optgroup', { label: g.label }, ...g.modes.map((m) => h('option', { value: m, selected: !pass && m === f.blendMode }, BLEND_LABELS[m])))));
  mix.addEventListener('change', () => {
    const t = host.layer(), doc = host.doc(), v = mix.value;
    if (!t || !doc) return;
    if (v === 'pass') host.push(setLayerProps(doc, t.id, { passThrough: true }, 'Folder mixes: pass through'));
    else if (isBlendMode(v)) host.push(setLayerProps(doc, t.id, { passThrough: false, blendMode: v }, 'Folder blend'));
  });
  const op = h('input', { id: id + 'o', type: 'range', min: 0, max: 100, step: 1, value: Math.round(f.opacity * 100), 'data-testid': 'folder-opacity' }) as HTMLInputElement;
  const out = h('output', { class: 'fpe-out', for: id + 'o' }, Math.round(f.opacity * 100) + '%');
  let start: number | null = null;
  op.addEventListener('input', () => {
    const t = host.layer();
    if (!t) return;
    start ??= t.opacity;
    t.opacity = Number(op.value) / 100;
    out.textContent = op.value + '%';
    host.live();
  });
  op.addEventListener('change', () => {
    const t = host.layer(), from = start;
    start = null;
    if (t && from !== null && from !== t.opacity) host.push(propsCommand(t.id, { opacity: from }, { opacity: t.opacity }, 'Folder opacity'));
  });
  const btn = (label: string, pro: string, help: string, testid: string, run: () => void): HTMLElement =>
    h('button', { type: 'button', class: 'fpe-btn', 'data-testid': testid, 'data-help-title': `${label} · ${pro}`, 'data-help': help, onclick: run }, label);
  el.replaceChildren(
    h('div', { class: 'fpe-mask-head' }, `Folder: ${f.name} `, h('small', { class: 'fpe-pro' }, `${n} layer${n === 1 ? '' : 's'} inside`)),
    h('div', { class: 'fpe-row', 'data-help-title': 'How the folder mixes · Blend mode',
      'data-help': 'Pass through lets the layers inside mix with everything below, as if there were no folder. Any other choice first makes the folder one picture, then mixes it.' },
    h('label', { for: id + 'm' }, 'How it mixes ', h('small', { class: 'fpe-pro' }, 'Blend mode')), mix),
    h('div', { class: 'fpe-row', 'data-help-title': 'How solid the folder is · Opacity', 'data-help': 'Lower lets the layers below the folder show through everything in it.' },
      h('label', { for: id + 'o' }, 'How solid ', h('small', { class: 'fpe-pro' }, 'Opacity')), op, out),
    h('div', { class: 'fpe-mask-actions' },
      btn(open ? 'Close the folder' : 'Open the folder', 'Collapse group', 'Hides or shows the rows inside in the Layers panel. The picture does not change.', 'folder-toggle', () => host.toggleOpen(f.id)),
      btn('Take out of the folder', 'Ungroup layers', 'The layers inside move out, in the same order, and the folder goes.', 'folder-ungroup', () => host.run('layer.ungroup'))));
}
