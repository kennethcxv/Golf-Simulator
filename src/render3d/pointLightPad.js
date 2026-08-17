// THE POINT-LIGHT PAD — collapse the light-count program axis.
//
// three.js bakes the VISIBLE point-light count into every lit program's
// cache key, and this game's day walks that count through at least four
// values (dawn walk 4, overview 1, night 2, trading morning 3, ledger
// reading light +1). Every transition used to revariant every lit material
// on first sight: measured 2026-08-16 as 31 program arrivals at night, 28
// on a trading morning, one landing as a 7.9 s freeze on a stalling driver.
//
// The pad holds the count CONSTANT: zero-intensity black points parked far
// below the course, topped up per frame so real + pad always equals
// PAD_TARGET. A count that never changes is one program family for the
// whole day — including every state nobody has enumerated yet. Intensity
// zero contributes exactly nothing to any fragment, which the four-state
// golden A/B proves pixel-for-pixel.
//
// If real visible lights ever EXCEED the target, the pad clamps to zero,
// warns once, and the program tripwire names the new variants — the
// failure is loud, never silent.
import * as THREE from 'three';

export const POINT_LIGHT_PAD_TARGET = 5;

export function createPointLightPad(scene) {
  const pads = [];
  for (let i = 0; i < POINT_LIGHT_PAD_TARGET; i += 1) {
    const pad = new THREE.PointLight(0x000000, 0, 0.001, 2);
    pad.name = `PointLightPad_${i}`;
    pad.visible = false;
    pad.castShadow = false;
    pad.position.set(0, -500 - i, 0); // far under the world; distance 0.001 anyway
    pad.userData.pointLightPad = true;
    pad.matrixAutoUpdate = false;
    pad.updateMatrix();
    scene.add(pad);
    pads.push(pad);
  }

  let registry = [];
  let framesSinceScan = Infinity;
  let clampWarned = false;

  const rescan = () => {
    registry = [];
    scene.traverse((o) => {
      if (o.isPointLight && !o.userData.pointLightPad) registry.push(o);
    });
  };

  // once per rendered frame, BEFORE the draw: top the visible count up.
  // __FW_DISABLE_POINT_LIGHT_PAD is the A/B kill switch: pads all off, the
  // real count flows through untouched (the four-state pixel A/B runs on it).
  const tick = (camera) => {
    if (globalThis.__FW_DISABLE_POINT_LIGHT_PAD) {
      for (const pad of pads) pad.visible = false;
      return -1;
    }
    framesSinceScan += 1;
    if (framesSinceScan >= 30) {
      framesSinceScan = 0;
      rescan();
    }
    let visible = 0;
    for (const light of registry) {
      if (!light.parent) continue; // removed since the scan
      let vis = true;
      for (let n = light; n; n = n.parent) {
        if (!n.visible) { vis = false; break; }
      }
      if (vis && light.layers.test(camera.layers)) visible += 1;
    }
    const need = POINT_LIGHT_PAD_TARGET - visible;
    if (need < 0 && !clampWarned) {
      clampWarned = true;
      console.warn('[point-light-pad] visible point lights exceed the pad target; the count axis is live again', visible);
    }
    for (let i = 0; i < pads.length; i += 1) pads[i].visible = i < need;
    return visible;
  };

  return {
    tick,
    diagnostics: () => ({
      padTarget: POINT_LIGHT_PAD_TARGET,
      padsOn: pads.filter((p) => p.visible).length,
      realTracked: registry.length,
      clamped: clampWarned,
    }),
    dispose: () => { for (const pad of pads) pad.removeFromParent(); },
  };
}
