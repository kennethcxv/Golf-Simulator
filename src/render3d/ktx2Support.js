import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// GPU-compressed textures for the pro-shop asset pass.
//
// A 1024² RGBA8 map with its mip chain occupies 5.59 MB of VRAM whatever the PNG
// or JPEG on disk weighs — the file format only decides download size, because
// the GPU is handed decoded pixels either way. KTX2/Basis is the one lever that
// changes the resident figure: the texture stays compressed all the way onto the
// GPU, so the same map costs 1.40 MB.
//
// Which block format the transcoder targets is decided by the hardware, not by
// us. KTX2Loader's priority list is ASTC, then BPTC, then S3TC, so on any desktop
// with BPTC — which is every GPU this game targets — both ETC1S and UASTC land on
// BC7 at 1 byte per texel. That is 4x off RGBA8, not the 8x that a BC1 assumption
// would predict. See KTX2Loader.js FORMAT_OPTIONS.
//
// The loader is shared process-wide: it owns a worker pool and a WASM transcoder
// instance, and standing up a second one would duplicate both.

let shared = null;
let supportDetected = false;

/**
 * Create the shared KTX2 loader and let it query the renderer for which
 * compressed formats this GPU actually supports.
 *
 * Must run before any GLB carrying KHR_texture_basisu is loaded — GLTFLoader
 * throws rather than falling back if the KTX2 loader is missing at parse time.
 */
export function initKTX2(renderer) {
  if (!shared) {
    shared = new KTX2Loader();
    // Relative to the document, matching how every other vendored asset is fetched.
    shared.setTranscoderPath('vendor/addons/libs/basis/');
  }
  if (!supportDetected && renderer) {
    shared.detectSupport(renderer);
    supportDetected = true;
  }
  return shared;
}

/**
 * The shared loader, or null if support has not been detected yet.
 *
 * Returning null before detection is deliberate: attaching an undetected loader
 * to a GLTFLoader would let a KTX2 GLB reach the transcoder with no target format
 * and fail deep inside a worker, where the cause is far from obvious.
 */
export function getKTX2Loader() {
  return supportDetected ? shared : null;
}

/** What the GPU offered, for diagnostics and for the QA harness to assert on. */
export function ktx2Diagnostics() {
  if (!shared) return { initialised: false, supportDetected: false };
  const cfg = shared.workerConfig || {};
  return {
    initialised: true,
    supportDetected,
    astc: !!cfg.astcSupported,
    bptc: !!cfg.bptcSupported,
    dxt: !!cfg.dxtSupported,
    etc1: !!cfg.etc1Supported,
    etc2: !!cfg.etc2Supported,
    pvrtc: !!cfg.pvrtcSupported,
    // The format both ETC1S and UASTC will transcode to on this machine.
    expectedBytesPerTexel: cfg.astcSupported || cfg.bptcSupported ? 1 : 0.5,
  };
}

export function disposeKTX2() {
  if (shared) shared.dispose();
  shared = null;
  supportDetected = false;
}
