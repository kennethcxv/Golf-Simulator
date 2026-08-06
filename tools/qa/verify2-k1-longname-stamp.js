// VERIFY2 K1/K2 — adversarial. Long club name ('Northamptonshire County Golf
// and Country Club') set BEFORE the stamp texture builds; the stamp texture
// canvas itself is dumped (ground truth for "never prints cut off"), the bag
// is photographed at TX START (K2: present + posed from the first moment),
// then rung to card-entry for the judgment frame, then a second CASH customer
// runs with largeTextAndTargets=true to see whether the pref distorts the bag.
// ok reflects instrument health only; claim verdicts live in `findings`.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-k/k1-longname');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const LONG_NAME = 'Northamptonshire County Golf and Country Club';
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const stage = (method) => page.evaluate(async ([skuIds, payMethod, longName]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    app.state.clubName = longName; // BEFORE any texture rebuild
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.speedIdx = 0; // NPCs at 1x
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
    return { customer: !!clubhouse.sendToCounter(skuIds, payMethod), clubName: app.state.clubName };
  }, [SKUS, method, LONG_NAME]);

  // bag census: presence, scale, pose, expected constants from the module itself
  const bagStats = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const mod = await import(new URL('src/render3d/clubhouse/simplifiedRegisterMode.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    if (!bag) return { present: false };
    const bounds = new THREE.Box3().setFromObject(bag);
    const euler = new THREE.Euler().setFromQuaternion(bag.quaternion);
    return {
      present: true,
      visible: bag.visible,
      scale: +bag.scale.x.toFixed(4),
      scaleUniform: Math.abs(bag.scale.x - bag.scale.y) < 1e-6 && Math.abs(bag.scale.x - bag.scale.z) < 1e-6,
      expectedScale: mod.CHECKOUT_DISPLAY_BRAND_PRESENTATION ? mod.CHECKOUT_BAG_PRESENTATION?.scale ?? null : null,
      presentationScaleConst: mod.CHECKOUT_BAG_PRESENTATION?.scale ?? null,
      euler: { x: +euler.x.toFixed(3), y: +euler.y.toFixed(3), z: +euler.z.toFixed(3) },
      worldMinY: +bounds.min.y.toFixed(4),
      worldMaxY: +bounds.max.y.toFixed(4),
      sizeX: +(bounds.max.x - bounds.min.x).toFixed(3),
      sizeZ: +(bounds.max.z - bounds.min.z).toFixed(3),
    };
  });

  // the stamp texture canvas is the ground truth for "cut off"
  const dumpStamp = (name) => page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let panel = null;
    clubhouse.interior.traverse((o) => { if (!panel && o.name === 'PineHillsDynamicBagBrand') panel = o; });
    const image = panel?.material?.map?.image;
    if (!image || image.tagName !== 'CANVAS') return { error: 'no stamp canvas' };
    const scratch = document.createElement('canvas');
    scratch.width = image.width; scratch.height = image.height;
    const sctx = scratch.getContext('2d');
    sctx.drawImage(image, 0, 0);
    const { data } = sctx.getImageData(0, 0, image.width, image.height);
    // ink = the green foreground/subtitle family (g dominates, dark); the kraft
    // ground and the brown border both have r >= g so they stay out of it
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity; let ink = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const i = (y * image.width + x) * 4;
        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        if (g > r + 10 && g > b + 8 && (0.2126 * r + 0.7152 * g + 0.0722 * b) < 120) {
          ink += 1;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    // border stroke: 8px wide centred on the 18px inset -> paint spans ~14..22
    const borderInnerEdge = 22;
    return {
      w: image.width, h: image.height, inkPixels: ink,
      inkMinX: minX, inkMaxX: maxX, inkMinY: minY, inkMaxY: maxY,
      insideBorder: ink > 0 && minX >= borderInnerEdge && maxX <= image.width - borderInnerEdge
        && minY >= borderInnerEdge && maxY <= image.height - borderInnerEdge,
      touchesCanvasEdge: ink > 0 && (minX <= 2 || maxX >= image.width - 3 || minY <= 2 || maxY >= image.height - 3),
      dataUrl: scratch.toDataURL('image/png'),
    };
  }).then((result) => {
    if (!result.error && result.dataUrl) {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
      delete result.dataUrl;
    }
    return result;
  });

  const bagCloseups = (prefix) => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    if (!bag) return null;
    const bounds = new THREE.Box3().setFromObject(bag);
    const centre = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const shots = {};
    const probe = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 40);
    probe.position.set(centre.x, centre.y + span * 1.15, centre.z + 0.001);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    shots.top = document.querySelector('canvas').toDataURL('image/png');
    const eye = scene3d.camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.sub(centre).setY(0).normalize();
    probe.position.copy(centre).addScaledVector(toEye, span * 1.05).add(new THREE.Vector3(0, span * 0.55, 0));
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    shots.oblique = document.querySelector('canvas').toDataURL('image/png');
    return shots;
  }).then((shots) => {
    if (shots) {
      fs.writeFileSync(path.join(OUT, `${prefix}-top.png`), Buffer.from(shots.top.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(OUT, `${prefix}-oblique.png`), Buffer.from(shots.oblique.split(',')[1], 'base64'));
    }
    return !!shots;
  });

  const ringAll = async () => {
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
  };

  // ---- LEG 1: card customer, long name, stamp + K2 tx-start ----------------
  const staged = await stage('card');
  assert(staged.customer, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(400); // K2: the START of the transaction, pre-ring

  const bagAtStart = await bagStats();
  await page.screenshot({ path: path.join(OUT, 'card-tx-start-frame.png') });
  await bagCloseups('card-tx-start');
  const stampLong = await dumpStamp('stamp-longname.png');

  await page.waitForTimeout(1100);
  await ringAll();
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
  const bagAtEntry = await bagStats();
  await page.screenshot({ path: path.join(OUT, 'card-entry-frame.png') });
  await bagCloseups('card-entry');
  const wrinkle = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    let kraftMeshes = 0; let bumped = 0; const bumpSources = new Set();
    bag?.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        if (!material || material.visible === false) continue;
        kraftMeshes += 1;
        if (material.bumpMap) { bumped += 1; bumpSources.add(material.bumpMap.uuid); }
      }
    });
    return { kraftMeshes, bumped, bumpSourceCount: bumpSources.size };
  });

  // ---- LEG 2: CASH customer + largeTextAndTargets on -----------------------
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.register.abandon?.();
    clubhouse.register.leave?.({ restorePointer: false });
    clubhouse.clearWalkins();
    const state = window.__fw.state;
    state.uiPrefs = state.uiPrefs || {};
    state.uiPrefs.checkout = { ...(state.uiPrefs.checkout || {}), largeTextAndTargets: true };
  });
  await page.waitForTimeout(900);
  const staged2 = await stage('cash');
  assert(staged2.customer, 'no cash fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const bagCashStartLargeText = await bagStats();
  await page.screenshot({ path: path.join(OUT, 'cash-largetext-tx-start-frame.png') });
  await bagCloseups('cash-largetext-tx-start');
  const stampCash = await dumpStamp('stamp-cash-largetext.png');

  await page.waitForTimeout(1100);
  await ringAll();
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 20000 });
  await page.waitForTimeout(1400);
  const bagCashTenderLargeText = await bagStats();
  await page.screenshot({ path: path.join(OUT, 'cash-largetext-tender-frame.png') });
  await bagCloseups('cash-largetext-tender');

  const findings = {
    longName: LONG_NAME,
    bagAtStart,
    bagAtEntry,
    bagCashStartLargeText,
    bagCashTenderLargeText,
    stampLong,
    stampCash,
    wrinkle,
    scaleIs135Everywhere: [bagAtStart, bagAtEntry, bagCashStartLargeText, bagCashTenderLargeText]
      .every((b) => b.present && Math.abs(b.scale - 1.35) < 1e-3 && b.scaleUniform),
    bagPresentFromStart: bagAtStart.present && bagAtStart.visible,
    stampNeverCutOff: !!stampLong.insideBorder && !stampLong.touchesCanvasEdge
      && !!stampCash.insideBorder && !stampCash.touchesCanvasEdge,
    largeTextDidNotChangeBagScale: bagCashStartLargeText.present
      && Math.abs(bagCashStartLargeText.scale - bagAtStart.scale) < 1e-6,
  };
  const out = { findings, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0; // instrument health only
  fs.writeFileSync(path.join(OUT, 'verify2-k1.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
