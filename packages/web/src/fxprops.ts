// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Layer effects in Properties (W6 S4, design 6): one section per effect, drawn by the shared control renderer, plain name
 * first and pro name second. Moving a control shows live on the canvas; letting go adds one undo step. Loaded only when the
 * active layer has effects, together with the effects engine, so the first screen stays small.
 * Batch effects 3 adds the raised edge, satin sheen, pattern overlay, blur and show-by-brightness sections, the settings of
 * colour fade and pattern layers, and the Saved looks sheet (named sets of effects to put on other layers).
 */
import {
  addNode, compositeRect, hasLayerFx, intersect, nextLayerName, parseHex, propsCommand, toHex,
  type Command, type FillLayer, type FxBevel, type FxBlendIf, type FxBlur, type FxPattern, type Layer, type LayerEffects, type PatternImage, type RGBA,
} from '@free-photoeditor/core';
import { PATTERNS, addLayerFx, createFillOf } from '@free-photoeditor/core/layerfx';
import type { Ctl } from './commands';
import { renderControls } from './controls';
import { h } from './dom';
import type { MaskPropsHost } from './layerprops';
import type { ToolHost } from './toolkit';

type Key = 'dropShadow' | 'innerShadow' | 'outerGlow' | 'innerGlow' | 'satin' | 'colorOverlay' | 'gradientOverlay' | 'stroke';
type Entry = { on: boolean; opacity: number; color?: RGBA } & Record<string, unknown>;
type Params = Record<string, number | undefined>;
const R = (key: string, label: string, help: string, min: number, max: number, value: number, unit = '', group?: string): Ctl => ({ key, label, help, min, max, value, step: 1, unit, group });
const SELECT = (key: string, label: string, help: string, options: readonly string[]): Ctl => ({ key, label, help, value: 0, type: 'select', options });
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
  { key: 'satin', plain: 'Satin sheen', pro: 'Satin', help: 'A silky shine across the layer, shaped by its own outline.',
    ctls: [{ ...OP, value: 50 }, { ...ANGLE, label: 'Direction · Angle', help: 'Which way the sheen runs, in degrees.', value: 19 },
      R('distance', 'Distance', 'How far apart the two bands of the sheen sit.', 0, 100, 11, ' px'), SIZE('How soft the sheen is.'),
      { key: 'invert', label: 'Swap light and dark · Invert', help: 'Swaps where the sheen darkens and where it leaves the layer alone.', value: 1, type: 'check' }] },
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
function numbers(e: Entry): Params {
  const p: Params = { opacity: Math.round(e.opacity * 100) };
  for (const k of ['angle', 'distance', 'spread', 'size']) if (typeof e[k] === 'number') p[k] = e[k] as number;
  if (typeof e.scale === 'number') p.scale = Math.round(e.scale * 100);
  if ('shape' in e) p.shape = e.shape === 'radial' ? 1 : 0;
  if ('reverse' in e) p.reverse = e.reverse ? 1 : 0;
  if ('invert' in e) p.invert = e.invert ? 1 : 0;
  if ('where' in e) p.where = Math.max(0, WHERE.indexOf(e.where as (typeof WHERE)[number]));
  if ('from' in e || 'spread' in e) p.from = e.from === 'centre' ? 1 : 0;
  return p;
}
/** A new entry with the controls' numbers (a value object: never changed in place). */
function withNumbers(e: Entry, key: Key, p: Params): Entry {
  const n: Entry = { ...e, opacity: (p.opacity ?? 100) / 100 };
  for (const k of ['angle', 'distance', 'spread', 'size']) if (typeof e[k] === 'number' && p[k] !== undefined) n[k] = p[k];
  if (typeof e.scale === 'number' && p.scale !== undefined) n.scale = p.scale / 100;
  if ('shape' in e) n.shape = p.shape ? 'radial' : 'linear';
  if ('reverse' in e) n.reverse = !!p.reverse;
  if ('invert' in e) n.invert = !!p.invert;
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

// ---------- the effects with settings of their own shape (batch effects 3) ----------

type One = 'bevel' | 'patternOverlay' | 'blur' | 'blendIf';
/** A colour of an effect: a picker, live while it moves, one undo step when it is set. */
interface Hue<E> { key: string; label: string; help: string; get(e: E): RGBA; set(e: E, c: RGBA): E; }
interface OwnSection<E> {
  key: One; plain: string; pro: string; help: string;
  ctls(e: E): Ctl[];
  read(e: E): Params;
  write(e: E, p: Params): E;
  hues?: Hue<E>[];
  /** Keeps linked numbers in order while one moves (show by brightness); `prev` is the settings before the move. */
  tidy?(p: Params, prev: Params, idBase: string): void;
  /** Buttons below the controls (the pattern from the selection). */
  extra?(ctx: { host: MaskPropsHost; now: (label: string, next: (e: E) => E) => void }): HTMLElement[];
}
const STYLES = ['inner', 'outer', 'emboss', 'pillow'] as const;
const pct = (v: number): number => Math.round(v * 100);
/** Raised edge: its own read and write, since its light and shade are two tones, not one colour and opacity. */
export const BEVEL: OwnSection<FxBevel> = {
  key: 'bevel', plain: 'Raised edge', pro: 'Bevel and emboss', help: 'Lights and shades the layer’s edge so it looks raised or carved.',
  ctls: () => [
    SELECT('style', 'Where · Style', 'Inside the edge, outside it (lifting the layer from what is below), on both sides, or a pressed-in edge.', ['Inside', 'Outside', 'Both sides', 'Pressed edge']),
    SELECT('method', 'Edge · Technique', 'A rounded, soft edge or a sharp chiselled one.', ['Rounded', 'Chisel']),
    SELECT('up', 'Raised or pressed in · Direction', 'Raised catches the light on the lit side; pressed in swaps light and shade.', ['Raised', 'Pressed in']),
    R('depth', 'Depth', 'How steep the edge looks: higher makes the light and shade stronger.', 1, 1000, 100, '%'),
    R('size', 'Size', 'How wide the raised edge is.', 0, 100, 5, ' px'),
    R('soften', 'Soften', 'Blurs the light and shade so the edge looks smoother.', 0, 16, 0, ' px'),
    ANGLE,
    R('altitude', 'Light height · Altitude', 'How high the light stands: low gives strong light and shade, 90 lights it from straight above.', 0, 90, 30, '°'),
    R('lightOp', 'Highlight strength · Highlight opacity', 'How strong the lit side is.', 0, 100, 75, '%'),
    R('darkOp', 'Shade strength · Shadow opacity', 'How strong the shaded side is.', 0, 100, 75, '%')],
  read: (e) => ({ style: Math.max(0, STYLES.indexOf(e.style)), method: e.method === 'chisel' ? 1 : 0, up: e.up === false ? 1 : 0, depth: e.depth, size: e.size,
    soften: e.soften, angle: e.angle, altitude: e.altitude, lightOp: pct(e.light.opacity), darkOp: pct(e.dark.opacity) }),
  write: (e, p) => ({ ...e, style: STYLES[p.style ?? 0] ?? 'inner', method: p.method ? 'chisel' : 'smooth', up: !p.up, depth: p.depth ?? e.depth, size: p.size ?? e.size,
    soften: p.soften ?? e.soften, angle: p.angle ?? e.angle, altitude: p.altitude ?? e.altitude,
    light: { ...e.light, opacity: (p.lightOp ?? 75) / 100 }, dark: { ...e.dark, opacity: (p.darkOp ?? 75) / 100 } }),
  hues: [
    { key: 'light', label: 'Highlight colour', help: 'The colour of the lit side.', get: (e) => e.light.color, set: (e, c) => ({ ...e, light: { ...e.light, color: c } }) },
    { key: 'dark', label: 'Shade colour · Shadow colour', help: 'The colour of the shaded side.', get: (e) => e.dark.color, set: (e, c) => ({ ...e, dark: { ...e.dark, color: c } }) }],
};
/** The pattern choices: the built-in ones, then the picture of its own when it has one. */
const patternNames = (own: boolean): string[] => [...PATTERNS.map((p) => p.plain), ...(own ? ['Your own (from the picture)'] : [])];
const patternIndex = (p: { pattern: string; image?: PatternImage }): number => (p.image ? PATTERNS.length : Math.max(0, PATTERNS.findIndex((x) => x.id === p.pattern)));
const PATTERN_SCALE = R('scale', 'Scale', 'How big the pattern is: 100% is its own size.', 25, 400, 100, '%');
/** The pattern from the selected part of the picture, or a plain refusal (nothing selected, or bigger than 512 × 512). */
function patternFromSelection(host: { doc: MaskPropsHost['doc']; toast(m: string): void }): PatternImage | null {
  const d = host.doc(), s = d?.selection, r = d && s ? intersect(s, { x: 0, y: 0, w: d.width, h: d.height }) : null;
  if (!d || !r || r.w < 1 || r.h < 1) { host.toast('Select an area first: the picture inside it becomes the pattern.'); return null; }
  if (r.w > 512 || r.h > 512) { host.toast(`That area is ${r.w} × ${r.h} pixels: select 512 × 512 or less to use it as a pattern.`); return null; }
  return { width: r.w, height: r.h, data: compositeRect(d.layers, r) };
}
const fromSelButton = (run: () => void): HTMLElement => h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'fx-pattern-from-sel',
  'data-help-title': 'Use the selection as the pattern · Define pattern', 'data-help': 'The picture inside the selection (up to 512 × 512 pixels) becomes the pattern, repeated across.', onclick: run },
