// ORCA — the velocity a body may travel at without touching anybody, or the
// least-bad one when no such velocity exists.
//
// WHY THIS EXISTS AND WHAT IT REPLACES. `crowd.js` has an RVO-FLAVOURED heading
// bend: it reacts to the single most urgent neighbour, bends the heading by a
// tuning constant, and hands off to a positional relaxation pass that shoves
// bodies apart afterwards. Measured in the owner's shop, five minutes, three
// customers: 3,595 frames on which somebody was displaced by a push they did not
// choose — 11.7 a second — while the overlap counter read zero, because a rigid
// positional solve drives its own residual to zero by construction. The push IS
// the rubbing he sees. See Designs/ProShop/NAV_RESEARCH.md.
//
// THE ONE IDEA. For two discs the set of RELATIVE velocities that produce
// contact within `timeHorizon` seconds is a cone (apex at the origin, opening
// along the line between the bodies, truncated by a disc of radius
// combinedRadius/horizon). Any relative velocity outside that cone CANNOT bring
// the centres within combinedRadius during the horizon — that is geometry, not a
// tuning outcome. ORCA (van den Berg et al., https://gamma.cs.unc.edu/ORCA/)
// turns each neighbour into a single HALF-PLANE in this body's velocity space,
// placed at the half-way point of the minimum change `u` that leaves the cone,
// with normal along `u`. Each party taking HALF is what stops the reciprocal
// dance where both apply the full correction and swap sides for ever. n
// neighbours give n half-planes; their intersection is convex; the point in it
// nearest the velocity this body WANTED is a 2-D linear program.
//
// So non-collision here is a theorem with a proof rather than a constant that
// was turned up until the screenshots stopped: if every agent runs this with the
// same horizon and the program is feasible, no pair can come into contact within
// the horizon.
//
// WHERE THE THEOREM LAPSES, AND WHAT IS DONE ABOUT IT — both cases are real in a
// shop and both are handled explicitly rather than discovered as a shove:
//
//   1. INFEASIBILITY. In a doorway the half-planes can have empty intersection:
//      there is no velocity that avoids everyone. Returning an arbitrary point
//      then is how a crowd pops through itself. `linearProgram3` is RVO2's
//      answer — a 3-D program that minimises the MAXIMUM constraint violation,
//      i.e. the least-bad velocity, penetrating the shallowest constraint by the
//      smallest amount. The caller is told (`infeasible`) so a jam is visible as
//      a jam and not as a silent failure.
//   2. NEIGHBOURS THAT DO NOT RECIPROCATE. The player is not running this. Pass
//      `reciprocal: false` and that neighbour's share of `u` becomes 1 instead
//      of 0.5 — this body takes the whole correction, which is exactly what
//      "the player never dodges" means in velocity space.
//
// Mikko Mononen (Recast/Detour) rejected ORCA for crowds because the half-plane
// construction commits to ONE side of each obstacle: "even in slightly crowded
// scenes that kind of problems occur a lot". That is a density objection. This
// shop peaks at three or four customers plus the player, where the wrong-side
// case is rare and recoverable; his 200-agent case made it constant. Read
// NAV_RESEARCH.md §5 before swapping this for a sampler.
//
// Pure: no THREE, no game state, no allocation on the hot path. Everything is
// testable against hand-placed bodies, which is how `crowd.js` earned its keep
// and how this one is expected to.

