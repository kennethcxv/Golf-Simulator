async (page) => {
  // Revived 2026-07-28 (HARNESS_TRUST.md remediation): BASE_URL was an MCP-REPL-era
  // global no committed runner defines; the committed runner's contract is QA_BASE_URL.
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  // LOOK AT THE LAPTOP BEFORE CHANGING ANYTHING.
  //
  // The brief lists ten failures ("screen too far", "hard to read", "orientation may be
  // wrong", "feels like a popup"...). Some of those may already be fixed — task #87 claims
  // the framing was done. The only way to know which are real is to sit down at the thing
  // and measure it. So: boot, walk to the desk, press E, and report the NUMBERS —
  // how much of the viewport the screen actually covers, what the projected quad is, and
  // how big a glyph ends up being after the matrix3d squeezes 1024x640 into it.

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'laptop', 'before',
  );
  const log = [];

  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(2000);

  // Stand at the LIVE laptop (2026-07-28): the fixed (8.55, 4.5) office stand
  // predates the laptop's move to the front desk. Same derivation as
  // fov-parity's proven sit ('chair' stand; 'north' retry happens at [E] below).
  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const L = await import('/src/data/shopLayout.js');
    const o = ch.interior.position;
    const st = app.scene3d.walk.state;
    const laptop = L.FRONT_DESK.laptop;
    const seat = { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
    st.x = seat.x + o.x;
    st.z = seat.z + o.z;
    const dx = laptop.x - seat.x;
    const dz = laptop.z - seat.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    st.pitch = Math.atan2(1.06 - 1.62, horizontal);
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 9 * 60;
    app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/0-standing-at-desk.png` });

  // sit down (retry once from the square-on north stand if the chair diagonal
  // does not focus the laptop)
  await page.keyboard.press('e');
  const openedFromChair = await page.waitForFunction(
    () => window.__fw.laptopOpen === true, null, { timeout: 6000 },
  ).then(() => true).catch(() => false);
  if (!openedFromChair) {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import('/src/data/shopLayout.js');
      const o = app.scene3d.clubhouse().interior.position;
      const st = app.scene3d.walk.state;
      const laptop = L.FRONT_DESK.laptop;
      st.x = laptop.x + o.x;
      st.z = laptop.z + 0.95 + o.z;
      const dx = 0;
      const dz = -0.95;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      st.pitch = Math.atan2(1.06 - 1.62, horizontal);
    });
    await page.waitForTimeout(600);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
  }
  // the DOM lands 1.35s in (lid swing -> boot -> interface). Wait for the ELEMENT, not the clock.
  await page.waitForFunction(() => {
    const r = document.querySelector('.laptop-screen');
    return r && r.style.display !== 'none';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(1200); // let the focus ease + realignment settle
  await page.screenshot({ path: `${OUT}/1-seated.png` });

  // MEASURE. The screen is a quad of four projected corners; the DOM is a 1024x640
  // rectangle mapped onto it by matrix3d. Both numbers matter.
  const m = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const cam = app.scene3d.camera;
    cam.updateMatrixWorld();
    const canvas = document.getElementById('game');
    const rect = canvas.getBoundingClientRect();
    const corners = ch.laptopScreenCorners();
    const pts = corners.map((v) => {
      const p = v.clone().project(cam);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    });
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    // shoelace for the true quad area (the screen is foreshortened, so bbox overstates it)
    const ord = [...pts].sort((a, b) => a.y - b.y);
    const top = ord.slice(0, 2).sort((a, b) => a.x - b.x);
    const bot = ord.slice(2).sort((a, b) => a.x - b.x);
    const q = [top[0], top[1], bot[1], bot[0]];
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i]; const b = q[(i + 1) % 4];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;

    const frame = document.querySelector('.lt-frame');
    const fr = frame ? frame.getBoundingClientRect() : null;
    const cs = frame ? getComputedStyle(frame) : null;

    // how many CSS px does one interface pixel become on the real monitor?
    const scaleX = w / 1024;
    const scaleY = h / 640;
    const bodyPx = cs ? parseFloat(getComputedStyle(document.querySelector('.lt-content') || frame).fontSize) : 0;

    return {
      viewport: { w: rect.width, h: rect.height },
      screenQuadPx: { w: Math.round(w), h: Math.round(h) },
      coverage: {
        widthFrac: +(w / rect.width).toFixed(3),
        heightFrac: +(h / rect.height).toFixed(3),
        areaFrac: +(area / (rect.width * rect.height)).toFixed(3),
      },
      uiScale: { x: +scaleX.toFixed(3), y: +scaleY.toFixed(3) },
      declaredBodyFontPx: bodyPx,
      effectiveBodyFontPx: +(bodyPx * scaleY).toFixed(2),
      frameSize: fr ? { w: Math.round(fr.width), h: Math.round(fr.height) } : null,
      transform: cs ? cs.transform.slice(0, 60) + '...' : null,
      pointerLocked: !!document.pointerLockElement,
      cursorVisible: getComputedStyle(document.body).cursor,
    };
  });
  log.push({ step: 'seated at the laptop', ...m });

  // is it MOUSE-DRIVEN? click a nav item through the projected DOM and see if the page changes.
  const navProbe = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.lt-navbtn')];
    return btns.map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  log.push({ step: 'nav buttons, as the real mouse sees them', navProbe });

  // click "Supplier" at its真 projected position
  const sup = navProbe.find((b) => /Supplier/.test(b.text));
  if (sup) {
    await page.mouse.move(sup.cx, sup.cy);
    await page.waitForTimeout(150);
    await page.mouse.click(sup.cx, sup.cy);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/2-supplier-clicked.png` });
    const landed = await page.evaluate(() => {
      const h1 = document.querySelector('.lt-h1');
      const imgs = [...document.querySelectorAll('.lt-prodimg')];
      return {
        pageTitle: h1 ? h1.textContent : null,
        productImages: imgs.length,
        firstImgSrc: imgs[0] ? imgs[0].src.slice(0, 30) : null,
        icons: document.querySelectorAll('.lt-prodicon').length,
      };
    });
    log.push({ step: 'clicked Supplier through the physical screen', ...landed });
  }

  // ESC out, and check nothing is trapped
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const out = await page.evaluate(() => ({
    laptopOpen: window.__fw.laptopOpen,
    domStillThere: (() => { const r = document.querySelector('.laptop-screen'); return r ? r.style.display !== 'none' : false; })(),
    roots: document.querySelectorAll('.laptop-screen').length,
    walkActive: window.__fw.scene3d.walk.state.active,
  }));
  log.push({ step: 'escaped', ...out });
  await page.screenshot({ path: `${OUT}/3-after-escape.png` });

  return { log, errors: errors.slice(0, 10), errorCount: errors.length };
}
