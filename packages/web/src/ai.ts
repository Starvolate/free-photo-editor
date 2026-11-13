// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The on-device AI commands in the editor (W11), loaded the first time one is used: Select the main subject, Remove the
 * background, Remove an object (the brush, and Edit › Fill from the surroundings) and Make it bigger (2x and 4x). Before
 * the first download a sheet says how much comes down, once; the photo itself never leaves this device.
 */
import { AiClient, Cancelled, blendFill, cannotRun, contextBox, detectBackend, downloadSize, estimateSeconds, fillOnly, mb, type Backend, type ModelId, type Progress } from '@free-photoeditor/ai';
import {
  activeLayer, addLayer, compositeDoc, createLayer, docCommand, docRect, expandMask, featherMask, maskBounds, maskFromSelection, pixelCommand, readRegion,
  resizeBitmap, selectionFromMask, snapshotDoc, writeRegion, type Command, type Doc, type Mask, type Rect, type Selection,
} from '@free-photoeditor/core';
import { errText, h } from './dom';
import { maxPixelsForDevice } from './io';
import type { ToolHost } from './toolkit';

export interface AiKit {
  /** Run an AI command by its function-map id. */
  cmd(id: string): Promise<void>;
  /** The Remove tool: fill the painted mask (picture size, any value above 0) from its surroundings. */
  removeObject(mask: Mask): Promise<void>;
  busy(): boolean;
}
const TITLE: Record<string, string> = {
  'select.subject': 'Select the main subject', 'image.remove-bg': 'Remove the background', 'edit.smart-fill': 'Fill from the surroundings',
  'image.upscale-2x': 'Make it twice as big', 'image.upscale-4x': 'Make it four times as big', 'tool.remove': 'Remove an object',
};
const timeText = (s: number): string => (s < 90 ? `${Math.max(10, Math.round(s / 10) * 10)} seconds` : `${Math.round(s / 60)} minutes`);
const CHANGED = 'The picture changed while the AI was working, so nothing was applied. Try again.';

