// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Free Photo Editor as a local MCP server: AI agents such as Claude edit, convert and export pictures on this computer
 * with the same engine as the web app. It reads and writes only inside the folders it was started with, never opens a
 * network connection and never runs other programs. Originals are never changed unless the agent asks to overwrite.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { APP_VERSION, AUTHOR, AUTHOR_URL, CREDIT, SOURCE_URL, type Doc } from '@free-photoeditor/core';
import { findOperation, opsIn, operationJson, searchWishes, type OpGroup } from '../../cli/src/catalog';
import { FORMAT_NAMES, READ_FORMATS, WRITE_FORMATS } from '../../cli/src/codecs';
import { DEFAULT_MAX_PIXELS, FLIPS, TURNS, applyOperation, cropPicture, describePicture, flattenLayers, keepOnlyLayer, layerList,
  mergeLayers, openPicture, planOutput, previewOf, resizePicture, savePicture, turnPicture, type Picture } from '../../cli/src/engine';
import { Folders } from './folders';

export const HELP = [`free-photo-editor-mcp ${APP_VERSION}: Free Photo Editor by ${AUTHOR} (${AUTHOR_URL}) as a local MCP server.`, '',
  'Usage: free-photo-editor-mcp <folder> [more folders...] [--max-pixels <n>]', '',
  'AI agents (Claude, Cursor and other MCP clients) can then open, edit, convert and export the pictures in those folders,',
  'and only there. Nothing is uploaded; the server never uses the network and never runs other programs.',
  `Without a folder it uses the folder it was started in, but never the whole disk. --max-pixels caps picture size (default ${DEFAULT_MAX_PIXELS}).`, '',
  'Free software under the GNU AGPL-3.0 with additional terms (keep the credit). It comes with no warranty.', `Source: ${SOURCE_URL}`].join('\n');
const instructions = (roots: string[]): string => [
  `Free Photo Editor by ${AUTHOR} (${AUTHOR_URL}): a free, open-source photo editor (AGPL-3.0) running on this computer; nothing is uploaded.`,
  `It reads and writes files only inside: ${roots.join(', ')}. Relative paths start in the first of these.`,
  `It opens ${READ_FORMATS.map((f) => FORMAT_NAMES[f]).join(', ')} and saves PNG, JPEG, WebP and PSD (PSD keeps layers). Every saved file carries "${CREDIT}" in its metadata.`,
  'Start with list_operations: pass query (for example "make it brighter" or "blur the background") to find the right tool and operation, or operation for its settings.',
  'Edits never change the original: the result is saved next to it with a suffix unless you give output; set overwrite only when the person wants a file replaced. Set preview to see the result.',
].join('\n');

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Reply = { content: Content[]; isError?: boolean };
const failure = (e: unknown): Reply => ({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] });
async function reply(data: Record<string, unknown>, doc?: Doc | null): Promise<Reply> {
  const content: Content[] = [{ type: 'text', text: JSON.stringify(data, null, 2) }];
  if (doc) content.push({ type: 'image', data: Buffer.from(await previewOf(doc)).toString('base64'), mimeType: 'image/png' });
  return { content };
}

const fmt = z.enum(WRITE_FORMATS as unknown as ['png', 'jpeg', 'webp', 'psd']);
const pathArg = z.string().min(1).describe('The picture file: an absolute path inside an allowed folder, or a path relative to the first allowed folder.');
const layerArg = z.union([z.string(), z.number().int().positive()]).optional()
  .describe('Which layer of a PSD: its name, its number from the top (1 = top layer), or "all". Default: the top layer.');
const rect = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() });
const out = {
  output: z.string().optional().describe('Where to save the result: a name ending in .png, .jpg, .webp or .psd. Default: next to the original, with a suffix.'),
  format: fmt.optional().describe("File type of the result. Default: the original's type when it can be saved, otherwise PNG."),
  quality: z.number().min(0.01).max(100).optional().describe('JPEG and WebP quality from 0.01 to 1 (or 1 to 100). Default 0.92; 1 makes WebP lossless.'),
  overwrite: z.boolean().optional().describe('Replace the output file if it already exists. Default false: an existing file is never replaced.'),
  preview: z.boolean().optional().describe('Also return a small PNG preview of the result (at most 512 pixels on its long side).'),
};
interface OutArgs { path: string; output?: string; format?: 'png' | 'jpeg' | 'webp' | 'psd'; quality?: number; overwrite?: boolean; preview?: boolean; }

