// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Tiny DOM helpers. No UI framework. */
type Val = string | number | boolean | null | undefined | ((e: Event) => void);
export type Attrs = Record<string, Val>;
type Kid = Node | string | null | undefined | false;
const SVGNS = 'http://www.w3.org/2000/svg';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c);
  return el;
}
export function icon(name: string, cls = 'fpe-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', '#fpe-i-' + name);
  svg.append(use);
  return svg;
}
export function iconButton(name: string, label: string, attrs: Attrs = {}, text?: string): HTMLButtonElement {
  return h('button', { type: 'button', class: 'fpe-btn fpe-icon-btn', 'aria-label': label, title: label, ...attrs },
    icon(name), text ? h('span', { class: 'fpe-btn-text' }, text) : null);
}
export function fmtBytes(n: number): string {
  if (n < 1024) return n + ' bytes';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
export const errText = (e: unknown, fallback = 'Something went wrong.'): string =>
  e instanceof Error && e.message ? e.message : typeof e === 'string' && e ? e : fallback;
/**
 * Focus a control inside a sheet and scroll only that sheet's body to show it. A plain focus() or scrollIntoView()
 * also scrolls the editor behind it: on a phone the sheet is still sliding up when the cursor lands, and the whole
 * editor once moved up about 180 px, cutting off the sheet's title.
 */
export function focusInSheet(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const body = el.closest<HTMLElement>('.fpe-sheet-body');
  if (body) {
    const b = body.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = 8;
    if (r.top < b.top + pad) body.scrollTop -= b.top + pad - r.top;
    else if (r.bottom > b.bottom - pad) body.scrollTop += Math.min(r.bottom - b.bottom + pad, r.top - b.top - pad);
  }
  el.focus({ preventScroll: true });
}
