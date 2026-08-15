// A (Goal 24) — THE BAG LOOKS EXACTLY THE SAME EMPTY OR FULL.
//
// "Image 3 is bagFill — the kraft block you added so the bag would read as full.
// Delete it. No block, no mass, no contents at the mouth."
//
// The block is deleted. The question this driver answers is the one a source
// test cannot: does anything ELSE appear at the mouth when goods go in. So it
// photographs the bag with nothing in it, plays the real click-to-bag
// interaction until every good is inside, photographs the same rectangle again,
// and compares the two frames pixel by pixel. The claim is that they match.
//
// THE CAMERA IS THE TRAP HERE AND IT IS NOW A CONTROL.
//
// "Register mode holds a static frame" is true WITHIN a stage and false across
// one. Bagging the last good advances the flow to payment, and the payment
// camera pulls back to put the customer and the card in shot — so the first
// version of this driver compared a close-up of the bag against a wide shot of
// a man holding a card and reported that 83.6% of the pixels had changed. It
// would have read as a catastrophic regression in the bag.
//
// So the comparison happens entirely inside the bagging stage: all but the LAST
// good go in, which leaves goods in the carrier and the flow where it was. The
// camera's position and orientation are recorded at every shot and the run fails
// if they differ, because a moved camera makes every other number here
// meaningless.
//
// THREE CONTROLS, because "the frames match" is a sentence this driver would
// otherwise be able to say about a black screen:
//   1. items must actually have been bagged. Nothing bagged, nothing to see.
//   2. the crop must contain real picture, not a flat wall — measured as the
//      spread of pixel values inside it.
//   3. bagFill ITSELF, rebuilt on purpose at the mouth, must make the same
//      comparison fail. This is the only control worth having here: the question
//      is not "can the check see some change", it is "would this check have
//      caught the exact thing the owner has been reporting for two goals". The
//      first version of this control merely switched one packed good back to
//      visible, and that moved 0.1% of the crop — because a good inside the bag
//      is genuinely behind the paper, which is the design working. It proved
//      nothing about the fill and nearly shipped as if it had.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a-bag-shows-nothing.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a-bag-shows-nothing');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], steps: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const step = (name, data) => { out.steps.push({ name, ...data }); console.log('A-BAG', name, JSON.stringify(data)); };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  out.staged = await page.evaluate(async ([skus]) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    app.speedIdx = 0;
    ch.setOrganicWalkins?.(false);
    if (app.state.shop) app.state.shop.open = true;
    for (const id of skus) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 8);
    }
    ch.rebuildStock();
    const name = ch.sendToCounter(skus, 'card');
    return name ? { ok: true, name } : { ok: false, why: 'sendToCounter returned nothing' };
  }, [['balls1', 'glove1', 'tees1']]);
  step('staged', out.staged);
  if (!out.staged.ok) { fs.writeFileSync(path.join(OUT, 'bag.json'), `${JSON.stringify(out, null, 2)}\n`); return out; }

  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const off = ch.interior.position;
    w.x = REGISTER.stand.x + off.x;
    w.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / h, -dz / h);
    w.pitch = Math.atan2(1.18 - 1.62, h);
  });
  const gotTx = await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx.items.length >= 2;
  }, null, { timeout: 90000 }).then(() => true).catch(() => false);
  if (!gotTx) {
    step('STAGING FAILED', { why: 'the customer never placed their goods on the counter' });
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'bag.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 20000 });
  await page.waitForTimeout(2000);

  // The bag's rectangle on screen, from its own bounding box. Generous by half a
  // box in every direction so a fill that stood proud of the rim would still be
  // inside the crop rather than conveniently outside it.
  const bagRect = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const bag = app.scene3d.clubhouse().register.bagNode?.();
    if (!bag) return { ok: false, why: 'register exposed no bag node' };
    bag.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(bag);
    if (box.isEmpty()) return { ok: false, why: 'bag bounding box is empty' };
    const cam = app.scene3d.camera;
    cam.updateMatrixWorld(true);
    let minX = 1e9; let minY = 1e9; let maxX = -1e9; let maxY = -1e9;
    for (let i = 0; i < 8; i += 1) {
      const p = new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).project(cam);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // A TIGHT pad. The first version padded by half the box in every direction,
    // which reached across the counter and swallowed the staging area — so the
    // goods LEAVING the counter (the game working correctly) read as 6.5% of the
    // crop changing, and the verdict was about the wrong rectangle entirely.
    const padX = (maxX - minX) * 0.12; const padY = (maxY - minY) * 0.12;
    const toU = (n) => Math.max(0, Math.min(1, (n + 1) / 2));
    return {
      ok: true,
      left: toU(minX - padX),
      right: toU(maxX + padX),
      // NDC y is up, image y is down
      top: 1 - toU(maxY + padY),
      bottom: 1 - toU(minY - padY),
    };
  });
  out.bagRect = bagRect;
  step('bag-rect', bagRect);

  const cameraPose = () => page.evaluate(() => {
    const c = window.__fw.scene3d.camera;
    c.updateMatrixWorld(true);
    const e = c.matrixWorld.elements;
    return [e[12], e[13], e[14], e[0], e[5], e[10]].map((n) => +n.toFixed(4));
  });
  out.poses = {};
  const shoot = async (file) => {
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, file) });
    out.poses[file] = await cameraPose();
    return path.join(OUT, file);
  };
  // THE REFERENCE FRAME HIDES THE GOODS THAT ARE STILL ON THE COUNTER.
  //
  // From this camera the staged goods sit IN FRONT OF the bag, so every
  // rectangle that contains the bag also contains them — and once they are
  // bagged they are gone from the counter, which is the game working correctly
  // and read as 3.9% of the crop changing. That is a real difference about the
  // COUNTER, and this check is about the BAG. Hiding them for the reference shot
  // leaves exactly one variable between the two frames: what is in the carrier.
  out.hiddenForReference = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const tx = ch.register.getTx();
    let n = 0;
    for (const item of tx?.items || []) {
      const mesh = ch.register.itemMesh(item.uid);
      if (mesh && mesh.visible) { mesh.visible = false; n += 1; }
    }
    return n;
  });
  await page.waitForTimeout(500);
  const emptyShot = await shoot('01-bag-empty.png');
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const tx = ch.register.getTx();
    for (const item of tx?.items || []) {
      const mesh = ch.register.itemMesh(item.uid);
      if (mesh) mesh.visible = true;
    }
  });
  await page.waitForTimeout(400);

  // ---- the real interaction: one click rings up AND moves the good in ------
  const clickItem = async (uid) => {
    const spot = await page.evaluate(async (id) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const mesh = app.scene3d.clubhouse().register.itemMesh(id);
      if (!mesh) return null;
      const world = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      world.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {
        x: rect.left + ((world.x + 1) / 2) * rect.width,
        y: rect.top + ((-world.y + 1) / 2) * rect.height,
        ok: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      };
    }, uid);
    if (!spot || !spot.ok) return false;
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(1800);
    return true;
  };
  // ALL BUT THE LAST. Bagging the final good advances the flow to payment and
  // moves the camera, which would put the two frames in different shots.
  const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
  for (const uid of uids.slice(0, -1)) await clickItem(uid);
  await page.waitForTimeout(2500); // let every flight land and settle
  // and hide the good still waiting on the counter, so the two frames differ
  // only in what the carrier holds
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const tx = ch.register.getTx();
    for (const item of tx?.items || []) {
      if (item.bagged) continue;
      const mesh = ch.register.itemMesh(item.uid);
      if (mesh) mesh.visible = false;
    }
  });
  await page.waitForTimeout(400);

  // CONTROL 1: how many goods are actually inside. Identical frames mean nothing
  // if the answer is zero.
  out.packed = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const bag = ch.register.bagNode?.();
    const tx = ch.register.getTx();
    const inBag = bag ? bag.children.filter(
      (c) => c.userData?.checkoutVisualState === 'packed-in-bag',
    ) : [];
    return {
      packedInBag: inBag.length,
      bagged: tx ? tx.items.filter((i) => i.bagged).length : 0,
      items: tx ? tx.items.length : 0,
      // if this is ever non-zero the fill is back under another name
      drawnInsideTheBag: inBag.filter((c) => c.visible).length,
      strayFillNodes: bag ? bag.children.filter(
        (c) => /fill/i.test(c.name || '') || c.userData?.checkoutOwnedFill,
      ).length : 0,
    };
  });
  step('packed', out.packed);
  const fullShot = await shoot('02-bag-full.png');

  // CONTROL 3: REBUILD bagFill AND MAKE SURE THIS CHECK SEES IT.
  //
  // Same geometry, same kraft colour, same anchor and the same size formula as
  // the deleted code, so what gets photographed is the block the owner has been
  // reporting — not a stand-in. If the comparison cannot see this, it cannot
  // certify that nothing is there.
  out.controlFill = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const ch = window.__fw.scene3d.clubhouse();
    const bag = ch.register.bagNode?.();
    if (!bag) return { ok: false, why: 'no bag node' };
    // the authored interior node, found the way the deleted code held it
    let contents = null;
    bag.traverse((o) => {
      if (!contents && Number.isFinite(o.userData?.interior_half_x)) contents = o;
    });
    let halfX = 0.125; let halfMouth = 0.126; let halfDepth = 0.07;
    const centre = new THREE.Vector3(0, 0.14, 0);
    if (contents) {
      bag.updateWorldMatrix(true, false);
      centre.copy(bag.worldToLocal(contents.getWorldPosition(new THREE.Vector3())));
      const a = contents.userData;
      if (Number.isFinite(a.interior_half_x)) halfX = a.interior_half_x;
      if (Number.isFinite(a.interior_half_mouth)) halfMouth = a.interior_half_mouth;
      if (Number.isFinite(a.interior_half_depth)) halfDepth = a.interior_half_depth;
    }
    const packed = bag.children.filter(
      (c) => c.userData?.checkoutVisualState === 'packed-in-bag',
    ).length || 3;
    const fullness = 1 - (1 / (1 + packed * 0.55));
    const height = Math.max(0.02, halfMouth * 2 * (0.35 + 0.5 * fullness));
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xb7a184, roughness: 0.92, metalness: 0 }),
    );
    mesh.name = 'QAControlBagFill';
    mesh.scale.set(halfX * 1.72, height, halfDepth * 1.6);
    mesh.position.set(centre.x, centre.y - halfMouth + height / 2, centre.z);
    bag.add(mesh);
    window.__qaControlFill = mesh;
    return { ok: true, usedAuthoredInterior: !!contents, height: +height.toFixed(3) };
  });
  await page.waitForTimeout(700);
  const controlShot = await shoot('03-control-bagfill-rebuilt.png');
  await page.evaluate(() => {
    const m = window.__qaControlFill;
    if (m) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
    window.__qaControlFill = null;
  });

  // ---- compare, node-side, in the real screenshots -------------------------
  const sharp = (await import('sharp')).default;
  const cropStats = async (file) => {
    const img = sharp(file);
    const meta = await img.metadata();
    const left = Math.round(bagRect.left * meta.width);
    const top = Math.round(bagRect.top * meta.height);
    const width = Math.max(2, Math.round((bagRect.right - bagRect.left) * meta.width));
    const height = Math.max(2, Math.round((bagRect.bottom - bagRect.top) * meta.height));
    const { data, info } = await sharp(file)
      .extract({
        left: Math.min(left, meta.width - 2),
        top: Math.min(top, meta.height - 2),
        width: Math.min(width, meta.width - left),
        height: Math.min(height, meta.height - top),
      })
      .raw().toBuffer({ resolveWithObject: true });
    return { data, info };
  };
  const diffPct = (a, b) => {
    if (a.data.length !== b.data.length) return 100;
    const px = a.data.length / a.info.channels;
    let changed = 0;
    for (let i = 0; i < px; i += 1) {
      const o = i * a.info.channels;
      if (Math.abs(a.data[o] - b.data[o]) > 8
        || Math.abs(a.data[o + 1] - b.data[o + 1]) > 8
        || Math.abs(a.data[o + 2] - b.data[o + 2]) > 8) changed += 1;
    }
    return +((changed / px) * 100).toFixed(3);
  };
  const empty = await cropStats(emptyShot);
  const full = await cropStats(fullShot);
  const control = await cropStats(controlShot);
  // CONTROL 2: is there real picture in the crop, or a flat wall?
  let lo = 255; let hi = 0;
  for (let i = 0; i < empty.data.length; i += empty.info.channels) {
    lo = Math.min(lo, empty.data[i]); hi = Math.max(hi, empty.data[i]);
  }
  out.measured = {
    cropPx: `${empty.info.width}x${empty.info.height}`,
    emptyVsFullPct: diffPct(empty, full),
    emptyVsControlPct: diffPct(empty, control),
    fullVsControlPct: diffPct(full, control),
    cropRedSpread: hi - lo,
  };
  out.checks = {
    bagRectFound: !!bagRect.ok,
    // CONTROL 1
    goodsActuallyWentIn: out.packed.packedInBag >= 2 && out.packed.bagged >= 2,
    // CONTROL 1b: the reference frame really did hide the counter goods
    referenceFrameIsolatedTheBag: out.hiddenForReference >= 3,
    nothingDrawnInsideTheBag: out.packed.drawnInsideTheBag === 0,
    noFillNodeExists: out.packed.strayFillNodes === 0,
    // CONTROL 2
    cropContainsRealPicture: out.measured.cropRedSpread > 40,
    // CONTROL 4: THE CAMERA DID NOT MOVE between any two shots. Without this
    // the comparison silently becomes "close-up versus wide shot".
    cameraHeldStillAcrossEveryShot: (() => {
      const poses = Object.values(out.poses);
      return poses.length >= 3 && poses.every(
        (p) => p.every((n, i) => Math.abs(n - poses[0][i]) < 0.002),
      );
    })(),
    // THE CLAIM
    bagLooksTheSameEmptyOrFull: out.measured.emptyVsFullPct < 0.5,
    // CONTROL 3 — the instrument can see a good that IS drawn
    controlRebuiltFillIsSeen: out.measured.fullVsControlPct >= 1,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'bag.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A-BAG', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
