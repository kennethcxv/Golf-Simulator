// GOAL 30 LEVER B — WHO still pays updateMatrix: per-subtree auto-matrix
// counts under the interior, the exterior group and the scene root, sorted.
// Pure census (no timing), valid on any machine.
//   node tools/qa/run-electron.cjs tools/qa/goal30-matrix-owners.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-draws');
  fs.mkdirSync(OUT, { recursive: true });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(10000);

  const out = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const autoCount = (root) => {
      let n = 0;
      root.traverse((o) => { if (o !== root && o.matrixAutoUpdate) n += 1; });
      return n;
    };
    const breakdown = (root, depth) => root.children
      .map((c) => ({
        name: c.name || `(${c.type})`,
        auto: autoCount(c) + (c.matrixAutoUpdate ? 1 : 0),
        children: depth > 1 && c.children.length > 3 ? breakdown(c, depth - 1).slice(0, 8) : undefined,
      }))
      .filter((r) => r.auto > 10)
      .sort((a, b) => b.auto - a.auto);
    const sceneRows = s3.scene.children.map((c) => ({
      name: c.name || `(${c.type})`,
      auto: autoCount(c) + (c.matrixAutoUpdate ? 1 : 0),
    })).filter((r) => r.auto > 10).sort((a, b) => b.auto - a.auto);
    return {
      sceneTotalAuto: autoCount(s3.scene),
      interiorAuto: autoCount(ch.interior),
      sceneRows: sceneRows.slice(0, 14),
      interiorRows: breakdown(ch.interior, 2).slice(0, 20),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(OUT, 'g30-matrix-owners.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
