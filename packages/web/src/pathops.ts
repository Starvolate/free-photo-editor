// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shapes & text, path operations (13 Nov 2026): combine two shapes, join or split pieces, grow or shrink, mirror, copies
 * round a centre, a hand-drawn wobble, star and spiral outlines; then (part 2) slice a shape with another, hatch lines,
 * stitch lines, in-between shapes, repeat or bend a shape along a line, thick-and-thin strokes, and drawing an outline as
 * a dashed or arrowed line on a layer; then (part 6) QR codes from our own encoder (core qr.ts). The pen kit (pen.ts) loads this file the first time one of them runs, so neither
 * the first screen nor the tool kit carries it.
 *
 * Each command works at once with the numbers it used last (one undo step), then shows a small sheet: a choice button
 * redoes it that way at once, and "Update" redoes it with changed numbers. Each redo starts again from the outlines as
 * they were before the command, so trying numbers never stacks one result on another; each is its own undo step.
 */
import { addLayer, clonePaths, combineCommands, createLayer, findLayer, geomOf, indexOfLayer, newPathId, setGeom, type Command, type Doc, type LayerGeom, type Subpath, type VectorPath } from '@free-photoeditor/core';
import { qrEncode, qrPixels, qrSubpaths, type QrLevel } from '@free-photoeditor/core/qr';
import {
  arrowHead, booleanSubpaths, dashLine, divideSubpaths, hatchSubpaths, interpolateSubpaths, mirrorSubpaths, offsetSubpaths, patternAlong, powerStroke,
  ringPoints, rotateCopies, roughenSubpaths, sliceWalk, spiralSubpath, splitPieces, starSubpath, stitchSubpaths, subpathsBounds, walk,
  type BoolOp, type MirrorAxis,
} from '@free-photoeditor/core/pathops';
import type { ToolHost } from './toolkit';
import { h } from './dom';

/** What the pen kit lends this file: the editor, the picked outline, picking one, and one undoable change of the outlines. */
export interface PathOpsKit {
  host: ToolHost;
  picked(d: Doc): VectorPath | null;
  pick(d: Doc, id: string): void;
  edit(label: string, run: (d: Doc) => void): void;
}

type Dash = 'solid' | 'dash' | 'dot' | 'dashdot';
/** The numbers each command used last (they stay for the next run in this tab). */
export const S = {
  op: 'unite' as BoolOp, combine: 'auto' as 'auto' | 'join' | 'split', offset: 10, axis: 'right' as MirrorAxis, join: true,
  copies: 6, around: 'self' as 'self' | 'picture', amount: 4, size: 8, seed: 1, kind: 'star' as 'star' | 'spiral', points: 5, inner: 45, turns: 3,
  gap: 10, angle: 45, cross: false, keep: true, stitches: 12, steps: 3, along: 0, w0: 2, w1: 16, w2: 2,
  width: 6, dash: 'dash' as Dash, cap: 'round' as CanvasLineCap, corner: 'round' as CanvasLineJoin, ends: 'none' as 'none' | 'end' | 'both',
  qrText: 'https://example.com', qrLevel: 'M' as QrLevel, qrModule: 0,
};

const TITLES: Record<string, [string, string]> = {
  'path.boolean': ['Combine two shapes', 'Boolean operations'],
  'path.combine': ['Join or split outlines', 'Combine / Break apart'],
  'path.offset': ['Grow or shrink a shape', 'Offset path'],
  'path.mirror': ['Mirror an outline', 'Mirror symmetry'],
  'path.rotate-copies': ['Copies around a circle', 'Rotate copies'],
  'path.roughen': ['Hand-drawn wobble', 'Roughen'],
  'shape.spiral-star': ['Star or spiral outline', 'Star and spiral'],
  'path.divide': ['Slice a shape with another', 'Division'],
  'path.hatches': ['Hatch lines', 'Hatches'],
  'path.stitch': ['Stitch lines between two lines', 'Stitch sub-paths'],
  'path.interpolate': ['In-between shapes', 'Interpolate'],
  'path.pattern-along': ['Repeat a shape along a line', 'Pattern along path'],
  'path.bend': ['Bend a shape along a line', 'Bend'],
  'path.power-stroke': ['Thick and thin line', 'Power stroke'],
  'path.stroke-style': ['Draw the outline as a line', 'Stroke style: dashes, ends, corners, arrowheads'],
  'shape.qr': ['QR code', 'QR code shape'],
};
const LABELS: Record<BoolOp, string> = { unite: 'Merge', subtract: 'Cut out', intersect: 'Keep the overlap', exclude: 'Keep what does not overlap' };
/** Commands that work on two shapes: the picked outline and the one above it, or the first piece of one outline and the rest. */
const TWO = new Set(['path.boolean', 'path.divide', 'path.stitch', 'path.interpolate', 'path.pattern-along', 'path.bend']);

