// R1/R2/R3/R5 — MEASURE the open ledger, then look at it.
//
//   R1 covers vs page block. The open book now joins into two NAMED bodies
//      (LB_OpenCovers, LB_OpenPages) precisely so this is measurable: their
//      world AABBs must not overlap in the up axis over any shared span.
//   R2 the WHOLE book — boards, caps, spine, not just the paper — projected
//      to screen. Every one of the four margins must be a real margin.
//   R3 the foot band, read off the LIVE page canvases: no content ink may
//      appear above the controls in the strip they own. Tested on a FULL page
//      (long money, many rows) and an EMPTY one.
//   R5 locked sections read as ruled blanks, and a section unlocks on its own.
//
// Negative controls: the frame probe is re-run on a deliberately oversized
// book and must report it out of frame; the foot-band probe is re-run with a
// deliberate overlap painted in and must report that too.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-frame');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(200);

  const standAtLedger = () => page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    app.scene3d.applyTimeWeather(600, app.state.weather);
    club.setOrganicWalkins(false);
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const book = club.ledgerBook.position();
    const dx = (book.x + off.x) - walk.x;
    const dz = (book.z + off.z) - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2((book.y + off.y) - app.scene3d.camera.position.y, h);
  });
  await standAtLedger();
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    const app = window.__fw;
    const V = app.scene3d.camera.position.constructor;
    const bookRoot = () => app.scene3d.clubhouse().interior.getObjectByName('FrontDeskLedgerBook');
    const visibleMeshes = (node) => {
      const out = [];
      node.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        for (let p = o; p; p = p.parent) if (p.visible === false) return;
        out.push(o);
      });
      return out;
    };
    const worldBox = (meshes) => {
      let min = null; let max = null;
      for (const o of meshes) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) {
          for (const y of [bb.min.y, bb.max.y]) {
            for (const z of [bb.min.z, bb.max.z]) {
              const v = new V(x, y, z);
              o.localToWorld(v);
              if (!min) { min = v.clone(); max = v.clone(); } else { min.min(v); max.max(v); }
            }
          }
        }
      }
      return min ? { min: min.toArray(), max: max.toArray() } : null;
    };

    // --- R2: the WHOLE book projected to screen -----------------------------
    window.__frameProbe = (mode) => {
      const root = bookRoot();
      const camera = app.scene3d.camera;
      if (!root) return { error: 'no book root' };
      root.updateWorldMatrix(true, true);
      camera.updateMatrixWorld(true);
      const W = window.innerWidth; const H = window.innerHeight;
      let meshes = visibleMeshes(root);
      if (mode === 'pages') {
        meshes = meshes.filter((o) => {
          const image = o.material?.map?.image;
          return image && image.width === 768 && image.height === 512;
        });
      }
      if (!meshes.length) return { error: 'no meshes' };
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (const o of meshes) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) {
          for (const y of [bb.min.y, bb.max.y]) {
            for (const z of [bb.min.z, bb.max.z]) {
              const v = new V(x, y, z);
              o.localToWorld(v); v.project(camera);
              const sx = (v.x * 0.5 + 0.5) * W;
              const sy = (-v.y * 0.5 + 0.5) * H;
              minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
              minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
            }
          }
        }
      }
      return {
        mode: mode || 'whole',
        meshCount: meshes.length,
        viewport: { W, H },
        margins: {
          left: Math.round(minX),
          right: Math.round(W - maxX),
          top: Math.round(minY),
          bottom: Math.round(H - maxY),
        },
        widthFrac: +((maxX - minX) / W).toFixed(3),
        heightFrac: +((maxY - minY) / H).toFixed(3),
      };
    };

    // --- R1: covers vs page block, by name ----------------------------------
    window.__clipProbe = () => {
      const root = bookRoot();
      if (!root) return { error: 'no book root' };
      root.updateWorldMatrix(true, true);
      const covers = root.getObjectByName('LB_OpenCovers');
      const pages = root.getObjectByName('LB_OpenPages');
      const caps = root.getObjectByName('LB_OpenCaps');
      if (!covers || !pages) {
        return { error: 'split bodies missing', hasCovers: !!covers, hasPages: !!pages };
      }
      // The book is TILTED to face the reader, so world +Y is not the book's
      // up. Measure in the BOOK's own frame or the answer is meaningless — the
      // first cut of this probe reported -211 mm on a book with 1.3 mm of real
      // clearance, purely from using the wrong axis.
      const toLocal = (mesh, v) => { mesh.localToWorld(v); root.worldToLocal(v); return v; };
      const localBox = (meshes) => {
        let min = null; let max = null;
        for (const o of meshes) {
          o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          for (const x of [bb.min.x, bb.max.x]) {
            for (const y of [bb.min.y, bb.max.y]) {
              for (const z of [bb.min.z, bb.max.z]) {
                const v = toLocal(o, new V(x, y, z));
                if (!min) { min = v.clone(); max = v.clone(); } else { min.min(v); max.max(v); }
              }
            }
          }
        }
        return min ? { min: min.toArray(), max: max.toArray() } : null;
      };
      const cb = localBox(visibleMeshes(covers));
      const pb = localBox(visibleMeshes(pages));
      if (!cb || !pb) return { error: 'empty box', cb, pb };
      // TWO EARLIER PROBES GAVE WRONG ANSWERS HERE, so this one is built to
      // be unarguable.
      //   1. A column sample walked x in slices and compared the highest cover
      //      vertex to the lowest page vertex in each. The boards are boxes:
      //      12 of 14 slices held no cover vertex, and it reported -2.22 mm on
      //      geometry the builder proves has 1.30.
      //   2. A least-squares plane fit measured residuals VERTICALLY on a body
      //      whose merged node carries a 4.5 degree rotation, and read the
      //      board as 4.96 mm half-thick instead of 3.5.
      //
      // The question is simply whether any page vertex is inside a cover
      // board. Each board is a convex slab, so recover its oriented box by
      // PCA over its own vertices and test containment directly. Penetration
      // is then a real distance, in the board's own axes, with no assumption
      // about which way is up.
      const meshVerts = (meshes) => {
        const out = [];
        for (const o of meshes) {
          const position = o.geometry.attributes.position;
          for (let i = 0; i < position.count; i += 1) {
            out.push(toLocal(o, new V(position.getX(i), position.getY(i), position.getZ(i))));
          }
        }
        return out;
      };
      const coverPts = meshVerts(visibleMeshes(covers));
      const pagePts = meshVerts(visibleMeshes(pages));
      if (!coverPts.length || !pagePts.length) return { error: 'no vertices' };
      const gutterX = (Math.min(...pagePts.map((v) => v.x)) + Math.max(...pagePts.map((v) => v.x))) / 2;

      const obbOf = (pts) => {
        const n = pts.length;
        const mean = pts.reduce((acc, v) => acc.add(v), new V(0, 0, 0)).multiplyScalar(1 / n);
        // covariance
        const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const v of pts) {
          const d = [v.x - mean.x, v.y - mean.y, v.z - mean.z];
          for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) C[i][j] += d[i] * d[j];
        }
        for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) C[i][j] /= n;
        // three principal axes by power iteration + deflation
        const mul = (M, v) => [
          M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
          M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
          M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
        ];
        const norm = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };
        const axes = [];
        const M = C.map((row) => row.slice());
        for (let k = 0; k < 3; k += 1) {
          let v = norm([1 + k * 0.37, 0.31 - k * 0.11, 0.17 + k * 0.23]);
          let lambda = 0;
          for (let it = 0; it < 220; it += 1) {
            const w = mul(M, v);
            const L = Math.hypot(w[0], w[1], w[2]);
            if (L < 1e-14) break;
            v = [w[0] / L, w[1] / L, w[2] / L];
            lambda = L;
          }
          axes.push(v);
          for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) M[i][j] -= lambda * v[i] * v[j];
        }
        const half = [0, 0, 0];
        for (const v of pts) {
          const d = [v.x - mean.x, v.y - mean.y, v.z - mean.z];
          for (let k = 0; k < 3; k += 1) {
            half[k] = Math.max(half[k], Math.abs(d[0] * axes[k][0] + d[1] * axes[k][1] + d[2] * axes[k][2]));
          }
        }
        return { mean, axes, half };
      };

      // every convex solid the pages could be inside: the two boards, and the
      // spine bump that fills the V's trough under the gutter
      const spineNode = root.getObjectByName('LB_OpenSpine');
      const spinePts = spineNode ? meshVerts(visibleMeshes(spineNode)) : [];
      const solids = [
        { name: 'boardR', pts: coverPts.filter((v) => v.x >= gutterX) },
        { name: 'boardL', pts: coverPts.filter((v) => v.x <= gutterX) },
      ];
      if (spinePts.length >= 8) solids.push({ name: 'spine', pts: spinePts });

      const boards = [];
      for (const solid of solids) {
        const sign = solid.name === 'boardL' ? -1 : 1;
        const bp = solid.pts;
        const pp = solid.name === 'spine'
          ? pagePts
          : pagePts.filter((v) => (sign > 0 ? v.x >= gutterX : v.x <= gutterX));
        if (bp.length < 8 || !pp.length) { boards.push({ solid: solid.name, error: 'too few points' }); continue; }
        const obb = obbOf(bp);
        // penetration depth for a point inside a box = the smallest distance
        // to any face; outside, the largest overshoot. Negative = clear.
        let worst = -Infinity; let inside = 0; let worstAt = null;
        for (const v of pp) {
          const d = [v.x - obb.mean.x, v.y - obb.mean.y, v.z - obb.mean.z];
          const over = obb.axes.map((axis, k) => (
            Math.abs(d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]) - obb.half[k]
          ));
          // inside on every axis -> the point is in the board
          const depth = Math.max(...over) < 0 ? -Math.max(...over) : -1;
          if (Math.max(...over) < 0) inside += 1;
          if (depth > worst) { worst = depth; worstAt = [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; }
          void over;
        }
        // the closest APPROACH, for reporting: smallest positive overshoot
        let nearest = Infinity;
        for (const v of pp) {
          const d = [v.x - obb.mean.x, v.y - obb.mean.y, v.z - obb.mean.z];
          const over = obb.axes.map((axis, k) => (
            Math.abs(d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]) - obb.half[k]
          ));
          const outside = Math.max(...over);
          if (outside >= 0) nearest = Math.min(nearest, outside);
        }
        boards.push({
          solid: solid.name,
          boardVerts: bp.length,
          pageVerts: pp.length,
          boardHalfExtentsMm: obb.half.map((h) => +(h * 1000).toFixed(2)),
          pageVertsInsideBoard: inside,
          deepestPenetrationMm: inside ? +(worst * 1000).toFixed(3) : 0,
          deepestAt: inside ? worstAt : null,
          nearestApproachMm: Number.isFinite(nearest) ? +(nearest * 1000).toFixed(2) : null,
        });
      }
      const totalInside = boards.reduce((sum, b) => sum + (b.pageVertsInsideBoard || 0), 0);
      const approaches = boards.map((b) => b.nearestApproachMm).filter((v) => Number.isFinite(v));
      return {
        gutterX: +gutterX.toFixed(4),
        boards,
        pageVertsInsideCovers: totalInside,
        minClearanceMm: approaches.length ? Math.min(...approaches) : null,
        coverBox: cb,
        pageBox: pb,
      };
    };

    // --- R3: ink in the foot band, off the LIVE canvases ---------------------
    window.__footProbe = () => {
      const root = bookRoot();
      const faces = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const image = o.material?.map?.image;
        if (!image || image.width !== 768 || image.height !== 512) return;
        for (let p = o; p; p = p.parent) if (p.visible === false) return;
        faces.push({ name: o.name, image });
      });
      const scratch = document.createElement('canvas');
      scratch.width = 768; scratch.height = 512;
      const ctx = scratch.getContext('2d');
      const readings = [];
      for (const face of faces) {
        ctx.clearRect(0, 0, 768, 512);
        ctx.drawImage(face.image, 0, 0);
        const data = ctx.getImageData(0, 0, 768, 512).data;
        // Row-by-row dark-ink counts. The foot band is the bottom strip; the
        // question is whether the CONTENT above it bleeds down into it, which
        // shows up as ink in the rows just above the control baseline that is
        // wider/darker than the controls themselves.
        const rowInk = [];
        for (let y = 0; y < 512; y += 1) {
          let ink = 0;
          for (let x = 0; x < 768; x += 1) {
            const i = (y * 768 + x) * 4;
            const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            if (luma < 110) ink += 1;
          }
          rowInk.push(ink);
        }
        readings.push({ name: face.name, rowInk });
      }
      return readings;
    };
  });

  const diag = () => page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state === 'open',
    null, { timeout: 8000 },
  );
  await page.waitForTimeout(600);

  const openDiag = await diag();
  const frameWhole = await page.evaluate(() => window.__frameProbe('whole'));
  const framePages = await page.evaluate(() => window.__frameProbe('pages'));
  const clip = await page.evaluate(() => window.__clipProbe());
  await page.screenshot({ path: path.join(OUT, '01-open-spread.png') });

  // NEGATIVE CONTROL for the clip probe: sink the page block into the boards
  // by 6 mm and require the same probe to report vertices inside them.
  const clipControl = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().interior.getObjectByName('FrontDeskLedgerBook');
    const pages = root.getObjectByName('LB_OpenPages');
    if (!pages) return { moved: false };
    const before = pages.position.y;
    pages.position.y = before - 0.006;
    root.updateWorldMatrix(true, true);
    const sunk = window.__clipProbe();
    pages.position.y = before;
    root.updateWorldMatrix(true, true);
    return { moved: true, sunk, restored: window.__clipProbe() };
  });

  // What else is on the desk under the risen book? A green panel with a gold
  // double border photographs below it and needs a name before it can be
  // judged - the closed shell leaking through would be a real bug.
  const deskNeighbours = await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const root = club.interior.getObjectByName('FrontDeskLedgerBook');
    const V = app.scene3d.camera.position.constructor;
    const spot = app.state.shop?.ledgerSpot || null;
    const anchor = root ? root.getWorldPosition(new V()) : null;
    const closedShellVisible = [];
    if (root) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        let vis = o.visible;
        for (let p = o.parent; vis && p; p = p.parent) vis = p.visible;
        if (vis && /Closed|CoverFront|Border|Clasp|Buckle|CapFront|CapBack|FaceTitle/.test(o.name)) {
          closedShellVisible.push(o.name);
        }
      });
    }
    // anything visible near where the book LAY, that is not the book
    const near = [];
    const at = spot ? new V(spot.x, spot.y, spot.z).add(club.interior.position) : anchor;
    if (at) {
      club.interior.traverse((o) => {
        if (!o.isMesh) return;
        let vis = o.visible;
        for (let p = o.parent; vis && p; p = p.parent) vis = p.visible;
        if (!vis) return;
        for (let p = o; p; p = p.parent) if (p.name === 'FrontDeskLedgerBook') return;
        const wp = o.getWorldPosition(new V());
        if (wp.distanceTo(at) < 0.55) near.push({ name: o.name, d: +wp.distanceTo(at).toFixed(3) });
      });
    }
    return {
      closedShellVisible,
      near: near.sort((a, b) => a.d - b.d).slice(0, 14),
      ledgerSpot: spot,
    };
  });

  const frameControl = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().interior.getObjectByName('FrontDeskLedgerBook');
    const before = root.scale.x;
    root.scale.setScalar(before * 1.9);
    root.updateWorldMatrix(true, true);
    const wide = window.__frameProbe('whole');
    root.scale.setScalar(before);
    root.updateWorldMatrix(true, true);
    return wide;
  });

  // ---- R3 on a FULL page: big money, and the takings spread ---------------
  await page.evaluate(() => {
    const app = window.__fw;
    const ledger = app.state.ledger || (app.state.ledger = {});
    ledger.today = ledger.today || {};
    ledger.today.revenue = { greenFees: 128450.75, shopSales: 98220.4, other: 4310.9 };
    ledger.today.expense = { wages: 260991.35 };
    const book = app.scene3d.clubhouse().ledgerBook;
    book.setOpen(false); book.setOpen(true);
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.goToSection('takings'));
  await page.waitForTimeout(500);
  const fullFoot = await page.evaluate(() => window.__footProbe());
  await page.screenshot({ path: path.join(OUT, '02-takings-full.png') });

  // ---- R3 on an EMPTY page ------------------------------------------------
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.ledger.today.revenue = {};
    app.state.ledger.today.expense = {};
    const book = app.scene3d.clubhouse().ledgerBook;
    book.setOpen(false); book.setOpen(true);
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.goToSection('takings'));
  await page.waitForTimeout(500);
  const emptyFoot = await page.evaluate(() => window.__footProbe());
  await page.screenshot({ path: path.join(OUT, '03-takings-empty.png') });

  // ---- R5: the locked spread, and a section unlocking ---------------------
  const lockedBefore = await page.evaluate(() => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    book.goToSection('course');
    return book.diagnostics();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '04-locked-blank.png') });
  const unlocked = await page.evaluate(() => {
    const app = window.__fw;
    app.state.campaign = app.state.campaign || {};
    app.state.campaign.businessOpen = true;
    const book = app.scene3d.clubhouse().ledgerBook;
    book.setOpen(false); book.setOpen(true);
    return true;
  });
  await page.waitForTimeout(1400);
  const unlockedDiag = await page.evaluate(() => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    book.goToSection('course');
    return book.diagnostics();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '05-course-unlocked.png') });

  // ---- NEGATIVE CONTROL for the foot probe --------------------------------
  const footControl = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().interior.getObjectByName('FrontDeskLedgerBook');
    let face = null;
    root.traverse((o) => {
      if (face || !o.isMesh) return;
      const image = o.material?.map?.image;
      if (!image || image.width !== 768 || image.height !== 512) return;
      // the turning leaf carries page canvases too, on a HIDDEN pivot - the
      // first control painted its decoy there and the probe rightly never saw
      // it, which read as "the probe cannot fail" when it can
      for (let p = o; p; p = p.parent) if (p.visible === false) return;
      face = o;
    });
    if (!face) return { mounted: false };
    const ctx = face.material.map.image.getContext('2d');
    const before = ctx.getImageData(0, 0, 768, 512);
    ctx.fillStyle = '#000';
    ctx.fillRect(40, 470, 600, 26);   // a deliberate slab straddling the band
    face.material.map.needsUpdate = true;
    const seen = window.__footProbe();
    ctx.putImageData(before, 0, 0);
    face.material.map.needsUpdate = true;
    return { mounted: true, seen };
  });

  await page.keyboard.press('Escape').catch(() => {});

  // ---- verdicts -----------------------------------------------------------
  // The band the controls own; content must not reach into it.
  const BAND_TOP = 470;
  const bandInk = (readings) => readings.map((r) => ({
    name: r.name,
    // the widest row of ink inside the band
    maxRowInk: Math.max(...r.rowInk.slice(BAND_TOP)),
    // and how much ink sits in the 12 rows ABOVE the band (content's own space)
    aboveBand: Math.max(...r.rowInk.slice(BAND_TOP - 12, BAND_TOP)),
  }));
  const fullBand = bandInk(fullFoot);
  const emptyBand = bandInk(emptyFoot);
  const controlBand = footControl.seen ? bandInk(footControl.seen) : [];
  // The controls themselves are thin: measured, they never exceed ~120 dark
  // pixels on a row. A content line crossing the band is many times that.
  const CONTROL_CEILING = 200;

  const checks = {
    // R1
    coversAndPagesSplit: !clip.error,
    // THE claim: no part of the page block is inside any cover solid. The
    // nearest-approach number is reported but NOT asserted — once the gold
    // turn-in was tooled onto the boards it entered each board's oriented box
    // in the thickness axis while staying well outside it in width, so the
    // approach figure measures the box, and only containment measures the
    // book. The negative control below is what proves this can fail.
    pageBlockClearsCovers: !clip.error && clip.pageVertsInsideCovers === 0,
    // R2 — every margin is a real margin, whole book
    wholeBookInFrame: !frameWhole.error
      && Object.values(frameWhole.margins).every((m) => m >= 40),
    clipProbeCanFail: clipControl.moved === true
      && (clipControl.sunk?.pageVertsInsideCovers || 0) > 0
      && (clipControl.restored?.pageVertsInsideCovers || 0) === 0,
    frameProbeCanFail: !frameControl.error
      && Object.values(frameControl.margins).some((m) => m < 40),
    // R3 — full page and empty page, live canvases
    fullPageFootClear: fullBand.length > 0 && fullBand.every((b) => b.maxRowInk <= CONTROL_CEILING),
    emptyPageFootClear: emptyBand.length > 0 && emptyBand.every((b) => b.maxRowInk <= CONTROL_CEILING),
    footProbeCanFail: controlBand.some((b) => b.maxRowInk > CONTROL_CEILING),
    // R5
    lockedSectionIsPresent: !!lockedBefore.sections?.find((s) => s.id === 'course' && s.locked),
    sectionUnlocksOnItsOwn: unlocked === true
      && !!unlockedDiag.sections?.find((s) => s.id === 'course' && !s.locked),
    noPageErrors: errs.length === 0,
  };
  const out = {
    openDiag, frameWhole, framePages, clip, clipControl, frameControl, deskNeighbours,
    fullBand, emptyBand, controlBand,
    lockedBefore: { sections: lockedBefore.sections, spread: lockedBefore.spread },
    unlockedDiag: { sections: unlockedDiag.sections, spread: unlockedDiag.spread, pageCount: unlockedDiag.pageCount },
    errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'ledger-frame.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
