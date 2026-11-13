// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The function map: every menu item, tool and panel a professional editor offers, in one list. Menus, the tool
 * column, search, shortcuts, tooltips and docs/function-map.md all come from this list. Pure data: no DOM.
 *
 * Row format: id | plain name | pro name | one plain line of help | wish words (- for none) | R (Ready) or P (Planned) | phase | keys
 * "@Path = plain | pro | help" starts a menu, submenu or tool group; "--" puts a separator before the next entry.
 * Phases: 1 = v0.1 engine and editor; W1 = this workspace; W2 = every filter family; W3 = remaining tools;
 * W4 = learn while you edit; 2 = selections and masks; 3 = transform and layers; 4 = painting; 5 = more filters and
 * adjustments; 6 = text, shapes and paths; 7 = more file formats; 8 = offline and install; 11 = on-device AI;
 * 13 = actions, batch, scripts and languages.
 */
const SRC = String.raw`
@File = File | File | Open, save and export pictures.
file.new | New picture | New | Start an empty picture of any size. | blank, empty canvas, start fresh, new document | R | 1 | Ctrl+N
file.open | Open a photo | Open | Open a picture from this device in a new tab. | load, photo, import, upload, open file, heic, raw, dng, tiff, pdf | R | 1 | Ctrl+O
file.open-layer | Add a photo as a layer | Place | Put another picture on top of this one as its own layer. | combine photos, collage, overlay, add picture, place | R | 1 | Ctrl+Shift+O
file.sample | Try a sample photo | Open sample | Open a built-in practice photo to try things on. | example, demo, practice, test picture | R | W1
file.open-url | Open from a web link | Open from URL | Load a picture from an internet address. | link, url, web address | R | 7
file.camera | Take a photo | Capture | Use the camera to take a new picture. | camera, selfie, webcam | R | 8
file.recent | Recent pictures | Open recent | Open again a picture you opened before. The files are kept only in this browser on this device; nothing is uploaded. | last files, history, open again | R | 8
--
file.restore | Bring back last pictures | Recover | Open again the pictures that were still open when the editor last closed. | restore, recover, lost work, crashed, closed by mistake | R | 8
file.autosave | Keep safety copies | Autosave | Keep a copy of open pictures in this browser, so a closed tab or a crash loses nothing. Nothing is uploaded. | autosave, auto save, backup, never lose work | R | 8
file.install | Install as an app | Install app | Put the editor on your home screen or desktop. It opens in its own window and works offline. | install, app, home screen, desktop app, offline, add to dock, pwa | R | 8
--
file.close | Close picture | Close | Close this picture's tab. | close, done, finish | R | W1
file.close-all | Close all pictures | Close all | Close every open tab. | close everything | R | W1
file.revert | Go back to the opened version | Revert | Undo every change since the picture was opened. | reset, original, start over, undo everything | R | W1
--
file.save-psd | Save with layers | Save as PSD | Keep every layer in a file other editors can open. | psd, keep layers, project file, save project | R | 1
file.export | Export | Export as | Save a copy as PNG, JPEG, WebP, PSD, TIFF, GIF, AVIF, JPEG XL, PDF, SVG and more, with a note on what each type loses. | save, download, png, jpg, save as | R | 1 | Ctrl+S
file.quick-png | Quick export as PNG | Quick export | Save a PNG straight away, no questions asked. | quick save, png, download now | R | W1 | Ctrl+Shift+Alt+S
file.export-print | Export for print at a DPI | Export at resolution | Pick the DPI (300 for print, 500, 600 or any number), see the print size it gives, then save. | dpi, ppi, 300 dpi, 600 dpi, print quality, high resolution, pixels per inch, for print | R | 7
file.export-best | Export in best quality | Maximum quality | Save at the top setting: a JPEG keeps every colour pixel (4:4:4); WebP, AVIF and JPEG XL lose nothing. | best quality, highest quality, max quality, 100 percent, no compression, sharpest | R | 7
@File > Export as = Save a copy as | Export as | Pick the file type for the copy.
file.export-png | PNG picture | PNG | Sharp and keeps see-through areas; bigger files. | png, transparent background, lossless | R | 1
file.export-jpeg | JPEG photo | JPEG | Small photo files; drops see-through areas and a little detail. | jpg, jpeg, small file, email | R | 1
file.export-webp | WebP picture | WebP | Small modern web pictures that can keep see-through areas. | webp, website picture | R | 1
file.export-psd | Layered file | PSD | Keeps the layers for other editors. | psd, layered | R | 1
file.export-avif | AVIF picture | AVIF | Very small modern picture files. | avif | R | 7
file.export-gif | GIF picture | GIF | Simple web pictures and animations. | gif, animation | R | 7
file.export-tiff | TIFF picture | TIFF | Files for print and archives. | tiff, tif, print | R | 7
file.export-pdf | PDF document | PDF | Share the picture as a document. | pdf, document | R | 7
file.export-svg | SVG drawing | SVG | A drawing file that stays sharp at any size. | svg, vector | R | 7
file.export-ico | Website icon | ICO | Small icon files for websites. | favicon, icon | R | 7
file.export-jxl | JPEG XL picture | JPEG XL | Very small, high-quality files that keep see-through areas. | jxl, jpeg xl | R | 7
file.export-tga | TGA picture | TGA | Files for games and video tools; keeps see-through areas. | tga, targa | R | 7
file.export-bmp | BMP picture | BMP | Plain Windows pictures with no compression. | bmp, bitmap, windows picture | R | 7
file.export-ora | Layered file for free editors | OpenRaster | Keeps the layers for Krita, GIMP and MyPaint. | ora, openraster, krita, mypaint, gimp layers | R | 7
file.export-animation | Animation from layers | Export animation | A moving GIF, PNG or WebP: each layer becomes one frame. | animation, animated gif, gif from layers, frames, apng, moving picture | R | 7
@File
file.export-layers | Save each layer as a file | Export layers | Save every layer as its own picture. | layers to files, separate layers | R | 7
file.print | Print | Print | Print the picture on paper. | printer, paper | R | 8
file.info | Picture details | File info | Title, author and copyright stored inside the file. | metadata, exif, copyright, author | P | 7
@File > Automate = Do many at once | Automate | Repeat a job on many pictures.
file.batch | Edit many pictures the same way | Batch | Run the same steps on a folder of pictures. | bulk edit, many files | R | 13
file.resize-many | Resize many pictures | Image processor | Resize and convert many files at once. | bulk resize, convert many | R | 13
file.crop-scans | Split scanned photos | Crop and straighten photos | Cut several scanned photos into separate straight pictures. | scans, straighten scans | P | 13
file.contact-sheet | Sheet of small photos | Contact sheet | Place many small pictures on one page. | grid of photos, photo sheet | R | 13
@File
file.scripts | Scripts | Scripts | Run small programs that edit pictures for you. Not built: scripts need a safe sandbox first. | script, automation, code | P | 13

@Edit = Edit | Edit | Undo, copy, paste, fill and turn layers.
edit.undo | Undo | Undo | Take back the last change. | undo, mistake, go back, oops | R | 1 | Ctrl+Z
edit.redo | Redo | Redo | Bring back a change you undid. | redo, again | R | 1 | Ctrl+Shift+Z
edit.history-back | Step back | Step backward | Go one step back in the History list. | previous step | R | W1
edit.history-forward | Step forward | Step forward | Go one step forward in the History list. | next step | R | W1
edit.history-brush-step | Paint back from this step | History brush source | Make the step you are at the one the history brush paints back; History marks it with a brush, and the brush beside any step picks that one. | paint back from step, history brush source, paint from here | R | W5
edit.fade | Soften the last change | Fade | Make the last filter or paint change weaker. | weaker, fade, reduce effect | P | 13
--
edit.cut | Cut | Cut | Move the selected part of this layer to the clipboard. | cut out | R | W1 | Ctrl+X
edit.copy | Copy | Copy | Copy the selected part of this layer. | copy | R | W1 | Ctrl+C
edit.copy-merged | Copy everything you see | Copy merged | Copy the selected area with all layers together. | copy visible, copy all layers | R | W1 | Ctrl+Shift+C
edit.paste | Paste as a new layer | Paste | Put what you copied on a new layer in the middle. | paste | R | W1 | Ctrl+V
edit.paste-in-place | Paste in the same spot | Paste in place | Paste exactly where it was copied from. | paste same place | R | W1 | Ctrl+Shift+V
edit.clear | Delete the selected pixels | Clear | Make the selected area of this layer see-through. | delete area, erase area, remove part | R | 1 | Delete
--
edit.fill | Fill with the main colour | Fill | Fill the selected area, or the whole layer, with your main colour. | paint area, colour fill, fill colour | R | W1 | Alt+Backspace
edit.fill-bg | Fill with the second colour | Fill with background colour | Fill the selected area, or the whole layer, with your second colour. | fill white, background colour | R | W1 | Ctrl+Backspace
edit.stroke | Outline the selection | Stroke | Draw a line along the edge of the selection. | border, outline | R | W3
edit.smart-fill | Fill from the surroundings | Content-aware fill | Remove what is selected; AI on this device fills the gap from its surroundings. | remove object, erase object, remove person, fill selection, remove selection | R | 11
--
edit.free-transform | Resize and turn freely | Free transform | Scale, turn and move the layer with handles. | resize layer, scale, rotate layer | R | W3 | Ctrl+T
@Edit > Transform = Turn and flip | Transform | Flip, turn and reshape the active layer.
edit.flip-layer-h | Mirror left to right | Flip horizontal | Flip the active layer like a mirror. | mirror, flip sideways | R | W1
edit.flip-layer-v | Flip top to bottom | Flip vertical | Flip the active layer upside down. | upside down | R | W1
edit.rotate-layer-cw | Turn right 90° | Rotate 90° clockwise | Turn the active layer a quarter turn to the right. | rotate layer right | R | W1
edit.rotate-layer-ccw | Turn left 90° | Rotate 90° counter-clockwise | Turn the active layer a quarter turn to the left. | rotate layer left | R | W1
edit.rotate-layer-180 | Turn half way round | Rotate 180° | Turn the active layer half a turn. | rotate layer 180 | R | W1
--
edit.scale | Resize the layer | Scale | Make the layer bigger or smaller with handles. | bigger, smaller | R | W3
edit.rotate | Turn by any angle | Rotate | Turn the layer by any amount. | tilt, angle | R | W3
edit.skew | Slant | Skew | Slant the layer sideways. | slant, italic | R | W3
edit.distort | Pull corners freely | Distort | Move each corner on its own. | corner pin | R | W3
edit.perspective | Fix the angle | Perspective | Make a slanted surface look straight on. | keystone | R | W3
edit.warp | Bend | Warp | Bend the layer with a grid of handles. | bend, curve | P | 3
@Edit
edit.smart-scale | Stretch without squashing people | Content-aware scale | Resize while protecting the important parts. | stretch background | P | 11
edit.pin-warp | Bend around pins | Puppet warp | Pin points and bend the shape around them. | pose, bend arm | P | 3
edit.perspective-warp | Re-angle a building | Perspective warp | Change the angle of buildings and flat surfaces. | building angle | P | 3
edit.auto-align | Line up photos automatically | Auto-align layers | Match overlapping photos of the same scene. Not built: finding matching points is not written yet. | panorama, align | P | 13
edit.auto-blend | Blend photos automatically | Auto-blend layers | Merge photos into one seamless picture. Not built: needs Line up photos automatically first. | focus stack, blend | P | 13
--
edit.define-brush | Make a brush from the selection | Define brush | Save the selected area as a brush tip. | custom brush | P | 4
edit.define-pattern | Make a pattern from the selection | Define pattern | Save the selected area as a repeating pattern. | custom pattern, texture | P | 4
@Edit > Settings = Settings | Preferences | Change how the editor looks and talks to you.
edit.pref-pro-names | Show pro names first | Pro names first | Put the usual professional names before the plain names. | expert names, professional names | R | W1
edit.pref-hints | Show help lines | Tooltips | Show one plain line of help when you point at, focus or hold a control. | tips, hints, help text | R | W1
edit.pref-theme | Light or dark look | Theme | Switch between the dark and the light look. | dark mode, light mode, theme | R | 1
edit.pref-language | Language | Language | Use the editor in another language. | translate, hindi | P | 13
edit.pref-gpu | Use the graphics chip | WebGPU | Run the AI tools on the graphics chip, which is much faster. Planned: not tested yet, and it needs its own 28.7 MB download. | gpu, graphics card, graphics chip, faster ai, speed up ai, webgpu | P | 11

@Image = Image | Image | Size, turning and colour of the whole picture.
@Image > Mode = Colour type | Mode | How the colours are stored.
image.mode-gray | Shades of grey only | Grayscale | Store only shades of grey. | grey mode | P | 13
image.mode-indexed | A few colours only | Indexed colour | Limit this layer, or the selected part, to a small palette, like a GIF. | palette, gif colours, indexed | R | 13
image.mode-cmyk | Printing colours | CMYK | Colours for printing presses. Not built: a browser cannot show print inks, so save in RGB and let the print shop convert. | print colours | P | 13
image.mode-lab | Lab colour | Lab colour | Colour described by lightness and two colour axes. Not built yet: editing works in RGB, and Lab needs its own engine. | lab | P | 13
image.mode-16 | Finer colour steps | 16 bits per channel | Smoother gradients for heavy edits. Not built yet: pictures keep 8 bits per colour, as the browser draws them. | 16 bit, high bit depth | P | 13
@Image > Adjustments = Light and colour | Adjustments | Fix brightness, contrast and colour, one tool at a time.
image.adj-brightness | Brightness and contrast | Brightness/Contrast | Make the picture lighter or darker, and punchier or flatter. | brighter, darker, lighter, too dark, too bright, contrast, dull, dim | R | 1
image.adj-levels | Light and dark balance | Levels | Set the darkest point, the brightest point and the middle tones. | tones, black point, white point, washed out, histogram | R | W1 | Ctrl+L
image.adj-curves | Tone curve | Curves | Shape the darks, middles and lights separately. | tone curve, s curve, contrast curve | R | W1 | Ctrl+M
image.adj-exposure | Exposure | Exposure | Fix a photo that came out too dark or too bright, in camera stops. | underexposed, overexposed, dark photo, stops | R | W1
--
image.adj-vibrance | Colour boost | Vibrance | Make dull colours richer without overdoing the strong ones. | pop, vivid, more colour, saturate, punchy | R | W1
image.adj-hue | Colour, strength and lightness | Hue/Saturation | Change colours, or make them stronger or weaker. | change colour, saturation, hue, recolour | R | 1 | Ctrl+U
image.adj-color-balance | Colour tint | Colour balance | Push the darks, middles or lights toward a colour. | warm, cool, tint, colour cast, too yellow, too blue | R | W1 | Ctrl+B
image.adj-bw | Black and white | Black & white | Make the picture grey, choosing how bright each colour becomes. | grey, monochrome, grayscale, no colour, black and white | R | 1 | Ctrl+Shift+Alt+B
image.adj-photo-filter | Lens colour filter | Photo filter | Warm or cool the picture like a coloured filter on the lens. | warm up, cool down, sepia, filter | R | W1
image.adj-channel-mixer | Colour channel mix | Channel mixer | Rebuild each colour channel from the others. | channels, infrared look | R | W1
image.adj-color-lookup | Colour look | Colour lookup | Apply a ready-made colour look from a LUT file. | lut, film look, preset look | P | 5
--
image.adj-invert | Negative | Invert | Swap every colour for its opposite. | negative, invert colours, opposite | R | 1 | Ctrl+I
image.adj-posterize | Fewer tones | Posterize | Reduce the picture to a few flat tones. | poster, cartoon, flat colours | R | W1
image.adj-threshold | Pure black and white | Threshold | Every pixel becomes black or white. | stencil, two colours | R | W1
image.adj-gradient-map | Colour by brightness | Gradient map | Paint the darks and lights with chosen colours. | duotone, two tone, sepia | R | W1
image.adj-selective-color | Change one colour family | Selective colour | Adjust only the reds, the blues, the greys and so on. | change one colour, only reds, skin tone | R | W1
--
image.adj-shadows | Lift shadows, calm highlights | Shadows/Highlights | Brighten dark areas and tame bright ones, judged by their surroundings. | backlit, dark face, recover shadows, bright sky | R | W1
image.adj-desaturate | Remove colour | Desaturate | Make the picture grey in one step. | grey, colourless | R | W1 | Ctrl+Shift+U
image.adj-match | Match another photo's colour | Match colour | Copy the colour mood of another picture. | match colours | P | 5
image.adj-replace | Replace a colour | Replace colour | Swap one colour for another. | swap colour | R | 5
image.adj-equalize | Even out the tones | Equalize | Spread the tones evenly from dark to light. | flat, even, histogram | R | W1
@Image
image.auto-tone | Fix the light automatically | Auto tone | Stretch each colour so the darkest part is black and the lightest white. | auto fix, one click, enhance, improve | R | W1 | Ctrl+Shift+L
image.auto-contrast | Fix the contrast automatically | Auto contrast | Stretch the contrast without changing the colours. | auto contrast, flat photo | R | W1 | Ctrl+Shift+Alt+L
image.auto-color | Fix the colour automatically | Auto colour | Remove a colour cast automatically. | white balance, colour cast, auto colour | R | W1 | Ctrl+Shift+B
--
image.size | Picture size | Image size | Change the width and height in pixels; the picture is redrawn to fit. | resize, smaller, bigger, scale, dimensions, for the web, email size | R | W1 | Ctrl+Alt+I
image.resolution | Print resolution | Resolution (DPI/PPI) | Set how many pixels print in one inch. With Resample off the pixels stay and only the print size changes. | dpi, ppi, print size, pixels per inch, document size, 300 dpi | R | 7
image.remove-bg | Remove the background | Remove background | Keep the main subject and hide everything behind it on a layer mask; nothing is deleted. | background removal, cut out, transparent background, remove backdrop, remove bg, no background, png without background, delete background | R | 11
@Image > Make it bigger = Make it bigger | Upscale | Twice or four times the size, with AI drawing in sharp detail on this device.
image.upscale-2x | Twice as big | Upscale 2× | Double the width and height; AI adds sharp detail instead of blur. | enlarge, upscale, make bigger, bigger photo, increase resolution, higher resolution, hd, enhance, super resolution | R | 11
image.upscale-4x | Four times as big | Upscale 4× | Four times the width and height, for small pictures and old photos. | enlarge 4x, upscale 4x, much bigger, super resolution, sharpen small photo | R | 11
@Image
image.canvas-size | Canvas size | Canvas size | Add or remove space around the picture without stretching it. | border, padding, frame, extend, more space | R | W1 | Ctrl+Alt+C
@Image > Rotate = Turn the picture | Image rotation | Turn or flip the whole picture.
image.rotate-cw | Turn right 90° | Rotate 90° clockwise | Turn the whole picture a quarter turn to the right. | rotate, sideways photo, portrait | R | W1
image.rotate-ccw | Turn left 90° | Rotate 90° counter-clockwise | Turn the whole picture a quarter turn to the left. | rotate left | R | W1
image.rotate-180 | Turn half way round | Rotate 180° | Turn the whole picture upside down. | upside down | R | W1
image.rotate-any | Turn by any angle | Arbitrary rotation | Straighten a tilted horizon by any angle. | straighten, horizon, tilted | P | 3
image.flip-h | Mirror the picture | Flip canvas horizontal | Mirror the whole picture left to right. | mirror, selfie flip | R | W1
image.flip-v | Flip the picture upside down | Flip canvas vertical | Mirror the whole picture top to bottom. | reflection | R | W1
@Image
image.crop | Cut to the selection | Crop | Keep only the selected area. | crop, cut out, trim | R | 1
image.trim | Cut away empty edges | Trim | Remove see-through or same-colour edges. | remove border, auto crop, white edges | R | W1
image.reveal-all | Show the parts outside | Reveal all | Grow the canvas so every layer fits. | expand, show hidden parts | R | W1
--
image.duplicate | Copy into a new tab | Duplicate | Open a copy of the picture in a new tab. | copy picture, try a version | R | W1
image.apply | Blend a layer into itself | Apply image | Not built: blending one colour channel into a layer needs separate channels, which the editor does not have yet. | apply image | P | 13
image.reduce-colors | Use fewer colours | Reduce colours | Limit the picture to a set number of colours. | palette, fewer colours | R | 5
image.vectorize | Turn into shapes | Vectorize | Trace the picture into vector shapes. | trace, svg | P | 6
image.variables | Data-driven pictures | Variables | Make many versions from a data file. | template, data merge | P | 13

@Layer = Layer | Layer | Add, arrange and combine layers.
@Layer > New = New layer | New | Add a new layer.
layer.new | New empty layer | New layer | A clear sheet on top to paint on without touching the photo. | add layer, blank layer, transparent layer | R | 1 | Ctrl+Shift+N
layer.new-copy | Layer from a copy | Layer via copy | Copy the selected area, or the whole layer, to a new layer. | copy to layer | R | W1 | Ctrl+J
layer.new-cut | Layer from a cut | Layer via cut | Move the selected area to a new layer. | cut to layer, separate part | R | W1 | Ctrl+Shift+J
layer.new-group | New empty folder | New group | Start an empty folder of layers above this one, then move layers into it. | group, folder, new folder | R | 3
layer.group | Put in a new folder | Group layers | Put this layer in a new folder in its place, so you can move, hide or fade them together. | group, folder, put in folder | R | 3 | Ctrl+G
layer.ungroup | Take out of the folder | Ungroup layers | Take the folder apart: its layers keep their place, one level up. | ungroup, remove folder, unfold | R | 3 | Ctrl+Shift+G
@Layer
layer.duplicate | Duplicate layer | Duplicate layer | Make an exact copy of the active layer. | copy layer, clone layer | R | 1
layer.delete | Delete layer | Delete layer | Remove the active layer. | remove layer | R | 1
layer.rename | Rename layer | Rename | Give the active layer a clear name. | name layer | R | W1
--
@Layer > Layer effects = Shadows, glows and outlines | Layer style | Effects that stay editable.
layer.fx-shadow | Drop shadow | Drop shadow | A soft shadow behind the layer. | shadow | R | 3
layer.fx-inner-shadow | Inner shadow | Inner shadow | A shadow inside the edges, so it looks pressed in. | inset | R | 3
layer.fx-outer-glow | Outer glow | Outer glow | A soft light around the outside. | glow | R | 3
layer.fx-inner-glow | Inner glow | Inner glow | A soft light inside the edges. | glow inside | R | 3
layer.fx-bevel | Raised edge | Bevel and emboss | Make the layer look raised or carved. | 3d edge | P | 3
layer.fx-satin | Satin sheen | Satin | A silky shine across the layer. | sheen | P | 3
layer.fx-color | Colour overlay | Colour overlay | Cover the layer with one colour. | tint layer | R | 3
layer.fx-gradient | Gradient overlay | Gradient overlay | Cover the layer with a colour fade. | fade overlay | R | 3
layer.fx-pattern | Pattern overlay | Pattern overlay | Cover the layer with a pattern. | texture overlay | P | 3
layer.fx-stroke | Outline | Stroke | Draw a coloured outline around the layer. | outline text, border | R | 3
@Layer > Fill layer = Colour layer | Fill layer | A layer filled with a colour, fade or pattern you can change later.
layer.fill-color | Solid colour layer | Solid colour | A layer of one colour you can change at any time. | colour layer | R | 3
layer.fill-gradient | Colour fade layer | Gradient fill | A colour fade you can change at any time. | gradient layer | P | 3
layer.fill-pattern | Pattern layer | Pattern fill | A repeating pattern you can change at any time. | pattern layer | P | 3
@Layer > Adjustment layer = Editable light and colour | Adjustment layer | An adjustment you can change or remove at any time.
layer.adj-brightness | Brightness and contrast layer | Brightness/Contrast layer | Brightness and contrast that stay editable. | editable brightness | R | 3
layer.adj-levels | Light and dark balance layer | Levels layer | Levels that stay editable. | editable levels | R | 3
layer.adj-curves | Tone curve layer | Curves layer | Curves that stay editable. | editable curves | R | 3
layer.adj-exposure | Exposure layer | Exposure layer | Exposure that stays editable. | editable exposure | R | 3
layer.adj-vibrance | Colour boost layer | Vibrance layer | Vibrance that stays editable. | editable vibrance | R | 3
layer.adj-hue | Colour and strength layer | Hue/Saturation layer | Hue and saturation that stay editable. | editable hue | R | 3
layer.adj-color-balance | Colour tint layer | Colour balance layer | Colour balance that stays editable. | editable colour balance | R | 3
layer.adj-bw | Black and white layer | Black & white layer | Black and white that stays editable. | editable black and white | R | 3
layer.adj-photo-filter | Lens filter layer | Photo filter layer | A photo filter that stays editable. | editable filter | R | 3
layer.adj-channel-mixer | Channel mix layer | Channel mixer layer | A channel mix that stays editable. | editable channels | R | 3
layer.adj-color-lookup | Colour look layer | Colour lookup layer | A colour look that stays editable. | editable lut | P | 3
layer.adj-invert | Negative layer | Invert layer | A negative that you can switch off. | editable invert | R | 3
layer.adj-posterize | Fewer tones layer | Posterize layer | Posterize that stays editable. | editable posterize | R | 3
layer.adj-threshold | Black and white split layer | Threshold layer | A threshold that stays editable. | editable threshold | R | 3
layer.adj-gradient-map | Colour by brightness layer | Gradient map layer | A gradient map that stays editable. | editable gradient map | R | 3
layer.adj-selective-color | One colour family layer | Selective colour layer | Selective colour that stays editable. | editable selective colour | R | 3
@Layer > Mask = Hide parts | Mask | Hide parts of a layer without erasing them.
layer.mask-add | Hide parts with a mask | Add layer mask | Paint black to hide and white to show, without deleting pixels. | mask, hide part, non destructive | R | 2
layer.mask-from-sel | Mask from the selection | Reveal selection | Show only the selected part of the layer. | mask selection | R | 2
layer.mask-apply | Make the mask permanent | Apply mask | Erase what the mask hides. | apply mask | R | 2
layer.mask-delete | Remove the mask | Delete mask | Throw the mask away and show the whole layer. | delete mask | R | 2
layer.mask-hide-all | Hide everything with a mask | Hide all | Hide the whole layer, then paint white where it should show. | mask, hide all, black mask | R | 2
layer.mask-hide-sel | Hide the selection | Hide selection | Hide the selected part of the layer with a mask; its pixels are kept. | mask, hide selection | R | 2
layer.mask-toggle | Switch the mask off | Disable layer mask | See the whole layer again without losing the mask; choose again to switch it back on. | mask on off, disable mask | R | 2
layer.mask-link | Link the mask to the layer | Link layer mask | Linked, the mask moves and turns with the layer; unlinked, they move apart. | link mask, chain | R | 2
layer.vector-mask | Shape mask | Vector mask | Hide parts with a sharp-edged shape. | shape mask | P | 6
layer.clip | Show only inside the layer below | Create clipping mask | Show this layer only where the layer below has pixels. | clip, picture inside text, clipping mask | R | 2 | Ctrl+Alt+G
@Layer > Smart layer = Smart layer | Keep-original layer | A layer that keeps its original pixels, so resizing never loses quality.
layer.smart-convert | Make a smart layer | Keep-original layer | Keep the layer's original pixels safe: resize or turn it as often as you like and get them back exactly. PSD files keep it as plain pixels. | smart object, convert to smart object, protect pixels, resize without losing quality | R | 3
layer.smart-edit | Edit the contents | Open the original | Open the original pixels to change them. | edit smart object, edit contents | P | 3
layer.smart-replace | Replace the contents | Swap the original | Swap the contents for another picture. | mockup, replace contents | P | 3
layer.smart-rasterize | Turn back into pixels | Flatten to pixels | Make the smart layer an ordinary layer you can paint on; its kept original goes. | rasterize, rasterize smart object | R | 3
@Layer
layer.rasterize | Turn into plain pixels | Rasterize layer | Make text, shapes or effects into ordinary pixels. | flatten text | R | W3
--
@Layer > Arrange = Order | Arrange | Move the layer up or down the stack.
layer.front | Bring to the very top | Bring to front | Move the active layer above all others. | top layer | R | W1 | Ctrl+Shift+]
layer.forward | Bring up one | Bring forward | Move the active layer up one place. | move layer up | R | 1 | Ctrl+]
layer.backward | Send down one | Send backward | Move the active layer down one place. | move layer down | R | 1 | Ctrl+[
layer.back | Send to the very bottom | Send to back | Move the active layer below all others. | bottom layer | R | W1 | Ctrl+Shift+[
@Layer > Align = Line up | Align | Line up the active layer with the selection, or with the picture when nothing is selected.
layer.align-left | Line up left edges | Align left edges | Move the layer so its left edge meets the selection's, or the picture's. | align left, line up left | R | W3
layer.align-hcenter | Line up centres across | Align horizontal centers | Centre the layer from side to side on the selection or the picture. | centre horizontally, center | R | W3
layer.align-right | Line up right edges | Align right edges | Move the layer so its right edge meets the selection's, or the picture's. | align right | R | W3
layer.align-top | Line up top edges | Align top edges | Move the layer so its top meets the selection's, or the picture's. | align top | R | W3
layer.align-vcenter | Line up middles | Align vertical centers | Centre the layer from top to bottom on the selection or the picture. | centre vertically, middle | R | W3
layer.align-bottom | Line up bottom edges | Align bottom edges | Move the layer so its bottom meets the selection's, or the picture's. | align bottom | R | W3
--
layer.distribute-h | Space out across | Distribute horizontal centers | Space three or more layers evenly from left to right. | space evenly, distribute | R | W3
layer.distribute-v | Space out down | Distribute vertical centers | Space three or more layers evenly from top to bottom. | space evenly vertically | R | W3
@Layer
layer.lock | Lock the layer | Lock all | Protect the active layer from changes. | lock, protect, freeze | R | W1 | Ctrl+/
layer.hide | Hide the layer | Hide layers | Hide the active layer without deleting it; choose again to show it. | hide, show, eye | R | W1 | Ctrl+,
--
layer.merge-down | Merge into the layer below | Merge down | Combine the active layer with the one under it. | combine layers, merge | R | W1 | Ctrl+E
layer.merge-visible | Merge the shown layers | Merge visible | Combine every shown layer into one. | combine visible | R | W1 | Ctrl+Shift+E
layer.flatten | Flatten into one layer | Flatten image | Combine all layers into one on white. | flatten, single layer | R | W1
layer.defringe | Clean up edge colour | Defringe | Remove coloured halos around cut-outs. | halo, fringe | R | 2
layer.frames | Make animation frames | Make frames from layers | Turn each layer into a frame of an animation. | gif animation, frames | P | 13

@Type = Type | Type | Add and style text.
type.add | Add text | Horizontal type | Click on the picture and type words. | text, words, caption, title, write, quote | R | W3
type.add-vertical | Add up-down text | Vertical type | Text that runs from top to bottom. | vertical text | P | 6
type.fonts | Choose a font | Font | Pick the typeface for your text. | font, typeface | R | W3
type.warp | Bend text | Warp text | Arc, wave or bulge the text. | curved text, arc text, wavy text | P | 6
type.path | Text along a line | Type on a path | Make text follow a curve or a circle. | text on circle | P | 6
type.to-shape | Turn text into a shape | Convert to shape | Make the letters into editable shapes. | outline text | P | 6
type.rasterize | Turn text into pixels | Rasterize type | Make text into ordinary pixels. | flatten text | R | W3
type.smooth | Smooth text edges | Anti-aliasing | Choose how soft the edges of letters are. | jagged text | P | 6
type.spell | Check spelling | Check spelling | Find spelling mistakes in your text. | spelling | P | 6
type.find | Find and replace text | Find and replace | Change a word everywhere at once. | replace word | P | 6

@Select = Select | Select | Choose the part of the picture to change.
select.all | Select everything | Select all | Select the whole picture. | everything, whole picture | R | 1 | Ctrl+A
select.none | Select nothing | Deselect | Drop the selection, so changes apply everywhere. | deselect, clear selection, unselect | R | 1 | Ctrl+D
select.reselect | Bring back the last selection | Reselect | Select again what you had selected before. | previous selection | R | W1 | Ctrl+Shift+D
select.inverse | Swap selected and not selected | Inverse | Select everything except what is selected now. | invert selection, opposite, background | R | W1 | Ctrl+Shift+I
--
select.subject | Select the main subject | Subject | Find the person or thing in front and select all of it, with AI on this device. | person, subject, auto select, select person, select object automatically | R | 11
select.color-range | Select by colour | Colour range | Select every pixel close to a colour, like the sky. | select sky, select colour | R | W3
select.focus | Select the sharp parts | Focus area | Select what is in focus and leave the blurry parts. | in focus | R | 11
--
select.refine | Smooth the selection edge | Refine edge | Tidy up hair and soft edges of a selection: the edge follows the picture, then smooth, soften or move it. | hair, fur, edge | R | 2
@Select > Modify = Change the selection | Modify | Grow, shrink or soften the selection.
select.border | Edge band | Border | Select a band along the selection edge. | border selection | R | W3
select.smooth | Round off | Smooth | Round off sharp corners of the selection. | smooth selection | R | W3
select.expand | Grow by pixels | Expand | Make the selection bigger by a number of pixels. | bigger selection | R | W3
select.contract | Shrink by pixels | Contract | Make the selection smaller by a number of pixels. | smaller selection | R | W3
select.feather | Soften the edge | Feather | Make the selection fade out gently at its edge. | soft edge, feather | R | W3 | Shift+F6
@Select
select.grow | Grow into similar colours | Grow | Add nearby pixels of similar colour. | grow | R | W3
select.similar | Select similar colours everywhere | Similar | Add every pixel in the picture of a similar colour. | similar | R | W3
select.transform | Resize the selection | Transform selection | Change the size and angle of the selection. | resize selection | R | W3
--
select.quick-mask | Paint a selection | Quick mask | Paint where to select, then switch back to a selection. | paint selection | R | W3 | Q
select.save | Save the selection | Save selection | Keep the selection to use again later. | store selection | R | W3
select.load | Load a saved selection | Load selection | Bring back a saved selection. | load selection | R | W3

@Filter = Filter | Filter | Effects such as blur, sharpen, noise and distortions.
filter.last | Repeat the last effect | Last filter | Run the last effect again with the same settings. | again, repeat effect | R | W1 | Ctrl+Alt+F
--
filter.gallery | Artistic effects | Filter gallery | Try painterly effects with a big preview. | painting effect, sketch | P | W2
filter.lens | Fix lens problems | Lens correction | Straighten bulging lines and lighten dark corners. | distortion, vignette, fisheye | R | W2
filter.raw | Develop a photo | Raw develop | Every photo control in one place, as for camera RAW files. | raw, develop, camera raw | P | 5
filter.liquify | Push pixels like liquid | Liquify | Gently push, bloat or pinch parts of the picture. | reshape, slim, liquify | P | 5
filter.perspective-plane | Paint in perspective | Perspective plane | Copy and paint along walls and floors in perspective. | vanishing point | P | 5
@Filter > Blur = Blur | Blur | Soften the picture.
filter.blur-gaussian | Smooth blur | Gaussian blur | An even, soft blur over the selected area or the whole layer. | blur, soften, smooth, out of focus, blurry | R | 1
filter.blur-box | Box blur | Box blur | A blur that averages square blocks. | box blur | R | W2
filter.blur-motion | Movement blur | Motion blur | Streak the picture as if it moved. | speed, motion | R | W2
filter.blur-radial | Spin or zoom blur | Radial blur | Blur in circles or toward a centre. | zoom blur, spin | R | W2
filter.blur-surface | Skin smoothing blur | Surface blur | Smooth flat areas and keep edges sharp. | smooth skin, airbrush | R | W2
filter.blur-lens | Camera lens blur | Lens blur | A blur that looks like a real camera lens. | bokeh | R | W2
filter.blur-average | Average colour | Average | Fill the area with its average colour. | average | R | W2
filter.blur-smart | Edge-aware blur | Smart blur | Blur everything except sharp edges. | smart blur | R | W2
@Filter > Camera blurs = Camera blurs | Blur gallery | Blurs that imitate camera lenses.
filter.blur-field | Gradual blur | Field blur | Blur that changes smoothly across the picture. | gradual blur | R | W2
filter.blur-iris | Blur around a spot | Iris blur | Keep one spot sharp and blur everything around it. | blur the background, background blur, portrait mode, bokeh | R | W2
filter.blur-tilt | Miniature effect | Tilt-shift | Keep a band sharp so the scene looks like a model. | miniature, tilt shift | R | W2
filter.blur-path | Blur along a path | Path blur | Blur along a line you draw. | path blur | P | W2
filter.blur-spin | Spinning blur | Spin blur | Make wheels and fans look like they spin. | wheels | R | W2
@Filter > Distort = Bend and twist | Distort | Bend, wave and twist the picture.
filter.displace | Push by a map | Displace | Push pixels around by a pattern of light and dark, such as soft clouds. | displacement, warp, distort | R | W2
filter.pinch | Pinch | Pinch | Squeeze the middle inwards or outwards. | pinch | R | W2
filter.polar | Wrap into a circle | Polar coordinates | Wrap the picture into a circle or unwrap it. | tiny planet | R | W2
filter.ripple | Ripples | Ripple | Add ripples like water. | water ripple | R | W2
filter.shear | Bend sideways | Shear | Bend the picture along a curve. | shear | R | W2
filter.spherize | Bulge | Spherize | Bulge the picture like a ball. | bulge, fisheye | R | W2
filter.twirl | Swirl | Twirl | Swirl the middle round. | swirl | R | W2
filter.wave | Waves | Wave | Bend the picture in waves. | wavy | R | W2
filter.zigzag | Rings in water | Zigzag | Ripple outwards like a stone in a pond. | pond ripple | R | W2
filter.glass | Behind glass | Glass | Look through textured glass. | frosted glass | R | W2
filter.ocean-ripple | Under water | Ocean ripple | Look through rippling water. | underwater | R | W2
@Filter > Noise = Grain | Noise | Add or remove grain and specks.
filter.add-noise | Add grain | Add noise | Add film-like grain. | grain, film grain | R | W2
filter.despeckle | Remove specks | Despeckle | Remove tiny specks and keep edges. | specks | R | W2
filter.dust | Remove dust and scratches | Dust and scratches | Hide small dust spots and scratches. | dust, scratches, old photo | R | W2
filter.median | Smooth out specks | Median | Replace each pixel with the middle value nearby. | median | R | W2
filter.reduce-noise | Reduce grain | Reduce noise | Smooth away camera grain from dark photos. | denoise, grainy photo | R | W2
@Filter > Pixelate = Blocks and dots | Pixelate | Turn the picture into blocks, dots or crystals.
filter.halftone | Print dots | Colour halftone | Make the picture out of printing dots. | comic dots | R | W2
filter.crystallize | Crystals | Crystallize | Break the picture into crystal shapes. | crystals | R | W2
filter.facet | Painted look | Facet | Group similar pixels into flat patches. | facet | R | W2
filter.fragment | Shaky copies | Fragment | Overlay four shifted copies. | shaky | R | W2
filter.mezzotint | Engraved dots | Mezzotint | Turn tones into random dots and lines. | engraving | R | W2
filter.mosaic | Blocks | Mosaic | Turn the picture into big square blocks. | pixelate, censor, hide face | R | W2
filter.pointillize | Painted dots | Pointillize | Paint the picture with coloured dots. | dots | R | W2
@Filter > Render = Make patterns | Render | Create clouds, light flares and textures.
filter.clouds | Clouds | Clouds | Fill with soft clouds in your two colours. | sky texture | R | W2
filter.difference-clouds | Marbled clouds | Difference clouds | Blend clouds into the picture for a marbled look. | marble | R | W2
filter.fibers | Fibres | Fibers | Draw a woven fibre texture. | fabric | R | W2
filter.lens-flare | Light flare | Lens flare | Add a bright camera flare. | sun flare | R | W2
filter.lighting | Spotlights | Lighting effects | Light the picture with spotlights. | spotlight | R | W2
@Filter > Sharpen = Sharpen | Sharpen | Make edges crisper.
filter.sharpen | Sharpen a little | Sharpen | Make edges a little crisper, with a preview before you apply. | crisp, sharp, blurry photo, focus | R | W1
filter.sharpen-more | Sharpen more | Sharpen more | Make edges clearly crisper, with a preview before you apply. | sharper | R | W1
filter.unsharp | Sharpen with control | Unsharp mask | Choose how strong and how wide the sharpening is. | sharpen detail, crisp | R | 1
filter.sharpen-edges | Sharpen only the edges | Sharpen edges | Sharpen edges and leave smooth areas alone. | edges | R | W2
filter.smart-sharpen | Smart sharpen | Smart sharpen | Sharpen with less halo and noise. | smart sharpen | R | W2
@Filter > Stylize = Graphic effects | Stylize | Turn the picture into graphic art.
filter.diffuse | Scatter | Diffuse | Scatter the pixels for a frosted look. | scatter | R | W2
filter.emboss | Stamped metal | Emboss | Make the picture look pressed into metal. | emboss | R | W2
filter.extrude | 3D blocks | Extrude | Push the picture out into 3D blocks. | blocks | R | W2
filter.find-edges | Outline drawing | Find edges | Keep only the outlines, like a sketch. | sketch, outline, line drawing | R | W2
filter.oil-paint | Oil painting | Oil paint | Make the picture look painted with oils. | painting, oil | R | W2
filter.solarize | Half negative | Solarize | Mix the picture with its negative. | solarize | R | W2
filter.tiles | Tiles | Tiles | Break the picture into tiles. | tiles | R | W2
filter.trace-contour | Contour lines | Trace contour | Draw lines along areas of the same brightness. | contour | R | W2
filter.wind | Wind streaks | Wind | Blow streaks across the picture. | wind | R | W2
filter.glowing-edges | Glowing outlines | Glowing edges | Turn the outlines into bright, neon-like lines on black. | neon, glow, glowing lines, neon outline | R | W2
@Filter > Other = More effects | Other | Special effects for experts.
filter.high-pass | Keep only the detail | High pass | Grey picture of just the edges, used for sharpening. | high pass | R | W2
filter.maximum | Grow light areas | Maximum | Spread the light areas outwards. | maximum | R | W2
filter.minimum | Grow dark areas | Minimum | Spread the dark areas outwards. | minimum | R | W2
filter.offset | Shift and wrap | Offset | Slide the picture and wrap it round the edges. | seamless tile | R | W2
filter.custom | Your own filter | Custom | Type in your own blur or sharpen numbers. | kernel | R | W2
filter.color-to-alpha | Make a colour see-through | Colour to alpha | Turn one colour transparent, like a white background. | remove white, transparent | R | W2
filter.dither | Dither | Dither | Fake extra colours with patterns of dots. | dither | R | W2

@View = View | View | Zoom, rulers, grid and screen modes.
view.zoom-in | Zoom in | Zoom in | Look closer. | bigger view, magnify | R | 1 | Ctrl+=
view.zoom-out | Zoom out | Zoom out | See more of the picture. | smaller view | R | 1 | Ctrl+-
view.fit | Fit on screen | Fit on screen | Show the whole picture as large as fits. | whole picture, fit | R | 1 | Ctrl+0
view.actual | Actual pixels | 100% | One picture pixel per screen pixel. | real size, 100 | R | 1 | Ctrl+1
view.zoom-200 | Double size | 200% | Two screen pixels per picture pixel. | 200 | R | W1
view.print-size | Print size | Print size | Show the picture at the size it would print. | print preview | R | 8
--
@View > Screen mode = Screen mode | Screen mode | How much of the workspace shows.
view.screen-standard | Normal workspace | Standard screen mode | Show the menus, tools and panels. | normal view | R | W1
view.screen-focus | Picture only | Full screen mode | Hide the tools and panels to see just the picture. Press F or Esc to come back. | full screen, distraction free | R | W1
view.screen-cycle | Switch screen mode | Cycle screen mode | Switch between the normal workspace and picture only. | toggle full screen | R | W1 | F
@View
view.rulers | Rulers | Rulers | Show measuring rulers along the edges of the picture. | measure, ruler | R | W1 | Ctrl+R
view.grid | Grid | Grid | Show a grid over the picture to line things up. | grid, align, straight lines | R | W1 | Ctrl+'
view.extras | Selection outline | Extras | Show or hide the moving dashes around a selection. | marching ants | R | W1 | Ctrl+H
view.pixel-grid | Pixel grid | Pixel grid | Show the edge of each pixel when zoomed in to 800% or more. | pixel grid | R | W2
--
view.guide-new | Add a guide line | New guide | Add a straight line to line things up against: down the middle first, then across. Drag it with Move, or off the picture to remove it. | guide | R | 13
view.guide-clear | Remove guide lines | Clear guides | Remove all guide lines. | clear guides | R | 13
view.guide-lock | Lock guide lines | Lock guides | Stop guide lines from moving. | lock guides | R | 13
view.snap | Snap to guides | Snap | Make guides, oval selections, measures, shapes and colour fades jump to guide lines and the picture's edges and middle. | snap | R | 13
view.slices-clear | Remove slices | Clear slices | Remove the web slices. | slices | P | 13

@Window = Window | Window | Show, hide and arrange panels.
panel.layers | Layers | Layers | The stack of sheets your picture is made of; upper sheets cover lower ones. | layers, stack, sheets | R | 1 | F7
panel.history | History | History | Every step you took; pick one to go back to it. | steps, undo list | R | W1
panel.properties | Properties | Properties | Name, position, size, opacity and blend of the active layer. | settings, details | R | W1
panel.adjustments | Light and colour | Adjustments | Every light and colour fix, one tap away. | fixes, adjustments | R | W1
panel.color | Colour | Colour | Pick your main and second colours. | colour picker, choose colour | R | W1 | F6
panel.swatches | Swatches | Swatches | Ready-made colours to pick with one tap. | palette, colours | R | W1
panel.navigator | Navigator | Navigator | A small view of the whole picture; drag the box to move around. | overview, minimap | R | W1
panel.info | Info | Info | Position and colour under the pointer, and the picture's size. | coordinates, rgb values, pixel colour | R | W1 | F8
panel.channels | Colour channels | Channels | See the red, green, blue and see-through channels one by one. | channels | P | 2
panel.paths | Outlines | Paths | Outlines you drew with the pen: pick, rename, delete, or turn one into a selection. | paths, outlines, saved path, work path | R | 6
panel.character | Text style | Character | Font, size and spacing of text. | font size | R | W3
panel.paragraph | Paragraph | Paragraph | Line-up and spacing of text blocks. | align text | R | W3
panel.brushes | Brush tips | Brushes | Choose and shape brush tips. | brush shapes | P | 4
panel.histogram | Tone graph | Histogram | A graph of how many dark and light pixels there are. | histogram | R | W2
panel.actions | Recorded steps | Actions | Record steps and play them back. | macro, record | R | 13
panel.styles | Saved effects | Styles | Effects you saved to use again. | styles | P | 3
panel.tool-presets | Saved tool settings | Tool presets | Tool settings you saved to use again. | presets | P | 4
panel.glyphs | Special characters | Glyphs | Symbols and letters not on your keyboard. | symbols | P | 6
panel.notes | Notes | Notes | Notes you pinned on the picture. | notes | P | 13
panel.timeline | Animation timeline | Timeline | Frames of an animation in order. | animation | P | 13
panel.layer-comps | Saved layer setups | Layer comps | Remember which layers were shown, to switch between versions. | versions | P | 13
panel.vector-info | Shape measurements | Vector info | Exact sizes of shapes and paths. | shape size | P | 6
--
window.reset | Reset the workspace | Reset workspace | Put every panel back where it started. | default layout | R | W1
window.collapse | Fold away all panels | Collapse panels | Fold every panel group down to its title. | tidy panels | R | W1

@Help = Help | Help | Learn the editor, find commands and see shortcuts.
help.start | What do you want to do? | Start screen | Pick a job and the editor opens the right tool for you. | start, how to, beginner, help me | R | W1
help.search | Search for a command | Search | Type what you want, like "make it brighter". | find, search, command | R | W1 | Ctrl+K
help.shortcuts | Keyboard shortcuts | Keyboard shortcuts | Every shortcut key in one list. | keys, hotkeys | R | 1
help.guided | Guided jobs | Guided jobs | Step-by-step help on the real controls. | tutorial, learn, lesson | P | W4
--
help.about | About Free Photo Editor | About | Version, licence and the people behind it. | about, licence, credits | R | 1
help.source | Source code | Source code | Open this editor's code on GitHub. | github, open source | R | 1
help.report | Report a problem | Report a bug | Tell the maker what went wrong. | bug, issue, feedback | R | W1

@Tools > Move = Move | Move | Move layers.
tool.move | Move | Move tool | Drag to move the active layer. Arrow keys nudge it by one pixel. | move, drag, position | R | 1 | V
tool.artboard | Artboards | Artboard tool | Design several canvases side by side. | artboard | P | 13
@Tools > Select box = Select a box | Marquee | Select rectangles and ovals.
tool.select-rect | Select a box | Rectangular marquee | Drag to select a rectangle; hold Shift for a square. | select area, rectangle, box | R | 1 | M
tool.select-ellipse | Select an oval | Elliptical marquee | Drag to select an oval; hold Shift while dragging for a circle. | circle selection | R | 2
tool.select-row | Select one row | Single row marquee | Select a line of pixels one pixel tall. | row | R | 2
tool.select-column | Select one column | Single column marquee | Select a line of pixels one pixel wide. | column | R | 2
@Tools > Lasso = Draw a selection | Lasso | Draw around the part you want.
tool.lasso | Draw around it | Lasso | Draw freely around what you want to select. | freehand selection | R | W3 | L
tool.lasso-poly | Click around it | Polygonal lasso | Click from corner to corner in straight lines. | straight lines selection | R | W3
tool.lasso-magnetic | Snap to edges | Magnetic lasso | Trace near an edge and the outline sticks to it. | edge selection | P | 2
@Tools > Smart select = Smart select | Quick selection | Let the editor find the edges for you.
tool.quick-select | Paint to select | Quick selection | Paint over an area and the selection grows to its edges. | quick selection | R | W3
tool.object-select | Select an object | Object selection | Tap a thing, or drag a box round it, and it becomes the selection; Shift adds, Alt takes away. | object, tap to select, click to select, select a thing, select an object | R | 11
tool.magic-wand | Select similar colour | Magic wand | Click a colour to select the area of similar colour. | magic wand, same colour | R | W3 | W
@Tools > Crop = Crop | Crop | Cut the picture to a new shape.
tool.crop | Crop | Crop tool | Drag to choose the part to keep, then apply. Ratios make square or story crops. | crop, cut, trim, square, instagram | R | 1 | C
tool.crop-perspective | Crop and straighten | Perspective crop | Crop a slanted surface so it looks straight on. | straighten document | P | 3
tool.slice | Cut into web pieces | Slice | Cut the picture into pieces for a web page. | slice | P | 13
@Tools > Measure = Pick and measure | Eyedropper | Pick colours and measure.
tool.eyedropper | Pick a colour | Eyedropper | Click the picture to use that colour for painting. | colour picker, sample colour | R | 1 | I
tool.color-sampler | Colour markers | Colour sampler | Pin up to four points that show their colour values. | colour values | R | 13
tool.ruler | Measure | Ruler | Measure a distance and an angle. | measure, angle | R | 13
tool.note | Sticky note | Note | Pin a written note on the picture. Notes stay while the picture is open; they are not saved into exported files. | comment | R | 13
@Tools > Retouch = Fix spots | Healing | Remove spots and blemishes.
tool.spot-heal | Remove spots | Spot healing brush | Paint over a spot and it blends into its surroundings. | blemish, pimple, dust spot, remove spot | R | W3 | J
tool.remove | Remove an object | Remove tool | Paint over something and let go: it disappears and AI fills the gap. | remove object, erase object, remove person, remove people, delete object, clean up photo, remove wires, remove text | R | 11
tool.heal | Heal from a source | Healing brush | Alt-click a clean area, then paint to heal with it. | heal | R | W3
tool.patch | Patch an area | Patch | Draw around a flaw and drag it to a clean area. | patch | R | W3
tool.smart-move | Move and fill the gap | Content-aware move | Move something and fill the hole it leaves. | move object | P | 11
tool.red-eye | Fix red eyes | Red eye | Click a red eye to make it dark again. | red eye, flash eyes | R | W3
@Tools > Paint = Paint | Brush | Paint and draw.
tool.brush | Paint brush | Brush | Paint with soft or hard edges; pens set the size by pressure. | paint, draw, brush, colour in | R | 1 | B
tool.pencil | Pencil | Pencil | Hard-edged lines, good for pixel art. | pixel art, hard line, sketch | R | W1
tool.color-replace | Recolour by painting | Colour replacement | Paint to change a colour and keep the detail. | recolour | R | W3
tool.mixer | Blend paint | Mixer brush | Paint that mixes with the colours already there. | wet paint | P | 4
@Tools > Clone = Copy an area | Clone stamp | Paint with pixels copied from another spot.
tool.clone | Copy an area | Clone stamp | Alt-click a source, then paint to copy it somewhere else. | clone, copy area, duplicate object | R | W3 | S
tool.pattern-stamp | Paint a pattern | Pattern stamp | Paint with a repeating pattern. | pattern brush | P | 4
@Tools > History brush = Paint back | History brush | Paint parts back to how they looked when the picture was opened.
tool.history-brush | Paint back an earlier step | History brush | Paint to bring back how part of the picture looked at an earlier step: the one marked with the brush in History, at first as opened. | undo part, paint back, restore part | R | W3 | Y
tool.art-history | Painterly strokes | Art history brush | Paint quick artistic strokes from an earlier step. | art brush | P | 4
@Tools > Erase = Erase | Eraser | Remove pixels.
tool.eraser | Eraser | Eraser | Rub out pixels so they become see-through. | erase, rub out | R | 1 | E
tool.bg-eraser | Erase a background | Background eraser | Erase the colour under the brush's centre and keep the edges. | erase background | R | W3
tool.magic-eraser | Erase similar colour | Magic eraser | Click a colour to erase the area of similar colour. | remove white background | R | W3
@Tools > Fill = Fill | Gradient | Fill areas with colour or colour fades.
tool.gradient | Colour fade | Gradient | Drag to fill with a smooth fade between colours. | fade, gradient, ombre | R | W3 | G
tool.bucket | Fill an area | Paint bucket | Click to fill an area of similar colour. | fill, bucket | R | W3
@Tools > Soften = Soften and smudge | Blur tool | Blur, sharpen or smudge by painting.
tool.blur | Soften by painting | Blur tool | Paint to soften just where you want. | soften part | R | W3
tool.sharpen | Sharpen by painting | Sharpen tool | Paint to sharpen just where you want. | sharpen part | R | W3
tool.smudge | Smudge | Smudge | Push the colours around like wet paint. | smear | R | W3
@Tools > Light = Lighten and darken | Dodge | Lighten, darken or change colour strength by painting.
tool.dodge | Lighten by painting | Dodge | Paint to lighten just where you want. | lighten part, brighten eyes | R | W3 | O
tool.burn | Darken by painting | Burn | Paint to darken just where you want. | darken part | R | W3
tool.sponge | Colour strength by painting | Sponge | Paint to make colours stronger or weaker. | saturate part | R | W3
@Tools > Pen = Pen | Pen | Draw exact outlines and curves.
tool.pen | Draw curves | Pen | Click for corners, drag for smooth curves; click the first point to close the outline. | bezier, outline, curve, draw path, trace | R | 6 | P
tool.pen-free | Draw outlines freely | Freeform pen | Draw an outline freely like a pencil. | freeform | P | 6
tool.anchor-add | Add a point | Add anchor point | Press on an outline's line to add a point there without changing its shape. | add point | R | 6
tool.anchor-delete | Remove a point | Delete anchor point | Press a point of an outline to remove it. | remove point | R | 6
tool.anchor-convert | Change a corner | Convert point | Switch a point between sharp and smooth, or drag a handle to move it alone. | corner, smooth point, sharp point | R | 6
@Tools > Text = Text | Type | Add words to the picture.
tool.type | Text | Horizontal type | Click and type words on the picture. | text, words, caption | R | W3 | T
tool.type-vertical | Up-down text | Vertical type | Type words from top to bottom. | vertical text | P | 6
tool.type-mask | Text-shaped selection | Type mask | Type words to select their shape. | text selection | P | 6
@Tools > Path select = Pick outlines | Path selection | Select and move outlines.
tool.path-select | Pick a whole outline | Path selection | Press an outline to pick it, then drag to move all of it. | select path, move outline | R | 6 | A
tool.direct-select | Pick outline points | Direct selection | Drag one point or handle of an outline to reshape it. | edit points, move point, reshape outline | R | 6
@Tools > Shapes = Shapes | Shape | Draw rectangles, circles, lines and more.
tool.rect | Rectangle | Rectangle | Drag to draw a rectangle. | box, square shape | R | W3 | U
tool.rounded-rect | Rounded rectangle | Rounded rectangle | Drag to draw a box with round corners; set how round in the options bar. | rounded box, button shape, pill | R | W3
tool.ellipse | Circle or oval | Ellipse | Drag to draw an oval; hold Shift for a circle. | circle shape | R | W3
tool.polygon | Polygon | Polygon | Draw a shape with straight sides, like a star. | star, triangle | R | W3
tool.line | Line | Line | Drag to draw a straight line or arrow. | arrow, straight line | R | W3
tool.custom-shape | Ready-made shapes | Custom shape | Draw hearts, arrows, speech bubbles and more. | heart, speech bubble | P | 6
@Tools > Hand = Move around | Hand | Move around a zoomed picture.
tool.hand | Move the view | Hand | Drag to move around the picture; hold Space with any tool. | pan, scroll around | R | W1 | H
tool.rotate-view | Turn the view | Rotate view | Turn the view to paint at a comfortable angle. | turn canvas | P | 13 | R
@Tools > Zoom = Zoom | Zoom | Zoom in and out.
tool.zoom | Zoom | Zoom tool | Click to zoom in; Alt-click to zoom out. | magnify, zoom | R | W1 | Z
@Tools > Colours = Colours | Colours | Your main and second colours.
tool.swap-colors | Swap the two colours | Switch colours | Swap your main and second colours. | swap colours | R | W1 | X
tool.default-colors | Black and white | Default colours | Reset to a black main colour and a white second colour. | reset colours | R | W1 | D
`;