export function createAiKit(host: ToolHost): AiKit {
  const client = new AiClient();
  let backend: Backend | null = null, running = false, answer: ((go: boolean) => void) | null = null;
  const msg = h('p', { class: 'fpe-ai-msg', 'data-testid': 'ai-message' });
  const note = h('p', { class: 'fpe-note', 'data-testid': 'ai-note' });
  const bar = h('progress', { class: 'fpe-ai-bar', max: 100, 'data-testid': 'ai-progress' });
  const status = h('p', { class: 'fpe-hint', 'data-testid': 'ai-status', 'aria-live': 'polite' });
  const go = h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'ai-download' }, 'Download and start');
  const stop = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'ai-cancel' }, 'Cancel');
  const body = h('div', { class: 'fpe-ai', 'data-testid': 'ai-sheet' }, msg, note, bar, status, h('div', { class: 'fpe-actions' }, stop, go));
  go.addEventListener('click', () => { const a = answer; answer = null; a?.(true); });
  stop.addEventListener('click', () => { const a = answer; answer = null; if (a) a(false); else client.cancel(); });
  const toast = (m: string): void => host.toast(m);
  const progress = (p: Progress): void => {
    if (p.stage === 'start') { bar.removeAttribute('value'); status.textContent = 'Getting the AI ready on this device…'; return; }
    bar.value = Math.floor((p.done / Math.max(1, p.total)) * 100);
    status.textContent = p.stage === 'download' ? `Downloading: ${bar.value}%. This happens only once.` : `Working on your photo: ${bar.value}%`;
  };
  const working = (text: string): void => { bar.removeAttribute('value'); status.textContent = text; };

  /** Open the sheet. The first time, say how much downloads and wait for a yes. False when the person says no. */
  async function ask(model: ModelId, title: string, slow: string): Promise<boolean> {
    const why = cannotRun();
    if (why) { toast(why); return false; }
    backend ??= await detectBackend();
    const size = await downloadSize(model, backend, client.loaded.has(model));
    answer?.(false);
    host.sheet('ai', title, body);
    note.textContent = slow;
    note.hidden = !slow;
    status.textContent = '';
    if (size <= 0) { msg.textContent = 'Your photo never leaves this device.'; go.hidden = true; bar.hidden = false; return true; }
    msg.textContent = `This downloads once, about ${mb(size)} MB. Your photo never leaves this device.`;
    go.hidden = false;
    bar.hidden = true;
    const yes = await new Promise<boolean>((resolve) => { answer = resolve; });
    if (!yes) { host.closeSheet(); return false; }
    go.hidden = true;
    bar.hidden = false;
    return true;
  }
  /** Ask, download and load the model, then do the work; errors and Cancel end in plain words. */
  async function job(model: ModelId, title: string, slow: string, work: () => Promise<void>): Promise<void> {
    if (running) { toast('The AI is still working on the last job. Wait for it, or press Cancel.'); return; }
    if (!(await ask(model, title, slow))) return;
    running = true;
    try {
      working('Getting the AI ready on this device…');
      backend = await client.prepare(model, backend ?? 'wasm', progress);
      await work();
    } catch (e) {
      if (e instanceof Cancelled) toast('Stopped. Nothing was changed.');
      else { console.warn('[ai]', e); toast(`The AI could not finish: ${errText(e)}`); }
    } finally {
      running = false;
      host.closeSheet();
      host.render();
    }
  }
  const same = (d: Doc, w: number, hh: number): boolean => host.doc() === d && d.width === w && d.height === hh;
  function select(d: Doc, next: Selection | null, label: string): void {
    const before = d.selection;
    host.rememberSel(before);
    host.forgetHole();
    d.selection = next;
    const cmd: Command = { label, bytes: (before?.alpha?.length ?? 0) + (next?.alpha?.length ?? 0), undo(doc) { doc.selection = before; }, redo(doc) { doc.selection = next; } };
    host.push(cmd);
    host.selectionChanged();
  }

  /** Select the main subject, or (remove) cut it out onto its own layer and hide the original layers. */
  async function subject(d: Doc, remove: boolean): Promise<void> {
    const W = d.width, H = d.height, title = TITLE[remove ? 'image.remove-bg' : 'select.subject'];
    await job('subject', title, '', async () => {
      working('Finding the main subject…');
      const comp = compositeDoc(d, docRect(d));
      const mask = await client.subject({ width: W, height: H, data: comp.slice() }, progress);
      if (!same(d, W, H)) { toast(CHANGED); return; }
      const sel = selectionFromMask({ width: W, height: H, data: mask });
      if (!sel) { toast('No clear subject was found. Try Paint to select or Draw around it instead.'); return; }
      if (!remove) {
        select(d, sel, title);
        toast('Main subject selected. Fine-tune it with Select › Change the selection, or add to it with Paint to select.');
        return;
      }
      const cut = new Uint8ClampedArray(comp.length);
      for (let i = 0, n = W * H; i < n; i++) { const j = i * 4; cut[j] = comp[j]; cut[j + 1] = comp[j + 1]; cut[j + 2] = comp[j + 2]; cut[j + 3] = (comp[j + 3] * mask[i] + 127) / 255; }
      const before = snapshotDoc(d), after = snapshotDoc(d), layer = createLayer('Background removed', W, H, { data: cut });
      for (const l of after.layers) l.visible = false;
      after.layers.push(layer);
      after.activeId = layer.id;
      after.selection = sel;
      const cmd = docCommand(title, before, after);
      cmd.redo(d);
      host.forgetHole();
      host.push(cmd, true);
      host.selectionChanged();
      host.panels();
      toast('Background removed. The original is kept, hidden, under it in Layers.');
    });
  }

  /** Make every layer f times bigger: painted layers through the AI, text and shape layers smoothly. */
  async function bigger(d: Doc, f: 2 | 4): Promise<void> {
    const W = d.width, H = d.height, title = TITLE[f === 2 ? 'image.upscale-2x' : 'image.upscale-4x'];
    if (W * f * H * f > maxPixelsForDevice()) {
      toast(f === 4 ? 'Four times as big would be too large for this device. Try twice as big.' : 'Twice as big would be too large for this device. Make the picture smaller first.');
      return;
    }
    backend ??= await detectBackend();
    const px = d.layers.reduce((a, l) => a + (l.content ? 0 : l.width * l.height), 0), secs = estimateSeconds('upscale', px, backend);
    if (secs > 20 * 60) { toast(`This device is too slow for this picture: it would take about ${timeText(secs)}. Make the picture smaller first, or use a computer.`); return; }
    const slow = secs > 40 ? `On this device this takes about ${timeText(secs)}. You can keep looking around, or press Cancel at any time.` : '';
    await job('upscale', title, slow, async () => {
      working('Making it bigger…');
      const before = snapshotDoc(d), after = snapshotDoc(d), total = Math.max(1, d.layers.filter((l) => !l.content).length);
      let done = 0;
      for (let k = 0; k < after.layers.length; k++) {
        const l = after.layers[k], nw = l.width * f, nh = l.height * f;
        if (l.content) { after.layers[k] = { ...l, x: l.x * f, y: l.y * f, width: nw, height: nh, data: resizeBitmap(l, nw, nh, 'smooth') }; continue; }
        const big = await client.upscale({ width: l.width, height: l.height, data: l.data.slice() }, f,
          (p) => progress({ stage: 'work', done: done * p.total + p.done, total: total * p.total }));
        after.layers[k] = { ...l, x: l.x * f, y: l.y * f, width: big.width, height: big.height, data: big.data };
        done++;
      }
      if (!same(d, W, H)) { toast(CHANGED); return; }
      after.width = W * f;
      after.height = H * f;
      after.selection = null;
      const cmd = docCommand(title, before, after);
      cmd.redo(d);
      host.forgetHole();
      host.push(cmd, true);
      host.selectionChanged();
      host.panels();
      toast(`Done: the picture is now ${W * f} × ${H * f} pixels.`);
    });
  }

  /** Fill the masked area from its surroundings. One visible layer is changed in place; otherwise the fill goes on a new top layer. */
  async function fill(d: Doc, mask: Mask, title: string): Promise<void> {
    const W = d.width, H = d.height, hole = expandMask(mask, 3), b = maskBounds(hole, 1);
    if (!b) { toast('Paint over what you want gone first.'); return; }
    const r: Rect = contextBox(b, W, H);
    await job('inpaint', title, '', async () => {
      working('Filling the gap from its surroundings…');
      const comp = compositeDoc(d, r), n = r.w * r.h, local = new Uint8Array(n);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) local[y * r.w + x] = hole.data[(r.y + y) * W + r.x + x] ? 255 : 0;
      const rgb = await client.inpaint({ width: r.w, height: r.h, data: comp.slice() }, local.slice(), progress);
      if (!same(d, W, H)) { toast(CHANGED); return; }
      const soft = featherMask({ width: r.w, height: r.h, data: local }, 2).data, l = activeLayer(d), shown = d.layers.filter((x) => x.visible);
      if (l && shown.length === 1 && shown[0] === l && !l.content && !l.locked && l.x <= r.x && l.y <= r.y && l.x + l.width >= r.x + r.w && l.y + l.height >= r.y + r.h) {
        const lr: Rect = { x: r.x - l.x, y: r.y - l.y, w: r.w, h: r.h }, before = readRegion(l, lr);
        writeRegion(l, lr, blendFill({ width: r.w, height: r.h, data: before }, rgb, soft));
        host.push(pixelCommand(title, l.id, lr, before));
        host.dirty(r);
      } else {
        host.push(addLayer(d, createLayer('Removed object', r.w, r.h, { x: r.x, y: r.y, data: fillOnly(rgb, soft, n) }), d.layers.length, title), true);
        host.panels();
      }
      toast('Removed. Undo brings it back.');
    });
  }

  return {
    busy: () => running,
    async removeObject(mask) { const d = host.doc(); if (d) await fill(d, mask, TITLE['tool.remove']); },
    async cmd(id) {
      const d = host.doc();
      if (!d) { toast('Open a photo first.'); return; }
      if (id === 'select.subject' || id === 'image.remove-bg') return subject(d, id === 'image.remove-bg');
      if (id === 'image.upscale-2x' || id === 'image.upscale-4x') return bigger(d, id === 'image.upscale-2x' ? 2 : 4);
      if (id === 'edit.smart-fill') {
        if (!d.selection) { toast('Select what you want gone first, then choose this again.'); return; }
        return fill(d, maskFromSelection(d.selection, d.width, d.height), TITLE['edit.smart-fill']);
      }
    },
  };
}
