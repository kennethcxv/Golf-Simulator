async (page) => {
  // MANUAL ACCEPTANCE: a whole sale, driven through the controls a player has.
  //
  // Nothing here reaches into the transaction. Every step is a real mouse click at a
  // real screen pixel, or a real keypress — the same events main.js routes. The only
  // thing the harness does that a player cannot is `sendToCounter`, which spawns a
  // shopper holding shelf-debited goods so we do not have to wait on the RNG to
  // produce a two-item customer. It skips the browsing, not the accounting.
  //
  // Set MODE to 'card' or 'cash'. Screenshots land in qa/register/<MODE>/.
  //
  // TWO THINGS THIS FILE LEARNED THE HARD WAY.
  //
  // 1. forward = (-sin yaw, -cos yaw), so yaw 0 faces -z and yaw PI faces +z. The
  //    first cut set yaw = PI "to face the counter" and the player faced the back
  //    wall. The register prop's facing test rejected [E], register mode never
  //    opened, and every scan step reported 0/2 — which read like a broken scanner
  //    and was a broken harness.
  //
  // 2. NEVER SLEEP FOR STATE. Headless rAF runs slow, so a fixed 1.6s wait under-ran
  //    a 1.5s card auth plus a 0.8s printer, and the harness reported "receipt never
  //    printed" when the receipt printed fine two seconds later. Every wait below is
  //    a condition on the real transaction.

  const MODE = 'cash';
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'register', MODE,
  );
  const errors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); };
  const log = [];

  const txNow = () => page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    if (!tx) return null;
    return {
      stage: tx.stage, method: tx.method,
      scanned: tx.items.filter((i) => i.scanned).length,
      bagged: tx.items.filter((i) => i.bagged).length,
      of: tx.items.length,
      cardAttempts: tx.cardAttempts, cardsTried: tx.cardsTried,
      receiptPrinted: !!tx.receiptPrinted, banked: !!tx.banked,
    };
  });
  const money = () => page.evaluate(() => ({
    revenue: (window.__fw.state.shop.salesLive || {}).revenue || 0,
    units: (window.__fw.state.shop.salesLive || {}).units || 0,
    held: (window.__fw.state.shop.held || []).length,
    saleHeld: (window.__fw.state.shop.held || [])
      .filter((unit) => unit.uid === 'customer-unit-1' || unit.uid === 'customer-unit-2').length,
    shelfBalls: window.__fw.state.shop.inventory.balls3.shelf,
    shelfGlove: window.__fw.state.shop.inventory.glove1.shelf,
  }));
  // Wait for a REAL condition on the transaction, never for a stopwatch. Typed
  // predicates, not eval'd source: a harness that builds `new Function()` out of a
  // string is a code-injection shape, and there is no reason to reach for one here.
  const untilTx = (ms = 30000) => page.waitForFunction(
    () => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: ms });
  const untilStage = (stages, ms = 30000) => page.waitForFunction((want) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && want.includes(tx.stage);
  }, Array.isArray(stages) ? stages : [stages], { timeout: ms });
  const untilFlag = (key, val, ms = 30000) => page.waitForFunction(([k, v]) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx[k] === v;
  }, [key, val], { timeout: ms });

  // WAIT FOR THE CAMERA TO ACTUALLY ARRIVE. isActive() flips true the instant [E] is
  // pressed, but the cashier pose BLENDS in over 0.4s — and headless rAF is throttled,
  // so a wall-clock wait under-runs the ease. Project an item while the camera is still
  // mid-flight and you get a pixel ~90px off; the click lands on bare counter, nothing
  // is grabbed, and the run reports "scanned: 0" as though the scanner were broken.
  // It is the same trap as sleeping for the receipt. Never sleep for state.
  const CASHIER_EYE = { x: 2.78, z: 5.52 };   // REGISTER cashier pose, clubhouse-local
  const untilCameraSettled = (ms = 30000) => page.waitForFunction((eye) => {
    const c = window.__fw.scene3d.camera;
    const origin = window.__fw.scene3d.clubhouse().interior.position;
    return Math.hypot(c.position.x - (eye.x + origin.x), c.position.z - (eye.z + origin.z)) < 0.03;
  }, CASHIER_EYE, { timeout: ms });


  // --- boot ------------------------------------------------------------------------
  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  const continueButton = page.getByText('Continue', { exact: true });
  if (await continueButton.count() && await continueButton.isEnabled()) {
    await continueButton.click();
  } else {
    const polishedNewGame = page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ });
    if (await polishedNewGame.count()) {
      await polishedNewGame.click();
      await page.getByRole('dialog', { name: 'New game' }).waitFor();
      await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
    } else {
      await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
    }
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  }
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // --- set the stage ----------------------------------------------------------------
  await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const app = window.__fw;
    app.speedIdx = 0; // a QA camera fixture must not roll past closing time mid-sale
    window.__qa = {
      // interior-local -> screen pixels, so a click lands on the pixel the thing is
      // actually drawn at, not where I hope it is
      px(lx, ly, lz) {
        const s3 = app.scene3d;
        const ch = s3.clubhouse();
        const v = new THREE.Vector3(
          lx + ch.interior.position.x, ly + ch.interior.position.y, lz + ch.interior.position.z,
        );
        v.project(s3.camera);
        const c = document.querySelector('canvas').getBoundingClientRect();
        return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((-v.y + 1) / 2) * c.height };
      },
      // AIM AT THE BOUNDING-BOX CENTRE, not the origin. A banknote is 1.8 mm thick, so
      // "origin plus 4 cm" is a ray that sails clean over it and grabs nothing — which
      // is exactly how the cash run stalled with the notes still on the counter.
      centre(m, ch) {
        const b = new THREE.Box3().setFromObject(m);
        const c = b.getCenter(new THREE.Vector3());
        const o = ch.interior.position;
        return { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
      },
      find(kind, i = 0) {
        const ch = app.scene3d.clubhouse();
        const out = [];
        ch.interior.traverse((o) => {
          if (o.userData && o.userData.kind === kind && o.visible) out.push(o);
        });
        const m = out[i];
        if (!m) return null;
        const c = window.__qa.centre(m, ch);
        return { ...c, uid: m.userData.uid || null, denom: m.userData.denom || null, n: out.length };
      },
      findMoney(from, denom) {
        const ch = app.scene3d.clubhouse();
        const out = [];
        ch.interior.traverse((o) => {
          const u = o.userData;
          if (u && u.kind === 'money' && u.from === from && (denom == null || u.denom === denom) && o.visible) out.push(o);
        });
        if (!out.length) return null;
        const m = out[out.length - 1];   // the top of the stack
        const c = window.__qa.centre(m, ch);
        return { ...c, denom: m.userData.denom, n: out.length };
      },
      // Find a pixel whose ray really resolves to the requested open-drawer stack.
      // Projecting only a mesh centre is not sufficient when two foreshortened bill
      // stacks overlap on screen: the nearer denomination can win the raycast.
      drawerMoneyPx(denom) {
        const ch = app.scene3d.clubhouse();
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const roots = [];
        const desired = [];
        ch.interior.traverse((o) => {
          if (!o.visible || !o.userData?.pick) return;
          roots.push(o);
          if (o.userData.kind === 'money' && o.userData.from === 'drawer'
              && o.userData.denom === Number(denom)) desired.push(o);
        });
        if (!desired.length) return null;

        const ray = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const hitsWanted = (x, y) => {
          ndc.set(((x - rect.left) / rect.width) * 2 - 1,
            -(((y - rect.top) / rect.height) * 2 - 1));
          ray.setFromCamera(ndc, app.scene3d.camera);
          const hit = ray.intersectObjects(roots, true)[0];
          if (!hit) return false;
          let root = hit.object;
          while (root && !root.userData?.pick && root.parent) root = root.parent;
          return root?.userData?.kind === 'money'
            && root.userData.from === 'drawer'
            && root.userData.denom === Number(denom);
        };

        for (let targetIndex = desired.length - 1; targetIndex >= 0; targetIndex--) {
          const box = new THREE.Box3().setFromObject(desired[targetIndex]);
          const points = [];
          for (const x of [box.min.x, (box.min.x + box.max.x) / 2, box.max.x]) {
            for (const y of [box.min.y, (box.min.y + box.max.y) / 2, box.max.y]) {
              for (const z of [box.min.z, (box.min.z + box.max.z) / 2, box.max.z]) {
                const p = new THREE.Vector3(x, y, z).project(app.scene3d.camera);
                points.push({
                  x: rect.left + ((p.x + 1) / 2) * rect.width,
                  y: rect.top + ((-p.y + 1) / 2) * rect.height,
                });
              }
            }
          }
          const minX = Math.min(...points.map((p) => p.x)) - 3;
          const maxX = Math.max(...points.map((p) => p.x)) + 3;
          const minY = Math.min(...points.map((p) => p.y)) - 3;
          const maxY = Math.max(...points.map((p) => p.y)) + 3;
          for (let gy = 1; gy <= 9; gy++) {
            for (let gx = 1; gx <= 9; gx++) {
              const x = minX + (maxX - minX) * (gx / 10);
              const y = minY + (maxY - minY) * (gy / 10);
              if (hitsWanted(x, y)) return { x, y };
            }
          }
        }
        return null;
      },
    };
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    const targetSkus = ['balls3', 'glove1'];
    lifecycle.ensureInventoryLifecycle(app.state);
    for (const id of targetSkus) {
      const inv = app.state.shop.inventory[id];
      const wanted = Math.max(inv.shelf, 10);
      const added = wanted - inv.shelf;
      if (added > 0) {
        const adopted = lifecycle.adoptExternalInventory(app.state, {
          skuId: id,
          quantity: added,
          stage: lifecycle.INVENTORY_STAGE.SHELF,
          note: 'Deterministic browser checkout fixture',
        });
        if (!adopted.ok) throw new Error(`Could not establish ${id} checkout fixture: ${adopted.reason}`);
        inv.shelf = wanted;
      }
    }
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    clubhouse.rebuildStock();

    // behind the till, FACING IT: yaw 0 is -z, which is where the counter is
    const st = app.scene3d.walk.state;
    const origin = clubhouse.interior.position;
    st.x = 2.80 + origin.x;
    st.z = 5.10 + origin.z;
    st.yaw = 0;
    st.pitch = -0.18;
  });
  await page.waitForTimeout(800);

  log.push({ step: '0. before', ...(await money()) });

  // --- a customer arrives -------------------------------------------------------------
  const who = await page.evaluate((m) => window.__fw.scene3d.clubhouse().sendToCounter(['balls3', 'glove1'], m), MODE);
  await untilTx();
  await page.waitForTimeout(900);
  await shot('01-customer-at-counter');
  log.push({ step: '1. customer at the counter', who, ...(await money()), tx: await txNow() });

  // --- [E] into register mode -----------------------------------------------------------
  await page.keyboard.press('e');
  await untilCameraSettled();
  await page.waitForTimeout(250);
  await shot('02-register-mode');
  log.push({ step: '2. [E] register mode', active: await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()) });

  // --- SCAN: drag each item across the glass ---------------------------------------------
  // Nothing calls scanItem(). The CROSSING calls it.
  // `via` routes the drag through a waypoint — the scanner glass, for a scan. Leave it
  // out and it goes straight there, which is what putting a note in the till should do.
  const dragTo = async (at, toLocal, { via = null, steps = 14 } = {}) => {
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const to = await page.evaluate((p) => window.__qa.px(p[0], p[1], p[2]), toLocal);
    const legs = [];
    if (via) legs.push(await page.evaluate((p) => window.__qa.px(p[0], p[1], p[2]), via));
    legs.push(to);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    let cur = from;
    for (const leg of legs) {
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        await page.mouse.move(cur.x + (leg.x - cur.x) * t, cur.y + (leg.y - cur.y) * t);
        await page.waitForTimeout(14);
      }
      cur = leg;
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  // A drawer stack can be partly hidden by the counter lip. Its projected box
  // centre is therefore not guaranteed to be a pickable pixel. Search the
  // visible projected bounds and retain only a point whose actual scene ray
  // resolves to the requested physical denomination.
  const moneyClickPoint = (from, denom) => page.evaluate(async ([wantedFrom, wantedDenom]) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const candidates = [];
    clubhouse.interior.traverse((object) => {
      const data = object.userData || {};
      if (object.visible && data.kind === 'money' && data.from === wantedFrom
        && Number(data.denom) === Number(wantedDenom)) candidates.push(object);
    });
    const raycaster = new THREE.Raycaster();
    const pickable = (object) => {
      for (let current = object; current; current = current.parent) {
        if (current.userData?.pick) return current;
      }
      return null;
    };
    const project = (point) => {
      const ndc = point.clone().project(app.scene3d.camera);
      return {
        x: rect.left + ((ndc.x + 1) / 2) * rect.width,
        y: rect.top + ((-ndc.y + 1) / 2) * rect.height,
      };
    };
    for (const object of candidates.reverse()) {
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) continue;
      const corners = [];
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) corners.push(project(new THREE.Vector3(x, y, z)));
        }
      }
      const minX = Math.min(...corners.map((point) => point.x));
      const maxX = Math.max(...corners.map((point) => point.x));
      const minY = Math.min(...corners.map((point) => point.y));
      const maxY = Math.max(...corners.map((point) => point.y));
      for (const fy of [0.25, 0.5, 0.75]) {
        for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          const x = minX + (maxX - minX) * fx;
          const y = minY + (maxY - minY) * fy;
          const ndc = new THREE.Vector2(
            ((x - rect.left) / rect.width) * 2 - 1,
            -(((y - rect.top) / rect.height) * 2 - 1),
          );
          raycaster.setFromCamera(ndc, app.scene3d.camera);
          const hit = raycaster.intersectObjects(clubhouse.interior.children, true)
            .map((entry) => pickable(entry.object))
            .find(Boolean);
          if (hit === object) return { x, y, denom: wantedDenom };
        }
      }
    }
    return null;
  }, [from, denom]);
  const scan = async (i) => {
    const at = await page.evaluate((k) => window.__qa.find('item', k), i);
    if (!at) return false;
    await dragTo(at, [3.68, 1.17, 4.44], { via: [2.70, 1.17, 4.22] });   // over the glass
    return true;
  };

  await scan(0);
  await shot('03-scanned-one');
  log.push({ step: '3. dragged item 1 over the glass', tx: await txNow() });

  await scan(0);   // the SAME item again — it must not count twice
  log.push({ step: '4. dragged the SAME item back over the glass', tx: await txNow(), expect: 'scanned still 1' });

  await page.keyboard.press('t');   // payment with one unscanned — must refuse
  await page.waitForTimeout(250);
  log.push({ step: '5. [T] with 1 unscanned', tx: await txNow(), expect: 'stage scanning, method null' });

  await scan(1);
  await shot('04-all-scanned');
  log.push({ step: '6. dragged item 2 over the glass', tx: await txNow() });

  // --- TOTAL --------------------------------------------------------------------------
  await page.keyboard.press('t');
  await untilFlag('method', MODE);
  await page.waitForTimeout(400);
  await shot('05-totalled');
  log.push({ step: '7. [T] total', tx: await txNow(), ...(await money()), expect: 'revenue still 0' });

  const term = await page.evaluate(() => window.__qa.px(2.05, 1.12, 3.88));

  if (MODE === 'card') {
    // --- CARD ---------------------------------------------------------------------------
    await page.mouse.click(term.x, term.y);
    await untilStage('card-ready');
    await shot('06-card-presented');
    log.push({ step: '8. clicked terminal — they present', tx: await txNow() });

    // A terminal tap must not silently authorize the sale. The player has to
    // take the visible card and physically swipe it through the reader.
    await page.mouse.click(term.x, term.y);
    await page.waitForTimeout(250);
    const afterTap = await txNow();
    if (afterTap?.stage !== 'card-ready' || afterTap.cardAttempts !== 0) {
      throw new Error(`A terminal tap bypassed the physical card swipe: ${JSON.stringify(afterTap)}`);
    }
    log.push({ step: '8b. terminal tap alone does not run the card', tx: afterTap });
    const swipeCard = async () => {
      const card = await page.evaluate(() => window.__qa.find('card'));
      if (!card) throw new Error('The presented card is not visible or pickable.');
      await dragTo(card, [2.31, 1.17, 3.98], { steps: 24 });
      await untilStage('card-busy');
    };
    await swipeCard();
    await shot('07-card-authorising');
    log.push({ step: '9. physically swiped card left to right — running', tx: await txNow(), ...(await money()) });

    await untilStage(['receipt', 'card-declined']);
    let t = await txNow();
    log.push({ step: '10. terminal answered', tx: t, ...(await money()), expect: 'revenue STILL 0 — an approval banks nothing' });
    await shot('08-card-result');

    // declined? they dig out a second card.
    while (t.stage === 'card-declined') {
      await page.mouse.click(term.x, term.y);          // retry -> another card
      await untilStage('card-ready');
      await swipeCard();                               // run the replacement card physically
      await untilStage(['receipt', 'card-declined']);
      t = await txNow();
      log.push({ step: '10b. second card', tx: t });
    }
  } else {
    // --- CASH ---------------------------------------------------------------------------
    // their notes are on the counter. Take them, open the till, put each one away,
    // then count the change back out of the wells.
    let piece = await page.evaluate(() => window.__qa.findMoney('tender'));
    log.push({ step: '8. they counted out notes', notes: piece ? piece.n : 0 });
    await shot('06-cash-on-counter');

    await page.keyboard.press('d');   // drawer refuses until the cash is in hand
    log.push({ step: '9. [D] drawer before taking the cash', tx: await txNow(), expect: 'still cash-tender' });

    // pick up the first note — touching it IS accepting it
    const p0 = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), piece);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    log.push({ step: '10. took their cash', tx: await txNow() });

    await page.keyboard.press('d');   // NOW the drawer opens
    await untilFlag('drawerOpen', true);
    await page.waitForTimeout(700);   // it slides
    await shot('07-drawer-open');
    log.push({ step: '11. [D] drawer open', tx: await txNow() });

    // put every tendered note into the till, one at a time
    for (let guard = 0; guard < 8; guard++) {
      piece = await page.evaluate(() => window.__qa.findMoney('tender'));
      if (!piece) break;
      await dragTo(piece, [2.42, 1.12, 4.98], { steps: 10 });   // straight into the open till
      await page.waitForTimeout(150);
    }
    await shot('08-cash-in-till');
    log.push({ step: '12. put their notes away', tx: await txNow(), ...(await money()) });

    // count the change out of the wells
    const need = await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const paid = tx.tenderedTotal || 0;
      return paid;
    });
    const want = await page.evaluate(async () => {
      const R = await import('/src/sim/register.js');
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return R.makeChange(R.changeDue(tx));
    });
    log.push({ step: '13. change owed', want });
    for (const [denom, n] of Object.entries(want)) {
      for (let k = 0; k < n; k++) {
        const heldBefore = await page.evaluate((d) => {
          const tx = window.__fw.scene3d.clubhouse().register.getTx();
          return tx.hand[Number(d)] || 0;
        }, denom);
        let picked = false;
        let pickedAt = null;
        // Under a heavily throttled headless frame the drawer can finish its last
        // transform between projection and click. Re-project and click the visible
        // note again until the real transaction confirms that the player's hand
        // gained it; this is still the exact mouse interaction a player performs.
        for (let attempt = 0; attempt < 3 && !picked; attempt++) {
          const px = await moneyClickPoint('drawer', Number(denom));
          if (!px) break;
          await page.mouse.click(px.x, px.y);
          picked = await page.waitForFunction(([d, before]) => {
            const tx = window.__fw.scene3d.clubhouse().register.getTx();
            return (tx.hand[Number(d)] || 0) > before;
          }, [denom, heldBefore], { timeout: 1500 }).then(() => true).catch(() => false);
          if (picked) pickedAt = px;
        }
        if (!picked) throw new Error(`No visible pick ray could take the drawer's $${denom} piece.`);
        log.push({ action: 'selected physical change', denom: Number(denom), pixel: pickedAt });
      }
    }
    await shot('09-change-counted');
    log.push({ step: '14. counted the change', tx: await txNow() });

    // hand it over: click their open palm
    const palm = await page.evaluate(() => window.__qa.px(1.78, 1.13, 3.64));
    await page.mouse.click(palm.x, palm.y);
    await untilStage('receipt');
    log.push({ step: '15. handed the change back', tx: await txNow(), ...(await money()), expect: 'revenue STILL 0' });
  }

  // --- RECEIPT -----------------------------------------------------------------------
  await untilFlag('receiptPrinted', true);
  await page.waitForTimeout(250);
  await shot('10-receipt-printed');
  const rp = await page.evaluate(() => window.__qa.find('receipt'));
  log.push({ step: '16. receipt printed', at: rp && { x: +rp.x.toFixed(2), z: +rp.z.toFixed(2) } });

  const rpx = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), rp);
  await page.mouse.click(rpx.x, rpx.y);
  await untilStage('bagging');
  await page.waitForTimeout(250); // the bagging anchor has settled and input is live
  log.push({ step: '17. took the receipt', tx: await txNow() });

  // --- BAG ---------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const at = await page.evaluate(() => window.__qa.find('item'));
    if (!at) break;
    const from = await page.evaluate((a) => window.__qa.px(a.x, a.y, a.z), at);
    const to = await page.evaluate(() => window.__qa.px(3.50, 1.20, 4.44));   // the open carrier
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let s = 1; s <= 10; s++) {
      const t = s / 10;
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await page.waitForTimeout(14);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  await shot('11-bagged');
  log.push({ step: '18. bagged', tx: await txNow(), ...(await money()), expect: 'revenue STILL 0' });

  // --- HAND IT OVER — the only thing that banks the money ---------------------------------
  const palmPx = await page.evaluate(() => window.__qa.px(1.78, 1.13, 3.64));
  await page.mouse.click(palmPx.x, palmPx.y);
  await page.waitForTimeout(900);
  await shot('12-handed-over');
  log.push({ step: '19. HANDED IT OVER', ...(await money()), expect: 'revenue banked NOW, held back to 0' });

  await page.waitForTimeout(1500);
  await shot('13-done');
  log.push({ step: '20. final', ...(await money()) });

  const inventoryAudit = await page.evaluate(async () => {
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const app = window.__fw;
    const reconciliation = lifecycle.reconcileInventory(app.state, {
      qa: true,
      context: 'browser-checkout-acceptance',
    });
    const data = lifecycle.ensureInventoryLifecycle(app.state);
    const summary = lifecycle.inventoryLifecycleSummary(app.state);
    const soldBySku = {};
    for (const lot of data.lots) {
      if (lot.active === false) continue;
      soldBySku[lot.skuId] = (soldBySku[lot.skuId] || 0)
        + (lot.buckets[lifecycle.INVENTORY_STAGE.SOLD] || 0);
    }
    return {
      reconciled: reconciliation.ok,
      discrepancies: reconciliation.discrepancies,
      totals: summary.totals,
      soldBySku,
      transactionHistory: app.state.shop.transactionHistory?.length || 0,
      held: app.state.shop.held?.length || 0,
    };
  });
  const nonAborted = failedRequests.filter((request) => !/ERR_ABORTED/.test(request.error));
  const finalMoney = log[log.length - 1];
  const ok = errors.length === 0
    && nonAborted.length === 0
    && inventoryAudit.reconciled
    && inventoryAudit.held === 0
    && (inventoryAudit.soldBySku.balls3 || 0) >= 1
    && (inventoryAudit.soldBySku.glove1 || 0) >= 1
    && finalMoney.units >= 2;
  return {
    ok,
    mode: MODE,
    log,
    inventoryAudit,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
    failedRequests,
    nonAbortedFailedRequests: nonAborted,
  };
}
