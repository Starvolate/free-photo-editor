// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The model check runs on its own (CI only, it downloads about 150 MB): `npx vitest run --config packages/ai/model-check/vitest.config.ts`. */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: { include: ['packages/ai/model-check/*.check.ts'], environment: 'node', testTimeout: 3_600_000 },
});
