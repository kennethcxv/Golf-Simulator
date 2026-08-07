// ITEM 8 — "Mop fibres are rigid. Strands must trail, splay on the floor, and
// swing behind."
//
// They read rigid because there are no fibres. The authored mop head is ONE
// mesh — MESH_MopSkirt, a solid cone — so nothing about it could ever trail or
// splay; the whole head moved as a block because the whole head IS a block.
//
// This builds real strands around that cone and moves them. Each strand is a
// three-segment chain hanging from the collar, and each segment lags the one
// above it, so a stroke travels DOWN the strand instead of teleporting the
// whole length at once. That lag is the entire effect: the tips arrive late,
// which is what "swings behind" means, and they keep arriving after the head
// has stopped, which is what makes it read as cloth rather than plastic.
//
// Where the strands meet the floor they cannot continue down, so the leftover
// length lays outward along the direction of travel. That is the splay.
//
// Kept deliberately cheap: 14 strands x 3 segments of a shared 5-sided tapered
// cylinder, one shared material, no per-frame allocation. The mop is a
// viewmodel seen at arm's length, but it is on screen for minutes at a time.

const STRAND_COUNT = 14;
const SEGMENTS = 3;

// B2 — every number the motion runs on, LIVE. The tuning overlay writes
// these through setParams while the tool is in hand; nothing is captured
// into closures at build time any more. Defaults are the shipped values.
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

