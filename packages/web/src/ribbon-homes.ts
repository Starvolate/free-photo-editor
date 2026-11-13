// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Where every function lives on the Task ribbon: twelve task tabs, four sheets in the app bar, the items that never
 * leave the screen, and the contextual tabs. Every function of the map (registry.ts) and of the new Planned rows
 * (registry-union.ts) has exactly one home here; registry.test.ts checks it and writes the reach count into
 * docs/function-map.md. Pure data: no DOM, and nothing on today's screen imports it (the ribbon will).
 *
 * Each group lists its ids in design order: big buttons, then the ones shown on the tab (small buttons or a live-preview
 * gallery), then its More list. A "family" group is a button that opens a family sheet holding its ids; a "button" group
 * is shrunk to one button that opens its list. A group's `again` names the ids it shows again though they live elsewhere
 * (Select the main subject lives in Select & cut out and is shown again on AI tools).
 *
 * On screen a group rests as `restOf` says: only Ready commands in its rows, and every Planned one in its More list under
 * a quiet "Coming" heading (his 18:54 verdict, 13 Nov 2026: a Planned item never sits in a resting row). `spots()`,
 * `homes()` and `clicks()` follow that, so what the map promises is what the screen shows.
 */
import { BY_ID } from './registry';
import { NEW_ROWS } from './registry-union';

/** How a group shows its commands on the tab. */
export type Show = 'small' | 'gallery' | 'button' | 'family' | 'none';
/** Where a command sits within its home. */
export type Place = 'big' | 'small' | 'gallery' | 'more' | 'family' | 'sheet' | 'always';
export interface Group { plain: string; pro: string; show: Show; big: string[]; shown: string[]; more: string[]; again: string[]; }
export interface Tab { plain: string; pro: string; groups: Group[]; }
export interface Sheet { plain: string; pro: string; ids: string[]; }
export interface Contextual { plain: string; pro: string; when: string; ids: string[]; }
export interface Home { tab: string; group: string; place: Place; }
export interface Spot extends Home { id: string; again: boolean; }

const words = (s: string): string[] => s.split(' ').filter(Boolean);
const g = (plain: string, pro: string, show: Show, big: string, shown: string, more: string, again = ''): Group =>
  ({ plain, pro, show, big: words(big), shown: words(shown), more: words(more), again: words(again) });

