// THE MOP'S YARN, SIMULATED — Verlet integration with distance constraints and
// a real floor. B2 (Goal 20), sixth attempt at this tool.
//
// WHY NOT A SIXTH LAG CURVE. The rig this replaces (mopStrands.js, still used by
// the broom, whose feel the owner says is right) drives every strand with
//
//     lag += (target - lag) * dt * chase
//
// a first-order filter toward an angle derived from the head's swing. It has no
// state beyond one angle per segment, no momentum, no floor and no notion of
// where the strand actually IS in the room. Everything it cannot express had to
// be added as another input: the mopping stroke (ITEM 8), then the head's carry
// fan (B3), then the head's world delta so that turning on the spot would stir
// it (E4). Three signals, three patches, and it still reads as animation because
// a filter chasing a target is animation. A fourth input was the thing the brief
// forbade, and rightly.
//
// WHY THIS SOLVER. Position-based dynamics (Verlet integration + iterated
// distance constraints, Jakobsen 2001 / Müller 2006) is the standard way rope,
// hair and cloth are done, and it produces all four things the brief asks for
// from ONE mechanism rather than four tuned terms:
//
//   * pressed to the floor they spread out and flatten — the floor clamps the
//     nodes, the distance constraint has nowhere left to put the length, and it
//     buckles outward
//   * moved side to side they flow and trail, then settle — momentum carries the
//     nodes, damping and floor friction bleed it off
//   * direction changes whip them — a reversal leaves the accumulated velocity
//     pointing the old way; the constraint converts it into a snap
//   * nothing reads as a canned loop — there is no clock in here. The old rig
//     literally had `Math.sin(time * 1.7 + phase)` in its rest pose.
//
// And because the nodes live in WORLD space, the strands respond to anything the
// head does — stroke, carry, walking, strafing, turning, a lift, a stumble —
// with no drive signal plumbed in at all. The three patches above become one
// line: read the anchor's world matrix.
//
// WHY NOT VENDOR ONE. The small JS Verlet libraries (mattdesl/verlet3d,
// VerletExpressJS, trzy/verlet) are particle-and-stick engines that allocate an
// object per particle and per constraint, and none of them models floor
// friction or writes into an InstancedMesh. At 640 strands x 4 nodes that is
// 2,560 live objects a frame plus an adapter, against ~90 lines of flat
// Float32Array arithmetic here. The thing that failed five times was not that
// the code was local — it was that it was a LAG CURVE. This is the named
// algorithm, run on real state, against a real floor.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// TUNED AGAINST THE PLAYER-CAMERA FRAMES, not by taste. The first pass ran
// gravity 11 / damping 0.90 / buckle 0.55 and the photographs showed two faults
// the simulation tests could not: on a strafe reversal the yarn whipped clean
// ABOVE its own collar, and a planted head splayed so hard it read as a flat
// disc rather than a bundle. Wet cotton is heavy and it damps fast, so the fix
// is physical rather than cosmetic — more weight, less retained velocity, and a
// buckle that lets the head keep its volume when it is pressed down.
const DEFAULT_PARAMS = Object.freeze({
  gravity: 19.0,      // yd/s^2 — waterlogged cotton, not hair
  damping: 0.865,     // velocity kept per step (air)
  floorFriction: 0.55, // horizontal velocity kept per step while touching boards
  iterations: 2,      // constraint passes; more = stiffer yarn
  buckle: 0.30,       // how strongly a compressed strand splays outward
  stiffness: 1.0,     // 0..1 fraction of the length error corrected per pass
  maxStep: 1 / 90,    // fixed sub-step, so feel never depends on frame rate
});

// THE YARN THE PLAYER ACTUALLY SEES, owned in one place.
//
// This used to live only as arguments at the single call site in
// toolViewmodel.js, while the function defaults below said something else and
// the test asserted the DEFAULTS. Two populations: the shipped mop could change
// without the test noticing, and the test could pass about a mop nobody holds.
// Both now read this object.
export const SHIPPED_MOP_YARN = Object.freeze({
  count: 16,
  radius: 0.098,
  length: 0.30,
  segments: 4,
  strandRadiusTop: 0.0062,
  strandRadiusBottom: 0.0048,
  radialSegments: 8,
  lengthVariation: 0.24,
});