// B3 — the same trailing-segment machinery in two LAYOUTS:
//   'ring' (default) — yarn hanging around a collar: the mop.
//   'bar'            — stiff tuft rows under a rectangular block: the push
//                      broom. columns x rows tufts spanning barWidth x
//                      barDepth in the anchor's local XZ, shorter segments,
//                      and the caller passes push-broom params (fast chase,
//                      low slack) so it settles like bristle, not yarn.
export function createMopStrands({
  THREE, material, radius = 0.115, length = 0.30, params = {},
  layout = 'ring', count = STRAND_COUNT, segments = SEGMENTS,
  barWidth = 0.44, barDepth = 0.05, barRows = 2,
  strandRadiusTop = 0.0072, strandRadiusBottom = 0.0052,
}) {
  const live = { ...DEFAULT_PARAMS, ...params };
  const root = new THREE.Group();
  root.name = 'MopStrandRig';

  // one geometry for every segment: a tapered length of yarn/bristle, origin
  // at its top so a segment rotates about where it joins the one above
  const SEGS = Math.max(1, segments);
  const segLen = length / SEGS;
  const geometry = new THREE.CylinderGeometry(strandRadiusTop, strandRadiusBottom, segLen, 5, 1, true);
  geometry.translate(0, -segLen / 2, 0);

  // placement per layout; angle keeps its two update() roles — cos = how much
  // of the stroke this strand feels, sin = which way it splays on the floor
  const places = [];
  if (layout === 'bar') {
    const cols = Math.max(2, Math.round(count / Math.max(1, barRows)));
    for (let r = 0; r < barRows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const xNorm = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1; // -1..1
        places.push({
          x: xNorm * (barWidth / 2),
          z: barRows === 1 ? 0 : ((r / (barRows - 1)) * 2 - 1) * (barDepth / 2),
          // near-full stroke response for every tuft, outward splay by column:
          // sin(angle) carries the sign of x, cos stays close to 1
          angle: Math.asin(Math.max(-1, Math.min(1, xNorm))) * 0.55,
        });
      }
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      // two rings, so the head reads as a bundle rather than a fringe
      const ring = i < count * 0.6 ? 0 : 1;
      const inRing = ring === 0 ? count * 0.6 : count * 0.4;
      const indexInRing = ring === 0 ? i : i - Math.floor(count * 0.6);
      const angle = (indexInRing / inRing) * Math.PI * 2 + (ring ? 0.22 : 0);
      const r = radius * (ring ? 0.62 : 1.0);
      places.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r, angle });
    }
  }

  const strands = [];
  for (let i = 0; i < places.length; i += 1) {
    const p = places[i];
    const anchor = new THREE.Group();
    anchor.position.set(p.x, 0, p.z);
    root.add(anchor);
    const joints = [];
    let parent = anchor;
    for (let s = 0; s < SEGS; s += 1) {
      const joint = new THREE.Group();
      if (s > 0) joint.position.y = -segLen;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.name = `MopStrand_${i}_${s}`;
      joint.add(mesh);
      parent.add(joint);
      joints.push(joint);
      parent = joint;
    }
    // a little variation so the bundle is not a machined row
    strands.push({
      anchor,
      joints,
      angle: p.angle,
      phase: (i * 0.61803) % 1,
      slack: 0.82 + ((i * 0.37) % 1) * 0.36,
      lag: joints.map(() => 0),
      carry: joints.map(() => 0),
    });
  }

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
   * scene graph — rigidly. Measured in the collar's frame they moved 0.004 yd
   * while being carried, which is the idle shimmer and nothing else: a mop
   * swung across a room had yarn welded to it.
   *
   * The parent has already applied `carry`, so what a trailing strand needs is
   * the DEFICIT — how far behind the head it still is. That relaxes to zero, so
   * a mop held still hangs straight, and it costs one filter per segment.
   */
  function update(dt, stroke = 0, strokeVel = 0, contact = 0, carry = 0) {
    time += dt;
    const drive = Math.max(-2.4, Math.min(2.4, strokeVel));
    for (const strand of strands) {
      // How much this strand feels the stroke: one on the outside of the arc,
      // less on the inside, so the bundle fans instead of moving as a slab.
      const facing = Math.cos(strand.angle);
      const slack = strand.slack * live.slackScale;
      // The velocity term used to be ADDED, which is a phase lead: the yarn
      // reached the end of the stroke fractionally before the head did. That is
      // anticipation, and cloth does not anticipate the hand carrying it — it
      // is dragged. Measured, the lead cancelled the chase filter's delay
      // almost exactly and the tips tracked the stroke at zero frames of lag
      // with r=0.97, which is a mop head moving as one piece.
      //
      // Subtracting it makes the term drag: the faster the head is driven, the
      // further behind the yarn sits, which is the direction the physics
      // actually points.
      const push = (stroke * live.pushGain - drive * live.dragGain) * slack;
      for (let s = 0; s < SEGS; s += 1) {
        // each segment chases the one above it, and more slowly further down —
        // this is the trail, and it is why the tips are still moving when the
        // head has stopped
        const chase = live.chaseBase - s * live.chaseFall;
        const target = push * (live.targetBase + s * live.targetGrow) * (0.55 + 0.45 * facing);
        strand.lag[s] += (target - strand.lag[s]) * Math.min(1, dt * chase);
        // the carried head's fan, arrived at late: the deeper the segment the
        // slower it catches up, so the deficit grows down the strand
        strand.carry[s] += (carry - strand.carry[s])
          * Math.min(1, dt * chase * live.carryChase);
        const deficit = (strand.carry[s] - carry)
          * (live.deficitBase + s * live.deficitGrow) * slack;
        const joint = strand.joints[s];
        // swing across the stroke, and trail behind the carry...
        joint.rotation.z = strand.lag[s] + deficit;
        // ...and splay OUTWARD once the floor stops the strand going down. The
        // deeper the segment and the more planted the head, the flatter it lies.
        const splay = contact * (live.splayBase + s * live.splayGrow) * slack;
        joint.rotation.x = Math.sin(strand.angle) * splay
          + Math.sin(time * 1.7 + strand.phase * 6.28) * 0.02 * (1 - contact);
      }
    }
  }

  function dispose() {
    geometry.dispose();
  }

  return {
    root,
    update,
    dispose,
    // B2: the overlay's live surface — read/patch the motion numbers with the
    // tool in hand; nothing is captured at build time.
    params: () => ({ ...live }),
    setParams(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (key in live && Number.isFinite(Number(value))) live[key] = Number(value);
      }
      return { ...live };
    },
    defaults: () => ({ ...DEFAULT_PARAMS }),
    // for a driver: the world position of every tip, which is the only honest
    // way to ask whether the strands actually moved
    tipCount: strands.length,
    tips: () => strands.map((strand) => strand.joints[SEGS - 1]),
  };
}
