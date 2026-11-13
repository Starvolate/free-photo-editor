// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The pen and its outline tools (wave 4, slice 1): draw curves, pick a whole outline, pick outline points, add, remove
 * and change points; the Paths panel; a selection from an outline and an outline from the selection. Loaded with the tool
 * kit (toolkit.ts imports it), never on the first screen. The outlines live in the document (`doc.paths`, core path.ts);
 * every change is one undoable step holding the outlines before and after, applied first and then put on the History.
 * Mouse, pen and touch share one gesture: press, move, release.
 */
import {
  anchorAt, clonePaths, countAnchors, deleteAnchor, dropEmpty, hitAnchor, hitSegment, makeCorner, makeSmooth, moveAnchor, moveHandle, newPathId,
  pathBounds, pathData, pathMask, pullHandles, selectionFromMask, selectionToPath, splitSegment, subpathPoints, translatePath,
  type Command, type Doc, type Selection, type VectorPath,
} from '@free-photoeditor/core';
import type { ToolId } from './commands';
import { h } from './dom';
import type { PointerInfo, Pt } from './input';
import type { ToolHost } from './toolkit';

/** Shapes & text path operations: the pen kit runs them through pathops.ts, loaded on first use. */
export const PATH_OPS = new Set<string>(['path.boolean', 'path.combine', 'path.offset', 'path.mirror', 'path.rotate-copies', 'path.roughen', 'shape.spiral-star',
  'path.stroke-style', 'path.divide', 'path.bend', 'path.hatches', 'path.interpolate', 'path.stitch', 'path.pattern-along', 'path.power-stroke']);
export const PEN_TOOLS = new Set<ToolId>(['pen', 'path-select', 'direct-select', 'anchor-add', 'anchor-delete', 'anchor-convert']);

type DragKind = 'pen' | 'close' | 'anchor' | 'handle' | 'path' | 'pull';
interface Drag { kind: DragKind; before: VectorPath[]; label: string; id: string; sub: number; idx: number; part?: 'in' | 'out'; alone?: boolean; last: Pt; from: Pt; moved: boolean; }

export interface PenKit {
  /** The picked outline (or the work path, or the last one): what text along a line follows. */
  outline(d: Doc): VectorPath | null;
  start(p: Pt, i: PointerInfo): void;
  move(p: Pt, i: PointerInfo): void;
  end(p: Pt, i: PointerInfo): void;
  cancel(): void;
  options(bar: HTMLElement, t: ToolId): void;
  overlay(ctx: CanvasRenderingContext2D): void;
  key(e: KeyboardEvent): boolean;
  cmd(id: string): unknown;
  toolChanged(prev: ToolId, next: ToolId): void;
  fillPanel(body: HTMLElement): void;
  refresh(): void;
  state(): Record<string, unknown>;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Inside an outline by the even-odd rule (open subpaths closed straight back), as a selection made from it would be. */
function inside(p: VectorPath, pt: Pt): boolean {
  let n = 0;
  for (const s of p.subpaths) {
    const q = subpathPoints(s);
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      if ((q[i].y > pt.y) !== (q[j].y > pt.y) && pt.x < q[i].x + ((pt.y - q[i].y) / (q[j].y - q[i].y)) * (q[j].x - q[i].x)) n++;
    }
  }
  return n % 2 === 1;
}

