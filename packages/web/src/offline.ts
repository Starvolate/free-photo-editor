// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * Works offline and installs like an app. Registers the service worker (sw.ts, built by scripts/pwa.ts), shows
 * "A new version is ready · Reload" when one is waiting, offers the browser's install prompt where there is one and
 * plain steps where there is not (iPhone and iPad: Share, then Add to Home Screen), and opens pictures handed to the
 * installed app: "Open with" on a computer (file handlers) and a phone's share sheet (share target).
 */
import { h, icon, iconButton } from './dom';

/** Turns on offline use and installing. The standalone page passes the build's sw.js; an embedding page passes its own. */
export interface AppOptions {
  /** Address of the build's sw.js. */
  serviceWorker: string | URL;
  /** The pages the worker looks after. Default: the folder sw.js sits in (it must end with a slash). */
  scope?: string;
}
export interface ShellHost {
  readonly root: HTMLElement;
  openFiles(files: File[]): Promise<void>;
  toast(msg: string, ms?: number): void;
  openModal(id: string): void;
  /** Called just before the page reloads into a new version: save what is open. */
  beforeReload(): Promise<void>;
}
export type Platform = 'ios' | 'android' | 'mac-safari' | 'firefox' | 'desktop';
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }>; }
interface LaunchParams { files?: readonly { getFile?: () => Promise<File> }[]; }

