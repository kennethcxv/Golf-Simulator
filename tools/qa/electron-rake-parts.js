// PLAYTEST 3, ITEM 9 — NAME THE EXPLODED RAKE GEOMETRY.
//
// The previous instrument scanned for meshes within 2.5 yd OF THE CAMERA and
// came back with hands and distant terrain and no rake at all -- because its
// staging left the camera at world Y -1.181, under the ground, with the tool
// wherever the viewmodel had put it relative to a player who was not standing
// anywhere sensible. "Nothing near the camera" was a fact about the staging.
//
// So this stops asking about the camera. The tool viewmodel names its own root
// `Tool_${id}`, and every part of the rake is a descendant of it. Measuring each
// part AGAINST THE TOOL'S OWN ORIGIN answers "what is exploded" without needing
// the player to be anywhere in particular -- an exploded part is one sitting far
// from the tool it belongs to, and that is true in any pose.
//
// It also reports the parts' spread, because "exploded" is a claim about a
// RELATIONSHIP: a rake whose head is 0.05 from the shaft is assembled and one
// whose head is 1.2 away is not, and only the second needs fixing.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-rake-parts.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/rake-parts');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  // Equip WITHOUT teleporting. Wherever the player starts is somewhere the game
  // put them, which is more trustworthy than a coordinate I invent -- and the
  // measurement below does not care where they stand.
  out.equipped = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    s3.walk.setTool('rake');
    await new Promise((d) => setTimeout(d, 2500));
    return { tool: s3.walk.getTool?.() ?? null };
  });
  await page.waitForTimeout(2500);
  console.log('EQUIPPED', JSON.stringify(out.equipped));

  out.parts = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let toolRoot = null;
    s3.scene.traverse((o) => { if (!toolRoot && o.name === 'Tool_rake') toolRoot = o; });
    if (!toolRoot) {
      // Name every tool root that DOES exist, so "not found" is actionable
      // rather than a dead end.
      const seen = [];
      s3.scene.traverse((o) => { if (o.name && o.name.startsWith('Tool_')) seen.push(o.name); });
      return { ok: false, why: 'no Tool_rake in the scene', toolRootsPresent: seen };
    }
    toolRoot.updateWorldMatrix(true, true);
    const e0 = toolRoot.matrixWorld.elements;
    const origin = { x: e0[12], y: e0[13], z: e0[14] };
    const rows = [];
    toolRoot.traverse((o) => {
      if (!o.isMesh) return;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      if (!o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      const cx = e[0] * bs.center.x + e[4] * bs.center.y + e[8] * bs.center.z + e[12];
      const cy = e[1] * bs.center.x + e[5] * bs.center.y + e[9] * bs.center.z + e[13];
      const cz = e[2] * bs.center.x + e[6] * bs.center.y + e[10] * bs.center.z + e[14];
      const scale = Math.max(
        Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]),
      );
      const chain = [];
      for (let p = o.parent; p && p !== toolRoot.parent; p = p.parent) if (p.name) chain.push(p.name);
      rows.push({
        name: o.name || '(unnamed)',
        parents: chain.slice(0, 3),
        // THE NUMBER THAT DECIDES IT: how far this part sits from the tool it
        // belongs to. Bounding-sphere centre, not the origin, because a part
        // with an innocent origin can still have its geometry miles away.
        distFromToolOrigin: +Math.hypot(cx - origin.x, cy - origin.y, cz - origin.z).toFixed(4),
        radius: +(bs.radius * scale).toFixed(4),
        localPos: [+o.position.x.toFixed(4), +o.position.y.toFixed(4), +o.position.z.toFixed(4)],
        visible: o.visible,
        verts: o.geometry.attributes?.position?.count ?? null,
        material: Array.isArray(o.material) ? 'multi'
          : (o.material?.color ? `#${o.material.color.getHexString()}` : null),
      });
    });
    rows.sort((a, b) => b.distFromToolOrigin - a.distFromToolOrigin);
    const dists = rows.map((r) => r.distFromToolOrigin);
    return {
      ok: true,
      partCount: rows.length,
      toolRootVisible: toolRoot.visible,
      spread: dists.length ? +(Math.max(...dists) - Math.min(...dists)).toFixed(4) : null,
      furthest: dists.length ? Math.max(...dists) : null,
      rows,
    };
  });

  if (!out.parts.ok) {
    console.log('PARTS', JSON.stringify(out.parts));
  } else {
    console.log('PARTS', out.parts.partCount, 'spread', out.parts.spread, 'furthest', out.parts.furthest);
    for (const r of out.parts.rows.slice(0, 20)) console.log('  ', JSON.stringify(r));
  }

  await page.screenshot({ path: path.join(OUT, 'rake-equipped.png') });
  out.verdict = {
    equipped: out.equipped.tool,
    partCount: out.parts.partCount ?? null,
    spreadYd: out.parts.spread ?? null,
    furthestPartYd: out.parts.furthest ?? null,
    // A hand tool is under a yard long; anything sitting further than that from
    // its own tool root is not attached to it in any meaningful sense.
    partsFurtherThanAYard: (out.parts.rows || []).filter((r) => r.distFromToolOrigin > 1.0)
      .map((r) => ({ name: r.name, parents: r.parents, dist: r.distFromToolOrigin })),
  };
  console.log('RAKE-PARTS', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'rake-parts.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
