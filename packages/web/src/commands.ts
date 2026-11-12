// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * What every Ready function does. Menus, the tool column, search, shortcuts and the start screen all run commands
 * through this table; a row of the function map that is Ready must have a handler here (a unit test checks it).
 * Also holds the adjustment dialogs' controls, in plain words. Pure data and small functions: no DOM.
 */
import { COLOR_FAMILIES, GRADIENT_MAPS, PHOTO_FILTERS, SOURCE_URL, type JobOp } from '@free-photoeditor/core';
import type { Editor } from './app';

export type ToolId = 'move' | 'select' | 'crop' | 'brush' | 'pencil' | 'eraser' | 'eyedropper' | 'hand' | 'zoom';
export interface Handler { run: (e: Editor) => unknown; enabled: (e: Editor) => boolean; checked?: (e: Editor) => boolean; }
export interface Ctl {
  key: string; label: string; help: string; value: number; min?: number; max?: number; step?: number; unit?: string;
  type?: 'range' | 'select' | 'check' | 'num'; options?: readonly string[]; group?: string;
  /** For a select: settings to fill in when each option is picked (the custom filter's ready-made grids). */
  fills?: ReadonlyArray<Record<string, number>>;
}
/** `colors` passes the main and second colours to the filter; `handles` names its on-picture handles (handles.ts). */
export interface AdjDef { op: JobOp; kind?: string; controls: Ctl[]; instant?: boolean; colors?: boolean; handles?: 'iris' | 'tilt' | 'field'; }

const R = (key: string, label: string, help: string, min: number, max: number, value: number, step = 1, unit = '', group?: string): Ctl =>
  ({ key, label, help, min, max, value, step, unit, group });
const SEL = (key: string, label: string, help: string, options: readonly string[], value = 0, fills?: Ctl['fills']): Ctl => ({ key, label, help, value, type: 'select', options, fills });
const CHK = (key: string, label: string, help: string, value = 1): Ctl => ({ key, label, help, value, type: 'check' });
const tones = (prefix: string, group: string): Ctl[] => [
  R(prefix + 'r', 'Cyan ↔ Red', 'Left adds cyan, right adds red.', -100, 100, 0, 1, '', group),
  R(prefix + 'g', 'Magenta ↔ Green', 'Left adds magenta, right adds green.', -100, 100, 0, 1, '', group),
  R(prefix + 'b', 'Yellow ↔ Blue', 'Left adds yellow, right adds blue.', -100, 100, 0, 1, '', group)];
const mix = (out: string, name: string, own: string): Ctl[] => ['r', 'g', 'b'].map((c, i) => R(out + c, 'From ' + ['red', 'green', 'blue'][i],
  `How much of the original ${['red', 'green', 'blue'][i]} goes into the ${name.toLowerCase()}.`, -200, 200, c === own ? 100 : 0, 1, '%', name));

const FX = (kind: string, controls: Ctl[], more: Partial<AdjDef> = {}): AdjDef => ({ op: 'fx', kind, controls, ...more });
const SEED = R('seed', 'Pattern', 'Pick another random pattern of the same kind.', 1, 100, 1);
const PX = (key: string, label: string, help: string, min: number, max: number, value: number, step = 1): Ctl => R(key, label, help, min, max, value, step, ' px');
const PCT = (key: string, label: string, help: string, min: number, max: number, value: number): Ctl => R(key, label, help, min, max, value, 1, '%');
const SPOT = (key: string, label: string, help: string, value: number): Ctl => PCT(key, label, help, 0, 100, value);
/** The custom filter's 5×5 grid: k0 is the top-left neighbour, k12 the pixel itself, k24 the bottom-right. */
const GRID: Ctl[] = Array.from({ length: 25 }, (_, i) => ({ key: 'k' + i, label: `Row ${Math.floor(i / 5) + 1}, column ${(i % 5) + 1}`,
  help: 'How much this neighbour counts; the middle box is the pixel itself.', value: 0, min: -99, max: 99, step: 1, type: 'num', group: 'Numbers' }));
const kernel = (cells: Record<number, number>, scale = 1, offset = 0): Record<string, number> => {
  const o: Record<string, number> = { scale, offset };
  for (let i = 0; i < 25; i++) o['k' + i] = cells[i] ?? 0;
  return o;
};
const KERNELS = [kernel({ 7: -1, 11: -1, 12: 5, 13: -1, 17: -1 }), kernel({ 6: 1, 7: 1, 8: 1, 11: 1, 12: 1, 13: 1, 16: 1, 17: 1, 18: 1 }, 9),
  kernel({ 6: -1, 7: -1, 8: -1, 11: -1, 12: 8, 13: -1, 16: -1, 17: -1, 18: -1 }), kernel({ 6: -2, 7: -1, 11: -1, 12: 1, 13: 1, 17: 1, 18: 2 })];
