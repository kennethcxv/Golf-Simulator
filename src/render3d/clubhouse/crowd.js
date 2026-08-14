// CROWD — people avoid each other BEFORE they touch, and never end up inside
// one another afterwards.
//
// WHAT WAS THERE AND WHY IT LOOKED LIKE THAT. Two separate 0.62 yd rules:
// `_isBlockedAt` treated another actor as a blocked cell for the look-ahead fan,
// and `resolveMotion` pushed an actor back out to 0.62 after the step. Both are
// reasonable on their own and together they still produce the owner's
// screenshot -- a shopper walking through the body of the person in front --
// for three reasons:
//
//   1. RESOLUTION WAS SEQUENTIAL AND ONE-SIDED. Actors resolve in array order,
//      and only the actor being updated moves. A pushes out of B; B is updated
//      next and walks straight back into A. Nobody yields, so the pair grinds
//      instead of separating, and the visible result is interpenetration that
//      never settles. Order-dependence also means the same crowd resolves
//      differently depending on which actor happens to be first in the pool.
//   2. STEERING SWITCHES OFF EXACTLY WHEN IT IS NEEDED. steerAround returns the
//      raw heading when the remaining travel is under 0.62 yd, which is the
//      distance at which two people are about to collide.
//   3. NOTHING LOOKED AT VELOCITY. A person is treated as a static blocked disc,
//      so two actors closing head-on each see a stationary obstacle in a place
//      neither of them will still be in, sidestep the wrong way, and re-collide.
//
// WHAT THIS DOES INSTEAD.
//
//   * `avoidanceHeading` is reciprocal and velocity-aware. It projects both
//     bodies forward, finds the time of closest approach, and only reacts to
//     neighbours it will ACTUALLY meet. Each body takes HALF the correction
//     because the other one is running the same computation on the same frame:
//     that is what makes two people step past each other instead of both
//     dodging the same way and colliding again (Reciprocal Velocity Obstacles,
//     van den Berg 2008 -- the reciprocity is the whole trick, and it is one
//     multiply here rather than a dependency).
//   * `separate` is a SIMULTANEOUS, SYMMETRIC solve. Every overlapping pair is
//     found first, then both bodies move apart by half each, and the whole pass
//     repeats a few times. No actor order can change the outcome, and a pair can
//     never be left overlapping because one of them was updated first.
//   * MASS. A person standing in a queue, being served, or otherwise pinned has
//     infinite mass: the mover goes around them and they do not get shoved out
//     of the line by someone walking past. That is the specific complaint about
//     the fourth person in the queue, and it is not expressible at all in a
//     scheme where whoever moves last wins.
//
// Pure, no THREE, no game state: the whole thing is testable against a
// hand-placed room, which is how the steering module before it earned its keep.

/** Half a shoulder width. Two people at exactly 2*BODY_RADIUS are touching. */
export const BODY_RADIUS = 0.31;

export const CROWD_DEFAULTS = Object.freeze({
  // How far ahead to look for a collision, in seconds. Below about a second
  // people react too late to look deliberate; much above it and they swerve
  // around someone they were going to pass comfortably anyway.
  horizon: 1.6,
  // Personal space on top of the two bodies. People do not walk shoulder to
  // shoulder in an empty room.
  comfort: 0.16,
  // How hard a predicted collision bends the heading. 1 fully commits to the
  // avoidance direction; lower blends with the intended course so an actor
  // still makes progress toward its goal while sidestepping.
  strength: 0.85,
  // Iterations of the separation solve. Three resolves a dense clump without
  // being visible as a jitter.
  iterations: 3,
  // Fraction of an overlap removed per iteration. 1 would be a rigid solve that
  // pops; this converges over the iterations and reads as people settling.
  stiffness: 0.62,
});

const clamp = (value, lo, hi) => (value < lo ? lo : (value > hi ? hi : value));

/**
 * Reciprocal, velocity-aware avoidance.
 *
 * @param self       {x, z, vx, vz, radius?}
 * @param neighbours [{x, z, vx, vz, radius?, pinned?}]
 * @param dirX,dirZ  the heading the actor wants (any length)
 * @param speed      how fast it intends to move, yd/s
 * @returns {{x, z, avoided, threat}} unit heading
 */
