// VERIFY2 K4 addendum — the EXACT-CHANGE customer, staged correctly this time.
// cashTotalOf counts scanned items only, so the exact total is computed ahead:
// taxRate 0.07, net 3738c -> tax round(261.66)=262c -> total $40.00 exactly.
// Step for $40 is $10 -> ceil(40/10)*10 = 40 -> tender IS the due: no change.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-k/k4-totals');
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
    return { customer: !!clubhouse.sendToCounter(skuIds, 'cash') };
  }, [SKUS]);
  assert(staged.customer, 'no cash fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const prices = [12.38, 15.00, 10.00]; // net 3738c + 7% tax -> $40.00 exactly
    tx.items.forEach((item, index) => {
      item.price = prices[index];
      item.priceCents = Math.round(prices[index] * 100);
    });
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
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 20000 });
  await page.waitForTimeout(1600);

  const pieces = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const candidates = [];
    clubhouse.interior.traverse((o) => {
      if (o.userData?.kind !== 'money' || o.userData?.from !== 'tender') return;
      if (o.isMesh && o.material?.visible === false) return;
      candidates.push(o);
    });
    const roots = candidates.filter((o) => {
      for (let p = o.parent; p; p = p.parent) if (candidates.includes(p)) return false;
      return true;
    });
    return roots.map((o) => o.userData.denom);
  });
  const plan = await page.evaluate(async () => {
    const { stackTotal, cashTotalOf, changeDue } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      tendered: tx?.tendered || null,
      tenderedTotal: tx?.tendered ? stackTotal(tx.tendered) : null,
      due: tx ? +cashTotalOf(tx).toFixed(2) : null,
      changeDue: tx ? +changeDue(tx).toFixed(2) : null,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'exact-40-player-frame.png') });
  const closeup = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    const bounds = new THREE.Box3();
    let found = 0;
    clubhouse.interior.traverse((o) => {
      if (o.userData?.kind === 'money' && o.userData?.from === 'tender'
        && o.visible && o.material?.visible !== false) {
        bounds.expandByObject(o); found += 1;
      }
    });
    if (!found || bounds.isEmpty()) return null;
    const centre = bounds.getCenter(new THREE.Vector3());
    const probe = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 40);
    const eye = scene3d.camera.getWorldPosition(new THREE.Vector3());
    probe.position.copy(centre).addScaledVector(eye.clone().sub(centre).normalize(), 0.42);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    return document.querySelector('canvas').toDataURL('image/png');
  });
  if (closeup) {
    fs.writeFileSync(path.join(OUT, 'exact-40-closeup.png'), Buffer.from(closeup.split(',')[1], 'base64'));
  }

  const meshCounts = {};
  for (const denom of pieces) meshCounts[denom] = (meshCounts[denom] || 0) + 1;
  const meshSum = +pieces.reduce((sum, denom) => sum + denom, 0).toFixed(2);
  const findings = {
    plan,
    meshCounts,
    meshSum,
    exactChange: plan.due === 40 && plan.changeDue === 0 && meshSum === 40,
    matchesPlan: JSON.stringify(meshCounts) === JSON.stringify(Object.fromEntries(
      Object.entries(plan.tendered || {}).map(([d, n]) => [Number(d), n]),
    )),
  };
  const out = { findings, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'verify2-k4-exact.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