/** The twelve task tabs, deep work first; the first one is open by default. */
export const TABS: Tab[] = [
  { plain: 'Effects & masks', pro: 'Layer styles, adjustment layers and masks', groups: [
    g('New', 'New layer, folder and fill', 'none', 'layer.new', '', 'layer.new-copy layer.duplicate layer.new-group layer.clip layer.fill-color layer.new-cut layer.fill-gradient layer.fill-pattern layer.3d-paint'),
    g('Editable light and colour', 'Adjustment layers', 'gallery', '', 'layer.adj-levels layer.adj-curves layer.adj-hue layer.adj-brightness layer.adj-exposure layer.adj-vibrance', 'layer.adj-color-balance layer.adj-bw layer.adj-gradient-map layer.adj-selective-color layer.adj-photo-filter layer.adj-channel-mixer layer.adj-color-lookup layer.adj-invert layer.adj-posterize layer.adj-threshold'),
    g('Shadows and glows', 'Layer styles', 'gallery', '', 'layer.fx-shadow layer.fx-stroke layer.fx-outer-glow layer.fx-bevel layer.fx-color', 'layer.fx-inner-shadow panel.styles layer.adj-presets layer.fx-inner-glow layer.fx-satin layer.fx-gradient layer.fx-pattern layer.fx-3d layer.fx-blur'),
    g('Live effects', 'Smart filters and smart layers', 'none', 'layer.smart-filters', '', 'layer.smart-convert layer.smart-edit layer.smart-replace layer.smart-linked layer.clone layer.smart-rasterize layer.linked-resources layer.clones-array'),
    g('Hide parts', 'Masks', 'none', 'layer.mask-add', '', 'layer.mask-from-sel layer.mask-hide-all layer.vector-mask layer.mask-toggle layer.mask-edge layer.transform-mask layer.live-masks layer.mask-apply layer.mask-delete layer.mask-hide-sel layer.mask-link layer.split-alpha layer.mask-shared'),
    g('Blending', 'Blend If and fill opacity', 'button', '', '', 'layer.blend-if layer.fill-opacity layer.blend-special layer.blend-space'),
  ] },
  { plain: 'Select & cut out', pro: 'Selection', groups: [
    g('Select with AI', 'Subject, object and sky', 'small', 'select.subject', 'tool.object-select image.remove-bg select.sky', 'select.people select.focus select.depth'),
    g('Draw or paint', 'Marquee, lasso, quick selection', 'small', 'tool.select-rect', 'tool.lasso tool.quick-select tool.magic-wand', 'tool.lasso-poly tool.select-ellipse tool.lasso-magnetic select.foreground tool.select-row tool.select-column'),
    g('By colour or light', 'Colour range', 'small', '', 'select.color-range select.luminance', 'select.similar'),
    g('Change it', 'All, inverse and modify', 'small', '', 'select.all', 'select.inverse select.none select.feather select.expand select.contract select.reselect select.smooth select.border select.grow select.transform select.remove-holes select.distort select.round-corners'),
    g('Perfect and keep', 'Select and mask, save, convert', 'small', 'select.refine', 'select.quick-mask', 'select.save select.load select.to-path layer.defringe select.from-alpha select.from-path select.float select.from-channel select.editor'),
    g('Copy and paste', 'Clipboard', 'small', '', 'edit.copy', 'edit.paste edit.cut edit.copy-merged edit.paste-in-place edit.clear'),
  ] },
  { plain: 'Retouch & remove', pro: 'Retouch', groups: [
    g('Remove', 'Remove and content-aware', 'small', 'tool.remove', 'edit.smart-fill tool.smart-move', 'retouch.distractions retouch.fill-from-photo'),
    g('Repair', 'Heal and clone', 'small', '', 'tool.spot-heal tool.heal tool.patch', 'tool.clone tool.red-eye filter.perspective-plane'),
    g('Touch up by painting', 'Dodge, burn, blur and sharpen', 'small', '', 'tool.dodge tool.burn tool.sponge', 'tool.blur tool.sharpen tool.smudge retouch.median-brush'),
    g('Faces and skin', 'Portrait and frequency separation', 'small', '', 'retouch.smooth-skin retouch.frequency-separation filter.liquify', 'ai.portrait', 'filter.liquify ai.portrait'),
    g('Rescue a photo', 'Restore', 'small', '', 'retouch.restore-photo retouch.deblur filter.dust', 'ai.colorize', 'filter.dust ai.colorize'),
  ] },
  { plain: 'Develop RAW', pro: 'RAW develop', groups: [
    g('Develop', 'Camera RAW and white balance', 'small', 'filter.raw raw.white-balance', 'raw.camera-profile raw.negative raw.black-white-points', ''),
    g('Light and tone', 'Tone', 'small', '', 'image.adj-exposure raw.filmic raw.tone-equalizer', 'raw.highlights raw.dehaze raw.base-curve raw.colour-rescue', 'image.adj-exposure'),
    g('Colour and looks', 'Colour grading and presets', 'button', '', '', 'raw.colour-grading raw.colour-mixer image.adj-vibrance raw.presets image.adj-color-lookup raw.colour-checker raw.colour-match raw.colour-appearance raw.gamut-compress raw.community-looks', 'image.adj-vibrance image.adj-color-lookup'),
    g('Detail and lens', 'Detail, optics and geometry', 'button', '', '', 'raw.ai-denoise raw.clarity filter.lens raw.upright raw.capture-sharpen raw.vignette raw.contrast-levels raw.wide-angle raw.denoise-profiled raw.defish raw.hot-pixels'),
    g('Edit one area', 'Masking', 'none', 'raw.local-edits', '', ''),
    g('Check', 'Histogram, clipping and snapshots', 'small', '', 'panel.histogram', 'raw.clipping raw.snapshots raw.scopes'),
  ] },
  { plain: 'AI tools', pro: 'AI', groups: [
    g('Make with words', 'Generative', 'small', 'ai.generative-fill', 'ai.expand ai.generate ai.recompose', 'ai.image-to-image ai.new-angle ai.to-video'),
    g('Select and remove', 'AI selection and removal', 'small', '', 'select.subject tool.object-select image.remove-bg', 'tool.remove retouch.distractions', 'select.subject tool.object-select image.remove-bg tool.remove retouch.distractions'),
    g('Change with AI', 'AI edits', 'small', '', 'ai.assistant ai.background-swap ai.sky-swap', 'ai.relight ai.harmonize ai.split-layers ai.colorize ai.style-transfer ai.sticker ai.landscape-mix'),
    g('Better quality', 'Enhance and models', 'small', '', 'image.upscale-2x', 'image.upscale-4x raw.ai-denoise retouch.deblur retouch.restore-photo ai.model-choice edit.pref-gpu', 'image.upscale-2x image.upscale-4x raw.ai-denoise retouch.deblur retouch.restore-photo edit.pref-gpu'),
    g('Faces and words', 'Portrait and text AI', 'small', '', 'ai.portrait', 'ai.grab-text retouch.smooth-skin ai.translate type.match-font ai.face-swap ai.headshot', 'retouch.smooth-skin type.match-font'),
  ] },
  { plain: 'Paint & draw', pro: 'Painting', groups: [
    g('Paint and erase', 'Brush and eraser', 'small', 'tool.brush', 'tool.pencil tool.mixer tool.eraser', 'tool.color-replace tool.bg-eraser tool.magic-eraser'),
    g('Brush kinds', 'Brush engines', 'gallery', '', 'paint.mypaint paint.bristle paint.filter-brush paint.calligraphy paint.chalk-spray paint.sketch-brush', 'paint.shape-brush paint.dynamic-brush paint.normal-brush'),
    g('Brush settings', 'Settings, symmetry and assistants', 'small', '', 'panel.brushes', 'paint.dynamics paint.stabilizer paint.symmetry paint.assistants paint.perspective-guides edit.define-brush panel.tool-presets paint.libraries paint.wrap-around paint.lock-settings'),
    g('Fill', 'Fill, gradient and line art', 'small', '', 'tool.gradient tool.bucket', 'edit.fill paint.colorize-mask edit.fill-bg edit.stroke tool.pattern-stamp edit.define-pattern paint.mesh-gradient paint.enclose-fill'),
    g('Colour', 'Colour', 'small', '', 'tool.eyedropper panel.color panel.swatches', 'tool.swap-colors tool.default-colors tool.color-sampler paint.colour-tools'),
    g('Paint back', 'History brush', 'small', '', 'tool.history-brush edit.history-brush-step tool.art-history', ''),
  ] },
  { plain: 'Shapes & text', pro: 'Vectors and type', groups: [
    g('Draw outlines', 'Pen and path editing', 'small', 'tool.pen', 'tool.pen-free tool.direct-select tool.path-select', 'panel.paths tool.anchor-add tool.anchor-delete tool.anchor-convert panel.vector-info path.tweak'),
    g('Shapes', 'Shape tools and trace', 'small', '', 'tool.rect tool.ellipse tool.rounded-rect', 'tool.polygon tool.line tool.custom-shape shape.live image.vectorize shape.vector-layer shape.spiral-star shape.qr shape.generate shape.comic-panels'),
    g('Combine and style', 'Path operations and strokes', 'small', '', 'path.boolean path.combine path.stroke-style', 'path.divide'),
    g('Live shape effects', 'Live path effects', 'small', '', 'path.effects path.bend path.hatches', 'path.interpolate path.knot path.mirror path.envelope path.stitch path.pattern-along path.offset path.power-stroke path.rotate-copies path.roughen path.sketch path.tiling'),
    g('Text', 'Type', 'none', 'tool.type', '', 'type.fonts type.path type.warp tool.type-vertical type.to-shape type.add type.add-vertical type.rasterize type.smooth type.spell type.find tool.type-mask type.match-font type.unrasterize type.in-shape type.make-font'),
    g('Text style', 'Character and paragraph', 'button', '', '', 'panel.character panel.paragraph type.styles type.opentype type.scripts panel.glyphs'),
  ] },
  { plain: 'Automate & batch', pro: 'Actions and batch', groups: [
    g('Record steps', 'Actions', 'small', 'panel.actions', 'auto.record-painting', ''),
    g('Do many at once', 'Batch', 'small', 'file.batch', 'file.resize-many auto.copy-edits auto.watermark', 'auto.droplets file.crop-scans'),
    g('Merge photos', 'Photo merge', 'small', '', 'auto.panorama auto.hdr-merge edit.auto-blend', 'edit.auto-align auto.stacks auto.astro-stack auto.pixel-shift'),
    g('Scripts and data', 'Scripting and data sets', 'small', '', 'file.scripts auto.plugins image.variables', 'auto.script-events auto.filter-graph'),
    g('Sheets and layouts', 'Contact sheet', 'small', '', 'file.contact-sheet', 'auto.collage auto.passport tool.slice'),
  ] },
  { plain: 'Arrange layers', pro: 'Layer arrangement', groups: [
    g('This layer', 'Layer', 'small', '', 'layer.rename layer.hide layer.lock', 'layer.delete layer.rasterize panel.layers layer.convert layer.crop-to-content layer.split-by-colour layer.remove-alpha layer.invert-alpha layer.colour-space'),
    g('Order', 'Arrange', 'small', '', 'layer.front layer.forward layer.backward', 'layer.back layer.reverse'),
    g('Folders', 'Group layers', 'small', '', 'layer.group layer.ungroup', ''),
    g('Line up', 'Align and distribute', 'small', '', 'layer.align-left layer.align-hcenter layer.align-right', 'layer.align-top layer.align-vcenter layer.align-bottom layer.distribute-h layer.distribute-v'),
    g('Combine', 'Merge', 'small', '', 'layer.merge-down layer.merge-visible layer.flatten', ''),
    g('Find and versions', 'Layer filter and comps', 'small', '', 'layer.filter layer.colour-label panel.layer-comps', 'layer.select-by-state layer.metadata'),
    g('Animate', 'Timeline', 'small', '', 'panel.timeline layer.frames', 'layer.keyframes layer.onion-skin layer.video layer.storyboard layer.import-frames'),
  ] },
  { plain: 'Crop & resize', pro: 'Crop and transform', groups: [
    g('Crop', 'Crop', 'small', 'tool.crop', 'image.crop image.trim tool.crop-perspective', 'image.reveal-all'),
    g('Size', 'Image and canvas size', 'small', '', 'image.size image.canvas-size image.upscale-2x', 'image.resolution image.upscale-4x image.fit-canvas tool.artboard'),
    g('Turn the picture', 'Rotate canvas', 'small', '', 'image.rotate-cw image.rotate-ccw image.rotate-any', 'image.rotate-180 image.flip-h image.flip-v'),
    g('Move and reshape a layer', 'Free transform', 'small', 'tool.move', 'edit.free-transform edit.scale edit.rotate', 'edit.skew edit.distort edit.perspective edit.transform-again'),
    g('Turn a layer', 'Rotate layer', 'small', '', 'edit.flip-layer-h edit.flip-layer-v edit.rotate-layer-cw', 'edit.rotate-layer-ccw edit.rotate-layer-180'),
    g('Bend and push', 'Warp and liquify', 'small', '', 'filter.liquify edit.warp edit.pin-warp', 'edit.perspective-warp edit.smart-scale edit.cage edit.transform-3d'),
  ] },
  { plain: 'Light & colour', pro: 'Adjustments', groups: [
    g('Fix in one click', 'Auto', 'small', '', 'image.auto-tone image.auto-contrast image.auto-color', ''),
    g('Light and colour', 'Adjustments', 'gallery', '', 'image.adj-brightness image.adj-levels image.adj-curves image.adj-exposure image.adj-shadows', 'image.adj-vibrance image.adj-hue image.adj-color-balance image.adj-bw raw.white-balance raw.dehaze raw.clarity image.adj-photo-filter image.adj-selective-color image.adj-channel-mixer image.adj-gradient-map image.adj-color-lookup image.adj-invert image.adj-posterize image.adj-threshold image.adj-desaturate image.adj-equalize image.adj-match image.adj-replace image.local-threshold panel.adjustments', 'raw.white-balance raw.dehaze raw.clarity'),
    g('More colour tools', 'HDR toning and colour tools', 'small', '', 'image.tone-mapping image.apply image.hue-chroma', 'image.retinex image.sample-colorize image.rotate-colours image.harmonize image.colour-contrast image.export-lut'),
    g('Colour type', 'Mode', 'small', '', 'image.mode-gray image.mode-cmyk image.mode-16', 'image.mode-lab image.mode-indexed image.reduce-colors image.mode-32 image.spot-channels image.palette-edit image.decompose'),
    g('Colour accuracy', 'Colour management', 'small', '', 'image.profiles image.soft-proof', 'image.gamut-warning'),
  ] },
  { plain: 'Filters & blur', pro: 'Filters', groups: [
    g('Again', 'Last effect', 'small', 'filter.last', 'edit.fade', ''),
    g('Popular effects', 'Live previews', 'gallery', '', 'filter.blur-gaussian filter.blur-iris filter.blur-tilt filter.blur-motion filter.unsharp raw.vignette filter.add-noise', 'filter.reduce-noise filter.bloom filter.oil-paint filter.find-edges filter.twirl filter.wave filter.mosaic', 'filter.blur-gaussian filter.blur-iris filter.blur-tilt filter.blur-motion filter.unsharp raw.vignette filter.add-noise filter.reduce-noise filter.bloom filter.oil-paint filter.find-edges filter.twirl filter.wave filter.mosaic'),
    g('Blur', 'Blur', 'family', '', '', 'filter.blur-gaussian filter.blur-box filter.blur-motion filter.blur-radial filter.blur-surface filter.blur-lens filter.blur-average filter.blur-smart filter.blur-variable filter.blur-edge-keep filter.blur-sketch filter.blur-tileable'),
    g('Camera blurs', 'Blur gallery', 'family', '', '', 'filter.blur-field filter.blur-iris filter.blur-tilt filter.blur-path filter.blur-spin filter.depth-blur'),
    g('Sharpen', 'Sharpen', 'family', '', '', 'filter.sharpen filter.sharpen-more filter.unsharp filter.sharpen-edges filter.smart-sharpen filter.diffuse-sharpen'),
    g('Grain and specks', 'Noise', 'family', '', '', 'filter.add-noise filter.despeckle filter.dust filter.median filter.reduce-noise filter.destripe filter.deinterlace'),
    g('Bend and twist', 'Distort', 'family', '', '', 'filter.displace filter.pinch filter.polar filter.ripple filter.shear filter.spherize filter.twirl filter.wave filter.zigzag filter.glass filter.ocean-ripple filter.kaleidoscope filter.panorama-projection filter.page-curl filter.illusion filter.fractal-trace filter.dents'),
    g('Blocks and dots', 'Pixelate', 'family', '', '', 'filter.halftone filter.crystallize filter.facet filter.fragment filter.mezzotint filter.mosaic filter.pointillize filter.newsprint filter.video-degrade filter.superpixels'),
    g('Patterns and light', 'Render', 'family', '', '', 'filter.clouds filter.difference-clouds filter.fibers filter.lens-flare filter.lighting filter.star-burst filter.bump-map filter.noise-patterns filter.fractals filter.patterns'),
    g('Graphic looks', 'Stylize', 'family', '', '', 'filter.diffuse filter.emboss filter.extrude filter.find-edges filter.oil-paint filter.solarize filter.tiles filter.trace-contour filter.wind filter.glowing-edges filter.bloom filter.long-shadow filter.tile-seamless filter.edge-detect filter.outline-relief filter.alien-map filter.lowlight'),
    g('Artistic', 'Artistic and filter gallery', 'family', '', '', 'filter.gallery filter.cartoon filter.ink-sketch filter.linocut filter.frames-overlays'),
    g('More effects', 'Other', 'family', '', '', 'filter.high-pass filter.maximum filter.minimum filter.offset filter.custom filter.color-to-alpha filter.dither filter.antialias'),
  ] },
];