for (const c of GRID) c.value = KERNELS[0][c.key];
const CLOUDS = [PX('size', 'Cloud size', 'How big the clouds are.', 2, 400, 120), R('detail', 'Detail', 'More adds finer wisps.', 1, 8, 5), SEED];

export const ADJ: Record<string, AdjDef> = {
  'image.adj-brightness': { op: 'adjust', kind: 'brightness-contrast', controls: [
    R('brightness', 'Brightness', 'Lighter or darker overall.', -100, 100, 0), R('contrast', 'Contrast', 'More or less difference between darks and lights.', -100, 100, 0)] },
  'image.adj-levels': { op: 'adjust', kind: 'levels', controls: [
    R('inB', 'Darkest point', 'Everything this dark or darker becomes black.', 0, 253, 0),
    R('gamma', 'Middle tones', 'Above 1 lightens the middle tones; below 1 darkens them.', 0.1, 4, 1, 0.01),
    R('inW', 'Brightest point', 'Everything this bright or brighter becomes white.', 2, 255, 255),
    R('outB', 'Lift the blacks', 'Raise to make black look faded, like old film.', 0, 255, 0),
    R('outW', 'Dim the whites', 'Lower to make white less bright.', 0, 255, 255)] },
  'image.adj-curves': { op: 'adjust', kind: 'curves', controls: [
    R('p0', 'Blacks', 'Raise to fade the blacks.', 0, 255, 0), R('p1', 'Shadows', 'Raise to brighten the dark tones, lower to deepen them.', 0, 255, 64),
    R('p2', 'Middle tones', 'Raise to brighten the middle tones, lower to darken them.', 0, 255, 128),
    R('p3', 'Lights', 'Raise to brighten the light tones, lower to calm them.', 0, 255, 192), R('p4', 'Whites', 'Lower to dim the whites.', 0, 255, 255)] },
  'image.adj-exposure': { op: 'adjust', kind: 'exposure', controls: [
    R('ev', 'Exposure', 'Like letting more or less light into the camera, in stops.', -5, 5, 0, 0.05, ' stops'),
    R('offset', 'Shadow lift', 'Lifts or deepens the darkest tones.', -0.5, 0.5, 0, 0.005),
    R('gamma', 'Middle tones', 'Above 1 brightens the middle tones; below 1 darkens them.', 0.1, 3, 1, 0.01)] },
  'image.adj-vibrance': { op: 'adjust', kind: 'vibrance', controls: [
    R('vibrance', 'Colour boost', 'Strengthens dull colours most and leaves strong ones alone.', -100, 100, 0),
    R('saturation', 'Colour strength', 'Makes every colour stronger or weaker.', -100, 100, 0)] },
  'image.adj-hue': { op: 'adjust', kind: 'hue-saturation', controls: [
    R('hue', 'Colour shift', 'Turns every colour around the colour wheel.', -180, 180, 0, 1, '°'),
    R('saturation', 'Colour strength', 'Makes colours stronger or weaker.', -100, 100, 0), R('lightness', 'Lightness', 'Lighter or darker, toward white or black.', -100, 100, 0)] },
  'image.adj-color-balance': { op: 'adjust', kind: 'color-balance', controls: [
    ...tones('s', 'Darks'), ...tones('m', 'Middle tones'), ...tones('h', 'Lights'),
    CHK('pl', 'Keep brightness', 'Keeps the picture just as bright while the colours shift.')] },
  'image.adj-bw': { op: 'adjust', kind: 'bw-mix', controls: [
    R('reds', 'Reds', 'How bright the reds become in grey.', -200, 300, 40, 1, '%'), R('yellows', 'Yellows', 'How bright the yellows become in grey.', -200, 300, 60, 1, '%'),
    R('greens', 'Greens', 'How bright the greens become in grey.', -200, 300, 40, 1, '%'), R('cyans', 'Cyans', 'How bright the cyans become in grey.', -200, 300, 60, 1, '%'),
    R('blues', 'Blues', 'How bright the blues (such as the sky) become in grey.', -200, 300, 20, 1, '%'),
    R('magentas', 'Magentas', 'How bright the magentas become in grey.', -200, 300, 80, 1, '%')] },
  'image.adj-photo-filter': { op: 'adjust', kind: 'photo-filter', controls: [
    SEL('color', 'Filter colour', 'The colour of the filter on the lens.', PHOTO_FILTERS.map((f) => f[0])),
    R('density', 'Strength', 'How strongly the filter colours the picture.', 1, 100, 25, 1, '%'),
    CHK('pl', 'Keep brightness', 'Keeps the picture just as bright under the filter.')] },
  'image.adj-channel-mixer': { op: 'adjust', kind: 'channel-mixer', controls: [
    ...mix('r', 'Red result', 'r'), ...mix('g', 'Green result', 'g'), ...mix('b', 'Blue result', 'b'),
    CHK('mono', 'Grey result', 'Make a black and white picture mixed by the red result row.', 0)] },
  'image.adj-posterize': { op: 'adjust', kind: 'posterize', controls: [R('levels', 'Tones per colour', 'How many flat tones each colour keeps.', 2, 32, 4)] },
  'image.adj-threshold': { op: 'adjust', kind: 'threshold', controls: [R('level', 'Split point', 'Pixels brighter than this turn white; the rest turn black.', 1, 255, 128)] },
  'image.adj-gradient-map': { op: 'adjust', kind: 'gradient-map', controls: [
    SEL('preset', 'Colours', 'The colours that replace the darks through to the lights.', GRADIENT_MAPS.map((g) => g[0])),
    CHK('reverse', 'Swap ends', 'Put the light colour on the darks.', 0)] },
  'image.adj-selective-color': { op: 'adjust', kind: 'selective-color', controls: [
    SEL('family', 'Colour family', 'Which colours to change.', COLOR_FAMILIES),
    R('c', 'Cyan', 'Right adds cyan (less red) to the chosen colours; left takes it away.', -100, 100, 0, 1, '%'),
    R('m', 'Magenta', 'Right adds magenta (less green); left takes it away.', -100, 100, 0, 1, '%'),
    R('y', 'Yellow', 'Right adds yellow (less blue); left takes it away.', -100, 100, 0, 1, '%'),
    R('k', 'Black', 'Right darkens the chosen colours; left lightens them.', -100, 100, 0, 1, '%')] },
  'image.adj-shadows': { op: 'adjust', kind: 'shadows-highlights', controls: [
    R('shadows', 'Lift shadows', 'How much to brighten dark areas.', 0, 100, 35, 1, '%'),
    R('highlights', 'Calm highlights', 'How much to darken bright areas.', 0, 100, 0, 1, '%'),
    R('radius', 'Area size', 'How big a neighbourhood decides what counts as a shadow.', 1, 150, 30, 1, ' px')] },
  'image.adj-invert': { op: 'adjust', kind: 'invert', instant: true, controls: [] },
  'image.adj-desaturate': { op: 'adjust', kind: 'desaturate', instant: true, controls: [] },
  'image.adj-equalize': { op: 'adjust', kind: 'equalize', instant: true, controls: [] },
  'image.auto-tone': { op: 'adjust', kind: 'auto-tone', instant: true, controls: [] },
  'image.auto-contrast': { op: 'adjust', kind: 'auto-contrast', instant: true, controls: [] },
  'image.auto-color': { op: 'adjust', kind: 'auto-color', instant: true, controls: [] },
  'filter.blur-gaussian': { op: 'gaussian-blur', controls: [R('radius', 'Blur amount', 'How far each pixel spreads; bigger is blurrier.', 0.5, 100, 4, 0.5, ' px')] },
  'filter.unsharp': { op: 'sharpen', controls: [
    R('amount', 'Strength', 'How much crisper the edges become.', 0, 5, 1, 0.1, '×'), R('radius', 'Edge width', 'How wide the sharpened edges are.', 0.5, 10, 1, 0.5, ' px'),
    R('threshold', 'Ignore small differences', 'Leaves smooth areas such as skin alone.', 0, 255, 0)] },
  'filter.sharpen': { op: 'sharpen', instant: true, controls: [R('amount', 'Strength', '', 0, 5, 0.6, 0.1), R('radius', 'Edge width', '', 0.5, 10, 1)] },
  'filter.sharpen-more': { op: 'sharpen', instant: true, controls: [R('amount', 'Strength', '', 0, 5, 1.5, 0.1), R('radius', 'Edge width', '', 0.5, 10, 1)] },
  // ---------- W2: every filter family ----------
  'filter.blur-box': FX('box-blur', [PX('radius', 'Blur amount', 'How far each pixel spreads, in square steps; bigger is blurrier.', 1, 100, 6)]),
  'filter.blur-motion': FX('motion-blur', [R('angle', 'Direction', 'Which way the streaks run: 0° is side to side, 90° is up and down.', -180, 180, 0, 1, '°'),
    PX('distance', 'Streak length', 'How far the picture seems to move.', 1, 200, 20)]),
  'filter.blur-radial': FX('radial-blur', [SEL('mode', 'Kind', 'Spin turns round the centre; Zoom rushes toward it.', ['Spin', 'Zoom']),
    R('amount', 'Strength', 'How strong the spin or the zoom is.', 1, 100, 10), SPOT('cx', 'Centre across', 'Where the centre is, from the left edge.', 50),
    SPOT('cy', 'Centre down', 'Where the centre is, from the top edge.', 50)]),
  'filter.blur-surface': FX('surface-blur', [PX('radius', 'Size', 'How big an area is smoothed round each pixel.', 1, 30, 5),
    R('threshold', 'Smooth up to', 'Lower keeps more edges sharp; higher smooths more.', 2, 255, 30)]),
  'filter.blur-lens': FX('lens-blur', [PX('radius', 'Blur amount', 'How out of focus the picture looks.', 1, 60, 10),
    PCT('bright', 'Bright spots', 'How much bright points glow into round discs, like a real lens.', 0, 100, 40),
    R('threshold', 'Glow from', 'Only parts brighter than this glow.', 0, 254, 200)]),
  'filter.blur-average': FX('average', [PCT('strength', 'Strength', 'How far the area moves toward its one average colour.', 1, 100, 100)]),
  'filter.blur-smart': FX('smart-blur', [PX('radius', 'Size', 'How big an area is blurred round each pixel.', 1, 30, 5),
    R('threshold', 'Keep edges', 'Differences bigger than this count as edges and stay sharp.', 1, 255, 40),
    SEL('mode', 'Show', 'The blurred picture, only the edges, or white edges over the picture.', ['Blurred picture', 'Edges only', 'White edges on top'])]),
  'filter.blur-field': FX('field-blur', [PX('b1', 'Blur at pin 1', 'How blurry the picture is at the first pin.', 0, 100, 0, 0.5),
    PX('b2', 'Blur at pin 2', 'How blurry the picture is at the second pin; the blur changes smoothly between them.', 0, 100, 20, 0.5),
    SPOT('x1', 'Pin 1 across', 'Where the first pin is, from the left. You can also drag it on the picture.', 30), SPOT('y1', 'Pin 1 down', 'Where the first pin is, from the top.', 30),
    SPOT('x2', 'Pin 2 across', 'Where the second pin is, from the left.', 70), SPOT('y2', 'Pin 2 down', 'Where the second pin is, from the top.', 70)], { handles: 'field' }),
  'filter.blur-iris': FX('iris-blur', [PX('blur', 'Background blur', 'How blurry everything outside the sharp spot becomes.', 0.5, 100, 12, 0.5),
    PCT('rw', 'Spot width', 'How wide the sharp spot is. You can also drag its handles on the picture.', 2, 100, 25),
    PCT('rh', 'Spot height', 'How tall the sharp spot is.', 2, 100, 30), PCT('feather', 'Soft edge', 'How gently sharp turns into blurred.', 2, 100, 50),
    SPOT('cx', 'Spot across', 'Where the sharp spot is, from the left.', 50), SPOT('cy', 'Spot down', 'Where the sharp spot is, from the top.', 50)], { handles: 'iris' }),
  'filter.blur-tilt': FX('tilt-blur', [PX('blur', 'Blur', 'How blurry the parts above and below the sharp strip become.', 0.5, 100, 12, 0.5),
    PCT('band', 'Sharp strip', 'How tall the sharp strip is. You can also drag its handles on the picture.', 0, 100, 15),
    PCT('fade', 'Soft edge', 'How gently the strip turns blurry.', 1, 100, 20), R('angle', 'Tilt', 'Turn the sharp strip.', -90, 90, 0, 1, '°'),
    SPOT('cy', 'Strip position', 'Where the sharp strip sits, from the top.', 50), SPOT('cx', 'Strip centre across', 'Where the strip turns round, from the left.', 50)], { handles: 'tilt' }),
  'filter.smart-sharpen': FX('smart-sharpen', [PCT('amount', 'Strength', 'How much crisper the edges become.', 1, 500, 150),
    PX('radius', 'Edge width', 'How wide the sharpened edges are.', 0.5, 10, 1.5, 0.1), PCT('noise', 'Ignore grain', 'Leaves tiny grainy differences alone.', 0, 100, 10),
    PCT('halo', 'Halo control', 'Stops bright and dark outlines forming round edges.', 0, 100, 60)]),
  'filter.sharpen-edges': FX('sharpen-edges', [PCT('amount', 'Strength', 'How much crisper the edges become.', 1, 500, 150),
    PX('radius', 'Edge width', 'How wide the sharpened edges are.', 0.5, 5, 1, 0.1), R('edge', 'Edges from', 'Only places with at least this much contrast are sharpened.', 1, 120, 20)]),
  'filter.add-noise': FX('add-noise', [PCT('amount', 'Grain', 'How strong the grain is.', 1, 100, 20),
    SEL('dist', 'Grain kind', 'Even grain, or film-like grain with a few strong specks.', ['Even', 'Film-like']), CHK('mono', 'Grey grain only', 'Grain without coloured specks.', 0), SEED]),
  'filter.reduce-noise': FX('reduce-noise', [PCT('strength', 'Smoothing', 'How strongly grain is smoothed away.', 0, 100, 60),
    PCT('detail', 'Keep detail', 'Brings back fine detail such as hair and texture.', 0, 100, 30), PCT('color', 'Remove colour blotches', 'Smooths coloured specks out of dark photos.', 0, 100, 50)]),
  'filter.median': FX('median', [PX('radius', 'Size', 'How big an area each pixel looks at; bigger removes bigger specks.', 1, 50, 2)]),
  'filter.dust': FX('dust', [PX('radius', 'Size', 'How big the dust and scratches are.', 1, 20, 2), R('threshold', 'Protect texture', 'Leaves fine detail alone; raise it to protect more.', 0, 128, 10)]),
  'filter.despeckle': FX('despeckle', [PX('radius', 'Strength', 'How big the specks are that get smoothed away.', 1, 5, 1), R('edge', 'Keep edges', 'Edges with more contrast than this stay crisp.', 1, 120, 30)]),
  'filter.pinch': FX('pinch', [PCT('amount', 'Squeeze', 'Right squeezes the middle in; left pushes it out.', -100, 100, 50)]),
  'filter.twirl': FX('twirl', [R('angle', 'Swirl', 'How far the middle turns; left swirls the other way.', -999, 999, 90, 1, '°')]),
  'filter.ripple': FX('ripple', [PCT('amount', 'Strength', 'How strong the ripples are.', -999, 999, 100), SEL('size', 'Ripple size', 'Small, medium or large ripples.', ['Small', 'Medium', 'Large'], 1)]),
  'filter.wave': FX('wave', [PX('wavelength', 'Wave length', 'The distance from one wave to the next.', 2, 300, 60), PX('amplitude', 'Wave height', 'How far the waves bend the picture.', 1, 100, 10),
    SEL('type', 'Wave shape', 'Smooth, pointed or square waves.', ['Smooth', 'Pointed', 'Square']), SEL('dir', 'Direction', 'Which way the picture bends.', ['Both ways', 'Side to side', 'Up and down'])]),
  'filter.polar': FX('polar', [SEL('mode', 'Kind', 'Wrap the picture into a circle (a tiny planet), or unwrap a circle into a strip.', ['Wrap into a circle', 'Unwrap a circle'])]),
  'filter.spherize': FX('spherize', [PCT('amount', 'Bulge', 'Right bulges the middle out like a ball; left pushes it in.', -100, 100, 60),
    SEL('mode', 'Direction', 'Bulge every way, or only sideways, or only up and down.', ['Every way', 'Side to side', 'Up and down'])]),
  'filter.zigzag': FX('zigzag', [PCT('amount', 'Strength', 'How strong the rings are.', -100, 100, 30), R('ridges', 'Rings', 'How many rings spread out.', 1, 20, 5),
    SEL('style', 'Style', 'How the rings move the picture.', ['Pond ripples', 'Out from the centre', 'Round the centre'])]),
  'filter.displace': FX('displace', [PCT('hscale', 'Push sideways', 'How far pixels move left and right.', -100, 100, 15), PCT('vscale', 'Push up and down', 'How far pixels move up and down.', -100, 100, 15),
    SEL('map', 'Map', 'The pattern of light and dark that decides where each pixel moves.', ['Soft clouds', 'The picture itself']), PX('size', 'Pattern size', 'How big the cloud pattern is.', 2, 200, 40), SEED]),
  'filter.shear': FX('shear', [PCT('amount', 'Bend', 'How far the picture bends sideways.', -100, 100, 30), SEL('shape', 'Bend shape', 'One arc, an S curve or a wave.', ['One arc', 'S curve', 'Wave']),
    SEL('edge', 'Edges', 'What fills the side the picture leaves.', ['Wrap round', 'Repeat the edge'])]),
  'filter.emboss': FX('emboss', [R('angle', 'Light direction', 'Where the light comes from.', -180, 180, 135, 1, '°'), PX('height', 'Depth', 'How deep the stamp looks.', 1, 10, 3),
    PCT('amount', 'Strength', 'How strong the raised edges are.', 1, 500, 100), CHK('color', 'Keep colour', 'Keep the colours instead of grey metal.', 0)]),
  'filter.find-edges': FX('find-edges', [PCT('strength', 'Line strength', 'How dark the outlines are.', 10, 400, 100)]),
  'filter.solarize': FX('solarize', [R('level', 'Turn point', 'Tones brighter than this turn into their negative.', 0, 255, 128)]),
  'filter.oil-paint': FX('oil-paint', [PX('radius', 'Brush size', 'How big the brush strokes are.', 1, 10, 4), R('levels', 'Detail', 'More keeps more of the picture; fewer looks more painted.', 4, 60, 20),
    PCT('shine', 'Brush shine', 'How much the paint looks raised and shiny.', 0, 100, 40)]),
  'filter.wind': FX('wind', [SEL('method', 'Kind', 'Light wind, a strong blast, or uneven gusts.', ['Wind', 'Blast', 'Gusts']), SEL('dir', 'From', 'Which side the wind blows from.', ['The right', 'The left']),
    PX('length', 'Streak length', 'How far the streaks blow.', 2, 200, 30), SEED]),
  'filter.diffuse': FX('diffuse', [PX('radius', 'Scatter distance', 'How far pixels jump.', 1, 20, 4),
    SEL('mode', 'Kind', 'Scatter every pixel, or only where it makes the picture darker or lighter.', ['Every pixel', 'Darker only', 'Lighter only']), SEED]),
  'filter.tiles': FX('tiles', [R('count', 'Tiles across', 'How many tiles fit across.', 1, 99, 8), PCT('offset', 'Gap', 'How far each tile can slide out of place.', 1, 99, 10),
    SEL('fill', 'Gaps show', 'What shows between the tiles.', ['Second colour', 'Negative', 'Original picture', 'See-through']), SEED], { colors: true }),
  'filter.extrude': FX('extrude', [SEL('type', 'Kind', 'Square blocks or pyramids.', ['Blocks', 'Pyramids']), PX('size', 'Block size', 'How big each block is.', 2, 255, 16),
    R('depth', 'Depth', 'How far the blocks stick out.', 1, 255, 30), CHK('solid', 'Plain fronts', 'Fill each block front with one colour.', 0)]),
  'filter.trace-contour': FX('trace-contour', [R('level', 'Brightness level', 'Lines are drawn where the colours cross this level.', 0, 255, 128),
    SEL('edge', 'Line side', 'Draw on the darker or the brighter side of the level.', ['Darker side', 'Brighter side'], 1)]),
  'filter.glowing-edges': FX('glowing-edges', [PX('width', 'Line width', 'How thick the glowing lines are.', 1, 14, 2), R('bright', 'Glow', 'How bright the lines glow.', 0, 20, 8),
    R('smooth', 'Smoothness', 'Higher ignores small details.', 1, 15, 5)]),
  'filter.halftone': FX('halftone', [PX('radius', 'Dot size', 'The size of the biggest printing dots.', 4, 127, 8)]),
  'filter.crystallize': FX('crystallize', [PX('size', 'Crystal size', 'How big each crystal is.', 3, 300, 16), SEED]),
  'filter.facet': FX('facet', [PX('radius', 'Patch size', 'How big the flat patches are.', 1, 10, 3)]),
  'filter.fragment': FX('fragment', [PX('distance', 'Shake', 'How far apart the four copies sit.', 1, 50, 4)]),
  'filter.mezzotint': FX('mezzotint', [SEL('type', 'Kind', 'The shape of the dots or lines.', ['Fine dots', 'Grainy dots', 'Short lines', 'Long lines']), SEED]),
  'filter.mosaic': FX('mosaic', [PX('size', 'Block size', 'How big each square block is.', 2, 200, 12)]),
  'filter.pointillize': FX('pointillize', [PX('size', 'Dot size', 'How big each painted dot is; the second colour shows between them.', 3, 300, 10), SEED], { colors: true }),
  'filter.clouds': FX('clouds', [...CLOUDS], { colors: true }),
  'filter.difference-clouds': FX('diff-clouds', [...CLOUDS], { colors: true }),
  'filter.fibers': FX('fibers', [R('variance', 'Fibre length', 'How long the fibres run.', 1, 64, 16), R('strength', 'Fibre density', 'How tightly the fibres pack.', 1, 64, 4), SEED], { colors: true }),
  'filter.high-pass': FX('high-pass', [PX('radius', 'Detail size', 'Bigger keeps bigger details; smaller keeps only fine edges.', 0.5, 100, 4, 0.5)]),
  'filter.maximum': FX('maximum', [PX('radius', 'Size', 'How far light areas spread.', 1, 100, 2)]),
  'filter.minimum': FX('minimum', [PX('radius', 'Size', 'How far dark areas spread.', 1, 100, 2)]),
  'filter.offset': FX('offset', [PCT('dx', 'Slide sideways', 'How far the picture slides right (left below 0).', -100, 100, 25), PCT('dy', 'Slide down', 'How far the picture slides down (up below 0).', -100, 100, 0),
    SEL('edge', 'Edges', 'What fills the space the picture leaves.', ['Wrap round', 'Repeat the edge', 'See-through'])]),
  'filter.custom': FX('custom', [SEL('preset', 'Start from', 'Fill the grid with a ready-made filter, then change any number.', ['Sharpen', 'Blur', 'Outline', 'Emboss'], 0, KERNELS),
    ...GRID, R('scale', 'Divide by', 'The total is divided by this; the sum of the numbers keeps the brightness.', 1, 100, 1),
    R('offset', 'Add', 'Added to every result; 128 gives a grey middle.', -255, 255, 0)]),
};

