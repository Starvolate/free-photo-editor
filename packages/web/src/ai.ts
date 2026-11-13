// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The on-device AI commands in the editor (W11, W2), loaded the first time one is used: Select an object (tap to select),
 * Select the main subject, Remove the background (onto a layer mask, so nothing is deleted), Remove an object (the brush,
 * and Edit › Fill from the surroundings) and Make it bigger (2x and 4x). Before the first download a sheet says how much
 * comes down, once; the photo itself never leaves this device. No caller ever waits on the person: `cmd()` resolves as soon as
 * the sheet is open, and closing the sheet while it waits for a yes counts as no.
 */
import {
  AiClient, Cancelled, blendFill, cannotRun, contextBox, deepestPoint, downloadSize, estimateSeconds, extrapolateSeconds, fillOnly, mb, minutesText, timeVerdict,
  unionMask, type ModelId, type Progress, type SegPrompt,
} from '@free-photoeditor/ai';
import {
  activeLayer, addLayer, compositeDoc, createLayer, docCommand, docRect, expandMask, featherMask, makeMask, maskBounds, maskFromSelection, pixelCommand, readRegion,
  resizeBitmap, resizeMask, selectionFromMask, snapshotDoc, writeRegion, type Command, type Doc, type Mask, type Rect, type Selection,
} from '@free-photoeditor/core';
import { errText, h } from './dom';
import { placeCutout } from './cutout-place';
import { maxPixelsForDevice } from './io';
import { keepFiles } from './offline';
import type { ToolHost } from './toolkit';

export interface AiKit {
  /** Run an AI command by its function-map id. Resolves as soon as its sheet is open (or at once when it cannot start), never when the job ends. */
  cmd(id: string): Promise<void>;
  /** The Remove tool: fill the painted mask (picture size, any value above 0) from its surroundings. Resolves when the job has ended (done, stopped, closed or failed), so the tool can clear its marks. */
  removeObject(mask: Mask): Promise<void>;
  /** Tap to select: the thing at the tap, or inside the box, as a picture-sized mask (0 or 255); null when nothing came of it. */
  objectSelect(prompt: SegPrompt): Promise<Mask | null>;
  busy(): boolean;
}
const TITLE: Record<string, string> = {
  'select.subject': 'Select the main subject', 'image.remove-bg': 'Remove the background', 'edit.smart-fill': 'Fill from the surroundings',
  'image.upscale-2x': 'Make it twice as big', 'image.upscale-4x': 'Make it four times as big', 'tool.remove': 'Remove an object',
  'tool.object-select': 'Select an object',
};
/** The refusal for a job over about 20 minutes, and the warning for one over about 30 seconds, in plain words. */
const tooSlow = (secs: number): string => `This device is too slow for this picture: it would take ${minutesText(secs)}. Make the picture smaller first, or use a computer.`;
const slowNote = (secs: number): string => `On this device this takes ${minutesText(secs)}. You can keep looking around, or press Cancel at any time.`;
const CHANGED = 'The picture changed while the AI was working, so nothing was applied. Try again.';