/** The four sheets in the app bar: one scrollable page each, so every item is two clicks away. */
export const SHEETS: Sheet[] = [
  { plain: 'File', pro: 'File (backstage)', ids: words('file.new file.open file.open-layer file.sample file.open-url file.camera file.recent file.restore file.autosave file.install file.close file.close-all file.revert file.export file.print file.info image.duplicate file.libraries file.cloud file.share-review file.phone-handoff file.library file.ratings file.cull file.sidecar file.map file.tether file.templates file.assets') },
  { plain: 'Export', pro: 'Export as', ids: words('file.save-psd file.quick-png file.export-png file.export-jpeg file.export-webp file.export-psd file.export-avif file.export-gif file.export-tiff file.export-pdf file.export-svg file.export-ico file.export-jxl file.export-tga file.export-bmp file.export-ora file.export-animation file.export-print file.export-best file.export-layers file.export-sizes file.credentials file.image-map file.more-formats file.export-gcode file.export-slides') },
  { plain: 'View', pro: 'View, panels and workspace', ids: words('view.zoom-in view.zoom-out view.fit view.actual view.zoom-200 view.print-size view.screen-standard view.screen-focus view.screen-cycle view.rulers view.grid view.extras view.pixel-grid view.guide-new view.guide-clear view.guide-lock view.snap view.slices-clear window.reset window.collapse panel.navigator panel.info panel.channels panel.notes tool.ruler tool.note tool.hand tool.rotate-view tool.zoom view.task-bar view.quick-compare view.colour-blind view.smart-guides view.isometric-grid view.reference view.task-sets view.slideshow view.focus-peaking view.composition-guides view.colour-check') },
  { plain: 'Help', pro: 'Help, learn and settings', ids: words('edit.pref-pro-names edit.pref-hints edit.pref-theme edit.pref-language edit.pref-gpu help.start help.search help.shortcuts help.guided help.about help.source help.report') },
];