/** The two shapes a combine works on: the picked outline and the one above it in Outlines, or the pieces of one outline. */
interface Pair { a: VectorPath | null; b: VectorPath; aSubs: Subpath[]; bSubs: Subpath[]; }
function pairOf(d: Doc, p: VectorPath): Pair | null {
  const list = d.paths ?? [], i = list.indexOf(p);
  if (list.length >= 2) { const a = list[i - 1] ?? list[i + 1]; return { a, b: p, aSubs: a.subpaths, bSubs: p.subpaths }; }
  if (p.subpaths.length >= 2) return { a: null, b: p, aSubs: [p.subpaths[0]], bSubs: p.subpaths.slice(1) };
  return null;
}
/** Put new outlines where the pair was (at the upper one's place, or in place of the one outline), and pick the first. */
function replacePair(d: Doc, k: PathOpsKit, pr: Pair, made: VectorPath[]): void {
  const list = d.paths ?? [], gone = pr.a ? [pr.a, pr.b] : [pr.b], at = Math.min(...gone.map((x) => list.indexOf(x)));
  if (gone.some((x) => x.work)) made[0].work = true;
  // The first new outline takes the picked one's id, so every try (and every undo back to an earlier try) keeps it picked.
  made[0].id = pr.b.id;
  d.paths = list.filter((x) => !gone.includes(x));
  d.paths.splice(Math.max(0, at), 0, ...made);
  k.pick(d, made[0].id);
}
const one = (pr: Pair, subs: Subpath[]): VectorPath[] => [{ id: newPathId(), name: (pr.a ?? pr.b).name, subpaths: subs }];
const nameFor = (d: Doc, base: string): string => { let n = 1; while ((d.paths ?? []).some((p) => p.name === `${base} ${n}`)) n++; return `${base} ${n}`; };
const copy = (subs: readonly Subpath[]): Subpath[] => subs.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) }));

/** Why a command cannot run on this picture now, in plain words, or null when it can. */
export function blocked(id: string, d: Doc, p: VectorPath | null): string | null {
  if (id === 'shape.spiral-star' || id === 'shape.qr') return null;
  if (!p || !p.subpaths.some((s) => s.anchors.length > 1)) return 'Draw an outline first: pick Draw curves (Pen), or make one from a selection in Outlines.';
  if (TWO.has(id) && !pairOf(d, p)) return 'This needs two shapes: draw a second outline, or a second piece in this one.';
  if (id === 'path.combine' && (d.paths ?? []).length < 2 && splitPieces(p.subpaths).length < 2) return 'This is one outline in one piece: draw a second outline to join it to.';
  return null;
}

