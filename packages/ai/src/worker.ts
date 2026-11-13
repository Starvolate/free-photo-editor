// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The AI worker. ONNX Runtime Web's loader is bundled into this file; its engine (.wasm) and each model download once (kept
 * in IndexedDB, checked by size and SHA-256), so after the first use the AI runs without the internet. The models run on
 * WebAssembly with one thread, away from the editor's main thread so the editor never freezes, and progress and results
 * go back to the editor. Pressing Cancel ends the whole worker at once. Nothing here sends the photo anywhere.
 */
import * as ortWasm from 'onnxruntime-web/wasm';
import { ENGINE, MODELS, type FileDef, type ModelId } from './models';
import type { OrtModule, OrtSession, OrtTensor } from './ort';
import { halve, inpaintInputs, maskFromPrediction, maskInput, upscaleTiled, type Rgba } from './process';
import type { FromWorker, ToWorker } from './protocol';
import { getFile, putFile } from './store';

interface Scope { postMessage(m: FromWorker, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null; location: { href: string; origin: string }; }
const scope = self as unknown as Scope;
const SUBJECT_SIZE = 320;
let ort: OrtModule | null = null;
const sessions = new Map<ModelId, OrtSession>();
const post = (m: FromWorker, t: Transferable[] = []): void => scope.postMessage(m, t);
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

async function fetchFile(f: FileDef, onBytes: (n: number) => void): Promise<Uint8Array> {
  const kept = await getFile(f.url);
  if (kept && kept.length === f.bytes) { onBytes(f.bytes); return kept; }
  let res: Response;
  try { res = await fetch(f.url, { credentials: 'omit' }); } catch { throw new Error('The download could not start. Check the internet connection and try again.'); }
  if (!res.ok || !res.body) throw new Error(`The download failed (error ${res.status}). Try again later.`);
  const reader = res.body.getReader(), buf = new Uint8Array(f.bytes);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > buf.length) throw new Error('The download was not the file we checked, so nothing was run.');
    buf.set(value, at);
    at += value.length;
    onBytes(at);
  }
  if (at !== f.bytes) throw new Error('The download stopped part way. Try again.');
  const subtle = globalThis.crypto?.subtle;
  if (f.sha256 && subtle && hex(await subtle.digest('SHA-256', buf)) !== f.sha256) throw new Error('The download was not the file we checked, so nothing was run.');
  await putFile(f.url, buf);
  return buf;
}
/** This worker's own files under the editor's folder (its script), which the page's list of loaded files does not show. */
function ownFiles(): string[] {
  const names = [scope.location.href, ...performance.getEntriesByType('resource').map((e) => e.name)].map((u) => u.split('#')[0]);
  return [...new Set(names)].filter((u) => u.startsWith(scope.location.origin + '/'));
}
async function prepare(id: number, model: ModelId): Promise<void> {
  const files: FileDef[] = [...(ort ? [] : [ENGINE]), ...(sessions.has(model) ? [] : [MODELS[model]])];
  const total = files.reduce((a, f) => a + f.bytes, 0), got: Uint8Array[] = [];
  let base = 0, last = -1;
  for (const f of files) {
    got.push(await fetchFile(f, (n) => {
      const pct = Math.floor(((base + n) / total) * 100);
      if (pct !== last) { last = pct; post({ type: 'progress', id, stage: 'download', done: base + n, total }); }
    }));
    base += f.bytes;
  }
  post({ type: 'progress', id, stage: 'start', done: 0, total: 0 });
  if (!ort) {
    const mod = ortWasm as unknown as OrtModule;
    mod.env.wasm.numThreads = 1;
    mod.env.wasm.wasmBinary = got.shift() as Uint8Array;
    mod.env.logLevel = 'error';
    ort = mod;
  }
  if (!sessions.has(model)) sessions.set(model, await (ort as OrtModule).InferenceSession.create(got.shift() as Uint8Array, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
  post({ type: 'ready', id, files: ownFiles() });
}
const T = (type: string, data: Float32Array | Uint8Array, dims: number[]): OrtTensor => new (ort as OrtModule).Tensor(type, data, dims);
async function run(model: ModelId, feeds: (s: OrtSession) => Record<string, OrtTensor>): Promise<{ out: Record<string, OrtTensor>; s: OrtSession }> {
  const s = sessions.get(model);
  if (!s) throw new Error('The AI is not ready yet.');
  return { out: await s.run(feeds(s)), s };
}
async function subject(src: Rgba): Promise<Uint8Array> {
  const input = maskInput(src, SUBJECT_SIZE);
  const { out, s } = await run('subject', (x) => ({ [x.inputNames[0]]: T('float32', input, [1, 3, SUBJECT_SIZE, SUBJECT_SIZE]) }));
  return maskFromPrediction(out[s.outputNames[0]].data as Float32Array, SUBJECT_SIZE, SUBJECT_SIZE, src.width, src.height);
}
async function inpaint(src: Rgba, hole: Uint8Array): Promise<Uint8Array> {
  const { image, keep } = inpaintInputs(src, hole), { width: w, height: h } = src;
  const { out, s } = await run('inpaint', (x) => {
    const found = x.inputNames.findIndex((n) => /mask/i.test(n)), m = found < 0 ? 1 : found, i = m === 0 ? 1 : 0;
    return { [x.inputNames[i]]: T('uint8', image, [1, 3, h, w]), [x.inputNames[m]]: T('uint8', keep, [1, 1, h, w]) };
  });
  return new Uint8Array(out[s.outputNames[0]].data as Uint8Array);
}
async function upscale(id: number, src: Rgba, factor: 2 | 4): Promise<Rgba> {
  const big = await upscaleTiled(src, 4, async (planes, w, h) => {
    const { out, s } = await run('upscale', (x) => ({ [x.inputNames[0]]: T('float32', planes, [1, 3, h, w]) }));
    return out[s.outputNames[0]].data as Float32Array;
  }, { tile: 128, pad: 10, onTile: (done, total) => post({ type: 'progress', id, stage: 'work', done, total }) });
  return factor === 2 ? halve(big) : big;
}
scope.onmessage = (e) => {
  const m = e.data;
  void (async () => {
    try {
      if (m.type === 'prepare') await prepare(m.id, m.model);
      else if (m.type === 'subject') { const mask = await subject(m.src); post({ type: 'mask', id: m.id, mask }, [mask.buffer as ArrayBuffer]); }
      else if (m.type === 'inpaint') { const rgb = await inpaint(m.src, m.hole); post({ type: 'fill', id: m.id, rgb }, [rgb.buffer as ArrayBuffer]); }
      else { const image = await upscale(m.id, m.src, m.factor); post({ type: 'image', id: m.id, image }, [image.data.buffer as ArrayBuffer]); }
    } catch (err) {
      post({ type: 'error', id: m.id, message: err instanceof Error && err.message ? err.message : String(err) });
    }
  })();
};
