// TAGS — the ROOM, photographed at the player's camera.
//
// The counter shot proves the goods crossing the till carry no labels. It does
// NOT prove anything about the five delivery cartons, the shoe box, the folded
// trousers or the water bottle — the assets where the repo-wide GLB sweep found
// the codes that were "still there". Those stand on the shop floor.
//
// Two earlier attempts at this shot failed, both recorded here:
//   1. setting walk.state while the REGISTER owned the camera — the pose never
//      moved and it re-photographed the till;
//   2. finding the cartons by GLB filename — the runtime node names are not the
//      file names, so the search returned nothing and the driver took no shots
//      while still reporting most of its checks green.
//
// So this one never enters the register, and finds cartons by SHAPE: a
// floor-standing box roughly 0.25–0.8 m on its longest side. Whatever it aims
// at, it re-reads: for every object it photographs it reports how many mesh
// nodes beneath it carry a signage name.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tag-free-room');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.waitForTimeout(1400);

  const targets = await page.evaluate(() => {
    const app = window.__fw;
    const V = app.scene3d.camera.position.constructor;
    const club = app.scene3d.clubhouse();
    const TAG = /(barcode|swingtag|hangtag|pricetag|shelftag|sizetag|pricerail|pricecard|qrcode)/i;
    const seen = [];
    club.interior.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      let vis = node.visible;
      for (let p = node.parent; vis && p; p = p.parent) vis = p.visible;
      if (!vis) return;
      node.geometry.computeBoundingBox();
      const bb = node.geometry.boundingBox;
      if (!bb) return;
      const lo = new V(bb.min.x, bb.min.y, bb.min.z);
      const hi = new V(bb.max.x, bb.max.y, bb.max.z);
      node.localToWorld(lo); node.localToWorld(hi);
      const w = Math.abs(hi.x - lo.x); const h = Math.abs(hi.y - lo.y); const d = Math.abs(hi.z - lo.z);
      const longest = Math.max(w, h, d);
      const shortest = Math.min(w, h, d);
      const floorY = Math.min(lo.y, hi.y);
      // a carton: boxy, floor-standing, hand-to-knee sized
      if (longest < 0.22 || longest > 0.9) return;
      if (shortest < 0.06) return;
      if (floorY > 1.2) return;
      const wp = node.getWorldPosition(new V());
      seen.push({ name: node.name || '(unnamed)', at: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)], longest: +longest.toFixed(2) });
    });
    // spread them out so the shots are of different objects
    const picked = [];
    for (const s of seen) {
      if (picked.some((p) => Math.hypot(p.at[0] - s.at[0], p.at[2] - s.at[2]) < 1.1)) continue;
      picked.push(s);
      if (picked.length >= 5) break;
    }
    // and re-read what each carries, from the ROOT of its asset
    for (const p of picked) {
      let root = null;
      club.interior.traverse((n) => {
        if (root) return;
        if ((n.name || '') === p.name) root = n.parent || n;
      });
      let signage = 0; let meshes = 0;
      (root || club.interior).traverse((c) => {
        if (!c.isMesh) return;
        meshes += 1;
        if (TAG.test(c.name || '')) signage += 1;
      });
      p.signageMeshes = signage;
      p.meshesUnderAsset = meshes;
      p.assetRoot = root ? (root.name || '(unnamed)') : null;
    }
    return { candidates: seen.length, picked };
  });

  const shots = [];
  for (const [index, target] of targets.picked.entries()) {
    const framed = await page.evaluate((t) => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const back = 1.25;
      walk.x = t.at[0] + back * 0.72;
      walk.z = t.at[2] + back * 0.72;
      const dx = t.at[0] - walk.x;
      const dz = t.at[2] - walk.z;
      const h = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / h, -dz / h);
      const eyeY = app.scene3d.camera.position.y;
      walk.pitch = Math.max(-1.0, Math.atan2(t.at[1] - eyeY, h));
      return { x: +walk.x.toFixed(2), z: +walk.z.toFixed(2), pitch: +walk.pitch.toFixed(3) };
    }, target);
    await page.waitForTimeout(950);
    const shot = `${String(index).padStart(2, '0')}-${target.name.replace(/[^a-z0-9_]+/gi, '-').slice(0, 44)}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    shots.push({ ...target, framed, shot });
  }

  // A wide shot of the room those cartons stand in. NOT club.center + the
  // interior offset — that double-counts, and the first run of this walked the
  // camera out onto the fairway and photographed grass. The cartons' own world
  // positions are already world space, so average them and stand back from that.
  await page.evaluate((points) => {
    const app = window.__fw;
    const walk = app.scene3d.walk.state;
    if (!points.length) return;
    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cz = points.reduce((sum, p) => sum + p[2], 0) / points.length;
    walk.x = cx + 3.4;
    walk.z = cz + 3.4;
    const dx = cx - walk.x;
    const dz = cz - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = -0.22;
  }, targets.picked.map((t) => t.at));
  await page.waitForTimeout(950);
  await page.screenshot({ path: path.join(OUT, 'room-wide.png') });
  // ASK, do not assume. The first version of this asserted `wideShotIsIndoors:
  // true` as a literal, which is not a check at all - the very habit that let a
  // tag survive two green sweeps. The clubhouse knows where its walls are.
  const wideIndoors = await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const walk = app.scene3d.walk.state;
    return {
      inside: typeof club.isInside === 'function' ? !!club.isInside(walk.x, walk.z) : null,
      at: [+walk.x.toFixed(2), +walk.z.toFixed(2)],
    };
  });

  const checks = {
    foundCartons: targets.picked.length > 0,
    everyOnePhotographed: shots.length === targets.picked.length && shots.length > 0,
    noSignageMeshOnAnyOfThem: targets.picked.every((t) => t.signageMeshes === 0),
    cameraMovedBetweenShots: shots.length < 2
      || new Set(shots.map((s) => `${s.framed.x},${s.framed.z}`)).size === shots.length,
    // the wide shot must be INDOORS - the first run framed the fairway
    wideShotIsIndoors: wideIndoors.inside === true,
    noPageErrors: errs.length === 0,
  };
  const out = { targets, shots, wideIndoors, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tag-free-room.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
