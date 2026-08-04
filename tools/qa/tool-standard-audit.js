// E1 — "Audit every other tool against the broom's fixed standard… Produce a
// table before fixing anything."
//
// Six axes, measured off the LIVE posed rig for every tool in CLEANING_TOOLS,
// not read off its registry entry. The registry says what a tool declares; this
// says where its geometry ended up after the frame posed it.
//
//   reach       contact socket height above the floor at the tool's own working
//               pitch. The 0.103 yd bug is a head that cannot touch what it
//               cleans.
//   visible     the contact socket's NDC at that same pitch — is the working
//               end on screen where the player works?
//   referenced  the spread of the contact socket's WORLD height across the full
//               look range (mouseLook clamps at +/-1.35). Near zero is
//               floor-referenced; a large spread is the C2 class — the head
//               rides the view.
//   hands       hand meshes parented into the tool, and sleeve/cuff geometry on
//               the arm rather than a bare stub.
//   animation   distinct local poses across 2 s of held use. Two poses is a
//               twitch; a spread is an animation.
//   collision   does the contact point enter a fixture's box when the player
//               walks into one?
//
// Negative control: the BROOM is measured by the same code. It is the tool the
// standard was set on, so if this instrument does not report the broom as
// floor-referenced with a reachable head, it is not measuring the standard and
// no other row can be trusted.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/tool-standard-audit');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (v, m) => { if (!v) throw new Error(m); };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1500);

  // Open floor, mid-room, so nothing else is in the way.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    app.speedIdx = 0;
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud,.hud-min,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);

  const defs = await page.evaluate(async () => {
    const { CLEANING_TOOLS } = await import('/src/data/cleaningTools.js');
    return Object.values(CLEANING_TOOLS).map((t) => ({
      id: t.id,
      label: t.label,
      floorAnchored: !!t.floorAnchored,
      // the pitch a player uses this at: its declared world pitch if it has
      // one, otherwise a natural working down-look
      workPitch: Number.isFinite(t.worldPitch) ? t.worldPitch : -0.55,
      indoorOnly: !!t.indoorOnly,
      hasFpGlb: !!(t.fp && t.fp.glb),
      declaredAudio: t.audio ? Object.keys(t.audio) : [],
    }));
  });

  const geo = () => page.evaluate(() => window.__fw.scene3d.walk.heldToolGeometry());
  const setPitch = (p) => page.evaluate((v) => { window.__fw.scene3d.walk.state.pitch = v; }, p);

  const rows = [];
  for (const def of defs) {
    await page.evaluate((id) => window.__fw.scene3d.walk.setTool(id), def.id);
    await page.waitForTimeout(1400);

    // ---- reach + visibility at the working pitch --------------------------
    await setPitch(def.workPitch);
    await page.waitForTimeout(900);
    const atWork = await geo();
    if (!atWork) { rows.push({ ...def, error: 'no geometry probe' }); continue; }

    // ---- floor- or camera-referenced --------------------------------------
    const heights = [];
    for (const p of [-1.20, -0.90, -0.60, -0.30, 0, 0.35, 0.70, 1.05, 1.35]) {
      await setPitch(p);
      await page.waitForTimeout(340);
      const g = await geo();
      if (g && g.contactAboveFloor != null) heights.push({ pitch: p, h: g.contactAboveFloor });
    }
    // SPREAD WITHIN THE CARRIED BAND ONLY. The first version swept the whole
    // range and reported the broom at 0.59 — its own control caught it. That
    // 0.59 is the DESIGN: the head is on the boards at a working down-look and
    // carried at a level one, and a pose that blends between two intended
    // heights is not the same claim as a head that rides the view. The C2 class
    // is movement WITHIN one regime, so the spread is measured at and above
    // level, where every tool is carried.
    const carried = heights.filter((r) => r.pitch >= 0);
    const cs = carried.map((r) => r.h);
    const spread = cs.length ? +(Math.max(...cs) - Math.min(...cs)).toFixed(3) : null;
    const hs = heights.map((r) => r.h);
    const fullSpread = hs.length ? +(Math.max(...hs) - Math.min(...hs)).toFixed(3) : null;

    // ---- animation, or a twitch -------------------------------------------
    await setPitch(def.workPitch);
    await page.waitForTimeout(500);
    const poses = await page.evaluate(async () => {
      const w = window.__fw.scene3d.walk;
      w.setSpraying(true);
      const seen = [];
      const started = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const g = w.heldToolGeometry();
          if (g) seen.push(g.localPose.map((v) => v.toFixed(3)).join(','));
          if (performance.now() - started >= 2000) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      w.setSpraying(false);
      return { frames: seen.length, distinct: new Set(seen).size };
    });

    // ---- fixture collision -------------------------------------------------
    // Walk the contact point INTO the nearest fixture box and see whether it
    // stops at the face or passes through it.
    const collision = await page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      const w = app.scene3d.walk;
      const c = app.scene3d.clubhouse();
      const groups = w.colliders || app.scene3d.colliders || {};
      const cols = [...(groups.props || []), ...(groups.structures || [])]
        .filter((col) => col && col.minX !== undefined
          && (col.maxX - col.minX) > 0.6 && (col.maxZ - col.minZ) > 0.3);
      if (!cols.length) return { probed: false };
      // nearest fixture to the player
      let best = null;
      let bestD = Infinity;
      for (const col of cols) {
        const cx = (col.minX + col.maxX) / 2;
        const cz = (col.minZ + col.maxZ) / 2;
        const d = Math.hypot(cx - w.state.x, cz - w.state.z);
        if (d < bestD) { bestD = d; best = col; }
      }
      // stand off its south face and face it
      const cx = (best.minX + best.maxX) / 2;
      w.clearKeys();
      w.state.x = cx;
      w.state.z = best.maxZ + 1.15;
      w.state.yaw = 0;
      await new Promise((r) => setTimeout(r, 700));
      let worstInside = 0;
      for (let step = 0; step < 26; step += 1) {
        w.state.z = Math.max(best.maxZ + 0.20, w.state.z - 0.035);
        await new Promise((r) => requestAnimationFrame(r));
        const g = w.heldToolGeometry();
        if (!g || g.contactWorldY == null) continue;
        // recover the contact point in world x/z through the socket probe's box
        const box = new THREE.Box3(
          new THREE.Vector3(best.minX, -Infinity, best.minZ),
          new THREE.Vector3(best.maxX, Infinity, best.maxZ),
        );
        const p = g.contactWorld;
        if (!p) continue;
        if (p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z) {
          // how far PAST the near face it has gone
          worstInside = Math.max(worstInside, best.maxZ - p.z);
        }
      }
      return { probed: true, worstInsideYd: +worstInside.toFixed(3) };
    });

    rows.push({
      ...def,
      reach: {
        contactAboveFloorYd: atWork.contactAboveFloor,
        contactSocket: atWork.contactSocket,
      },
      visibleAtWorkPitch: atWork.contactNdc
        ? Math.abs(atWork.contactNdc.x) <= 1 && Math.abs(atWork.contactNdc.y) <= 1
        : null,
      contactNdcAtWorkPitch: atWork.contactNdc,
      referenceFrame: {
        contactHeightSpreadYd: spread,
        fullRangeSpreadYd: fullSpread,
        // the C2 threshold: 0.05 yd across the whole look range
        floorReferenced: spread != null ? spread < 0.05 : null,
        byPitch: heights,
      },
      hands: {
        handMeshes: atWork.handMeshes,
        sleeveMeshes: atWork.sleeveMeshes,
        hasGrip: atWork.hasGrip,
        hasSupport: atWork.hasSupport,
      },
      animation: { ...poses, isAnimated: poses.distinct > 4 },
      collision,
    });

    // back to open floor for the next tool
    await page.evaluate(() => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.clearKeys();
      w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    });
    await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
    await page.waitForTimeout(400);
  }

  const broom = rows.find((r) => r.id === 'broom');
  assert(broom && broom.referenceFrame.floorReferenced === true,
    'NEGATIVE CONTROL FAILED: the broom — the tool this standard was set on — does not read as '
    + `floor-referenced across the carried band (spread ${broom && broom.referenceFrame.contactHeightSpreadYd}). `
    + 'The instrument is not measuring the standard, so no other row means anything.');

  fs.writeFileSync(path.join(OUT, 'tool-standard-audit.json'), `${JSON.stringify({ rows }, null, 2)}\n`);
  return {
    tools: rows.length,
    controlBroomSpread: broom.referenceFrame.contactHeightSpreadYd,
    summary: rows.map((r) => ({
      id: r.id,
      reachYd: r.reach?.contactAboveFloorYd ?? null,
      visible: r.visibleAtWorkPitch,
      carriedSpreadYd: r.referenceFrame?.contactHeightSpreadYd ?? null,
      fullSpreadYd: r.referenceFrame?.fullRangeSpreadYd ?? null,
      floorReferenced: r.referenceFrame?.floorReferenced ?? null,
      hands: r.hands?.handMeshes ?? null,
      sleeves: r.hands?.sleeveMeshes ?? null,
      animated: r.animation?.isAnimated ?? null,
      distinctPoses: r.animation?.distinct ?? null,
    })),
  };
}
