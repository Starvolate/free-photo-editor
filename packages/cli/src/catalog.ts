// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Every adjustment and filter the command line and the MCP server can run. It is read straight from the web app's own
 * function map (plain name, pro name, one line of help, wish words) and its dialog controls (each setting's plain name,
 * range and default), so a filter that becomes Ready in the web app becomes a command here with no extra work.
 */
import type { JobParams } from '@free-photoeditor/core';
import { ADJ, type AdjDef, type Ctl } from '../../web/src/commands';
import { BY_ID, MENU_INFO, search } from '../../web/src/registry';

export type OpGroup = 'adjust' | 'filter';
export type SettingValue = number | string | boolean;
export interface Setting {
  key: string; name: string; help: string; type: 'number' | 'choice' | 'switch'; default: SettingValue;
  min?: number; max?: number; step?: number; unit?: string; choices?: string[]; group?: string;
}
export interface Operation {
  id: string; group: OpGroup; registryId: string; plain: string; pro: string; help: string; wish: string; place: string;
  settings: Setting[]; usesColors: boolean; def: AdjDef;
}

const shortId = (rid: string): string => rid.replace(/^image\.(adj-)?/, '').replace(/^filter\./, '');
export const norm = (s: string): string => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const numMin = (c: Ctl): number => c.min ?? (c.type === 'num' ? -99 : -Infinity);
const numMax = (c: Ctl): number => c.max ?? (c.type === 'num' ? 99 : Infinity);

function toSetting(c: Ctl): Setting {
  const base = { key: c.key, name: c.label, help: c.help || c.label, ...(c.group ? { group: c.group } : {}) };
  if (c.type === 'select') return { ...base, type: 'choice', default: c.options?.[c.value] ?? '', choices: [...(c.options ?? [])] };
  if (c.type === 'check') return { ...base, type: 'switch', default: !!c.value };
  const unit = (c.unit ?? '').trim(), min = numMin(c), max = numMax(c);
  return { ...base, type: 'number', default: c.value, ...(Number.isFinite(min) ? { min } : {}), ...(Number.isFinite(max) ? { max } : {}),
    ...(c.step ? { step: c.step } : {}), ...(unit ? { unit } : {}) };
}

/** Every Ready adjustment and filter, in the web app's menu order. */
const JOB_OPS: readonly string[] = ['adjust', 'gaussian-blur', 'sharpen', 'fx'];
/** A Ready picture adjustment or filter that runs as an engine job (dialogs for selections or tools are not operations here). */
export const isOperation = (rid: string, def: AdjDef): boolean =>
  /^(image|filter)\./.test(rid) && JOB_OPS.includes(def.op) && BY_ID.get(rid)?.status === 'ready';
export const OPERATIONS: Operation[] = Object.entries(ADJ).flatMap(([rid, def]): Operation[] => {
  const r = BY_ID.get(rid);
  if (!r || !isOperation(rid, def)) return [];
  return [{ id: shortId(rid), group: rid.startsWith('filter.') ? 'filter' : 'adjust', registryId: rid, plain: r.plain, pro: r.pro,
    help: r.help, wish: r.wish, place: r.place, settings: def.controls.map(toSetting), usesColors: !!def.colors, def }];
});
export const opsIn = (group?: OpGroup): Operation[] => OPERATIONS.filter((o) => !group || o.group === group);
/** "Filter > Blur" as people read it, with its plain and pro names. */
export function placeName(place: string): string {
  const m = MENU_INFO.get(place);
  return m ? (m.plain === m.pro ? m.plain : `${m.plain} · ${m.pro}`) : place.replace(/ > /g, ' › ');
}
/** By short id (levels), registry id (image.adj-levels), pro name (Levels) or plain name (Light and dark balance). */
export function findOperation(name: string, group?: OpGroup): Operation | undefined {
  const n = norm(name), pool = opsIn(group);
  for (const k of ['id', 'registryId', 'pro', 'plain'] as const) {
    const hit = pool.find((o) => norm(o[k]) === n);
    if (hit) return hit;
  }
  return undefined;
}

