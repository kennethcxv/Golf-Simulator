async (page) => {
  // WALK FINDING 2 â€” the doorway is blocked, for the third time.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-door-clearway-audit.js
  //
  // DOOR_CLEARWAY exists precisely so nothing solid sits in front of the
  // entrance, and three separate systems already refuse to place things there
  // (layout.js, propertyPlacement.js, boxPlacement.js). Something is arriving
  // by a route none of those three police. This finds it by name rather than by
  // eye: every collider overlapping the rect, matched against the nearest named
  // scene object, plus a walkability sweep that answers the only question the
  // player cares about â€” can you get through the door.
  //
  // Runs both variants. The rect is not variant-conditional, so a difference
  // between the two rooms is itself a finding.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const shotDir = path.join(outDir, 'door-clearway');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
  };

  const audit = () => page.evaluate(async () => {
    const L = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    // The building-local origin, from the clubhouse itself. An earlier revision
    // of this probe used ch.interior.position and reported every collider a
    // couple of tenths out of place â€” enough to pin the blame on the wrong prop
    // twice. interior is a scene-graph node with its own offset; `center` is
    // what L2W/colBoxAt actually use.
    const origin = ch.center;
    const R = L.DOOR_CLEARWAY;
    // Interior-local rect â†’ world, which is the space colliders live in.
    const world = {
      minX: R.minX + origin.x,
      maxX: R.maxX + origin.x,
      minZ: R.minZ + origin.z,
      maxZ: R.maxZ + origin.z,
    };

    // Name the culprit: the nearest named object whose world position sits near
    // the collider. A collider with no name is still reported â€” unnamed is a
    // finding too, not an excuse to skip it.
    const named = [];
    app.scene3d.scene.traverse((o) => {
      if (!o.name || !o.visible) return;
      const p = new (Object.getPrototypeOf(o.position).constructor)();
      o.getWorldPosition(p);
      named.push({ name: o.name, type: o.type, x: p.x, y: p.y, z: p.z });
    });
    // Everything close, not just the closest. The nearest-name heuristic named a
    // socket node inside an umbrella stand and a restoration-target group as the
    // culprits, when the collider actually belonged to a clutter pile sitting
    // between them â€” a pile registers a collider but its group carries no name.
    // A list lets the reader see the ambiguity instead of inheriting a guess.
    const nearbyNames = (x, z, radius = 1.2) => named
      .map((n) => ({ name: n.name, type: n.type, dist: +Math.hypot(n.x - x, n.z - z).toFixed(2) }))
      .filter((n) => n.dist <= radius)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6);

    const overlapsRect = (c) => c.maxX > world.minX && c.minX < world.maxX
      && c.maxZ > world.minZ && c.minZ < world.maxZ;
    const overlapsCircle = (c) => {
      const cx = Math.max(world.minX, Math.min(c.x, world.maxX));
      const cz = Math.max(world.minZ, Math.min(c.z, world.maxZ));
      return Math.hypot(c.x - cx, c.z - cz) < c.r;
    };

    const cols = app.scene3d.walk.colliders;
    const hits = [];
    const scan = (list, kind) => {
      for (const c of list || []) {
        const isRect = c.minX !== undefined;
        if (isRect ? !overlapsRect(c) : !overlapsCircle(c)) continue;
        const cx = isRect ? (c.minX + c.maxX) / 2 : c.x;
        const cz = isRect ? (c.minZ + c.maxZ) / 2 : c.z;
        // The clearway necessarily touches the wall the door is set into, and
        // the door leaves themselves swing through it â€” updateDoorCollider
        // re-fits their rect every frame, so a closed leaf is not an obstruction,
        // it is a door. Both are the BUILDING. Anything else in here was put
        // there, and that is what this audit is looking for.
        const structural = c.shellWall === true || c.door === true;
        hits.push({
          kind,
          structural,
          shape: isRect ? 'rect' : 'circle',
          local: { x: +(cx - origin.x).toFixed(2), z: +(cz - origin.z).toFixed(2) },
          size: isRect
            ? { w: +(c.maxX - c.minX).toFixed(2), d: +(c.maxZ - c.minZ).toFixed(2) }
            : { r: +c.r.toFixed(2) },
          nearby: nearbyNames(cx, cz),
        });
      }
    };
    scan(cols.props, 'prop');
    scan(cols.structures, 'structure');
    scan(cols.trees, 'tree');

    // The player-facing measure. A doorway is clear when a body-width walker can
    // get from outside the threshold to inside the room along it.
    // Computed against the collider lists rather than walk.isFree, for one
    // reason: the door LEAVES must be excluded. updateDoorCollider re-fits their
    // rect from the swing angle every frame, so sampling with the doors shut
    // measures a closed door, not a blocked clearway â€” the first run of this
    // probe reported "crossable: false" in both rooms on exactly that basis, and
    // it meant nothing. Everything else, including the wall, still counts.
    const radius = app.scene3d.walk.state.radius || 0.32;
    const step = 0.15;
    const solids = [...(cols.props || []), ...(cols.structures || []), ...(cols.trees || [])]
      .filter((c) => c.door !== true);
    const blocked = (wx, wz) => solids.some((c) => (c.minX !== undefined
      ? wx + radius > c.minX && wx - radius < c.maxX && wz + radius > c.minZ && wz - radius < c.maxZ
      : Math.hypot(wx - c.x, wz - c.z) < c.r + radius));
    const grid = [];
    for (let z = R.minZ; z <= R.maxZ + 1e-6; z += step) {
      const row = [];
      for (let x = R.minX; x <= R.maxX + 1e-6; x += step) {
        row.push(blocked(x + origin.x, z + origin.z) ? 0 : 1);
      }
      grid.push({ z: +z.toFixed(2), row });
    }
    const cells = grid.flatMap((g) => g.row);
    // Can a walker cross the clearway north-to-south at any x? Flood from the
    // outermost row inward through free cells only (4-connected).
    const H = grid.length;
    const W = grid[0].row.length;
    const seen = Array.from({ length: H }, () => new Array(W).fill(false));
    const queue = [];
    for (let x = 0; x < W; x += 1) {
      if (grid[H - 1].row[x]) { queue.push([H - 1, x]); seen[H - 1][x] = true; }
    }
    while (queue.length) {
      const [r, c] = queue.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= H || nc >= W || seen[nr][nc] || !grid[nr].row[nc]) continue;
        seen[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
    const crossable = seen[0].some((v, i) => v && grid[0].row[i]);
    // The widest continuous free run on the row just inside the threshold â€”
    // this is the gap the player's shoulders actually have to fit through.
    const insideRow = grid[0].row;
    let widest = 0;
    let run = 0;
    for (const v of insideRow) { run = v ? run + 1 : 0; if (run > widest) widest = run; }

    return {
      clearway: R,
      clutterSpots: L.CLUTTER_SPOTS.map((c) => ({ x: c.x, z: c.z })),
      origin: { x: +origin.x.toFixed(2), z: +origin.z.toFixed(2) },
      blockingColliders: hits,
      walkable: {
        freeCells: cells.filter(Boolean).length,
        totalCells: cells.length,
        crossable,
        widestGapYd: +(widest * step).toFixed(2),
        needYd: +(radius * 2).toFixed(2),
      },
      grid: grid.map((g) => `${String(g.z).padStart(6)} ${g.row.map((v) => (v ? '.' : '#')).join('')}`),
    };
  });

  // The entrance does not auto-open for an empty-handed player (updateDoors
  // opens for customers, and for a player carrying a delivery load) â€” the player
  // presses E. So the walkability sweep runs against a door opened the way a
  // player opens it, not one forced open through a back channel. A closed leaf
  // is not an obstruction; it is a door.

  const out = { variants: {} };
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    // eslint-disable-next-line no-await-in-loop
    await boot(variant);
    // eslint-disable-next-line no-await-in-loop
    const origin = await page.evaluate(() => window.__fw.scene3d.clubhouse().center);
    // eslint-disable-next-line no-await-in-loop
    const result = await audit();
    // A look at the threshold from outside, so the report carries the picture too.
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((o) => {
      const app = window.__fw;
      const w = app.scene3d.walk.state;
      w.x = -0.8 + o.x; w.z = 6.6 + o.z; w.yaw = Math.PI; w.pitch = -0.05;
    }, result.origin);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: path.join(shotDir, `${variant}-threshold.png`) });
    out.variants[variant] = result;
  }

  for (const v of Object.values(out.variants)) {
    v.intruders = v.blockingColliders.filter((h) => !h.structural);
  }
  out.intruderCount = Object.values(out.variants).reduce((n, v) => n + v.intruders.length, 0);
  out.ok = Object.values(out.variants).every((v) => v.intruders.length === 0
    && v.walkable.crossable
    && v.walkable.widestGapYd >= v.walkable.needYd);
  fs.writeFileSync(path.join(outDir, 'door-clearway-audit.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
