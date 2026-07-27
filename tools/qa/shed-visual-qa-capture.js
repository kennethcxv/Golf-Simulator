// SHED VISUAL-QA CAPTURE — the fixed-camera matrix for the browser-game
// visual-QA protocol (.agents/skills/browser-game-visual-qa) run on the
// ?scene=shed slice. Re-runnable: boots fresh, pins midday+clear weather,
// proves normal keyboard/mouse-look controls respond, then captures NINE fixed
// cameras at 1600x900: the dirty boot frame, a doorway exterior approach, the
// room from just inside the door (the acceptance driver's own DOOR_VIEW), a
// NW->SE diagonal, workbench close, tool-rack wall, the mop-equipped B-pose and
// the spray mid-use C-pose (the evidence driver's B/C stances), and — after a
// scripted full clean reusing the acceptance G10 finale mechanics — the
// all-clean frame from the same DOOR_VIEW.
//
// Poses use the same documented fixture the certified drivers use (walk.state
// placement + walk.setTool/setSpraying — the real input entries); the full
// clean drives the SAME clubhouseApi.cleanWithTool dispatch and real [E]
// station interactions the acceptance certifies. No sim-state pokes.
//
// Run:  node tools/qa/run-playwright.cjs tools/qa/shed-visual-qa-capture.js
// Out:  SHED_VQA_ROOT (default qa/shed_stage1/visual/latest)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.SHED_VQA_ROOT
    || path.join(repo, 'qa', 'shed_stage1', 'visual', 'latest'));
  fs.mkdirSync(out, { recursive: true });

  // ---- console/page/network findings (whole run) ---------------------------
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    else if (m.type() === 'warning') warnings.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText || '?'})`));

  const boot = async () => {
    await page.goto(`${baseUrl}?scene=shed&fresh=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForTimeout(1800);
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      if (!v) return true;
      const cs = getComputedStyle(v);
      return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02;
    }, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(600);
  };
  await boot();

  // ---- fixed conditions: 14:00 midday, zero rain (weather is seed-rolled) ---
  const pinConditions = () => page.evaluate(() => {
    const app = window.__fw;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    if (app.state.weather?.today) app.state.weather.today.rainIn = 0;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
  });
  await pinConditions();
  await page.waitForTimeout(500);

  const ROOM = await page.evaluate(() => {
    const o = window.__fw.scene3d.clubhouse().interior.position;
    return { ox: o.x, oz: o.z };
  });

  // ---- the fixed camera set (local room coords; yaw 0 faces north/-z) ------
  const DOOR_VIEW = { lx: 1.2, lz: 2.6, yaw: 0, pitch: -0.35 }; // acceptance's own pose
  const aimYaw = (fx, fz, tx, tz) => {
    const dx = tx - fx;
    const dz = tz - fz;
    const d = Math.hypot(dx, dz) || 1;
    return Math.atan2(-dx / d, -dz / d);
  };
  const CAMERAS = [
    { name: '11-exterior-approach', lx: 1.2, lz: 6.0, yaw: 0, pitch: -0.02 },
    { name: '12-room-from-door', ...{ lx: DOOR_VIEW.lx, lz: DOOR_VIEW.lz, yaw: DOOR_VIEW.yaw, pitch: DOOR_VIEW.pitch } },
    { name: '13-nw-diagonal', lx: -2.75, lz: -1.8, yaw: aimYaw(-2.75, -1.8, 2.6, 2.0), pitch: -0.1 },
    { name: '14-workbench-close', lx: -0.4, lz: -0.8, yaw: 0, pitch: -0.3 },
    { name: '15-toolrack-wall', lx: -1.3, lz: -1.5, yaw: Math.PI / 2, pitch: -0.12 },
    { name: '16-mop-b-pose', lx: 0.0, lz: 1.0, yaw: 0, pitch: -0.62, tool: 'mop' },
    { name: '17-spray-c-pose', lx: 0.4, lz: 1.2, yaw: 0, pitch: -0.62, tool: 'spray', use: true },
  ];

  const place = (lx, lz, yaw, pitch, tool = null) => page.evaluate(async (a) => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool(a.tool);
    walk.state.x = a.ROOM.ox + a.lx;
    walk.state.z = a.ROOM.oz + a.lz;
    walk.state.yaw = a.yaw;
    walk.state.pitch = a.pitch;
    walk.state.active = true;
    await new Promise((r) => setTimeout(r, 450));
  }, { ROOM, lx, lz, yaw, pitch, tool });

  const shots = [];
  const shoot = async (name) => {
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    shots.push(`${name}.png`);
  };

  // ---- 10: the dirty-state boot frame (natural spawn, untouched pose) ------
  await shoot('10-dirty-boot');

  // ---- normal-controls proof: real key events through the live loop --------
  const controls = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    walk.state.active = true;
    const before = { x: walk.state.x, z: walk.state.z, yaw: walk.state.yaw };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    await new Promise((r) => setTimeout(r, 650));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'arrowleft' }));
    await new Promise((r) => setTimeout(r, 350));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'arrowleft' }));
    const after = { x: walk.state.x, z: walk.state.z, yaw: walk.state.yaw };
    return {
      moved: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(3),
      yawDelta: +(after.yaw - before.yaw).toFixed(3),
    };
  });

  // ---- the seven staged cameras -------------------------------------------
  for (const cam of CAMERAS) {
    await place(cam.lx, cam.lz, cam.yaw, cam.pitch, cam.tool || null);
    if (cam.use) {
      await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
      await page.waitForTimeout(800);
      await shoot(cam.name);
      await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
      await page.waitForTimeout(150);
    } else {
      await shoot(cam.name);
    }
  }

  // ---- scripted full clean (trimmed acceptance G3+G10 mechanics) -----------
  const POSES = {
    'web:corner-nw': { x: -3.6, z: -2.6 }, 'web:corner-ne': { x: 3.6, z: -2.6 },
    'bench:grease': { x: -0.4, z: -2.35 }, 'wall:scuff-door': { x: 2.35, z: 2.9 },
    'floor:oil-patch': { x: 0.6, z: 0.2 }, 'shelf:dust': { x: -3.35, z: -0.2 },
    'entry:leaf-drift': { x: 1.2, z: 2.3 }, 'trash:cans': { x: -2.2, z: 0.6 },
    'window:south': { x: -2.0, z: 2.85 }, 'window:east': { x: 3.8, z: -0.5 },
  };
  const burst = (tool, id, n) => page.evaluate((a) => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    const p = a.POSES[a.id];
    walk.setTool(a.tool);
    walk.state.x = a.ROOM.ox + p.x;
    walk.state.z = a.ROOM.oz + p.z;
    walk.state.active = true;
    for (let i = 0; i < a.n; i++) ch.cleanWithTool(a.tool, a.ROOM.ox + p.x, a.ROOM.oz + p.z, 0, -1, 0.1);
  }, { ROOM, tool, id, n, POSES });

  // pizza box through its real [E] prop (fallback-free: acceptance-proven poses)
  await page.evaluate(async (rm) => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool(null);
    walk.state.yaw = Math.PI / 2;
    walk.state.active = true;
    for (const [bk, pit] of [[1.0, 0.2], [0.9, 0.35], [1.15, 0.05], [0.8, 0.4]]) {
      walk.state.x = rm.ox + -3.1 + bk;
      walk.state.z = rm.oz + 2.1;
      walk.state.pitch = pit;
      await new Promise((r) => setTimeout(r, 220));
      const label = walk.getFocusLabel();
      if (label && /pizza/i.test(label)) { walk.interact(); break; }
    }
    await new Promise((r) => setTimeout(r, 140));
  }, ROOM);

  for (const [tool, id, n] of [
    ['vacuum', 'web:corner-nw', 40], ['vacuum', 'web:corner-ne', 40],
    ['sponge', 'floor:oil-patch', 120], ['cloth', 'shelf:dust', 60],
  ]) await burst(tool, id, n);
  for (const id of ['bench:grease', 'wall:scuff-door', 'window:south', 'window:east']) {
    await burst('spray', id, 3);
    await burst(id === 'bench:grease' ? 'sponge' : 'cloth', id, 40);
  }
  await burst('broom', 'entry:leaf-drift', 40);
  await burst('trashbag', 'entry:leaf-drift', 8);
  await burst('trashbag', 'trash:cans', 20);

  // vacuum every floor cell (the acceptance finale's contact walk)
  await page.evaluate((rm) => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    walk.setTool('vacuum');
    walk.state.active = true;
    const contacts = [];
    for (const x of [-2.75, -1.38, 0, 1.38, 2.75]) for (const z of [-2.06, -0.69, 0.69, 2.06]) contacts.push([x, z]);
    contacts.push([-1.38, -1.4], [0, -1.4], [1.38, -1.4], [-2.75, 1.35]);
    for (let pass = 0; pass < 4; pass++) for (const [x, z] of contacts) {
      walk.state.x = rm.ox + x;
      walk.state.z = rm.oz + z;
      for (let i = 0; i < 8; i++) ch.cleanWithTool('vacuum', rm.ox + x, rm.oz + z, 0, 0, 0.1);
    }
  }, ROOM);

  // collect + dispose ALL debris through the bin's real [E] chain
  const interactBin = (presses) => page.evaluate(async (a) => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool('trashbag');
    for (const [bx, bz, pa] of [[2.5, 0.9, 0], [2.5, 0.9, 0.12], [2.5, 1.1, -0.05], [2.3, 0.9, 0.08], [2.8, 0.9, 0]]) {
      walk.state.x = a.rm.ox + bx;
      walk.state.z = a.rm.oz + bz;
      walk.state.yaw = -Math.PI / 2;
      walk.state.pitch = -0.3 + pa;
      walk.state.active = true;
      await new Promise((r) => setTimeout(r, 240));
      const label = walk.getFocusLabel();
      if (label && /waste bin/i.test(label)) {
        for (let k = 0; k < a.presses; k++) { walk.interact(); await new Promise((r) => setTimeout(r, 80)); }
        break;
      }
    }
  }, { rm: ROOM, presses });
  let cleanState = null;
  for (let round = 0; round < 12; round++) {
    await page.evaluate((rm) => {
      const ch = window.__fw.scene3d.clubhouse();
      const walk = window.__fw.scene3d.walk;
      const list = (window.__fw.state.shop.reno.debris || []).map((d) => ({ x: d.x, z: d.z }));
      for (const tool of ['dustpan', 'trashbag']) {
        walk.setTool(tool);
        for (const d of list) {
          const cz = d.z < -1.9 ? d.z + 0.6 : d.z;
          walk.state.x = rm.ox + d.x;
          walk.state.z = rm.oz + cz;
          walk.state.active = true;
          for (let i = 0; i < 6; i++) ch.cleanWithTool(tool, rm.ox + d.x, rm.oz + cz, 0, -1, 0.1);
        }
      }
    }, ROOM);
    await interactBin(4);
    cleanState = await page.evaluate(() => {
      const c = window.__fw.state.shop.reno.cleaning;
      return {
        total: +window.__fw.scene3d.clubhouse().debrisTotal().toFixed(3),
        pan: +c.pan.load.toFixed(3),
        bag: +c.bag.load.toFixed(3),
        disposed: c.bag.disposed,
      };
    });
    if (cleanState.total <= 0.02 && cleanState.pan <= 0.02 && cleanState.bag <= 0.02 && cleanState.disposed >= 1) break;
  }
  await page.waitForTimeout(900); // completion watch + checklist interval
  const done = await page.evaluate(() => ({
    completedAt: window.__fw.state.shop.reno.shed.completedAt,
    targetsAll: Object.values(window.__fw.state.shop.reno.shed.targets).every((v) => v >= 1),
    checklistComplete: !!document.querySelector('.shed-checklist.is-complete'),
  }));

  // ---- 18: the all-clean frame from the same DOOR_VIEW ---------------------
  await pinConditions();
  await place(DOOR_VIEW.lx, DOOR_VIEW.lz, DOOR_VIEW.yaw, DOOR_VIEW.pitch, null);
  await page.waitForTimeout(3600); // let target-complete toasts age out of the stack
  await shoot('18-all-clean');

  // ---- manifest + gate -----------------------------------------------------
  const planned = ['10-dirty-boot.png',
    ...CAMERAS.map((c) => `${c.name}.png`), '18-all-clean.png'];
  const missing = planned.filter((n) => !fs.existsSync(path.join(out, n)));
  const ok = missing.length === 0 && errors.length === 0
    && controls.moved > 0.4 && Math.abs(controls.yawDelta) > 0.1
    && done.targetsAll && Number.isFinite(done.completedAt);
  const manifest = {
    ok,
    out,
    viewport: page.viewportSize(),
    cameras: [{ name: '10-dirty-boot', pose: 'natural spawn (untouched)' },
      ...CAMERAS.map(({ name, lx, lz, yaw, pitch, tool, use }) => ({
        name, lx, lz, yaw: +yaw.toFixed(3), pitch, tool: tool || null, inUse: !!use,
      })),
      { name: '18-all-clean', ...DOOR_VIEW, note: 'after scripted full clean' }],
    controls,
    clean: { ...done, debris: cleanState },
    consoleErrors: errors,
    consoleWarnings: warnings.slice(0, 12),
    failedRequests,
    missing,
    shots,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
