// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** W8: the install manifest, our own icons, which files the offline worker saves when, and the safety-copy helpers. */
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { OPEN_EXTS } from '@free-photoeditor/formats';
import { createDocument, createLayer } from '@free-photoeditor/core';
import { ICONS, OPEN_TYPES, SHARE_ACTION, SHARE_FIELD, drawIcon, encodePng, splitFiles, webManifest, type BundleFile } from '../scripts/pwa';
import { STEPS, platformOf } from '../src/offline';
import { namesText, plainDoc } from '../src/autosave';
import { HANDLERS } from '../src/commands';
import { BY_ID, search } from '../src/registry';

describe('the install manifest', () => {
  const m = webManifest() as Record<string, any>;
  it('names the app and its maker, and opens standalone', () => {
    expect(m.name).toBe('Free Photo Editor');
    expect(m.description).toContain('Bhawesh Tibrewal');
    expect(m.display).toBe('standalone');
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('uses only addresses relative to itself, so the app works in any folder', () => {
    const urls = [m.id, m.start_url, m.scope, ...m.icons.map((i: { src: string }) => i.src), m.share_target.action, ...m.file_handlers.map((f: { action: string }) => f.action)];
    for (const u of urls) expect(u, u).not.toMatch(/^(\/|https?:)/);
  });
  it('offers 192 and 512 pixel icons and a maskable one', () => {
    const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  });
  it('opens every picture type the editor reads, from the computer and from a phone share sheet', () => {
    const accepted = new Set(Object.values(OPEN_TYPES).flat());
    for (const e of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'ico', 'psd', 'psb', ...OPEN_EXTS]) expect(accepted.has('.' + e), e).toBe(true);
    for (const t of Object.keys(OPEN_TYPES)) expect(t).toMatch(/^[a-z]+\/[\w.+-]+$/);
    expect(m.share_target).toMatchObject({ action: './' + SHARE_ACTION, method: 'POST', enctype: 'multipart/form-data' });
    expect(m.share_target.params.files[0].name).toBe(SHARE_FIELD);
    expect(m.share_target.params.files[0].accept).toContain('image/*');
  });
});

describe('our own icons', () => {
  it('are valid PNG files of the right size: rounded with see-through corners, or square to the edge for masks', () => {
    for (const i of ICONS) {
      const png = PNG.sync.read(Buffer.from(encodePng(i.size, i.size, drawIcon(i.size, i.kind))));
      expect([png.width, png.height], i.file).toEqual([i.size, i.size]);
      const a = (x: number, y: number): number => png.data[(y * i.size + x) * 4 + 3];
      expect(a(0, 0), i.file).toBe(i.kind === 'any' ? 0 : 255);
      expect(a(i.size >> 1, i.size >> 1), i.file).toBe(255);
    }
  });
  it('are drawn the same way every time, so a build does not change them by chance', () => {
    expect(Buffer.from(drawIcon(64, 'any')).equals(Buffer.from(drawIcon(64, 'any')))).toBe(true);
  });
});

describe('what the offline worker saves, and when', () => {
  const files: BundleFile[] = [
    { fileName: 'assets/index-AAAAAAAA.js', type: 'chunk', isEntry: true, imports: ['assets/shared-BBBBBBBB.js'], css: ['assets/index-CCCCCCCC.css'],
      code: 'new Worker(new URL("worker-DDDDDDDD.js", import.meta.url)); import("./fx-EEEEEEEE.js"); const m = ["assets/fx-EEEEEEEE.js"];' },
    { fileName: 'assets/shared-BBBBBBBB.js', type: 'chunk', code: '' },
    { fileName: 'assets/fx-EEEEEEEE.js', type: 'chunk', imports: ['assets/shared-BBBBBBBB.js'], code: 'fetch(new URL("avif-FFFFFFFF.wasm", import.meta.url))' },
    { fileName: 'assets/index-CCCCCCCC.css', type: 'asset' },
    { fileName: 'assets/worker-DDDDDDDD.js', type: 'asset', code: 'import("./blur-GGGGGGGG.js")' },
    { fileName: 'assets/blur-GGGGGGGG.js', type: 'asset' },
    { fileName: 'assets/avif-FFFFFFFF.wasm', type: 'asset' },
    { fileName: '.vite/manifest.json', type: 'asset' },
  ];
  const { shell, addons } = splitFiles(files, ['index.html', 'manifest.webmanifest']);
  it('saves the page, its script, styles and the filter worker at install', () => {
    expect(shell).toEqual(['assets/index-AAAAAAAA.js', 'assets/index-CCCCCCCC.css', 'assets/shared-BBBBBBBB.js', 'assets/worker-DDDDDDDD.js', 'index.html', 'manifest.webmanifest']);
  });
  it('leaves every add-on (filters, formats and their WebAssembly) to be saved on first use', () => {
    expect(addons).toEqual(['assets/avif-FFFFFFFF.wasm', 'assets/blur-GGGGGGGG.js', 'assets/fx-EEEEEEEE.js']);
  });
});

describe('install steps and safety copies', () => {
  it('knows which install steps fit the device, iPad included', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(platformOf(iphone, 'iPhone', 5)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'MacIntel', 5)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'MacIntel', 0)).toBe('mac-safari');
    expect(platformOf('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36', 'Linux', 5)).toBe('android');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Win32', 0)).toBe('firefox');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'MacIntel', 0)).toBe('desktop');
    expect(STEPS.ios.steps.map((s) => s[1]).join(' ')).toMatch(/Share.*Add to Home Screen/);
  });
  it('stores plain data only, keeping pixels, text and shapes', () => {
    const d = createDocument(8, 6);
    const l = createLayer('Words', 4, 4);
    (l as unknown as { content: unknown }).content = { kind: 'text', text: 'Hi' };
    (l as unknown as { cache: unknown }).cache = () => 1;
    d.layers.push(l);
    const p = plainDoc(d);
    expect(p.layers[1].data).toBe(l.data);
    expect(p.layers[1].content).toEqual({ kind: 'text', text: 'Hi' });
    expect('cache' in p.layers[1]).toBe(false);
    expect(() => structuredClone(p)).not.toThrow();
    expect(namesText([{ name: 'a.jpg' }, { name: 'b.png' }, { name: 'c.psd' }])).toBe('a.jpg, b.png and 1 more');
  });
  it('lists the new commands as Ready, with plain names, handlers and wish words', () => {
    for (const id of ['file.install', 'file.autosave', 'file.restore']) {
      expect(BY_ID.get(id)?.status, id).toBe('ready');
      expect(HANDLERS[id], id).toBeTruthy();
    }
    expect(search('install the app')[0]?.id).toBe('file.install');
    expect(search('autosave')[0]?.id).toBe('file.autosave');
    expect(search('recover lost work')[0]?.id).toBe('file.restore');
  });
});
