// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * SVG save, written for Free Photo Editor: one group per layer (hidden ones kept, hidden). Text and shape layers become
 * real SVG text and shapes; painted layers are kept as PNG pictures inside. The credit sits in the file's metadata.
 */
import { CREDIT, arrowHead, currentContent, shapePoints, utf8Encode, xmlEscape, type Doc, type FormatCodec, type LayerContent } from '@free-photoeditor/core';
import { encodePng } from './png';
import { base64 } from './util';

const CSS_BLEND = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const n = (v: number): string => String(Math.round(v * 100) / 100);
const pts = (p: { x: number; y: number }[]): string => p.map((q) => `${n(q.x)},${n(q.y)}`).join(' ');
function vector(c: LayerContent): string {
  if (c.kind === 'text') {
    const st = c.style, anchor = st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start';
    const lines = c.text.split('\n').map((t, i) => `<tspan x="${n(c.x)}" y="${n(c.y + i * st.size * st.lineHeight)}">${xmlEscape(t)}</tspan>`).join('');
    return `<text xml:space="preserve" font-family="${xmlEscape(st.font)}" font-size="${n(st.size)}" font-weight="${st.bold ? 700 : 400}" font-style="${st.italic ? 'italic' : 'normal'}" fill="${xmlEscape(st.color)}" text-anchor="${anchor}" dominant-baseline="text-before-edge"${st.letterSpacing ? ` letter-spacing="${n(st.letterSpacing)}"` : ''}>${lines}</text>`;
  }
  const paint = `fill="${c.fill ? xmlEscape(c.fill) : 'none'}" stroke="${c.stroke ? xmlEscape(c.stroke) : 'none'}" stroke-width="${n(c.strokeWidth)}"`;
  const x = Math.min(c.x0, c.x1), y = Math.min(c.y0, c.y1), w = Math.abs(c.x1 - c.x0), h = Math.abs(c.y1 - c.y0);
  if (c.shape === 'rect' || c.shape === 'rounded') return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${c.shape === 'rounded' ? ` rx="${n(c.radius)}"` : ''} ${paint}/>`;
  if (c.shape === 'ellipse') return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${paint}/>`;
  if (c.shape === 'line') {
    const col = xmlEscape(c.stroke ?? c.fill ?? '#000000'), head = arrowHead(c);
    return `<line x1="${n(c.x0)}" y1="${n(c.y0)}" x2="${n(c.x1)}" y2="${n(c.y1)}" stroke="${col}" stroke-width="${n(c.strokeWidth)}" stroke-linecap="round"/>` + (head ? `<polygon points="${pts(head)}" fill="${col}"/>` : '');
  }
  return `<polygon points="${pts(shapePoints(c))}" ${paint}/>`;
}
export function encodeSvg(doc: Doc, credit: string = CREDIT): Uint8Array {
  const W = doc.width, H = doc.height, out = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><rdf:Description rdf:about="" xmp:CreatorTool="${xmlEscape(credit)}"/></rdf:RDF></metadata>`,
    `<desc>Made with ${xmlEscape(credit)}</desc>`];
  doc.layers.forEach((l, i) => {
    const a = [`id="layer-${i + 1}"`, `data-name="${xmlEscape(l.name)}"`];
    if (!l.visible) a.push('display="none"');
    if (l.opacity < 1) a.push(`opacity="${n(l.opacity)}"`);
    if (CSS_BLEND.has(l.blendMode)) a.push(`style="mix-blend-mode:${l.blendMode}"`);
    const c = currentContent(l);
    out.push(`<g ${a.join(' ')}>${c ? vector(c) : `<image x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" href="data:image/png;base64,${base64(encodePng({ width: l.width, height: l.height, data: l.data }, credit))}"/>`}</g>`);
  });
  out.push('</svg>');
  return utf8Encode(out.join('\n'));
}
export const codec: FormatCodec = { encode: async (doc) => encodeSvg(doc) };
