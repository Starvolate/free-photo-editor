// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The light and colour batch (13 Nov 2026): hue and chroma, spin one colour range, readable text (WCAG contrast), local
 * black and white, lift the dark areas (retinex), a local tone map, colour harmony, the main colours, and the print
 * estimate. Perceptual colour is OKLab / OKLCH (Björn Ottosson's published matrices). None reads past the edited box, so
 * none needs a reach: the neighbourhood ones measure inside the box. All maths here is written for this project.
 */
import type { Bitmap } from '../document';
import { blurPlane, clamp, luma, num, rgbOf, type Box, type Fx, type P } from './lib';
import { fitPalette } from './more';
import type { FxKind } from './meta';

const DEG = Math.PI / 180;
/** sRGB byte to linear light. */
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
/** Linear light to an sRGB byte value (not rounded; the clamped array rounds), clipped to the screen's range. */
const enc = (v: number): number => { const c = v <= 0 ? 0 : v >= 1 ? 1 : v; return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
/** The signed shortest turn from one hue to another, in degrees (-180 to 180). */
const turn = (d: number): number => ((((d % 360) + 540) % 360) - 180);

/** sRGB bytes to OKLab: `o` gets lightness (0 to 1), a (green to red) and b (blue to yellow). */
export function toLab(r: number, g: number, b: number, o: number[]): void {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  o[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  o[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}
/** OKLab back to sRGB bytes at res[i], res[i + 1], res[i + 2]; colours past the screen's range are clipped. */
export function fromLab(L: number, a: number, b: number, res: Uint8ClampedArray, i: number): void {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  res[i] = enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  res[i + 1] = enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  res[i + 2] = enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
const each = (src: Bitmap, b: Box, f: (i: number, j: number) => void): void => {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x, j = y * src.width + x; x < b.x + b.w; x++, j++) if (src.data[j * 4 + 3]) f(j * 4, j);
};
/** Re-colours each pixel from its OKLCH lightness, chroma and hue (degrees); `fn` returns false to leave it exactly as it was. */
function lch(src: Bitmap, b: Box, fn: (o: number[], C: number, h: number) => boolean): Uint8ClampedArray {
  const d = src.data, res = d.slice(), o = [0, 0, 0];
  each(src, b, (i) => {
    toLab(d[i], d[i + 1], d[i + 2], o);
    const C = Math.hypot(o[1], o[2]), h = Math.atan2(o[2], o[1]) / DEG;
    if (fn(o, C, h)) fromLab(o[0], o[1], o[2], res, i);
  });
  return res;
}
/** Sets o's a and b from a chroma and a hue in degrees. */
const polar = (o: number[], C: number, h: number): true => { o[1] = C * Math.cos(h * DEG); o[2] = C * Math.sin(h * DEG); return true; };
/** How much a colour counts as a colour at all: greys (chroma under 0.01) have no hue, so hue tools leave them alone. */
const tint = (C: number): number => clamp((C - 0.01) / 0.02, 0, 1);

const hueChroma: Fx = (src, p, b) => {
  const dh = clamp(num(p, 'hue', 0), -180, 180), k = 1 + clamp(num(p, 'chroma', 25), -100, 100) / 100, lt = clamp(num(p, 'light', 0), -100, 100) / 100;
  return lch(src, b, (o, C, h) => { o[0] = lt >= 0 ? o[0] + (1 - o[0]) * lt : o[0] * (1 + lt); return polar(o, C * k, h + dh); });
};
/** The centres of the named colour ranges on the OKLCH wheel: reds, oranges, yellows, greens, cyans, blues, purples, pinks. */
export const HUES = [29, 60, 105, 142, 195, 264, 300, 340];
const rotateColours: Fx = (src, p, b) => {
  const from = HUES[clamp(Math.round(num(p, 'from', 1)), 0, 7)], to = HUES[clamp(Math.round(num(p, 'to', 5)), 0, 7)];
  const half = clamp(num(p, 'width', 70), 10, 180) / 2, inner = half * (1 - clamp(num(p, 'soft', 40), 0, 100) / 100), shift = turn(to - from);
  return lch(src, b, (o, C, h) => {
    const dist = Math.abs(turn(h - from)), w = (dist <= inner ? 1 : (half - dist) / (half - inner)) * tint(C);
    return dist < half && w > 0 && polar(o, C, h + shift * w);
  });
};
/** Colour schemes as turns from the main hue: one colour, opposites, neighbours, three-way, split opposites. */
const SCHEMES = [[0], [0, 180], [-30, 0, 30], [0, 120, 240], [0, 150, 210]];
const harmonize: Fx = (src, p, b) => {
  const d = src.data, o = [0, 0, 0], set = SCHEMES[clamp(Math.round(num(p, 'scheme', 1)), 0, 4)], k = clamp(num(p, 'amount', 50), 0, 100) / 100;
  // The main hue: the sum of every pixel's (a, b) colour arrow, so strong colours count more than dull ones.
  let sa = 0, sb = 0;
  each(src, b, (i) => { toLab(d[i], d[i + 1], d[i + 2], o); sa += o[1]; sb += o[2]; });
  const base = (Math.hypot(sa, sb) > 1e-9 ? Math.atan2(sb, sa) / DEG : 0) + clamp(num(p, 'turn', 0), -180, 180);
  return lch(src, b, (q, C, h) => {
    let best = 360;
    for (const t of set) { const dd = turn(base + t - h); if (Math.abs(dd) < Math.abs(best)) best = dd; }
    const w = k * tint(C);
    return w > 0 && polar(q, C, h + best * w);
  });
};

/** Brightness (0 to 255) of every pixel of the working bitmap, as floats. */
function lumaPlane(src: Bitmap): Float32Array {
  const d = src.data, L = new Float32Array(src.width * src.height);
  for (let j = 0, i = 0; j < L.length; j++, i += 4) L[j] = luma(d[i], d[i + 1], d[i + 2]);
  return L;
}
/** Black or white by comparing each pixel with the average brightness around it, so uneven light on a scan does not matter. */
const localThreshold: Fx = (src, p, b) => {
  const res = src.data.slice(), L = lumaPlane(src), off = clamp(num(p, 'offset', 10), -100, 100);
  const mean = blurPlane(L, src.width, src.height, clamp(num(p, 'radius', 15), 1, 400) / 2);
  each(src, b, (i, j) => { res[i] = res[i + 1] = res[i + 2] = L[j] < mean[j] - off ? 0 : 255; });
  return res;
};
/** Multiplies each pixel's colour by `gain(j)`, so its own hue and strength stay. */
function scaleBy(src: Bitmap, b: Box, gain: (j: number) => number): Uint8ClampedArray {
  const d = src.data, res = d.slice();
  each(src, b, (i, j) => { const g = gain(j); res[i] = d[i] * g; res[i + 1] = d[i + 1] * g; res[i + 2] = d[i + 2] * g; });
  return res;
}
/** Retinex: the light falling on each place is the blurred brightness; dividing it out brings dark places up to the average. */
const retinex: Fx = (src, p, b) => {
  const L = lumaPlane(src), I = blurPlane(L, src.width, src.height, clamp(num(p, 'radius', 60), 2, 600) / 2);
  const s = clamp(num(p, 'amount', 60), 0, 100) / 100, lift = num(p, 'lift', 1) > 0;
  let sum = 0, n = 0;
  each(src, b, (_i, j) => { sum += L[j]; n++; });
  const mid = n ? sum / n : 128;
  return scaleBy(src, b, (j) => { const g = Math.min(8, (mid / Math.max(4, I[j])) ** s); return lift && g < 1 ? 1 : g; });
};
/**
 * A local tone map: brightness in stops is split into a smooth base (the big light differences) and the detail on top.
 * The base is squeezed toward the brightest place, the detail kept or boosted, then each pixel's colour is scaled to match.
 */
const toneMap: Fx = (src, p, b) => {
  const L = lumaPlane(src), l = new Float32Array(L.length), eps = 1 / 256;
  for (let j = 0; j < L.length; j++) l[j] = Math.log2(L[j] / 255 + eps);
  const base = blurPlane(l, src.width, src.height, clamp(num(p, 'radius', 40), 1, 600) / 2);
  const c = clamp(num(p, 'squeeze', 50), 0, 100) / 100, det = clamp(num(p, 'detail', 120), 0, 300) / 100, ev = clamp(num(p, 'bright', 0), -100, 100) / 100;
  let top = -Infinity;
  each(src, b, (_i, j) => { if (base[j] > top) top = base[j]; });
  return scaleBy(src, b, (j) => {
    const out = top + (base[j] - top) * (1 - c) + (l[j] - base[j]) * det + ev;
    return Math.max(0, 2 ** out - eps) / Math.max(1e-6, 2 ** l[j] - eps);
  });
};

/** WCAG 2 relative luminance of sRGB bytes (0 is black, 1 is white). */
export const wcagLum = (r: number, g: number, b: number): number => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
/** WCAG contrast ratio of two luminances: 1 (none) to 21 (black on white). */
export const contrastRatio = (y1: number, y2: number): number => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
/** The WCAG levels the check offers: AA for normal text, AA for large text, AAA for normal text. */
export const LEVELS = [4.5, 3, 7];
/** The text colour as 0xRRGGBB: the main colour, the second colour, black or white. */
export const textColour = (p: P): number => {
  const w = clamp(Math.round(num(p, 'text', 0)), 0, 3);
  return w === 0 ? num(p, 'fg', 0) : w === 1 ? num(p, 'bg', 0xffffff) : w === 2 ? 0 : 0xffffff;
};
/** Readable text: every pixel that fails the chosen level against the text colour is lightened or darkened just enough. */
const textContrast: Fx = (src, p, b) => {
  const d = src.data, res = d.slice(), [tr, tg, tb] = rgbOf(textColour(p)), Lt = wcagLum(tr, tg, tb);
  // A small margin, so rounding back to whole bytes never drops a fixed pixel under the level.
  const need = LEVELS[clamp(Math.round(num(p, 'level', 0)), 0, 2)] + 0.03;
  const up = need * (Lt + 0.05) - 0.05, down = (Lt + 0.05) / need - 0.05, white = 1.05 / (Lt + 0.05) >= (Lt + 0.05) / 0.05;
  each(src, b, (i) => {
    const r = LIN[d[i]], g = LIN[d[i + 1]], bl = LIN[d[i + 2]], Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    if (Y >= up || Y <= down) return;
    if (up <= 1 && (Y >= Lt || down < 0)) {
      const t = (up - Y) / (1 - Y);
      res[i] = enc(r + (1 - r) * t); res[i + 1] = enc(g + (1 - g) * t); res[i + 2] = enc(bl + (1 - bl) * t);
    } else if (down >= 0) {
      const k = Y > 0 ? down / Y : 0;
      res[i] = enc(r * k); res[i + 1] = enc(g * k); res[i + 2] = enc(bl * k);
    } else res[i] = res[i + 1] = res[i + 2] = white ? 255 : 0; // no shade reaches the level: the best there is
  });
  return res;
};

/** The area's main colours (median cut), most used first, as OKLab. */
export function mainColours(src: Bitmap, b: Box, n: number): number[][] {
  const pal = fitPalette(src, b, n), d = src.data, count = new Float64Array(pal.length);
  each(src, b, (i) => {
    let best = 0, bd = Infinity;
    pal.forEach((c, k) => { const e = (c[0] - d[i]) ** 2 + (c[1] - d[i + 1]) ** 2 + (c[2] - d[i + 2]) ** 2; if (e < bd) { bd = e; best = k; } });
    count[best]++;
  });
  return pal.map((c, k) => ({ c, n: count[k] })).sort((x, y) => y.n - x.n).map(({ c }) => { const o = [0, 0, 0]; toLab(c[0], c[1], c[2], o); return o; });
}
/** Change each main colour: every pixel takes the turns of the main colours near it, weighted by how close each one is. */
const paletteEdit: Fx = (src, p, b) => {
  const pal = mainColours(src, b, 4), set = pal.map((_, k) => [num(p, 'h' + (k + 1), 0), num(p, 'c' + (k + 1), 0) / 100, num(p, 'l' + (k + 1), 0) / 100]);
  const w = new Float64Array(pal.length);
  return lch(src, b, (o, C, h) => {
    let dmin = Infinity;
    pal.forEach((q, k) => { w[k] = (q[0] - o[0]) ** 2 + (q[1] - o[1]) ** 2 + (q[2] - o[2]) ** 2; dmin = Math.min(dmin, w[k]); });
    let sum = 0, dh = 0, dc = 0, dl = 0;
    pal.forEach((_, k) => { w[k] = Math.exp(-(w[k] - dmin) / (2 * 0.04 * 0.04)); sum += w[k]; });
    pal.forEach((_, k) => { const x = w[k] / sum; dh += set[k][0] * x; dc += set[k][1] * x; dl += set[k][2] * x; });
    if (!dh && !dc && !dl) return false;
    o[0] = dl >= 0 ? o[0] + (1 - o[0]) * dl : o[0] * (1 + dl);
    return polar(o, C * Math.max(0, 1 + dc), h + dh * tint(C));
  });
};

/**
 * Print estimate: a rough, hand-set outline of what a typical four-ink press on coated paper reaches, as the strongest
 * chroma at each hue, peaking at the lightness of that hue's strongest ink and falling to grey at black and white. It is
 * not a printer's ICC profile; the dialog says so.
 */
const PRESS = [[29, 0.56, 0.19], [70, 0.72, 0.15], [105, 0.9, 0.17], [150, 0.56, 0.13], [215, 0.62, 0.1], [265, 0.38, 0.12], [330, 0.56, 0.19]];
export function pressChroma(L: number, h: number): number {
  const hh = ((h % 360) + 360) % 360;
  let k = PRESS.length - 1;
  while (k > 0 && PRESS[k][0] > hh) k--;
  const a = PRESS[k], z = PRESS[(k + 1) % PRESS.length], span = (z[0] - a[0] + 360) % 360 || 360, t = ((hh - a[0] + 360) % 360) / span;
  const Lc = a[1] + (z[1] - a[1]) * t, Cc = a[2] + (z[2] - a[2]) * t;
  return Cc * clamp(L <= Lc ? L / Lc : (1 - L) / (1 - Lc), 0, 1);
}
const gamutWarning: Fx = (src, p, b) => {
  const pull = num(p, 'mode', 0) > 0, more = 1 + clamp(num(p, 'margin', 0), -50, 50) / 100, grey = clamp(num(p, 'grey', 50), 0, 100) / 100;
  return lch(src, b, (o, C, h) => {
    const cap = pressChroma(o[0], h) * more;
    if (C <= cap) return false;
    if (pull) return polar(o, cap, h);
    o[0] = grey; o[1] = o[2] = 0;
    return true;
  });
};

export const LIGHT = {
  'hue-chroma': hueChroma, 'rotate-colours': rotateColours, 'text-contrast': textContrast, 'local-threshold': localThreshold, retinex,
  'tone-map': toneMap, harmonize, 'palette-edit': paletteEdit, 'gamut-warning': gamutWarning,
} satisfies Partial<Record<FxKind, Fx>>;
