// G3 — A PENETRATION METRIC THAT SURVIVES ITS OWN CONTROL.
//
// "Item 20: a metric that survives its own control, or a written statement that
// it is unmeasurable and the screenshots are all there is."
//
// TWO EARLIER ATTEMPTS FAILED, and both failed for the same reason. Parity
// ray-casting (count the crossings; odd means inside) undercounts, because
// three.js raycasts FRONT FACES ONLY — and it could not have worked anyway,
// because the fixture surfaces are open single-sided planes and parity is only
// defined for a closed surface. Bounding-box containment found no volume for
// the same reason: there is no volume there to find.
//
// The mistake in both was looking at the VISIBLE geometry. The authored assets
// carry COL_/COLLISION_/VOLUME_ proxies — simplified closed hulls, kept in the
// scene as invisible meshes with `runtimeCollisionProxyExcluded`. A closed hull
// has an inside. So the metric is the contact socket's depth inside the nearest
// such proxy, computed in the proxy's OWN frame so a rotated counter is not
// measured against a world-axis box.
//
// THE CONTROLS, and this is the whole point of the exercise:
//   inside   a point placed AT the proxy's centre must read a large positive
//            depth. If the centre of a solid reads as outside it, there is no
//            metric here.
//   outside  a point a yard clear of its nearest face must read zero. If
//            everything reads as penetrating, the number is not about
//            penetration.
// Both are asserted. If either fails, this driver says so and the honest answer
// is the written statement the brief allows instead.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-penetration');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  const world = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    // facing the front desk, at the working distance a player cleans from
    w.x = o.x - 3.0; w.z = o.z + 3.6; w.yaw = 2.5; w.pitch = -0.30;
    return { x: w.x, z: w.z };
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;

    // every closed collision hull in the room, with its own frame
    const proxies = [];
    s3.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const named = /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(o.name || ''));
      if (!named && !o.userData?.collision_proxy && !o.userData?.runtimeCollisionProxyExcluded) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox || o.geometry.boundingBox.isEmpty()) return;
      o.updateWorldMatrix(true, false);
      proxies.push({
        name: o.name || '(unnamed)',
        box: o.geometry.boundingBox.clone(),
        inverse: o.matrixWorld.clone().invert(),
        scale: o.getWorldScale(new THREE.Vector3()),
      });
    });
    window.__proxyCount = proxies.length;

    // Depth INSIDE a hull, in its own frame: the smallest distance from the
    // point to any of the six faces, scaled back to world. Zero when outside.
    const depthInside = (worldPoint, accept = null) => {
      let best = { depth: 0, name: null };
      const local = new THREE.Vector3();
      for (const p of proxies) {
        if (accept && !accept(p.name)) continue;
        local.copy(worldPoint).applyMatrix4(p.inverse);
        const b = p.box;
        if (local.x < b.min.x || local.x > b.max.x
          || local.y < b.min.y || local.y > b.max.y
          || local.z < b.min.z || local.z > b.max.z) continue;
        const dx = Math.min(local.x - b.min.x, b.max.x - local.x) * Math.abs(p.scale.x);
        const dy = Math.min(local.y - b.min.y, b.max.y - local.y) * Math.abs(p.scale.y);
        const dz = Math.min(local.z - b.min.z, b.max.z - local.z) * Math.abs(p.scale.z);
        const depth = Math.min(dx, dy, dz);
        if (depth > best.depth) best = { depth, name: p.name };
      }
      return best;
    };
    // THE FLOOR IS NOT A FIXTURE. A floor tool's contact socket sits ON the
    // boards, so it reads a tenth of a yard inside the foundation slab by
    // design — that is the tool working, not the tool clipping. Item 20 is about
    // a tool being inside the COUNTER. Both numbers are returned so the
    // distinction is in the data rather than in a reader's head.
    const GROUND = /foundation|floorslab|COL_Floor/i;
    window.__depthInside = (x, y, z) => {
      const point = new THREE.Vector3(x, y, z);
      const any = depthInside(point);
      const fixture = depthInside(point, (name) => !GROUND.test(name));
      return {
        depth: +any.depth.toFixed(4),
        proxy: any.name,
        fixtureDepth: +fixture.depth.toFixed(4),
        fixtureProxy: fixture.name,
      };
    };

    // the controls need a real hull to aim at: the biggest one in the room
    window.__controlPoints = () => {
      if (!proxies.length) return null;
      let biggest = null;
      let bestVol = -1;
      const size = new THREE.Vector3();
      for (const p of proxies) {
        p.box.getSize(size);
        const vol = size.x * Math.abs(p.scale.x) * size.y * Math.abs(p.scale.y)
          * size.z * Math.abs(p.scale.z);
        if (vol > bestVol) { bestVol = vol; biggest = p; }
      }
      const centreLocal = biggest.box.getCenter(new THREE.Vector3());
      const toWorld = biggest.inverse.clone().invert();
      const centre = centreLocal.clone().applyMatrix4(toWorld);
      biggest.box.getSize(size);
      const halfY = (size.y / 2) * Math.abs(biggest.scale.y);
      // a yard clear of its own top face
      const outside = centre.clone().add(new THREE.Vector3(0, halfY + 1.0, 0));
      return {
        proxy: biggest.name,
        volumeYd3: +bestVol.toFixed(4),
        centre: centre.toArray().map((v) => +v.toFixed(3)),
        outside: outside.toArray().map((v) => +v.toFixed(3)),
      };
    };

    window.__toolContact = (toolId) => {
      let contact = null;
      const under = (o) => { for (let p = o.parent; p; p = p.parent) if (p === s3.camera) return true; return false; };
      const vis = (o) => { let v = o.visible; for (let p = o.parent; p && v; p = p.parent) v = p.visible; return v; };
      s3.scene.traverse((o) => {
        if (contact || !vis(o) || !under(o)) return;
        if (/SOCKET_(FloorContact|DirtIntake|PanIntake|SprayEmission|BristleContact|SweepContact)/i.test(String(o.name || ''))) {
          contact = o;
        }
      });
      if (!contact) return null;
      const p = contact.getWorldPosition(new THREE.Vector3());
      return { name: contact.name, point: p.toArray().map((v) => +v.toFixed(3)) };
    };
  });

  const proxyCount = await page.evaluate(() => window.__proxyCount);
  const cp = await page.evaluate(() => window.__controlPoints());
  const controlInside = cp ? await page.evaluate((p) => window.__depthInside(...p), cp.centre) : null;
  const controlOutside = cp ? await page.evaluate((p) => window.__depthInside(...p), cp.outside) : null;

  // ONE POSE IS NOT A CLAIM. The player can stand anywhere and aim anywhere, so
  // each tool is walked over a grid of stand points and pitches against the
  // desk and the deepest reading of the lot is what gets reported. A single
  // frame reading zero says nothing about the frame after it.
  const POSES = [];
  for (const [dx, dz] of [[-3.0, 3.6], [-2.2, 3.0], [-3.6, 2.6], [-2.6, 4.2]]) {
    for (const pitch of [-0.10, -0.30, -0.55, -0.80]) POSES.push({ dx, dz, pitch });
  }
  const rows = [];
  for (const tool of ['broom', 'mop', 'vacuum', 'dustpan', 'washer', 'spray']) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(1400);
    let worst = null;
    let sampled = 0;
    for (const pose of POSES) {
      await page.evaluate(({ dx, dz, pitch }) => {
        const o = window.__fw.scene3d.clubhouse().interior.position;
        const w = window.__fw.scene3d.walk.state;
        w.x = o.x + dx; w.z = o.z + dz; w.yaw = 2.5; w.pitch = pitch;
      }, pose);
      await page.waitForTimeout(320);
      const contact = await page.evaluate((t) => window.__toolContact(t), tool);
      if (!contact) continue;
      sampled += 1;
      const d = await page.evaluate((pt) => window.__depthInside(...pt), contact.point);
      if (!worst || d.fixtureDepth > worst.fixtureDepth) worst = { ...d, socket: contact.name, pose };
    }
    if (!sampled) { rows.push({ tool, error: 'no contact socket at any pose' }); continue; }
    // photograph the deepest pose, so the number has a picture beside it
    if (worst?.pose) {
      await page.evaluate(({ dx, dz, pitch }) => {
        const o = window.__fw.scene3d.clubhouse().interior.position;
        const w = window.__fw.scene3d.walk.state;
        w.x = o.x + dx; w.z = o.z + dz; w.yaw = 2.5; w.pitch = pitch;
      }, worst.pose);
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(OUT, `${tool}.png`) });
    rows.push({ tool, posesSampled: sampled, ...worst });
  }

  const controlsPass = !!cp
    && (controlInside?.depth ?? 0) > 0.05
    && (controlOutside?.depth ?? 1) === 0;

  const out = {
    world, proxyCount, controlPoints: cp, controlInside, controlOutside, rows,
    deepest: rows.filter((r) => !r.error).sort((a, b) => b.fixtureDepth - a.fixtureDepth)[0] || null,
    checks: {
      foundClosedHulls: proxyCount > 0,
      // THE TWO CONTROLS. Without both, the numbers below mean nothing.
      controlCentreReadsInside: (controlInside?.depth ?? 0) > 0.05,
      controlClearPointReadsOutside: (controlOutside?.depth ?? 1) === 0,
      everyToolMeasured: rows.every((r) => !r.error),
      everyToolSweptEveryPose: rows.every((r) => r.error || r.posesSampled === POSES.length),
      // the finding: no tool's working end is inside a FIXTURE at any swept pose
      noToolInsideAFixture: rows.every((r) => r.error || r.fixtureDepth === 0),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.verdict = controlsPass
    ? `metric holds: a hull centre reads ${controlInside.depth} yd inside, a point a yard clear reads 0`
    : 'the controls did not pass; this metric is not usable and the screenshots are all there is';
  out.ok = controlsPass;
  fs.writeFileSync(path.join(OUT, 'penetration.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
