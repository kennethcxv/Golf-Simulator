// A1 (Goal 23) — THE FRAME CAP COUNTS VSYNCS, NOT MILLISECONDS.
//
// Measured on the owner's machine, standing inside the shop, panel 181.8 Hz:
//
//   cap   achieved   on cadence   1% low
//   60      60.6       94.4%      22.0 ms
//   120     97.1        0.2%      12.0 ms
//   144    181.8       (ignored)  11.6 ms
//   0      181.8       99.2%       6.5 ms
//
// A cap of 120 on a 181.8 Hz panel achieved 97 fps and put TWO INTERVALS IN A
// THOUSAND on the cadence it was asking for. That is not a frame rate problem,
// it is a frame TIME problem, and average fps cannot see it: to average 120 on
// a display that can only present every 5.5 ms, the loop has to alternate one
// vsync and two, which is a 5.5/11 ms sawtooth. It reads as stutter at any
// average you like, and "it never feels smooth" is exactly what a sawtooth
// feels like.
//
// The old gate compared wall time against a target interval with a 1.2 ms
// tolerance. On a panel whose refresh does not divide the target, no tolerance
// can help: the frames are only ALLOWED to arrive on vsync boundaries, so the
// only reachable rates are refresh/1, refresh/2, refresh/3...
//
// So the cap picks the nearest reachable rate and holds it exactly. It counts
// presented frames: render every Nth tick, N = round(panelInterval ratio).
// A player asking for 120 on a 181.8 Hz panel gets 90.9 fps that is PERFECTLY
// even, which is better than 97 fps of sawtooth in the only way that matters.
//
// The panel interval is measured rather than assumed — a laptop moved between
// a 60 Hz internal panel and a 165 Hz external one changes it mid-session, and
// no constant survives that.

const HISTORY = 31; // odd, so the median is a real sample

export function createFrameCap() {
  let cap = 0;
  const gaps = [];
  let lastTick = 0;
  let ticksSinceRender = 0;
  let everyN = 1;
  let panelMs = 0;

  // Median of the recent rAF gaps. Median rather than mean because one long
  // gap — a GC pause, a window drag — must not redefine the panel.
  function panelInterval() {
    if (gaps.length < 8) return 0;
    const v = gaps.slice().sort((a, b) => a - b);
    return v[v.length >> 1];
  }

  function recompute() {
    panelMs = panelInterval();
    if (cap <= 0 || panelMs <= 0) { everyN = 1; return; }
    const want = 1000 / cap;
    // Round rather than ceil: asking for 144 on a 181.8 Hz panel is nearer to
    // "every vsync" than to "every other one", and handing back 90.9 would be
    // a bigger lie than handing back 181.8.
    everyN = Math.max(1, Math.round(want / panelMs));
  }

  return {
    setCap(next) {
      const n = Number(next) || 0;
      if (n === cap) return;
      cap = n > 0 ? n : 0;
      ticksSinceRender = 0;
      recompute();
    },

    /**
     * Call once per animation frame. Returns true when this tick should draw.
     *
     * Before the panel is known (the first handful of ticks) it returns true,
     * so a cap can never wedge the game shut on a display it has not measured
     * yet. Erring toward drawing is the safe direction: the worst case is a few
     * uncapped frames during startup.
     */
    shouldRender(ts) {
      if (lastTick) {
        const gap = ts - lastTick;
        // Ignore absurd gaps: a backgrounded window, a breakpoint, a load
        // veil. Those are not the panel and must not redefine it.
        if (gap > 0.5 && gap < 100) {
          gaps.push(gap);
          if (gaps.length > HISTORY) gaps.shift();
          if (gaps.length % 8 === 0) recompute();
        }
      }
      lastTick = ts;
      if (cap <= 0) return true;
      if (everyN <= 1) return true;
      ticksSinceRender += 1;
      if (ticksSinceRender < everyN) return false;
      ticksSinceRender = 0;
      return true;
    },

    diagnostics() {
      return {
        cap,
        panelIntervalMs: panelMs ? +panelMs.toFixed(3) : null,
        panelHz: panelMs ? +(1000 / panelMs).toFixed(1) : null,
        everyNVsyncs: everyN,
        effectiveFps: panelMs && everyN ? +(1000 / (panelMs * everyN)).toFixed(1) : null,
        samples: gaps.length,
      };
    },
  };
}
