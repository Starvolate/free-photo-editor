// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Model check, round 4 (wave 2, tap to select): Segment Anything family models on the same four CC0 photos, regions and bar
 * as rounds 1 to 3 (both subject rectangles mean >= 179, both background rectangles <= 38; a mode passes on 3 of 4 photos).
 * The prompts were fixed in prompts.json before any of these models ran. It downloads about 150 MB, so it runs in CI only
 * (.github/workflows/model-check.yml), never in `npm test`. The real product steps run here: segment.ts and process.ts.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import sharp from 'sharp';
import { it } from 'vitest';
import { MODELS } from '../src/models';
import { maskFromPrediction, maskInput, type Rgba } from '../src/process';
import { asType, deepestPoint, segEncoderInput, segMask, segOutputs, segPromptFeeds, unionMask, type SegLayout, type SegPick, type SegPrompt, type TensorSpec } from '../src/segment';

const here = (f: string): string => fileURLToPath(new URL(f, import.meta.url));
const OUT = here('./out/');
const UA = { 'User-Agent': 'free-photo-editor-model-check/1.0 (https://github.com/Starvolate/free-photo-editor)' };
type Rect = [number, number, number, number];
const regions = JSON.parse(readFileSync(here('./regions.json'), 'utf8')) as Record<string, { subject: Rect[]; background: Rect[] }>;
const photos = JSON.parse(readFileSync(here('./photos.json'), 'utf8')) as Record<string, string>;
const names = Object.keys(photos);

