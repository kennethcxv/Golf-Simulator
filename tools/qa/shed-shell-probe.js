// THE MAINTENANCE SHED SHELL, in the running game.
//
// Boots ?scene=shed&fresh=1 and proves the Task-3 substitution end to end: the
// shed-shell contract self-report, that the legacy clubhouse dressing is gone,
// that the four walls are solid and the doorway passes through, that the floor
// holds the player at a stable height, that no clubhouse [E] prompt is reachable
// while the tool belt still equips, and that the seeded cleaning simulation still
// runs through the SAME clubhouseApi.cleanWithTool dispatch with no discrete
// pre-gate. Screenshots land in qa/shed_stage1/shell/.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.SHED_QA_ROOT || path.join(repo, 'qa', 'shed_stage1', 'shell'));
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(`${baseUrl}?scene=shed&fresh=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  // let shaders compile + the load veil lift so screenshots are the room, not the veil
  await page.waitForTimeout(1800);
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    if (!v) return true;
    const cs = getComputedStyle(v);
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02;
  }, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);

  const fail = [];
  const expect = (cond, msg) => { if (!cond) fail.push(msg); return !!cond; };

  // ---- 1. shell-contract self report ---------------------------------------------------
  const diag = await page.evaluate(() => window.__fw.scene3d.clubhouse().shedDiagnostics());
  expect(diag.variant === 'shed', `variant is ${diag.variant}, want shed`);
  expect(diag.shed === true, 'shedDiagnostics.shed !== true');
  expect(diag.suppressedNodes > 0, `suppressedNodes ${diag.suppressedNodes} not > 0`);
  expect(diag.colliderCount >= 4 && diag.colliderCount <= 8,
    `colliderCount ${diag.colliderCount} outside 4..8`);
  expect(diag.shellContract.windowDefs === 2, `windowDefs ${diag.shellContract.windowDefs} != 2`);
  const wantLighting = ['setShopTier', 'setTimeMood', 'refreshCondition', 'setWindowDirt',
    'setCeilingCircuitPowered', 'isCeilingCircuitPowered', 'refreshRestoration',
    'setCameraLocalPosition', 'panelRenderBudget', 'updateFlicker'];
  expect(wantLighting.every((m) => diag.shellContract.lighting.includes(m)),
    `lighting facade missing methods: ${wantLighting.filter((m) => !diag.shellContract.lighting.includes(m))}`);
  expect(diag.doorMode === 'dormant', `doorMode ${diag.doorMode} != dormant`);

  // ---- 2. legacy fixtures are not visible ----------------------------------------------
  const legacyNames = ['SimplifiedFrontDeskRegister', 'CheckoutHardwareVisualRoot',
    'CheckoutCounterVisualRoot', 'LegacyWelcomeMat', 'CampaignInteractionMarkers',
    'PineHillsInteriorLayer'];
  const legacyVis = await page.evaluate((names) => {
    const scene = window.__fw.scene3d.scene;
    const effVisible = (obj) => { let v = obj.visible; let p = obj.parent; while (v && p) { v = p.visible; p = p.parent; } return v; };
    const res = {};
    for (const n of names) { const o = scene.getObjectByName(n); res[n] = o ? effVisible(o) : 'absent'; }
    // total effectively-visible meshes inside the interior root
    const interior = window.__fw.scene3d.clubhouse().interior;
    let visibleInteriorMeshes = 0;
    interior.traverse((x) => { if ((x.isMesh || x.isInstancedMesh) && effVisible(x)) visibleInteriorMeshes++; });
    return { res, visibleInteriorMeshes };
  }, legacyNames);
  for (const n of legacyNames) {
    expect(legacyVis.res[n] === 'absent' || legacyVis.res[n] === false,
      `legacy node ${n} is visible under shed (${legacyVis.res[n]})`);
  }
  // Task 5 furnished the shed: ~7 furniture groups, 11 target visuals (incl.
  // 14 leaf + 4 can instances + 6 cobweb fans), the grime plane, plus the
  // shell's own ceiling/beams/bulb — ~70 legitimate visible meshes. A real
  // legacy-clubhouse leak is hundreds to thousands, so this bound still catches
  // it while allowing the authored shed content.
  expect(legacyVis.visibleInteriorMeshes < 130,
    `too many visible interior meshes (${legacyVis.visibleInteriorMeshes}) — suppression leaked`);

  // ---- 3. walk the walls + doorway -----------------------------------------------------
  const ROOM = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const o = ch.interior.position;
    return { ox: o.x, oz: o.z };
  });
  // solid wall centerline points (local) should be BLOCKED; interior + door gap FREE
  const walls = await page.evaluate((ROOM) => {
    const walk = window.__fw.scene3d.walk;
    const F = (lx, lz) => walk.isFree(ROOM.ox + lx, ROOM.oz + lz);
    return {
      northBlocked: !F(0, -3.14),
      southSolidBlocked: !F(3.0, 3.14),
      westBlocked: !F(-4.14, 0),
      eastBlocked: !F(4.14, 1.6),
      doorGapFree: F(1.2, 3.14),
      centerFree: F(0, 0),
      // Task 5 placed the shelving unit against the west wall (collider x -4.0..-3.3),
      // so the old (-3.4, 0) sample now sits inside furniture — test open floor
      // just east of it instead.
      nearWestFree: F(-2.7, 0),
    };
  }, ROOM);
  expect(walls.northBlocked, 'north wall not solid');
  expect(walls.southSolidBlocked, 'south wall (solid part) not solid');
  expect(walls.westBlocked, 'west wall not solid');
  expect(walls.eastBlocked, 'east wall not solid');
  expect(walls.doorGapFree, 'doorway is blocked (should be passable)');
  expect(walls.centerFree, 'room center is blocked');
  expect(walls.nearWestFree, 'interior near west wall is blocked');

  // march (axis-separated, engine isFree-gated — mirrors walkTryMove) into each wall + door
  const march = await page.evaluate((ROOM) => {
    const walk = window.__fw.scene3d.walk;
    const run = (sx, sz, dx, dz, steps) => {
      let x = ROOM.ox + sx; let z = ROOM.oz + sz;
      const mag = Math.hypot(dx, dz); const ux = dx / mag; const uz = dz / mag;
      for (let i = 0; i < steps; i++) {
        const nx = x + ux * 0.2; const nz = z + uz * 0.2;
        if (walk.isFree(nx, z)) x = nx;
        if (walk.isFree(x, nz)) z = nz;
      }
      return { lx: +(x - ROOM.ox).toFixed(3), lz: +(z - ROOM.oz).toFixed(3), free: walk.isFree(x, z), finite: Number.isFinite(x) && Number.isFinite(z) };
    };
    return {
      north: run(0, 0, 0, -1, 40),
      south: run(3.0, 0, 0, 1, 40),
      west: run(0, 0, -1, 0, 40),
      east: run(0, 1.6, 1, 0, 40),
      door: run(1.2, 0, 0, 1, 40),
    };
  }, ROOM);
  // solid-wall marches stop inside the room (never tunnel past the clear span) and end free+finite
  expect(march.north.lz > -3.05 && march.north.free && march.north.finite, `north march ${JSON.stringify(march.north)}`);
  expect(march.south.lz < 3.05 && march.south.free && march.south.finite, `south march ${JSON.stringify(march.south)}`);
  expect(march.west.lx > -4.06 && march.west.free && march.west.finite, `west march ${JSON.stringify(march.west)}`);
  expect(march.east.lx < 4.06 && march.east.free && march.east.finite, `east march ${JSON.stringify(march.east)}`);
  // the door march passes THROUGH to the outside
  expect(march.door.lz > 3.1 && march.door.finite, `door march did not pass through ${JSON.stringify(march.door)}`);

  // real engine depenetration: nudge the player a shallow step into the east wall
  // collider, let the loop push them back out into the room (never trapped, never NaN)
  const depen = await page.evaluate(async (ROOM) => {
    const walk = window.__fw.scene3d.walk;
    walk.state.x = ROOM.ox + 4.0; // shallow overlap of the east wall collider
    walk.state.z = ROOM.oz + 1.6;
    walk.state.active = true;
    await new Promise((r) => setTimeout(r, 400));
    const lx = walk.state.x - ROOM.ox; const lz = walk.state.z - ROOM.oz;
    return { lx: +lx.toFixed(3), lz: +lz.toFixed(3), free: walk.isFree(walk.state.x, walk.state.z), finite: Number.isFinite(walk.state.x) && Number.isFinite(walk.state.z), insideRoom: Math.abs(lx) < 4.1 && Math.abs(lz) < 3.1 };
  }, ROOM);
  expect(depen.finite, 'walk.state went NaN after wall penetration');
  expect(depen.free, 'engine did not depenetrate the player out of the east wall');
  expect(depen.insideRoom, `depenetration did not keep the player in the room: ${JSON.stringify(depen)}`);

  // ---- 4. groundYAt sanity (5 interior points, stable finite floor) --------------------
  const ground = await page.evaluate((ROOM) => {
    const ch = window.__fw.scene3d.clubhouse();
    const pts = [[0, 0], [-3, -2], [3, 2], [-3, 2], [3, -2]];
    return pts.map(([lx, lz]) => ch.groundYAt(ROOM.ox + lx, ROOM.oz + lz));
  }, ROOM);
  const gFinite = ground.every((y) => Number.isFinite(y));
  const gStable = Math.max(...ground) - Math.min(...ground) < 1e-6;
  expect(gFinite, `groundYAt returned non-finite: ${JSON.stringify(ground)}`);
  expect(gStable, `groundYAt not stable across the floor: ${JSON.stringify(ground)}`);

  // ---- 5. interaction quiet + tool belt ------------------------------------------------
  const CLUB_PROMPT = /register|laptop|wash|window|wipe|repair|install|disposal|door|clubhouse|counter|bucket|shelf|stock|reservation|book|desk|telephone|phone|arrivals|check-in|simulator|sign|office|cart|fixture|display/i;
  const focus = await page.evaluate(async (ROOM) => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool(null);
    walk.state.active = true;
    walk.state.pitch = 0;
    const positions = [[0, 0], [-3.2, 0], [3.2, 0], [0, 2.4], [0, -2.4], [-2, 1.6]];
    const labels = [];
    for (const [lx, lz] of positions) {
      walk.state.x = ROOM.ox + lx; walk.state.z = ROOM.oz + lz;
      for (let s = 0; s < 8; s++) {
        walk.state.yaw = (s / 8) * Math.PI * 2;
        await new Promise((r) => setTimeout(r, 70));
        const l = walk.getFocusLabel();
        if (l) labels.push(l);
      }
    }
    return labels;
  }, ROOM);
  const clubPrompts = focus.filter((l) => CLUB_PROMPT.test(l));
  expect(clubPrompts.length === 0, `reachable clubhouse prompts under shed: ${JSON.stringify([...new Set(clubPrompts)])}`);

  const toolBelt = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool('broom');
    await new Promise((r) => setTimeout(r, 400));
    const scene = window.__fw.scene3d.scene;
    let visibleToolMeshes = 0;
    scene.traverse((o) => { if (o.name && o.name.startsWith('Tool_') && o.visible) visibleToolMeshes++; });
    // focus becomes a live cleaning readout — proves the focus pipeline is live, not dead
    const readout = walk.getFocusLabel();
    walk.setTool(null);
    return { visibleToolMeshes, readout };
  });
  expect(toolBelt.visibleToolMeshes >= 1, `broom did not equip a visible Tool_ mesh (${toolBelt.visibleToolMeshes})`);

  // ---- 6. sim-live: sweep debris (conserved+moved) + vacuum grime (falls) --------------
  const sim = await page.evaluate(async (ROOM) => {
    const ch = window.__fw.scene3d.clubhouse();
    const state = window.__fw.state;
    const mean = (a) => (Array.isArray(a) && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    // a seeded debris cluster clear of every Task-5 cleaning target (the old
    // door-pile sample now sits inside the entry:leaf-drift target radius, whose
    // pre-gate would consume the broom before it reaches the floor sweep).
    const dz0 = ch.debrisTotal();
    const dc0 = ch.debrisCount();
    const dpos0 = JSON.stringify((state.shop.reno.debris || []).map((d) => [d.x, d.z]));
    const bx = ROOM.ox - 1.7; const bz = ROOM.oz - 0.65;
    for (let i = 0; i < 24; i++) ch.cleanWithTool('broom', bx, bz, 0, -1, 0.05);
    const dz1 = ch.debrisTotal();
    const dpos1 = JSON.stringify((state.shop.reno.debris || []).map((d) => [d.x, d.z]));
    // vacuum a seeded-dirty grime cell near the center
    const g0 = mean(state.shop.reno.grime);
    const vx = ROOM.ox - 0.6; const vz = ROOM.oz + 0.5;
    for (let i = 0; i < 30; i++) ch.cleanWithTool('vacuum', vx, vz, 0, 0, 0.06);
    const g1 = mean(state.shop.reno.grime);
    return {
      debrisBefore: +dz0.toFixed(3), debrisAfter: +dz1.toFixed(3),
      debrisCountBefore: dc0, conserved: Math.abs(dz1 - dz0) < 0.05, moved: dpos0 !== dpos1,
      grimeBefore: +g0.toFixed(4), grimeAfter: +g1.toFixed(4), grimeFell: g1 < g0 - 1e-4,
    };
  }, ROOM);
  expect(sim.conserved, `broom did not conserve debris (${sim.debrisBefore} -> ${sim.debrisAfter})`);
  expect(sim.moved, 'broom did not move any debris');
  expect(sim.grimeFell, `vacuum did not lower grime (${sim.grimeBefore} -> ${sim.grimeAfter})`);

  // ---- 7. screenshots ------------------------------------------------------------------
  const place = (lx, lz, yaw, pitch) => page.evaluate(async ({ lx, lz, yaw, pitch, ROOM }) => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool(null);
    walk.state.x = ROOM.ox + lx; walk.state.z = ROOM.oz + lz;
    walk.state.yaw = yaw; walk.state.pitch = pitch; walk.state.active = true;
    await new Promise((r) => setTimeout(r, 260));
  }, { lx, lz, yaw, pitch, ROOM });
  // yaw convention: forward = (-sin yaw, -cos yaw); yaw=0 faces -z (north),
  // +PI faces +z (south), +PI/2 faces -x (west), -PI/2 faces +x (east).
  await place(1.2, 5.0, 0, -0.06); await page.screenshot({ path: path.join(out, '01-doorway-exterior-approach.png') });
  await place(1.2, 2.4, 0, -0.05); await page.screenshot({ path: path.join(out, '02-room-from-door.png') });
  await place(0, 2.4, 0, -0.08); await page.screenshot({ path: path.join(out, '03-north-wall.png') });
  await place(0, -2.4, Math.PI, -0.05); await page.screenshot({ path: path.join(out, '04-south-wall-door.png') });
  await place(3.5, 0, Math.PI / 2, -0.02); await page.screenshot({ path: path.join(out, '05-west-wall.png') });
  await place(-3.5, -0.5, -Math.PI / 2, -0.02); await page.screenshot({ path: path.join(out, '06-east-wall-window.png') });
  await place(0.4, 0.9, 0, 0.5); await page.screenshot({ path: path.join(out, '07-ceiling-bulb.png') });
  await place(-0.4, -1.3, 0, -0.9); await page.screenshot({ path: path.join(out, '08-floor-detail.png') });

  expect(errors.length === 0, `console/page errors: ${JSON.stringify(errors)}`);

  const ok = fail.length === 0;
  return {
    ok,
    fail,
    diagnostics: diag,
    visibleInteriorMeshes: legacyVis.visibleInteriorMeshes,
    legacyVisibility: legacyVis.res,
    walls,
    march,
    depenetration: depen,
    groundYAt: ground,
    focusLabelsSeen: [...new Set(focus)],
    toolBelt,
    sim,
    errors,
    shots: out,
  };
}