'Use the selection as the pattern');
const PATTERN: OwnSection<FxPattern> = {
  key: 'patternOverlay', plain: 'Pattern overlay', pro: 'Pattern overlay', help: 'Covers the layer with a repeating pattern.',
  ctls: (e) => [{ ...OP, value: 100 }, SELECT('pattern', 'Pattern', 'Which pattern covers the layer.', patternNames(!!e.image)), PATTERN_SCALE],
  read: (e) => ({ opacity: pct(e.opacity), pattern: patternIndex(e), scale: pct(e.scale) }),
  write: (e, p) => {
    const i = p.pattern ?? 0, n: FxPattern = { ...e, opacity: (p.opacity ?? 100) / 100, scale: (p.scale ?? 100) / 100 };
    if (i < PATTERNS.length) { n.pattern = PATTERNS[i].id; delete n.image; }
    return n;
  },
  extra: ({ host, now }) => [fromSelButton(() => {
    const image = patternFromSelection(host);
    if (image) now('Pattern from the selection', (e) => ({ ...e, pattern: 'own', image }));
  })],
};
const BLUR: OwnSection<FxBlur> = {
  key: 'blur', plain: 'Blur as an effect', pro: 'Gaussian blur effect', help: 'Blurs what the layer shows, with its effects; its own pixels are kept as they are.',
  ctls: () => [R('size', 'Size', 'How far the blur spreads, in pixels.', 1, 50, 4, ' px')],
  read: (e) => ({ size: e.size }),
  write: (e, p) => ({ ...e, size: p.size ?? e.size }),
};
const RANGE = (pre: string, group: string): Ctl[] => [
  R(pre + '0', 'Hidden darker than · Black start', 'Parts darker than this do not show.', 0, 255, 0, '', group),
  R(pre + '1', 'Fully shown from · Black full', 'Between the first point and this one the dark parts fade in.', 0, 255, 0, '', group),
  R(pre + '2', 'Fully shown up to · White full', 'Between this point and the last one the light parts fade out.', 0, 255, 255, '', group),
  R(pre + '3', 'Hidden lighter than · White end', 'Parts lighter than this do not show.', 0, 255, 255, '', group)];
