// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * TIFF, written for Free Photo Editor. Opens every page as a layer: strips or tiles; no compression, LZW, Deflate or
 * PackBits; 1 to 32 bits; grey, colour, palette or CMYK; with or without see-through. Saves colour (with see-through
 * when the picture has it) using LZW and the horizontal predictor, one page or one page per layer, with the credit in
 * the Software tag (305) and in XMP (700), and the print resolution (DPI) in tags 282, 283 and 296, read back on open.
 */
import { inflateSync, unzlibSync, zlibSync } from 'fflate';
import { CREDIT, buildXmp, concatBytes, isDpi, latin1Decode, latin1Encode, rationalOf, roundDpi, utf8Encode, type Bitmap, type Decoded, type FormatCodec } from '@free-photoeditor/core';
import { docFromFrames, errMsg, framesOf, isOpaque } from './util';

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };
export interface TiffIfd { tags: Map<number, number[]>; text: Map<number, string>; }
export interface TiffFile { le: boolean; ifds: TiffIfd[]; }

export function readTiff(b: Uint8Array): TiffFile {
  if (b.length < 8) throw new Error('This TIFF file is too short.');
  const le = b[0] === 0x49 && b[1] === 0x49;
  if (!le && !(b[0] === 0x4d && b[1] === 0x4d)) throw new Error('This is not a TIFF file.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number): number => dv.getUint16(o, le), u32 = (o: number): number => dv.getUint32(o, le);
  if (u16(2) === 43) throw new Error("This is a very large (BigTIFF) file, which this editor can't open yet.");
  if (u16(2) !== 42) throw new Error('This is not a TIFF file.');
  const ifds: TiffIfd[] = [], seen = new Set<number>();
  for (let off = u32(4); off && off + 2 <= b.length && !seen.has(off) && ifds.length < 4096; ) {
    seen.add(off);
    const n = u16(off), tags = new Map<number, number[]>(), text = new Map<number, string>();
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > b.length) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4), unit = SIZE[type] ?? 0, size = unit * count;
      if (!size) continue;
      const at = size <= 4 ? e + 8 : u32(e + 8);
      if (at + size > b.length) continue;
      if (type === 2) { text.set(tag, latin1Decode(b, at, at + count).replace(/\0+$/, '')); continue; }
      if ((type === 1 || type === 7) && count > 65536) continue;
      const v: number[] = new Array<number>(count);
      for (let k = 0, p = at; k < count; k++, p += unit) {
        switch (type) {
          case 1: case 7: v[k] = b[p]; break;
          case 6: v[k] = dv.getInt8(p); break;
          case 3: v[k] = u16(p); break;
          case 8: v[k] = dv.getInt16(p, le); break;
          case 4: case 13: v[k] = u32(p); break;
          case 9: v[k] = dv.getInt32(p, le); break;
          case 5: v[k] = u32(p) / (u32(p + 4) || 1); break;
          case 10: v[k] = dv.getInt32(p, le) / (dv.getInt32(p + 4, le) || 1); break;
          case 11: v[k] = dv.getFloat32(p, le); break;
          case 12: v[k] = dv.getFloat64(p, le); break;
          default: v[k] = Number(dv.getBigUint64(p, le));
        }
      }
      tags.set(tag, v);
    }
    ifds.push({ tags, text });
    const nx = off + 2 + n * 12;
    off = nx + 4 <= b.length ? u32(nx) : 0;
  }
  if (!ifds.length) throw new Error('This TIFF file has no pictures in it.');
  return { le, ifds };
}