export function createPenKit(host: ToolHost, setSel: (s: Selection | null, label: string) => void): PenKit {
  const picked = new WeakMap<Doc, string>();
  let drawing: { id: string; sub: number } | null = null, drag: Drag | null = null, focus: { sub: number; idx: number } | null = null;
  let panel: HTMLElement | null = null, renaming: string | null = null;
  const S = { auto: true, tol: 2 };

  const doc = (): Doc | null => host.doc();
  const list = (d: Doc): VectorPath[] => d.paths ?? [];
  const find = (d: Doc, id: string | undefined): VectorPath | null => (id ? list(d).find((p) => p.id === id) ?? null : null);
  const active = (d: Doc): VectorPath | null => find(d, picked.get(d));
  const phone = (): boolean => host.layout() === 'phone';
  /** How near, in picture pixels, a press must be to a point or a line to catch it. */
  const reach = (): number => (phone() ? 16 : 9) / host.view().zoom;
  const scr = (p: Pt): Pt => { const v = host.view(); return { x: v.panX + p.x * v.zoom, y: v.panY + p.y * v.zoom }; };
  const nextName = (d: Doc): string => { let n = 1; while (list(d).some((p) => p.name === `Outline ${n}`)) n++; return `Outline ${n}`; };

  function commit(d: Doc, before: VectorPath[], label: string): void {
    const after = clonePaths(d.paths);
    const bytes = 64 * (before.reduce((n, p) => n + countAnchors(p), 0) + after.reduce((n, p) => n + countAnchors(p), 0)) + 64;
    const cmd: Command = { label, bytes, undo: (x) => { x.paths = clonePaths(before); }, redo: (x) => { x.paths = clonePaths(after); } };
    host.push(cmd);
    refresh();
  }
  /** Undo can take away the subpath being drawn: stop drawing when it is gone or closed. */
  function check(d: Doc): void {
    if (!drawing) return;
    const p = find(d, drawing.id), s = p?.subpaths[drawing.sub];
    if (!p || !s || s.closed || !s.anchors.length) drawing = null;
  }
  /** The outline under a press: the picked one first. */
  function under(d: Doc, pt: Pt, r: number): VectorPath | null {
    const a = active(d), all = a ? [a, ...list(d).filter((p) => p !== a)] : list(d);
    return all.find((p) => hitAnchor(p, pt, r) || hitSegment(p, pt, r)) ?? all.find((p) => inside(p, pt)) ?? null;
  }
  const begin = (kind: DragKind, before: VectorPath[], label: string, p: VectorPath, sub: number, idx: number, pt: Pt, extra: Partial<Drag> = {}): void => {
    drag = { kind, before, label, id: p.id, sub, idx, last: pt, from: pt, moved: false, ...extra };
    focus = idx >= 0 ? { sub, idx } : null;
  };

  function penDown(d: Doc, pt: Pt, before: VectorPath[]): void {
    const r = reach();
    let ap = active(d);
    if (drawing && ap && ap.id === drawing.id) {
      const s = ap.subpaths[drawing.sub];
      if (s.anchors.length >= 2 && dist(s.anchors[0], pt) <= r) { s.closed = true; begin('close', before, 'Close the outline', ap, drawing.sub, 0, pt); return; }
      s.anchors.push(anchorAt(pt.x, pt.y));
      begin('pen', before, 'Add a point', ap, drawing.sub, s.anchors.length - 1, pt);
      return;
    }
    drawing = null;
    if (ap && S.auto) {
      const ah = hitAnchor(ap, pt, r, false);
      if (ah) {
        const s = ap.subpaths[ah.sub];
        if (!s.closed && (ah.idx === s.anchors.length - 1 || ah.idx === 0)) {
          // An open end: carry on drawing from it.
          if (ah.idx === 0 && s.anchors.length > 1) { s.anchors.reverse(); for (const a of s.anchors) [a.inX, a.inY, a.outX, a.outY] = [a.outX, a.outY, a.inX, a.inY]; }
          drawing = { id: ap.id, sub: ah.sub };
          focus = { sub: ah.sub, idx: s.anchors.length - 1 };
          if (ah.idx === 0 && s.anchors.length > 1) commit(d, before, 'Carry on the outline');
          return;
        }
        deleteAnchor(s, ah.idx); dropEmpty(ap); focus = null;
        commit(d, before, 'Remove a point');
        return;
      }
      const sh = hitSegment(ap, pt, r);
      if (sh) { const idx = splitSegment(ap.subpaths[sh.sub], sh.seg, sh.t); begin('anchor', before, 'Add a point', ap, sh.sub, idx, pt); return; }
    }
    if (!ap) {
      ap = list(d).find((p) => p.work) ?? null;
      if (!ap) { ap = { id: newPathId(), name: 'Work path', work: true, subpaths: [] }; (d.paths ??= []).push(ap); }
      picked.set(d, ap.id);
    }
    ap.subpaths.push({ anchors: [anchorAt(pt.x, pt.y)], closed: false });
    drawing = { id: ap.id, sub: ap.subpaths.length - 1 };
    begin('pen', before, 'Start an outline', ap, drawing.sub, 0, pt);
  }

  function start(pt: Pt, i: PointerInfo): void {
    const d = doc();
    if (!d) return;
    check(d);
    const t = host.tool(), before = clonePaths(d.paths), r = reach();
    if (t === 'pen') { penDown(d, pt, before); host.render(); host.refreshOptions(); return; }
    const p = t === 'path-select' ? under(d, pt, r) : (active(d) && (hitAnchor(active(d) as VectorPath, pt, r) || hitSegment(active(d) as VectorPath, pt, r)) ? active(d) : under(d, pt, r));
    if (!p) { if (t === 'path-select' || t === 'direct-select') { picked.delete(d); focus = null; refresh(); } host.render(); return; }
    if (picked.get(d) !== p.id) { picked.set(d, p.id); refresh(); }
    const ah = hitAnchor(p, pt, r, t !== 'anchor-delete' && t !== 'anchor-add');
    if (t === 'path-select') begin('path', before, 'Move the outline', p, 0, -1, pt);
    else if (t === 'direct-select') {
      if (ah?.part === 'anchor') begin('anchor', before, 'Move a point', p, ah.sub, ah.idx, pt);
      else if (ah) begin('handle', before, 'Move a handle', p, ah.sub, ah.idx, pt, { part: ah.part as 'in' | 'out', alone: i.alt });
    } else if (t === 'anchor-convert') {
      if (ah?.part === 'anchor') begin('pull', before, 'Make a smooth point', p, ah.sub, ah.idx, pt);
      else if (ah) begin('handle', before, 'Move a handle', p, ah.sub, ah.idx, pt, { part: ah.part as 'in' | 'out', alone: true });
    } else if (t === 'anchor-delete') {
      if (ah) { deleteAnchor(p.subpaths[ah.sub], ah.idx); dropEmpty(p); focus = null; commit(d, before, 'Remove a point'); }
    } else if (t === 'anchor-add') {
      const sh = hitSegment(p, pt, r);
      if (sh) begin('anchor', before, 'Add a point', p, sh.sub, splitSegment(p.subpaths[sh.sub], sh.seg, sh.t), pt);
    }
    host.render();
  }
  function move(pt: Pt): void {
    const d = doc(), g = drag;
    if (!d || !g) return;
    const p = find(d, g.id);
    if (!p) return;
    if (!g.moved && dist(pt, g.from) < reach() / 3) return;
    g.moved = true;
    const a = g.idx >= 0 ? p.subpaths[g.sub]?.anchors[g.idx] : undefined, dx = pt.x - g.last.x, dy = pt.y - g.last.y;
    if (g.kind === 'path') translatePath(p, dx, dy);
    else if (a && (g.kind === 'pen' || g.kind === 'close' || g.kind === 'pull')) pullHandles(a, pt.x, pt.y);
    else if (a && g.kind === 'anchor') moveAnchor(a, dx, dy);
    else if (a && g.kind === 'handle' && g.part) moveHandle(a, g.part, pt.x, pt.y, g.alone);
    g.last = pt;
    host.render();
  }
  function end(): void {
    const d = doc(), g = drag;
    drag = null;
    if (!d || !g) return;
    const p = find(d, g.id), a = p && g.idx >= 0 ? p.subpaths[g.sub]?.anchors[g.idx] : undefined;
    if (g.kind === 'pen') commit(d, g.before, g.moved ? (g.idx === 0 ? 'Start a curve' : 'Add a smooth point') : g.label);
    else if (g.kind === 'close') { drawing = null; commit(d, g.before, g.label); }
    else if (g.kind === 'pull' && a && p) {
      if (!g.moved) { const sub = p.subpaths[g.sub]; if (a.smooth || a.inX !== a.x || a.outX !== a.x || a.inY !== a.y || a.outY !== a.y) { makeCorner(a); g.label = 'Make a corner'; } else makeSmooth(sub, g.idx); }
      commit(d, g.before, g.label);
    } else if (g.moved || g.label === 'Add a point') commit(d, g.before, g.label);
    host.render();
    host.refreshOptions();
  }
  function cancel(): void {
    const d = doc(), g = drag;
    drag = null;
    if (d && g) { d.paths = clonePaths(g.before); check(d); host.render(); }
  }
  function stop(): void { drawing = null; host.render(); host.refreshOptions(); }

  function overlay(ctx: CanvasRenderingContext2D): void {
    const d = doc();
    if (!d) return;
    const p = active(d), t = host.tool(), tools = PEN_TOOLS.has(t), v = host.view();
    if (!p) return;
    ctx.save();
    ctx.translate(v.panX, v.panY); ctx.scale(v.zoom, v.zoom);
    const shape = new Path2D(pathData(p));
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,14,22,.75)'; ctx.lineWidth = 3 / v.zoom; ctx.stroke(shape);
    ctx.strokeStyle = '#5ea0ff'; ctx.lineWidth = 1.5 / v.zoom; ctx.stroke(shape);
    const ptr = host.pointer(), s = drawing && drawing.id === p.id ? p.subpaths[drawing.sub] : null;
    if (tools && s && ptr && !drag && s.anchors.length) {
      // The next curve, from the last point to the pointer, before it is placed.
      const a = s.anchors[s.anchors.length - 1];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.outX, a.outY, ptr.x, ptr.y, ptr.x, ptr.y);
      ctx.setLineDash([6 / v.zoom, 4 / v.zoom]); ctx.strokeStyle = '#5ea0ff'; ctx.lineWidth = 1.5 / v.zoom; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    if (!tools) return;
    const big = phone(), sq = big ? 11 : 7, dot = big ? 5 : 3.5;
    p.subpaths.forEach((sp, si) => sp.anchors.forEach((a, k) => {
      const c = scr(a);
      for (const [hx, hy] of [[a.inX, a.inY], [a.outX, a.outY]]) {
        if (hx === a.x && hy === a.y) continue;
        const e = scr({ x: hx, y: hy });
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.strokeStyle = 'rgba(94,160,255,.9)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(e.x, e.y, dot, 0, Math.PI * 2); ctx.fillStyle = '#5ea0ff'; ctx.fill(); ctx.strokeStyle = '#0a0e16'; ctx.stroke();
      }
      const on = focus && focus.sub === si && focus.idx === k;
      ctx.fillStyle = on ? '#5ea0ff' : '#ffffff'; ctx.strokeStyle = '#0a0e16'; ctx.lineWidth = 1.5;
      ctx.fillRect(c.x - sq / 2, c.y - sq / 2, sq, sq); ctx.strokeRect(c.x - sq / 2, c.y - sq / 2, sq, sq);
    }));
    if (s && ptr && s.anchors.length >= 2 && dist(s.anchors[0], ptr) <= reach()) {
      const f = scr(s.anchors[0]);
      ctx.beginPath(); ctx.arc(f.x, f.y, sq + 3, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function fromPath(): void {
    const d = doc();
    if (!d) return;
    const p = active(d) ?? list(d).find((x) => x.work) ?? list(d)[0];
    if (!p || !countAnchors(p)) { host.toast('Draw an outline with Draw curves (Pen) first.'); return; }
    const sel = selectionFromMask(pathMask(p, d.width, d.height));
    if (!sel) { host.toast('That outline does not enclose any of the picture yet.'); return; }
    setSel(sel, 'Selection from the outline');
  }
  function toPath(): void {
    const d = doc();
    if (!d) return;
    if (!d.selection) { host.toast('Select something first, then make an outline from it.'); return; }
    const made = selectionToPath(d.selection, S.tol);
    if (!made) { host.toast('Nothing is selected enough to trace.'); return; }
    const before = clonePaths(d.paths), all = (d.paths ??= []), old = all.find((p) => p.work);
    // The earlier work path is kept under its own name, so nothing is lost.
    if (old) { old.work = undefined; delete old.work; old.name = nextName(d); }
    all.push(made);
    picked.set(d, made.id);
    commit(d, before, 'Outline from the selection');
    host.render();
  }
  function edit(label: string, run: (d: Doc) => void): void {
    const d = doc();
    if (!d) return;
    const before = clonePaths(d.paths);
    run(d);
    commit(d, before, label);
    host.render();
  }
  const btn = (text: string, pro: string, help: string, testid: string, run: () => void, off = false): HTMLElement =>
    h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': testid, 'data-help-title': `${text} (${pro})`, 'data-help': help,
      title: `${pro}: ${help}`, 'aria-disabled': off ? 'true' : null, onclick: () => { if (!off) run(); } }, text);

  function fillPanel(body: HTMLElement): void {
    panel = body;
    const d = doc();
    if (body.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return;
    if (!d) { body.replaceChildren(h('p', { class: 'fpe-note' }, 'Open a picture to draw outlines on it.')); return; }
    const all = list(d), cur = active(d);
    const rows = all.map((p) => {
      const cv = h('canvas', { width: 44, height: 32, 'aria-hidden': 'true', style: 'flex:none;border:1px solid var(--line);border-radius:4px;background:var(--panel-2)' });
      const b = pathBounds(p), x = cv.getContext('2d');
      if (b && x) {
        const k = Math.min(38 / Math.max(1, b.w), 26 / Math.max(1, b.h));
        x.translate(22 - (b.x + b.w / 2) * k, 16 - (b.y + b.h / 2) * k); x.scale(k, k);
        x.lineWidth = 1.5 / k; x.strokeStyle = '#5ea0ff'; x.stroke(new Path2D(pathData(p)));
      }
      const name = renaming === p.id
        ? h('input', { type: 'text', value: p.name, 'data-testid': 'path-name-input', 'aria-label': 'Outline name', style: 'flex:1;min-width:0;font-size:13px',
          onkeydown: (ev: Event) => { const e = ev as KeyboardEvent; if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { renaming = null; refresh(); } e.stopPropagation(); },
          onblur: (e: Event) => {
            const v = (e.target as HTMLInputElement).value.trim();
            renaming = null;
            if (v && (v !== p.name || p.work)) edit('Rename the outline', (dd) => { const q = find(dd, p.id); if (q) { q.name = v; delete q.work; } });
            else refresh();
          } })
        : h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.name);
      return h('li', { 'data-testid': 'path-row', 'data-id': p.id, role: 'option', 'aria-selected': String(p === cur), tabindex: 0,
        class: 'fpe-row', style: `gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;${p === cur ? 'background:var(--sel)' : ''}`,
        onclick: () => { if (picked.get(d) !== p.id) { picked.set(d, p.id); refresh(); host.render(); } },
        ondblclick: () => { renaming = p.id; refresh(); },
        onkeydown: (ev: Event) => { const e = ev as KeyboardEvent; if (e.key === 'Enter' || e.key === ' ') { picked.set(d, p.id); refresh(); host.render(); e.preventDefault(); } } },
      cv, name, p.work ? h('span', { class: 'fpe-hint', title: 'The pen draws into this outline. Rename it to keep it as its own outline.' }, 'Work path') : null);
    });
    body.replaceChildren(
      all.length ? h('ul', { role: 'listbox', 'aria-label': 'Outlines', 'data-testid': 'paths-list', style: 'list-style:none;margin:0;padding:0;display:grid;gap:2px' }, ...rows)
        : h('p', { class: 'fpe-note' }, 'No outlines yet. Pick Draw curves (Pen) and click on the picture to start one.'),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' },
        btn('New outline', 'New path', 'Start a new, empty outline and pick the pen to draw it.', 'paths-new', () => {
          edit('New outline', (dd) => { const p: VectorPath = { id: newPathId(), name: nextName(dd), subpaths: [] }; (dd.paths ??= []).push(p); picked.set(dd, p.id); });
          drawing = null; host.setTool('pen');
        }),
        btn('Rename', 'Rename path', 'Give the picked outline a name. A renamed work path is kept as its own outline.', 'paths-rename', () => { if (cur) { renaming = cur.id; refresh(); panel?.querySelector<HTMLInputElement>('[data-testid="path-name-input"]')?.select(); } }, !cur),
        btn('Delete', 'Delete path', 'Remove the picked outline. Undo brings it back.', 'paths-delete', () => {
          if (cur) { edit('Delete the outline', (dd) => { dd.paths = list(dd).filter((p) => p.id !== cur.id); picked.delete(dd); }); drawing = null; }
        }, !cur),
        btn('Make a selection', 'Load path as selection', 'Select the area inside the picked outline.', 'paths-to-selection', fromPath, !all.length),
        btn('Outline from the selection', 'Make work path', 'Trace the edge of the selection as a new outline you can reshape.', 'paths-from-selection', toPath, !d.selection)));
  }
  function refresh(): void { if (panel?.isConnected) fillPanel(panel); }

  function options(bar: HTMLElement, t: ToolId): void {
    const hint = (s: string): HTMLElement => h('span', { class: 'fpe-hint' }, s);
    const d = doc();
    if (t === 'pen') {
      bar.append(hint(drawing ? 'Click to add a corner, drag for a curve. Click the first point to close the outline.' : 'Click on the picture to start an outline: clicks make corners, drags make smooth curves.'),
        h('div', { class: 'fpe-seg', role: 'group', 'aria-label': 'Add and remove points' }, ...([[true, 'On', 'pen-auto-on'], [false, 'Off', 'pen-auto-off']] as const).map(([v, text, id]) =>
          h('button', { type: 'button', 'aria-pressed': String(S.auto === v), 'data-testid': id, 'data-help-title': 'Add and remove points (auto add/delete)',
            'data-help': 'With it on, the pen adds a point when you press on the picked outline\'s line and removes one when you press a point.',
            onclick: () => { S.auto = v; host.refreshOptions(); } }, `Add and remove points: ${text}`))));
      if (drawing) bar.append(h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'pen-done', title: 'Stop drawing and leave the outline open (Esc or Enter).', onclick: stop }, 'Done'));
    } else if (t === 'path-select') bar.append(hint('Press an outline to pick it, then drag to move all of it.'));
    else if (t === 'direct-select') bar.append(hint('Drag a point or one of its handles to reshape the outline. Hold Alt on a handle to move it alone.'));
    else if (t === 'anchor-add') bar.append(hint('Press on an outline\'s line to add a point there; the shape stays the same.'));
    else if (t === 'anchor-delete') bar.append(hint('Press a point to remove it.'));
    else if (t === 'anchor-convert') bar.append(hint('Press a point to switch it between sharp and smooth; drag from it for new handles; drag a handle to move it alone.'));
    if (d && list(d).length) bar.append(btn('Make a selection', 'Load path as selection', 'Select the area inside the picked outline.', 'pen-make-selection', fromPath));
  }
  function key(e: KeyboardEvent): boolean {
    const d = doc();
    if (!d || !PEN_TOOLS.has(host.tool())) return false;
    check(d);
    if (drawing && (e.key === 'Escape' || e.key === 'Enter')) { stop(); return true; }
    if (drawing && e.key === 'Backspace') {
      const p = find(d, drawing.id), s = p?.subpaths[drawing.sub];
      if (p && s) {
        const before = clonePaths(d.paths);
        s.anchors.pop();
        if (!s.anchors.length) { p.subpaths.splice(drawing.sub, 1); drawing = null; }
        commit(d, before, 'Remove a point');
        host.render();
      }
      return true;
    }
    return false;
  }
  function state(): Record<string, unknown> {
    const d = doc(), p = d ? active(d) : null;
    return {
      count: d ? list(d).length : 0, names: d ? list(d).map((x) => x.name) : [], picked: p?.name ?? null, anchors: p ? countAnchors(p) : 0,
      closed: p ? p.subpaths.map((s) => s.closed) : [], drawing: !!drawing,
      points: p ? p.subpaths.flatMap((s) => s.anchors.map((a) => ({ x: a.x, y: a.y, smooth: a.smooth, inX: a.inX, inY: a.inY, outX: a.outX, outY: a.outY }))) : [],
    };
  }

  return {
    start, move, end, cancel, options, overlay, key, fillPanel, refresh, state,
    outline: (d: Doc) => active(d) ?? list(d).find((x) => x.work) ?? list(d)[list(d).length - 1] ?? null,
    cmd(id) {
      if (PATH_OPS.has(id)) {
        return import('./pathops').then((m) => m.runPathOp(id, {
          host, edit, pick: (d, pid) => { picked.set(d, pid); },
          picked: (d) => active(d) ?? list(d).find((x) => x.work) ?? list(d)[list(d).length - 1] ?? null,
        }));
      }
      if (id === 'select.from-path') fromPath(); else if (id === 'select.to-path') toPath();
      return undefined;
    },
    toolChanged(prev, next) { if (prev === 'pen' && next !== 'pen') drawing = null; if (prev !== next) { focus = null; host.render(); } },
  };
}
