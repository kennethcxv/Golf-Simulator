async (page) => {
  // A1 — THE CARD READER LOCKS OUT MID-SALE (playtest 2026-08-03).
  //
  // Reported: "I clicked the offered card, the reader came up, the card STAYED
  // IN THE CUSTOMER'S HAND, the reader showed 304.95 without me pressing a key,
  // and X did nothing. The transaction is dead."
  //
  // This driver does not assume the trigger. It runs the SAME card sale twice,
  // varying exactly one thing — how long the player takes to click the offered
  // card — and reports the flow state, the domain stage and the watchdog log
  // for each.
  //
  //   A (negative control): click promptly. If this does not complete, the
  //      harness is broken and case B proves nothing.
  //   B (suspect):          wait past the CardInsertReady timeout, then click.
  //
  // Both use four items and a total over $300, so if the delay is NOT the
  // trigger the control run reproduces the lockout too and the item count /
  // amount hypotheses stay live.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/card-lockout');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  // four items, matching the reported sale
  const SKUS = ['tees1', 'marker1', 'glove1', 'towel1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const report = { runs: {} };

  await page.setViewportSize(VIEWPORT);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const stageCustomer = async () => {
    await page.evaluate(async ([skuIds]) => {
      const app = window.__fw;
      const { REGISTER } = await import('/src/data/shopLayout.js');
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins(false);
      for (const id of Object.keys(app.state.shop.inventory)) {
        const inventory = app.state.shop.inventory[id];
        if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
      }
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
      return clubhouse.sendToCounter(skuIds, 'card');
    }, [SKUS]);
    await page.waitForFunction((count) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === count;
    }, SKUS.length, { timeout: 30000 });
    // Pin the total at the reported figure so the amount hypothesis is tested
    // at the amount it was reported at, not at whatever the seed rolls.
    return page.evaluate(async () => {
      const { totalOf } = await import('/src/sim/register.js');
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const prices = [96.40, 74.25, 68.15, 42.10];
      tx.items.forEach((item, index) => {
        item.price = prices[index];
        item.priceCents = Math.round(prices[index] * 100);
      });
      tx.rng = () => 0.9;
      return { total: totalOf(tx), items: tx.items.length };
    });
  };

  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((o) => {
      if (found || !o.visible || !o.userData) return;
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

  const ringUp = async () => {
    const uids = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
    ));
    for (const uid of uids) {
      await settleAndClick({ kind: 'item', uid }, `item ${uid}`);
      await page.waitForFunction((id) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        const item = tx?.items.find((candidate) => candidate.uid === id);
        return !!(item?.scanned && item?.bagged);
      }, uid, { timeout: 12000 });
      await page.waitForFunction(() => {
        const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
        return state === 'WaitingForScan' || state === 'AllProductsScanned';
      }, null, { timeout: 12000 });
    }
  };

  const readState = () => page.evaluate(async () => {
    const { cardEnteredAmount, totalOf } = await import('/src/sim/register.js');
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    const flow = register.getFlow();
    const point = register.presentedCardScreenPoint
      ? register.presentedCardScreenPoint() : null;
    return {
      stage: tx?.stage || null,
      method: tx?.method || null,
      total: tx ? totalOf(tx) : null,
      entered: tx ? cardEnteredAmount(tx) : null,
      entryDigits: String(tx?.cardEntryDigits || ''),
      flowState: flow?.state || null,
      recovery: flow?.recovery ? { ...flow.recovery } : null,
      cardPoint: point ? { inView: point.inView, clickable: point.clickable } : null,
      watchdog: register.checkoutWatchdogDiagnostics(),
    };
  });

  const waitForInsertReady = async () => {
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return tx?.stage === 'card-ready'
        && register.getFlow()?.state === 'CardInsertReady';
    }, null, { timeout: 30000 });
  };

  const clickOfferedCard = async () => {
    const point = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
    ));
    if (!point || !point.inView) return false;
    await page.mouse.click(point.x, point.y);
    return true;
  };

  const runSale = async ({ label, delayMs }) => {
    await stageCustomer();
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 12000 });
    await page.waitForTimeout(1600);
    await ringUp();
    await waitForInsertReady();
    const atReady = await readState();
    // the one variable
    await page.waitForTimeout(delayMs);
    const beforeClick = await readState();
    const clicked = await clickOfferedCard();
    await page.waitForTimeout(1600);
    const afterClick = await readState();
    await shot(`${label}-after-click.png`);
    // Can the player get out? Try the reader's X, then the keyboard exit.
    const xPoint = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.cardXScreenPoint()
    ));
    if (xPoint && xPoint.inView) await page.mouse.click(xPoint.x, xPoint.y);
    await page.waitForTimeout(900);
    const afterX = await readState();
    await shot(`${label}-after-x.png`);
    const entry = {
      delayMs,
      totalCharged: atReady.total,
      items: SKUS.length,
      atReady: { stage: atReady.stage, flowState: atReady.flowState },
      beforeClick: {
        stage: beforeClick.stage,
        flowState: beforeClick.flowState,
        recovery: beforeClick.recovery,
        watchdogEvents: beforeClick.watchdog.events,
      },
      clicked,
      afterClick: {
        stage: afterClick.stage,
        flowState: afterClick.flowState,
        entered: afterClick.entered,
        cardPoint: afterClick.cardPoint,
      },
      xVisible: !!(xPoint && xPoint.inView),
      afterX: { stage: afterX.stage, flowState: afterX.flowState },
      recovered: afterX.flowState !== 'Recovery'
        && (afterClick.stage === 'card-entry' || afterX.stage === 'scanning'),
    };
    report.runs[label] = entry;
    return entry;
  };

  // ---- A: negative control — a prompt click must complete the same sale -----
  const control = await runSale({ label: 'A-prompt-click', delayMs: 400 });
  assert(control.afterClick.stage === 'card-entry',
    `NEGATIVE CONTROL FAILED: a promptly clicked four-item $${control.totalCharged} card sale did not reach amount entry (${JSON.stringify(control.afterClick)}). Nothing below this line can be trusted.`);

  // clear the control customer before the suspect run
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.register.exit?.();
    clubhouse.clearWalkins?.();
  });
  await page.waitForTimeout(1500);

  // ---- B: the suspect — same sale, the player takes a beat -----------------
  const slow = await runSale({ label: 'B-slow-click', delayMs: 6000 });

  report.verdict = {
    controlReachedAmountEntry: control.afterClick.stage === 'card-entry',
    slowReachedAmountEntry: slow.afterClick.stage === 'card-entry',
    slowStuckInRecovery: slow.beforeClick.flowState === 'Recovery',
    slowRecoverable: slow.recovered,
    delayIsTheTrigger: control.afterClick.stage === 'card-entry'
      && slow.afterClick.stage !== 'card-entry',
  };
  fs.writeFileSync(path.join(OUT, 'card-lockout.json'), JSON.stringify(report, null, 2));
  return report;
}
