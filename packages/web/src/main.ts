// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/** The standalone page. */
import { mount } from './app';

const el = document.getElementById('app');
if (el) (window as unknown as { fpe: unknown }).fpe = mount(el, { standalone: true });
