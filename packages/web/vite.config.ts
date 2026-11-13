// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { defineConfig, type Plugin } from 'vite';
import { HELP_ID, helpSplit } from './scripts/help-split';
import { pwa } from './scripts/pwa';

/**
 * ONNX Runtime Web's loader, bundled into the AI worker, names its engine file with
 * `new URL("ort-wasm-simd-threaded.wasm", import.meta.url)`, which would make the bundler copy that 14.8 MB file into dist.
 * The editor downloads it once from jsDelivr instead (packages/ai/src/models.ts) and hands it to the loader, so the name is
 * hidden from the bundler. The build stops if a new ONNX Runtime version changes the pattern.
 */
function engineFromCdn(): Plugin {
  const from = 'new URL("ort-wasm-simd-threaded.wasm",import.meta.url)';
  return {
    name: 'fpe:ort-engine-from-cdn',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]onnxruntime-web[\\/]dist[\\/]ort\.wasm\.bundle\.min\.mjs$/.test(id.split('?')[0])) return null;
      if (!code.includes(from)) this.error(`onnxruntime-web changed: ${from} is gone. Check that dist gets no .wasm, then update vite.config.ts.`);
      return { code: code.split(from).join('new URL("ort-wasm-simd-threaded.wasm",String(import.meta.url))'), map: null };
    },
  };
}

export default defineConfig({
  // The folder the app is served from. './' works in any folder reached with a trailing slash; set FPE_BASE (for example
  // /tools/free-photoeditor/) to build for one fixed folder. The offline worker's scope follows the folder sw.js is in.
  base: process.env.FPE_BASE || './',
  // The help lines (help-split) are saved with the app shell at install, so help, search and tooltips work offline from
  // the first visit. Saving them is not loading them: the first screen still does not wait for them.
  plugins: [pwa({ shell: ['\0' + HELP_ID] }), engineFromCdn(), helpSplit()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, sourcemap: false, manifest: true },
  // The AI worker is bundled on its own, with its own plugins.
  worker: { format: 'es', plugins: () => [engineFromCdn()] },
});
