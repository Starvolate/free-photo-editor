// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The light and colour batch's dialogs (13 Nov 2026), in plain words: hue and chroma, spin one colour range, readable
 * text, local black and white, lift the dark areas, the local tone map, colour harmony, the main colours and the print
 * estimate; plus saving the light and colour layers as a .cube lookup file. commands.ts loads this file the first time
 * one of them runs (LIGHT_IDS), so the first screen never downloads it; loading it adds the dialogs to ADJ.
 */
import { createLayer, docCommand, hasPixels, runJob, snapshotDoc, type Doc, type JobSpec, type Pixels } from '@free-photoeditor/core';
import { contrastRatio, LEVELS, textColour, wcagLum } from '@free-photoeditor/core/fx';
import type { Editor } from './app';
import { ADJ, type AdjDef, type Ctl } from './commands';
import type { ToolHost } from './toolkit';

/**
 * Hand a file to the browser's download. Kept here rather than imported from io.ts: the CLI bundles commands.ts, which
 * loads this file, with dynamic imports inlined, and io.ts pulls in the formats package (and fflate, which the CLI does
 * not ship). This file must stay free of io.ts and of formats.
 */
function download(blob: Blob, filename: string, host: HTMLElement): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  host.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const R = (key: string, label: string, help: string, min: number, max: number, value: number, unit = '', group?: string): Ctl =>
  ({ key, label, help, min, max, value, step: 1, unit, group });
