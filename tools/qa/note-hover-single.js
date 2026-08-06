// ITEM 12 — "Hovering a note outlines THAT note only. Thin outline, no fill."
//
// The count IS the claim, and it is directly readable: the outline is a child
// mesh tagged `grabOutlineShell` parented onto the highlighted mesh. Hover one
// note, count how many DISTINCT tender notes own a shell. One is the
// requirement; the shipped behaviour was ALL of them, because
// offeredPaymentTarget returned the whole `tenderMeshes` array the moment the
// cursor touched any of it — it had to, since the pick that reaches it is
// usually `tenderHandful`, one generous invisible sphere over the entire pile.
//
// Controls, because a count of 1 could equally mean "the outline is broken":
//   - pointer parked away from the pile must give 0 shells;
//   - hovering must give exactly 1, and moving to a DIFFERENT note must MOVE
//     the shell rather than add a second.
//
// The staging prologue is lifted from cash-hover-outline.js, which is the
// proven route to a cash tender lying on the desk (enter the register with E,
// click each item to ring it, wait for stage 'cash-tender'). An earlier cut of
// this driver invented its own route, never reached the stage, and reported
// zero notes on the desk.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* diff skipped */ }
  const OUT = path.resolve('qa/electron/note-hover');
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

  // ---- the probe ----------------------------------------------------------
  await page.evaluate(() => {
    window.__outlineProbe = () => {
      const owners = new Set();
      let shells = 0;
      let filled = 0;
      window.__fw.scene3d.clubhouse().interior.traverse((o) => {
        if (!o.userData?.grabOutlineShell) return;
        shells += 1;
        if (o.parent) owners.add(o.parent.uuid);
        // thin outline, no fill: a BackSide hull or a DoubleSide frame ring.
        // A FrontSide opaque plate over the face would be a fill.
        if (o.material?.side === 0) filled += 1;
      });
      return { shells, distinctOwners: owners.size, filled };
    };
  });

  // NOTE THE FLAW, since this run did not resolve it: `? ... : []` cannot tell
  // "the accessor is missing" from "there are no notes", and this driver
  // reported noteCount 0 without saying which. Distinguished now.
  const notePointsRaw = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    if (typeof reg.presentedTenderScreenPoints !== 'function') {
      return { accessor: 'missing', points: [] };
    }
    return { accessor: 'present', points: reg.presentedTenderScreenPoints() };
  });
  const notePoints = notePointsRaw.points;
  const inView = notePoints.filter((p) => p.inView !== false);

  // park the pointer well away from the pile: the zero control
  await page.mouse.move(120, 140);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => window.__outlineProbe());
  await page.screenshot({ path: path.join(OUT, '01-no-hover.png') });

  let hoverA = null; let hoverB = null; let movedTo = null;
  if (inView.length) {
    await page.mouse.move(inView[0].x, inView[0].y);
    await page.waitForTimeout(500);
    hoverA = await page.evaluate(() => window.__outlineProbe());
    await page.screenshot({ path: path.join(OUT, '02-hover-note-a.png') });
    const other = inView.find((p) => Math.hypot(p.x - inView[0].x, p.y - inView[0].y) > 14)
      || inView[inView.length - 1];
    movedTo = { from: [inView[0].x, inView[0].y], to: [other.x, other.y] };
    await page.mouse.move(other.x, other.y);
    await page.waitForTimeout(500);
    hoverB = await page.evaluate(() => window.__outlineProbe());
    await page.screenshot({ path: path.join(OUT, '03-hover-note-b.png') });
  }

  const checks = {
    accessorPresent: notePointsRaw.accessor === 'present',
    tenderOnTheDesk: notePoints.length > 0,
    moreThanOneNote: notePoints.length > 1,
    noOutlineWhenNotHovering: before.shells === 0,
    exactlyOneNoteOutlined: !!hoverA && hoverA.distinctOwners === 1,
    stillOneAfterMoving: !!hoverB && hoverB.distinctOwners === 1,
    noFilledPlate: !!hoverA && hoverA.filled === 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    accessor: notePointsRaw.accessor,
    noteCount: notePoints.length, notePoints, movedTo, before, hoverA, hoverB,
    errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'note-hover.json'), `${JSON.stringify(out, null, 1)}
`);
  return out;
}
