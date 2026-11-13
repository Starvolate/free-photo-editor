// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Help in plain words. Command and operation names come from the web app's function map: plain name first, pro name second. */
import { APP_VERSION, AUTHOR, AUTHOR_URL, CREDIT, SOURCE_URL } from '@free-photoeditor/core';
import { BY_ID, MENU_INFO } from '../../web/src/registry';
import { opsIn, placeName, type OpGroup, type Operation, type Setting } from './catalog';
import { DEFAULT_MAX_PIXELS } from './engine';

export const BIN = 'free-photo-editor';
export const names = (plain: string, pro: string): string => (plain.toLowerCase() === pro.toLowerCase() ? plain : `${plain} · ${pro}`);
const row = (id: string, plain: string, pro: string): [string, string] => { const r = BY_ID.get(id); return r ? [r.plain, r.pro] : [plain, pro]; };
const menu = (p: string, plain: string, pro: string): [string, string] => { const m = MENU_INFO.get(p); return m ? [m.plain, m.pro] : [plain, pro]; };

export interface CommandInfo { usage: string; names: [string, string]; help: string; options: [string, string][]; examples: string[]; }
const OUT: [string, string][] = [['-o, --output <file>', 'Where to save: a name ending in .png, .jpg, .webp or .psd. With many pictures put {name} in it, e.g. out/{name}.webp'],
  ['--out-dir <folder>', 'Save the results in this folder under their own names'], ['--to <type>', 'File type of the result: png, jpeg, webp or psd'],
  ['--quality <0-1>', 'JPEG and WebP quality (default 0.92; 1 makes WebP lossless and keeps every JPEG colour pixel, 4:4:4)'], ['-y, --overwrite', 'Replace a file that is already there'],
  ['--dpi <number>', 'Print quality: the dots per inch written into the file, e.g. 300 for print (the pixels stay: DPI alone never adds detail)'],
  ['--resize-to-print <size>', 'Resample to a print size at the DPI, e.g. 10x15cm, 4x6in or 210x297mm; one side (10cm) keeps the shape']];
const EDIT: [string, string][] = [['--layer <name|number|all>', 'Which layer to change in a PSD: its name, its number from the top, or all (default: the top layer)'],
  ['--area <x,y,width,height>', 'Only change this rectangle, in pixels from the top-left corner (default: the whole layer)']];
