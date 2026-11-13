// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The MCP server with the SDK's own client, in process: its tools, two real edits, and the folder guard. */
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { CREDIT, readPngText, webpInfo } from '@free-photoeditor/core';
import { pattern, tempDir, writePng } from '../../cli/test/helpers';
import { createServer } from '../src/server';

const TOOLS = ['adjust', 'convert', 'crop', 'export', 'filter', 'flip', 'image_info', 'layers', 'list_operations', 'resize', 'rotate'];
async function connect(folders: string[], maxPixels?: number): Promise<Client> {
  const { server } = await createServer({ folders, maxPixels }), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(a);
  return client;
}
type Res = { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown>): Promise<Res> => (await c.callTool({ name, arguments: args })) as Res;
const body = (r: Res): any => JSON.parse(r.content[0].text ?? '{}');
function folder(): string {
  const dir = tempDir();
  writePng(path.join(dir, 'a.png'), { width: 24, height: 16, data: pattern(24, 16) });
  return dir;
}

describe('the MCP server', () => {
  it('lists its tools, with the operations as choices and the credit in its instructions', async () => {
    const c = await connect([folder()]), { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    const filter = tools.find((t) => t.name === 'filter') as any;
    expect(filter.inputSchema.properties.operation.enum).toContain('blur-gaussian');
    expect(c.getInstructions()).toMatch(/Free Photo Editor by Bhawesh Tibrewal/);
    expect(c.getServerVersion()).toMatchObject({ name: 'free-photo-editor' });
  });
  it('explains every operation, and finds the right one for a wish', async () => {
    const c = await connect([folder()]);
    const all = body(await call(c, 'list_operations', {}));
    expect(all.operations.find((o: any) => o.id === 'levels')).toMatchObject({ name: 'Light and dark balance', proName: 'Levels' });
    expect(all.saves).toEqual(['png', 'jpeg', 'webp', 'psd']);
    const wish = body(await call(c, 'list_operations', { query: 'blur the background' }));
    expect(wish.results[0]).toMatchObject({ tool: 'filter', operation: 'blur-iris' });
    expect(body(await call(c, 'list_operations', { operation: 'Gaussian blur' })).call).toEqual({ tool: 'filter', operation: 'blur-gaussian' });
  });
  it('runs a filter and a conversion, saving new files with the credit', async () => {
    const dir = folder(), c = await connect([dir]);
    const r = await call(c, 'filter', { path: 'a.png', operation: 'blur-gaussian', settings: { radius: 2 }, preview: true });
    expect(r.isError).toBeFalsy();
    expect(body(r)).toMatchObject({ ok: true, operation: 'blur-gaussian', width: 24, height: 16 });
    expect(r.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(readPngText(readFileSync(path.join(dir, 'a-blur-gaussian.png'))).Software).toBe(CREDIT);
    const w = await call(c, 'convert', { path: path.join(dir, 'a.png'), format: 'webp' });
    expect(body(w).output).toBe(path.join(realpathSync(dir), 'a.webp'));
    expect(webpInfo(readFileSync(path.join(dir, 'a.webp'))).xmp).toContain(CREDIT);
    expect(body(await call(c, 'image_info', { path: 'a.webp' }))).toMatchObject({ width: 24, height: 16, madeWith: CREDIT });
    expect((await call(c, 'filter', { path: 'a.png', operation: 'blur-gaussian' })).content[0].text).toMatch(/already exists/);
    expect((await call(c, 'filter', { path: 'a.png', operation: 'blur-gaussian', settings: { radius: 999 } })).isError).toBe(true);
  });
  it('refuses paths outside its folders, links that lead outside included', async () => {
    const dir = folder(), other = folder(), c = await connect([path.join(dir)]);
    for (const p of ['../outside.png', path.join(other, 'a.png')]) {
      const r = await call(c, 'image_info', { path: p });
      expect(r.isError).toBe(true);
    }
    expect((await call(c, 'image_info', { path: path.join(other, 'a.png') })).content[0].text).toMatch(/outside the folders/);
    symlinkSync(path.join(other, 'a.png'), path.join(dir, 'link.png'));
    expect((await call(c, 'image_info', { path: 'link.png' })).content[0].text).toMatch(/outside the folders/);
    symlinkSync(other, path.join(dir, 'door'));
    expect((await call(c, 'convert', { path: 'a.png', format: 'png', output: 'door/escaped.png' })).content[0].text).toMatch(/outside the folders/);
    expect(existsSync(path.join(other, 'escaped.png'))).toBe(false);
    const victim = path.join(other, 'keep.png');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, path.join(dir, 'trap.png'));
    expect((await call(c, 'convert', { path: 'a.png', format: 'png', output: 'trap.png', overwrite: true })).isError).toBeFalsy();
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect((await call(c, 'convert', { path: 'a.png', output: 'a.exe', format: 'png' })).isError).toBe(true);
  });
  it('never starts on the whole disk, and keeps to its pixel limit', async () => {
    await expect(createServer({ folders: [path.parse(process.cwd()).root] })).rejects.toThrow(/whole disk/);
    const dir = folder(), c = await connect([dir], 100);
    expect((await call(c, 'image_info', { path: 'a.png' })).content[0].text).toMatch(/million pixels/);
    mkdirSync(path.join(dir, 'sub'));
    const big = await connect([dir], 1000);
    expect((await call(big, 'resize', { path: 'a.png', width: 5000 })).content[0].text).toMatch(/million pixels/);
  });
});
