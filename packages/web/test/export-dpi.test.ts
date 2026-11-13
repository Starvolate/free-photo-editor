// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Export's Print quality section: which types keep a DPI, the print size in words, resizing to a print size on a copy. */
import { describe, expect, it } from 'vitest';
import { createDocument, docDpi, setDocDpi } from '@free-photoeditor/core';
import { bestText, dpiNote, holdsDpi, joinCommands, printCopy, printText, resizeTarget } from '../src/export-dpi';

describe('Export at a chosen DPI', () => {
  it('knows which types store a DPI and says so plainly for the rest', () => {
    for (const f of ['png', 'jpeg', 'webp', 'psd', 'tiff', 'pdf', 'bmp', 'avif', 'jxl']) expect([f, holdsDpi(f), dpiNote(f, f)]).toEqual([f, true, null]);
    for (const f of ['gif', 'ico', 'tga', 'svg', 'ora']) {
      expect(holdsDpi(f), f).toBe(false);
      expect(dpiNote(f, f.toUpperCase())).toContain('no place to store a DPI');
    }
    expect(holdsDpi('png', true)).toBe(false);
    expect(dpiNote('webp', 'WebP', true)).toContain("don't keep a DPI yet");
    expect(holdsDpi('tiff', true)).toBe(true);
  });
  it('gives the print size in cm and inches', () => {
    expect(printText(600, 400, 300)).toBe('5.08 × 3.39 cm (2 × 1.33 in)');
    expect(printText(3000, 2000, 500)).toBe('15.24 × 10.16 cm (6 × 4 in)');
  });
  it('resizes to a print size from the side the person typed, or from both', () => {
    const cur = { width: 600, height: 400 };
    expect(resizeTarget(10, 99, 'cm', 300, cur, 'w')).toEqual({ width: 1181, height: 787 });
    expect(resizeTarget(99, 4, 'in', 500, cur, 'h')).toEqual({ width: 3000, height: 2000 });
    expect(resizeTarget(10, 15, 'cm', 300, cur, null)).toEqual({ width: 1181, height: 1772 });
  });
  it('resamples a copy for the export and leaves the picture alone', () => {
    const d = createDocument(60, 40, { r: 10, g: 20, b: 30, a: 255 });
    d.dpi = 300;
    const layer = d.layers[0];
    const c = printCopy(d, 120, 80, 'smooth');
    expect([c.width, c.height, c.dpi, c.layers[0].width]).toEqual([120, 80, 300, 120]);
    expect([d.width, d.height, d.layers[0] === layer, layer.width]).toEqual([60, 40, true, 60]);
  });
  it('joins new pixels and a new DPI into one undo step', () => {
    const d = createDocument(10, 10);
    const both = joinCommands(null, setDocDpi(d, 300));
    expect(docDpi(d)).toBe(300);
    both?.undo(d);
    expect(docDpi(d)).toBe(72);
    expect(joinCommands(null, null)).toBeNull();
  });
  it('names what Best quality does for each kind of type', () => {
    expect(bestText('jpeg', 'JPEG', true)).toContain('4:4:4');
    expect(bestText('webp', 'WebP', true)).toContain('lossless');
    expect(bestText('png', 'PNG', false)).toContain('every pixel');
    expect(bestText('gif', 'GIF', false)).toContain('no quality setting');
  });
});
