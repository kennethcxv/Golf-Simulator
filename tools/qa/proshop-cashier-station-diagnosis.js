async (page) => {
  // BLOCKER 5 — the cashier station. Two complaints, measured separately:
  //
  //   "the staff side renders black"
  //   "the only way in is standing backward on the wrong side and phasing through"
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-cashier-station-diagnosis.js
  //
  // REACHABILITY is a flood fill from the middle of the public floor across
  // walkable cells only. If the staff chair is not in the flood, there is no
  // legitimate route to it and the only way in is through something.
  //
  // DARKNESS is measured at the staff pose and against a public-side pose in
  // the same frame conditions, because "black" needs a number next to a
  // comparison or it is an impression.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const zlib = process.getBuiltinModule('node:zlib');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'cashier-station');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const VARIANT = process.env.CLUBHOUSE_VARIANT || 'pine-hills-v2';

  function decodePng(buffer) {
    let pos = 8;
    let width = 0; let height = 0; let colorType = 0;
    const idat = [];
    while (pos < buffer.length) {
      const len = buffer.readUInt32BE(pos);
      const type = buffer.toString('ascii', pos + 4, pos + 8);
      const data = buffer.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    const paeth = (a, b, c) => {
      const pp = a + b - c;
      const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const rowIn = (y * (stride + 1)) + 1;
      const rowOut = y * stride;
      for (let x = 0; x < stride; x++) {
        const rb = raw[rowIn + x];
        const left = x >= bpp ? out[rowOut + x - bpp] : 0;
        const up = y > 0 ? out[rowOut - stride + x] : 0;
        const ul = y > 0 && x >= bpp ? out[rowOut - stride + x - bpp] : 0;
        let v;
        switch (filter) {
          case 0: v = rb; break;
          case 1: v = rb + left; break;
          case 2: v = rb + up; break;
          case 3: v = rb + ((left + up) >> 1); break;
          case 4: v = rb + paeth(left, up, ul); break;
          default: throw new Error(`bad filter ${filter}`);
        }
        out[rowOut + x] = v & 0xff;
      }
    }
    return { width, height, bpp, data: out };
  }
  const meanLuma = (img) => {
    let sum = 0;
    let n = 0;
    let dark = 0;
    for (let i = 0; i < img.data.length; i += img.bpp) {
      const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      sum += l; n += 1; if (l < 8) dark += 1;
    }
    return { mean: +(sum / n).toFixed(2), nearBlackPct: +((dark / n) * 100).toFixed(1) };
  };

  const query = VARIANT === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    app.state.clock.minutes = 10 * 60;
    app.scene3d.clubhouse().setTimeMood?.(10 * 60);
    app.scene3d.clubhouse().setOrganicWalkins?.(false);
    document.querySelectorAll('.hud, .notification-center, .walk-overlay').forEach((n) => { n.style.display = 'none'; });
  });

  const reach = await page.evaluate(async () => {
    const L = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.center;
    const walk = app.scene3d.walk;
    const radius = walk.state.radius || 0.32;
    // THE WHOLE BUILDING, not PUBLIC_ROOM_BOUNDS.
    //
    // The first version of this probe flooded only the public room, whose east
    // edge is x 5.70 — and the staff corridor's one intended entrance is the
    // partition mouth at x 5.60–5.80, z 3.86–4.89, which leads EAST into the
    // office. So the route the floor plan actually specifies (FLOOR_PLAN §7,
    // "the staff mouth stays open") lay outside the grid, and the probe reported
    // the corridor sealed because it had walled off the doorway itself.
    //
    // That "1479 of 1530 free cells, staff pocket unreachable" number is an
    // artifact of the grid, not a measurement of the room. Anything derived from
    // it — including TILL-REACH-001's premise — has to be re-measured here.
    // …plus a margin OUTSIDE it. Third grid fault, same class as the first two:
    // bounded at the interior, the flood cannot represent "go out the front and
    // round the back", so it could not tell an inconvenient route from no route.
    const MARGIN = 6.0;
    const bounds = {
      minX: -L.INTERIOR.w / 2 - MARGIN, maxX: L.INTERIOR.w / 2 + MARGIN,
      minZ: -L.INTERIOR.d / 2 - MARGIN, maxZ: L.INTERIOR.d / 2 + MARGIN,
    };
    const step = 0.15;

    // A CLOSED DOOR IS NOT A WALL. walk.isFree() is the right question for "can I
    // stand here this instant" and the wrong one for "is there a route": every
    // interior door collides while shut, so a flood over isFree() reports the
    // office, the stockroom and the staff corridor as sealed rooms. The first
    // run of this probe did exactly that and the conclusion went into DEFECTS.md.
    //
    // So the audit runs twice. `grid` is walkable-now; `gridDoors` additionally
    // treats a cell as passable when the ONLY things blocking it are door
    // colliders — the route a player has, given that E opens doors. The second
    // is the one that answers "is this pocket reachable"; the first is kept
    // because a pocket only reachable through a door is still worth naming.
    const doorRects = [];
    const solidRects = [];
    for (const key of ['structures', 'props']) {
      for (const c of walk.colliders?.[key] || []) {
        if (!Number.isFinite(c?.minX)) continue;
        (c.door === true ? doorRects : solidRects).push(c);
      }
    }
    const overlaps = (rect, x, z) => x + radius > rect.minX && x - radius < rect.maxX
      && z + radius > rect.minZ && z - radius < rect.maxZ;
    const free = (lx, lz) => walk.isFree(lx + o.x, lz + o.z, radius);
    // Blocked, but by nothing except a door leaf.
    const doorOnly = (lx, lz) => {
      const x = lx + o.x;
      const z = lz + o.z;
      if (!doorRects.some((d) => overlaps(d, x, z))) return false;
      return !solidRects.some((s) => overlaps(s, x, z));
    };
    const cols = Math.round((bounds.maxX - bounds.minX) / step) + 1;
    const rows = Math.round((bounds.maxZ - bounds.minZ) / step) + 1;
    const at = (r, c) => ({ x: bounds.minX + c * step, z: bounds.minZ + r * step });
    const grid = [];
    const gridDoors = [];
    for (let r = 0; r < rows; r += 1) {
      const row = [];
      const rowD = [];
      for (let c = 0; c < cols; c += 1) {
        const p = at(r, c);
        const now = free(p.x, p.z);
        row.push(now ? 1 : 0);
        rowD.push(now || doorOnly(p.x, p.z) ? 1 : 0);
      }
      grid.push(row);
      gridDoors.push(rowD);
    }

    // Flood from the middle of the public floor.
    const start = { x: L.DOOR_MAIN.x, z: L.PUBLIC_ROOM_BOUNDS.maxZ - 2.0 };
    const sc = Math.round((start.x - bounds.minX) / step);
    const sr = Math.round((start.z - bounds.minZ) / step);
    const floodFrom = (g) => {
      const mark = g.map((row) => row.map(() => false));
      const queue = [];
      if (g[sr]?.[sc]) { queue.push([sr, sc]); mark[sr][sc] = true; }
      while (queue.length) {
        const [r, c] = queue.pop();
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (mark[nr][nc] || !g[nr][nc]) continue;
          mark[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
      return mark;
    };
    const seenNow = floodFrom(grid);
    // `seen` is the one everything downstream reads: reachable given that the
    // player can open the doors between here and there.
    const seen = floodFrom(gridDoors);

    // EVERY POCKET, not just the one that was reported. A single-point check
    // answers "is the staff chair reachable" and nothing else — it would have
    // stayed green through a floor plan that sealed some other corner. So the
    // free cells that the flood did NOT reach are grouped into connected
    // components and each is reported with its area and bounds. Zero components
    // above a stray-cell threshold is the actual contract: a walkable pocket
    // with no route to it is a floor-plan error wherever it is.
    const unreachablePockets = (() => {
      const claimed = grid.map((row) => row.map(() => false));
      const found = [];
      const cellArea = step * step;
      for (let r0 = 0; r0 < rows; r0 += 1) {
        for (let c0 = 0; c0 < cols; c0 += 1) {
          if (!gridDoors[r0][c0] || seen[r0][c0] || claimed[r0][c0]) continue;
          const stack = [[r0, c0]];
          claimed[r0][c0] = true;
          const cells = [];
          while (stack.length) {
            const [r, c] = stack.pop();
            cells.push([r, c]);
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
              if (claimed[nr][nc] || !gridDoors[nr][nc] || seen[nr][nc]) continue;
              claimed[nr][nc] = true;
              stack.push([nr, nc]);
            }
          }
          const pts = cells.map(([r, c]) => at(r, c));
          found.push({
            cells: cells.length,
            areaYd2: +(cells.length * cellArea).toFixed(2),
            minX: +Math.min(...pts.map((p) => p.x)).toFixed(2),
            maxX: +Math.max(...pts.map((p) => p.x)).toFixed(2),
            minZ: +Math.min(...pts.map((p) => p.z)).toFixed(2),
            maxZ: +Math.max(...pts.map((p) => p.z)).toFixed(2),
          });
        }
      }
      return found.sort((a, b) => b.areaYd2 - a.areaYd2);
    })();

    const staff = L.FRONT_DESK.staffChair;
    const nearestReachableTo = (tx, tz) => {
      let best = null;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (!seen[r][c]) continue;
          const p = at(r, c);
          const d = Math.hypot(p.x - tx, p.z - tz);
          if (!best || d < best.d) best = { d: +d.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
        }
      }
      return best;
    };

    const staffCell = {
      r: Math.round((staff.z - bounds.minZ) / step),
      c: Math.round((staff.x - bounds.minX) / step),
    };
    // Where a cashier actually stands to work the till, which is NOT the chair —
    // the chair is the laptop seat. The original probe targeted the chair and so
    // measured a cell that is legitimately solid.
    const stand = L.COUNTER.staffStand;
    const standCell = {
      r: Math.round((stand.z - bounds.minZ) / step),
      c: Math.round((stand.x - bounds.minX) / step),
    };
    return {
      startedFrom: { x: +start.x.toFixed(2), z: +start.z.toFixed(2) },
      staffChairLocal: { x: +staff.x.toFixed(2), z: +staff.z.toFixed(2) },
      staffStandLocal: { x: +stand.x.toFixed(2), z: +stand.z.toFixed(2) },
      staffStandIsFreeFloor: !!grid[standCell.r]?.[standCell.c],
      staffStandIsReachable: !!seen[standCell.r]?.[standCell.c],
      unreachablePockets,
      staffCellIsFreeFloor: !!grid[staffCell.r]?.[staffCell.c],
      staffCellIsReachable: !!seen[staffCell.r]?.[staffCell.c],
      nearestReachablePointToStaffChair: nearestReachableTo(staff.x, staff.z),
      reachableCells: seen.flat().filter(Boolean).length,
      reachableCellsDoorsShut: seenNow.flat().filter(Boolean).length,
      freeCells: grid.flat().filter(Boolean).length,
      freeCellsWithDoorsOpen: gridDoors.flat().filter(Boolean).length,
      // The desk's neighbourhood as a picture: '.' walkable and reachable,
      // 'o' walkable but cut off, '#' solid, 'S' the staff chair.
      map: (() => {
        const lines = [];
        const r0 = Math.max(0, Math.round((staff.z - 3.2 - bounds.minZ) / step));
        const r1 = Math.min(rows - 1, Math.round((staff.z + 2.0 - bounds.minZ) / step));
        const c0 = Math.max(0, Math.round((staff.x - 4.0 - bounds.minX) / step));
        const c1 = Math.min(cols - 1, Math.round((staff.x + 4.0 - bounds.minX) / step));
        for (let r = r0; r <= r1; r += 1) {
          let line = '';
          for (let c = c0; c <= c1; c += 1) {
            const isStaff = r === Math.round((staff.z - bounds.minZ) / step)
              && c === Math.round((staff.x - bounds.minX) / step);
            line += isStaff ? 'S' : (gridDoors[r][c] ? (seen[r][c] ? '.' : 'o') : '#');
          }
          lines.push(`z=${at(r, c0).z.toFixed(2).padStart(6)} ${line}`);
        }
        lines.push(`        x from ${at(r0, c0).x.toFixed(2)} to ${at(r0, c1).x.toFixed(2)} step ${step}`);
        return lines;
      })(),
    };
  });

  const shoot = async (name, pose) => {
    await page.evaluate((p) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().center;
      const w = app.scene3d.walk.state;
      w.x = p.x + o.x; w.z = p.z + o.z; w.yaw = p.yaw; w.pitch = p.pitch;
    }, pose);
    await page.waitForTimeout(700);
    const buf = await page.screenshot({ path: path.join(shotDir, `${VARIANT}-${name}.png`) });
    return { pose, ...meanLuma(decodePng(buf)) };
  };

  // Standing where a cashier stands, looking at the till; and the customer's
  // side of the same counter, as the control.
  const staff = reach.staffChairLocal;
  const luma = {
    staffSide: await shoot('staff-side', { x: staff.x, z: staff.z, yaw: 0, pitch: -0.08 }),
    publicSide: await shoot('public-side', { x: staff.x, z: staff.z - 2.4, yaw: Math.PI, pitch: -0.08 }),
  };

  const out = {
    variant: VARIANT,
    reach,
    luma,
    // "Renders black" as a number: the staff view against the customer view of
    // the same counter under the same conditions.
    staffVsPublicRatio: +(luma.staffSide.mean / Math.max(0.01, luma.publicSide.mean)).toFixed(2),
    shots: shotDir,
  };
  // Two independent claims, reported separately so a fix to one cannot be read
  // as a fix to both. See DEFECTS.md TILL-REACH-001.
  //
  // The reachability claim is now the general one: no walkable pocket anywhere in
  // the public room may be cut off, not merely the one that got reported. A stray
  // cell or two behind a fixture corner is grid noise rather than a pocket, so the
  // threshold is 0.25 yd² — a quarter of the player's own footprint.
  const POCKET_MIN_YD2 = 0.25;
  // One region is unreachable on purpose and says so in the layout: v2 pulled the
  // west wall in to x −2.60 and left "sealed dead cavity until the exterior shell
  // is re-authored (Phase 4+)" behind it. Declared by name and reason rather than
  // filtered by size, so it appears in the output as an allowance instead of
  // vanishing — a threshold quietly tuned until the red goes away is how an
  // instrument stops measuring.
  const ALLOWED = [{
    name: 'v2 dead cavity west of the pulled-in west wall',
    why: 'PINE_HILLS_V2_LAYOUT.publicBounds — sealed until the shell is re-authored',
    minX: -9.0, maxX: -2.60, minZ: -6.0, maxZ: 6.0,
  }];
  const allowedFor = (p) => ALLOWED.find((a) => p.minX >= a.minX && p.maxX <= a.maxX
    && p.minZ >= a.minZ && p.maxZ <= a.maxZ) || null;
  out.allowedPockets = reach.unreachablePockets
    .filter((p) => p.areaYd2 >= POCKET_MIN_YD2 && allowedFor(p))
    .map((p) => ({ ...p, allowedAs: allowedFor(p).name, why: allowedFor(p).why }));
  out.sealedPockets = reach.unreachablePockets
    .filter((p) => p.areaYd2 >= POCKET_MIN_YD2 && !allowedFor(p));
  out.reachable = out.sealedPockets.length === 0 && reach.staffStandIsReachable;
  out.notDark = out.staffVsPublicRatio > 0.35;
  out.ok = out.reachable && out.notDark;
  fs.writeFileSync(path.join(outDir, `cashier-station-${VARIANT}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
