// VERIFY2 K5 — adversarial. The shipped K5 driver measured the ENTRY and
// APPROVED faces. This one photographs the rest of the reader's faces on the
// light glass: idle READY (on the counter, pre-transaction), card-present
// (insert prompt), PROCESSING (card-busy), and DECLINED — plus the finding
// that tx.rng can never decline in production (DECLINE_CHANCE is 0), so the
// declined face is forced via runCard(tx, {force:'declined'}) inside the busy
// window. Warn-accent legibility is measured as a WCAG-style contrast ratio
// of the red pixels against the glass. Term canvas dumps are pixel ground
// truth; probe close-ups show the same faces in the scene.
// ok reflects instrument health only; claim verdicts live in `findings`.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-k/k5-faces');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  // ---- shared instruments --------------------------------------------------
  const dumpTerm = (name) => page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let image = null;
    clubhouse.interior.traverse((o) => {
      const im = o.material?.map?.image;
      if (!image && im && im.tagName === 'CANVAS' && im.width === 512 && im.height === 468) image = im;
    });
    if (!image) return { error: 'term canvas not found on any mesh' };
    const scratch = document.createElement('canvas');
    scratch.width = image.width; scratch.height = image.height;
    const sctx = scratch.getContext('2d');
    sctx.drawImage(image, 0, 0);
    const { data } = sctx.getImageData(0, 0, image.width, image.height);
    // stats: glass median luma (12px bezel margin excluded), warn-red pixels
    const lumas = [];
    let warn = 0; let warnR = 0; let warnG = 0; let warnB = 0;
    let glassR = 0; let glassG = 0; let glassB = 0; let glassN = 0;
    for (let y = 12; y < image.height - 12; y += 1) {
      for (let x = 12; x < image.width - 12; x += 1) {
        const i = (y * image.width + x) * 4;
        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lumas.push(luma);
        if (r > 110 && r > g + 30 && r > b + 30) { warn += 1; warnR += r; warnG += g; warnB += b; }
        if (luma > 180) { glassR += r; glassG += g; glassB += b; glassN += 1; }
      }
    }
    lumas.sort((a, b) => a - b);
    const median = lumas[Math.floor(lumas.length / 2)];
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : (((s + 0.055) / 1.055) ** 2.4);
    };
    const relLum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    let warnContrast = null;
    if (warn > 50 && glassN > 100) {
      const lWarn = relLum(warnR / warn, warnG / warn, warnB / warn);
      const lGlass = relLum(glassR / glassN, glassG / glassN, glassB / glassN);
      warnContrast = +(((Math.max(lWarn, lGlass) + 0.05) / (Math.min(lWarn, lGlass) + 0.05))).toFixed(2);
    }
    // K5-style band classifier: digits vs glass in a horizontal band
    const bandDelta = (x0, y0, x1, y1) => {
      const band = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * image.width + x) * 4;
          band.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
        }
      }
      const sorted = [...band].sort((a, b) => a - b);
      const bandMedian = sorted[Math.floor(sorted.length / 2)];
      const byDistance = [...band].sort((a, b) => Math.abs(b - bandMedian) - Math.abs(a - bandMedian));
      const n = Math.max(1, Math.floor(byDistance.length * 0.06));
      const digitMean = byDistance.slice(0, n).reduce((sum, v) => sum + v, 0) / n;
      return +Math.abs(digitMean - bandMedian).toFixed(1);
    };
    return {
      glassMedianLuma: +median.toFixed(1),
      warnPixels: warn,
      warnContrastVsGlass: warnContrast,
      amountBandDelta: bandDelta(44, 150, 466, 290),
      captionBandDelta: bandDelta(44, 110, 466, 150),
      footerBandDelta: bandDelta(44, 280, 440, 340),
      bareGlassDelta: bandDelta(44, 400, 400, 445),
      dataUrl: scratch.toDataURL('image/png'),
    };
  }).then((result) => {
    if (!result.error && result.dataUrl) {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
      delete result.dataUrl;
    }
    return result;
  });

  const readerCloseup = (name) => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    let reader = null;
    clubhouse.interior.traverse((o) => { if (!reader && o.name === 'checkout-payment_terminal') reader = o; });
    if (!reader) return null;
    const bounds = new THREE.Box3().setFromObject(reader);
    const centre = bounds.getCenter(new THREE.Vector3());
    const probe = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 40);
    const eye = scene3d.camera.getWorldPosition(new THREE.Vector3());
    probe.position.copy(centre).addScaledVector(eye.clone().sub(centre).normalize(), 0.5);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    return document.querySelector('canvas').toDataURL('image/png');
  }).then((dataUrl) => {
    if (dataUrl) fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    return !!dataUrl;
  });

  const stage = () => page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    return { customer: !!clubhouse.sendToCounter(skuIds, 'card') };
  }, [SKUS]);

  const ringAll = async (label) => {
    const uids = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
    ));
    for (const uid of uids) {
      let point = null;
      for (let settle = 0; settle < 22; settle += 1) {
        const next = await page.evaluate(async (id) => {
          const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
          const app = window.__fw;
          let found = null;
          app.scene3d.clubhouse().interior.traverse((o) => {
            if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === id) found = o;
          });
          if (!found) return null;
          const bounds = new THREE.Box3().setFromObject(found);
          const world = bounds.isEmpty()
            ? found.getWorldPosition(new THREE.Vector3())
            : bounds.getCenter(new THREE.Vector3());
          world.project(app.scene3d.camera);
          const rect = document.querySelector('canvas').getBoundingClientRect();
          return {
            x: rect.left + ((world.x + 1) / 2) * rect.width,
            y: rect.top + ((-world.y + 1) / 2) * rect.height,
            inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
          };
        }, uid);
        if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
          point = next; break;
        }
        point = next;
        await page.waitForTimeout(160);
      }
      assert(point && point.inView, `${label}: item ${uid} not in the working frame`);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction((id) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        const item = tx?.items.find((candidate) => candidate.uid === id);
        return !!(item?.scanned && item?.bagged);
      }, uid, { timeout: 10000 });
    }
  };

  const toCardEntry = async (label, rngValue) => {
    const staged = await stage();
    assert(staged.customer, `${label}: no card fixture customer`);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === 3;
    }, null, { timeout: 30000 });
    await page.evaluate((rng) => {
      window.__fw.scene3d.clubhouse().register.getTx().rng = () => rng;
    }, rngValue);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    await ringAll(label);
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
    }, null, { timeout: 25000 });
    await page.waitForTimeout(700);
    return null;
  };

  const clearTill = async () => {
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.register.abandon?.();
      clubhouse.register.leave?.({ restorePointer: false });
      clubhouse.clearWalkins();
    });
    await page.waitForTimeout(900);
  };

  // ---- FACE 1: idle READY on the counter, before any customer --------------
  let idleFace = { error: 'not captured' };
  try {
    await page.waitForFunction(() => {
      let found = false;
      window.__fw.scene3d.clubhouse().interior.traverse((o) => {
        const im = o.material?.map?.image;
        if (im && im.tagName === 'CANVAS' && im.width === 512 && im.height === 468) found = true;
      });
      return found;
    }, null, { timeout: 60000 });
    idleFace = await dumpTerm('face-idle-ready.png');
  } catch (e) {
    idleFace = { error: `term canvas never appeared idle: ${e.message}` };
  }
  const idleCloseupOk = await readerCloseup('closeup-idle-ready.png');
  await page.screenshot({ path: path.join(OUT, 'frame-idle.png') });

  // ---- CUSTOMER A: rng 0.01 — the suggested decline attack, run honestly ---
  await toCardEntry('custA', 0.01);
  const cardPointA = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  const presentFace = await dumpTerm('face-card-present.png');
  await readerCloseup('closeup-card-present.png');
  await page.mouse.click(cardPointA.x, cardPointA.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const dueDigitsA = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return String(Math.round(totalOf(tx) * 100));
  });
  for (const key of dueDigitsA) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  const busyStage = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage
  ));
  const processingFace = await dumpTerm('face-processing.png');
  await readerCloseup('closeup-processing.png');
  await page.waitForFunction(() => (
    ['receipt', 'bagging', 'done', 'card-declined'].includes(
      window.__fw.scene3d.clubhouse().register.getTx()?.stage,
    )
  ), null, { timeout: 30000 });
  const rngAttackOutcome = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return { stage: tx?.stage, cardResult: tx?.cardResult };
  });
  await clearTill();

  // ---- CUSTOMER B: the declined face, forced inside the busy window --------
  await toCardEntry('custB', 0.9);
  const cardPointB = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPointB.x, cardPointB.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const dueDigitsB = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return String(Math.round(totalOf(tx) * 100));
  });
  for (const key of dueDigitsB) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  const forced = await page.evaluate(async () => {
    const { runCard } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const before = tx?.stage;
    let result = null;
    if (tx && tx.stage === 'card-busy') result = runCard(tx, { force: 'declined' });
    return { before, after: tx?.stage, result };
  });
  await page.waitForTimeout(600); // let drawTerm repaint the declined face
  const declinedFace = await dumpTerm('face-declined.png');
  await readerCloseup('closeup-declined.png');
  await page.screenshot({ path: path.join(OUT, 'frame-declined.png') });
  await clearTill();

  const findings = {
    idleFace,
    idleCloseupOk,
    presentFace,
    busyStageAtCapture: busyStage,
    processingFace,
    rngAttackOutcome, // DECLINE_CHANCE is 0: expect approved even at rng 0.01
    rngCannotDecline: rngAttackOutcome.cardResult === 'approved',
    forcedDecline: forced,
    declinedFace,
    declinedWarnContrast: declinedFace.warnContrastVsGlass ?? null,
    declinedAmountStrong: !declinedFace.error && declinedFace.amountBandDelta > 150,
  };
  const out = { findings, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'verify2-k5.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
