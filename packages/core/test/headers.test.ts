// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
describe('licence headers', () => {
  it('every source file starts with the AGPL-3.0 and copyright lines', () => {
    const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
      .split('\n').filter((f) => /\.(ts|mjs|js|css|html|ya?ml)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.filter((f) => {
      const head = readFileSync(root + '/' + f, 'utf8').split('\n').slice(0, 3).join('\n');
      return !head.includes('SPDX-License-Identifier: AGPL-3.0-only') || !head.includes('Copyright (C) 2026 Bhawesh Tibrewal');
    });
    expect(bad).toEqual([]);
  });
});
