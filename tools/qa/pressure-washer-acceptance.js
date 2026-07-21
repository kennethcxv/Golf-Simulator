// PRESSURE WASHER ACCEPTANCE — the water leaves the nozzle, and stops at the first wall.
//
// Two shipped defects this proves out in the running game, not in a unit test:
//   1. the jet was drawn from a camera-local constant that ignored the animated held rig
//   2. `aim` intersected only the grime planes, so the siding was washable through the building
//
// Captures the reference sequence too: idle -> aim -> trigger -> jet -> partial -> finished.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = process.env.PRESSURE_WASHER_QA_OUT_DIR
    || path.join(repo, 'qa', 'assets_51_100_master', 'claude_completion', 'pressure_washer');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.__fw.scene3d.clubhouse().sheet06ProductionReady?.();
    await window.__fw.scene3d.walk.toolViewmodelsReady?.();
  });
  await page.locator('#game').click({ position: { x: 800, y: 450 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game', null, { timeout: 2500 })
    .catch(() => {}); // headless Chrome can deny pointer lock; keyboard/pointer controls still fire
  const pointerLockAcquired = await page.evaluate(() => document.pointerLockElement?.id === 'game');
  if (!pointerLockAcquired) {
    await page.locator('.shop-lockhint').evaluate((node) => { node.style.visibility = 'hidden'; });
  }

  const selectTool = async (tool) => {
    for (let press = 0; press < 8; press++) {
      const current = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
      if (current === tool) return;
      await page.keyboard.press('f');
      await page.waitForTimeout(120);
    }
    throw new Error(`normal-control belt could not select ${tool}`);
  };

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
  await selectTool('washer');
  await page.waitForTimeout(700); // let the equip ease finish
  await shot('02-aim-equipped.png');

  // Read the geometry truth: where is the authored nozzle, where does the jet actually start,
  // and where would the constant this replaced have put it?
  const measure = () => page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    let camera = null; let socket = null; let authoredSocket = null; let jet = null;
    let washerGroup = null;
    scene.traverse((o) => {
      if (o.isCamera && o.isPerspectiveCamera && !camera) camera = o;
      if (o.name === 'HeldWasher' || o.name === 'Tool_washer') washerGroup = o;
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
      authoredSocket = washerGroup.getObjectByName('SOCKET_SprayEmission');
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
    const authoredSocketW = vec(authoredSocket);
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
      authoredSocketFound: !!authoredSocket,
      jetVisible: !!(jet && jet.visible),
      socketToAuthored: dist(socketW, authoredSocketW),
      jetStartToSocket: dist(jetStart, socketW),
      jetStartToLegacyConstant: dist(jetStart, legacy),
      socketToLegacyConstant: dist(socketW, legacy),
    };
  });

  // --- 3. trigger down ----------------------------------------------------------------------
  await page.mouse.down({ button: 'left' });
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
  await page.waitForTimeout(2500);
  await shot('04-partial-cleaning.png');
  const after = await grimeNow();

  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(400);
  await shot('05-released.png');

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

  await selectTool(null);

  const cleaned = Object.keys(before).some((k) => after[k] < before[k] - 1e-4);

  return {
    ok: spraying.socketFound
      && spraying.authoredSocketFound
      && spraying.socketToAuthored !== null && spraying.socketToAuthored < 0.02
      && spraying.jetVisible
      && spraying.jetStartToSocket !== null && spraying.jetStartToSocket < 0.02
      && cleaned
      && occl.insideHitId === null
      && errors.length === 0,
    nozzle: spraying,
    grimeBefore: before,
    grimeAfter: after,
    cleanedSomething: cleaned,
    occlusion: occl,
    errors,
    pointerLockAcquired,
    shots: out,
  };
}
