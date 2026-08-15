// PLAYTEST 5, ITEM 6.1 — DID THE AUTHORED HAND ACTUALLY REPLACE THE CAPSULES?
//
// "Wire it in REPLACING the procedural build rather than sitting beside it."
// Two things have to be true and they are different claims:
//
//   ADOPTED   every joint that has an authored counterpart is drawing the
//             authored geometry. Counted, not assumed -- a part missing from the
//             GLB would leave one capsule among fifteen authored segments, which
//             is the kind of thing a frame hides.
//   REPLACED  the capsule geometry is GONE, not hidden behind the new part. The
//             check is the vertex count of the live geometry: the authored
//             segments carry hundreds of vertices, a CapsuleGeometry carries a
//             few dozen, so "still a capsule" is a number.
//
// Then it photographs the hand on the shaft at the default player camera, using
// the settled-and-re-asserted recipe, so the model can be judged beside the
// reference rather than trusted.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-hands-authored.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/hands');
  fs.mkdirSync(OUT, { recursive: true });
  const libPath = `${process.cwd()}/tools/qa/lib/tool-photo.mjs`.replace(/\\/g, '/');
  const { photographTool } = await import(`file:///${libPath}`);
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);

  // The hands only exist once a tool that wants them is held.
  out.shot = await photographTool(page, 'broom', path.join(OUT, 'hands-authored.png'));
  console.log('SHOT', JSON.stringify(out.shot));

  out.adopt = await page.evaluate(() => ({ adopt: window.__fwHandAdopt ?? null, load: window.__fwHandLoad ?? null, builds: window.__fwHandBuild ?? null })); for (const k of ['fpHands','hands']) { const h = s3[k]; if (h?.authoredHandDiagnostics) return h.authoredHandDiagnostics(); } return null; })());
  console.log('ADOPT', JSON.stringify(out.adopt));

  out.parts = await page.evaluate(() => {
    const app = window.__fw;
    const WANT = ['Palm', 'Forearm', 'ThumbProx', 'ThumbDist'];
    for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
      for (const seg of ['Prox', 'Mid', 'Dist']) WANT.push(`${f}${seg}`);
    }
    const rows = [];
    let nailsVisible = 0;
    app.scene3d.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'FingerNail' && o.visible) nailsVisible += 1;
    });
    // The hand parts are not all NAMED in the runtime hierarchy (only some are),
    // so they are found by walking the first-person hand root and reading the
    // geometry each mesh is actually drawing.
    let handRoot = null;
    app.scene3d.scene.traverse((o) => { if (!handRoot && o.name === 'FirstPersonRightHand') handRoot = o; });
    if (handRoot) {
      handRoot.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry;
        // The PARENT CHAIN, not just the mesh name. The unswapped capsules are
        // unnamed, so "4 capsules left" was untraceable from names alone -- but
        // the chain says which joint each one hangs from, which is the same
        // question. No accessor needed; the scene graph already knows.
        const chain = [];
        for (let at = o.parent, i = 0; at && i < 5; at = at.parent, i += 1) {
          chain.push(at.name || at.type);
        }
        rows.push({
          name: o.name || '(unnamed)',
          type: g.type,
          vertices: g.attributes?.position?.count ?? 0,
          visible: o.visible,
          chain,
          pos: [+o.position.x.toFixed(4), +o.position.y.toFixed(4), +o.position.z.toFixed(4)],
        });
      });
    }
    return { rows, nailsVisible, want: WANT.length };
  });

  const capsules = out.parts.rows.filter((r) => /Capsule/i.test(r.type) && r.visible);
  const authored = out.parts.rows.filter((r) => r.type === 'BufferGeometry' && r.vertices > 150 && r.visible);
  out.verdict = {
    handMeshesDrawn: out.parts.rows.filter((r) => r.visible).length,
    authoredSegments: authored.length,
    capsuleSegmentsLeft: capsules.length,
    capsuleNames: capsules.map((c) => `${c.name}:${c.vertices}`).slice(0, 6),
    nailsStillVisible: out.parts.nailsVisible,
    photographedWith: out.shot.toolAtShot,
    drawableAtShot: out.shot.drawableAtShot,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('HANDS-AUTHORED', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'hands.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
