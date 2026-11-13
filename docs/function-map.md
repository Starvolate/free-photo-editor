# Free Photo Editor: function map

Generated from `packages/web/src/registry.ts` by `packages/web/test/registry.test.ts`; do not edit by hand.
Every menu item, tool and panel of a professional editor, with a plain name first, the usual pro name second,
one plain line of help, the wish words search understands, where it lives, and whether it works today.

**398 functions: 251 Ready, 147 Planned** (64 tools, 22 panels, 36 menus and submenus).

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

## File (25 Ready, 11 Planned)

Groups: Save a copy as · Export as; Do many at once · Automate.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| file.new | New picture | New | Start an empty picture of any size. | blank, empty canvas, start fresh, new document | File | Ready | 1 | Ctrl+N |
| file.open | Open a photo | Open | Open a picture from this device in a new tab. | load, photo, import, upload, open file, heic, raw, dng, tiff, pdf | File | Ready | 1 | Ctrl+O |
| file.open-layer | Add a photo as a layer | Place | Put another picture on top of this one as its own layer. | combine photos, collage, overlay, add picture, place | File | Ready | 1 | Ctrl+Shift+O |
| file.sample | Try a sample photo | Open sample | Open a built-in practice photo to try things on. | example, demo, practice, test picture | File | Ready | W1 |  |
| file.open-url | Open from a web link | Open from URL | Load a picture from an internet address. | link, url, web address | File | Planned | 7 |  |
| file.camera | Take a photo | Capture | Use the camera to take a new picture. | camera, selfie, webcam | File | Planned | 8 |  |
| file.recent | Recent pictures | Open recent | Pictures you opened before. | last files, history | File | Planned | 8 |  |
| file.close | Close picture | Close | Close this picture's tab. | close, done, finish | File | Ready | W1 |  |
| file.close-all | Close all pictures | Close all | Close every open tab. | close everything | File | Ready | W1 |  |
| file.revert | Go back to the opened version | Revert | Undo every change since the picture was opened. | reset, original, start over, undo everything | File | Ready | W1 |  |
| file.save-psd | Save with layers | Save as PSD | Keep every layer in a file other editors can open. | psd, keep layers, project file, save project | File | Ready | 1 |  |
| file.export | Export | Export as | Save a copy as PNG, JPEG, WebP, PSD, TIFF, GIF, AVIF, JPEG XL, PDF, SVG and more, with a note on what each type loses. | save, download, png, jpg, save as | File | Ready | 1 | Ctrl+S |
| file.quick-png | Quick export as PNG | Quick export | Save a PNG straight away, no questions asked. | quick save, png, download now | File | Ready | W1 | Ctrl+Shift+Alt+S |
| file.export-png | PNG picture | PNG | Sharp and keeps see-through areas; bigger files. | png, transparent background, lossless | File › Export as | Ready | 1 |  |
| file.export-jpeg | JPEG photo | JPEG | Small photo files; drops see-through areas and a little detail. | jpg, jpeg, small file, email | File › Export as | Ready | 1 |  |
| file.export-webp | WebP picture | WebP | Small modern web pictures that can keep see-through areas. | webp, website picture | File › Export as | Ready | 1 |  |
| file.export-psd | Layered file | PSD | Keeps the layers for other editors. | psd, layered | File › Export as | Ready | 1 |  |
| file.export-avif | AVIF picture | AVIF | Very small modern picture files. | avif | File › Export as | Ready | 7 |  |
| file.export-gif | GIF picture | GIF | Simple web pictures and animations. | gif, animation | File › Export as | Ready | 7 |  |
| file.export-tiff | TIFF picture | TIFF | Files for print and archives. | tiff, tif, print | File › Export as | Ready | 7 |  |
| file.export-pdf | PDF document | PDF | Share the picture as a document. | pdf, document | File › Export as | Ready | 7 |  |
| file.export-svg | SVG drawing | SVG | A drawing file that stays sharp at any size. | svg, vector | File › Export as | Ready | 7 |  |
| file.export-ico | Website icon | ICO | Small icon files for websites. | favicon, icon | File › Export as | Ready | 7 |  |
| file.export-jxl | JPEG XL picture | JPEG XL | Very small, high-quality files that keep see-through areas. | jxl, jpeg xl | File › Export as | Ready | 7 |  |
| file.export-tga | TGA picture | TGA | Files for games and video tools; keeps see-through areas. | tga, targa | File › Export as | Ready | 7 |  |
| file.export-bmp | BMP picture | BMP | Plain Windows pictures with no compression. | bmp, bitmap, windows picture | File › Export as | Ready | 7 |  |
| file.export-ora | Layered file for free editors | OpenRaster | Keeps the layers for Krita, GIMP and MyPaint. | ora, openraster, krita, mypaint, gimp layers | File › Export as | Ready | 7 |  |
| file.export-animation | Animation from layers | Export animation | A moving GIF, PNG or WebP: each layer becomes one frame. | animation, animated gif, gif from layers, frames, apng, moving picture | File › Export as | Ready | 7 |  |
| file.export-layers | Save each layer as a file | Export layers | Save every layer as its own picture. | layers to files, separate layers | File | Planned | 7 |  |
| file.print | Print | Print | Print the picture on paper. | printer, paper | File | Planned | 8 |  |
| file.info | Picture details | File info | Title, author and copyright stored inside the file. | metadata, exif, copyright, author | File | Planned | 7 |  |
| file.batch | Edit many pictures the same way | Batch | Run the same steps on a folder of pictures. | bulk edit, many files | File › Automate | Planned | 13 |  |
| file.resize-many | Resize many pictures | Image processor | Resize and convert many files at once. | bulk resize, convert many | File › Automate | Planned | 13 |  |
| file.crop-scans | Split scanned photos | Crop and straighten photos | Cut several scanned photos into separate straight pictures. | scans, straighten scans | File › Automate | Planned | 13 |  |
| file.contact-sheet | Sheet of small photos | Contact sheet | Place many small pictures on one page. | grid of photos, photo sheet | File › Automate | Planned | 13 |  |
| file.scripts | Scripts | Scripts | Run small programs that edit pictures for you. | script, automation, code | File | Planned | 13 |  |

## Edit (28 Ready, 11 Planned)

