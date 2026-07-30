async (page) => {
  // Measure MESH_WindowWest_CreamCasing's real world box in both variants, plus its parent
  // chain and visibility — the inputs the analytic collider needs. Scratch probe for C5.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
  };

  const measure = () => page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const origin = ch.center;
    const found = [];
    app.scene3d.scene.traverse((node) => {
      if (/CreamCasing/.test(node.name || '')) {
        const box = new THREE.Box3().setFromObject(node);
        const chain = [];
        for (let p = node; p; p = p.parent) chain.push(`${p.name || p.type}${p.visible === false ? '[hidden]' : ''}`);
        found.push({
          name: node.name,
          visibleChain: chain.slice(0, 6),
          worldBox: {
            minX: +box.min.x.toFixed(3), maxX: +box.max.x.toFixed(3),
            minY: +box.min.y.toFixed(3), maxY: +box.max.y.toFixed(3),
            minZ: +box.min.z.toFixed(3), maxZ: +box.max.z.toFixed(3),
          },
          localBox: {
            minX: +(box.min.x - origin.x).toFixed(3), maxX: +(box.max.x - origin.x).toFixed(3),
            minZ: +(box.min.z - origin.z).toFixed(3), maxZ: +(box.max.z - origin.z).toFixed(3),
          },
        });
      }
    });
    const floorY = ch.interior.getWorldPosition(new THREE.Vector3()).y;
    const L = await import('/src/data/shopLayout.js');

    // THE QUESTION THE RULING RESTS ON: standing at the front wall plane, where can a body
    // actually be? A transect at 2 cm steps across x, at three z rows — ON the wall plane,
    // just outside it, and a body-radius outside. Free spans west of the wall's outer corner
    // are lawn, not holes; free spans WITHIN the wall's x-range are real walk-throughs.
    const walk = app.scene3d.walk;
    const rows = {};
    for (const [rowName, lz] of [['onWallPlane', 5.68], ['justOutside', 6.05], ['bodyOutside', 6.4]]) {
      const blocked = [];
      let run = null;
      for (let lx = -11; lx <= -5.5; lx += 0.02) {
        const free = walk.isFree(origin.x + lx, origin.z + lz);
        if (!free) {
          if (!run) run = { from: +lx.toFixed(2) };
          run.to = +lx.toFixed(2);
        } else if (run) { blocked.push(run); run = null; }
      }
      if (run) blocked.push(run);
      rows[rowName] = blocked;
    }

    // …and the visible west-front casing specifically: sample its own XZ box the way the
    // sweep samples, and report the walkable fraction. This is the mesh the player SEES.
    const visibleWest = found.find((f) => f.name === 'MESH_WindowStandard_LayeredCreamCasing'
      && !f.visibleChain.some((c) => c.includes('[hidden]'))
      && f.localBox.minX < -6 && f.localBox.minZ > 5);
    let visibleWestWalkable = null;
    if (visibleWest) {
      const b = visibleWest.localBox;
      let total = 0;
      let free = 0;
      for (let lx = b.minX + 0.02; lx < b.maxX; lx += 0.05) {
        for (let lz = b.minZ + 0.01; lz < b.maxZ; lz += 0.04) {
          total += 1;
          if (walk.isFree(origin.x + lx, origin.z + lz)) free += 1;
        }
      }
      visibleWestWalkable = { samples: total, free, fraction: +(free / total).toFixed(3), box: b };
    }

    // The hidden asset-51 casing's own box, same sampling — reproducing the sweep's 37.5%
    // so the two numbers can sit side by side.
    const hiddenWest = found.find((f) => f.name === 'MESH_WindowWest_CreamCasing');
    let hiddenWestWalkable = null;
    if (hiddenWest) {
      const b = hiddenWest.localBox;
      let total = 0;
      let free = 0;
      const freeAt = [];
      for (let lx = b.minX + 0.02; lx < b.maxX; lx += 0.05) {
        for (let lz = b.minZ + 0.01; lz < b.maxZ; lz += 0.04) {
          total += 1;
          if (walk.isFree(origin.x + lx, origin.z + lz)) {
            free += 1;
            if (freeAt.length < 6) freeAt.push({ x: +lx.toFixed(2), z: +lz.toFixed(2) });
          }
        }
      }
      hiddenWestWalkable = { samples: total, free, fraction: +(free / total).toFixed(3), box: b, freeAt };
    }

    return {
      origin: { x: +origin.x.toFixed(3), z: +origin.z.toFixed(3) },
      floorY: +floorY.toFixed(3),
      shell: { w: L.SHELL.w, d: L.SHELL.d, halfW: L.SHELL.w / 2, halfD: L.SHELL.d / 2 },
      wallTransect: rows,
      visibleWestWalkable,
      hiddenWestWalkable,
      found,
    };
  });

  const out = {};
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    // eslint-disable-next-line no-await-in-loop
    await boot(variant);
    // eslint-disable-next-line no-await-in-loop
    out[variant] = await measure();
    // Look at the southwest corner from outside — the eye check on whatever the numbers say.
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const app = window.__fw;
      const st = app.scene3d.walk.state;
      const origin = app.scene3d.clubhouse().center;
      st.x = origin.x - 12.3;
      st.z = origin.z + 9.2;
      st.yaw = Math.atan2(-(-12.3 - -8.3), -(9.2 - 5.7));   // face the west window from SW
      st.pitch = 0.02;
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: path.join(outDir, `window-casing-sw-${variant}.png`) });
  }
  fs.writeFileSync(path.join(outDir, 'window-casing-measure.json'), `${JSON.stringify(out, null, 2)}\n`);
  return { ...out, ok: true };
}
