// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Shapes & text, path operations (13 Nov 2026): combine two shapes, join or split pieces, grow or shrink, mirror, copies
 * round a centre, a hand-drawn wobble, and star and spiral outlines. The pen kit (pen.ts) loads this file the first time
 * one of them runs, so neither the first screen nor the tool kit carries it.
 *
 * Each command works at once with the numbers it used last (one undo step), then shows a small sheet: a choice button
 * redoes it that way at once, and "Update" redoes it with changed numbers. Each redo starts again from the outlines as
 * they were before the command, so trying numbers never stacks one result on another; each is its own undo step.
 */
import { clonePaths, newPathId, type Doc, type Subpath, type VectorPath } from '@free-photoeditor/core';
import {
  booleanSubpaths, mirrorSubpaths, offsetSubpaths, rotateCopies, roughenSubpaths, spiralSubpath, splitPieces, starSubpath, subpathsBounds,
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

/** The numbers each command used last (they stay for the next run in this tab). */
export const S = {
  op: 'unite' as BoolOp, combine: 'auto' as 'auto' | 'join' | 'split', offset: 10, axis: 'right' as MirrorAxis, join: true,
  copies: 6, around: 'self' as 'self' | 'picture', amount: 4, size: 8, seed: 1, kind: 'star' as 'star' | 'spiral', points: 5, inner: 45, turns: 3,
};

const TITLES: Record<string, [string, string]> = {
  'path.boolean': ['Combine two shapes', 'Boolean operations'],
  'path.combine': ['Join or split outlines', 'Combine / Break apart'],
  'path.offset': ['Grow or shrink a shape', 'Offset path'],
  'path.mirror': ['Mirror an outline', 'Mirror symmetry'],
  'path.rotate-copies': ['Copies around a circle', 'Rotate copies'],
  'path.roughen': ['Hand-drawn wobble', 'Roughen'],
  'shape.spiral-star': ['Star or spiral outline', 'Star and spiral'],
};
const LABELS: Record<BoolOp, string> = { unite: 'Merge', subtract: 'Cut out', intersect: 'Keep the overlap', exclude: 'Keep what does not overlap' };

/** The two shapes a combine works on: the picked outline and the one above it in Outlines, or the pieces of one outline. */
interface Pair { a: VectorPath | null; b: VectorPath; aSubs: Subpath[]; bSubs: Subpath[]; }
function pairOf(d: Doc, p: VectorPath): Pair | null {
  const list = d.paths ?? [], i = list.indexOf(p);
  if (list.length >= 2) { const a = list[i - 1] ?? list[i + 1]; return { a, b: p, aSubs: a.subpaths, bSubs: p.subpaths }; }
  if (p.subpaths.length >= 2) return { a: null, b: p, aSubs: [p.subpaths[0]], bSubs: p.subpaths.slice(1) };
  return null;
}
/** Put one outline where two were (at the upper one's place), and pick it. */
function replacePair(d: Doc, k: PathOpsKit, pr: Pair, subs: Subpath[]): void {
  const list = d.paths ?? [], a = pr.a as VectorPath, at = Math.min(list.indexOf(a), list.indexOf(pr.b));
  const np: VectorPath = { id: newPathId(), name: a.name, subpaths: subs };
  if (a.work || pr.b.work) np.work = true;
  d.paths = list.filter((x) => x !== a && x !== pr.b);
  d.paths.splice(Math.max(0, at), 0, np);
  k.pick(d, np.id);
}
const nameFor = (d: Doc, base: string): string => { let n = 1; while ((d.paths ?? []).some((p) => p.name === `${base} ${n}`)) n++; return `${base} ${n}`; };

/** Why a command cannot run on this picture now, in plain words, or null when it can. */
export function blocked(id: string, d: Doc, p: VectorPath | null): string | null {
  if (id === 'shape.spiral-star') return null;
  if (!p || !p.subpaths.some((s) => s.anchors.length > 1)) return 'Draw an outline first: pick Draw curves (Pen), or make one from a selection in Outlines.';
  if (id === 'path.boolean' && !pairOf(d, p)) return 'Combining needs two shapes: draw a second outline, or a second piece in this one.';
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
  switch (id) {
    case 'path.boolean': {
      const pr = pairOf(d, p);
      if (!pr) return null;
      const out = booleanSubpaths(pr.aSubs, pr.bSubs, S.op);
      if (pr.a) replacePair(d, k, pr, out); else p.subpaths = out;
      return out.length ? null : 'Nothing is left: the two shapes do not overlap. Undo, or pick another way to combine them.';
    }
    case 'path.combine': {
      const pr = pairOf(d, p), pieces = splitPieces(p.subpaths);
      const how = S.combine !== 'auto' ? S.combine : list.length >= 2 ? 'join' : 'split';
      if (how === 'join' && pr?.a) { replacePair(d, k, pr, [...pr.a.subpaths, ...pr.b.subpaths].map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) }))); return null; }
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
  }
  return null;
}

/** Run a path operation: at once with the last numbers, then the sheet to try others. */
export function runPathOp(id: string, k: PathOpsKit): void {
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
  host.sheet('pathop', `${plain} (${pro})`, sheet(id, k, go));
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

function sheet(id: string, k: PathOpsKit, redo: () => void): HTMLElement {
  const host = k.host, rows: HTMLElement[] = [];
  const num = (label: string, help: string, min: number, max: number, key: 'offset' | 'copies' | 'amount' | 'size' | 'seed' | 'points' | 'inner' | 'turns', unit: string): HTMLElement =>
    host.slider(label, help, min, max, S[key], unit, (v) => { S[key] = v; }, `pathop-${key}`);
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
  }
  return h('div', { 'data-testid': 'pathop-sheet', 'data-cmd': id, style: 'display:grid;gap:4px;min-width:min(340px,100%)' },
    h('p', { class: 'fpe-note', style: 'margin:0 0 4px' }, note), ...rows,
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px' },
      h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'pathop-update', title: 'Do it again from the outlines as they were, with these numbers (one undo step).', onclick: redo }, 'Update'),
      h('button', { type: 'button', class: 'fpe-btn', 'data-testid': 'pathop-done', onclick: () => host.closeSheet() }, 'Done')));
}
