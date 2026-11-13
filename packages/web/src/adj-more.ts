// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The batch filters' dialogs (13 Nov 2026), in plain words: spin blur, lens fix, glass, ocean ripple, lens flare,
 * lighting, colour to see-through, dither, replace a colour, fewer colours and palette colour, then the census filters of batch 2. commands.ts loads this
 * file the first time one of them runs (BATCH_IDS, BATCH2_IDS), so the first screen never downloads it; loading it adds them to ADJ.
 */
import { ADJ, type AdjDef, type Ctl } from './commands';

const R = (key: string, label: string, help: string, min: number, max: number, value: number, unit = ''): Ctl => ({ key, label, help, min, max, value, step: 1, unit });
const PCT = (key: string, label: string, help: string, min: number, max: number, value: number): Ctl => R(key, label, help, min, max, value, '%');
const SEL = (key: string, label: string, help: string, options: readonly string[], value = 0): Ctl => ({ key, label, help, value, type: 'select', options });
const CHK = (key: string, label: string, help: string, value: number): Ctl => ({ key, label, help, value, type: 'check' });
const FX = (kind: string, controls: Ctl[], more: Partial<AdjDef> = {}): AdjDef => ({ op: 'fx', kind, controls, ...more });
const SEED = R('seed', 'Pattern', 'Pick another random pattern of the same kind.', 1, 100, 1);
const ACROSS = (v: number): Ctl => PCT('x', 'Across', 'Where the centre sits, from the left edge of the area.', 0, 100, v);
const DOWN = (v: number): Ctl => PCT('y', 'Down', 'Where the centre sits, from the top edge of the area.', 0, 100, v);
const DOTS = (v: number): Ctl => CHK('dither', 'Smooth with dots', 'Mix the kept colours in fine dots to fake the missing ones.', v);

export const MORE: Record<string, AdjDef> = {
  'filter.blur-spin': FX('spin-blur', [R('angle', 'Spin', 'How far the round area turns while it blurs; more looks faster.', 1, 360, 20, '°'),
    PCT('size', 'Circle size', 'How big the spinning circle is, against the selected area.', 5, 200, 80), ACROSS(50), DOWN(50)]),
  'filter.lens': FX('lens-fix', [R('distort', 'Bulge fix', 'Right straightens lines that bulge outwards; left fixes lines that pinch in.', -100, 100, 15),
    R('vignette', 'Corner light', 'Right lightens dark corners; left darkens them.', -100, 100, 30),
    PCT('mid', 'Corner reach', 'How far in from the corners the light change starts.', 0, 100, 50),
    R('fringe', 'Colour fringe fix', 'Moves red and blue back in line where edges show coloured outlines.', -100, 100, 0)]),
  'filter.glass': FX('glass', [SEL('texture', 'Glass kind', 'Frosted, square blocks, tiny lenses or woven canvas.', ['Frosted', 'Blocks', 'Tiny lenses', 'Canvas']),
    R('distort', 'Distortion', 'How far the glass bends the picture.', 0, 20, 5), R('smooth', 'Smoothness', 'Bigger makes the bends wider and softer.', 1, 15, 3),
    PCT('scale', 'Texture size', 'How big the glass pattern is.', 50, 200, 100), SEED]),
  'filter.ocean-ripple': FX('ocean-ripple', [R('size', 'Ripple size', 'How far apart the ripples are.', 1, 15, 9),
    R('amount', 'Ripple strength', 'How far the ripples bend the picture.', 0, 20, 9), SEED]),
  'filter.lens-flare': FX('lens-flare', [SEL('kind', 'Lens', 'Each lens makes a different flare: rays, a clean glow or a tight ring.', ['Zoom lens', 'Wide lens', 'Long lens']),
    PCT('bright', 'Brightness', 'How bright the flare is.', 10, 300, 100), ACROSS(30), DOWN(30)]),
  'filter.lighting': FX('lighting', [SEL('type', 'Light', 'A spotlight, a lamp shining all round, or flood light from one side.', ['Spotlight', 'Lamp', 'Flood light']),
    PCT('bright', 'Brightness', 'How strong the light is.', 0, 200, 100), PCT('size', 'Light size', 'How wide the pool of light is.', 5, 200, 60),
    PCT('ambient', 'Room light', 'How much of the picture still shows outside the light.', 0, 100, 25),
    PCT('bumps', 'Raised texture', 'Light areas look raised, so the light picks out texture.', 0, 100, 0), ACROSS(40), DOWN(35)]),
  'filter.color-to-alpha': FX('color-to-alpha', [SEL('which', 'Colour', 'Which colour turns see-through; colours that contain some of it fade partly.',
    ['White', 'Black', 'The main colour', 'The second colour']), PCT('clear', 'Fully clear within', 'Colours this close to it turn fully see-through.', 0, 99, 0)], { colors: true }),
  'filter.dither': FX('dither', [R('tones', 'Tones per colour', 'How many flat tones each colour keeps; dots fake the ones in between.', 2, 16, 4),
    SEL('method', 'Dot pattern', 'Spread the rounding for a smooth look, a regular grid, or random dots.', ['Smooth spread', 'Regular grid', 'Random dots']),
    CHK('grey', 'Shades of grey', 'Turn the picture grey first.', 0), SEED]),
  'image.adj-replace': FX('replace-color', [SEL('from', 'Colour to change', 'The colour at the middle of the selected area, or your main colour.', ['Middle of the area', 'The main colour']),
    R('fuzz', 'Range', 'How different a colour can be and still change.', 0, 200, 60), R('hue', 'New hue', 'Turns the matched colour round the colour wheel.', -180, 180, 120, '°'),
    R('sat', 'Colour strength', 'More or less vivid.', -100, 100, 0), R('light', 'Lightness', 'Lighter or darker.', -100, 100, 0)], { colors: true }),
  'image.reduce-colors': FX('reduce-colors', [R('count', 'Colours', 'How many colours are kept; they are chosen to fit this picture.', 2, 256, 8), DOTS(0)]),
  'image.mode-indexed': FX('indexed', [SEL('palette', 'Palette', 'Colours fitted to this picture, the web-safe set, greys, or black and white.',
    ['Fitted (256 colours)', 'Web-safe (216 colours)', 'Greys (16)', 'Black and white']), DOTS(1)]),
};
Object.assign(ADJ, MORE);

