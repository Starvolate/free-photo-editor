// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/// <reference path="./ambient.d.ts" />
/**
 * PDF. Saving is written for Free Photo Editor: each page holds the picture exactly (Flate, with a soft mask for
 * see-through), with the credit as Producer and Creator and in XMP; the page size follows the print resolution (DPI). Opening draws a page with pdf.js (Apache-2.0),
 * loaded only when a PDF is first opened; the app asks which page and how sharp.
 */
import { zlibSync } from 'fflate';
import { CREDIT, buildXmp, concatBytes, latin1Encode, utf8Encode, type Bitmap, type FormatCodec } from '@free-photoeditor/core';
import { docOf, framesOf, isOpaque } from './util';

const pdfText = (s: string): string => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
export function encodePdf(pages: Bitmap[], credit: string = CREDIT, dpi = 72): Uint8Array {
  const objs: Uint8Array[] = [];
  const add = (body: Uint8Array | string): number => { objs.push(typeof body === 'string' ? latin1Encode(body) : body); return objs.length; };
  const stream = (dict: string, data: Uint8Array): Uint8Array => concatBytes(latin1Encode(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, latin1Encode('\nendstream'));
  const catalog = add(''), pagesId = add(''), meta = add(stream('/Type /Metadata /Subtype /XML', utf8Encode(buildXmp(credit, dpi)))), kids: number[] = [], k = 72 / dpi;
  for (const bmp of pages) {
    const { width: w, height: h, data } = bmp, rgb = new Uint8Array(w * h * 3), a = isOpaque(data) ? null : new Uint8Array(w * h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) { rgb[i * 3] = data[j]; rgb[i * 3 + 1] = data[j + 1]; rgb[i * 3 + 2] = data[j + 2]; if (a) a[i] = data[j + 3]; }
    const smask = a ? add(stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlibSync(a))) : 0;
    const img = add(stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''}`, zlibSync(rgb)));
    const pw = Math.round(w * k * 100) / 100, ph = Math.round(h * k * 100) / 100;
    const content = add(stream('', latin1Encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`)));
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = latin1Encode(`<< /Type /Catalog /Pages ${pagesId} 0 R /Metadata ${meta} 0 R >>`);
  objs[pagesId - 1] = latin1Encode(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const date = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const info = add(`<< /Producer ${pdfText(credit)} /Creator ${pdfText(credit)} /CreationDate (D:${date}Z) >>`);
  const head = latin1Encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'), parts: Uint8Array[] = [head], offsets: number[] = [];
  let size = head.length;
  objs.forEach((body, i) => { offsets.push(size); const p = concatBytes(latin1Encode(`${i + 1} 0 obj\n`), body, latin1Encode('\nendobj\n')); parts.push(p); size += p.length; });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(latin1Encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return concatBytes(...parts);
}
export interface PdfHandle { pages: number; pageSize(n: number): Promise<{ width: number; height: number }>; render(n: number, dpi: number): Promise<Bitmap>; close(): void; }
/** Open a PDF with pdf.js on the page's own thread (no worker file to fetch). Needs a browser canvas to draw. */
export async function openPdf(bytes: Uint8Array): Promise<PdfHandle> {
  const g = globalThis as { pdfjsWorker?: unknown };
  const pdfjs = await import('pdfjs-dist');
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  return {
    pages: doc.numPages,
    async pageSize(n) { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); return { width: v.width, height: v.height }; },
    async render(n, dpi) {
      const page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 });
      let scale = dpi / 72;
      if (v1.width * v1.height * scale * scale > 40e6) scale = Math.sqrt(40e6 / (v1.width * v1.height));
      const vp = page.getViewport({ scale }), w = Math.max(1, Math.ceil(vp.width)), h = Math.max(1, Math.ceil(vp.height));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('This browser cannot draw on a canvas.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
      const data = ctx.getImageData(0, 0, w, h).data;
      canvas.width = 0; canvas.height = 0;
      page.cleanup();
      return { width: w, height: h, data };
    },
    close() { void task.destroy(); },
  };
}
export const codec: FormatCodec = {
  async decode(bytes) {
    const pdf = await openPdf(bytes);
    try {
      const bmp = await pdf.render(1, 150);
      return { doc: docOf(bmp.width, bmp.height, [{ name: 'Page 1', bmp }]), notes: pdf.pages > 1 ? [`Page 1 of ${pdf.pages} was opened.`] : [] };
    } finally { pdf.close(); }
  },
  encode: async (doc, o) => encodePdf(framesOf(doc, o.multi, o.delay).map((f) => f.bmp), CREDIT, o.dpi ?? 72),
};
