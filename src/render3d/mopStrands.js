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

export function createMopStrands({ THREE, material, radius = 0.115, length = 0.30 }) {
  const root = new THREE.Group();
  root.name = 'MopStrandRig';

  // one geometry for every segment: a tapered length of yarn, origin at its top
  // so a segment rotates about where it joins the one above
  const segLen = length / SEGMENTS;
  const geometry = new THREE.CylinderGeometry(0.0072, 0.0052, segLen, 5, 1, true);
  geometry.translate(0, -segLen / 2, 0);

  const strands = [];
  for (let i = 0; i < STRAND_COUNT; i += 1) {
    // two rings, so the head reads as a bundle rather than a fringe
    const ring = i < STRAND_COUNT * 0.6 ? 0 : 1;
    const inRing = ring === 0 ? STRAND_COUNT * 0.6 : STRAND_COUNT * 0.4;
    const indexInRing = ring === 0 ? i : i - Math.floor(STRAND_COUNT * 0.6);
    const angle = (indexInRing / inRing) * Math.PI * 2 + (ring ? 0.22 : 0);
    const r = radius * (ring ? 0.62 : 1.0);
    const anchor = new THREE.Group();
    anchor.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    root.add(anchor);

    const joints = [];
    let parent = anchor;
    for (let s = 0; s < SEGMENTS; s += 1) {
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
    // a little variation so the bundle is not a machined ring
    strands.push({
      anchor,
      joints,
      angle,
      phase: (i * 0.61803) % 1,
      slack: 0.82 + ((i * 0.37) % 1) * 0.36,
      lag: joints.map(() => 0),
    });
  }

  let time = 0;

  /**
   * @param dt        seconds
   * @param stroke    the rig's lagged sweep angle (radians); the head's swing
   * @param strokeVel the rig's lag velocity; how hard it is being driven
   * @param contact   0..1, how planted the head is on the floor
   */
  function update(dt, stroke = 0, strokeVel = 0, contact = 0) {
    time += dt;
    const drive = Math.max(-2.4, Math.min(2.4, strokeVel));
    for (const strand of strands) {
      // How much this strand feels the stroke: one on the outside of the arc,
      // less on the inside, so the bundle fans instead of moving as a slab.
      const facing = Math.cos(strand.angle);
      const push = (stroke * 1.15 + drive * 0.16) * strand.slack;
      for (let s = 0; s < SEGMENTS; s += 1) {
        // each segment chases the one above it, and more slowly further down —
        // this is the trail, and it is why the tips are still moving when the
        // head has stopped
        const chase = 9.5 - s * 2.3;
        const target = push * (0.42 + s * 0.34) * (0.55 + 0.45 * facing);
        strand.lag[s] += (target - strand.lag[s]) * Math.min(1, dt * chase);
        const joint = strand.joints[s];
        // swing across the stroke...
        joint.rotation.z = strand.lag[s];
        // ...and splay OUTWARD once the floor stops the strand going down. The
        // deeper the segment and the more planted the head, the flatter it lies.
        const splay = contact * (0.30 + s * 0.42) * strand.slack;
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
    // for a driver: the world position of every tip, which is the only honest
    // way to ask whether the strands actually moved
    tipCount: STRAND_COUNT,
    tips: () => strands.map((strand) => strand.joints[SEGMENTS - 1]),
  };
}