/** How to run a registry row from here, for rows that are not adjustments or filters. */
const COMMAND_FOR: Record<string, string> = {
  'image.size': 'resize --width <pixels>', 'tool.crop': 'crop --aspect 1:1', 'image.crop': 'crop --area x,y,width,height',
  'image.trim': 'crop --trim', 'image.rotate-cw': 'rotate --turn right', 'image.rotate-ccw': 'rotate --turn left',
  'image.rotate-180': 'rotate --turn 180', 'image.flip-h': 'flip --direction horizontal', 'image.flip-v': 'flip --direction vertical',
  'edit.flip-layer-h': 'flip --direction horizontal --layer <layer>', 'edit.flip-layer-v': 'flip --direction vertical --layer <layer>',
  'edit.rotate-layer-cw': 'rotate --turn right --layer <layer>', 'edit.rotate-layer-ccw': 'rotate --turn left --layer <layer>',
  'edit.rotate-layer-180': 'rotate --turn 180 --layer <layer>', 'layer.merge-visible': 'layers merge',
  'layer.merge-down': 'layers merge --layer <layer>', 'layer.flatten': 'layers flatten', 'panel.layers': 'layers list',
  'file.export': 'export --to <png|jpeg|webp|psd>', 'file.quick-png': 'convert --to png', 'file.save-psd': 'convert --to psd',
  'file.export-png': 'convert --to png', 'file.export-jpeg': 'convert --to jpeg', 'file.export-webp': 'convert --to webp',
  'file.export-psd': 'convert --to psd', 'file.info': 'info', 'panel.info': 'info',
};
export interface Found { registryId: string; plain: string; pro: string; help: string; run: string | null; operation: string | null; }
/** The web app's wish search ("make it brighter", "blur the background"), with how to run each match here. */
export function searchWishes(query: string, limit = 10): Found[] {
  return search(query, 40).map((r): Found => {
    const op = OPERATIONS.find((o) => o.registryId === r.id);
    return { registryId: r.id, plain: r.plain, pro: r.pro, help: r.help, operation: op ? op.id : null,
      run: op ? `${op.group} ${op.id}` : COMMAND_FOR[r.id] ?? null };
  }).filter((f) => f.run).slice(0, limit);
}
export const suggest = (name: string, group?: OpGroup): Operation[] =>
  searchWishes(name, 30).flatMap((f) => opsIn(group).filter((o) => o.id === f.operation)).slice(0, 3);

function findControl(op: Operation, key: string): Ctl {
  const ctls = op.def.controls, k = key.trim();
  const byKey = ctls.find((c) => c.key === k) ?? ctls.find((c) => c.key.toLowerCase() === k.toLowerCase());
  const byName = ctls.filter((c) => norm(c.label) === norm(k));
  const c = byKey ?? (byName.length === 1 ? byName[0] : undefined);
  if (!c) throw new Error(`"${op.id}" has no setting called "${key}". ${ctls.length ? `Its settings are: ${ctls.map((x) => x.key).join(', ')}.` : 'It has no settings.'}`);
  return c;
}
function toNumber(op: Operation, c: Ctl, raw: SettingValue): number {
  if (c.type === 'select') {
    const opts = c.options ?? [];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < opts.length) return raw;
    const s = norm(String(raw));
    let i = opts.findIndex((o) => norm(o) === s);
    if (i < 0) {
      const near = opts.map((o, j) => [norm(o), j] as const).filter(([o]) => s && (o.startsWith(s) || o.split(' ').includes(s)));
      if (near.length === 1) i = near[0][1];
    }
    if (i < 0) throw new Error(`${op.id} ${c.key} (${c.label}) must be one of: ${opts.map((o) => `"${o}"`).join(', ')}.`);
    return i;
  }
  if (c.type === 'check') {
    const s = String(raw).toLowerCase().trim();
    if (raw === true || ['1', 'true', 'yes', 'on', 'y'].includes(s)) return 1;
    if (raw === false || ['0', 'false', 'no', 'off', 'n'].includes(s)) return 0;
    throw new Error(`${op.id} ${c.key} (${c.label}) is a switch: use yes or no.`);
  }
  const v = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/\s*(px|%|°|×|x|stops?)$/i, ''));
  const min = numMin(c), max = numMax(c), unit = c.unit ?? '';
  if (typeof raw === 'boolean' || !Number.isFinite(v)) throw new Error(`${op.id} ${c.key} (${c.label}) needs a number${Number.isFinite(min) ? ` from ${min} to ${max}${unit}` : ''}.`);
  if (v < min || v > max) throw new Error(`${op.id} ${c.key} (${c.label}) must be from ${min} to ${max}${unit}; you gave ${v}.`);
  return v;
}
/**
 * The numbers the engine gets, built the way the web app's dialog builds them: every control's default, then a
 * ready-made choice's own numbers (the custom filter's grids), then the settings given.
 */
export function resolveParams(op: Operation, given: Record<string, SettingValue> = {}): JobParams {
  const params: JobParams = {};
  for (const c of op.def.controls) params[c.key] = c.value;
  const chosen = Object.entries(given).map(([k, raw]) => { const c = findControl(op, k); return [c, toNumber(op, c, raw)] as const; });
  for (const [c, v] of chosen) if (c.fills?.[v]) Object.assign(params, c.fills[v]);
  for (const [c, v] of chosen) params[c.key] = v;
  return params;
}

/** An operation as plain data, for --json and for agents. */
export function operationJson(o: Operation) {
  return { id: o.id, group: o.group, name: o.plain, proName: o.pro, help: o.help, searchWords: o.wish, place: o.place.replace(/ > /g, ' › '),
    usesColors: o.usesColors, settings: o.settings };
}
