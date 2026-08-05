// K3 — the cash hover highlight must be the OUTLINE of the note, and nothing
// else. The shipped implementation is an inverted-hull shell and its own
// comment says "nothing about the money's own surface changes" — but this
// item came back in queue K, so the claim gets photographed, not trusted.
//
// The instrument: one probe camera framed tight on the desk tender, three
// renders from the IDENTICAL pose —
//   A  unhovered      B  unhovered again      C  hovered
// A-vs-B is the negative control: the pose is frozen, so any diff there is
// instrument noise and the run cannot claim anything. A-vs-C is the hover's
// entire visual contribution, pixel by pixel. The DOM tip chip lives outside
// the WebGL canvas, so the probe isolates the 3D highlight alone.
//
// "Outline, not a blob" as a number: the authored rim is 4.5 mm wide, and at
// this probe distance that projects to a KNOWN pixel width (~26 px at 0.38 m,
// fov 34, device height 1333). A hover contribution is a blob when it forms a
// solid mass ~2.5x wider than that rim — the kernel radius is computed from
// the same constants, not guessed, because a fixed small kernel flags the
// rim's own interior at close-up scale (the first run of this driver did
// exactly that against a visually clean ring). And (2) the 40x40 box at the
// pile's projected centre — the middle of the top note's face — must not
// change at all.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* diff skipped */ }
  const OUT = path.resolve('qa/electron/cash-hover-k3');
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

  // park the pointer well away from the pile first
  await page.mouse.move(VIEWPORT.width - 40, 60);
  await page.waitForTimeout(400);

  // freeze one probe pose from the pile's bounds, then reuse it for all renders
  const probeReady = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const bounds = new THREE.Box3();
    let pieces = 0;
    clubhouse.interior.traverse((o) => {
      if (o.userData?.kind === 'money' && o.userData?.from === 'tender' && o.visible && o.geometry) {
        bounds.expandByObject(o); pieces += 1;
      }
    });
    if (!pieces || bounds.isEmpty()) return { error: 'no tender pieces on the desk' };
    const centre = bounds.getCenter(new THREE.Vector3());
    const eye = app.scene3d.camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.sub(centre).normalize();
    const probe = new THREE.PerspectiveCamera(34, 16 / 9, 0.02, 40);
    probe.position.copy(centre).addScaledVector(toEye, 0.38);
    probe.lookAt(centre);
    probe.updateMatrixWorld(true);
    const ndc = centre.clone().project(probe);
    window.__k3 = { probe, centrePx: {
      x: Math.round(((ndc.x + 1) / 2) * 1600),
      y: Math.round(((-ndc.y + 1) / 2) * 900),
    } };
    return { pieces, centrePx: window.__k3.centrePx };
  });
  assert(!probeReady.error, probeReady.error || 'probe setup failed');

  const probeShot = async (name) => {
    const dataUrl = await page.evaluate(() => {
      const scene3d = window.__fw.scene3d;
      scene3d.renderer.render(scene3d.scene, window.__k3.probe);
      return document.querySelector('canvas').toDataURL('image/png');
    });
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    return buf;
  };

  // ---- A, B unhovered (control pair), then hover, then C -------------------
  const shotA = await probeShot('unhovered-a.png');
  const shotB = await probeShot('unhovered-b.png');
  await page.screenshot({ path: path.join(OUT, 'player-frame-unhovered.png') });

  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'the desk tender is not in view');
  await page.mouse.move(handful.x, handful.y);
  await page.waitForTimeout(600);
  const shellCount = await page.evaluate(() => {
    let shells = 0; let sprites = 0;
    window.__fw.scene3d.clubhouse().interior.traverse((o) => {
      if (o.userData?.grabOutlineShell) shells += 1;
      if (o.isSprite && o.visible) sprites += 1;
    });
    return { shells, sprites };
  });
  const shotC = await probeShot('hovered.png');
  await page.screenshot({ path: path.join(OUT, 'player-frame-hovered.png') });

  // ---- pixel verdicts ------------------------------------------------------
  let verdict = { skipped: 'sharp unavailable' };
  if (sharp) {
    const raw = async (buf) => {
      const img = sharp(buf).ensureAlpha().raw();
      const { data, info } = await img.toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height };
    };
    const A = await raw(shotA); const B = await raw(shotB); const C = await raw(shotC);
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
    // a blob pixel: the centre of a fully-changed block ~2.5x the rim's own
    // projected width (probe: 0.38 m, fov 34 — keep in sync with probeReady)
    const frameH = 2 * 0.38 * Math.tan((34 / 2) * (Math.PI / 180));
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
    // the middle of the top note's face: the 40x40 box at the projected centre
    const c = probeReady.centrePx;
    const sx = Math.round(c.x * (A.w / 1600));
    const sy = Math.round(c.y * (A.h / 900));
    let centreChanged = 0;
    for (let y = Math.max(0, sy - 20); y < Math.min(A.h, sy + 20); y += 1) {
      for (let x = Math.max(0, sx - 20); x < Math.min(A.w, sx + 20); x += 1) {
        if (hover.mask[y * A.w + x]) centreChanged += 1;
      }
    }
    // the diff itself, as evidence
    const vis = Buffer.alloc(A.w * A.h * 3);
    for (let p = 0; p < A.w * A.h; p += 1) {
      const v = hover.mask[p] ? 255 : Math.round(luma(A.data, p * 4) * 0.25);
      vis[p * 3] = v; vis[p * 3 + 1] = hover.mask[p] ? 40 : v; vis[p * 3 + 2] = hover.mask[p] ? 40 : v;
    }
    await sharp(vis, { raw: { width: A.w, height: A.h, channels: 3 } })
      .png().toFile(path.join(OUT, 'hover-diff.png'));
    verdict = {
      pixels: A.w * A.h,
      controlChanged: control.changed,
      hoverChanged: hover.changed,
      rimProjectedPx: +rimPx.toFixed(1),
      blobKernelRadius: R,
      blobPixels: blob,
      blobFraction: hover.changed ? +(blob / hover.changed).toFixed(4) : 0,
      centreChanged,
    };
  }

  const checks = {
    controlDiffQuiet: !!verdict.pixels && verdict.controlChanged < verdict.pixels * 0.005,
    hoverDrawsSomething: !!verdict.pixels && verdict.hoverChanged > 200,
    outlineNotBlob: !!verdict.pixels && verdict.blobFraction < 0.03,
    noteFaceUntouched: !!verdict.pixels && verdict.centreChanged === 0,
    shellsPresentNoSprites: shellCount.shells > 0 && shellCount.sprites === 0,
    noPageErrors: errs.length === 0,
  };
  const out = { probeReady, shellCount, verdict, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'cash-hover.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
