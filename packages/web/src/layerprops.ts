// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Properties of a layer's mask (W6 S1) and of a folder (W6 S2), shown in the Properties panel (design 6). Loaded only when the
 * active layer has a mask or is a folder, so the first screen stays small. Each slider's label sits on its own line above the slider, plain name then pro name.
 * Sliders show their change live and add one undo step when released; buttons run the Layer menu's own functions.
 */
import {
  carriesLocked, effectiveBox, isFolder, moveNode, makeMask, maskCommand, parseHex, propsCommand, subtreeOf, toHex,
  type AdjustLayer, type Command, type Doc, type FillLayer, type Layer, type LayerMask,
} from '@free-photoeditor/core';
import { ADJ } from './commands';
import { renderControls } from './controls';
import { curveEditor } from './curvegraph';
import { h } from './dom';
import { BY_ID } from './registry';

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

/** Whether a Tone curve layer's five Simple sliders are open; kept here so a redraw of the panel keeps it. */
let curveSimpleOpen = false;

/**
 * An editable light and colour layer (W6 S3, design 6): the exact controls of its Image › Adjustments dialog, drawn by the
 * one shared renderer. Moving a control shows live on the canvas; letting go adds one undo step. Clip and Reset sit below.
 */
export function renderAdjustProps(el: HTMLElement, host: MaskPropsHost): void {
  const l = host.layer(), a = l?.adjust;
  if (!l || !a) return;
  const def = ADJ[a.from], row = BY_ID.get(a.from), job = a.job, name = row?.plain ?? 'Light and colour';
  const head = h('div', { class: 'fpe-mask-head' }, name + ' ', h('small', { class: 'fpe-pro' }, row?.pro ?? ''));
  if (!def || !job) {
    el.replaceChildren(head, h('p', { class: 'fpe-note' }, 'This layer came from a file with settings this editor cannot show yet. It is kept as it is and saved back unchanged.'));
    return;
  }
  const params: Record<string, number | undefined> = { ...job.params }, curves = a.from === 'image.adj-curves';
  let start: AdjustLayer | null = null;
  const input = (): void => {
    const t = host.layer();
    if (!t?.adjust?.job) return;
    start ??= t.adjust;
    t.adjust = { ...t.adjust, job: { ...t.adjust.job, params: { ...params } } };
    host.live();
  };
  const commit = (): void => {
    const t = host.layer(), from = start;
    start = null;
    if (t?.adjust && from && from !== t.adjust) host.push(propsCommand(t.id, { adjust: from }, { adjust: t.adjust }, name));
  };
  const draw = (): void => {
    const clipId = `fpe-${host.uid}-adj-clip`;
    const cb = h('input', { id: clipId, type: 'checkbox', checked: !!host.layer()?.clip, 'data-testid': 'adjust-clip' }) as HTMLInputElement;
    cb.addEventListener('change', () => host.run('layer.clip'));
    const reset = h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'adjust-reset', 'data-help-title': 'Back to the start · Reset',
      'data-help': 'Puts every setting of this layer back where it started.', onclick: () => {
        for (const c of def.controls) params[c.key] = c.value;
        if (curves) for (const k of Object.keys(params)) if (/^[rgb][0-4]$/.test(k)) delete params[k];
        input(); commit(); draw();
      } }, 'Back to the start');
    const note = h('p', { class: 'fpe-note' }, `${row?.help ? row.help + ' ' : ''}As a layer it changes everything below and keeps their pixels: change it at any time, or hide it to compare.`);
    const clip = h('div', { class: 'fpe-check', 'data-help-title': 'Affects only the layer below · Clip', 'data-help': 'Changes only the layer directly below it instead of everything below.' },
      cb, h('label', { for: clipId }, 'Affects only the layer below ', h('small', { class: 'fpe-pro' }, 'Clip')));
    const acts = h('div', { class: 'fpe-mask-actions' }, reset);
    if (curves) {
      // A Tone curve layer (UI-D, a-deep): the graph first; its five sliders are the same all-colours points, behind Simple.
      const syncSliders = (): void => {
        for (const c of def.controls) {
          const s = el.querySelector<HTMLInputElement>(`[data-testid="ctl-${c.key}"]`), v = params[c.key];
          if (!s || v == null) continue;
          s.value = String(v);
          const o = s.closest('.fpe-field')?.querySelector('output');
          if (o) o.textContent = String(v);
        }
      };
      const ed = curveEditor(params, { doc: host.doc, input: () => { input(); syncSliders(); }, commit }, name, row?.pro ?? 'Curves');
      const simple = h('details', { class: 'fpe-curve-simple', 'data-testid': 'curve-simple', open: curveSimpleOpen },
        h('summary', { 'data-help-title': 'Simple · five sliders', 'data-help': 'The same curve as five sliders, darkest to lightest, for all colours together.' }, 'Simple: five sliders'),
        ...renderControls(def.controls, params, `fpe-${host.uid}-adj-`, { input: () => { input(); ed.sync(); }, commit, rerender: draw }));
      simple.addEventListener('toggle', () => { curveSimpleOpen = simple.open; });
      el.replaceChildren(...ed.parts, simple, note, clip, acts);
      return;
    }
    el.replaceChildren(head, note, ...renderControls(def.controls, params, `fpe-${host.uid}-adj-`, { input, commit, rerender: draw }), clip, acts);
  };
  draw();
}

/** A solid colour layer (W6 S3): its colour, live on the canvas while it changes, one undo step when it is set. */
export function renderFillProps(el: HTMLElement, host: MaskPropsHost): void {
  const l = host.layer(), f = l?.fill;
  if (!l || !f) return;
  const id = `fpe-${host.uid}-fill`, inp = h('input', { id, type: 'color', value: toHex(f.color), 'data-testid': 'fill-color' }) as HTMLInputElement;
  let start: FillLayer | null = null;
  inp.addEventListener('input', () => {
    const t = host.layer(), c = parseHex(inp.value);
    if (!t?.fill || !c) return;
    start ??= t.fill;
    t.fill = { type: 'solid', color: { r: c.r, g: c.g, b: c.b, a: 255 } };
    host.live();
  });
  inp.addEventListener('change', () => {
    const t = host.layer(), from = start;
    start = null;
    if (t?.fill && from && from !== t.fill) host.push(propsCommand(t.id, { fill: from }, { fill: t.fill }, 'Change the colour'));
  });
  el.replaceChildren(h('div', { class: 'fpe-mask-head' }, 'Solid colour layer ', h('small', { class: 'fpe-pro' }, 'Solid colour fill')),
    h('p', { class: 'fpe-note' }, 'One colour over the whole picture. Change it at any time; lower the opacity or pick a blend to mix it with what is below.'),
    h('div', { class: 'fpe-row', 'data-help-title': 'Colour', 'data-help': 'The colour that fills the layer.' }, h('label', { for: id }, 'Colour'), inp));
}
