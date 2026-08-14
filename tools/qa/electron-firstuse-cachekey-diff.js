// ROUND 7 — WHY does a material that ALREADY DREW during the warm compile a
// SECOND program on the player's first gesture?
//
// The owner's framing, and it is the right one: three keys a program on the
// RENDER CONTEXT, not on the material. Lights affecting the object, shadow
// settings, fog, tone mapping, clipping planes and the output colour space all
// go into the cache key (vendor/three.module.js:7811 getProgramCacheKeyParameters).
// So "the material drew during the warm" is not the same claim as "the program
// the turn needs was built during the warm", and every warm attempt so far has
// assumed it was.
//
// This does not guess. renderer.properties.get(material).programs is a Map of
// EVERY cache key that material has ever compiled, so when the turn adds a
// second one the FIRST one is still sitting there beside it, on the same
// material. Decoding both and diffing them field by field names the exact
// render-context condition the warm is not reproducing -- which is the answer,
// not a lead.
//
// The decoder is not new: tools/qa/lib/goal24-program-ownership.mjs already
// maps a cache key back to its material and to its named parameters. This
// driver supplies the two moments to compare.
//
// NEGATIVE CONTROLS (golf-qa law 1), both of which must read zero or the
// instrument is measuring its own snapshot boundary rather than the gesture:
//   idle          -- a window of the same length with NO gesture in it
//   <gesture>_2nd -- the same gesture a second time, which by the owner's own
//                    report ("everything after is instant") cannot compile
//
//   node tools/qa/run-electron.cjs tools/qa/electron-firstuse-cachekey-diff.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { pathToFileURL } = process.getBuiltinModule('node:url');
  const OUT = path.resolve('qa/electron/firstuse-cachekey');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], gestures: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const repo = process.cwd();
  const ownership = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-program-ownership.mjs',
  )).href);
  const factorySource = ownership.goal24ProgramOwnershipProbeFactorySource();

  const bootPath = `${repo}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(7000); // past the deferred warm
  out.warmState = await page.evaluate(() => window.__fwWarm ?? null);
  // A green run with the warm phase silently skipped is indistinguishable from a
  // green run where it worked, unless the phase reports itself. prewarmTimings
  // carries a label per phase and the tool warm pushes its own COUNT.
  out.prewarmTimings = await page.evaluate(() => {
    const t = window.__fw.scene3d.prewarmTimings?.() ?? null;
    return Array.isArray(t) ? t.map((x) => ({ label: x.label, ms: x.ms })) : t;
  });
  out.gesturePhases = (out.prewarmTimings || []).filter((t) => String(t.label).startsWith('gesture'));
  // What the ledger's warm gesture actually MANAGED. "gesture-ledger ran for
  // 315 ms" is compatible with a book that opened and never got a leaf into the
  // air, which warms nothing and looks identical from outside.
  out.ledgerGesture = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse?.()?.ledgerBook?.prewarmGestureReport?.() ?? null));
  console.log('LEDGER-GESTURE', JSON.stringify(out.ledgerGesture));
  out.loadTotalMs = (out.prewarmTimings || []).find((t) => t.label === 'TOTAL')?.ms ?? null;

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(500);

  const keys = () => page.evaluate(() => (
    (window.__fw.scene3d.renderer.info.programs || []).map((p) => String(p.cacheKey || ''))));
  const counters = () => page.evaluate(() => {
    const info = window.__fw.scene3d.renderer.info;
    return { textures: info.memory.textures, geometries: info.memory.geometries };
  });

  // One gesture: snapshot, run it, snapshot, and -- only if a program arrived --
  // ask the renderer which material owns it and what the same material's older
  // program differs by.
  const gesture = async (label, run, settleMs = 2500) => {
    const before = await keys();
    const cBefore = await counters();
    await run();
    await page.waitForTimeout(settleMs);
    const after = await keys();
    const cAfter = await counters();
    const beforeSet = new Set(before);
    const arrivals = after.filter((k) => !beforeSet.has(k));
    const row = {
      label,
      programDelta: after.length - before.length,
      arrivalCount: arrivals.length,
      textureDelta: cAfter.textures - cBefore.textures,
      geometryDelta: cAfter.geometries - cBefore.geometries,
      ownership: null,
    };
    if (arrivals.length) {
      row.ownership = await page.evaluate(({ src, arrivalKeys, referenceKeys }) => {
        const s3 = window.__fw.scene3d;
        const createProbe = (0, eval)(src);
        return createProbe().capture({
          renderer: s3.renderer,
          scene: s3.scene,
          arrivalKeys,
          referenceKeys,
        });
      }, { src: factorySource, arrivalKeys: arrivals, referenceKeys: before });
    }
    out.gestures.push(row);
    // The console line carries only what a human needs to read: who compiled,
    // and which named fields the older program of that same material disagrees
    // on. The full capture goes to the JSON.
    const brief = {
      label,
      arrivals: row.arrivalCount,
      tex: row.textureDelta,
      geo: row.geometryDelta,
      owners: (row.ownership?.arrivals || []).map((a) => ({
        material: a.materialOwners[0]?.material?.name
          || a.materialOwners[0]?.material?.type || '(unattributed)',
        meshes: (a.materialOwners[0]?.matchingOwners || []).map((o) => o.name).slice(0, 3),
        nearestDistance: a.nearestExisting?.distance ?? null,
        sameMaterial: a.nearestExisting?.sameMaterial ?? null,
        DIFFERS_BY: (a.nearestExisting?.differences || []).map(
          (d) => `${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`,
        ),
      })),
    };
    console.log('CACHEKEY', JSON.stringify(brief, null, 2));
    return row;
  };

  // ---- CONTROL: an idle window of the same length ---------------------------
  await gesture('control_idle', async () => {}, 2500);

  // ---- THE TEE DESK, which is register.enter() ------------------------------
  //
  // The owner's "tee desk" is the counter prop in clubhouse.js whose label reads
  // "Tee desk - [E] arrivals, check-ins and walk-ins" and whose action is
  // register.enter(). It is NOT the outdoor "Starter desk" by the first tee --
  // that one's action routes to enterFrontDesk(), which bails because nothing in
  // src/ ever assigns frontDeskUi, and a driver aimed there measures a press
  // that opens nothing.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2; w.vx = 0; w.vz = 0;
  });
  await page.waitForTimeout(900);
  // The prompt is the proof the press lands on the desk rather than on air.
  out.teeDeskFocus = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() ?? null);
  console.log('TEE-DESK-FOCUS', JSON.stringify(out.teeDeskFocus));
  await gesture('teeDesk_enter_1st', () => page.keyboard.press('e'), 3200);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(1200);
  await gesture('teeDesk_enter_2nd_CONTROL', () => page.keyboard.press('e'), 2600);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(1000);

  // ---- the ledger, driven by the REAL key presses ---------------------------
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch.ledgerBook?.root;
    if (!r) return;
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    let dx = c.x - e[12]; let dz = c.z - e[14];
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    w.x = e[12] + dx * 1.9; w.z = e[14] + dz * 1.9; w.vx = 0; w.vz = 0;
    const lx = e[12] - w.x; const lz = e[14] - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    const eye = window.__fw.scene3d?.camera?.position?.y;
    w.pitch = Math.atan2(e[13] - (Number.isFinite(eye) ? eye : 1.62), h);
  });
  await page.waitForTimeout(1200);
  await gesture('ledger_raise', () => page.keyboard.press('k'), 2400);
  await gesture('ledger_open', () => page.keyboard.press('e'), 2800);
  await gesture('pageTurn_1st', () => page.keyboard.press('e'), 2600);
  await gesture('pageTurn_2nd_CONTROL', () => page.keyboard.press('e'), 2400);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook?.setOpen(false));
  await page.waitForTimeout(1600);

  // ---- every cleaning tool, in belt order -----------------------------------
  //
  // ALL of them, not the one the deferred warm happens to equip. That warm
  // equips 'dustpan' and nothing else, so a driver that measures the dustpan is
  // measuring the intervention's own target and will report every tool warm.
  const belt = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    return (typeof w.beltOrder === 'function' ? w.beltOrder() : null)
      || ['washer', 'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag'];
  });
  out.belt = belt;
  for (const tool of belt) {
    await gesture(`equip_${tool}`, () => page.evaluate(
      (t) => window.__fw.scene3d.walk.setTool(t), tool,
    ), 2200);
  }
  // and one of them again, as the control on the tool half
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(800);
  await gesture(`equip_${belt[0]}_2nd_CONTROL`, () => page.evaluate(
    (t) => window.__fw.scene3d.walk.setTool(t), belt[0],
  ), 2200);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));

  out.gestureWarmRan = {
    phases: out.gesturePhases,
    prewarmTotalMs: out.loadTotalMs,
  };
  console.log('GESTURE-WARM-PHASES', JSON.stringify(out.gestureWarmRan));
  out.summary = out.gestures.map((g) => ({
    label: g.label,
    arrivals: g.arrivalCount,
    tex: g.textureDelta,
    geo: g.geometryDelta,
    differsBy: (g.ownership?.arrivals || []).flatMap(
      (a) => (a.nearestExisting?.differences || []).map((d) => d.field),
    ),
  }));
  fs.writeFileSync(path.join(OUT, 'cachekey-diff.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('FIRSTUSE-CACHEKEY', JSON.stringify(out.summary, null, 2));
  return out;
}
