// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Pointer and gesture input on the canvas. One finger, a mouse or a pen uses the current tool; two fingers pinch-zoom
 * and pan together; a two-finger tap undoes and a three-finger tap redoes. A first finger waits a moment before it
 * paints, and its stroke is rolled back if a second finger lands soon after, so pinches never leave dabs. Once a pen
 * is in use, fingers only pan (palm rejection).
 */
import type { View } from './renderer';

export interface PointerInfo { type: string; pressure: number; tiltX: number; tiltY: number; shift: boolean; alt: boolean; ctrl?: boolean; }
export interface Pt { x: number; y: number; }
export interface InputHost {
  toDoc(sx: number, sy: number): Pt;
  getView(): View;
  setView(v: View): void;
  pan(dx: number, dy: number): void;
  zoomAt(factor: number, sx: number, sy: number): void;
  toolStart(p: Pt, i: PointerInfo): void;
  toolMove(p: Pt, i: PointerInfo): void;
  toolEnd(p: Pt, i: PointerInfo): void;
  toolCancel(): void;
  hover(sx: number, sy: number, inside: boolean): void;
  gestureUndo(): void;
  gestureRedo(): void;
  contextMenu(clientX: number, clientY: number): void;
  spaceHeld(): boolean;
}
interface Ptr { sx: number; sy: number; x0: number; y0: number; type: string; }
type Mode = 'idle' | 'pending' | 'tool' | 'pan' | 'gesture';
const now = (): number => performance.now();

export class CanvasInput {
  private el: HTMLElement;
  private host: InputHost;
  private ptrs = new Map<number, Ptr>();
  private mode: Mode = 'idle';
  private toolId = -1;
  private toolAt = 0;
  private pend: { id: number; pts: { sx: number; sy: number; i: PointerInfo }[] } | null = null;
  private timer = 0;
  private penAt = -1e9;
  private tap: { at: number; max: number; moved: boolean } | null = null;
  private pinch0: { d: number; dx: number; dy: number; zoom: number } | null = null;
  private gScale = 1;
  private off: (() => void)[] = [];
  /** Turn the view (radians): points are turned back about the canvas centre, so tools see the unturned screen. */
  turn = 0;

