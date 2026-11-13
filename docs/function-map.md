# Free Photo Editor: function map

Generated from `packages/web/src/registry.ts`, `registry-union.ts` and `ribbon-homes.ts` by `packages/web/test/registry.test.ts`;
do not edit by hand. Every menu item, tool and panel of a professional editor, with a plain name first, the usual
pro name second, one plain line of help, the wish words search understands, where it lives, and whether it works today.

**675 functions: 433 Ready, 242 Planned** (65 tools, 22 panels, 37 menus and submenus).
414 are today's menu, tool and panel rows; 261 are new functions from the feature census (U001 to U261),
176 of them Planned until their wave builds them; they never join the menu bar: search lists them (a Planned one with its tag), and the Task ribbon gives each one a home.

## Reach on the Task ribbon

Counted from the resting screen (a photo open, nothing else opened): what never leaves the screen is 1 click; a tab and
its command, or an app-bar sheet and its item, is 2; a More list, a family sheet or a group shrunk to its button is 3.
Scrolling is free, search and keys are not clicks, and contextual tabs are not counted. A function shown in two places
counts once, at its best.

| Functions | Count | 1 click | 2 clicks | 3 clicks | Search only |
|---|---|---|---|---|---|
| All functions | 675 | 25 | 220 | 430 | 0 |
| Ready today | 433 | 25 | 184 | 224 | 0 |

## The Task ribbon

Twelve task tabs, deep work first (the first is open by default), four sheets in the app bar, and the items that never
leave the screen. "Commands" counts every command a tab shows, including ones shown again from another home.

| Tab: plain · pro | Groups | Commands | Homed here | Shown on the tab (2 clicks) |
|---|---|---|---|---|
| Effects & masks · Layer styles, adjustment layers and masks | New, Editable light and colour, Shadows and glows, Live effects, Hide parts, Blending | 67 | 67 | 12 |
| Select & cut out · Selection | Select with AI, Draw or paint, By colour or light, Change it, Perfect and keep, Copy and paste | 51 | 51 | 14 |
| Retouch & remove · Retouch | Remove, Repair, Touch up by painting, Faces and skin, Rescue a photo | 26 | 22 | 9 |
| Develop RAW · RAW develop | Develop, Light and tone, Colour and looks, Detail and lens, Edit one area, Check | 38 | 35 | 7 |
| AI tools · AI | Make with words, Select and remove, Change with AI, Better quality, Faces and words | 36 | 23 | 4 |
| Paint & draw · Painting | Paint and erase, Brush kinds, Brush settings, Fill, Colour, Paint back | 47 | 47 | 11 |
| Shapes & text · Vectors and type | Draw outlines, Shapes, Combine and style, Live shape effects, Text, Text style | 65 | 65 | 14 |
| Automate & batch · Actions and batch | Record steps, Do many at once, Merge photos, Scripts and data, Sheets and layouts | 24 | 24 | 6 |
| Arrange layers · Layer arrangement | This layer, Order, Folders, Line up, Combine, Find and versions, Animate | 42 | 42 | 17 |
| Crop & resize · Crop and transform | Crop, Size, Turn the picture, Move and reshape a layer, Turn a layer, Bend and push | 38 | 38 | 17 |
| Light & colour · Adjustments | Fix in one click, Light and colour, More colour tools, Colour type, Colour accuracy | 51 | 48 | 15 |
| Filters & blur · Filters | Again, Popular effects, Blur, Camera blurs, Sharpen, Grain and specks, Bend and twist, Blocks and dots, Patterns and light, Graphic looks, Artistic, More effects | 114 | 100 | 8 |
| File sheet · File (backstage) | app-bar sheet | 29 | 29 | 29 |
| Export sheet · Export as | app-bar sheet | 26 | 26 | 26 |
| View sheet · View, panels and workspace | app-bar sheet | 40 | 40 | 40 |
| Help sheet · Help, learn and settings | app-bar sheet | 12 | 12 | 12 |

Always on screen (1 click): App bar (help.search, edit.undo, edit.redo, file.export); Picture tabs (file.new, file.close); Your tools (tool.move, tool.select-rect, tool.brush, tool.eraser, tool.crop, tool.type); Layers card (panel.layers, layer.new, layer.mask-add, layer.duplicate, layer.delete, layer.hide); History (panel.history, edit.history-back, edit.history-forward); Properties (panel.properties); Zoom (view.zoom-out, view.zoom-in, view.fit).

## Contextual tabs

Shown only in context, as a filled chip in the app bar. Everything on them also has a home above, so the reach count never depends on them.

| Tab: plain · pro | Shown when | Commands |
|---|---|---|
| Brush options · Brush | tool.brush | paint.mypaint, paint.bristle, paint.filter-brush, paint.sketch-brush, paint.chalk-spray, paint.shape-brush, paint.dynamic-brush, paint.normal-brush, paint.calligraphy, paint.dynamics, paint.stabilizer, paint.symmetry, paint.wrap-around, panel.tool-presets |
| Pen options · Pen | tool.pen | path.boolean, path.combine, path.divide, select.from-path, path.stroke-style, path.effects |
| Crop options · Crop | tool.crop | image.rotate-any, view.composition-guides, tool.crop-perspective |
| Remove and heal options · Remove and heal | tool.remove tool.spot-heal tool.heal | its own settings only |
| Colour fade options · Gradient | tool.gradient | its own settings only |
| Transform options · Transform | edit.free-transform | edit.warp, edit.cage, edit.transform-3d, edit.transform-again |
| Selection · Select | an active selection | select.refine, select.feather, select.inverse, layer.mask-from-sel, edit.smart-fill, ai.generative-fill, layer.new-copy, image.crop, select.save, select.to-path, view.task-bar |
| Text · Type | tool.type | type.opentype, type.styles, type.scripts, type.warp, type.path, type.to-shape, type.match-font |
| Mask · Layer mask | a mask being edited | layer.mask-edge, select.refine, select.color-range, select.luminance, layer.live-masks, layer.mask-toggle, layer.mask-link, layer.mask-apply |
| Adjustment layer · Adjustment or fill layer | an adjustment or fill layer | layer.adj-presets |
| Smart layer · Smart object | a smart layer | layer.smart-filters, layer.smart-edit, layer.smart-replace |

## Phases

| Phase | What ships |
|---|---|
| 1 | v0.1 engine and editor |
| 2 | Selections and masks |
| 3 | Transform and layers |
| 4 | Painting and retouch |
| 5 | More filters and adjustments |
| 6 | Text, shapes and paths |
| 7 | More file formats |
| 8 | Offline and install |
| 11 | On-device AI |
| 13 | Actions, batch, scripts, languages |
| W1 | Professional workspace (this card) |
| W2 | Every filter family |
| W3 | Remaining tools |
| W4 | Learn while you edit |
| B1 | Build wave 1: smart layers and live filters |
| B4 | Build wave 4: pen and paths |
| B5 | Build wave 5: brush engine |
| B6 | Build wave 6: rAW develop room |
| B7 | Build wave 7: recorded steps and batch |
| B8 | Build wave 8: fill by describing (optional add-on) |
| B9 | Build wave 9: masks and blending depth |
| B10 | Build wave 10: selection depth |
| B11 | Build wave 11: retouch depth |
| B12 | Build wave 12: develop depth |
| B13 | Build wave 13: more on-device AI |
| B14 | Build wave 14: painting depth |
| B15 | Build wave 15: vectors and type depth |
| B16 | Build wave 16: warps and liquify |
| B17 | Build wave 17: merge photos and HDR |
| B18 | Build wave 18: colour accuracy, bit depth, print |
| B19 | Build wave 19: automation depth |
| B20 | Build wave 20: workspace helpers |
| T3 | Basic or niche, not sequenced yet |

## File (38 Ready, 3 Planned)

Groups: Save a copy as · Export as; Do many at once · Automate.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| file.new | New picture | New | Start an empty picture of any size. | blank, empty canvas, start fresh, new document | File | File sheet | Ready | 1 | Ctrl+N |
| file.open | Open a photo | Open | Open a picture from this device in a new tab. | load, photo, import, upload, open file, heic, raw, dng, tiff, pdf | File | File sheet | Ready | 1 | Ctrl+O |
| file.open-layer | Add a photo as a layer | Place | Put another picture on top of this one as its own layer. | combine photos, collage, overlay, add picture, place | File | File sheet | Ready | 1 | Ctrl+Shift+O |
| file.sample | Try a sample photo | Open sample | Open a built-in practice photo to try things on. | example, demo, practice, test picture | File | File sheet | Ready | W1 |  |
| file.open-url | Open from a web link | Open from URL | Load a picture from an internet address. | link, url, web address | File | File sheet | Ready | 7 |  |
| file.camera | Take a photo | Capture | Use the camera to take a new picture. | camera, selfie, webcam | File | File sheet | Ready | 8 |  |
| file.recent | Recent pictures | Open recent | Open again a picture you opened before. The files are kept only in this browser on this device; nothing is uploaded. | last files, history, open again | File | File sheet | Ready | 8 |  |
| file.restore | Bring back last pictures | Recover | Open again the pictures that were still open when the editor last closed. | restore, recover, lost work, crashed, closed by mistake | File | File sheet | Ready | 8 |  |
| file.autosave | Keep safety copies | Autosave | Keep a copy of open pictures in this browser, so a closed tab or a crash loses nothing. Nothing is uploaded. | autosave, auto save, backup, never lose work | File | File sheet | Ready | 8 |  |
| file.install | Install as an app | Install app | Put the editor on your home screen or desktop. It opens in its own window and works offline. | install, app, home screen, desktop app, offline, add to dock, pwa | File | File sheet | Ready | 8 |  |
| file.close | Close picture | Close | Close this picture's tab. | close, done, finish | File | File sheet | Ready | W1 |  |
| file.close-all | Close all pictures | Close all | Close every open tab. | close everything | File | File sheet | Ready | W1 |  |
| file.revert | Go back to the opened version | Revert | Undo every change since the picture was opened. | reset, original, start over, undo everything | File | File sheet | Ready | W1 |  |
| file.save-psd | Save with layers | Save as PSD | Keep every layer in a file other editors can open. | psd, keep layers, project file, save project | File | Export sheet | Ready | 1 |  |
| file.export | Export | Export as | Save a copy as PNG, JPEG, WebP, PSD, TIFF, GIF, AVIF, JPEG XL, PDF, SVG and more, with a note on what each type loses. | save, download, png, jpg, save as | File | File sheet | Ready | 1 | Ctrl+S |
| file.quick-png | Quick export as PNG | Quick export | Save a PNG straight away, no questions asked. | quick save, png, download now | File | Export sheet | Ready | W1 | Ctrl+Shift+Alt+S |
| file.export-print | Export for print at a DPI | Export at resolution | Pick the DPI (300 for print, 500, 600 or any number), see the print size it gives, then save. | dpi, ppi, 300 dpi, 600 dpi, print quality, high resolution, pixels per inch, for print | File | Export sheet | Ready | 7 |  |
| file.export-best | Export in best quality | Maximum quality | Save at the top setting: a JPEG keeps every colour pixel (4:4:4); WebP, AVIF and JPEG XL lose nothing. | best quality, highest quality, max quality, 100 percent, no compression, sharpest | File | Export sheet | Ready | 7 |  |
| file.export-png | PNG picture | PNG | Sharp and keeps see-through areas; bigger files. | png, transparent background, lossless | File › Export as | Export sheet | Ready | 1 |  |
| file.export-jpeg | JPEG photo | JPEG | Small photo files; drops see-through areas and a little detail. | jpg, jpeg, small file, email | File › Export as | Export sheet | Ready | 1 |  |
| file.export-webp | WebP picture | WebP | Small modern web pictures that can keep see-through areas. | webp, website picture | File › Export as | Export sheet | Ready | 1 |  |
| file.export-psd | Layered file | PSD | Keeps the layers for other editors. | psd, layered | File › Export as | Export sheet | Ready | 1 |  |
| file.export-avif | AVIF picture | AVIF | Very small modern picture files. | avif | File › Export as | Export sheet | Ready | 7 |  |
| file.export-gif | GIF picture | GIF | Simple web pictures and animations. | gif, animation | File › Export as | Export sheet | Ready | 7 |  |
| file.export-tiff | TIFF picture | TIFF | Files for print and archives. | tiff, tif, print | File › Export as | Export sheet | Ready | 7 |  |
| file.export-pdf | PDF document | PDF | Share the picture as a document. | pdf, document | File › Export as | Export sheet | Ready | 7 |  |
| file.export-svg | SVG drawing | SVG | A drawing file that stays sharp at any size. | svg, vector | File › Export as | Export sheet | Ready | 7 |  |
| file.export-ico | Website icon | ICO | Small icon files for websites. | favicon, icon | File › Export as | Export sheet | Ready | 7 |  |
| file.export-jxl | JPEG XL picture | JPEG XL | Very small, high-quality files that keep see-through areas. | jxl, jpeg xl | File › Export as | Export sheet | Ready | 7 |  |
| file.export-tga | TGA picture | TGA | Files for games and video tools; keeps see-through areas. | tga, targa | File › Export as | Export sheet | Ready | 7 |  |
| file.export-bmp | BMP picture | BMP | Plain Windows pictures with no compression. | bmp, bitmap, windows picture | File › Export as | Export sheet | Ready | 7 |  |
| file.export-ora | Layered file for free editors | OpenRaster | Keeps the layers for Krita, GIMP and MyPaint. | ora, openraster, krita, mypaint, gimp layers | File › Export as | Export sheet | Ready | 7 |  |
| file.export-animation | Animation from layers | Export animation | A moving GIF, PNG or WebP: each layer becomes one frame. | animation, animated gif, gif from layers, frames, apng, moving picture | File › Export as | Export sheet | Ready | 7 |  |
| file.export-layers | Save each layer as a file | Export layers | Save every layer as its own picture. | layers to files, separate layers | File | Export sheet | Ready | 7 |  |
| file.print | Print | Print | Print the picture on paper. | printer, paper | File | File sheet | Ready | 8 |  |
| file.info | Picture details | File info | Title, author and copyright stored inside the file. | metadata, exif, copyright, author | File | File sheet | Planned | 7 |  |
| file.batch | Edit many pictures the same way | Batch | Run the same steps on a folder of pictures. | bulk edit, many files | File › Automate | Automate & batch › Do many at once · big button | Ready | 13 |  |
| file.resize-many | Resize many pictures | Image processor | Resize and convert many files at once. | bulk resize, convert many | File › Automate | Automate & batch › Do many at once · small button | Ready | 13 |  |
| file.crop-scans | Split scanned photos | Crop and straighten photos | Cut several scanned photos into separate straight pictures. | scans, straighten scans | File › Automate | Automate & batch › Do many at once · More list | Planned | 13 |  |
| file.contact-sheet | Sheet of small photos | Contact sheet | Place many small pictures on one page. | grid of photos, photo sheet | File › Automate | Automate & batch › Sheets and layouts · small button | Ready | 13 |  |
| file.scripts | Scripts | Scripts | Run small programs that edit pictures for you. Not built: scripts need a safe sandbox first. | script, automation, code | File | Automate & batch › Scripts and data · More list | Planned | 13 |  |

## Edit (29 Ready, 11 Planned)

