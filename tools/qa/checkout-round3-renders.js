async (page) => {
  // CHECKOUT-PHYSICALITY ROUND 3 EVIDENCE (2026-07-30). Captures the beats the
  // two acceptance drivers do not photograph deliberately:
  //   - the bright-green grabbable rim + "Take payment" chip on offered cash/card
  //   - the drawer-slot tooltip chip
  //   - RIGHT-CLICK retract on a drawer well (one piece back off the pile)
  //   - SPACE finishing the transaction at the drawer
  //   - the flat change pile on the BARE counter (trays deleted)
  //   - the drawer-derived camera, the upright bag, the receipt beat
  // Saves under qa/cash-register-production/simplified-rebuild/checkout-round3/.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/checkout-round3');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
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
  }, null, { timeout: 15000 });
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
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 5000 });
  await page.waitForTimeout(1400);
  await shot('01-working-frame-upright-bag.png');

  // ring all three up (click-slide into the upright bag)
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
      if (q.denom !== undefined && Number(o.userData.denom) !== Number(q.denom)) return;
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
  let midSlideShot = false;
  for (const uid of uids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) { point = next; break; }
      point = next;
    }
    assert(point && point.inView, `item ${uid} not visible`);
    await page.mouse.click(point.x, point.y);
    if (!midSlideShot) {
      await page.waitForFunction(() => {
        const p = window.__fw.scene3d.clubhouse().register.scanPresentation();
        return p.active && p.phase === 'slide' && p.phaseT > 0.35;
      }, null, { timeout: 5000 }).catch(() => {});
      await shot('02-item-sliding-sideways-into-bag.png');
      midSlideShot = true;
    }
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 6000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 8000 });
  }

  // offered cash: green rim + "Take payment" chip
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'cash-tender' && register.presentedCashScreenPoint()?.inView;
  }, null, { timeout: 12000 });
  await page.waitForTimeout(950);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  await page.mouse.move(handful.x, handful.y);
  await page.waitForTimeout(350);
  const cashTip = await page.evaluate(() => {
    const chip = document.querySelector('.register-tip');
    return chip && chip.style.display !== 'none' ? chip.textContent : null;
  });
  assert(cashTip === 'Take payment', `offered-cash tooltip read ${JSON.stringify(cashTip)}`);
  await shot('03-offered-cash-green-outline.png');

  // take it; the drawer opens and the derived drawer camera eases in
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.drawerOpen && tx.deposited;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(1300);
  await shot('04-drawer-derived-camera.png');

  // drawer-slot tooltip chip
  const oneSlot = await projectObject({ kind: 'money', from: 'drawer', denom: 1 });
  assert(oneSlot && oneSlot.inView, 'the $1 well is not visible in the drawer camera');
  await page.mouse.move(oneSlot.x, oneSlot.y);
  await page.waitForTimeout(350);
  const slotTip = await page.evaluate(() => {
    const chip = document.querySelector('.register-tip');
    return chip && chip.style.display !== 'none' ? chip.textContent : null;
  });
  assert(slotTip && slotTip.includes('$1') && slotTip.includes('right-click'),
    `drawer-slot tooltip read ${JSON.stringify(slotTip)}`);
  await shot('05-drawer-slot-tooltip.png');

  const giving = () => page.evaluate(async () => {
    const R = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return { giving: R.handTotal(tx), state: R.changeGivingState(tx).state };
  });

  // LEFT-click gives one $1 onto the bare-counter pile; do it twice
  await page.mouse.click(oneSlot.x, oneSlot.y);
  await page.waitForFunction(async () => true, null, { timeout: 500 }).catch(() => {});
  await page.waitForTimeout(250);
  const afterOne = await giving();
  assert(Math.round(afterOne.giving * 100) === 100, `left-click did not give $1 (${afterOne.giving})`);
  const oneSlotAgain = await projectObject({ kind: 'money', from: 'drawer', denom: 1 });
  await page.mouse.click(oneSlotAgain.x, oneSlotAgain.y);
  await page.waitForTimeout(250);
  const afterTwo = await giving();
  assert(Math.round(afterTwo.giving * 100) === 200, `second left-click did not give $1 (${afterTwo.giving})`);
  await shot('06-change-flat-pile-on-counter.png');

  // RIGHT-click the same well retracts exactly one — the pile shrinks
  const retractSlot = await projectObject({ kind: 'money', from: 'drawer', denom: 1 });
  await page.mouse.click(retractSlot.x, retractSlot.y, { button: 'right' });
  await page.waitForTimeout(300);
  const afterRetract = await giving();
  assert(Math.round(afterRetract.giving * 100) === 100,
    `right-click did not retract one $1 (${afterRetract.giving})`);
  const stillActive = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  assert(stillActive, 'right-click over the drawer well exited the register');
  await shot('07-right-click-retracted-one.png');

  // count the exact change, then SPACE finishes the transaction
  const plan = await page.evaluate(async () => {
    const R = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const due = R.changeDue(tx);
    return {
      due,
      already: R.handTotal(tx),
      plan: R.makeChangeFrom(R.drawerContents(tx, window.__fw.state.shop.drawer), due - R.handTotal(tx)),
    };
  });
  assert(plan.plan, `drawer cannot complete the remaining $${(plan.due - plan.already).toFixed(2)}`);
  for (const [rawDenom, count] of Object.entries(plan.plan)) {
    for (let index = 0; index < count; index += 1) {
      const slot = await projectObject({ kind: 'money', from: 'drawer', denom: Number(rawDenom) })
        || await projectObject({ kind: 'drawer-slot', denom: Number(rawDenom) });
      assert(slot && slot.inView, `slot ${rawDenom} not visible`);
      const target = await page.evaluate(({ center, wanted }) => {
        const register = window.__fw.scene3d.clubhouse().register;
        const samples = [{ x: center.x, y: center.y }];
        for (let radius = 4; radius <= 36; radius += 4) {
          for (let step = 0; step < 16; step += 1) {
            const angle = (step / 16) * Math.PI * 2;
            samples.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
          }
        }
        for (const point of samples) {
          const picked = register.debugPickAt(point.x, point.y).physical;
          if (Number(picked?.denom) === Number(wanted)
              && (picked.kind === 'drawer-slot' || picked.from === 'drawer')) return point;
        }
        return null;
      }, { center: slot, wanted: rawDenom });
      assert(target, `no clickable point for slot ${rawDenom}`);
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(140);
    }
  }
  const exact = await giving();
  assert(exact.state === 'exact', `count is not exact: ${JSON.stringify(exact)}`);
  await shot('08-exact-change-counted.png');
  await page.keyboard.press(' ');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
  }, null, { timeout: 6000 });
  await shot('09-space-finished-change-handoff.png');

  // the receipt beat: print at the visible printer, then hand-over
  const sawPrint = await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-print'
  ), null, { timeout: 10000 }).then(() => true).catch(() => false);
  assert(sawPrint, 'the visible receipt-print phase never ran');
  await page.waitForTimeout(500);
  await shot('10-receipt-printing-in-frame.png');
  await page.waitForFunction(() => (
    ['receipt-deliver', 'receipt-customer-hold'].includes(
      window.__fw.scene3d.clubhouse().register.deliveryPhase(),
    )
  ), null, { timeout: 8000 });
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.deliveryPhase() === 'receipt-customer-hold'
  ), null, { timeout: 8000 });
  await shot('11-receipt-handed-to-customer.png');

  // let the sale finish and the register clear
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 20000 });
  await shot('12-sale-complete.png');

  // SECOND CUSTOMER, CARD: green rim on the offered card, riser + protruding card
  const second = await page.evaluate(([skuIds]) => (
    window.__fw.scene3d.clubhouse().sendToCounter(skuIds, 'card')
  ), [SKUS]);
  assert(second, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 20000 });
  const cardUids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (const uid of cardUids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) { point = next; break; }
      point = next;
    }
    assert(point && point.inView, `card-route item ${uid} not visible`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 6000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 8000 });
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    const point = register.presentedCardScreenPoint();
    return tx?.stage === 'card-ready' && point?.inView && point.clickable;
  }, null, { timeout: 12000 });
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  const cardInHand = await page.evaluate(async () => {
    // the customer rigs live OUTSIDE the interior group, so a grip-parented
    // card must be searched from the whole scene
    let card = null;
    window.__fw.scene3d.scene.traverse((o) => {
      if (!card && o.userData?.kind === 'payment-card') card = o;
    });
    for (let node = card; node; node = node.parent) {
      if (node.userData?.kind === 'customer-carry-grip') return true;
    }
    return false;
  });
  assert(cardInHand, 'the offered card is not parented to the customer carry grip');
  await page.mouse.move(cardPoint.x, cardPoint.y);
  await page.waitForTimeout(350);
  const cardTip = await page.evaluate(() => {
    const chip = document.querySelector('.register-tip');
    return chip && chip.style.display !== 'none' ? chip.textContent : null;
  });
  assert(cardTip === 'Take payment', `offered-card tooltip read ${JSON.stringify(cardTip)}`);
  await shot('13-offered-card-green-outline-in-hand.png');
  // The card workspace retains full cursor lean, so the hover dwell above has
  // eased the camera and staled cardPoint. Settle the lean at centre, then
  // re-sample the live projection right before the accept click.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(500);
  const freshCardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(freshCardPoint?.inView && freshCardPoint.clickable, 'offered card left view after hover');
  await page.mouse.click(freshCardPoint.x, freshCardPoint.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-entry';
  }, null, { timeout: 9000 });
  await page.waitForTimeout(900);
  await shot('14-reader-light-face-card-protruding.png');
  const clickKey = async (actionId) => {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), actionId);
    assert(point?.visible && point?.inView, `key ${actionId} not clickable`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
  };
  const cents = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    return Math.round(totalOf(window.__fw.scene3d.clubhouse().register.getTx()) * 100);
  });
  for (const digit of String(cents)) await clickKey(`digit:${digit}`);
  await shot('15-reader-amount-keyed.png');
  await clickKey('confirm');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-busy';
  }, null, { timeout: 4000 });
  await shot('16-reader-processing-card-inserted.png');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 30000 });

  return { ok: true, out: OUT };
}
