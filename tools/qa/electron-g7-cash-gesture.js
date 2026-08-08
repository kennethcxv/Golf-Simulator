// G5 + G7 — CASH ON THE DESK, AND THE HAND THAT COMES BACK.
//
// G7: "Cash: they lay it on the desk and take their hand back. They do not stand
//      holding it out."
// G5: "Coins on the desk, not only notes."
//
// Both were fixed at the sim level and pinned by source-reading tests, which the
// report has carried as UNCONFIRMED all session. The missing piece was never an
// instrument - it was a SCENARIO: a customer mid-transaction, paying cash.
// `clubhouse.sendToCounter(skuIds, payMethod)` stages exactly that.
//
// WHAT IS MEASURED
//   * the customer's rig mode over time - it must move PayCash -> CashLaid,
//     which is the arm coming back
//   * what is physically on the desk - notes AND coins, counted by denomination
//
// NEGATIVE CONTROL: sample the mode BEFORE the tender exists. If it already
// reads CashLaid then "the arm came back" is not something this driver detected,
// it is the pose the customer happened to be in.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g7-cash-gesture');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(8000);

  out.camera = await page.evaluate(() => ({
    css: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    fov: window.__fw.scene3d.camera?.fov ?? null,
  }));

  // THE CONTROL, taken before anything is staged.
  const rig = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const cust = ch.register?.getCustomer?.();
    const char = cust?.mesh?.userData?.char;
    return {
      hasCustomer: !!cust,
      mode: char?.mode ?? null,
      stage: ch.register?.getTx?.()?.stage ?? null,
      method: ch.register?.getTx?.()?.method ?? null,
    };
  });
  out.before = await rig();

  // OPEN THE SHOP FIRST, AND STOCK IT.
  //
  // Three runs staged a customer who then sat at Idle forever. The blocker was
  // named in the source and I found it in a working driver: a new day opens
  // CLOSED, and a staged shopper with nothing to buy and a shut shop never
  // starts a transaction. Set the clock to mid-afternoon, rebuild stock, stand
  // where the register expects the cashier, and press E like a player - calling
  // register.enter() directly was not the same thing.
  out.staged = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    ch.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = ch.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    if (!ch.sendToCounter) return { ok: false, why: 'no sendToCounter hook' };
    const who = ch.sendToCounter(['balls3', 'glove1'], 'cash');
    return { ok: !!who, who: who || null };
  });

  // the transaction appears on its own once they reach the counter
  out.txArrived = await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!(tx && tx.items.length >= 2);
  }, null, { timeout: 60000 }).then(() => true).catch(() => false);

  // THE PLAYER HAS TO BE AT THE TILL.
  //
  // The first run staged the customer successfully and then watched them sit at
  // Idle for sixty seconds. A staged customer walks in on their own; the
  // TRANSACTION only starts when the cashier is present and accepts them. The
  // scenario was half-built - the shopper existed, nobody was serving.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(600);
  await page.keyboard.press('e');          // the player takes the till
  out.entered = await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 12000 },
  ).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);

  // DRIVE THE SCAN. The tender only exists after the goods are rung up, and
  // click-to-bag is the shipped verb: project the item to the screen, click it,
  // wait for the register to mark it scanned AND bagged. Lifted from
  // cash-hover-highlight.js, which reaches the same beat.
  const projectItem = (uid) => page.evaluate((id) => {
    const app = window.__fw;
    const reg = app.scene3d.clubhouse().register;
    const mesh = reg.itemMesh ? reg.itemMesh(id) : null;
    const node = mesh || null;
    if (!node) return null;
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    const cam = app.scene3d.camera;
    const v = { x: e[12], y: e[13], z: e[14] };
    // manual projection: world -> clip, using the camera's matrices
    cam.updateMatrixWorld();
    const m = cam.projectionMatrix.elements;
    const inv = cam.matrixWorldInverse.elements;
    const vx = inv[0] * v.x + inv[4] * v.y + inv[8] * v.z + inv[12];
    const vy = inv[1] * v.x + inv[5] * v.y + inv[9] * v.z + inv[13];
    const vz = inv[2] * v.x + inv[6] * v.y + inv[10] * v.z + inv[14];
    const cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
    if (!cw) return null;
    const cx = (m[0] * vx + m[4] * vy + m[8] * vz + m[12]) / cw;
    const cy = (m[1] * vx + m[5] * vy + m[9] * vz + m[13]) / cw;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((cx + 1) / 2) * rect.width,
      y: rect.top + ((-cy + 1) / 2) * rect.height,
      inView: Math.abs(cx) <= 1 && Math.abs(cy) <= 1,
    };
  }, uid);

  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.items.map((i) => i.uid) || []));
  out.scanned = [];
  for (const uid of uids) {
    const p = await projectItem(uid);
    if (!p || !p.inView) { out.scanned.push({ uid, why: 'not in frame' }); continue; }
    await page.mouse.click(p.x, p.y);
    const ok = await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const it = tx?.items.find((c) => c.uid === id);
      return !!(it?.scanned && it?.bagged);
    }, uid, { timeout: 15000 }).then(() => true).catch(() => false);
    out.scanned.push({ uid, ok });
  }
  out.reachedTender = await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 40000 }).then(() => true).catch(() => false);

  // let them be accepted and reach the cash tender
  out.samples = [];
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1500);
    const s = await rig();
    out.samples.push(s);
    if (s.mode === 'CashLaid') break;
  }
  out.after = out.samples[out.samples.length - 1] || null;

  // what is physically on the desk
  out.onDesk = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const tx = ch.register?.getTx?.();
    const stack = tx?.tendered || null;
    if (!stack) return { tendered: null };
    const COINS = ['0.01', '0.05', '0.10', '0.25'];
    const notes = {};
    const coins = {};
    for (const [d, n] of Object.entries(stack)) {
      if (!n) continue;
      (COINS.includes(d) ? coins : notes)[d] = n;
    }
    return {
      tendered: stack,
      noteKinds: Object.keys(notes).length,
      coinKinds: Object.keys(coins).length,
      coinPieces: Object.values(coins).reduce((a, b) => a + b, 0),
    };
  });

  await page.screenshot({ path: path.join(OUT, 'g7-cash-on-desk.png') });

  const modes = out.samples.map((s) => s.mode).filter(Boolean);
  out.verdict = {
    scenarioStaged: out.staged.ok === true,
    txArrived: out.txArrived === true,
    tookTheTill: out.entered === true,
    itemsScanned: (out.scanned || []).filter((x) => x.ok).length,
    reachedTender: out.reachedTender === true,
    // the control: the arm must not already have been back
    controlNotAlreadyLaid: out.before.mode !== 'CashLaid',
    modesSeen: [...new Set(modes)],
    heldItOut: modes.includes('PayCash'),
    // G7: the hand comes back
    armCameBack: modes.includes('CashLaid'),
    // and in that order
    laidAfterHolding: modes.indexOf('CashLaid') > modes.indexOf('PayCash')
      && modes.includes('PayCash') && modes.includes('CashLaid'),
    // G5: coins on the desk, not only notes
    coinKindsOnDesk: out.onDesk.coinKinds ?? null,
    coinPiecesOnDesk: out.onDesk.coinPieces ?? null,
    cameraUntouched: out.camera,
    shot: 'g7-cash-on-desk.png',
  };
  fs.writeFileSync(path.join(OUT, 'g7.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G7-CASH', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
