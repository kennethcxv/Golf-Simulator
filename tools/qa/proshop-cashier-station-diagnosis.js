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
    const bounds = L.PUBLIC_ROOM_BOUNDS;
    const step = 0.15;

    const free = (lx, lz) => walk.isFree(lx + o.x, lz + o.z, radius);
    const cols = Math.round((bounds.maxX - bounds.minX) / step) + 1;
    const rows = Math.round((bounds.maxZ - bounds.minZ) / step) + 1;
    const at = (r, c) => ({ x: bounds.minX + c * step, z: bounds.minZ + r * step });
    const grid = [];
    for (let r = 0; r < rows; r += 1) {
      const row = [];
      for (let c = 0; c < cols; c += 1) { const p = at(r, c); row.push(free(p.x, p.z) ? 1 : 0); }
      grid.push(row);
    }

    // Flood from the middle of the public floor.
    const start = { x: L.DOOR_MAIN.x, z: bounds.maxZ - 2.0 };
    const sc = Math.round((start.x - bounds.minX) / step);
    const sr = Math.round((start.z - bounds.minZ) / step);
    const seen = grid.map((row) => row.map(() => false));
    const queue = [];
    if (grid[sr]?.[sc]) { queue.push([sr, sc]); seen[sr][sc] = true; }
    while (queue.length) {
      const [r, c] = queue.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        if (seen[nr][nc] || !grid[nr][nc]) continue;
        seen[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }

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
    return {
      startedFrom: { x: +start.x.toFixed(2), z: +start.z.toFixed(2) },
      staffChairLocal: { x: +staff.x.toFixed(2), z: +staff.z.toFixed(2) },
      staffCellIsFreeFloor: !!grid[staffCell.r]?.[staffCell.c],
      staffCellIsReachable: !!seen[staffCell.r]?.[staffCell.c],
      nearestReachablePointToStaffChair: nearestReachableTo(staff.x, staff.z),
      reachableCells: seen.flat().filter(Boolean).length,
      freeCells: grid.flat().filter(Boolean).length,
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
            line += isStaff ? 'S' : (grid[r][c] ? (seen[r][c] ? '.' : 'o') : '#');
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
  out.reachable = reach.staffCellIsReachable;
  out.notDark = out.staffVsPublicRatio > 0.35;
  out.ok = out.reachable && out.notDark;
  fs.writeFileSync(path.join(outDir, `cashier-station-${VARIANT}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
