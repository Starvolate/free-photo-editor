# Third-party notices

Free Photo Editor is free software under the GNU Affero General Public License 3.0 (`LICENSE`, with the terms in
`ADDITIONAL-TERMS.md`). The file-format add-ons in `packages/formats` use the libraries below. Each one is loaded only
when its format is first opened or saved. None is changed, and each keeps its own licence and copyright notice inside
its npm package.

The AGPL-3.0 lets a program be combined with code under any GPLv3-compatible licence. MIT, ISC, BSD and Apache-2.0 are
GPLv3-compatible. The LGPL (2.1 or 3.0) allows use from a program under any licence when the library stays a separate,
replaceable part. Here each LGPL library is its own npm package and its own downloaded file, never merged into our code,
so anyone can swap in their own build.

| Library (npm) | Version | Licence | What it does here | Why it is compatible |
|---|---|---|---|---|
| fflate | 0.8.3 | MIT | Zip (OpenRaster, Krita) and Deflate (PNG, TIFF, PDF) | MIT is GPLv3-compatible |
| gifenc | 1.0.3 | MIT | Reduces colours for GIF frames and writes GIF | MIT is GPLv3-compatible |
| @jsquash/avif | 2.1.1 | Apache-2.0 | AVIF save, and AVIF open when the browser can't. Built from libavif (BSD-2-Clause) and libaom (BSD-2-Clause, with the royalty-free AOM patent licence 1.0) | Apache-2.0 and BSD are GPLv3-compatible |
| @jsquash/jxl | 1.3.0 | Apache-2.0 | JPEG XL open and save. Built from libjxl (BSD-3-Clause) | Apache-2.0 and BSD are GPLv3-compatible |
| libheif-js | 1.23.5 | LGPL-3.0 | HEIC/HEIF open when the browser can't. Built from libheif and libde265 (both LGPL-3.0). It only decodes: it carries no x265 encoder, which is GPL-only (checked: the bundle has no x265 code) | LGPL-3.0, used as a separate, replaceable package |
| pdfjs-dist | 6.5.438 | Apache-2.0 | Draws a PDF page so it opens as a picture | Apache-2.0 is GPLv3-compatible |
| libraw-wasm | 1.6.0 | ISC (the wrapper) | Camera RAW open (DNG and most camera raw files). Inside is LibRaw, licensed LGPL-2.1 or CDDL-1.0; we use it under the LGPL-2.1. LibRaw 0.20 and later have no GPL demosaic packs | ISC is GPLv3-compatible; LGPL-2.1, used as a separate, replaceable package |
| ag-psd | 34.2.0 | MIT | PSD open and save (already in the editor); also opens PSB, the large PSD | MIT is GPLv3-compatible |

We wrote these ourselves, with no outside code: TIFF (LZW, Deflate, PackBits, pages as layers), TGA, BMP and ICO saving,
PNG reading and writing, moving PNG (APNG), GIF reading, moving WebP joining, OpenRaster, SVG and PDF saving, and the RAW
develop step.

Every file the editor saves carries "Free Photo Editor by Bhawesh Tibrewal" in the format's metadata where the format
has room for it (`ADDITIONAL-TERMS.md` 7(b)). BMP has no place for text. AVIF's encoder has no metadata setting, so the
editor adds the credit to the finished file as an XMP item.

## On-device AI (`packages/ai`)

