// VERIFY2 K4 — adversarial. Three tender shapes the shipped driver never ran:
//   over-100   due > $100  -> the $50-step customer (fifties on the desk)
//   exact      due == $40.00 exactly -> the exact-change customer (no change)
//   odd-coins  rng 0.2 -> coins in the tender (recount, different total)
// Each leg proves mesh denominations == tx.tendered plan, sums tie, and the
// negative control (no tender meshes before the stage) holds. Also carries the
// K2 spot check: bag present+posed at tx start in the CASH flow, at 1.35.
// ok reflects instrument health only; claim verdicts live in `findings`.
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

  const collectTender = () => page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const candidates = [];
    clubhouse.interior.traverse((o) => {
      if (o.userData?.kind !== 'money' || o.userData?.from !== 'tender') return;
      if (o.isMesh && o.material?.visible === false) return; // the click sphere
      candidates.push(o);
    });
    const roots = candidates.filter((o) => {
      for (let p = o.parent; p; p = p.parent) if (candidates.includes(p)) return false;
      return true;
    });
    return roots.map((o) => {
      let kitGeometry = false;
      let proceduralGeometry = false;
      o.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        if (n.geometry.type === 'BufferGeometry') kitGeometry = true;
        if (/^(Box|Cylinder)Geometry$/.test(n.geometry.type)) proceduralGeometry = true;
      });
      return { denom: o.userData.denom, kitGeometry, proceduralGeometry };
    });
  });

  const readPlan = () => page.evaluate(async () => {
    const { stackTotal, cashTotalOf, changeDue } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      tendered: tx?.tendered || null,
      tenderedTotal: tx?.tendered ? stackTotal(tx.tendered) : null,
      due: tx ? +cashTotalOf(tx).toFixed(2) : null,
      changeDue: tx ? +changeDue(tx).toFixed(2) : null,
    };
  });

  const bagStats = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    if (!bag) return { present: false };
    const bounds = new THREE.Box3().setFromObject(bag);
    return {
      present: true,
      visible: bag.visible,
      scale: +bag.scale.x.toFixed(4),
      worldMinY: +bounds.min.y.toFixed(4),
    };
  });

  const runLeg = async (label, rngValue, prices, exactTargetCents) => {
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
    assert(staged.customer, `${label}: no cash fixture customer`);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === 3;
    }, null, { timeout: 30000 });
    const priced = await page.evaluate(async ([rng, legPrices, targetCents]) => {
      const { cashTotalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      tx.items.forEach((item, index) => {
        item.price = legPrices[index];
        item.priceCents = Math.round(legPrices[index] * 100);
      });
      // exact-change leg: walk item 0's price until the cash total lands on the
      // target to the cent (tax rides on net, so iterate rather than solve)
      let iterations = 0;
      if (targetCents != null) {
        for (; iterations < 60; iterations += 1) {
          const total = Math.round(cashTotalOf(tx) * 100);
          if (total === targetCents) break;
          const shortfall = targetCents - total;
          const step = Math.abs(shortfall) > 3 ? Math.round(shortfall * 0.9) : (shortfall > 0 ? 1 : -1);
          tx.items[0].priceCents += step;
          tx.items[0].price = tx.items[0].priceCents / 100;
        }
      }
      tx.rng = () => rng; // pinned BEFORE any payment stage consumes it
      return {
        due: +cashTotalOf(tx).toFixed(2),
        taxRate: tx.taxRate ?? null,
        prices: tx.items.map((item) => item.price),
        iterations,
      };
    }, [rngValue, prices, exactTargetCents ?? null]);

    const preStage = await collectTender(); // NEGATIVE CONTROL

    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const bagAtStart = await bagStats(); // K2 in the cash flow
    await page.waitForTimeout(1100);
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
      assert(point && point.inView, `${label}: item ${uid} not in the working frame`);
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

    const pieces = await collectTender();
    const plan = await readPlan();
    await page.screenshot({ path: path.join(OUT, `${label}-player-frame.png`) });
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
      fs.writeFileSync(path.join(OUT, `${label}-closeup.png`), Buffer.from(closeup.split(',')[1], 'base64'));
    }

    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.register.abandon?.();
      clubhouse.register.leave?.({ restorePointer: false });
      clubhouse.clearWalkins();
    });
    await page.waitForTimeout(900);

    const meshCounts = {};
    for (const piece of pieces) meshCounts[piece.denom] = (meshCounts[piece.denom] || 0) + 1;
    const meshSum = +pieces.reduce((sum, piece) => sum + piece.denom, 0).toFixed(2);
    const planCounts = Object.fromEntries(
      Object.entries(plan.tendered || {}).map(([d, n]) => [Number(d), n]),
    );
    const sortedJson = (o) => JSON.stringify(Object.fromEntries(
      Object.entries(o).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]),
    ));
    return {
      label,
      priced,
      bagAtStart,
      preStageTenderCount: preStage.length,
      pieceCount: pieces.length,
      meshCounts,
      meshSum,
      plan,
      kitPieces: pieces.filter((piece) => piece.kitGeometry && !piece.proceduralGeometry).length,
      matchesPlan: sortedJson(meshCounts) === sortedJson(planCounts) && Object.keys(planCounts).length > 0,
    };
  };

  const legOver100 = await runLeg('over-100', 0.9, [49.10, 52.35, 41.80], null);
  const legExact = await runLeg('exact-40', 0.9, [12.00, 15.00, 9.00], 4000);
  const legOddCoins = await runLeg('odd-coins', 0.2, [6.90, 9.20, 19.62], null);

  const legs = [legOver100, legExact, legOddCoins];
  const findings = {
    legOver100,
    legExact,
    legOddCoins,
    controlsQuiet: legs.every((leg) => leg.preStageTenderCount === 0),
    allMatchPlan: legs.every((leg) => leg.matchesPlan),
    allSumsTie: legs.every((leg) => leg.meshSum === leg.plan.tenderedTotal),
    accountingTies: legs.every((leg) => Math.abs((leg.meshSum - leg.plan.due) - leg.plan.changeDue) < 0.005),
    over100UsesFifties: (legOver100.meshCounts[50] || 0) > 0 && legOver100.plan.due > 100,
    exactChangeCustomer: legExact.plan.due === 40 && legExact.plan.changeDue === 0
      && legExact.meshSum === 40,
    oddLegHasCoins: Object.keys(legOddCoins.meshCounts).map(Number).some((d) => d < 1),
    allKitMoney: legs.every((leg) => leg.kitPieces === leg.pieceCount),
    bagPresentAtStartAllLegs: legs.every((leg) => leg.bagAtStart.present && leg.bagAtStart.visible
      && Math.abs(leg.bagAtStart.scale - 1.35) < 1e-3),
  };
  const out = { findings, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'verify2-k4.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
