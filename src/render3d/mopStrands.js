// FIBRES — the mop's yarn and the broom's bristles, one rig, drawn INSTANCED.
//
// ITEM 8 (Goal 16) asked for fibres that trail, splay on the floor and swing
// behind. The motion below is that, unchanged in behaviour: each strand is a
// short chain of segments, each segment lags the one above it, so a stroke
// travels DOWN the strand instead of teleporting the whole length at once. The
// tips arrive late, which is what "swings behind" means, and they keep arriving
// after the head has stopped, which is what makes it read as cloth rather than
// plastic. Where the strands meet the floor they cannot continue down, so the
// leftover length lays outward along the direction of travel: the splay.
//
// WHAT CHANGED (Goal 17, B2) AND WHY IT HAD TO:
//
// The broom read as "a rake, not a brush", and the geometry says exactly that.
// 22 tufts across a 0.46 m block is one every 46 mm, and a tuft is 26 mm thick,
// so there was TWENTY MILLIMETRES OF DAYLIGHT between neighbours - separated
// tines with gaps you can see through, which is a rake.
//
// The fix is density, and density was unaffordable in the old construction:
// every segment of every strand was its own Mesh, so the broom cost 44 draw
// calls and the mop 42. A1 measured this renderer at 870-1982 draw calls a
// frame and draw-call bound rather than fill bound, so tripling the tuft count
// the obvious way would have put 150 more calls into the frame the player
// already misses budget on.
//
// So the segments are now InstancedMesh - ONE per segment index, however many
// strands there are. The broom goes from 44 draw calls to 2 and the mop from 42
// to 3, which buys the density outright and gives frame time back on top.
// Per frame the rig composes one matrix per segment per strand on the CPU
// (a few hundred, trivial) instead of relying on the scene graph.

const STRAND_COUNT = 14;
const SEGMENTS = 3;

// B2 — every number the motion runs on, LIVE. The tuning overlay writes these
// through setParams while the tool is in hand; nothing is captured into
// closures at build time. Defaults are the shipped values.
const DEFAULT_PARAMS = Object.freeze({
  pushGain: 1.15,   // stroke angle -> strand push
  dragGain: 0.10,   // velocity term SUBTRACTED (drag, not anticipation)
  chaseBase: 9.5,   // segment chase rate at the collar
  chaseFall: 2.3,   // how much slower each segment down the strand
  carryChase: 0.62, // fraction of chase used for the carry deficit filter
  deficitBase: 0.55,
  deficitGrow: 0.30,
  splayBase: 0.30,
  splayGrow: 0.42,
  slackScale: 1.0,  // multiplies each strand's authored slack
  targetBase: 0.42,
  targetGrow: 0.34,
});

