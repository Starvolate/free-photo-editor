// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Byte helpers. The engine has no DOM, so it carries its own tiny encoders. */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}
export function utf8Decode(b: Uint8Array, start = 0, end = b.length): string {
  let s = '';
  for (let i = start; i < end; ) {
    const c = b[i++];
    let cp = c;
    if (c >= 0xf0) { cp = ((c & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); i += 3; }
    else if (c >= 0xe0) { cp = ((c & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63); i += 2; }
    else if (c >= 0xc0) { cp = ((c & 31) << 6) | (b[i] & 63); i += 1; }
    s += String.fromCodePoint(cp);
  }
  return s;
}
export function latin1Encode(s: string): Uint8Array {
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o[i] = c < 256 ? c : 63; }
  return o;
}
export function latin1Decode(b: Uint8Array, start = 0, end = b.length): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
