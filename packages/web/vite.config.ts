// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { defineConfig } from 'vite';
import { pwa } from './scripts/pwa';

export default defineConfig({
  // The folder the app is served from. './' works in any folder reached with a trailing slash; set FPE_BASE (for example
  // /tools/free-photoeditor/) to build for one fixed folder. The offline worker's scope follows the folder sw.js is in.
  base: process.env.FPE_BASE || './',
  plugins: [pwa()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, sourcemap: false, manifest: true },
  worker: { format: 'es' },
});
