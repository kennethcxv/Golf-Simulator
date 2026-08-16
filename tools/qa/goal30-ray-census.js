// GOAL 30 — what the spawn camera actually sees, ray by ray, with freeze
// state. Ends the guessing about watched-fail subject selection.
//   node tools/qa/run-electron.cjs tools/qa/goal30-ray-census.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(
    () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
    null, { timeout: 180000 },
  );
  await page.waitForTimeout(1500);
  const out = await page.evaluate(async () => {
    const THREE = await import('three');
    const s3 = window.__fw.scene3d;
    const rc = new THREE.Raycaster();
    rc.camera = s3.camera;
    const rows = [];
    for (const ny of [0.4, 0.1, -0.2, -0.5]) {
      for (const nx of [-0.5, 0, 0.5]) {
        rc.setFromCamera(new THREE.Vector2(nx, ny), s3.camera);
        let hits = [];
        try {
          hits = rc.intersectObjects(s3.scene.children, true)
            .filter((h) => h.object.visible && h.object.layers.mask !== 0);
        } catch { /* sprite guard */ }
        const h = hits[0];
        rows.push(h ? {
          ndc: [nx, ny],
          name: h.object.name || h.object.type,
          dist: +h.distance.toFixed(1),
          frozen: !!h.object.userData?.matrixFrozen,
          auto: h.object.matrixAutoUpdate,
          instanced: !!h.object.isInstancedMesh,
        } : { ndc: [nx, ny], name: null });
      }
    }
    const diag = s3.matrixFreezeDiagnostics();
    return { rows, diag };
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}
