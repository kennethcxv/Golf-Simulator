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

// GOAL 34 — THE PANEL COMES FROM THE OS NOW, AND THE SKIP IS GUARDED.
//
// Measured 2026-08-16: this module reported panelHz 60.2 / 62.9 / 58.5 on three
// legs while Electron's own screen API reported 240 for the same display, so
// everyNVsyncs came out 1 and skippedTicks 0 at cap 60, at cap 144 and
// uncapped. The cap was inert and its diagnostics were lying about why.
//
// The lie has one cause: on a GPU-bound frame the rAF cadence is the GAME's
// rate, not the display's, and this module was inferring the panel from it.
// The OS knows the real number, so the OS is asked (setPanelHz, fed from
// fw:display-info).
//
// But trusting the OS grid ALONE would be far worse than the inert cap. If rAF
// is firing at 70 Hz because a frame costs 14 ms, and the cap decides the grid
// is 240 Hz and skips three ticks in four, the player gets 17 fps. The vsync
// grid is real; the assumption that a tick arrives on every vsync is not.
//
// So the grid comes from the OS and the DECISION carries a headroom guard
// measured on presented frames: if the interval between rendered frames cannot
// hold the requested rate, the cap stops skipping entirely. The two thresholds
// differ (1.4x to give up, 0.9x to try again) so a frame sitting exactly on the
// boundary cannot oscillate between 60 and 240 every few frames — that
// hysteresis is the whole reason the guard is safe to leave on.
const HISTORY = 31; // odd, so the median is a real sample

