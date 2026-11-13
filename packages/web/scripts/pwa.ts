// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The installable, offline app, made at build time with no extra packages:
 * - manifest.webmanifest (name, his name in the description, our own icons, standalone, file handlers, share target).
 *   Every address in it is relative to the manifest, so the app works at any folder: / or /tools/free-photoeditor/.
 * - Our own icons, drawn here (no image files in the repo) and saved as PNG.
 * - sw.js from src/sw.ts, with this build's file lists filled in: the app shell is saved at install, every add-on on
 *   first use. The build's folder comes from Vite's `base` (set FPE_BASE, for example /tools/free-photoeditor/).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { transformWithOxc, type Plugin } from 'vite';

export const APP = 'Free Photo Editor';
export const SHARE_ACTION = 'share-target';
export const SHARE_FIELD = 'photos';
export const BG = '#111214';
/** Pictures the installed app opens from the computer's "Open with" (types by extension; RAW and others open too). */
export const OPEN_TYPES: Record<string, string[]> = {
  'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg', '.jfif'], 'image/webp': ['.webp'], 'image/gif': ['.gif'], 'image/bmp': ['.bmp', '.dib'],
  'image/avif': ['.avif'], 'image/svg+xml': ['.svg'], 'image/x-icon': ['.ico'], 'image/vnd.adobe.photoshop': ['.psd', '.psb'],
  'image/tiff': ['.tif', '.tiff'], 'image/heic': ['.heic', '.hif'], 'image/heif': ['.heif'], 'image/jxl': ['.jxl'], 'image/apng': ['.apng'],
  'image/x-tga': ['.tga', '.icb', '.vda', '.vst', '.tpic'], 'image/openraster': ['.ora'], 'application/pdf': ['.pdf'],
  'image/x-raw': ['.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.raf', '.orf', '.rw2', '.rwl', '.pef', '.ptx', '.srw', '.x3f', '.3fr', '.fff', '.iiq', '.erf', '.mef', '.mos', '.mrw', '.kdc', '.dcr', '.dcs', '.k25', '.raw', '.gpr', '.ari', '.bay', '.cap', '.eip', '.mdc', '.pxn'],
  'image/x-dds': ['.dds'], 'image/x-xcf': ['.xcf'], 'image/x-krita': ['.kra'], 'image/x-portable-anymap': ['.pbm', '.pgm', '.ppm', '.pnm', '.pam'],
  'image/x-exr': ['.exr'], 'image/vnd.radiance': ['.hdr'], 'image/qoi': ['.qoi'], 'image/x-pcx': ['.pcx'], 'image/vnd.zbrush.pcx': ['.pcx'],
};
export const ICONS = [
  { file: 'icons/icon-192.png', size: 192, kind: 'any' as const },
  { file: 'icons/icon-512.png', size: 512, kind: 'any' as const },
  { file: 'icons/icon-maskable-512.png', size: 512, kind: 'maskable' as const },
  { file: 'icons/apple-touch-icon.png', size: 180, kind: 'full' as const },
  { file: 'icons/icon-32.png', size: 32, kind: 'any' as const },
];

export function webManifest(): Record<string, unknown> {
  const exts = [...new Set(Object.values(OPEN_TYPES).flat())];
  return {
    id: './', name: APP, short_name: 'Photo Editor',
    description: 'Free Photo Editor by Bhawesh Tibrewal: a free photo editor with layers, brushes, filters and PSD files. It works offline, and your pictures never leave your device.',
    lang: 'en', dir: 'ltr', start_url: './', scope: './', display: 'standalone', orientation: 'any',
    background_color: BG, theme_color: BG, categories: ['photo', 'graphics', 'productivity'],
    icons: ICONS.filter((i) => i.kind !== 'full' && i.size >= 192).map((i) => ({ src: i.file, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.kind })),
    file_handlers: [{ action: './', accept: OPEN_TYPES }],
    share_target: { action: './' + SHARE_ACTION, method: 'POST', enctype: 'multipart/form-data', params: { files: [{ name: SHARE_FIELD, accept: ['image/*', 'application/pdf', ...exts] }] } },
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
  };
}

