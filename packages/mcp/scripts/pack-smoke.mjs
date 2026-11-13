// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The packages as people will get them: pack both, install the two tarballs into an empty folder, then run what was
 * installed: free-photo-editor --help, one conversion, and an MCP client over stdio against free-photo-editor-mcp.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../../..', import.meta.url)), tmp = mkdtempSync(path.join(os.tmpdir(), 'fpe-pack-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const check = (ok, what) => { if (!ok) throw new Error('Pack smoke failed: ' + what); console.log('ok: ' + what); };

const tarballs = ['cli', 'mcp'].map((p) => path.join(tmp, sh(npm, ['pack', '--pack-destination', tmp], path.join(root, 'packages', p)).trim().split('\n').pop()));
for (const t of tarballs) {
  const files = sh('tar', ['-tzf', t], tmp);
  check(['package/dist/', 'package/README.md', 'package/LICENSE', 'package/ADDITIONAL-TERMS.md'].every((f) => files.includes(f)) && !files.includes('package/src/'),
    `${path.basename(t)} holds dist, README, LICENSE and ADDITIONAL-TERMS, and no sources`);
}
const app = path.join(tmp, 'app');
mkdirSync(app);
writeFileSync(path.join(app, 'package.json'), '{ "name": "smoke", "private": true }');
sh(npm, ['install', '--no-audit', '--no-fund', ...tarballs], app);
const bin = (n) => path.join(app, 'node_modules', '.bin', n);
check(sh(bin('free-photo-editor'), ['--help']).includes('Free Photo Editor by Bhawesh Tibrewal'), 'free-photo-editor --help');
check(sh(bin('fpe'), ['--version']).includes('no warranty'), 'fpe --version');
const pics = path.join(tmp, 'pictures');
mkdirSync(pics);
const raw = Buffer.alloc(32 * 24 * 4, 200);
await sharp(raw, { raw: { width: 32, height: 24, channels: 4 } }).png().toFile(path.join(pics, 'a.png'));
sh(bin('free-photo-editor'), ['convert', path.join(pics, 'a.png'), '--to', 'webp']);
check(readFileSync(path.join(pics, 'a.webp')).includes(Buffer.from('Free Photo Editor by Bhawesh Tibrewal')), 'convert to WebP, credit inside');
const client = new Client({ name: 'pack-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: bin('free-photo-editor-mcp'), args: [pics], stderr: 'ignore' }));
check((await client.listTools()).tools.some((t) => t.name === 'filter'), 'free-photo-editor-mcp lists its tools over stdio');
const res = await client.callTool({ name: 'filter', arguments: { path: 'a.png', operation: 'blur-gaussian', settings: { radius: 2 } } });
check(!res.isError && existsSync(path.join(pics, 'a-blur-gaussian.png')), 'free-photo-editor-mcp runs a filter');
await client.close();
rmSync(tmp, { recursive: true, force: true });
console.log('Pack smoke passed.');
