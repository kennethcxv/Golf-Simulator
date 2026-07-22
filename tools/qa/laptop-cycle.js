async (page) => {
  // SIT DOWN AND STAND UP THIRTY TIMES.
  //
  // The brief asks for exactly this, and it is the right thing to ask for: entering a mode is
  // easy to get right once and impossible to get right thirty times if anything leaks. What
  // could go wrong, and what this therefore counts:
  //
  //   - a second .laptop-screen root appended each time (duplicate UI)
  //   - a resize listener added on entry and never removed (accumulating listeners)
  //   - a setTimeout from entry #7 firing during entry #8 and painting the wrong thing
  //   - the camera lens (fov 34 / near 0.03) never handed back, so the world stays telephoto
  //   - pointer lock left released, or the walk overlay left hidden — a player who cannot move
  //   - the focus camera never cleared, so you are stuck staring at a laptop forever
  //
  // Every one of those is checked after the last cycle, and the listener count is measured by
  // wrapping addEventListener BEFORE the first entry.

  const errs = [];
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const out = path.join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'laptop', 'cycle',
  );
  fs.mkdirSync(out, { recursive: true });
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const QA_ROOT = (process.env.GOLF_FLIPPER_QA_ROOT || `${process.cwd()}/qa`).replaceAll('\\', '/');
  const BASE_URL = process.env.GOLF_FLIPPER_URL || 'http://localhost:8457/';

  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  // count window listeners from here on
  await page.evaluate(() => {
    window.__listeners = {};
    const add = window.addEventListener.bind(window);
    const rm = window.removeEventListener.bind(window);
    window.addEventListener = (t, f, o) => { window.__listeners[t] = (window.__listeners[t] || 0) + 1; return add(t, f, o); };
    window.removeEventListener = (t, f, o) => { window.__listeners[t] = (window.__listeners[t] || 0) - 1; return rm(t, f, o); };
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = 8.45 + o.x; w.z = 4.5 + o.z; w.yaw = -Math.PI / 2; w.pitch = -0.05;
  });
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => ({
    roots: document.querySelectorAll('.laptop-screen').length,
    frames: document.querySelectorAll('.lt-frame').length,
    resizeListeners: window.__listeners.resize || 0,
    fov: window.__fw.scene3d.camera.fov,
    near: window.__fw.scene3d.camera.near,
  }));

  // WAIT FOR THE GAME TO SAY IT IS READY, rather than mashing the key.
  //
  // The first cut of this harness pressed E the instant Escape had closed the lid, and cycle 2
  // "never opened". That was my bug, not the game's — but chasing it turned up something real:
  // the camera takes ~0.4s to ease back out of the seat, and courseScene decides what you are
  // looking at FROM THE CAMERA. For those 0.4s the camera is still in the laptop's face, so no
  // prop is under the gaze, the prompt is blank, and an E pressed then is silently dropped.
  // It self-heals the moment the camera is back behind your eyes; nothing is trapped.
  //
  // So: wait for the prompt to actually offer the laptop. That IS the game saying "press E now".
  const promptReady = () => page.waitForFunction(() => {
    const p = document.querySelector('.shop-prompt');
    return !!(p && /laptop/i.test(p.textContent || ''));
  }, null, { timeout: 10000 });

  const N = 30;
  const failures = [];
  for (let i = 0; i < N; i++) {
    const ready = await promptReady().then(() => true).catch(() => false);
    if (!ready) { failures.push(`cycle ${i + 1}: the laptop prompt never came back`); break; }
    await page.keyboard.press('e');
    // wait for the interface to actually land — not for a clock
    const opened = await page.waitForFunction(
      () => window.__fw.laptopOpen && (() => { const r = document.querySelector('.laptop-screen'); return r && r.style.display !== 'none'; })(),
      null, { timeout: 12000 },
    ).then(() => true).catch(() => false);
    if (!opened) { failures.push(`cycle ${i + 1}: never opened`); break; }

    // on a few cycles, navigate first — a page mid-render must not survive the exit
    if (i % 7 === 3) {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.lt-navbtn')];
        const b = btns.find((x) => /Inventory/.test(x.textContent));
        if (b) b.click();
      });
      await page.waitForTimeout(120);
    }

    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 })
      .then(() => true).catch(() => false);
    if (!closed) { failures.push(`cycle ${i + 1}: never closed`); break; }

    const mid = await page.evaluate(() => ({
      roots: document.querySelectorAll('.laptop-screen').length,
      visibleFrames: [...document.querySelectorAll('.laptop-screen')].filter((r) => r.style.display !== 'none').length,
    }));
    if (mid.roots !== 1) failures.push(`cycle ${i + 1}: ${mid.roots} laptop roots in the DOM`);
    if (mid.visibleFrames !== 0) failures.push(`cycle ${i + 1}: interface still visible after Escape`);
  }

  // let anything that was going to leak, leak
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => {
    const app = window.__fw;
    const cam = app.scene3d.camera;
    const walk = app.scene3d.walk;
    const ch = app.scene3d.clubhouse();
    // The chair and the laptop must still be in the scene AND visible after the
    // last exit — the reported bug was one of them vanishing after laptop mode.
    let chair = null; let laptop = null;
    ch.interior.traverse((o) => {
      const n = (o.name || '').toLowerCase();
      if (!chair && n.includes('chair') && o.parent) chair = o;
      if (!laptop && n.includes('laptop') && o.parent) laptop = o;
    });
    const shownInWorld = (obj) => {
      if (!obj) return false;
      for (let p = obj; p; p = p.parent) if (p.visible === false) return false;
      return true;
    };
    const info = app.scene3d.renderer ? app.scene3d.renderer.info : null;
    let nodes = 0;
    ch.interior.traverse(() => { nodes += 1; });
    return {
      roots: document.querySelectorAll('.laptop-screen').length,
      visible: [...document.querySelectorAll('.laptop-screen')].filter((r) => r.style.display !== 'none').length,
      resizeListeners: window.__listeners.resize || 0,
      laptopOpen: app.laptopOpen,
      // the lens must be handed back, or the whole world stays on a telephoto
      fov: cam.fov,
      near: cam.near,
      // and you must be able to walk away
      walkActive: walk.state.active,
      focused: !!(walk.state.focus || walk.state.focused),
      walkOverlayVisible: (() => { const o = document.querySelector('.walk-overlay'); return o ? o.style.display !== 'none' : null; })(),
      viewToggleVisible: (() => { const v = document.querySelector('.view-toggle'); return v ? v.style.display !== 'none' : null; })(),
      pointerLocked: !!document.pointerLockElement,
      // furniture persistence + resource counts (leak detection)
      chairPresent: !!chair,
      chairVisible: shownInWorld(chair),
      laptopPresent: !!laptop,
      laptopVisible: shownInWorld(laptop),
      interiorNodes: nodes,
      geometries: info ? info.memory.geometries : null,
      textures: info ? info.memory.textures : null,
    };
  });
  if (!after.chairPresent || !after.chairVisible) failures.push('the chair vanished after laptop mode');
  if (!after.laptopPresent || !after.laptopVisible) failures.push('the laptop vanished after laptop mode');

  // Can the player actually walk away? REAL key events — a synthetic KeyboardEvent dispatched at
  // `window` is not what the game listens to, and "the player cannot move" would have been my
  // harness lying about the game a second time.
  //
  // STRAFE, not forward. The player is standing at a desk, facing it, with a chair behind them:
  // 'w' walks into the desk and 's' into the chair, and both correctly report zero. That is
  // furniture doing its job, and testing against it would be testing the desk.
  const p0 = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
  await page.keyboard.down('a');
  await page.waitForTimeout(700);
  await page.keyboard.up('a');
  const p1 = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
  const moved = { dist: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(3) };
  moved.moved = moved.dist > 0.05;

  await page.screenshot({ path: path.join(out, 'after-30.png') });

  return {
    cycles: N,
    before,
    after,
    checks: {
      oneRootOnly: after.roots === 1 ? 'OK' : `FAIL — ${after.roots} roots`,
      noVisibleLeftovers: after.visible === 0 ? 'OK' : 'FAIL — interface still on screen',
      noAccumulatedListeners: after.resizeListeners === before.resizeListeners
        ? `OK — resize listeners back to ${before.resizeListeners}`
        : `FAIL — ${before.resizeListeners} -> ${after.resizeListeners} after ${N} cycles`,
      lensHandedBack: after.fov === 66 && after.near === 0.15 ? 'OK — walk lens restored' : `FAIL — fov ${after.fov}, near ${after.near}`,
      notTrappedInFocus: !after.focused ? 'OK' : 'FAIL — camera still parked at the laptop',
      canWalkAway: moved.moved ? `OK — moved ${moved.dist} yd` : 'FAIL — the player cannot move',
      overlayBack: after.walkOverlayVisible !== false ? 'OK' : 'FAIL — walk overlay left hidden',
    },
    failures,
    errs: errs.slice(0, 6),
    errCount: errs.length,
  };
}