export type Status = 'ready' | 'planned';
export type Kind = 'command' | 'tool' | 'panel';
export interface Row {
  id: string; plain: string; pro: string; help: string; wish: string; place: string;
  status: Status; phase: string; key: string; kind: Kind; sep: boolean;
}
export interface MenuInfo { path: string; plain: string; pro: string; help: string; sep: boolean; }
export type MenuEntry = { type: 'item'; row: Row } | { type: 'sub'; info: MenuInfo };

export const ROWS: Row[] = [];
export const MENU_INFO = new Map<string, MenuInfo>();
/** Entries of every menu, submenu and tool group, in order. */
export const MENU_ITEMS = new Map<string, MenuEntry[]>();
export const TOP_MENUS = ['File', 'Edit', 'Image', 'Layer', 'Type', 'Select', 'Filter', 'View', 'Window', 'Help'] as const;
export const PHASES: Record<string, string> = {
  '1': 'v0.1 engine and editor', W1: 'Professional workspace (this card)', W2: 'Every filter family', W3: 'Remaining tools',
  W4: 'Learn while you edit', '2': 'Selections and masks', '3': 'Transform and layers', '4': 'Painting and retouch',
  '5': 'More filters and adjustments', '6': 'Text, shapes and paths', '7': 'More file formats', '8': 'Offline and install',
  '11': 'On-device AI', '13': 'Actions, batch, scripts, languages',
};

