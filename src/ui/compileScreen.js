// FIRST-RUN COMPILE SCREEN — worded the way shipped games word it.
//
// The whole first load of this game is shader compilation (the prewarm draws
// every program the session will use), and on a fresh profile that is tens of
// seconds with a generic loading veil giving no reason. Shipped games name it:
// a title, one line of why, and a count that is the real work moving.
//
// THE GATE IS A STAMP, NOT A TIMER. Chromium's shader cache lives in the
// browser profile, so "first boot on this profile" is exactly "the compiles
// are real work" — the same lifetime, the same directory. The stamp stores the
// driver identity too, because a driver update invalidates every cached
// binary: same screen, different second line, and saying "only happens once"
// again would make the game a liar.
//
// The stamp is written ONLY after the warm completes, so a boot that dies
// mid-compile shows the screen again next time — which is true.
//
// (The two lines below end in periods where the spec sketch used em dashes:
// ITEM 28 bans the em dash from every string a player reads, suite-enforced
// by tests/no-em-dash-in-player-copy.test.js.)

export const COMPILE_TITLE = 'Compiling shaders';
export const COMPILE_LINES = {
  'first-run': 'First-time setup. This only happens once.',
  'driver-update': 'Your graphics driver was updated. Rebuilding for the new version.',
};

export const COMPILE_STAMP_KEY = 'golfEmpire.shaderCompileStamp.v1';

// Measured on this build: the live program count at the moment the stamp is
// written, first boot, fresh profile, pine-hills-v2 (the QA driver asserts the
// stamp lands between the last painted count and the final live count, so
// drift in this constant shows up as a count that finishes early or late, not
// as a silent lie). The display clamps: if the live count overtakes this, the
// denominator follows the truth upward.
export const COMPILE_EXPECTED_PROGRAMS = 171;

// The GL half of the identity: vendor, unmasked renderer, GL version. On this
// Electron build ANGLE's string carries NO driver version digits (measured:
// "... Direct3D11 vs_5_0 ps_5_0, D3D11)"), so GL strings alone cannot see a
// driver update. The version rides in separately, below.
export function driverKeyOf(renderer) {
  try {
    const gl = renderer?.getContext?.();
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const key = [
      dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      gl.getParameter(gl.VERSION),
    ].filter(Boolean).join(' | ');
    return key || null;
  } catch {
    return null;
  }
}

// The OS driver version, reported by the GPU process over the native bridge
// (fw:gpu-driver-versions) and primed at boot. It arrives asynchronously, so
// the gate's rule is asymmetric on purpose: UNKNOWN IS NOT CHANGED. A boot
// that decides before the version resolves compares GL strings only and stays
// silent; only two KNOWN, DIFFERENT versions may claim a driver update —
// the false "your driver was updated" is the lie this avoids.
let knownDriverVersions = null;
export function primeDriverVersions(value) {
  knownDriverVersions = (typeof value === 'string' && value) ? value : null;
}

export function readCompileStamp(storage) {
  try {
    const raw = storage?.getItem?.(COMPILE_STAMP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.driver !== 'string' || !parsed.driver) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCompileStamp(storage, driverKey, programs, driverVersions = null) {
  try {
    storage?.setItem?.(COMPILE_STAMP_KEY, JSON.stringify({
      v: 1, driver: driverKey, drv: driverVersions || null, programs, at: new Date().toISOString(),
    }));
  } catch {
    // Storage unavailable: the screen shows again next boot, which is honest —
    // nothing recorded the work as done.
  }
}

// The decision, pure. No driver key means no way to attribute the work, so no
// claim is made either way and the stamp is left alone. The version clause is
// deliberately one-sided: it takes two KNOWN versions to call an update.
export function decideCompileScreen(stamp, driverKey, driverVersions = null) {
  if (!driverKey) return { show: false, mode: null };
  if (!stamp) return { show: true, mode: 'first-run' };
  if (stamp.driver !== driverKey) return { show: true, mode: 'driver-update' };
  if (typeof stamp.drv === 'string' && stamp.drv && driverVersions && stamp.drv !== driverVersions) {
    return { show: true, mode: 'driver-update' };
  }
  return { show: false, mode: null };
}

// Wire the screen to a load. The count is renderer.info.programs.length read
// live — the number the census and every acceptance in this repo trusts — and
// it is painted from BOTH a rAF loop and a coarse interval: on a machine where
// frames are seconds apart the interval keeps the DOM text current, so
// whenever the compositor does get a frame it paints the freshest number
// rather than one from the last vsync.
export function startCompileScreen({ renderer, veil, storage }) {
  const store = storage || globalThis.localStorage;
  const driverKey = driverKeyOf(renderer);
  const decision = decideCompileScreen(readCompileStamp(store), driverKey, knownDriverVersions);
  const live = () => renderer?.info?.programs?.length ?? 0;
  let finished = false;
  let raf = 0;
  let timer = 0;
  const paint = () => {
    if (finished) return;
    const n = live();
    const total = Math.max(COMPILE_EXPECTED_PROGRAMS, n);
    veil.compileCount(Math.min(n, total), total);
  };
  if (decision.show) {
    veil.compileBegin(decision.mode, COMPILE_TITLE, COMPILE_LINES[decision.mode]);
    const pump = () => {
      if (finished) return;
      paint();
      raf = requestAnimationFrame(pump);
    };
    pump();
    timer = setInterval(paint, 100);
  }
  return {
    active: decision.show,
    mode: decision.mode,
    finish(ok) {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      if (!decision.show) return;
      if (ok && driverKey) {
        // The estimate served its purpose; the truth at completion is the live
        // count, so the last painted state reads n / n.
        const n = live();
        veil.compileCount(n, n);
        writeCompileStamp(store, driverKey, n, knownDriverVersions);
      }
      veil.compileEnd();
    },
  };
}
