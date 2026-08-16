// GOAL 28 PHASE 3 — STARTER-EMPIRE GENERATION, OFF THE MAIN THREAD.
//
// newStarterEmpire measured 2,240 ms of synchronous main-thread work at the
// New Game click (marks ng-stategen-*, 2026-08-16), and the first worker
// design STILL blocked the main thread ~2.1 s, because reviving the JSON
// product through deserializeEmpireWithReport REGENERATES the course from
// its seed (cpu-profile: hash2/closestOnRoute/designCourse own the whole
// cost — a save stores the seed, not the terrain). So the empire crosses as
// the RUNTIME OBJECT via structured clone: the same-origin product of the
// same code and the same seed the synchronous path would have produced —
// there is no foreign data here to validate, and the main thread does no
// generation at all. If the object ever stops being clonable
// (DataCloneError), the worker degrades to the JSON envelope and the caller
// pays the revive; if anything else fails, the caller falls back to
// synchronous generation with the same seed. The seed itself is still drawn
// inside onNewGame — the QA seed pin hooks that exact frame
// (tests/qa-boot-seed-pin.test.js) and stays intact.
import { newStarterEmpire, serializeEmpire } from '../sim/empire.js';

self.onmessage = (event) => {
  const { token, mode, seed } = event.data || {};
  try {
    const empire = newStarterEmpire(mode, seed);
    try {
      self.postMessage({ token, empire });
    } catch {
      // not structured-clonable (a function or exotic object crept into the
      // sim state): fall back to the save envelope, which the caller revives
      self.postMessage({ token, json: serializeEmpire(empire) });
    }
  } catch (error) {
    self.postMessage({ token, error: String(error?.message || error) });
  }
};