  constructor(el: HTMLElement, host: InputHost) {
    this.el = el;
    this.host = host;
    const on = (t: string, f: (e: Event) => void, o?: AddEventListenerOptions): void => {
      el.addEventListener(t, f, o);
      this.off.push(() => el.removeEventListener(t, f, o));
    };
    on('pointerdown', (e) => this.down(e as PointerEvent));
    on('pointermove', (e) => this.move(e as PointerEvent));
    on('pointerup', (e) => this.up(e as PointerEvent));
    on('pointercancel', (e) => this.up(e as PointerEvent));
    on('pointerleave', () => { if (!this.ptrs.size) this.host.hover(0, 0, false); });
    on('wheel', (e) => this.wheel(e as WheelEvent), { passive: false });
    on('contextmenu', (e) => {
      e.preventDefault();
      if (this.mode === 'idle') this.host.contextMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY);
    });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) on(t, (e) => this.gesture(e), { passive: false });
  }
  destroy(): void { clearTimeout(this.timer); for (const f of this.off) f(); this.off = []; }

  private local(e: { clientX: number; clientY: number }): { sx: number; sy: number } {
    const r = this.el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!this.turn) return { sx: x, sy: y };
    const c = Math.cos(this.turn), s = Math.sin(this.turn), dx = x - r.width / 2, dy = y - r.height / 2;
    return { sx: r.width / 2 + c * dx + s * dy, sy: r.height / 2 - s * dx + c * dy };
  }
  private info(e: PointerEvent): PointerInfo {
    const pen = e.pointerType === 'pen';
    return { type: e.pointerType, pressure: pen ? e.pressure || 0.5 : 1, tiltX: pen ? e.tiltX || 0 : 0, tiltY: pen ? e.tiltY || 0 : 0, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }
  private touches(): Ptr[] { return [...this.ptrs.values()].filter((p) => p.type === 'touch'); }
  private startTool(id: number, sx: number, sy: number, i: PointerInfo): void {
    this.mode = 'tool'; this.toolId = id; this.toolAt = now();
    this.host.toolStart(this.host.toDoc(sx, sy), i);
  }
  private commitPending(): void {
    const p = this.pend;
    if (!p || this.mode !== 'pending') return;
    this.pend = null;
    const [first, ...rest] = p.pts;
    this.startTool(p.id, first.sx, first.sy, first.i);
    for (const q of rest) this.host.toolMove(this.host.toDoc(q.sx, q.sy), q.i);
  }
  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button === 2) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const { sx, sy } = this.local(e);
    this.ptrs.set(e.pointerId, { sx, sy, x0: sx, y0: sy, type: e.pointerType });
    if (e.pointerType === 'touch') {
      const n = this.touches().length;
      if (n === 1) this.tap = { at: now(), max: 1, moved: false };
      else if (this.tap) this.tap.max = Math.max(this.tap.max, n);
      if (n === 1) {
        if (this.mode !== 'idle') return;
        if (now() - this.penAt < 5000) { this.mode = 'pan'; return; }
        this.mode = 'pending';
        this.pend = { id: e.pointerId, pts: [{ sx, sy, i: this.info(e) }] };
        this.timer = window.setTimeout(() => this.commitPending(), 90);
        return;
      }
      clearTimeout(this.timer);
      if (this.mode === 'pending') this.pend = null;
      else if (this.mode === 'tool') {
        if (now() - this.toolAt < 600) this.host.toolCancel();
        else { const p = this.ptrs.get(this.toolId); this.host.toolEnd(this.host.toDoc(p?.sx ?? sx, p?.sy ?? sy), this.info(e)); }
      }
      this.mode = 'gesture';
      this.startPinch();
      return;
    }
    if (e.pointerType === 'pen') this.penAt = now();
    if (this.mode !== 'idle') return;
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.host.spaceHeld()))) { this.mode = 'pan'; return; }
    this.startTool(e.pointerId, sx, sy, this.info(e));
  }
  private move(e: PointerEvent): void {
    const ptr = this.ptrs.get(e.pointerId);
    const { sx, sy } = this.local(e);
    if (!ptr) { if (e.pointerType !== 'touch') this.host.hover(sx, sy, true); return; }
    const dx = sx - ptr.sx, dy = sy - ptr.sy;
    ptr.sx = sx; ptr.sy = sy;
    if (this.tap && Math.hypot(sx - ptr.x0, sy - ptr.y0) > 10) this.tap.moved = true;
    if (e.pointerType === 'pen') this.penAt = now();
    if (this.mode === 'pending' && this.pend && e.pointerId === this.pend.id) {
      this.pend.pts.push({ sx, sy, i: this.info(e) });
      if (Math.hypot(sx - ptr.x0, sy - ptr.y0) > 8) { clearTimeout(this.timer); this.commitPending(); }
    } else if (this.mode === 'tool' && e.pointerId === this.toolId) {
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of list.length ? list : [e]) { const l = this.local(ce); this.host.toolMove(this.host.toDoc(l.sx, l.sy), this.info(ce)); }
      if (e.pointerType !== 'touch') this.host.hover(sx, sy, true);
    } else if (this.mode === 'pan') this.host.pan(dx, dy);
    else if (this.mode === 'gesture') this.updatePinch();
  }
  private up(e: PointerEvent): void {
    const ptr = this.ptrs.get(e.pointerId);
    if (!ptr) return;
    this.ptrs.delete(e.pointerId);
    const { sx, sy } = this.local(e);
    const cancel = e.type === 'pointercancel';
    if (this.mode === 'pending' && this.pend && this.pend.id === e.pointerId) {
      clearTimeout(this.timer);
      if (!cancel) { this.commitPending(); this.host.toolEnd(this.host.toDoc(sx, sy), this.info(e)); }
      this.pend = null;
      this.mode = 'idle';
    } else if (this.mode === 'tool' && e.pointerId === this.toolId) {
      if (cancel) this.host.toolCancel(); else this.host.toolEnd(this.host.toDoc(sx, sy), this.info(e));
      this.mode = 'idle';
      this.toolId = -1;
    } else if (this.mode === 'gesture') {
      if (this.touches().length >= 2) this.startPinch(); else this.pinch0 = null;
    }
    if (e.pointerType === 'touch' && !this.touches().length && this.tap) {
      const t = this.tap;
      this.tap = null;
      if (!t.moved && now() - t.at < 400) { if (t.max === 2) this.host.gestureUndo(); else if (t.max === 3) this.host.gestureRedo(); }
    }
    if (!this.ptrs.size) this.mode = 'idle';
  }
  private startPinch(): void {
    const [a, b] = this.touches();
    if (!a || !b) return;
    const v = this.host.getView();
    const cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
    this.pinch0 = { d: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), dx: (cx - v.panX) / v.zoom, dy: (cy - v.panY) / v.zoom, zoom: v.zoom };
  }
  private updatePinch(): void {
    const p = this.pinch0, [a, b] = this.touches();
    if (!p || !a || !b) return;
    const z = (p.zoom * Math.hypot(a.sx - b.sx, a.sy - b.sy)) / p.d;
    const cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
    this.host.setView({ zoom: z, panX: cx - p.dx * z, panY: cy - p.dy * z });
  }
  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { sx, sy } = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const notch = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 50 && Number.isInteger(dy));
    if (e.ctrlKey || e.metaKey || notch) this.host.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
    else { const c = Math.cos(this.turn), s = Math.sin(this.turn); this.host.pan(-(c * dx + s * dy), -(c * dy - s * dx)); }
  }
  private gesture(e: Event): void {
    e.preventDefault();
    const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
    if (e.type === 'gesturestart') { this.gScale = 1; return; }
    if (e.type !== 'gesturechange' || !g.scale) return;
    const { sx, sy } = this.local({ clientX: g.clientX ?? 0, clientY: g.clientY ?? 0 });
    this.host.zoomAt(g.scale / this.gScale, sx, sy);
    this.gScale = g.scale;
  }
}
