// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * One control renderer for every adjustment's settings (design 6): the Image › Adjustments dialogs and the Properties of an
 * editable light and colour layer draw the same controls (labels, plain help lines, ranges, defaults) from the same `ADJ`
 * entry, so the two can never drift apart. Each control writes its number into `params`, then calls the hooks.
 */
import type { Ctl } from './commands';
import { h } from './dom';

export const fmtNum = (v: number): string => (Number.isInteger(v) ? String(v) : Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1));
/** A labelled control with its plain help line, the label on its own line above the control. */
export function field(id: string, label: string, help: string, control: HTMLElement, out?: HTMLElement | null): HTMLElement {
  return h('div', { class: 'fpe-field', 'data-help-title': label, 'data-help': help }, h('div', { class: 'fpe-field-top' }, h('label', { for: id }, label), out ?? null), control);
}
export interface ControlHooks {
  /** A setting moved: show it live. */
  input(): void;
  /** A setting was let go (one undo step in Properties). */
  commit?(): void;
  /** A ready-made choice filled in several settings: draw the controls again. */
  rerender(): void;
}
/** The controls of one adjustment, in order, with their group titles. `idBase + key` is each control's id. */
export function renderControls(controls: readonly Ctl[], params: Record<string, number | undefined>, idBase: string, hooks: ControlHooks): HTMLElement[] {
  const kids: HTMLElement[] = [];
  let group = '';
  for (const c of controls) {
    if (c.group && c.group !== group) { group = c.group; kids.push(h('h3', { class: 'fpe-group-title' }, group)); }
    const cid = idBase + c.key;
    if (c.type === 'select') {
      const sel = h('select', { id: cid, 'data-testid': 'ctl-' + c.key }, ...(c.options ?? []).map((o, k) => h('option', { value: k, selected: k === params[c.key] }, o)));
      sel.addEventListener('change', () => {
        params[c.key] = Number(sel.value);
        const fill = c.fills?.[Number(sel.value)];
        if (fill) { Object.assign(params, fill); hooks.rerender(); }
        hooks.input();
        hooks.commit?.();
      });
      kids.push(h('div', { class: 'fpe-row', 'data-help-title': c.label, 'data-help': c.help }, h('label', { for: cid }, c.label), sel));
    } else if (c.type === 'num') {
      const last = kids[kids.length - 1];
      let grid = last instanceof HTMLElement && last.classList.contains('fpe-kernel') ? last : null;
      if (!grid) { grid = h('div', { class: 'fpe-kernel', role: 'group', 'aria-label': c.group ?? 'Numbers' }); kids.push(grid); }
      const inp = h('input', { id: cid, type: 'number', inputmode: 'numeric', min: c.min ?? -99, max: c.max ?? 99, step: c.step ?? 1, value: params[c.key] ?? c.value,
        'aria-label': c.label, 'data-testid': 'ctl-' + c.key, 'data-help-title': c.label, 'data-help': c.help });
      inp.addEventListener('input', () => { const v = Number(inp.value); if (inp.value !== '' && Number.isFinite(v)) { params[c.key] = v; hooks.input(); } });
      inp.addEventListener('change', () => hooks.commit?.());
      grid.append(inp);
    } else if (c.type === 'check') {
      const cb = h('input', { id: cid, type: 'checkbox', checked: !!params[c.key], 'data-testid': 'ctl-' + c.key });
      cb.addEventListener('change', () => { params[c.key] = cb.checked ? 1 : 0; hooks.input(); hooks.commit?.(); });
      kids.push(h('div', { class: 'fpe-check', 'data-help-title': c.label, 'data-help': c.help }, cb, h('label', { for: cid }, c.label)));
    } else {
      const val = Number(params[c.key] ?? c.value), unit = c.unit ?? '';
      const out = h('output', { class: 'fpe-out', for: cid }, fmtNum(val) + unit);
      const inp = h('input', { id: cid, type: 'range', min: c.min ?? 0, max: c.max ?? 100, step: c.step ?? 1, value: val, 'data-testid': 'ctl-' + c.key });
      inp.addEventListener('input', () => { const v = Number(inp.value); params[c.key] = v; out.textContent = fmtNum(v) + unit; hooks.input(); });
      inp.addEventListener('change', () => hooks.commit?.());
      kids.push(field(cid, c.label, c.help, inp, out));
    }
  }
  return kids;
}
