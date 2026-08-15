async (page) => {
  // CAN THE GREYBOX ROOM BE REACHED WITHOUT A QUERY STRING?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/clubhouse-variant-no-query.js
  //
  // The unit tests pin the resolver's precedence and the launch-flag wiring. They cannot
  // prove the thing the brief actually asks for, which is that a session with NOTHING in
  // its URL builds the v2 room â€” that depends on localStorage being readable at module
  // -eval time on this origin, which is a runtime fact, not a source fact.
  //
  // THE NEGATIVE CONTROL IS STAGE A AND STAGE C, not a separate run. A probe that only
  // ever looks at the positive case cannot tell "the setting worked" from "this build
  // draws v2 no matter what" â€” which is precisely the failure mode of a variant seam.
  // So: boot clean and require v1, set the setting and require v2, clear it and require
  // v1 again. Only the middle stage may differ.
  //
  // Ground truth is geometry, not the flag. Reading CLUBHOUSE_VARIANT_REQUEST back proves
  // the resolver ran; it does not prove the room changed.
  //
  // So the room is MEASURED, from one point that is inside the public floor of both
  // variants: a ray straight up finds the ceiling, a ray west finds the west wall. Both
  // hit real geometry in v1 and in v2, so the two stages produce comparable numbers
  // rather than a present/absent flag. (The first version of this probe claimed a ceiling
  // height and reported null for it in every stage, because it asked the clubhouse for a
  // `floorY` the public API does not expose â€” the check silently degraded to "is the grey
  // ceiling there", which is the same claim as the line above it. A number that can only
  // come out null is not a measurement.)
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const STORAGE_KEY = 'golfempire:dev:clubhouse-variant';

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1280, height: 720 });

  // Seed the save and, optionally, the dev room setting â€” then load with a BARE url.
  // The order matters: the empire seed clears storage, so the variant key is written
  // after it, and the reload is the first load that can see either.
  const bootBare = async (storedVariant) => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate(async ({ seed, key, variant }) => {
      localStorage.clear();
      const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
      if (variant) localStorage.setItem(key, variant);
      else localStorage.removeItem(key);
    }, { seed: SEED, key: STORAGE_KEY, variant: storedVariant || null });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(2600);
  };

  const measure = (label) => page.evaluate(async ({ stage, key }) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const named = (name) => {
      let hit = null;
      scene.traverse((o) => { if (!hit && o.name === name) hit = o; });
      return hit;
    };
    const clubhouse = app.scene3d.clubhouse();
    // interior.position.y IS the floor top â€” clubhouse.js sets it from
    // heightAt(center) + FLOOR_TOP. (Its x/z are a scene-graph offset and must NOT be
    // used as the building origin; that is what clubhouse.center is for.)
    const floorY = clubhouse.interior.position.y;

    // Raycasting needs an explicitly collected visible-mesh set: THREE.Raycaster does
    // not skip visible=false subtrees, so suppressed production furniture would block
    // rays it cannot draw. Zero-mask meshes (the merged static batch) are excluded for
    // the same reason â€” they do not draw either.
    const targets = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.layers.mask) return;
      let node = o;
      while (node) { if (node.visible === false) return; node = node.parent; }
      targets.push(o);
    });
    const origin = clubhouse.localToWorld(2.0, 0.0); // inside the public floor of BOTH rooms
    const cast = (dir) => {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(origin.x, floorY + 1.6, origin.z),
        dir.clone().normalize(),
        0.05,
        40,
      );
      const hit = ray.intersectObjects(targets, false)[0];
      return hit ? { distanceYd: +hit.distance.toFixed(2), name: hit.object.name || hit.object.type } : null;
    };
    const up = cast(new THREE.Vector3(0, 1, 0));
    const west = cast(new THREE.Vector3(-1, 0, 0));
    return {
      stage,
      url: location.href,
      urlHasQuery: location.search.length > 0,
      storedSetting: localStorage.getItem(key),
      // What the resolver decided, and what put it there.
      request: L.CLUBHOUSE_VARIANT_REQUEST,
      layoutVariant: L.CLUBHOUSE_LAYOUT_VARIANT,
      // GEOMETRY, independent of the flag above. Both rays start 1.6 yd above the floor
      // at local (2.0, 0.0) and hit real surfaces in either room.
      ceilingHit: up,
      westWallHit: west,
      greyWestWall: !!named('GREY_WestWall'),
      publicMinX: +L.PUBLIC_ROOM_BOUNDS.minX.toFixed(2),
      publicMinZ: +L.PUBLIC_ROOM_BOUNDS.minZ.toFixed(2),
    };
  }, { stage: label, key: STORAGE_KEY });

  // --- A: control. Nothing asks for a room. --------------------------------------
  await bootBare(null);
  const a = await measure('A control â€” bare url, no saved setting');

  // --- B: the case the brief needs. -----------------------------------------------
  await bootBare('pine-hills-v2');
  const b = await measure('B saved setting, still a bare url');
  await page.screenshot({ path: path.join(outDir, 'variant-no-query-v2.png') });

  // --- C: control again. The setting is removed; v2 must go away. -----------------
  await bootBare(null);
  const c = await measure('C control â€” setting cleared');

  const isV2 = (m) => m.layoutVariant === 'pine-hills-v2' && m.greyWestWall && m.publicMinX === -2.6;
  const findings = {
    noStageUsedAQuery: [a, b, c].every((m) => !m.urlHasQuery),
    controlIsNotV2: !isV2(a) && !isV2(c),
    settingBuiltV2: isV2(b),
    settingWasTheReason: b.request?.source === 'setting',
    // The ROOM changed, measured: v2 drops the ceiling and pulls the west wall in. Both
    // rays must have hit something in both stages, or the comparison is vacuous.
    ceilingMeasuredBothStages: !!(a.ceilingHit && b.ceilingHit && c.ceilingHit),
    westWallMeasuredBothStages: !!(a.westWallHit && b.westWallHit && c.westWallHit),
    ceilingLowerInV2: !!(a.ceilingHit && b.ceilingHit) && b.ceilingHit.distanceYd < a.ceilingHit.distanceYd,
    westWallCloserInV2: !!(a.westWallHit && b.westWallHit) && b.westWallHit.distanceYd < a.westWallHit.distanceYd,
    // And it changed BACK â€” otherwise stage B could simply have been a one-way door.
    controlsAgree: !!(a.ceilingHit && c.ceilingHit && a.westWallHit && c.westWallHit)
      && a.ceilingHit.distanceYd === c.ceilingHit.distanceYd
      && a.westWallHit.distanceYd === c.westWallHit.distanceYd,
    ceilingYd: { control: a.ceilingHit?.distanceYd ?? null, v2: b.ceilingHit?.distanceYd ?? null },
    westWallYd: { control: a.westWallHit?.distanceYd ?? null, v2: b.westWallHit?.distanceYd ?? null },
  };

  const result = {
    what: 'pine-hills-v2 reached from a persisted setting with no query string, controlled both sides',
    findings,
    stages: [a, b, c],
    shots: ['variant-no-query-v2.png'],
    errs: errs.slice(0, 12),
    ok: findings.noStageUsedAQuery
      && findings.controlIsNotV2
      && findings.settingBuiltV2
      && findings.settingWasTheReason
      && findings.ceilingMeasuredBothStages
      && findings.westWallMeasuredBothStages
      && findings.ceilingLowerInV2
      && findings.westWallCloserInV2
      && findings.controlsAgree
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'variant-no-query.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
