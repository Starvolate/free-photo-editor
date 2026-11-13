// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Smart layers in the editor (smart-layers-design.md), loaded on first use: Make a smart layer, Turn back into pixels, and
 * live filters (a blur or sharpen that stays editable under the layer). Loading this module also lets Free transform and
 * Picture size redraw smart layers from their kept original.
 */
import { activeLayer, ancestors, findLayer, type Command, type Doc, type JobParams, type Layer, type SmartLayer } from '@free-photoeditor/core';
import { h, icon, iconButton } from './dom';
import { BY_ID } from './registry';
import type { AdjDef } from './commands';
import type { Session } from './app';
import { canMakeSmart, convertToSmart, docQuad, installSmartHooks, keepArea, rasterizeSmart, renderSmart, updateSmart } from '@free-photoeditor/core/smart';

export interface SmartHost {
  doc(): Doc | null;
  push(cmd: Command, structural?: boolean): void;
  toast(msg: string): void;
  editable(l: Layer, pixels?: boolean, onMask?: boolean): boolean;
  all(): void;
}
/** The editor's filter dialog, to open a filter (again) as a live filter. */
export interface Ed { openAdjust(id: string, preset?: JobParams): Promise<void> }
let hooked = false;
/** Free transform and Picture size reach smart layers from now on. */
export function ensureSmartHooks(): void {
  if (hooked) return;
  installSmartHooks();
  hooked = true;
}
export function runSmart(id: string, host: SmartHost, ed?: Ed): void {
  ensureSmartHooks();
  const d = host.doc(), l = d ? activeLayer(d) : undefined;
  if (!d || !l) return;
  const live = id === 'layer.smart-filters';
  if (id === 'layer.smart-convert' || (live && l.kind !== 'smart')) {
    if (l.kind === 'smart') { host.toast(`"${l.name}" is already a smart layer.`); return; }
    if (!canMakeSmart(l)) { host.toast('Pick a picture layer first. Folders and light and colour layers have no pixels of their own.'); return; }
    if (!host.editable(l, false)) return;
    const had = !!l.content, c = convertToSmart(l);
    if (!c) return;
    host.push(c, true);
    if (!live) host.toast(`"${l.name}" is a smart layer now: resize or turn it as often as you like, and its original pixels stay safe.${had ? ' Its text or shape is kept as pixels.' : ''}`);
  }
  if (live) {
    host.toast('Smooth blur opens as a live filter. Every blur and sharpen in the Filter menu stays live on a smart layer: it is listed under the layer, where you can switch it off, remove it or click its name to change it.');
    void ed?.openAdjust('filter.blur-gaussian');
  } else if (id === 'layer.smart-rasterize') {
    if (l.kind !== 'smart') { host.toast('Pick a smart layer first.'); return; }
    if (!host.editable(l, false)) return;
    const c = rasterizeSmart(l);
    if (c) host.push(c, true);
  }
}
/** The "Smart" tag on a smart layer's row in the Layers panel (styled here, so the first screen's CSS stays as it was). */
export const tag = (): HTMLElement => h('span', { class: 'fpe-layer-tag', 'data-testid': 'smart-tag', title: 'Smart layer: keeps its original pixels',
  style: 'flex:none;font-size:12px;line-height:18px;padding:0 5px;border:1px solid var(--line);border-radius:4px;color:var(--muted)' }, 'Smart');

// ---------- live filters ----------
/** The filters that can stay live: the blur family and the sharpens. They keep the picture's size, so a live filter only redraws. */
const LIVE = new Set(('blur-gaussian unsharp sharpen sharpen-more blur-box blur-motion blur-radial blur-surface blur-lens blur-average blur-smart '
  + 'blur-field blur-iris blur-tilt smart-sharpen sharpen-edges').split(' ').map((s) => 'filter.' + s));
/** Which live filter a reopened dialog changes (its place in the list); -1 adds a new one. Set by a click on its name. */
let reopen = -1;
const nameOf = (cmd: string): string => BY_ID.get(cmd)?.plain ?? cmd;

/**
 * The filter dialog on a smart layer: the preview runs on the whole layer (never the selection), on a working copy, so the
 * cache the undo steps hold is never written. `before` is that cache; `source` is what the filter runs on: the cache for a new
 * filter, or the picture with only the filters below it when one is reopened.
 */
