// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Layer effects in Properties (W6 S4, design 6): one section per effect, drawn by the shared control renderer, plain name
 * first and pro name second. Moving a control shows live on the canvas; letting go adds one undo step. Loaded only when the
 * active layer has effects, together with the effects engine, so the first screen stays small.
 */
import { parseHex, propsCommand, toHex, type Layer, type LayerEffects, type RGBA } from '@free-photoeditor/core';
import type { Ctl } from './commands';
import { renderControls } from './controls';
import { h } from './dom';
import type { MaskPropsHost } from './layerprops';

type Key = 'dropShadow' | 'innerShadow' | 'outerGlow' | 'innerGlow' | 'colorOverlay' | 'gradientOverlay' | 'stroke';
type Entry = { on: boolean; opacity: number; color?: RGBA } & Record<string, unknown>;
const R = (key: string, label: string, help: string, min: number, max: number, value: number, unit = ''): Ctl => ({ key, label, help, min, max, value, step: 1, unit });
const OP = R('opacity', 'Strength · Opacity', 'How strong the effect is: 100% fully, lower lets it fade.', 0, 100, 75, '%');
const ANGLE = R('angle', 'Light from · Angle', 'Where the light comes from, in degrees (90 = from above); shadows fall the other way.', 0, 360, 120, '°');
const SIZE = (help: string): Ctl => R('size', 'Size', help, 0, 100, 10, ' px');
const SHADOW: Ctl[] = [OP, ANGLE, R('distance', 'Distance', 'How far the shadow falls from the layer.', 0, 100, 10, ' px'),
  R('spread', 'Spread', 'How solid it stays before it softens.', 0, 100, 0, '%'), SIZE('How soft the edge is.')];
const INNER: Ctl[] = [OP, ANGLE, R('distance', 'Distance', 'How far the shadow sits in from the edge.', 0, 100, 5, ' px'),
  R('spread', 'Solid part · Choke', 'How solid it stays before it softens.', 0, 100, 0, '%'), SIZE('How soft the edge is.')];
const GLOW: Ctl[] = [OP, R('spread', 'Spread', 'How solid it stays before it fades.', 0, 100, 0, '%'), SIZE('How far the glow reaches.')];
const SECTIONS: { key: Key; plain: string; pro: string; help: string; ctls: Ctl[] }[] = [
  { key: 'dropShadow', plain: 'Drop shadow', pro: 'Drop shadow', help: 'A soft shadow behind the layer.', ctls: SHADOW },
  { key: 'innerShadow', plain: 'Inner shadow', pro: 'Inner shadow', help: 'A shadow inside the edges, so it looks pressed in.', ctls: INNER },
  { key: 'outerGlow', plain: 'Outer glow', pro: 'Outer glow', help: 'A soft light around the outside.', ctls: GLOW },
  { key: 'innerGlow', plain: 'Inner glow', pro: 'Inner glow', help: 'A soft light inside the edges.',
    ctls: [...GLOW, { key: 'from', label: 'Shines from · Source', help: 'From the edge inwards, or from the middle outwards.', value: 0, type: 'select', options: ['The edge', 'The middle'] }] },
  { key: 'colorOverlay', plain: 'Colour overlay', pro: 'Colour overlay', help: 'Covers the layer with one colour.', ctls: [{ ...OP, value: 100 }] },
  { key: 'gradientOverlay', plain: 'Gradient overlay', pro: 'Gradient overlay', help: 'Covers the layer with a colour fade.',
    ctls: [{ ...OP, value: 100 }, { ...ANGLE, label: 'Direction · Angle', help: 'Which way the fade runs, in degrees.', value: 90 },
      R('scale', 'Length · Scale', 'How long the fade is across the layer.', 10, 150, 100, '%'),
      { key: 'shape', label: 'Shape · Style', help: 'A straight fade or a round one from the middle.', value: 0, type: 'select', options: ['Straight', 'Round'] },
      { key: 'reverse', label: 'Reverse', help: 'Swaps the two ends of the fade.', value: 0, type: 'check' }] },
  { key: 'stroke', plain: 'Outline', pro: 'Stroke', help: 'A coloured outline around the layer.',
    ctls: [R('size', 'Thickness · Size', 'How thick the outline is.', 1, 50, 3, ' px'),
      { key: 'where', label: 'Where · Position', help: 'Inside the edge, centred on it, or outside it.', value: 2, type: 'select', options: ['Inside', 'Centred', 'Outside'] }, { ...OP, value: 100 }] },
];
const WHERE = ['inside', 'centre', 'outside'] as const;
/** The entry's numbers as the controls show them. */
function numbers(e: Entry): Record<string, number | undefined> {
  const p: Record<string, number | undefined> = { opacity: Math.round(e.opacity * 100) };
  for (const k of ['angle', 'distance', 'spread', 'size']) if (typeof e[k] === 'number') p[k] = e[k] as number;
  if (typeof e.scale === 'number') p.scale = Math.round(e.scale * 100);
  if ('shape' in e) p.shape = e.shape === 'radial' ? 1 : 0;
  if ('reverse' in e) p.reverse = e.reverse ? 1 : 0;
  if ('where' in e) p.where = Math.max(0, WHERE.indexOf(e.where as (typeof WHERE)[number]));
  if ('from' in e || 'spread' in e) p.from = e.from === 'centre' ? 1 : 0;
  return p;
}
/** A new entry with the controls' numbers (a value object: never changed in place). */
function withNumbers(e: Entry, key: Key, p: Record<string, number | undefined>): Entry {
  const n: Entry = { ...e, opacity: (p.opacity ?? 100) / 100 };
  for (const k of ['angle', 'distance', 'spread', 'size']) if (typeof e[k] === 'number' && p[k] !== undefined) n[k] = p[k];
  if (typeof e.scale === 'number' && p.scale !== undefined) n.scale = p.scale / 100;
  if ('shape' in e) n.shape = p.shape ? 'radial' : 'linear';
  if ('reverse' in e) n.reverse = !!p.reverse;
  if ('where' in e) n.where = WHERE[p.where ?? 2] ?? 'outside';
  if (key === 'innerGlow') n.from = p.from ? 'centre' : 'edge';
  return n;
}
const entries = (f: LayerEffects, key: Key): Entry[] => {
  const v = (f as unknown as Record<string, unknown>)[key];
  return (Array.isArray(v) ? v : v ? [v] : []) as Entry[];
};
/** The effects object with entry i of `key` replaced (or removed with null). */
function put(f: LayerEffects, key: Key, i: number, next: Entry | null): LayerEffects {
  const o = { ...f } as unknown as Record<string, unknown>, v = o[key];
  if (Array.isArray(v)) o[key] = next ? v.map((x, j) => (j === i ? next : x)) : v.filter((_, j) => j !== i);
  else if (next) o[key] = next; else delete o[key];
  return o as unknown as LayerEffects;
}

