async (page) => {
  // DIRT VISIBILITY — the two systems House Flipper needs, and the reticle.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/dirt-visibility.js
  //
  // Play-test: "I cannot tell what still needs cleaning… Shop condition 9 —
  // filthy tells me a number but never where."
  //   1. hold-to-reveal (Q), through geometry, fading, cancelled by using a tool
  //   2. the overview camera marks WHERE the dirt is (HF1's minimap complaint)
  //   3. the reticle confirms the thing under the crosshair is cleanable
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/dirt-visibility');
  fs.mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = -0.12;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.waitForTimeout(900);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2200);

  const sense = () => page.evaluate(() => window.__fw.scene3d.walk.dirtSense());
  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n) }); };
  const out = {};

  // ---- 1. baseline: no reveal ---------------------------------------------
  out.idle = await sense();
  await shot('01-idle-no-reveal.png');

  // ---- 2. hold Q: the reveal, through geometry ----------------------------
  await page.keyboard.down('q');
  await page.waitForTimeout(700);
  out.held = await sense();
  await shot('02-holding-q.png');

  // ---- 3. release: it lingers, then fades ---------------------------------
  await page.keyboard.up('q');
  await page.waitForTimeout(600);
  out.justReleased = await sense();
  await page.waitForTimeout(4200);
  out.faded = await sense();
  await shot('03-after-fade.png');

  // ---- 4. using the tool cancels it ---------------------------------------
  await page.keyboard.down('q');
  await page.waitForTimeout(600);
  const beforeUse = await sense();
  await page.mouse.down();
  await page.waitForTimeout(500);
  out.cancelledByUse = { before: beforeUse.alpha, after: (await sense()).alpha };
  await page.mouse.up();
  await page.keyboard.up('q');
  await page.waitForTimeout(3000);

  // ---- 5. the reticle over cleanable dirt ---------------------------------
  // Walk toward the nearest cluster until the crosshair reports it.
  const aimed = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk;
    const diag = ch.dirtSenseDiagnostics();
    if (!diag.clusters) return { ok: false, why: 'no debris in the room' };
    // find a cluster in local space and stand a stride short of it, facing it
    const list = app.state.shop.reno.debris.filter((d) => d && d.a > 0.001);
    if (!list.length) return { ok: false, why: 'no debris entries' };
    const o = ch.interior.position;
    // Pick the cluster nearest the middle of the room, so the shot is not
    // facing a window — a real focus (a filthy pane) legitimately outranks the
    // dirt reticle, and testing against one measures the wrong thing.
    const target = list.slice().sort((a, b) =>
      (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z))[0];
    const tx = o.x + target.x;
    const tz = o.z + target.z;
    // stand back along +z and look DOWN at it; the crosshair-to-floor solve
    // means the stand-off and the pitch have to agree
    const back = 1.15;
    w.state.x = tx;
    w.state.z = tz + back;
    w.state.yaw = 0; // forward is -z
    w.state.pitch = -Math.atan2(1.62, back);
    window.__dirtTarget = { tx, tz };
    return { ok: true, tx: +tx.toFixed(2), tz: +tz.toFixed(2) };
  });
  await page.waitForTimeout(900);
  // The walker is pushed out of colliders after a teleport, so aim from where
  // it actually ENDED UP rather than from where we asked it to stand.
  const reaim = await page.evaluate(() => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const t = window.__dirtTarget;
    if (!t) return null;
    const dx = t.tx - w.state.x;
    const dz = t.tz - w.state.z;
    const flat = Math.hypot(dx, dz);
    // forward is (-sin yaw, -cos yaw)
    w.state.yaw = Math.atan2(-dx, -dz);
    const ch = app.scene3d.clubhouse();
    const eyeY = app.scene3d.camera.position.y
      - (ch.groundYAt ? ch.groundYAt(w.state.x, w.state.z) : w.state.y - 1.62);
    w.state.pitch = -Math.atan2(eyeY, Math.max(0.35, flat));
    return {
      standX: +w.state.x.toFixed(2), standZ: +w.state.z.toFixed(2),
      flat: +flat.toFixed(2), eyeY: +eyeY.toFixed(2), pitch: +w.state.pitch.toFixed(3),
    };
  });
  await page.waitForTimeout(700);
  out.reticle = { placement: aimed, reaim, sense: await sense() };
  out.reticlePrompt = await page.evaluate(() => {
    const el = document.querySelector('.shop-prompt');
    return { text: el?.textContent || '', opacity: el ? getComputedStyle(el).opacity : null };
  });
  // A real focus (a desk, a filthy pane) legitimately outranks the dirt
  // reticle, so to see the dirt prompt itself we need a pile that is not also
  // standing in front of a prop. Try clusters until one is clear.
  out.dirtPrompt = { tried: 0, found: null };
  for (let i = 0; i < 10 && !out.dirtPrompt.found; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const step = await page.evaluate((idx) => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      const ch = app.scene3d.clubhouse();
      const list = app.state.shop.reno.debris.filter((d) => d && d.a > 0.001);
      if (idx >= list.length) return { done: true };
      const o = ch.interior.position;
      const t = list[idx];
      const tx = o.x + t.x;
      const tz = o.z + t.z;
      w.state.x = tx; w.state.z = tz + 1.3; w.state.yaw = 0; w.state.pitch = -0.9;
      return { done: false, tx: +tx.toFixed(2), tz: +tz.toFixed(2) };
    }, i);
    if (step.done) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(280);
    // eslint-disable-next-line no-await-in-loop
    const res = await page.evaluate((t) => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      const ch = app.scene3d.clubhouse();
      const dx = t.tx - w.state.x;
      const dz = t.tz - w.state.z;
      const flat = Math.hypot(dx, dz);
      w.state.yaw = Math.atan2(-dx, -dz);
      const eyeY = app.scene3d.camera.position.y - ch.groundYAt(w.state.x, w.state.z);
      w.state.pitch = -Math.atan2(eyeY, Math.max(0.35, flat));
      return null;
    }, step);
    void res;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(320);
    // eslint-disable-next-line no-await-in-loop
    const probe = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      const el = document.querySelector('.dirt-reticle');
      return {
        focus: w.getFocus() ? (w.getFocus().label || w.getFocus().kind) : null,
        aimed: w.dirtSense().aimed,
        reticleText: el?.textContent || '',
        reticleShown: el ? getComputedStyle(el).display !== 'none' : false,
      };
    });
    out.dirtPrompt.tried += 1;
    // The dedicated reticle label must show whether or not a prop also has
    // focus — that independence is the whole point of giving it its own node.
    if (probe.aimed && probe.reticleShown && probe.reticleText) {
      out.dirtPrompt.found = probe;
      // eslint-disable-next-line no-await-in-loop
      await shot('06-reticle-dirt-prompt.png');
    }
  }
  await shot('04-reticle-over-dirt.png');

  // the lower-left affordance
  out.hint = await page.evaluate(() => {
    const el = document.querySelector('.dirt-sense-hint');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { display: cs.display, text: el.textContent.replace(/\s+/g, ' ').trim() };
  });

  // ---- 6. the overview marks WHERE ----------------------------------------
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1800);
  out.overview = await page.evaluate(() => ({
    mode: window.__fw.courseMode,
    overlay: window.__fw.scene3d.clubhouse().dirtSenseDiagnostics(),
  }));
  await shot('05a-overview-as-opened.png');
  // The overview opens looking at the COURSE, so park it over the clubhouse to
  // prove the columns clear the roof and read from above. How far the player
  // has to pan to see them is reported honestly rather than hidden.
  out.overviewFramed = await page.evaluate(() => {
    const app = window.__fw;
    const cam = app.scene3d.camera;
    const o = app.scene3d.clubhouse().interior.position;
    const before = { x: +cam.position.x.toFixed(1), z: +cam.position.z.toFixed(1) };
    cam.position.set(o.x + 1, 26, o.z + 20);
    cam.lookAt(o.x, 1.5, o.z);
    cam.updateMatrixWorld(true);
    return {
      panFromDefaultYd: +Math.hypot(before.x - o.x, before.z - o.z).toFixed(1),
      cameraBefore: before,
    };
  });
  await page.waitForTimeout(700);
  await shot('05b-overview-over-clubhouse.png');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200);
  out.backToWalk = await page.evaluate(() => ({
    mode: window.__fw.courseMode,
    overlay: window.__fw.scene3d.clubhouse().dirtSenseDiagnostics(),
  }));

  fs.writeFileSync(path.join(OUT, 'dirt-visibility.json'), JSON.stringify(out, null, 2));

  const problems = [];
  if (!(out.idle.alpha < 0.05)) problems.push('reveal is on before the key is pressed');
  if (!(out.held.alpha > 0.9)) problems.push(`hold did not reveal (alpha ${out.held.alpha})`);
  if (!out.held.overlay?.drawsThroughGeometry) problems.push('markers do not draw through geometry');
  if (!(out.held.overlay?.markers > 0)) problems.push('no markers placed');
  if (!(out.faded.alpha < 0.05)) problems.push(`did not fade (alpha ${out.faded.alpha})`);
  if (!(out.cancelledByUse.after < out.cancelledByUse.before)) problems.push('using the tool did not cancel it');
  if (out.hint?.display === 'none') problems.push('lower-left affordance hidden while dirt remains');
  if (!out.reticle.sense?.aimed) problems.push('crosshair over a pile did not register as cleanable');
  if (!out.dirtPrompt.found) problems.push('no pile produced a cleanable prompt on the reticle');
  else if (!/sweep/i.test(out.dirtPrompt.found.reticleText)) {
    problems.push(`reticle prompt reads "${out.dirtPrompt.found.reticleText}"`);
  }
  if (!out.overview.overlay?.columns) problems.push('overview did not switch to column markers');
  if (out.backToWalk.overlay?.alpha > 0.05) problems.push('overview markers survived the return to walking');
  return { ok: problems.length === 0, problems, ...out };
}
