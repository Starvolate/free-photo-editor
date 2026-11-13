// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Free Photo Editor's on-device AI add-on, loaded only when an AI command is first used. The work runs in a Web Worker on
 * this device: the engine and each model download once from their public hosts and are kept in the browser, and the
 * photo never leaves the device.
 */
import { MODELS, RUNTIMES, type Backend, type ModelId } from './models';
import type { Rgba } from './process';
import type { FromWorker, Progress, ToWorker } from './protocol';
import { hasFile } from './store';

export { MODELS, ORT_VERSION, RUNTIMES, type Backend, type FileDef, type ModelDef, type ModelId } from './models';
export type { Progress, Stage } from './protocol';
export * from './process';

export class Cancelled extends Error { constructor() { super('Stopped.'); this.name = 'Cancelled'; } }
type GpuNav = { gpu?: { requestAdapter(): Promise<unknown> } };
/** WebGPU when the browser hands out a graphics adapter, else WebAssembly. */
export async function detectBackend(): Promise<Backend> {
  const gpu = (globalThis.navigator as unknown as GpuNav | undefined)?.gpu;
  if (!gpu) return 'wasm';
  // A browser that never answers counts as no graphics chip, so an AI command never waits on it.
  const none = new Promise<null>((resolve) => { setTimeout(() => resolve(null), 2000); });
  try { return (await Promise.race([gpu.requestAdapter(), none])) ? 'webgpu' : 'wasm'; } catch { return 'wasm'; }
}
/** Why this browser can't run the AI tools, in plain words, or null when it can. */
export function cannotRun(): string | null {
  return typeof WebAssembly === 'object' && typeof Worker === 'function' && typeof fetch === 'function' ? null
    : "This browser can't run the AI tools. Try a recent Chrome, Edge, Firefox or Safari.";
}
/** About how many bytes the first use of `model` downloads (0 when the engine and the model are already on this device). */
export async function downloadSize(model: ModelId, backend: Backend, loaded = false): Promise<number> {
  if (loaded) return 0;
  let n = 0;
  for (const f of [RUNTIMES[backend], MODELS[model]]) if (!(await hasFile(f.url))) n += f.transfer;
  return n;
}
/** Megabytes in plain words: one decimal under 10. */
export const mb = (bytes: number): string => { const v = bytes / 1e6; return String(v < 10 ? Math.max(0.1, Math.round(v * 10) / 10) : Math.round(v)); };
/**
 * About how long a job takes, in seconds. Measured on one WebAssembly thread (the slowest path): 4x enlarging costs about
 * 60 microseconds per picture pixel, finding the subject or filling a gap a second or two. WebGPU is far quicker.
 */
export function estimateSeconds(job: ModelId, pixels: number, backend: Backend): number {
  const cpu = job === 'upscale' ? pixels * 6e-5 : 2;
  return backend === 'webgpu' ? cpu / 15 : cpu;
}

type Ask = ToWorker extends infer T ? (T extends unknown ? Omit<T, 'id'> : never) : never;
interface Pending { resolve(v: FromWorker): void; reject(e: Error): void; progress?: (p: Progress) => void; }
const buf = (a: { buffer: ArrayBufferLike }): ArrayBuffer => a.buffer as ArrayBuffer;
/** The editor's handle on the AI worker. Pixel buffers passed in are handed over to the worker, so pass copies. */
export class AiClient {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly jobs = new Map<number, Pending>();
  /** Models loaded in the worker that is running now. */
  readonly loaded = new Set<ModelId>();
  private get w(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'free-photoeditor-ai' });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data, j = this.jobs.get(m.id);
      if (!j) return;
      if (m.type === 'progress') { j.progress?.(m); return; }
      this.jobs.delete(m.id);
      if (m.type === 'error') j.reject(new Error(m.message)); else j.resolve(m);
    };
    w.onerror = (e) => { e.preventDefault(); this.stop(new Error(e.message || 'The AI stopped unexpectedly.')); };
    return (this.worker = w);
  }
  private call(msg: Ask, progress?: (p: Progress) => void, transfer: Transferable[] = []): Promise<FromWorker> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.jobs.set(id, { resolve, reject, progress }); this.w.postMessage({ ...msg, id }, transfer); });
  }
  private stop(err: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.loaded.clear();
    for (const j of this.jobs.values()) j.reject(err);
    this.jobs.clear();
  }
  /** Download what is missing (once) and load the model. Resolves with the engine in use. */
  async prepare(model: ModelId, backend: Backend, progress?: (p: Progress) => void): Promise<Backend> {
    const r = await this.call({ type: 'prepare', model, backend }, progress);
    this.loaded.add(model);
    return r.type === 'ready' ? r.backend : backend;
  }
  /** A mask (0 to 255, one byte per pixel) of the main subject. */
  async subject(src: Rgba, progress?: (p: Progress) => void): Promise<Uint8Array> {
    const r = await this.call({ type: 'subject', src }, progress, [buf(src.data)]);
    if (r.type !== 'mask') throw new Error('The AI gave an unexpected answer.');
    return r.mask;
  }
  /** The picture with the `hole` (any value above 0) filled from its surroundings, as three colour planes. */
  async inpaint(src: Rgba, hole: Uint8Array, progress?: (p: Progress) => void): Promise<Uint8Array> {
    const r = await this.call({ type: 'inpaint', src, hole }, progress, [buf(src.data), buf(hole)]);
    if (r.type !== 'fill') throw new Error('The AI gave an unexpected answer.');
    return r.rgb;
  }
  /** The picture made `factor` times bigger. */
  async upscale(src: Rgba, factor: 2 | 4, progress?: (p: Progress) => void): Promise<Rgba> {
    const r = await this.call({ type: 'upscale', src, factor }, progress, [buf(src.data)]);
    if (r.type !== 'image') throw new Error('The AI gave an unexpected answer.');
    return r.image;
  }
  /** Stop at once. The downloaded files stay on this device. */
  cancel(): void { this.stop(new Cancelled()); }
}
