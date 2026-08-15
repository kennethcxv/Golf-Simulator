// NEGATIVE CONTROL FOR THE B2 TEST FILE: run the same three measurements
// against the rig being REPLACED (the lag filter). If the new tests pass for
// both rigs they measure nothing.
import * as THREE from 'three';
import { createMopStrands } from '../../src/render3d/mopStrands.js';

const SHIPPED = {
  splayBase: 0.22, splayGrow: 0.30, pushGain: 3.0, dragGain: 0.08,
  chaseBase: 11.0, chaseFall: 2.0, targetBase: 0.70, targetGrow: 0.55,
  deficitBase: 0.25, deficitGrow: 0.15,
};

function build() {
  const material = new THREE.MeshBasicMaterial();
  const rig = createMopStrands({
    THREE, material, count: 48, segments: 3, radius: 0.115, length: 0.30,
    params: SHIPPED,
  });
  const head = new THREE.Group();
  head.add(rig.root);
  head.position.set(0, 1, 0);
  head.updateMatrixWorld(true);
  return { rig, head };
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// --- 1. IS THE REST POSE STILL? -------------------------------------------
{
  const { rig, head } = build();
  for (let f = 0; f < 240; f += 1) { head.updateMatrixWorld(true); rig.update(1 / 60, 0, 0, 0, 0); }
  const a = rig.tipsLocal().map((v) => v.clone());
  for (let f = 0; f < 30; f += 1) { head.updateMatrixWorld(true); rig.update(1 / 60, 0, 0, 0, 0); }
  const b = rig.tipsLocal();
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, a[i].distanceTo(b[i]));
  console.log(`OLD RIG rest stillness: worst tip moved ${worst.toFixed(6)} yd over 30 still frames`);
  console.log(`  new-rig assertion is  < 0.000001  ->  ${worst < 1e-6 ? 'PASS' : 'FAIL'}`);
}

// --- 2. DOES SLIDING THE HEAD MAKE THE YARN TRAIL? -------------------------
// The head is walked sideways. Nothing else: no mopping stroke. This is
// "carrying a mop across a room".
{
  const { rig, head } = build();
  for (let f = 0; f < 180; f += 1) { head.updateMatrixWorld(true); rig.update(1 / 60, 0, 0, 0, 0); }
  const restX = mean(rig.tipsLocal().map((v) => v.x));
  for (let f = 0; f < 40; f += 1) {
    head.position.x += 0.03;
    head.updateMatrixWorld(true);
    rig.update(1 / 60, 0, 0, 0, 0);
  }
  const moveX = mean(rig.tipsLocal().map((v) => v.x));
  const offset = moveX - restX;
  console.log(`OLD RIG trail while carried: mean tip offset ${offset.toFixed(6)} yd`);
  console.log(`  new-rig assertion is  < -0.02    ->  ${offset < -0.02 ? 'PASS' : 'FAIL'}`);
}

// --- 3. DOES THE FLOOR SPREAD IT? -----------------------------------------
// The old rig has no floor at all; `contact` is a 0..1 dial someone else sets.
{
  const free = build();
  for (let f = 0; f < 240; f += 1) { free.head.updateMatrixWorld(true); free.rig.update(1 / 60, 0, 0, 0, 0); }
  const freeSpread = mean(free.rig.tipsLocal().map((v) => Math.hypot(v.x, v.z)));
  const freeDrop = mean(free.rig.tipsLocal().map((v) => -v.y));
  // "planted" for the old rig can only mean turning the dial to 1
  const plant = build();
  for (let f = 0; f < 240; f += 1) { plant.head.updateMatrixWorld(true); plant.rig.update(1 / 60, 0, 0, 1, 0); }
  const plantSpread = mean(plant.rig.tipsLocal().map((v) => Math.hypot(v.x, v.z)));
  const plantDrop = mean(plant.rig.tipsLocal().map((v) => -v.y));
  console.log(`OLD RIG spread free ${freeSpread.toFixed(4)} -> planted ${plantSpread.toFixed(4)} `
    + `(ratio ${(plantSpread / freeSpread).toFixed(2)}, assertion needs > 1.5)`);
  console.log(`OLD RIG drop   free ${freeDrop.toFixed(4)} -> planted ${plantDrop.toFixed(4)} `
    + `(ratio ${(plantDrop / freeDrop).toFixed(2)}, assertion needs < 0.75)`);
}