const RANGE_KEYS = [['s0', 's1', 's2', 's3'], ['u0', 'u1', 'u2', 'u3']];
/** Keeps the four points of each range in order: the one that moved pushes its neighbours along. */
export function orderRanges(p: Params, prev: Params): void {
  for (const keys of RANGE_KEYS) {
    const i = keys.findIndex((k) => p[k] !== prev[k]);
    if (i < 0) continue;
    const v = p[keys[i]] ?? 0;
    keys.forEach((k, j) => { const x = p[k] ?? 0; if (j < i && x > v) p[k] = v; if (j > i && x < v) p[k] = v; });
  }
}
export const BLEND_IF: OwnSection<FxBlendIf> = {
  key: 'blendIf', plain: 'Show by brightness', pro: 'Blend If', help: 'Lets this layer show only where it, or the layer below, is dark or light, with soft fades between.',
  ctls: () => [...RANGE('s', 'This layer'), ...RANGE('u', 'The layer below · Underlying layer')],
  read: (e) => ({ s0: e.self[0], s1: e.self[1], s2: e.self[2], s3: e.self[3], u0: e.under[0], u1: e.under[1], u2: e.under[2], u3: e.under[3] }),
  write: (e, p) => ({ ...e, self: [p.s0 ?? 0, p.s1 ?? 0, p.s2 ?? 255, p.s3 ?? 255], under: [p.u0 ?? 0, p.u1 ?? 0, p.u2 ?? 255, p.u3 ?? 255] }),
  tidy: (p, prev, idBase) => {
    orderRanges(p, prev);
    // Show the pushed neighbours where they now are.
    for (const k of RANGE_KEYS.flat()) {
      const inp = document.getElementById(idBase + k) as HTMLInputElement | null, v = String(p[k] ?? 0);
      if (!inp || inp.value === v) continue;
      inp.value = v;
      const out = inp.closest('.fpe-field')?.querySelector('output');
      if (out) out.textContent = v;
    }
  },
};
const OWN = [BEVEL, PATTERN, BLUR, BLEND_IF] as unknown as OwnSection<{ on: boolean }>[];

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
    const t = host.layer(), from = t?.fx;
    if (!t || !from) return;
    // The push only records the step: the layer takes the change first (Show, Show the effects, Remove).
    t.fx = next(from);
    host.push(propsCommand(t.id, { fx: from }, { fx: t.fx }, label));
  };
  const uid = `fpe-${host.uid}-fx-`, allId = uid + 'all';
  const all = h('input', { id: allId, type: 'checkbox', checked: f.on, 'data-testid': 'fx-all' }) as HTMLInputElement;
  all.addEventListener('change', () => now(all.checked ? 'Show the effects' : 'Hide the effects', (x) => ({ ...x, on: all.checked })));
  const kids: HTMLElement[] = [
    h('div', { class: 'fpe-mask-head' }, 'Effects ', h('small', { class: 'fpe-pro' }, 'Layer style')),
    h('div', { class: 'fpe-check', 'data-help-title': 'Show the effects', 'data-help': 'Switch every effect of this layer off or on at once, to compare.' }, all, h('label', { for: allId }, 'Show the effects')),
  ];
  /** A section's title, its Show box, its body, and Remove. */
  const frame = (base: string, s: { plain: string; pro: string; help: string }, isOn: boolean, toggle: (on: boolean) => void, body: HTMLElement[], remove: () => void, testid: string): HTMLElement => {
    const onId = base + 'on', cb = h('input', { id: onId, type: 'checkbox', checked: isOn, 'data-testid': 'fx-on' }) as HTMLInputElement;
    cb.addEventListener('change', () => toggle(cb.checked));
    return h('div', { class: 'fpe-fx-section', 'data-testid': testid },
      h('h3', { class: 'fpe-group-title', 'data-help-title': `${s.plain} · ${s.pro}`, 'data-help': s.help }, s.plain + ' ', h('small', { class: 'fpe-pro' }, s.pro)),
      h('div', { class: 'fpe-check', 'data-help-title': 'Show', 'data-help': 'Hide this effect to compare; its settings are kept.' }, cb, h('label', { for: onId }, 'Show')),
      ...body,
      h('div', { class: 'fpe-mask-actions' }, h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'fx-remove', 'data-help-title': `Remove · Delete ${s.pro.toLowerCase()}`,
        'data-help': `Throw this ${s.plain.toLowerCase()} away. Undo brings it back.`, onclick: remove }, 'Remove')));
  };
  const picker = (id: string, label: string, help: string, c: RGBA, set: (c: RGBA) => void, done: () => void): HTMLElement => {
    const inp = h('input', { id, type: 'color', value: toHex(c), 'data-testid': 'fx-color' }) as HTMLInputElement;
    inp.addEventListener('input', () => { const v = parseHex(inp.value); if (v) set({ r: v.r, g: v.g, b: v.b, a: 255 }); });
    inp.addEventListener('change', done);
    return h('div', { class: 'fpe-row', 'data-help-title': label, 'data-help': help }, h('label', { for: id }, label), inp);
  };
  for (const s of SECTIONS) entries(f, s.key).forEach((e, i) => {
    const base = `${uid}${s.key}-${i}-`, params = numbers(e), lower = s.plain.toLowerCase();
    const body: HTMLElement[] = [];
    if (e.color) body.push(picker(base + 'color', 'Colour', `The colour of the ${lower}.`, e.color,
      (c) => live((_t, x) => put(x, s.key, i, { ...entries(x, s.key)[i], color: c })), () => commit(`${s.plain} colour`)));
    body.push(...renderControls(s.ctls, params, base, {
      input: () => live((_t, x) => put(x, s.key, i, withNumbers(entries(x, s.key)[i], s.key, params))),
      commit: () => commit(s.plain),
      rerender: () => { /* no ready-made choices here */ },
    }));
    kids.push(frame(base, s, e.on, (on) => now(on ? `Show the ${lower}` : `Hide the ${lower}`, (x) => put(x, s.key, i, { ...entries(x, s.key)[i], on })),
      body, () => now(`Remove the ${lower}`, (x) => put(x, s.key, i, null)), `fx-${s.key}-${i}`));
  });
  for (const s of OWN) {
    const e = (f as unknown as Record<string, { on: boolean } | undefined>)[s.key];
    if (!e) continue;
    const get = (x: LayerEffects): { on: boolean } => (x as unknown as Record<string, { on: boolean }>)[s.key];
    const set = (x: LayerEffects, v: { on: boolean } | null): LayerEffects => {
      const o = { ...x } as unknown as Record<string, unknown>;
      if (v) o[s.key] = v; else delete o[s.key];
      return o as unknown as LayerEffects;
    };
    const base = `${uid}${s.key}-0-`, params = s.read(e), lower = s.plain.toLowerCase();
    let prev = { ...params };
    const body: HTMLElement[] = (s.hues ?? []).map((c) => picker(base + c.key, c.label, c.help, c.get(e),
      (v) => live((_t, x) => set(x, c.set(get(x), v))), () => commit(`${s.plain}: ${c.label.split(' · ')[0].toLowerCase()}`)));
    body.push(...renderControls(s.ctls(e), params, base, {
      input: () => { s.tidy?.(params, prev, base); prev = { ...params }; live((_t, x) => set(x, s.write(get(x), params))); },
      commit: () => commit(s.plain),
      rerender: () => { /* no ready-made choices here */ },
    }));
    if (s.extra) body.push(...s.extra({ host, now: (label, next) => now(label, (x) => set(x, next(get(x)))) }));
    kids.push(frame(base, s, e.on, (on) => now(on ? `Show the ${lower}` : `Hide the ${lower}`, (x) => set(x, { ...get(x), on })),
      body, () => now(`Remove the ${lower}`, (x) => set(x, null)), `fx-${s.key}-0`));
  }
  el.replaceChildren(...kids);
}

