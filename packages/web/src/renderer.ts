// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Display only. The editor draws through the Renderer interface, so a WebGL or WebGPU renderer can replace this
 * Canvas 2D one later. The composite lives in 1024 px tiles (with a 1 px overlap so no seams show when zoomed out),
 * which keeps updates small and stays under mobile canvas size limits.
 */
import type { Rect } from '@free-photoeditor/core';

export interface View { zoom: number; panX: number; panY: number; }
export interface Overlay { selection: Rect | null; crop: Rect | null; cursor: { x: number; y: number; r: number } | null; ants: number; }
export interface Colors { stage: string; checkA: string; checkB: string; edge: string; }
export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  setColors(c: Colors): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  setDocumentSize(width: number, height: number): void;
  /** Composite pixels for a document rectangle. */
  upload(r: Rect, rgba: Uint8ClampedArray): void;
  render(view: View, overlay: Overlay): void;
  dispose(): void;
}
const TILE = 1024;
interface Tile { x: number; y: number; w: number; h: number; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; }

export class Canvas2DRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tiles: Tile[] = [];
  private docW = 0;
  private docH = 0;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private colors: Colors = { stage: '#0b0c0e', checkA: '#2a2b30', checkB: '#202126', edge: 'rgba(255,255,255,.18)' };
  private pattern: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot draw on a canvas.');
    this.ctx = ctx;
  }
  setColors(c: Colors): void { this.colors = c; this.pattern = null; }
  resize(w: number, h: number, dpr: number): void {
    this.cssW = Math.max(1, w); this.cssH = Math.max(1, h); this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }
  setDocumentSize(w: number, h: number): void {
    for (const t of this.tiles) { t.canvas.width = 0; t.canvas.height = 0; }
    this.tiles = [];
    this.docW = w; this.docH = h;
    for (let y = 0; y < h; y += TILE) for (let x = 0; x < w; x += TILE) {
      const tw = Math.min(TILE + 1, w - x), th = Math.min(TILE + 1, h - y);
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('This browser cannot draw on a canvas.');
      this.tiles.push({ x, y, w: tw, h: th, canvas: c, ctx });
    }
  }
  upload(r: Rect, rgba: Uint8ClampedArray): void {
    for (const t of this.tiles) {
      const x0 = Math.max(r.x, t.x), y0 = Math.max(r.y, t.y), x1 = Math.min(r.x + r.w, t.x + t.w), y1 = Math.min(r.y + r.h, t.y + t.h);
      if (x0 >= x1 || y0 >= y1) continue;
      const w = x1 - x0, hh = y1 - y0;
      const img = t.ctx.createImageData(w, hh);
      for (let y = 0; y < hh; y++) {
        const s = ((y0 - r.y + y) * r.w + (x0 - r.x)) * 4;
        img.data.set(rgba.subarray(s, s + w * 4), y * w * 4);
      }
      t.ctx.putImageData(img, x0 - t.x, y0 - t.y);
    }
  }
  private checker(): CanvasPattern | string {
    if (this.pattern) return this.pattern;
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    if (!x) return this.colors.checkA;
    x.fillStyle = this.colors.checkA; x.fillRect(0, 0, 16, 16);
    x.fillStyle = this.colors.checkB; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    this.pattern = this.ctx.createPattern(c, 'repeat');
    return this.pattern ?? this.colors.checkA;
  }
  render(view: View, ov: Overlay): void {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.colors.stage;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (!this.docW) return;
    const z = view.zoom, px = view.panX, py = view.panY, dw = this.docW * z, dh = this.docH * z;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.checker();
    ctx.fillRect(px, py, dw, dh);
    ctx.save();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * px, dpr * py);
    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = 'high';
    for (const t of this.tiles) {
      const sx = px + t.x * z, sy = py + t.y * z;
      if (sx > this.cssW || sy > this.cssH || sx + t.w * z < 0 || sy + t.h * z < 0) continue;
      ctx.drawImage(t.canvas, t.x, t.y);
    }
    ctx.restore();
    ctx.strokeStyle = this.colors.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(px) - 0.5, Math.round(py) - 0.5, Math.round(dw) + 1, Math.round(dh) + 1);
    if (ov.crop) this.drawCrop(view, ov.crop);
    if (ov.selection) this.drawAnts(view, ov.selection, ov.ants);
    if (ov.cursor) {
      ctx.beginPath();
      ctx.arc(ov.cursor.x, ov.cursor.y, Math.max(2, ov.cursor.r), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.25; ctx.stroke();
    }
  }
  private screen(view: View, r: Rect): Rect {
    return { x: Math.round(view.panX + r.x * view.zoom), y: Math.round(view.panY + r.y * view.zoom), w: Math.round(r.w * view.zoom), h: Math.round(r.h * view.zoom) };
  }
  private drawAnts(view: View, r: Rect, offset: number): void {
    const s = this.screen(view, r), ctx = this.ctx;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -offset;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    ctx.lineDashOffset = -offset + 5;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    ctx.setLineDash([]);
  }
  private drawCrop(view: View, r: Rect): void {
    const s = this.screen(view, r), ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.rect(0, 0, this.cssW, this.cssH);
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(s.x + (s.w * i) / 3, s.y); ctx.lineTo(s.x + (s.w * i) / 3, s.y + s.h);
      ctx.moveTo(s.x, s.y + (s.h * i) / 3); ctx.lineTo(s.x + s.w, s.y + (s.h * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  }
  dispose(): void { for (const t of this.tiles) { t.canvas.width = 0; t.canvas.height = 0; } this.tiles = []; }
}
