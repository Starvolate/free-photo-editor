# Free Photo Editor MCP server

**by [Bhawesh Tibrewal](https://bhaweshtibrewal.com)**

`free-photo-editor-mcp` gives Claude and other AI agents a free photo editor that runs on your own computer. Through the
Model Context Protocol (MCP, the standard way tools plug into AI assistants), an agent can open, adjust, filter, resize,
crop, turn, convert and export pictures in the folders you choose, with the same engine as the
[Free Photo Editor](https://github.com/Starvolate/free-photo-editor) web app. Nothing is uploaded, there is no account,
and it is free.

> **Not on npm yet.** The setups below use `npx -y free-photo-editor-mcp`, which works once the package is published.
> Until then, run it from the source code (see [From the source code](#from-the-source-code)).

## Set it up

Always name the folders the agent may use. The server works only inside them, and refuses to start on a whole disk.
It needs Node.js 20.9 or newer.

**Claude Code**

```sh
claude mcp add free-photo-editor -- npx -y free-photo-editor-mcp ~/Pictures
```

Add `--scope user` to have it in every project.

**Claude Desktop**: Settings, Developer, Edit Config (the file is `claude_desktop_config.json`), then add:

```json
{
  "mcpServers": {
    "free-photo-editor": {
      "command": "npx",
      "args": ["-y", "free-photo-editor-mcp", "/Users/you/Pictures"]
    }
  }
}
```

Use the full path of your folder (on Windows, for example `C:\\Users\\you\\Pictures`), then restart Claude Desktop.

**Cursor**: the same `mcpServers` block in `.cursor/mcp.json` (one project) or `~/.cursor/mcp.json` (every project).

**VS Code and other MCP clients**: any client that starts a local (stdio) server works. Command `npx`, arguments
`-y free-photo-editor-mcp <folder> [more folders]`. In VS Code's `.vscode/mcp.json` that is
`{ "servers": { "free-photo-editor": { "type": "stdio", "command": "npx", "args": ["-y", "free-photo-editor-mcp", "/Users/you/Pictures"] } } }`.

Then ask in plain words, for example: "Make every photo in my Pictures/trip folder a little brighter and save them as
WebP", "Blur the background of portrait.jpg", or "Crop logo.png to a square and make it 512 pixels wide".

## Tools

| Tool | Plain name · pro name | What it does |
|---|---|---|
| `list_operations` | What the editor can do | Every adjustment and filter with plain name, pro name, help and settings; `query` finds the right one for a wish |
| `image_info` | Picture details · File info | Size, type, layers, see-through areas, the credit stored in the file |
| `adjust` | Light and colour · Adjustments | 21 adjustments, from brightness and levels to automatic fixes |
| `filter` | Effects · Filters | 55 filters: blurs, sharpen, noise, distort, pixelate, render, stylize |
| `resize` | Picture size · Image size | New width and height, or a percentage |
| `crop` | Crop · Crop tool | An area, a shape such as 1:1, or trim empty edges |
| `rotate` | Turn the picture · Image rotation | Right, left or 180, for the picture or one layer |
| `flip` | Mirror or flip · Flip canvas | Horizontal or vertical, for the picture or one layer |
| `convert` | Change the file type · Convert | PNG, JPEG, WebP or PSD, with a note on what the new type loses |
| `export` | Export · Export as | A copy, or one layer of a PSD, in any of those types |
| `layers` | Layers | List, merge or flatten the layers of a PSD |

Edits can be limited to one layer or to a rectangle, and every edit tool can return a small preview so the agent can
look at the result. The server opens PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, ICO and PSD, and saves PNG, JPEG, WebP and PSD.

## Safety

- It reads and writes only inside the folders you name. Every path is resolved to where it really is, so `..`, an
  absolute path elsewhere, or a link that leads outside is refused. A link planted at an output name is replaced, never
  followed.
- The original is never changed: results are saved next to it with a suffix unless the agent names an output, and an
  existing file is replaced only when the agent sets `overwrite`.
- It never opens a network connection and never runs other programs.
- Pictures above 64 million pixels are refused, when opening and when resizing (change it with `--max-pixels <n>`).

## From the source code

```sh
git clone https://github.com/Starvolate/free-photo-editor.git
cd free-photo-editor
npm ci
npm run build:agents
claude mcp add free-photo-editor -- node "$PWD/packages/mcp/dist/server.js" ~/Pictures
```

For other clients use command `node` with arguments `/full/path/to/free-photo-editor/packages/mcp/dist/server.js` and
your folder. The same engine is also a command-line tool: [free-photo-editor](../cli/README.md).

## Credit and licence

Free Photo Editor is made by **Bhawesh Tibrewal** ([bhaweshtibrewal.com](https://bhaweshtibrewal.com)). Every file the
server saves carries "Free Photo Editor by Bhawesh Tibrewal" in its file details, with no visible watermark.

Free and open source under the GNU Affero General Public License v3.0 (`LICENSE`), with two additional terms
(`ADDITIONAL-TERMS.md`): keep the credit "Free Photo Editor by Bhawesh Tibrewal" in every copy, and mark changed versions
as changed. It comes with no warranty. It uses the MCP TypeScript SDK (MIT), zod (MIT), sharp (Apache-2.0, with libvips
under LGPL-3.0) and ag-psd (MIT).

Claude is a trademark of Anthropic. Cursor, VS Code and Photoshop are trademarks of their owners. Free Photo Editor is
an independent project and is not affiliated with, sponsored by or endorsed by any of them.