// ---------- colour fade and pattern layers (design 2.6) ----------

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 }, WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
const rgba = (hex: string, or: RGBA): RGBA => { const c = parseHex(hex); return c ? { r: c.r, g: c.g, b: c.b, a: 255 } : { ...or }; };
/** Layer › New colour layer › Colour fade or Pattern: a new layer over the whole canvas, one undo step, then its settings in Properties. */
export function addFillOf(host: ToolHost, kind: 'gradient' | 'pattern'): void {
  const d = host.doc();
  if (!d) return;
  const plain = kind === 'gradient' ? 'Colour fade' : 'Pattern';
  host.push(addNode(d, createFillOf(kind, nextLayerName(d, plain), d.width, d.height, rgba(host.fg(), BLACK), rgba(host.bg(), WHITE)), plain + ' layer'), true);
  host.showPanel('properties');
}
type Fade = Extract<FillLayer, { type: 'gradient' }>;
type Tile = Extract<FillLayer, { type: 'pattern' }>;
/** The settings of a colour fade or pattern layer: live while a control moves, one undo step when it is let go. */
export function renderFillLayerProps(el: HTMLElement, host: MaskPropsHost): void {
  const l = host.layer(), f = l?.fill;
  if (!l || !f || f.type === 'solid') return;
  let start: FillLayer | null = null;
  const live = (next: (x: FillLayer) => FillLayer): void => {
    const t = host.layer();
    if (!t?.fill) return;
    start ??= t.fill;
    t.fill = next(t.fill);
    host.live();
  };
  const commit = (label: string): void => {
    const t = host.layer(), from = start;
    start = null;
    if (t?.fill && from && from !== t.fill) host.push(propsCommand(t.id, { fill: from }, { fill: t.fill }, label));
  };
  const base = `fpe-${host.uid}-fill-`, noop = (): void => { /* no ready-made choices here */ };
  const colour = (key: string, label: string, help: string, c: RGBA, set: (x: Fade, c: RGBA) => Fade): HTMLElement => {
    const inp = h('input', { id: base + key, type: 'color', value: toHex(c), 'data-testid': 'fill-' + key }) as HTMLInputElement;
    inp.addEventListener('input', () => { const v = parseHex(inp.value); if (v) live((x) => (x.type === 'gradient' ? set(x, { r: v.r, g: v.g, b: v.b, a: 255 }) : x)); });
    inp.addEventListener('change', () => commit('Change the colour'));
    return h('div', { class: 'fpe-row', 'data-help-title': label, 'data-help': help }, h('label', { for: base + key }, label), inp);
  };
  if (f.type === 'gradient') {
    const ends = (x: Fade, a: RGBA | null, b: RGBA | null): Fade => {
      const stops = x.stops.map((s, i) => (i === 0 && a ? { ...s, color: a } : i === x.stops.length - 1 && b ? { ...s, color: b } : s));
      return { ...x, stops, color: { ...stops[0].color } };
    };
    const ctls: Ctl[] = [{ ...ANGLE, label: 'Direction · Angle', help: 'Which way the fade runs, in degrees.', value: 90 },
      R('scale', 'Length · Scale', 'How long the fade is across the picture.', 10, 150, 100, '%'),
      SELECT('shape', 'Shape · Style', 'A straight fade or a round one from the middle.', ['Straight', 'Round']),
      { key: 'reverse', label: 'Reverse', help: 'Swaps the two ends of the fade.', value: 0, type: 'check' }];
    const params: Params = { angle: f.angle, scale: pct(f.scale), shape: f.shape === 'radial' ? 1 : 0, reverse: f.reverse ? 1 : 0 };
    el.replaceChildren(h('div', { class: 'fpe-mask-head' }, 'Colour fade layer ', h('small', { class: 'fpe-pro' }, 'Gradient fill')),
      h('p', { class: 'fpe-note' }, 'A colour fade over the whole picture. Change it at any time; lower the opacity or pick a blend to mix it with what is below.'),
      colour('from', 'Start colour', 'The colour the fade starts with.', f.stops[0].color, (x, c) => ends(x, c, null)),
      colour('to', 'End colour', 'The colour the fade ends with.', f.stops[f.stops.length - 1].color, (x, c) => ends(x, null, c)),
      ...renderControls(ctls, params, base, {
        input: () => live((x) => (x.type === 'gradient' ? { ...x, angle: params.angle ?? 90, scale: (params.scale ?? 100) / 100, shape: params.shape ? 'radial' : 'linear', reverse: !!params.reverse } : x)),
        commit: () => commit('Colour fade'), rerender: noop,
      }));
    return;
  }
  const params: Params = { pattern: patternIndex(f), scale: pct(f.scale) };
  const tile = (x: Tile): Tile => {
    const i = params.pattern ?? 0, n: Tile = { ...x, scale: (params.scale ?? 100) / 100 };
    if (i < PATTERNS.length) { n.pattern = PATTERNS[i].id; n.color = { ...PATTERNS[i].swatch }; delete n.image; }
    return n;
  };
  el.replaceChildren(h('div', { class: 'fpe-mask-head' }, 'Pattern layer ', h('small', { class: 'fpe-pro' }, 'Pattern fill')),
    h('p', { class: 'fpe-note' }, 'A repeating pattern over the whole picture. Change it at any time; lower the opacity or pick a blend to mix it with what is below.'),
    ...renderControls([SELECT('pattern', 'Pattern', 'Which pattern fills the layer.', patternNames(!!f.image)), PATTERN_SCALE], params, base, {
      input: () => live((x) => (x.type === 'pattern' ? tile(x) : x)), commit: () => commit('Pattern layer'), rerender: noop,
    }),
    h('div', { class: 'fpe-mask-actions' }, fromSelButton(() => {
      const t = host.layer(), from = t?.fill, image = patternFromSelection(host);
      if (!t || from?.type !== 'pattern' || !image) return;
      // The push only records the step: the layer takes the change first.
      t.fill = { ...from, pattern: 'own', image, color: { ...from.color } };
      host.push(propsCommand(t.id, { fill: from }, { fill: t.fill }, 'Pattern from the selection'));
    })));
}

