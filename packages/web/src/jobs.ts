// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Runs engine jobs in a Web Worker, falling back to the main thread if workers are unavailable. */
import { runJob, type Bitmap, type JobSpec } from '@free-photoeditor/core';

interface Waiter { res: (d: Uint8ClampedArray) => void; rej: (e: Error) => void; }
export class JobRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, Waiter>();
  constructor() {
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
  }
  /** Runs on a copy of `src`, so the caller's pixels stay untouched. */
  run(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray> {
    const local = (): Promise<Uint8ClampedArray> => new Promise((res) => setTimeout(() => res(runJob(spec, src)), 0));
    const w = this.worker;
    if (!w) return local();
    const id = ++this.seq, copy = src.data.slice();
    return new Promise<Uint8ClampedArray>((res, rej) => {
      this.waiting.set(id, { res, rej });
      w.postMessage({ id, spec, width: src.width, height: src.height, buffer: copy.buffer }, [copy.buffer as ArrayBuffer]);
    }).catch(local);
  }
  private fail(): void {
    const w = this.worker;
    this.worker = null;
    w?.terminate();
    for (const p of this.waiting.values()) p.rej(new Error('worker stopped'));
    this.waiting.clear();
  }
  dispose(): void { this.worker?.terminate(); this.worker = null; this.waiting.clear(); }
}
