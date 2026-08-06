// VERIFY2 K3 — adversarial. The shipped K3 driver photographed a bills-only
// tender. This one forces a COIN-bearing tender (rng 0.2 -> the odd-cents
// digger) and hovers the pile: do the coins get elliptical outline RINGS or
// artifacts/slabs? Then a card leg hovers the PRESENTED CARD. Identical-pose
// probe renders (A control, B control, C hovered) + sharp pixel diffs.
// ok reflects instrument health only; claim verdicts live in `findings`.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* diff skipped */ }
  const OUT = path.resolve('qa/electron/verify2-k/k3-coins-card');
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

  const stage = (method) => page.evaluate(async ([skuIds, payMethod]) => {
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
    return { customer: !!clubhouse.sendToCounter(skuIds, payMethod) };
  }, [SKUS, method]);

  const ringAll = async (label) => {
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
  };

  // freeze a probe on the bounds of a target set; slot 'main' or 'coin'
  const freezeProbe = (slot, opts) => page.evaluate(async ([key, options]) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const bounds = new THREE.Box3();
    let pieces = 0;
    clubhouse.interior.traverse((o) => {
      if (!o.visible) return;
      if (options.mode === 'tender' && o.userData?.kind === 'money' && o.userData?.from === 'tender' && o.geometry) {
        if (options.coinOnly && !(o.userData.denom < 1)) return;
        bounds.expandByObject(o); pieces += 1;
      }
    });
    // the presented card hangs from the CUSTOMER's hand (ClubhouseCustomers,
    // a sibling of the interior) — search the whole scene for it
    if (options.mode === 'card') {
      app.scene3d.scene.traverse((o) => {
        if (o.visible && o.userData?.kind === 'payment-card' && o.geometry) {
          bounds.expandByObject(o); pieces += 1;
        }
      });
    }
    if (!pieces || bounds.isEmpty()) return { error: `no target for probe ${key}` };
    const centre = bounds.getCenter(new THREE.Vector3());
    const eye = app.scene3d.camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.sub(centre).normalize();
    const probe = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 40);
    probe.position.copy(centre).addScaledVector(toEye, options.distance);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    const ndc = centre.clone().project(probe);
    window.__v2k3 = window.__v2k3 || {};
    window.__v2k3[key] = { probe, centrePx: {
      x: Math.round(((ndc.x + 1) / 2) * 1600),
      y: Math.round(((-ndc.y + 1) / 2) * 900),
    } };
    return { pieces, centrePx: window.__v2k3[key].centrePx };
  }, [slot, opts]);

  const probeShot = async (slot, name) => {
    const dataUrl = await page.evaluate((key) => {
      const scene3d = window.__fw.scene3d;
      scene3d.renderer.render(scene3d.scene, window.__v2k3[key].probe);
      return document.querySelector('canvas').toDataURL('image/png');
    }, slot);
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    return buf;
  };

  const shellCensus = () => page.evaluate(() => {
    let shells = 0; let frames = 0; let hulls = 0; let sprites = 0;
    let coinFrames = 0; let coinHulls = 0;
    window.__fw.scene3d.scene.traverse((o) => {
      if (o.isSprite && o.visible) sprites += 1;
      if (!o.userData?.grabOutlineShell) return;
      shells += 1;
      const isFrame = o.geometry?.type === 'ShapeGeometry';
      if (isFrame) frames += 1; else hulls += 1;
      let coin = false;
      for (let p = o.parent; p; p = p.parent) {
        if (p.userData?.kind === 'money' && p.userData?.denom < 1) { coin = true; break; }
        if (p.userData?.denom < 1) { coin = true; break; }
      }
      if (coin && isFrame) coinFrames += 1;
      if (coin && !isFrame) coinHulls += 1;
    });
    return { shells, frames, hulls, sprites, coinFrames, coinHulls };
  });

  const diffPair = async (bufA, bufB, bufC, tag, centrePx, probeDistance) => {
    if (!sharp) return { skipped: 'sharp unavailable' };
    const raw = async (buf) => {
      const img = sharp(buf).ensureAlpha().raw();
      const { data, info } = await img.toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height };
    };
    const A = await raw(bufA); const B = await raw(bufB); const C = await raw(bufC);
    const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const diffMask = (P, Q) => {
      const mask = new Uint8Array(P.w * P.h);
      let changed = 0;
      for (let p = 0; p < P.w * P.h; p += 1) {
        const i = p * 4;
        if (Math.abs(luma(P.data, i) - luma(Q.data, i)) > 12) { mask[p] = 1; changed += 1; }
      }
      return { mask, changed };
    };
    const control = diffMask(A, B);
    const hover = diffMask(A, C);
    const frameH = 2 * probeDistance * Math.tan((34 / 2) * (Math.PI / 180));
    const rimPx = 0.0045 * (A.h / frameH);
    let blob = 0;
    const R = Math.max(5, Math.ceil(rimPx * 1.25));
    for (let y = R; y < A.h - R; y += 1) {
      for (let x = R; x < A.w - R; x += 1) {
        if (!hover.mask[y * A.w + x]) continue;
        let full = true;
        for (let dy = -R; full && dy <= R; dy += 1) {
          for (let dx = -R; dx <= R; dx += 1) {
            if (!hover.mask[(y + dy) * A.w + (x + dx)]) { full = false; break; }
          }
        }
        if (full) blob += 1;
      }
    }
    let centreChanged = 0;
    if (centrePx) {
      const sx = Math.round(centrePx.x * (A.w / 1600));
      const sy = Math.round(centrePx.y * (A.h / 900));
      for (let y = Math.max(0, sy - 20); y < Math.min(A.h, sy + 20); y += 1) {
        for (let x = Math.max(0, sx - 20); x < Math.min(A.w, sx + 20); x += 1) {
          if (hover.mask[y * A.w + x]) centreChanged += 1;
        }
      }
    }
    const vis = Buffer.alloc(A.w * A.h * 3);
    for (let p = 0; p < A.w * A.h; p += 1) {
      const v = hover.mask[p] ? 255 : Math.round(luma(A.data, p * 4) * 0.25);
      vis[p * 3] = v; vis[p * 3 + 1] = hover.mask[p] ? 40 : v; vis[p * 3 + 2] = hover.mask[p] ? 40 : v;
    }
    await sharp(vis, { raw: { width: A.w, height: A.h, channels: 3 } })
      .png().toFile(path.join(OUT, `${tag}-diff.png`));
    return {
      controlChanged: control.changed,
      hoverChanged: hover.changed,
      rimProjectedPx: +rimPx.toFixed(1),
      blobKernelRadius: R,
      blobPixels: blob,
      blobFraction: hover.changed ? +(blob / hover.changed).toFixed(4) : 0,
      centreChanged,
    };
  };

  // ---- LEG 1: cash with COINS ----------------------------------------------
  const staged = await stage('cash');
  assert(staged.customer, 'no cash fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const prices = [6.90, 9.20, 19.62];
    tx.items.forEach((item, index) => {
      item.price = prices[index];
      item.priceCents = Math.round(prices[index] * 100);
    });
    tx.rng = () => 0.2; // the odd-cents digger: coins land in the tender
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  await ringAll('cash');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const plan = await page.evaluate(async () => {
    const { stackTotal } = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return { tendered: tx?.tendered || null, total: tx?.tendered ? stackTotal(tx.tendered) : null };
  });
  const coinDenoms = Object.keys(plan.tendered || {}).map(Number).filter((d) => d < 1);
  assert(coinDenoms.length > 0, `staging failed to produce coins: ${JSON.stringify(plan)}`);

  await page.mouse.move(VIEWPORT.width - 40, 60);
  await page.waitForTimeout(400);
  const mainProbe = await freezeProbe('main', { mode: 'tender', distance: 0.38 });
  assert(!mainProbe.error, mainProbe.error);
  const coinProbe = await freezeProbe('coin', { mode: 'tender', coinOnly: true, distance: 0.20 });

  const cashA = await probeShot('main', 'cash-unhovered-a.png');
  const cashB = await probeShot('main', 'cash-unhovered-b.png');
  const coinA = coinProbe.error ? null : await probeShot('coin', 'coin-unhovered-a.png');
  const coinB = coinProbe.error ? null : await probeShot('coin', 'coin-unhovered-b.png');

  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'the desk tender is not in view');
  await page.mouse.move(handful.x, handful.y);
  await page.waitForTimeout(600);
  const cashShells = await shellCensus();
  const cashC = await probeShot('main', 'cash-hovered.png');
  const coinC = coinProbe.error ? null : await probeShot('coin', 'coin-hovered.png');
  await page.screenshot({ path: path.join(OUT, 'cash-player-frame-hovered.png') });

  const cashDiff = await diffPair(cashA, cashB, cashC, 'cash', mainProbe.centrePx, 0.38);
  const coinDiff = (coinA && coinC) ? await diffPair(coinA, coinB, coinC, 'coin', coinProbe.centrePx, 0.20) : { skipped: 'no coin probe' };

  // ---- LEG 2: hover the presented CARD -------------------------------------
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.register.abandon?.();
    clubhouse.register.leave?.({ restorePointer: false });
    clubhouse.clearWalkins();
  });
  await page.waitForTimeout(900);
  const staged2 = await stage('card');
  assert(staged2.customer, 'no card fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 0.9; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  await ringAll('card');
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.getTx()?.stage === 'card-ready' && register.presentedCardScreenPoint()?.inView;
  }, null, { timeout: 25000 });
  await page.waitForTimeout(900);

  await page.mouse.move(VIEWPORT.width - 40, 60);
  await page.waitForTimeout(500);
  const cardProbeUsed = await freezeProbe('cardp', { mode: 'card', distance: 0.30 });
  assert(!cardProbeUsed.error, cardProbeUsed.error || 'no card probe');
  const cardA = await probeShot('cardp', 'card-unhovered-a.png');
  const cardB = await probeShot('cardp', 'card-unhovered-b.png');
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(cardPoint?.inView, 'presented card not in view');
  await page.mouse.move(cardPoint.x, cardPoint.y);
  await page.waitForTimeout(600);
  const cardShells = await shellCensus();
  const cardC = await probeShot('cardp', 'card-hovered.png');
  await page.screenshot({ path: path.join(OUT, 'card-player-frame-hovered.png') });
  const cardDiff = await diffPair(cardA, cardB, cardC, 'card', cardProbeUsed.centrePx, 0.30);

  const findings = {
    tenderPlan: plan,
    coinDenomsInTender: coinDenoms,
    cashShells,
    cardShells,
    cashDiff,
    coinDiff,
    cardDiff,
    cashOutlineOnly: !!cashDiff.hoverChanged && cashDiff.blobFraction < 0.03 && cashDiff.centreChanged === 0,
    cardOutlineOnly: !!cardDiff.hoverChanged && cardDiff.blobFraction < 0.03,
    coinsGetFrames: cashShells.coinFrames > 0 && cashShells.coinHulls === 0,
    noSprites: cashShells.sprites === 0 && cardShells.sprites === 0,
  };
  const out = { findings, errs: errs.slice(0, 10) };
  out.ok = errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'verify2-k3.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
