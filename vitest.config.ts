// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts'], environment: 'node', testTimeout: 30000 },
});