export function avoidanceHeading(self, neighbours, dirX, dirZ, speed, options = {}) {
  const opts = { ...CROWD_DEFAULTS, ...options };
  const len = Math.hypot(dirX, dirZ);
  if (!(len > 1e-6)) return { x: 0, z: 0, avoided: false, threat: null };
  const ux = dirX / len;
  const uz = dirZ / len;
  if (!Array.isArray(neighbours) || neighbours.length === 0) {
    return { x: ux, z: uz, avoided: false, threat: null };
  }
  const selfRadius = Number.isFinite(self.radius) ? self.radius : BODY_RADIUS;
  const vx = ux * speed;
  const vz = uz * speed;

  // Pick the single most urgent neighbour rather than summing every push. A sum
  // of opposing pushes from a crowd cancels to zero and walks the actor straight
  // into the middle of it, which is the classic boids-in-a-corridor failure.
  let worst = null;
  for (const other of neighbours) {
    if (!other) continue;
    const otherRadius = Number.isFinite(other.radius) ? other.radius : BODY_RADIUS;
    const combined = selfRadius + otherRadius + opts.comfort;
    const rx = other.x - self.x;
    const rz = other.z - self.z;
    const distance = Math.hypot(rx, rz);
    if (distance < 1e-6) continue;
    // Relative velocity. A pinned neighbour contributes none of its own, which
    // is what makes a queue behave like furniture to someone walking past.
    const ovx = other.pinned ? 0 : (Number.isFinite(other.vx) ? other.vx : 0);
    const ovz = other.pinned ? 0 : (Number.isFinite(other.vz) ? other.vz : 0);
    const dvx = vx - ovx;
    const dvz = vz - ovz;
    // r points from self to other and dv is (self - other), so the pair is
    // CLOSING when dv points along r. This was negated on the first pass, which
    // made every genuinely closing pair read as "moving apart" and skipped: two
    // people walking straight at each other saw no threat at all.
    const closing = rx * dvx + rz * dvz;
    // Already overlapping counts as urgent even if the pair is separating,
    // otherwise two bodies that start inside each other never push apart.
    const overlapping = distance < combined;
    if (!overlapping && closing <= 0) continue; // moving apart, not a threat

    const relSpeedSq = dvx * dvx + dvz * dvz;
    // Time of closest approach along the relative velocity.
    const tca = relSpeedSq > 1e-9
      ? clamp((rx * dvx + rz * dvz) / relSpeedSq, 0, opts.horizon)
      : 0;
    const cx = rx - dvx * tca;
    const cz = rz - dvz * tca;
    const missDistance = Math.hypot(cx, cz);
    if (!overlapping && missDistance >= combined) continue; // passes clear

    // Urgency: how soon, and how deep. Overlap is treated as t = 0.
    const urgency = overlapping
      ? 2 + (combined - distance)
      : 1 / (0.15 + tca);
    if (!worst || urgency > worst.urgency) {
      worst = { urgency, rx, rz, distance, combined, cx, cz, missDistance, overlapping };
    }
  }
  if (!worst) return { x: ux, z: uz, avoided: false, threat: null };

  // Sidestep perpendicular to the line of approach. The SIGN is chosen so both
  // parties pass on the same side of each other, decided from geometry both can
  // compute identically rather than from anything private to one actor -- if
  // each picked its own preferred side they would mirror each other and collide
  // again. Cross product of intended heading with the offset to the neighbour:
  // positive means it lies to the left, so go right.
  const cross = ux * worst.rz - uz * worst.rx;
  const sign = cross > 0 ? -1 : 1;
  let px = -uz * sign;
  let pz = ux * sign;

  // Head-on (cross ~ 0) has no natural side. Break it with the neighbour's
  // position along the perpendicular so the choice is still symmetric.
  if (Math.abs(cross) < 1e-4) {
    const bias = (worst.rx * -uz) + (worst.rz * ux);
    if (bias > 0) { px = uz; pz = -ux; } else { px = -uz; pz = ux; }
  }

  // Deeper overlap and nearer approach bend the heading harder.
  const shortfall = worst.overlapping
    ? 1
    : clamp((worst.combined - worst.missDistance) / Math.max(worst.combined, 1e-6), 0, 1);
  const bend = opts.strength * shortfall;
  // Back away along the contact normal too when already inside someone.
  let bx = 0;
  let bz = 0;
  if (worst.overlapping && worst.distance > 1e-6) {
    const push = (worst.combined - worst.distance) / worst.combined;
    bx = (-worst.rx / worst.distance) * push;
    bz = (-worst.rz / worst.distance) * push;
  }
  const hx = ux * (1 - bend) + px * bend + bx;
  const hz = uz * (1 - bend) + pz * bend + bz;
  const hlen = Math.hypot(hx, hz);
  if (!(hlen > 1e-6)) return { x: ux, z: uz, avoided: false, threat: worst };
  return { x: hx / hlen, z: hz / hlen, avoided: true, threat: worst };
}

