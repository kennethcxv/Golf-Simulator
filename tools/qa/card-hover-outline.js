// VERIFY2_K card leg — hovering the presented card must draw the card's
// OUTLINE only. The refuted version framed the card's own CHIP mesh too,
// painting a solid patch in the middle of the face; the fix suppresses flat
// child meshes under 30% of the piece's largest flat footprint. Verdict from
// WebGL-only captures (canvas.toDataURL after an explicit render) so the DOM
// tip chip cannot pollute the diff, cropped to the card's screen region.
//
// FIXTURE: a CHECK-IN payment held at 'card-entry'. Every flow auto-inserts
// the customer's own card within ~a second of presentation (CardInsertReady
// -> beginAutomaticCardInsert -> setWorkspace re-frames the camera), so no
// mouse-driven protocol can hold a hover on the presented card - two runs
// proved every capture pair straddles the re-frame. 'card-entry' waits for
// the PLAYER's amount, so it holds indefinitely: the card sits seated in the
// reader, the workspace camera is parked, and the driver applies the REAL
// highlight through register.debugCardGrabOutline (same setGrabOutline the
// pick calls; the pick step is proven by the cash hover drivers).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* verdict skipped */ }
  const OUT = path.resolve('qa/electron/card-hover-k3');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const staged = await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
    app.scene3d.applyTimeWeather(10 * 60, app.state.weather);
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    const customer = clubhouse.sendWalkInToDesk({});
    if (!customer) return null;
    customer.paymentPreference = 'card';
    customer.payMethod = 'card';
    customer.partySize = 1;
    return { customerId: customer.customerId };
  });
  assert(staged, 'walk-in did not spawn');
  await page.waitForFunction((id) => {
    const desk = window.__fw.scene3d.clubhouse().frontDeskBridge?.();
    const entry = (desk?.walkIns?.() || []).find((w) => w.customerId === id);
    return !!(entry && entry.phase === 'walk-in-waiting' && entry.queueIndex === 0);
  }, staged.customerId, { timeout: 60000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const clickMonitor = async (actionId, label) => {
    const point = await page.evaluate((id) => (
      window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
    ), actionId);
    assert(point && point.inView, `${label}: hotspot ${actionId} not on screen`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
  };
  await clickMonitor('tab-check-in', 'check-in tab');
  await clickMonitor(`select-walkin:${staged.customerId}`, 'walk-in row');
  const firstSlot = await page.evaluate((id) => (
    (window.__fw.scene3d.clubhouse().frontDeskBridge().walkInSlotsFor(id) || [])[0] || null
  ), staged.customerId);
  assert(firstSlot, 'no bookable slot for the walk-in');
  await clickMonitor(
    `select-walkin-slot:${staged.customerId}:${firstSlot.dayAbs}:${firstSlot.minute}`,
    'first offered slot',
  );
  // an AUTO-inserted card completes the whole payment by itself - the stable
  // 'card-entry' hold only exists after a PLAYER-clicked insert. Click the
  // presented card inside the pre-insert window (the ledger driver's proven
  // beat), then the reader waits indefinitely for the player's amount with
  // the card seated in view.
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const presentedPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(presentedPoint?.inView, 'presented card not in view for the insert click');
  await page.mouse.click(presentedPoint.x, presentedPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  // the workspace camera ease + doorway dark-state blend both settle over a
  // couple of seconds - captures taken mid-ramp differ globally
  await page.waitForTimeout(2500);

  // park the mouse for the WHOLE protocol - the highlight is applied through
  // the QA hook, so the pointer contributes zero deltas
  await page.mouse.move(VIEWPORT.width - 40, 60);
  await page.waitForTimeout(500);
  const glShot = async (name) => {
    const dataUrl = await page.evaluate(() => {
      const scene3d = window.__fw.scene3d;
      scene3d.renderer.render(scene3d.scene, scene3d.camera);
      return document.querySelector('canvas').toDataURL('image/png');
    });
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    return buf;
  };
  // A/B/C protocol (the cash driver's): the highlight must differ from BOTH
  // quiet frames. Any residual global ramp settles between B and C, so ramp
  // pixels fail the |B-C| leg and drop out of the mask.
  const before = await glShot('card-unhovered.png');
  const cardPoint = await page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.cardTerminalScreenPoint?.() || register.presentedCardScreenPoint?.();
  });
  assert(cardPoint?.inView, 'seated card not in view');
  const highlighted = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.debugCardGrabOutline(true)
  ));
  assert(highlighted?.applied, 'debugCardGrabOutline found no card mesh');
  await page.waitForTimeout(350);
  const after = await glShot('card-hovered.png');
  await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.debugCardGrabOutline(false)
  ));
  await page.waitForTimeout(350);
  const settled = await glShot('card-unhovered-2.png');

  let verdict = { skipped: 'sharp unavailable' };
  if (sharp) {
    const raw = async (buf) => {
      const img = sharp(buf).ensureAlpha().raw();
      const { data, info } = await img.toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height };
    };
    const A = await raw(before); const B = await raw(after); const C = await raw(settled);
    const scaleX = A.w / VIEWPORT.width;
    const scaleY = A.h / VIEWPORT.height;
    const cx = Math.round(cardPoint.x * scaleX);
    const cy = Math.round(cardPoint.y * scaleY);
    const half = Math.round(300 * scaleX);
    const x0 = Math.max(0, cx - half); const x1 = Math.min(A.w, cx + half);
    const y0 = Math.max(0, cy - half); const y1 = Math.min(A.h, cy + half);
    const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const w = x1 - x0; const h = y1 - y0;
    const mask = new Uint8Array(w * h);
    let changed = 0;
    let drift = 0; // A-vs-C disagreement = scene noise the mask excluded
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (((y + y0) * A.w) + (x + x0)) * 4;
        const lB = luma(B.data, i);
        if (Math.abs(luma(A.data, i) - luma(C.data, i)) > 12) drift += 1;
        if (Math.abs(lB - luma(A.data, i)) > 12 && Math.abs(lB - luma(C.data, i)) > 12) {
          mask[y * w + x] = 1; changed += 1;
        }
      }
    }
    // the card is ~0.6 m from the eye at fov 44: 1 mm is ~2.4 px, the ~3 mm
    // card rim ~8 px - blobs are masses ~3x that
    const R = 13;
    let blob = 0;
    for (let y = R; y < h - R; y += 1) {
      for (let x = R; x < w - R; x += 1) {
        if (!mask[y * w + x]) continue;
        let full = true;
        for (let dy = -R; full && dy <= R; dy += 1) {
          for (let dx = -R; dx <= R; dx += 1) {
            if (!mask[(y + dy) * w + (x + dx)]) { full = false; break; }
          }
        }
        if (full) blob += 1;
      }
    }
    verdict = {
      crop: { x0, y0, x1, y1 },
      changed,
      drift,
      driftFraction: +(drift / (w * h)).toFixed(4),
      blobPixels: blob,
      blobFraction: changed ? +(blob / changed).toFixed(4) : 0,
    };
    const vis = Buffer.alloc(w * h * 3);
    for (let p = 0; p < w * h; p += 1) {
      const i = (((Math.floor(p / w) + y0) * A.w) + ((p % w) + x0)) * 4;
      const v = mask[p] ? 255 : Math.round(luma(A.data, i) * 0.25);
      vis[p * 3] = v; vis[p * 3 + 1] = mask[p] ? 40 : v; vis[p * 3 + 2] = mask[p] ? 40 : v;
    }
    await sharp(vis, { raw: { width: w, height: h, channels: 3 } })
      .png().toFile(path.join(OUT, 'card-diff.png'));
  }

  const checks = {
    hoverDrawsSomething: !!verdict.changed && verdict.changed > 200,
    cardOutlineNotPatch: verdict.blobFraction !== undefined && verdict.blobFraction < 0.05,
    // the STRUCTURAL half of the proof (the seated card hides its chip from
    // the camera): every framed mesh must be CARD-sized. The body and its
    // full-size brand panel both earn frames; a chip frame would show up as
    // an owner span a small fraction of the card's.
    chipShellSuppressed: Array.isArray(highlighted.shellOwnerSpans)
      && highlighted.shellOwnerSpans.length > 0
      && highlighted.shellOwnerSpans.every((span) => (
        Number.isFinite(span)
        && span >= Math.max(...highlighted.shellOwnerSpans) * 0.8
      )),
    // instrument health: if most of the crop drifted between the two QUIET
    // frames, the A/B/C exclusion is carrying the whole verdict - refuse
    sceneReasonablyQuiet: verdict.driftFraction !== undefined && verdict.driftFraction < 0.5,
    noPageErrors: errs.length === 0,
  };
  const out = { cardPoint, highlighted, verdict, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'card-hover.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
