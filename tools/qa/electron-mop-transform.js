// PLAYTEST 5 — IS THE MOP HEAD ATTACHED TO THE SHAFT?
//
// The owner looked at mop-bisect-c and saw the strand ring floating LEFT of and
// BELOW the red hub, attached to nothing. If that is right then it is a transform
// bug, not a proportion, and it voids the whole bisection: all five points
// measured hem width and drop on geometry that was not where the hub is.
//
// I reported "the head reads as a ring, you can see through the middle" from those
// same frames. A ring of strands sitting away from its hub looks exactly like a
// sparse head from the front, and I read it as sparseness. So this measures rather
// than looks:
//
//   the strand rig root, the collar layer, the hem beads, the hub, the pad --
//   all as WORLD positions, plus the offsets between them.
//
// If the rig root and the hub agree to within a millimetre or two the owner and I
// are both wrong and it is genuinely a coverage problem. If they do not, the
// number says by how much and in which direction.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mop-transform.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-transform');
  fs.mkdirSync(OUT, { recursive: true });
  const libPath = `${process.cwd()}/tools/qa/lib/tool-photo.mjs`.replace(/\\/g, '/');
  const { photographTool, lightTheRoom } = await import(`file:///${libPath}`);
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await lightTheRoom(page);
  await page.waitForTimeout(1200);

  const shot = await photographTool(page, 'mop', path.join(OUT, 'mop-transform.png'), { pitch: -0.62 });
  console.log('SHOT', JSON.stringify(shot));

  out.transform = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene = window.__fw.scene3d.scene;
    const found = {};
    scene.traverse((o) => {
      if (!o.name) return;
      if (['MopVerletRig', 'MopVerletLayer_0', 'MopVerletTips', 'MESH_MopHub', 'MESH_MopPad',
        'MESH_MopHubRim', 'MESH_MopCollar', 'Tool_mop'].includes(o.name) && !found[o.name]) found[o.name] = o;
    });
    const world = (o) => {
      if (!o) return null;
      o.updateWorldMatrix(true, false);
      const v = o.getWorldPosition(new THREE.Vector3());
      return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
    };
    // The instanced layers put every strand at its own matrix, so the layer's own
    // world position says nothing about where the strands ARE. The mean of the
    // instance translations, taken into world space, is what the eye sees.
    const instanceCentre = (mesh) => {
      if (!mesh || !mesh.count) return null;
      mesh.updateWorldMatrix(true, false);
      const m = mesh.instanceMatrix.array;
      let sx = 0; let sy = 0; let sz = 0;
      for (let i = 0; i < mesh.count; i += 1) {
        sx += m[i * 16 + 12]; sy += m[i * 16 + 13]; sz += m[i * 16 + 14];
      }
      const local = new THREE.Vector3(sx / mesh.count, sy / mesh.count, sz / mesh.count);
      const w = local.clone().applyMatrix4(mesh.matrixWorld);
      return { local: [+local.x.toFixed(4), +local.y.toFixed(4), +local.z.toFixed(4)],
        world: [+w.x.toFixed(4), +w.y.toFixed(4), +w.z.toFixed(4)] };
    };
    const hub = world(found.MESH_MopHub);
    const rig = world(found.MopVerletRig);
    const collar = instanceCentre(found.MopVerletLayer_0);
    const tips = instanceCentre(found.MopVerletTips);
    const gap = (a, b) => (a && b
      ? { dx: +(a[0] - b[0]).toFixed(4), dy: +(a[1] - b[1]).toFixed(4), dz: +(a[2] - b[2]).toFixed(4),
        distance: +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4) }
      : null);
    return {
      present: Object.keys(found),
      hub,
      pad: world(found.MESH_MopPad),
      rigRoot: rig,
      rigParent: found.MopVerletRig?.parent?.name || found.MopVerletRig?.parent?.type || null,
      hubParent: found.MESH_MopHub?.parent?.name || found.MESH_MopHub?.parent?.type || null,
      collarInstanceCentre: collar,
      tipInstanceCentre: tips,
      // THE NUMBERS THAT DECIDE IT
      rigRootVsHub: gap(rig, hub),
      collarVsHub: gap(collar?.world, hub),
      tipsVsHub: gap(tips?.world, hub),
    };
  });
  console.log('TRANSFORM', JSON.stringify(out.transform, null, 2));

  const g = out.transform.collarVsHub;
  out.verdict = {
    strandsAttachedToHub: g ? g.distance < 0.03 : null,
    collarOffsetFromHub: g ? g.distance : null,
    offsetDirection: g ? `dx ${g.dx} dy ${g.dy} dz ${g.dz}` : null,
    bisectionValid: g ? g.distance < 0.03 : null,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('MOP-TRANSFORM', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'mop-transform.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
