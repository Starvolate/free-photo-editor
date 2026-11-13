// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The small part of ONNX Runtime Web's API the add-on uses. Its loader is bundled into the AI worker (worker.ts); the engine file downloads once (models.ts). */
export interface OrtTensor { readonly data: unknown; readonly dims: readonly number[]; readonly type: string; }
export interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export interface OrtModule {
  env: { logLevel?: string; wasm: { numThreads?: number; wasmBinary?: ArrayBufferLike | Uint8Array; proxy?: boolean } };
  Tensor: new (type: string, data: Float32Array | Uint8Array, dims: readonly number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, options?: { executionProviders?: string[]; graphOptimizationLevel?: string }): Promise<OrtSession> };
}
