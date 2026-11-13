// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * The service worker: the editor keeps working without the internet.
 * - The app shell (the page, its script and styles, the filter worker, the icons) is saved when this worker installs.
 * - Every add-on (a filter family, a tool, a file format, PSD; later AI models served from this folder) is saved the
 *   first time it is used, so it works offline from then on.
 * - Each build is a new version. A new version waits until the person presses Reload on "A new version is ready"; the
 *   add-ons they used before are carried over (or fetched again when they changed) before it takes over.
 * - Photos sent to the installed app from a phone's share sheet arrive here as a POST and are handed to the page.
 * Caches are shared by the whole site, so every name starts with "fpe:" and this worker's scope, and only those are
 * ever deleted. Self-contained on purpose (no imports): scripts/pwa.ts strips the types and fills in __FPE_BUILD__.
 */
interface Build {
  /** Changes with every build: names this version's caches. */
  version: string;
  /** Saved at install, relative to this file's folder. */
  shell: string[];
  /** Every other file of the build: saved on first use. */
  addons: string[];
  /** The editor's own page, relative to this folder. */
  start: string;
  /** Where the share sheet posts photos, and the form field that holds them. */
  share: string; shareField: string;
}
interface ExtEvent extends Event { waitUntil(p: Promise<unknown>): void; }
interface FetchEvt extends ExtEvent { readonly request: Request; respondWith(r: Response | Promise<Response>): void; }
interface MsgEvt extends ExtEvent { readonly data: unknown; }
interface SwScope {
  readonly registration: { readonly scope: string };
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', f: (e: ExtEvent) => void): void;
  addEventListener(type: 'fetch', f: (e: FetchEvt) => void): void;
  addEventListener(type: 'message', f: (e: MsgEvt) => void): void;
}
declare const __FPE_BUILD__: Build;

const sw = self as unknown as SwScope;
const B = __FPE_BUILD__;
const HERE = new URL('./', location.href).href;
const ORIGIN = new URL(HERE).origin;
const abs = (p: string): string => new URL(p, HERE).href;
const bare = (u: string): string => u.split('#')[0].split('?')[0];
const PREFIX = 'fpe:' + sw.registration.scope + ':';
const SHELL = PREFIX + 'shell:' + B.version;
const ADDONS = PREFIX + 'addons:' + B.version;
/** Files under this folder that are not part of a build (for example models): kept across versions. */
const FILES = PREFIX + 'files';
/** Same-site pages and files outside this folder (a host page that embeds the editor): network first, saved copy offline. */
const SITE = PREFIX + 'site';
const SHARED = PREFIX + 'shared';
/** Which add-ons were used, by file name without its content hash, so a new version fetches them again. */
const USED = PREFIX + 'used';
const USED_KEY = abs('__fpe-used.json');
const SHELL_URLS = B.shell.map(abs);
const ADDON_URLS = new Set(B.addons.map(abs));
const START = abs(B.start);
const SHARE = abs(B.share);
/** "assets/fx-B3x_9kQ1.js" and the next build's "assets/fx-Zq81_aaB.js" share the stable name "assets/fx.js". */
const stable = (u: string): string => bare(u).replace(/-[\w-]{8}(\.[a-z0-9]+)$/i, '$1');

let used: Set<string> | null = null;
async function readUsed(): Promise<Set<string>> {
  if (used) return used;
  try {
    const r = await (await caches.open(USED)).match(USED_KEY);
    used = new Set(r ? ((await r.json()) as string[]) : []);
  } catch { used = new Set(); }
  return used;
}
async function markUsed(url: string): Promise<void> {
  const u = await readUsed(), k = stable(url);
  if (u.has(k)) return;
  u.add(k);
  await (await caches.open(USED)).put(USED_KEY, new Response(JSON.stringify([...u]), { headers: { 'content-type': 'application/json' } }));
}
async function cachedIn(names: string[], req: Request | string): Promise<Response | undefined> {
  for (const n of names) {
    const hit = await (await caches.open(n)).match(req);
    if (hit) return hit;
  }
  return undefined;
}

