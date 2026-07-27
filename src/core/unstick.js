// NEVER PERMANENTLY TRAPPED — depenetration, a safe trail, and escalating recovery.
//
// The collision test only ever answered "may I move INTO that?". It could not answer "am I
// already inside something?", so an overlapped player had every candidate move rejected and the
// only way out was to restart the game. These four pieces are the way out:
//
//   resolveOverlaps    push out of anything you are standing in, by the shortest route
//   createSafeTrail    breadcrumbs of ground that was known-good
//   createStuckMonitor notice that the player is pressing a key and going nowhere
//   nearestFree        last resort: spiral out to the closest open ground
//
// All four are pure — they take numbers and colliders and give back numbers — so the recovery
// rules are pinned by tests rather than by playing the game and hoping.

// colliders are either AABBs {minX,maxX,minZ,maxZ} or circles {x,z,r}
function pushOutOf(x, z, r, c) {
  if (c.minX !== undefined) {
    if (!(x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ)) return null;
    // four ways out; take the shortest
    const west = x + r - c.minX; // push -x
    const east = c.maxX - (x - r); // push +x
    const south = z + r - c.minZ; // push -z
    const north = c.maxZ - (z - r); // push +z
    const m = Math.min(west, east, south, north);
    if (m === west) return { x: c.minX - r, z };
    if (m === east) return { x: c.maxX + r, z };
    if (m === south) return { x, z: c.minZ - r };
    return { x, z: c.maxZ + r };
  }
  const dx = x - c.x;
  const dz = z - c.z;
  const rr = c.r + r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return { x: c.x + rr, z: c.z }; // dead centre: any direction will do
  return { x: c.x + (dx / d) * rr, z: c.z + (dz / d) * rr };
}

// `groups` is an array of collider arrays (walls, props, trees, ...) so the caller can hand over
// its live lists without copying them every frame.
export function resolveOverlaps(x, z, r, groups, iterations = 6) {
  let px = x;
  let pz = z;
  let pushed = false;
  for (let i = 0; i < iterations; i++) {
    let moved = false;
    for (const group of groups) {
      if (!group) continue;
      for (const c of group) {
        const out = pushOutOf(px, pz, r, c);
        if (out) {
          px = out.x;
          pz = out.z;
          moved = true;
          pushed = true;
        }
      }
    }
    if (!moved) break; // settled: clear of everything
  }
  return { x: px, z: pz, pushed };
}

// breadcrumbs of ground the player stood on cleanly
export function createSafeTrail(cap = 24) {
  const pts = [];
  return {
    record(x, z) {
      pts.push({ x, z });
      if (pts.length > cap) pts.shift();
    },
    // walk backwards until we find a crumb that is *still* free — the shop changes shape
    recall(isFree) {
      for (let i = pts.length - 1; i >= 0; i--) {
        if (isFree(pts[i].x, pts[i].z)) return pts[i];
      }
      return null;
    },
    get size() {
      return pts.length;
    },
    clear() {
      pts.length = 0;
    },
  };
}

// "pressing a movement key and going nowhere" is the only definition of stuck that matters
export function createStuckMonitor(opts = {}) {
  const softMs = opts.softMs ?? 700;
  const hardMs = opts.hardMs ?? 1800;
  const crawl = opts.crawlPerFrame ?? 0.02; // yd at 60fps: slower than this is not walking
  let stuckMs = 0;
  let stage = 0;

  return {
    update(dtMs, { wantsToMove, moved, overlapping }) {
      const pinned = wantsToMove && moved < crawl * (dtMs / 16.7);
      if (!pinned) {
        stuckMs = 0;
        if (!overlapping) stage = 0;
        return null;
      }
      stuckMs += dtMs;
      if (stuckMs >= hardMs && stage < 2) {
        stage = 2;
        return 'nearestFree';
      }
      if (stuckMs >= softMs && stage < 1) {
        stage = 1;
        return 'lastSafe';
      }
      return null;
    },
    reset() {
      stuckMs = 0;
      stage = 0;
    },
    get stuckMs() {
      return stuckMs;
    },
  };
}

// last resort: rings of candidates outward from where you are, nearest first
export function nearestFree(x, z, isFree, step = 0.25, maxRings = 40) {
  if (isFree(x, z)) return { x, z };
  for (let ring = 1; ring <= maxRings; ring++) {
    const rad = ring * step;
    const n = Math.max(8, ring * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cx = x + Math.cos(a) * rad;
      const cz = z + Math.sin(a) * rad;
      if (isFree(cx, cz)) return { x: cx, z: cz };
    }
  }
  return null;
}