/** Do the command once on the picture's outlines with the numbers in S. Returns a plain note for the person, if any. */
function apply(id: string, d: Doc, pid: string | null, k: PathOpsKit): string | null {
  const list = d.paths ?? [], p = list.find((x) => x.id === pid) ?? k.picked(d);
  if (id === 'shape.spiral-star') {
    const r = Math.max(8, Math.round(Math.min(d.width, d.height) * 0.3)), cx = d.width / 2, cy = d.height / 2;
    const sub = S.kind === 'star' ? starSubpath(cx, cy, S.points, r, (r * S.inner) / 100) : spiralSubpath(cx, cy, S.turns, (r * S.inner) / 400, r);
    const np: VectorPath = { id: newPathId(), name: nameFor(d, S.kind === 'star' ? 'Star' : 'Spiral'), subpaths: [sub] };
    (d.paths ??= []).push(np);
    k.pick(d, np.id);
    return null;
  }
  if (!p) return null;
  const pr = TWO.has(id) ? pairOf(d, p) : null;
  if (TWO.has(id) && !pr) return null;
  switch (id) {
    case 'path.boolean': {
      const out = booleanSubpaths(pr!.aSubs, pr!.bSubs, S.op);
      if (pr!.a) replacePair(d, k, pr!, one(pr!, out)); else p.subpaths = out;
      return out.length ? null : 'Nothing is left: the two shapes do not overlap. Undo, or pick another way to combine them.';
    }
    case 'path.combine': {
      const pc = pairOf(d, p), pieces = splitPieces(p.subpaths);
      const how = S.combine !== 'auto' ? S.combine : list.length >= 2 ? 'join' : 'split';
      if (how === 'join' && pc?.a) { replacePair(d, k, pc, one(pc, copy([...pc.a.subpaths, ...pc.b.subpaths]))); return null; }
      if (how === 'split' && pieces.length > 1) {
        const at = list.indexOf(p), made = pieces.map((g, i): VectorPath => ({ id: i ? newPathId() : p.id, name: i ? `${p.name} piece ${i + 1}` : p.name, subpaths: g }));
        if (p.work) made[0].work = true;
        list.splice(at, 1, ...made);
        k.pick(d, p.id);
        return null;
      }
      return how === 'join' ? 'There is no second outline to join this one to.' : 'This outline is one piece already.';
    }
    case 'path.offset': p.subpaths = offsetSubpaths(p.subpaths, S.offset); return p.subpaths.length ? null : 'The shape shrank to nothing. Undo, or use a smaller number.';
    case 'path.mirror': p.subpaths = mirrorSubpaths(p.subpaths, S.axis, S.join); return null;
    case 'path.rotate-copies': {
      const b = subpathsBounds(p.subpaths);
      if (!b) return null;
      const c = S.around === 'self' ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: d.width / 2, y: d.height / 2 };
      p.subpaths = rotateCopies(p.subpaths, S.copies, c, S.join);
      return null;
    }
    case 'path.roughen': p.subpaths = roughenSubpaths(p.subpaths, S.amount, S.size, S.seed); return null;
    case 'path.divide': {
      const groups = divideSubpaths(pr!.aSubs, pr!.bSubs), base = (pr!.a ?? p).name;
      if (!groups.length) return 'Nothing is left to slice.';
      replacePair(d, k, pr!, groups.map((g, i): VectorPath => ({ id: newPathId(), name: `${base} piece ${i + 1}`, subpaths: g })));
      return groups.length < 2 ? 'The edge did not cut it: it stays one piece.' : null;
    }
    case 'path.hatches': {
      const lines = hatchSubpaths(p.subpaths.filter((s) => s.closed), S.gap, S.angle, S.cross);
      if (!lines.length) return 'Hatch lines need a closed outline with room inside it.';
      p.subpaths = [...(S.keep ? copy(p.subpaths) : []), ...lines];
      return null;
    }
    case 'path.stitch': case 'path.interpolate': {
      const a = pr!.aSubs.find((s) => s.anchors.length > 1), b = pr!.bSubs.find((s) => s.anchors.length > 1);
      if (!a || !b) return null;
      const extra = id === 'path.stitch' ? stitchSubpaths(a, b, S.stitches) : interpolateSubpaths(a, b, S.steps);
      if (pr!.a) replacePair(d, k, pr!, one(pr!, [...copy(pr!.aSubs), ...extra, ...copy(pr!.bSubs)])); else p.subpaths = [...copy(p.subpaths), ...extra];
      return null;
    }
    case 'path.pattern-along': case 'path.bend': {
      const line = pr!.bSubs.find((s) => s.anchors.length > 1);
      if (!line) return null;
      const out = patternAlong(pr!.aSubs, line, S.along, id === 'path.bend');
      if (!out.length) return 'The shape to repeat has no width.';
      replacePair(d, k, pr!, [{ id: newPathId(), name: nameFor(d, id === 'path.bend' ? 'Bent shape' : 'Pattern'), subpaths: out }]);
      return null;
    }
    case 'path.power-stroke': p.subpaths = p.subpaths.filter((s) => s.anchors.length > 1).flatMap((s) => powerStroke(s, S.w0, S.w1, S.w2)); return null;
  }
  return null;
}

