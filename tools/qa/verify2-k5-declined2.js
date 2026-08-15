// VERIFY2 K5 round 2 — the warn faces, painted by the game's own painters.
//  1. ENTRY-ERROR face: key a wrong amount and submit — production-reachable
//     red accent on the light glass.
//  2. DECLINED face: force runCard(tx,{force:'declined'}) in the busy window
//     (production cannot decline: DECLINE_CHANCE=0), then leave + re-enter the
//     register so the mode's own entry path repaints the glass from tx.stage.
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
    return {
      glassMedianLuma: +median.toFixed(1),
      warnPixels: warn,
      warnContrastVsGlass: warnContrast,
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

  const staged = await page.evaluate(async ([skuIds]) => {
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
  assert(staged.customer, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);
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
    assert(point && point.inView, `item ${uid} not in the working frame`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 10000 });
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 25000 });
  await page.waitForTimeout(700);
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(900);

  // ---- 1: the WRONG amount -> the entry-error warn face --------------------
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const entryErrorState = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return { stage: tx?.stage, cardEntryError: tx?.cardEntryError || null };
  });
  const entryErrorFace = await dumpTerm('face-entry-error.png');
  await readerCloseup('closeup-entry-error.png');

  // ---- 2: correct amount -> busy -> forced decline -> re-enter -------------
  const dueDigits = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    // clear the erroneous entry first
    tx.cardEntryDigits = '';
    tx.cardEntryCents = 0;
    return String(Math.round(totalOf(tx) * 100));
  });
  for (const key of dueDigits) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  const forced = await page.evaluate(async () => {
    const { runCard } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const before = tx?.stage;
    let result = null;
    if (tx && tx.stage === 'card-busy') result = runCard(tx, { force: 'declined' });
    return { before, after: tx?.stage, result };
  });
  assert(forced.after === 'card-declined', `force failed: ${JSON.stringify(forced)}`);
  // leave + re-enter: the entry path repaints the glass from tx.stage
  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().register.leave?.({ restorePointer: false });
  });
  await page.waitForTimeout(700);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(900);
  const declinedState = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return { stage: tx?.stage, cardResult: tx?.cardResult || null };
  });
  const declinedFace = await dumpTerm('face-declined2.png');
  await readerCloseup('closeup-declined2.png');
  await page.screenshot({ path: path.join(OUT, 'frame-declined2.png') });

  const findings = { entryErrorState, entryErrorFace, forced, declinedState, declinedFace };
  const out = { findings, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'verify2-k5-declined2.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
