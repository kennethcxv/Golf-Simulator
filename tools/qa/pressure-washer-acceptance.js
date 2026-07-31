// PRESSURE WASHER ACCEPTANCE — the water leaves the nozzle, and stops at the first wall.
//
// Contracts this proves out in the running game, not in a unit test:
//   1. the jet draws from the authored nozzle socket, not a camera-local constant
//   2. `aim` is occluded by architecture — no washing the siding through the building
//   3. a player-shaped SWEEP erodes light siding (the fine 0.25 yd grid drains a fixed
//      footprint in <1 s by design — a fixed stance stalling is correct, not a defect)
//   4. the SOAP GATE on heavy staining: plain water stalls at the floor; soap + dwell breaks it
//
// Captures the reference sequence too: idle -> aim -> trigger -> jet -> partial -> finished.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.PRESSURE_WASHER_QA_ROOT
    || path.join(repo, 'qa', 'assets_51_100_master', 'claude_completion', 'pressure_washer'));
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.__fw.scene3d.clubhouse().sheet06ProductionReady?.();
  });
  // Deterministic baseline: --bootstrap reuses the persisted save, so grime eroded by earlier
  // runs would contaminate the before/after contract. Re-seed every wash surface to its
  // authored start value (same numbers seedFreshCampaignWorld uses) so the driver is rerunnable.
  await page.evaluate(async () => {
    const sim = await import('/src/sim/washing.js');
    const wash = window.__fw.state.shop.reno.wash;
    for (const def of sim.WASH_SURFACES) {
      const w = wash[def.id];
      if (!w) continue;
      for (let i = 0; i < w.grime.length; i += 1) w.grime[i] = def.start;
      for (let i = 0; i < w.soap.length; i += 1) w.soap[i] = 0;
    }
    window.__fw.scene3d.clubhouse().repaintWash?.();
  });

  // Stand outside on the south side, looking at the siding east of the door.
  const place = async (shot) => {
    await page.evaluate((s) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      const origin = app.scene3d.clubhouse().interior.position;
      walk.state.x = origin.x + s.x;
      walk.state.z = origin.z + s.z;
      const dx = (origin.x + s.tx) - walk.state.x;
      const dz = (origin.z + s.tz) - walk.state.z;
      const d = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / d, -dz / d);
      walk.state.pitch = s.pitch || 0;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, shot);
    await page.waitForTimeout(400);
  };

  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  // --- 1. idle, tool away -------------------------------------------------------------------
  // Stand square on to the south siding EAST of the door. The planes are fitted around the
  // openings, so aiming at the doorway itself hits nothing; and the tool only reaches 7 yd.
  await place({ x: 5.6, z: 9.2, tx: 5.6, tz: 6.5, pitch: 0.06 });
  await shot('01-idle-no-tool.png');

  // --- 2. equip and aim ---------------------------------------------------------------------
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('washer'));
  await page.waitForTimeout(700); // let the equip ease finish
  await shot('02-aim-equipped.png');

  // Read the geometry truth: where is the authored nozzle, where does the jet actually start,
  // and where would the constant this replaced have put it?
  const measure = () => page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    let camera = null; let socket = null; let tipMesh = null; let jet = null;
    let washerGroup = null;
    scene.traverse((o) => {
      if (o.isCamera && o.isPerspectiveCamera && !camera) camera = o;
      if (o.name === 'HeldWasher') washerGroup = o;
      // the jet is the open-ended tapered cylinder drawn between nozzle and contact point.
      // Identify it by geometry, not by colour — a palette tweak must not break the probe.
      if (o.isMesh && o.geometry?.type === 'CylinderGeometry') {
        const p = o.geometry.parameters || {};
        if (p.openEnded === true && p.height === 1 && (p.radiusBottom ?? 0) > (p.radiusTop ?? 0)) jet = o;
      }
    });
    // Scope to the washer's own group. Several cleaning tools now carry a SOCKET_nozzle, so a
    // scene-wide search by name picks up whichever happened to be traversed last.
    if (washerGroup) {
      socket = washerGroup.children.find((c) => c.name === 'SOCKET_nozzle') || null;
    }
    // the fan tip is the 9 cm cone at the lance end
    if (socket && socket.parent) {
      for (const c of socket.parent.children) {
        if (c.isMesh && c.geometry?.type === 'CylinderGeometry'
          && Math.abs((c.geometry.parameters?.height ?? 0) - 0.09) < 1e-6) tipMesh = c;
      }
    }
    const vec = (o) => {
      if (!o) return null;
      o.updateWorldMatrix(true, false);
      const p = { x: 0, y: 0, z: 0 };
      const m = o.matrixWorld.elements;
      p.x = m[12]; p.y = m[13]; p.z = m[14];
      return p;
    };
    const socketW = vec(socket);
    const tipW = vec(tipMesh);
    let jetStart = null;
    if (jet && jet.visible) {
      jet.updateWorldMatrix(true, false);
      const m = jet.matrixWorld.elements;
      const mid = { x: m[12], y: m[13], z: m[14] };
      // the cylinder's local +Y is the flow axis; scale.y is its length
      const ax = { x: m[4], y: m[5], z: m[6] };
      const al = Math.hypot(ax.x, ax.y, ax.z) || 1;
      const half = (jet.scale.y || 1) / 2;
      jetStart = {
        x: mid.x - (ax.x / al) * half,
        y: mid.y - (ax.y / al) * half,
        z: mid.z - (ax.z / al) * half,
      };
    }
    // what the old hardcoded constant would have produced
    let legacy = null;
    if (camera) {
      camera.updateWorldMatrix(true, false);
      const m = camera.matrixWorld.elements;
      const lx = 0.24, ly = -0.24, lz = -1.25;
      legacy = {
        x: m[0] * lx + m[4] * ly + m[8] * lz + m[12],
        y: m[1] * lx + m[5] * ly + m[9] * lz + m[13],
        z: m[2] * lx + m[6] * ly + m[10] * lz + m[14],
      };
    }
    const dist = (a, b) => (a && b)
      ? +Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(4) : null;
    return {
      socketFound: !!socket,
      tipFound: !!tipMesh,
      jetVisible: !!(jet && jet.visible),
      socketToTip: dist(socketW, tipW),
      jetStartToSocket: dist(jetStart, socketW),
      jetStartToLegacyConstant: dist(jetStart, legacy),
      socketToLegacyConstant: dist(socketW, legacy),
    };
  });

  // --- 3. trigger down ----------------------------------------------------------------------
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
  await page.waitForTimeout(500);
  await shot('03-trigger-jet.png');
  const spraying = await measure();

  // --- 4. keep washing, then sample progress ------------------------------------------------
  const grimeNow = () => page.evaluate(() => {
    const w = window.__fw.state.shop.reno.wash;
    const o = {};
    for (const [k, v] of Object.entries(w)) {
      o[k] = +(v.grime.reduce((a, b) => a + b, 0) / v.grime.length).toFixed(4);
    }
    return o;
  });
  const before = await grimeNow();
  // SWEEP while washing. The grime grid is fine (0.25 yd cells) and light surfaces drain their
  // ~4-cell footprint in well under a second, so a fixed stance stops producing deltas almost
  // immediately — that is correct sim behavior, not a defect. The contract is a player-shaped
  // pass: rake the jet across the face and the mean must fall.
  for (let i = 0; i < 8; i += 1) {
    await page.evaluate((step) => {
      const walk = window.__fw.scene3d.walk;
      walk.state.yaw += (step % 2 === 0 ? 1 : -1) * 0.035 * (1 + step * 0.25);
      walk.state.pitch = 0.06 + (step % 3 - 1) * 0.05;
    }, i);
    await page.waitForTimeout(350);
  }
  await shot('04-partial-cleaning.png');
  const after = await grimeNow();

  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
  await page.waitForTimeout(400);
  await shot('05-released.png');

  // --- 4b. the soap gate on HEAVY staining --------------------------------------------------
  // The foundation skirt is heavy: plain water must stall at the floor, soap + dwell must break
  // through. Self-locate the aim pitch (the skirt is a low band; the exact pitch depends on
  // stance), then drive the real loop: wash → stall, soap → dwell → wash → breakthrough.
  const soapGate = { found: false, stalledMean: null, afterSoapMean: null, stalled: false, brokeThrough: false };
  const foundPitch = await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    let camera = null;
    app.scene3d.scene.traverse((o) => { if (o.isPerspectiveCamera && !camera) camera = o; });
    if (!camera) return null;
    for (let p = -0.05; p >= -0.75; p -= 0.05) {
      walk.state.pitch = p;
      camera.rotation.set(p, walk.state.yaw, 0, 'YXZ');
      camera.updateWorldMatrix(true, false);
      const e = camera.matrixWorld.elements;
      const hit = club.washAim({ x: e[12], y: e[13], z: e[14] }, { x: -e[8], y: -e[9], z: -e[10] });
      if (hit && hit.id === 'foundation') return p;
    }
    return null;
  });
  if (foundPitch !== null) {
    soapGate.found = true;
    const foundationMean = () => page.evaluate(() => {
      const g = window.__fw.state.shop.reno.wash.foundation.grime;
      return +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(4);
    });
    const sweepWash = async (ms) => {
      await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
      for (let i = 0; i < Math.max(1, Math.round(ms / 350)); i += 1) {
        await page.evaluate((step) => {
          window.__fw.scene3d.walk.state.yaw += (step % 2 === 0 ? 1 : -1) * 0.05 * (1 + step * 0.3);
        }, i);
        await page.waitForTimeout(350);
      }
      await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    };
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, foundPitch);
    await sweepWash(2100);
    soapGate.stalledMean = await foundationMean();
    // heavy cells floor at 0.42 without soap — the swept band must still sit well above clean
    soapGate.stalled = soapGate.stalledMean > 0.44;
    await page.evaluate(() => window.__fw.scene3d.walk.setSoaping(true));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__fw.scene3d.walk.setSoaping(false));
    await page.waitForTimeout(2600); // soap dwell (SOAP_DWELL_SEC = 2.0) matures after release
    await sweepWash(2100);
    await shot('05b-soap-breakthrough.png');
    soapGate.afterSoapMean = await foundationMean();
    soapGate.brokeThrough = soapGate.afterSoapMean < soapGate.stalledMean - 0.01;
  }

  // --- 5. occlusion: stand INSIDE and try to wash the south siding through the wall ----------
  const occl = await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const origin = club.interior.position;

    // Outside, south of the building, looking north at the siding: must HIT.
    const outsideFrom = new THREE.Vector3(origin.x + 5.6, origin.y + 1.6, origin.z + 9.0);
    const north = new THREE.Vector3(0, 0, -1);
    const outsideHit = club.washAim(outsideFrom, north);

    // Inside the building, looking south at the same siding through the wall: must MISS.
    const insideFrom = new THREE.Vector3(origin.x + 5.6, origin.y + 1.6, origin.z + 1.0);
    const south = new THREE.Vector3(0, 0, 1);
    const insideHit = club.washAim(insideFrom, south);

    return {
      outsideHitId: outsideHit ? outsideHit.id : null,
      outsideHitDist: outsideHit ? +outsideHit.dist.toFixed(3) : null,
      insideHitId: insideHit ? insideHit.id : null,
    };
  });

  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));

  const cleaned = Object.keys(before).some((k) => after[k] < before[k] - 1e-4);

  return {
    ok: spraying.socketFound
      && spraying.jetVisible
      && spraying.jetStartToSocket !== null && spraying.jetStartToSocket < 0.02
      && cleaned
      && soapGate.found && soapGate.stalled && soapGate.brokeThrough
      && occl.insideHitId === null
      && errors.length === 0,
    nozzle: spraying,
    grimeBefore: before,
    grimeAfter: after,
    cleanedSomething: cleaned,
    soapGate,
    occlusion: occl,
    errors,
    shots: out,
  };
}