/** What never leaves the screen (one click): the app bar, the picture tabs, your tools, the Layers card, History, Properties and zoom. */
export const ALWAYS: { group: string; ids: string[] }[] = [
  { group: 'App bar', ids: words('help.search edit.undo edit.redo file.export') },
  { group: 'Picture tabs', ids: words('file.new file.close') },
  { group: 'Your tools', ids: words('tool.move tool.select-rect tool.brush tool.eraser tool.crop tool.type') },
  // The Layers card (W6 S2 part 6, as in the approved layout) shows New, Mask, Copy and Delete with words; Lock sits behind
  // its More button (2 clicks), so Lock is promised at its tab home, Arrange layers › This layer, not here.
  { group: 'Layers card', ids: words('panel.layers layer.new layer.mask-add layer.duplicate layer.delete layer.hide') },
  { group: 'History', ids: words('panel.history edit.history-back edit.history-forward') },
  { group: 'Properties', ids: words('panel.properties') },
  { group: 'Zoom', ids: words('view.zoom-out view.zoom-in view.fit') },
];

/** Tabs that show only in context, as a filled chip in the app bar. Everything on them also has a home above. */
export const CONTEXTUAL: Contextual[] = [
  { plain: 'Brush options', pro: 'Brush', when: 'tool.brush', ids: words('paint.mypaint paint.bristle paint.filter-brush paint.sketch-brush paint.chalk-spray paint.shape-brush paint.dynamic-brush paint.normal-brush paint.calligraphy paint.dynamics paint.stabilizer paint.symmetry paint.wrap-around panel.tool-presets') },
  { plain: 'Pen options', pro: 'Pen', when: 'tool.pen', ids: words('path.boolean path.combine path.divide select.from-path path.stroke-style path.effects') },
  { plain: 'Crop options', pro: 'Crop', when: 'tool.crop', ids: words('image.rotate-any view.composition-guides tool.crop-perspective') },
  { plain: 'Remove and heal options', pro: 'Remove and heal', when: 'tool.remove tool.spot-heal tool.heal', ids: words('') },
  { plain: 'Colour fade options', pro: 'Gradient', when: 'tool.gradient', ids: words('') },
  { plain: 'Transform options', pro: 'Transform', when: 'edit.free-transform', ids: words('edit.warp edit.cage edit.transform-3d edit.transform-again') },
  { plain: 'Selection', pro: 'Select', when: 'an active selection', ids: words('select.refine select.feather select.inverse layer.mask-from-sel edit.smart-fill ai.generative-fill layer.new-copy image.crop select.save select.to-path view.task-bar') },
  { plain: 'Text', pro: 'Type', when: 'tool.type', ids: words('type.opentype type.styles type.scripts type.warp type.path type.to-shape type.match-font') },
  { plain: 'Mask', pro: 'Layer mask', when: 'a mask being edited', ids: words('layer.mask-edge select.refine select.color-range select.luminance layer.live-masks layer.mask-toggle layer.mask-link layer.mask-apply') },
  { plain: 'Adjustment layer', pro: 'Adjustment or fill layer', when: 'an adjustment or fill layer', ids: words('layer.adj-presets') },
  { plain: 'Smart layer', pro: 'Smart object', when: 'a smart layer', ids: words('layer.smart-filters layer.smart-edit layer.smart-replace') },
];