export const ORCA_DEFAULTS = Object.freeze({
  // Seconds of guaranteed contact-freedom against other agents. Bigger reads as
  // people anticipating from further off; smaller as late, sharp swerves. Detour
  // looks eight body radii ahead for neighbours, which at walking pace is about
  // this.
  timeHorizon: 2.0,
  // The frame. Only used for the already-overlapping case, where the pair must
  // separate within a frame rather than "avoid" a contact that has happened.
  timeStep: 1 / 60,
  // Personal space folded into the radii. People do not walk shoulder to
  // shoulder in an empty room. This is inside the GUARANTEE, so it is the real
  // distance a pair is held at, not a suggestion a later pass enforces.
  //
  // IT MUST BE BIGGER THAN `CROWD_DEFAULTS.comfort` (0.16), AND THAT IS WHY IT
  // IS 0.18. At 0.10 this solver guaranteed 0.72 yd between bodies while
  // `separate()` treated anything under 0.78 as a violation and pushed it out —
  // so every pair ORCA held perfectly legally in that six-centimetre band was
  // shoved by the pass behind it, and the shove is the artefact this whole
  // rebuild exists to remove. MEASURED, staged pinch, three customers, one
  // minute each: legacy 2.20 shoves/s, ORCA 2.38 — the velocity solver was
  // NO BETTER than the heuristic under stress, and the reason was entirely this
  // threshold and not the solver. tests/orca-solver.test.js fails if the two
  // ever cross again.
  comfort: 0.18,
  // Seconds of guaranteed clearance from STATIC geometry. Shorter than the agent
  // horizon on purpose: a wall does not move, so hugging one is fine and
  // planning two seconds of clearance from every shelf would make the aisles
  // unusable. RVO2 splits these for the same reason.
  timeHorizonObstacle: 0.7,
  // KEEP TO ONE SIDE. Radians the preferred velocity is leaned by while anyone
  // is being avoided — and only then, so an empty room is untouched.
  //
  // This is not a garnish. MEASURED: five walkers crossing a circle to their
  // antipodes, solved by pure ORCA with no bias, are contact-free (closest
  // approach 0.723 yd, never inside 0.62) and COMPLETELY STUCK — the worst of
  // them finishes 4.12 yd short of a 7 yd crossing after fourteen seconds. The
  // constraints are perfectly symmetric, every agent's least-bad velocity points
  // into the same jam, and the theorem has nothing to say about it: ORCA
  // guarantees no contact, never progress. RVO2's own Circle demo carries the
  // same admission — "perturb a little to avoid deadlocks due to perfect
  // symmetry" — using a random nudge per frame.
  //
  // Random is wrong for a game: it is noise, and two runs of a scenario stop
  // being comparable. A fixed lean is deterministic, reproducible, and reads as
  // a traffic rule rather than a twitch: two people walking at each other both
  // lean the same absolute way, which puts them on consistent sides. At 0.02 rad
  // (1.1 degrees) it is invisible and the same five walkers all arrive within
  // 1e-7 yd of their goals.
  bias: 0.02,
});

const EPS = 1e-5;
const det = (ax, az, bx, bz) => ax * bz - az * bx;

// Pooled half-planes. `orcaVelocity` runs once per customer per frame, and a
// fresh {px,pz,dx,dz} per neighbour per customer per frame is the sort of
// short-lived garbage that turns into stutter on a busy floor. The consequence
// is that this module is NOT re-entrant and the returned velocity must be read
// before the next call — the same contract `customerNeighbours` already has.
const _lines = [];
const _proj = [];
function lineAt(pool, i) {
  let line = pool[i];
  if (!line) { line = { px: 0, pz: 0, dx: 0, dz: 0 }; pool[i] = line; }
  return line;
}
const _result = { x: 0, z: 0 };
const _out = {
  vx: 0, vz: 0, lines: 0, obstacleLines: 0, infeasible: false, penetration: 0, yielded: 0,
};

/**
 * Optimise a velocity against ONE half-plane, subject to the max-speed circle
 * and every half-plane before it. Returns false when that is impossible, which
 * is the signal that the whole program is infeasible.
 */
function linearProgram1(lines, lineNo, radius, optX, optZ, directionOpt, result) {
  const L = lines[lineNo];
  const dot = L.px * L.dx + L.pz * L.dz;
  const discriminant = dot * dot + radius * radius - (L.px * L.px + L.pz * L.pz);
  // The max-speed circle does not reach this half-plane at all: no velocity this
  // body can travel at satisfies it.
  if (discriminant < 0) return false;
  const sq = Math.sqrt(discriminant);
  let tLeft = -dot - sq;
  let tRight = -dot + sq;
  for (let i = 0; i < lineNo; i += 1) {
    const O = lines[i];
    const denominator = det(L.dx, L.dz, O.dx, O.dz);
    const numerator = det(O.dx, O.dz, L.px - O.px, L.pz - O.pz);
    if (Math.abs(denominator) <= EPS) {
      // Parallel. Either this line lies entirely inside the other's half-plane
      // (nothing to do) or entirely outside it (nothing can be done).
      if (numerator < 0) return false;
      continue;
    }
    const t = numerator / denominator;
    if (denominator >= 0) { if (t < tRight) tRight = t; } else if (t > tLeft) tLeft = t;
    if (tLeft > tRight) return false;
  }
  let t;
  if (directionOpt) {
    t = (optX * L.dx + optZ * L.dz) > 0 ? tRight : tLeft;
  } else {
    t = L.dx * (optX - L.px) + L.dz * (optZ - L.pz);
    if (t < tLeft) t = tLeft;
    else if (t > tRight) t = tRight;
  }
  result.x = L.px + t * L.dx;
  result.z = L.pz + t * L.dz;
  return true;
}