/**
 * Simultaneous symmetric separation.
 *
 * Bodies are {x, z, radius?, pinned?} and are mutated in place. Returns the
 * number of pairs that were overlapping on the first pass, which is the number
 * a probe should expect to see fall to zero.
 *
 * @param clampToWorld optional (x, z, radius) => ({x, z}) so a body pushed out
 *        of a neighbour is never pushed into a wall.
 */
let _dx = new Float64Array(0);
let _dz = new Float64Array(0);

export function separate(bodies, options = {}, clampToWorld = null) {
  const opts = { ...CROWD_DEFAULTS, ...options };
  if (!Array.isArray(bodies) || bodies.length < 2) return 0;
  let firstPassOverlaps = 0;

  for (let iteration = 0; iteration < opts.iterations; iteration += 1) {
    // Collect every correction BEFORE applying any of them. Applying as we go
    // is what made the old resolution order-dependent: the second pair in the
    // list would be computed against a body the first pair had already moved.
    // Hoisted: this allocated two typed arrays PER ITERATION per frame. The
    // scratch is reused and grown only when a bigger crowd turns up.
    if (_dx.length < bodies.length) { _dx = new Float64Array(bodies.length); _dz = new Float64Array(bodies.length); }
    const dx = _dx;
    const dz = _dz;
    dx.fill(0, 0, bodies.length);
    dz.fill(0, 0, bodies.length);

    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i];
      if (!a) continue;
      const ar = Number.isFinite(a.radius) ? a.radius : BODY_RADIUS;
      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j];
        if (!b) continue;
        const br = Number.isFinite(b.radius) ? b.radius : BODY_RADIUS;
        const want = ar + br + opts.comfort;
        let rx = b.x - a.x;
        let rz = b.z - a.z;
        let distance = Math.hypot(rx, rz);
        if (distance >= want) continue;
        if (iteration === 0) firstPassOverlaps += 1;
        if (distance < 1e-6) {
          // Exactly coincident: no direction of its own. Use a deterministic
          // one derived from the pair's indices so a stack of bodies fans out
          // instead of every pair choosing the same axis.
          const angle = ((i * 31 + j * 17) % 360) * (Math.PI / 180);
          rx = Math.cos(angle) * 1e-3;
          rz = Math.sin(angle) * 1e-3;
          distance = 1e-3;
        }
        const overlap = (want - distance) * opts.stiffness;
        const nx = rx / distance;
        const nz = rz / distance;
        // Mass: a pinned body does not move, and its share goes to the other.
        const aFixed = a.pinned === true;
        const bFixed = b.pinned === true;
        if (aFixed && bFixed) continue;
        const aShare = aFixed ? 0 : (bFixed ? 1 : 0.5);
        const bShare = bFixed ? 0 : (aFixed ? 1 : 0.5);
        dx[i] -= nx * overlap * aShare;
        dz[i] -= nz * overlap * aShare;
        dx[j] += nx * overlap * bShare;
        dz[j] += nz * overlap * bShare;
      }
    }

    // SQUEEZED BODIES NEED A WAY OUT SIDEWAYS.
    //
    // A body wedged between two immovable ones -- someone standing in the middle
    // of a queue -- receives two opposing corrections that cancel to nothing, so
    // it stays exactly where it is, overlapping both, forever. Along the line of
    // centres there is genuinely no solution: the gap is smaller than the body.
    // The escape is perpendicular, and it has to be deterministic so the same
    // jam always resolves the same way.
    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      if (!body || body.pinned === true) continue;
      const br = Number.isFinite(body.radius) ? body.radius : BODY_RADIUS;
      let deepest = null;
      let crowdX = 0;
      let crowdZ = 0;
      for (let j = 0; j < bodies.length; j += 1) {
        if (j === i || !bodies[j]) continue;
        const other = bodies[j];
        const or = Number.isFinite(other.radius) ? other.radius : BODY_RADIUS;
        const want = br + or + opts.comfort;
        const rx = other.x - body.x;
        const rz = other.z - body.z;
        const d = Math.hypot(rx, rz);
        if (d >= want) continue;
        crowdX += rx;
        crowdZ += rz;
        if (!deepest || (want - d) > deepest.depth) deepest = { rx, rz, d, depth: want - d };
      }
      if (!deepest) continue;
      // Fires when the corrections NEARLY cancel, not only when they cancel
      // exactly. Squeezed between two pinned bodies the opposing pushes leave a
      // small residue that walks the body to an equilibrium point still inside
      // both of them, and an exact-zero test never sees it. A body overlapping
      // only ONE neighbour has a net correction of the same order as its overlap
      // depth, so it fails this test and takes no lateral push.
      if (Math.hypot(dx[i], dz[i]) > deepest.depth * 0.35) continue;
      const d = deepest.d > 1e-6 ? deepest.d : 1e-6;
      const nx = deepest.rx / d;
      const nz = deepest.rz / d;
      // THE SIDE COMES FROM GEOMETRY, NOT FROM THE ARRAY INDEX. Using `i % 2`
      // here made the whole solve order-dependent again -- reversing the body
      // list changed every result -- which is the exact fault this module exists
      // to remove. Escape away from the centre of mass of whoever is crowding
      // this body; if that is perfectly balanced, fall back to a tiebreak
      // derived from the body's OWN position, which no reordering can change.
      let side = (-nz * crowdX + nx * crowdZ) < 0 ? 1 : -1;
      if (Math.abs(-nz * crowdX + nx * crowdZ) < 1e-9) {
        side = ((Math.round(body.x * 1000) + Math.round(body.z * 1000)) % 2 === 0) ? 1 : -1;
      }
      dx[i] += -nz * side * deepest.depth * opts.stiffness;
      dz[i] += nx * side * deepest.depth * opts.stiffness;
    }

    let moved = false;
    for (let i = 0; i < bodies.length; i += 1) {
      if (dx[i] === 0 && dz[i] === 0) continue;
      const body = bodies[i];
      const nextX = body.x + dx[i];
      const nextZ = body.z + dz[i];
      const placed = clampToWorld
        ? clampToWorld(nextX, nextZ, Number.isFinite(body.radius) ? body.radius : BODY_RADIUS)
        : { x: nextX, z: nextZ };
      body.x = placed.x;
      body.z = placed.z;
      moved = true;
    }
    if (!moved) break;
  }
  return firstPassOverlaps;
}