/** Which install steps apply. iPadOS reports itself as a Mac, so a Mac with a touch screen counts as an iPad. */
export function platformOf(ua: string, platform: string, touchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'mac-safari';
  return 'desktop';
}
/** True inside the installed app's own window. */
export function isInstalled(): boolean {
  const mm = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  return mm('(display-mode: standalone)') || mm('(display-mode: window-controls-overlay)') || mm('(display-mode: fullscreen)')
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
/** The plain steps, by device: the person's own device first, the others folded below. */
export const STEPS: Record<Platform, { title: string; steps: [string | null, string][] }> = {
  ios: { title: 'On iPhone and iPad', steps: [
    ['share', 'Tap Share in Safari (the square with an arrow pointing up). In Chrome or Edge it sits in the address bar.'],
    ['add-square', 'Scroll down and tap Add to Home Screen.'],
    ['check', 'Tap Add. The editor now opens from your Home Screen, full screen, even without the internet.']] },
  android: { title: 'On Android', steps: [
    ['menu', 'Open the browser menu (the three dots).'],
    ['add-square', 'Tap Install app, or Add to Home screen.'],
    ['check', 'Tap Install. The editor opens from your home screen and your app list.']] },
  'mac-safari': { title: 'In Safari on a Mac', steps: [
    ['menu', 'In the menu bar, choose File, then Add to Dock.'],
    ['check', 'Click Add. The editor opens from the Dock in its own window.']] },
  firefox: { title: 'In Firefox on a computer', steps: [
    [null, 'Firefox cannot install web apps on computers. The editor still works offline in this tab after your first visit.'],
    [null, 'To install it, open this page in Chrome, Edge or Safari.']] },
  desktop: { title: 'In Chrome or Edge on a computer', steps: [
    ['install', 'Click the install button at the right end of the address bar.'],
    [null, 'No button? Open the browser menu and choose Install Free Photo Editor (in Chrome: Cast, save and share, then Install page as app).'],
    ['check', 'Click Install. The editor opens in its own window and from your apps.']] },
};

export class AppShell {
  readonly platform: Platform;
  /** off: no offline support asked for; starting: saving the app; ready: works offline; failed: the browser refused. */
  status: 'off' | 'starting' | 'ready' | 'failed' = 'off';
  updateReady = false;
  private prompt: InstallPrompt | null = null;
  private reg: ServiceWorkerRegistration | null = null;
  private note: HTMLElement | null = null;
  private reloading = false;
  private off: (() => void)[] = [];
  private timer = 0;

  constructor(private host: ShellHost, private opts: AppOptions | undefined) {
    this.platform = typeof navigator === 'undefined' ? 'desktop'
      : platformOf(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);
    if (!opts) return;
    this.on(window, 'beforeinstallprompt', (e) => { e.preventDefault(); this.prompt = e as InstallPrompt; });
    this.on(window, 'appinstalled', () => { this.prompt = null; host.toast('Installed. Free Photo Editor now opens like an app on this device.', 5000); });
    // An old page asking for a file a new version removed: look for the new version, which shows the Reload note.
    this.on(window, 'vite:preloadError', () => { void this.reg?.update().catch(() => undefined); });
    this.takeLaunches();
    void this.register();
  }
  private on(t: EventTarget, type: string, f: (e: Event) => void): void { t.addEventListener(type, f); this.off.push(() => t.removeEventListener(type, f)); }
  get enabled(): boolean { return !!this.opts; }
  /** The browser can show its own install prompt right now. */
  get canPrompt(): boolean { return !!this.prompt; }
  installed(): boolean { return isInstalled(); }

  private async register(): Promise<void> {
    const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!sw || !this.opts) { this.status = 'failed'; return; }
    this.status = 'starting';
    try {
      const url = new URL(String(this.opts.serviceWorker), location.href);
      const reg = await sw.register(url.href, { scope: this.opts.scope ?? new URL('./', url).href, updateViaCache: 'none' });
      this.reg = reg;
      const watch = (w: ServiceWorker | null): void => {
        if (!w) return;
        const check = (): void => { if (w.state === 'installed' && sw.controller) this.showUpdate(); };
        w.addEventListener('statechange', check);
        check();
      };
      if (reg.waiting && sw.controller) this.showUpdate();
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      const hadController = !!sw.controller;
      this.on(sw, 'controllerchange', () => {
        if (this.reloading) { location.reload(); return; }
        this.status = 'ready';
        this.keepLoaded();
      });
      await sw.ready;
      if (hadController) { this.status = 'ready'; this.keepLoaded(); }
      void this.takeShared();
      this.timer = window.setInterval(() => { void reg.update().catch(() => undefined); }, 60 * 60 * 1000);
      this.on(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => undefined); });
    } catch {
      this.status = 'failed';
    }
  }
  /** Files this page loaded before the worker was in charge (on the very first visit) are saved too. */
  private keepLoaded(): void {
    const c = navigator.serviceWorker?.controller;
    if (!c || typeof performance === 'undefined') return;
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin));
    c.postMessage({ type: 'keep', urls });
  }
  private showUpdate(): void {
    this.updateReady = true;
    if (this.note) return;
    this.note = h('div', { class: 'fpe-update', role: 'status', 'data-testid': 'update-note' },
      icon('refresh'), h('span', { class: 'fpe-update-text' }, 'A new version is ready'), h('span', { class: 'fpe-update-dot', 'aria-hidden': 'true' }, '·'),
      h('button', { type: 'button', class: 'fpe-btn fpe-update-reload', 'data-testid': 'update-reload', onclick: () => void this.applyUpdate() }, 'Reload'),
      iconButton('close', 'Not now: the new version starts next time', { class: 'fpe-btn fpe-icon-btn fpe-update-close', 'data-testid': 'update-later',
        onclick: () => { this.note?.remove(); this.note = null; } }));
    this.host.root.append(this.note);
  }
  /** Reload: save what is open, let the waiting version take over, then reload into it. */
  async applyUpdate(): Promise<void> {
    await this.host.beforeReload().catch(() => undefined);
    const w = this.reg?.waiting;
    this.reloading = true;
    if (!w) { location.reload(); return; }
    w.postMessage({ type: 'skip-waiting' });
    window.setTimeout(() => location.reload(), 4000);
  }
  /** File > Install as an app: the browser's own prompt where there is one, otherwise the plain steps. */
  install(): void {
    const p = this.prompt;
    if (p && this.platform !== 'ios') {
      this.prompt = null;
      this.host.toast('Your browser is asking whether to install Free Photo Editor.', 5000);
      void p.prompt().then(() => p.userChoice).then((c) => {
        if (c.outcome !== 'accepted') this.host.toast('Not installed. You can install it any time from File, Install as an app.');
      }, () => this.host.openModal('install'));
      return;
    }
    this.host.openModal('install');
  }
  /** The body of the install sheet. */
  installSheet(): HTMLElement {
    const list = (p: Platform): HTMLElement => h('ol', { class: 'fpe-steps', 'data-platform': p },
      ...STEPS[p].steps.map(([ic, text]) => h('li', {}, ic ? icon(ic, 'fpe-icon fpe-step-icon') : h('span', { class: 'fpe-step-icon', 'aria-hidden': 'true' }), h('span', {}, text))));
    const others = (Object.keys(STEPS) as Platform[]).filter((p) => p !== this.platform);
    return h('div', { class: 'fpe-stack fpe-install', 'data-testid': 'install-steps' },
      h('p', {}, 'Put Free Photo Editor on your device. It opens in its own window, works without the internet, and your pictures never leave your device.'),
      h('h3', {}, STEPS[this.platform].title), list(this.platform),
      h('details', {}, h('summary', {}, 'On another device'), ...others.flatMap((p) => [h('h4', {}, STEPS[p].title), list(p)])));
  }
  /** Pictures opened with the installed app ("Open with" on a computer, or dropped on its icon). */
  private takeLaunches(): void {
    const lq = (window as Window & { launchQueue?: { setConsumer(f: (p: LaunchParams) => void): void } }).launchQueue;
    lq?.setConsumer((p) => {
      void (async () => {
        const files: File[] = [];
        for (const f of p.files ?? []) { try { const x = await f.getFile?.(); if (x) files.push(x); } catch { /* not a file */ } }
        if (files.length) await this.host.openFiles(files);
      })();
    });
  }
  /** Photos sent from a phone's share sheet: the worker kept them; open them and clear them. */
  private async takeShared(): Promise<void> {
    const u = new URL(location.href);
    if (!u.searchParams.has('shared') || !this.reg) return;
    u.searchParams.delete('shared');
    history.replaceState(history.state, '', u.href);
    try {
      const cache = await caches.open('fpe:' + this.reg.scope + ':shared');
      const files: File[] = [];
      for (const req of await cache.keys()) {
        const r = await cache.match(req);
        if (r) files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') ?? 'Shared picture'), { type: r.headers.get('content-type') ?? '' }));
        await cache.delete(req);
      }
      if (files.length) await this.host.openFiles(files);
      else this.host.toast('Nothing to open: the shared item was not a picture.');
    } catch {
      this.host.toast("The shared picture couldn't be opened.");
    }
  }
  /** Plain status for About and for tests. */
  info(): Record<string, unknown> {
    return { status: this.status, updateReady: this.updateReady, canPrompt: this.canPrompt, installed: this.installed(), platform: this.platform,
      scope: this.reg?.scope ?? null, controlled: typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller };
  }
  dispose(): void {
    clearInterval(this.timer);
    for (const f of this.off) f();
    this.off = [];
    this.note?.remove();
  }
}
