// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Lucide icons (ISC licence; some derived from Feather, MIT) built into one inline SVG sprite. Only these are bundled. */
import { ArrowDown, ArrowUp, Brush, Check, Code, Copy, Crop, Download, Eraser, Eye, EyeOff, FilePlus, FolderOpen, Image,
  ImagePlus, Info, Keyboard, Layers, Maximize, Menu, Moon, Move, Pipette, Plus, Redo2, SlidersHorizontal, SquareDashed,
  Sun, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide';

type IconNode = ReadonlyArray<readonly [string, Record<string, string | number | undefined>]>;
const ICONS: Record<string, unknown> = {
  'arrow-down': ArrowDown, 'arrow-up': ArrowUp, brush: Brush, check: Check, code: Code, copy: Copy, crop: Crop,
  download: Download, eraser: Eraser, eye: Eye, 'eye-off': EyeOff, 'file-plus': FilePlus, open: FolderOpen, image: Image,
  'image-plus': ImagePlus, info: Info, keyboard: Keyboard, layers: Layers, fit: Maximize, menu: Menu, moon: Moon, move: Move,
  pipette: Pipette, plus: Plus, redo: Redo2, sliders: SlidersHorizontal, select: SquareDashed, sun: Sun, trash: Trash2,
  undo: Undo2, close: X, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
};
const SVGNS = 'http://www.w3.org/2000/svg';
export function ensureSprite(doc: Document): void {
  if (doc.getElementById('fpe-sprite')) return;
  const svg = doc.createElementNS(SVGNS, 'svg');
  svg.id = 'fpe-sprite';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  for (const [name, node] of Object.entries(ICONS)) {
    const sym = doc.createElementNS(SVGNS, 'symbol');
    sym.id = 'fpe-i-' + name;
    sym.setAttribute('viewBox', '0 0 24 24');
    for (const [tag, attrs] of node as IconNode) {
      const el = doc.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) if (v != null && k !== 'key') el.setAttribute(k, String(v));
      sym.append(el);
    }
    svg.append(sym);
  }
  doc.body.append(svg);
}
