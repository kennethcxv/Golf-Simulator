// 7.1 (Goal 26) — MEASURE THE DRAW CALLS AGAIN FIRST.
//
// "Named in Goal 23, Goal 24 and Goal 25. Never started. Last measured: 574 draw
// calls standing, 942 peak, 838 static meshes, 290 materials -- MEASURE AGAIN
// FIRST."
//
// So this measures, and it does not merge anything. The target is stated as a
// percentage of the standing and peak figures, and a percentage of a stale
// baseline is a number about a build nobody is running.
//
// WHAT IT COUNTS, and why each is separate:
//   drawCalls standing   the player stood still indoors, which is the number the
//                        30% target is against
//   drawCalls peak       swept through headings and positions, because "peak" is
//                        whatever the worst view costs, not an average
//   static visual meshes classified the way 7.1 asks -- static visual,
//                        interactive, animated, skinned -- so the merge candidate
//                        pool is a real number rather than "838 meshes"
//   materials            what the merge is per, so the ceiling on how much
//                        merging can possibly buy is visible up front
//
// A scene-graph count is NOT a draw call, and this repository has already been
// caught by that (batched props draw via layers.mask, so a graph walk measures
// geometry that never draws). The draw figures here come from
// renderer.info.render.calls AFTER a real frame, not from counting meshes.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-phase7-drawcalls.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/phase7-drawcalls');
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

  // STANDING, INDOORS — the pose the 574 baseline was taken at.
  out.standing = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    w.x = c.x; w.z = c.z; w.vx = 0; w.vz = 0; w.yaw = 0; w.pitch = 0;
    await new Promise((done) => setTimeout(done, 1200));
    const info = s3.renderer.info;
    return {
      inside: ch.isInside(w.x, w.z),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? null,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  });
  console.log('STANDING', JSON.stringify(out.standing));

  // PEAK — sweep headings and a ring of positions, keep the worst frame.
  out.peak = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    let worst = { drawCalls: 0 };
    for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [12, 12], [-12, -12]]) {
      for (let step = 0; step < 8; step += 1) {
        w.x = c.x + dx; w.z = c.z + dz; w.vx = 0; w.vz = 0;
        w.yaw = (step / 8) * Math.PI * 2; w.pitch = 0;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((done) => setTimeout(done, 140));
        const info = s3.renderer.info;
        if (info.render.calls > worst.drawCalls) {
          worst = {
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            at: `${dx},${dz}`,
            yawDeg: Math.round((step / 8) * 360),
            inside: ch.isInside(w.x, w.z),
          };
        }
      }
    }
    return worst;
  });
  console.log('PEAK', JSON.stringify(out.peak));

  // THE MERGE CANDIDATE POOL, classified the way 7.1 asks for.
  out.classified = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const counts = {
      total: 0, staticVisual: 0, skinned: 0, instanced: 0, animated: 0,
      collisionOnly: 0, interactive: 0, hidden: 0,
    };
    const materials = new Set();
    s3.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
      counts.total += 1;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) materials.add(m.uuid);
      if (!o.visible) { counts.hidden += 1; return; }
      if (o.isSkinnedMesh) { counts.skinned += 1; return; }
      if (o.isInstancedMesh) { counts.instanced += 1; return; }
      if (o.userData?.collisionOnly || /collider|collision/i.test(o.name || '')) {
        counts.collisionOnly += 1; return;
      }
      if (o.userData?.pick || o.userData?.station || o.userData?.checkoutUid) {
        counts.interactive += 1; return;
      }
      // anything whose world matrix is driven every frame is not mergeable
      if (o.matrixAutoUpdate && o.parent && /Tool_|Held|Customer|Character/i.test(o.parent.name || '')) {
        counts.animated += 1; return;
      }
      counts.staticVisual += 1;
    });
    return { ...counts, materials: materials.size };
  });
  console.log('CLASSIFIED', JSON.stringify(out.classified));

  const BASE = { standing: 574, peak: 942, staticMeshes: 838, materials: 290 };
  out.verdict = {
    baselineFromBrief: BASE,
    nowStanding: out.standing.drawCalls,
    nowPeak: out.peak.drawCalls,
    nowStaticVisual: out.classified.staticVisual,
    nowMaterials: out.classified.materials,
    standingVsBaseline: `${out.standing.drawCalls} vs ${BASE.standing}`,
    peakVsBaseline: `${out.peak.drawCalls} vs ${BASE.peak}`,
    // 7.1's targets, stated against the numbers measured TODAY
    target30pcStanding: Math.round(out.standing.drawCalls * 0.7),
    target25pcPeak: Math.round(out.peak.drawCalls * 0.75),
  };
  console.log('PHASE7-DRAWCALLS', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'drawcalls.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