const always = (): boolean => true;
const hasDoc = (e: Editor): boolean => !!e.doc;
const hasSel = (e: Editor): boolean => !!e.doc?.selection;
const layers = (e: Editor): number => e.doc?.layers.length ?? 0;
const notTop = (e: Editor): boolean => !!e.doc && e.activeIndex() < layers(e) - 1;
const notBottom = (e: Editor): boolean => !!e.doc && e.activeIndex() > 0;
const H = (run: Handler['run'], enabled: Handler['enabled'] = hasDoc, checked?: Handler['checked']): Handler => ({ run, enabled, checked });

export const TOOLS: Record<string, ToolId> = {
  'tool.move': 'move', 'tool.select-rect': 'select', 'tool.crop': 'crop', 'tool.brush': 'brush', 'tool.pencil': 'pencil',
  'tool.eraser': 'eraser', 'tool.eyedropper': 'eyedropper', 'tool.hand': 'hand', 'tool.zoom': 'zoom',
};
export const DOCK_PANELS = ['layers', 'history', 'properties', 'adjustments', 'color', 'swatches', 'navigator', 'info'] as const;
export type PanelId = (typeof DOCK_PANELS)[number];

export const HANDLERS: Record<string, Handler> = {
  'file.new': H((e) => e.openModal('new'), always),
  'file.open': H((e) => e.pickFile(false), always),
  'file.open-layer': H((e) => e.pickFile(true)),
  'file.sample': H((e) => e.openSample(), always),
  'file.close': H((e) => e.closeDoc(false)),
  'file.close-all': H((e) => e.closeDoc(true)),
  'file.revert': H((e) => e.revert(), (e) => !!e.doc && e.history.canUndo),
  'file.save-psd': H((e) => e.openExport('psd')),
  'file.export': H((e) => e.openExport()),
  'file.quick-png': H((e) => e.quickPng()),
  'file.export-png': H((e) => e.openExport('png')),
  'file.export-jpeg': H((e) => e.openExport('jpeg')),
  'file.export-webp': H((e) => e.openExport('webp')),
  'file.export-psd': H((e) => e.openExport('psd')),
  'edit.undo': H((e) => e.undo(), (e) => !!e.doc && e.history.canUndo),
  'edit.redo': H((e) => e.redo(), (e) => !!e.doc && e.history.canRedo),
  'edit.history-back': H((e) => e.undo(), (e) => !!e.doc && e.history.canUndo),
  'edit.history-forward': H((e) => e.redo(), (e) => !!e.doc && e.history.canRedo),
  'edit.cut': H((e) => e.copy(false, true)),
  'edit.copy': H((e) => e.copy(false, false)),
  'edit.copy-merged': H((e) => e.copy(true, false)),
  'edit.paste': H((e) => e.paste(false), (e) => !!e.doc && !!e.clip),
  'edit.paste-in-place': H((e) => e.paste(true), (e) => !!e.doc && !!e.clip),
  'edit.clear': H((e) => e.deleteArea(), hasSel),
  'edit.fill': H((e) => e.fillArea(false)),
  'edit.fill-bg': H((e) => e.fillArea(true)),
  'edit.flip-layer-h': H((e) => e.turnLayerAction('flip-h')),
  'edit.flip-layer-v': H((e) => e.turnLayerAction('flip-v')),
  'edit.rotate-layer-cw': H((e) => e.turnLayerAction('cw')),
  'edit.rotate-layer-ccw': H((e) => e.turnLayerAction('ccw')),
  'edit.rotate-layer-180': H((e) => e.turnLayerAction('180')),
  'edit.pref-pro-names': H((e) => e.setNames(!e.proNames, true), always, (e) => e.proNames),
  'edit.pref-hints': H((e) => e.setHints(!e.hints, true), always, (e) => e.hints),
  'edit.pref-theme': H((e) => e.toggleTheme(), always, (e) => e.root.dataset.theme === 'light'),
  'image.size': H((e) => e.openModal('size')),
  'image.canvas-size': H((e) => e.openModal('canvas')),
  'image.rotate-cw': H((e) => e.turnCanvas('cw')),
  'image.rotate-ccw': H((e) => e.turnCanvas('ccw')),
  'image.rotate-180': H((e) => e.turnCanvas('180')),
  'image.flip-h': H((e) => e.turnCanvas('flip-h')),
  'image.flip-v': H((e) => e.turnCanvas('flip-v')),
  'image.crop': H((e) => e.cropToSelection(), hasSel),
  'image.trim': H((e) => e.trim()),
  'image.reveal-all': H((e) => e.revealAllAction()),
  'image.duplicate': H((e) => e.duplicateDoc()),
  'layer.new': H((e) => e.addLayerAction()),
  'layer.new-copy': H((e) => e.layerVia(false)),
  'layer.new-cut': H((e) => e.layerVia(true), hasSel),
  'layer.duplicate': H((e) => e.duplicateLayerAction()),
  'layer.delete': H((e) => e.deleteLayerAction(), (e) => layers(e) > 1),
  'layer.rename': H((e) => e.openModal('rename')),
  'layer.front': H((e) => e.arrange('front'), notTop),
  'layer.forward': H((e) => e.arrange('forward'), notTop),
  'layer.backward': H((e) => e.arrange('backward'), notBottom),
  'layer.back': H((e) => e.arrange('back'), notBottom),
  'layer.lock': H((e) => e.toggleLock(), hasDoc, (e) => !!e.active()?.locked),
  'layer.hide': H((e) => e.toggleHidden(), hasDoc, (e) => e.active()?.visible === false),
  'layer.merge-down': H((e) => e.mergeDownAction(), notBottom),
  'layer.merge-visible': H((e) => e.mergeVisibleAction(), (e) => (e.doc?.layers.filter((l) => l.visible).length ?? 0) > 1),
  'layer.flatten': H((e) => e.flattenAction(), (e) => layers(e) > 1),
  'select.all': H((e) => e.selectAll()),
  'select.none': H((e) => e.deselect(), hasSel),
  'select.reselect': H((e) => e.reselect(), (e) => !!e.doc && !!e.lastSel),
  'select.inverse': H((e) => e.inverseSelect(), hasSel),
  'filter.last': H((e) => e.runLastFilter(), (e) => !!e.doc && !!e.lastFilter),
  'view.zoom-in': H((e) => e.zoomBy(1.25)),
  'view.zoom-out': H((e) => e.zoomBy(0.8)),
  'view.fit': H((e) => e.fit()),
  'view.actual': H((e) => e.zoomTo(1)),
  'view.zoom-200': H((e) => e.zoomTo(2)),
  'view.screen-standard': H((e) => e.setScreen('standard'), always, (e) => e.screen === 'standard'),
  'view.screen-focus': H((e) => e.setScreen('focus'), always, (e) => e.screen === 'focus'),
  'view.screen-cycle': H((e) => e.setScreen(e.screen === 'focus' ? 'standard' : 'focus'), always),
  'view.rulers': H((e) => e.toggleFlag('rulers'), always, (e) => e.flags.rulers),
  'view.grid': H((e) => e.toggleFlag('grid'), always, (e) => e.flags.grid),
  'view.extras': H((e) => e.toggleFlag('extras'), always, (e) => e.flags.extras),
  'window.reset': H((e) => e.resetWorkspace(), always),
  'window.collapse': H((e) => e.collapseAll(), always),
  'help.start': H((e) => e.showStart(), always),
  'help.search': H((e) => e.openSearch(), always),
  'help.shortcuts': H((e) => e.openModal('keys'), always),
  'help.about': H((e) => e.openModal('about'), always),
  'help.source': H((e) => e.openLink(SOURCE_URL), always),
  'help.report': H((e) => e.openLink(SOURCE_URL + '/issues'), always),
  'tool.swap-colors': H((e) => e.swapColors(), always),
  'tool.default-colors': H((e) => e.defaultColors(), always),
};
for (const [id, t] of Object.entries(TOOLS)) HANDLERS[id] = H((e) => e.setTool(t), always, (e) => e.tool === t);
for (const id of Object.keys(ADJ)) HANDLERS[id] = H((e) => e.openAdjust(id));
for (const p of DOCK_PANELS) HANDLERS['panel.' + p] = H((e) => e.togglePanelShown(p), always, (e) => e.panelShown(p));