The AI commands load only when one is first used: Select an object, Select the main subject, Remove the background,
Remove an object, Fill from the surroundings and Make it bigger. They run on the person's own device with ONNX Runtime Web on
WebAssembly, in a Web Worker. Before the first download the editor says how much comes down. The engine file and each
model then download once from the public hosts below, are checked by their exact size and SHA-256
(`packages/ai/src/models.ts` pins every file to a version or a commit), and are kept in the browser (IndexedDB), so the
AI tools work without the internet from then on. The photo is never uploaded. Every licence below allows free and
commercial use and is GPLv3-compatible, so the AGPL-3.0 editor may use these parts. Models under non-commercial terms
(for example BRIA's RMBG-1.4 and RMBG-2.0) are not used.

| Part | How it reaches the browser | Licence, quoted from its source | What it does here |
|---|---|---|---|
| ONNX Runtime Web 1.31.1, the loader: npm `onnxruntime-web@1.31.1`, `dist/ort.wasm.bundle.min.mjs` (onnxruntime-common and the Emscripten-built start-up code are inside it; no other package) | Part of this build: bundled, unchanged, into the AI worker's file in `dist/assets/`. Its own header reads "ONNX Runtime Web v1.31.1 / Copyright (c) Microsoft Corporation. All rights reserved. / Licensed under the MIT License." | "MIT License / Copyright (c) Microsoft Corporation" (github.com/microsoft/onnxruntime at tag v1.31.1, `LICENSE`) | Loads the engine and runs the models |
| ONNX Runtime Web 1.31.1, the engine: `ort-wasm-simd-threaded.wasm` (14,848,852 bytes) | Downloaded once from cdn.jsdelivr.net (npm `onnxruntime-web@1.31.1`), which sends it brotli-compressed: 3,195,270 bytes | The same MIT licence | The compiled engine the models run on |
| MI-GAN, ONNX pipeline v2 | Downloaded once from huggingface.co/andraniksargsyan/migan at commit 406830d0fa60, `migan_pipeline_v2.onnx` (28,079,181 bytes) | "MIT License / Copyright (c) 2024 Picsart AI Research (PAIR)" (github.com/Picsart-AI-Research/MI-GAN, `LICENSE`) | Fills in what you remove: the Remove tool, Fill from the surroundings |
| Real-ESRGAN general x4v3 | Downloaded once from huggingface.co/CoderViking/realesr-general-x4v3-onnx at commit c6a971706797, `realesr-general-x4v3.onnx` (4,866,417 bytes) | "BSD 3-Clause License / Copyright (c) 2021, Xintao Wang" (github.com/xinntao/Real-ESRGAN, `LICENSE`) | Makes pictures twice or four times as big |
| U²-Net small (u2netp) | Downloaded once, on the first use of Select the main subject or Remove the background, from huggingface.co/BritishWerewolf/U-2-Netp at commit 7112208dbac3, `onnx/model.onnx` (4,574,861 bytes) | "Apache License, Version 2.0, January 2004" (github.com/xuebinqin/U-2-Net, `LICENSE`) | Finds the main subject |
| MobileSAM: the image encoder and the mask decoder | Downloaded once, on the first use of Select an object, Select the main subject or Remove the background, from huggingface.co/Acly/MobileSAM at commit 0d3b403339b4: `mobile_sam_image_encoder.onnx` (28,157,093 bytes) and `sam_mask_decoder_multi.onnx` (16,496,559 bytes) | "Apache License, Version 2.0, January 2004" (github.com/ChaoningZhang/MobileSAM, `LICENSE`); MobileSAM is built on Meta AI's Segment Anything, under the same licence (github.com/facebookresearch/segment-anything, `LICENSE`) | Selects the thing you tap or box, and finds all of the main subject |

ONNX Runtime's loader and engine are built from ONNX Runtime and the open-source parts it lists in its own notices file,
`ThirdPartyNotices.txt` at tag v1.31.1 (github.com/microsoft/onnxruntime/blob/v1.31.1/ThirdPartyNotices.txt). Using the
graphics chip (WebGPU) is Planned and not shipped, so its 28.7 MB engine file is never downloaded. The U²-Net, MobileSAM
and Real-ESRGAN files are ONNX conversions of the authors' published weights, made and hosted by the Hugging Face accounts
named; the MI-GAN file is published by one of its authors. The licence that applies to each is the authors' licence
quoted above. Apache-2.0, MIT and BSD-3-Clause are all GPLv3-compatible.
