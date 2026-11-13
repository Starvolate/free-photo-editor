// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * ZIP files for commands that save many files at once (File › Save each layer as a file): one download instead of a
 * browser prompt per file. fflate (MIT) already writes the OpenRaster files; this entry only shares it.
 */
export { unzipSync, zipSync, type Zippable } from 'fflate';
