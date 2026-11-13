// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The standalone page. */
import { mount } from './app';

const el = document.getElementById('app');
// The build's sw.js sits beside index.html and this script is in assets/, so it is one folder up, in whatever folder
// the site serves the editor from. Development builds run without it.
const SW = '../sw.js';
if (el) (window as unknown as { fpe: unknown }).fpe = mount(el, { standalone: true, app: import.meta.env.PROD ? { serviceWorker: new URL(SW, import.meta.url) } : undefined });
