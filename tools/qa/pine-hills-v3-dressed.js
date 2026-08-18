// THE DRESSED COPY OF THE GREYBOX — is it the same room with the real assets?
//
// "Start making edits in a copy of the gray box with the newly updated blender
// assets." pine-hills-v2 is the working variant and CLAUDE.md says it stays
// grey, so v3 is where raising it is allowed. Two things have to be true and
// they pull in opposite directions:
//
//   1. IT IS THE SAME ROOM. Same floor plan, same datums, same colliders, same
//      queue. If v3 moved anything, dressing it could break v2 — which is the
//      one thing this must never do.
//   2. IT IS NOT THE SAME PICTURE. The grey retail volumes are gone and the
//      real fixtures, with the baked garments on them, are what you see.
//
// ...and one thing has to STAY grey: the front desk. Its hero replacement came
// out of the v5 hardgoods line with img 0 and no COLOR_0, so it never went
// through the v7 bake and dressing it would ship flat colour.
//
// Run it on BOTH rooms and diff:
//   QA_TAG=v3 node tools/qa/run-electron.cjs tools/qa/pine-hills-v3-dressed.js --clubhouse=pine-hills-v3
//   QA_TAG=v2 node tools/qa/run-electron.cjs tools/qa/pine-hills-v3-dressed.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/pine-hills-v3');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(2000);

  // WHICH ROOM DID IT BUILD, AND ON WHOSE NUMBERS?
  out.build = await page.evaluate(async () => {
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = window.__fw.scene3d.clubhouse();
    const log = ch.buildLog ? ch.buildLog() : (window.__fw.scene3d.clubhouseBuildLog?.() || null);
    return {
      requested: layout.CLUBHOUSE_VARIANT_REQUEST?.variant ?? null,
      layoutVariant: layout.CLUBHOUSE_LAYOUT_VARIANT ?? null,
      buildLog: log,
      // the datums that would break v2 if v3 moved them
      counter: { x: +layout.COUNTER.x.toFixed(4), z: +layout.COUNTER.z.toFixed(4), ry: +layout.COUNTER.ry.toFixed(6) },
      register: { x: +layout.REGISTER.stand.x.toFixed(4), z: +layout.REGISTER.stand.z.toFixed(4) },
      queue: [0, 1, 2, 3, 4, 5].map((i) => {
        const s = layout.queueSlot(i);
        return { x: +s.x.toFixed(4), z: +s.z.toFixed(4) };
      }),
      roomBounds: layout.PUBLIC_ROOM_BOUNDS,
    };
  });
  console.log(`requested=${out.build.requested} layout=${out.build.layoutVariant}`);

  // WHAT IS ACTUALLY DRAWN. Grey volumes carry GREY_ names by contract, so the
  // count of VISIBLE ones is the whole difference between the two rooms.
  out.scene = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const grey = [];
    const hero = [];
    const visibleUp = (o) => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
    ch.interior.traverse((o) => {
      const name = o.name || '';
      if (/^GREY_/.test(name) && visibleUp(o)) grey.push(name);
      if (/^hero_|apparel_|Polo|Hoodie|Cap|Towel|Trouser|Tee/i.test(name) && o.isMesh && visibleUp(o)) {
        hero.push(name);
      }
    });
    return {
      greyVisible: grey.sort(),
      greyCount: grey.length,
      heroMeshes: [...new Set(hero)].slice(0, 40),
      heroCount: hero.length,
      // the three roots the dressed copy stands down, by name
      fixtureVolumesVisible: !!ch.interior.getObjectByName('GreyboxFixtureVolumes')?.visible,
      loungeVolumesVisible: !!ch.interior.getObjectByName('GreyboxLounge')?.visible,
      boardVolumesVisible: !!ch.interior.getObjectByName('GreyboxWallBoards')?.visible,
      // ...and the one it does NOT
      frontDeskVisible: !!ch.interior.getObjectByName('GreyboxFrontDesk')?.visible,
    };
  });
  console.log(`grey volumes visible: ${out.scene.greyCount} `
    + `(fixtures=${out.scene.fixtureVolumesVisible} lounge=${out.scene.loungeVolumesVisible} `
    + `boards=${out.scene.boardVolumesVisible} frontDesk=${out.scene.frontDeskVisible})`);
  console.log(`hero/apparel meshes drawn: ${out.scene.heroCount}`);

  // THE FRONT DESK STAYS GREY, in both rooms. Stated as a check, not a hope.
  if (!out.scene.frontDeskVisible) {
    fail('the front desk grey volume is NOT drawn — the counter has no baked asset '
      + 'and must not be dressed until Block 5');
  }

  // Stand on the retail floor and photograph it at the default player camera.
  await page.evaluate(async () => {
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    app.speedIdx = 0;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
    const off = ch.interior.position;
    const walk = app.scene3d.walk.state;
    // STAND WHERE A SHOPPER STANDS, IN FRONT OF THE THING THIS IS ABOUT. The
    // room centre looking at the door photographs the entrance, not the retail
    // floor, and the whole point of the dressed copy is the retail floor: the
    // baked garments were previously photographed in the STOCKROOM because
    // every fixture that carries them is inside a grey box on v2.
    const sim = await import(new URL('src/sim/layout.js', document.baseURI).href);
    const fixtures = sim.placedFixtures(app.state) || [];
    const want = fixtures.find((f) => /apparel/i.test(f.id))
      || fixtures.find((f) => f.kind === 'apparelwall' || f.kind === 'rail')
      || fixtures.find((f) => f.kind === 'shelf');
    window.__v3Fixture = want ? { id: want.id, kind: want.kind, x: want.x, z: want.z, ry: want.ry } : null;
    if (want) {
      // three yards out along the fixture's facing
      const fx = Math.sin(want.ry || 0);
      const fz = Math.cos(want.ry || 0);
      walk.x = want.x + fx * 3.0 + off.x;
      walk.z = want.z + fz * 3.0 + off.z;
      const dx = (want.x + off.x) - walk.x;
      const dz = (want.z + off.z) - walk.z;
      const h = Math.hypot(dx, dz) || 1;
      walk.yaw = Math.atan2(-dx / h, -dz / h);
      walk.pitch = -0.05;
    } else {
      const b = layout.PUBLIC_ROOM_BOUNDS;
      walk.x = ((b.minX + b.maxX) / 2) + off.x;
      walk.z = ((b.minZ + b.maxZ) / 2) + off.z + 1.6;
      walk.yaw = Math.PI;
      walk.pitch = 0;
    }
  });
  out.framedFixture = await page.evaluate(() => window.__v3Fixture || null);
  console.log(`framed on: ${JSON.stringify(out.framedFixture)}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${tag}-retail-floor.png`) });
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw = 0; });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, `${tag}-opposite.png`) });

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nfailures ${out.failures.length} · evidence qa/pine-hills-v3/${tag}.json`);
}