/** TIFF LZW (most significant bit first, code width grows one code early), as libtiff writes it. */
export function lzwDecode(src: Uint8Array, want: number): Uint8Array {
  const out = new Uint8Array(want), offs = new Int32Array(4096), lens = new Int32Array(4096), total = src.length * 8;
  let op = 0, bitPos = 0, codeLen = 9, next = 258, old = -1, oldStart = 0, oldLen = 0;
  const copy = (from: number, n: number): void => { for (let i = 0; i < n; i++, op++) if (op < want) out[op] = out[from + i]; };
  while (op < want && bitPos + codeLen <= total) {
    const k = bitPos >> 3, chunk = (src[k] << 16) | ((src[k + 1] ?? 0) << 8) | (src[k + 2] ?? 0);
    const code = (chunk >> (24 - (bitPos & 7) - codeLen)) & ((1 << codeLen) - 1);
    bitPos += codeLen;
    if (code === 257) break;
    if (code === 256) { codeLen = 9; next = 258; old = -1; continue; }
    const start = op;
    let len: number;
    if (old === -1 || code < next) {
      if (code < 256) { if (op < want) out[op] = code; op++; len = 1; } else { len = lens[code]; copy(offs[code], len); }
    } else { copy(oldStart, oldLen); if (op < want) out[op] = out[oldStart]; op++; len = oldLen + 1; }
    if (old !== -1 && next < 4096) { offs[next] = oldStart; lens[next] = oldLen + 1; next++; }
    if (next >= (1 << codeLen) - 1 && codeLen < 12) codeLen++;
    old = code; oldStart = start; oldLen = len;
  }
  return out;
}
export function lzwEncode(src: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(1024, src.length >> 1)), n = 0, buf = 0, bits = 0, codeLen = 9, next = 258;
  const push = (v: number): void => { if (n === out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; } out[n++] = v; };
  const put = (code: number): void => { buf = (buf << codeLen) | code; bits += codeLen; while (bits >= 8) { bits -= 8; push((buf >>> bits) & 255); } buf &= (1 << bits) - 1; };
  const table = new Int32Array(1 << 20), used: number[] = [];
  put(256);
  if (src.length) {
    let w = src[0];
    for (let i = 1; i < src.length; i++) {
      const c = src[i], key = (w << 8) | c, hit = table[key];
      if (hit) { w = hit; continue; }
      put(w);
      table[key] = next++; used.push(key);
      if (next === 4094) { put(256); for (const u of used) table[u] = 0; used.length = 0; next = 258; codeLen = 9; }
      else if (next > (1 << codeLen) - 1) codeLen++;
      w = c;
    }
    put(w);
    next++;
    if (next !== 4094 && next > (1 << codeLen) - 1 && codeLen < 12) codeLen++;
  }
  put(257);
  if (bits) push((buf << (8 - bits)) & 255);
  return out.slice(0, n);
}
function unpackBits(s: Uint8Array, want: number): Uint8Array {
  const o = new Uint8Array(want);
  let i = 0, p = 0;
  while (i < s.length && p < want) {
    const n = (s[i++] << 24) >> 24;
    if (n >= 0) { const c = Math.min(n + 1, want - p); o.set(s.subarray(i, i + c), p); i += n + 1; p += c; }
    else if (n !== -128) { const c = Math.min(1 - n, want - p); o.fill(s[i++], p, p + c); p += c; }
  }
  return o;
}
function inflate(comp: number, src: Uint8Array, want: number): Uint8Array {
  let d: Uint8Array;
  if (comp === 1) d = src.slice(0, want);
  else if (comp === 5) d = lzwDecode(src, want);
  else if (comp === 32773) d = unpackBits(src, want);
  else { try { d = unzlibSync(src); } catch { d = inflateSync(src); } }
  if (d.length >= want) return d.length === want ? d : d.subarray(0, want);
  const o = new Uint8Array(want);
  o.set(d);
  return o;
}
function unpredict(d: Uint8Array, rowBytes: number, rows: number, spp: number, bps: number, le: boolean): void {
  if (bps === 8) { for (let r = 0; r < rows; r++) for (let i = r * rowBytes + spp, e = (r + 1) * rowBytes; i < e; i++) d[i] += d[i - spp]; return; }
  if (bps !== 16) return;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (let r = 0; r < rows; r++) for (let i = spp; i < rowBytes >> 1; i++) {
    const p = r * rowBytes + i * 2;
    dv.setUint16(p, (dv.getUint16(p, le) + dv.getUint16(p - spp * 2, le)) & 0xffff, le);
  }
}
const COMPRESSION: Record<number, string> = { 2: 'fax', 3: 'fax', 4: 'fax', 6: 'old JPEG', 7: 'JPEG', 34712: 'JPEG 2000', 50000: 'Zstandard', 50001: 'WebP', 52546: 'JPEG XL' };

