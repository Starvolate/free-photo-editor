// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The first visit: files the page fetched before the offline worker took charge went straight to the network, so the page
 * asks the worker to save them. A file still downloading at the takeover is listed by the browser only once it arrives,
 * so the page watches for it (keepUnseen). Fake timings, worked by hand: the worker takes charge at 1000 ms.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, keepUnseen, type ShellHost } from '../src/offline';

const SITE = 'https://editor.test';
const TAKEOVER = 1000;
const at = (name: string, startTime: number, duration: number): PerformanceEntry =>
  ({ name, startTime, duration, entryType: 'resource' }) as PerformanceEntry;

/** Stands in for the browser's PerformanceObserver: the test hands it the entries that arrive. */
class FakeObserver {
  static made: FakeObserver[] = [];
  watching = '';
  stopped = false;
  constructor(private cb: (l: { getEntries(): PerformanceEntry[] }) => void) { FakeObserver.made.push(this); }
  observe(o: { type: string }): void { this.watching = o.type; }
  disconnect(): void { this.stopped = true; }
  arrive(...l: PerformanceEntry[]): void { if (!this.stopped) this.cb({ getEntries: () => l }); }
}

/** Already in the browser's list at the takeover: each one started and ended before 1000 ms. */
const DONE = [
  at(SITE + '/assets/index-A1b2C3d4.js', 12, 180), // 12 to 192 ms
  at('https://fonts.example.net/face.css', 30, 60), // another site: not the worker's business
  at(SITE + '/assets/filters-E5f6G7h8.js', 640, 95), // 640 to 735 ms
];

let sent: { type: string; urls: string[] }[];
const worker = { postMessage: (m: unknown): void => { sent.push(m as { type: string; urls: string[] }); } };

beforeEach(() => {
  sent = [];
  FakeObserver.made = [];
  vi.stubGlobal('location', { origin: SITE });
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((t) => (t === 'resource' ? DONE : []));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('keepUnseen: a file still downloading when the worker takes charge is saved too', () => {
  it('sends what had arrived at once, then each same-site file that started before the takeover as it arrives', () => {
    const o = keepUnseen(worker, TAKEOVER, true);
    // 192 ms and 735 ms ends are both before 1000 ms; the font is on another site.
    expect(sent).toEqual([{ type: 'keep', urls: [SITE + '/assets/index-A1b2C3d4.js', SITE + '/assets/filters-E5f6G7h8.js'] }]);
    expect(FakeObserver.made).toHaveLength(1);
    expect(FakeObserver.made[0].watching).toBe('resource');
    expect(o).toBe(FakeObserver.made[0]);

    FakeObserver.made[0].arrive(
      at(SITE + '/assets/ribbon-9hKHT72a.js', 900, 500), // 900 to 1400 ms: started 100 ms before the takeover, so the worker never saw it
      at(SITE + '/assets/registry-union-Q1w2E3r4.js', 1100, 40), // started 100 ms after: it passed through the worker, which saved it
      at('https://cdn.example.net/engine.js', 950, 300), // started before, but another site
    );
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ type: 'keep', urls: [SITE + '/assets/ribbon-9hKHT72a.js'] });

    // 999.5 ms is before 1000 ms (sent); 1000 ms itself is the takeover (not sent); 2500 ms is well after (not sent).
    FakeObserver.made[0].arrive(at(SITE + '/assets/tool-kit-Z9y8X7w6.js', 999.5, 2000), at(SITE + '/assets/a-Aa11Bb22.js', 1000, 5), at(SITE + '/assets/b-Cc33Dd44.js', 2500, 5));
    expect(sent).toHaveLength(3);
    expect(sent[2].urls).toEqual([SITE + '/assets/tool-kit-Z9y8X7w6.js']);
  });

  it('posts nothing for a batch where every file came after the takeover or from another site', () => {
    keepUnseen(worker, TAKEOVER, true);
    FakeObserver.made[0].arrive(at(SITE + '/assets/late-Ee55Ff66.js', 1200, 30), at('https://other.example.org/x.js', 10, 2000));
    expect(sent).toHaveLength(1);
  });

  it('without watch (the page was in the worker\'s charge from the start), sends the loaded files once and watches nothing', () => {
    expect(keepUnseen(worker, TAKEOVER, false)).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(FakeObserver.made).toHaveLength(0);
  });

  it('the editor watches only after a takeover, stops the old watcher on the next one, and stops watching when it closes', () => {
    vi.stubGlobal('navigator', { userAgent: '', platform: '', maxTouchPoints: 0, serviceWorker: { controller: worker } });
    const host = {} as ShellHost;
    const shell = new AppShell(host, undefined);
    const keepLoaded = (takeover?: boolean): void => (shell as unknown as { keepLoaded(t?: boolean): void }).keepLoaded(takeover);
    keepLoaded();
    expect(FakeObserver.made).toHaveLength(0);
    keepLoaded(true);
    keepLoaded(true);
    expect(FakeObserver.made.map((o) => o.stopped)).toEqual([true, false]);
    shell.dispose();
    expect(FakeObserver.made.map((o) => o.stopped)).toEqual([true, true]);
    expect(sent).toHaveLength(3);
  });
});
