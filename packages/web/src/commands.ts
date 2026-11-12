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
  type?: 'range' | 'select' | 'check'; options?: readonly string[]; group?: string;
}
export interface AdjDef { op: JobOp; kind?: string; controls: Ctl[]; instant?: boolean; }

const R = (key: string, label: string, help: string, min: number, max: number, value: number, step = 1, unit = '', group?: string): Ctl =>
  ({ key, label, help, min, max, value, step, unit, group });
const SEL = (key: string, label: string, help: string, options: readonly string[], value = 0): Ctl => ({ key, label, help, value, type: 'select', options });
const CHK = (key: string, label: string, help: string, value = 1): Ctl => ({ key, label, help, value, type: 'check' });
const tones = (prefix: string, group: string): Ctl[] => [
  R(prefix + 'r', 'Cyan ↔ Red', 'Left adds cyan, right adds red.', -100, 100, 0, 1, '', group),
  R(prefix + 'g', 'Magenta ↔ Green', 'Left adds magenta, right adds green.', -100, 100, 0, 1, '', group),
  R(prefix + 'b', 'Yellow ↔ Blue', 'Left adds yellow, right adds blue.', -100, 100, 0, 1, '', group)];
const mix = (out: string, name: string, own: string): Ctl[] => ['r', 'g', 'b'].map((c, i) => R(out + c, 'From ' + ['red', 'green', 'blue'][i],
  `How much of the original ${['red', 'green', 'blue'][i]} goes into the ${name.toLowerCase()}.`, -200, 200, c === own ? 100 : 0, 1, '%', name));

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
