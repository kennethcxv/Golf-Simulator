// The course startup hold is a capability, not a boolean. A stale prewarm may
// finish after a newer scene has started, so only the token that began the
// current hold and the scene attached to that token can release it.

export const STARTUP_INPUT_EVENT_TYPES = Object.freeze([
  'keydown',
  'keyup',
  'click',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'wheel',
  'contextmenu',
]);

function validGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validSpeedIndex(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function fatalPanelOwns(event) {
  const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
  if (path.some((node) => node?.classList?.contains?.('fault-panel'))) return true;
  return !!event?.target?.closest?.('.fault-panel');
}

function isReloadShortcut(event) {
  if (event?.type !== 'keydown') return false;
  if (event.key === 'F5') return true;
  return (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'r';
}

export function createStartupHold() {
  let sequence = 0;
  let current = null;

  function begin({ generation, intendedSpeedIdx }) {
    if (!validGeneration(generation)) {
      throw new TypeError('Startup hold generation must be a non-negative safe integer.');
    }
    if (!validSpeedIndex(intendedSpeedIdx)) {
      throw new TypeError('Startup hold speed index must be a non-negative safe integer.');
    }
    const token = Object.freeze({ id: ++sequence, generation });
    current = {
      token,
      generation,
      intendedSpeedIdx,
      scene: null,
    };
    return token;
  }

  function attachScene(token, scene) {
    if (!current || current.token !== token || scene == null) return false;
    current.scene = scene;
    return true;
  }

  function complete(token, scene) {
    if (!current
      || current.token !== token
      || current.scene == null
      || current.scene !== scene) return null;
    const result = Object.freeze({
      generation: current.generation,
      intendedSpeedIdx: current.intendedSpeedIdx,
    });
    current = null;
    return result;
  }

  function cancelForScene(scene) {
    if (!current || scene == null || current.scene !== scene) return false;
    current = null;
    return true;
  }

  function cancel() {
    if (!current) return false;
    current = null;
    return true;
  }

  function diagnostics() {
    return Object.freeze({
      pending: current !== null,
      tokenId: current?.token.id ?? null,
      generation: current?.generation ?? null,
      intendedSpeedIdx: current?.intendedSpeedIdx ?? null,
      sceneAttached: current?.scene != null,
      beginCount: sequence,
    });
  }

  return Object.freeze({
    begin,
    attachScene,
    complete,
    cancelForScene,
    cancel,
    isPending: () => current !== null,
    diagnostics,
  });
}

// Install once, before any gameplay component adds capture listeners. The veil
// already owns the pixels; this owns the keyboard and pointer event paths that
// still bubble through document/window while those pixels are hidden.
export function installStartupInputHold({ scope = globalThis.window, hold } = {}) {
  if (!scope?.addEventListener || !scope?.removeEventListener) {
    throw new TypeError('Startup input hold requires an event target scope.');
  }
  if (!hold || typeof hold.isPending !== 'function') {
    throw new TypeError('Startup input hold requires a hold controller.');
  }

  const blockWhilePending = (event) => {
    if (!hold.isPending() || fatalPanelOwns(event) || isReloadShortcut(event)) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  };
  const options = { capture: true, passive: false };
  for (const type of STARTUP_INPUT_EVENT_TYPES) {
    scope.addEventListener(type, blockWhilePending, options);
  }

  let installed = true;
  return Object.freeze({
    eventTypes: STARTUP_INPUT_EVENT_TYPES,
    dispose() {
      if (!installed) return false;
      installed = false;
      for (const type of STARTUP_INPUT_EVENT_TYPES) {
        scope.removeEventListener(type, blockWhilePending, options);
      }
      return true;
    },
  });
}
