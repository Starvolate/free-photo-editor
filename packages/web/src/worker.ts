// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Heavy pixel work off the main thread, so touch and pen input never freeze. */
import { runJob, type JobSpec } from '@free-photoeditor/core';

interface Msg { id: number; spec: JobSpec; width: number; height: number; buffer: ArrayBuffer; }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
scope.onmessage = (e) => {
  const { id, spec, width, height, buffer } = e.data;
  try {
    const out = runJob(spec, { width, height, data: new Uint8ClampedArray(buffer) });
    scope.postMessage({ id, buffer: out.buffer }, [out.buffer as ArrayBuffer]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