Groups: Turn and flip · Transform; Settings · Preferences.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| edit.undo | Undo | Undo | Take back the last change. | undo, mistake, go back, oops | Edit | Always on screen › App bar | Ready | 1 | Ctrl+Z |
| edit.redo | Redo | Redo | Bring back a change you undid. | redo, again | Edit | Always on screen › App bar | Ready | 1 | Ctrl+Shift+Z |
| edit.history-back | Step back | Step backward | Go one step back in the History list. | previous step | Edit | Always on screen › History | Ready | W1 |  |
| edit.history-forward | Step forward | Step forward | Go one step forward in the History list. | next step | Edit | Always on screen › History | Ready | W1 |  |
| edit.history-brush-step | Paint back from this step | History brush source | Make the step you are at the one the history brush paints back; History marks it with a brush, and the brush beside any step picks that one. | paint back from step, history brush source, paint from here | Edit | Paint & draw › Paint back · small button | Ready | W5 |  |
| edit.fade | Soften the last change | Fade | Make the last filter or paint change weaker. | weaker, fade, reduce effect | Edit | Filters & blur › Again · More list | Planned | 13 |  |
| edit.cut | Cut | Cut | Move the selected part of this layer to the clipboard. | cut out | Edit | Select & cut out › Copy and paste · More list | Ready | W1 | Ctrl+X |
| edit.copy | Copy | Copy | Copy the selected part of this layer. | copy | Edit | Select & cut out › Copy and paste · small button | Ready | W1 | Ctrl+C |
| edit.copy-merged | Copy everything you see | Copy merged | Copy the selected area with all layers together. | copy visible, copy all layers | Edit | Select & cut out › Copy and paste · More list | Ready | W1 | Ctrl+Shift+C |
| edit.paste | Paste as a new layer | Paste | Put what you copied on a new layer in the middle. | paste | Edit | Select & cut out › Copy and paste · More list | Ready | W1 | Ctrl+V |
| edit.paste-in-place | Paste in the same spot | Paste in place | Paste exactly where it was copied from. | paste same place | Edit | Select & cut out › Copy and paste · More list | Ready | W1 | Ctrl+Shift+V |
| edit.clear | Delete the selected pixels | Clear | Make the selected area of this layer see-through. | delete area, erase area, remove part | Edit | Select & cut out › Copy and paste · More list | Ready | 1 | Delete |
| edit.fill | Fill with the main colour | Fill | Fill the selected area, or the whole layer, with your main colour. | paint area, colour fill, fill colour | Edit | Paint & draw › Fill · More list | Ready | W1 | Alt+Backspace |
| edit.fill-bg | Fill with the second colour | Fill with background colour | Fill the selected area, or the whole layer, with your second colour. | fill white, background colour | Edit | Paint & draw › Fill · More list | Ready | W1 | Ctrl+Backspace |
| edit.stroke | Outline the selection | Stroke | Draw a line along the edge of the selection. | border, outline | Edit | Paint & draw › Fill · More list | Ready | W3 |  |
| edit.smart-fill | Fill from the surroundings | Content-aware fill | Remove what is selected; AI on this device fills the gap from its surroundings. | remove object, erase object, remove person, fill selection, remove selection | Edit | Retouch & remove › Remove · small button | Ready | 11 |  |
| edit.free-transform | Resize and turn freely | Free transform | Scale, turn and move the layer with handles. | resize layer, scale, rotate layer | Edit | Crop & resize › Move and reshape a layer · small button | Ready | W3 | Ctrl+T |
| edit.flip-layer-h | Mirror left to right | Flip horizontal | Flip the active layer like a mirror. | mirror, flip sideways | Edit › Transform | Crop & resize › Turn a layer · small button | Ready | W1 |  |
| edit.flip-layer-v | Flip top to bottom | Flip vertical | Flip the active layer upside down. | upside down | Edit › Transform | Crop & resize › Turn a layer · small button | Ready | W1 |  |
| edit.rotate-layer-cw | Turn right 90° | Rotate 90° clockwise | Turn the active layer a quarter turn to the right. | rotate layer right | Edit › Transform | Crop & resize › Turn a layer · small button | Ready | W1 |  |
| edit.rotate-layer-ccw | Turn left 90° | Rotate 90° counter-clockwise | Turn the active layer a quarter turn to the left. | rotate layer left | Edit › Transform | Crop & resize › Turn a layer · More list | Ready | W1 |  |
| edit.rotate-layer-180 | Turn half way round | Rotate 180° | Turn the active layer half a turn. | rotate layer 180 | Edit › Transform | Crop & resize › Turn a layer · More list | Ready | W1 |  |
| edit.scale | Resize the layer | Scale | Make the layer bigger or smaller with handles. | bigger, smaller | Edit › Transform | Crop & resize › Move and reshape a layer · small button | Ready | W3 |  |
| edit.rotate | Turn by any angle | Rotate | Turn the layer by any amount. | tilt, angle | Edit › Transform | Crop & resize › Move and reshape a layer · small button | Ready | W3 |  |
| edit.skew | Slant | Skew | Slant the layer sideways. | slant, italic | Edit › Transform | Crop & resize › Move and reshape a layer · More list | Ready | W3 |  |
| edit.distort | Pull corners freely | Distort | Move each corner on its own. | corner pin | Edit › Transform | Crop & resize › Move and reshape a layer · More list | Ready | W3 |  |
| edit.perspective | Fix the angle | Perspective | Make a slanted surface look straight on. | keystone | Edit › Transform | Crop & resize › Move and reshape a layer · More list | Ready | W3 |  |
| edit.warp | Bend | Warp | Bend the layer with a grid of handles. | bend, curve | Edit › Transform | Crop & resize › Bend and push · More list | Planned | 3 |  |
| edit.smart-scale | Stretch without squashing people | Content-aware scale | Resize while protecting the important parts. | stretch background | Edit | Crop & resize › Bend and push · More list | Planned | 11 |  |
| edit.pin-warp | Bend around pins | Puppet warp | Pin points and bend the shape around them. | pose, bend arm | Edit | Crop & resize › Bend and push · More list | Planned | 3 |  |
| edit.perspective-warp | Re-angle a building | Perspective warp | Change the angle of buildings and flat surfaces. | building angle | Edit | Crop & resize › Bend and push · More list | Planned | 3 |  |
| edit.auto-align | Line up photos automatically | Auto-align layers | Match overlapping photos of the same scene. Not built: finding matching points is not written yet. | panorama, align | Edit | Automate & batch › Merge photos · More list | Planned | 13 |  |
| edit.auto-blend | Blend photos automatically | Auto-blend layers | Merge photos into one seamless picture. Not built: needs Line up photos automatically first. | focus stack, blend | Edit | Automate & batch › Merge photos · More list | Planned | 13 |  |
| edit.define-brush | Make a brush from the selection | Define brush | Save the selected area as a brush tip. | custom brush | Edit | Paint & draw › Brush settings · More list | Planned | 4 |  |
| edit.define-pattern | Make a pattern from the selection | Define pattern | Save the selected area as a repeating pattern. | custom pattern, texture | Edit | Paint & draw › Fill · More list | Planned | 4 |  |
| edit.pref-pro-names | Show pro names first | Pro names first | Put the usual professional names before the plain names. | expert names, professional names | Edit › Settings | Help sheet | Ready | W1 |  |
| edit.pref-hints | Show help lines | Tooltips | Show one plain line of help when you point at, focus or hold a control. | tips, hints, help text | Edit › Settings | Help sheet | Ready | W1 |  |
| edit.pref-theme | Light or dark look | Theme | Switch between the dark and the light look. | dark mode, light mode, theme | Edit › Settings | Help sheet | Ready | 1 |  |
| edit.pref-language | Language | Language | Use the editor in another language. | translate, hindi | Edit › Settings | Help sheet | Planned | 13 |  |
| edit.pref-gpu | Use the graphics chip | WebGPU | Run the AI tools on the graphics chip, which is much faster. Planned: not tested yet, and it needs its own 28.7 MB download. | gpu, graphics card, graphics chip, faster ai, speed up ai, webgpu | Edit › Settings | Help sheet | Planned | 11 |  |

## Image (39 Ready, 10 Planned)

Groups: Colour type · Mode; Light and colour · Adjustments; Make it bigger · Upscale; Turn the picture · Image rotation.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| image.mode-gray | Shades of grey only | Grayscale | Store only shades of grey. | grey mode | Image › Mode | Light & colour › Colour type · More list | Planned | 13 |  |
| image.mode-indexed | A few colours only | Indexed colour | Limit this layer, or the selected part, to a small palette, like a GIF. | palette, gif colours, indexed | Image › Mode | Light & colour › Colour type · small button | Ready | 13 |  |
| image.mode-cmyk | Printing colours | CMYK | Colours for printing presses. Not built: a browser cannot show print inks, so save in RGB and let the print shop convert. | print colours | Image › Mode | Light & colour › Colour type · More list | Planned | 13 |  |
| image.mode-lab | Lab colour | Lab colour | Colour described by lightness and two colour axes. Not built yet: editing works in RGB, and Lab needs its own engine. | lab | Image › Mode | Light & colour › Colour type · More list | Planned | 13 |  |
| image.mode-16 | Finer colour steps | 16 bits per channel | Smoother gradients for heavy edits. Not built yet: pictures keep 8 bits per colour, as the browser draws them. | 16 bit, high bit depth | Image › Mode | Light & colour › Colour type · More list | Planned | 13 |  |
| image.adj-brightness | Brightness and contrast | Brightness/Contrast | Make the picture lighter or darker, and punchier or flatter. | brighter, darker, lighter, too dark, too bright, contrast, dull, dim | Image › Adjustments | Light & colour › Light and colour · live-preview gallery | Ready | 1 |  |
| image.adj-levels | Light and dark balance | Levels | Set the darkest point, the brightest point and the middle tones. | tones, black point, white point, washed out, histogram | Image › Adjustments | Light & colour › Light and colour · live-preview gallery | Ready | W1 | Ctrl+L |
| image.adj-curves | Tone curve | Curves | Shape the darks, middles and lights separately. | tone curve, s curve, contrast curve | Image › Adjustments | Light & colour › Light and colour · live-preview gallery | Ready | W1 | Ctrl+M |
| image.adj-exposure | Exposure | Exposure | Fix a photo that came out too dark or too bright, in camera stops. | underexposed, overexposed, dark photo, stops | Image › Adjustments | Light & colour › Light and colour · live-preview gallery | Ready | W1 |  |
| image.adj-vibrance | Colour boost | Vibrance | Make dull colours richer without overdoing the strong ones. | pop, vivid, more colour, saturate, punchy | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-hue | Colour, strength and lightness | Hue/Saturation | Change colours, or make them stronger or weaker. | change colour, saturation, hue, recolour | Image › Adjustments | Light & colour › Light and colour · More list | Ready | 1 | Ctrl+U |
| image.adj-color-balance | Colour tint | Colour balance | Push the darks, middles or lights toward a colour. | warm, cool, tint, colour cast, too yellow, too blue | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 | Ctrl+B |
| image.adj-bw | Black and white | Black & white | Make the picture grey, choosing how bright each colour becomes. | grey, monochrome, grayscale, no colour, black and white | Image › Adjustments | Light & colour › Light and colour · More list | Ready | 1 | Ctrl+Shift+Alt+B |
| image.adj-photo-filter | Lens colour filter | Photo filter | Warm or cool the picture like a coloured filter on the lens. | warm up, cool down, sepia, filter | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-channel-mixer | Colour channel mix | Channel mixer | Rebuild each colour channel from the others. | channels, infrared look | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-color-lookup | Colour look | Colour lookup | Apply a ready-made colour look from a LUT file. | lut, film look, preset look | Image › Adjustments | Light & colour › Light and colour · More list | Planned | 5 |  |
| image.adj-invert | Negative | Invert | Swap every colour for its opposite. | negative, invert colours, opposite | Image › Adjustments | Light & colour › Light and colour · More list | Ready | 1 | Ctrl+I |
| image.adj-posterize | Fewer tones | Posterize | Reduce the picture to a few flat tones. | poster, cartoon, flat colours | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-threshold | Pure black and white | Threshold | Every pixel becomes black or white. | stencil, two colours | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-gradient-map | Colour by brightness | Gradient map | Paint the darks and lights with chosen colours. | duotone, two tone, sepia | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-selective-color | Change one colour family | Selective colour | Adjust only the reds, the blues, the greys and so on. | change one colour, only reds, skin tone | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.adj-shadows | Lift shadows, calm highlights | Shadows/Highlights | Brighten dark areas and tame bright ones, judged by their surroundings. | backlit, dark face, recover shadows, bright sky | Image › Adjustments | Light & colour › Light and colour · live-preview gallery | Ready | W1 |  |
| image.adj-desaturate | Remove colour | Desaturate | Make the picture grey in one step. | grey, colourless | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 | Ctrl+Shift+U |
| image.adj-match | Match another photo's colour | Match colour | Copy the colour mood of another picture. | match colours | Image › Adjustments | Light & colour › Light and colour · More list | Planned | 5 |  |
| image.adj-replace | Replace a colour | Replace colour | Swap one colour for another. | swap colour | Image › Adjustments | Light & colour › Light and colour · More list | Ready | 5 |  |
| image.adj-equalize | Even out the tones | Equalize | Spread the tones evenly from dark to light. | flat, even, histogram | Image › Adjustments | Light & colour › Light and colour · More list | Ready | W1 |  |
| image.auto-tone | Fix the light automatically | Auto tone | Stretch each colour so the darkest part is black and the lightest white. | auto fix, one click, enhance, improve | Image | Light & colour › Fix in one click · small button | Ready | W1 | Ctrl+Shift+L |
| image.auto-contrast | Fix the contrast automatically | Auto contrast | Stretch the contrast without changing the colours. | auto contrast, flat photo | Image | Light & colour › Fix in one click · small button | Ready | W1 | Ctrl+Shift+Alt+L |
| image.auto-color | Fix the colour automatically | Auto colour | Remove a colour cast automatically. | white balance, colour cast, auto colour | Image | Light & colour › Fix in one click · small button | Ready | W1 | Ctrl+Shift+B |
| image.size | Picture size | Image size | Change the width and height in pixels; the picture is redrawn to fit. | resize, smaller, bigger, scale, dimensions, for the web, email size | Image | Crop & resize › Size · small button | Ready | W1 | Ctrl+Alt+I |
| image.resolution | Print resolution | Resolution (DPI/PPI) | Set how many pixels print in one inch. With Resample off the pixels stay and only the print size changes. | dpi, ppi, print size, pixels per inch, document size, 300 dpi | Image | Crop & resize › Size · More list | Ready | 7 |  |
| image.remove-bg | Remove the background | Remove background | Keep the main subject and hide everything behind it on a layer mask; nothing is deleted. | background removal, cut out, transparent background, remove backdrop, remove bg, no background, png without background, delete background | Image | Select & cut out › Select with AI · small button | Ready | 11 |  |
| image.upscale-2x | Twice as big | Upscale 2× | Double the width and height; AI adds sharp detail instead of blur. | enlarge, upscale, make bigger, bigger photo, increase resolution, higher resolution, hd, enhance, super resolution | Image › Make it bigger | Crop & resize › Size · small button | Ready | 11 |  |
| image.upscale-4x | Four times as big | Upscale 4× | Four times the width and height, for small pictures and old photos. | enlarge 4x, upscale 4x, much bigger, super resolution, sharpen small photo | Image › Make it bigger | Crop & resize › Size · More list | Ready | 11 |  |
| image.canvas-size | Canvas size | Canvas size | Add or remove space around the picture without stretching it. | border, padding, frame, extend, more space | Image | Crop & resize › Size · small button | Ready | W1 | Ctrl+Alt+C |
| image.rotate-cw | Turn right 90° | Rotate 90° clockwise | Turn the whole picture a quarter turn to the right. | rotate, sideways photo, portrait | Image › Rotate | Crop & resize › Turn the picture · small button | Ready | W1 |  |
| image.rotate-ccw | Turn left 90° | Rotate 90° counter-clockwise | Turn the whole picture a quarter turn to the left. | rotate left | Image › Rotate | Crop & resize › Turn the picture · small button | Ready | W1 |  |
| image.rotate-180 | Turn half way round | Rotate 180° | Turn the whole picture upside down. | upside down | Image › Rotate | Crop & resize › Turn the picture · small button | Ready | W1 |  |
| image.rotate-any | Turn by any angle | Arbitrary rotation | Straighten a tilted horizon by any angle. | straighten, horizon, tilted | Image › Rotate | Crop & resize › Turn the picture · More list | Planned | 3 |  |
| image.flip-h | Mirror the picture | Flip canvas horizontal | Mirror the whole picture left to right. | mirror, selfie flip | Image › Rotate | Crop & resize › Turn the picture · More list | Ready | W1 |  |
| image.flip-v | Flip the picture upside down | Flip canvas vertical | Mirror the whole picture top to bottom. | reflection | Image › Rotate | Crop & resize › Turn the picture · More list | Ready | W1 |  |
| image.crop | Cut to the selection | Crop | Keep only the selected area. | crop, cut out, trim | Image | Crop & resize › Crop · small button | Ready | 1 |  |
| image.trim | Cut away empty edges | Trim | Remove see-through or same-colour edges. | remove border, auto crop, white edges | Image | Crop & resize › Crop · small button | Ready | W1 |  |
| image.reveal-all | Show the parts outside | Reveal all | Grow the canvas so every layer fits. | expand, show hidden parts | Image | Crop & resize › Crop · small button | Ready | W1 |  |
| image.duplicate | Copy into a new tab | Duplicate | Open a copy of the picture in a new tab. | copy picture, try a version | Image | File sheet | Ready | W1 |  |
| image.apply | Blend a layer into itself | Apply image | Not built: blending one colour channel into a layer needs separate channels, which the editor does not have yet. | apply image | Image | Light & colour › More colour tools · More list | Planned | 13 |  |
| image.reduce-colors | Use fewer colours | Reduce colours | Limit the picture to a set number of colours. | palette, fewer colours | Image | Light & colour › Colour type · small button | Ready | 5 |  |
| image.vectorize | Turn into shapes | Vectorize | Trace the picture into vector shapes. | trace, svg | Image | Shapes & text › Shapes · More list | Planned | 6 |  |
| image.variables | Data-driven pictures | Variables | Make many versions from a data file. | template, data merge | Image | Automate & batch › Scripts and data · More list | Planned | 13 |  |

## Layer (65 Ready, 7 Planned)