/** One page (one directory of tags) as RGBA. Throws a plain sentence when the page can't be read. */
export function decodeTiffPage(b: Uint8Array, le: boolean, t: TiffIfd): Bitmap {
  const one = (tag: number, d: number): number => t.tags.get(tag)?.[0] ?? d;
  const w = one(256, 0), h = one(257, 0);
  if (!w || !h) throw new Error('A TIFF page has no size, so it was left out.');
  const comp = one(259, 1), photo = one(262, t.tags.has(320) ? 3 : 1), spp = one(277, 1), planar = one(284, 1), pred = one(317, 1), fmt = one(339, 1), bps = one(258, 1);
  if (![1, 5, 8, 32773, 32946].includes(comp)) throw new Error(`A TIFF page uses ${COMPRESSION[comp] ?? 'a kind of'} compression this editor can't read yet, so it was left out.`);
  if (![0, 1, 2, 3, 5].includes(photo)) throw new Error("A TIFF page uses a colour model this editor can't read yet, so it was left out.");
  if (![1, 2, 4, 8, 16, 32].includes(bps) || (fmt === 3 && bps !== 32) || pred === 3) throw new Error("A TIFF page stores its colours in a way this editor can't read yet, so it was left out.");
  if (w * h > 150e6) throw new Error('A TIFF page is too large to open, so it was left out.');
  const tiled = t.tags.has(322), cw = tiled ? one(322, w) : w, ch = tiled ? one(323, h) : Math.min(one(278, h) || h, h);
  const offs = t.tags.get(tiled ? 324 : 273) ?? [], counts = t.tags.get(tiled ? 325 : 279) ?? [];
  const planes = planar === 2 ? spp : 1, per = planar === 2 ? 1 : spp;
  const rowBytes = Math.ceil((w * per * bps) / 8), chunkRow = Math.ceil((cw * per * bps) / 8);
  const across = Math.ceil(w / cw), down = Math.ceil(h / ch);
  const full = Array.from({ length: planes }, () => new Uint8Array(rowBytes * h));
  for (let p = 0; p < planes; p++) for (let cy = 0; cy < down; cy++) for (let cx = 0; cx < across; cx++) {
    const i = p * across * down + cy * across + cx;
    if (i >= offs.length) continue;
    const rows = tiled ? ch : Math.min(ch, h - cy * ch), end = counts[i] === undefined ? b.length : offs[i] + counts[i];
    const data = inflate(comp, b.subarray(offs[i], end), chunkRow * rows);
    if (pred === 2) unpredict(data, chunkRow, rows, per, bps, le);
    const x0 = cx * cw, at = (x0 * per * bps) / 8, n = Math.ceil((Math.min(cw, w - x0) * per * bps) / 8);
    if (at % 1) continue;
    for (let r = 0; r < rows; r++) {
      const y = cy * ch + r;
      if (y >= h) break;
      full[p].set(data.subarray(r * chunkRow, r * chunkRow + n), y * rowBytes + at);
    }
  }
  const dvs = full.map((f) => new DataView(f.buffer)), max = bps >= 32 ? 0xffffffff : 2 ** bps - 1;
  const raw = (p: number, y: number, idx: number): number => {
    const f = full[p], o = y * rowBytes;
    if (bps === 8) return f[o + idx];
    if (bps === 16) return dvs[p].getUint16(o + idx * 2, le);
    if (bps === 32) return fmt === 3 ? dvs[p].getFloat32(o + idx * 4, le) : dvs[p].getUint32(o + idx * 4, le);
    const bit = idx * bps;
    return (f[o + (bit >> 3)] >> (8 - bps - (bit & 7))) & max;
  };
  const to8 = (v: number): number => (fmt === 3 ? Math.round(Math.min(1, Math.max(0, v)) * 255) : bps === 8 ? v : bps === 16 ? v >> 8 : bps === 32 ? v >>> 24 : Math.round((v * 255) / max));
  const s = (k: number, y: number, x: number): number => to8(planar === 2 ? raw(k, y, x) : raw(0, y, x * spp + k));
  const extra = t.tags.get(338)?.[0] ?? -1, colours = photo === 2 ? 3 : photo === 5 ? 4 : 1;
  const alpha = spp > colours && (extra === 1 || extra === 2 || (extra === -1 && spp === colours + 1 && photo !== 5));
  const map = t.tags.get(320), mapN = 2 ** bps, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    let r: number, g: number, bl: number;
    if (photo === 3) {
      const i = raw(0, y, planar === 2 ? x : x * spp);
      r = map ? map[i] >> 8 : i; g = map ? map[mapN + i] >> 8 : i; bl = map ? map[2 * mapN + i] >> 8 : i;
    } else if (photo === 2) { r = s(0, y, x); g = s(1, y, x); bl = s(2, y, x); }
    else if (photo === 5) { const k = 255 - s(3, y, x); r = ((255 - s(0, y, x)) * k) / 255; g = ((255 - s(1, y, x)) * k) / 255; bl = ((255 - s(2, y, x)) * k) / 255; }
    else { const v = s(0, y, x); r = g = bl = photo === 0 ? 255 - v : v; }
    const a = alpha ? s(colours, y, x) : 255;
    if (extra === 1 && a > 0 && a < 255) { const k = 255 / a; r *= k; g *= k; bl *= k; }
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a;
  }
  return { width: w, height: h, data: out };
}
export function decodeTiff(bytes: Uint8Array): Decoded {
  const f = readTiff(bytes), notes = new Set<string>(), pages: { name?: string; bmp: Bitmap }[] = [];
  for (const t of f.ifds) {
    if ((t.tags.get(254)?.[0] ?? 0) & 1) continue;
    try { pages.push({ name: t.text.get(285) || undefined, bmp: decodeTiffPage(bytes, f.le, t) }); } catch (e) { notes.add(errMsg(e)); }
  }
  if (!pages.length) throw new Error([...notes][0] ?? 'This TIFF file has no picture this editor can read.');
  if (pages.length > 1) notes.add(`Each of the ${pages.length} pages opened as its own layer; page 1 shows. Turn the others on in Layers.`);
  const w = Math.max(...pages.map((p) => p.bmp.width)), h = Math.max(...pages.map((p) => p.bmp.height));
  const doc = docFromFrames(w, h, pages.map((p, i) => ({ bmp: p.bmp, name: pages.length > 1 ? p.name ?? `Page ${i + 1}` : 'Background' })), 'Page');
  const x = f.ifds[0].tags.get(282)?.[0] ?? 0, unit = f.ifds[0].tags.get(296)?.[0] ?? 2, dpi = roundDpi(unit === 3 ? x * 2.54 : unit === 2 ? x : 0);
  if (isDpi(dpi)) doc.dpi = dpi;
  return { doc, notes: [...notes] };
}

