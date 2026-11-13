// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Heavy pixel work off the main thread, so touch and pen input never freeze. Filter families load on first use. */
import { runJob, type Bitmap, type JobSpec } from '@free-photoeditor/core';

interface Msg { id: number; spec: JobSpec; width: number; height: number; buffer: ArrayBuffer; }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
async function work(spec: JobSpec, src: Bitmap): Promise<Uint8ClampedArray> {
  if (spec.op !== 'fx') return runJob(spec, src);
  const fx = await import('@free-photoeditor/core/fx');
  return fx.runEffect(spec, src);
}
scope.onmessage = (e) => {
  const { id, spec, width, height, buffer } = e.data;
  work(spec, { width, height, data: new Uint8ClampedArray(buffer) }).then(
    (out) => scope.postMessage({ id, buffer: out.buffer }, [out.buffer as ArrayBuffer]),
    (err: unknown) => scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  );
};
