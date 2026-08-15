// K1 — the counter bag: smaller than the 1.85 it shipped at, larger than the
// original, judged AGAINST THE MONITOR AND READER in the working frame
// (the brief's own protocol). Plus paper wrinkles, plus a stamp that is not
// cut off mid-letter.
//
// This driver photographs the judgment frame and measures it: the projected
// screen boxes of the bag, the POS glass and the floating reader, mid card
// entry - the one composition where all three share the frame. Close-ups
// (top-down for the stamp, oblique for the paper) carry the wrinkle and stamp
// verdicts. Run with K1_LEG=before|after around the change.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const LEG = process.env.K1_LEG || 'run';
  const OUT = path.resolve(`qa/electron/bag-presentation-k1/${LEG}`);
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

  const staged = await page.evaluate(async (skuIds) => {
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
  }, SKUS);
  assert(staged.customer, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    tx.rng = () => 0.9;
  });
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

  // reach card entry so the reader floats in the same frame as bag + monitor
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

  // ---- the judgment frame: bag vs monitor vs reader ------------------------
  const frame = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    const boxOf = (object) => {
      if (!object) return null;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return null;
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(camera);
            minX = Math.min(minX, (p.x + 1) / 2); maxX = Math.max(maxX, (p.x + 1) / 2);
            minY = Math.min(minY, (-p.y + 1) / 2); maxY = Math.max(maxY, (-p.y + 1) / 2);
          }
        }
      }
      return {
        wFrac: +(maxX - minX).toFixed(4),
        hFrac: +(maxY - minY).toFixed(4),
        areaFrac: +((maxX - minX) * (maxY - minY)).toFixed(4),
      };
    };
    const find = (test) => {
      let hit = null;
      clubhouse.interior.traverse((o) => { if (!hit && o.visible && test(o)) hit = o; });
      return hit;
    };
    const bag = find((o) => o.name === 'FrontDeskShoppingBag');
    const monitor = find((o) => o.name === 'FrontDeskLiveMonitor' || o.name === 'POS_Screen');
    const reader = find((o) => o.name === 'checkout-payment_terminal');
    const bagScale = bag ? +bag.scale.x.toFixed(3) : null;
    return {
      bagScale,
      bag: boxOf(bag),
      monitor: boxOf(monitor),
      reader: boxOf(reader),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'working-frame.png') });

  // ---- close-ups: stamp (top-down) and paper (oblique) ---------------------
  const probeShots = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    if (!bag) return null;
    const bounds = new THREE.Box3().setFromObject(bag);
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    const shots = {};
    const probe = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 40);
    // top-down: the stamp face
    probe.position.set(centre.x, centre.y + span * 1.15, centre.z + 0.001);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    shots.top = document.querySelector('canvas').toDataURL('image/png');
    // oblique from the cashier side: the paper in raking light
    const eye = scene3d.camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.sub(centre).setY(0).normalize();
    probe.position.copy(centre).addScaledVector(toEye, span * 1.05).add(new THREE.Vector3(0, span * 0.55, 0));
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    shots.oblique = document.querySelector('canvas').toDataURL('image/png');
    return shots;
  });
  assert(probeShots, 'no bag in the scene');
  fs.writeFileSync(path.join(OUT, 'bag-top.png'), Buffer.from(probeShots.top.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'bag-oblique.png'), Buffer.from(probeShots.oblique.split(',')[1], 'base64'));

  // wrinkle presence, honestly measurable: the kraft materials carry a bump map
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

  const out = {
    leg: LEG,
    frame,
    wrinkle,
    ratios: frame.bag && frame.monitor && frame.reader ? {
      bagVsMonitorArea: +(frame.bag.areaFrac / frame.monitor.areaFrac).toFixed(3),
      bagVsReaderArea: +(frame.bag.areaFrac / frame.reader.areaFrac).toFixed(3),
    } : null,
    errs: errs.slice(0, 10),
  };
  out.ok = !!frame.bag && !!frame.monitor && !!frame.reader && errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'bag-presentation.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
