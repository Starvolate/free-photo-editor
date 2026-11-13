// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The MCP export tool's dpi and printSize options, called the way an agent calls them. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { jpegSampling, readJpegDpi, readPngDpi } from '@free-photoeditor/core';
import { pattern, readPng, tempDir, writePng } from '../../cli/test/helpers';
import { createServer } from '../src/server';

type Res = { isError?: boolean; content: { type: string; text?: string }[] };
describe('the MCP server and print resolution', () => {
  it('export takes dpi (and printSize), writes it into the file and reports it', async () => {
    const dir = tempDir();
    writePng(path.join(dir, 'a.png'), { width: 600, height: 400, data: pattern(600, 400, false) });
    const { server } = await createServer({ folders: [dir] }), [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(a);
    const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      JSON.parse(((await c.callTool({ name: 'export', arguments: args })) as Res).content[0].text ?? '{}');
    expect(await call({ path: 'a.png', format: 'jpeg', quality: 1, dpi: 300, output: 'a-300.jpg' })).toMatchObject({ ok: true, dpi: 300, width: 600, height: 400 });
    const jpg = new Uint8Array(readFileSync(path.join(dir, 'a-300.jpg')));
    expect([readJpegDpi(jpg), jpegSampling(jpg)]).toEqual([300, '4:4:4']);
    expect(await call({ path: 'a.png', format: 'png', dpi: 300, printSize: '10x15cm', output: 'print.png' })).toMatchObject({ ok: true, dpi: 300, width: 1181, height: 1772 });
    expect([readPng(path.join(dir, 'print.png')).height, readPngDpi(new Uint8Array(readFileSync(path.join(dir, 'print.png'))))]).toEqual([1772, 300]);
    const { tools } = await c.listTools(), ex = tools.find((t) => t.name === 'export') as unknown as { inputSchema: { properties: Record<string, { description?: string }> } };
    expect(ex.inputSchema.properties.dpi.description).toMatch(/dots per inch/);
  });
});