/** The second batch (13 Nov 2026): census filters on the "Filters & blur" tab, same pattern, same lazy file. */
export const MORE2: Record<string, AdjDef> = {
  'filter.kaleidoscope': FX('kaleidoscope', [R('repeats', 'Repeats', 'How many times the slice and its mirror image go round the centre.', 1, 12, 3),
    R('turn', 'Turn', 'Turns the slices round the centre.', 0, 360, 0, '°'), ACROSS(50), DOWN(50)]),
  'filter.alien-map': FX('alien-map', [R('cycles', 'Wildness', 'How many times each colour swings between dark and bright as the picture gets lighter.', 1, 10, 3),
    R('red', 'Red start', 'Where the red swing starts; turning it changes which parts go red.', 0, 360, 0, '°'),
    R('green', 'Green start', 'Where the green swing starts.', 0, 360, 120, '°'), R('blue', 'Blue start', 'Where the blue swing starts.', 0, 360, 240, '°')]),
  'filter.bloom': FX('bloom', [R('threshold', 'Glow from', 'Only parts brighter than this give off light.', 0, 254, 170),
    R('size', 'Glow size', 'How far the light spreads.', 1, 200, 12, ' px'), PCT('strength', 'Strength', 'How bright the glow is.', 0, 300, 80)]),
  'filter.edge-detect': FX('edge-detect', [SEL('method', 'Method', 'Four ways to find lines: smooth, even, thin, or a line on both sides of each edge.',
    ['Smooth (Sobel)', 'Even (Prewitt)', 'Thin (Roberts)', 'Both sides (Laplace)']), PCT('amount', 'Strength', 'Makes faint lines stronger.', 10, 400, 100),
    CHK('dark', 'Dark lines on white', 'Show the lines dark on a white page, like a drawing.', 0)]),
  'filter.deinterlace': FX('deinterlace', [SEL('keep', 'Lines to keep', 'The other lines are rebuilt from the lines above and below them.',
    ['1st, 3rd, 5th and so on', '2nd, 4th, 6th and so on'])]),
  'filter.destripe': FX('destripe', [R('width', 'Stripe width', 'The widest stripe it looks for; bigger also evens out broad bands.', 1, 200, 10, ' px'),
    PCT('strength', 'Strength', 'How much of each stripe is removed.', 0, 100, 100)]),
  'filter.video-degrade': FX('video-degrade', [SEL('pattern', 'Pattern', 'Colour stripes of an old TV, colour dots, or dark scan lines.', ['Stripes', 'Dots', 'Scan lines']),
    R('size', 'Size', 'How big each stripe, dot or line is.', 1, 16, 2, ' px'), PCT('strength', 'Strength', 'How strong the pattern is.', 0, 100, 60)]),
  'filter.lowlight': FX('lowlight', [PCT('dark', 'How dark', 'How far the eye has turned to night vision: colours fade and the scene dims.', 0, 100, 70),
    PCT('blue', 'Blue tint', 'Night vision sees blue-green best, so a night scene looks cooler.', 0, 100, 50)]),
  'filter.bump-map': FX('bump-map', [SEL('mode', 'Result', 'Light areas look raised under a light, or a normal map for games (green points up).', ['Raised shading', 'Normal map']),
    R('depth', 'Depth', 'How tall light areas stand over dark ones.', 1, 100, 20), R('angle', 'Light from', 'Where the light comes from: 0 is the right, 90 the top.', 0, 360, 135, '°')]),
  'filter.star-burst': FX('star-burst', [PCT('top', 'Brightest part', 'Stars sit on the brightest points, within this share of the light range.', 1, 100, 15),
    R('count', 'Most stars', 'The largest number of stars.', 1, 50, 12), SEL('rays', 'Rays', 'How many rays each star has.', ['4', '6', '8']),
    PCT('length', 'Ray length', 'How long the rays are, against the area.', 1, 100, 10), PCT('bright', 'Brightness', 'How bright the stars are.', 10, 300, 100),
    R('turn', 'Turn', 'Turns the rays.', 0, 180, 0, '°')]),
  'filter.blur-edge-keep': FX('edge-keep-blur', [R('radius', 'Blur amount', 'How far the smoothing reaches.', 1, 10, 4, ' px'),
    R('keep', 'Keep edges above', 'Colour differences bigger than this count as edges and stay sharp.', 1, 255, 30)]),
  'filter.antialias': FX('antialias', [R('edge', 'Edge contrast', 'Only edges with at least this much contrast are smoothed.', 1, 255, 24),
    PCT('strength', 'Strength', 'How much the steps are smoothed.', 0, 100, 80)]),
};
Object.assign(ADJ, MORE2);

