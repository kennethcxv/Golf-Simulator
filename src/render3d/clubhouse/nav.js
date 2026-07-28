// CUSTOMER NAVIGATION — a walkable-cell grid baked from the collider boxes,
// A* on destination changes only, then string-pulled so walkers cut natural
// straight lines. Pure data in, waypoints out: no renderer types in here, so
// the whole thing unit-tests headlessly.

const SQRT2 = Math.SQRT2;

export function makeNav({ minX, maxX, minZ, maxZ, cell = 0.3, radius = 0.32 }) {
  const w = Math.max(2, Math.ceil((maxX - minX) / cell));
  const h = Math.max(2, Math.ceil((maxZ - minZ) / cell));
  let blocked = new Uint8Array(w * h);

  const toCX = (x) => Math.min(w - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const toCZ = (z) => Math.min(h - 1, Math.max(0, Math.floor((z - minZ) / cell)));
  const cxOf = (i) => i % w;
  const czOf = (i) => (i / w) | 0;
  const centerX = (cx) => minX + (cx + 0.5) * cell;
  const centerZ = (cz) => minZ + (cz + 0.5) * cell;
  const inGridPt = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;

  // bake: a cell is blocked when its center falls inside any collider inflated
  // by the walker radius
  function rebuild(cols) {
    blocked = new Uint8Array(w * h);
    for (const c of cols) {
      const x0 = Math.max(0, toCX(c.minX - radius));
      const x1 = Math.min(w - 1, toCX(c.maxX + radius));
      const z0 = Math.max(0, toCZ(c.minZ - radius));
      const z1 = Math.min(h - 1, toCZ(c.maxZ + radius));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const px = centerX(cx);
          const pz = centerZ(cz);
          if (px > c.minX - radius && px < c.maxX + radius && pz > c.minZ - radius && pz < c.maxZ + radius) {
            blocked[cz * w + cx] = 1;
          }
        }
      }
    }
  }

  const isFree = (cx, cz) => cx >= 0 && cz >= 0 && cx < w && cz < h && !blocked[cz * w + cx];

  function nearestFree(cx, cz, maxR = 10) {
    if (isFree(cx, cz)) return cz * w + cx;
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (isFree(cx + dx, cz + dz)) return (cz + dz) * w + (cx + dx);
        }
      }
    }
    return -1;
  }

  // World-space open queries for callers outside the bake: the centre of the
  // nearest open cell to a world point (null when everything within maxR cells
  // is solid), and a point-openness test. The stuck-recovery ladder uses these
  // to nudge a wedged walker onto ground the grid actually believes in, and to
  // project an unreachable target to its nearest reachable stand point.
  function nearestOpenWorld(x, z, maxR = 10) {
    if (!inGridPt(x, z)) return null;
    const i = nearestFree(toCX(x), toCZ(z), maxR);
    if (i < 0) return null;
    return { x: centerX(cxOf(i)), z: centerZ(czOf(i)) };
  }
  const isOpenWorld = (x, z) => inGridPt(x, z) && isFree(toCX(x), toCZ(z));

  // grid line-of-sight: sample the segment at sub-cell steps
  function lineFree(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(d / (cell * 0.5)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!isFree(toCX(x0 + (x1 - x0) * t), toCZ(z0 + (z1 - z0) * t))) return false;
    }
    return true;
  }

  function astar(startIdx, goalIdx) {
    if (startIdx === goalIdx) return [goalIdx];
    const open = [startIdx];
    const came = new Map();
    const g = new Map([[startIdx, 0]]);
    const gx = cxOf(goalIdx);
    const gz = czOf(goalIdx);
    const hOf = (i) => {
      const dx = Math.abs(cxOf(i) - gx);
      const dz = Math.abs(czOf(i) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    const f = new Map([[startIdx, hOf(startIdx)]]);
    const inOpen = new Set([startIdx]);
    let guard = w * h * 4;
    while (open.length && guard-- > 0) {
      // smallest-f pop (linear scan is fine at this grid size and call rate)
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((f.get(open[i]) ?? 1e9) < (f.get(open[bi]) ?? 1e9)) bi = i;
      const cur = open.splice(bi, 1)[0];
      inOpen.delete(cur);
      if (cur === goalIdx) {
        const path = [cur];
        let n = cur;
        while (came.has(n)) { n = came.get(n); path.push(n); }
        return path.reverse();
      }
      const cx = cxOf(cur);
      const cz = czOf(cur);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!isFree(nx, nz)) continue;
          // no diagonal corner-cutting
          if (dx && dz && (!isFree(cx + dx, cz) || !isFree(cx, cz + dz))) continue;
          const ni = nz * w + nx;
          const ng = (g.get(cur) ?? 1e9) + (dx && dz ? SQRT2 : 1);
          if (ng < (g.get(ni) ?? 1e9)) {
            came.set(ni, cur);
            g.set(ni, ng);
            f.set(ni, ng + hOf(ni));
            if (!inOpen.has(ni)) { open.push(ni); inOpen.add(ni); }
          }
        }
      }
    }
    return null;
  }

  // world path: null means "no route" (caller falls back to a straight line);
  // [] means "you are effectively there"
  function path(sx, sz, tx, tz) {
    if (!inGridPt(sx, sz) || !inGridPt(tx, tz)) return null; // off the mat — open ground
    if (lineFree(sx, sz, tx, tz)) return [{ x: tx, z: tz }];
    const s = nearestFree(toCX(sx), toCZ(sz));
    const t = nearestFree(toCX(tx), toCZ(tz));
    if (s < 0 || t < 0) return null;
    const cells = astar(s, t);
    if (!cells) return null;
    const pts = cells.map((i) => ({ x: centerX(cxOf(i)), z: centerZ(czOf(i)) }));
    // string-pull: keep only the corners the walker actually needs
    const out = [];
    let anchor = { x: sx, z: sz };
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (lineFree(anchor.x, anchor.z, pts[j].x, pts[j].z)) { far = j; break; }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far + 1;
    }
    // land exactly on the target if the last leg is clear
    if (lineFree(anchor.x, anchor.z, tx, tz)) out.push({ x: tx, z: tz });
    return out;
  }

  return {
    rebuild,
    path,
    lineFree,
    nearestOpenWorld,
    isOpenWorld,
    _debug: { get blocked() { return blocked; }, w, h },
  };
}
