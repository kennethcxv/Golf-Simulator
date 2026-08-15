async (page) => {
  // IS THE LAPTOP SEARCH BAR THERE, AND CAN THE PLAYER SEE IT?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/laptop-search-visible.js
  //
  // Reported 2026-07-29: "I see no search bar at all. Either it did not ship or it is not
  // rendering. Find out which, fix it, and show me a screenshot with it visible."
  //
  // Both halves are separable and both get measured:
  //   SHIPPED â€” is there an .lt-search element in the DOM at all.
  //   RENDERING â€” does it have a real box, inside the laptop screen, on screen, not
  //     transparent, not zero-width, and not covered by something else.
  //
  // "Present in the DOM" is the answer to the first and says nothing about the second. The
  // laptop screen is an HTML surface transformed onto the 3D lid, so an element can exist,
  // have CSS, and still be clipped, squeezed to nothing by its flex siblings, or projected
  // off the visible quad.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Sit at the desk laptop the way the player does. Derived from the live datums rather
  // than a fixed coordinate: the laptop has moved once already, and a probe standing at its
  // old spot photographs an empty desk.
  const seated = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const origin = ch.interior.position;
    const st = app.scene3d.walk.state;
    const laptop = (() => {
        // D1: the LIVE rig rather than the layout datum.
        //
        // NOT because the datum was stale — it was the first hypothesis and it
        // is wrong. Measured 2026-08-04: the rig sits at interior-local
        // (-2.550, 1.557) and FRONT_DESK.laptop reads (-2.550, 1.557). B8 moved
        // the datum with the machine. This is here so a future move of one
        // without the other cannot silently re-open the same investigation; the
        // interior group carries no rotation, so local == world - origin, which
        // is the frame the surrounding maths is already written in.
        const ch = app.scene3d.clubhouse();
        const rig = ch.laptopRig ? ch.laptopRig() : null;
        const node = rig && rig.object;
        if (!node) return L.FRONT_DESK.laptop;
        ch.interior.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        return { x: m[12] - ch.interior.position.x, z: m[14] - ch.interior.position.z };
      })();
    const seat = { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
    st.x = seat.x + origin.x;
    st.z = seat.z + origin.z;
    const dx = laptop.x - seat.x;
    const dz = laptop.z - seat.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    // Pitch AT the lid, not a guessed -0.25: the laptop screen sits at y 1.06 against a
    // 1.62 eye height, and the focus only engages when the crosshair is actually on it.
    st.pitch = Math.atan2(1.06 - 1.62, horizontal);
    const clock = app.state.clock;
    clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 9 * 60; // daylight, so the shot is readable
    app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
    return { seat, laptop: { x: laptop.x, z: laptop.z } };
  });
  await page.waitForTimeout(900);

  // OPEN IT THE WAY THE PLAYER DOES, with the retry the proven laptop drivers use. The
  // chair diagonal does not always focus the lid; a square-on stand does. The first version
  // of this probe pressed E once, never opened the laptop, and then measured .lt-search
  // inside a screen whose display was 'none' â€” reporting a zero-width field and calling it
  // "not rendering", which was a fact about the probe.
  await page.keyboard.press('KeyE');
  let laptopOpen = await page.waitForFunction(
    () => (() => { const a = window.__fw; if (!a || a.laptopOpen !== true) return false; const s = document.querySelector('.laptop-screen'); if (!s || s.style.display === 'none') return false; const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); if (!(r.width > 100 && r.height > 60)) return false; const p = window.__qaLtFrame || {}; window.__qaLtFrame = { x: r.left, w: r.width }; return Math.abs((p.x ?? -1e6) - r.left) < 0.5 && Math.abs((p.w ?? -1e6) - r.width) < 0.5; })(), null, { timeout: 6000 },
  ).then(() => true).catch(() => false);
  if (!laptopOpen) {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const origin = app.scene3d.clubhouse().interior.position;
      const st = app.scene3d.walk.state;
      const laptop = (() => {
        // D1: the LIVE rig rather than the layout datum.
        //
        // NOT because the datum was stale — it was the first hypothesis and it
        // is wrong. Measured 2026-08-04: the rig sits at interior-local
        // (-2.550, 1.557) and FRONT_DESK.laptop reads (-2.550, 1.557). B8 moved
        // the datum with the machine. This is here so a future move of one
        // without the other cannot silently re-open the same investigation; the
        // interior group carries no rotation, so local == world - origin, which
        // is the frame the surrounding maths is already written in.
        const ch = app.scene3d.clubhouse();
        const rig = ch.laptopRig ? ch.laptopRig() : null;
        const node = rig && rig.object;
        if (!node) return L.FRONT_DESK.laptop;
        ch.interior.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        return { x: m[12] - ch.interior.position.x, z: m[14] - ch.interior.position.z };
      })();
      st.x = laptop.x + origin.x;
      st.z = laptop.z + 0.95 + origin.z;
      st.yaw = Math.atan2(0, 0.95);
      st.pitch = Math.atan2(1.06 - 1.62, 0.95);
    });
    await page.waitForTimeout(700);
    await page.keyboard.press('KeyE');
    laptopOpen = await page.waitForFunction(
      () => (() => { const a = window.__fw; if (!a || a.laptopOpen !== true) return false; const s = document.querySelector('.laptop-screen'); if (!s || s.style.display === 'none') return false; const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); if (!(r.width > 100 && r.height > 60)) return false; const p = window.__qaLtFrame || {}; window.__qaLtFrame = { x: r.left, w: r.width }; return Math.abs((p.x ?? -1e6) - r.left) < 0.5 && Math.abs((p.w ?? -1e6) - r.width) < 0.5; })(), null, { timeout: 9000 },
    ).then(() => true).catch(() => false);
  }
  // The DOM lands ~1.35 s in: lid swing, then boot, then the interface. Wait for the
  // ELEMENT to be shown rather than for a clock.
  if (laptopOpen) {
    await page.waitForFunction(() => {
      const r = document.querySelector('.laptop-screen');
      return r && r.style.display !== 'none';
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1400);
  }
  const opened = await page.evaluate(() => ({
    laptopOpen: !!window.__fw?.laptopOpen,
    screenPresent: !!document.querySelector('.laptop-screen'),
    screenDisplay: document.querySelector('.laptop-screen')?.style.display ?? null,
  }));

  const measure = await page.evaluate(() => {
    const field = document.querySelector('.lt-search');
    const screen = document.querySelector('.laptop-screen');
    const status = document.querySelector('.lt-status');
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1),
      };
    };
    const style = (node) => {
      if (!node) return null;
      const cs = getComputedStyle(node);
      return {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        flexBasis: cs.flexBasis,
        minWidth: cs.minWidth,
        width: cs.width,
        background: cs.backgroundColor,
        overflow: cs.overflow,
      };
    };
    // Is any ancestor hiding it, and is any ancestor clipping it?
    let hiddenBy = null;
    let clippedBy = null;
    if (field) {
      const fieldRect = field.getBoundingClientRect();
      let node = field.parentElement;
      while (node) {
        const cs = getComputedStyle(node);
        if (!hiddenBy && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) {
          hiddenBy = node.className || node.tagName;
        }
        if (!clippedBy && (cs.overflow === 'hidden' || cs.overflowX === 'hidden')) {
          const r = node.getBoundingClientRect();
          const clipped = fieldRect.right > r.right + 0.5 || fieldRect.left < r.left - 0.5
            || fieldRect.bottom > r.bottom + 0.5 || fieldRect.top < r.top - 0.5;
          if (clipped) clippedBy = node.className || node.tagName;
        }
        node = node.parentElement;
      }
    }
    return {
      // SHIPPED?
      inDom: !!field,
      placeholder: field?.placeholder ?? null,
      // RENDERING?
      fieldBox: box(field),
      fieldStyle: style(field),
      screenBox: box(screen),
      statusBox: box(status),
      statusChildren: status
        ? [...status.children].map((c) => ({
          cls: c.className || c.tagName,
          w: +c.getBoundingClientRect().width.toFixed(1),
        }))
        : null,
      hiddenBy,
      clippedBy,
      // Does a hit test at the field's own centre land ON the field? If something is drawn
      // over it, the player cannot see or click it however good its box is.
      topmostAtCentre: (() => {
        if (!field) return null;
        const r = field.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (!hit) return null;
        return { cls: hit.className || hit.tagName, isTheField: hit === field };
      })(),
      viewport: { w: innerWidth, h: innerHeight },
    };
  });

  const onScreen = !!measure.fieldBox
    && measure.fieldBox.width > 8 && measure.fieldBox.height > 6
    && measure.fieldBox.x + measure.fieldBox.width > 0
    && measure.fieldBox.y + measure.fieldBox.height > 0
    && measure.fieldBox.x < measure.viewport.w
    && measure.fieldBox.y < measure.viewport.h;

  await page.screenshot({ path: path.join(outDir, 'laptop-search-full.png') });
  if (onScreen) {
    const pad = 40;
    await page.screenshot({
      path: path.join(outDir, 'laptop-search-field.png'),
      clip: {
        x: Math.max(0, measure.fieldBox.x - pad),
        y: Math.max(0, measure.fieldBox.y - pad),
        width: Math.min(measure.viewport.w - Math.max(0, measure.fieldBox.x - pad), measure.fieldBox.width + pad * 2),
        height: Math.min(measure.viewport.h - Math.max(0, measure.fieldBox.y - pad), measure.fieldBox.height + pad * 2),
      },
    });
  }

  // And it has to WORK, not just be visible: type into it and confirm results appear.
  let typed = null;
  if (onScreen) {
    await page.click('.lt-search');
    await page.type('.lt-search', 'towel', { delay: 40 });
    await page.waitForTimeout(500);
    typed = await page.evaluate(() => ({
      value: document.querySelector('.lt-search')?.value ?? null,
      resultRows: document.querySelectorAll('.lt-searchhit, .lt-row, .lt-card').length,
      bodyText: (document.querySelector('.lt-main')?.textContent || '').slice(0, 400),
    }));
    await page.screenshot({ path: path.join(outDir, 'laptop-search-typed.png') });
  }

  const findings = {
    shipped: measure.inDom,
    renderedWithARealBox: onScreen,
    fieldBox: measure.fieldBox,
    hiddenByAncestor: measure.hiddenBy,
    clippedByAncestor: measure.clippedBy,
    coveredBy: measure.topmostAtCentre && !measure.topmostAtCentre.isTheField
      ? measure.topmostAtCentre.cls : null,
    laptopOpened: !!measure.screenBox && measure.screenBox.width > 20,
    acceptsTyping: typed?.value === 'towel',
    searchProducedResults: !!typed && /towel/i.test(typed.bodyText || ''),
  };

  const result = {
    what: 'the laptop search field: shipped versus rendering, measured and shot',
    seated,
    opened,
    measure,
    typed,
    findings,
    shots: ['laptop-search-full.png', onScreen ? 'laptop-search-field.png' : null, typed ? 'laptop-search-typed.png' : null].filter(Boolean),
    errs: errs.slice(0, 12),
    ok: findings.shipped
      && findings.laptopOpened
      && findings.renderedWithARealBox
      && !findings.hiddenByAncestor
      && !findings.clippedByAncestor
      && !findings.coveredBy
      && findings.acceptsTyping
      && findings.searchProducedResults
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'laptop-search.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
