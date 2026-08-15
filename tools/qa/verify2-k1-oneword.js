// VERIFY2 K1 addendum — the single-WORD name attack. The laptop settings
// club-name input has no maxlength, so a player can enter one unbroken word
// longer than the fitter's minimum-size floor can ever fit (min 4% of canvas
// height = 30px; maxWidth 540). checkoutDisplayBrandLines keeps <=2 words on
// ONE line, so the fitter floors out and centre-aligned fillText overflows.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify2-k/k1-longname');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const ONE_WORD = 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch';
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const staged = await page.evaluate(async ([skuIds, name]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    app.state.clubName = name;
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
  }, [SKUS, ONE_WORD]);
  assert(staged.customer, 'no fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1200); // let drawScreen -> syncPhysicalBrand rebuild

  const stamp = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let panel = null;
    clubhouse.interior.traverse((o) => { if (!panel && o.name === 'PineHillsDynamicBagBrand') panel = o; });
    const image = panel?.material?.map?.image;
    if (!image || image.tagName !== 'CANVAS') return { error: 'no stamp canvas' };
    const scratch = document.createElement('canvas');
    scratch.width = image.width; scratch.height = image.height;
    const sctx = scratch.getContext('2d');
    sctx.drawImage(image, 0, 0);
    const { data } = sctx.getImageData(0, 0, image.width, image.height);
    let minX = Infinity; let maxX = -Infinity; let ink = 0;
    let edgeInk = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const i = (y * image.width + x) * 4;
        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        if (g > r + 10 && g > b + 8 && (0.2126 * r + 0.7152 * g + 0.0722 * b) < 120) {
          ink += 1;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (x <= 2 || x >= image.width - 3) edgeInk += 1;
        }
      }
    }
    return {
      w: image.width, h: image.height, inkPixels: ink,
      inkMinX: minX, inkMaxX: maxX, edgeInk,
      cutOff: edgeInk > 0 || minX < 14 || maxX > image.width - 14,
      dataUrl: scratch.toDataURL('image/png'),
    };
  });
  assert(!stamp.error, stamp.error || 'stamp dump failed');
  fs.writeFileSync(path.join(OUT, 'stamp-oneword.png'), Buffer.from(stamp.dataUrl.split(',')[1], 'base64'));
  delete stamp.dataUrl;

  const closeup = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    if (!bag) return null;
    const bounds = new THREE.Box3().setFromObject(bag);
    const centre = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const probe = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 40);
    probe.position.set(centre.x, centre.y + span * 1.15, centre.z + 0.001);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probe);
    return document.querySelector('canvas').toDataURL('image/png');
  });
  if (closeup) {
    fs.writeFileSync(path.join(OUT, 'stamp-oneword-top.png'), Buffer.from(closeup.split(',')[1], 'base64'));
  }

  const out = { findings: { oneWord: ONE_WORD, stamp }, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'verify2-k1-oneword.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
