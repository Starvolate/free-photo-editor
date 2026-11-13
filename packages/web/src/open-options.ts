// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The two open steps that ask first: which PDF page (and how sharp), and the camera RAW develop step. Loaded only when needed. */
import type { Bitmap } from '@free-photoeditor/core';
import { h } from './dom';
import { toImageData, type OpenUi } from './io';

let seq = 0;
export async function openPdfPage(bytes: Uint8Array, ui: OpenUi): Promise<Bitmap | null> {
  const { openPdf } = await import('@free-photoeditor/formats/pdf');
  const pdf = await openPdf(bytes);
  try {
    const id = `fpe-pdf-${++seq}`;
    const pageIn = h('input', { id: id + 'p', type: 'number', min: 1, max: pdf.pages, value: 1, inputmode: 'numeric', 'data-testid': 'pdf-page' });
    const sharp = h('select', { id: id + 's', 'data-testid': 'pdf-dpi' },
      ...([['72', 'Screen · 72 dots per inch'], ['150', 'Good · 150 dots per inch'], ['300', 'Print · 300 dots per inch'], ['600', 'Very sharp · 600 dots per inch']] as const)
        .map(([v, t]) => h('option', { value: v }, t)));
    sharp.value = '150';
    const size = h('p', { class: 'fpe-kept', 'data-testid': 'pdf-size', 'aria-live': 'polite' });
    const page = (): number => Math.min(pdf.pages, Math.max(1, Math.round(Number(pageIn.value) || 1)));
    const update = async (): Promise<void> => {
      const s = await pdf.pageSize(page()), k = Number(sharp.value) / 72;
      size.textContent = `Page ${page()} opens as a picture of ${Math.ceil(s.width * k)} × ${Math.ceil(s.height * k)} pixels.`;
    };
    pageIn.addEventListener('input', () => void update());
    sharp.addEventListener('change', () => void update());
    await update();
    const body = h('div', { class: 'fpe-stack', 'data-testid': 'pdf-picker' },
      h('p', {}, pdf.pages === 1 ? 'This PDF has 1 page. It opens as a picture you can edit.' : `This PDF has ${pdf.pages} pages. Pick the page to open as a picture you can edit.`),
      h('div', { class: 'fpe-row', 'data-help-title': 'Page', 'data-help': 'Which page of the document to open.' }, h('label', { for: id + 'p' }, `Page (1 to ${pdf.pages})`), pageIn),
      h('div', { class: 'fpe-row', 'data-help-title': 'Sharpness', 'data-help': 'More dots per inch make a bigger, sharper picture.' }, h('label', { for: id + 's' }, 'Sharpness · Resolution'), sharp),
      size);
    if (!(await ui.choose('Open a PDF page', body, 'Open page'))) return null;
    return await pdf.render(page(), Number(sharp.value) || 150);
  } finally { pdf.close(); }
}
export async function developRaw(bytes: Uint8Array, ui: OpenUi): Promise<Bitmap | null> {
  const raw = await import('@free-photoeditor/formats/raw');
  const img = await raw.decodeRaw(bytes), s = { ...raw.NO_DEVELOP }, id = `fpe-raw-${++seq}`;
  const canvas = h('canvas', { 'data-testid': 'raw-preview', role: 'img', 'aria-label': 'Preview of the developed photo' });
  canvas.style.cssText = 'display:block;max-width:100%;height:auto;border-radius:6px';
  let frame = 0;
  const preview = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { const p = raw.develop(img, s, 480); canvas.width = p.width; canvas.height = p.height; canvas.getContext('2d')?.putImageData(toImageData(p), 0, 0); });
  };
  const slider = (key: 'exposure' | 'warmth' | 'tint', label: string, help: string, min: number, max: number, step: number, show: (v: number) => string): HTMLElement => {
    const input = h('input', { id: id + key, type: 'range', min, max, step, value: 0, 'data-testid': 'raw-' + key });
    const out = h('output', { class: 'fpe-out', for: id + key }, show(0));
    input.addEventListener('input', () => { s[key] = Number(input.value); out.textContent = show(s[key]); preview(); });
    return h('div', { class: 'fpe-row', 'data-help-title': label, 'data-help': help }, h('label', { for: id + key }, label), input, out);
  };
  const body = h('div', { class: 'fpe-stack', 'data-testid': 'raw-develop' },
    h('p', {}, `Your camera saved its raw light readings (${img.width} × ${img.height} pixels). Set the brightness and colour, then open it as a photo you can edit.`),
    canvas,
    slider('exposure', 'Brightness · Exposure', 'Brighter or darker, in camera stops: +1 lets in twice the light.', -3, 3, 0.1, (v) => (v > 0 ? '+' : '') + v.toFixed(1)),
    slider('warmth', 'Warm or cool · White balance', 'Right for warmer (more yellow), left for cooler (more blue).', -100, 100, 1, (v) => String(v)),
    slider('tint', 'Green or pink · Tint', 'Right for pinker, left for greener.', -100, 100, 1, (v) => String(v)));
  preview();
  if (!(await ui.choose('Develop the photo', body, 'Open photo'))) return null;
  return raw.develop(img, s);
}
