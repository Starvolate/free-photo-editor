// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * What the AI add-on downloads, from where, and under which licence (THIRD-PARTY-NOTICES.md quotes each one). Every file
 * is pinned to an exact version or commit and checked by its byte count, and by its SHA-256 where the browser allows it,
 * so what runs is what was reviewed. These files come down once and are kept on the device, so the AI tools work without
 * the internet from then on; the photo is never sent.
 */
import type { SegLayout } from './segment';

export const ORT_VERSION = '1.31.1';
/** `bytes` is the file's real size; `transfer` is what comes over the network (the host may compress it). */
export interface FileDef { url: string; bytes: number; sha256?: string; transfer: number; }
/**
 * The engine: ONNX Runtime Web's WebAssembly file (MIT, Microsoft). Its loader is part of this build, bundled into the AI
 * worker; this 14.8 MB file is not. It downloads once from jsDelivr, which sends it brotli-compressed: 3,195,270 bytes
 * (checked 13 Nov 2026). A unit test checks that it is the same file as node_modules/onnxruntime-web, so a version bump
 * fails loudly. Using the graphics chip (WebGPU) is Planned: untested, and it needs its own 28.7 MB file.
 */
export const ENGINE: FileDef = {
  url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`, bytes: 14_848_852, transfer: 3_195_270,
  sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d',
};
export type ModelId = 'subject' | 'inpaint' | 'upscale' | 'segment';
/**
 * `decoder`: a second file the model needs, kept and checked the same way (tap to select reads the picture once with the
 * main file, then answers each tap with this small one). `layout`: how tap to select talks to it (segment.ts).
 */
export interface ModelDef extends FileDef { id: ModelId; name: string; does: string; licence: string; authors: string; source: string; converted: string; decoder?: FileDef; layout?: SegLayout; }
const HF = (repo: string, commit: string, file: string): string => `https://huggingface.co/${repo}/resolve/${commit}/${file}`;
export const MODELS: Record<ModelId, ModelDef> = {
  subject: {
    id: 'subject', name: 'U²-Net small (u2netp)', does: 'finds the main subject', licence: 'Apache-2.0', authors: 'Xuebin Qin and co-authors',
    source: 'https://github.com/xuebinqin/U-2-Net', converted: 'ONNX copy on Hugging Face: BritishWerewolf/U-2-Netp',
    url: HF('BritishWerewolf/U-2-Netp', '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8', 'onnx/model.onnx'), bytes: 4_574_861, transfer: 4_574_861,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  },
  inpaint: {
    id: 'inpaint', name: 'MI-GAN (512, Places2), ONNX pipeline v2', does: 'fills in what you remove', licence: 'MIT', authors: 'Picsart AI Research (PAIR)',
    source: 'https://github.com/Picsart-AI-Research/MI-GAN', converted: 'ONNX file published by an author on Hugging Face: andraniksargsyan/migan',
    url: HF('andraniksargsyan/migan', '406830d0fa60666da0071c342ad2fbc8f30c5c64', 'migan_pipeline_v2.onnx'), bytes: 28_079_181, transfer: 28_079_181,
    sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
  },
  upscale: {
    id: 'upscale', name: 'Real-ESRGAN general x4v3', does: 'makes pictures bigger', licence: 'BSD-3-Clause', authors: 'Xintao Wang and co-authors',
    source: 'https://github.com/xinntao/Real-ESRGAN', converted: 'ONNX copy on Hugging Face: CoderViking/realesr-general-x4v3-onnx',
    url: HF('CoderViking/realesr-general-x4v3-onnx', 'c6a971706797c7502945a2b4c4274fce4900d4ab', 'realesr-general-x4v3.onnx'), bytes: 4_866_417, transfer: 4_866_417,
    sha256: '1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112',
  },
  segment: {
    id: 'segment', name: 'MobileSAM', does: 'selects the thing you tap', licence: 'Apache-2.0', authors: 'Chaoning Zhang and co-authors (MobileSAM), from Meta AI\'s Segment Anything',
    source: 'https://github.com/ChaoningZhang/MobileSAM', converted: 'ONNX copy on Hugging Face: Acly/MobileSAM', layout: 'sam-onnx',
    url: HF('Acly/MobileSAM', '0d3b403339b4674a82493d5e97964dd78089ddc8', 'mobile_sam_image_encoder.onnx'), bytes: 28_157_093, transfer: 28_157_093,
    sha256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749',
    decoder: {
      url: HF('Acly/MobileSAM', '0d3b403339b4674a82493d5e97964dd78089ddc8', 'sam_mask_decoder_multi.onnx'), bytes: 16_496_559, transfer: 16_496_559,
      sha256: '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe',
    },
  },
};
