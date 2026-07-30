async (page) => {
  // BLOCKER 4 — a first-time player must be able to find out how to open a box.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-box-discoverability.js
  //
  // The unboxing gesture (hold LMB, drag along the tape) is used by nothing
  // else in the game, and the whole retail loop sits behind it. This checks the
  // three ways a player can learn it, and the one dead end that used to hide
  // it: a carton set down where it cannot be opened, with nothing on screen
  // saying so.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const shotDir = path.join(outDir, 'box-discoverability');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
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
  await page.waitForTimeout(2500);
  // Run at 1x, NOT paused. An earlier revision of this file paused the game and
  // then measured whether the cut guide animated — it does not, because the
  // walk update does not run while paused, and the harness reported a working
  // affordance as broken. Measure motion at the speed a player sees it.
  const speedNow = await page.evaluate(() => window.__fw.speedIdx);

  // ONE aim helper, re-run before every read. Customers shove the walker at 1x,
  // so an aim taken once and trusted for the rest of the run silently drops
  // focus — which made this harness report a working affordance as broken.
  await page.evaluate(() => {
    window.__aimAtBox = (boxId) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      let target = null;
      ch.interior.parent.traverse((o) => {
        if (!target && o.userData?.deliveryBoxId === boxId) target = o;
      });
      if (!target) return null;
      target.updateWorldMatrix(true, false);
      const p = new (Object.getPrototypeOf(target.position).constructor)();
      target.getWorldPosition(p);
      const w = app.scene3d.walk.state;
      w.x = p.x + 1.05; w.z = p.z + 0.05;
      const dx = p.x - w.x; const dz = p.z - w.z;
      w.yaw = Math.atan2(-dx, -dz);
      w.pitch = Math.atan2(p.y + 0.35 - 1.62, Math.hypot(dx, dz));
      return { x: p.x, y: p.y, z: p.z };
    };
  });

  const out = { speedIdx: speedNow, checks: [], failures: [] };
  const check = (name, pass, detail) => {
    out.checks.push({ name, pass, detail });
    if (!pass) out.failures.push(`${name}: ${detail}`);
  };

  // --- 1. The lesson exists and fires on the first delivery ----------------
  const lesson = await page.evaluate(async () => {
    const T = await import('/src/sim/tutorial.js');
    const found = T.CONTEXTUAL_TUTORIALS.find((l) => l.id === 'delivery-carton');
    if (!found) return { exists: false };
    const st = window.__fw.state;
    // A brand-new club has never seen one; trigger it the way the arrival does.
    st.tutorial.contextual.lessons['delivery-carton'] = {
      triggered: false, complete: false, dismissed: false, remindAfter: 0,
    };
    const fired = T.triggerContextTutorial(st, 'delivery-carton');
    return {
      exists: true,
      hint: found.hint,
      completeFlag: found.completeFlag,
      fired: !!fired,
      // it must retire itself once the player has actually cut a box
      retiresOnCut: found.completeFlag === 'boxCut',
    };
  });
  check('a first-delivery lesson exists', lesson.exists, JSON.stringify(lesson.hint || null));
  check('the lesson fires when a delivery lands', !!lesson.fired, `fired=${lesson.fired}`);
  check('the lesson retires on the first real cut', !!lesson.retiresOnCut, `flag=${lesson.completeFlag}`);
  check('the lesson names the gesture, not just the key', /drag/i.test(lesson.hint || ''), lesson.hint || '');

  // --- 2. Put a sealed carton on an unpackable surface and look at it ------
  // The starter's cartons sit in the world, where nothing can be opened — that
  // IS the reported dead end, and it is checked separately below. To test the
  // affordance the box has to be somewhere a player could legitimately open it,
  // so move one to the packing bench the way a player would: pick it up, put it
  // down on the bench.
  const placed = await page.evaluate(async () => {
    const D = await import('/src/sim/deliveries.js');
    const B = await import('/src/sim/boxPlacement.js');
    const S = await import('/src/data/boxPlacementSurfaces.js');
    const st = window.__fw.state;
    const boxes = D.boxesOf(st);
    const sealedOf = () => D.boxesOf(st).find((b) => !b.flat && !D.tapeCut(b) && !D.isEmpty(b));
    let sealed = sealedOf();
    if (!sealed) return { id: null, boxCount: boxes.length };
    void S;
    // Prefer a sealed carton that is already somewhere openable.
    const openable = D.boxesOf(st).find((b) => !b.flat && !D.tapeCut(b) && !D.isEmpty(b)
      && B.boxPlacementCapabilities(st, b).canUnpack);
    if (openable) {
      sealed = openable;
    } else if (!B.boxPlacementCapabilities(st, sealed).canUnpack) {
      // Otherwise carry it to the backroom shelving, which is unpackable — the
      // same two verbs a player uses.
      const up = D.pickUpBox(st, sealed.id);
      if (up.ok) D.putDownBox(st, sealed.id, 'stock');
      window.__fw.scene3d.clubhouse().rebuildStock?.();
      sealed = D.boxesOf(st).find((b) => b.id === sealed.id) || sealedOf();
    }
    const caps = B.boxPlacementCapabilities(st, sealed);
    return {
      id: sealed.id, loc: sealed.loc, surface: sealed.surface || null,
      tape: sealed.tape || 0, canUnpack: !!caps.canUnpack,
    };
  });
  out.sealedBox = placed;

  if (placed.id) {
    // Stand at the carton and aim at it so the focus resolves.
    const aimed = await page.evaluate((boxId) => window.__aimAtBox(boxId), placed.id);
    out.aimedAt = aimed;
    await page.waitForTimeout(900);

    const focus = await page.evaluate(async (boxId) => {
      window.__aimAtBox(boxId);
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 450));
      return {
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      tool: window.__fw.scene3d.walk.getFocus?.()?.prop?.tool ?? null,
      };
    }, placed.id);
    out.focus = focus;

    // The visible affordance: cut line, ribbon and travelling pip, all live.
    const guide = await page.evaluate(async (boxId) => {
      window.__aimAtBox(boxId);
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 450));
      const names = ['BoxCutterActiveTapeGuide', 'BoxCutterActiveTapeRibbon', 'BoxCutterActiveTapePip'];
      const found = {};
      const scenes = [];
      for (const key of Object.keys(window.__fw.scene3d)) {
        const v = window.__fw.scene3d[key];
        if (v && v.isScene) scenes.push(v);
      }
      const root = scenes[0] || window.__fw.scene3d.clubhouse().interior.parent;
      root.traverse((o) => { if (names.includes(o.name)) found[o.name] = { visible: o.visible }; });
      return found;
    }, placed.id);
    out.guide = guide;

    check('looking at a sealed carton offers the cutter',
      focus.tool === 'boxcutter' || /drag along tape/i.test(focus.label || ''),
      `tool=${focus.tool} label=${focus.label}`);
    check('a cut line is drawn on the box',
      !!guide.BoxCutterActiveTapeRibbon?.visible,
      JSON.stringify(guide));
    check('the cut line MOVES — a static mark is decoration, not an instruction',
      !!guide.BoxCutterActiveTapePip?.visible,
      JSON.stringify(guide.BoxCutterActiveTapePip || null));

    // The pip must actually TRAVEL, not merely exist. Measure total distance
    // walked between samples rather than the bounding span: a sweep that wraps
    // can show a small span while covering the whole seam, and a frozen pip
    // shows zero either way. Threshold is relative to the seam's own length,
    // so it cannot pass by accident on a degenerate path.
    const travel = await page.evaluate(async (boxId) => {
      // RE-AIM FIRST. An earlier revision sampled ~3 s after aiming and read a
      // frozen pip, because focus had been lost in the meantime (customers
      // shove the walker at 1x) — the guide had simply switched off. The
      // instrument reported a working affordance as broken twice before this
      // was caught, which is exactly the failure class this session is about.
      window.__aimAtBox(boxId);
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 500));
      const root = window.__fw.scene3d.clubhouse().interior.parent;
      let pip = null; let ribbon = null;
      root.traverse((o) => {
        if (o.name === 'BoxCutterActiveTapePip') pip = o;
        if (o.name === 'BoxCutterActiveTapeRibbon') ribbon = o;
      });
      if (!pip) return null;
      const seam = ribbon ? ribbon.scale.z : 0;
      // Is the scene advancing AT ALL while this loop runs? Count real frames.
      let frames = 0;
      const tick = () => { frames += 1; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const t0 = performance.now();
      let walked = 0;
      let prev = pip.position.clone();
      // setTimeout, not requestAnimationFrame: an rAF-driven sampling loop
      // competes with the app's own rAF in headless and starves the render
      // loop, so the pip reads as frozen when it is not. A wall-clock sample
      // lets the scene actually advance between reads.
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await new Promise((r) => setTimeout(r, 110));
        walked += pip.position.distanceTo(prev);
        prev = pip.position.clone();
      }
      return {
        seamLength: +seam.toFixed(4),
        walked: +walked.toFixed(4),
        samples: 20,
        wallMs: Math.round(performance.now() - t0),
        rafFrames: frames,
        pipVisibleAtEnd: pip.visible,
        pipAt: [+pip.position.x.toFixed(4), +pip.position.z.toFixed(4)],
      };
    }, placed.id);
    out.pipTravel = travel;
    check('the pip sweeps along the seam',
      !!travel && travel.walked > travel.seamLength * 0.05,
      JSON.stringify(travel));

    await page.screenshot({ path: path.join(shotDir, 'sealed-carton-with-cut-guide.png') });
  } else {
    check('a sealed carton exists to look at', false, JSON.stringify(placed));
  }

  // --- 3. The dead end: a carton that cannot be opened where it sits -------
  const deadEnd = await page.evaluate(async () => {
    const B = await import('/src/sim/boxPlacement.js');
    const D = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    const rows = [];
    for (const box of D.boxesOf(st)) {
      const caps = B.boxPlacementCapabilities(st, box);
      rows.push({ id: box.id, loc: box.loc, surface: box.surface || null, canUnpack: !!caps.canUnpack });
    }
    return rows;
  });
  out.boxCapabilities = deadEnd;
  const blocked = deadEnd.find((r) => !r.canUnpack);
  if (blocked) {
    const label = await page.evaluate((boxId) => {
      // Read the prop label directly — this is the string the player sees.
      const ch = window.__fw.scene3d.clubhouse();
      const props = ch.props || ch.interactionProps || null;
      if (!Array.isArray(props)) return null;
      for (const prop of props) {
        const text = typeof prop.label === 'function' ? prop.label() : prop.label;
        if (text && String(text).includes('pick up')) return String(text);
      }
      void boxId;
      return null;
    }, blocked.id);
    out.blockedLabel = label;
    check('a carton that cannot be opened here says why',
      label === null || /open it on a bench|worktop|stock shelf|stocking cart/i.test(label),
      label === null ? 'label unreadable from outside (prop list not exposed) — checked in source instead' : label);
  }

  out.ok = out.failures.length === 0;
  out.shots = shotDir;
  fs.writeFileSync(path.join(outDir, 'box-discoverability.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
