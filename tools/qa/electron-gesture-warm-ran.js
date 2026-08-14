// ROUND 7 — DID THE GESTURE WARM RUN, AND WHY IS THE MOP STILL COLD?
//
// The page turn went to +0 programs, but that was the shadow-type fix. The
// gesture warm's own effect is UNPROVEN: the mop still arrives with +1 program
// and +8 geometries on its first equip, exactly as before, and there are two
// completely different reasons that could be true --
//
//   (a) the phase never ran. It hangs off `clubhouseApi?.ledgerBook?.
//       prewarmGesture?.(...)` and a walkSetTool loop inside `if (alive())`,
//       and this repository has been burned repeatedly by optional chains that
//       no-op in silence.
//   (b) it ran and could not help, because the render context at prewarm is not
//       the render context at equip -- which is what the cache-key diff already
//       says: parameter.numPointLights, 4 -> 7.
//
// Those need opposite fixes, so this asks rather than assumes. prewarmTimings
// carries a label per phase and the tool warm pushes its own COUNT, so a phase
// that ran but warmed nothing is distinguishable from one that never ran.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-gesture-warm-ran.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/gesture-warm-ran');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(7000);

  // Count the lights the way THREE does when it builds a cache key: the render
  // state's light list, which is every light that survived the visibility walk.
  // A scene.traverse count would include lights the frame never submits, which
  // is the difference the cache key is made of.
  const lights = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const found = { point: [], dir: [], spot: [], hemi: [] };
    s3.scene.traverse((o) => {
      if (!o.isLight) return;
      let visible = o.visible;
      for (let n = o.parent; n && visible; n = n.parent) visible = n.visible;
      const row = { name: o.name || o.type, visible, intensity: +Number(o.intensity).toFixed(3) };
      if (o.isPointLight) found.point.push(row);
      else if (o.isDirectionalLight) found.dir.push(row);
      else if (o.isSpotLight) found.spot.push(row);
      else if (o.isHemisphereLight) found.hemi.push(row);
    });
    const live = (list) => list.filter((r) => r.visible).length;
    return {
      pointTotal: found.point.length,
      pointVisible: live(found.point),
      dirVisible: live(found.dir),
      spotVisible: live(found.spot),
      hemiVisible: live(found.hemi),
      points: found.point,
    };
  });

  out.prewarmTimings = await page.evaluate(() => {
    const t = window.__fw.scene3d.prewarmTimings?.() ?? null;
    return Array.isArray(t) ? t.map((x) => ({ label: x.label, ms: x.ms })) : t;
  });
  out.gesturePhases = (out.prewarmTimings || []).filter(
    (t) => String(t.label).startsWith('gesture'),
  );
  out.heldAssets = await page.evaluate(() => {
    const d = window.__fw.scene3d.heldAssetDiagnostics?.() ?? null;
    if (!d) return null;
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, {
      status: v.status, reason: v.reason, ensureCalls: v.ensureCalls,
    }]));
  });
  out.lightsAtBoot = await lights();

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(600);
  out.lightsAfterPointerLock = await lights();

  // Does the mop's yarn geometry EXIST before the player equips it? If the warm
  // equipped the mop behind the veil, the strands are already built and the +8
  // is something else; if it does not exist, the geometry is created on equip
  // and no warm of any kind can pre-upload a buffer that is not there yet.
  const mopMeshes = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const hits = [];
    const walkRoots = [s3.scene, s3.camera];
    const seen = new Set();
    for (const root of walkRoots) {
      root?.traverse?.((o) => {
        if (seen.has(o.uuid) || !/Mop/i.test(o.name || '')) return;
        seen.add(o.uuid);
        if (!o.isMesh) return;
        hits.push({
          name: o.name,
          visible: o.visible,
          verts: o.geometry?.attributes?.position?.count ?? null,
          geoUuid: o.geometry?.uuid?.slice(0, 8) ?? null,
        });
      });
    }
    return hits;
  });
  out.mopBeforeEquip = await mopMeshes();

  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  await page.waitForTimeout(2500);
  out.mopAfterEquip = await mopMeshes();
  out.lightsWithMop = await lights();

  out.summary = {
    GESTURE_PHASES_RAN: out.gesturePhases,
    heldAssetStatus: out.heldAssets,
    pointLights: {
      boot: `${out.lightsAtBoot.pointVisible}/${out.lightsAtBoot.pointTotal} visible`,
      afterLock: `${out.lightsAfterPointerLock.pointVisible}/${out.lightsAfterPointerLock.pointTotal}`,
      withMop: `${out.lightsWithMop.pointVisible}/${out.lightsWithMop.pointTotal}`,
    },
    mopGeometryBeforeEquip: out.mopBeforeEquip.length,
    mopGeometryAfterEquip: out.mopAfterEquip.length,
    mopBefore: out.mopBeforeEquip.slice(0, 6),
    mopAfter: out.mopAfterEquip.slice(0, 6),
  };
  fs.writeFileSync(path.join(OUT, 'gesture-warm.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('GESTURE-WARM', JSON.stringify(out.summary, null, 2));
  return out;
}