export const COMMANDS: Record<string, CommandInfo> = {
  info: { usage: 'info <files...>', names: row('file.info', 'Picture details', 'File info'), help: 'Size, layers, see-through areas and the credit stored in each file. Changes nothing.', options: [], examples: ['info photo.jpg', 'info "shoot/*.psd" --json'] },
  convert: { usage: 'convert <files...> --to <type>', names: ['Change the file type', 'Convert'], help: 'Save a copy as PNG, JPEG, WebP or PSD (layers kept), with a note on what the new type loses.', options: OUT, examples: ['convert photo.png --to jpeg', 'convert "scans/*.bmp" --to png --out-dir png'] },
  export: { usage: 'export <file> --to <type> [--layer <layer>]', names: row('file.export', 'Export', 'Export as'), help: 'Save a copy, or one layer of it, as PNG, JPEG, WebP or PSD, with a note on what that type loses.', options: [['--layer <name|number>', 'Save only this layer'], ...OUT], examples: ['export design.psd --to png', 'export design.psd --layer Logo -o logo.png', 'export photo.jpg --to jpeg --quality 1 --dpi 300 --resize-to-print 10x15cm'] },
  resize: { usage: 'resize <files...> --width <px> | --height <px> | --scale <percent>', names: row('image.size', 'Picture size', 'Image size'), help: 'Change the width and height in pixels; the picture is redrawn to fit. Give one side to keep the proportions.', options: [['--width <pixels>', 'New width'], ['--height <pixels>', 'New height'], ['--scale <percent>', 'New size as a percentage, e.g. 50'], ['--mode smooth|pixel', 'smooth (default) for photos; pixel keeps hard pixel-art edges'], ...OUT], examples: ['resize photo.jpg --width 1200', 'resize "*.png" --scale 50 --out-dir small'] },
  crop: { usage: 'crop <files...> --area <x,y,width,height> | --aspect <w:h> | --trim', names: row('tool.crop', 'Crop', 'Crop tool'), help: 'Keep only part of the picture.', options: [['--area <x,y,width,height>', 'Keep this rectangle'], ['--aspect <w:h>', 'Keep the biggest centred area of this shape, e.g. 1:1 for a square or 9:16 for a story'], ['--trim', `${names(...row('image.trim', 'Cut away empty edges', 'Trim'))}: remove see-through or same-colour edges`], ...OUT], examples: ['crop photo.jpg --aspect 1:1', 'crop photo.png --area 100,50,800,600', 'crop logo.png --trim'] },
  rotate: { usage: 'rotate <files...> --turn right|left|180', names: menu('Image > Rotate', 'Turn the picture', 'Image rotation'), help: 'Turn the whole picture (or one layer) a quarter or half turn.', options: [['--turn right|left|180', 'right = 90° clockwise, left = 90° counter-clockwise, 180 = upside down'], ['--layer <name|number>', 'Turn only this layer'], ...OUT], examples: ['rotate photo.jpg --turn right'] },
  flip: { usage: 'flip <files...> --direction horizontal|vertical', names: ['Mirror or flip the picture', 'Flip canvas'], help: 'Mirror the whole picture (or one layer) left to right, or flip it top to bottom.', options: [['--direction horizontal|vertical', 'horizontal mirrors left to right; vertical flips top to bottom'], ['--layer <name|number>', 'Flip only this layer'], ...OUT], examples: ['flip selfie.jpg --direction horizontal'] },
  adjust: { usage: 'adjust <adjustment> <files...> [--set setting=value ...]', names: menu('Image > Adjustments', 'Light and colour', 'Adjustments'), help: `Fix brightness, contrast and colour: ${opsIn('adjust').length} adjustments. "${BIN} adjust --help" lists them; "${BIN} adjust levels --help" shows one's settings.`, options: [['-s, --set <name=value>', 'A setting (repeat it, or write name=value after the files)'], ['--settings <json>', 'All settings as JSON, e.g. \'{"brightness": 20}\''], ...EDIT, ...OUT], examples: ['adjust brightness photo.jpg --set brightness=25 --set contrast=10', 'adjust auto-tone "holiday/*.jpg" --out-dir fixed'] },
  filter: { usage: 'filter <filter> <files...> [--set setting=value ...]', names: ['Effects', 'Filters'], help: `Blur, sharpen, noise, distortions, stylize and more: ${opsIn('filter').length} filters. "${BIN} filter --help" lists them; "${BIN} filter blur-gaussian --help" shows one's settings.`, options: [['-s, --set <name=value>', 'A setting (repeat it, or write name=value after the files)'], ['--settings <json>', 'All settings as JSON'], ['--color <#hex>', 'Main colour for effects that paint (default #000000)'], ['--color2 <#hex>', 'Second colour (default #ffffff)'], ...EDIT, ...OUT], examples: ['filter blur-gaussian photo.jpg --set radius=6', 'filter blur-iris portrait.jpg --set blur=20', 'filter mosaic face.png --area 40,40,120,120'] },
  layers: { usage: 'layers list|merge|flatten <files...>', names: ['Layers', 'Layers'], help: `list: every layer, top first. merge: ${names(...row('layer.merge-visible', 'Merge the shown layers', 'Merge visible'))} (or, with --layer, ${names(...row('layer.merge-down', 'Merge into the layer below', 'Merge down'))}). flatten: ${names(...row('layer.flatten', 'Flatten into one layer', 'Flatten image'))}.`, options: [['--layer <name|number>', 'merge: merge this layer into the one below'], ['--background <#hex|transparent>', 'flatten: what shows through see-through areas (default white)'], ...OUT], examples: ['layers list design.psd', 'layers merge design.psd --layer Shadow', 'layers flatten design.psd --to png'] },
  list: { usage: 'list [adjust|filter|<name>]', names: ['Every adjustment and filter', 'Operations'], help: 'Every adjustment and filter with its settings, or one of them in detail. With --json, the full settings schema for agents.', options: [], examples: ['list filter', 'list levels', 'list --json'] },
  search: { usage: 'search <what you want to do>', names: row('help.search', 'Search for a command', 'Search'), help: 'Find the command for a wish, like "make it brighter" or "blur the background".', options: [], examples: ['search "make it brighter"', 'search "square crop for instagram"'] },
};
const COMMON: [string, string][] = [['--json', 'Answer in JSON, for scripts and AI agents'], ['-q, --quiet', 'Only report problems'],
  ['--max-pixels <n>', `Largest picture to open or make, in pixels (default ${DEFAULT_MAX_PIXELS})`], ['-h, --help', 'Help for a command'], ['-v, --version', 'Version, maker and licence']];
const table = (rows: [string, string][], w = 30): string[] => rows.map(([a, b]) => `  ${a.padEnd(w)} ${b}`);
const LEGAL = [`Every saved file carries "${CREDIT}" in its file details.`,
  'Free software under the GNU AGPL-3.0 with additional terms (keep that credit). It comes with no warranty.', `Source: ${SOURCE_URL}`];

