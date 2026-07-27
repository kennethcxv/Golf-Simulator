// THE SHED'S DIRTY CONTENT, in the running game.
//
// Boots ?scene=shed&fresh=1 and proves Task 5 end to end: the authored grime
// plane + eleven discrete targets + two window films + two service stations +
// seven furniture groups are present; a full cleaning pass driven through the
// REAL clubhouseApi.cleanWithTool dispatch (per-target schedules, spray/sweep
// refusals, the broom 0.66 cap, the oil patch's slower rate, the window
// two-path film drain, station pan/bag disposal) reaches shedCleanupComplete
// with no dev-tool state pokes; and it all survives an autosave + reload.
// Screenshots land in qa/shed_stage1/content/.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.SHED_QA_ROOT || path.join(repo, 'qa', 'shed_stage1', 'content'));
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  const fail = [];
  const expect = (cond, msg) => { if (!cond) fail.push(msg); return !!cond; };

  // authored contact poses (src/data/shedLayout.js TARGET_POSES), local coords
  const POSES = {
    'web:corner-nw': { x: -3.6, z: -2.6 }, 'web:corner-ne': { x: 3.6, z: -2.6 },
    'bench:grease': { x: -0.4, z: -2.35 }, 'wall:scuff-door': { x: 2.35, z: 2.9 },
    'floor:oil-patch': { x: 0.6, z: 0.2 }, 'shelf:dust': { x: -3.35, z: -0.2 },
    'entry:leaf-drift': { x: 1.2, z: 2.3 }, 'trash:cans': { x: -2.2, z: 0.6 },
    'trash:pizza-box': { x: -3.1, z: 2.1 },
    'window:south': { x: -2.0, z: 2.85 }, 'window:east': { x: 3.8, z: -0.5 },
  };

  const boot = async (fresh) => {
    await page.goto(`${baseUrl}?scene=shed${fresh ? '&fresh=1' : ''}`, { waitUntil: 'domcontentloaded' });
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

  await boot(true);

  // install toast + audio-cue captures on the live hooks (survive for the whole run)
  await page.evaluate(() => {
    window.__shedToasts = [];
    window.__shedCues = [];
    const walk = window.__fw.scene3d.walk;
    const orig = walk.hooks.toast;
    walk.hooks.toast = (msg, kind) => { window.__shedToasts.push({ msg, kind }); return orig?.(msg, kind); };
    const origSfx = walk.hooks.sfx;
    walk.hooks.sfx = (name) => { window.__shedCues.push(name); return origSfx?.(name); };
  });

  // ---- checklist HUD present with the five objective rows, not yet complete ------------
  const checklist0 = await page.evaluate(() => {
    const card = document.querySelector('.shed-checklist');
    const rows = document.querySelectorAll('.shed-checklist .shed-check-row');
    return { present: !!card, rows: rows.length, complete: !!card && card.classList.contains('is-complete') };
  });
  expect(checklist0.present, 'shed checklist card not mounted in the shed scene');
  expect(checklist0.rows === 5, `shed checklist row count ${checklist0.rows} != 5`);
  expect(!checklist0.complete, 'shed checklist marked complete before any cleaning');

  const ROOM = await page.evaluate(() => {
    const o = window.__fw.scene3d.clubhouse().interior.position;
    return { ox: o.x, oz: o.z };
  });

  // ---- 1. diagnostics ------------------------------------------------------------------
  const diag = await page.evaluate(() => window.__fw.scene3d.clubhouse().shedDiagnostics());
  expect(diag.targets === 11, `targets ${diag.targets} != 11`);
  expect(diag.films === 2, `films ${diag.films} != 2`);
  expect(diag.stations === 2, `stations ${diag.stations} != 2`);
  expect(diag.furniture === 7, `furniture ${diag.furniture} != 7`);
  expect(diag.grimePlane === true, 'grime plane missing');
  expect(diag.introShown === true, 'intro beat did not fire on boot');
  expect(diag.colliderCount >= 7 && diag.colliderCount <= 8,
    `colliderCount ${diag.colliderCount} (want shell 5 + furniture 3 = 8)`);

  // grime present in the shed cells before any cleaning
  const grime0 = await page.evaluate(() => {
    const g = window.__fw.state.shop.reno.grime;
    return { max: Math.max(...g), mean: +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(4) };
  });
  expect(grime0.max > 0.4, `floor grime not seeded (max ${grime0.max})`);

  // ---- 2. dirty-before screenshot from the door ----------------------------------------
  const place = (lx, lz, yaw, pitch, tool = null) => page.evaluate(async ({ lx, lz, yaw, pitch, tool, ROOM }) => {
    const walk = window.__fw.scene3d.walk;
    walk.setTool(tool);
    walk.state.x = ROOM.ox + lx; walk.state.z = ROOM.oz + lz;
    walk.state.yaw = yaw; walk.state.pitch = pitch; walk.state.active = true;
    await new Promise((r) => setTimeout(r, 220));
  }, { lx, lz, yaw, pitch, tool, ROOM });
  await place(1.2, 2.6, 0, -0.35); await page.screenshot({ path: path.join(out, '01-dirty-from-door.png') });

  // ---- 3. per-target schedule pass (real cleanWithTool at world coords) -----------------
  // burst helper: N steady contacts of one tool at a local target, returns the
  // last cleanWithTool result + the target progress after.
  const burst = (tool, id, dt, n) => page.evaluate(({ tool, id, dt, n, POSES, ROOM }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    const p = POSES[id];
    walk.setTool(tool);
    walk.state.x = ROOM.ox + p.x; walk.state.z = ROOM.oz + p.z; walk.state.active = true;
    let last = null;
    for (let i = 0; i < n; i++) last = ch.cleanWithTool(tool, ROOM.ox + p.x, ROOM.oz + p.z, 0, -1, dt);
    const prog = window.__fw.state.shop.reno.shed.targets[id] || 0;
    return { last, prog: +prog.toFixed(3) };
  }, { tool, id, dt, n, POSES, ROOM });
  // count single bursts until a target reaches 1 (rate probe)
  const burstsToComplete = (tool, id, dt, cap) => page.evaluate(({ tool, id, dt, cap, POSES, ROOM }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    const p = POSES[id];
    walk.setTool(tool);
    walk.state.x = ROOM.ox + p.x; walk.state.z = ROOM.oz + p.z; walk.state.active = true;
    let count = 0;
    while ((window.__fw.state.shop.reno.shed.targets[id] || 0) < 1 && count < cap) {
      ch.cleanWithTool(tool, ROOM.ox + p.x, ROOM.oz + p.z, 0, -1, dt);
      count++;
    }
    return { count, prog: +(window.__fw.state.shop.reno.shed.targets[id] || 0).toFixed(3) };
  }, { tool, id, dt, cap, POSES, ROOM });

  const t = {};
  // cobwebs: vacuum -> 1
  t.cobwebNW = await burst('vacuum', 'web:corner-nw', 0.1, 30);
  t.cobwebNE = await burst('vacuum', 'web:corner-ne', 0.1, 30);
  expect(t.cobwebNW.prog >= 1 && t.cobwebNE.prog >= 1, `cobwebs not vacuumed (${t.cobwebNW.prog}, ${t.cobwebNE.prog})`);
  // bench grease: sponge REFUSED before spray, then spray -> 0.28+, sponge -> 1
  t.benchRefuse = await burst('sponge', 'bench:grease', 0.1, 1);
  expect(t.benchRefuse.last.blocked && t.benchRefuse.last.reason === 'spray-first',
    `bench sponge-first not refused with spray-first (${JSON.stringify(t.benchRefuse.last)})`);
  t.benchSpray = await burst('spray', 'bench:grease', 0.1, 3);
  expect(t.benchSpray.prog >= 0.28, `bench spray did not snap to 0.28 (${t.benchSpray.prog})`);
  t.benchScrub = await burst('sponge', 'bench:grease', 0.1, 30);
  expect(t.benchScrub.prog >= 1, `bench grease not scrubbed to 1 (${t.benchScrub.prog})`);
  // wall scuff: spray -> cloth -> 1
  await burst('spray', 'wall:scuff-door', 0.1, 3);
  t.wall = await burst('cloth', 'wall:scuff-door', 0.1, 30);
  expect(t.wall.prog >= 1, `wall scuff not cleaned (${t.wall.prog})`);
  // oil patch: sponge, SLOWER than an equal-rate cloth target (shelf dust)
  t.oilBursts = await burstsToComplete('sponge', 'floor:oil-patch', 0.1, 200);
  t.shelfBursts = await burstsToComplete('cloth', 'shelf:dust', 0.1, 200);
  expect(t.oilBursts.prog >= 1, `oil patch not scrubbed (${t.oilBursts.prog})`);
  expect(t.shelfBursts.prog >= 1, `shelf dust not wiped (${t.shelfBursts.prog})`);
  expect(t.oilBursts.count > t.shelfBursts.count,
    `oil patch not slower than shelf (${t.oilBursts.count} vs ${t.shelfBursts.count} bursts)`);
  // leaf drift: trashbag REFUSED (sweep-first), broom caps at 0.66, trashbag -> 1
  t.leafRefuse = await burst('trashbag', 'entry:leaf-drift', 0.1, 1);
  expect(t.leafRefuse.last.blocked && t.leafRefuse.last.reason === 'sweep-first',
    `leaf trashbag-first not refused with sweep-first (${JSON.stringify(t.leafRefuse.last)})`);
  t.leafBroom = await burst('broom', 'entry:leaf-drift', 0.1, 40);
  expect(t.leafBroom.prog >= 0.65 && t.leafBroom.prog <= 0.661,
    `broom did not cap the leaf drift at 0.66 (${t.leafBroom.prog})`);
  t.leafBag = await burst('trashbag', 'entry:leaf-drift', 0.1, 6);
  expect(t.leafBag.prog >= 1, `leaf drift not bagged to 1 (${t.leafBag.prog})`);
  // trash cans: trashbag -> 1, bag load rises
  const bagBeforeCans = await page.evaluate(() => window.__fw.scene3d.clubhouse().bagLoad());
  t.cans = await burst('trashbag', 'trash:cans', 0.1, 20);
  const bagAfterCans = await page.evaluate(() => window.__fw.scene3d.clubhouse().bagLoad());
  expect(t.cans.prog >= 1, `trash cans not cleared (${t.cans.prog})`);
  expect(bagAfterCans > bagBeforeCans, `bag load did not rise cleaning cans (${bagBeforeCans} -> ${bagAfterCans})`);
  // pizza box: walk to it, focus label matches, E -> target 1, box hidden
  t.pizza = await page.evaluate(async ({ POSES, ROOM }) => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const p = POSES['trash:pizza-box'];
    walk.setTool(null);
    walk.state.x = ROOM.ox + p.x + 1.0; walk.state.z = ROOM.oz + p.z;
    walk.state.yaw = Math.PI / 2; walk.state.pitch = 0.2; walk.state.active = true; // face west toward the box
    let label = null;
    for (const [bk, pit] of [[1.0, 0.2], [0.9, 0.35], [1.15, 0.05]]) {
      walk.state.x = ROOM.ox + p.x + bk; walk.state.pitch = pit;
      await new Promise((r) => setTimeout(r, 220));
      label = walk.getFocusLabel();
      if (label && /pizza/i.test(label)) break;
    }
    const matched = !!(label && /pizza/i.test(label));
    if (matched) walk.interact();
    await new Promise((r) => setTimeout(r, 120));
    const scene = app.scene3d.scene;
    const box = scene.getObjectByName('SHED_PizzaBox');
    return { label, matched, prog: +(app.state.shop.reno.shed.targets['trash:pizza-box'] || 0).toFixed(3), boxVisible: box ? box.visible : 'absent' };
  }, { POSES, ROOM });
  expect(t.pizza.matched, `pizza box focus label not matched (${t.pizza.label})`);
  expect(t.pizza.prog >= 1, `pizza box not thrown out (${t.pizza.prog})`);
  expect(t.pizza.boxVisible === false, `pizza box still visible after disposal (${t.pizza.boxVisible})`);

  await place(0.5, 1.3, 0, -0.28); await page.screenshot({ path: path.join(out, '02-mid-clean-marks.png') });

  // ---- 4. windows: two-path film drain + milestone -------------------------------------
  const winMilestoneBefore = await page.evaluate(() => window.__fw.state.shop.reno.cleanupMilestones?.windows === true);
  const filmOpacity = (i) => page.evaluate((idx) => {
    const f = window.__fw.scene3d.scene.getObjectByName(`ShedDirtWindowFilm_${idx}`);
    return f ? +f.material.opacity.toFixed(3) : null;
  }, i);
  const winState = () => page.evaluate(() => window.__fw.state.shop.reno.windows.slice(0, 2).map((v) => +v.toFixed(3)));
  const win = {};
  win.filmBefore0 = await filmOpacity(0);
  win.beforeSpray = await winState();
  await burst('spray', 'window:south', 0.1, 1);
  win.afterSprayS = await winState();
  expect(win.afterSprayS[0] < win.beforeSpray[0] && win.afterSprayS[0] <= 0.71,
    `south spray did not loosen the film (${win.beforeSpray[0]} -> ${win.afterSprayS[0]})`);
  win.southCloth = await burst('cloth', 'window:south', 0.1, 20);
  win.afterClothS = await winState();
  expect(win.afterClothS[0] <= 0.01, `south window film not cleared (${win.afterClothS[0]})`);
  win.filmAfter0 = await filmOpacity(0);
  expect(win.filmAfter0 < win.filmBefore0 && win.filmAfter0 <= 0.24,
    `south film mesh not visually clear (opacity ${win.filmBefore0} -> ${win.filmAfter0})`);
  // east pane
  await burst('spray', 'window:east', 0.1, 1);
  await burst('cloth', 'window:east', 0.1, 20);
  win.afterBoth = await winState();
  expect(win.afterBoth[0] <= 0.01 && win.afterBoth[1] <= 0.01, `both panes not cleared (${JSON.stringify(win.afterBoth)})`);
  win.milestoneAfter = await page.evaluate(() => window.__fw.state.shop.reno.cleanupMilestones?.windows === true);
  expect(winMilestoneBefore === false && win.milestoneAfter === true,
    `windows milestone not recorded exactly on completion (before ${winMilestoneBefore}, after ${win.milestoneAfter})`);
  await place(-2.0, 1.1, Math.PI, 0.12); await page.screenshot({ path: path.join(out, '03-windows-clean.png') });

  // ---- checklist: a row flips DONE once its objective completes (both panes clear) -----
  await page.waitForTimeout(600); // let the 500 ms checklist interval refresh
  const winRow = await page.evaluate(() => {
    const r = document.querySelector('.shed-checklist .shed-check-row[data-id="windows"]');
    return { present: !!r, done: !!r && r.classList.contains('is-done') };
  });
  expect(winRow.present, 'windows checklist row missing');
  expect(winRow.done, 'windows checklist row did not flip done after both panes were cleared');

  // ---- 5. stations: mop service + collect debris + dispose -----------------------------
  // 5a. mop service at the bucket: use the mop (deplete), then wring at the station (E).
  const mopBefore = await page.evaluate(async ({ ROOM }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    walk.setTool('mop');
    walk.state.x = ROOM.ox + 0; walk.state.z = ROOM.oz + 0.5; walk.state.active = true;
    for (let i = 0; i < 60; i++) ch.cleanWithTool('mop', ROOM.ox + (i % 5 - 2) * 0.5, ROOM.oz + 0.5, 0, -1, 0.1);
    return +(window.__fw.state.shop.reno.cleaning.mop.charge).toFixed(2);
  }, { ROOM });
  const interactStation = (rx, rz, yaw, pitch, tool, labelRe, presses = 1) => page.evaluate(async ({ rx, rz, yaw, pitch, tool, labelReSrc, presses, ROOM }) => {
    const walk = window.__fw.scene3d.walk;
    const labelRe = new RegExp(labelReSrc, 'i');
    walk.setTool(tool);
    let label = null; let matched = false;
    for (const [bx, bz, pa] of [[rx, rz, 0], [rx, rz, 0.12], [rx, rz + 0.2, -0.05], [rx - 0.2, rz, 0.08]]) {
      walk.state.x = ROOM.ox + bx; walk.state.z = ROOM.oz + bz;
      walk.state.yaw = yaw; walk.state.pitch = pitch + pa; walk.state.active = true;
      await new Promise((r) => setTimeout(r, 240));
      label = walk.getFocusLabel();
      if (label && labelRe.test(label)) {
        matched = true;
        for (let k = 0; k < presses; k++) { walk.interact(); await new Promise((r) => setTimeout(r, 70)); }
        break;
      }
    }
    return { label, matched };
  }, { rx, rz, yaw, pitch, tool, labelReSrc: labelRe.source, presses, ROOM });
  // stand just SW of the bucket (3.35, 2.25) aiming NE-down at it
  const mopStation = await interactStation(2.6, 2.25, -Math.PI / 2, -0.35, 'mop', 'mop bucket');
  const mopAfter = await page.evaluate(() => ({
    charge: +(window.__fw.state.shop.reno.cleaning.mop.charge).toFixed(2),
    bucketLevel: +(window.__fw.state.shop.reno.cleaning.bucket.level).toFixed(3),
  }));
  expect(mopStation.matched, `mop bucket station focus not found (${mopStation.label})`);
  expect(mopAfter.charge > mopBefore, `mop not re-wrung at the bucket (${mopBefore} -> ${mopAfter.charge})`);

  await place(1.4, 1.5, -Math.PI / 2, -0.12); await page.screenshot({ path: path.join(out, '04-stations.png') });

  // 5b. collect ALL seeded debris (grit->pan, litter->bag) then dispose at the bin.
  const debrisStart = await page.evaluate(() => ({
    total: +window.__fw.scene3d.clubhouse().debrisTotal().toFixed(3),
    count: window.__fw.scene3d.clubhouse().debrisCount(),
    disposed: window.__fw.state.shop.reno.cleaning.bag.disposed,
  }));
  // sweep pass: at each current debris position, collect with dustpan + trashbag,
  // then run the bin's E (pan->bag, tie+dispose) — looped until everything is gone.
  const dispose = async () => {
    // stand WEST of the bin (3.45, 0.9) facing east; four E presses resolve the
    // sequence: empty the pan into the bag, then tie & dispose the loaded bag.
    await interactStation(2.5, 0.9, -Math.PI / 2, -0.3, 'trashbag', 'waste bin', 4);
  };
  let debrisEnd = null;
  for (let round = 0; round < 10; round++) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(({ ROOM }) => {
      const ch = window.__fw.scene3d.clubhouse();
      const walk = window.__fw.scene3d.walk;
      const list = (window.__fw.state.shop.reno.debris || []).map((d) => ({ x: d.x, z: d.z }));
      for (const tool of ['dustpan', 'trashbag']) {
        walk.setTool(tool);
        for (const d of list) {
          // Clusters seeded under the workbench collider (z in [-3.1,-2.0]) refuse
          // direct contact; collect them from the bench front, still inside the
          // 0.76 collect radius.
          const cz = d.z < -1.9 ? d.z + 0.6 : d.z;
          walk.state.x = ROOM.ox + d.x; walk.state.z = ROOM.oz + cz; walk.state.active = true;
          for (let i = 0; i < 6; i++) ch.cleanWithTool(tool, ROOM.ox + d.x, ROOM.oz + cz, 0, -1, 0.1);
        }
      }
    }, { ROOM });
    // eslint-disable-next-line no-await-in-loop
    await dispose();
    // eslint-disable-next-line no-await-in-loop
    debrisEnd = await page.evaluate(() => {
      const c = window.__fw.state.shop.reno.cleaning;
      return {
        total: +window.__fw.scene3d.clubhouse().debrisTotal().toFixed(3),
        pan: +c.pan.load.toFixed(3), bag: +c.bag.load.toFixed(3), disposed: c.bag.disposed,
      };
    });
    if (debrisEnd.total <= 0.02 && debrisEnd.pan <= 0.02 && debrisEnd.bag <= 0.02 && debrisEnd.disposed >= 1) break;
  }
  expect(debrisEnd.total <= 0.02, `debris not fully collected (${debrisStart.total} -> ${debrisEnd.total})`);
  expect(debrisEnd.pan <= 0.02 && debrisEnd.bag <= 0.02, `pan/bag not emptied (pan ${debrisEnd.pan}, bag ${debrisEnd.bag})`);
  expect(debrisEnd.disposed >= 1, `no bag disposed at the waste station (${debrisEnd.disposed})`);

  // ---- 6. full-clean finale: mop/vacuum every shed floor cell, reach completion --------
  const floorFinale = await page.evaluate(({ ROOM }) => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    walk.setTool('vacuum');
    walk.state.active = true;
    // The 20 seeded shed cells are cx 4..8 x cy 2..5. Four of them sit UNDER
    // furniture colliders (workbench: (-1.38,0,1.38 @ -2.06); crate: (-2.75 @
    // 2.06)) where the cleaning gate refuses contact — so those are cleaned from
    // an adjacent unblocked point whose 0.9 radius still reaches the cell centre.
    const contacts = [];
    const xs = [-2.75, -1.38, 0, 1.38, 2.75];
    const zs = [-2.06, -0.69, 0.69, 2.06];
    for (const x of xs) for (const z of zs) contacts.push([x, z]);
    contacts.push([-1.38, -1.4], [0, -1.4], [1.38, -1.4]); // reach under the workbench
    contacts.push([-2.75, 1.35]);                          // reach under the crate stack
    for (let pass = 0; pass < 4; pass++) {
      for (const [x, z] of contacts) {
        walk.state.x = ROOM.ox + x; walk.state.z = ROOM.oz + z;
        for (let i = 0; i < 8; i++) ch.cleanWithTool('vacuum', ROOM.ox + x, ROOM.oz + z, 0, 0, 0.1);
      }
    }
    const g = window.__fw.state.shop.reno.grime;
    // shed cells (centres inside the footprint) must all be clean
    let maxShed = 0;
    let worst = -1;
    for (let cy = 2; cy <= 5; cy++) for (let cx = 4; cx <= 8; cx++) {
      const v = g[cy * 13 + cx];
      if (v > maxShed) { maxShed = v; worst = cy * 13 + cx; }
    }
    return { maxShedCell: +maxShed.toFixed(4), worstCell: worst };
  }, { ROOM });
  expect(floorFinale.maxShedCell <= 0.01, `shed floor cells not clean (max ${floorFinale.maxShedCell})`);
  // let the update-loop completion watch fire (throttled ~0.3s in shedInterior.update)
  await page.waitForTimeout(700);
  const done = await page.evaluate(() => {
    const state = window.__fw.state;
    return {
      // completedAt is set ONLY inside shedCleanupComplete when it first returns
      // true — a set completedAt is proof the predicate flipped with no dev poke.
      completedAt: state.shop.reno.shed.completedAt,
      targetsAll: Object.values(state.shop.reno.shed.targets).every((v) => v >= 1),
      toastSpotless: window.__shedToasts.some((x) => /spotless/i.test(x.msg)),
      toastCobweb: window.__shedToasts.some((x) => /cobweb/i.test(x.msg)),
      // completion beat + per-target sparkle cues routed through the SFX hook
      completionCue: window.__shedCues.includes('clubhouse-restoration-complete'),
      sparkleCue: window.__shedCues.includes('shed-target-complete'),
    };
  });
  expect(done.targetsAll, 'not all targets complete at finale');
  expect(Number.isFinite(done.completedAt), `reno.shed.completedAt not set — shedCleanupComplete never flipped (${done.completedAt})`);
  expect(done.toastSpotless, 'completion toast "spotless" not observed');
  expect(done.toastCobweb, 'per-target completion toast not observed');
  expect(done.sparkleCue, 'per-target sparkle cue (shed-target-complete) never fired through the SFX hook');
  expect(done.completionCue, 'completion beat cue (clubhouse-restoration-complete) not observed at finale');

  // ---- checklist flips to a DONE state when the shed is finished -----------------------
  await page.waitForTimeout(600);
  const checklistDone = await page.evaluate(() => {
    const card = document.querySelector('.shed-checklist');
    const rows = [...document.querySelectorAll('.shed-checklist .shed-check-row')];
    return {
      complete: !!card && card.classList.contains('is-complete'),
      done: rows.filter((r) => r.classList.contains('is-done')).length,
      total: rows.length,
    };
  });
  expect(checklistDone.complete, 'shed checklist did not flip to its complete state at finale');
  expect(checklistDone.done === 5 && checklistDone.total === 5,
    `not every checklist row is done at finale (${checklistDone.done}/${checklistDone.total})`);

  // ---- refusal (warn-class) toast lifetime is capped <= 3 s ----------------------------
  const refusal = await page.evaluate(async () => {
    window.__fw.scene3d.walk.hooks.clearToasts?.();
    await new Promise((r) => setTimeout(r, 200));
    window.__fw.scene3d.walk.hooks.toast('Loosen it with spray first.', 'warn');
    await new Promise((r) => setTimeout(r, 150));
    const present = !!document.querySelector('.notification-invalid');
    const start = performance.now();
    while (document.querySelector('.notification-invalid') && performance.now() - start < 3400) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return { present, gone: !document.querySelector('.notification-invalid'), goneBy: Math.round(performance.now() - start) };
  });
  expect(refusal.present, 'refusal toast did not render');
  expect(refusal.gone && refusal.goneBy <= 3000, `refusal toast lifetime > 3 s (present ${refusal.present}, goneBy ${refusal.goneBy} ms)`);

  await place(1.2, 2.6, 0, -0.3); await page.screenshot({ path: path.join(out, '05-all-clean-from-door.png') });

  // ---- 7. persistence: autosave, reload (no fresh), assert everything persists ---------
  await page.evaluate(async () => { await window.__fw.autosave(); });
  await boot(false);
  const persisted = await page.evaluate(() => {
    const s = window.__fw.state.shop.reno;
    return {
      completedAt: s.shed.completedAt,
      targetsAll: Object.values(s.shed.targets).every((v) => v >= 1),
      windows: s.windows.slice(0, 2).map((v) => +v.toFixed(3)),
      debris: +(s.debris || []).reduce((a, d) => a + (d.a || 0), 0).toFixed(3),
      disposed: s.cleaning.bag.disposed,
    };
  });
  expect(persisted.targetsAll, 'targets did not persist across reload');
  expect(Number.isFinite(persisted.completedAt), `completedAt did not persist (${persisted.completedAt})`);
  expect(persisted.windows[0] <= 0.01 && persisted.windows[1] <= 0.01, `windows did not persist clean (${JSON.stringify(persisted.windows)})`);
  expect(persisted.debris <= 0.02, `debris did not persist cleared (${persisted.debris})`);

  // ---- 8. notification scoping: no course/campaign leak on a fresh shed boot ------------
  // Re-boot fresh (the tractor + greenskeeper notes would fire at boot if unscoped), then watch the
  // notification centre across a 60 s idle and assert neither course banner ever appears. The shed's
  // own (shedScoped) toasts still pass the gate. Override the idle with SHED_LEAK_IDLE_MS for CI speed.
  await boot(true);
  const idleMs = Number(process.env.SHED_LEAK_IDLE_MS || 60000);
  const leak = await page.evaluate(async (ms) => {
    const texts = [];
    const scan = () => { for (const n of document.querySelectorAll('.notification-message')) texts.push(n.textContent || ''); };
    const ui = document.getElementById('ui');
    const obs = new MutationObserver(scan);
    if (ui) obs.observe(ui, { childList: true, subtree: true, characterData: true });
    scan();
    await new Promise((r) => setTimeout(r, ms));
    scan();
    obs.disconnect();
    const joined = texts.join(' | ');
    return {
      idleMs: ms,
      greenskeeper: /greenskeeper/i.test(joined),
      tractor: /tractor/i.test(joined),
      sample: [...new Set(texts.filter(Boolean))].slice(0, 8),
    };
  }, idleMs);
  expect(!leak.greenskeeper, `greenskeeper note leaked into the shed (samples: ${leak.sample.join(' / ')})`);
  expect(!leak.tractor, `tractor note leaked into the shed (samples: ${leak.sample.join(' / ')})`);

  expect(errors.length === 0, `console/page errors: ${JSON.stringify(errors.slice(0, 6))}`);

  const ok = fail.length === 0;
  return {
    ok, fail,
    diagnostics: diag,
    grimeSeed: grime0,
    targets: t,
    windows: win,
    mop: { before: mopBefore, ...mopAfter, station: mopStation.matched },
    debris: { start: debrisStart, end: debrisEnd },
    floorFinale, completion: done, persisted,
    checklist: { rows: checklist0.rows, winRowDone: winRow.done, finaleComplete: checklistDone.complete, finaleDone: checklistDone.done },
    refusal, leak,
    errors, shots: out,
  };
}
