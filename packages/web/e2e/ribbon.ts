// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Reach a command the way a person does on a desktop: through its home on the Task ribbon (ribbon-homes.ts), with real
 * clicks, never search. `show` opens the way to it (its tab, its More list or its sheet) and returns the clicks spent;
 * `reach` then clicks it too.
 */
import type { Page } from 'playwright-core';
import { homes, spots, type Spot } from '../src/ribbon-homes';

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const HOMES = homes();

/** Open the way to a command and wait until it is on screen. Returns the clicks spent so far. */
export async function show(p: Page, id: string): Promise<number> {
  const h = HOMES.get(id);
  if (!h) throw new Error(`${id} has no home on the ribbon`);
  if (h.place === 'always') return 0;
  if (h.place === 'sheet') {
    await p.click(`[data-testid="rsheet-${slug(h.tab)}"]`);
    await p.waitForSelector(`[data-testid="rlist"] [data-testid="ri-${id}"]`);
    return 1;
  }
  await p.click(`[data-testid="rtab-${slug(h.tab)}"]`);
  if (h.place === 'more' || h.place === 'family') {
    await p.click(`[data-testid="rmore-${slug(h.tab)}-${slug(h.group)}"]`);
    await p.waitForSelector(`[data-testid="rlist"] [data-testid="ri-${id}"]`);
    return 2;
  }
  await p.waitForSelector(`[data-testid="ribbon-body"] [data-testid="ri-${id}"]`);
  return 1;
}

/** Click a command through its ribbon home. Returns the clicks it took, to hold against `clicks()`. */
export async function reach(p: Page, id: string): Promise<number> {
  const n = await show(p, id);
  if (HOMES.get(id)?.place === 'always') await p.locator(`[data-cmd="${id}"]:visible`).first().click();
  else await p.click(`[data-testid="ri-${id}"]`);
  return n + 1;
}

/** What a spot costs from the resting screen, by the page's rule (the same rule as `clicks()`). */
export const cost = (s: Spot): number => (s.place === 'always' ? 1 : s.place === 'more' || s.place === 'family' ? 3 : 2);
/** Every place an id is shown, cheapest first: `clicks()` promises the first. */
export const ways = (id: string): Spot[] => spots().filter((s) => s.id === id).sort((a, b) => cost(a) - cost(b));
/** Always-on controls that carry a test id instead of `data-cmd`. */
const ALWAYS_SEL: Record<string, string> = { 'file.close': '[data-testid="doc-tab-close"]', 'layer.hide': '[data-testid="layer-eye"]' };

/**
 * Open the way to one spot of a command with real clicks and return the clicks spent with the command's own element, or
 * null when that spot is not on screen within `wait` ms. The caller clicks the element (or not, when it is disabled now).
 */
export async function open(p: Page, s: Spot, wait = 3000): Promise<{ n: number; sel: string } | null> {
  const seen = async (sel: string): Promise<boolean> => p.waitForSelector(sel, { timeout: wait }).then(() => true, () => false);
  if (s.place === 'always') {
    for (const sel of [`[data-cmd="${s.id}"]`, ALWAYS_SEL[s.id]].filter(Boolean)) {
      const el = p.locator(`${sel}:visible`).first();
      if (await el.count()) return { n: 1, sel: `${sel}:visible` };
    }
    return null;
  }
  if (s.place === 'sheet') {
    await p.click(`[data-testid="rsheet-${slug(s.tab)}"]`);
    const sel = `[data-testid="rlist"] [data-testid="ri-${s.id}"]`;
    return (await seen(sel)) ? { n: 2, sel } : null;
  }
  await p.click(`[data-testid="rtab-${slug(s.tab)}"]`);
  const group = `[data-testid="rgroup-${slug(s.tab)}-${slug(s.group)}"]`;
  if (s.place === 'more' || s.place === 'family') {
    if (!(await seen(`${group} [data-testid="rmore-${slug(s.tab)}-${slug(s.group)}"]`))) return null;
    await p.click(`[data-testid="rmore-${slug(s.tab)}-${slug(s.group)}"]`);
    const sel = `[data-testid="rlist"] [data-testid="ri-${s.id}"]`;
    return (await seen(sel)) ? { n: 3, sel } : null;
  }
  const sel = `${group} [data-testid="ri-${s.id}"]`;
  return (await seen(sel)) ? { n: 2, sel } : null;
}
