// B2 probe — HOW BIG IS THE BLOCK, REALLY?
//
// The player-camera crop shows the bristle field spanning roughly 60% of the
// block's width, with daylight either side and between neighbours. The bristle
// layout is driven by hand-written barWidth/barDepth constants in
// toolViewmodel.js, and nothing has ever checked them against the block they
// are supposed to fill. This measures the authored block in the SAME local
// space the strand rig root lives in, so the constants can be replaced with the
// real numbers instead of a better guess.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b2-broomhead');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(7000);

  out.bounds = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const group = s3.scene.getObjectByName('Tool_broom');
    if (!group) return { found: false };
    const contact = group.getObjectByName('SOCKET_FloorContact');
    const rigRoot = group.getObjectByName('MopStrandRig');
    const named = (n) => group.getObjectByName(n) || null;
    // Box3 is not exported on window, so build the bounds by hand from the
    // geometry's own bounding box pushed through each mesh's matrix relative to
    // the strand rig's PARENT - the space the tuft positions are written in.
    const parent = rigRoot?.parent || contact?.parent || null;
    const measure = (mesh) => {
      if (!mesh?.geometry) return null;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const V = Object.getPrototypeOf(mesh.position).constructor;
      const corners = [];
      for (const x of [bb.min.x, bb.max.x]) {
        for (const y of [bb.min.y, bb.max.y]) {
          for (const z of [bb.min.z, bb.max.z]) corners.push(new V(x, y, z));
        }
      }
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const c of corners) {
        mesh.localToWorld(c);
        if (parent) parent.worldToLocal(c);
        lo[0] = Math.min(lo[0], c.x); hi[0] = Math.max(hi[0], c.x);
        lo[1] = Math.min(lo[1], c.y); hi[1] = Math.max(hi[1], c.y);
        lo[2] = Math.min(lo[2], c.z); hi[2] = Math.max(hi[2], c.z);
      }
      return {
        min: lo.map((v) => +v.toFixed(4)),
        max: hi.map((v) => +v.toFixed(4)),
        size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]].map((v) => +v.toFixed(4)),
        centre: [(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2].map((v) => +v.toFixed(4)),
      };
    };
    return {
      found: true,
      parentName: parent?.name || '(none)',
      block: measure(named('MESH_BroomBlock')),
      blockCap: measure(named('MESH_BroomBlockCap')),
      bristleSeat: measure(named('MESH_BroomBristleSeat')),
      // the authored bristle slab, hidden but still the shape the artist drew
      authoredBristles: measure(named('MESH_BroomBristles')),
      ferrule: measure(named('MESH_BroomFerrule')),
      rigRootPos: rigRoot ? [rigRoot.position.x, rigRoot.position.y, rigRoot.position.z]
        .map((v) => +v.toFixed(4)) : null,
      contactPos: contact ? [contact.position.x, contact.position.y, contact.position.z]
        .map((v) => +v.toFixed(4)) : null,
    };
  });

  fs.writeFileSync(path.join(OUT, 'b2-bounds.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B2BOUNDS', JSON.stringify(out.bounds, null, 1));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