/** Run a path operation: at once with the last numbers, then the sheet to try others. */
export function runPathOp(id: string, k: PathOpsKit): void {
  if (id === 'path.stroke-style') { runLineStyle(k); return; }
  if (id === 'shape.qr') { runQr(k); return; }
  const host = k.host, d = host.doc();
  if (!d) return;
  const first = k.picked(d), why = blocked(id, d, first);
  if (why) { host.toast(why); return; }
  const base = clonePaths(d.paths), pid = first?.id ?? null, [plain, pro] = TITLES[id];
  const go = (): void => {
    const dd = host.doc();
    if (dd !== d) { host.closeSheet(); return; }
    let note: string | null = null;
    k.edit(plain, (x) => { x.paths = clonePaths(base); note = apply(id, x, pid, k); });
    if (note) host.toast(note);
    host.render();
  };
  go();
  show(k, `${plain} (${pro})`, sheet(id, k, go));
}

/**
 * The editor builds a sheet once per name and keeps that first body, so every command shows its own controls inside one
 * holder that is refilled each time. Without it, Mirror after Grow showed Grow's sheet, wired to redo Grow.
 */
let holder: HTMLElement | null = null;
function show(k: PathOpsKit, title: string, body: HTMLElement): void {
  holder ??= h('div', { 'data-testid': 'pathop-holder' });
  holder.replaceChildren(body);
  k.host.sheet('pathop', title, holder);
}

// ---- drawing an outline as a line on a layer -------------------------------------------------------------------------
const PATTERN: Record<Dash, (w: number, butt: boolean) => number[]> = {
  solid: () => [1, 0], dash: (w) => [3 * w, 2 * w], dot: (w, butt) => (butt ? [w, w] : [0, 2 * w]), dashdot: (w, butt) => [3 * w, 2 * w, butt ? w : 0, 2 * w],
};
/** The outline drawn as a line in `color` with the style in S, as layer pixels just big enough to hold it. */
function lineGeom(subs: readonly Subpath[], color: string): LayerGeom | null {
  const b = subpathsBounds(subs), head = S.width * 3 + 6;
  if (!b) return null;
  const pad = Math.ceil(S.width * 2 + head + 2), x0 = Math.floor(b.x - pad), y0 = Math.floor(b.y - pad);
  const w = Math.ceil(b.w + 2 * pad) + 1, hh = Math.ceil(b.h + 2 * pad) + 1;
  if (w * hh > 25_000_000 || w > 16384 || hh > 16384) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return null;
  x.translate(-x0, -y0);
  x.strokeStyle = x.fillStyle = color; x.lineWidth = S.width; x.lineCap = S.cap; x.lineJoin = S.corner; x.miterLimit = 10;
  const pat = PATTERN[S.dash](S.width, S.cap === 'butt');
  for (const s of subs) {
    const pts = ringPoints(s);
    if (pts.length < 2) continue;
    const arrows = !s.closed && S.ends !== 'none', wk = walk(pts, s.closed);
    // The line stops a little short of an arrowhead's tip, so its end never pokes out past the point.
    const run = arrows ? sliceWalk(wk, S.ends === 'both' ? head * 0.6 : 0, Math.max(0, wk.length - head * 0.6)) : pts;
    for (const dash of dashLine(run, s.closed && !arrows, pat)) {
      x.beginPath();
      dash.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
      if (S.dash === 'solid' && s.closed) x.closePath();
      x.stroke();
    }
    if (arrows) for (const atStart of S.ends === 'both' ? [false, true] : [false]) {
      const t = arrowHead(pts, atStart, head);
      x.beginPath(); x.moveTo(t[0].x, t[0].y); x.lineTo(t[1].x, t[1].y); x.lineTo(t[2].x, t[2].y); x.closePath(); x.fill();
    }
  }
  return { x: x0, y: y0, width: w, height: hh, data: x.getImageData(0, 0, w, hh).data };
}
/** Draw the picked outline as a line on a new layer; each Update redraws that layer (one undo step each). */
function runLineStyle(k: PathOpsKit): void {
  const host = k.host, d = host.doc();
  if (!d) return;
  const p = k.picked(d), why = blocked('path.stroke-style', d, p);
  if (why || !p) { host.toast(why ?? ''); return; }
  const pid = p.id, [plain, pro] = TITLES['path.stroke-style'];
  let lid: string | null = null;
  const go = (): void => {
    const dd = host.doc(), path = dd?.paths?.find((x) => x.id === pid);
    if (dd !== d || !dd || !path) { host.closeSheet(); return; }
    const g = lineGeom(path.subpaths, host.fg());
    if (!g) { host.toast('This outline is too big to draw as a line here.'); return; }
    const old = lid ? findLayer(dd, lid) : undefined;
    if (old) {
      const before = geomOf(old), id = old.id, set = (x: Doc, v: LayerGeom): void => { const l = findLayer(x, id); if (l) setGeom(l, v); };
      setGeom(old, g);
      host.push({ label: 'Line style', bytes: g.data.length, undo: (x) => set(x, before), redo: (x) => set(x, g) }, true);
    } else {
      const l = createLayer(path.name + ' line', g.width, g.height, { x: g.x, y: g.y, data: g.data });
      lid = l.id;
      host.push(addLayer(dd, l, indexOfLayer(dd, dd.activeId) + 1, 'Draw the outline as a line'), true);
    }
    host.render();
  };
  go();
  show(k, `${plain} (${pro})`, sheet('path.stroke-style', k, go));
}