// Two LAYOUTS off the same machinery:
//   'ring' - yarn hanging around a collar: the mop.
//   'bar'  - tuft rows under a rectangular block: the push broom. columns x
//            rows spanning barWidth x barDepth in the anchor's local XZ.
export function createMopStrands({
  THREE, material, radius = 0.115, length = 0.30, params = {},
  layout = 'ring', count = STRAND_COUNT, segments = SEGMENTS,
  barWidth = 0.44, barDepth = 0.05, barRows = 2,
  strandRadiusTop = 0.0072, strandRadiusBottom = 0.0052,
}) {
  const live = { ...DEFAULT_PARAMS, ...params };
  const root = new THREE.Group();
  root.name = 'MopStrandRig';

  const SEGS = Math.max(1, segments);
  const segLen = length / SEGS;
  // One geometry for every segment: a tapered length of yarn or bristle, origin
  // at its TOP so a segment rotates about where it joins the one above.
  const geometry = new THREE.CylinderGeometry(strandRadiusTop, strandRadiusBottom, segLen, 5, 1, true);
  geometry.translate(0, -segLen / 2, 0);

  // Placement per layout. `angle` keeps its two roles: cos = how much of the
  // stroke this strand feels, sin = which way it splays on the floor.
  const places = [];
  if (layout === 'bar') {
    const cols = Math.max(2, Math.round(count / Math.max(1, barRows)));
    for (let r = 0; r < barRows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const xNorm = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1; // -1..1
        places.push({
          x: xNorm * (barWidth / 2),
          z: barRows === 1 ? 0 : ((r / (barRows - 1)) * 2 - 1) * (barDepth / 2),
          // near-full stroke response for every tuft, outward splay by column
          angle: Math.asin(Math.max(-1, Math.min(1, xNorm))) * 0.55,
        });
      }
    }
  } else {
    // B1 (Goal 17) — A MOP HEAD IS A SOLID BUNDLE, NOT TWO HOOPS.
    //
    // The old layout put every strand on one of two rings, at radius 1.0 and
    // 0.62 of the head, and nothing in between or in the middle. At the
    // player's camera that reads as a sparse spiky ball - the screenshot looks
    // closer to a shaving brush than a mop, which is precisely B1's "not a cone
    // with a texture on it".
    //
    // A sunflower distribution fills the disc EVENLY instead: radius grows as
    // sqrt(i/N) so each ring of area gets its fair share of strands, and the
    // golden angle between successive strands means no spokes, no banding and
    // no seam - the same construction nature uses on a seed head, for the same
    // reason. Deterministic, so two sessions are identical.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i += 1) {
      const r = radius * Math.sqrt((i + 0.5) / count);
      const theta = i * GOLDEN;
      places.push({
        x: Math.cos(theta) * r,
        z: Math.sin(theta) * r,
        // `angle` keeps both its jobs: cos() is how much of the stroke this
        // strand feels, sin() is which way it splays. Azimuth is still the
        // right value for both; strands near the centre simply have less
        // leverage, which is also true of a real mop.
        angle: theta,
      });
    }
  }

  const N = places.length;
  // ONE InstancedMesh per segment index. Segment 0 of every strand draws in one
  // call, segment 1 in the next, and so on.
  const layers = [];
  for (let s = 0; s < SEGS; s += 1) {
    const mesh = new THREE.InstancedMesh(geometry, material, N);
    mesh.name = `MopStrandLayer_${s}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // The fibres move every frame, so three must not cache their matrices.
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // A bundle of fibres is small and always near the camera that draws it;
    // culling it per-instance costs more than it saves and can pop the whole
    // head when the bounding sphere is stale.
    mesh.frustumCulled = false;
    root.add(mesh);
    layers.push(mesh);
  }

  // PER-STRAND VARIATION — B1's actual lever, and it took a failed experiment to
  // find it.
  //
  // Measured with a settled instrument: at the shipped values the fibres
  // already account for ~45% of the on-screen change during a stroke. Tripling
  // pushGain, halving the chase, and raising splay and carry deficit moved that
  // to ~47% - nothing, inside run-to-run noise - while world tip travel went up
  // 0.145 m to 0.214 m. So the fibres were always moving plenty and MORE motion
  // does not read as more motion.
  //
  // What it reads as instead is one mass swinging, because every strand is
  // driven by the same stroke through the same filter and differs only by a
  // smooth `facing` term. They start together, arrive together and stop
  // together. Real yarn does not: each length is a little stiffer or looser
  // than its neighbour, so the bundle BREAKS UP as it moves, and that breaking
  // up is what the eye reads as fibre rather than flap.
  //
  // These multipliers are deterministic per index (no build-time randomness, so
  // two sessions look identical), spread either side of 1, and deliberately
  // coprime-ish so the pattern does not band across a ring or a row.
  const strands = places.map((p, i) => ({
    x: p.x,
    z: p.z,
    angle: p.angle,
    phase: (i * 0.61803) % 1,
    slack: 0.82 + ((i * 0.37) % 1) * 0.36,
    // how fast this strand catches up: 0.62x to 1.38x of the shared rate
    chaseMul: 0.62 + ((i * 0.6180339887) % 1) * 0.76,
    // how hard the stroke drives it: 0.70x to 1.30x
    pushMul: 0.70 + ((i * 0.4142135624) % 1) * 0.60,
    lag: new Float32Array(SEGS),
    carry: new Float32Array(SEGS),
  }));

  // Scratch, allocated once: the update runs every frame for every fibre.
  const _m = new THREE.Matrix4();
  const _acc = new THREE.Matrix4();
  const _rot = new THREE.Matrix4();
  const _euler = new THREE.Euler();
  const _down = new THREE.Matrix4().makeTranslation(0, -segLen, 0);
  let time = 0;

  /**
   * @param dt        seconds
   * @param stroke    the rig's lagged sweep angle (radians); the head's swing
   * @param strokeVel the rig's lag velocity; how hard it is being driven
   * @param contact   0..1, how planted the head is on the floor
   * @param carry     the head's own fan angle from being walked about (radians)
   *
   * `carry` is the correction for a defect the first version could not have
   * caught. The strands hang off the collar, and the collar is BELOW the head's
   * fan pivot, so the head's swing was already being applied to them by the
   * transform above - rigidly. Measured in the collar's frame they moved 0.004
   * yd while being carried, which is idle shimmer and nothing else: a mop swung
   * across a room had yarn welded to it.
   *
   * The parent has already applied `carry`, so what a trailing strand needs is
   * the DEFICIT - how far behind the head it still is. That relaxes to zero, so
   * a mop held still hangs straight, and it costs one filter per segment.
   */
  function update(dt, stroke = 0, strokeVel = 0, contact = 0, carry = 0) {
    time += dt;
    const drive = Math.max(-2.4, Math.min(2.4, strokeVel));
    for (let i = 0; i < N; i += 1) {
      const strand = strands[i];
      // How much this strand feels the stroke: one on the outside of the arc,
      // less on the inside, so the bundle fans instead of moving as a slab.
      const facing = Math.cos(strand.angle);
      const slack = strand.slack * live.slackScale;
      // The velocity term is SUBTRACTED. Added, it is a phase lead: the yarn
      // reaches the end of the stroke fractionally before the head does, and
      // cloth does not anticipate the hand carrying it - it is dragged.
      const push = (stroke * live.pushGain - drive * live.dragGain) * slack * strand.pushMul;
      // Start at the strand's anchor on the block, then walk down the chain
      // accumulating each segment's rotation.
      _acc.makeTranslation(strand.x, 0, strand.z);
      for (let s = 0; s < SEGS; s += 1) {
        const chase = Math.max(0.5, (live.chaseBase - s * live.chaseFall) * strand.chaseMul);
        const target = push * (live.targetBase + s * live.targetGrow) * (0.55 + 0.45 * facing);
        strand.lag[s] += (target - strand.lag[s]) * Math.min(1, dt * chase);
        // the carried head's fan, arrived at late: the deeper the segment the
        // slower it catches up, so the deficit grows down the strand
        strand.carry[s] += (carry - strand.carry[s]) * Math.min(1, dt * chase * live.carryChase);
        const deficit = (strand.carry[s] - carry)
          * (live.deficitBase + s * live.deficitGrow) * slack;
        // swing across the stroke and trail behind the carry...
        const rz = strand.lag[s] + deficit;
        // ...and splay OUTWARD once the floor stops the strand going down. The
        // deeper the segment and the more planted the head, the flatter it lies.
        const splay = contact * (live.splayBase + s * live.splayGrow) * slack;
        const rx = Math.sin(strand.angle) * splay
          + Math.sin(time * 1.7 + strand.phase * 6.28) * 0.02 * (1 - contact);
        _euler.set(rx, 0, rz);
        _rot.makeRotationFromEuler(_euler);
        _acc.multiply(_rot);
        _m.copy(_acc);
        layers[s].setMatrixAt(i, _m);
        // the next segment hangs from the bottom of this one
        _acc.multiply(_down);
      }
    }
    for (let s = 0; s < SEGS; s += 1) layers[s].instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    for (const layer of layers) layer.dispose();
  }

  return {
    root,
    update,
    dispose,
    // the overlay's live surface - read and patch the motion numbers with the
    // tool in hand; nothing is captured at build time
    params: () => ({ ...live }),
    setParams(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (key in live && Number.isFinite(Number(value))) live[key] = Number(value);
      }
      return { ...live };
    },
    defaults: () => ({ ...DEFAULT_PARAMS }),
    // For a driver: the LOCAL position of every tip, which is the only honest
    // way to ask whether the fibres actually moved. Read from the instance
    // matrices, so it reports what was drawn rather than what was intended.
    tipCount: N,
    strandCount: N,
    drawCalls: SEGS,
    tipsLocal: () => {
      const last = layers[SEGS - 1];
      const out = [];
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      for (let i = 0; i < N; i += 1) {
        last.getMatrixAt(i, m);
        v.set(0, -segLen, 0).applyMatrix4(m);
        out.push(v.clone());
      }
      return out;
    },
    // The old API returned Object3Ds; the callers that used it wanted world
    // positions, so hand back the layer plus an index rather than a fake node.
    tipLayer: () => layers[SEGS - 1],
  };
}
