// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The command line: free-photo-editor <command> <files...> [options]. `run` returns the exit code, so tests call it directly. */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CREDIT, isDpi, parsePrintSize } from '@free-photoeditor/core';
import { findOperation, opsIn, operationJson, resolveParams, searchWishes, suggest, type OpGroup, type SettingValue } from './catalog';
import { FORMAT_NAMES } from './codecs';
import { DEFAULT_MAX_PIXELS, FLIPS, TURNS, applyOperation, applyPrint, cropPicture, describePicture, flattenLayers, keepOnlyLayer, layerList,
  mergeLayers, openPicture, parseArea, planOutput, resizePicture, savePicture, turnPicture, type Picture } from './engine';
import { expandGlob, hasGlob } from './glob';
import { BIN, COMMANDS, commandHelp, mainHelp, names, opHelp, opsHelp, versionText } from './help';

export interface Io { out(s: string): void; err(s: string): void; cwd: string; }
const stdIo = (): Io => ({ out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n'), cwd: process.cwd() });
const OPTIONS = {
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' }, quiet: { type: 'boolean', short: 'q' },
  output: { type: 'string', short: 'o' }, 'out-dir': { type: 'string' }, to: { type: 'string' }, quality: { type: 'string' },
  overwrite: { type: 'boolean', short: 'y' }, 'max-pixels': { type: 'string' },
  set: { type: 'string', short: 's', multiple: true }, settings: { type: 'string' }, layer: { type: 'string' }, area: { type: 'string' },
  color: { type: 'string' }, color2: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' }, scale: { type: 'string' },
  mode: { type: 'string' }, aspect: { type: 'string' }, trim: { type: 'boolean' }, turn: { type: 'string' }, direction: { type: 'string' },
  background: { type: 'string' }, dpi: { type: 'string' }, 'resize-to-print': { type: 'string' },
} as const;
const parse = (argv: string[]) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
type Values = ReturnType<typeof parse>['values'];
/** A mistake in how the command was written (exit code 2), as opposed to a picture that could not be changed (exit code 1). */
export class UsageError extends Error {}
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
function num(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.trim().replace(/\s*(%|px)$/i, ''));
  if (!Number.isFinite(n)) throw new UsageError(`--${name} needs a number (not "${v}").`);
  return n;
}
/** Settings from --settings JSON, then --set name=value (repeatable, or comma-separated), then name=value words after the files. */
export function collectSettings(v: Pick<Values, 'settings' | 'set'>, words: string[] = []): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  if (v.settings) {
    let j: unknown;
    try { j = JSON.parse(v.settings); } catch { throw new UsageError(`--settings must be JSON, for example --settings '{"radius": 8}'.`); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new UsageError('--settings must be a JSON object of name: value pairs.');
    for (const [k, x] of Object.entries(j)) {
      if (!['number', 'string', 'boolean'].includes(typeof x)) throw new UsageError(`The setting ${k} must be a number, a word or true/false.`);
      out[k] = x as SettingValue;
    }
  }
  for (const s of [...(v.set ?? []), ...words]) for (const part of s.split(/,(?=\s*[A-Za-z][\w ]*=)/)) {
    const i = part.indexOf('=');
    if (i < 1) throw new UsageError(`"${part}" is not a setting. Write name=value, for example radius=8.`);
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
/** File names and patterns to files. Patterns are expanded here, so they work in every shell. */
export function expandFiles(tokens: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (hasGlob(t) && !existsSync(path.resolve(cwd, t))) {
      const m = expandGlob(t, cwd);
      if (!m.length) throw new UsageError(`No files match "${t}".`);
      out.push(...m);
    } else out.push(path.resolve(cwd, t));
  }
  if (!out.length) throw new UsageError('Name at least one picture file.');
  return [...new Set(out)];
}

interface Result { input: string; output?: string; type?: string; width?: number; height?: number; dpi?: number; layers?: number; bytes?: number; notes?: string[]; error?: string; }
class Run {
  readonly results: Result[] = [];
  failed = 0;
  constructor(readonly io: Io, readonly v: Values, readonly command: string) {}
  get json(): boolean { return !!this.v.json; }
  rel(p: string): string { const r = path.relative(this.io.cwd, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; }
  say(lines: string[]): void { if (!this.json && !this.v.quiet) for (const l of lines) this.io.out(l); }
  ok(r: Result, lines: string[]): void { this.results.push(r); this.say(lines); }
  bad(input: string, e: unknown): void {
    this.failed++;
    this.results.push({ input, error: msg(e) });
    if (!this.json) this.io.err(`Could not ${this.command === 'info' ? 'read' : 'change'} ${this.rel(input)}: ${msg(e)}`);
  }
  finish(extra: Record<string, unknown> = {}): number {
    if (this.json) this.io.out(JSON.stringify({ ok: this.failed === 0, command: this.command, ...extra, results: this.results, credit: CREDIT }, null, 2));
    else if (this.results.length > 1 && !this.v.quiet) this.io.out(`Done: ${this.results.length - this.failed} of ${this.results.length} pictures${this.failed ? `; ${this.failed} could not be done` : ''}.`);
    return this.failed ? 1 : 0;
  }
  /** Open each picture, change it, save the result with the credit. */
  async edit(files: string[], suffix: string | undefined, change: (p: Picture) => string[] | void, extra: Record<string, unknown> = {}): Promise<number> {
    const maxPixels = num(this.v['max-pixels'], 'max-pixels') ?? DEFAULT_MAX_PIXELS, quality = num(this.v.quality, 'quality');
    const print = { dpi: num(this.v.dpi?.replace(/\s*(dpi|ppi)$/i, ''), 'dpi'), printSize: this.v['resize-to-print'] };
    if (print.dpi !== undefined && !isDpi(print.dpi)) throw new UsageError('--dpi needs a number from 1 to 10000, for example 300.');
    if (print.printSize) { try { parsePrintSize(print.printSize); } catch (e) { throw new UsageError(msg(e)); } }
    for (const input of files) {
      try {
        const pic = await openPicture(input, maxPixels), notes = [...pic.notes, ...(change(pic) ?? []), ...applyPrint(pic.doc, print, maxPixels)];
        const plan = planOutput(input, pic.format, { output: this.v.output, outDir: this.v['out-dir'], to: this.v.to, suffix, cwd: this.io.cwd, many: files.length > 1 });
        await fs.mkdir(path.dirname(plan.file), { recursive: true });
        const s = await savePicture(pic.doc, plan.file, plan.format, { quality, overwrite: this.v.overwrite });
        const all = [...notes, ...s.notes];
        this.ok({ input, output: s.output, type: FORMAT_NAMES[s.format], width: s.width, height: s.height, dpi: s.dpi, layers: s.layers, bytes: s.bytes, notes: all },
          [`Saved ${this.rel(s.output)} (${s.width} × ${s.height} ${FORMAT_NAMES[s.format]}${s.layers > 1 ? `, ${s.layers} layers` : ''})`, ...all.map((n) => `  Note: ${n}`)]);
      } catch (e) { this.bad(input, e); }
    }
    return this.finish(extra);
  }
  async read(files: string[], show: (p: Picture) => { data: Record<string, unknown>; lines: string[] }): Promise<number> {
    const maxPixels = num(this.v['max-pixels'], 'max-pixels') ?? DEFAULT_MAX_PIXELS;
    for (const input of files) {
      try { const p = await openPicture(input, maxPixels), s = show(p); this.ok({ input, ...s.data }, s.lines); } catch (e) { this.bad(input, e); }
    }
    return this.finish();
  }
}
const layerLines = (p: Picture): string[] => layerList(p.doc).map((l) =>
  `    ${l.number}. ${l.name}${l.active ? ' (active)' : ''}: ${l.visible ? 'shown' : 'hidden'}, ${l.opacity}% ${l.blendMode}, ${l.width} × ${l.height} at ${l.x},${l.y}`);

export async function run(argv: string[], io: Io = stdIo()): Promise<number> {
  let v: Values, pos: string[];
  try { ({ values: v, positionals: pos } = parse(argv)); } catch (e) {
    io.err(`${msg(e).replace(/\. To specify a positional argument.*$/s, '.')}\nSee: ${BIN} --help`);
    return 2;
  }
  const [cmd, ...rest] = pos;
  if (v.version) { io.out(versionText()); return 0; }
  if (!cmd || cmd === 'help') { io.out(rest[0] && COMMANDS[rest[0]] ? commandHelp(rest[0]) : mainHelp()); return 0; }
  if (!COMMANDS[cmd]) { io.err(`There is no command called "${cmd}". The commands are: ${Object.keys(COMMANDS).join(', ')}.\nSee: ${BIN} --help`); return 2; }
  const r = new Run(io, v, cmd);
  try {
    if (v.help && cmd !== 'adjust' && cmd !== 'filter') { io.out(commandHelp(cmd)); return 0; }
    const layer = v.layer, area = v.area ? parseArea(v.area) : null;
    switch (cmd) {
      case 'list': {
        const a = rest[0]?.toLowerCase(), group: OpGroup | undefined = a === 'adjust' || a === 'adjustments' ? 'adjust' : a === 'filter' || a === 'filters' ? 'filter' : undefined;
        const op = rest[0] && !group ? findOperation(rest.join(' ')) : undefined;
        if (rest[0] && !group && !op) throw new UsageError(`Nothing is called "${rest.join(' ')}". Try: ${BIN} search "${rest.join(' ')}"`);
        if (r.json) io.out(JSON.stringify({ ok: true, command: 'list', operations: (op ? [op] : opsIn(group)).map(operationJson) }, null, 2));
        else io.out(op ? opHelp(op) : group ? opsHelp(group) : `${opsHelp('adjust')}\n\n${opsHelp('filter')}`);
        return 0;
      }
      case 'search': {
        const q = rest.join(' ').trim();
        if (!q) throw new UsageError(`Say what you want to do, for example: ${BIN} search "make it brighter"`);
        const found = searchWishes(q);
        if (r.json) io.out(JSON.stringify({ ok: true, command: 'search', query: q, results: found.map((f) => ({ ...f, command: `${BIN} ${f.run}` })) }, null, 2));
        else io.out(found.length ? [`For "${q}":`, ...found.map((f) => `  ${BIN} ${(f.run ?? '').padEnd(34)} ${names(f.plain, f.pro)}: ${f.help}`)].join('\n')
          : `Nothing here matches "${q}". Try other words, or see ${BIN} list.`);
        return 0;
      }
      case 'adjust': case 'filter': {
        const group: OpGroup = cmd, [name, ...more] = rest;
        const op = name ? findOperation(name, group) : undefined;
        if (v.help || !name) { io.out(op ? opHelp(op) : opsHelp(group)); return 0; }
        if (!op) {
          const other = findOperation(name), s = suggest(name, group);
          throw new UsageError(other ? `"${name}" is ${other.group === 'filter' ? 'a filter' : 'an adjustment'}: run ${BIN} ${other.group} ${other.id}`
            : `There is no ${group === 'adjust' ? 'adjustment' : 'filter'} called "${name}".${s.length ? ` Did you mean: ${s.map((o) => `${o.id} (${o.plain})`).join(', ')}?` : ''} See: ${BIN} ${group} --help`);
        }
        const isSetting = (t: string): boolean => t.includes('=') && !existsSync(path.resolve(io.cwd, t));
        const settings = collectSettings(v, more.filter(isSetting));
        try { resolveParams(op, settings); } catch (e) { throw new UsageError(msg(e)); }
        return await r.edit(expandFiles(more.filter((t) => !isSetting(t)), io.cwd), op.id, (p) => {
          const ls = applyOperation(p.doc, op, settings, { layer, area }, { main: v.color, second: v.color2 });
          return p.doc.layers.length > 1 && layer === undefined ? [`Changed the layer "${ls[0].name}" (the top layer). Use --layer to choose another, or --layer all.`] : [];
        }, { operation: operationJson(op), settings });
      }
      case 'info': return await r.read(expandFiles(rest, io.cwd), (p) => {
        const d = describePicture(p);
        return { data: d, lines: [`${r.rel(p.file)}: ${d.type}, ${d.width} × ${d.height}${d.megapixels >= 0.01 ? ` (${d.megapixels} megapixels)` : ''}, ${d.layers.length} layer${d.layers.length === 1 ? '' : 's'}${d.transparent ? ', has see-through areas' : ''}`,
          `  Print: ${d.print}`, `  Made with: ${d.madeWith ?? 'no credit stored'}`, ...(d.layers.length > 1 ? ['  Layers, top first:', ...layerLines(p)] : []), ...d.notes.map((n) => `  Note: ${n}`)] };
      });
      case 'convert': case 'export': {
        if (!v.to && !v.output) throw new UsageError(`Say which type to save: --to png, jpeg, webp or psd (or name the file with -o).`);
        if (cmd === 'convert' && layer !== undefined) throw new UsageError(`To save one layer, use: ${BIN} export <file> --layer <name>`);
        const slug = layer === undefined ? undefined : String(layer).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
        return await r.edit(expandFiles(rest, io.cwd), slug, (p) => (layer === undefined ? [] : [keepOnlyLayer(p.doc, layer)]));
      }
      case 'resize': {
        const req = { width: num(v.width, 'width'), height: num(v.height, 'height'), scale: num(v.scale, 'scale'), mode: (v.mode ?? 'smooth') as 'smooth' | 'pixel' };
        if (req.mode !== 'smooth' && req.mode !== 'pixel') throw new UsageError('--mode is smooth or pixel.');
        if (req.width === undefined && req.height === undefined && req.scale === undefined) throw new UsageError('Give --width, --height or --scale.');
        const maxPixels = num(v['max-pixels'], 'max-pixels') ?? DEFAULT_MAX_PIXELS;
        return await r.edit(expandFiles(rest, io.cwd), 'resized', (p) => { resizePicture(p.doc, req, maxPixels); });
      }
      case 'crop': {
        if (!area && !v.aspect && !v.trim) throw new UsageError('Say what to keep: --area x,y,width,height, --aspect 1:1 or --trim.');
        return await r.edit(expandFiles(rest, io.cwd), 'cropped', (p) => cropPicture(p.doc, { area: area ?? undefined, aspect: v.aspect, trim: v.trim }));
      }
      case 'rotate': case 'flip': {
        const word = (cmd === 'rotate' ? v.turn : v.direction)?.toLowerCase() ?? '', t = (cmd === 'rotate' ? TURNS : FLIPS)[word];
        if (!t) throw new UsageError(cmd === 'rotate' ? 'Say which way: --turn right, left or 180.' : 'Say which way: --direction horizontal or vertical.');
        return await r.edit(expandFiles(rest, io.cwd), cmd === 'rotate' ? 'rotated' : 'flipped', (p) => { turnPicture(p.doc, t, layer); });
      }
      case 'layers': {
        const [action, ...files] = rest;
        if (action === 'list') return await r.read(expandFiles(files, io.cwd), (p) => ({ data: { layers: layerList(p.doc) }, lines: [`${r.rel(p.file)}: ${p.doc.layers.length} layer${p.doc.layers.length === 1 ? '' : 's'}, top first`, ...layerLines(p)] }));
        if (action === 'merge') return await r.edit(expandFiles(files, io.cwd), 'merged', (p) => [mergeLayers(p.doc, layer)]);
        if (action === 'flatten') return await r.edit(expandFiles(files, io.cwd), 'flat', (p) => [flattenLayers(p.doc, v.background)]);
        throw new UsageError(`Say what to do with the layers: ${BIN} layers list|merge|flatten <files...>`);
      }
    }
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError) && !/^"|^--|^Give|^Say/.test(msg(e))) throw e;
    if (r.json) io.out(JSON.stringify({ ok: false, command: cmd, error: msg(e) }, null, 2)); else io.err(msg(e).includes('See: ') ? msg(e) : `${msg(e)}\nSee: ${BIN} ${cmd} --help`);
    return 2;
  }
}
