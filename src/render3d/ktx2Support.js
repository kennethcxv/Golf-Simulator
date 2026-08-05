import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// GPU-compressed textures — EVALUATED AND REJECTED.
//
// The measurement stands: KTX2/Basis is the only lever that changes resident VRAM
// per texel rather than download size, and on asset_065 it took the shipped figure
// from 12.0 MB to 3.0 MB. It is off anyway, because it cannot run under this app's
// Content Security Policy.
//
// three.js ships Binomial's Emscripten *embind* build of the Basis transcoder, and
// embind constructs its invoker functions with `new Function` — see
// vendor/addons/libs/basis/basis_transcoder.js, `craftInvokerFunction`. That needs
// full 'unsafe-eval' for the whole document. 'wasm-unsafe-eval' is not sufficient;
// it clears the WebAssembly.instantiate refusal and then the embind violation
// fires. There is no non-embind build published, KTX2Loader has no worker-free
// path, and a per-response CSP header confined to the worker fails in the packaged
// Electron app, which loads from file://.
//
// The trade was declined: sharing plus the resolution ceiling already project the
// twelve-file Tier 1 pass to ~28 MB, so this buys 4x on a number that is not a
// problem, in exchange for re-enabling eval() app-wide.
//
// Full reasoning, measured numbers, and the condition that would reopen this:
// Designs/ProShop/TEXTURE_MEMORY_POLICY.md §3.
//
// This module is kept, dormant, for two reasons. It is the instrument that would
// re-measure the decision if the reopen condition is ever met, and leaving the
// loader detached is what turns "a KTX2 asset shipped by mistake" into a clear
// error at parse time instead of a CSP EvalError from inside a worker.

const REJECTION = 'KTX2 is disabled by decision - see Designs/ProShop/TEXTURE_MEMORY_POLICY.md §3';

let shared = null;
let supportDetected = false;

/** True only when something has deliberately opted back in for a measurement run. */
function enabled() {
  return !!globalThis.__FW_ENABLE_KTX2;
}

/**
 * No-op unless `globalThis.__FW_ENABLE_KTX2` is set before the scene is built.
 *
 * The opt-in exists so the reopen condition in §3 can be re-measured without a
 * code change; it still requires the CSP relaxation to actually transcode, and
 * will throw an EvalError inside the transcoder worker without it.
 */
export function initKTX2(renderer) {
  if (!enabled()) return null;
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
 * The shared loader, or null.
 *
 * Null is the normal answer. GLTFLoader throws a legible "no KTX2 loader" error at
 * parse time when it meets KHR_texture_basisu with nothing attached, which is the
 * failure we want if a compressed asset ever reaches the runtime by mistake.
 */
export function getKTX2Loader() {
  return enabled() && supportDetected ? shared : null;
}

/** State of the format lever, for diagnostics and for the QA harness to assert on. */
export function ktx2Diagnostics() {
  if (!enabled()) {
    return { initialised: false, supportDetected: false, rejected: true, reason: REJECTION };
  }
  if (!shared) return { initialised: false, supportDetected: false, rejected: false };
  const cfg = shared.workerConfig || {};
  return {
    initialised: true,
    supportDetected,
    rejected: false,
    astc: !!cfg.astcSupported,
    bptc: !!cfg.bptcSupported,
    dxt: !!cfg.dxtSupported,
    etc1: !!cfg.etc1Supported,
    etc2: !!cfg.etc2Supported,
    pvrtc: !!cfg.pvrtcSupported,
    // The format both ETC1S and UASTC would transcode to on this machine.
    expectedBytesPerTexel: cfg.astcSupported || cfg.bptcSupported ? 1 : 0.5,
  };
}

export function disposeKTX2() {
  if (shared) shared.dispose();
  shared = null;
  supportDetected = false;
}
