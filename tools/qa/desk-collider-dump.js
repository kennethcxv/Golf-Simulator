// C5 — WHICH colliders seal the west end of the staff strip.
// walk.colliders is the read-only list the clubhouse and the facilities register
// into; naming the owners is the difference between moving the right box and
// nudging six datums until the map looks better.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/desk-map');
  fs.mkdirSync(OUT, { recursive: true });

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  const dump = await page.evaluate(async () => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const origin = app.scene3d.clubhouse().interior.position;
    const band = { minX: 0.2, maxX: 3.2, minZ: 3.5, maxZ: 5.6 };
    const out = [];
    for (const [group, list] of Object.entries(walk.colliders)) {
      for (const c of list) {
        // colliders are either {x,z,r} discs or {minX,maxX,minZ,maxZ} boxes,
        // in WORLD space; convert back to interior-local to compare with layout.
        const box = ('minX' in c)
          ? { minX: c.minX - origin.x, maxX: c.maxX - origin.x, minZ: c.minZ - origin.z, maxZ: c.maxZ - origin.z }
          : { minX: c.x - c.r - origin.x, maxX: c.x + c.r - origin.x, minZ: c.z - c.r - origin.z, maxZ: c.z + c.r - origin.z };
        if (box.maxX < band.minX || box.minX > band.maxX) continue;
        if (box.maxZ < band.minZ || box.minZ > band.maxZ) continue;
        out.push({
          group,
          kind: 'minX' in c ? 'box' : 'disc',
          local: {
            minX: +box.minX.toFixed(3), maxX: +box.maxX.toFixed(3),
            minZ: +box.minZ.toFixed(3), maxZ: +box.maxZ.toFixed(3),
          },
          tag: c.tag || c.name || c.id || null,
        });
      }
    }
    return {
      counts: Object.fromEntries(Object.entries(walk.colliders).map(([k, v]) => [k, v.length])),
      inBand: out.sort((a, b) => a.local.minX - b.local.minX),
    };
  });

  fs.writeFileSync(path.join(OUT, 'colliders.json'), `${JSON.stringify(dump, null, 2)}\n`);
  return dump;
}