export interface ServerSettings { folders?: string[]; maxPixels?: number; }
export async function createServer(s: ServerSettings = {}): Promise<{ server: McpServer; folders: Folders }> {
  const folders = await Folders.open(s.folders ?? []), maxPixels = s.maxPixels ?? DEFAULT_MAX_PIXELS;
  const server = new McpServer({ name: 'free-photo-editor', title: `Free Photo Editor by ${AUTHOR}`, version: APP_VERSION, websiteUrl: AUTHOR_URL },
    { instructions: instructions(folders.roots) });
  const open = async (p: string): Promise<Picture> => openPicture(await folders.input(p), maxPixels);
  /** Open, change, save with the credit; the original stays as it was unless overwrite names it. */
  const edit = async (a: OutArgs, suffix: string | undefined, change: (p: Picture) => string[] | void, extra: Record<string, unknown> = {}): Promise<Reply> => {
    try {
      const pic = await open(a.path), notes = [...pic.notes, ...(change(pic) ?? [])];
      const plan = planOutput(pic.file, pic.format, { output: a.output ? folders.resolve(a.output) : undefined, to: a.format, suffix, cwd: folders.first });
      const saved = await savePicture(pic.doc, await folders.output(plan.file), plan.format, { quality: a.quality, overwrite: a.overwrite });
      return await reply({ ok: true, input: pic.file, ...extra, ...saved, type: FORMAT_NAMES[saved.format], notes: [...notes, ...saved.notes], credit: CREDIT },
        a.preview ? pic.doc : null);
    } catch (e) { return failure(e); }
  };
  const area = (r?: { x: number; y: number; width: number; height: number }) => (r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null);
  const opTool = (group: OpGroup) => async (a: OutArgs & { operation: string; settings?: Record<string, number | string | boolean>; layer?: string | number;
    area?: { x: number; y: number; width: number; height: number }; color?: string; color2?: string }): Promise<Reply> => {
    const op = findOperation(a.operation, group);
    if (!op) return failure(new Error(`There is no ${group === 'adjust' ? 'adjustment' : 'filter'} called "${a.operation}". Call list_operations to see them.`));
    return edit(a, op.id, (p) => { applyOperation(p.doc, op, a.settings ?? {}, { layer: a.layer, area: area(a.area) }, { main: a.color, second: a.color2 }); },
      { operation: op.id, name: op.plain, proName: op.pro });
  };
  const ro = { readOnlyHint: true, openWorldHint: false }, rw = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const settingsArg = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional()
    .describe('Settings by key, for example {"radius": 8}. Any you leave out keep their default; list_operations shows each key with its range and default.');

  server.registerTool('list_operations', {
    title: 'What the editor can do',
    description: 'Every adjustment and filter, with its plain name, pro name, one line of help and its settings (key, range, default). Pass query to find the right tool for a wish such as "make it brighter", "blur the background" or "square crop for Instagram"; pass operation to get one in detail.',
    inputSchema: { group: z.enum(['adjust', 'filter', 'all']).optional(), query: z.string().optional(), operation: z.string().optional() }, annotations: ro,
  }, async (a) => {
    if (a.operation) {
      const op = findOperation(a.operation);
      return op ? reply({ operation: operationJson(op), call: { tool: op.group, operation: op.id } }) : failure(new Error(`Nothing is called "${a.operation}". Try query instead.`));
    }
    if (a.query) return reply({ query: a.query, results: searchWishes(a.query).map((f) => ({ ...f, tool: (f.run ?? '').split(' ')[0], cli: `free-photo-editor ${f.run}` })) });
    const g = a.group === 'adjust' || a.group === 'filter' ? a.group : undefined;
    return reply({ opens: READ_FORMATS, saves: WRITE_FORMATS, operations: opsIn(g).map(operationJson) });
  });
  server.registerTool('image_info', {
    title: 'Picture details', description: 'Size, file type, layers (top first), see-through areas and the credit stored in a picture file. Changes nothing.',
    inputSchema: { path: pathArg, preview: out.preview }, annotations: ro,
  }, async (a) => { try { const p = await open(a.path); return await reply(describePicture(p), a.preview ? p.doc : null); } catch (e) { return failure(e); } });
  const ids = (g: OpGroup) => opsIn(g).map((o) => o.id) as [string, ...string[]];
  server.registerTool('adjust', {
    title: 'Light and colour (adjustments)',
    description: `Run one of ${ids('adjust').length} adjustments (brightness, levels, curves, exposure, hue, black and white, automatic fixes...) on a picture and save the result. list_operations gives each one's settings.`,
    inputSchema: { path: pathArg, operation: z.enum(ids('adjust')), settings: settingsArg, layer: layerArg,
      area: rect.optional().describe('Only change this rectangle, in pixels from the top-left. Default: the whole layer.'), ...out }, annotations: rw,
  }, opTool('adjust'));
  server.registerTool('filter', {
    title: 'Effects (filters)',
    description: `Run one of ${ids('filter').length} filters (blurs, sharpen, noise, distort, pixelate, render, stylize...) on a picture and save the result. list_operations gives each one's settings.`,
    inputSchema: { path: pathArg, operation: z.enum(ids('filter')), settings: settingsArg, layer: layerArg,
      area: rect.optional().describe('Only change this rectangle, in pixels from the top-left. Default: the whole layer.'),
      color: z.string().optional().describe('Main colour for effects that paint, as hex (default #000000).'),
      color2: z.string().optional().describe('Second colour, as hex (default #ffffff).'), ...out }, annotations: rw,
  }, opTool('filter'));
  server.registerTool('resize', {
    title: 'Picture size', description: 'Change the width and height in pixels; the picture is redrawn to fit. Give width or height alone to keep the proportions, or scale as a percentage.',
    inputSchema: { path: pathArg, width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), scale: z.number().positive().optional().describe('Percentage, e.g. 50'),
      mode: z.enum(['smooth', 'pixel']).optional().describe('smooth (default) for photos; pixel keeps hard pixel-art edges'), ...out }, annotations: rw,
  }, (a) => edit(a, 'resized', (p) => { resizePicture(p.doc, { width: a.width, height: a.height, scale: a.scale, mode: a.mode }, maxPixels); }));
  server.registerTool('crop', {
    title: 'Crop', description: 'Keep only part of the picture: an area, the biggest centred area of a shape (aspect such as "1:1" or "9:16"), or trim away empty edges.',
    inputSchema: { path: pathArg, area: rect.optional().describe('The rectangle to keep, in pixels from the top-left.'), aspect: z.string().optional(), trim: z.boolean().optional(), ...out }, annotations: rw,
  }, (a) => edit(a, 'cropped', (p) => cropPicture(p.doc, { area: area(a.area) ?? undefined, aspect: a.aspect, trim: a.trim })));
  server.registerTool('rotate', {
    title: 'Turn the picture', description: 'Turn the whole picture, or one layer, a quarter turn right or left, or half way round.',
    inputSchema: { path: pathArg, turn: z.enum(['right', 'left', '180']), layer: layerArg, ...out }, annotations: rw,
  }, (a) => edit(a, 'rotated', (p) => { turnPicture(p.doc, TURNS[a.turn], a.layer); }));
  server.registerTool('flip', {
    title: 'Mirror or flip', description: 'Mirror the whole picture, or one layer, left to right (horizontal) or top to bottom (vertical).',
    inputSchema: { path: pathArg, direction: z.enum(['horizontal', 'vertical']), layer: layerArg, ...out }, annotations: rw,
  }, (a) => edit(a, 'flipped', (p) => { turnPicture(p.doc, FLIPS[a.direction], a.layer); }));
  server.registerTool('convert', {
    title: 'Change the file type', description: 'Save a copy as PNG, JPEG, WebP or PSD (PSD keeps the layers), with a note on what the new type loses.',
    inputSchema: { path: pathArg, ...out, format: fmt }, annotations: rw,
  }, (a) => edit(a, undefined, () => undefined));
  server.registerTool('export', {
    title: 'Export', description: 'Save a copy, or just one layer of it, as PNG, JPEG, WebP or PSD, with a note on what that type loses. Give format or output.',
    inputSchema: { path: pathArg, layer: z.union([z.string(), z.number().int().positive()]).optional().describe('Save only this layer: its name or its number from the top.'), ...out }, annotations: rw,
  }, (a) => (!a.format && !a.output ? Promise.resolve(failure(new Error('Give format (png, jpeg, webp or psd) or an output name.'))) :
    edit(a, a.layer === undefined ? undefined : String(a.layer).replace(/[^\w-]+/g, '-') || 'layer', (p) => (a.layer === undefined ? [] : [keepOnlyLayer(p.doc, a.layer)]))));
  server.registerTool('layers', {
    title: 'Layers', description: 'list: every layer of a picture, top first. merge: merge the shown layers into one (or, with layer, merge that layer into the one below). flatten: combine every layer into one.',
    inputSchema: { path: pathArg, action: z.enum(['list', 'merge', 'flatten']), layer: layerArg,
      background: z.string().optional().describe('flatten: hex colour behind see-through areas, or "transparent" (default white)'), ...out }, annotations: rw,
  }, async (a) => {
    if (a.action === 'list') { try { const p = await open(a.path); return await reply({ file: p.file, layers: layerList(p.doc) }); } catch (e) { return failure(e); } }
    return a.action === 'merge' ? edit(a, 'merged', (p) => [mergeLayers(p.doc, a.layer)]) : edit(a, 'flat', (p) => [flattenLayers(p.doc, a.background)]);
  });
  return { server, folders };
}
