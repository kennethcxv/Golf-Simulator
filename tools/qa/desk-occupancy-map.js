// C5 — an ASCII occupancy map of the desk band, so the shape of the seal is read
// off the running build instead of reconstructed from six datums in three files.
//
// Two radii, because they answer different questions:
//   r=0.02  where the SOLIDS actually are
//   r=0.34  where a PLAYER can actually stand
// A gap that is solid-free but player-blocked is the sub-capsule class that has
// bitten this room twice.
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

  const map = await page.evaluate(async () => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const origin = app.scene3d.clubhouse().interior.position;
    const X0 = -2.6; const X1 = 6.4; const Z0 = 2.4; const Z1 = 5.6; const S = 0.10;
    const render = (r) => {
      const rows = [];
      for (let z = Z1; z >= Z0 - 1e-9; z -= S) {
        let row = '';
        for (let x = X0; x <= X1 + 1e-9; x += S) {
          row += walk.isFree(x + origin.x, z + origin.z, r) ? '.' : '#';
        }
        rows.push(`z=${z.toFixed(2).padStart(5)} ${row}`);
      }
      const ruler = `        ${Array.from({ length: Math.round((X1 - X0) / S) + 1 }, (_, i) => {
        const x = X0 + i * S;
        return Math.abs(x - Math.round(x)) < S / 2 ? String(Math.round(x)).slice(-1) : ' ';
      }).join('')}`;
      return [...rows, ruler].join('\n');
    };
    return { solids: render(0.02), player: render(0.34), origin: { x: origin.x, z: origin.z } };
  });

  fs.writeFileSync(path.join(OUT, 'solids.txt'), `${map.solids}\n`);
  fs.writeFileSync(path.join(OUT, 'player.txt'), `${map.player}\n`);
  return { wrote: 'qa/electron/desk-map', origin: map.origin };
}
