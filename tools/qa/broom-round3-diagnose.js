async (page) => {
  // BROOM ROUND 3 — DIAGNOSE BEFORE TOUCHING ANYTHING.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-round3-diagnose.js
  //
  // The play-test verdict: "Two disembodied forearm cylinders, flesh-coloured,
  // ending in small nub protrusions... No hands are modelled. A large green
  // diagonal shape crosses the frame — apparently the player's own body
  // geometry intersecting the near plane. The broom head sits far to the lower
  // left, well below and away from the hands."
  //
  // Three of those four claims are about WHAT is on screen, so this driver
  // identifies every mesh drawn in the viewmodel pass by name, colour, and
  // screen footprint, then isolates each candidate by hiding it. No guessing.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/broom-round3/diagnose');
  fs.mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist')
      .forEach((n) => { n.style.display = 'none'; });
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2500);

  const shots = [];
  const shot = async (name) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file });
    shots.push(file);
    return file;
  };

  // ---- 1. as shipped, level pitch -----------------------------------------
  await shot('01-as-shipped-level.png');
  const diag = await page.evaluate(() => window.__fw.scene3d.walk.broomDiagnostics());

  // ---- 2. inventory every mesh drawn in the viewmodel pass -----------------
  // Name, colour, and the screen box each mesh actually covers, so "the large
  // green diagonal" resolves to a specific object instead of a theory.
  const inventory = await page.evaluate(() => {
    const app = window.__fw;
    const cam = app.scene3d.walk.broomViewmodelCamera?.()
      || app.scene3d.camera;
    cam.updateMatrixWorld?.(true);
    // three is not on window; every Object3D carries the Vector3 constructor
    const Vec3 = cam.position.constructor;
    const items = [];
    const v = new Vec3();
    app.scene3d.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      // only the viewmodel layer
      if (!(o.layers.mask & (1 << 29))) return;
      let parentHidden = false;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) { parentHidden = true; break; }
      if (parentHidden) return;
      const geo = o.geometry;
      if (!geo?.attributes?.position) return;
      const pos = geo.attributes.position;
      let minX = 9, maxX = -9, minY = 9, maxY = -9;
      let inFront = 0;
      const step = Math.max(1, Math.floor(pos.count / 120));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        o.localToWorld(v);
        v.project(cam);
        if (v.z < 1) inFront += 1;
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      const col = o.material?.color;
      // ancestry helps name the anonymous capsules
      const chain = [];
      for (let p = o; p && chain.length < 5; p = p.parent) chain.push(p.name || p.type);
      items.push({
        name: o.name || o.type,
        chain: chain.join(' < '),
        hex: col ? `#${col.getHexString()}` : null,
        ndc: {
          x: [+minX.toFixed(2), +maxX.toFixed(2)],
          y: [+minY.toFixed(2), +maxY.toFixed(2)],
        },
        // fraction of the frame area the mesh's screen box covers
        cover: +(((Math.min(1, maxX) - Math.max(-1, minX))
          * (Math.min(1, maxY) - Math.max(-1, minY))) / 4).toFixed(3),
        inFront,
      });
    });
    items.sort((a, b) => b.cover - a.cover);
    return items;
  });

  // ---- 3. isolate the suspects -------------------------------------------
  // The viewmodel's own sleeve capsules use the polo green 0x2f4a35 and run
  // from each elbow to a shoulder anchor authored at camera-space z −1.0 —
  // i.e. a yard IN FRONT of the lens. If they are the diagonal, hiding them
  // clears it.
  const hide = (mode) => page.evaluate((which) => {
    const app = window.__fw;
    const underNamed = (o, names) => {
      for (let p = o; p; p = p.parent) if (names.includes(p.name)) return true;
      return false;
    };
    const ARMS = ['BroomRightArm', 'BroomLeftArm'];
    const test = (o) => {
      if (which === 'green') {
        const hex = o.material?.color?.getHexString();
        return hex === '2f4a35' || hex === '21351f';
      }
      if (which === 'arms') return underNamed(o, ARMS);
      if (which === 'tool') return !underNamed(o, ['FirstPersonHands', ...ARMS]);
      return false;
    };
    const hidden = [];
    app.scene3d.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (!(o.layers.mask & (1 << 29))) return;
      if (test(o)) { o.userData.__wasVisible = o.visible; o.visible = false; hidden.push(o.name || o.type); }
    });
    return hidden;
  }, mode);
  const unhideAll = () => page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((o) => {
      if (o.userData?.__wasVisible !== undefined) {
        o.visible = o.userData.__wasVisible;
        delete o.userData.__wasVisible;
      }
    });
  });

  // 3a. hide everything green (sleeves + cuffs) in the viewmodel pass
  const hiddenGreen = await hide("o.material && o.material.color && (o.material.color.getHexString()==='2f4a35' || o.material.color.getHexString()==='21351f')");
  await page.waitForTimeout(400);
  await shot('02-green-hidden.png');
  await unhideAll();

  // 3b. hide the broom's own arm groups entirely — what remains is the tool
  //     plus the fpHands, so the "are hands modelled" claim gets a clean look
  const hiddenArms = await hide("(()=>{for(let p=o;p;p=p.parent){if(p.name==='BroomRightArm'||p.name==='BroomLeftArm')return true;}return false;})()");
  await page.waitForTimeout(400);
  await shot('03-arms-hidden-hands-and-tool-only.png');
  await unhideAll();

  // 3c. the hands alone: hide the tool geometry, keep hands + arms
  const hiddenTool = await hide("(()=>{for(let p=o;p;p=p.parent){if(p.name==='FirstPersonHands'||p.name==='BroomRightArm'||p.name==='BroomLeftArm')return false;}return true;})()");
  await page.waitForTimeout(400);
  await shot('04-hands-and-arms-only.png');
  await unhideAll();
  await page.waitForTimeout(300);

  // ---- 4. where are the hands, really? ------------------------------------
  const hands = await page.evaluate(() => {
    const app = window.__fw;
    const cam = app.scene3d.walk.broomViewmodelCamera?.() || app.scene3d.camera;
    cam.updateMatrixWorld?.(true);
    const Vec3 = cam.position.constructor;
    const out = {};
    for (const n of ['FirstPersonRightHand', 'FirstPersonLeftHand']) {
      let found = null;
      app.scene3d.scene.traverse((o) => { if (o.name === n) found = o; });
      if (!found) { out[n] = null; continue; }
      const w = new Vec3();
      found.getWorldPosition(w);
      const ndc = w.clone().project(cam);
      // world extent + screen box, walked by hand (no Box3 available here)
      const v = new Vec3();
      const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
      let nx0 = 9; let nx1 = -9; let ny0 = 9; let ny1 = -9;
      found.traverse((m) => {
        const pos = m.isMesh && m.geometry?.attributes?.position;
        if (!pos || !m.visible) return;
        const step = Math.max(1, Math.floor(pos.count / 40));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i);
          m.localToWorld(v);
          lo[0] = Math.min(lo[0], v.x); hi[0] = Math.max(hi[0], v.x);
          lo[1] = Math.min(lo[1], v.y); hi[1] = Math.max(hi[1], v.y);
          lo[2] = Math.min(lo[2], v.z); hi[2] = Math.max(hi[2], v.z);
          v.project(cam);
          nx0 = Math.min(nx0, v.x); nx1 = Math.max(nx1, v.x);
          ny0 = Math.min(ny0, v.y); ny1 = Math.max(ny1, v.y);
        }
      });
      out[n] = {
        visible: found.visible,
        scale: found.scale.toArray().map((x) => +x.toFixed(3)),
        worldSizeYd: hi.map((h, i) => +(h - lo[i]).toFixed(3)),
        ndc: { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3), z: +ndc.z.toFixed(3) },
        screenBox: {
          x: [+nx0.toFixed(2), +nx1.toFixed(2)],
          y: [+ny0.toFixed(2), +ny1.toFixed(2)],
        },
      };
    }
    return out;
  });

  return {
    ok: true,
    diag,
    hands,
    hiddenGreen,
    hiddenArms: hiddenArms.length,
    hiddenTool: hiddenTool.length,
    inventoryTop: inventory.slice(0, 14),
    shots,
  };
}