/**
 * The 2-D program: the point nearest `opt` inside every half-plane and the
 * max-speed circle. Returns `count` on success, or the index of the first
 * half-plane that could not be satisfied.
 */
function linearProgram2(lines, count, radius, optX, optZ, directionOpt, result) {
  if (directionOpt) {
    // `opt` is a unit direction and we want the fastest velocity along it.
    result.x = optX * radius;
    result.z = optZ * radius;
  } else {
    const sq = optX * optX + optZ * optZ;
    if (sq > radius * radius) {
      const len = Math.sqrt(sq) || 1;
      result.x = (optX / len) * radius;
      result.z = (optZ / len) * radius;
    } else {
      result.x = optX;
      result.z = optZ;
    }
  }
  for (let i = 0; i < count; i += 1) {
    const L = lines[i];
    if (det(L.dx, L.dz, L.px - result.x, L.pz - result.z) > 0) {
      const tx = result.x;
      const tz = result.z;
      if (!linearProgram1(lines, i, radius, optX, optZ, directionOpt, result)) {
        result.x = tx;
        result.z = tz;
        return i;
      }
    }
  }
  return count;
}

/**
 * THE JAM. When the half-planes have no common point there is no safe velocity,
 * and the honest thing is to pick the one that violates the WORST constraint by
 * the least — a crowd that slows and shuffles rather than one that pops through
 * itself. Each infeasible constraint is re-projected against the ones before it
 * and the maximum violation is minimised in turn (RVO2's linearProgram3).
 *
 * `numObstLines` is the count of leading half-planes that may never be violated
 * (static geometry). Zero until stage 3 puts walls in the same solve.
 */
function linearProgram3(lines, count, numObstLines, beginLine, radius, result) {
  let distance = 0;
  for (let i = beginLine; i < count; i += 1) {
    const L = lines[i];
    if (det(L.dx, L.dz, L.px - result.x, L.pz - result.z) > distance) {
      let n = 0;
      for (let k = 0; k < numObstLines; k += 1) {
        const src = lines[k];
        const dst = lineAt(_proj, n);
        dst.px = src.px; dst.pz = src.pz; dst.dx = src.dx; dst.dz = src.dz;
        n += 1;
      }
      for (let j = numObstLines; j < i; j += 1) {
        const O = lines[j];
        const determinant = det(L.dx, L.dz, O.dx, O.dz);
        const p = lineAt(_proj, n);
        if (Math.abs(determinant) <= EPS) {
          // Same direction: j is no more restrictive than i here.
          if (L.dx * O.dx + L.dz * O.dz > 0) continue;
          p.px = 0.5 * (L.px + O.px);
          p.pz = 0.5 * (L.pz + O.pz);
        } else {
          const s = det(O.dx, O.dz, L.px - O.px, L.pz - O.pz) / determinant;
          p.px = L.px + s * L.dx;
          p.pz = L.pz + s * L.dz;
        }
        const ddx = O.dx - L.dx;
        const ddz = O.dz - L.dz;
        const dl = Math.hypot(ddx, ddz) || 1;
        p.dx = ddx / dl;
        p.dz = ddz / dl;
        n += 1;
      }
      const tx = result.x;
      const tz = result.z;
      // Push out along i's normal as little as possible.
      if (linearProgram2(_proj, n, radius, -L.dz, L.dx, true, result) < n) {
        // In principle unreachable: the current result is already feasible for
        // this sub-program by construction, so a failure is floating-point
        // noise and the previous answer is the better one.
        result.x = tx;
        result.z = tz;
      }
      distance = det(L.dx, L.dz, L.px - result.x, L.pz - result.z);
    }
  }
}

/**
 * The velocity this body should travel at.
 *
 * @param self        {x, z, vx, vz, radius?, maxSpeed?} — vx/vz is the CURRENT
 *                    velocity, not the wanted one; the half-planes are placed
 *                    relative to it, which is what makes the split reciprocal.
 * @param neighbours  [{x, z, vx, vz, radius?, reciprocal?}] — `reciprocal:false`
 *                    for anybody not running this solver (the player).
 * @param prefVx,prefVz  the velocity the body would travel at with the room to
 *                    itself: heading * desired speed.
 * @param options.obstacles [{nx, nz, clearance}] — static geometry, each already
 *                    reduced to a unit normal pointing from the surface toward
 *                    this body and the gap between the body's edge and the
 *                    surface. Inviolable: they lead the program.
 * @returns pooled {vx, vz, lines, obstacleLines, infeasible, penetration,
 *          yielded}. `yielded` is |v - vpref|: how much of its intention the
 *          body gave up, which is what "visibly giving way" looks like as a
 *          number.
 */
