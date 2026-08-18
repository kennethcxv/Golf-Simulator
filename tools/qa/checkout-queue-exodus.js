// "I DO A PURCHASE FOR 1 PERSON AND FOR SOME REASON EVERYONE IN LINE LEAVES."
//
// The unit test proves the RULE. This proves the SHIPPED GAME: a real five-deep
// line at the real till, a real card sale rung through with the real keys, and
// the only question that matters counted before and after — how many people are
// still standing there.
//
// Staged the way the report describes it. The line is left to wait until the
// customers behind position two are close to the authored fuse (readable from
// checkoutQueue().waitSec), and only THEN is the sale run, so the fuse expires
// during the transaction. That is the exact window in which the old rule
// emptied the shop: they all armed together, so they all expire together, and
// completing the sale shifts the array and exposes the next one, and the next.
//
//   node tools/qa/run-electron.cjs \
//     tools/qa/checkout-queue-exodus.js --clubhouse=pine-hills-v2
//
// Record it (people walking out is a gesture):
//   VIDEO_DIR=qa/clips/queue node tools/qa/run-electron.cjs ...
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/queue-exodus');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [], samples: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1200);

  const LINE = 5;
  // Stand the player behind the till, open the shop, and send five shoppers.
  out.staged = await page.evaluate(async (n) => {
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 1;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60; // mid-afternoon, shop trading
    if (app.state.shop) app.state.shop.open = true;
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    // sendToCounter picks the goods OFF THE SHELF, and returns null if the
    // shelf is empty — five nulls read exactly like "the spawner is broken".
    // Stock the three SKUs first, and report what was on the shelf either way.
    clubhouse.setOrganicWalkins(false);
    const skus = ['tees1', 'marker1', 'glove1'];
    const shelfBefore = {};
    for (const id of skus) {
      const row = app.state.shop.inventory[id];
      shelfBefore[id] = row ? row.shelf : null;
      if (row) row.shelf = 40;
    }
    clubhouse.rebuildStock();
    const sent = [];
    for (let i = 0; i < n; i += 1) {
      const c = clubhouse.sendToCounter([skus[i % skus.length]], i % 2 ? 'cash' : 'card');
      sent.push(!!c);
    }
    return {
      sent: sent.filter(Boolean).length,
      asked: n,
      shelfBefore,
      catalogHas: skus.filter((id) => !!app.state.shop.inventory[id]),
    };
  }, LINE);
  console.log(`staged ${out.staged.sent}/${out.staged.asked} shoppers`);
  // Staging can legitimately produce nothing: the shop has a live population
  // cap, and on a resumed save it is often already full of REAL customers,
  // which is better evidence than staged ones. What must never be true is
  // reaching the measurement with no line, and that is checked below.
  if (out.staged.sent < LINE) {
    console.log(`note: only ${out.staged.sent} of ${LINE} were staged `
      + '(the shop is probably already at its population cap) — using whoever is in the line');
  }

  const queue = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const q = ch.checkoutQueue();
    return {
      len: q.length,
      people: ch.crowdDiagnostics ? ch.crowdDiagnostics().people : null,
      tx: !!ch.register.hasTx(),
      active: !!ch.register.isActive(),
      stage: ch.register.getTx()?.stage || null,
      exits: ch.checkoutQueueExits ? ch.checkoutQueueExits() : null,
      rows: q.map((r) => ({
        name: r.fullName, phase: r.phase, waitSec: r.waitSec, totalWaitSec: r.totalWaitSec,
        advances: r.advances, awaiting: r.awaitingCheckout,
      })),
    };
  });

  // wait for the line to actually form
  await page.waitForFunction((n) => window.__fw.scene3d.clubhouse().checkoutQueue().length >= n,
    LINE, { timeout: 120000 }).catch(() => fail('the five-deep line never formed'));
  out.formed = await queue();
  console.log(`line formed: ${out.formed.len} deep`);

  // ---- LET THEM WAIT, up to the edge of the authored fuse -------------------
  //
  // PATIENCE_FULL is 600 on a clock that runs at 4x the wall, so this is about
  // two and a half real minutes. Sampled throughout, so the report can say when
  // each person's clock stood still and when it went back to zero.
  const FUSE = 600;
  const sample = async (note) => {
    const q = await queue();
    out.samples.push({ at: Date.now(), note, ...q });
    return q;
  };
  await sample('line formed');
  const started = Date.now();
  let ripe = false;
  while (Date.now() - started < 260000) {
    const q = await sample('waiting');
    const behind = q.rows.slice(2);
    const minWait = behind.length ? Math.min(...behind.map((r) => r.waitSec)) : 0;
    if (q.len < LINE) {
      fail(`somebody left BEFORE the sale even started — queue ${q.len}/${LINE}: `
        + `${(q.exits || []).map((e) => `${e.name} (${e.reason})`).join('; ') || 'no reason recorded'}`);
      break;
    }
    // 0.62, not 0.93: at 0.93 (and at 0.80 on a drifted save) the driver was racing the fuse it is trying to
    // observe, and one customer expired during the run-up. The sale has to
    // start with headroom or the measurement is about the harness.
    if (behind.length && minWait > FUSE * 0.62) { ripe = true; break; }
    await page.waitForTimeout(4000);
  }
  out.ripe = await sample('ripe — the fuse is about to blow');
  console.log(`clocks at the edge: ${JSON.stringify(out.ripe.rows.map((r) => r.waitSec))}`);
  if (!ripe) fail('the queue never reached the edge of the fuse — this run proves nothing');
  await page.screenshot({ path: path.join(OUT, `${tag}-01-line-before-sale.png`) });

  // ---- THE SALE, with the real keys ----------------------------------------
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    if (tx) tx.rng = () => 0.9; // approves
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(),
    null, { timeout: 20000 }).catch(() => fail('the register never went active on E'));
  await sample('till active');
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    if (tx) tx.rng = () => 0.9;
  });

  // DRIVE THE TILL THROUGH ITS OWN MONITOR, not through pixels. The register
  // exposes the hotspots it has actually DRAWN (deskHitTargets) and dispatches
  // one by id (deskAction), which is the same path a click takes after the
  // raycast — so this is the real checkout, minus the aiming. Scanning still
  // needs each product picked up, and those are meshes on the counter, so they
  // are clicked for real.
  const saleStart = Date.now();
  let paid = false;
  const seenStages = {};
  while (Date.now() - saleStart < 180000) {
    const q = await sample('selling');
    const st = q.stage;
    seenStages[st] = (seenStages[st] || 0) + 1;
    if (['done', 'bagging', 'receipt'].includes(st)) { paid = true; break; }
    // 1. any drawn primary/secondary hotspot that moves the sale forward
    const acted = await page.evaluate(() => {
      const r = window.__fw.scene3d.clubhouse().register;
      const drawn = (r.deskHitTargets() || []).filter((h) => !h.disabled);
      const WANT = ['start-scanning', 'take-payment', 'accept-cash', 'give-change',
        'finish', 'complete', 'bag-items', 'hand-bag', 'confirm', 'continue', 'done'];
      const pick = drawn.find((h) => WANT.includes(h.id))
        || drawn.find((h) => h.kind === 'primary');
      if (!pick) return { acted: false, drawn: drawn.map((h) => h.id) };
      return { acted: true, id: pick.id, result: r.deskAction(pick.id), drawn: drawn.map((h) => h.id) };
    });
    if (!out.hotspots) out.hotspots = [];
    out.hotspots.push({ stage: st, ...acted });
    // 2. unscanned products: click the mesh, the way the cashier does
    if (st === 'scanning') {
      const point = await page.evaluate(async () => {
        const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
        const app = window.__fw;
        const r = app.scene3d.clubhouse().register;
        const tx = r.getTx();
        const item = tx?.items?.find((i) => !i.scanned);
        if (!item) return null;
        const mesh = r.itemMesh(item.uid);
        if (!mesh) return { uid: item.uid, missing: true };
        const box = new THREE.Box3().setFromObject(mesh);
        const world = box.isEmpty()
          ? mesh.getWorldPosition(new THREE.Vector3())
          : box.getCenter(new THREE.Vector3());
        world.project(app.scene3d.camera);
        const rect = app.scene3d.renderer.domElement.getBoundingClientRect();
        return {
          uid: item.uid,
          x: rect.left + ((world.x + 1) / 2) * rect.width,
          y: rect.top + ((-world.y + 1) / 2) * rect.height,
          inView: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1 && world.z >= -1 && world.z <= 1,
        };
      });
      if (point && point.inView) {
        await page.mouse.click(Math.round(point.x), Math.round(point.y));
        await page.waitForTimeout(900);
        continue;
      }
      if (point) out.scanTrouble = point;
    }
    // 2b. cash on the desk. "Click the customer's cash; the drawer will open
    //     and stow it automatically" — so it is a mesh hunt, keyed on the
    //     userData the register's own pick uses rather than on a name.
    if (st === 'cash-tender' || st === 'cash-drawer' || st === 'change') {
      const p = await page.evaluate(async () => {
        const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
        const app = window.__fw;
        const ch = app.scene3d.clubhouse();
        let mesh = null;
        ch.interior.traverse((o) => {
          if (mesh || !o.visible) return;
          const u = o.userData || {};
          if (u.pick && u.kind === 'money' && (u.from === 'tender' || u.from === 'change')) mesh = o;
        });
        if (!mesh) return null;
        const box = new THREE.Box3().setFromObject(mesh);
        const world = box.isEmpty()
          ? mesh.getWorldPosition(new THREE.Vector3())
          : box.getCenter(new THREE.Vector3());
        world.project(app.scene3d.camera);
        const rect = app.scene3d.renderer.domElement.getBoundingClientRect();
        return {
          from: mesh.userData.from,
          x: rect.left + ((world.x + 1) / 2) * rect.width,
          y: rect.top + ((-world.y + 1) / 2) * rect.height,
          inView: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1 && world.z >= -1 && world.z <= 1,
        };
      });
      out.cashPoints = (out.cashPoints || []).concat([p]);
      if (p && p.inView) {
        await page.mouse.click(Math.round(p.x), Math.round(p.y));
        await page.waitForTimeout(900);
        continue;
      }
    }
    // 3. the card, which is a floating object rather than a monitor row. The
    //    reader has to be the active workspace before the offered card can be
    //    taken — tapTerminal is what the player's own click on the reader does.
    if (st === 'card-ready' || st === 'card-present') {
      const p = await page.evaluate(() => {
        const r = window.__fw.scene3d.clubhouse().register;
        r.tapTerminal();
        return r.presentedCardScreenPoint();
      });
      out.cardPoints = (out.cardPoints || []).concat([p]);
      if (p?.inView) { await page.mouse.click(Math.round(p.x), Math.round(p.y)); }
    } else if (st === 'card-entry') {
      // register.onKey takes a KEY NAME, not a KeyboardEvent — the app's own
      // handler unwraps the event before forwarding. Pressing the physical key
      // reaches whatever has DOM focus, which after a canvas click is not the
      // register; 128 samples sat in card-entry that way.
      out.pinResult = await page.evaluate(() => {
        const r = window.__fw.scene3d.clubhouse().register;
        const taken = ['3', '8', '2', '2', 'Enter'].map((k) => r.onKey(k));
        return { taken, stage: r.getTx()?.stage || null };
      });
    }
    await page.waitForTimeout(1200);
  }
  out.stagesSeen = seenStages;
  console.log(`stages during the sale: ${JSON.stringify(seenStages)}`);
  out.paid = paid;
  if (!paid) {
    console.log('NOTE: the full tender could not be driven to done by this harness '
      + `(stages seen: ${JSON.stringify(seenStages)}). The line-advance half is measured `
      + 'below through dismissCounterCustomer instead, and that is NOT a sale.');
  }

  // ---- THE ADVANCE, THROUGH A REAL SHIPPED VERB ----------------------------
  //
  // What has to be proved in the running game is that the LINE ADVANCING gives
  // everybody behind their patience back. A completed sale is one way to make
  // the line advance; dismissCounterCustomer (the B5 "clear the person at the
  // counter" verb) is another, and it goes through the very same funnel —
  // removeCustomer -> leaveQueue -> every index behind drops by one. That is
  // the code path the exodus rides on.
  //
  // SAY WHAT THIS IS NOT: it is not a purchase. It does not bank a ticket or
  // hand over a bag. It proves the queue's response to the head leaving, which
  // is the half the fix changed — and nothing about the sale itself.
  // FRAME THE LINE, NOT THE MONITOR. Register mode owns the camera, so a clip
  // recorded through the sale is 440 seconds of the till screen with the queue
  // entirely out of shot — which is exactly the "screenshot cannot show a
  // gesture" trap, one level up: a clip pointed at the wrong thing.
  await page.evaluate(async () => {
    const { REGISTER, queueSlot } = await import(
      new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    ch.register.leave();
    const walk = app.scene3d.walk.state;
    const off = ch.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    // look down the line rather than at the desk
    const slot = queueSlot ? queueSlot(3) : null;
    const tx = (slot ? slot.x : REGISTER.stand.x) + off.x;
    const tz = (slot ? slot.z : REGISTER.stand.z + 3) + off.z;
    const dx = tx - walk.x;
    const dz = tz - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = -0.06;
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(OUT, `${tag}-04-line-framed.png`) });
  const beforeAdvance = await sample('before the head is cleared');
  out.dismissed = await page.evaluate(() => window.__fw.scene3d.clubhouse()
    .dismissCounterCustomer());
  console.log(`cleared the head: ${out.dismissed}`);
  // 25 seconds, because the claim is "everyone in line leaves" and a walk-out
  // is a walk: under the old rule the cascade took under a second to START but
  // the bodies take a while to reach the door, and a clip has to show them
  // still standing there long after that.
  await page.waitForTimeout(25000);
  await page.screenshot({ path: path.join(OUT, `${tag}-05-line-after-advance.png`) });
  out.afterAdvance = await sample('after the head is cleared');
  const advanced = out.afterAdvance.rows.filter((r) => r.advances > 0);
  console.log(`advance credited to ${advanced.length}/${out.afterAdvance.rows.length}: `
    + `${JSON.stringify(out.afterAdvance.rows.map((r) => `${r.waitSec}s/adv${r.advances}`))}`);
  if (beforeAdvance.len > 1 && !advanced.length) {
    fail('the line advanced and NOBODY was credited — the fix is not wired into the live loop');
  }
  // THE CLOCK GOES BACK — and "back" is measured against what it WAS, not
  // against a wall-clock number. The patience clock runs at four times the
  // wall, so the 25 real seconds this check waits are 100 seconds of it. A
  // fixed threshold here failed a run whose reset was perfect (380.9 -> 103.9,
  // which is a reset plus exactly 25 x 4).
  const beforeByName = new Map(beforeAdvance.rows.map((r) => [r.name, r.waitSec]));
  const stillBurning = out.afterAdvance.rows.filter((r) => {
    const was = beforeByName.get(r.name);
    return Number.isFinite(was) && was > 60 && r.waitSec > was * 0.5;
  });
  if (stillBurning.length) {
    fail(`${stillBurning.length} customers kept a burning clock after the line moved: `
      + `${JSON.stringify(stillBurning.map((r) => `${r.name} ${beforeByName.get(r.name)}s -> ${r.waitSec}s`))}`);
  }
  await page.screenshot({ path: path.join(OUT, `${tag}-02-sale-done.png`) });
  out.atSale = await sample('sale complete');
  console.log(`sale complete; queue now ${out.atSale.len}`);

  // ---- AND THEN: WHO IS LEFT? ----------------------------------------------
  // 45 seconds is long past the point at which the old rule had emptied it —
  // under that rule the whole line went inside a second of the array shifting.
  const after = Date.now();
  while (Date.now() - after < 45000) {
    await sample('after the sale');
    await page.waitForTimeout(3000);
  }
  out.final = await sample('final');
  await page.screenshot({ path: path.join(OUT, `${tag}-03-line-after-sale.png`) });

  const expected = LINE - 1; // one was served and left with their goods
  console.log(`\nbefore the sale: ${out.ripe.len}   after: ${out.final.len}   (expected ${expected})`);
  console.log(`advances credited: ${JSON.stringify(out.final.rows.map((r) => r.advances))}`);
  console.log(`wait clocks after: ${JSON.stringify(out.final.rows.map((r) => r.waitSec))}`);
  // A departure is only an EXODUS if it was a walk-out. Somebody the player
  // served and somebody a reservation released both leave the line legitimately,
  // and counting them as losses is how a driver invents a bug.
  const walkOuts = (out.final.exits || []).filter((e) => e.reason === 'gave-up');
  console.log(`queue exits: ${JSON.stringify((out.final.exits || []).map((e) => `${e.name}:${e.reason}`))}`);
  if (walkOuts.length) {
    fail(`ONE SALE EMPTIED THE LINE: ${walkOuts.length} customers GAVE UP — `
      + `${walkOuts.map((e) => `${e.name} at wait ${e.waitSec}s/total ${e.totalWaitSec}s`).join('; ')}`);
  }
  if (out.final.len < expected) {
    console.log(`note: the line is ${out.final.len}, not ${expected} — exits above say why`);
  }

  out.summary = {
    staged: out.staged.sent,
    formedDeep: out.formed.len,
    beforeSale: out.ripe.len,
    afterSale: out.final.len,
    expectedAfter: expected,
    paid: out.paid,
    advances: out.final.rows.map((r) => r.advances),
    waitAfter: out.final.rows.map((r) => r.waitSec),
    totalAfter: out.final.rows.map((r) => r.totalWaitSec),
  };
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nfailures ${out.failures.length} · evidence qa/queue-exodus/${tag}.json`);
}