export function liveSession(id: string, def: AdjDef, label: string, preset: JobParams | undefined, host: SmartHost): Session | null {
  ensureSmartHooks();
  const d = host.doc(), l = d ? activeLayer(d) : undefined, s = l?.smart, k = reopen;
  reopen = -1;
  if (!d || !l || !s || !host.editable(l, false)) return null;
  if (!LIVE.has(id)) { host.toast("This one can't stay live yet: only blurs and sharpens do. Turn the smart layer back into pixels first (Layer, Turn back into pixels)."); return null; }
  const params: JobParams = {};
  for (const c of def.controls) params[c.key] = preset?.[c.key] ?? c.value;
  const before = l.data, g = k >= 0 ? renderSmart({ ...s, filters: s.filters.slice(0, k) }, docQuad(s, l.x, l.y), undefined, keepArea(d))?.geom : null;
  const source = g && g.width === l.width && g.height === l.height ? g.data : before.slice(), r = { x: 0, y: 0, w: l.width, h: l.height }, area = r.w * r.h;
  l.data = before.slice();
  return { id, def, label, spec: { op: def.op, kind: def.kind, params }, layerId: l.id, r, padded: r, source, before, hist: new Uint32Array(256), running: null,
    queued: false, ran: false, after: null, showBefore: false, scale: def.op !== 'adjust' && area > 2e6 ? Math.sqrt(1e6 / area) : 1, small: null, applying: false, live: k };
}
/** Apply: the filter joins (or changes in) the layer's list, and the layer is redrawn from its original, as one undo step. */
export function liveApply(s: Session, host: SmartHost): void {
  const d = host.doc(), l = d ? findLayer(d, s.layerId) : undefined, sm = l?.smart, k = s.live ?? -1;
  if (!d || !l || !sm) return;
  l.data = s.before;
  const params = { ...s.spec.params };
  delete params.ix; delete params.iy; delete params.iw; delete params.ih;
  for (const key of s.def.viewOnly ?? []) params[key] = 0;
  const fs = sm.filters.slice(), f = { id: k >= 0 ? fs[k].id : `${Date.now().toString(36)}${fs.length}`, cmd: s.id, spec: { op: s.spec.op, kind: s.spec.kind, params }, on: true };
  if (k >= 0) fs[k] = f; else fs.push(f);
  const c = updateSmart(d, l, { ...sm, filters: fs }, docQuad(sm, l.x, l.y), `${k >= 0 ? 'Change' : 'Live'} ${s.label.toLowerCase()}`);
  if (c) { host.push(c, true); host.toast(`${s.label} stays live under "${l.name}": switch it off, remove it, or click its name to change it.`); } else host.all();
}
/** The rows under a smart layer in the Layers panel: "Live filters" (its eye switches them all), then one row per filter. */
export function rows(l: Layer, host: SmartHost, ed: Ed): HTMLElement[] {
  const s = l.smart, d = host.doc();
  if (!s?.filters.length || !d) return [];
  const all = s.filtersOn !== false, depth = ancestors(d.layers, l.id).length + 1;
  const set = (sm: SmartLayer, label: string): void => { const c = updateSmart(d, l, sm, docQuad(s, l.x, l.y), label); if (c) host.push(c, true); };
  const eye = (on: boolean, what: string, tid: string, flip: () => void): HTMLElement => h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn', 'aria-pressed': String(on),
    'aria-label': `${on ? 'Hide' : 'Show'} ${what}`, 'data-help-title': on ? 'Switch it off' : 'Switch it on',
    'data-help': 'Shows the layer without this live filter, or with it again. Nothing is lost either way.', 'data-testid': tid, onclick: flip }, icon(on ? 'eye' : 'eye-off'));
  const row = (tid: string, ...kids: (HTMLElement | null)[]): HTMLElement => h('li', { class: 'fpe-layer fpe-live', style: `--depth:${depth}`, 'data-testid': tid },
    kids[0], h('span', { class: 'fpe-indent', 'aria-hidden': 'true' }), ...kids.slice(1));
  return [
    row('live-row', eye(all, `every live filter on ${l.name}`, 'live-all', () => set({ ...s, filtersOn: !all }, all ? 'Switch live filters off' : 'Switch live filters on')),
      h('span', { class: 'fpe-layer-name', style: 'font-size:12px;color:var(--muted)' }, 'Live filters')),
    ...s.filters.map((f, k) => {
      const name = nameOf(f.cmd);
      return row('live-filter', eye(f.on, name, 'live-eye', () => set({ ...s, filters: s.filters.map((x, j) => (j === k ? { ...x, on: !x.on } : x)) }, `${f.on ? 'Hide' : 'Show'} ${name.toLowerCase()}`)),
        h('button', { type: 'button', class: 'fpe-btn fpe-layer-name', 'data-testid': 'live-name', 'data-help-title': `Change ${name.toLowerCase()}`,
          'data-help': 'Opens the filter again with its settings. OK changes it in place; the original picture is never touched.',
          onclick: () => { d.activeId = l.id; reopen = k; void ed.openAdjust(f.cmd, f.spec.params); } }, h('span', {}, name)),
        iconButton('close', `Remove ${name}`, { class: 'fpe-btn fpe-icon-btn', 'data-testid': 'live-remove', 'data-help-title': 'Remove this live filter',
          'data-help': 'Takes the filter off. Undo brings it back.', onclick: () => set({ ...s, filters: s.filters.filter((_, j) => j !== k) }, `Remove ${name.toLowerCase()}`) }));
    }),
  ];
}