export function orcaVelocity(self, neighbours, prefVx, prefVz, options = {}) {
  const obstacles = options.obstacles;
  const horizon = Number.isFinite(options.timeHorizon) ? options.timeHorizon : ORCA_DEFAULTS.timeHorizon;
  const step = Number.isFinite(options.timeStep) ? options.timeStep : ORCA_DEFAULTS.timeStep;
  const comfort = Number.isFinite(options.comfort) ? options.comfort : ORCA_DEFAULTS.comfort;
  const bias = Number.isFinite(options.bias) ? options.bias : ORCA_DEFAULTS.bias;
  const obstacleHorizon = Number.isFinite(options.timeHorizonObstacle)
    ? options.timeHorizonObstacle : ORCA_DEFAULTS.timeHorizonObstacle;
  const dt = Math.max(1e-3, Math.min(step, 0.25));
  const invTimeHorizon = 1 / Math.max(0.05, horizon);
  const invTimeStep = 1 / dt;
  const selfR = Number.isFinite(self.radius) ? self.radius : 0.31;
  const vx = Number.isFinite(self.vx) ? self.vx : 0;
  const vz = Number.isFinite(self.vz) ? self.vz : 0;
  const prefLen = Math.hypot(prefVx, prefVz);
  const maxSpeed = Math.max(
    1e-3,
    Number.isFinite(self.maxSpeed) && self.maxSpeed > 0 ? self.maxSpeed : prefLen,
  );

  // STATIC GEOMETRY GOES IN FIRST, AND IS NEVER VIOLATED.
  //
  // Stage 2 chose a safe velocity and then let `resolveCustomer` clamp the
  // resulting POSITION out of any collider it landed in — and that clamp can
  // push a body straight into another body, which is how the closest approach
  // came out at 0.708 yd when the solver had guaranteed 0.80. A wall the solver
  // cannot see is a wall that undoes it.
  //
  // Each obstacle arrives already reduced to the thing that matters: the unit
  // normal pointing from the surface TOWARD this body, and the clearance
  // between the body's edge and the surface. The constraint is then one line of
  // algebra — for the clearance to stay non-negative for the whole horizon,
  // `v · n >= -clearance / horizon` — and the half-plane through
  // `n * (-clearance/horizon)` perpendicular to n says exactly that. There is no
  // reciprocity: a shelf takes none of the correction.
  //
  // These are the LEADING lines, so the infeasible fallback treats them as
  // inviolable and gives ground on the people instead. That is the right
  // priority: two people brushing past each other is a bad frame, a body inside
  // the counter is a broken shop.
  let count = 0;
  let penetration = 0;
  const walls = obstacles || [];
  for (let k = 0; k < walls.length; k += 1) {
    const o = walls[k];
    if (!o) continue;
    const nx = o.nx;
    const nz = o.nz;
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) continue;
    // Already inside it: the constraint asks for outward motion, but bounded, or
    // one deeply-embedded body makes the whole program infeasible for ever.
    const clearance = Math.max(Number.isFinite(o.clearance) ? o.clearance : 0, -0.35);
    const line = lineAt(_lines, count);
    const offset = -clearance / Math.max(0.05, obstacleHorizon);
    line.px = nx * offset;
    line.pz = nz * offset;
    line.dx = nz;
    line.dz = -nx;
    count += 1;
  }
  const obstacleLines = count;
  const list = neighbours || [];
  for (let k = 0; k < list.length; k += 1) {
    const other = list[k];
    if (!other) continue;
    const otherR = Number.isFinite(other.radius) ? other.radius : 0.31;
    let rx = other.x - self.x;
    let rz = other.z - self.z;
    let distSq = rx * rx + rz * rz;
    if (distSq < 1e-8) {
      // Exactly coincident bodies have no direction of their own. A tiebreak
      // derived from the body's OWN position (never from array order) so the
      // same stack always fans out the same way and no reordering changes it.
      const a = ((Math.round(self.x * 1000) + Math.round(self.z * 1000) + count * 37) % 360)
        * (Math.PI / 180);
      rx = Math.cos(a) * 1e-3;
      rz = Math.sin(a) * 1e-3;
      distSq = 1e-6;
    }
    const dvx = vx - (Number.isFinite(other.vx) ? other.vx : 0);
    const dvz = vz - (Number.isFinite(other.vz) ? other.vz : 0);
    const combined = selfR + otherR + comfort;
    const combinedSq = combined * combined;
    const line = lineAt(_lines, count);
    // The shortest change to the relative velocity that leaves the cone. Every
    // branch below assigns both.
    let ux;
    let uz;

    if (distSq > combinedSq) {
      // No contact yet. w is the relative velocity measured from the apex of the
      // truncated cone; u is the shortest way out of it.
      const wx = dvx - invTimeHorizon * rx;
      const wz = dvz - invTimeHorizon * rz;
      const wLenSq = wx * wx + wz * wz;
      const dot1 = wx * rx + wz * rz;
      if (dot1 < 0 && dot1 * dot1 > combinedSq * wLenSq) {
        // Nearest point on the cone is on its truncating cap.
        const wLen = Math.sqrt(wLenSq) || 1e-9;
        const unitWx = wx / wLen;
        const unitWz = wz / wLen;
        line.dx = unitWz;
        line.dz = -unitWx;
        const mag = combined * invTimeHorizon - wLen;
        ux = mag * unitWx;
        uz = mag * unitWz;
      } else {
        // Nearest point is on a leg — pass in front or behind, and the side is
        // whichever is already closer, which is what keeps a body from being
        // asked to cross in front of somebody it has nearly passed.
        const leg = Math.sqrt(Math.max(0, distSq - combinedSq));
        if (det(rx, rz, wx, wz) > 0) {
          line.dx = (rx * leg - rz * combined) / distSq;
          line.dz = (rx * combined + rz * leg) / distSq;
        } else {
          line.dx = -(rx * leg + rz * combined) / distSq;
          line.dz = -(-rx * combined + rz * leg) / distSq;
        }
        const dot2 = dvx * line.dx + dvz * line.dz;
        ux = dot2 * line.dx - dvx;
        uz = dot2 * line.dz - dvz;
      }
    } else {
      // ALREADY TOUCHING. Not a prediction problem any more: project onto the
      // cut-off circle of ONE FRAME so the pair is required to be apart by the
      // next one. The guarantee is meant to make this branch unreachable in
      // play; it exists because a body can be placed here by something else
      // (a spawn, a teleport, the recovery ladder), and because a solver that
      // has no answer for its own failure case cannot be trusted.
      const wx = dvx - invTimeStep * rx;
      const wz = dvz - invTimeStep * rz;
      const wLen = Math.hypot(wx, wz) || 1e-9;
      const unitWx = wx / wLen;
      const unitWz = wz / wLen;
      line.dx = unitWz;
      line.dz = -unitWx;
      const mag = combined * invTimeStep - wLen;
      ux = mag * unitWx;
      uz = mag * unitWz;
      const pen = combined - Math.sqrt(distSq);
      if (pen > penetration) penetration = pen;
    }

    // THE RECIPROCAL SPLIT. Half, because the other body is running the same
    // computation on the same frame and will contribute the other half. A
    // neighbour that is not running it takes none, so this body takes all.
    const share = other.reciprocal === false ? 1 : 0.5;
    line.px = vx + share * ux;
    line.pz = vz + share * uz;
    count += 1;
  }

  // The lean goes on the OBJECTIVE, not the constraints: it changes which
  // feasible velocity is preferred, never which velocities are safe. And only
  // while somebody is being avoided, so a body walking an empty room travels
  // exactly where it meant to.
  let optX = prefVx;
  let optZ = prefVz;
  if (count > 0 && bias) {
    const c = Math.cos(bias);
    const s = Math.sin(bias);
    optX = prefVx * c - prefVz * s;
    optZ = prefVx * s + prefVz * c;
  }

  const failed = linearProgram2(_lines, count, maxSpeed, optX, optZ, false, _result);
  let infeasible = false;
  if (failed < count) {
    infeasible = true;
    linearProgram3(_lines, count, obstacleLines, failed, maxSpeed, _result);
  }
  _out.vx = _result.x;
  _out.vz = _result.z;
  _out.lines = count;
  _out.obstacleLines = obstacleLines;
  _out.infeasible = infeasible;
  _out.penetration = penetration;
  _out.yielded = Math.hypot(_result.x - prefVx, _result.z - prefVz);
  return _out;
}
