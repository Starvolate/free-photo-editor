# Free Photo Editor on the command line

**by [Bhawesh Tibrewal](https://bhaweshtibrewal.com)**

`free-photo-editor` edits, converts and exports pictures on your own computer, one file or a whole folder at a time.
It uses the same engine as the [Free Photo Editor](https://github.com/Starvolate/free-photo-editor) web app, so the same
adjustment gives the same pixels. Nothing is uploaded, there is no account, and it is free. It is made for people and
for AI agents: every command can answer in JSON.

> **Not on npm yet.** The commands below use `npx free-photo-editor`, which works once the package is published. Until
> then, run it from the source code (see [From the source code](#from-the-source-code)).

## Try it

```sh
npx free-photo-editor --help
npx free-photo-editor adjust brightness photo.jpg --set brightness=25
```

Installed for good with `npm install -g free-photo-editor`, it also answers to the short name `fpe`. (Only after a
global install: `npx fpe` would fetch an unrelated package.) It needs Node.js 20.9 or newer.

## What it does

Each command shows a plain name first and the usual pro name second, as in the web app.

| Command | Plain name · pro name | What it does |
|---|---|---|
| `info` | Picture details · File info | Size, layers, see-through areas and the credit stored in a file |
| `convert` | Change the file type · Convert | Save a copy as PNG, JPEG, WebP or PSD, with a note on what the new type loses |
| `export` | Export · Export as | Save a copy, or one layer of a PSD, in any of those types |
| `resize` | Picture size · Image size | New width and height; give one side to keep the proportions |
| `crop` | Crop · Crop tool | Keep an area, a shape such as 1:1, or trim empty edges |
| `rotate` | Turn the picture · Image rotation | A quarter turn right or left, or half way round |
| `flip` | Mirror or flip the picture · Flip canvas | Mirror left to right, or flip top to bottom |
| `adjust` | Light and colour · Adjustments | 21 adjustments: brightness and contrast, levels, curves, exposure, colour balance, black and white, automatic fixes and more |
| `filter` | Effects · Filters | 55 filters: blurs (including blur around a spot and the miniature effect), sharpen, noise, distort, pixelate, render, stylize |
| `layers` | Layers | List, merge or flatten the layers of a PSD file |
| `list` | Every adjustment and filter | Each one's settings, ranges and defaults (`--json` for agents) |
| `search` | Search for a command · Search | Find the command for a wish, such as "make it brighter" |

`free-photo-editor adjust --help` and `free-photo-editor filter --help` list every adjustment and filter.
`free-photo-editor filter blur-gaussian --help` shows the settings of one.

It opens PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, ICO and PSD files, and saves PNG, JPEG, WebP and PSD (PSD keeps every
layer). Photos are turned upright from the camera's orientation tag, like a browser shows them.

## Recipes

```sh
# Brighter, with more contrast
npx free-photo-editor adjust brightness photo.jpg --set brightness=25 --set contrast=10

# Fix the light automatically on a whole folder, into a new folder
npx free-photo-editor adjust auto-tone "holiday/*.jpg" --out-dir fixed

# Blur the background around a sharp spot (portrait look)
npx free-photo-editor filter blur-iris portrait.jpg --set blur=20 --set cx=50 --set cy=40

# Square crop for Instagram, then a smaller WebP for the web
npx free-photo-editor crop photo.jpg --aspect 1:1 -o square.jpg
npx free-photo-editor resize square.jpg --width 1080 --to webp

# Hide a face or a number plate
npx free-photo-editor filter mosaic photo.jpg --area 120,80,200,200 --set size=24

# A PSD: see its layers, save one layer as a PNG, flatten the rest
npx free-photo-editor layers list design.psd
npx free-photo-editor export design.psd --layer Logo -o logo.png
npx free-photo-editor layers flatten design.psd --to png

# Find the right command for a wish
npx free-photo-editor search "black and white"
```

Patterns such as `"photos/*.jpg"` or `"shoot/**/*.{jpg,png}"` are expanded by the tool itself, so they work in every
shell; keep the quotes.

## Safe by default

- The original is never changed. Results are saved next to it with a suffix (`photo-blur-gaussian.jpg`), in the folder
  given by `--out-dir`, or under the name given by `-o` (put `{name}` in it for many files: `-o out/{name}.webp`).
- An existing file is never replaced unless you add `--overwrite`.
- Pictures above 64 million pixels are refused (change it with `--max-pixels`), so a huge file cannot fill your memory.
- It works fully offline and sends nothing anywhere.

## For scripts and AI agents

- `--json` on any command gives one JSON answer: `ok`, each input and output file, size, type, notes, and the credit.
- `free-photo-editor list --json` gives every adjustment and filter with its plain name, pro name, help and settings
  (key, range, default, choices).
- `free-photo-editor search "blur the background" --json` maps a wish to the command to run.
- Exit codes: 0 done, 1 some pictures could not be changed, 2 the command was written wrongly.
- AI apps that speak MCP (Claude, Cursor and others) can use the companion MCP server instead:
  [free-photo-editor-mcp](../mcp/README.md).

## From the source code

```sh
git clone https://github.com/Starvolate/free-photo-editor.git
cd free-photo-editor
npm ci
npm run build:agents
node packages/cli/dist/cli.js --help
```

## Credit and licence

Free Photo Editor is made by **Bhawesh Tibrewal** ([bhaweshtibrewal.com](https://bhaweshtibrewal.com)). Every file it
saves carries "Free Photo Editor by Bhawesh Tibrewal" in its file details (PNG text, JPEG EXIF and XMP, WebP XMP, PSD
XMP), with no visible watermark.

Free and open source under the GNU Affero General Public License v3.0 (`LICENSE`), with two additional terms
(`ADDITIONAL-TERMS.md`): keep the credit "Free Photo Editor by Bhawesh Tibrewal" in every copy, and mark changed versions
as changed. It comes with no warranty. Picture reading and writing uses [sharp](https://sharp.pixelplumbing.com)
(Apache-2.0, with libvips under LGPL-3.0) and [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT).

Photoshop is a trademark of Adobe Inc. Free Photo Editor is an independent project and is not affiliated with, sponsored
by or endorsed by Adobe.
