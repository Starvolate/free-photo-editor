// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Free Photo Editor's on-device AI add-on, loaded only when an AI command is first used. The work runs in a Web Worker on
 * this device: the engine and each model download once from their public hosts and are kept in the browser, and the
 * photo never leaves the device.
 */
import { ENGINE, MODELS, type ModelId } from './models';
import type { Box, Rgba } from './process';
import type { SegPick, SegPrompt } from './segment';
import type { FromWorker, Progress, ToWorker } from './protocol';
import { hasFile } from './store';

export { ENGINE, MODELS, ORT_VERSION, type FileDef, type ModelDef, type ModelId } from './models';
export type { Progress, Stage } from './protocol';
export * from './process';
export * from './segment';

export class Cancelled extends Error { constructor() { super('Stopped.'); this.name = 'Cancelled'; } }
/** Why this browser can't run the AI tools, in plain words, or null when it can. */
export function cannotRun(): string | null {
  return typeof WebAssembly === 'object' && typeof Worker === 'function' && typeof fetch === 'function' ? null
    : "This browser can't run the AI tools. Try a recent Chrome, Edge, Firefox or Safari.";
}
/** About how many bytes the first use of `model` downloads (0 when the engine and the model are already on this device). */
export async function downloadSize(model: ModelId, loaded = false): Promise<number> {
  if (loaded) return 0;
  let n = 0;
  const m = MODELS[model];
  for (const f of [ENGINE, m, ...(m.decoder ? [m.decoder] : [])]) if (!(await hasFile(f.url))) n += f.transfer;
  return n;
}
/** Megabytes in plain words: one decimal under 10. */
export const mb = (bytes: number): string => { const v = bytes / 1e6; return String(v < 10 ? Math.max(0.1, Math.round(v * 10) / 10) : Math.round(v)); };
/**
 * About how long a job takes, in seconds, before it starts. Making a picture bigger costs about `pace` seconds per picture
 * pixel: 60 microseconds as measured on one WebAssembly thread, or what the last job's first tile measured on this device.
 * Finding the subject or filling a gap takes a second or two.
 */
export function estimateSeconds(job: ModelId, pixels: number, pace = 6e-5): number {
  return job === 'upscale' ? pixels * pace : 2;
}
/** Over this many seconds a job says how long it takes, in minutes, before the long part runs. */
export const WARN_SECONDS = 30;
/** Over this many seconds (about 20 minutes) a job is refused as too slow for this device. */
export const REFUSE_SECONDS = 20 * 60;
/** Go ahead quietly, warn with the time in minutes, or refuse. */
export function timeVerdict(secs: number): 'go' | 'warn' | 'refuse' {
  return secs > REFUSE_SECONDS ? 'refuse' : secs > WARN_SECONDS ? 'warn' : 'go';
}
/**
 * The whole job's time in seconds, extrapolated from how it started: `ms` from the start of the work (the download and the
 * loading left out) to the `done`th of `total` tiles. The first tile also pays for warming up, so this errs on the long side.
 */
export function extrapolateSeconds(ms: number, done: number, total: number): number {
  return done > 0 && total > 0 ? (ms / 1000) * (total / done) : 0;
}
/** Whole minutes in plain words, rounded up: "about 1 minute", "about 4 minutes". */
export function minutesText(secs: number): string {
  const m = Math.max(1, Math.ceil(secs / 60));
  return `about ${m} minute${m === 1 ? '' : 's'}`;
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
  /** Download what is missing (once) and load the model. Resolves with the same-origin files the worker loaded, for the offline worker to keep. */
  async prepare(model: ModelId, progress?: (p: Progress) => void): Promise<string[]> {
    const r = await this.call({ type: 'prepare', model }, progress);
    this.loaded.add(model);
    return r.type === 'ready' ? r.files : [];
  }
  /** A mask (0 to 255, one byte per pixel) of the main subject. */
  async subject(src: Rgba, progress?: (p: Progress) => void): Promise<Uint8Array> {
    const r = await this.call({ type: 'subject', src }, progress, [buf(src.data)]);
    if (r.type !== 'mask') throw new Error('The AI gave an unexpected answer.');
    return r.mask;
  }
  /**
   * A mask (0 or 255) of the thing at the taps, or inside the box. The picture is read once per picture state, so later taps
   * on the same picture answer quickly. `clip` keeps only what lies inside a box.
   */
  async segment(src: Rgba, prompt: SegPrompt, pick: SegPick = 'best', clip: Box | null = null): Promise<Uint8Array> {
    const r = await this.call({ type: 'segment', src, prompt, pick, clip }, undefined, [buf(src.data)]);
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
