// IS THE SECOND BUILDING ACTUALLY GONE? Asked of the running game, not the diff.
//
// The removal deleted a putModel call, so the check is the NETWORK: the GLB
// must never be requested. That gate was watched flipping — 1 request with
// the placement restored, 0 with it removed, same layout, same seed.
//
// The mesh census below is EVIDENCE, NOT A VERDICT: it matched an unnamed
// boulder-sized bystander at the spot on both builds, so it cannot testify
// alone. In the pinned v2 layout the house also stood entirely inside the
// forest — which is presumably how a second clubhouse survived on the map
// for months without any QA frame catching it; the owner's own layout put
// it in the open.
//
//   QA_TAG=before|after node tools/qa/run-electron.cjs tools/qa/tripo-house-gone.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/tripo-house';
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'shot';
  const failures = [];

  const requested = [];
  page.on('request', (r) => {
    if (/clubhouse_ext(_opt)?\.glb/i.test(r.url())) requested.push(r.url());
  });

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const placed = await page.evaluate(() => {
    const fw = window.__fw;
    const st = fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    if ('speedIdx' in st) st.speedIdx = 0;
    // The TRUE placement, found by scene traversal on the restored build: an
    // unnamed building-scale mesh (bounding radius 12.9) at world (396, -168)
    // — the far side of the property, 750 m from the clubhouse, which is why
    // a frame aimed near the clubhouse could never see it come or go.
    const spot = { x: 396, z: -168 };
    // every mesh near the spot, so "gone" is a statement about geometry
    const near = [];
    if (spot) {
      fw.scene3d.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.updateWorldMatrix(true, false);
        const e = o.matrixWorld.elements;
        const dx = e[12] - spot.x; const dz = e[14] - spot.z;
        if (dx * dx + dz * dz < 8 * 8) near.push(o.name || o.parent?.name || '(unnamed)');
      });
      const w = fw.scene3d.walk.state;
      w.x = spot.x + 18; w.z = spot.z + 15;
      w.yaw = Math.atan2(spot.x - w.x, -(spot.z - w.z));
      w.pitch = 0.02;
    }
    return { spot, nearMeshes: near.slice(0, 30), nearCount: near.length };
  });
  await page.waitForTimeout(2200);
  const file = `${OUT}/${tag}-true-spot.png`;
  await page.screenshot({ path: file });

  console.log(`structures[0] spot: ${JSON.stringify(placed.spot)}`);
  console.log(`meshes within 8 yd: ${placed.nearCount} ${JSON.stringify(placed.nearMeshes.slice(0, 8))}`);
  console.log(`network requests for the GLB: ${requested.length} ${JSON.stringify(requested)}`);
  console.log(`screenshot: ${file}`);

  if (process.env.QA_TAG === 'after' && requested.length) {
    failures.push(`the removed GLB was still requested: ${requested.join(', ')}`);
  }
  for (const f of failures) console.log('FAIL:', f);
  console.log(`failures: ${failures.length}`);
  return { placed, requested, file, failures };
}