export interface TiffEntry { tag: number; type: number; value: number[] | string | Uint8Array; }
export interface TiffPage { entries: TiffEntry[]; strips: Uint8Array[]; }
function encodeValue(e: TiffEntry): { count: number; bytes: Uint8Array } {
  if (typeof e.value === 'string') { const b = concatBytes(latin1Encode(e.value), new Uint8Array(1)); return { count: b.length, bytes: b }; }
  if (e.value instanceof Uint8Array) return { count: e.value.length, bytes: e.value };
  const unit = SIZE[e.type] ?? 1, vals = e.value, rational = e.type === 5 || e.type === 10, count = rational ? vals.length / 2 : vals.length;
  const bytes = new Uint8Array(count * unit), dv = new DataView(bytes.buffer);
  vals.forEach((v, i) => {
    switch (e.type) {
      case 1: case 7: bytes[i] = v; break;
      case 3: dv.setUint16(i * 2, v, true); break;
      case 8: dv.setInt16(i * 2, v, true); break;
      case 4: case 5: dv.setUint32(i * 4, v, true); break;
      case 9: case 10: dv.setInt32(i * 4, v, true); break;
      case 11: dv.setFloat32(i * 4, v, true); break;
      case 12: dv.setFloat64(i * 8, v, true); break;
      default: break;
    }
  });
  return { count, bytes };
}
/** A little-endian TIFF from directories of tags; strip offsets (273) and byte counts (279) are filled in. */
export function writeTiff(pages: TiffPage[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x49, 0x49, 42, 0, 0, 0, 0, 0])], ifdAt: number[] = [];
  let size = 8;
  const align = (): void => { if (size & 1) { chunks.push(new Uint8Array(1)); size++; } };
  for (const pg of pages) {
    const offsets = pg.strips.map((s) => { align(); const at = size; chunks.push(s); size += s.length; return at; });
    const entries = [...pg.entries.filter((e) => e.tag !== 273 && e.tag !== 279),
      { tag: 273, type: 4, value: offsets }, { tag: 279, type: 4, value: pg.strips.map((s) => s.length) }].sort((a, b) => a.tag - b.tag);
    align();
    const at = size, ifd = new Uint8Array(2 + entries.length * 12 + 4), dv = new DataView(ifd.buffer), tail: Uint8Array[] = [];
    let extra = at + ifd.length;
    dv.setUint16(0, entries.length, true);
    entries.forEach((e, i) => {
      const o = 2 + i * 12, v = encodeValue(e);
      dv.setUint16(o, e.tag, true); dv.setUint16(o + 2, e.type, true); dv.setUint32(o + 4, v.count, true);
      if (v.bytes.length <= 4) ifd.set(v.bytes, o + 8);
      else { dv.setUint32(o + 8, extra, true); const p = v.bytes.length & 1 ? concatBytes(v.bytes, new Uint8Array(1)) : v.bytes; tail.push(p); extra += p.length; }
    });
    chunks.push(ifd, ...tail);
    size = extra;
    ifdAt.push(at);
  }
  const out = concatBytes(...chunks), dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(4, ifdAt[0] ?? 0, true);
  ifdAt.forEach((at, i) => dv.setUint32(at + 2 + dv.getUint16(at, true) * 12, ifdAt[i + 1] ?? 0, true));
  return out;
}
/** Pages (one or more) as a TIFF, colour with see-through when needed, LZW (or Deflate) with the predictor. */
export function encodeTiffPages(frames: { bmp: Bitmap; name: string }[], credit: string = CREDIT, compression: 'lzw' | 'deflate' = 'lzw', dpi = 72): Uint8Array {
  const xmp = utf8Encode(buildXmp(credit, dpi)), multi = frames.length > 1, res = rationalOf(dpi);
  return writeTiff(frames.map(({ bmp, name }, i) => {
    const alpha = !isOpaque(bmp.data), spp = alpha ? 4 : 3, rowBytes = bmp.width * spp;
    const rps = Math.max(1, Math.min(bmp.height, Math.floor(65536 / rowBytes))), strips: Uint8Array[] = [];
    for (let y0 = 0; y0 < bmp.height; y0 += rps) {
      const rows = Math.min(rps, bmp.height - y0), raw = new Uint8Array(rows * rowBytes);
      for (let r = 0; r < rows; r++) {
        const s = (y0 + r) * bmp.width * 4, o = r * rowBytes;
        for (let x = 0; x < bmp.width; x++) for (let k = 0; k < spp; k++) raw[o + x * spp + k] = bmp.data[s + x * 4 + k];
        for (let j = rowBytes - 1; j >= spp; j--) raw[o + j] -= raw[o + j - spp];
      }
      strips.push(compression === 'lzw' ? lzwEncode(raw) : zlibSync(raw));
    }
    const entries: TiffEntry[] = [
      { tag: 254, type: 4, value: [multi ? 2 : 0] }, { tag: 256, type: 4, value: [bmp.width] }, { tag: 257, type: 4, value: [bmp.height] },
      { tag: 258, type: 3, value: new Array<number>(spp).fill(8) }, { tag: 259, type: 3, value: [compression === 'lzw' ? 5 : 8] },
      { tag: 262, type: 3, value: [2] }, { tag: 277, type: 3, value: [spp] }, { tag: 278, type: 4, value: [rps] },
      { tag: 282, type: 5, value: res }, { tag: 283, type: 5, value: res }, { tag: 284, type: 3, value: [1] },
      { tag: 296, type: 3, value: [2] }, { tag: 305, type: 2, value: credit }, { tag: 317, type: 3, value: [2] }, { tag: 700, type: 1, value: xmp },
    ];
    if (multi) entries.push({ tag: 285, type: 2, value: name || `Page ${i + 1}` }, { tag: 297, type: 3, value: [i, frames.length] });
    if (alpha) entries.push({ tag: 338, type: 3, value: [2] });
    return { entries, strips };
  }));
}
export const codec: FormatCodec = {
  decode: async (bytes) => decodeTiff(bytes),
  encode: async (doc, o) => encodeTiffPages(framesOf(doc, o.multi, o.delay), CREDIT, 'lzw', o.dpi ?? 72),
};