// ---- QR codes --------------------------------------------------------------------------------------------------------
const changeGeom = (label: string, id: string, before: LayerGeom, after: LayerGeom): Command => {
  const set = (x: Doc, v: LayerGeom): void => { const l = findLayer(x, id); if (l) setGeom(l, v); };
  return { label, bytes: after.data.length + before.data.length, undo: (x) => set(x, before), redo: (x) => set(x, after) };
};
/**
 * A QR code of the words in S, centred in the picture: black squares on a white border on a new layer (so a phone scans
 * it), and the same squares as an outline. Making it, and each Update, is one undo step for both.
 */
function runQr(k: PathOpsKit): void {
  const host = k.host, d = host.doc();
  if (!d) return;
  const [plain, pro] = TITLES['shape.qr'];
  let pid: string | null = null, lid: string | null = null;
  const go = (): void => {
    const dd = host.doc();
    if (dd !== d || !dd) { host.closeSheet(); return; }
    const text = S.qrText.trim(), code = qrEncode(text, S.qrLevel);
    if (!code) {
      host.toast(text ? 'Too long for one QR code here: shorten the words, or pick a lower damage level.' : 'Type the words or web address the code should hold.');
      return;
    }
    if (S.qrModule <= 0) S.qrModule = Math.max(1, Math.floor((Math.min(dd.width, dd.height) * 0.6) / (code.size + 8)));
    const m = S.qrModule, px = qrPixels(code, m, 4, [0, 0, 0, 255], [255, 255, 255, 255]);
    const x0 = Math.round((dd.width - px.width) / 2), y0 = Math.round((dd.height - px.width) / 2);
    const g: LayerGeom = { x: x0, y: y0, width: px.width, height: px.width, data: px.data }, subs = qrSubpaths(code, x0 + 4 * m, y0 + 4 * m, m);
    const before = clonePaths(dd.paths);
    let path = pid ? dd.paths?.find((x) => x.id === pid) : undefined;
    if (path) path.subpaths = subs;
    else { path = { id: newPathId(), name: nameFor(dd, 'QR code'), subpaths: subs }; (dd.paths ??= []).push(path); pid = path.id; }
    const after = clonePaths(dd.paths), anchors = (ps: VectorPath[]): number => ps.reduce((n, q) => n + q.subpaths.reduce((a, s) => a + s.anchors.length, 0), 0);
    const paths: Command = { label: plain, bytes: 64 * (anchors(before) + anchors(after)) + 64, undo: (x) => { x.paths = clonePaths(before); }, redo: (x) => { x.paths = clonePaths(after); } };
    const old = lid ? findLayer(dd, lid) : undefined;
    let layer: Command;
    if (old) { const was = geomOf(old); setGeom(old, g); layer = changeGeom(plain, old.id, was, g); }
    else { const l = createLayer(path.name, g.width, g.height, { x: g.x, y: g.y, data: g.data }); lid = l.id; layer = addLayer(dd, l, indexOfLayer(dd, dd.activeId) + 1, plain); }
    k.pick(dd, path.id);
    host.push(combineCommands(plain, [paths, layer]), true);
    host.render();
  };
  go();
  show(k, `${plain} (${pro})`, sheet('shape.qr', k, go));
}

