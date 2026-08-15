// C5 — how far does the player actually walk to get behind their own till?
//
// The route is measured against the LIVE collider set (walk.isFree), not against
// shopLayout's rectangles: the thing that stops a player is the collider that got
// registered, and half of these are registered by the greybox module rather than
// by the layout. A grid BFS over the real free-space is the only honest answer.
//
// TWO FRAME TRAPS, both of which this driver hit before it was trusted:
//   * walk.isFree takes WORLD coordinates. Every shopLayout datum is
//     INTERIOR-LOCAL and the interior sits ~360 yd out in x, so a probe fed
//     layout numbers measures open terrain and reports everything walkable.
//   * dist as a Float32Array silently kills Dijkstra: the popped f64 cost is
//     greater than the stored f32 cost for almost every node, the `d > dist[at]`
//     staleness guard fires on live nodes, and the search reports "unreachable"
//     for a point two yards from the door.
//
// Controls, all three required before any number here is believed:
//   POSITIVE — the middle of the desk slab must read BLOCKED.
//   NEGATIVE — the queue head, on the open customer floor, must be reachable.
//   SANITY   — free-cell fraction must be well under 1.0 (a grid that is 98%
//              free is a grid measuring the wrong place).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/staff-route');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 240000 });
  await page.waitForTimeout(4000);

  const measured = await page.evaluate(async () => {
    const base = document.baseURI;
    const L = await import(new URL('src/data/shopLayout.js', base).href);
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const origin = app.scene3d.clubhouse().interior.position;
    const W = (p) => ({ x: p.x + origin.x, z: p.z + origin.z });

    // NOT PUBLIC_ROOM_BOUNDS. The only way behind the desk today is out through
    // the service wing east of the partition (x > 5.70), which is outside the
    // public envelope — clipping the grid to the public room reports the till
    // "unreachable" when what is true is "reachable the long way round".
    const P = L.PUBLIC_ROOM_BOUNDS;
    const B = { minX: P.minX - 0.5, maxX: 9.6, minZ: P.minZ - 0.5, maxZ: P.maxZ + 0.5 };
    const STEP = 0.05;
    const r = walk.radius ?? 0.34;
    const nx = Math.round((B.maxX - B.minX) / STEP) + 1;
    const nz = Math.round((B.maxZ - B.minZ) / STEP) + 1;
    const idx = (i, j) => j * nx + i;
    // A CLOSED DOOR IS A COLLIDER. doors.js marks its leaf hulls `collider.door
    // = true` precisely because "nav grid ignores doors — they open for
    // walkers". A reachability probe that reads walk.isFree straight reports the
    // stockroom and the staff strip as sealed pockets when what is true is
    // "there is a door there". So the grid is built from walk.colliders with
    // door leaves excluded — and cross-checked against walk.isFree on every
    // non-door cell, which is this instrument's own control.
    const groups = Object.values(walk.colliders);
    const solid = [];
    let doorLeaves = 0;
    for (const list of groups) {
      for (const c of list) {
        if (c.door) { doorLeaves += 1; continue; }
        solid.push(c);
      }
    }
    const blockedAt = (wx, wz, rr) => {
      for (const c of solid) {
        if ('minX' in c) {
          if (wx + rr > c.minX && wx - rr < c.maxX && wz + rr > c.minZ && wz - rr < c.maxZ) return true;
        } else {
          const dx = wx - c.x; const dz = wz - c.z; const rad = (c.r || 0) + rr;
          if (dx * dx + dz * dz < rad * rad) return true;
        }
      }
      return false;
    };

    const free = new Uint8Array(nx * nz);
    let mismatches = 0;
    let checked = 0;
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const w = W({ x: B.minX + i * STEP, z: B.minZ + j * STEP });
        const mine = !blockedAt(w.x, w.z, r);
        free[idx(i, j)] = mine ? 1 : 0;
        if ((i + j) % 7 === 0) {
          checked += 1;
          // walk.isFree may additionally refuse a cell because of a door leaf or
          // water; it must never PERMIT one this probe calls solid.
          if (walk.isFree(w.x, w.z, r) && !mine) mismatches += 1;
        }
      }
    }
    let freeCells = 0;
    for (let k = 0; k < free.length; k += 1) freeCells += free[k];

    const snap = (p) => ({
      i: Math.round((p.x - B.minX) / STEP),
      j: Math.round((p.z - B.minZ) / STEP),
    });
    const nearestFree = (cell) => {
      if (cell.i >= 0 && cell.j >= 0 && cell.i < nx && cell.j < nz && free[idx(cell.i, cell.j)]) return cell;
      for (let ring = 1; ring < 60; ring += 1) {
        for (let di = -ring; di <= ring; di += 1) {
          for (let dj = -ring; dj <= ring; dj += 1) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
            const i = cell.i + di; const j = cell.j + dj;
            if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
            if (free[idx(i, j)]) return { i, j, nudged: +(ring * STEP).toFixed(2) };
          }
        }
      }
      return null;
    };

    const bfs = (from, to) => {
      const start = nearestFree(snap(from));
      const goal = nearestFree(snap(to));
      if (!start || !goal) return { ok: false, reason: 'no free cell near an endpoint' };
      const dist = new Float64Array(nx * nz).fill(Infinity);
      const prev = new Int32Array(nx * nz).fill(-1);
      const startIdx = idx(start.i, start.j);
      const goalIdx = idx(goal.i, goal.j);
      dist[startIdx] = 0;
      // Binary heap; re-sorting an array on every pop turned a 34k-cell search
      // into minutes of wall time.
      const heap = [[0, startIdx]];
      const push = (item) => {
        heap.push(item);
        let c = heap.length - 1;
        while (c > 0) {
          const p = (c - 1) >> 1;
          if (heap[p][0] <= heap[c][0]) break;
          [heap[p], heap[c]] = [heap[c], heap[p]];
          c = p;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let p = 0;
          for (;;) {
            const l = p * 2 + 1; const rr = l + 1;
            let s = p;
            if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
            if (rr < heap.length && heap[rr][0] < heap[s][0]) s = rr;
            if (s === p) break;
            [heap[p], heap[s]] = [heap[s], heap[p]];
            p = s;
          }
        }
        return top;
      };
      while (heap.length) {
        const [d, at] = pop();
        if (d > dist[at]) continue;
        if (at === goalIdx) break;
        const i = at % nx; const j = (at - i) / nx;
        for (let di = -1; di <= 1; di += 1) {
          for (let dj = -1; dj <= 1; dj += 1) {
            if (!di && !dj) continue;
            const ni = i + di; const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            const n = idx(ni, nj);
            if (!free[n]) continue;
            if (di && dj && (!free[idx(i + di, j)] || !free[idx(i, j + dj)])) continue;
            const cost = d + STEP * (di && dj ? Math.SQRT2 : 1);
            if (cost < dist[n]) { dist[n] = cost; prev[n] = at; push([cost, n]); }
          }
        }
      }
      if (!Number.isFinite(dist[goalIdx])) return { ok: false, reason: 'unreachable' };
      const pts = [];
      for (let at = goalIdx; at !== -1; at = prev[at]) {
        const i = at % nx; const j = (at - i) / nx;
        pts.push({ x: +(B.minX + i * STEP).toFixed(2), z: +(B.minZ + j * STEP).toFixed(2) });
      }
      pts.reverse();
      return {
        ok: true,
        yards: +dist[goalIdx].toFixed(2),
        straightLine: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(2),
        detour: +(dist[goalIdx] / Math.hypot(to.x - from.x, to.z - from.z)).toFixed(2),
        endpointNudge: { start: start.nudged || 0, goal: goal.nudged || 0 },
        waypoints: pts.filter((_, k) => k % 15 === 0 || k === pts.length - 1),
      };
    };

    // Connected-component labelling, so "unreachable" is followed by WHICH
    // pocket the till is in and how big it is rather than by a theory.
    const label = new Int32Array(nx * nz).fill(-1);
    const regions = [];
    for (let seed = 0; seed < free.length; seed += 1) {
      if (!free[seed] || label[seed] !== -1) continue;
      const id = regions.length;
      let count = 0;
      const bbox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      const stack = [seed];
      label[seed] = id;
      while (stack.length) {
        const at = stack.pop();
        count += 1;
        const i = at % nx; const j = (at - i) / nx;
        const x = B.minX + i * STEP; const z = B.minZ + j * STEP;
        if (x < bbox.minX) bbox.minX = x;
        if (x > bbox.maxX) bbox.maxX = x;
        if (z < bbox.minZ) bbox.minZ = z;
        if (z > bbox.maxZ) bbox.maxZ = z;
        for (let di = -1; di <= 1; di += 1) {
          for (let dj = -1; dj <= 1; dj += 1) {
            if (!di && !dj) continue;
            const ni = i + di; const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            const n = idx(ni, nj);
            if (!free[n] || label[n] !== -1) continue;
            if (di && dj && (!free[idx(i + di, j)] || !free[idx(i, j + dj)])) continue;
            label[n] = id;
            stack.push(n);
          }
        }
      }
      regions.push({
        id,
        cells: count,
        yd2: +(count * STEP * STEP).toFixed(2),
        bbox: {
          minX: +bbox.minX.toFixed(2), maxX: +bbox.maxX.toFixed(2),
          minZ: +bbox.minZ.toFixed(2), maxZ: +bbox.maxZ.toFixed(2),
        },
      });
    }
    const regionAt = (p) => {
      const cell = nearestFree(snap(p));
      return cell ? label[idx(cell.i, cell.j)] : null;
    };

    const door = { x: L.DOOR_MAIN.x, z: B.maxZ - 0.55 };
    const staff = L.COUNTER.staffStand;
    const queueHead = L.queueSlot(0);
    const deskMiddle = { x: L.FRONT_DESK_FRAME.x, z: L.FRONT_DESK_FRAME.z };

    return {
      radius: r,
      interiorOrigin: { x: +origin.x.toFixed(3), z: +origin.z.toFixed(3) },
      grid: { nx, nz, step: STEP, freeCells, freeFraction: +(freeCells / free.length).toFixed(3) },
      controls: {
        positive_deskMiddleBlocked: blockedAt(W(deskMiddle).x, W(deskMiddle).z, r),
        negative_queueHeadReachable: bfs(door, queueHead).ok,
        doorLeavesExcluded: doorLeaves,
        gridDisagreesWithIsFree: mismatches,
        gridCellsCrossChecked: checked,
      },
      door,
      staffStand: staff,
      pockets: {
        doorRegion: regionAt(door),
        staffStandRegion: regionAt(staff),
        queueHeadRegion: regionAt(queueHead),
        // every region big enough to stand in, largest first
        list: regions.filter((rg) => rg.cells > 30).sort((a, b) => b.cells - a.cells).slice(0, 10),
      },
      toStaffStand: bfs(door, staff),
      toQueueHead: bfs(door, queueHead),
      deskColliders: L.FRONT_DESK_COLLIDERS,
      westEndProbe: [3.90, 4.20, 4.50, 4.80, 5.10]
        .map((z) => ({ z, freeAtX1p45: walk.isFree(W({ x: 1.45, z }).x, W({ x: 1.45, z }).z, r) })),
    };
  });

  fs.writeFileSync(path.join(OUT, 'route.json'), `${JSON.stringify(measured, null, 2)}\n`);
  return measured;
}
