// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The batch filters' dialogs (13 Nov 2026), in plain words: spin blur, lens fix, glass, ocean ripple, lens flare,
 * lighting, colour to see-through, dither, replace a colour, fewer colours and palette colour. commands.ts loads this
 * file the first time one of them runs (BATCH_IDS), so the first screen never downloads it; loading it adds them to ADJ.
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