function seg<T extends string>(label: string, help: string, opts: readonly [T, string][], cur: () => T, set: (v: T) => void, redo: () => void, tid: string): HTMLElement {
  const wrap = h('div', { class: 'fpe-seg', role: 'group', 'aria-label': label, title: help, style: 'display:flex;flex-wrap:wrap;gap:4px' });
  const paint = (): void => { for (const b of Array.from(wrap.children)) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === cur())); };
  wrap.append(...opts.map(([v, text]) => h('button', { type: 'button', class: 'fpe-btn', 'data-v': v, 'data-testid': `${tid}-${v}`, 'aria-pressed': String(v === cur()),
    onclick: () => { set(v); paint(); redo(); } }, text)));
  return h('div', { style: 'display:grid;gap:4px;margin:8px 0' }, h('span', { class: 'fpe-hint' }, label), wrap);
}
function check(label: string, help: string, get: () => boolean, set: (v: boolean) => void, redo: () => void, tid: string): HTMLElement {
  const box = h('input', { type: 'checkbox', 'data-testid': tid, onchange: () => { set(box.checked); redo(); } });
  box.checked = get();
  return h('label', { title: help, style: 'display:flex;gap:8px;align-items:center;margin:8px 0;font-size:13px' }, box, label);
}

type Num = 'qrModule' | 'offset' | 'copies' | 'amount' | 'size' | 'seed' | 'points' | 'inner' | 'turns' | 'gap' | 'angle' | 'stitches' | 'steps' | 'along' | 'w0' | 'w1' | 'w2' | 'width';
function sheet(id: string, k: PathOpsKit, redo: () => void): HTMLElement {
  const host = k.host, rows: HTMLElement[] = [];
  const num = (label: string, help: string, min: number, max: number, key: Num, unit: string): HTMLElement =>
    host.slider(label, help, min, max, S[key], unit, (v) => { S[key] = v; }, `pathop-${key}`);
  const pair = 'The outline above the picked one in Outlines (A) and the picked one (B); with one outline, its first piece and the next.';
  let note = '';
  switch (id) {
    case 'path.boolean':
      note = 'The picked outline (B) meets the one above it in Outlines (A); with one outline, its first piece meets the rest.';
      rows.push(seg('How to combine', 'Merge both, cut B out of A, keep only where they overlap, or keep only where they do not.',
        (['unite', 'subtract', 'intersect', 'exclude'] as const).map((v) => [v, LABELS[v]] as [BoolOp, string]), () => S.op, (v) => { S.op = v; }, redo, 'pathop-op'));
      break;
    case 'path.combine':
      note = 'Join puts the picked outline and the one above it into one outline (its pieces stay as they are). Split makes each separate piece its own outline; a hole stays with the piece round it.';
      rows.push(seg('Join or split', 'Join two outlines into one, or split one into its pieces.', [['join', 'Join into one outline'], ['split', 'Split into pieces']] as const,
        () => (S.combine === 'auto' ? 'join' : S.combine) as 'join' | 'split', (v) => { S.combine = v; }, redo, 'pathop-combine'));
      break;
    case 'path.offset':
      note = 'Every edge moves out (grow) or in (shrink) by the same number of pixels; grown corners come out round. True to about half a pixel.';
      rows.push(num('Grow (+) or shrink (−)', 'Pixels to move every edge: above 0 grows the shape, below 0 shrinks it.', -100, 100, 'offset', ' px'));
      break;
    case 'path.mirror':
      note = 'A mirror copy is added across an edge of the outline. Draw half a heart with both ends on that edge, and joining makes the whole heart.';
      rows.push(seg('Mirror across', 'Which edge of the outline\'s box the mirror line runs along.', [['right', 'Right edge'], ['left', 'Left edge'], ['bottom', 'Bottom edge'], ['top', 'Top edge']] as const,
        () => S.axis, (v) => { S.axis = v; }, redo, 'pathop-axis'),
      check('Join the two halves into one shape', 'Off keeps the mirror copy as a separate piece.', () => S.join, (v) => { S.join = v; }, redo, 'pathop-join'));
      break;
    case 'path.rotate-copies':
      note = 'Copies of the outline are spun round a centre at even angles, like the petals of a flower.';
      rows.push(num('Copies', 'How many copies go round the circle, the original included.', 2, 36, 'copies', ''),
        seg('Spin round', 'The middle of the outline itself, or the middle of the picture (draw the shape off-centre for a ring).', [['self', 'Its own centre'], ['picture', 'The picture\'s centre']] as const,
          () => S.around, (v) => { S.around = v; }, redo, 'pathop-around'),
        check('Join the copies into one shape', 'Off keeps each copy as a separate piece.', () => S.join, (v) => { S.join = v; }, redo, 'pathop-join'));
      break;
    case 'path.roughen':
      note = 'Points are set every few pixels along the outline and each is pushed sideways a random amount, like a hand-drawn line.';
      rows.push(num('Wobble', 'How far, in pixels, a point may be pushed sideways.', 0, 50, 'amount', ' px'),
        num('Detail', 'Pixels between points: smaller gives a finer, busier wobble.', 2, 100, 'size', ' px'),
        num('Pattern', 'Another random pattern of the same strength.', 1, 100, 'seed', ''));
      break;
    case 'shape.spiral-star':
      note = 'A new outline in the middle of the picture. Reshape it with the point tools, or fill it from Outlines.';
      rows.push(seg('Shape', 'A star with points, or a spiral that winds out from the middle.', [['star', 'Star'], ['spiral', 'Spiral']] as const, () => S.kind, (v) => { S.kind = v; }, redo, 'pathop-kind'),
        num('Points (star)', 'How many tips the star has.', 3, 50, 'points', ''),
        num('Inner size', 'Star: how far in the corners between the tips sit, against the tips. Spiral: where it starts.', 5, 95, 'inner', '%'),
        num('Turns (spiral)', 'How many times the spiral winds round.', 1, 20, 'turns', ''));
      break;
    case 'path.divide':
      note = `A is sliced along B's edge: the parts outside B and the parts inside it each become their own outline, and B is used up. ${pair}`;
      break;
    case 'path.hatches':
      note = 'Evenly spaced lines fill the inside of the picked outline (holes stay empty). Draw them with "Arrowheads and dash styles", or make a selection from them.';
      rows.push(num('Gap', 'Pixels between the lines.', 2, 200, 'gap', ' px'),
        num('Angle', 'Which way the lines run: 0 is level, 90 is upright.', -90, 90, 'angle', '°'),
        check('Cross the lines', 'Adds a second set at right angles.', () => S.cross, (v) => { S.cross = v; }, redo, 'pathop-cross'),
        check('Keep the outline', 'Off leaves only the lines.', () => S.keep, (v) => { S.keep = v; }, redo, 'pathop-keep'));
      break;
    case 'path.stitch':
      note = `Straight lines go across from A to B, spaced evenly along both, like string art. ${pair}`;
      rows.push(num('Lines', 'How many lines go across.', 2, 200, 'stitches', ''));
      break;
    case 'path.interpolate':
      note = `In-between shapes blend A into B in even steps. ${pair}`;
      rows.push(num('Steps', 'How many in-between shapes.', 1, 50, 'steps', ''));
      break;
    case 'path.pattern-along': case 'path.bend':
      note = id === 'path.bend'
        ? `A is bent along the line B and stretched to its length. ${pair}`
        : `Copies of A are laid along the line B, each bent to follow it; on a closed line they spread evenly. ${pair}`;
      if (id === 'path.pattern-along') rows.push(num('Gap', 'Pixels between copies.', 0, 200, 'along', ' px'));
      break;
    case 'path.power-stroke':
      note = 'The picked line becomes a shape that is thick and thin along its length; fill it from Outlines. Widths change evenly between the three points.';
      rows.push(num('Width at the start', 'Pixels across at the start of the line.', 0, 200, 'w0', ' px'),
        num('Width in the middle', 'Pixels across halfway along.', 0, 200, 'w1', ' px'),
        num('Width at the end', 'Pixels across at the end of the line.', 0, 200, 'w2', ' px'));
      break;
    case 'shape.qr': {
      note = 'Black squares on a white border, on a new layer in the middle of the picture, so a phone can scan it; the same squares are also an outline you can fill or reshape. Scan it with your phone before you print it.';
      const ta = h('textarea', { rows: 3, 'data-testid': 'pathop-qr-text', 'aria-label': 'Words or web address', style: 'width:100%;box-sizing:border-box;font:inherit;font-size:13px',
        oninput: () => { S.qrText = ta.value; } });
      ta.value = S.qrText;
      rows.push(h('label', { style: 'display:grid;gap:4px;font-size:13px' }, 'Words or web address (Update makes the new code)', ta),
        seg('How much damage it survives (error correction)', 'More lets a phone read the code when part of it is covered or dirty, but packs the squares tighter.',
          [['L', 'Low, 7%'], ['M', 'Medium, 15%'], ['Q', 'High, 25%'], ['H', 'Highest, 30%']] as const, () => S.qrLevel, (v) => { S.qrLevel = v; }, redo, 'pathop-qr-level'),
        num('Square size', 'Pixels across each small square of the code.', 1, 40, 'qrModule', ' px'));
      break;
    }
    case 'path.stroke-style':
      note = 'The picked outline is drawn as a line on a new layer in the main colour. Update redraws that layer.';
      rows.push(num('Width', 'How thick the line is, in pixels.', 1, 100, 'width', ' px'),
        seg('Pattern', 'A solid line, dashes, dots, or dash and dot.', [['solid', 'Solid'], ['dash', 'Dashes'], ['dot', 'Dots'], ['dashdot', 'Dash and dot']] as const, () => S.dash, (v) => { S.dash = v; }, redo, 'pathop-dash'),
        seg('Line ends', 'Flat ends stop at the point; round and square ends reach half the width past it.', [['butt', 'Flat'], ['round', 'Round'], ['square', 'Square']] as const, () => S.cap, (v) => { S.cap = v; }, redo, 'pathop-cap'),
        seg('Corners', 'Sharp, round or cut-off corners.', [['miter', 'Sharp'], ['round', 'Round'], ['bevel', 'Cut off']] as const, () => S.corner, (v) => { S.corner = v; }, redo, 'pathop-corner'),
        seg('Arrowheads', 'An arrowhead at the end of an open line, at both ends, or none.', [['none', 'None'], ['end', 'At the end'], ['both', 'Both ends']] as const, () => S.ends, (v) => { S.ends = v; }, redo, 'pathop-ends'));
      break;
  }
  return h('div', { 'data-testid': 'pathop-sheet', 'data-cmd': id, style: 'display:grid;gap:4px;min-width:min(340px,100%)' },
    h('p', { class: 'fpe-note', style: 'margin:0 0 4px' }, note), ...rows,
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'pathop-update', title: 'Do it again from the outlines as they were, with these numbers (one undo step).', onclick: redo }, 'Update'),
      h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'pathop-done', onclick: () => host.closeSheet() }, 'Done')));
}
