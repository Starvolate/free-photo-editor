// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Smart layers in the editor (smart-layers-design.md), loaded on first use: Make a smart layer and Turn back into pixels.
 * Loading this module also lets Free transform and Picture size redraw smart layers from their kept original.
 */
import { activeLayer, type Command, type Doc, type Layer } from '@free-photoeditor/core';
import { h } from './dom';
import { canMakeSmart, convertToSmart, installSmartHooks, rasterizeSmart } from '@free-photoeditor/core/smart';

export interface SmartHost {
  doc(): Doc | null;
  push(cmd: Command, structural?: boolean): void;
  toast(msg: string): void;
  editable(l: Layer, pixels?: boolean, onMask?: boolean): boolean;
}
let hooked = false;
/** Free transform and Picture size reach smart layers from now on. */
export function ensureSmartHooks(): void {
  if (hooked) return;
  installSmartHooks();
  hooked = true;
}
export function runSmart(id: string, host: SmartHost): void {
  ensureSmartHooks();
  const d = host.doc(), l = d ? activeLayer(d) : undefined;
  if (!d || !l) return;
  if (id === 'layer.smart-convert') {
    if (l.kind === 'smart') { host.toast(`"${l.name}" is already a smart layer.`); return; }
    if (!canMakeSmart(l)) { host.toast('Pick a picture layer first. Folders and light and colour layers have no pixels of their own.'); return; }
    if (!host.editable(l, false)) return;
    const had = !!l.content, c = convertToSmart(l);
    if (!c) return;
    host.push(c, true);
    host.toast(`"${l.name}" is a smart layer now: resize or turn it as often as you like, and its original pixels stay safe.${had ? ' Its text or shape is kept as pixels.' : ''}`);
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