export function createVerletMopStrands({
  THREE, material,
  radius = 0.115,
  length = 0.30,
  count = 820,
  segments = 4,
  strandRadiusTop = 0.0030,
  strandRadiusBottom = 0.0016,
  radialSegments = 5,
  // B3: real mop yarn is not cut to one length. +/-18% around the nominal, so
  // the hem of the bundle is ragged instead of a machined disc.
  lengthVariation = 0.18,
  params = {},
}) {
  const live = { ...DEFAULT_PARAMS, ...params };
  const N = Math.max(1, Math.round(count));
  const S = Math.max(1, Math.round(segments));
  const NODES = S + 1; // node 0 is the anchor, pinned to the head

  const root = new THREE.Group();
  root.name = 'MopVerletRig';

  // Geometry is authored at the NOMINAL segment length with its origin at the
  // top, so a segment scales about the joint it hangs from.
  const nominalSeg = length / S;
  const RADIAL = Math.max(3, Math.round(radialSegments));
  const geometry = new THREE.CylinderGeometry(
    strandRadiusTop, strandRadiusBottom, nominalSeg, RADIAL, 1, true,
  );
  geometry.translate(0, -nominalSeg / 2, 0);

  const layers = [];
  for (let s = 0; s < S; s += 1) {
    const mesh = new THREE.InstancedMesh(geometry, material, N);
    mesh.name = `MopVerletLayer_${s}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    root.add(mesh);
    layers.push(mesh);
  }

  // Per-strand constants. Sunflower placement fills the disc evenly (golden
  // angle, sqrt radius) — no spokes, no banding, and deterministic, so two
  // sessions are identical.
  const anchorX = new Float32Array(N);
  const anchorZ = new Float32Array(N);
  const outX = new Float32Array(N); // buckling direction: away from the centre
  const outZ = new Float32Array(N);
  const segLen = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const r = radius * Math.sqrt((i + 0.5) / N);
    const theta = i * GOLDEN;
    anchorX[i] = Math.cos(theta) * r;
    anchorZ[i] = Math.sin(theta) * r;
    outX[i] = Math.cos(theta);
    outZ[i] = Math.sin(theta);
    // deterministic ragged hem
    const v = ((i * 0.6180339887) % 1) * 2 - 1;
    segLen[i] = (length * (1 + v * lengthVariation)) / S;
  }

  // World-space node state. Flat arrays: this runs 2,560 nodes a frame.
  const px = new Float32Array(N * NODES);
  const py = new Float32Array(N * NODES);
  const pz = new Float32Array(N * NODES);
  const qx = new Float32Array(N * NODES); // previous position (Verlet velocity)
  const qy = new Float32Array(N * NODES);
  const qz = new Float32Array(N * NODES);
  let seeded = false;

  const _m = new THREE.Matrix4();
  const _inv = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _anchor = new THREE.Vector3();

  // Seed (and re-seed) every chain hanging straight down from its anchor, at
  // rest. Used on the first frame, and whenever the head teleports — equipping,
  // a scene change, a respawn — so a 40-yard jump can never fling the yarn.
  function seed(rootWorld) {
    for (let i = 0; i < N; i += 1) {
      _anchor.set(anchorX[i], 0, anchorZ[i]).applyMatrix4(rootWorld);
      for (let n = 0; n < NODES; n += 1) {
        const k = i * NODES + n;
        px[k] = _anchor.x;
        py[k] = _anchor.y - n * segLen[i];
        pz[k] = _anchor.z;
        qx[k] = px[k];
        qy[k] = py[k];
        qz[k] = pz[k];
      }
    }
    seeded = true;
  }

  /**
   * @param dt      seconds
   * @param floorY  world Y of the boards under the player, or null for none
   *
   * No drive signal: the strands read the anchor's own world matrix, so every
   * way the head can move is already accounted for.
   */
  function update(dt, floorY = null) {
    root.updateWorldMatrix(true, false);
    const rootWorld = root.matrixWorld;
    if (!seeded) { seed(rootWorld); return; }

    // A teleport must reset rather than simulate: compare the first anchor's
    // new world position with where its own node 0 was last frame.
    _anchor.set(anchorX[0], 0, anchorZ[0]).applyMatrix4(rootWorld);
    const jump = Math.abs(_anchor.x - px[0]) + Math.abs(_anchor.y - py[0])
      + Math.abs(_anchor.z - pz[0]);
    if (jump > 2.0) { seed(rootWorld); return; }

    // Fixed sub-steps: the yarn must feel the same at 30 fps and 144 fps.
    let remaining = Math.min(Math.max(dt, 0), 0.1);
    const floor = floorY == null ? null : floorY + 0.004;
    while (remaining > 0) {
      const h = Math.min(remaining, live.maxStep);
      remaining -= h;
      const gdt = live.gravity * h * h;
      const damp = live.damping;

      for (let i = 0; i < N; i += 1) {
        const base = i * NODES;
        // node 0 is pinned to the head, in world space
        _anchor.set(anchorX[i], 0, anchorZ[i]).applyMatrix4(rootWorld);
        px[base] = _anchor.x; py[base] = _anchor.y; pz[base] = _anchor.z;
        qx[base] = _anchor.x; qy[base] = _anchor.y; qz[base] = _anchor.z;

        for (let n = 1; n < NODES; n += 1) {
          const k = base + n;
          const onFloor = floor !== null && py[k] <= floor + 1e-4;
          // friction only bites the horizontal, the way a wet strand dragging
          // on boards does; the vertical is free to settle
          const lat = onFloor ? live.floorFriction : damp;
          const vx = (px[k] - qx[k]) * lat;
          const vy = (py[k] - qy[k]) * damp;
          const vz = (pz[k] - qz[k]) * lat;
          qx[k] = px[k]; qy[k] = py[k]; qz[k] = pz[k];
          px[k] += vx;
          py[k] += vy - gdt;
          pz[k] += vz;
        }
      }

      for (let iter = 0; iter < live.iterations; iter += 1) {
        for (let i = 0; i < N; i += 1) {
          const base = i * NODES;
          const L = segLen[i];
          for (let n = 1; n < NODES; n += 1) {
            const k = base + n;
            const p = k - 1;
            let dx = px[k] - px[p];
            let dy = py[k] - py[p];
            let dz = pz[k] - pz[p];
            let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-6) {
              // degenerate: a fully compressed chain has no direction of its
              // own, so give it the one a real fibre would buckle along
              dx = outX[i] * 1e-3; dy = -1e-3; dz = outZ[i] * 1e-3;
              d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            const f = ((L - d) / d) * live.stiffness;
            // the parent is authoritative (the chain hangs from a pinned
            // anchor), so only the child moves — one pass down the chain is
            // stable and needs no mass bookkeeping
            px[k] += dx * f;
            py[k] += dy * f;
            pz[k] += dz * f;

            if (floor !== null && py[k] < floor) {
              // BUCKLING: the length has to go somewhere. Pushing the node out
              // along its own azimuth by the amount the floor stole is what
              // makes a pressed head spread and flatten instead of stacking.
              const bite = floor - py[k];
              py[k] = floor;
              px[k] += outX[i] * bite * live.buckle;
              pz[k] += outZ[i] * bite * live.buckle;
            }
          }
        }
      }
    }

    // Compose the instance matrices in the rig's own local frame.
    _inv.copy(rootWorld).invert();
    for (let i = 0; i < N; i += 1) {
      const base = i * NODES;
      const yScale = segLen[i] / nominalSeg;
      for (let n = 0; n < S; n += 1) {
        const a = base + n;
        const b = a + 1;
        _dir.set(px[b] - px[a], py[b] - py[a], pz[b] - pz[a]);
        const len = _dir.length();
        if (len > 1e-6) _dir.multiplyScalar(1 / len); else _dir.set(0, -1, 0);
        // the cylinder is authored pointing DOWN from its origin
        _q.setFromUnitVectors(_up, _dir.negate());
        _pos.set(px[a], py[a], pz[a]);
        _scale.set(1, yScale, 1);
        _m.compose(_pos, _q, _scale);
        _m.premultiply(_inv);
        layers[n].setMatrixAt(i, _m);
      }
    }
    for (let n = 0; n < S; n += 1) layers[n].instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    for (const layer of layers) layer.dispose();
  }

  return {
    root,
    update,
    dispose,
    // broomViewmodel drives the filtered rig with four scalars and this one with
    // a floor height; the flag is how it tells them apart.
    isVerlet: true,
    params: () => ({ ...live }),
    setParams(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (key in live && Number.isFinite(Number(value))) live[key] = Number(value);
      }
      return { ...live };
    },
    defaults: () => ({ ...DEFAULT_PARAMS }),
    strandCount: N,
    tipCount: N,
    drawCalls: S,
    // For a driver: where the tips ACTUALLY are, in world space, read out of the
    // simulation state rather than inferred from the head's pose.
    tipsWorld: () => {
      const out = [];
      for (let i = 0; i < N; i += 1) {
        const k = i * NODES + NODES - 1;
        out.push(new THREE.Vector3(px[k], py[k], pz[k]));
      }
      return out;
    },
    tipsLocal: () => {
      _inv.copy(root.matrixWorld).invert();
      const out = [];
      for (let i = 0; i < N; i += 1) {
        const k = i * NODES + NODES - 1;
        out.push(new THREE.Vector3(px[k], py[k], pz[k]).applyMatrix4(_inv));
      }
      return out;
    },
    tipLayer: () => layers[S - 1],
  };
}
