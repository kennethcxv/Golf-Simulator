// ITEM 27 — "Change is due on 48.6% of sales, so does the drawer actually open
// and get worked? Watch a cash sale end to end and report where the interaction
// breaks."
//
// Item 13 measured the TENDER and found change owed on 48.6% of sales. That says
// nothing about whether the drawer opens, or whether a player can finish the
// sale once it does. This drives one real cash sale from ringing to receipt and
// records the register's own state at every step: stage, drawerOpen, deposited,
// the change-giving state machine, and the hint the game is showing the player.
//
// It does not assert a happy path. It reports WHERE the run stops, which is the
// thing asked for. The only pass/fail is on the instrument: the sale must
// actually reach a cash tender with change owed, or the observation is worthless.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* diff skipped */ }
  const OUT = path.resolve('qa/electron/drawer-run');
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

  // ---- a cash customer at the counter (checkout-round7 staging) ------------
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
    return { customer: !!clubhouse.sendToCounter(skuIds, 'cash') };
  }, SKUS);
  assert(staged.customer, 'no cash fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    tx.rng = () => 0.9; // tenders $40
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);

  // ---- ring the three items up ---------------------------------------------
  const projectItem = (uid) => page.evaluate(async (id) => {
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
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (const uid of uids) {
    let point = await projectItem(uid);
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectItem(uid);
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next; break;
      }
      point = next;
    }
    assert(point && point.inView, `item ${uid} not in the working frame`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 10000 });
  }

  // ---- the tender lies on the desk -----------------------------------------
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 20000 });
  await page.waitForTimeout(1400); // let the notes finish landing

  // ---- watch the whole thing ----------------------------------------------
  const steps = [];
  await page.evaluate(async () => {
    const mod = await import(new URL('src/sim/register.js', document.baseURI).href);
    window.__changeGivingState = mod.changeGivingState;
  });
  const snap = async (label) => {
    const s = await page.evaluate(() => {
      const club = window.__fw.scene3d.clubhouse();
      const reg = club.register;
      const tx = reg.getTx?.();
      if (!tx) return { tx: false };
      // changeGivingState lives in sim/register.js, not on the clubhouse
      // facade - the facade is a hand-written whitelist and does not forward
      // it. Read the sim directly rather than report a null and call it data.
      let change = null;
      try { change = window.__changeGivingState ? window.__changeGivingState(tx) : null; } catch { change = null; }
      return {
        tx: true,
        stage: tx.stage,
        method: tx.method,
        drawerOpen: !!tx.drawerOpen,
        deposited: !!tx.deposited,
        tenderedTotal: tx.tenderedTotal ?? null,
        changeState: change?.state ?? null,
        changeDue: change?.due ?? null,
        given: change?.given ?? null,
        hint: (() => {
          try {
            const h = reg.hint();
            return typeof h === 'string' ? h : (h && h.text) || JSON.stringify(h);
          } catch { return null; }
        })(),
        flow: (() => { try { return reg.checkoutFlowState?.() ?? null; } catch { return null; } })(),
      };
    });
    s.label = label;
    steps.push(s);
    return s;
  };


  await snap('cash-on-desk');
  await page.screenshot({ path: path.join(OUT, '01-tender-on-desk.png') });

  // take the payment the way a player does: click the customer's cash
  const notePoint = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    const pts = reg.presentedTenderScreenPoints ? reg.presentedTenderScreenPoints() : [];
    return pts.find((p) => p.inView !== false) || null;
  });
  let clicked = false;
  if (notePoint) {
    await page.mouse.click(notePoint.x, notePoint.y);
    clicked = true;
    await page.waitForTimeout(1600);
  }
  await snap('after-clicking-cash');
  await page.screenshot({ path: path.join(OUT, '02-after-taking-cash.png') });

  // let the deposit choreography settle, sampling as it goes
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(1200);
    const s = await snap(`settle-${i}`);
    if (s.changeState === 'complete' || !s.tx) break;
  }
  await page.screenshot({ path: path.join(OUT, '03-drawer-worked.png') });

  const withDrawer = steps.filter((s) => s.drawerOpen);
  const last = steps[steps.length - 1];
  const reachedTender = steps.some((s) => s.stage === 'cash-tender' || s.stage === 'cash-drawer');

  const checks = {
    // instrument only: the run must reach a cash sale, or nothing below means anything
    reachedACashSale: reachedTender,
    clickedTheCash: clicked === true,
    capturedSteps: steps.length >= 4,
    readTheChangeState: steps.some((s) => s.changeState !== null),
    noPageErrors: errs.length === 0,
  };
  const out = {
    steps,
    drawerEverOpened: withDrawer.length > 0,
    drawerOpenedAtStep: withDrawer.length ? withDrawer[0].label : null,
    depositedEver: steps.some((s) => s.deposited),
    changeStatesSeen: [...new Set(steps.map((s) => s.changeState).filter(Boolean))],
    stagesSeen: [...new Set(steps.map((s) => s.stage).filter(Boolean))],
    finalState: last,
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'drawer-run.json'), `${JSON.stringify(out, null, 1)}
`);
  return out;
}
