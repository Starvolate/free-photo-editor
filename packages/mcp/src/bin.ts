// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** free-photo-editor-mcp <folders...>: the MCP server on stdio. Stdout carries only the protocol; messages go to stderr. */
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { APP_VERSION, AUTHOR } from '@free-photoeditor/core';
import { HELP, createServer } from './server';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, 'max-pixels': { type: 'string' } } });
  if (values.help) { process.stdout.write(HELP + '\n'); return; }
  if (values.version) { process.stdout.write(HELP.split('\n')[0] + '\n'); return; }
  const mp = values['max-pixels'] === undefined ? undefined : Number(values['max-pixels']);
  if (mp !== undefined && !(mp > 0)) throw new Error('--max-pixels needs a number above 0.');
  const { server, folders } = await createServer({ folders: positionals, maxPixels: mp });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`Free Photo Editor MCP server ${APP_VERSION} by ${AUTHOR}: working in ${folders.roots.join(', ')}\n`);
}
main().catch((e: unknown) => { process.stderr.write(`free-photo-editor-mcp: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