// ---------- Saved looks (panel.styles) ----------

/** A named set of layer effects. */
export interface Look { name: string; fx: LayerEffects; }
const KEY = 'fpe-looks';
/** The ready-made looks every editor starts with. */
export function starterLooks(): Look[] {
  const shiny = addLayerFx(addLayerFx(undefined, 'raised-edge'), 'satin-sheen');
  const soft = addLayerFx(undefined, 'drop-shadow');
  soft.dropShadow = [{ ...soft.dropShadow[0], opacity: 0.45, distance: 6, size: 14 }];
  const sticker = addLayerFx(addLayerFx(undefined, 'stroke', WHITE), 'drop-shadow');
  sticker.stroke = [{ ...sticker.stroke[0], size: 6 }];
  const carved = addLayerFx(addLayerFx(undefined, 'raised-edge'), 'inner-shadow');
  carved.bevel = { ...(carved.bevel as FxBevel), up: false, size: 3 };
  return [{ name: 'Raised and shiny', fx: shiny }, { name: 'Soft shadow', fx: soft }, { name: 'Sticker', fx: sticker },
    { name: 'Soft glow', fx: addLayerFx(undefined, 'outer-glow') }, { name: 'Carved in', fx: carved }];
}
/** The layer takes the look first (History.push only records), then the one undo step that puts its old effects back. */
export function applyLook(l: Layer, fx: LayerEffects): Command {
  const from = l.fx;
  l.fx = structuredClone(fx);
  return propsCommand(l.id, { fx: from }, { fx: l.fx }, 'Use a saved look');
}
/** A look as it can be kept in this browser: no file-only details, and no picture of its own (too big to keep). */
export function lookToKeep(fx: LayerEffects): { fx: LayerEffects; lostPicture: boolean } {
  const lostPicture = !!fx.patternOverlay?.image;
  const out = JSON.parse(JSON.stringify(fx, (k, v: unknown) => (k === 'psd' || k === 'image' ? undefined : v))) as LayerEffects;
  if (out.patternOverlay && !PATTERNS.some((p) => p.id === out.patternOverlay?.pattern)) out.patternOverlay = { ...out.patternOverlay, pattern: PATTERNS[0].id };
  return { fx: out, lostPicture };
}
const LISTS = ['dropShadow', 'innerShadow', 'colorOverlay', 'gradientOverlay', 'stroke'] as const;
/** The person's own looks, kept in this browser. Anything unreadable is left out. */
export function readLooks(store: Pick<Storage, 'getItem'> | null): Look[] {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is Look => !!x && typeof x.name === 'string' && !!x.fx && typeof x.fx === 'object' && typeof x.fx.on === 'boolean'
      && LISTS.every((k) => Array.isArray(x.fx[k])));
  } catch { return []; }
}
const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };
function writeLooks(looks: Look[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(looks)); return true; } catch { return false; }
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Effects & masks › Saved looks: put a look on the active layer, keep the active layer's effects as a look, delete your own. */
export function openLooks(host: ToolHost): void {
  const body = h('div', { class: 'fpe-stack', 'data-testid': 'looks-body' });
  const active = (): Layer | undefined => { const d = host.doc(); return d?.layers.find((x) => x.id === d.activeId); };
  const use = (look: Look): void => {
    const t = active();
    if (!t || t.locked || (t.kind && t.kind !== 'pixel')) { host.toast('Pick a picture, text or shape layer first: a look goes on its effects.'); return; }
    host.push(applyLook(t, look.fx), true);
    host.closeSheet();
    host.showPanel('properties');
    host.toast(`“${look.name}” is on ${t.name}. Change any part of it in Properties.`);
  };
  const row = (look: Look, own: boolean, i: number): HTMLElement => h('li', { class: 'fpe-row', 'data-testid': 'look' },
    h('span', {}, look.name),
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'look-use-' + slug(look.name), 'data-help-title': 'Use this look',
      'data-help': 'Puts these effects on the active layer instead of its own. Undo brings its own back.', onclick: () => use(look) }, 'Use'),
    own ? h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'look-delete-' + slug(look.name), 'data-help-title': 'Delete this look',
      'data-help': 'Removes your saved look from this browser. Layers that use it keep their effects.',
      onclick: () => { const all = readLooks(storage()); all.splice(i, 1); if (!writeLooks(all)) host.toast('This browser would not let the editor change its saved looks.'); draw(); } }, 'Delete') : null);
  const name = h('input', { type: 'text', maxlength: 40, placeholder: 'A name for this look', 'aria-label': 'A name for the look', 'data-testid': 'look-name' }) as HTMLInputElement;
  const save = (): void => {
    const t = active();
    if (!t?.fx || !hasLayerFx(t)) { host.toast('The active layer has no effects to save yet: add a shadow, an outline or a raised edge first.'); return; }
    const label = name.value.trim() || `${t.name} look`, kept = lookToKeep(t.fx), all = readLooks(storage());
    all.push({ name: label, fx: kept.fx });
    if (!writeLooks(all)) { host.toast('This browser would not keep the look (a private window, or its storage is full).'); return; }
    name.value = '';
    host.toast(kept.lostPicture ? `Saved “${label}”. Its pattern from your picture is not kept in a look; it uses Checks instead.` : `Saved “${label}”.`);
    draw();
  };
  const draw = (): void => {
    const own = readLooks(storage());
    body.replaceChildren(
      h('p', { class: 'fpe-note' }, 'A look is a set of layer effects with a name. Use one to put it on the active layer, or save the active layer’s effects to use them again on other layers.'),
      h('h3', { class: 'fpe-group-title' }, 'Ready-made looks'),
      h('ul', { class: 'fpe-stack', 'data-testid': 'looks-starter' }, ...starterLooks().map((x, i) => row(x, false, i))),
      h('h3', { class: 'fpe-group-title' }, 'Your looks'),
      own.length ? h('ul', { class: 'fpe-stack', 'data-testid': 'looks-own' }, ...own.map((x, i) => row(x, true, i)))
        : h('p', { class: 'fpe-note' }, 'None yet. They are kept in this browser only.'),
      h('div', { class: 'fpe-field', 'data-help-title': 'Save this layer’s look', 'data-help': 'Keeps the active layer’s effects under this name, in this browser.' },
        name, h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'look-save', onclick: save }, 'Save this layer’s look')));
  };
  draw();
  host.sheet('looks', 'Saved looks · Styles', body);
}
