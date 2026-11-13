// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Types for the add-on libraries that ship without their own. */
declare module 'gifenc' {
  export type Palette = number[][];
  export interface FrameOptions { palette?: Palette; delay?: number; transparent?: boolean; transparentIndex?: number; repeat?: number; dispose?: number; first?: boolean; }
  export interface Encoder { writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void; finish(): void; bytes(): Uint8Array; }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' { const factory: (opts?: object) => unknown; export default factory; }
declare module 'pdfjs-dist/build/pdf.worker.mjs' { export const WorkerMessageHandler: unknown; }