Groups: Turn and flip · Transform; Settings · Preferences.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| edit.undo | Undo | Undo | Take back the last change. | undo, mistake, go back, oops | Edit | Ready | 1 | Ctrl+Z |
| edit.redo | Redo | Redo | Bring back a change you undid. | redo, again | Edit | Ready | 1 | Ctrl+Shift+Z |
| edit.history-back | Step back | Step backward | Go one step back in the History list. | previous step | Edit | Ready | W1 |  |
| edit.history-forward | Step forward | Step forward | Go one step forward in the History list. | next step | Edit | Ready | W1 |  |
| edit.history-brush-step | Paint back from this step | History brush source | Make the step you are at the one the history brush paints back; History marks it with a brush, and the brush beside any step picks that one. | paint back from step, history brush source, paint from here | Edit | Ready | W5 |  |
| edit.fade | Soften the last change | Fade | Make the last filter or paint change weaker. | weaker, fade, reduce effect | Edit | Planned | 13 |  |
| edit.cut | Cut | Cut | Move the selected part of this layer to the clipboard. | cut out | Edit | Ready | W1 | Ctrl+X |
| edit.copy | Copy | Copy | Copy the selected part of this layer. | copy | Edit | Ready | W1 | Ctrl+C |
| edit.copy-merged | Copy everything you see | Copy merged | Copy the selected area with all layers together. | copy visible, copy all layers | Edit | Ready | W1 | Ctrl+Shift+C |
| edit.paste | Paste as a new layer | Paste | Put what you copied on a new layer in the middle. | paste | Edit | Ready | W1 | Ctrl+V |
| edit.paste-in-place | Paste in the same spot | Paste in place | Paste exactly where it was copied from. | paste same place | Edit | Ready | W1 | Ctrl+Shift+V |
| edit.clear | Delete the selected pixels | Clear | Make the selected area of this layer see-through. | delete area, erase area, remove part | Edit | Ready | 1 | Delete |
| edit.fill | Fill with the main colour | Fill | Fill the selected area, or the whole layer, with your main colour. | paint area, colour fill, fill colour | Edit | Ready | W1 | Alt+Backspace |
| edit.fill-bg | Fill with the second colour | Fill with background colour | Fill the selected area, or the whole layer, with your second colour. | fill white, background colour | Edit | Ready | W1 | Ctrl+Backspace |
| edit.stroke | Outline the selection | Stroke | Draw a line along the edge of the selection. | border, outline | Edit | Ready | W3 |  |
| edit.smart-fill | Fill from the surroundings | Content-aware fill | Remove something by filling it from nearby pixels. | remove object, erase object, remove person | Edit | Planned | 11 |  |
| edit.free-transform | Resize and turn freely | Free transform | Scale, turn and move the layer with handles. | resize layer, scale, rotate layer | Edit | Ready | W3 | Ctrl+T |
| edit.flip-layer-h | Mirror left to right | Flip horizontal | Flip the active layer like a mirror. | mirror, flip sideways | Edit › Transform | Ready | W1 |  |
| edit.flip-layer-v | Flip top to bottom | Flip vertical | Flip the active layer upside down. | upside down | Edit › Transform | Ready | W1 |  |
| edit.rotate-layer-cw | Turn right 90° | Rotate 90° clockwise | Turn the active layer a quarter turn to the right. | rotate layer right | Edit › Transform | Ready | W1 |  |
| edit.rotate-layer-ccw | Turn left 90° | Rotate 90° counter-clockwise | Turn the active layer a quarter turn to the left. | rotate layer left | Edit › Transform | Ready | W1 |  |
| edit.rotate-layer-180 | Turn half way round | Rotate 180° | Turn the active layer half a turn. | rotate layer 180 | Edit › Transform | Ready | W1 |  |
| edit.scale | Resize the layer | Scale | Make the layer bigger or smaller with handles. | bigger, smaller | Edit › Transform | Ready | W3 |  |
| edit.rotate | Turn by any angle | Rotate | Turn the layer by any amount. | tilt, angle | Edit › Transform | Ready | W3 |  |
| edit.skew | Slant | Skew | Slant the layer sideways. | slant, italic | Edit › Transform | Ready | W3 |  |
| edit.distort | Pull corners freely | Distort | Move each corner on its own. | corner pin | Edit › Transform | Ready | W3 |  |
| edit.perspective | Fix the angle | Perspective | Make a slanted surface look straight on. | keystone | Edit › Transform | Ready | W3 |  |
| edit.warp | Bend | Warp | Bend the layer with a grid of handles. | bend, curve | Edit › Transform | Planned | 3 |  |
| edit.smart-scale | Stretch without squashing people | Content-aware scale | Resize while protecting the important parts. | stretch background | Edit | Planned | 11 |  |
| edit.pin-warp | Bend around pins | Puppet warp | Pin points and bend the shape around them. | pose, bend arm | Edit | Planned | 3 |  |
| edit.perspective-warp | Re-angle a building | Perspective warp | Change the angle of buildings and flat surfaces. | building angle | Edit | Planned | 3 |  |
| edit.auto-align | Line up photos automatically | Auto-align layers | Match overlapping photos of the same scene. | panorama, align | Edit | Planned | 13 |  |
| edit.auto-blend | Blend photos automatically | Auto-blend layers | Merge photos into one seamless picture. | focus stack, blend | Edit | Planned | 13 |  |
| edit.define-brush | Make a brush from the selection | Define brush | Save the selected area as a brush tip. | custom brush | Edit | Planned | 4 |  |
| edit.define-pattern | Make a pattern from the selection | Define pattern | Save the selected area as a repeating pattern. | custom pattern, texture | Edit | Planned | 4 |  |
| edit.pref-pro-names | Show pro names first | Pro names first | Put the usual professional names before the plain names. | expert names, professional names | Edit › Settings | Ready | W1 |  |
| edit.pref-hints | Show help lines | Tooltips | Show one plain line of help when you point at, focus or hold a control. | tips, hints, help text | Edit › Settings | Ready | W1 |  |
| edit.pref-theme | Light or dark look | Theme | Switch between the dark and the light look. | dark mode, light mode, theme | Edit › Settings | Ready | 1 |  |
| edit.pref-language | Language | Language | Use the editor in another language. | translate, hindi | Edit › Settings | Planned | 13 |  |

## Image (32 Ready, 13 Planned)