interface Part { url: string; bytes: number; sha256: string; data?: { url: string; bytes: number; sha256: string } }
interface Candidate { name: string; layout: SegLayout; licence: string; encoder: Part; decoder: Part }
const HF = (repo: string, commit: string, file: string): string => `https://huggingface.co/${repo}/resolve/${commit}/${file}`;
const SLIM = (f: string): string => HF('Xenova/slimsam-77-uniform', '5850ab45f587c112167512ffef949107115e26a0', f);
const MOB = (f: string): string => HF('Acly/MobileSAM', '0d3b403339b4674a82493d5e97964dd78089ddc8', f);
const EFF = (f: string): string => HF('yunyangx/EfficientSAM', '1cf49585c39567bfc49e991ab8eb31f491ad4877', f);
const SAM2 = (f: string): string => HF('onnx-community/sam2.1-hiera-tiny-ONNX', '814a066640debee5a91e70aa401fb8e17e030503', f);
const CANDIDATES: Candidate[] = [
  { name: 'SlimSAM-77 (quantized)', layout: 'sam', licence: 'https://github.com/czg1225/SlimSAM/blob/master/LICENSE',
    encoder: { url: SLIM('onnx/vision_encoder_quantized.onnx'), bytes: 8_882_165, sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971' },
    decoder: { url: SLIM('onnx/prompt_encoder_mask_decoder_quantized.onnx'), bytes: 4_903_810, sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2' } },
  { name: 'MobileSAM', layout: 'sam-onnx', licence: 'https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE',
    encoder: { url: MOB('mobile_sam_image_encoder.onnx'), bytes: 28_157_093, sha256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749' },
    decoder: { url: MOB('sam_mask_decoder_multi.onnx'), bytes: 16_496_559, sha256: '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe' } },
  { name: 'EfficientSAM-Ti', layout: 'efficientsam', licence: 'https://github.com/yformer/EfficientSAM/blob/main/LICENSE',
    encoder: { url: EFF('efficientsam_ti_encoder.onnx'), bytes: 24_799_761, sha256: '84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951' },
    decoder: { url: EFF('efficientsam_ti_decoder.onnx'), bytes: 16_565_728, sha256: 'a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11' } },
  { name: 'SAM 2.1 tiny (quantized)', layout: 'sam2', licence: 'https://github.com/facebookresearch/sam2/blob/main/LICENSE',
    encoder: { url: SAM2('onnx/vision_encoder_quantized.onnx'), bytes: 441_167, sha256: '8800fdd04b9045cb6060ba8962b83c78ce9bb0976da8f030afa073467a888524',
      data: { url: SAM2('onnx/vision_encoder_quantized.onnx_data'), bytes: 52_573_088, sha256: 'ea1f677596dc82cef0dc317d78135d892f4b26e20a4439f899aa58d84965b324' } },
    decoder: { url: SAM2('onnx/prompt_encoder_mask_decoder_quantized.onnx'), bytes: 290_416, sha256: 'a5f31dba5a7f03203dc3a130fdd7766f0fea952eb4aac1f55458549170eb51ff',
      data: { url: SAM2('onnx/prompt_encoder_mask_decoder_quantized.onnx_data'), bytes: 8_662_016, sha256: 'fdb3179a32388267a944a416c0f992c77a138b69a4bfd94f0bbf7089430d7489' } } },
];

async function download(f: { url: string; bytes: number; sha256: string }): Promise<Uint8Array> {
  const r = await fetch(f.url, { headers: UA });
  if (!r.ok) throw new Error(`${f.url}: HTTP ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer()), sum = createHash('sha256').update(b).digest('hex');
  if (b.length !== f.bytes || sum !== f.sha256) throw new Error(`${f.url}: got ${b.length} bytes, sha256 ${sum}`);
  return b;
}
async function session(p: Part): Promise<ort.InferenceSession> {
  const model = await download(p), file = p.data ? p.data.url.split('/').pop() as string : '';
  return ort.InferenceSession.create(model, p.data ? { externalData: [{ path: file, data: await download(p.data) }] } : {});
}
const describe = (s: ort.InferenceSession): string => {
  const f = (m: readonly ort.InferenceSession.ValueMetadata[]): string => m.map((x) => x.isTensor ? `${x.name}:${x.type}[${x.shape.join(',')}]` : x.name).join(' ');
  return `in ${f(s.inputMetadata)} | out ${f(s.outputMetadata)}`;
};
const tensor = (t: TensorSpec): ort.Tensor => new ort.Tensor(t.type, t.data, t.dims);
const typeOf = (s: ort.InferenceSession, name: string): string | undefined => {
  const m = s.inputMetadata.find((x) => x.name === name);
  return m && m.isTensor ? m.type : undefined;
};

/** A Commons photo at 640 px on its long side, as in rounds 1 to 3: the Commons rendition, or the original made smaller here. */
async function photo(title: string): Promise<{ src: Rgba; how: string; licence: string }> {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName&iiurlwidth=640&iiurlheight=640&titles=${encodeURIComponent('File:' + title)}`;
  const q = await (await fetch(api, { headers: UA })).json() as { query: { pages: Record<string, { imageinfo: { url: string; thumburl?: string; extmetadata?: { LicenseShortName?: { value: string } } }[] }> } };
  const info = Object.values(q.query.pages)[0].imageinfo[0], licence = info.extmetadata?.LicenseShortName?.value ?? '?';
  let how = 'Commons 640 px rendition', bytes: Buffer | null = null;
  if (info.thumburl) { const r = await fetch(info.thumburl, { headers: UA }); if (r.ok) bytes = Buffer.from(await r.arrayBuffer()); }
  let img = bytes ? sharp(bytes).rotate() : null;
  const meta = img ? await img.metadata() : null;
  if (!img || !meta || Math.max(meta.width ?? 0, meta.height ?? 0) !== 640) {
    how = 'original, made 640 px here';
    img = sharp(Buffer.from(await (await fetch(info.url, { headers: UA })).arrayBuffer())).rotate().resize({ width: 640, height: 640, fit: 'inside' });
  }
  const { data, info: o } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (Math.max(o.width, o.height) !== 640) throw new Error(`${title}: long side ${Math.max(o.width, o.height)}, not 640`);
  return { src: { width: o.width, height: o.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }, how, licence };
}

const mean = (m: Uint8Array, w: number, [x, y, rw, rh]: Rect): number => { let s = 0; for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) s += m[j * w + i]; return Math.round(s / (rw * rh)); };
const centre = ([x, y, w, h]: Rect): SegPrompt => ({ points: [{ x: x + w / 2, y: y + h / 2, add: true }] });
interface Score { s: number[]; b: number[]; pass: boolean }
function score(n: string, m: Uint8Array, w: number): Score {
  const s = regions[n].subject.map((r) => mean(m, w, r)), b = regions[n].background.map((r) => mean(m, w, r));
  return { s, b, pass: s.every((v) => v >= 179) && b.every((v) => v <= 38) };
}
const MODES = ['tap A', 'tap B', 'subject, largest', 'subject, best'] as const;

/** One row per mode, one tile per photo: the photo where the mask keeps it, a grey check where it does not. */
async function sheet(file: string, rows: Uint8Array[][], pics: Rgba[]): Promise<void> {
  const T = 320, N = pics.length, H = rows.length, out = Buffer.alloc(T * N * T * H * 4), W = T * N;
  rows.forEach((row, r) => pics.forEach((c, k) => {
    const m = row[k], sc = Math.min(T / c.width, T / c.height), w = Math.round(c.width * sc), h = Math.round(c.height * sc), ox = k * T + ((T - w) >> 1), oy = r * T + ((T - h) >> 1);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = ((r * T + y) * W + k * T + x) * 4, g = ((x >> 4) + (y >> 4)) & 1 ? 200 : 150; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255; }
    if (!m) return;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const yy = Math.min(c.height - 1, Math.floor(y / sc)), xx = Math.min(c.width - 1, Math.floor(x / sc)), i = (yy * c.width + xx) * 4, a = m[yy * c.width + xx] / 255, o = ((oy + y) * W + ox + x) * 4;
      for (let q = 0; q < 3; q++) out[o + q] = Math.round(c.data[i + q] * a + out[o + q] * (1 - a));
    }
  }));
  writeFileSync(OUT + file, await sharp(out, { raw: { width: W, height: T * H, channels: 4 } }).png().toBuffer());
}

it('round 4: Segment Anything family on the four photos', async () => {
  mkdirSync(OUT, { recursive: true });
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
  const log: string[] = [], say = (s: string): void => { console.log(s); log.push(s); };
  const pics: Rgba[] = [];
  for (const n of names) { const p = await photo(photos[n]); pics.push(p.src); say(`${n}: ${p.src.width} x ${p.src.height}, ${p.how}, licence ${p.licence}`); }

  // The shipped subject model (u2netp, pinned in models.ts), whose answer prompts the "subject" modes.
  const u2 = await session({ url: MODELS.subject.url, bytes: MODELS.subject.bytes, sha256: MODELS.subject.sha256 as string });
  const subj: Uint8Array[] = [];
  for (const src of pics) {
    const out = await u2.run({ [u2.inputNames[0]]: new ort.Tensor('float32', maskInput(src, 320), [1, 3, 320, 320]) });
    subj.push(maskFromPrediction(out[u2.outputNames[0]].data as Float32Array, 320, 320, src.width, src.height));
  }
  say(`u2netp alone: ${names.map((n, k) => { const r = score(n, subj[k], pics[k].width); return `${n} ${r.s}|${r.b} ${r.pass ? 'pass' : 'FAIL'}`; }).join('  ')}`);
  await sheet('u2netp.png', [subj], pics);

  const results: Record<string, unknown> = {};
  for (const c of CANDIDATES) {
    try {
      const enc = await session(c.encoder), dec = await session(c.decoder);
      say(`\n## ${c.name} (${c.layout}), licence ${c.licence}`);
      say(`encoder ${describe(enc)}`);
      say(`decoder ${describe(dec)}`);
      const rows: Uint8Array[][] = MODES.map(() => []), table: Record<string, Score[]> = {}, encMs: number[] = [], decMs: number[] = [];
      for (const [k, n] of names.entries()) {
        const src = pics[k], { width: w, height: h } = src, e = segEncoderInput(c.layout, src);
        let t = performance.now();
        const emb = await enc.run({ [enc.inputNames[0]]: tensor(e) });
        encMs.push(Math.round(performance.now() - t));
        const decode = async (p: SegPrompt, pick: SegPick): Promise<Uint8Array> => {
          const feeds: Record<string, ort.Tensor> = {}, spec = segPromptFeeds(c.layout, p, w, h);
          for (const name of dec.inputNames) {
            if (emb[name]) feeds[name] = emb[name];
            else if (spec[name]) feeds[name] = tensor(spec[name].type === typeOf(dec, name) ? spec[name] : asType(spec[name], typeOf(dec, name)));
            else throw new Error(`no value for decoder input ${name}`);
          }
          t = performance.now();
          const o = await dec.run(feeds), on = segOutputs(dec.outputNames);
          decMs.push(Math.round(performance.now() - t));
          return segMask(c.layout, { data: o[on.masks].data as Float32Array, dims: o[on.masks].dims }, o[on.scores].data as Float32Array, w, h, pick);
        };
        const r = regions[n], deep = deepestPoint(subj[k], w, h);
        const masks = [
          await decode(centre(r.subject[0]), 'best'),
          await decode(centre(r.subject[1]), 'best'),
          deep ? unionMask(subj[k], await decode({ points: [deep] }, 'largest')) : subj[k],
          deep ? unionMask(subj[k], await decode({ points: [deep] }, 'best')) : subj[k],
        ];
        masks.forEach((m, i) => { rows[i].push(m); (table[MODES[i]] ??= []).push(score(n, m, w)); });
      }
      for (const mode of MODES) {
        const s = table[mode], passed = s.filter((x) => x.pass).length;
        say(`${mode}: ${passed} of ${names.length}  ${names.map((n, k) => `${n} ${s[k].s}|${s[k].b} ${s[k].pass ? 'pass' : 'FAIL'}`).join('  ')}`);
      }
      say(`time: encoder ${encMs.join(', ')} ms; decoder median ${decMs.sort((a, b) => a - b)[decMs.length >> 1]} ms; process memory ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
      results[c.name] = { layout: c.layout, licence: c.licence, table, encMs, decMs };
      await sheet(`${c.layout}.png`, rows, pics);
      await enc.release();
      await dec.release();
    } catch (e) {
      say(`\n## ${c.name}: DID NOT RUN: ${e instanceof Error ? e.message : String(e)}`);
      results[c.name] = { error: String(e) };
    }
  }
  writeFileSync(OUT + 'results.json', JSON.stringify(results, null, 1));
  writeFileSync(OUT + 'results.txt', log.join('\n') + '\n');
});
