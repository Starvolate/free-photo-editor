// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { defineConfig } from 'vite';

/** One Node file: the engine and the web app's function map are bundled in; sharp and ag-psd stay npm dependencies. */
export default defineConfig({
  build: {
    ssr: 'src/bin.ts', target: 'node20', outDir: 'dist', emptyOutDir: true, minify: false, sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'cli.js', banner: '#!/usr/bin/env node', inlineDynamicImports: true } },
  },
  ssr: { noExternal: [/^@free-photoeditor\//], external: ['sharp', 'ag-psd'] },
});
