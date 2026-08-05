// K5 — the reader glass theme. "Too dark. Lighten it. Keep the amount
// dominant."
//
// The metric that keeps this honest (plan review, PLAN_12): the amount's
// CONTRAST — digit-pixel vs glass-pixel luminance delta — must not drop while
// the glass lightens. Lightening the ground under a near-white figure can only
// cut that delta, so this instrument measures it directly, from the live term
// canvas, and the same driver runs before and after the palette change
// (K5_LEG=before|after) so the comparison is two readings from one instrument.
//
// Negative control: the same digit-classifier runs on a band of glass that
// carries no text. If it reports a meaningful delta there, it is manufacturing
// digits from noise and the amount reading cannot be trusted.
//
// Band geometry is baked from the source layout (simplifiedRegisterMode.js):
// TERM_PAD 10, canvas 512x468, statusY 50, amount baseline 208 when the KEYED
// entry is present, entry baseline 304, footer hairline 348, panel bottom 458.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const LEG = process.env.K5_LEG || 'run';
  const OUT = path.resolve(`qa/electron/reader-theme-k5/${LEG}`);
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

  // ---- a card customer at the counter, same staging as checkout-round7 -----
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
    return { customer: !!clubhouse.sendToCounter(skuIds, 'card') };
  }, SKUS);
  assert(staged.customer, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    tx.rng = () => 0.9; // approves
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

  // ---- take the card; reach amount entry -----------------------------------
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 25000 });
  await page.waitForTimeout(700);
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(900);

  // two digits so the KEYED line and caret are on the glass for the still
  const dueDigits = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return String(Math.round(totalOf(tx) * 100));
  });
  for (const key of dueDigits.slice(0, 2)) await page.keyboard.press(key);
  await page.waitForTimeout(500);

  // ---- measure the glass, from the live term canvas ------------------------
  const measureGlass = () => page.evaluate(() => {
    const app = window.__fw;
    let image = null;
    app.scene3d.clubhouse().interior.traverse((o) => {
      const im = o.material?.map?.image;
      if (!image && im && im.tagName === 'CANVAS' && im.width === 512 && im.height === 468) image = im;
    });
    if (!image) return { error: 'term canvas not found on any mesh' };
    const scratch = document.createElement('canvas');
    scratch.width = image.width; scratch.height = image.height;
    const sctx = scratch.getContext('2d');
    sctx.drawImage(image, 0, 0);
    const bandStats = (x0, y0, x1, y1) => {
      const data = sctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const lumas = [];
      for (let i = 0; i < data.length; i += 4) {
        lumas.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      }
      const sorted = [...lumas].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // digit pixels = the 6% farthest from the band's dominant (glass) luma;
      // works in either polarity, and antialiased edge pixels stay out of it
      const byDistance = [...lumas].sort((a, b) => Math.abs(b - median) - Math.abs(a - median));
      const n = Math.max(1, Math.floor(byDistance.length * 0.06));
      const digitMean = byDistance.slice(0, n).reduce((sum, v) => sum + v, 0) / n;
      return {
        glassMedian: +median.toFixed(1),
        digitMean: +digitMean.toFixed(1),
        delta: +Math.abs(digitMean - median).toFixed(1),
      };
    };
    return {
      // the dominant figure (AMOUNT DUE): baseline 208, up to 152 px tall
      amount: bandStats(44, 158, 466, 258),
      // the KEYED line: baseline 304, 52 px
      entry: bandStats(44, 282, 400, 326),
      // NEGATIVE CONTROL: bare glass under the footer — no text lives here
      control: bandStats(44, 400, 400, 445),
    };
  });
  const entryMeasure = await measureGlass();
  assert(!entryMeasure.error, entryMeasure.error || 'measure failed');
  await page.screenshot({ path: path.join(OUT, 'entry-frame.png') });

  // close-up of the glass from a probe camera, for legibility in the report
  const closeup = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    let reader = null;
    clubhouse.interior.traverse((o) => { if (!reader && o.name === 'checkout-payment_terminal') reader = o; });
    if (!reader) return null;
    const bounds = new THREE.Box3().setFromObject(reader);
    const centre = bounds.getCenter(new THREE.Vector3());
    const probe = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 40);
    const eye = scene3d.camera.getWorldPosition(new THREE.Vector3());
    probe.position.copy(centre).addScaledVector(eye.clone().sub(centre).normalize(), 0.5);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    return document.querySelector('canvas').toDataURL('image/png');
  });
  if (closeup) {
    fs.writeFileSync(path.join(OUT, 'entry-closeup.png'), Buffer.from(closeup.split(',')[1], 'base64'));
  }

  // ---- finish the entry; the approved face gets the same theme -------------
  for (const key of dueDigits.slice(2)) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (
    ['receipt', 'bagging', 'done'].includes(window.__fw.scene3d.clubhouse().register.getTx()?.stage)
  ), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const approvedMeasure = await measureGlass();
  await page.screenshot({ path: path.join(OUT, 'approved-frame.png') });

  const checks = {
    // the classifier finds real digits where digits are, and none where not
    amountContrastStrong: entryMeasure.amount.delta > 150,
    entryLegible: entryMeasure.entry.delta > 100,
    controlIsQuiet: entryMeasure.control.delta < 12
      && entryMeasure.control.delta < entryMeasure.amount.delta * 0.12,
    approvedReadable: !approvedMeasure.error && approvedMeasure.amount.delta > 150,
    noPageErrors: errs.length === 0,
  };
  const out = { leg: LEG, dueDigits, entryMeasure, approvedMeasure, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'reader-theme.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
