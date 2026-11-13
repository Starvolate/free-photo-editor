// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The File extras: web links (names, answers, plain messages), print sizes, each layer as its own PNG, camera messages. */
import { describe, expect, it } from 'vitest';
import { addLayer, createDocument, createLayer, type Layer } from '@free-photoeditor/core';
import { decodePng } from '@free-photoeditor/formats/png';
import { unzipSync } from '@free-photoeditor/formats/zip';
import { URL_BLOCKED, URL_PAGE, cameraProblem, checkUrl, fetchPicture, layerFiles, layersZip, nameFromUrl, photoName, printHtml, printMm, statusText } from '../src/file-more';

const answer = (status: number, type: string, body: Uint8Array | string): typeof fetch =>
  (async () => new Response(status === 204 ? null : body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

describe('Open from a web link', () => {
  it('makes a typed address whole and refuses what cannot be one', () => {
    expect(checkUrl(' example.com/cat.png ')).toBe('https://example.com/cat.png');
    expect(checkUrl('http://127.0.0.1:8080/a.jpg')).toBe('http://127.0.0.1:8080/a.jpg');
    expect(checkUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const bad of ['', '   ', 'not a link at all', 'javascript:alert(1)']) expect(checkUrl(bad), bad).toBeNull();
  });
  it('names the picture from its address, adding a type from the answer when it has none', () => {
    expect(nameFromUrl('https://x.org/pics/cat%20one.jpg?size=2')).toBe('cat one.jpg');
    expect(nameFromUrl('https://x.org/', 'image/png')).toBe('web picture.png');
    expect(nameFromUrl('https://x.org/get/42', 'image/webp')).toBe('42.webp');
    expect(nameFromUrl('data:image/png;base64,AAAA', 'image/png')).toBe('web picture.png');
  });
  it('turns every failure into a plain sentence', async () => {
    const blocked = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchPicture('https://x.org/a.png', blocked)).rejects.toThrow(URL_BLOCKED);
    await expect(fetchPicture('https://x.org/a.png', answer(404, 'text/plain', 'no'))).rejects.toThrow('answered 404');
    await expect(fetchPicture('https://x.org/a.png', answer(403, 'text/plain', 'no'))).rejects.toThrow('refused');
    await expect(fetchPicture('https://x.org/page', answer(200, 'text/html; charset=utf-8', '<p>hi</p>'))).rejects.toThrow(URL_PAGE);
    await expect(fetchPicture('https://x.org/a.png', answer(200, 'image/png', new Uint8Array(0)))).rejects.toThrow('empty');
    expect(statusText(500)).toContain('Try again later');
  });
  it('hands back the picture and its name when the site allows it', async () => {
    const got = await fetchPicture('https://x.org/photo', answer(200, 'image/jpeg', new Uint8Array([255, 216, 255, 0])));
    expect([got.blob.size, got.name]).toEqual([4, 'photo.jpg']);
  });
});

describe('Print', () => {
  it('works out the size on paper from the DPI', () => {
    expect(printMm(600, 300, 300)).toEqual({ w: 50.8, h: 25.4 });
    expect(printMm(72, 144)).toEqual({ w: 25.4, h: 50.8 });
    expect(printMm(100, 100, 0)).toEqual(printMm(100, 100, 72));
  });
  it('fits the page (sideways for wide pictures) or prints at the real size', () => {
    const fit = printHtml('blob:x', 'Cat <1>', 800, 400, 'fit');
    expect(fit).toContain('size:landscape');
    expect(fit).toContain('max-width:100%');
    expect(fit).toContain('<title>Cat &#60;1&#62;</title>');
    const real = printHtml('blob:x', 'Cat', 600, 300, 'size', 300);
    expect(real).toContain('width:50.8mm;height:25.4mm');
    expect(real).not.toContain('landscape');
  });
});

describe('Save each layer as a file', () => {
  const doc = () => {
    const d = createDocument(40, 30, { r: 255, g: 255, b: 255, a: 255 });
    const box = createLayer('Red / box', 10, 10, { x: 5, y: 6, fill: { r: 255, g: 0, b: 0, a: 255 } });
    box.visible = false;
    box.blendMode = 'multiply';
    addLayer(d, box, 1, 'Add');
    const folder: Layer = { ...createLayer('Folder', 1, 1), kind: 'folder' };
    addLayer(d, folder, 2, 'Add');
    return d;
  };
  it('gives one canvas-sized picture per layer with pixels, in its place, hidden ones included', () => {
    const files = layerFiles(doc());
    expect(files.map((f) => f.name)).toEqual(['01 Background.png', '02 Red - box.png']);
    const red = files[1].bmp, at = (x: number, y: number): number[] => Array.from(red.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
    expect([red.width, red.height]).toEqual([40, 30]);
    expect(at(7, 8)).toEqual([255, 0, 0, 255]);
    expect(at(0, 0)[3]).toBe(0);
    expect(Array.from(files[0].bmp.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  });
  it('packs them into one ZIP of PNG files', () => {
    const { bytes, count } = layersZip(doc());
    const files = unzipSync(bytes);
    expect(count).toBe(2);
    expect(Object.keys(files).sort()).toEqual(['01 Background.png', '02 Red - box.png']);
    const png = decodePng(files['02 Red - box.png']);
    expect([png.width, png.height, png.data[(8 * 40 + 7) * 4]]).toEqual([40, 30, 255]);
  });
});

describe('Take a photo', () => {
  it('says plainly why the camera did not start', () => {
    expect(cameraProblem({ name: 'NotAllowedError' })).toContain('blocked');
    expect(cameraProblem({ name: 'NotFoundError' })).toContain('No camera');
    expect(cameraProblem({ name: 'NotReadableError' })).toContain('busy');
    expect(cameraProblem(null)).toContain('could not start');
  });
  it('names the photo from the time it was taken', () => {
    expect(photoName(new Date(2026, 10, 13, 9, 5, 7))).toBe('Camera photo 2026-11-13 09.05.07.png');
  });
});
