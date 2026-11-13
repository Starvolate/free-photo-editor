// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** Remove the background puts its copy just above the photo's layer, at the same depth, and hides the originals (W2). */
import { describe, expect, it } from 'vitest';
import { checkTree, createFolder, createLayer, shownInTree, snapshotDoc, type Doc } from '@free-photoeditor/core';
import { placeCutout } from '../src/cutout-place';

const doc = (): Doc => {
  const bg = createLayer('Background', 4, 4), photo = createLayer('Photo', 4, 4), top = createLayer('Note', 4, 4), f = createFolder('Folder');
  photo.parentId = f.id;
  // Bottom to top: Background, Photo (in Folder), Folder, Note.
  return { width: 4, height: 4, layers: [bg, photo, f, top], activeId: photo.id, selection: null };
};

describe('placeCutout', () => {
  it('puts the copy above the photo inside its folder, shown, with everything else hidden and kept', () => {
    const d = doc(), s = snapshotDoc(d), copy = createLayer('Background removed', 4, 4);
    placeCutout(s, copy);
    expect(s.layers.map((l) => l.name)).toEqual(['Background', 'Photo', 'Background removed', 'Folder', 'Note']);
    expect(copy.parentId).toBe(d.layers[2].id);
    expect(checkTree(s.layers)).toBeNull();
    expect(s.activeId).toBe(copy.id);
    expect(s.layers.filter((l) => l.kind !== 'folder' && shownInTree(s.layers, l)).map((l) => l.name)).toEqual(['Background removed']);
    expect(s.layers.find((l) => l.name === 'Folder')?.visible).toBe(true);
  });

  it('at the top level, puts the copy directly above the photo and hides every other layer', () => {
    const d = doc();
    d.activeId = d.layers[0].id;
    const s = snapshotDoc(d), copy = createLayer('Background removed', 4, 4);
    placeCutout(s, copy);
    expect(s.layers.map((l) => l.name)).toEqual(['Background', 'Background removed', 'Photo', 'Folder', 'Note']);
    expect(copy.parentId).toBeUndefined();
    expect(checkTree(s.layers)).toBeNull();
    expect(s.layers.filter((l) => l.visible).map((l) => l.name)).toEqual(['Background removed']);
  });
});