const UNION = new Map(NEW_ROWS.map((r) => [r.id, r]));
/** Ready in the map (registry.ts) or among the new rows (registry-union.ts), wherever the row is. */
export const isReady = (id: string): boolean => (BY_ID.get(id) ?? UNION.get(id))?.status === 'ready';
/** A group as it rests on screen. */
export interface Rest { big: string[]; shown: string[]; more: string[]; coming: string[]; }
/**
 * Only Ready commands sit in a group's rows. The places its Planned ones leave are filled, in order, with Ready ones from
 * its More list (as big buttons in a group of big buttons only, else as small buttons or tiles), so a row never grows.
 * Every Planned command goes to the end of the More list, under the "Coming" heading. A group with nothing Ready at all
 * shows one small "Coming soon" tile that opens that list (ribbon.ts).
 */
export function restOf(gr: Group, ready: (id: string) => boolean = isReady): Rest {
  const big = gr.big.filter(ready), shown = gr.shown.filter(ready), more = gr.more.filter(ready);
  const coming = [...gr.big, ...gr.shown, ...gr.more].filter((id) => !ready(id));
  const into = gr.show === 'none' ? big : shown;
  for (let free = gr.big.length + gr.shown.length - big.length - shown.length; free > 0 && more.length; free--) into.push(more.shift() as string);
  return { big, shown, more, coming };
}