(function parse(): void {
  let place = '', sep = false;
  for (const raw of SRC.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '--') { sep = true; continue; }
    if (line.startsWith('@')) {
      const [path, rest] = line.slice(1).split(' = ');
      place = path.trim();
      if (!MENU_ITEMS.has(place)) MENU_ITEMS.set(place, []);
      if (rest && !MENU_INFO.has(place)) {
        const [plain, pro, help] = rest.split(' | ').map((s) => s.trim());
        const info: MenuInfo = { path: place, plain, pro, help, sep };
        MENU_INFO.set(place, info);
        const cut = place.lastIndexOf(' > ');
        if (cut > 0 && !place.startsWith('Tools')) MENU_ITEMS.get(place.slice(0, cut))?.push({ type: 'sub', info });
        sep = false;
      }
      continue;
    }
    const f = line.split(' | ').map((s) => s.trim());
    if (f.length < 7) throw new Error('Bad function-map row: ' + line);
    const [id, plain, pro, help, wish, st, phase, key] = f;
    const row: Row = {
      id, plain, pro, help, wish: wish === '-' ? '' : wish, place, status: st === 'R' ? 'ready' : 'planned', phase, key: key ?? '',
      kind: id.startsWith('tool.') ? 'tool' : id.startsWith('panel.') ? 'panel' : 'command', sep,
    };
    sep = false;
    ROWS.push(row);
    MENU_ITEMS.get(place)?.push({ type: 'item', row });
  }
})();

