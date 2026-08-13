// PHASE 2.3 (Goal 25) — WHICH FRAME ARE CUSTOMER MESHES IN?
//
// electron-c3-nothing-through-a-body.js reads the flying product from
// mesh.matrixWorld (world) and both customers from mesh.position (parent-local).
// If customers are parented to ch.interior, every corridor number that driver has
// ever printed is drawn between two different coordinate spaces and means nothing.
// If they are parented to the scene root, .position IS world and it is accidentally
// correct.
//
// This asks the running game directly rather than inferring it from grep, and it
// does not trust the parent NAME -- it compares object identity and then measures
// the actual gap between local and world for a real body. A zero offset would make
// the identity question moot, so both are reported.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p2-frame-check.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p2-frame');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // stage a body so there is something real to measure
  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    campaign.disableCampaign(app.state);
    if (app.state.shop) { app.state.shop.open = true; app.state.shop.signOpen = true; }
    ch.sendToCounter?.(['balls1'], 'card');
  });
  await page.waitForTimeout(9000);

  out.measured = await page.evaluate(async () => {
    const THREE = await import('three');
    const ch = window.__fw.scene3d.clubhouse();
    const people = (ch.customers ? ch.customers() : []).filter((c) => c.mesh);
    if (!people.length) return { error: 'no customer to measure' };
    const c = people[0];
    const interior = ch.interior;
    c.mesh.updateWorldMatrix(true, false);
    const w = c.mesh.getWorldPosition(new THREE.Vector3());
    const local = c.mesh.position;
    // walk the ancestry so a mesh nested UNDER interior still counts as local to it
    let n = c.mesh.parent; let underInterior = false; const chain = [];
    while (n) {
      chain.push(n.name || n.type);
      if (n === interior) underInterior = true;
      n = n.parent;
    }
    return {
      parentIsInteriorExactly: c.mesh.parent === interior,
      anyAncestorIsInterior: underInterior,
      parentChain: chain.slice(0, 6),
      interiorPos: { x: +interior.position.x.toFixed(3), z: +interior.position.z.toFixed(3) },
      localPos: { x: +local.x.toFixed(3), y: +local.y.toFixed(3), z: +local.z.toFixed(3) },
      worldPos: { x: +w.x.toFixed(3), y: +w.y.toFixed(3), z: +w.z.toFixed(3) },
      // THE NUMBER THAT DECIDES IT: how far apart are the two frames, in yards?
      localToWorldGapYd: +Math.hypot(w.x - local.x, w.z - local.z).toFixed(3),
    };
  });

  const m = out.measured;
  out.verdict = m.error ? 'UNMEASURED' :
    (m.localToWorldGapYd > 0.5
      ? 'FRAMES DIFFER — the c3 corridor test mixes world and local, its numbers are void'
      : 'frames coincide — .position is effectively world, c3 is accidentally sound');
  out.ok = !m.error && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'frame.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P2-FRAME', JSON.stringify(out, null, 2));
  return out;
}