/** The "What do you want to do?" jobs. Each opens the real command; `ratio` starts the crop tool with that shape. */
export interface Job { title: string; cmd: string; icon: string; ratio?: number; help?: string; }
export const JOBS: Job[] = [
  { title: 'Make it brighter or darker', cmd: 'image.adj-brightness', icon: 'sun' },
  { title: 'Fix the light in one click', cmd: 'image.auto-tone', icon: 'sparkles' },
  { title: 'Make the colours pop', cmd: 'image.adj-vibrance', icon: 'palette' },
  { title: 'Crop the picture', cmd: 'tool.crop', icon: 'crop' },
  { title: 'Square crop for Instagram', cmd: 'tool.crop', icon: 'square', ratio: 1, help: 'Opens the crop tool with a centred square, ready to apply.' },
  { title: 'Make it smaller for the web', cmd: 'image.size', icon: 'image-down' },
  { title: 'Black and white', cmd: 'image.adj-bw', icon: 'contrast' },
  { title: 'Soften or blur', cmd: 'filter.blur-gaussian', icon: 'droplet' },
  { title: 'Draw or paint', cmd: 'tool.brush', icon: 'brush' },
  { title: 'Combine two photos', cmd: 'file.open-layer', icon: 'image-plus' },
  { title: 'Remove the background', cmd: 'select.remove-bg', icon: 'scissors' },
  { title: 'Remove a spot', cmd: 'tool.spot-heal', icon: 'bandage' },
  { title: 'Add text', cmd: 'tool.type', icon: 'type' },
  { title: 'Blur the background', cmd: 'filter.blur-iris', icon: 'focus' },
];