Groups: Colour type · Mode; Light and colour · Adjustments; Turn the picture · Image rotation.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| image.mode-gray | Shades of grey only | Grayscale | Store only shades of grey. | grey mode | Image › Mode | Planned | 13 |  |
| image.mode-indexed | A few colours only | Indexed colour | Limit the picture to a small palette, like a GIF. | palette, gif colours | Image › Mode | Planned | 13 |  |
| image.mode-cmyk | Printing colours | CMYK | Colours for printing presses. | print colours | Image › Mode | Planned | 13 |  |
| image.mode-lab | Lab colour | Lab colour | Colour described by lightness and two colour axes. | lab | Image › Mode | Planned | 13 |  |
| image.mode-16 | Finer colour steps | 16 bits per channel | Smoother gradients for heavy edits. | 16 bit, high bit depth | Image › Mode | Planned | 13 |  |
| image.adj-brightness | Brightness and contrast | Brightness/Contrast | Make the picture lighter or darker, and punchier or flatter. | brighter, darker, lighter, too dark, too bright, contrast, dull, dim | Image › Adjustments | Ready | 1 |  |
| image.adj-levels | Light and dark balance | Levels | Set the darkest point, the brightest point and the middle tones. | tones, black point, white point, washed out, histogram | Image › Adjustments | Ready | W1 | Ctrl+L |
| image.adj-curves | Tone curve | Curves | Shape the darks, middles and lights separately. | tone curve, s curve, contrast curve | Image › Adjustments | Ready | W1 | Ctrl+M |
| image.adj-exposure | Exposure | Exposure | Fix a photo that came out too dark or too bright, in camera stops. | underexposed, overexposed, dark photo, stops | Image › Adjustments | Ready | W1 |  |
| image.adj-vibrance | Colour boost | Vibrance | Make dull colours richer without overdoing the strong ones. | pop, vivid, more colour, saturate, punchy | Image › Adjustments | Ready | W1 |  |
| image.adj-hue | Colour, strength and lightness | Hue/Saturation | Change colours, or make them stronger or weaker. | change colour, saturation, hue, recolour | Image › Adjustments | Ready | 1 | Ctrl+U |
| image.adj-color-balance | Colour tint | Colour balance | Push the darks, middles or lights toward a colour. | warm, cool, tint, colour cast, too yellow, too blue | Image › Adjustments | Ready | W1 | Ctrl+B |
| image.adj-bw | Black and white | Black & white | Make the picture grey, choosing how bright each colour becomes. | grey, monochrome, grayscale, no colour, black and white | Image › Adjustments | Ready | 1 | Ctrl+Shift+Alt+B |
| image.adj-photo-filter | Lens colour filter | Photo filter | Warm or cool the picture like a coloured filter on the lens. | warm up, cool down, sepia, filter | Image › Adjustments | Ready | W1 |  |
| image.adj-channel-mixer | Colour channel mix | Channel mixer | Rebuild each colour channel from the others. | channels, infrared look | Image › Adjustments | Ready | W1 |  |
| image.adj-color-lookup | Colour look | Colour lookup | Apply a ready-made colour look from a LUT file. | lut, film look, preset look | Image › Adjustments | Planned | 5 |  |
| image.adj-invert | Negative | Invert | Swap every colour for its opposite. | negative, invert colours, opposite | Image › Adjustments | Ready | 1 | Ctrl+I |
| image.adj-posterize | Fewer tones | Posterize | Reduce the picture to a few flat tones. | poster, cartoon, flat colours | Image › Adjustments | Ready | W1 |  |
| image.adj-threshold | Pure black and white | Threshold | Every pixel becomes black or white. | stencil, two colours | Image › Adjustments | Ready | W1 |  |
| image.adj-gradient-map | Colour by brightness | Gradient map | Paint the darks and lights with chosen colours. | duotone, two tone, sepia | Image › Adjustments | Ready | W1 |  |
| image.adj-selective-color | Change one colour family | Selective colour | Adjust only the reds, the blues, the greys and so on. | change one colour, only reds, skin tone | Image › Adjustments | Ready | W1 |  |
| image.adj-shadows | Lift shadows, calm highlights | Shadows/Highlights | Brighten dark areas and tame bright ones, judged by their surroundings. | backlit, dark face, recover shadows, bright sky | Image › Adjustments | Ready | W1 |  |
| image.adj-desaturate | Remove colour | Desaturate | Make the picture grey in one step. | grey, colourless | Image › Adjustments | Ready | W1 | Ctrl+Shift+U |
| image.adj-match | Match another photo's colour | Match colour | Copy the colour mood of another picture. | match colours | Image › Adjustments | Planned | 5 |  |
| image.adj-replace | Replace a colour | Replace colour | Swap one colour for another. | swap colour | Image › Adjustments | Planned | 5 |  |
| image.adj-equalize | Even out the tones | Equalize | Spread the tones evenly from dark to light. | flat, even, histogram | Image › Adjustments | Ready | W1 |  |
| image.auto-tone | Fix the light automatically | Auto tone | Stretch each colour so the darkest part is black and the lightest white. | auto fix, one click, enhance, improve | Image | Ready | W1 | Ctrl+Shift+L |
| image.auto-contrast | Fix the contrast automatically | Auto contrast | Stretch the contrast without changing the colours. | auto contrast, flat photo | Image | Ready | W1 | Ctrl+Shift+Alt+L |
| image.auto-color | Fix the colour automatically | Auto colour | Remove a colour cast automatically. | white balance, colour cast, auto colour | Image | Ready | W1 | Ctrl+Shift+B |
| image.size | Picture size | Image size | Change the width and height in pixels; the picture is redrawn to fit. | resize, smaller, bigger, scale, dimensions, for the web, email size | Image | Ready | W1 | Ctrl+Alt+I |
| image.canvas-size | Canvas size | Canvas size | Add or remove space around the picture without stretching it. | border, padding, frame, extend, more space | Image | Ready | W1 | Ctrl+Alt+C |
| image.rotate-cw | Turn right 90° | Rotate 90° clockwise | Turn the whole picture a quarter turn to the right. | rotate, sideways photo, portrait | Image › Rotate | Ready | W1 |  |
| image.rotate-ccw | Turn left 90° | Rotate 90° counter-clockwise | Turn the whole picture a quarter turn to the left. | rotate left | Image › Rotate | Ready | W1 |  |
| image.rotate-180 | Turn half way round | Rotate 180° | Turn the whole picture upside down. | upside down | Image › Rotate | Ready | W1 |  |
| image.rotate-any | Turn by any angle | Arbitrary rotation | Straighten a tilted horizon by any angle. | straighten, horizon, tilted | Image › Rotate | Planned | 3 |  |
| image.flip-h | Mirror the picture | Flip canvas horizontal | Mirror the whole picture left to right. | mirror, selfie flip | Image › Rotate | Ready | W1 |  |
| image.flip-v | Flip the picture upside down | Flip canvas vertical | Mirror the whole picture top to bottom. | reflection | Image › Rotate | Ready | W1 |  |
| image.crop | Cut to the selection | Crop | Keep only the selected area. | crop, cut out, trim | Image | Ready | 1 |  |
| image.trim | Cut away empty edges | Trim | Remove see-through or same-colour edges. | remove border, auto crop, white edges | Image | Ready | W1 |  |
| image.reveal-all | Show the parts outside | Reveal all | Grow the canvas so every layer fits. | expand, show hidden parts | Image | Ready | W1 |  |
| image.duplicate | Copy into a new tab | Duplicate | Open a copy of the picture in a new tab. | copy picture, try a version | Image | Ready | W1 |  |
| image.apply | Blend a layer into itself | Apply image | Blend a layer or channel into the active layer. | apply image | Image | Planned | 13 |  |
| image.reduce-colors | Use fewer colours | Reduce colours | Limit the picture to a set number of colours. | palette, fewer colours | Image | Planned | 5 |  |
| image.vectorize | Turn into shapes | Vectorize | Trace the picture into vector shapes. | trace, svg | Image | Planned | 6 |  |
| image.variables | Data-driven pictures | Variables | Make many versions from a data file. | template, data merge | Image | Planned | 13 |  |

## Layer (24 Ready, 42 Planned)