/** Where a command lives "Always on screen" when it has no tab or sheet. */
export const ALWAYS_TAB = 'Always on screen';

/** Every place an id appears: its home, and each place it is shown again. Always-on spots come last. */
export function spots(): Spot[] {
  const out: Spot[] = [];
  for (const t of TABS) for (const gr of t.groups) {
    const shown: Place = gr.show === 'gallery' ? 'gallery' : 'small', rest: Place = gr.show === 'family' ? 'family' : 'more', r = restOf(gr);
    for (const [list, place] of [[r.big, 'big'], [r.shown, shown], [[...r.more, ...r.coming], rest]] as [string[], Place][]) {
      for (const id of list) out.push({ id, tab: t.plain, group: gr.plain, place, again: gr.again.includes(id) });
    }
  }
  for (const s of SHEETS) for (const id of s.ids) out.push({ id, tab: s.plain, group: '', place: 'sheet', again: false });
  for (const a of ALWAYS) for (const id of a.ids) out.push({ id, tab: ALWAYS_TAB, group: a.group, place: 'always', again: false });
  return out;
}

/** Each id's one home: the first spot not marked as shown again; an always-on item lives there only when it has no other. */
export function homes(): Map<string, Home> {
  const m = new Map<string, Home>();
  for (const s of spots()) if (!s.again && !m.has(s.id)) m.set(s.id, { tab: s.tab, group: s.group, place: s.place });
  return m;
}

