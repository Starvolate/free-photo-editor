// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Runs engine jobs in a Web Worker, falling back to the main thread if workers are unavailable. The worker starts on
 * the first job, and the filter families load inside it only when a filter first runs, so the first screen stays small.
 */
import { runJob, type Bitmap, type JobSpec } from '@free-photoeditor/core';

/** The job was stopped with Cancel: there is no result, and it is not run again on the main thread. */
export class JobStopped extends Error { constructor() { super('Stopped.'); } }
interface Waiter { res: (d: Uint8ClampedArray) => void; rej: (e: Error) => void; }
/** The same work on this thread, with the filter families loaded on first use. */
async function runHere(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray> {
  if (spec.op !== 'fx') return runJob(spec, src);
  const fx = await import('@free-photoeditor/core/fx');
  return fx.runEffect(spec, src);
}
export class JobRunner {
  private worker: Worker | null = null;
  private tried = false;
  private seq = 0;
  private waiting = new Map<number, Waiter>();
  private start(): Worker | null {
    if (this.tried) return this.worker;
    this.tried = true;
    try {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; buffer?: ArrayBuffer; error?: string }>) => {
        const p = this.waiting.get(e.data.id);
        if (!p) return;
        this.waiting.delete(e.data.id);
        if (e.data.buffer) p.res(new Uint8ClampedArray(e.data.buffer)); else p.rej(new Error(e.data.error || 'The job failed.'));
      };
      w.onerror = () => this.fail();
      this.worker = w;
    } catch { this.worker = null; }
    return this.worker;
  }
  /** Runs on a copy of `src`, so the caller's pixels stay untouched. */
  run(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray> {
    const local = (): Promise<Uint8ClampedArray> => new Promise((res, rej) => setTimeout(() => { runHere(spec, src).then(res, rej); }, 0));
    const w = this.start();
    if (!w) return local();
    const id = ++this.seq, copy = src.data.slice();
    return new Promise<Uint8ClampedArray>((res, rej) => {
      this.waiting.set(id, { res, rej });
      w.postMessage({ id, spec, width: src.width, height: src.height, buffer: copy.buffer }, [copy.buffer as ArrayBuffer]);
    }).catch((e: unknown) => { if (e instanceof JobStopped) throw e; return local(); });
  }
  /** Cancel: ends the worker at once (its work is dropped) and fails every waiting job with JobStopped; the next job starts a new worker. */
  stop(): void {
    const w = this.worker;
    this.worker = null;
    this.tried = false;
    w?.terminate();
    for (const p of this.waiting.values()) p.rej(new JobStopped());
    this.waiting.clear();
  }
  private fail(): void {
    const w = this.worker;
    this.worker = null;
    w?.terminate();
    for (const p of this.waiting.values()) p.rej(new Error('worker stopped'));
    this.waiting.clear();
  }
  dispose(): void { this.worker?.terminate(); this.worker = null; this.tried = true; this.waiting.clear(); }
}