Groups: New layer · New; Shadows, glows and outlines · Layer style; Colour layer · Fill layer; Editable light and colour · Adjustment layer; Hide parts · Mask; Smart layer · Smart object; Order · Arrange; Line up · Align.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| layer.new | New empty layer | New layer | A clear sheet on top to paint on without touching the photo. | add layer, blank layer, transparent layer | Layer › New | Effects & masks › New · big button | Ready | 1 | Ctrl+Shift+N |
| layer.new-copy | Layer from a copy | Layer via copy | Copy the selected area, or the whole layer, to a new layer. | copy to layer | Layer › New | Effects & masks › New · More list | Ready | W1 | Ctrl+J |
| layer.new-cut | Layer from a cut | Layer via cut | Move the selected area to a new layer. | cut to layer, separate part | Layer › New | Effects & masks › New · More list | Ready | W1 | Ctrl+Shift+J |
| layer.new-group | New empty folder | New group | Start an empty folder of layers above this one, then move layers into it. | group, folder, new folder | Layer › New | Effects & masks › New · More list | Ready | 3 |  |
| layer.group | Put in a new folder | Group layers | Put this layer in a new folder in its place, so you can move, hide or fade them together. | group, folder, put in folder | Layer › New | Arrange layers › Folders · small button | Ready | 3 | Ctrl+G |
| layer.ungroup | Take out of the folder | Ungroup layers | Take the folder apart: its layers keep their place, one level up. | ungroup, remove folder, unfold | Layer › New | Arrange layers › Folders · small button | Ready | 3 | Ctrl+Shift+G |
| layer.duplicate | Duplicate layer | Duplicate layer | Make an exact copy of the active layer. | copy layer, clone layer | Layer | Effects & masks › New · More list | Ready | 1 |  |
| layer.delete | Delete layer | Delete layer | Remove the active layer. | remove layer | Layer | Arrange layers › This layer · More list | Ready | 1 |  |
| layer.rename | Rename layer | Rename | Give the active layer a clear name. | name layer | Layer | Arrange layers › This layer · small button | Ready | W1 |  |
| layer.fx-shadow | Drop shadow | Drop shadow | A soft shadow behind the layer. | shadow | Layer › Layer effects | Effects & masks › Shadows and glows · live-preview gallery | Ready | 3 |  |
| layer.fx-inner-shadow | Inner shadow | Inner shadow | A shadow inside the edges, so it looks pressed in. | inset | Layer › Layer effects | Effects & masks › Shadows and glows · More list | Ready | 3 |  |
| layer.fx-outer-glow | Outer glow | Outer glow | A soft light around the outside. | glow | Layer › Layer effects | Effects & masks › Shadows and glows · live-preview gallery | Ready | 3 |  |
| layer.fx-inner-glow | Inner glow | Inner glow | A soft light inside the edges. | glow inside | Layer › Layer effects | Effects & masks › Shadows and glows · More list | Ready | 3 |  |
| layer.fx-bevel | Raised edge | Bevel and emboss | Make the layer look raised or carved. | 3d edge | Layer › Layer effects | Effects & masks › Shadows and glows · live-preview gallery | Ready | 3 |  |
| layer.fx-satin | Satin sheen | Satin | A silky shine across the layer. | sheen | Layer › Layer effects | Effects & masks › Shadows and glows · More list | Ready | 3 |  |
| layer.fx-color | Colour overlay | Colour overlay | Cover the layer with one colour. | tint layer | Layer › Layer effects | Effects & masks › Shadows and glows · live-preview gallery | Ready | 3 |  |
| layer.fx-gradient | Gradient overlay | Gradient overlay | Cover the layer with a colour fade. | fade overlay | Layer › Layer effects | Effects & masks › Shadows and glows · More list | Ready | 3 |  |
| layer.fx-pattern | Pattern overlay | Pattern overlay | Cover the layer with a pattern, built in or from part of your picture. | texture overlay | Layer › Layer effects | Effects & masks › Shadows and glows · More list | Ready | 3 |  |
| layer.fx-stroke | Outline | Stroke | Draw a coloured outline around the layer. | outline text, border | Layer › Layer effects | Effects & masks › Shadows and glows · live-preview gallery | Ready | 3 |  |
| layer.fill-color | Solid colour layer | Solid colour | A layer of one colour you can change at any time. | colour layer | Layer › Fill layer | Effects & masks › New · More list | Ready | 3 |  |
| layer.fill-gradient | Colour fade layer | Gradient fill | A colour fade you can change at any time. | gradient layer | Layer › Fill layer | Effects & masks › New · More list | Ready | 3 |  |
| layer.fill-pattern | Pattern layer | Pattern fill | A repeating pattern you can change at any time. | pattern layer | Layer › Fill layer | Effects & masks › New · More list | Ready | 3 |  |
| layer.adj-brightness | Brightness and contrast layer | Brightness/Contrast layer | Brightness and contrast that stay editable. | editable brightness | Layer › Adjustment layer | Effects & masks › Editable light and colour · live-preview gallery | Ready | 3 |  |
| layer.adj-levels | Light and dark balance layer | Levels layer | Levels that stay editable. | editable levels | Layer › Adjustment layer | Effects & masks › Editable light and colour · live-preview gallery | Ready | 3 |  |
| layer.adj-curves | Tone curve layer | Curves layer | Curves that stay editable. | editable curves | Layer › Adjustment layer | Effects & masks › Editable light and colour · live-preview gallery | Ready | 3 |  |
| layer.adj-exposure | Exposure layer | Exposure layer | Exposure that stays editable. | editable exposure | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-vibrance | Colour boost layer | Vibrance layer | Vibrance that stays editable. | editable vibrance | Layer › Adjustment layer | Effects & masks › Editable light and colour · live-preview gallery | Ready | 3 |  |
| layer.adj-hue | Colour and strength layer | Hue/Saturation layer | Hue and saturation that stay editable. | editable hue | Layer › Adjustment layer | Effects & masks › Editable light and colour · live-preview gallery | Ready | 3 |  |
| layer.adj-color-balance | Colour tint layer | Colour balance layer | Colour balance that stays editable. | editable colour balance | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-bw | Black and white layer | Black & white layer | Black and white that stays editable. | editable black and white | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-photo-filter | Lens filter layer | Photo filter layer | A photo filter that stays editable. | editable filter | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-channel-mixer | Channel mix layer | Channel mixer layer | A channel mix that stays editable. | editable channels | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-color-lookup | Colour look layer | Colour lookup layer | A colour look that stays editable. | editable lut | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Planned | 3 |  |
| layer.adj-invert | Negative layer | Invert layer | A negative that you can switch off. | editable invert | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-posterize | Fewer tones layer | Posterize layer | Posterize that stays editable. | editable posterize | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-threshold | Black and white split layer | Threshold layer | A threshold that stays editable. | editable threshold | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-gradient-map | Colour by brightness layer | Gradient map layer | A gradient map that stays editable. | editable gradient map | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.adj-selective-color | One colour family layer | Selective colour layer | Selective colour that stays editable. | editable selective colour | Layer › Adjustment layer | Effects & masks › Editable light and colour · More list | Ready | 3 |  |
| layer.mask-add | Hide parts with a mask | Add layer mask | Paint black to hide and white to show, without deleting pixels. | mask, hide part, non destructive | Layer › Mask | Effects & masks › Hide parts · big button | Ready | 2 |  |
| layer.mask-from-sel | Mask from the selection | Reveal selection | Show only the selected part of the layer. | mask selection | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.mask-apply | Make the mask permanent | Apply mask | Erase what the mask hides. | apply mask | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.mask-delete | Remove the mask | Delete mask | Throw the mask away and show the whole layer. | delete mask | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.mask-hide-all | Hide everything with a mask | Hide all | Hide the whole layer, then paint white where it should show. | mask, hide all, black mask | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.mask-hide-sel | Hide the selection | Hide selection | Hide the selected part of the layer with a mask; its pixels are kept. | mask, hide selection | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.mask-toggle | Switch the mask off | Disable layer mask | See the whole layer again without losing the mask; choose again to switch it back on. | mask on off, disable mask | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.mask-link | Link the mask to the layer | Link layer mask | Linked, the mask moves and turns with the layer; unlinked, they move apart. | link mask, chain | Layer › Mask | Effects & masks › Hide parts · More list | Ready | 2 |  |
| layer.vector-mask | Shape mask | Vector mask | Hide parts with a sharp-edged shape. | shape mask | Layer › Mask | Effects & masks › Hide parts · More list | Planned | 6 |  |
| layer.clip | Show only inside the layer below | Create clipping mask | Show this layer only where the layer below has pixels. | clip, picture inside text, clipping mask | Layer › Mask | Effects & masks › New · More list | Ready | 2 | Ctrl+Alt+G |
| layer.smart-convert | Make a smart layer | Convert to smart object | Keep the layer's original pixels safe from resizing. | smart object | Layer › Smart layer | Effects & masks › Live effects · More list | Planned | 3 |  |
| layer.smart-edit | Edit the contents | Edit contents | Open the original pixels to change them. | edit smart object | Layer › Smart layer | Effects & masks › Live effects · More list | Planned | 3 |  |
| layer.smart-replace | Replace the contents | Replace contents | Swap the contents for another picture. | mockup | Layer › Smart layer | Effects & masks › Live effects · More list | Planned | 3 |  |
| layer.smart-rasterize | Turn back into pixels | Rasterize smart object | Make the smart layer an ordinary layer. | rasterize | Layer › Smart layer | Effects & masks › Live effects · More list | Planned | 3 |  |
| layer.rasterize | Turn into plain pixels | Rasterize layer | Make text, shapes or effects into ordinary pixels. | flatten text | Layer | Arrange layers › This layer · More list | Ready | W3 |  |
| layer.front | Bring to the very top | Bring to front | Move the active layer above all others. | top layer | Layer › Arrange | Arrange layers › Order · small button | Ready | W1 | Ctrl+Shift+] |
| layer.forward | Bring up one | Bring forward | Move the active layer up one place. | move layer up | Layer › Arrange | Arrange layers › Order · small button | Ready | 1 | Ctrl+] |
| layer.backward | Send down one | Send backward | Move the active layer down one place. | move layer down | Layer › Arrange | Arrange layers › Order · small button | Ready | 1 | Ctrl+[ |
| layer.back | Send to the very bottom | Send to back | Move the active layer below all others. | bottom layer | Layer › Arrange | Arrange layers › Order · More list | Ready | W1 | Ctrl+Shift+[ |
| layer.align-left | Line up left edges | Align left edges | Move the layer so its left edge meets the selection's, or the picture's. | align left, line up left | Layer › Align | Arrange layers › Line up · small button | Ready | W3 |  |
| layer.align-hcenter | Line up centres across | Align horizontal centers | Centre the layer from side to side on the selection or the picture. | centre horizontally, center | Layer › Align | Arrange layers › Line up · small button | Ready | W3 |  |
| layer.align-right | Line up right edges | Align right edges | Move the layer so its right edge meets the selection's, or the picture's. | align right | Layer › Align | Arrange layers › Line up · small button | Ready | W3 |  |
| layer.align-top | Line up top edges | Align top edges | Move the layer so its top meets the selection's, or the picture's. | align top | Layer › Align | Arrange layers › Line up · More list | Ready | W3 |  |
| layer.align-vcenter | Line up middles | Align vertical centers | Centre the layer from top to bottom on the selection or the picture. | centre vertically, middle | Layer › Align | Arrange layers › Line up · More list | Ready | W3 |  |
| layer.align-bottom | Line up bottom edges | Align bottom edges | Move the layer so its bottom meets the selection's, or the picture's. | align bottom | Layer › Align | Arrange layers › Line up · More list | Ready | W3 |  |
| layer.distribute-h | Space out across | Distribute horizontal centers | Space three or more layers evenly from left to right. | space evenly, distribute | Layer › Align | Arrange layers › Line up · More list | Ready | W3 |  |
| layer.distribute-v | Space out down | Distribute vertical centers | Space three or more layers evenly from top to bottom. | space evenly vertically | Layer › Align | Arrange layers › Line up · More list | Ready | W3 |  |
| layer.lock | Lock the layer | Lock all | Protect the active layer from changes. | lock, protect, freeze | Layer | Arrange layers › This layer · small button | Ready | W1 | Ctrl+/ |
| layer.hide | Hide the layer | Hide layers | Hide the active layer without deleting it; choose again to show it. | hide, show, eye | Layer | Arrange layers › This layer · small button | Ready | W1 | Ctrl+, |
| layer.merge-down | Merge into the layer below | Merge down | Combine the active layer with the one under it. | combine layers, merge | Layer | Arrange layers › Combine · small button | Ready | W1 | Ctrl+E |
| layer.merge-visible | Merge the shown layers | Merge visible | Combine every shown layer into one. | combine visible | Layer | Arrange layers › Combine · small button | Ready | W1 | Ctrl+Shift+E |
| layer.flatten | Flatten into one layer | Flatten image | Combine all layers into one on white. | flatten, single layer | Layer | Arrange layers › Combine · small button | Ready | W1 |  |
| layer.defringe | Clean up edge colour | Defringe | Remove coloured halos around cut-outs. | halo, fringe | Layer | Select & cut out › Perfect and keep · More list | Ready | 2 |  |
| layer.frames | Make animation frames | Make frames from layers | Turn each layer into a frame of an animation. | gif animation, frames | Layer | Arrange layers › Animate · More list | Planned | 13 |  |

## Type (3 Ready, 7 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| type.add | Add text | Horizontal type | Click on the picture and type words. | text, words, caption, title, write, quote | Type | Shapes & text › Text · More list | Ready | W3 |  |
| type.add-vertical | Add up-down text | Vertical type | Text that runs from top to bottom. | vertical text | Type | Shapes & text › Text · More list | Planned | 6 |  |
| type.fonts | Choose a font | Font | Pick the typeface for your text. | font, typeface | Type | Shapes & text › Text · More list | Ready | W3 |  |
| type.warp | Bend text | Warp text | Arc, wave or bulge the text. | curved text, arc text, wavy text | Type | Shapes & text › Text · More list | Planned | 6 |  |
| type.path | Text along a line | Type on a path | Make text follow a curve or a circle. | text on circle | Type | Shapes & text › Text · More list | Planned | 6 |  |
| type.to-shape | Turn text into a shape | Convert to shape | Make the letters into editable shapes. | outline text | Type | Shapes & text › Text · More list | Planned | 6 |  |
| type.rasterize | Turn text into pixels | Rasterize type | Make text into ordinary pixels. | flatten text | Type | Shapes & text › Text · More list | Ready | W3 |  |
| type.smooth | Smooth text edges | Anti-aliasing | Choose how soft the edges of letters are. | jagged text | Type | Shapes & text › Text · More list | Planned | 6 |  |
| type.spell | Check spelling | Check spelling | Find spelling mistakes in your text. | spelling | Type | Shapes & text › Text · More list | Planned | 6 |  |
| type.find | Find and replace text | Find and replace | Change a word everywhere at once. | replace word | Type | Shapes & text › Text · More list | Planned | 6 |  |

## Select (19 Ready, 0 Planned)

Groups: Change the selection · Modify.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| select.all | Select everything | Select all | Select the whole picture. | everything, whole picture | Select | Select & cut out › Change it · small button | Ready | 1 | Ctrl+A |
| select.none | Select nothing | Deselect | Drop the selection, so changes apply everywhere. | deselect, clear selection, unselect | Select | Select & cut out › Change it · More list | Ready | 1 | Ctrl+D |
| select.reselect | Bring back the last selection | Reselect | Select again what you had selected before. | previous selection | Select | Select & cut out › Change it · More list | Ready | W1 | Ctrl+Shift+D |
| select.inverse | Swap selected and not selected | Inverse | Select everything except what is selected now. | invert selection, opposite, background | Select | Select & cut out › Change it · More list | Ready | W1 | Ctrl+Shift+I |
| select.subject | Select the main subject | Subject | Find the person or thing in front and select all of it, with AI on this device. | person, subject, auto select, select person, select object automatically | Select | Select & cut out › Select with AI · big button | Ready | 11 |  |
| select.color-range | Select by colour | Colour range | Select every pixel close to a colour, like the sky. | select sky, select colour | Select | Select & cut out › By colour or light · small button | Ready | W3 |  |
| select.focus | Select the sharp parts | Focus area | Select what is in focus and leave the blurry parts. | in focus | Select | Select & cut out › Select with AI · small button | Ready | 11 |  |
| select.refine | Smooth the selection edge | Refine edge | Tidy up hair and soft edges of a selection: the edge follows the picture, then smooth, soften or move it. | hair, fur, edge | Select | Select & cut out › Perfect and keep · big button | Ready | 2 |  |
| select.border | Edge band | Border | Select a band along the selection edge. | border selection | Select › Modify | Select & cut out › Change it · More list | Ready | W3 |  |
| select.smooth | Round off | Smooth | Round off sharp corners of the selection. | smooth selection | Select › Modify | Select & cut out › Change it · More list | Ready | W3 |  |
| select.expand | Grow by pixels | Expand | Make the selection bigger by a number of pixels. | bigger selection | Select › Modify | Select & cut out › Change it · More list | Ready | W3 |  |
| select.contract | Shrink by pixels | Contract | Make the selection smaller by a number of pixels. | smaller selection | Select › Modify | Select & cut out › Change it · More list | Ready | W3 |  |
| select.feather | Soften the edge | Feather | Make the selection fade out gently at its edge. | soft edge, feather | Select › Modify | Select & cut out › Change it · More list | Ready | W3 | Shift+F6 |
| select.grow | Grow into similar colours | Grow | Add nearby pixels of similar colour. | grow | Select | Select & cut out › Change it · More list | Ready | W3 |  |
| select.similar | Select similar colours everywhere | Similar | Add every pixel in the picture of a similar colour. | similar | Select | Select & cut out › By colour or light · More list | Ready | W3 |  |
| select.transform | Resize the selection | Transform selection | Change the size and angle of the selection. | resize selection | Select | Select & cut out › Change it · More list | Ready | W3 |  |
| select.quick-mask | Paint a selection | Quick mask | Paint where to select, then switch back to a selection. | paint selection | Select | Select & cut out › Perfect and keep · small button | Ready | W3 | Q |
| select.save | Save the selection | Save selection | Keep the selection to use again later. | store selection | Select | Select & cut out › Perfect and keep · More list | Ready | W3 |  |
| select.load | Load a saved selection | Load selection | Bring back a saved selection. | load selection | Select | Select & cut out › Perfect and keep · More list | Ready | W3 |  |

## Filter (64 Ready, 5 Planned)

Groups: Blur · Blur; Camera blurs · Blur gallery; Bend and twist · Distort; Grain · Noise; Blocks and dots · Pixelate; Make patterns · Render; Sharpen · Sharpen; Graphic effects · Stylize; More effects · Other.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| filter.last | Repeat the last effect | Last filter | Run the last effect again with the same settings. | again, repeat effect | Filter | Filters & blur › Again · big button | Ready | W1 | Ctrl+Alt+F |
| filter.gallery | Artistic effects | Filter gallery | Try painterly effects with a big preview. | painting effect, sketch | Filter | Filters & blur › Artistic · family sheet | Planned | W2 |  |
| filter.lens | Fix lens problems | Lens correction | Straighten bulging lines and lighten dark corners. | distortion, vignette, fisheye | Filter | Develop RAW › Detail and lens · More list | Ready | W2 |  |
| filter.raw | Develop a photo | Raw develop | Every photo control in one place, as for camera RAW files. | raw, develop, camera raw | Filter | Develop RAW › Develop · More list | Planned | 5 |  |
| filter.liquify | Push pixels like liquid | Liquify | Gently push, bloat or pinch parts of the picture. | reshape, slim, liquify | Filter | Crop & resize › Bend and push · More list | Planned | 5 |  |
| filter.perspective-plane | Paint in perspective | Perspective plane | Copy and paint along walls and floors in perspective. | vanishing point | Filter | Retouch & remove › Repair · More list | Planned | 5 |  |
| filter.blur-gaussian | Smooth blur | Gaussian blur | An even, soft blur over the selected area or the whole layer. | blur, soften, smooth, out of focus, blurry | Filter › Blur | Filters & blur › Blur · family sheet | Ready | 1 |  |
| filter.blur-box | Box blur | Box blur | A blur that averages square blocks. | box blur | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-motion | Movement blur | Motion blur | Streak the picture as if it moved. | speed, motion | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-radial | Spin or zoom blur | Radial blur | Blur in circles or toward a centre. | zoom blur, spin | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-surface | Skin smoothing blur | Surface blur | Smooth flat areas and keep edges sharp. | smooth skin, airbrush | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-lens | Camera lens blur | Lens blur | A blur that looks like a real camera lens. | bokeh | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-average | Average colour | Average | Fill the area with its average colour. | average | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-smart | Edge-aware blur | Smart blur | Blur everything except sharp edges. | smart blur | Filter › Blur | Filters & blur › Blur · family sheet | Ready | W2 |  |
| filter.blur-field | Gradual blur | Field blur | Blur that changes smoothly across the picture. | gradual blur | Filter › Camera blurs | Filters & blur › Camera blurs · family sheet | Ready | W2 |  |
| filter.blur-iris | Blur around a spot | Iris blur | Keep one spot sharp and blur everything around it. | blur the background, background blur, portrait mode, bokeh | Filter › Camera blurs | Filters & blur › Camera blurs · family sheet | Ready | W2 |  |
| filter.blur-tilt | Miniature effect | Tilt-shift | Keep a band sharp so the scene looks like a model. | miniature, tilt shift | Filter › Camera blurs | Filters & blur › Camera blurs · family sheet | Ready | W2 |  |
| filter.blur-path | Blur along a path | Path blur | Blur along a line you draw. | path blur | Filter › Camera blurs | Filters & blur › Camera blurs · family sheet | Planned | W2 |  |
| filter.blur-spin | Spinning blur | Spin blur | Make wheels and fans look like they spin. | wheels | Filter › Camera blurs | Filters & blur › Camera blurs · family sheet | Ready | W2 |  |
| filter.displace | Push by a map | Displace | Push pixels around by a pattern of light and dark, such as soft clouds. | displacement, warp, distort | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.pinch | Pinch | Pinch | Squeeze the middle inwards or outwards. | pinch | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.polar | Wrap into a circle | Polar coordinates | Wrap the picture into a circle or unwrap it. | tiny planet | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.ripple | Ripples | Ripple | Add ripples like water. | water ripple | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.shear | Bend sideways | Shear | Bend the picture along a curve. | shear | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.spherize | Bulge | Spherize | Bulge the picture like a ball. | bulge, fisheye | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.twirl | Swirl | Twirl | Swirl the middle round. | swirl | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.wave | Waves | Wave | Bend the picture in waves. | wavy | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.zigzag | Rings in water | Zigzag | Ripple outwards like a stone in a pond. | pond ripple | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.glass | Behind glass | Glass | Look through textured glass. | frosted glass | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.ocean-ripple | Under water | Ocean ripple | Look through rippling water. | underwater | Filter › Distort | Filters & blur › Bend and twist · family sheet | Ready | W2 |  |
| filter.add-noise | Add grain | Add noise | Add film-like grain. | grain, film grain | Filter › Noise | Filters & blur › Grain and specks · family sheet | Ready | W2 |  |
| filter.despeckle | Remove specks | Despeckle | Remove tiny specks and keep edges. | specks | Filter › Noise | Filters & blur › Grain and specks · family sheet | Ready | W2 |  |
| filter.dust | Remove dust and scratches | Dust and scratches | Hide small dust spots and scratches. | dust, scratches, old photo | Filter › Noise | Filters & blur › Grain and specks · family sheet | Ready | W2 |  |
| filter.median | Smooth out specks | Median | Replace each pixel with the middle value nearby. | median | Filter › Noise | Filters & blur › Grain and specks · family sheet | Ready | W2 |  |
| filter.reduce-noise | Reduce grain | Reduce noise | Smooth away camera grain from dark photos. | denoise, grainy photo | Filter › Noise | Filters & blur › Grain and specks · family sheet | Ready | W2 |  |
| filter.halftone | Print dots | Colour halftone | Make the picture out of printing dots. | comic dots | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.crystallize | Crystals | Crystallize | Break the picture into crystal shapes. | crystals | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.facet | Painted look | Facet | Group similar pixels into flat patches. | facet | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.fragment | Shaky copies | Fragment | Overlay four shifted copies. | shaky | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.mezzotint | Engraved dots | Mezzotint | Turn tones into random dots and lines. | engraving | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.mosaic | Blocks | Mosaic | Turn the picture into big square blocks. | pixelate, censor, hide face | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.pointillize | Painted dots | Pointillize | Paint the picture with coloured dots. | dots | Filter › Pixelate | Filters & blur › Blocks and dots · family sheet | Ready | W2 |  |
| filter.clouds | Clouds | Clouds | Fill with soft clouds in your two colours. | sky texture | Filter › Render | Filters & blur › Patterns and light · family sheet | Ready | W2 |  |
| filter.difference-clouds | Marbled clouds | Difference clouds | Blend clouds into the picture for a marbled look. | marble | Filter › Render | Filters & blur › Patterns and light · family sheet | Ready | W2 |  |
| filter.fibers | Fibres | Fibers | Draw a woven fibre texture. | fabric | Filter › Render | Filters & blur › Patterns and light · family sheet | Ready | W2 |  |
| filter.lens-flare | Light flare | Lens flare | Add a bright camera flare. | sun flare | Filter › Render | Filters & blur › Patterns and light · family sheet | Ready | W2 |  |
| filter.lighting | Spotlights | Lighting effects | Light the picture with spotlights. | spotlight | Filter › Render | Filters & blur › Patterns and light · family sheet | Ready | W2 |  |
| filter.sharpen | Sharpen a little | Sharpen | Make edges a little crisper, with a preview before you apply. | crisp, sharp, blurry photo, focus | Filter › Sharpen | Filters & blur › Sharpen · family sheet | Ready | W1 |  |
| filter.sharpen-more | Sharpen more | Sharpen more | Make edges clearly crisper, with a preview before you apply. | sharper | Filter › Sharpen | Filters & blur › Sharpen · family sheet | Ready | W1 |  |
| filter.unsharp | Sharpen with control | Unsharp mask | Choose how strong and how wide the sharpening is. | sharpen detail, crisp | Filter › Sharpen | Filters & blur › Sharpen · family sheet | Ready | 1 |  |
| filter.sharpen-edges | Sharpen only the edges | Sharpen edges | Sharpen edges and leave smooth areas alone. | edges | Filter › Sharpen | Filters & blur › Sharpen · family sheet | Ready | W2 |  |
| filter.smart-sharpen | Smart sharpen | Smart sharpen | Sharpen with less halo and noise. | smart sharpen | Filter › Sharpen | Filters & blur › Sharpen · family sheet | Ready | W2 |  |
| filter.diffuse | Scatter | Diffuse | Scatter the pixels for a frosted look. | scatter | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.emboss | Stamped metal | Emboss | Make the picture look pressed into metal. | emboss | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.extrude | 3D blocks | Extrude | Push the picture out into 3D blocks. | blocks | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.find-edges | Outline drawing | Find edges | Keep only the outlines, like a sketch. | sketch, outline, line drawing | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.oil-paint | Oil painting | Oil paint | Make the picture look painted with oils. | painting, oil | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.solarize | Half negative | Solarize | Mix the picture with its negative. | solarize | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.tiles | Tiles | Tiles | Break the picture into tiles. | tiles | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.trace-contour | Contour lines | Trace contour | Draw lines along areas of the same brightness. | contour | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.wind | Wind streaks | Wind | Blow streaks across the picture. | wind | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.glowing-edges | Glowing outlines | Glowing edges | Turn the outlines into bright, neon-like lines on black. | neon, glow, glowing lines, neon outline | Filter › Stylize | Filters & blur › Graphic looks · family sheet | Ready | W2 |  |
| filter.high-pass | Keep only the detail | High pass | Grey picture of just the edges, used for sharpening. | high pass | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |
| filter.maximum | Grow light areas | Maximum | Spread the light areas outwards. | maximum | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |
| filter.minimum | Grow dark areas | Minimum | Spread the dark areas outwards. | minimum | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |
| filter.offset | Shift and wrap | Offset | Slide the picture and wrap it round the edges. | seamless tile | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |
| filter.custom | Your own filter | Custom | Type in your own blur or sharpen numbers. | kernel | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |
| filter.color-to-alpha | Make a colour see-through | Colour to alpha | Turn one colour transparent, like a white background. | remove white, transparent | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |
| filter.dither | Dither | Dither | Fake extra colours with patterns of dots. | dither | Filter › Other | Filters & blur › More effects · family sheet | Ready | W2 |  |

## View (17 Ready, 1 Planned)

Groups: Screen mode · Screen mode.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| view.zoom-in | Zoom in | Zoom in | Look closer. | bigger view, magnify | View | View sheet | Ready | 1 | Ctrl+= |
| view.zoom-out | Zoom out | Zoom out | See more of the picture. | smaller view | View | View sheet | Ready | 1 | Ctrl+- |
| view.fit | Fit on screen | Fit on screen | Show the whole picture as large as fits. | whole picture, fit | View | View sheet | Ready | 1 | Ctrl+0 |
| view.actual | Actual pixels | 100% | One picture pixel per screen pixel. | real size, 100 | View | View sheet | Ready | 1 | Ctrl+1 |
| view.zoom-200 | Double size | 200% | Two screen pixels per picture pixel. | 200 | View | View sheet | Ready | W1 |  |
| view.print-size | Print size | Print size | Show the picture at the size it would print. | print preview | View | View sheet | Ready | 8 |  |
| view.screen-standard | Normal workspace | Standard screen mode | Show the menus, tools and panels. | normal view | View › Screen mode | View sheet | Ready | W1 |  |
| view.screen-focus | Picture only | Full screen mode | Hide the tools and panels to see just the picture. Press F or Esc to come back. | full screen, distraction free | View › Screen mode | View sheet | Ready | W1 |  |
| view.screen-cycle | Switch screen mode | Cycle screen mode | Switch between the normal workspace and picture only. | toggle full screen | View › Screen mode | View sheet | Ready | W1 | F |
| view.rulers | Rulers | Rulers | Show measuring rulers along the edges of the picture. | measure, ruler | View | View sheet | Ready | W1 | Ctrl+R |
| view.grid | Grid | Grid | Show a grid over the picture to line things up. | grid, align, straight lines | View | View sheet | Ready | W1 | Ctrl+' |
| view.extras | Selection outline | Extras | Show or hide the moving dashes around a selection. | marching ants | View | View sheet | Ready | W1 | Ctrl+H |
| view.pixel-grid | Pixel grid | Pixel grid | Show the edge of each pixel when zoomed in to 800% or more. | pixel grid | View | View sheet | Ready | W2 |  |
| view.guide-new | Add a guide line | New guide | Add a straight line to line things up against: down the middle first, then across. Drag it with Move, or off the picture to remove it. | guide | View | View sheet | Ready | 13 |  |
| view.guide-clear | Remove guide lines | Clear guides | Remove all guide lines. | clear guides | View | View sheet | Ready | 13 |  |
| view.guide-lock | Lock guide lines | Lock guides | Stop guide lines from moving. | lock guides | View | View sheet | Ready | 13 |  |
| view.snap | Snap to guides | Snap | Make guides, oval selections, measures, shapes and colour fades jump to guide lines and the picture's edges and middle. | snap | View | View sheet | Ready | 13 |  |
| view.slices-clear | Remove slices | Clear slices | Remove the web slices. | slices | View | View sheet | Planned | 13 |  |

## Window (2 Ready, 0 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| window.reset | Reset the workspace | Reset workspace | Put every panel back where it started. | default layout | Window | View sheet | Ready | W1 |  |
| window.collapse | Fold away all panels | Collapse panels | Fold every panel group down to its title. | tidy panels | Window | View sheet | Ready | W1 |  |

## Help (6 Ready, 1 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| help.start | What do you want to do? | Start screen | Pick a job and the editor opens the right tool for you. | start, how to, beginner, help me | Help | Help sheet | Ready | W1 |  |
| help.search | Search for a command | Search | Type what you want, like "make it brighter". | find, search, command | Help | Help sheet | Ready | W1 | Ctrl+K |
| help.shortcuts | Keyboard shortcuts | Keyboard shortcuts | Every shortcut key in one list. | keys, hotkeys | Help | Help sheet | Ready | 1 |  |
| help.guided | Guided jobs | Guided jobs | Step-by-step help on the real controls. | tutorial, learn, lesson | Help | Help sheet | Planned | W4 |  |
| help.about | About Free Photo Editor | About | Version, licence and the people behind it. | about, licence, credits | Help | Help sheet | Ready | 1 |  |
| help.source | Source code | Source code | Open this editor's code on GitHub. | github, open source | Help | Help sheet | Ready | 1 |  |
| help.report | Report a problem | Report a bug | Tell the maker what went wrong. | bug, issue, feedback | Help | Help sheet | Ready | W1 |  |

## Panels (Window menu and the dock) (14 Ready, 8 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| panel.layers | Layers | Layers | The stack of sheets your picture is made of; upper sheets cover lower ones. | layers, stack, sheets | Window | Arrange layers › This layer · More list | Ready | 1 | F7 |
| panel.history | History | History | Every step you took; pick one to go back to it. | steps, undo list | Window | Always on screen › History | Ready | W1 |  |
| panel.properties | Properties | Properties | Name, position, size, opacity and blend of the active layer. | settings, details | Window | Always on screen › Properties | Ready | W1 |  |
| panel.adjustments | Light and colour | Adjustments | Every light and colour fix, one tap away. | fixes, adjustments | Window | Light & colour › Light and colour · More list | Ready | W1 |  |
| panel.color | Colour | Colour | Pick your main and second colours. | colour picker, choose colour | Window | Paint & draw › Colour · small button | Ready | W1 | F6 |
| panel.swatches | Swatches | Swatches | Ready-made colours to pick with one tap. | palette, colours | Window | Paint & draw › Colour · small button | Ready | W1 |  |
| panel.navigator | Navigator | Navigator | A small view of the whole picture; drag the box to move around. | overview, minimap | Window | View sheet | Ready | W1 |  |
| panel.info | Info | Info | Position and colour under the pointer, and the picture's size. | coordinates, rgb values, pixel colour | Window | View sheet | Ready | W1 | F8 |
| panel.channels | Colour channels | Channels | See the red, green, blue and see-through channels one by one. | channels | Window | View sheet | Planned | 2 |  |
| panel.paths | Outlines | Paths | Outlines you drew with the pen: pick, rename, delete, or turn one into a selection. | paths, outlines, saved path, work path | Window | Shapes & text › Draw outlines · small button | Ready | 6 |  |
| panel.character | Text style | Character | Font, size and spacing of text. | font size | Window | Shapes & text › Text style · More list | Ready | W3 |  |
| panel.paragraph | Paragraph | Paragraph | Line-up and spacing of text blocks. | align text | Window | Shapes & text › Text style · More list | Ready | W3 |  |
| panel.brushes | Brush tips | Brushes | Choose and shape brush tips. | brush shapes | Window | Paint & draw › Brush settings · More list | Planned | 4 |  |
| panel.histogram | Tone graph | Histogram | A graph of how many dark and light pixels there are. | histogram | Window | Develop RAW › Check · small button | Ready | W2 |  |
| panel.actions | Recorded steps | Actions | Record steps and play them back. | macro, record | Window | Automate & batch › Record steps · big button | Ready | 13 |  |
| panel.styles | Saved looks | Styles | Save a layer's effects as a named look and put it on other layers; a few ready-made looks to start. | styles, saved effects | Window | Effects & masks › Shadows and glows · More list | Ready | 3 |  |
| panel.tool-presets | Saved tool settings | Tool presets | Tool settings you saved to use again. | presets | Window | Paint & draw › Brush settings · More list | Planned | 4 |  |
| panel.glyphs | Special characters | Glyphs | Symbols and letters not on your keyboard. | symbols | Window | Shapes & text › Text style · More list | Planned | 6 |  |
| panel.notes | Notes | Notes | Notes you pinned on the picture. | notes | Window | View sheet | Planned | 13 |  |
| panel.timeline | Animation timeline | Timeline | Frames of an animation in order. | animation | Window | Arrange layers › Animate · More list | Planned | 13 |  |
| panel.layer-comps | Saved layer setups | Layer comps | Remember which layers were shown, to switch between versions. | versions | Window | Arrange layers › Find and versions · More list | Planned | 13 |  |
| panel.vector-info | Shape measurements | Vector info | Exact sizes of shapes and paths. | shape size | Window | Shapes & text › Draw outlines · More list | Planned | 6 |  |

## Tools (52 Ready, 13 Planned)

Groups: Move · Move; Select a box · Marquee; Draw a selection · Lasso; Smart select · Quick selection; Crop · Crop; Pick and measure · Eyedropper; Fix spots · Healing; Paint · Brush; Copy an area · Clone stamp; Paint back · History brush; Erase · Eraser; Fill · Gradient; Soften and smudge · Blur tool; Lighten and darken · Dodge; Pen · Pen; Text · Type; Pick outlines · Path selection; Shapes · Shape; Move around · Hand; Zoom · Zoom; Colours · Colours.

| id | Plain name | Pro name | What it does | Wish words | Place | Lives in | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|---|
| tool.move | Move | Move tool | Drag to move the active layer. Arrow keys nudge it by one pixel. | move, drag, position | Tools › Move | Crop & resize › Move and reshape a layer · big button | Ready | 1 | V |
| tool.artboard | Artboards | Artboard tool | Design several canvases side by side. | artboard | Tools › Move | Crop & resize › Size · More list | Planned | 13 |  |
| tool.select-rect | Select a box | Rectangular marquee | Drag to select a rectangle; hold Shift for a square. | select area, rectangle, box | Tools › Select box | Select & cut out › Draw or paint · big button | Ready | 1 | M |
| tool.select-ellipse | Select an oval | Elliptical marquee | Drag to select an oval; hold Shift while dragging for a circle. | circle selection | Tools › Select box | Select & cut out › Draw or paint · More list | Ready | 2 |  |
| tool.select-row | Select one row | Single row marquee | Select a line of pixels one pixel tall. | row | Tools › Select box | Select & cut out › Draw or paint · More list | Ready | 2 |  |
| tool.select-column | Select one column | Single column marquee | Select a line of pixels one pixel wide. | column | Tools › Select box | Select & cut out › Draw or paint · More list | Ready | 2 |  |
| tool.lasso | Draw around it | Lasso | Draw freely around what you want to select. | freehand selection | Tools › Lasso | Select & cut out › Draw or paint · small button | Ready | W3 | L |
| tool.lasso-poly | Click around it | Polygonal lasso | Click from corner to corner in straight lines. | straight lines selection | Tools › Lasso | Select & cut out › Draw or paint · More list | Ready | W3 |  |
| tool.lasso-magnetic | Snap to edges | Magnetic lasso | Trace near an edge and the outline sticks to it. | edge selection | Tools › Lasso | Select & cut out › Draw or paint · More list | Planned | 2 |  |
| tool.quick-select | Paint to select | Quick selection | Paint over an area and the selection grows to its edges. | quick selection | Tools › Smart select | Select & cut out › Draw or paint · small button | Ready | W3 |  |
| tool.object-select | Select an object | Object selection | Tap a thing, or drag a box round it, and it becomes the selection; Shift adds, Alt takes away. | object, tap to select, click to select, select a thing, select an object | Tools › Smart select | Select & cut out › Select with AI · small button | Ready | 11 |  |
| tool.magic-wand | Select similar colour | Magic wand | Click a colour to select the area of similar colour. | magic wand, same colour | Tools › Smart select | Select & cut out › Draw or paint · small button | Ready | W3 | W |
| tool.crop | Crop | Crop tool | Drag to choose the part to keep, then apply. Ratios make square or story crops. | crop, cut, trim, square, instagram | Tools › Crop | Crop & resize › Crop · big button | Ready | 1 | C |
| tool.crop-perspective | Crop and straighten | Perspective crop | Crop a slanted surface so it looks straight on. | straighten document | Tools › Crop | Crop & resize › Crop · More list | Planned | 3 |  |
| tool.slice | Cut into web pieces | Slice | Cut the picture into pieces for a web page. | slice | Tools › Crop | Automate & batch › Sheets and layouts · More list | Planned | 13 |  |
| tool.eyedropper | Pick a colour | Eyedropper | Click the picture to use that colour for painting. | colour picker, sample colour | Tools › Measure | Paint & draw › Colour · small button | Ready | 1 | I |
| tool.color-sampler | Colour markers | Colour sampler | Pin up to four points that show their colour values. | colour values | Tools › Measure | Paint & draw › Colour · More list | Ready | 13 |  |
| tool.ruler | Measure | Ruler | Measure a distance and an angle. | measure, angle | Tools › Measure | View sheet | Ready | 13 |  |
| tool.note | Sticky note | Note | Pin a written note on the picture. Notes stay while the picture is open; they are not saved into exported files. | comment | Tools › Measure | View sheet | Ready | 13 |  |
| tool.spot-heal | Remove spots | Spot healing brush | Paint over a spot and it blends into its surroundings. | blemish, pimple, dust spot, remove spot | Tools › Retouch | Retouch & remove › Repair · small button | Ready | W3 | J |
| tool.remove | Remove an object | Remove tool | Paint over something and let go: it disappears and AI fills the gap. | remove object, erase object, remove person, remove people, delete object, clean up photo, remove wires, remove text | Tools › Retouch | Retouch & remove › Remove · big button | Ready | 11 |  |
| tool.heal | Heal from a source | Healing brush | Alt-click a clean area, then paint to heal with it. | heal | Tools › Retouch | Retouch & remove › Repair · small button | Ready | W3 |  |
| tool.patch | Patch an area | Patch | Draw around a flaw and drag it to a clean area. | patch | Tools › Retouch | Retouch & remove › Repair · small button | Ready | W3 |  |
| tool.smart-move | Move and fill the gap | Content-aware move | Move something and fill the hole it leaves. | move object | Tools › Retouch | Retouch & remove › Remove · More list | Planned | 11 |  |
| tool.red-eye | Fix red eyes | Red eye | Click a red eye to make it dark again. | red eye, flash eyes | Tools › Retouch | Retouch & remove › Repair · More list | Ready | W3 |  |
| tool.brush | Paint brush | Brush | Paint with soft or hard edges; pens set the size by pressure. | paint, draw, brush, colour in | Tools › Paint | Paint & draw › Paint and erase · big button | Ready | 1 | B |
| tool.pencil | Pencil | Pencil | Hard-edged lines, good for pixel art. | pixel art, hard line, sketch | Tools › Paint | Paint & draw › Paint and erase · small button | Ready | W1 |  |
| tool.color-replace | Recolour by painting | Colour replacement | Paint to change a colour and keep the detail. | recolour | Tools › Paint | Paint & draw › Paint and erase · small button | Ready | W3 |  |
| tool.mixer | Blend paint | Mixer brush | Paint that mixes with the colours already there. | wet paint | Tools › Paint | Paint & draw › Paint and erase · More list | Planned | 4 |  |
| tool.clone | Copy an area | Clone stamp | Alt-click a source, then paint to copy it somewhere else. | clone, copy area, duplicate object | Tools › Clone | Retouch & remove › Repair · More list | Ready | W3 | S |
| tool.pattern-stamp | Paint a pattern | Pattern stamp | Paint with a repeating pattern. | pattern brush | Tools › Clone | Paint & draw › Fill · More list | Planned | 4 |  |
| tool.history-brush | Paint back an earlier step | History brush | Paint to bring back how part of the picture looked at an earlier step: the one marked with the brush in History, at first as opened. | undo part, paint back, restore part | Tools › History brush | Paint & draw › Paint back · small button | Ready | W3 | Y |
| tool.art-history | Painterly strokes | Art history brush | Paint quick artistic strokes from an earlier step. | art brush | Tools › History brush | Paint & draw › Paint back · More list | Planned | 4 |  |
| tool.eraser | Eraser | Eraser | Rub out pixels so they become see-through. | erase, rub out | Tools › Erase | Paint & draw › Paint and erase · small button | Ready | 1 | E |
| tool.bg-eraser | Erase a background | Background eraser | Erase the colour under the brush's centre and keep the edges. | erase background | Tools › Erase | Paint & draw › Paint and erase · More list | Ready | W3 |  |
| tool.magic-eraser | Erase similar colour | Magic eraser | Click a colour to erase the area of similar colour. | remove white background | Tools › Erase | Paint & draw › Paint and erase · More list | Ready | W3 |  |
| tool.gradient | Colour fade | Gradient | Drag to fill with a smooth fade between colours. | fade, gradient, ombre | Tools › Fill | Paint & draw › Fill · small button | Ready | W3 | G |
| tool.bucket | Fill an area | Paint bucket | Click to fill an area of similar colour. | fill, bucket | Tools › Fill | Paint & draw › Fill · small button | Ready | W3 |  |
| tool.blur | Soften by painting | Blur tool | Paint to soften just where you want. | soften part | Tools › Soften | Retouch & remove › Touch up by painting · More list | Ready | W3 |  |
| tool.sharpen | Sharpen by painting | Sharpen tool | Paint to sharpen just where you want. | sharpen part | Tools › Soften | Retouch & remove › Touch up by painting · More list | Ready | W3 |  |
| tool.smudge | Smudge | Smudge | Push the colours around like wet paint. | smear | Tools › Soften | Retouch & remove › Touch up by painting · More list | Ready | W3 |  |
| tool.dodge | Lighten by painting | Dodge | Paint to lighten just where you want. | lighten part, brighten eyes | Tools › Light | Retouch & remove › Touch up by painting · small button | Ready | W3 | O |
| tool.burn | Darken by painting | Burn | Paint to darken just where you want. | darken part | Tools › Light | Retouch & remove › Touch up by painting · small button | Ready | W3 |  |
| tool.sponge | Colour strength by painting | Sponge | Paint to make colours stronger or weaker. | saturate part | Tools › Light | Retouch & remove › Touch up by painting · small button | Ready | W3 |  |
| tool.pen | Draw curves | Pen | Click for corners, drag for smooth curves; click the first point to close the outline. | bezier, outline, curve, draw path, trace | Tools › Pen | Shapes & text › Draw outlines · big button | Ready | 6 | P |
| tool.pen-free | Draw outlines freely | Freeform pen | Draw an outline freely like a pencil. | freeform | Tools › Pen | Shapes & text › Draw outlines · More list | Planned | 6 |  |
| tool.anchor-add | Add a point | Add anchor point | Press on an outline's line to add a point there without changing its shape. | add point | Tools › Pen | Shapes & text › Draw outlines · More list | Ready | 6 |  |
| tool.anchor-delete | Remove a point | Delete anchor point | Press a point of an outline to remove it. | remove point | Tools › Pen | Shapes & text › Draw outlines · More list | Ready | 6 |  |
| tool.anchor-convert | Change a corner | Convert point | Switch a point between sharp and smooth, or drag a handle to move it alone. | corner, smooth point, sharp point | Tools › Pen | Shapes & text › Draw outlines · More list | Ready | 6 |  |
| tool.type | Text | Horizontal type | Click and type words on the picture. | text, words, caption | Tools › Text | Shapes & text › Text · big button | Ready | W3 | T |
| tool.type-vertical | Up-down text | Vertical type | Type words from top to bottom. | vertical text | Tools › Text | Shapes & text › Text · More list | Planned | 6 |  |
| tool.type-mask | Text-shaped selection | Type mask | Type words to select their shape. | text selection | Tools › Text | Shapes & text › Text · More list | Planned | 6 |  |
| tool.path-select | Pick a whole outline | Path selection | Press an outline to pick it, then drag to move all of it. | select path, move outline | Tools › Path select | Shapes & text › Draw outlines · small button | Ready | 6 | A |
| tool.direct-select | Pick outline points | Direct selection | Drag one point or handle of an outline to reshape it. | edit points, move point, reshape outline | Tools › Path select | Shapes & text › Draw outlines · small button | Ready | 6 |  |
| tool.rect | Rectangle | Rectangle | Drag to draw a rectangle. | box, square shape | Tools › Shapes | Shapes & text › Shapes · small button | Ready | W3 | U |
| tool.rounded-rect | Rounded rectangle | Rounded rectangle | Drag to draw a box with round corners; set how round in the options bar. | rounded box, button shape, pill | Tools › Shapes | Shapes & text › Shapes · small button | Ready | W3 |  |
| tool.ellipse | Circle or oval | Ellipse | Drag to draw an oval; hold Shift for a circle. | circle shape | Tools › Shapes | Shapes & text › Shapes · small button | Ready | W3 |  |
| tool.polygon | Polygon | Polygon | Draw a shape with straight sides, like a star. | star, triangle | Tools › Shapes | Shapes & text › Shapes · More list | Ready | W3 |  |
| tool.line | Line | Line | Drag to draw a straight line or arrow. | arrow, straight line | Tools › Shapes | Shapes & text › Shapes · More list | Ready | W3 |  |
| tool.custom-shape | Ready-made shapes | Custom shape | Draw hearts, arrows, speech bubbles and more. | heart, speech bubble | Tools › Shapes | Shapes & text › Shapes · More list | Planned | 6 |  |
| tool.hand | Move the view | Hand | Drag to move around the picture; hold Space with any tool. | pan, scroll around | Tools › Hand | View sheet | Ready | W1 | H |
| tool.rotate-view | Turn the view | Rotate view | Turn the view to paint at a comfortable angle. | turn canvas | Tools › Hand | View sheet | Planned | 13 | R |
| tool.zoom | Zoom | Zoom tool | Click to zoom in; Alt-click to zoom out. | magnify, zoom | Tools › Zoom | View sheet | Ready | W1 | Z |
| tool.swap-colors | Swap the two colours | Switch colours | Swap your main and second colours. | swap colours | Tools › Colours | Paint & draw › Colour · More list | Ready | W1 | X |
| tool.default-colors | Black and white | Default colours | Reset to a black main colour and a white second colour. | reset colours | Tools › Colours | Paint & draw › Colour · More list | Ready | W1 | D |

## New functions from the feature census (176 Planned, 85 Ready), by home

Not in the menu bar. Search finds them by plain name, pro name or wish words, and shows a Planned one with its tag.

### Effects & masks (18)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| layer.smart-filters | U001 | Effects you can reopen and edit | Smart filters (live filters) | Put any effect on a layer so it stays editable, can be masked and switched off, and never changes the pixels. | live filter, editable filter, non-destructive filter, reopen effect, change filter later | Effects & masks › Live effects · More list | Planned | B1 |
| layer.transform-mask | U006 | Move or turn a layer without touching pixels | Transform Mask | A mask that moves, rotates, scales or skews a layer non-destructively and can be keyframed. | transform mask, move layer without changing pixels, keyframe move | Effects & masks › Hide parts · More list | Planned | B9 |
| layer.live-masks | U007 | Mask that is itself a live effect | Live layer masks / compound layer masks | Masks built from several parts or from a live filter, kept editable. | live mask, compound mask, combine masks, mask from filter | Effects & masks › Hide parts · More list | Planned | B9 |
| layer.mask-edge | U008 | Mask edge and density | Mask refinement (feather, density) | Blur, feather, guided-filter and contrast the mask edge. | mask edge, feather mask, soften mask, mask density | Effects & masks › Hide parts · More list | Planned | B9 |
| layer.smart-linked | U009 | Keep an image linked to a file on disk | Linked Smart Object | A layer that points to an external file and updates when it changes. | linked file, link image, place linked, update from file | Effects & masks › Live effects · More list | Planned | B1 |
| layer.clone | U010 | Linked copy of a layer | Clone Layer | A layer that always mirrors another and updates when it changes. | clone layer, mirror layer, linked copy, instance | Effects & masks › Live effects · More list | Planned | B1 |
| layer.blend-if | U011 | Show by brightness | Blend If (blend ranges) | Let a layer show only where it, or the layer below, is light or dark, with soft fades between. | blend if, blend ranges, show only in shadows, show only in highlights | Effects & masks › Blending · More list | Ready | B9 |
| layer.fill-opacity | U012 | Opacity for fill and effects separately | Fill opacity vs layer opacity | Fade a layer's pixels but keep its effects. | fill opacity, fade pixels keep effects, inner opacity | Effects & masks › Blending · More list | Planned | B9 |
| layer.adj-presets | U013 | Save adjustment looks as layer presets | Adjustment presets | One-click saved settings for Curves, Levels and others. | adjustment preset, save look, reuse adjustment, preset | Effects & masks › Shadows and glows · More list | Planned | B1 |
| layer.3d-paint | U094 | Paint on a 3D object | 3D layers, Substance textures | Import 3D models, paint textures, and render. Planned: it needs a 3D engine and model formats, beyond this 2D editor today. | 3d object, paint on 3d, 3d model, texture painting | Effects & masks › New · More list | Planned | T3 |
| layer.fx-3d | U095 | 3D lighting effect | Layer effect: 3D | Light a layer as if it were raised in 3D, kept editable. Planned: real 3D light needs a 3D renderer; Raised edge gives the common look today. | 3d effect, 3d lighting, emboss light, raised 3d look | Effects & masks › Shadows and glows · More list | Planned | T3 |
| layer.fx-blur | U096 | Gaussian blur as a layer effect | Layer effect: Gaussian Blur | Blurs a layer's result without touching its pixels. | blur effect on layer, live blur, layer blur style | Effects & masks › Shadows and glows · More list | Ready | T3 |
| layer.split-alpha | U097 | Split transparency into its own mask | Split Alpha | Move a layer's see-through part into a separate mask and back. | split alpha, transparency to mask, alpha to mask | Effects & masks › Hide parts · More list | Planned | T3 |
| layer.mask-shared | U098 | Use a mask made in another effect | Raster masks / external raster mask | Reuse one effect's mask in a different effect. | reuse mask, shared mask, raster mask, external mask | Effects & masks › Hide parts · More list | Planned | T3 |
| layer.linked-resources | U099 | Share one layer's content across files | Linked Services / Resource Manager | Lists every placed file and lets you relink or embed them. | linked resources, share layer across files, shared assets in files | Effects & masks › Live effects · More list | Planned | T3 |
| layer.clones-array | U100 | Make many linked copies | Clones Array | Builds a grid of clone layers, handy for sprites. | clones array, grid of copies, sprite sheet copies | Effects & masks › Live effects · More list | Planned | T3 |
| layer.blend-special | U101 | Dissolve, Erase and Merge blend modes | Dissolve, Color Erase, Erase, Merge, Split | Special blend modes that scatter, knock out or merge pixels. | dissolve, erase blend, merge blend, split blend mode | Effects & masks › Blending · More list | Planned | T3 |
| layer.blend-space | U102 | Choose the blend space (linear or perceptual) | Layer composite mode and space | Pick how colours mix: linear light or perceptual. Planned: linear light would change every blend formula and slow the whole picture. | linear blending, perceptual blending, blend space, gamma blending | Effects & masks › Blending · More list | Planned | T3 |

### Select & cut out (14)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| select.sky | U014 | Select the sky | Select Sky | One click selects the sky. | select sky, sky mask, choose sky | Select & cut out › Select with AI · More list | Planned | B10 |
| select.people | U015 | Select people and body parts | Select People (hair, skin, eyes, teeth, clothes) | Pick a person, or only their hair, skin or teeth, for local edits. | select person, select hair, select skin, select face, teeth, eyes, clothes | Select & cut out › Select with AI · More list | Planned | B10 |
| select.depth | U016 | Select by distance from camera | Depth range mask | Select near, middle or far parts using the picture's estimated depth. | depth mask, select by distance, near and far, background by depth | Select & cut out › Select with AI · More list | Planned | B10 |
| select.foreground | U017 | Cut out the subject by painting rough marks | Foreground Select | Paint rough in/out strokes and it separates a subject with matting. | foreground select, rough cut out, scribble to cut out, matting | Select & cut out › Draw or paint · More list | Planned | B10 |
| select.luminance | U018 | Select by brightness | Luminance range | Select the light, middle or dark parts, with a soft falloff you can tune. | luminosity mask, luminance range, select bright parts, select dark parts | Select & cut out › By colour or light · small button | Ready | B10 |
| select.from-path | U019 | Selection from a path | Selection From Paths | Turns a drawn outline into a selection. | path to selection, outline to selection, load path | Select & cut out › Perfect and keep · More list | Ready | B4 |
| select.to-path | U020 | Selection to a path | To Path | Turns a selection into an editable outline. | selection to path, make path, make outline | Select & cut out › Perfect and keep · More list | Ready | B4 |
| select.from-alpha | U021 | Selection from a layer's see-through part (add, subtract, intersect) | Alpha to Selection (and add/subtract/intersect) | Builds a selection from a layer's solid parts (and its layer mask, when it is on), combined with the current one. | alpha to selection, select layer pixels, select opaque area, layer transparency | Select & cut out › Perfect and keep · More list | Ready | B10 |
| select.remove-holes | U103 | Fill holes in a selection | Remove Holes | Closes small unselected gaps inside a selection. | fill holes in selection, close gaps in selection, solid selection | Select & cut out › Change it · More list | Ready | T3 |
| select.distort | U104 | Roughen the selection edge | Distort selection | Makes a selection edge irregular and hand-torn. | rough edge, torn edge, distort selection, irregular selection | Select & cut out › Change it · More list | Ready | T3 |
| select.round-corners | U105 | Rounded corners on a selection | Rounded Rectangle | Rounds the corners of the current selection. | rounded selection, round corners, rounded rectangle selection | Select & cut out › Change it · More list | Ready | T3 |
| select.editor | U106 | Selection editor with preview | Selection Editor | Shows the selection as a grey picture (white selected, black not) to paint, blur or invert, then turns it back into a selection. | selection editor, see selection, selection preview | Select & cut out › Perfect and keep · More list | Ready | T3 |
| select.float | U107 | Float a selection into a loose layer | Float | Lifts the selected pixels into a new layer just above, cutting them from the original, so you can move them. | float selection, floating layer, lift pixels | Select & cut out › Perfect and keep · More list | Ready | T3 |
| select.from-channel | U108 | Select from a colour channel | Selection from channels | Turns one colour channel into a selection. | channel selection, select from red channel, channel to selection | Select & cut out › Perfect and keep · More list | Ready | T3 |

### Retouch & remove (7)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| retouch.distractions | U022 | Remove distracting people or wires in one click | Distraction removal (Remove people, Wires and cables) | Auto-find tourists, wires and cables and clear them. | remove people, remove wires, remove power lines, remove tourists, clean up background | Retouch & remove › Remove · More list | Planned | B11 |
| retouch.fill-from-photo | U023 | Fill using a second photo | Multi-image Content-Aware Fill | Fill a hole with pixels borrowed from another photo of the same scene. | fill from another photo, multi image fill, borrow from second photo | Retouch & remove › Remove · More list | Planned | B11 |
| retouch.smooth-skin | U024 | Smooth skin | Skin Smoothing | AI softens blemishes and texture while keeping facial detail. | smooth skin, skin softening, beauty, blemishes, wrinkles, airbrush | Retouch & remove › Faces and skin · More list | Planned | B11 |
| retouch.frequency-separation | U025 | Smooth a face by detail layers | Frequency separation (via Apply Image and actions) | Split colour and texture so skin can be retouched without losing pores. | frequency separation, texture and colour layers, skin retouch | Retouch & remove › Faces and skin · More list | Planned | B11 |
| retouch.restore-photo | U026 | Repair an old or damaged photo | Photo Restoration | AI fixes scratches, fading and grain in old prints. | restore old photo, damaged photo, scratches, torn photo, fix old picture | Retouch & remove › Rescue a photo · More list | Planned | B11 |
| retouch.deblur | U027 | Fix a blurry or shaken photo | Shake Reduction / Deblur | Sharpens a picture blurred by camera movement. | deblur, shaky photo, camera shake, blurry photo, unblur | Retouch & remove › Rescue a photo · More list | Planned | B11 |
| retouch.median-brush | U109 | Smooth by median average with a brush | Median Brush Tool | Paints a median blur to calm noise or texture. | median brush, smooth by painting, noise brush | Retouch & remove › Touch up by painting · More list | Planned | T3 |

### Develop RAW (32)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| raw.white-balance | U002 | Fix the colour of the light | White balance (temperature and tint) | Set the scene's light by temperature and tint, or click something grey and let it work out the light. | white balance, temperature, tint, too orange, too blue, grey picker | Develop RAW › Develop · big button | Ready | B6 |
| raw.local-edits | U003 | Edit one area with brush, gradient, range or AI masks | Masking (local adjustments) | Draw an area, or let the AI find one (sky, subject, a colour or brightness range), and give it its own light and colour sliders. | local adjustment, edit one area, brighten only the sky, mask sliders, local edit | Develop RAW › Edit one area · More list | Planned | B6 |
| raw.camera-profile | U028 | Choose how the camera's colours are read | Camera profile and calibration | Adjust how the camera's colours are rendered. Not built yet: it needs measured colour profiles for each camera. | camera profile, calibration, camera colours, colour profile for raw | Develop RAW › Develop · More list | Planned | B12 |
| raw.negative | U029 | Fix film negatives | Negadoctor / film negative | Turn a scan or photo of a film negative into a positive. | film negative, scan negative, invert film, negative to positive | Develop RAW › Develop · small button | Ready | B12 |
| raw.filmic | U030 | Natural-looking bright-to-dark curve | Filmic RGB / Sigmoid / AgX tone mapping | Squeeze a wide brightness range into a screen so highlights roll off softly. | filmic, tone mapping, highlight roll off, sigmoid, agx | Develop RAW › Light and tone · More list | Planned | B12 |
| raw.tone-equalizer | U031 | Brighten by zone with a slider per zone | Tone equalizer | Raise or lower brightness separately for five zones, from blacks to whites, without halos. | tone equalizer, zone brightness, dodge and burn by zones | Develop RAW › Light and tone · small button | Ready | B12 |
| raw.highlights | U032 | Rescue bright and dark areas | Highlights and shadows | Calm bright areas and open up dark ones, each with its own slider; detail the camera never recorded cannot come back. | blown highlights, burnt sky, clipped white, rebuild highlights | Develop RAW › Light and tone · small button | Ready | B12 |
| raw.dehaze | U033 | Remove haze | Haze Removal | Lifts fog or haze from a landscape. | dehaze, haze, fog, foggy, mist, smog | Develop RAW › Light and tone · More list | Ready | B12 |
| raw.colour-grading | U034 | Colour wheels for shadows, mids, highlights | Colour grading | Three colour wheels (darks, middle tones, lights) as hue and amount sliders, plus balance, for cinematic looks. | colour grading, colour wheels, split toning, cinematic look, teal and orange | Develop RAW › Colour and looks · More list | Ready | B12 |
| raw.colour-mixer | U035 | Change one colour by picking it | Colour mixer (point colour, colour zones) | Pick one of eight colour bands and shift its hue, strength and lightness. | colour mixer, hsl, point colour, change one colour, colour zones | Develop RAW › Colour and looks · More list | Ready | B12 |
| raw.ai-denoise | U036 | Remove noise with AI | AI Denoise | Removes grain from high-ISO and night shots with an on-device model. Not built yet: the model's licence must be checked first. | ai denoise, noisy photo, grainy, high iso, night photo, remove noise with ai | Develop RAW › Detail and lens · More list | Planned | B13 |
| raw.denoise-profiled | U037 | Clean up grain measured from the photo | Denoise (measured) | Measures the grain in this photo and smooths it while keeping edges, without AI; there are no per-camera noise profiles yet. | profiled denoise, camera noise, iso noise, noise reduction for raw | Develop RAW › Detail and lens · More list | Ready | B12 |
| raw.capture-sharpen | U038 | Sharpen using the raw capture | Capture sharpening / deconvolution | Undo slight lens and sensor softness with a few rounds of deconvolution. | capture sharpening, deconvolution, raw sharpen, lens blur fix | Develop RAW › Detail and lens · More list | Ready | B12 |
| raw.contrast-levels | U039 | Contrast at each detail size | Contrast equalizer / contrast by detail levels / wavelets | Boost or calm texture, medium and large shapes separately. | contrast by detail size, wavelets, texture, local contrast levels | Develop RAW › Detail and lens · More list | Ready | B12 |
| raw.clarity | U040 | Add punch to mid-size detail | Clarity / local contrast | Add punch to mid-sized contrast without touching the whole picture. | clarity, local contrast, punch, texture, crisp | Develop RAW › Detail and lens · More list | Ready | B12 |
| raw.upright | U041 | Level a tilted picture | Upright (auto level and straighten) | Level the picture by its strongest straight lines, or turn it by hand; it zooms in just enough to hide the corners. | upright, level horizon, straighten building, keystone, fix tilted | Develop RAW › Detail and lens · More list | Ready | B12 |
| raw.wide-angle | U042 | Straighten a wide-angle picture | Adaptive Wide Angle | Correct curved lines and stretch from wide lenses. | wide angle, bent lines, curved lines, wide lens fix | Develop RAW › Detail and lens · More list | Planned | B12 |
| raw.clipping | U043 | Warn about burnt areas | Clipping warning / raw overexposed warning | Marks pure white in red and pure black in blue while you edit; Apply never keeps the marks. | clipping warning, blown out, overexposed warning, burnt areas | Develop RAW › Check · More list | Ready | B12 |
| raw.scopes | U044 | Colour scopes | Waveform, vectorscope and colour readouts | See the tones as a waveform, or the colours as a vectorscope, live as you edit. | waveform, vectorscope, scopes, parade, colour readout | Develop RAW › Check · More list | Ready | B12 |
| raw.snapshots | U045 | Keep and recall snapshots of an edit | Snapshots | Keep named states of the develop settings and go back to any of them while the page is open. | snapshot, before and after, save state, compare versions | Develop RAW › Check · More list | Ready | B12 |
| raw.presets | U046 | Save an edit as your own look | Presets | Save your develop settings under a name and apply them to any photo; they stay in this browser. | preset, look, save edit, reusable look, filter preset | Develop RAW › Colour and looks · More list | Ready | B12 |
| raw.black-white-points | U110 | Set black and white points of the sensor | Raw black/white point | Choose which tone becomes pure black and which pure white, for any photo. | sensor black point, raw white point, raw levels | Develop RAW › Develop · small button | Ready | T3 |
| raw.colour-rescue | U111 | Rescue clipped colours | Colour reconstruction | Bring back believable colour in areas that clipped. | clipped colours, rescue colour, colour reconstruction | Develop RAW › Light and tone · More list | Planned | T3 |
| raw.base-curve | U112 | Starting curve for a camera | Base curve | Start from a gentle, medium, strong or film-like brightness curve; there are no per-camera curves yet. | base curve, camera curve, starting curve | Develop RAW › Light and tone · More list | Ready | T3 |
| raw.colour-checker | U113 | Fix colours with a chart photo | Colour checker calibration | Build a colour correction from a photo of a standard colour chart. Not built yet: it needs reference values for the chart's patches. | colour checker, colour chart, calibrate with chart | Develop RAW › Colour and looks · More list | Planned | T3 |
| raw.colour-match | U114 | Match one patch's colour across photos | Area colour mapping | Pick a target colour in one photo and match it in others, useful for batches. | match colour across photos, colour mapping, same colour in every photo | Develop RAW › Colour and looks · More list | Planned | T3 |
| raw.colour-appearance | U115 | Colour by how it looks to the eye | Colour appearance model (CIECAM02 / CAM16, JzCzHz) | Change brightness, colourfulness and lightness in a model of human vision. | colour appearance, cam16, ciecam, how the eye sees colour | Develop RAW › Colour and looks · More list | Planned | T3 |
| raw.gamut-compress | U116 | Soft-clip very vivid colours | Gamut compression (ACES) | Pull oversaturated colours back before editing. | vivid colours clipping, neon colours, gamut compression, aces | Develop RAW › Colour and looks · More list | Planned | T3 |
| raw.hot-pixels | U117 | Remove stuck bright dots | Hot pixels | Find and hide sensor pixels that are always lit. | hot pixels, stuck pixels, bright dots, dead pixels | Develop RAW › Detail and lens · More list | Ready | T3 |
| raw.defish | U118 | Flatten a fisheye picture | De-fish | Turn a fisheye shot into a normal-looking one, set by the lens's field of view. | fisheye, defish, flatten fisheye, fisheye correction | Develop RAW › Detail and lens · More list | Ready | T3 |
| raw.vignette | U119 | Add or remove dark corners | Vignetting | Darken or lighten the picture's edges. | vignette, dark corners, remove vignetting, corner shading | Develop RAW › Detail and lens · More list | Ready | T3 |
| raw.community-looks | U120 | Copy and share community looks | Community filters | Browse and apply filters made by other users. Not built yet: sharing looks needs a place to host them. | community looks, shared filters, download looks, share preset | Develop RAW › Colour and looks · More list | Planned | T3 |

### AI tools (23)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| ai.generative-fill | U004 | Fill a selection by describing it | Generative Fill | Mark an area, type what should be there, and the AI paints it on a new layer, with variations and sliders to tweak the result. | generative fill, fill with words, add something, describe, prompt, ai fill | AI tools › Make with words · More list | Planned | B8 |
| ai.expand | U047 | Grow the picture past its edges | Generative Expand | Drag the crop box outward and the AI invents the new surroundings. | generative expand, extend picture, outpaint, make wider, grow canvas with ai | AI tools › Make with words · More list | Planned | B8 |
| ai.generate | U048 | Make a picture from words | Generate Image | Create a new picture from a typed wish, optionally guided by example pictures. | text to image, generate picture, create image from words, ai art | AI tools › Make with words · More list | Planned | B8 |
| ai.harmonize | U049 | Make a pasted object match the scene | Harmonize | Adjust a cut-out's colour, light and shadow so it sits believably in a new background. | harmonize, match lighting, blend object into scene, composite match | AI tools › Change with AI · More list | Planned | B13 |
| ai.relight | U050 | Change the light by placing lamps | Relight | Place up to three light sources on the picture and the AI relights it. | relight, add light, change lighting, lamp, light source | AI tools › Change with AI · More list | Planned | B13 |
| ai.assistant | U051 | Edit by chatting | AI assistant | Describe an edit in plain words and the assistant does the steps. | chat to edit, ai assistant, tell it what to do, edit by talking | AI tools › Change with AI · More list | Planned | B13 |
| ai.sky-swap | U052 | Swap the sky | Sky Replacement | Pick a new sky and the tool masks, blends and relights the scene to match. | sky replacement, replace sky, new sky, sunset sky, blue sky | AI tools › Change with AI · More list | Planned | B13 |
| ai.colorize | U053 | Colour an old black and white photo | Colorize | AI adds natural colour, with colour pins to steer it. | colorize, colourise, add colour to old photo, grey photo to colour, old family photo | AI tools › Change with AI · More list | Planned | B13 |
| ai.style-transfer | U054 | Copy an art style onto a photo | Style Transfer | Apply the look of a preset or your own reference artwork. | style transfer, painting style, art style, make it look like a painting | AI tools › Change with AI · More list | Planned | B13 |
| ai.split-layers | U055 | Split a flat picture into movable layers | Extract Layers / Image to Layer / Magic Layers | AI separates subject, objects and background into layers. | split into layers, extract layers, separate objects, layers from photo | AI tools › Change with AI · More list | Planned | B13 |
| ai.background-swap | U056 | Swap in a new background | Change Background / Backdrop | Cut the subject out and place it on a new scene, colour or picture. | change background, new background, replace background, backdrop | AI tools › Change with AI · More list | Planned | B13 |
| ai.grab-text | U057 | Turn words in a photo into editable text | Grab Text / Image Text Editor | Finds text inside a picture and makes it real, editable text. | edit text in photo, grab text, ocr, words in picture | AI tools › Faces and words · More list | Planned | B13 |
| ai.recompose | U121 | Rearrange a picture's composition | Generative Recompose | Let the AI reshape or recompose the picture to a new frame. | recompose, rearrange picture, move things around with ai | AI tools › Make with words · More list | Planned | T3 |
| ai.image-to-image | U122 | Make a new picture from one you have | Image to Image | Restyle or re-imagine an existing image from a prompt. | image to image, redraw with ai, variations, reimagine | AI tools › Make with words · More list | Planned | T3 |
| ai.new-angle | U123 | Change the camera angle of a photo | Photo to Angle / AI Reshot | AI re-renders the scene from another viewpoint. | change angle, new viewpoint, reshoot, camera angle | AI tools › Make with words · More list | Planned | T3 |
| ai.to-video | U124 | Image to video | Generate video | Turn a picture into a short video clip. | image to video, animate photo, make video from picture | AI tools › Make with words · More list | Planned | T3 |
| ai.landscape-mix | U125 | Blend two landscapes | Landscape Mixer | Mix the seasons, time of day or look of another landscape into yours. | landscape mixer, blend landscapes, change season, winter to summer | AI tools › Change with AI · More list | Planned | T3 |
| ai.sticker | U126 | Make a sticker | Sticker Maker | Cut out the subject with an outline for use as a sticker. | sticker, make sticker, cut out sticker, emoji | AI tools › Change with AI · More list | Planned | T3 |
| ai.portrait | U127 | Change a face's expression, age or look | Smart Portrait, Photo Restoration, JPEG Artifacts Removal, Makeup Transfer, Face Aware editing | Sliders for smile, age, direction, scratches, compression blocks and makeup. | face edit, smile, age, expression, makeup transfer, face aware | AI tools › Faces and words · More list | Planned | T3 |
| ai.face-swap | U128 | Swap faces | Face Swap | Put one person's face onto another photo. | face swap, swap faces, put my face | AI tools › Faces and words · More list | Planned | T3 |
| ai.headshot | U129 | Make avatars and headshots | AI Headshot / Avatar Generator | AI makes a professional headshot or avatar from your photos. | headshot, avatar, profile picture, linkedin photo | AI tools › Faces and words · More list | Planned | T3 |
| ai.translate | U130 | Translate words inside a picture | Image Translator | Reads text in the picture and swaps in another language. | translate text in picture, translate image, menu translation | AI tools › Faces and words · More list | Planned | T3 |
| ai.model-choice | U131 | Pick the AI model | AI model choice | Choose which on-device model does the work. | ai model, choose model, model picker | AI tools › Better quality · More list | Planned | T3 |

### Paint & draw (21)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| paint.dynamics | U005 | Brush responds to the pen | Brush dynamics | Pen pressure, speed, tilt and direction change the brush's size, opacity, colour and angle. | pen pressure, tilt, tablet, stylus, pressure size, brush dynamics | Paint & draw › Brush settings · More list | Planned | B5 |
| paint.mypaint | U058 | Natural paint (MyPaint) | MyPaint Brush Engine | Loads MyPaint-style natural media brushes. | natural media, mypaint, watercolour, charcoal, oil brush | Paint & draw › Brush kinds · More list | Planned | B14 |
| paint.bristle | U059 | Bristle paint | Bristle Brush Engine | Paints with many separate hairs that spread, shear, run out of ink and soak up colour like a real brush. | bristle brush, real paint, hairy brush, oil paint brush | Paint & draw › Brush kinds · More list | Planned | B14 |
| paint.filter-brush | U060 | Effect brush | Filter Brush Engine | Paints any filter (blur, colour change) only where you brush. | effect brush, paint a filter, blur brush, filter brush | Paint & draw › Brush kinds · More list | Planned | B14 |
| paint.stabilizer | U061 | Steady shaky lines | Stroke smoothing (stabiliser) | Stabilise the brush stroke while painting. | smooth lines, steady hand, stabilizer, lazy mouse, shaky lines | Paint & draw › Brush settings · More list | Planned | B5 |
| paint.libraries | U062 | Custom brush, pattern, gradient and palette libraries | Brushes, Patterns, Gradients, Palettes dialogs | Manage and edit saved brushes, patterns, gradients and colour lists. | brush library, pattern library, gradient library, palettes, import brushes | Paint & draw › Brush settings · More list | Planned | B14 |
| paint.symmetry | U063 | Symmetry painting | Paint Symmetry (mirror, radial, spiral, mandala) | Paint once and mirror the strokes. | symmetry, mirror painting, mandala, radial symmetry, kaleidoscope drawing | Paint & draw › Brush settings · More list | Planned | B14 |
| paint.assistants | U064 | Guide that your strokes snap to | Drawing assistants (ellipse, concentric ellipse, perspective ellipse, ruler, infinite ruler, parallel ruler, spline) | A placed line or curve that pulls your freehand stroke onto it. | drawing assistant, ruler, ellipse guide, snap stroke, straight line guide | Paint & draw › Brush settings · More list | Planned | B14 |
| paint.perspective-guides | U065 | Perspective guides | Perspective, Vanishing Point, Fish Eye Point, 2 Point Perspective, Curvilinear Perspective assistants | Strokes follow lines that meet at vanishing points, including curved fish-eye views. | perspective guide, vanishing point, two point perspective, fish eye | Paint & draw › Brush settings · More list | Planned | B14 |
| paint.wrap-around | U066 | Paint a seamless tile | Wrap Around Mode | Paint across the edges so the picture tiles without seams, seeing the repeats live. | seamless tile, wrap around, repeat pattern painting, tileable | Paint & draw › Brush settings · More list | Planned | B14 |
| paint.colorize-mask | U067 | Colour line art by dabbing | Colorize Mask | Dab rough colour blobs and each closed area of the line art fills with that colour, gaps closed for you. | colour line art, flat colours, colourise comics, fill line art | Paint & draw › Fill · More list | Planned | B14 |
| paint.sketch-brush | U132 | Sketchy line brush | Sketch Brush Engine | Draws thin curved lines around the stroke for a loose pencil-scribble look. | sketch brush, pencil sketch brush, scribble brush | Paint & draw › Brush kinds · More list | Planned | T3 |
| paint.chalk-spray | U133 | Chalk, hatching and spray brushes | Chalk / Hatching / Spray Brush Engines | Chalky grain, cross-hatch lines or scattered dots as the brush stroke. | chalk, hatching, spray paint, airbrush spray | Paint & draw › Brush kinds · More list | Planned | T3 |
| paint.shape-brush | U134 | Shape, particle and grid brushes | Shape / Particle / Grid Brush Engines | Strokes built from shapes, flying particles or a repeated grid of dabs. | shape brush, particle brush, grid brush | Paint & draw › Brush kinds · More list | Planned | T3 |
| paint.dynamic-brush | U135 | Dynamic and curve brushes | Dyna / Curve Brush Engines | Brush with a weight that lags behind the pen, or strokes drawn as curves between points. | dynamic brush, curve brush, flowing lines | Paint & draw › Brush kinds · More list | Planned | T3 |
| paint.normal-brush | U136 | Normal-map brush | Tangent Normal Brush Engine | Paints surface-direction colours for 3D bump maps. | normal map brush, tangent normal, game textures | Paint & draw › Brush kinds · More list | Planned | T3 |
| paint.calligraphy | U137 | Calligraphy and ink pen | Calligraphy / Ink tool | Angled-nib and speed-sensitive pen strokes. | calligraphy, ink pen, lettering, brush pen | Paint & draw › Brush kinds · More list | Planned | T3 |
| paint.lock-settings | U138 | Lock a brush setting | Locked Brush Settings | Keep one setting fixed while you switch between saved brushes. | lock brush setting, keep brush size, locked settings | Paint & draw › Brush settings · More list | Planned | T3 |
| paint.mesh-gradient | U139 | Mesh gradients | Mesh Gradient | Colour that blends smoothly across a grid of points. | mesh gradient, freeform gradient, smooth colour blend | Paint & draw › Fill · More list | Planned | T3 |
| paint.enclose-fill | U140 | Fill a drawn area with many options | Enclose and Fill Tool | Draw a loop; fills every region inside it that matches a chosen colour, transparency or outline rule. | fill drawn area, lasso fill, enclose and fill, fill gaps | Paint & draw › Fill · More list | Planned | T3 |
| paint.colour-tools | U141 | Colour tools: advanced, artistic, gamut mask, wide gamut, digital mixer, sliders | Colour dockers | Many colour pickers, including masks that limit the palette to harmonious colours. | colour wheel, colour sliders, gamut mask, colour mixer, palette | Paint & draw › Colour · More list | Planned | T3 |

### Shapes & text (33)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| shape.live | U068 | Live editable shapes | Live Shapes (corner radius sliders) | Rectangles and polygons whose corners stay editable. | live shape, editable shape, corner radius, rounded corners | Shapes & text › Shapes · More list | Planned | B15 |
| shape.vector-layer | U069 | Vector layer | Vector Layer | A layer holding editable shapes and text that stay sharp. | vector layer, sharp shapes, scalable drawing | Shapes & text › Shapes · More list | Planned | B15 |
| path.boolean | U070 | Combine two shapes (merge, cut out, overlap) | Boolean operations: Union, Difference, Intersection, Exclusion | Merges the picked outline with the one above it in Outlines, cuts it out of that one, or keeps only the overlap or only what does not overlap. | union, subtract shapes, intersect, exclude, combine shapes, merge shapes | Shapes & text › Combine and style · small button | Ready | B4 |
| path.combine | U071 | Join or split path pieces | Combine / Break Apart | Joins the picked outline and the one above it into one outline, or splits an outline into its separate pieces (a hole stays with its shape). | combine paths, break apart, join paths, split path | Shapes & text › Combine and style · small button | Ready | B4 |
| path.stroke-style | U072 | Arrowheads and dash styles | Stroke style: dashes, line ends, corners, arrowheads | Draws the picked outline as a line on a new layer: solid, dashed or dotted, flat, round or square ends, sharp, round or cut corners, and arrowheads. | arrow, arrowhead, dashed line, dotted line, line style | Shapes & text › Combine and style · small button | Ready | B15 |
| path.effects | U073 | Non-destructive path effects, stackable | Live Path Effects | Adds editable effects to a path that update when the path changes; effects can be stacked. | path effects, live path effect, non-destructive path | Shapes & text › Live shape effects · More list | Planned | B15 |
| type.opentype | U074 | Variable fonts and OpenType features | Variable fonts, ligatures, stylistic sets | Weight and width sliders and type features for fonts. | variable font, ligatures, stylistic sets, font features, opentype | Shapes & text › Text style · More list | Planned | B15 |
| type.styles | U075 | Paragraph and character styles | Character Styles, Paragraph Styles | Save text looks and apply to many text layers. | character style, paragraph style, text style, reuse text format | Shapes & text › Text style · More list | Planned | B15 |
| type.scripts | U076 | Text in every script | Complex scripts (Arabic, Hebrew, Indic) | Correct shaping and right-to-left layout for Arabic, Hebrew, Hindi and other Indic scripts. | hindi text, arabic text, hebrew, right to left, indic script, complex script | Shapes & text › Text style · More list | Planned | B15 |
| path.tweak | U142 | Reshape a path by brushing it | Tweak Tool (push, shrink, roughen, jitter colours) | Pushes, thins or roughens path parts like clay. | tweak path, push path, roughen path, brush a shape | Shapes & text › Draw outlines · More list | Planned | T3 |
| shape.spiral-star | U143 | Star and spiral outlines | Star and spiral tools | Draws a star (number of points, inner size) or a spiral (turns) as an outline you can reshape and fill. | spiral, star, polygon star, star shape, swirl | Shapes & text › Shapes · More list | Ready | T3 |
| shape.qr | U144 | Draw QR codes | QR code shape | Generates an editable QR code. | qr code, make qr code, scan code | Shapes & text › Shapes · More list | Planned | T3 |
| shape.generate | U145 | Generate shapes (barcodes, grids, gears) | Render extensions | Creates new objects from numbers. | barcode, grid, gear, generate shapes | Shapes & text › Shapes · More list | Planned | T3 |
| shape.comic-panels | U146 | Comic panels | Comic Panel Editing Tool | Draw and edit comic panel frames. | comic panels, manga panels, comic page layout | Shapes & text › Shapes · More list | Planned | T3 |
| path.divide | U147 | Slice a shape with another shape | Division | Slices the outline above the picked one along the picked one's edge: the parts outside it and the parts inside it each become their own outline. | divide shapes, cut path, slice shape, knife | Shapes & text › Combine and style · More list | Ready | T3 |
| path.bend | U148 | Bend a shape along a curve | Bend | Bends the outline above the picked line along it, stretched to the line's length. | bend along curve, follow path, curve a shape | Shapes & text › Live shape effects · small button | Ready | T3 |
| path.hatches | U149 | Hatch lines | Hatches | Fills the picked outline with evenly spaced lines (holes stay empty): pick the gap, the angle, and crossed lines. | hatches, hatching, crosshatch shading | Shapes & text › Live shape effects · small button | Ready | T3 |
| path.interpolate | U150 | Blend between two shapes | Interpolate sub-paths | Adds in-between shapes that blend the outline above into the picked one (or one piece into the next) in the number of steps you pick. | interpolate, blend shapes, steps between paths | Shapes & text › Live shape effects · small button | Ready | T3 |
| path.knot | U151 | Over-and-under crossings | LPE Knot | Makes gaps where a path crosses itself, like a knot. | knot, over and under, weave lines | Shapes & text › Live shape effects · More list | Planned | T3 |
| path.mirror | U152 | Draw one half, mirror the other | Mirror symmetry | Adds a mirror copy across an edge of the outline and joins the halves: draw half a heart, get the whole heart. | mirror half, symmetric shape, mirror path | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.envelope | U153 | Tilt a flat shape in perspective | LPE Perspective/Envelope | Four corner handles tilt a flat object in 3D space. | envelope, perspective shape, tilt flat shape | Shapes & text › Live shape effects · More list | Planned | T3 |
| path.stitch | U154 | Stitch lines between two paths | Stitch sub-paths | Adds straight lines across from the outline above to the picked one, spaced evenly along both, like string art. | stitch lines, connect two paths, string art | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.pattern-along | U155 | Repeat a shape along a line | Pattern along path | Repeats the outline above along the picked line, each copy bent to follow it, with the gap you pick. | pattern along path, repeat along line, chain of shapes | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.offset | U156 | Grow or shrink a shape by a distance | Offset path | Moves every edge of an outline out or in by a number of pixels, true to about half a pixel; grown corners come out round. | offset, outset, inset, grow shape, shrink shape | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.power-stroke | U157 | Strokes with changing thickness | Power stroke | Turns the picked line into a shape that is thick and thin along its length: sliders set the width at the start, the middle and the end. | variable width, tapered stroke, thick and thin line | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.rotate-copies | U158 | Copies around a circle | Rotate copies | Spins copies of an outline round its own centre or the picture's centre and joins them, for flowers and mandalas. | rotate copies, radial copies, copies around a circle, mandala shape | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.roughen | U159 | Hand-drawn wobble | Roughen | Gives an outline a hand-drawn wobble: pick how far points move, how fine the wobble is, and another random pattern. | roughen, wobble, hand drawn look, jitter | Shapes & text › Live shape effects · More list | Ready | T3 |
| path.sketch | U160 | Sketch look from a path | LPE Sketch | Turns a path into several pencil-like lines. | sketch path, sketchy lines, pencil look from path | Shapes & text › Live shape effects · More list | Planned | T3 |
| path.tiling | U161 | Tile many copies in a grid | LPE Tiling | Makes rows and columns of copies with gaps and offsets. | tile copies, grid of copies, repeat in grid | Shapes & text › Live shape effects · More list | Planned | T3 |
| type.match-font | U162 | Change a font to match a picture | Match Font | Find a similar font from a photo of text. | match font, what font is this, identify font, font finder | Shapes & text › Text · More list | Planned | T3 |
| type.unrasterize | U163 | Undo a rasterize | Revert Rasterize | Brings a text layer back to editable text. | undo rasterize, editable text again, revert rasterize | Shapes & text › Text · More list | Planned | T3 |
| type.in-shape | U164 | Text that fills a shape | Shape text | Types words inside a custom outline. | text in shape, fill shape with text, text frame | Shapes & text › Text · More list | Planned | T3 |
| type.make-font | U165 | Make your own font | Creating Custom Fonts / SVG font editor | Draws glyphs and builds a font. | make a font, custom font, font from drawing, svg font | Shapes & text › Text · More list | Planned | T3 |

### Automate & batch (14)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| auto.copy-edits | U077 | Copy edits to many photos | History copy and paste, styles | Copy this picture's light-and-colour layers and your last filter, then paste them onto other open pictures or many picture files. | copy edits, paste settings, sync edits, same edit on many photos | Automate & batch › Do many at once · small button | Ready | B7 |
| auto.panorama | U078 | Stitch several shots into a panorama | Photomerge | Align and blend many photos into one wide picture. Not built: needs automatic alignment first. | panorama, stitch photos, photomerge, join shots | Automate & batch › Merge photos · More list | Planned | B17 |
| auto.hdr-merge | U079 | Merge exposure brackets | Merge to HDR Pro (32-bit) | Combine exposures into an HDR image with tone mapping. Not built: needs automatic alignment, and the editor holds 8 bits per colour. | hdr, merge brackets, exposure bracket, high dynamic range | Automate & batch › Merge photos · More list | Planned | B17 |
| auto.stacks | U080 | Stack photos to remove moving objects or noise | Image stacks (median, mean, exposure merge) | Combines many shots of one scene to drop passers-by, cut noise or blend exposures. | stack photos, remove tourists by stacking, median stack, noise stack | Automate & batch › Merge photos · More list | Planned | B17 |
| auto.plugins | U081 | Add extra tools | Plug-ins | Install outside tools and effects into the editor. Not built: outside code needs a safe sandbox first. | plugin, add-on, extension, extra tools | Automate & batch › Scripts and data · More list | Planned | B19 |
| auto.record-painting | U166 | Record a painting | Recorder Docker | Records the painting session into a timelapse. | record painting, timelapse, record strokes | Automate & batch › Record steps · More list | Planned | T3 |
| auto.droplets | U167 | Drag-and-drop mini apps | Droplets | Save an action as a tiny app: drop files on it and they are processed. Not built yet; use Edit many pictures the same way. | droplet, drag and drop app, quick action | Automate & batch › Do many at once · More list | Planned | T3 |
| auto.watermark | U168 | Watermark | Watermark | Stamp your text or logo on this picture as a movable layer, or on many pictures at once. | watermark, logo on photos, copyright mark, signature | Automate & batch › Do many at once · small button | Ready | T3 |
| auto.astro-stack | U169 | Stack star photos | Astrophotography Stack Persona | Aligns and averages night-sky frames, with dark and flat frames and narrowband mixing. Not built: needs automatic alignment first. | astro, star stack, milky way, night sky stacking | Automate & batch › Merge photos · More list | Planned | T3 |
| auto.pixel-shift | U170 | Combine several shots with ghost removal | Pixel shift merge | Merge a camera's pixel-shift frames, hiding moving things. Not built: needs pixel-exact alignment first. | pixel shift, ghost removal, multi shot merge | Automate & batch › Merge photos · More list | Planned | T3 |
| auto.script-events | U171 | Run scripts on events | Script Events Manager | Run an action or script when a file opens, saves or exports. Not built: scripts need a safe sandbox first. | script events, run on open, automatic script, trigger | Automate & batch › Scripts and data · More list | Planned | T3 |
| auto.filter-graph | U172 | Draw-your-own filter graph | GEGL Graph, GEGL Operation tool | Type a chain of filters and run it. | node editor, filter graph, node based, gegl graph | Automate & batch › Scripts and data · More list | Planned | T3 |
| auto.collage | U173 | Auto-arrange photos into a collage | Collage Wizard | Places chosen photos in a layout without cropping them. | collage, photo collage, grid collage, auto arrange photos | Automate & batch › Sheets and layouts · More list | Ready | T3 |
| auto.passport | U174 | Passport photo sheet | Passport Photo Maker | Fills a print page with copies of your photo at a passport size. Check your own country's rules: only the size is set. | passport photo, id photo, visa photo, photo sheet | Automate & batch › Sheets and layouts · More list | Ready | T3 |

### Arrange layers (16)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| layer.crop-to-content | U175 | Crop a layer to its content | Crop Layers to Content | Shrinks the layer to the non-empty pixels. | crop layer, trim layer, shrink layer to content | Arrange layers › This layer · More list | Ready | T3 |
| layer.remove-alpha | U176 | Remove the see-through channel | Remove Alpha Channel | Fills transparency with the background colour. | remove transparency, remove alpha, flatten transparency | Arrange layers › This layer · More list | Ready | T3 |
| layer.invert-alpha | U177 | Invert see-through areas | Invert Alpha | Swaps opaque and clear areas. | invert transparency, invert alpha, swap see-through | Arrange layers › This layer · More list | Ready | T3 |
| layer.split-by-colour | U178 | Split layer by colour | Split Layer | Cut a layer into one layer per colour field. | split layer by colour, separate colours into layers | Arrange layers › This layer · More list | Ready | T3 |
| layer.convert | U179 | Convert a layer to another kind | Convert a layer to... | Turn a layer into a paint, mask or file layer. | convert layer, change layer type, turn into vector layer | Arrange layers › This layer · More list | Planned | T3 |
| layer.colour-space | U180 | Change colour space of one layer | Convert Layer Color Space | Different colour model for one layer only. | layer colour space, convert layer profile | Arrange layers › This layer · More list | Planned | T3 |
| layer.reverse | U181 | Reverse the layer order | Reverse Layer Order | Flips the stack upside down. | reverse layers, flip layer order, reverse order | Arrange layers › Order · More list | Ready | T3 |
| layer.filter | U182 | Find layers by kind, label or words | Layers filter (kind, name, effect, colour) | Find layers by name, notes, tags, kind, colour label or effects, and click one to work on it. | find layer, search layers, filter layers, layer by kind | Arrange layers › Find and versions · small button | Ready | T3 |
| layer.colour-label | U183 | Colour-label layers | Layer colour labels | Tag the active layer with a colour, to find it again with Find layers. | layer colour, colour label, tag layer, mark layer | Arrange layers › Find and versions · small button | Ready | T3 |
| layer.select-by-state | U184 | Select layers by state | Select hidden / locked / unlocked layers | Lists every hidden, shown, locked or unlocked layer at once; show or unlock them all in one step, or click one to work on it. | select hidden layers, select locked layers, select layers by state | Arrange layers › Find and versions · small button | Ready | T3 |
| layer.metadata | U185 | Edit layer metadata | Edit Metadata | Write notes and tags on the active layer; Find layers searches them. | layer metadata, layer notes, layer info | Arrange layers › Find and versions · More list | Ready | T3 |
| layer.video | U186 | Edit video on a timeline | Video Timeline (clips, keyframes, transitions, audio, render video) | A timeline for clips, keyframed effects and audio. | video editing, video timeline, clips, transitions, audio | Arrange layers › Animate · More list | Planned | T3 |
| layer.keyframes | U187 | Animate with keyframes on layers | Timeline layer keyframes (position, opacity, style, mask) | Animate layer properties over time. | keyframe, animate position, animate opacity, motion | Arrange layers › Animate · More list | Planned | T3 |
| layer.onion-skin | U188 | See neighbour frames | Onion Skin | Shows previous frames in red and next in green to draw in-betweens. | onion skin, see previous frame, animation ghost | Arrange layers › Animate · More list | Planned | T3 |
| layer.storyboard | U189 | Storyboard | Storyboard Docker | Plan shots as a board of panels. | storyboard, shot list, comic planning | Arrange layers › Animate · More list | Planned | T3 |
| layer.import-frames | U190 | Import animation frames | Import Animation Frames | Bring a folder of images in as frames. | import frames, image sequence, animation frames from files | Arrange layers › Animate · More list | Planned | T3 |

### Crop & resize (4)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| edit.cage | U082 | Pin-based bend cage | Cage Transform | Draw a cage around a shape and drag its corners to reshape smoothly. | cage transform, cage warp, reshape with cage | Crop & resize › Bend and push · More list | Planned | B16 |
| image.fit-canvas | U191 | Fit canvas to layers or selection | Fit Canvas to Layers / Selection | Resizes the canvas to what you have. | fit canvas, canvas to layers, canvas to selection, trim canvas | Crop & resize › Size · More list | Planned | T3 |
| edit.transform-again | U192 | Repeat the last transform | Transform again | Pick the previous transform back up and keep adjusting. | transform again, repeat transform, do it again | Crop & resize › Move and reshape a layer · More list | Planned | T3 |
| edit.transform-3d | U193 | Tilt a layer in 3D | 3D Transform | Rotates a layer around three axes with a camera. | 3d transform, tilt layer, rotate in 3d, perspective tilt | Crop & resize › Bend and push · More list | Planned | T3 |

### Light & colour (16)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| image.tone-mapping | U083 | Even out tone ranges for HDR looks | Tone Mapping (local) | Squeezes big light and dark differences into the screen's range while keeping the local detail. | tone mapping, hdr look, compress tones, dramatic hdr | Light & colour › More colour tools · small button | Ready | B17 |
| image.mode-32 | U084 | Work in 32-bit light | 32-bit HDR editing / OpenEXR | Not built: a browser canvas keeps 8 bits per colour, so light above pure white cannot be kept. | 32 bit, float, hdr editing, exr, high dynamic range editing | Light & colour › Colour type · More list | Planned | B17 |
| image.profiles | U085 | Colour profiles | Colour settings, assign and convert profile | Not built yet: reading and embedding ICC colour profiles needs changes to how files are saved. | colour profile, icc, srgb, adobe rgb, display p3, convert profile | Light & colour › Colour accuracy · More list | Planned | B18 |
| image.soft-proof | U086 | Preview how colours print | Soft Proof (Proof Setup, Proof Colours, Simulate Paper) | Not built: an honest proof needs a printer's ICC profile, and the editor cannot read one in the browser yet. | soft proof, print preview colours, proof colours, paper simulation | Light & colour › Colour accuracy · More list | Planned | B18 |
| image.gamut-warning | U087 | See which colours cannot print | Gamut Warning | Greys out colours a typical four-ink press is likely to miss, or pulls them into range. An estimate, not a printer's profile. | gamut warning, out of gamut, colours that cannot print | Light & colour › Colour accuracy · small button | Ready | B18 |
| image.local-threshold | U194 | Local threshold | Local Threshold | Black and white decided by each pixel's neighbourhood, not the whole picture: clean text from unevenly lit scans. | local threshold, adaptive threshold, scan documents, clean text scan | Light & colour › Light and colour · More list | Ready | T3 |
| image.retinex | U195 | Lift detail in dark areas | Retinex | Brings dark, unevenly lit places up toward the picture's average light, keeping their colours. | retinex, uneven light, shadow lift, even out lighting | Light & colour › More colour tools · small button | Ready | T3 |
| image.hue-chroma | U196 | Hue and chroma sliders | Hue Chroma | Turns colours, makes them stronger or weaker, and lighter or darker as the eye sees it (OKLCH). | hue chroma, chroma, lch, colour strength | Light & colour › More colour tools · small button | Ready | T3 |
| image.rotate-colours | U197 | Spin the colours | Rotate Colors | Turns one range of colours, say the oranges, into another, say the blues; the rest stay as they are. | rotate colours, hue shift, swap colours, colour spin | Light & colour › More colour tools · More list | Ready | T3 |
| image.sample-colorize | U198 | Colour by example | Sample Colorize | Not built yet: it needs a way to choose a second picture as the colour sample. | colour by example, sample colorize, copy colours from picture | Light & colour › More colour tools · More list | Planned | T3 |
| image.harmonize | U199 | Harmonise colours | Colour harmonizer | Pulls every colour toward a colour scheme built on the picture's main colour. | colour harmony, harmonise colours, colour scheme | Light & colour › More colour tools · More list | Ready | T3 |
| image.colour-contrast | U200 | Check text contrast | WCAG contrast check | Shows whether text in a chosen colour is readable on this area (WCAG ratio), and lightens or darkens only the parts that fail. | colour contrast, colour pop, separate colours | Light & colour › More colour tools · More list | Ready | T3 |
| image.export-lut | U201 | Save your adjustments as a lookup file | Export adjustments as 3D LUTs | Saves your light and colour layers as one .cube file that other editors and video apps open. Add one such layer first. | export lut, save lut, cube file, 3d lut | Light & colour › More colour tools · More list | Ready | T3 |
| image.palette-edit | U202 | Change the main colours | Palette edit | Finds the picture's four main colours and lets you turn, strengthen or lighten each one. | edit palette, colormap, indexed palette, gif palette | Light & colour › Colour type · small button | Ready | T3 |
| image.decompose | U203 | Split into and rebuild from colour channels | Decompose, Compose, Recompose, Extract Component | Splits the layer into Red, Green and Blue layers in one step (one undo). Together they rebuild the picture; edit or hide one to change just that colour. | decompose, channels to layers, rgb channels, compose channels | Light & colour › Colour type · More list | Ready | T3 |
| image.spot-channels | U204 | Print inks as separate plates | Spot channels, Duotone, Multichannel | Not built: special inks need separate colour channels, which the editor does not have yet. | spot colour, duotone, multichannel, ink plates, separations | Light & colour › Colour type · More list | Planned | T3 |

### Filters & blur (34)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| filter.depth-blur | U088 | Add depth blur from a depth map | Depth Blur | Blur by distance with focal distance and strength sliders. | depth blur, background blur, portrait mode, bokeh, blur background by depth | Filters & blur › Camera blurs · family sheet | Planned | B13 |
| filter.blur-variable | U205 | Blur by a map | Variable Blur | Blur strength set by a second layer. | variable blur, blur by map, gradient blur | Filters & blur › Blur · family sheet | Planned | T3 |
| filter.blur-edge-keep | U206 | Edge-keeping blurs | Mean Curvature, Selective Gaussian, Symmetric Nearest Neighbor | Smooth noise while keeping edges. | edge preserving blur, smooth skin blur, selective blur, bilateral | Filters & blur › Blur · family sheet | Ready | T3 |
| filter.blur-sketch | U207 | Sketchy brush-stroke blur | Sketch Blur | Coarse painted look from median estimation. | sketch blur, brush stroke blur, painterly blur | Filters & blur › Blur · family sheet | Planned | T3 |
| filter.blur-tileable | U208 | Make a tile repeat without seams (blur edge) | Tileable Blur | Blurs edges so a pattern tiles. | tileable blur, seamless blur, wrap edges blur | Filters & blur › Blur · family sheet | Planned | T3 |
| filter.diffuse-sharpen | U209 | Diffuse or sharpen detail | Diffuse or sharpen | A flexible tool that sharpens, deblurs, softens or adds bloom by spreading detail. | diffuse, sharpen detail, local sharpen, soften detail | Filters & blur › Sharpen · family sheet | Planned | T3 |
| filter.destripe | U210 | Remove stripes from a picture | Destripe | Removes vertical stripes from scans. | destripe, stripes, scan lines, banding | Filters & blur › Grain and specks · family sheet | Ready | T3 |
| filter.deinterlace | U211 | Fix interlace lines | Deinterlace | Removes line artefacts from video frames. | deinterlace, interlace lines, video lines, tv lines | Filters & blur › Grain and specks · family sheet | Ready | T3 |
| filter.kaleidoscope | U212 | Kaleidoscope | Kaleidoscope | Mirror slices around a centre. | kaleidoscope, mirror pattern, mandala effect | Filters & blur › Bend and twist · family sheet | Ready | T3 |
| filter.panorama-projection | U213 | Flat panorama to 3D view | Panorama Projection | Projects a 360 picture into a view. | little planet, panorama projection, 360 photo, tiny planet | Filters & blur › Bend and twist · family sheet | Planned | T3 |
| filter.page-curl | U214 | Page curl and curve bend | Page Curl, Curve Bend | Peel a corner; bend along a curve. | page curl, curl corner, bend picture | Filters & blur › Bend and twist · family sheet | Planned | T3 |
| filter.illusion | U215 | Illusion and recursive transform | Illusion, Recursive Transform | Repeating mirrored and nested copies. | illusion, recursive, droste, infinite picture | Filters & blur › Bend and twist · family sheet | Planned | T3 |
| filter.fractal-trace | U216 | Crumple and fractal looks | Fractal Trace, Value Propagate | Odd mapped and spread-colour effects. | fractal trace, crumple, crumpled paper, value propagate | Filters & blur › Bend and twist · family sheet | Planned | T3 |
| filter.dents | U217 | Dents and tile reflection | Dents, Tile Reflection | Water-like and mirrored-tile distortions. | dents, tile reflection, bumpy glass | Filters & blur › Bend and twist · family sheet | Planned | T3 |
| filter.newsprint | U218 | Newsprint and engrave | Newsprint, Engrave | Halftone and line-engraved looks. | newsprint, engrave, comic dots, print dots | Filters & blur › Blocks and dots · family sheet | Planned | T3 |
| filter.video-degrade | U219 | Video degradation | Video Degradation | Old TV pixel-pattern look. | vhs, old tv, video glitch, retro screen | Filters & blur › Blocks and dots · family sheet | Ready | T3 |
| filter.superpixels | U220 | Superpixels | SLIC, Waterpixels | Group pixels into regions. | superpixels, cells, low poly look | Filters & blur › Blocks and dots · family sheet | Planned | T3 |
| filter.star-burst | U221 | Star burst | Supernova, Gradient Flare, Sparkle | Bright star and flare effects. | star burst, sparkle, supernova, light rays, gradient flare | Filters & blur › Patterns and light · family sheet | Ready | T3 |
| filter.bump-map | U222 | Bump map and normal map | Bump Map, Normal Map | Create 3D-looking shading or game normal maps from a picture. | bump map, normal map, texture relief | Filters & blur › Patterns and light · family sheet | Ready | T3 |
| filter.noise-patterns | U223 | Noise patterns | Cell, Perlin, Simplex, Solid, Plasma | Generated organic textures. | perlin noise, cell noise, plasma, solid noise, random texture | Filters & blur › Patterns and light · family sheet | Planned | T3 |
| filter.fractals | U224 | Fractals | Julia, Mandelbrot, Fractal Explorer, IFS, Flame | Generated fractal art. | fractal, mandelbrot, julia set, flame fractal | Filters & blur › Patterns and light · family sheet | Planned | T3 |
| filter.patterns | U225 | Patterns: grid, checkerboard, maze, spiral, sinus, jigsaw | Render patterns | Generates geometric backgrounds. | checkerboard, grid pattern, maze, spiral pattern, jigsaw | Filters & blur › Patterns and light · family sheet | Planned | T3 |
| filter.bloom | U226 | Glow around lights | Bloom / Soft glow | Spreads light from bright areas. | bloom, glow, soft glow, dreamy, glowing lights | Filters & blur › Graphic looks · family sheet | Ready | T3 |
| filter.long-shadow | U227 | Long cast shadow | Long Shadow | Flat long shadow behind an object. | long shadow, flat design shadow, cast shadow | Filters & blur › Graphic looks · family sheet | Planned | T3 |
| filter.tile-seamless | U228 | Seamless tiling | Tile Seamless, Tile, Small Tiles, Paper Tile | Make or build repeating textures. | seamless tile, make tileable, repeat texture | Filters & blur › Graphic looks · family sheet | Planned | T3 |
| filter.edge-detect | U229 | Edge detectors | Difference of Gaussians, Sobel, Laplace, Neon, Edge | Different line-finding methods. | edge detect, sobel, laplace, neon edges, outline edges | Filters & blur › Graphic looks · family sheet | Ready | T3 |
| filter.outline-relief | U230 | Outline and relief | Outline, Relief | Edge tracing and edge-blended emboss. | outline, relief, carved, emboss outline | Filters & blur › Graphic looks · family sheet | Planned | T3 |
| filter.alien-map | U231 | Weird colour shift | Alien Map | Rotates colours in a non-natural way. | alien map, psychedelic, weird colours, trippy | Filters & blur › Graphic looks · family sheet | Ready | T3 |
| filter.lowlight | U232 | Simulate a dark-adapted eye | Lowlight vision | Show how a night scene looks to the eye. | night vision, dark adapted, lowlight, blue night look | Filters & blur › Graphic looks · family sheet | Ready | T3 |
| filter.cartoon | U233 | Cartoon, photocopy, cubism, glass tile | Cartoon, Photocopy, Cubism, Glass Tile | Graphic and painterly restyles. | cartoon, photocopy, cubism, glass tiles, comic look | Filters & blur › Artistic · family sheet | Planned | T3 |
| filter.ink-sketch | U234 | Ink sketch and pencil sketch | Ink Sketch, Pencil Sketch | Drawn looks. | pencil sketch, ink sketch, drawing from photo, sketch effect | Filters & blur › Artistic · family sheet | Planned | T3 |
| filter.linocut | U235 | Linocut and stained glass | Linocut, Stained Glass | Block print and leaded-glass looks. | linocut, woodcut, stained glass, print block | Filters & blur › Artistic · family sheet | Planned | T3 |
| filter.frames-overlays | U236 | Frames, borders, texture, light leaks, bokeh overlays | Photo Frames / Texture Background / Overlays | Add frames and texture overlays with blend control. | photo frame, border, light leaks, bokeh overlay, texture overlay | Filters & blur › Artistic · family sheet | Planned | T3 |
| filter.antialias | U237 | Smooth jagged edges | Antialias | Softens stair-stepped edges. | antialias, smooth jaggies, jagged edges, staircase edges | Filters & blur › More effects · family sheet | Ready | T3 |

### File sheet (12)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| file.libraries | U238 | Shared assets across files | Shared libraries | Reuse colours, images and styles in all your files. | shared library, asset library, reuse across files | File sheet | Planned | T3 |
| file.cloud | U239 | Cloud documents and version history | Cloud documents | Save online, share and recover earlier versions. | cloud documents, version history, sync files, online save | File sheet | Planned | T3 |
| file.share-review | U240 | Share for review | Share for review / invite to edit | Send a link for comments. | share for review, invite to edit, comments, feedback link | File sheet | Planned | T3 |
| file.phone-handoff | U241 | Take photo from phone into the editor | Phone to desktop handoff | Continue editing between devices. | phone to computer, send photo from phone, handoff | File sheet | Planned | T3 |
| file.library | U242 | Browse a photo library | Lighttable / collections / film rolls / timeline | Sort and find photos by folder, date, camera and more. | photo library, browse photos, collections, film rolls, catalog | File sheet | Planned | T3 |
| file.ratings | U243 | Ratings, colour labels, tags, grouping | Ratings, labels, tagging, metadata editor | Star, colour-mark, tag and describe photos for finding later. | rating, stars, colour label, tags, keywords | File sheet | Planned | T3 |
| file.cull | U244 | Compare several photos at once | Culling mode | Show a few photos side by side at the same zoom to pick the best. | cull, compare photos, pick the best photo, side by side | File sheet | Planned | T3 |
| file.sidecar | U245 | Edits stored in small side files | Sidecar files | Keep edits next to the original so the original never changes. | sidecar, xmp, keep edits in side file | File sheet | Planned | T3 |
| file.map | U246 | Place photos on a map | Geotagging / map view | Show where photos were taken and assign locations. | map, geotag, gps, where photo was taken | File sheet | Planned | T3 |
| file.tether | U247 | Shoot with the computer connected | Tethering / live view | Control a camera and see shots arrive. | tethering, shoot tethered, camera connected, live view | File sheet | Planned | T3 |
| file.templates | U248 | Start from a template for posts, posters, cards, flyers | Design templates | Ready layouts sized for social, print and web. | template, poster, flyer, social post, card, instagram post | File sheet | Planned | T3 |
| file.assets | U249 | Stock photos, stickers, icons, fonts library | Asset library | Search built-in free stock photos and graphics to add. | stock photos, stickers, icons, free fonts, clipart | File sheet | Planned | T3 |

### Export sheet (6)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| file.export-sizes | U089 | Export at several sizes at once | Export As (1x, 2x, 3x) and slices | Export at several scales and formats at once. | export 1x 2x 3x, several sizes, app icons, retina sizes, export slices | Export sheet | Planned | B19 |
| file.credentials | U250 | Add content origin info | Content Credentials | Attach a tamper-evident record of edits and AI use to exported files. | content credentials, provenance, made with ai label, origin info | Export sheet | Planned | T3 |
| file.image-map | U251 | Image from a data source | Image Map | Clickable regions for web. | image map, clickable areas, links in picture | Export sheet | Planned | T3 |
| file.more-formats | U252 | Load more file types | HEIC, JPEG XR, DDS, PDN | Open or save these formats. | heic, jpeg xr, dds, pdn, more file types, open other formats | Export sheet | Planned | T3 |
| file.export-gcode | U253 | Export for cutting machines | Gcodetools | Makes machine paths from vector shapes. | gcode, cutting machine, plotter, laser cutter, cricut | Export sheet | Planned | T3 |
| file.export-slides | U254 | Animated slides | JessyInk | Builds animated presentations in SVG. | slides, presentation, animated slides, slideshow file | Export sheet | Planned | T3 |

### View sheet (11)

| id | Census | Plain name | Pro name | What it does | Wish words | Lives in | Status | Phase |
|---|---|---|---|---|---|---|---|---|
| view.task-bar | U090 | Next-step bar | Contextual task bar | A small bar beside what you selected, offering the likely next steps; can be switched off. | next step, task bar, what next, suggestions bar | View sheet | Planned | B20 |
| view.quick-compare | U091 | Compare before and after quickly | Quick Compare | Flip between the edited and original view in one move. | before and after, compare, original vs edited, split view | View sheet | Planned | B20 |
| view.colour-blind | U092 | See as a colour-blind person | Proof for colour blindness | Preview with common colour-vision types. | colour blind, colour blindness, protanopia, deuteranopia, accessibility check | View sheet | Planned | B18 |
| view.smart-guides | U093 | Smart guides and spacing | Smart Guides, Guides from layout, Snap to layers | Guides appear when layers align or have equal gaps. | smart guides, spacing guides, snap to layers, alignment hints | View sheet | Planned | B20 |
| view.isometric-grid | U255 | Isometric and construction grids | Isometric grids, Quick Grids, curve snapping | Special grids and snapping to curves for technical drawing. | isometric grid, construction grid, 30 degree grid | View sheet | Planned | T3 |
| view.reference | U256 | Reference images | Reference Images Tool and Docker | Pin pictures beside the canvas to look at while painting. | reference image, reference board, mood board | View sheet | Planned | T3 |
| view.task-sets | U257 | Reusable task layouts | Task Sets | Saved sets of tools for a job. | task layout, workspace layout, saved workspace | View sheet | Planned | T3 |
| view.slideshow | U258 | Slideshow | Slideshow view | Play a collection full-screen. | slideshow, full screen photos, present photos | View sheet | Planned | T3 |
| view.focus-peaking | U259 | Show where focus is sharp | Focus peaking | Highlight the sharpest edges. | focus peaking, what is sharp, in focus check | View sheet | Planned | T3 |
| view.composition-guides | U260 | Composition guides | Guides and overlays | Draw thirds, golden ratio and other guides on the photo. | rule of thirds, golden ratio, composition grid, crop overlay | View sheet | Ready | T3 |
| view.colour-check | U261 | Colour-check the screen | Colour assessment | Switch to a neutral surround to judge colours fairly. | colour check, screen calibration, colour assessment, grey surround | View sheet | Planned | T3 |
