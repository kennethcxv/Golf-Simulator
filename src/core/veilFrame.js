// THE BOOT YIELDED THROUGH A QUEUE THE COMPOSITOR IS ALLOWED TO STARVE.
//
// prewarm() advances by awaiting requestAnimationFrame between phases: draw a
// little, hand the frame back, draw a little more. That is the right shape --
// it is what keeps the veil painting and the window answering -- but it makes
// the WALL TIME of the boot a function of how often Chromium feels like
// producing a frame, which is not the same thing as how much work the boot has
// to do.
//
// Measured on this machine with tools/qa/boot-frame-clock.js, on one stamped
// boot, three queues recorded concurrently:
//
//   queue        n      median        max    time lost to gaps > 250 ms
//   rAF         47      1003.7     2008.2      37,091 ms  (35 gaps)
//   setTimeout  7120       4.0     1897.5       6,917 ms  (10 gaps)
//   MessageChannel 200000   0.0      137.5           0 ms  ( 0 gaps)
//
// rAF at 1 Hz while the timer queue runs at 4 ms is not a busy main thread --
// a blocked main thread starves every queue equally, and that is exactly what
// this same probe found on 2026-08-19, when the ratio was 1.01 and the answer
// was a genuine 21-second block. Both conditions are real and the probe tells
// them apart. This one is the compositor: an occluded window, or a display
// that has gone to sleep, drops BeginFrame to about 1 Hz, and every yield in
// prewarm then costs a second to do nothing.
//
// So: race the frame against a short timer. When the compositor is healthy the
// frame arrives in ~4 ms on this panel and wins every time -- behaviour is
// bit-for-bit what it was, real frames, veil painting, no change. When the
// compositor is throttled the timer wins at `timeoutMs` instead of 1,000 ms,
// and the boot goes back to costing what the work costs.
//
// This does NOT skip work: a warm draw executes its GL commands when
// renderer.render() is called, not when a frame is presented. The yield exists
// to let the page breathe between draws, and the timer lets it breathe.
// WHY IT WAITS BEFORE IT STOPS WAITING.
//
// The first cut raced every yield against a 16 ms timer. That fixed the boot
// and quietly broke something else: with the timer winning most yields, the
// warm draws stopped landing on real frames, and two program variants the warm
// used to reach were left for the player to pay. Measured on the door driver,
// first belt press indoors: 213.4 ms and 5 programs on the old build, 565.1 ms
// and 7 on that one. A shorter veil bought with a longer press is the exact
// trade this project has already refused once.
//
// So the race is armed, not permanent. Every yield asks for a frame and waits
// up to PROBE_MS for it, and only after PATIENCE CONSECUTIVE misses is the
// compositor treated as absent; the remaining yields then fall through at
// FAST_MS, and a single real frame clears the verdict again.
//
// PROBE_MS IS 900, NOT 16, AND THAT NUMBER IS LOAD-BEARING. A second cut used
// 250 ms and still cost the belt press its programs, because during prewarm a
// frame legitimately takes a long time -- these are the heaviest draws the
// game ever does, and prewarm-slow-draw-ms alone is over five seconds. A short
// probe therefore reads the boot's OWN WORK as a throttle and stops waiting
// for frames it was about to get. The throttled case is a metronomic ~1,000 ms
// (measured 1003.7 median), so 900 ms sits below that and above any real warm
// frame, and three in a row is a distinction the boot's own work cannot
// manufacture. Worst case on a throttled machine is 2.7 s of patience before
// it commits -- against the ~24 s it replaces.
//
// Cost of being wrong in each direction: if it decides "throttled" on a
// healthy machine it needs two consecutive quarter-second frame gaps to do it,
// which is not a machine anyone is playing on; if it decides "healthy" on a
// throttled one the boot pays PROBE_MS twice and then corrects itself.
const PROBE_MS = 900;
const FAST_MS = 16;
const PATIENCE = 3;

export function createVeilTick({
  raf = (cb) => globalThis.requestAnimationFrame(cb),
  cancelRaf = (id) => globalThis.cancelAnimationFrame?.(id),
  setTimer = (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
  probeMs = PROBE_MS,
  fastMs = FAST_MS,
  patience = PATIENCE,
} = {}) {
  let consecutiveTimeouts = 0;
  return function tick() {
    const throttled = consecutiveTimeouts >= patience;
    return new Promise((resolve) => {
      let done = false;
      let frameId = null;
      let timerId = null;
      const settle = (via) => {
        if (done) return;
        done = true;
        // Release the loser, so a starved rAF does not accumulate one live
        // callback per yield across a whole boot.
        if (via !== 'frame' && frameId != null) cancelRaf(frameId);
        if (via !== 'timer' && timerId != null) clearTimer(timerId);
        if (via === 'frame') consecutiveTimeouts = 0;
        else consecutiveTimeouts += 1;
        resolve(via);
      };
      frameId = raf(() => settle('frame'));
      timerId = setTimer(() => settle('timer'), throttled ? fastMs : probeMs);
    });
  };
}

export const VEIL_TICK_PROBE_MS = PROBE_MS;
export const VEIL_TICK_FAST_MS = FAST_MS;