export function createFrameCap() {
  let cap = 0;
  const gaps = [];
  // intervals between PRESENTED frames — the guard's evidence, and a different
  // series from `gaps`, which counts every tick including the declined ones
  const renderGaps = [];
  let lastTick = 0;
  let lastRender = 0;
  let workBound = false;
  let ticksSinceRender = 0;
  let everyN = 1;
  let panelMs = 0;
  let osPanelMs = 0;
  // What the cap actually DID, not what it intended. Smoothness is the interval
  // between PRESENTED frames, and a probe sampling requestAnimationFrame cannot
  // see that: at a cap, the ticks the cap declines still fire, and Chromium
  // issues the next one almost immediately because the declined tick produced
  // no damage. Measured at cap 60 on this machine: a third of all rAF gaps came
  // back under 0.5 ms, which reads as a 2,000 fps game and is really the skip.
  // These two counters let a driver reconstruct the frames a player saw.
  let renderedFrames = 0;
  let skippedTicks = 0;
  // Both periodic re-checks below used to be triggered by `array.length % 8`,
  // and both arrays saturate at HISTORY = 31. 31 % 8 is 7, so once the history
  // filled, the trigger never fired again for the rest of the session: the
  // panel estimate froze at whatever the first 31 gaps said and a display
  // change could not re-solve it. Count the samples instead of measuring the
  // buffer.
  let gapSamples = 0;
  let renderSamples = 0;

  // Median rather than mean because one long sample — a GC pause, a window
  // drag — must not redefine anything.
  function median(series, min = 8) {
    if (series.length < min) return 0;
    const v = series.slice().sort((a, b) => a - b);
    return v[v.length >> 1];
  }

  // The cadence the cap is ASKING for, ignoring whether the machine can hold
  // it. Round rather than ceil: asking for 144 on a 181.8 Hz panel is nearer to
  // "every vsync" than to "every other one", and handing back 90.9 would be a
  // bigger lie than handing back 181.8.
  function idealEveryN() {
    if (cap <= 0 || panelMs <= 0) return 1;
    return Math.max(1, Math.round((1000 / cap) / panelMs));
  }

  function recompute() {
    // The OS wins when it has answered. Its number does not move with load,
    // which is the entire point: the measured median does, and that is how a
    // 240 Hz display came to be reported as 58.5 Hz.
    panelMs = osPanelMs > 0 ? osPanelMs : median(gaps);
    everyN = workBound ? 1 : idealEveryN();
  }

  // THE GUARD. Evidence is the interval between frames the player was actually
  // shown, compared against the cadence the cap is asking for — not against the
  // raw setting, because a cap the panel cannot divide is ROUNDED on purpose
  // and its own presented interval is legitimately longer than 1000/cap.
  //
  // Above 1.4x that cadence the machine is missing it and every declined tick
  // is pure loss, so stop declining. With the skip off the presented interval
  // is simply the frame cost, so the way back in is that cost fitting inside
  // the budget. The two thresholds do not overlap, which is what stops a frame
  // sitting on the boundary from flipping the rate every few frames.
  function updateWorkBound() {
    if (cap <= 0) {
      if (workBound) { workBound = false; recompute(); }
      return;
    }
    const ideal = idealEveryN();
    if (ideal <= 1) {
      // nothing would be declined at this setting, so there is no skip to guard
      if (workBound) { workBound = false; recompute(); }
      return;
    }
    const rendered = median(renderGaps, 4);
    if (!rendered || panelMs <= 0) return;
    const target = ideal * panelMs;
    if (!workBound && rendered > target * 1.4) {
      workBound = true;
      renderGaps.length = 0;
      recompute();
    } else if (workBound && rendered <= target * 0.98) {
      workBound = false;
      renderGaps.length = 0;
      recompute();
    }
  }

  return {
    setCap(next) {
      const n = Number(next) || 0;
      if (n === cap) return;
      cap = n > 0 ? n : 0;
      ticksSinceRender = 0;
      // UNPROVEN UNTIL MEASURED. Skipping starts OFF on every cap or panel
      // change and only switches on once presented frames show the headroom is
      // really there. The other order — skip first, back off when it hurts —
      // costs the player a fifth of a second of quartered frame rate every time
      // they touch the setting, and that is the exact feel this whole goal is
      // about.
      workBound = cap > 0;
      renderGaps.length = 0;
      lastRender = 0;
      recompute();
    },

    /**
     * The display's refresh rate as the OPERATING SYSTEM reports it, which is
     * the only source that does not move with load. Fed from Electron's screen
     * API via fw:display-info. Zero or nothing returns the module to inferring
     * the panel from rAF, which is what a browser build has to do.
     */
    setPanelHz(hz) {
      const n = Number(hz) || 0;
      const next = n > 0 && n <= 1000 ? 1000 / n : 0;
      if (next === osPanelMs) return;
      osPanelMs = next;
      ticksSinceRender = 0;
      workBound = cap > 0;
      renderGaps.length = 0;
      lastRender = 0;
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
          gapSamples += 1;
          if (gapSamples % 8 === 0) recompute();
        }
      }
      lastTick = ts;
      const present = () => {
        if (lastRender) {
          const rg = ts - lastRender;
          if (rg > 0.5 && rg < 500) {
            renderGaps.push(rg);
            if (renderGaps.length > HISTORY) renderGaps.shift();
            renderSamples += 1;
            if (renderSamples % 8 === 0) updateWorkBound();
          }
        }
        lastRender = ts;
        renderedFrames += 1;
        return true;
      };
      if (cap <= 0 || everyN <= 1) return present();
      ticksSinceRender += 1;
      if (ticksSinceRender < everyN) { skippedTicks += 1; return false; }
      ticksSinceRender = 0;
      return present();
    },

    diagnostics() {
      const measured = median(gaps);
      return {
        cap,
        panelIntervalMs: panelMs ? +panelMs.toFixed(3) : null,
        panelHz: panelMs ? +(1000 / panelMs).toFixed(1) : null,
        // where that number came from, so a probe can never again report the
        // game's own rate as the display's without the report saying so
        panelSource: osPanelMs > 0 ? 'os' : 'rAF-median',
        osPanelHz: osPanelMs > 0 ? +(1000 / osPanelMs).toFixed(1) : null,
        measuredTickHz: measured ? +(1000 / measured).toFixed(1) : null,
        everyNVsyncs: everyN,
        // true when the machine cannot hold the requested rate, so the cap has
        // deliberately stopped skipping rather than multiplying the shortfall
        workBound,
        presentedIntervalMs: median(renderGaps) ? +median(renderGaps).toFixed(2) : null,
        effectiveFps: panelMs && everyN ? +(1000 / (panelMs * everyN)).toFixed(1) : null,
        samples: gaps.length,
        renderedFrames,
        skippedTicks,
      };
    },
  };
}