/** The second batch, part 2 (13 Nov 2026): each census row builds every look its name lists, picked in the Look list. */
const LOOK = (help: string, options: readonly string[]): Ctl => SEL('look', 'Look', help, options);
export const MORE3: Record<string, AdjDef> = {
  'filter.outline-relief': FX('outline', [LOOK('Dark lines traced along the edges, or the edges raised and sunk with the colours kept.', ['Traced outline', 'Relief']),
    PCT('amount', 'Strength', 'How dark the lines are, or how high the relief stands.', 10, 400, 100),
    R('width', 'Line width (outline)', 'How thick the traced lines are.', 1, 10, 1, ' px'),
    R('angle', 'Light from (relief)', 'Where the light comes from: 0 is the right, 90 the top.', 0, 360, 135, '°'),
    R('height', 'Height (relief)', 'How far apart the raised and sunk sides of each edge are.', 1, 10, 2, ' px')]),
  'filter.newsprint': FX('newsprint', [LOOK('Round ink dots like a newspaper photo, or engraved lines that thicken in the dark parts.', ['Halftone dots', 'Engraved lines']),
    R('size', 'Spacing', 'How far apart the dots or lines are.', 2, 64, 8, ' px'), R('angle', 'Angle', 'Turns the dot grid or the lines.', 0, 180, 45, '°')]),
  'filter.dents': FX('dents', [LOOK('Bends the picture as if seen through dented glass, or mirrors it inside square tiles.', ['Dents', 'Mirror tiles']),
    R('size', 'Size', 'How big each dent or tile is.', 2, 400, 40, ' px'), R('amount', 'Depth (dents)', 'How far the dents push the picture.', 0, 100, 8, ' px'),
    SEL('flip', 'Mirror (tiles)', 'Which way each tile mirrors its part of the picture.', ['Both ways', 'Left to right', 'Top to bottom']), SEED]),
  'filter.cartoon': FX('cartoon', [LOOK('Flat colours with black lines, a black and white photocopy, tilted squares of colour, or a wall of glass blocks.',
    ['Cartoon', 'Photocopy', 'Cubist squares', 'Glass blocks']),
    R('size', 'Line reach (cartoon, photocopy)', 'How far round each pixel it looks to decide whether it is a dark line.', 1, 100, 6, ' px'),
    PCT('edge', 'Line threshold (cartoon, photocopy)', 'How much darker than its surroundings a pixel must be to become ink; lower finds more lines.', 1, 90, 10),
    R('levels', 'Colour steps (cartoon)', 'How many flat tones each colour keeps.', 2, 16, 4),
    R('tile', 'Tile size (squares, glass)', 'How big the squares or glass blocks are.', 2, 400, 16, ' px'),
    PCT('amount', 'Glass bend (glass)', 'How much each block squeezes the view behind it.', 0, 100, 50), SEED], { colors: true }),
  'filter.ink-sketch': FX('sketch', [LOOK('Ink lines over paler colour, or a grey pencil drawing on white paper.', ['Ink drawing', 'Pencil drawing']),
    PCT('amount', 'Line strength (ink)', 'How dark the ink lines are.', 10, 400, 100), R('width', 'Line width (ink)', 'How thick the ink lines are.', 1, 10, 1, ' px'),
    PCT('color', 'Colour (ink)', 'How much of the colour stays under the ink.', 0, 100, 50),
    R('size', 'Softness (pencil)', 'Bigger draws broader, softer pencil shading.', 1, 100, 4, ' px'), PCT('dark', 'Darkness (pencil)', 'How dark the pencil lines are.', 10, 300, 100)]),
  'filter.linocut': FX('linocut', [LOOK('A black and white print cut from a lino block, or coloured glass held by dark lead lines.', ['Lino print', 'Leaded glass']),
    R('level', 'Ink below (lino)', 'Parts darker than this print black.', 1, 254, 128), R('smooth', 'Smoothness (lino)', 'Smooths the cut edges.', 0, 50, 1, ' px'),
    CHK('gouges', 'Carved lines (lino)', 'Cut thin white lines into the dark parts, thicker where the picture is lighter.', 1),
    R('spacing', 'Line spacing (lino)', 'How far apart the carved lines are.', 3, 40, 6, ' px'),
    R('cell', 'Piece size (glass)', 'How big each piece of glass is.', 6, 400, 24, ' px'), R('lead', 'Lead width (glass)', 'How thick the dark lines between pieces are.', 0, 20, 2, ' px'), SEED]),
  'filter.patterns': FX('patterns', [LOOK('Fills the area with a pattern in your main colour over your second colour.', ['Grid', 'Checkerboard', 'Maze', 'Spiral', 'Sine waves', 'Jigsaw']),
    R('size', 'Size', 'How big each square, maze cell, spiral turn, wave or puzzle piece is.', 2, 400, 24, ' px'),
    R('width', 'Line width (grid, maze, jigsaw)', 'How thick the lines are.', 1, 100, 2, ' px'), SEED], { colors: true }),
  'filter.blur-sketch': FX('stroke-blur', [R('length', 'Stroke length', 'How long each brush stroke is; longer looks more painted.', 1, 40, 6, ' px'),
    R('angle', 'Stroke angle', 'Which way the strokes run: 0 is level, 90 upright.', 0, 180, 45, '°'),
    R('jitter', 'Wobble', 'How much each stroke turns from that angle, for a hand-painted look.', 0, 90, 20, '°'), SEED]),
  'filter.blur-tileable': FX('wrap-blur', [R('radius', 'Blur amount', 'How far the blur reaches; it wraps round, so the left edge blends with the right.', 1, 200, 8, ' px'),
    R('edges', 'Only near the edges', 'Blur only this close to the edges, so the middle stays sharp; 0 blurs the whole area.', 0, 1000, 32, ' px')]),
};
Object.assign(ADJ, MORE3);