export function versionText(): string {
  return [`Free Photo Editor by ${AUTHOR} (${AUTHOR_URL})`, `${BIN} ${APP_VERSION} (command line)`,
    'Free software under the GNU Affero General Public License 3.0 with additional terms: keep the credit',
    `"Free Photo Editor by ${AUTHOR}" and mark changed versions as changed. It comes with no warranty.`, `Source code: ${SOURCE_URL}`].join('\n');
}
export function mainHelp(): string {
  return [`Free Photo Editor by ${AUTHOR} (${AUTHOR_URL}) · command line ${APP_VERSION}`,
    'Edit, convert and export pictures on your own computer. Nothing is uploaded and nothing costs money.', '',
    'Usage', `  ${BIN} <command> <files...> [options]`, `  (after "npm install -g ${BIN}" the short name fpe works too)`, '',
    'Commands (plain name · pro name)', ...Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(9)} ${names(...c.names).padEnd(42)} ${c.help.split('. ')[0].replace(/\.$/, '')}.`), '',
    'Files', '  Name files, or use patterns such as "photos/*.jpg" or "shoot/**/*.png" (keep the quotes).',
    '  Opens PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, ICO and PSD. Saves PNG, JPEG, WebP and PSD.',
    '  The original is never changed: results are saved next to it with a suffix, unless you choose a name.', '',
    'Options for every command', ...table([...OUT, ...COMMON]), '',
    'Examples', ...['adjust brightness photo.jpg --set brightness=25', 'filter blur-gaussian "photos/*.jpg" --set radius=6 --out-dir blurred',
      'resize photo.png --width 1200 --to webp', 'crop photo.jpg --aspect 1:1', 'search "make it brighter"'].map((e) => `  ${BIN} ${e}`), '',
    `More: ${BIN} <command> --help`, '', ...LEGAL].join('\n');
}
export function commandHelp(cmd: string): string {
  const c = COMMANDS[cmd];
  return [`${BIN} ${cmd}: ${names(...c.names)}`, c.help, '', 'Usage', `  ${BIN} ${c.usage} [options]`, '',
    ...(c.options.length ? ['Options', ...table(c.options), ''] : []), 'Also', ...table(COMMON), '',
    'Examples', ...c.examples.map((e) => `  ${BIN} ${e}`)].join('\n');
}
export function settingText(s: Setting): string {
  const range = s.type === 'choice' ? `One of: ${(s.choices ?? []).map((c) => `"${c}"`).join(', ')}; default "${s.default}".`
    : s.type === 'switch' ? `yes or no; default ${s.default ? 'yes' : 'no'}.`
      : `${s.min ?? ''}${s.max !== undefined ? ` to ${s.max}` : ''}${s.unit ? ' ' + s.unit : ''}, default ${s.default}.`;
  return `${s.group ? `${s.group}: ` : ''}${s.name}. ${s.help === s.name ? '' : s.help + ' '}${range}`;
}
export function opHelp(o: Operation): string {
  const ex = o.settings[0] ? ` --set ${o.settings[0].key}=${o.settings[0].type === 'choice' ? `"${o.settings[0].default}"` : o.settings[0].type === 'switch' ? 'yes' : o.settings[0].default}` : '';
  return [`${BIN} ${o.group} ${o.id}: ${names(o.plain, o.pro)} (${placeName(o.place)})`, o.help, ...(o.wish ? [`Search words: ${o.wish}`] : []), '',
    ...(o.settings.length ? ['Settings (--set name=value; any you leave out keep their default)', ...o.settings.map((s) => `  ${s.key.padEnd(12)} ${settingText(s)}`)] : ['No settings: it just runs.']),
    ...(o.usesColors ? ['', 'It paints with two colours: --color (main colour, default #000000) and --color2 (second colour, default #ffffff).'] : []), '',
    `Example: ${BIN} ${o.group} ${o.id} photo.png${ex}`].join('\n');
}
export function opsHelp(group: OpGroup): string {
  const ops = opsIn(group), out = [`${group === 'adjust' ? names(...COMMANDS.adjust.names) : names(...COMMANDS.filter.names)}: ${ops.length} you can run`,
    `Use: ${BIN} ${group} <name> <files...> [--set setting=value ...]   Settings of one: ${BIN} ${group} <name> --help`];
  let place = '';
  for (const o of ops) {
    if (o.place !== place) { place = o.place; out.push('', placeName(place)); }
    out.push(`  ${o.id.padEnd(18)} ${names(o.plain, o.pro)}: ${o.help}`);
  }
  return out.join('\n');
}