export function createAiKit(host: ToolHost): AiKit {
  const client = new AiClient();
  let running = false, current = '', asked = 0, watched = false, answer: ((go: boolean) => void) | null = null;
  /** Why the editor stopped the running job (too slow for this device), said instead of "Stopped." */
  let stopText: string | null = null;
  /** Seconds per picture pixel that making a picture bigger took on this device, timed on the last job's first tile. */
  let pace: number | undefined;
  /** `cmd()` calls still waiting for the sheet to open. */
  const waiting = new Set<() => void>();
  const msg = h('p', { class: 'fpe-ai-msg', 'data-testid': 'ai-message' });
  const note = h('p', { class: 'fpe-note', 'data-testid': 'ai-note' });
  const bar = h('progress', { class: 'fpe-ai-bar', max: 100, 'data-testid': 'ai-progress' });
  const status = h('p', { class: 'fpe-hint', 'data-testid': 'ai-status', 'aria-live': 'polite' });
  const go = h('button', { type: 'button', class: 'fpe-btn fpe-btn-primary', 'data-testid': 'ai-download' }, 'Download and start');
  const stop = h('button', { type: 'button', class: 'fpe-btn fpe-btn-ghost', 'data-testid': 'ai-cancel' }, 'Cancel');
  const body = h('div', { class: 'fpe-ai', 'data-testid': 'ai-sheet' }, msg, note, bar, status, h('div', { class: 'fpe-actions' }, stop, go));
  const toast = (m: string): void => host.toast(m);
  const shown = (): boolean => body.isConnected && !body.closest('[data-state="closed"]');
  /** Close the AI sheet only: never another sheet the person opened meanwhile. */
  const closeSheet = (): void => { if (shown()) host.closeSheet(); };
  /** Open (or bring back) the sheet and let every waiting `cmd()` go. Closing the sheet while it waits for a yes counts as no. */
  function show(title: string): void {
    host.sheet('ai', title, body);
    const s = body.closest<HTMLElement>('[data-state]');
    if (s && !watched) {
      watched = true;
      new MutationObserver(() => { if (s.dataset.state === 'closed' && answer) { const a = answer; answer = null; a(false); } })
        .observe(s, { attributes: true, attributeFilter: ['data-state'] });
    }
    for (const f of waiting) f();
    waiting.clear();
  }
  go.addEventListener('click', () => { const a = answer; answer = null; a?.(true); });
  stop.addEventListener('click', () => { const a = answer; answer = null; if (a) a(false); else if (running) client.cancel(); else closeSheet(); });
  const progress = (p: Progress): void => {
    if (p.stage === 'start') { bar.removeAttribute('value'); status.textContent = 'Getting the AI ready on this device…'; return; }
    bar.value = Math.floor((p.done / Math.max(1, p.total)) * 100);
    status.textContent = p.stage === 'download' ? `Downloading: ${bar.value}%. This happens only once.` : `Working on your photo: ${bar.value}%`;
  };
  const working = (text: string): void => { bar.removeAttribute('value'); status.textContent = text; };

  /** Open the sheet at once. The first time, say how much downloads and wait for a yes. False when the person says no or closes the sheet. */
  async function ask(models: ModelId[], title: string, slow: string): Promise<boolean> {
    const why = cannotRun();
    if (why) { toast(why); return false; }
    const mine = ++asked;
    answer?.(false);
    answer = null;
    msg.textContent = 'Checking what needs to download…';
    note.textContent = slow;
    note.hidden = !slow;
    status.textContent = '';
    go.hidden = true;
    bar.hidden = true;
    show(title);
    const size = await downloadSize(models, models.every((m) => client.loaded.has(m)));
    if (mine !== asked || !shown()) return false;
    if (size <= 0) { msg.textContent = 'Your photo never leaves this device.'; bar.hidden = false; return true; }
    msg.textContent = `This downloads once, about ${mb(size)} MB. Your photo never leaves this device.`;
    go.hidden = false;
    const yes = await new Promise<boolean>((resolve) => { answer = resolve; });
    if (!yes) { if (mine === asked) closeSheet(); return false; }
    go.hidden = true;
    bar.hidden = false;
    return true;
  }
  /** Ask, download and load the model, then do the work; errors and Cancel end in plain words. Resolves when the job has ended. */
  async function job(model: ModelId | ModelId[], title: string, slow: string, work: () => Promise<void>): Promise<void> {
    const models = Array.isArray(model) ? model : [model];
    if (running) { show(current); toast('The AI is still working on the last job. Wait for it, or press Cancel.'); return; }
    if (!(await ask(models, title, slow))) return;
    running = true;
    current = title;
    stopText = null;
    try {
      working('Getting the AI ready on this device…');
      // The worker's own file is not in the page's list of loaded files: ask the offline worker to keep it too.
      for (const m of models) keepFiles(await client.prepare(m, progress));
      await work();
    } catch (e) {
      if (e instanceof Cancelled) toast(stopText ?? 'Stopped. Nothing was changed.');
      else { console.warn('[ai]', e); toast(`The AI could not finish: ${errText(e)}`); }
    } finally {
      running = false;
      closeSheet();
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

  /**
   * The main subject's mask, by model check round 4's rule: u2netp's answer, joined with MobileSAM's whole object at
   * u2netp's deepest pixel, which recovers the parts u2netp alone leaves out. Where only MobileSAM found the subject the
   * edge is hard until Refine edge.
   */
  async function subjectMask(comp: Uint8ClampedArray, W: number, H: number): Promise<Uint8Array> {
    const soft = await client.subject({ width: W, height: H, data: comp.slice() }, progress);
    const p = deepestPoint(soft, W, H);
    if (!p) return soft;
    working('Finding all of it…');
    return unionMask(soft, await client.segment({ width: W, height: H, data: comp.slice() }, { points: [p] }, 'largest'));
  }
  /**
   * Select the main subject, or (remove) show only it: a copy of the picture whose layer mask hides the background, over
   * the original layers, hidden. Nothing is deleted: switch the mask off and the whole picture is back.
   */
  async function subject(d: Doc, remove: boolean): Promise<void> {
    const W = d.width, H = d.height, title = TITLE[remove ? 'image.remove-bg' : 'select.subject'];
    await job(['subject', 'segment'], title, '', async () => {
      working('Finding the main subject…');
      const comp = compositeDoc(d, docRect(d)), mask = await subjectMask(comp, W, H);
      if (!same(d, W, H)) { toast(CHANGED); return; }
      const sel = selectionFromMask({ width: W, height: H, data: mask });
      if (!sel) { toast('No clear subject was found. Try Select an object, Paint to select or Draw around it instead.'); return; }
      if (!remove) {
        select(d, sel, title);
        toast('Main subject selected. Fine-tune it with Select › Change the selection, or add to it with Select an object.');
        return;
      }
      const before = snapshotDoc(d), after = snapshotDoc(d), layer = createLayer('Background removed', W, H, { data: comp });
      after.selection = sel;
      const lm = makeMask(after, 'selection');
      if (!lm) { toast('No clear subject was found. Try Select an object instead.'); return; }
      layer.mask = lm;
      placeCutout(after, layer);
      const cmd = docCommand(title, before, after);
      cmd.redo(d);
      host.forgetHole();
      host.push(cmd, true);
      host.selectionChanged();
      host.panels();
      toast('Background removed on a mask, so nothing is deleted. The original is kept, hidden, under it in Layers.');
    });
  }

  /**
   * Make every layer f times bigger: painted layers through the AI, text and shape layers smoothly. The first tile is timed
   * on this device and the rest extrapolated from it: a job over about 30 seconds says how many minutes it takes, and one
   * over about 20 minutes stops with the reason.
   */
  async function bigger(d: Doc, f: 2 | 4): Promise<void> {
    const W = d.width, H = d.height, title = TITLE[f === 2 ? 'image.upscale-2x' : 'image.upscale-4x'];
    if (W * f * H * f > maxPixelsForDevice()) {
      toast(f === 4 ? 'Four times as big would be too large for this device. Try twice as big.' : 'Twice as big would be too large for this device. Make the picture smaller first.');
      return;
    }
    const px = d.layers.reduce((a, l) => a + (l.content ? 0 : l.width * l.height), 0), secs = estimateSeconds('upscale', px, pace);
    if (timeVerdict(secs) === 'refuse') { toast(tooSlow(secs)); return; }
    await job('upscale', title, timeVerdict(secs) === 'warn' ? slowNote(secs) : '', async () => {
      working('Making it bigger…');
      const before = snapshotDoc(d), after = snapshotDoc(d), total = Math.max(1, d.layers.filter((l) => !l.content).length);
      // The work starts now: the download and the loading are behind it, so the first tile times this device fairly.
      const t0 = performance.now();
      let done = 0, timed = false;
      for (let k = 0; k < after.layers.length; k++) {
        const l = after.layers[k], nw = l.width * f, nh = l.height * f;
        // A mask grows with its layer, the way Picture size redraws it.
        const mask = l.mask ? { mask: resizeMask(l.mask, f, f) } : {};
        if (l.content) { after.layers[k] = { ...l, x: l.x * f, y: l.y * f, width: nw, height: nh, data: resizeBitmap(l, nw, nh, 'smooth'), ...mask }; continue; }
        const big = await client.upscale({ width: l.width, height: l.height, data: l.data.slice() }, f, (p) => {
          const at = done * p.total + p.done, all = total * p.total;
          if (!timed && p.stage === 'work' && at > 0) {
            timed = true;
            const est = extrapolateSeconds(performance.now() - t0, at, all), verdict = timeVerdict(est);
            pace = est / Math.max(1, px);
            if (verdict === 'refuse') { stopText = tooSlow(est); client.cancel(); return; }
            note.textContent = verdict === 'warn' ? slowNote(est) : '';
            note.hidden = verdict !== 'warn';
          }
          progress({ stage: 'work', done: at, total: all });
        });
        after.layers[k] = { ...l, x: l.x * f, y: l.y * f, width: big.width, height: big.height, data: big.data, ...mask };
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
    const W = d.width, H = d.height, hole = expandMask(mask, 3), b = maskBounds(hole, 1), a = activeLayer(d);
    // Painting on a mask: removing changes pixels only, so it refuses in plain words before any AI work (text, shape and
    // locked layers keep their fill on a new layer).
    if (a?.mask && !a.content && !a.locked && !host.editable(a, true)) return;
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

  /**
   * Tap to select. The first use asks for the download in the sheet; once the AI is ready on this device a tap answers
   * without opening it (the picture is read once, so each later tap takes a fraction of a second).
   */
  async function objectSelect(prompt: SegPrompt): Promise<Mask | null> {
    const d = host.doc();
    if (!d) return null;
    const W = d.width, H = d.height;
    let out: Mask | null = null;
    const work = async (): Promise<void> => {
      const m = await client.segment({ width: W, height: H, data: compositeDoc(d, docRect(d)).slice() }, prompt, 'best', prompt.box ?? null);
      if (!same(d, W, H)) { toast(CHANGED); return; }
      if (!m.some((v) => v > 0)) { toast('Nothing was found there. Tap the middle of the thing, or drag a box round it.'); return; }
      out = { width: W, height: H, data: m };
    };
    if (!running && client.loaded.has('segment')) {
      running = true;
      try { await work(); } catch (e) { console.warn('[ai]', e); toast(`The AI could not finish: ${errText(e)}`); } finally { running = false; }
    } else await job('segment', TITLE['tool.object-select'], '', async () => { working('Finding the object…'); await work(); });
    return out;
  }

  /** Where each command goes; resolves when its job has ended. */
  async function route(id: string): Promise<void> {
    const d = host.doc();
    if (!d) { toast('Open a photo first.'); return; }
    if (id === 'select.subject' || id === 'image.remove-bg') return subject(d, id === 'image.remove-bg');
    if (id === 'image.upscale-2x' || id === 'image.upscale-4x') return bigger(d, id === 'image.upscale-2x' ? 2 : 4);
    if (id === 'edit.smart-fill') {
      if (!d.selection) { toast('Select what you want gone first, then choose this again.'); return; }
      return fill(d, maskFromSelection(d.selection, d.width, d.height), TITLE['edit.smart-fill']);
    }
  }

  return {
    busy: () => running,
    async removeObject(mask) { const d = host.doc(); if (d) await fill(d, mask, TITLE['tool.remove']); },
    objectSelect,
    cmd(id) {
      return new Promise<void>((resolve) => {
        waiting.add(resolve);
        route(id).catch((e: unknown) => { console.warn('[ai]', e); toast(`The AI could not finish: ${errText(e)}`); })
          .finally(() => { waiting.delete(resolve); resolve(); });
      });
    },
  };
}
