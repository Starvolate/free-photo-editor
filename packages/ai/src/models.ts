// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Bhawesh Tibrewal
/**
 * What the AI add-on downloads, from where, and under which licence (THIRD-PARTY-NOTICES.md quotes each one). Every file
 * is pinned to an exact version or commit and checked by its byte count, and by its SHA-256 where the browser allows it,
 * so what runs is what was reviewed. These files come down once and are kept on the device; the photo is never sent.
 */
export const ORT_VERSION = '1.31.1';
const ORT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export type Backend = 'webgpu' | 'wasm';
/** `bytes` is the file's real size; `transfer` is about what comes over the network (the host may compress it). */
export interface FileDef { url: string; bytes: number; sha256?: string; transfer: number; }
export interface RuntimeDef extends FileDef { backend: Backend; script: string; }
/** ONNX Runtime Web (MIT, Microsoft) runs the models: WebGPU when the device offers it, else WebAssembly. */
export const RUNTIMES: Record<Backend, RuntimeDef> = {
  webgpu: { backend: 'webgpu', script: ORT + 'ort.webgpu.min.mjs', url: ORT + 'ort-wasm-simd-threaded.asyncify.wasm', bytes: 28_747_738, transfer: 4_800_000, sha256: 'ca319e9539cd0f1e291cf56074760121eaf39650f5dbf84b6e52c07f4b2944ec' },
  wasm: { backend: 'wasm', script: ORT + 'ort.wasm.min.mjs', url: ORT + 'ort-wasm-simd-threaded.wasm', bytes: 14_848_852, transfer: 3_200_000, sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d' },
};
export type ModelId = 'subject' | 'inpaint' | 'upscale';
export interface ModelDef extends FileDef { id: ModelId; name: string; does: string; licence: string; authors: string; source: string; converted: string; }
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
};
