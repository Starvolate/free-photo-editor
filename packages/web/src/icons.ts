// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Lucide icons (ISC licence; some derived from Feather, MIT) built into one inline SVG sprite. Only these are bundled. */
import { ArrowDown, ArrowLeftRight, ArrowUp, Bandage, Brush, Check, ChevronDown, ChevronLeft, ChevronRight, Code, Contrast, Copy, Crop,
  Download, Droplet, Eraser, Eye, EyeOff, FilePlus, Focus, FolderOpen, Hand, Image as ImageIcon, ImageDown, ImagePlus, Info, Keyboard,
  Lasso, Layers, Lock, Maximize, Menu, Merge, Moon, MousePointer2, Move, PaintBucket, Palette, PenTool, Pipette, Plus, Redo2, RotateCcw,
  Scan, Scissors, Search, Shapes, SlidersHorizontal, Sparkles, Square, SquareDashed, Stamp, Sun, SunDim, Trash2, Type, Undo2, Wand, X,
  ZoomIn, ZoomOut } from 'lucide';

type IconNode = ReadonlyArray<readonly [string, Record<string, string | number | undefined>]>;
const ICONS: Record<string, unknown> = {
  'arrow-down': ArrowDown, 'arrow-up': ArrowUp, bandage: Bandage, brush: Brush, bucket: PaintBucket, check: Check,
  'chev-down': ChevronDown, 'chev-left': ChevronLeft, 'chev-right': ChevronRight, close: X, code: Code, contrast: Contrast, copy: Copy,
  crop: Crop, dodge: SunDim, download: Download, droplet: Droplet, eraser: Eraser, eye: Eye, 'eye-off': EyeOff, 'file-plus': FilePlus,
  fit: Maximize, focus: Focus, hand: Hand, history: RotateCcw, image: ImageIcon, 'image-down': ImageDown, 'image-plus': ImagePlus,
  info: Info, keyboard: Keyboard, lasso: Lasso, layers: Layers, link: Link, unlink: Unlink, lock: Lock, menu: Menu, merge: Merge, moon: Moon, move: Move,
  open: FolderOpen, palette: Palette, pen: PenTool, pipette: Pipette, plus: Plus, pointer: MousePointer2, redo: Redo2, scan: Scan,
  scissors: Scissors, search: Search, select: SquareDashed, shapes: Shapes, sliders: SlidersHorizontal, sparkles: Sparkles,
  square: Square, stamp: Stamp, sun: Sun, swap: ArrowLeftRight, trash: Trash2, type: Type, undo: Undo2, wand: Wand,
  'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
};
// W8 (offline and install): the install, reload, Share and Add to Home Screen marks.
import { MonitorDown, RefreshCw, Share, SquarePlus } from 'lucide';
import { Link, Unlink } from 'lucide';
Object.assign(ICONS, { install: MonitorDown, refresh: RefreshCw, share: Share, 'add-square': SquarePlus });
/** Every icon name the sprite holds (tests check that the interface only asks for these). */
export const ICON_NAMES: readonly string[] = Object.keys(ICONS);
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