export const BY_ID = new Map(ROWS.map((r) => [r.id, r] as const));
export const row = (id: string): Row | undefined => BY_ID.get(id);
export const TOOL_GROUPS = [...MENU_INFO.values()].filter((m) => m.path.startsWith('Tools > ') && m.path !== 'Tools > Colours');
export const PANELS = ROWS.filter((r) => r.kind === 'panel');
/** The always-on tools of the Task ribbon's left column (ribbon-homes.ts ALWAYS 'Your tools'; registry.test.ts checks they match). */
export const KEEP_TOOLS = ['tool.move', 'tool.select-rect', 'tool.brush', 'tool.eraser', 'tool.crop', 'tool.type'];
/** "Image > Adjustments" as people read it. */
export const placeText = (p: string): string => p.replace(/ > /g, ' › ');

// ---------- search that understands wishes ----------
const STOP = new Set(['a', 'an', 'the', 'to', 'it', 'its', 'my', 'me', 'i', 'want', 'make', 'this', 'that', 'of', 'in', 'on', 'for', 'please',
  'how', 'do', 'can', 'is', 'be', 'some', 'with', 'and', 'or', 'more', 'bit', 'little', 'get', 'picture', 'photo', 'image', 'pic']);
const SYN: Record<string, string> = { color: 'colour', colors: 'colour', colours: 'colour', grey: 'grey', gray: 'grey', greyscale: 'grey',
  grayscale: 'grey', bg: 'background', backdrop: 'background', pic: 'picture', erase: 'erase', delete: 'delete', resize: 'resize', bigger: 'big', smaller: 'small' };
