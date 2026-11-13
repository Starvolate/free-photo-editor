// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** W6 parity through the MCP server: its `layers` flatten of the shared fixture gives the golden pixels (design 5). */
import { copyFileSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { readPng, tempDir } from '../../cli/test/helpers';
import { sha256 } from '../../cli/test/make-w6-fixture';
import { createServer } from '../src/server';

const BASE = fileURLToPath(new URL('../../cli/test/fixtures/w6-layers', import.meta.url));

describe('W6 layers fixture through the MCP server', () => {
  it('layers flatten gives the golden pixels', async () => {
    const dir = realpathSync(tempDir()), src = path.join(dir, 'w6-layers.psd'), out = path.join(dir, 'w6-flat.png');
    copyFileSync(BASE + '.psd', src);
    const { server } = await createServer({ folders: [dir] }), [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(a);
    const res = (await client.callTool({ name: 'layers', arguments: { path: src, action: 'flatten', output: out } })) as { isError?: boolean; content: { text?: string }[] };
    expect(res.isError ?? false, res.content[0]?.text).toBe(false);
    expect(sha256(readPng(out).data)).toBe(readFileSync(BASE + '.flat.sha256', 'utf8').trim());
  });
});
