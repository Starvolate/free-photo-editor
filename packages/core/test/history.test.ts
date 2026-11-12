// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { describe, expect, it } from 'vitest';
import { History, Stroke, activeLayer, addEmptyLayer, addLayer, clearSelection, createDocument, createLayer, cropDocument,
  deleteLayer, duplicateActive, moveLayer, setLayerProps, type BrushOptions, type Doc } from '../src/index';

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BRUSH: BrushOptions = { size: 6, hardness: 1, opacity: 1, color: RED, erase: false };
function paint(doc: Doc, pts: [number, number][], o: BrushOptions = BRUSH) {
  const s = new Stroke(doc, activeLayer(doc)!, o);
  for (const [x, y] of pts) s.add({ x, y });
  return s.end();
}
const snap = (d: Doc): string => [d.width, d.height, d.activeId, ...d.layers.map((l) =>
  [l.id, l.name, l.visible, l.opacity, l.blendMode, l.x, l.y, l.width, l.height, l.data.join(',')].join('|'))].join('/');

describe('history', () => {
  it('undoes and redoes a brush stroke exactly', () => {
    const doc = createDocument(40, 30), h = new History(), s0 = snap(doc);
    h.push(paint(doc, [[5, 5], [30, 20]]));
    const s1 = snap(doc);
    expect(s1).not.toBe(s0);
    h.undo(doc); expect(snap(doc)).toBe(s0);
    h.redo(doc); expect(snap(doc)).toBe(s1);
  });
  it('keeps at least 30 steps of undo and redo', () => {
    const doc = createDocument(40, 30), h = new History(), states = [snap(doc)];
    for (let i = 0; i < 35; i++) {
      h.push(paint(doc, [[i, i % 30], [i + 3, (i * 7) % 30]], { ...BRUSH, color: { r: i * 7, g: 255 - i * 7, b: 100, a: 255 } }));
      states.push(snap(doc));
    }
    expect(h.length).toBe(35);
    for (let i = 35; i > 0; i--) { h.undo(doc); expect(snap(doc)).toBe(states[i - 1]); }
    expect(h.canUndo).toBe(false);
    for (let i = 1; i <= 35; i++) { h.redo(doc); expect(snap(doc)).toBe(states[i]); }
  });
  it('drops the redo steps after a new edit', () => {
    const doc = createDocument(20, 20), h = new History();
    h.push(paint(doc, [[3, 3]])); h.undo(doc);
    expect(h.canRedo).toBe(true);
    h.push(paint(doc, [[10, 10]]));
    expect(h.canRedo).toBe(false);
  });
  it('undoes layer add, duplicate, property changes, reorder and delete', () => {
    const doc = createDocument(10, 10), h = new History(), s0 = snap(doc);
    h.push(addEmptyLayer(doc)); h.push(duplicateActive(doc));
    expect(doc.layers.length).toBe(3);
    h.push(setLayerProps(doc, doc.activeId, { opacity: 0.5, blendMode: 'multiply', name: 'Shade', visible: false }));
    h.push(moveLayer(doc, 2, 0)); h.push(deleteLayer(doc, doc.layers[1].id));
    const s1 = snap(doc);
    expect(doc.layers.length).toBe(2);
    while (h.canUndo) h.undo(doc);
    expect(snap(doc)).toBe(s0);
    while (h.canRedo) h.redo(doc);
    expect(snap(doc)).toBe(s1);
  });
  it('a stroke grows a small layer, and undo restores its size', () => {
    const doc = createDocument(20, 20), h = new History();
    addLayer(doc, createLayer('small', 4, 4, { x: 2, y: 2 }));
    const s0 = snap(doc);
    h.push(paint(doc, [[15, 15]]));
    expect(activeLayer(doc)!.width).toBe(20);
    h.undo(doc); expect(snap(doc)).toBe(s0);
  });
  it('a cancelled stroke leaves no trace', () => {
    const doc = createDocument(20, 20), s0 = snap(doc);
    const s = new Stroke(doc, activeLayer(doc)!, BRUSH);
    s.add({ x: 4, y: 4 }); s.add({ x: 15, y: 9 });
    expect(snap(doc)).not.toBe(s0);
    s.cancel();
    expect(snap(doc)).toBe(s0);
  });
  it('a selection limits painting and deleting', () => {
    const doc = createDocument(20, 20), L = doc.layers[0], h = new History();
    doc.selection = { x: 5, y: 5, w: 5, h: 5 };
    h.push(paint(doc, [[0, 7], [19, 7]]));
    const g = (x: number, y: number): number => L.data[(y * 20 + x) * 4 + 1];
    expect(g(2, 7)).toBe(255); expect(g(7, 7)).toBe(0); expect(g(12, 7)).toBe(255);
    h.push(clearSelection(doc, L));
    const a = (x: number, y: number): number => L.data[(y * 20 + x) * 4 + 3];
    expect(a(7, 7)).toBe(0); expect(a(2, 7)).toBe(255);
    h.undo(doc); expect(a(7, 7)).toBe(255);
  });
  it('crop trims every layer and undo brings the pixels back', () => {
    const doc = createDocument(20, 10), h = new History();
    h.push(paint(doc, [[2, 2], [18, 8]]));
    const s0 = snap(doc);
    h.push(cropDocument(doc, { x: 5, y: 2, w: 8, h: 6 }));
    expect([doc.width, doc.height, doc.layers[0].width, doc.layers[0].height]).toEqual([8, 6, 8, 6]);
    h.undo(doc); expect(snap(doc)).toBe(s0);
  });
});