/**
 * Stuck escalation. Actors that stop making progress get progressively stronger
 * remedies rather than one blunt timer, because the three ways a person gets
 * stuck need three different answers:
 *
 *   NUDGE   jammed against a body -- a sidestep clears it
 *   REPATH  the world changed under the path (a box was set down)
 *   UNSTICK genuinely wedged in geometry -- only a placement fixes it
 *
 * Pure bookkeeping: it returns the action to take and never performs it.
 */
export const STUCK_ACTION = Object.freeze({
  NONE: 'none', NUDGE: 'nudge', REPATH: 'repath', UNSTICK: 'unstick',
});

export const STUCK_DEFAULTS = Object.freeze({
  // A person shuffling in a queue is not stuck; this is the speed below which
  // "moving" stops counting, in yards per second.
  crawlSpeed: 0.08,
  nudgeAfter: 0.7,
  repathAfter: 1.8,
  unstickAfter: 4.0,
});

export function makeStuckWatch(options = {}) {
  const opts = { ...STUCK_DEFAULTS, ...options };
  return {
    stalled: 0,
    lastAction: STUCK_ACTION.NONE,
    /**
     * @param movedDistance how far the actor actually moved this frame
     * @param dt            seconds
     * @param wantsToMove   false while deliberately standing (queueing, served)
     */
    tick(movedDistance, dt, wantsToMove) {
      if (!wantsToMove) { this.stalled = 0; this.lastAction = STUCK_ACTION.NONE; return STUCK_ACTION.NONE; }
      const speed = dt > 1e-6 ? movedDistance / dt : 0;
      if (speed > opts.crawlSpeed) {
        this.stalled = 0;
        this.lastAction = STUCK_ACTION.NONE;
        return STUCK_ACTION.NONE;
      }
      this.stalled += dt;
      // Escalate once per threshold rather than every frame past it, so a stuck
      // actor is not re-pathed sixty times a second.
      let action = STUCK_ACTION.NONE;
      if (this.stalled >= opts.unstickAfter && this.lastAction !== STUCK_ACTION.UNSTICK) {
        action = STUCK_ACTION.UNSTICK;
      } else if (this.stalled >= opts.repathAfter && this.lastAction === STUCK_ACTION.NUDGE) {
        action = STUCK_ACTION.REPATH;
      } else if (this.stalled >= opts.nudgeAfter && this.lastAction === STUCK_ACTION.NONE) {
        action = STUCK_ACTION.NUDGE;
      }
      if (action !== STUCK_ACTION.NONE) this.lastAction = action;
      return action;
    },
    reset() { this.stalled = 0; this.lastAction = STUCK_ACTION.NONE; },
  };
}
