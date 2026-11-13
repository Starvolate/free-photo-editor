// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Reach a command the way a person does on a desktop: through its home on the Task ribbon (ribbon-homes.ts), with real
 * clicks, never search. `show` opens the way to it (its tab, its More list or its sheet) and returns the clicks spent;
 * `reach` then clicks it too.
 */
import type { Page } from 'playwright-core';
import { homes } from '../src/ribbon-homes';

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