export function stem(w: string): string {
  let s = SYN[w] ?? w;
  for (const end of ['ening', 'ness', 'ing', 'er', 'ed', 'es', 's']) {
    if (s.length > end.length + 3 && s.endsWith(end)) { s = s.slice(0, -end.length); break; }
  }
  return s;
}
export const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9°%]+/g, ' ').split(' ').filter(Boolean);
interface Indexed { row: Row; fields: [string[], number][]; all: string; }
let INDEX: Indexed[] | null = null;
/** Add rows that live outside the menus (the new Planned functions, loaded by search on first use). */
export function addRows(rows: Row[]): void {
  for (const r of rows) { ROWS.push(r); BY_ID.set(r.id, r); }
  INDEX = null;
}
function index(): Indexed[] {
  return (INDEX ??= ROWS.map((r) => ({
    row: r,
    fields: [[words(r.plain).map(stem), 3], [words(r.pro).map(stem), 3], [words(r.wish).map(stem), 4], [words(r.help).map(stem), 1], [words(r.place).map(stem), 1]],
    all: (r.plain + ' ' + r.pro + ' ' + r.wish).toLowerCase(),
  })));
}
/** Commands that match a wish such as "make it brighter" or "blur the background", best first. */
export function search(query: string, limit = 12): Row[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const toks = words(q).filter((w) => !STOP.has(w)).map(stem);
  const scored: [number, Row][] = [];
  for (const it of index()) {
    let score = 0;
    for (const t of toks) {
      let best = 0;
      for (const [ws, wt] of it.fields) if (ws.some((w) => w === t || (t.length > 2 && w.startsWith(t)))) best = Math.max(best, wt);
      score += best;
    }
    if (it.all.includes(q)) score += 6;
    if (!score || (toks.length > 1 && score < toks.length)) continue;
    if (it.row.status === 'planned') score -= 0.5;
    if (it.row.kind === 'panel') score -= 0.25;
    scored.push([score, it.row]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1]);
}

// ---------- counts (docs/function-map.md is written by function-map.ts) ----------
export function counts(): { total: number; ready: number; planned: number; tools: number; panels: number; menus: number } {
  const ready = ROWS.filter((r) => r.status === 'ready').length;
  return { total: ROWS.length, ready, planned: ROWS.length - ready, tools: ROWS.filter((r) => r.kind === 'tool').length,
    panels: PANELS.length, menus: [...MENU_INFO.keys()].filter((k) => !k.startsWith('Tools')).length };
}
