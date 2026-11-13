// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Messages between the editor and the AI worker. */
import type { Backend, ModelId } from './models';
import type { Rgba } from './process';

export type Stage = 'download' | 'start' | 'work';
export interface Progress { stage: Stage; done: number; total: number; }
export type ToWorker =
  | { type: 'prepare'; id: number; model: ModelId; backend: Backend }
  | { type: 'subject'; id: number; src: Rgba }
  | { type: 'inpaint'; id: number; src: Rgba; hole: Uint8Array }
  | { type: 'upscale'; id: number; src: Rgba; factor: 2 | 4 };
export type FromWorker =
  | ({ type: 'progress'; id: number } & Progress)
  | { type: 'ready'; id: number; backend: Backend }
  | { type: 'mask'; id: number; mask: Uint8Array }
  | { type: 'fill'; id: number; rgb: Uint8Array }
  | { type: 'image'; id: number; image: Rgba }
  | { type: 'error'; id: number; message: string };
