// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Where Remove the background puts its copy (W2). The copy goes directly above the photo's layer (the active one) at the
 * same depth, so inside its folder when it is in one; tree.ts keeps a folder's contents together under it, and a node
 * placed just above a sibling stays in that run. The original layers are hidden, never deleted. The folders around the
 * copy stay shown, or the copy would be hidden with them.
 */
import { ancestors, type DocState, type Layer } from '@free-photoeditor/core';

export function placeCutout(s: DocState, copy: Layer): void {
  const at = s.layers.findIndex((l) => l.id === s.activeId), photo = at >= 0 ? s.layers[at] : undefined;
  if (photo?.parentId) copy.parentId = photo.parentId; else delete copy.parentId;
  const around = new Set(photo ? ancestors(s.layers, photo.id).map((f) => f.id) : []);
  for (const l of s.layers) l.visible = around.has(l.id);
  s.layers.splice(at >= 0 ? at + 1 : s.layers.length, 0, copy);
  s.activeId = copy.id;
}