const PCT = (key: string, label: string, help: string, min: number, max: number, value: number, group?: string): Ctl => R(key, label, help, min, max, value, '%', group);
const PX = (key: string, label: string, help: string, min: number, max: number, value: number): Ctl => R(key, label, help, min, max, value, ' px');
const SEL = (key: string, label: string, help: string, options: readonly string[], value = 0): Ctl => ({ key, label, help, value, type: 'select', options });
const FX = (kind: string, controls: Ctl[], more: Partial<AdjDef> = {}): AdjDef => ({ op: 'fx', kind, controls, ...more });
const RANGES = ['Reds', 'Oranges', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Purples', 'Pinks'];
const TEXT = ['Your main colour', 'Your second colour', 'Black', 'White'];
const LEVEL = ['AA, normal text (4.5 to 1)', 'AA, large text (3 to 1)', 'AAA, normal text (7 to 1)'];
const MAIN = ['Most used colour', 'Second colour', 'Third colour', 'Fourth colour'];
const clampI = (v: number | undefined, hi: number): number => Math.min(hi, Math.max(0, Math.round(v ?? 0)));

/** The readable-text dialog's live line: the lowest WCAG contrast in the area against the text colour, and how much fails. */
export function contrastInfo(p: Readonly<Record<string, number | undefined>>, area: Uint8ClampedArray): string {
  const t = textColour(p as Record<string, number>), Lt = wcagLum((t >> 16) & 255, (t >> 8) & 255, t & 255), lv = clampI(p.level, 2), need = LEVELS[lv];
  let worst = 21, fail = 0, n = 0;
  for (let i = 0; i < area.length; i += 4) {
    if (!area[i + 3]) continue;
    const r = contrastRatio(Lt, wcagLum(area[i], area[i + 1], area[i + 2]));
    n++;
    if (r < worst) worst = r;
    if (r < need) fail++;
  }
  if (!n) return 'This area has no pixels to check.';
  const who = `Text in ${TEXT[clampI(p.text, 3)].toLowerCase()} on this area`, low = (Math.floor(worst * 10) / 10).toFixed(1), name = LEVEL[lv].replace(/ \(.*/, '');
  return fail
    ? `${who}: the lowest contrast is ${low} to 1, and ${Math.max(1, Math.round((100 * fail) / n))}% of the area fails ${name} (${need} to 1 needed). Apply lightens or darkens only those parts.`
    : `${who} passes ${name} everywhere: the lowest contrast is ${low} to 1 (${need} to 1 needed).`;
}

export const LIGHT: Record<string, AdjDef> = {
  'image.hue-chroma': FX('hue-chroma', [R('hue', 'Colour turn', 'Turns every colour round the colour wheel, keeping how light it looks.', -180, 180, 0, '°'),
    PCT('chroma', 'Colour strength', 'Stronger or weaker colours; greys stay grey.', -100, 100, 25),
    R('light', 'Lightness', 'Lighter or darker as the eye sees it, without changing the colours.', -100, 100, 0)]),
  'image.rotate-colours': FX('rotate-colours', [SEL('from', 'Colours to change', 'Which range of colours turns; the rest stay exactly as they are.', RANGES, 1),
    SEL('to', 'Turn them into', 'The colour range they become.', RANGES, 5),
    R('width', 'Range width', 'How wide the range of colours is, round the colour wheel.', 10, 180, 70, '°'),
    PCT('soft', 'Soft edge', 'How gently colours at the edge of the range blend in.', 0, 100, 40)]),
  'image.colour-contrast': FX('text-contrast', [SEL('text', 'Text colour', 'The colour of the text you will put on this area.', TEXT),
    SEL('level', 'Must pass', 'The WCAG level: AA is the usual rule; large text means about 24 px, or 19 px bold.', LEVEL)],
  { colors: true, info: contrastInfo }),
  'image.local-threshold': FX('local-threshold', [PX('radius', 'Neighbourhood', 'How far around each pixel the average is taken; bigger than the letters works best.', 2, 200, 15),
    R('offset', 'Ink darker by', 'How much darker than its surroundings a pixel must be to turn black; raise it to clean up specks.', -50, 50, 10)]),
  'image.retinex': FX('retinex', [PX('radius', 'Light size', 'How big the patches of uneven light are.', 4, 600, 60),
    PCT('amount', 'Strength', 'How far dark places are brought up toward the average.', 0, 100, 60),
    { key: 'lift', label: 'Only brighten', help: 'Leave bright places as they are and only lift the dark ones.', value: 1, type: 'check' }]),
  'image.tone-mapping': FX('tone-map', [PCT('squeeze', 'Squeeze', 'How much the big differences between light and dark places are pulled together.', 0, 100, 50),
    PCT('detail', 'Detail', 'Keeps (100%) or boosts the small light and dark detail.', 0, 300, 120),
    PX('radius', 'Area size', 'How big an area counts as one place of light; small sizes show more halo.', 2, 600, 40),
    R('bright', 'Brightness', 'Lighter or darker overall afterwards.', -100, 100, 0)]),
  'image.harmonize': FX('harmonize', [SEL('scheme', 'Colour scheme', 'Built on the picture\'s main colour: one colour, opposites, neighbours, three-way or split opposites.',
    ['One colour', 'Opposites', 'Neighbours', 'Three-way', 'Split opposites'], 1),
    PCT('amount', 'Strength', 'How far each colour is pulled to the nearest colour of the scheme.', 0, 100, 50),
    R('turn', 'Turn the scheme', 'Moves the whole scheme round the colour wheel from the main colour.', -180, 180, 0, '°')]),
  'image.palette-edit': FX('palette-edit', MAIN.flatMap((g, k) => [
    R('h' + (k + 1), 'Colour turn', 'Turns this colour, and the shades near it, round the colour wheel.', -180, 180, k ? 0 : 60, '°', g),
    PCT('c' + (k + 1), 'Colour strength', 'Stronger or weaker.', -100, 100, 0, g), R('l' + (k + 1), 'Lightness', 'Lighter or darker.', -100, 100, 0, '', g)])),
  'image.gamut-warning': FX('gamut-warning', [SEL('mode', 'Show or fix', 'Grey them out to see where they are (then Cancel), or pull them into range.',
    ['Grey them out', 'Pull them into range'], 0), PCT('margin', 'Press reach', 'Right trusts the press with stronger colours; left is stricter.', -50, 50, 0),
    PCT('grey', 'Grey shade', 'How light the grey that marks them is.', 0, 100, 50)]),
};
Object.assign(ADJ, LIGHT);

/**
 * The visible light and colour layers, bottom to top, as one .cube 3D lookup table (Adobe's open text format: a size line,
 * then one "r g b" line per grid point, red changing fastest). Masks and blend modes are left out: a lookup table holds one
 * colour change for the whole picture. Each layer's own engine runs on the grid, so the file matches the editor's result.
 */
export function cubeText(doc: Doc, n = 33): string {
  const q = (i: number): number => Math.round((i * 255) / (n - 1)), grid = new Uint8ClampedArray(n * n * n * 4);
  for (let b = 0, k = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, k += 4) { grid[k] = q(r); grid[k + 1] = q(g); grid[k + 2] = q(b); grid[k + 3] = 255; }
  let cur: Uint8ClampedArray = grid.slice();
  for (const l of doc.layers) {
    const job = l.kind === 'adjust' && l.visible ? (l.adjust?.job as JobSpec | undefined) : undefined;
    if (!job) continue;
    const out = runJob(job, { width: n * n, height: n, data: cur }), a = Math.min(1, Math.max(0, l.opacity));
    if (a < 1) for (let i = 0; i < out.length; i++) out[i] = cur[i] + (out[i] - cur[i]) * a;
    cur = out;
  }
  // Each point keeps its exact grid value plus the change in bytes, so an empty stack writes the exact identity table.
  const v = (i: number, c: number): string => Math.min(1, Math.max(0, i / (n - 1) + (cur[c] - grid[c]) / 255)).toFixed(6);
  const lines = ['TITLE "Free Photo Editor adjustments"', `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let b = 0, k = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++, k += 4) lines.push(`${v(r, k)} ${v(g, k + 1)} ${v(b, k + 2)}`);
  return lines.join('\n') + '\n';
}
/** Saves the .cube file of the picture's light and colour layers. */
export function exportLut(e: Editor): void {
  const d = e.doc;
  if (d) download(new Blob([cubeText(d)], { type: 'text/plain' }), 'adjustments.cube', e.root);
}

/**
 * One layer per colour channel: red, green and blue, each keeping only its own channel and the layer's see-through
 * parts. Red is drawn normally and green and blue screen over it; screen with 0 leaves a channel as it was, so the three
 * together rebuild the opaque picture exactly (200,100,50 = 200,0,0 then 0,100,0 then 0,0,50).
 */
export function channelLayers(src: Pixels): Uint8ClampedArray[] {
  return [0, 1, 2].map((c) => {
    const out = new Uint8ClampedArray(src.data.length);
    for (let i = 0; i < out.length; i += 4) { out[i + c] = src.data[i + c]; out[i + 3] = src.data[i + 3]; }
    return out;
  });
}
const CHANNELS = ['Red', 'Green', 'Blue'] as const;
/** Split into and rebuild from colour channels (image.decompose): three layers above the active one, which is hidden; one undo. */
export function decompose(host: ToolHost): void {
  const d = host.doc(), l = d?.layers.find((x) => x.id === d.activeId);
  if (!d || !l || !hasPixels(l)) { host.toast('Pick a picture layer first.'); return; }
  if (!l.visible) { host.toast('This layer is hidden. Show it to split it.'); return; }
  const before = snapshotDoc(d), at = d.layers.indexOf(l);
  const made = channelLayers(l).map((data, i) => {
    const nl = createLayer(`${CHANNELS[i]} channel`, l.width, l.height, { x: l.x, y: l.y, data });
    nl.blendMode = i ? 'screen' : 'normal';
    if (l.parentId) nl.parentId = l.parentId;
    if (l.mask) nl.mask = structuredClone(l.mask);
    return nl;
  });
  d.layers.splice(at + 1, 0, ...made);
  l.visible = false;
  d.activeId = made[2].id;
  host.push(docCommand('Split into colour channels', before, snapshotDoc(d)), true);
}