sw.addEventListener('install', (e) => e.waitUntil((async () => {
  const shell = await caches.open(SHELL);
  await shell.addAll(SHELL_URLS.map((u) => new Request(u, { cache: 'reload' })));
  // Add-ons used with an earlier version stay offline: copy the unchanged files, fetch the changed ones.
  const olds = (await caches.keys()).filter((k) => k.startsWith(PREFIX + 'addons:') && k !== ADDONS);
  const u = await readUsed();
  const want = [...ADDON_URLS].filter((url) => u.has(stable(url)));
  if (!want.length) return;
  const next = await caches.open(ADDONS);
  await Promise.all(want.map(async (url) => {
    try {
      const old = await cachedIn(olds, url);
      if (old) await next.put(url, old);
      else await next.add(url);
    } catch { /* fetched again on its next use */ }
  }));
})()));

sw.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) {
    if ((k.startsWith(PREFIX + 'shell:') && k !== SHELL) || (k.startsWith(PREFIX + 'addons:') && k !== ADDONS)) await caches.delete(k);
  }
  await sw.clients.claim();
})()));

sw.addEventListener('message', (e) => {
  const d = e.data as { type?: string; urls?: unknown } | null;
  if (d?.type === 'skip-waiting') void sw.skipWaiting();
  // Files the page fetched before this worker was in charge (the first visit): save them as if used through it.
  else if (d?.type === 'keep' && Array.isArray(d.urls)) e.waitUntil(Promise.all(d.urls.map(String).map(keep)));
});
async function keep(url: string): Promise<void> {
  const u = bare(url);
  if (!u.startsWith(HERE) || u === abs('sw.js')) return;
  try {
    if (await cachedIn([SHELL, ADDONS, FILES], u)) return;
    const res = await fetch(u);
    if (res.ok) await store(u, res);
  } catch { /* not reachable now: it is saved on its next use */ }
}
async function store(url: string, res: Response): Promise<void> {
  const inBuild = ADDON_URLS.has(url);
  await (await caches.open(inBuild ? ADDONS : FILES)).put(url, res);
  if (inBuild) await markUsed(url);
}

sw.addEventListener('fetch', (e) => {
  const req = e.request, url = bare(req.url);
  if (req.method === 'POST' && url === SHARE) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET' || new URL(url).origin !== ORIGIN || req.headers.has('range')) return;
  if (req.mode === 'navigate') { e.respondWith(page(req, e)); return; }
  if (url === abs('sw.js')) return;
  e.respondWith(url.startsWith(HERE) ? file(req, url, e) : site(req, e));
});

/** The editor's own page comes from this version's saved shell, so page and files always match. */
async function page(req: Request, e: FetchEvt): Promise<Response> {
  const url = bare(req.url);
  if (url === START || url === HERE) {
    const hit = await cachedIn([SHELL], START);
    if (hit) return hit;
  }
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') { const copy = res.clone(); e.waitUntil(caches.open(SITE).then((c) => c.put(url, copy))); }
    return res;
  } catch {
    return (await cachedIn([SITE], url)) ?? (await cachedIn([SHELL], START))
      ?? new Response('You are offline, and this page was not saved yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
/** Files of this folder: the saved copy first; anything fetched is saved for next time. */
async function file(req: Request, url: string, e: FetchEvt): Promise<Response> {
  const hit = await cachedIn([SHELL, ADDONS, FILES], url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && (res.type === 'basic' || res.type === 'cors')) e.waitUntil(store(url, res.clone()));
  return res;
}
/** Same-site files outside this folder (a host page's own files): the network first, the saved copy when offline. */
async function site(req: Request, e: FetchEvt): Promise<Response> {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') { const copy = res.clone(); e.waitUntil(caches.open(SITE).then((c) => c.put(req, copy))); }
    return res;
  } catch (err) {
    const hit = await cachedIn([SITE], req);
    if (hit) return hit;
    throw err;
  }
}
/** Photos from the share sheet: kept for the page, which opens them after the redirect. */
async function receiveShare(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARED), stamp = Date.now().toString(36);
    let i = 0;
    for (const f of form.getAll(B.shareField)) {
      if (typeof f === 'string') continue;
      await cache.put(abs(`__shared/${stamp}-${i++}`), new Response(f, {
        headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'Shared picture') },
      }));
    }
  } catch { /* nothing usable arrived: the editor opens as usual */ }
  return Response.redirect(START.endsWith('/index.html') ? HERE + '?shared=1' : START + '?shared=1', 303);
}
export {};
