import { ceilingCircuitPowered } from '../../sim/clubhouseRestoration.js';

/**
 * Keep the renderer's ceiling-light circuit on the same authoritative state as
 * the simulation without advancing any simulation clocks.
 *
 * Clubhouse prewarm renders while the normal update loop is intentionally
 * suspended. A render-only synchronization point therefore needs the same
 * circuit gate as the live flicker/update path. The closure remembers the last
 * applied boolean so repeated camera-visibility polls are allocation-light and
 * do not churn light visibility/layer masks.
 */
export function createCeilingCircuitRenderSync({
  state,
  readPowered = ceilingCircuitPowered,
  applyPowered,
} = {}) {
  if (typeof readPowered !== 'function') {
    throw new TypeError('createCeilingCircuitRenderSync requires readPowered(state).');
  }
  if (typeof applyPowered !== 'function') {
    throw new TypeError('createCeilingCircuitRenderSync requires applyPowered(powered).');
  }

  let appliedPowered = null;
  let sequence = 0;
  let settledResult = null;

  function sync() {
    const powered = readPowered(state) === true;
    if (powered === appliedPowered) return settledResult;
    const rendererChanged = applyPowered(powered) === true;
    appliedPowered = powered;
    sequence += 1;
    const changedResult = Object.freeze({
      powered,
      changed: true,
      rendererChanged,
      sequence,
    });
    // updateFlicker calls this on every live frame. Cache the unchanged result
    // alongside the newly applied result so the hot path returns one stable
    // object rather than allocating and freezing sixty objects per second.
    settledResult = Object.freeze({
      powered,
      changed: false,
      rendererChanged: false,
      sequence,
    });
    return changedResult;
  }

  function diagnostics() {
    return Object.freeze({ appliedPowered, sequence });
  }

  return Object.freeze({ sync, diagnostics });
}