// ---------- our own icon: a photo card (sky, two hills, a sun) and a brush, on the editor's dark ground ----------
type RGBA = [number, number, number, number];
const hex = (s: string, a = 255): RGBA => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];
const boxD = (x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number): number => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segD = (x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number): number => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - t * dx, py - t * dy) - r;
};
/** Inside a convex polygon (clockwise) is negative; good enough for edges a pixel wide. */
const polyD = (x: number, y: number, pts: [number, number][]): number => {
  let d = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], len = Math.hypot(bx - ax, by - ay);
    d = Math.max(d, ((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / len);
  }
  return d;
};
/** Draws the icon at `size` pixels. any: rounded square, see-through corners; maskable and full: square to the edge. */
export function drawIcon(size: number, kind: 'any' | 'maskable' | 'full'): Uint8Array {
  const px = new Uint8Array(size * size * 4), u = size / 100;
  const k = kind === 'maskable' ? 0.78 : 1, m = (v: number): number => (50 + (v - 50) * k) * u;
  const shapes: [(x: number, y: number) => number, RGBA][] = [
    [(x, y) => (kind === 'any' ? boxD(x, y, 50 * u, 50 * u, 46 * u, 46 * u, 21 * u) : -1), hex(BG)],
    [(x, y) => boxD(x, y, m(46), m(46), 30 * u * k, 24 * u * k, 5 * u * k), hex('#eef1f6')],
    [(x, y) => boxD(x, y, m(46), m(46), 26 * u * k, 20 * u * k, 2.5 * u * k), hex('#9cc3f5')],
    [(x, y) => Math.max(polyD(x, y, [[m(20), m(66)], [m(38), m(40)], [m(56), m(66)]]), boxD(x, y, m(46), m(46), 26 * u * k, 20 * u * k, 2.5 * u * k)), hex('#2d6fd6')],
    [(x, y) => Math.max(polyD(x, y, [[m(40), m(66)], [m(54), m(48)], [m(72), m(66)]]), boxD(x, y, m(46), m(46), 26 * u * k, 20 * u * k, 2.5 * u * k)), hex('#1f4f9c')],
    [(x, y) => Math.hypot(x - m(60), y - m(35)) - 5.5 * u * k, hex('#f3a712')],
    [(x, y) => segD(x, y, m(84), m(46), m(64), m(76), 4.2 * u * k), hex('#f3a712')],
    [(x, y) => segD(x, y, m(66), m(73), m(61), m(81), 4.6 * u * k), hex('#d8dde6')],
    [(x, y) => polyD(x, y, [[m(57.5), m(80)], [m(64), m(83)], [m(56), m(88)]]), hex('#17181c')],
  ];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [d, c] of shapes) {
      const cov = Math.max(0, Math.min(1, 0.5 - d(x + 0.5, y + 0.5))) * (c[3] / 255);
      if (!cov) continue;
      const na = cov + a * (1 - cov);
      r = (c[0] * cov + r * a * (1 - cov)) / na; g = (c[1] * cov + g * a * (1 - cov)) / na; b = (c[2] * cov + b * a * (1 - cov)) / na; a = na;
    }
    const o = (y * size + x) * 4;
    px[o] = Math.round(r); px[o + 1] = Math.round(g); px[o + 2] = Math.round(b); px[o + 3] = Math.round(a * 255);
  }
  return px;
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** A minimal PNG encoder: 8-bit RGBA, no filters, deflate from node:zlib. */
export function encodePng(w: number, hgt: number, rgba: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(Buffer.from(type, 'latin1'), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, hgt);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((w * 4 + 1) * hgt);
  for (let y = 0; y < hgt; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- which files are the app shell, and which are add-ons saved on first use ----------
/** `module` is the chunk's own module id (Rollup's facadeModuleId), for example "\0virtual:fpe-help". */
export interface BundleFile { fileName: string; type: 'chunk' | 'asset'; isEntry?: boolean; module?: string; imports?: string[]; code?: string; css?: string[]; assets?: string[]; }
const REF = /["'`]([^"'`\s]*?)([\w.-]+\.(?:js|mjs|wasm))["'`]/g;
/**
 * The shell is the page's entry script with everything it imports up front, its styles, and the files it starts by
 * address (the filter worker), plus `extra` (the page, manifest, icons) and the chunks of `modules` with what they
 * import (lazy files the editor fetches by itself in its first seconds, such as the help lines). Everything else is an
 * add-on. A module in `modules` with no chunk stops the build, so a rename cannot quietly make it an add-on again.
 */
export function splitFiles(files: BundleFile[], extra: string[], modules: string[] = []): { shell: string[]; addons: string[] } {
  const by = new Map(files.map((f) => [f.fileName, f] as const)), shell = new Set<string>(extra);
  const walk = (name: string): void => {
    const f = by.get(name);
    if (!f || shell.has(name)) return;
    shell.add(name);
    for (const c of [...(f.css ?? []), ...(f.assets ?? [])]) shell.add(c);
    for (const i of f.imports ?? []) walk(i);
  };
  for (const f of files) if (f.type === 'chunk' && f.isEntry) walk(f.fileName);
  for (const m of modules) {
    const f = files.find((x) => x.type === 'chunk' && x.module === m);
    if (!f) throw new Error(`pwa: no chunk holds ${JSON.stringify(m)}, so the offline worker would not save it at install`);
    walk(f.fileName);
  }
  const dyn = new Set<string>();
  const lazy = (name: string): void => { const f = by.get(name); if (!f || dyn.has(name) || shell.has(name)) return; dyn.add(name); for (const i of f.imports ?? []) lazy(i); };
  for (const f of files) if (f.type === 'chunk' && !f.isEntry && !shell.has(f.fileName)) lazy(f.fileName);
  for (const name of [...shell]) {
    const code = by.get(name)?.code;
    if (!code) continue;
    for (const m of code.matchAll(REF)) {
      const ref = [...by.keys()].find((k) => k === m[1] + m[2] || k === 'assets/' + m[2] || k.endsWith('/' + m[2]));
      if (ref && !dyn.has(ref)) shell.add(ref);
    }
  }
  const skip = (n: string): boolean => n === 'sw.js' || n.startsWith('.vite/') || n.endsWith('.map');
  return { shell: [...shell].filter((n) => !skip(n)).sort(), addons: files.map((f) => f.fileName).filter((n) => !shell.has(n) && !skip(n)).sort() };
}

/**
 * The Vite plugin. `shell`: module ids whose chunks are saved at install, not on first use (see splitFiles). The help
 * chunk is one: the editor loads it on idle, often while the worker is still installing, and a file fetched then that
 * arrives after the worker takes charge is in neither the worker's own saves nor the page's `keep` list.
 */
export function pwa(opts: { shell?: string[] } = {}): Plugin {
  let base = './', root = process.cwd();
  return {
    name: 'free-photoeditor-pwa',
    apply: 'build',
    configResolved(c) { base = c.base; root = c.root; },
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'link', attrs: { rel: 'manifest', href: base + 'manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: base + 'icons/icon-32.png' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: base + 'icons/apple-touch-icon.png' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Photo Editor' }, injectTo: 'head' },
      ],
    },
    generateBundle: {
      order: 'post',
      async handler(_opts, bundle) {
        for (const i of ICONS) this.emitFile({ type: 'asset', fileName: i.file, source: encodePng(i.size, i.size, drawIcon(i.size, i.kind)) });
        this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(webManifest(), null, 2) + '\n' });
        const files: BundleFile[] = Object.values(bundle).map((f) => f.type === 'chunk'
          ? { fileName: f.fileName, type: 'chunk', isEntry: f.isEntry, module: f.facadeModuleId ?? undefined, imports: f.imports, code: f.code,
            css: [...(f.viteMetadata?.importedCss ?? [])], assets: [...(f.viteMetadata?.importedAssets ?? [])] }
          : { fileName: f.fileName, type: 'asset', code: typeof f.source === 'string' && /\.m?js$/.test(f.fileName) ? f.source : undefined });
        const { shell, addons } = splitFiles(files, ['index.html', 'manifest.webmanifest', ...ICONS.map((i) => i.file)], opts.shell);
        const hash = createHash('sha256');
        for (const f of Object.values(bundle).sort((a, b) => a.fileName.localeCompare(b.fileName))) {
          hash.update(f.fileName);
          hash.update(f.type === 'chunk' ? f.code : typeof f.source === 'string' ? f.source : Buffer.from(f.source));
        }
        const build = { version: hash.digest('hex').slice(0, 12), shell, addons, start: 'index.html', share: SHARE_ACTION, shareField: SHARE_FIELD };
        const ts = readFileSync(join(root, 'src', 'sw.ts'), 'utf8');
        const js = (await transformWithOxc(ts, 'sw.ts', { lang: 'ts' })).code;
        if (!js.includes('__FPE_BUILD__')) throw new Error('sw.ts lost its __FPE_BUILD__ placeholder');
        const out = js.replace(/^declare const __FPE_BUILD__.*$/m, '').replace(/^export \{\s*\};?\s*$/m, '').replace(/__FPE_BUILD__/g, JSON.stringify(build));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: '// Free Photo Editor by Bhawesh Tibrewal. AGPL-3.0-only. Built from packages/web/src/sw.ts.\n' + out });
        const bytes = (n: string): number => { const f = bundle[n]; return !f ? 0 : f.type === 'chunk' ? Buffer.byteLength(f.code) : typeof f.source === 'string' ? Buffer.byteLength(f.source) : f.source.length; };
        const kb = (l: string[]): string => (l.reduce((a, n) => a + bytes(n), 0) / 1000).toFixed(1) + ' KB';
        console.log(`\nOffline: version ${build.version}; ${shell.length} shell files (${kb(shell)} before compression) saved at install, ${addons.length} add-on files (${kb(addons)}) saved on first use.`);
      },
    },
  };
}
