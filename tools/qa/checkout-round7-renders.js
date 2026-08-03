async (page) => {
  // CHECKOUT PLAYTEST ROUND 7 (2026-07-31), photographed against the
  // 2026-07-31 TCG screenshot (dark counter edge, glowing device bay, reader
  // + pin pad standing in it, register right):
  //   01 working frame — monitor bigger/left and fully in frame, goods on the
  //      centre seam, device bay glowing under the counter lip, no desk lamp,
  //      no printer
  //   02 rung up — goods slid left along the counter into the flat bag
  //   03 cash on the desk — the tender lies flat in front of the customer
  //   04 outline hover — the pile wears a silhouette outline, no halo blob
  //   05 drawer open — green notes, standing $ tags, legible coin tags
  //   06 reader centred at the face mid-entry (polished glass, caret)
  //   07 reader close-up — the inserted card reads as a card
  //   08 approved glass
  //   09 post-sale — and the register KEEPS the player at the till (probed)
  // Saves under qa/cash-register-production/simplified-rebuild/checkout-round7/.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/checkout-round7');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const report = {};

  // BOOT A NEW GAME (the "Continue" click hangs on a clean profile).
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
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
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

  const stageCustomer = async (method) => {
    const fixture = await page.evaluate(async ([skuIds, payMethod]) => {
      const app = window.__fw;
      const { REGISTER } = await import('/src/data/shopLayout.js');
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
      return { customer: clubhouse.sendToCounter(skuIds, payMethod) };
    }, [SKUS, method]);
    assert(fixture.customer, `no ${method} fixture customer`);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === 3;
    }, null, { timeout: 30000 });
    await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const prices = [6.90, 9.20, 19.62];
      tx.items.forEach((item, index) => {
        item.price = prices[index];
        item.priceCents = Math.round(prices[index] * 100);
      });
      tx.rng = () => 0.9; // card approves; cash tenders $40
    });
  };

  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((o) => {
      if (found || !o.visible || !o.userData) return;
      if (q.name && o.name !== q.name) return;
      if (q.kind && o.userData.kind !== q.kind) return;
      if (q.uid && o.userData.uid !== q.uid) return;
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

  const settleAndClick = async (query, label) => {
    let point = await projectObject(query);
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject(query);
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next; break;
      }
      point = next;
    }
    assert(point && point.inView, `${label} is not in the working frame`);
    await page.mouse.click(point.x, point.y);
    return point;
  };

  // ============================= CASH CUSTOMER ==============================
  await stageCustomer('cash');
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1800);

  // --- 01: the working frame -------------------------------------------------
  report.frame = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { COUNTER_TOP, COUNTER } = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    const counterWorldY = clubhouse.interior.position.y + COUNTER_TOP;
    const boxOf = (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return null;
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
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
        minX: +minX.toFixed(3), maxX: +maxX.toFixed(3),
        minY: +minY.toFixed(3), maxY: +maxY.toFixed(3),
        inside: !behind && minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1,
      };
    };
    const find = (test) => {
      let hit = null;
      clubhouse.interior.traverse((o) => { if (!hit && o.visible && test(o)) hit = o; });
      return hit;
    };
    const monitor = find((o) => o.isMesh
      && (o.material === clubhouse.register.screenMaterial || o.name === 'POS_Screen'));
    const bay = find((o) => o.name === 'CheckoutTerminalBay');
    const printer = find((o) => o.name === 'checkout-receipt_printer');
    let lamp = null;
    app.scene3d.scene.traverse((o) => {
      if (!lamp && o.userData?.assetNumber === 83) lamp = o;
    });
    const lampDistance = lamp
      ? (() => {
        const world = lamp.getWorldPosition(new THREE.Vector3());
        const counterWorld = clubhouse.interior.localToWorld(new THREE.Vector3(COUNTER.x, COUNTER_TOP, COUNTER.z));
        return +world.distanceTo(counterWorld).toFixed(2);
      })()
      : null;
    // the parked reader: where is it, and is it visible in frame?
    let reader = null;
    clubhouse.interior.traverse((o) => { if (!reader && o.name === 'checkout-payment_terminal') reader = o; });
    return {
      eyeAboveCounter: +(camera.position.y - counterWorldY).toFixed(3),
      monitor: monitor ? boxOf(monitor) : null,
      bay: bay ? boxOf(bay) : null,
      readerParked: reader ? boxOf(reader) : null,
      printerExists: !!printer,
      lampDistanceFromCounter: lampDistance,
    };
  });
  await shot('01-working-frame.png');
  // THE FRAME AS ENTERED. Round 8 compares this against the same reading after
  // the sale banks — "after the transaction is over it moves the screen to the
  // right" has to be a measured delta, not an impression.
  const readPose = () => page.evaluate(() => {
    const camera = window.__fw.scene3d.camera;
    const register = window.__fw.scene3d.clubhouse().register;
    return {
      position: camera.position.toArray().map((v) => +v.toFixed(4)),
      quaternion: camera.quaternion.toArray().map((v) => +v.toFixed(4)),
      fov: camera.fov,
      // the SOLVED frame, independent of easing and cursor lean
      solved: register.debugWorkingPose ? register.debugWorkingPose() : null,
    };
  });
  // Take the baseline only once the POS GLASS has mounted. The working solve
  // uses the live screen quad when it exists and the authored monitor point
  // before then, so a baseline read during the deferred kit load compares two
  // different (both stable) compositions and reports a drift that has nothing
  // to do with the sale — the confound this probe exists to rule out.
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    // attachScreen names the live canvas plane as it mounts it, so this is a
    // direct signal that the working solve now has the real glass to fit.
    return !!clubhouse.interior.getObjectByName('FrontDeskLiveMonitor');
  }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  report.poseOnEntry = await readPose();

  // --- 02: ring the goods up -------------------------------------------------
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (const uid of uids) {
    await settleAndClick({ kind: 'item', uid }, `item ${uid}`);
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
  await shot('02-rung-up.png');

  // --- 03/04: the cash lies on the desk; hovering outlines it ----------------
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'cash-tender';
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1100);
  report.tender = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { COUNTER_TOP } = await import('/src/data/shopLayout.js');
    const clubhouse = window.__fw.scene3d.clubhouse();
    const counterWorldY = clubhouse.interior.position.y + COUNTER_TOP;
    const pieces = [];
    clubhouse.interior.traverse((o) => {
      if (o.userData?.kind === 'money' && o.userData?.from === 'tender' && o.visible && o.geometry) {
        const bounds = new THREE.Box3().setFromObject(o);
        if (!bounds.isEmpty()) pieces.push(+(bounds.min.y - counterWorldY).toFixed(4));
      }
    });
    return { pieceCount: pieces.length, lowestAboveCounter: pieces.length ? Math.min(...pieces) : null,
      highestAboveCounter: pieces.length ? Math.max(...pieces) : null };
  });
  await shot('03-cash-on-desk.png');
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'the desk tender is not in view');
  await page.mouse.move(handful.x, handful.y);
  await page.waitForTimeout(500);
  report.outline = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let shells = 0; let sprites = 0;
    clubhouse.interior.traverse((o) => {
      if (o.userData?.grabOutlineShell) shells += 1;
      if (o.isSprite && o.visible) sprites += 1;
    });
    return { shells, visibleSprites: sprites };
  });
  await shot('04-cash-outline.png');

  // --- 05: take the cash; the drawer opens -----------------------------------
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return tx?.stage === 'cash-drawer' && tx?.deposited;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await shot('05-drawer-open.png');

  // this cash sale has served its captures — clear the till for the card run
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.register.abandon?.();
    clubhouse.register.leave?.({ restorePointer: false });
    clubhouse.clearWalkins();
  });
  await page.waitForTimeout(800);

  // ============================= CARD CUSTOMER ==============================
  await stageCustomer('card');
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1200);
  const cardUids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (const uid of cardUids) {
    await settleAndClick({ kind: 'item', uid }, `card item ${uid}`);
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

  // --- 06: the reader hangs centred at the face, clear of the desk -----------
  report.reader = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { COUNTER_TOP } = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    const counterWorldY = clubhouse.interior.position.y + COUNTER_TOP;
    let reader = null;
    clubhouse.interior.traverse((o) => { if (!reader && o.name === 'checkout-payment_terminal') reader = o; });
    if (!reader) return null;
    const bounds = new THREE.Box3().setFromObject(reader);
    const centre = bounds.getCenter(new THREE.Vector3()).project(camera);
    return {
      centreNdcX: +centre.x.toFixed(3),
      centreNdcY: +centre.y.toFixed(3),
      lowestAboveCounter: +(bounds.min.y - counterWorldY).toFixed(3),
    };
  });
  // key part of the total so the caret and running figure are in the still
  for (const key of ['3', '8']) await page.keyboard.press(key);
  await page.waitForTimeout(400);
  await shot('06-reader-centred-entry.png');

  // --- 07: the inserted card close-up ---------------------------------------
  const readerShot = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const scene3d = app.scene3d;
    const clubhouse = scene3d.clubhouse();
    let reader = null;
    clubhouse.interior.traverse((o) => { if (!reader && o.name === 'checkout-payment_terminal') reader = o; });
    if (!reader) return null;
    const bounds = new THREE.Box3().setFromObject(reader);
    const centre = bounds.getCenter(new THREE.Vector3());
    const probe = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 40);
    const eye = scene3d.camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.clone().sub(centre).normalize();
    probe.position.copy(centre).addScaledVector(toEye, 0.52);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    return document.querySelector('canvas').toDataURL('image/png');
  });
  if (readerShot) {
    fs.writeFileSync(path.join(OUT, '07-card-inserted-closeup.png'),
      Buffer.from(readerShot.split(',')[1], 'base64'));
  }

  // --- 08: finish the entry; approved glass ----------------------------------
  for (const key of ['2', '2']) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (
    ['receipt', 'bagging', 'done'].includes(window.__fw.scene3d.clubhouse().register.getTx()?.stage)
  ), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await shot('08-approved.png');

  // --- 09: the sale banks and the register KEEPS the player at the till ------
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return !register.getTx();
  }, null, { timeout: 30000 });
  const stayProbe = [];
  for (let second = 0; second < 8; second += 1) {
    stayProbe.push(await page.evaluate(() => ({
      active: window.__fw.scene3d.clubhouse().register.isActive(),
      registerModeClass: document.body.classList.contains('register-mode'),
      tx: !!window.__fw.scene3d.clubhouse().register.getTx(),
    })));
    await page.waitForTimeout(1000);
  }
  report.stayInView = stayProbe;
  report.poseAfterSale = await readPose();
  {
    const a = report.poseOnEntry;
    const b = report.poseAfterSale;
    const dist = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
    // quaternion dot -> half-angle between the two orientations
    const dot = Math.abs(a.quaternion.reduce((sum, v, i) => sum + v * b.quaternion[i], 0));
    const sa = a.solved || {};
    const sb = b.solved || {};
    report.frameDrift = {
      eyeMovedYd: +dist.toFixed(4),
      lookTurnedDeg: +(2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI).toFixed(3),
      fovChanged: a.fov !== b.fov,
      // the composition itself — this is what round 8 changed
      solvedYawDeg: +(((sb.yaw ?? 0) - (sa.yaw ?? 0)) * 180 / Math.PI).toFixed(4),
      solvedPitchDeg: +(((sb.pitch ?? 0) - (sa.pitch ?? 0)) * 180 / Math.PI).toFixed(4),
      solvedEyeMovedYd: +Math.hypot(
        (sb.x ?? 0) - (sa.x ?? 0), (sb.y ?? 0) - (sa.y ?? 0), (sb.z ?? 0) - (sa.z ?? 0),
      ).toFixed(4),
      poseKeyOnEntry: sa.poseKey ?? null,
      poseKeyAfterSale: sb.poseKey ?? null,
    };
  }
  await shot('09-post-sale-stays.png');

  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(report, null, 2));
  const stayedThroughout = stayProbe.every((sample) => sample.active && sample.registerModeClass);
  // The composition must be IDENTICAL; the live camera is allowed the tiny
  // residue of easing between poses.
  const frameHeld = report.frameDrift.solvedEyeMovedYd < 0.001
    && Math.abs(report.frameDrift.solvedYawDeg) < 0.01
    && Math.abs(report.frameDrift.solvedPitchDeg) < 0.01
    && !report.frameDrift.fovChanged;
  return { ok: true, out: OUT, stayedThroughout, frameHeld, drift: report.frameDrift, report };
}