export function renderFxProps(el: HTMLElement, host: MaskPropsHost): void {
  const l = host.layer(), f = l?.fx;
  if (!l || !f) return;
  let start: LayerEffects | null = null;
  const live = (next: (t: Layer, fx: LayerEffects) => LayerEffects): void => {
    const t = host.layer();
    if (!t?.fx) return;
    start ??= t.fx;
    t.fx = next(t, t.fx);
    host.live();
  };
  const commit = (label: string): void => {
    const t = host.layer(), from = start;
    start = null;
    if (t?.fx && from && from !== t.fx) host.push(propsCommand(t.id, { fx: from }, { fx: t.fx }, label));
  };
  const now = (label: string, next: (fx: LayerEffects) => LayerEffects): void => {
    const t = host.layer();
    if (t?.fx) host.push(propsCommand(t.id, { fx: t.fx }, { fx: next(t.fx) }, label));
  };
  const uid = `fpe-${host.uid}-fx-`, allId = uid + 'all';
  const all = h('input', { id: allId, type: 'checkbox', checked: f.on, 'data-testid': 'fx-all' }) as HTMLInputElement;
  all.addEventListener('change', () => now(all.checked ? 'Show the effects' : 'Hide the effects', (x) => ({ ...x, on: all.checked })));
  const kids: HTMLElement[] = [
    h('div', { class: 'fpe-mask-head' }, 'Effects ', h('small', { class: 'fpe-pro' }, 'Layer style')),
    h('div', { class: 'fpe-check', 'data-help-title': 'Show the effects', 'data-help': 'Switch every effect of this layer off or on at once, to compare.' }, all, h('label', { for: allId }, 'Show the effects')),
  ];
  for (const s of SECTIONS) entries(f, s.key).forEach((e, i) => {
    const base = `${uid}${s.key}-${i}-`, params = numbers(e);
    const onId = base + 'on', cb = h('input', { id: onId, type: 'checkbox', checked: e.on, 'data-testid': 'fx-on' }) as HTMLInputElement;
    cb.addEventListener('change', () => now(cb.checked ? `Show the ${s.plain.toLowerCase()}` : `Hide the ${s.plain.toLowerCase()}`, (x) => put(x, s.key, i, { ...entries(x, s.key)[i], on: cb.checked })));
    const parts: HTMLElement[] = [
      h('h3', { class: 'fpe-group-title', 'data-help-title': `${s.plain} · ${s.pro}`, 'data-help': s.help }, s.plain + ' ', h('small', { class: 'fpe-pro' }, s.pro)),
      h('div', { class: 'fpe-check', 'data-help-title': 'Show', 'data-help': 'Hide this effect to compare; its settings are kept.' }, cb, h('label', { for: onId }, 'Show')),
    ];
    if (e.color) {
      const cid = base + 'color', inp = h('input', { id: cid, type: 'color', value: toHex(e.color), 'data-testid': 'fx-color' }) as HTMLInputElement;
      inp.addEventListener('input', () => { const c = parseHex(inp.value); if (c) live((_t, x) => put(x, s.key, i, { ...entries(x, s.key)[i], color: { r: c.r, g: c.g, b: c.b, a: 255 } })); });
      inp.addEventListener('change', () => commit(`${s.plain} colour`));
      parts.push(h('div', { class: 'fpe-row', 'data-help-title': 'Colour', 'data-help': `The colour of the ${s.plain.toLowerCase()}.` }, h('label', { for: cid }, 'Colour'), inp));
    }
    parts.push(...renderControls(s.ctls, params, base, {
      input: () => live((_t, x) => put(x, s.key, i, withNumbers(entries(x, s.key)[i], s.key, params))),
      commit: () => commit(s.plain),
      rerender: () => { /* no ready-made choices here */ },
    }));
    parts.push(h('div', { class: 'fpe-mask-actions' }, h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'fx-remove', 'data-help-title': `Remove · Delete ${s.pro.toLowerCase()}`,
      'data-help': `Throw this ${s.plain.toLowerCase()} away. Undo brings it back.`, onclick: () => now(`Remove the ${s.plain.toLowerCase()}`, (x) => put(x, s.key, i, null)) }, 'Remove')));
    kids.push(h('div', { class: 'fpe-fx-section', 'data-testid': `fx-${s.key}-${i}` }, ...parts));
  });
  el.replaceChildren(...kids);
}
