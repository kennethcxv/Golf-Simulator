// D1 — CARRY THE BOOK, ENTER A STATION, AND SEE WHERE THE BOOK IS.
//
// The brief: "Carry the book, click the cashier, and the book stays hanging in
// the air where I was standing."
//
// The mechanism is known: the carried ledger is placed every frame by
// followCarry from walk.x/z/yaw, and a station stops driving those, so the book
// freezes at the last walk position. This proves the fix from the outside -
// where the book ENDS UP, in world coordinates, after a station takes over.
//
// The measurement that matters is the distance from the book to the place the
// player was standing when the station took the camera. Floating means it is
// still there. Put down means it is on a surface at a sane height and the
// carried flag is false.
//
// NEGATIVE CONTROL: the same carry, and then NO station entry. The book must
// still be carried and still following. If it reads "put down" there too, the
// driver is measuring something that happens on its own.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d1-nofloat');
  fs.mkdirSync(OUT, { recursive: true });
  const LEG = process.env.D1_LEG || 'station';
  const out = { leg: LEG, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(8000);

  const bookState = () => page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const book = ch.ledgerBook;
    const r = book.root;
    const off = ch.interior.position;
    const w = fw.scene3d.walk.state;
    return {
      carried: !!book.isCarried?.(),
      worldX: +(r.position.x + off.x).toFixed(3),
      worldY: +(r.position.y + off.y).toFixed(3),
      worldZ: +(r.position.z + off.z).toFixed(3),
      playerX: +w.x.toFixed(3),
      playerZ: +w.z.toFixed(3),
    };
  });

  // Stand at the book, find it, pick it up with the REAL carry key.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const b = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - b.x, z: ip.z - b.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = b.x + (to.x / len) * 1.3;
    st.z = b.z + (to.z / len) * 1.3;
    st.yaw = Math.atan2(-(b.x - st.x), -(b.z - st.z));
    st.pitch = -0.3;
  });
  await page.waitForTimeout(900);
  out.focus = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const st = walk.state;
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const base = st.yaw;
    for (const dp of [-0.3, -0.15, 0]) {
      for (let k = 0; k < 10; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        st.pitch = dp;
        await sleep(100);
        const l = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/ledger|read|carry/i.test(l)) return { hit: true, label: l.slice(0, 70) };
      }
    }
    return { hit: false };
  });
  await page.mouse.click(700, 500);
  await page.waitForTimeout(400);
  const keys = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  await page.keyboard.press(keys.carry || 'x');
  await page.waitForTimeout(1200);
  out.afterPickup = await bookState();

  // Walk away, so "where I was standing" is somewhere distinct.
  await page.keyboard.down('s');
  await page.waitForTimeout(1400);
  await page.keyboard.up('s');
  await page.waitForTimeout(600);
  out.afterWalk = await bookState();
  out.stoodAt = { x: out.afterWalk.playerX, z: out.afterWalk.playerZ };

  if (LEG === 'station') {
    // A station takes the camera. The laptop is the one a driver can open
    // without a customer present.
    await page.evaluate(() => window.__fw.scene3d.walk.hooks?.openLaptop?.());
    await page.waitForTimeout(1800);
  } else {
    // CONTROL: no station. Just wait the same time.
    await page.waitForTimeout(1800);
  }
  out.afterStation = await bookState();
  await page.screenshot({ path: path.join(OUT, `d1-${LEG}.png`) });

  const b = out.afterStation;
  const strandedAt = Math.hypot(b.worldX - out.stoodAt.x, b.worldZ - out.stoodAt.z);
  out.verdict = {
    pickedUp: out.afterPickup.carried === true,
    stillCarriedAfter: b.carried,
    // "hanging in the air where I was standing" - within a stride of the spot,
    // at waist height, and still flagged carried
    distanceFromWhereIStood: +strandedAt.toFixed(3),
    heightY: b.worldY,
    floating: b.carried === true && strandedAt < 1.0,
    // the fix: not carried any more, i.e. it was put down
    putDown: b.carried === false,
  };
  fs.writeFileSync(path.join(OUT, `d1-${LEG}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`D1[${LEG}]`, JSON.stringify(out.verdict));
  console.log(`D1[${LEG}] focus`, JSON.stringify(out.focus), 'pickup', JSON.stringify(out.afterPickup));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
