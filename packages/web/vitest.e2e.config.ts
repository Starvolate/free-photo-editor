// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The headless browser test only (`npm run e2e`). The unit tests use the root vitest.config.ts. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['e2e/**/*.e2e.test.ts'], testTimeout: 60_000, hookTimeout: 90_000, fileParallelism: false },
});
