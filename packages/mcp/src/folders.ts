// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The folders the MCP server may use. Every path is resolved to its real location (links followed) before use, and
 * must sit inside one of the folders named at start, so neither "..", nor a link, nor an absolute path can reach
 * anything else. The whole disk is never allowed.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class Folders {
  private constructor(readonly roots: string[]) {}
  static async open(dirs: string[]): Promise<Folders> {
    const roots: string[] = [];
    for (const d of dirs.length ? dirs : [process.cwd()]) {
      let real: string;
      try { real = await fs.realpath(path.resolve(d)); } catch { throw new Error(`The folder ${d} does not exist.`); }
      if (!(await fs.stat(real)).isDirectory()) throw new Error(`${d} is a file, not a folder.`);
      if (path.parse(real).root === real) {
        throw new Error(`Refusing to work on the whole disk (${real}). Start the server with the folders that hold your pictures, for example: free-photo-editor-mcp ~/Pictures`);
      }
      if (!roots.includes(real)) roots.push(real);
    }
    return new Folders(roots);
  }
  get first(): string { return this.roots[0]; }
  /** Absolute, file:// or ~/ paths; anything else is taken from the first folder. */
  resolve(p: string): string {
    const s = p.trim();
    if (s.startsWith('file://')) return fileURLToPath(s);
    if (s === '~' || s.startsWith('~/')) return path.join(os.homedir(), s.slice(1));
    return path.resolve(this.first, s);
  }
  contains(real: string): boolean {
    return this.roots.some((r) => {
      const rel = path.relative(r, real);
      return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
    });
  }
  private outside(abs: string): Error {
    return new Error(`${abs} is outside the folders this server may use (${this.roots.join(', ')}). Ask the person to add that folder when they start the server.`);
  }
  /** An existing file to read, as its real path. */
  async input(p: string): Promise<string> {
    const abs = this.resolve(p);
    let real: string;
    try { real = await fs.realpath(abs); } catch { throw new Error(`There is no file at ${abs}.`); }
    if (!this.contains(real)) throw this.outside(abs);
    return real;
  }
  /** A file to write: its folder must exist inside the allowed folders. A link at the name itself is replaced, never followed. */
  async output(p: string): Promise<string> {
    const abs = this.resolve(p);
    let dir: string;
    try { dir = await fs.realpath(path.dirname(abs)); } catch { throw new Error(`The folder ${path.dirname(abs)} does not exist.`); }
    if (!this.contains(dir)) throw this.outside(abs);
    return path.join(dir, path.basename(abs));
  }
}