Groups: New layer · New; Shadows, glows and outlines · Layer style; Colour layer · Fill layer; Editable light and colour · Adjustment layer; Hide parts · Mask; Smart layer · Smart object; Order · Arrange; Line up · Align.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| layer.new | New empty layer | New layer | A clear sheet on top to paint on without touching the photo. | add layer, blank layer, transparent layer | Layer › New | Ready | 1 | Ctrl+Shift+N |
| layer.new-copy | Layer from a copy | Layer via copy | Copy the selected area, or the whole layer, to a new layer. | copy to layer | Layer › New | Ready | W1 | Ctrl+J |
| layer.new-cut | Layer from a cut | Layer via cut | Move the selected area to a new layer. | cut to layer, separate part | Layer › New | Ready | W1 | Ctrl+Shift+J |
| layer.new-group | Folder of layers | Group | Keep layers together in a folder. | group, folder | Layer › New | Planned | 3 | Ctrl+G |
| layer.duplicate | Duplicate layer | Duplicate layer | Make an exact copy of the active layer. | copy layer, clone layer | Layer | Ready | 1 |  |
| layer.delete | Delete layer | Delete layer | Remove the active layer. | remove layer | Layer | Ready | 1 |  |
| layer.rename | Rename layer | Rename | Give the active layer a clear name. | name layer | Layer | Ready | W1 |  |
| layer.fx-shadow | Drop shadow | Drop shadow | A soft shadow behind the layer. | shadow | Layer › Layer effects | Planned | 3 |  |
| layer.fx-inner-shadow | Inner shadow | Inner shadow | A shadow inside the edges, so it looks pressed in. | inset | Layer › Layer effects | Planned | 3 |  |
| layer.fx-outer-glow | Outer glow | Outer glow | A soft light around the outside. | glow | Layer › Layer effects | Planned | 3 |  |
| layer.fx-inner-glow | Inner glow | Inner glow | A soft light inside the edges. | glow inside | Layer › Layer effects | Planned | 3 |  |
| layer.fx-bevel | Raised edge | Bevel and emboss | Make the layer look raised or carved. | 3d edge | Layer › Layer effects | Planned | 3 |  |
| layer.fx-satin | Satin sheen | Satin | A silky shine across the layer. | sheen | Layer › Layer effects | Planned | 3 |  |
| layer.fx-color | Colour overlay | Colour overlay | Cover the layer with one colour. | tint layer | Layer › Layer effects | Planned | 3 |  |
| layer.fx-gradient | Gradient overlay | Gradient overlay | Cover the layer with a colour fade. | fade overlay | Layer › Layer effects | Planned | 3 |  |
| layer.fx-pattern | Pattern overlay | Pattern overlay | Cover the layer with a pattern. | texture overlay | Layer › Layer effects | Planned | 3 |  |
| layer.fx-stroke | Outline | Stroke | Draw a coloured outline around the layer. | outline text, border | Layer › Layer effects | Planned | 3 |  |
| layer.fill-color | Solid colour layer | Solid colour | A layer of one colour you can change at any time. | colour layer | Layer › Fill layer | Planned | 3 |  |
| layer.fill-gradient | Colour fade layer | Gradient fill | A colour fade you can change at any time. | gradient layer | Layer › Fill layer | Planned | 3 |  |
| layer.fill-pattern | Pattern layer | Pattern fill | A repeating pattern you can change at any time. | pattern layer | Layer › Fill layer | Planned | 3 |  |
| layer.adj-brightness | Brightness and contrast layer | Brightness/Contrast layer | Brightness and contrast that stay editable. | editable brightness | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-levels | Light and dark balance layer | Levels layer | Levels that stay editable. | editable levels | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-curves | Tone curve layer | Curves layer | Curves that stay editable. | editable curves | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-exposure | Exposure layer | Exposure layer | Exposure that stays editable. | editable exposure | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-vibrance | Colour boost layer | Vibrance layer | Vibrance that stays editable. | editable vibrance | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-hue | Colour and strength layer | Hue/Saturation layer | Hue and saturation that stay editable. | editable hue | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-color-balance | Colour tint layer | Colour balance layer | Colour balance that stays editable. | editable colour balance | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-bw | Black and white layer | Black & white layer | Black and white that stays editable. | editable black and white | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-photo-filter | Lens filter layer | Photo filter layer | A photo filter that stays editable. | editable filter | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-channel-mixer | Channel mix layer | Channel mixer layer | A channel mix that stays editable. | editable channels | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-color-lookup | Colour look layer | Colour lookup layer | A colour look that stays editable. | editable lut | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-invert | Negative layer | Invert layer | A negative that you can switch off. | editable invert | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-posterize | Fewer tones layer | Posterize layer | Posterize that stays editable. | editable posterize | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-threshold | Black and white split layer | Threshold layer | A threshold that stays editable. | editable threshold | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-gradient-map | Colour by brightness layer | Gradient map layer | A gradient map that stays editable. | editable gradient map | Layer › Adjustment layer | Planned | 3 |  |
| layer.adj-selective-color | One colour family layer | Selective colour layer | Selective colour that stays editable. | editable selective colour | Layer › Adjustment layer | Planned | 3 |  |
| layer.mask-add | Hide parts with a mask | Add layer mask | Paint black to hide and white to show, without deleting pixels. | mask, hide part, non destructive | Layer › Mask | Planned | 2 |  |
| layer.mask-from-sel | Mask from the selection | Reveal selection | Show only the selected part of the layer. | mask selection | Layer › Mask | Planned | 2 |  |
| layer.mask-apply | Make the mask permanent | Apply mask | Erase what the mask hides. | apply mask | Layer › Mask | Planned | 2 |  |
| layer.mask-delete | Remove the mask | Delete mask | Throw the mask away and show the whole layer. | delete mask | Layer › Mask | Planned | 2 |  |
| layer.vector-mask | Shape mask | Vector mask | Hide parts with a sharp-edged shape. | shape mask | Layer › Mask | Planned | 6 |  |
| layer.clip | Show only inside the layer below | Create clipping mask | Show this layer only where the layer below has pixels. | clip, picture inside text | Layer › Mask | Planned | 2 | Ctrl+Alt+G |
| layer.smart-convert | Make a smart layer | Convert to smart object | Keep the layer's original pixels safe from resizing. | smart object | Layer › Smart layer | Planned | 3 |  |
| layer.smart-edit | Edit the contents | Edit contents | Open the original pixels to change them. | edit smart object | Layer › Smart layer | Planned | 3 |  |
| layer.smart-replace | Replace the contents | Replace contents | Swap the contents for another picture. | mockup | Layer › Smart layer | Planned | 3 |  |
| layer.smart-rasterize | Turn back into pixels | Rasterize smart object | Make the smart layer an ordinary layer. | rasterize | Layer › Smart layer | Planned | 3 |  |
| layer.rasterize | Turn into plain pixels | Rasterize layer | Make text, shapes or effects into ordinary pixels. | flatten text | Layer | Ready | W3 |  |
| layer.front | Bring to the very top | Bring to front | Move the active layer above all others. | top layer | Layer › Arrange | Ready | W1 | Ctrl+Shift+] |
| layer.forward | Bring up one | Bring forward | Move the active layer up one place. | move layer up | Layer › Arrange | Ready | 1 | Ctrl+] |
| layer.backward | Send down one | Send backward | Move the active layer down one place. | move layer down | Layer › Arrange | Ready | 1 | Ctrl+[ |
| layer.back | Send to the very bottom | Send to back | Move the active layer below all others. | bottom layer | Layer › Arrange | Ready | W1 | Ctrl+Shift+[ |
| layer.align-left | Line up left edges | Align left edges | Move the layer so its left edge meets the selection's, or the picture's. | align left, line up left | Layer › Align | Ready | W3 |  |
| layer.align-hcenter | Line up centres across | Align horizontal centers | Centre the layer from side to side on the selection or the picture. | centre horizontally, center | Layer › Align | Ready | W3 |  |
| layer.align-right | Line up right edges | Align right edges | Move the layer so its right edge meets the selection's, or the picture's. | align right | Layer › Align | Ready | W3 |  |
| layer.align-top | Line up top edges | Align top edges | Move the layer so its top meets the selection's, or the picture's. | align top | Layer › Align | Ready | W3 |  |
| layer.align-vcenter | Line up middles | Align vertical centers | Centre the layer from top to bottom on the selection or the picture. | centre vertically, middle | Layer › Align | Ready | W3 |  |
| layer.align-bottom | Line up bottom edges | Align bottom edges | Move the layer so its bottom meets the selection's, or the picture's. | align bottom | Layer › Align | Ready | W3 |  |
| layer.distribute-h | Space out across | Distribute horizontal centers | Space three or more layers evenly from left to right. | space evenly, distribute | Layer › Align | Ready | W3 |  |
| layer.distribute-v | Space out down | Distribute vertical centers | Space three or more layers evenly from top to bottom. | space evenly vertically | Layer › Align | Ready | W3 |  |
| layer.lock | Lock the layer | Lock all | Protect the active layer from changes. | lock, protect, freeze | Layer | Ready | W1 | Ctrl+/ |
| layer.hide | Hide the layer | Hide layers | Hide the active layer without deleting it; choose again to show it. | hide, show, eye | Layer | Ready | W1 | Ctrl+, |
| layer.merge-down | Merge into the layer below | Merge down | Combine the active layer with the one under it. | combine layers, merge | Layer | Ready | W1 | Ctrl+E |
| layer.merge-visible | Merge the shown layers | Merge visible | Combine every shown layer into one. | combine visible | Layer | Ready | W1 | Ctrl+Shift+E |
| layer.flatten | Flatten into one layer | Flatten image | Combine all layers into one on white. | flatten, single layer | Layer | Ready | W1 |  |
| layer.defringe | Clean up edge colour | Defringe | Remove coloured halos around cut-outs. | halo, fringe | Layer | Planned | 2 |  |
| layer.frames | Make animation frames | Make frames from layers | Turn each layer into a frame of an animation. | gif animation, frames | Layer | Planned | 13 |  |

## Type (3 Ready, 7 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| type.add | Add text | Horizontal type | Click on the picture and type words. | text, words, caption, title, write, quote | Type | Ready | W3 |  |
| type.add-vertical | Add up-down text | Vertical type | Text that runs from top to bottom. | vertical text | Type | Planned | 6 |  |
| type.fonts | Choose a font | Font | Pick the typeface for your text. | font, typeface | Type | Ready | W3 |  |
| type.warp | Bend text | Warp text | Arc, wave or bulge the text. | curved text, arc text, wavy text | Type | Planned | 6 |  |
| type.path | Text along a line | Type on a path | Make text follow a curve or a circle. | text on circle | Type | Planned | 6 |  |
| type.to-shape | Turn text into a shape | Convert to shape | Make the letters into editable shapes. | outline text | Type | Planned | 6 |  |
| type.rasterize | Turn text into pixels | Rasterize type | Make text into ordinary pixels. | flatten text | Type | Ready | W3 |  |
| type.smooth | Smooth text edges | Anti-aliasing | Choose how soft the edges of letters are. | jagged text | Type | Planned | 6 |  |
| type.spell | Check spelling | Check spelling | Find spelling mistakes in your text. | spelling | Type | Planned | 6 |  |
| type.find | Find and replace text | Find and replace | Change a word everywhere at once. | replace word | Type | Planned | 6 |  |

## Select (16 Ready, 4 Planned)

Groups: Change the selection · Modify.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| select.all | Select everything | Select all | Select the whole picture. | everything, whole picture | Select | Ready | 1 | Ctrl+A |
| select.none | Select nothing | Deselect | Drop the selection, so changes apply everywhere. | deselect, clear selection, unselect | Select | Ready | 1 | Ctrl+D |
| select.reselect | Bring back the last selection | Reselect | Select again what you had selected before. | previous selection | Select | Ready | W1 | Ctrl+Shift+D |
| select.inverse | Swap selected and not selected | Inverse | Select everything except what is selected now. | invert selection, opposite, background | Select | Ready | W1 | Ctrl+Shift+I |
| select.subject | Select the main subject | Subject | Find the person or thing in front automatically. | person, subject, auto select | Select | Planned | 11 |  |
| select.remove-bg | Remove the background | Remove background | Keep the subject and clear everything behind it. | background removal, cut out, transparent background, remove backdrop | Select | Planned | 11 |  |
| select.color-range | Select by colour | Colour range | Select every pixel close to a colour, like the sky. | select sky, select colour | Select | Ready | W3 |  |
| select.focus | Select the sharp parts | Focus area | Select what is in focus and leave the blurry parts. | in focus | Select | Planned | 11 |  |
| select.refine | Smooth the selection edge | Refine edge | Tidy up hair and soft edges of a selection. | hair, fur, edge | Select | Planned | 2 |  |
| select.border | Edge band | Border | Select a band along the selection edge. | border selection | Select › Modify | Ready | W3 |  |
| select.smooth | Round off | Smooth | Round off sharp corners of the selection. | smooth selection | Select › Modify | Ready | W3 |  |
| select.expand | Grow by pixels | Expand | Make the selection bigger by a number of pixels. | bigger selection | Select › Modify | Ready | W3 |  |
| select.contract | Shrink by pixels | Contract | Make the selection smaller by a number of pixels. | smaller selection | Select › Modify | Ready | W3 |  |
| select.feather | Soften the edge | Feather | Make the selection fade out gently at its edge. | soft edge, feather | Select › Modify | Ready | W3 | Shift+F6 |
| select.grow | Grow into similar colours | Grow | Add nearby pixels of similar colour. | grow | Select | Ready | W3 |  |
| select.similar | Select similar colours everywhere | Similar | Add every pixel in the picture of a similar colour. | similar | Select | Ready | W3 |  |
| select.transform | Resize the selection | Transform selection | Change the size and angle of the selection. | resize selection | Select | Ready | W3 |  |
| select.quick-mask | Paint a selection | Quick mask | Paint where to select, then switch back to a selection. | paint selection | Select | Ready | W3 | Q |
| select.save | Save the selection | Save selection | Keep the selection to use again later. | store selection | Select | Ready | W3 |  |
| select.load | Load a saved selection | Load selection | Bring back a saved selection. | load selection | Select | Ready | W3 |  |

## Filter (56 Ready, 13 Planned)

Groups: Blur · Blur; Camera blurs · Blur gallery; Bend and twist · Distort; Grain · Noise; Blocks and dots · Pixelate; Make patterns · Render; Sharpen · Sharpen; Graphic effects · Stylize; More effects · Other.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| filter.last | Repeat the last effect | Last filter | Run the last effect again with the same settings. | again, repeat effect | Filter | Ready | W1 | Ctrl+Alt+F |
| filter.gallery | Artistic effects | Filter gallery | Try painterly effects with a big preview. | painting effect, sketch | Filter | Planned | W2 |  |
| filter.lens | Fix lens problems | Lens correction | Straighten bulging lines and lighten dark corners. | distortion, vignette, fisheye | Filter | Planned | W2 |  |
| filter.raw | Develop a photo | Raw develop | Every photo control in one place, as for camera RAW files. | raw, develop, camera raw | Filter | Planned | 5 |  |
| filter.liquify | Push pixels like liquid | Liquify | Gently push, bloat or pinch parts of the picture. | reshape, slim, liquify | Filter | Planned | 5 |  |
| filter.perspective-plane | Paint in perspective | Perspective plane | Copy and paint along walls and floors in perspective. | vanishing point | Filter | Planned | 5 |  |
| filter.blur-gaussian | Smooth blur | Gaussian blur | An even, soft blur over the selected area or the whole layer. | blur, soften, smooth, out of focus, blurry | Filter › Blur | Ready | 1 |  |
| filter.blur-box | Box blur | Box blur | A blur that averages square blocks. | box blur | Filter › Blur | Ready | W2 |  |
| filter.blur-motion | Movement blur | Motion blur | Streak the picture as if it moved. | speed, motion | Filter › Blur | Ready | W2 |  |
| filter.blur-radial | Spin or zoom blur | Radial blur | Blur in circles or toward a centre. | zoom blur, spin | Filter › Blur | Ready | W2 |  |
| filter.blur-surface | Skin smoothing blur | Surface blur | Smooth flat areas and keep edges sharp. | smooth skin, airbrush | Filter › Blur | Ready | W2 |  |
| filter.blur-lens | Camera lens blur | Lens blur | A blur that looks like a real camera lens. | bokeh | Filter › Blur | Ready | W2 |  |
| filter.blur-average | Average colour | Average | Fill the area with its average colour. | average | Filter › Blur | Ready | W2 |  |
| filter.blur-smart | Edge-aware blur | Smart blur | Blur everything except sharp edges. | smart blur | Filter › Blur | Ready | W2 |  |
| filter.blur-field | Gradual blur | Field blur | Blur that changes smoothly across the picture. | gradual blur | Filter › Camera blurs | Ready | W2 |  |
| filter.blur-iris | Blur around a spot | Iris blur | Keep one spot sharp and blur everything around it. | blur the background, background blur, portrait mode, bokeh | Filter › Camera blurs | Ready | W2 |  |
| filter.blur-tilt | Miniature effect | Tilt-shift | Keep a band sharp so the scene looks like a model. | miniature, tilt shift | Filter › Camera blurs | Ready | W2 |  |
| filter.blur-path | Blur along a path | Path blur | Blur along a line you draw. | path blur | Filter › Camera blurs | Planned | W2 |  |
| filter.blur-spin | Spinning blur | Spin blur | Make wheels and fans look like they spin. | wheels | Filter › Camera blurs | Planned | W2 |  |
| filter.displace | Push by a map | Displace | Push pixels around by a pattern of light and dark, such as soft clouds. | displacement, warp, distort | Filter › Distort | Ready | W2 |  |
| filter.pinch | Pinch | Pinch | Squeeze the middle inwards or outwards. | pinch | Filter › Distort | Ready | W2 |  |
| filter.polar | Wrap into a circle | Polar coordinates | Wrap the picture into a circle or unwrap it. | tiny planet | Filter › Distort | Ready | W2 |  |
| filter.ripple | Ripples | Ripple | Add ripples like water. | water ripple | Filter › Distort | Ready | W2 |  |
| filter.shear | Bend sideways | Shear | Bend the picture along a curve. | shear | Filter › Distort | Ready | W2 |  |
| filter.spherize | Bulge | Spherize | Bulge the picture like a ball. | bulge, fisheye | Filter › Distort | Ready | W2 |  |
| filter.twirl | Swirl | Twirl | Swirl the middle round. | swirl | Filter › Distort | Ready | W2 |  |
| filter.wave | Waves | Wave | Bend the picture in waves. | wavy | Filter › Distort | Ready | W2 |  |
| filter.zigzag | Rings in water | Zigzag | Ripple outwards like a stone in a pond. | pond ripple | Filter › Distort | Ready | W2 |  |
| filter.glass | Behind glass | Glass | Look through textured glass. | frosted glass | Filter › Distort | Planned | W2 |  |
| filter.ocean-ripple | Under water | Ocean ripple | Look through rippling water. | underwater | Filter › Distort | Planned | W2 |  |
| filter.add-noise | Add grain | Add noise | Add film-like grain. | grain, film grain | Filter › Noise | Ready | W2 |  |
| filter.despeckle | Remove specks | Despeckle | Remove tiny specks and keep edges. | specks | Filter › Noise | Ready | W2 |  |
| filter.dust | Remove dust and scratches | Dust and scratches | Hide small dust spots and scratches. | dust, scratches, old photo | Filter › Noise | Ready | W2 |  |
| filter.median | Smooth out specks | Median | Replace each pixel with the middle value nearby. | median | Filter › Noise | Ready | W2 |  |
| filter.reduce-noise | Reduce grain | Reduce noise | Smooth away camera grain from dark photos. | denoise, grainy photo | Filter › Noise | Ready | W2 |  |
| filter.halftone | Print dots | Colour halftone | Make the picture out of printing dots. | comic dots | Filter › Pixelate | Ready | W2 |  |
| filter.crystallize | Crystals | Crystallize | Break the picture into crystal shapes. | crystals | Filter › Pixelate | Ready | W2 |  |
| filter.facet | Painted look | Facet | Group similar pixels into flat patches. | facet | Filter › Pixelate | Ready | W2 |  |
| filter.fragment | Shaky copies | Fragment | Overlay four shifted copies. | shaky | Filter › Pixelate | Ready | W2 |  |
| filter.mezzotint | Engraved dots | Mezzotint | Turn tones into random dots and lines. | engraving | Filter › Pixelate | Ready | W2 |  |
| filter.mosaic | Blocks | Mosaic | Turn the picture into big square blocks. | pixelate, censor, hide face | Filter › Pixelate | Ready | W2 |  |
| filter.pointillize | Painted dots | Pointillize | Paint the picture with coloured dots. | dots | Filter › Pixelate | Ready | W2 |  |
| filter.clouds | Clouds | Clouds | Fill with soft clouds in your two colours. | sky texture | Filter › Render | Ready | W2 |  |
| filter.difference-clouds | Marbled clouds | Difference clouds | Blend clouds into the picture for a marbled look. | marble | Filter › Render | Ready | W2 |  |
| filter.fibers | Fibres | Fibers | Draw a woven fibre texture. | fabric | Filter › Render | Ready | W2 |  |
| filter.lens-flare | Light flare | Lens flare | Add a bright camera flare. | sun flare | Filter › Render | Planned | W2 |  |
| filter.lighting | Spotlights | Lighting effects | Light the picture with spotlights. | spotlight | Filter › Render | Planned | W2 |  |
| filter.sharpen | Sharpen a little | Sharpen | Make edges a little crisper, with a preview before you apply. | crisp, sharp, blurry photo, focus | Filter › Sharpen | Ready | W1 |  |
| filter.sharpen-more | Sharpen more | Sharpen more | Make edges clearly crisper, with a preview before you apply. | sharper | Filter › Sharpen | Ready | W1 |  |
| filter.unsharp | Sharpen with control | Unsharp mask | Choose how strong and how wide the sharpening is. | sharpen detail, crisp | Filter › Sharpen | Ready | 1 |  |
| filter.sharpen-edges | Sharpen only the edges | Sharpen edges | Sharpen edges and leave smooth areas alone. | edges | Filter › Sharpen | Ready | W2 |  |
| filter.smart-sharpen | Smart sharpen | Smart sharpen | Sharpen with less halo and noise. | smart sharpen | Filter › Sharpen | Ready | W2 |  |
| filter.diffuse | Scatter | Diffuse | Scatter the pixels for a frosted look. | scatter | Filter › Stylize | Ready | W2 |  |
| filter.emboss | Stamped metal | Emboss | Make the picture look pressed into metal. | emboss | Filter › Stylize | Ready | W2 |  |
| filter.extrude | 3D blocks | Extrude | Push the picture out into 3D blocks. | blocks | Filter › Stylize | Ready | W2 |  |
| filter.find-edges | Outline drawing | Find edges | Keep only the outlines, like a sketch. | sketch, outline, line drawing | Filter › Stylize | Ready | W2 |  |
| filter.oil-paint | Oil painting | Oil paint | Make the picture look painted with oils. | painting, oil | Filter › Stylize | Ready | W2 |  |
| filter.solarize | Half negative | Solarize | Mix the picture with its negative. | solarize | Filter › Stylize | Ready | W2 |  |
| filter.tiles | Tiles | Tiles | Break the picture into tiles. | tiles | Filter › Stylize | Ready | W2 |  |
| filter.trace-contour | Contour lines | Trace contour | Draw lines along areas of the same brightness. | contour | Filter › Stylize | Ready | W2 |  |
| filter.wind | Wind streaks | Wind | Blow streaks across the picture. | wind | Filter › Stylize | Ready | W2 |  |
| filter.glowing-edges | Glowing outlines | Glowing edges | Turn the outlines into bright, neon-like lines on black. | neon, glow, glowing lines, neon outline | Filter › Stylize | Ready | W2 |  |
| filter.high-pass | Keep only the detail | High pass | Grey picture of just the edges, used for sharpening. | high pass | Filter › Other | Ready | W2 |  |
| filter.maximum | Grow light areas | Maximum | Spread the light areas outwards. | maximum | Filter › Other | Ready | W2 |  |
| filter.minimum | Grow dark areas | Minimum | Spread the dark areas outwards. | minimum | Filter › Other | Ready | W2 |  |
| filter.offset | Shift and wrap | Offset | Slide the picture and wrap it round the edges. | seamless tile | Filter › Other | Ready | W2 |  |
| filter.custom | Your own filter | Custom | Type in your own blur or sharpen numbers. | kernel | Filter › Other | Ready | W2 |  |
| filter.color-to-alpha | Make a colour see-through | Colour to alpha | Turn one colour transparent, like a white background. | remove white, transparent | Filter › Other | Planned | W2 |  |
| filter.dither | Dither | Dither | Fake extra colours with patterns of dots. | dither | Filter › Other | Planned | W2 |  |

## View (11 Ready, 7 Planned)

Groups: Screen mode · Screen mode.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| view.zoom-in | Zoom in | Zoom in | Look closer. | bigger view, magnify | View | Ready | 1 | Ctrl+= |
| view.zoom-out | Zoom out | Zoom out | See more of the picture. | smaller view | View | Ready | 1 | Ctrl+- |
| view.fit | Fit on screen | Fit on screen | Show the whole picture as large as fits. | whole picture, fit | View | Ready | 1 | Ctrl+0 |
| view.actual | Actual pixels | 100% | One picture pixel per screen pixel. | real size, 100 | View | Ready | 1 | Ctrl+1 |
| view.zoom-200 | Double size | 200% | Two screen pixels per picture pixel. | 200 | View | Ready | W1 |  |
| view.print-size | Print size | Print size | Show the picture at the size it would print. | print preview | View | Planned | 8 |  |
| view.screen-standard | Normal workspace | Standard screen mode | Show the menus, tools and panels. | normal view | View › Screen mode | Ready | W1 |  |
| view.screen-focus | Picture only | Full screen mode | Hide the tools and panels to see just the picture. Press F or Esc to come back. | full screen, distraction free | View › Screen mode | Ready | W1 |  |
| view.screen-cycle | Switch screen mode | Cycle screen mode | Switch between the normal workspace and picture only. | toggle full screen | View › Screen mode | Ready | W1 | F |
| view.rulers | Rulers | Rulers | Show measuring rulers along the edges of the picture. | measure, ruler | View | Ready | W1 | Ctrl+R |
| view.grid | Grid | Grid | Show a grid over the picture to line things up. | grid, align, straight lines | View | Ready | W1 | Ctrl+' |
| view.extras | Selection outline | Extras | Show or hide the moving dashes around a selection. | marching ants | View | Ready | W1 | Ctrl+H |
| view.pixel-grid | Pixel grid | Pixel grid | Show the edge of each pixel when zoomed far in. | pixel grid | View | Planned | W2 |  |
| view.guide-new | Add a guide line | New guide | Add a straight line to line things up against. | guide | View | Planned | 13 |  |
| view.guide-clear | Remove guide lines | Clear guides | Remove all guide lines. | clear guides | View | Planned | 13 |  |
| view.guide-lock | Lock guide lines | Lock guides | Stop guide lines from moving. | lock guides | View | Planned | 13 |  |
| view.snap | Snap to guides | Snap | Make moved things jump to guides and edges. | snap | View | Planned | 13 |  |
| view.slices-clear | Remove slices | Clear slices | Remove the web slices. | slices | View | Planned | 13 |  |

## Window (2 Ready, 0 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| window.reset | Reset the workspace | Reset workspace | Put every panel back where it started. | default layout | Window | Ready | W1 |  |
| window.collapse | Fold away all panels | Collapse panels | Fold every panel group down to its title. | tidy panels | Window | Ready | W1 |  |

## Help (6 Ready, 1 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| help.start | What do you want to do? | Start screen | Pick a job and the editor opens the right tool for you. | start, how to, beginner, help me | Help | Ready | W1 |  |
| help.search | Search for a command | Search | Type what you want, like "make it brighter". | find, search, command | Help | Ready | W1 | Ctrl+K |
| help.shortcuts | Keyboard shortcuts | Keyboard shortcuts | Every shortcut key in one list. | keys, hotkeys | Help | Ready | 1 |  |
| help.guided | Guided jobs | Guided jobs | Step-by-step help on the real controls. | tutorial, learn, lesson | Help | Planned | W4 |  |
| help.about | About Free Photo Editor | About | Version, licence and the people behind it. | about, licence, credits | Help | Ready | 1 |  |
| help.source | Source code | Source code | Open this editor's code on GitHub. | github, open source | Help | Ready | 1 |  |
| help.report | Report a problem | Report a bug | Tell the maker what went wrong. | bug, issue, feedback | Help | Ready | W1 |  |

## Panels (Window menu and the dock) (10 Ready, 12 Planned)

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| panel.layers | Layers | Layers | The stack of sheets your picture is made of; upper sheets cover lower ones. | layers, stack, sheets | Window | Ready | 1 | F7 |
| panel.history | History | History | Every step you took; pick one to go back to it. | steps, undo list | Window | Ready | W1 |  |
| panel.properties | Properties | Properties | Name, position, size, opacity and blend of the active layer. | settings, details | Window | Ready | W1 |  |
| panel.adjustments | Light and colour | Adjustments | Every light and colour fix, one tap away. | fixes, adjustments | Window | Ready | W1 |  |
| panel.color | Colour | Colour | Pick your main and second colours. | colour picker, choose colour | Window | Ready | W1 | F6 |
| panel.swatches | Swatches | Swatches | Ready-made colours to pick with one tap. | palette, colours | Window | Ready | W1 |  |
| panel.navigator | Navigator | Navigator | A small view of the whole picture; drag the box to move around. | overview, minimap | Window | Ready | W1 |  |
| panel.info | Info | Info | Position and colour under the pointer, and the picture's size. | coordinates, rgb values, pixel colour | Window | Ready | W1 | F8 |
| panel.channels | Colour channels | Channels | See the red, green, blue and see-through channels one by one. | channels | Window | Planned | 2 |  |
| panel.paths | Paths | Paths | Outlines you drew with the pen. | paths | Window | Planned | 6 |  |
| panel.character | Text style | Character | Font, size and spacing of text. | font size | Window | Ready | W3 |  |
| panel.paragraph | Paragraph | Paragraph | Line-up and spacing of text blocks. | align text | Window | Ready | W3 |  |
| panel.brushes | Brush tips | Brushes | Choose and shape brush tips. | brush shapes | Window | Planned | 4 |  |
| panel.histogram | Tone graph | Histogram | A graph of how many dark and light pixels there are. | histogram | Window | Planned | W2 |  |
| panel.actions | Recorded steps | Actions | Record steps and play them back. | macro, record | Window | Planned | 13 |  |
| panel.styles | Saved effects | Styles | Effects you saved to use again. | styles | Window | Planned | 3 |  |
| panel.tool-presets | Saved tool settings | Tool presets | Tool settings you saved to use again. | presets | Window | Planned | 4 |  |
| panel.glyphs | Special characters | Glyphs | Symbols and letters not on your keyboard. | symbols | Window | Planned | 6 |  |
| panel.notes | Notes | Notes | Notes you pinned on the picture. | notes | Window | Planned | 13 |  |
| panel.timeline | Animation timeline | Timeline | Frames of an animation in order. | animation | Window | Planned | 13 |  |
| panel.layer-comps | Saved layer setups | Layer comps | Remember which layers were shown, to switch between versions. | versions | Window | Planned | 13 |  |
| panel.vector-info | Shape measurements | Vector info | Exact sizes of shapes and paths. | shape size | Window | Planned | 6 |  |

## Tools (38 Ready, 26 Planned)

Groups: Move · Move; Select a box · Marquee; Draw a selection · Lasso; Smart select · Quick selection; Crop · Crop; Pick and measure · Eyedropper; Fix spots · Healing; Paint · Brush; Copy an area · Clone stamp; Paint back · History brush; Erase · Eraser; Fill · Gradient; Soften and smudge · Blur tool; Lighten and darken · Dodge; Pen · Pen; Text · Type; Pick outlines · Path selection; Shapes · Shape; Move around · Hand; Zoom · Zoom; Colours · Colours.

| id | Plain name | Pro name | What it does | Wish words | Place | Status | Phase | Keys |
|---|---|---|---|---|---|---|---|---|
| tool.move | Move | Move tool | Drag to move the active layer. Arrow keys nudge it by one pixel. | move, drag, position | Tools › Move | Ready | 1 | V |
| tool.artboard | Artboards | Artboard tool | Design several canvases side by side. | artboard | Tools › Move | Planned | 13 |  |
| tool.select-rect | Select a box | Rectangular marquee | Drag to select a rectangle; hold Shift for a square. | select area, rectangle, box | Tools › Select box | Ready | 1 | M |
| tool.select-ellipse | Select an oval | Elliptical marquee | Drag to select an oval or a circle. | circle selection | Tools › Select box | Planned | 2 |  |
| tool.select-row | Select one row | Single row marquee | Select a line of pixels one pixel tall. | row | Tools › Select box | Planned | 2 |  |
| tool.select-column | Select one column | Single column marquee | Select a line of pixels one pixel wide. | column | Tools › Select box | Planned | 2 |  |
| tool.lasso | Draw around it | Lasso | Draw freely around what you want to select. | freehand selection | Tools › Lasso | Ready | W3 | L |
| tool.lasso-poly | Click around it | Polygonal lasso | Click from corner to corner in straight lines. | straight lines selection | Tools › Lasso | Ready | W3 |  |
| tool.lasso-magnetic | Snap to edges | Magnetic lasso | Trace near an edge and the outline sticks to it. | edge selection | Tools › Lasso | Planned | 2 |  |
| tool.object-select | Select an object | Object selection | Drag a box around an object and its edges are found. | object | Tools › Smart select | Planned | 11 |  |
| tool.quick-select | Paint to select | Quick selection | Paint over an area and the selection grows to its edges. | quick selection | Tools › Smart select | Ready | W3 |  |
| tool.magic-wand | Select similar colour | Magic wand | Click a colour to select the area of similar colour. | magic wand, same colour | Tools › Smart select | Ready | W3 | W |
| tool.crop | Crop | Crop tool | Drag to choose the part to keep, then apply. Ratios make square or story crops. | crop, cut, trim, square, instagram | Tools › Crop | Ready | 1 | C |
| tool.crop-perspective | Crop and straighten | Perspective crop | Crop a slanted surface so it looks straight on. | straighten document | Tools › Crop | Planned | 3 |  |
| tool.slice | Cut into web pieces | Slice | Cut the picture into pieces for a web page. | slice | Tools › Crop | Planned | 13 |  |
| tool.eyedropper | Pick a colour | Eyedropper | Click the picture to use that colour for painting. | colour picker, sample colour | Tools › Measure | Ready | 1 | I |
| tool.color-sampler | Colour markers | Colour sampler | Pin up to four points that show their colour values. | colour values | Tools › Measure | Planned | 13 |  |
| tool.ruler | Measure | Ruler | Measure a distance and an angle. | measure, angle | Tools › Measure | Planned | 13 |  |
| tool.note | Sticky note | Note | Pin a written note on the picture. | comment | Tools › Measure | Planned | 13 |  |
| tool.spot-heal | Remove spots | Spot healing brush | Paint over a spot and it blends into its surroundings. | blemish, pimple, dust spot, remove spot | Tools › Retouch | Ready | W3 | J |
| tool.heal | Heal from a source | Healing brush | Alt-click a clean area, then paint to heal with it. | heal | Tools › Retouch | Ready | W3 |  |
| tool.patch | Patch an area | Patch | Draw around a flaw and drag it to a clean area. | patch | Tools › Retouch | Ready | W3 |  |
| tool.smart-move | Move and fill the gap | Content-aware move | Move something and fill the hole it leaves. | move object | Tools › Retouch | Planned | 11 |  |
| tool.red-eye | Fix red eyes | Red eye | Click a red eye to make it dark again. | red eye, flash eyes | Tools › Retouch | Ready | W3 |  |
| tool.brush | Paint brush | Brush | Paint with soft or hard edges; pens set the size by pressure. | paint, draw, brush, colour in | Tools › Paint | Ready | 1 | B |
| tool.pencil | Pencil | Pencil | Hard-edged lines, good for pixel art. | pixel art, hard line, sketch | Tools › Paint | Ready | W1 |  |
| tool.color-replace | Recolour by painting | Colour replacement | Paint to change a colour and keep the detail. | recolour | Tools › Paint | Ready | W3 |  |
| tool.mixer | Blend paint | Mixer brush | Paint that mixes with the colours already there. | wet paint | Tools › Paint | Planned | 4 |  |
| tool.clone | Copy an area | Clone stamp | Alt-click a source, then paint to copy it somewhere else. | clone, copy area, duplicate object | Tools › Clone | Ready | W3 | S |
| tool.pattern-stamp | Paint a pattern | Pattern stamp | Paint with a repeating pattern. | pattern brush | Tools › Clone | Planned | 4 |  |
| tool.history-brush | Paint back an earlier step | History brush | Paint to bring back how part of the picture looked at an earlier step: the one marked with the brush in History, at first as opened. | undo part, paint back, restore part | Tools › History brush | Ready | W3 | Y |
| tool.art-history | Painterly strokes | Art history brush | Paint quick artistic strokes from an earlier step. | art brush | Tools › History brush | Planned | 4 |  |
| tool.eraser | Eraser | Eraser | Rub out pixels so they become see-through. | erase, rub out | Tools › Erase | Ready | 1 | E |
| tool.bg-eraser | Erase a background | Background eraser | Erase the colour under the brush's centre and keep the edges. | erase background | Tools › Erase | Ready | W3 |  |
| tool.magic-eraser | Erase similar colour | Magic eraser | Click a colour to erase the area of similar colour. | remove white background | Tools › Erase | Ready | W3 |  |
| tool.gradient | Colour fade | Gradient | Drag to fill with a smooth fade between colours. | fade, gradient, ombre | Tools › Fill | Ready | W3 | G |
| tool.bucket | Fill an area | Paint bucket | Click to fill an area of similar colour. | fill, bucket | Tools › Fill | Ready | W3 |  |
| tool.blur | Soften by painting | Blur tool | Paint to soften just where you want. | soften part | Tools › Soften | Ready | W3 |  |
| tool.sharpen | Sharpen by painting | Sharpen tool | Paint to sharpen just where you want. | sharpen part | Tools › Soften | Ready | W3 |  |
| tool.smudge | Smudge | Smudge | Push the colours around like wet paint. | smear | Tools › Soften | Ready | W3 |  |
| tool.dodge | Lighten by painting | Dodge | Paint to lighten just where you want. | lighten part, brighten eyes | Tools › Light | Ready | W3 | O |
| tool.burn | Darken by painting | Burn | Paint to darken just where you want. | darken part | Tools › Light | Ready | W3 |  |
| tool.sponge | Colour strength by painting | Sponge | Paint to make colours stronger or weaker. | saturate part | Tools › Light | Ready | W3 |  |
| tool.pen | Draw curves | Pen | Click and drag to draw exact curves. | bezier, outline | Tools › Pen | Planned | 6 | P |
| tool.pen-free | Draw outlines freely | Freeform pen | Draw an outline freely like a pencil. | freeform | Tools › Pen | Planned | 6 |  |
| tool.anchor-add | Add a point | Add anchor point | Add a point to an outline. | add point | Tools › Pen | Planned | 6 |  |
| tool.anchor-delete | Remove a point | Delete anchor point | Remove a point from an outline. | remove point | Tools › Pen | Planned | 6 |  |
| tool.anchor-convert | Change a corner | Convert point | Switch a point between sharp and smooth. | corner | Tools › Pen | Planned | 6 |  |
| tool.type | Text | Horizontal type | Click and type words on the picture. | text, words, caption | Tools › Text | Ready | W3 | T |
| tool.type-vertical | Up-down text | Vertical type | Type words from top to bottom. | vertical text | Tools › Text | Planned | 6 |  |
| tool.type-mask | Text-shaped selection | Type mask | Type words to select their shape. | text selection | Tools › Text | Planned | 6 |  |
| tool.path-select | Pick a whole outline | Path selection | Click an outline to move it. | select path | Tools › Path select | Planned | 6 | A |
| tool.direct-select | Pick outline points | Direct selection | Click points of an outline to move them. | edit points | Tools › Path select | Planned | 6 |  |
| tool.rect | Rectangle | Rectangle | Drag to draw a rectangle. | box, square shape | Tools › Shapes | Ready | W3 | U |
| tool.rounded-rect | Rounded rectangle | Rounded rectangle | Drag to draw a box with round corners; set how round in the options bar. | rounded box, button shape, pill | Tools › Shapes | Ready | W3 |  |
| tool.ellipse | Circle or oval | Ellipse | Drag to draw an oval; hold Shift for a circle. | circle shape | Tools › Shapes | Ready | W3 |  |
| tool.polygon | Polygon | Polygon | Draw a shape with straight sides, like a star. | star, triangle | Tools › Shapes | Ready | W3 |  |
| tool.line | Line | Line | Drag to draw a straight line or arrow. | arrow, straight line | Tools › Shapes | Ready | W3 |  |
| tool.custom-shape | Ready-made shapes | Custom shape | Draw hearts, arrows, speech bubbles and more. | heart, speech bubble | Tools › Shapes | Planned | 6 |  |
| tool.hand | Move the view | Hand | Drag to move around the picture; hold Space with any tool. | pan, scroll around | Tools › Hand | Ready | W1 | H |
| tool.rotate-view | Turn the view | Rotate view | Turn the view to paint at a comfortable angle. | turn canvas | Tools › Hand | Planned | 13 | R |
| tool.zoom | Zoom | Zoom tool | Click to zoom in; Alt-click to zoom out. | magnify, zoom | Tools › Zoom | Ready | W1 | Z |
| tool.swap-colors | Swap the two colours | Switch colours | Swap your main and second colours. | swap colours | Tools › Colours | Ready | W1 | X |
| tool.default-colors | Black and white | Default colours | Reset to a black main colour and a white second colour. | reset colours | Tools › Colours | Ready | W1 | D |
