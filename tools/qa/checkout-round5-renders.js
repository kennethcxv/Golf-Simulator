async (page) => {
  // CHECKOUT PLAYTEST ROUND 5 (2026-07-30). Three reported items, photographed
  // against Designs/CashRegister/Final and the 2026-07-30 counter screenshot:
  //   A the working frame is a STANDING CASHIER'S eye line, not a bird's eye —
  //     the eye sits at the player's own standing height above the staff floor,
  //     close to the counter, and the customer opposite crops at the shoulders
  //   B no orange hover box anywhere; the GREEN payment rim still marks the
  //     offered cash
  //   C the paper bag lies FLAT and LONG on the counter with its mouth open
  //     toward the empty counter space on its right
  // Saves under qa/cash-register-production/simplified-rebuild/checkout-round5/.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/checkout-round5');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const report = {};

  // BOOT A NEW GAME, don't resume. "Continue" only exists when a save is
  // already in localStorage, so on a clean profile the click was a no-op, the
  // menu stayed up and the driver hung on the load veil below.
  await page.setViewportSize(VIEWPORT);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const startBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await startBtn.isVisible({ timeout: 1500 }).catch(() => false)) await startBtn.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 90000 });
  // The veil does not always retire on a resumed save; the clubhouse being up
  // (waited on above) is the real readiness signal, so this must not be fatal.
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const fixture = await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
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
    return { customer: clubhouse.sendToCounter(skuIds, 'cash') };
  }, [SKUS]);
  assert(fixture.customer, 'no fixture customer');

  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 20000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const prices = [6.90, 9.20, 19.62];
    tx.items.forEach((item, index) => {
      item.price = prices[index];
      item.priceCents = Math.round(prices[index] * 100);
    });
    tx.rng = () => 0.9;
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1800);

  // --- A: is the eye a standing person's, and where does the customer crop? --
  // Everything is reported against the STAFF FLOOR (interior-local y 0.3), the
  // surface the cashier actually stands on, so "10 ft tall cashier" is a number.
  const frameMetrics = async () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const { COUNTER_TOP } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    const FLOOR_LOCAL_Y = 0.3;
    const floorWorldY = clubhouse.interior.position.y + FLOOR_LOCAL_Y;
    const counterWorldY = clubhouse.interior.position.y + COUNTER_TOP;
    const boxOf = (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return null;
      let minX = Infinity; let maxX = -Infinity;
      let minY = Infinity; let maxY = -Infinity;
      let behind = false;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(camera);
            if (p.z > 1) behind = true;
            minX = Math.min(minX, (p.x + 1) / 2); maxX = Math.max(maxX, (p.x + 1) / 2);
            minY = Math.min(minY, (-p.y + 1) / 2); maxY = Math.max(maxY, (-p.y + 1) / 2);
          }
        }
      }
      return {
        minX, maxX, minY, maxY, behind,
        w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        inside: !behind && minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1,
        worldMin: bounds.min.toArray(), worldMax: bounds.max.toArray(),
      };
    };
    const project = (v) => {
      const p = v.clone().project(camera);
      return { x: (p.x + 1) / 2, y: (-p.y + 1) / 2 };
    };
    const find = (test) => {
      let hit = null;
      clubhouse.interior.traverse((o) => { if (!hit && o.visible && test(o)) hit = o; });
      return hit;
    };
    const bag = find((o) => o.userData?.kind === 'bag');
    const items = [];
    clubhouse.interior.traverse((o) => { if (o.userData?.kind === 'item' && o.visible) items.push(o); });
    const monitor = find((o) => o.isMesh
      && (o.material === clubhouse.register.screenMaterial || o.name === 'POS_Screen'));
    // The customer: crown, shoulders and feet as explicit world points, so
    // "their head is above the top of frame" is measurable rather than felt.
    let customerRoot = null;
    app.scene3d.scene.traverse((o) => {
      if (!customerRoot && o.userData?.kind === 'customer-carry-grip') customerRoot = o;
    });
    const custMesh = clubhouse.register.getCustomer()?.mesh || null;
    let crown = null; let shoulder = null; let feet = null;
    if (custMesh) {
      custMesh.updateWorldMatrix(true, false);
      const base = custMesh.getWorldPosition(new THREE.Vector3());
      const at = (dy) => project(base.clone().add(new THREE.Vector3(0, dy, 0)));
      crown = at(1.66);
      shoulder = at(1.34);
      feet = at(0.02);
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return {
      eyeWorld: camera.position.toArray(),
      eyeAboveStaffFloor: camera.position.y - floorWorldY,
      eyeAboveCounter: camera.position.y - counterWorldY,
      floorWorldY,
      counterWorldY,
      downAngleDeg: -Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI,
      fov: camera.fov,
      bag: bag ? boxOf(bag) : null,
      monitor: monitor ? boxOf(monitor) : null,
      itemCount: items.length,
      items: items.length ? items.map(boxOf).filter(Boolean).reduce((a, b) => ({
        minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY),
      })) : null,
      customerBox: customerRoot ? boxOf(customerRoot) : null,
      customerCrown: crown,
      customerShoulder: shoulder,
      customerFeet: feet,
    };
  });
  report.frame = await frameMetrics();
  await shot('01-working-frame.png');

  // --- B: hover a counter product. NOTHING may outline it. -------------------
  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((o) => {
      if (found || !o.visible || !o.userData) return;
      if (q.kind && o.userData.kind !== q.kind) return;
      if (q.uid && o.userData.uid !== q.uid) return;
      if (q.from && o.userData.from !== q.from) return;
      found = o;
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
  }, query);

  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  let hoverPoint = await projectObject({ kind: 'item', uid: uids[0] });
  for (let settle = 0; settle < 20; settle += 1) {
    await page.waitForTimeout(160);
    const next = await projectObject({ kind: 'item', uid: uids[0] });
    if (next && hoverPoint && Math.abs(next.x - hoverPoint.x) < 1.5
        && Math.abs(next.y - hoverPoint.y) < 1.5) { hoverPoint = next; break; }
    hoverPoint = next;
  }
  assert(hoverPoint && hoverPoint.inView, 'the first product is not in the working frame');
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await page.waitForTimeout(400);
  report.hover = await page.evaluate(() => {
    // Count every helper the register root still owns. A Box3Helper is a
    // LineSegments whose material colour IS the outline colour, so a surviving
    // orange rim cannot hide behind a name.
    const clubhouse = window.__fw.scene3d.clubhouse();
    const helpers = [];
    clubhouse.interior.traverse((o) => {
      if (!o.isLineSegments && !o.type?.includes('Box3Helper')) return;
      helpers.push({
        name: o.name || o.type,
        visible: o.visible,
        colour: o.material?.color ? `#${o.material.color.getHexString()}` : null,
      });
    });
    return { helpers, cursor: document.querySelector('canvas')?.style.cursor || '' };
  });
  await shot('02-hover-product.png');

  // --- C: the bag. One extra render with a throwaway camera parked in front of
  // the carrier, read straight back off the drawing buffer, so "does the mouth
  // read as an OPEN PAPER BAG" can be judged at a size the working frame cannot
  // show. The game's own camera is untouched.
  const bagCrop = report.frame.bag;
  const bagShot = await page.evaluate(async ([elevDeg, azimDeg, distance]) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const scene3d = app.scene3d;
    const clubhouse = scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.userData?.kind === 'bag') bag = o; });
    if (!bag) return null;
    const bounds = new THREE.Box3().setFromObject(bag);
    const centre = bounds.getCenter(new THREE.Vector3());
    const probe = new THREE.PerspectiveCamera(38, 16 / 9, 0.02, 40);
    // Spherical offset in the register's own frame: azimuth measured off the
    // desk's staff normal so the shot is repeatable when the desk rotates.
    const frame = bag.parent || clubhouse.interior;
    frame.updateWorldMatrix(true, false);
    // The desk faces the entrance, so its staff side is the interior's -Z.
    const normal = new THREE.Vector3(0, 0, -1)
      .transformDirection(frame.matrixWorld).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const elev = THREE.MathUtils.degToRad(elevDeg);
    const azim = THREE.MathUtils.degToRad(azimDeg);
    const dir = normal.clone().multiplyScalar(Math.cos(elev) * Math.cos(azim))
      .addScaledVector(right, Math.cos(elev) * Math.sin(azim))
      .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(elev))
      .normalize();
    probe.position.copy(centre).addScaledVector(dir, distance);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    return document.querySelector('canvas').toDataURL('image/png');
  }, [30, 26, 0.60]);
  if (bagShot) {
    fs.writeFileSync(path.join(OUT, '05-bag-closeup.png'),
      Buffer.from(bagShot.split(',')[1], 'base64'));
  }
  report.bagShot = !!bagShot;
  // WHAT DOES A LOOK STRAIGHT DOWN AT THE BAG ACTUALLY HIT? A laid bag must
  // present its printed paper face upward; if a liner or a backface wins that
  // ray, the mouth read is coming from the wrong surface.
  report.bagSurfaces = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.userData?.kind === 'bag') bag = o; });
    if (!bag) return null;
    const bounds = new THREE.Box3().setFromObject(bag);
    const centre = bounds.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(
      centre.clone().setY(bounds.max.y + 0.5), new THREE.Vector3(0, -1, 0), 0.01, 2,
    );
    const hits = ray.intersectObject(bag, true).slice(0, 6).map((hit) => ({
      name: hit.object.name,
      y: +hit.point.y.toFixed(4),
      side: hit.object.material?.side,
      colour: hit.object.material?.color ? `#${hit.object.material.color.getHexString()}` : null,
      visible: hit.object.visible,
    }));
    const meshes = [];
    bag.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const b = new THREE.Box3().setFromObject(o);
      meshes.push({
        name: o.name,
        top: +b.max.y.toFixed(4),
        bottom: +b.min.y.toFixed(4),
        side: Array.isArray(o.material) ? o.material.map((m) => m.side) : o.material?.side,
      });
    });
    meshes.sort((a, b) => b.top - a.top);
    // IS THE WHOLE FOOTPRINT ON THE COUNTER? A bag whose mouth corner hangs off
    // the desk edge reads as falling, not resting. Drop a ray under each corner
    // of the laid footprint and require a surface within a hand's width.
    const support = [];
    for (const x of [bounds.min.x + 0.01, bounds.max.x - 0.01]) {
      for (const z of [bounds.min.z + 0.01, bounds.max.z - 0.01]) {
        const down = new THREE.Raycaster(
          new THREE.Vector3(x, bounds.min.y + 0.02, z), new THREE.Vector3(0, -1, 0), 0.001, 0.6,
        );
        down.camera = window.__fw.scene3d.camera; // sprites raycast against a camera
        const under = down.intersectObject(clubhouse.interior, true)
          .filter((h) => h.object.visible && !/^COL_/i.test(h.object.name || '')
            && h.object.userData?.kind !== 'bag')[0];
        support.push({
          x: +x.toFixed(3), z: +z.toFixed(3),
          drop: under ? +(bounds.min.y + 0.02 - under.point.y).toFixed(4) : null,
          on: under?.object?.name || null,
        });
      }
    }
    return {
      hits, topMeshes: meshes.slice(0, 8), bagTop: +bounds.max.y.toFixed(4), support,
    };
  });

  // ring the goods up so the frame carries scanned goods too
  for (const uid of uids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next; break;
      }
      point = next;
    }
    assert(point && point.inView, `item ${uid} not visible in the working frame`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 10000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 10000 });
  }
  report.afterScan = await frameMetrics();
  await shot('03-rung-up.png');

  // --- B (part 2): the GREEN payment rim still marks the offered cash --------
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'cash-tender' && register.presentedCashScreenPoint()?.inView;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  await page.mouse.move(handful.x, handful.y);
  await page.waitForTimeout(500);
  report.paymentHover = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const helpers = [];
    clubhouse.interior.traverse((o) => {
      if (o.isLineSegments) {
        helpers.push({
          visible: o.visible,
          colour: o.material?.color ? `#${o.material.color.getHexString()}` : null,
        });
      }
      if (o.isSprite && o.visible) helpers.push({ visible: true, colour: 'sprite-glow' });
    });
    return helpers;
  });
  await shot('04-payment-green-rim.png');

  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(report, null, 2));
  return { ok: true, out: OUT, bagCrop, report };
}
