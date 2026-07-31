async (page) => {
  // CHECKOUT-PHYSICALITY ROUND 4 EVIDENCE (2026-07-30). Photographs the three
  // playtest items against Designs/CashRegister/Final:
  //   1 the working frame — derived square-on pose: upright bag LEFT, goods
  //     CENTRE, POS RIGHT and un-rotated, customer across the counter, nothing
  //     clipped by a frame edge (reference 154454)
  //   2 the card reader — clickable physical keys, red X / yellow ⌫ / green OK,
  //     banded Payment/Total face, card protruding (references 154606, 154618)
  //   3 the cash drawer — big, lit, five distinct notes and five distinct
  //     coins labelled 1¢ 5¢ 10¢ 25¢ 50¢ (references 154525, 154641)
  // Saves under qa/cash-register-production/simplified-rebuild/checkout-round4/.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/checkout-round4');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const report = { framing: {}, keys: {}, drawer: {} };

  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw && window.__fw.scene3d
    && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const fixture = await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import('/src/data/shopLayout.js');
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
  await page.waitForTimeout(1600);

  // --- ITEM 1: measure the working frame -----------------------------------
  // Every named subject is projected and reported as a viewport-fraction box so
  // "nothing is clipped" and "the POS is not a rotated slab on the right edge"
  // are numbers, not impressions.
  const frameMetrics = async () => page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    const rect = document.querySelector('canvas').getBoundingClientRect();
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
            minX = Math.min(minX, (p.x + 1) / 2);
            maxX = Math.max(maxX, (p.x + 1) / 2);
            minY = Math.min(minY, (-p.y + 1) / 2);
            maxY = Math.max(maxY, (-p.y + 1) / 2);
          }
        }
      }
      return {
        minX, maxX, minY, maxY, behind,
        w: maxX - minX, h: maxY - minY,
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        inside: !behind && minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1,
      };
    };
    const find = (test, from) => {
      let hit = null;
      (from || clubhouse.interior).traverse((o) => {
        if (!hit && o.visible && test(o)) hit = o;
      });
      return hit;
    };
    const bag = find((o) => o.userData?.kind === 'bag');
    const items = [];
    clubhouse.interior.traverse((o) => { if (o.userData?.kind === 'item' && o.visible) items.push(o); });
    const monitor = find((o) => o.isMesh
      && (o.material === clubhouse.register.screenMaterial || o.name === 'POS_Screen'));
    let customer = null;
    app.scene3d.scene.traverse((o) => {
      if (!customer && o.userData?.kind === 'customer-carry-grip') customer = o;
    });
    const itemsBox = items.length
      ? items.map(boxOf).filter(Boolean).reduce((a, b) => ({
        minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY),
        inside: a.inside && b.inside,
      }))
      : null;
    return {
      bag: bag ? boxOf(bag) : null,
      items: itemsBox && {
        ...itemsBox, w: itemsBox.maxX - itemsBox.minX, h: itemsBox.maxY - itemsBox.minY,
        cx: (itemsBox.minX + itemsBox.maxX) / 2, cy: (itemsBox.minY + itemsBox.maxY) / 2,
      },
      itemCount: items.length,
      monitor: monitor ? boxOf(monitor) : null,
      monitorName: monitor?.name || null,
      customer: customer ? boxOf(customer) : null,
      cameraFov: camera.fov,
      viewport: { w: rect.width, h: rect.height },
    };
  });
  report.framing.working = await frameMetrics();
  await shot('01-working-frame.png');

  // --- ring the goods up ---------------------------------------------------
  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import('/vendor/three.module.js');
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
  for (const uid of uids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) { point = next; break; }
      point = next;
    }
    assert(point && point.inView, `item ${uid} not visible in the working frame`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 8000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 8000 });
  }
  report.framing.afterScan = await frameMetrics();
  await shot('02-working-frame-rung-up.png');

  // --- ITEM 3: the drawer ---------------------------------------------------
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'cash-tender' && register.presentedCashScreenPoint()?.inView;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.drawerOpen && tx.deposited;
  }, null, { timeout: 12000 });
  await page.waitForTimeout(1600);
  await shot('03-drawer-open.png');

  report.drawer = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    const register = clubhouse.register;
    const slots = new Map();
    let tray = null;
    clubhouse.interior.traverse((o) => {
      if (o.name === 'SimplifiedDrawerMoney') tray = o.parent;
      if (o.userData?.kind === 'drawer-slot') slots.set(Number(o.userData.denom), o);
    });
    const frac = (object) => {
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return null;
      let minX = Infinity; let maxX = -Infinity;
      let minY = Infinity; let maxY = -Infinity;
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
        w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        inside: minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1,
      };
    };
    const denoms = [...slots.keys()].sort((a, b) => a - b);
    const money = new Map();
    clubhouse.interior.traverse((o) => {
      if (o.userData?.kind !== 'money' || o.userData.from !== 'drawer') return;
      const d = Number(o.userData.denom);
      if (!money.has(d)) money.set(d, []);
      money.get(d).push(o);
    });
    const materialSample = (denom) => {
      const pieces = money.get(denom) || [];
      const colours = new Set();
      for (const piece of pieces.slice(0, 2)) {
        piece.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (m?.color) colours.add(`#${m.color.getHexString()}`);
          }
        });
      }
      return [...colours];
    };
    return {
      trayFrac: tray ? frac(tray) : null,
      denoms,
      coinDenoms: denoms.filter((d) => d < 1),
      slotFrac: Object.fromEntries(denoms.map((d) => [d, frac(slots.get(d))])),
      tints: Object.fromEntries(denoms.map((d) => [d, materialSample(d)])),
      pieceCounts: Object.fromEntries(denoms.map((d) => [d, (money.get(d) || []).length])),
      drawerLightIntensity: (() => {
        let total = 0;
        clubhouse.interior.traverse((o) => { if (o.isLight && o.visible) total += o.intensity; });
        return total;
      })(),
    };
  });

  // finish the cash sale so a card customer can follow
  const plan = await page.evaluate(async () => {
    const R = await import('/src/sim/register.js');
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const due = R.changeDue(tx);
    return {
      due,
      plan: R.makeChangeFrom(R.drawerContents(tx, window.__fw.state.shop.drawer), due - R.handTotal(tx)),
    };
  });
  assert(plan.plan, `the drawer cannot complete $${plan.due}`);
  for (const [rawDenom, count] of Object.entries(plan.plan)) {
    for (let index = 0; index < count; index += 1) {
      const slot = await projectObject({ kind: 'money', from: 'drawer', denom: Number(rawDenom) })
        || await projectObject({ kind: 'drawer-slot', denom: Number(rawDenom) });
      assert(slot && slot.inView, `slot ${rawDenom} not visible in the drawer frame`);
      const target = await page.evaluate(({ center, wanted }) => {
        const register = window.__fw.scene3d.clubhouse().register;
        const samples = [{ x: center.x, y: center.y }];
        for (let radius = 4; radius <= 40; radius += 4) {
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
  await shot('04-drawer-change-counted.png');
  await page.keyboard.press(' ');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 40000 });

  // --- ITEM 2: the card reader ---------------------------------------------
  const second = await page.evaluate(([skuIds]) => (
    window.__fw.scene3d.clubhouse().sendToCounter(skuIds, 'card')
  ), [SKUS]);
  assert(second, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 25000 });
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
    }, uid, { timeout: 8000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 8000 });
  }
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.presentedCardScreenPoint();
    return register.getTx()?.stage === 'card-ready' && point?.inView && point.clickable;
  }, null, { timeout: 15000 });
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(400);
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 12000 });
  await page.waitForTimeout(1400);
  await shot('05-reader-at-face.png');

  // How big is the reader, where does it sit, and does the card show?
  report.keys.framing = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const camera = app.scene3d.camera;
    let terminal = null;
    let card = null;
    app.scene3d.scene.traverse((o) => {
      if (!terminal && /payment_terminal|Terminal_Body/i.test(o.name || '')) terminal = o;
      if (!card && o.userData?.kind === 'payment-card') card = o;
    });
    const frac = (object) => {
      if (!object) return null;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return null;
      let minX = Infinity; let maxX = -Infinity;
      let minY = Infinity; let maxY = -Infinity;
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
        w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        minY, maxY, inside: minX >= 0 && maxX <= 1 && minY >= 0 && maxY <= 1,
      };
    };
    return { terminal: frac(terminal), card: frac(card), terminalName: terminal?.name || null };
  });

  // THE ACTUAL ACCEPTANCE FOR ITEM 2: click each physical key where it is SEEN
  // and check the digit landed. A projected point that does not pick the key it
  // was projected from is the "keys do nothing" bug, so record both.
  // NOTE: debugPickAt only reports the PHYSICAL pick set (money, goods) — the
  // terminal keys have their own raycast, so a null `picked` here is expected
  // and says nothing about whether the key works. The click trace below is the
  // real evidence.
  const keyCheck = async (label) => page.evaluate((id) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.cardKeyScreenPoint(id);
    if (!point) return { id, point: null };
    return { id, point };
  }, label);
  const clickKey = async (actionId) => {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), actionId);
    assert(point?.visible && point?.inView, `key ${actionId} is not on screen`);
    const before = await page.evaluate(() => (
      String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
    ));
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(140);
    const after = await page.evaluate(() => (
      String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
    ));
    return { actionId, before, after, changed: before !== after, point };
  };

  // EVERY digit key must enter its own digit when CLICKED where it is drawn.
  // The entry is cleared between digits so a length cap can never disguise a
  // dead key as a full field.
  // Empty the field through the REAL handler (keyboard Backspace), so the glass
  // repaints exactly as it does in play instead of being mutated behind it.
  const clearEntry = async () => {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const left = await page.evaluate(() => (
        String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
      ));
      if (!left) return;
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(70);
    }
  };
  const digitTrace = [];
  for (const digit of '1234567890') {
    await clearEntry();
    const result = await clickKey(`digit:${digit}`);
    digitTrace.push({ ...result, correct: result.after === digit });
  }
  report.keys.digits = digitTrace;
  report.keys.allDigitsClickable = digitTrace.every((entry) => entry.correct);
  report.keys.screenPoints = [];
  for (const id of ['digit:5', 'confirm', 'backspace', 'clear']) {
    report.keys.screenPoints.push(await keyCheck(id));
  }
  // The keyboard must key the same pad.
  await clearEntry();
  await page.keyboard.press('4');
  await page.keyboard.press('2');
  await page.waitForTimeout(120);
  report.keys.typed = await page.evaluate(() => (
    String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
  ));
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  report.keys.typedAfterBackspace = await page.evaluate(() => (
    String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
  ));
  // yellow = backspace: clicking it must REMOVE the last digit
  await clearEntry();
  await clickKey('digit:7');
  await clickKey('digit:3');
  const beforeBack = await page.evaluate(() => (
    String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
  ));
  const backResult = await clickKey('backspace');
  report.keys.backspace = { beforeBack, ...backResult, correct: backResult.after === '7' };
  await clearEntry();
  await page.waitForTimeout(250);
  await shot('06-reader-keys-labelled.png');

  // key the real total and confirm with green
  const cents = await page.evaluate(async () => {
    const { totalOf } = await import('/src/sim/register.js');
    return Math.round(totalOf(window.__fw.scene3d.clubhouse().register.getTx()) * 100);
  });
  for (const digit of String(cents)) await clickKey(`digit:${digit}`);
  report.keys.keyed = await page.evaluate(() => (
    String(window.__fw.scene3d.clubhouse().register.getTx()?.cardEntryDigits || '')
  ));
  await shot('07-reader-amount-keyed.png');
  await clickKey('confirm');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-busy'
  ), null, { timeout: 6000 });
  report.keys.confirmed = true;
  await shot('08-reader-processing.png');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 40000 });

  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(report, null, 2));
  return { ok: true, out: OUT, report };
}