/** The commands a tab is designed to show at rest (its big buttons, small buttons and gallery tiles) before `restOf` moves its Planned ones to More. */
export const restingIds = (t: Tab): string[] => t.groups.flatMap((gr) => [...gr.big, ...gr.shown]);

/**
 * The tab a first run opens: the first, in the deep-first order above, where at least half the commands shown at rest
 * are Ready, so the first screen shows working tools rather than a half-disabled ribbon. It moves to Effects & masks by
 * itself once that tab is mostly Ready. After the first run the ribbon opens the tab used last.
 */
export function firstTab(ready: (id: string) => boolean): string {
  for (const t of TABS) {
    const ids = restingIds(t);
    if (ids.length && ids.filter(ready).length * 2 >= ids.length) return t.plain;
  }
  return TABS[0].plain;
}

/** "Effects & masks › New", "File sheet", "Always on screen › History". */
export const homeText = (h: Home): string => h.place === 'sheet' ? `${h.tab} sheet` : `${h.tab} › ${h.group}`;

/**
 * Clicks from the resting screen (a photo open, nothing else opened), with the page's rule: what never leaves the screen
 * is 1; a tab and its command, or a sheet and its item, is 2; a More list, a family sheet or a group shrunk to its button
 * is 3. Scrolling is free, search and keys are not clicks, and contextual tabs are not counted. An id shown in several
 * places counts once, at its best. 0 means it is reachable only by search.
 */
export function clicks(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of spots()) {
    const c = s.place === 'always' ? 1 : s.place === 'more' || s.place === 'family' ? 3 : 2;
    m.set(s.id, Math.min(m.get(s.id) ?? 9, c));
  }
  return m;
}

/** How many of these ids are 1, 2 or 3 clicks away, and how many only search finds. */
export function reach(ids: string[]): { one: number; two: number; three: number; searchOnly: number } {
  const c = clicks(), n = (k: number): number => ids.filter((id) => (c.get(id) ?? 0) === k).length;
  return { one: n(1), two: n(2), three: n(3), searchOnly: n(0) };
}
