// A — WHY 42 PROGRAMS ARRIVE AFTER THE PREWARM ENDS.
//
// electron-stall-attribution.js established that the shop's first spin costs
// 2.5 s in a handful of freezes and its second costs 0.2 s, with no geometry or
// texture uploads on any stall frame — a first-visit shader-compile cost, 36 of
// the 42 late programs being `physical` (standard/physical materials).
//
// A standard-material program in three.js is keyed on, among other things, the
// NUMBER OF LIGHTS OF EACH TYPE currently in the scene. clubhouse.js hides the
// whole `interior` group past CLUBHOUSE_INTERIOR_DRAW_DISTANCE — and the shop's
// PointLights are inside it. So crossing that distance changes the light counts,
// which changes the cache key of every physical program in the world, which
// recompiles all of them. The prewarm's forced draw runs at the spawn pose, so
// the set it compiles is the OUTSIDE set, and walking into your own pro shop
// throws all of it away.
//
// This probe does not assume that. It stands at three distances and names every
// light three would count, with the ancestor that owns it, so the ones that come
// and go are identified rather than inferred — and it reports the program count
// at each pose, which is the consequence.
//
// CONTROL. The sun and the hemisphere fill are visible from everywhere and must
// appear in ALL THREE censuses. If the probe reported those coming and going too,
// it would be measuring its own traverse rather than the scene.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/light-churn');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
  });

  const census = async (name, dx, dz) => {
    await page.evaluate(({ ax, az }) => {
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const w = window.__fw.scene3d.walk.state;
      w.x = o.x + ax; w.z = o.z + az; w.yaw = 0; w.pitch = -0.05;
    }, { ax: dx, az: dz });
    await page.waitForTimeout(1400); // let the draw-distance sync settle and draw
    return page.evaluate(({ label, ax, az }) => {
      const s3 = window.__fw.scene3d;
      const lights = [];
      s3.scene.traverse((o) => {
        if (!o.isLight) return;
        let vis = o.visible;
        const chain = [];
        for (let p = o.parent; p; p = p.parent) {
          if (p.name) chain.push(p.name);
          if (!p.visible) vis = false;
        }
        if (!vis) return;
        lights.push({
          type: o.type,
          name: o.name || '(unnamed)',
          intensity: Math.round((o.intensity || 0) * 1000) / 1000,
          owner: chain.slice(0, 3).join(' < ') || '(scene)',
        });
      });
      const by = {};
      for (const l of lights) by[l.type] = (by[l.type] || 0) + 1;
      const ch = s3.clubhouse();
      return {
        label,
        offset: { dx: ax, dz: az },
        interiorVisible: !!ch.interior.visible,
        counts: by,
        total: lights.length,
        lights: lights.map((l) => `${l.type} ${l.name} i=${l.intensity} [${l.owner}]`).sort(),
        programs: s3.renderer.info.programs?.length ?? null,
      };
    }, { label: name, ax: dx, az: dz });
  };

  // far outside (roughly where the spawn/prewarm camera stands), the porch, inside
  const far = await census('far-outside', -2, 60);
  const porch = await census('porch', -2, 14);
  const inside = await census('inside-shop', -5.6, 2.4);

  const setOf = (c) => new Set(c.lights);
  const onlyInside = [...setOf(inside)].filter((l) => !setOf(far).has(l));
  const onlyFar = [...setOf(far)].filter((l) => !setOf(inside).has(l));
  const inAll = [...setOf(far)].filter((l) => setOf(porch).has(l) && setOf(inside).has(l));

  const out = {
    far, porch, inside,
    onlyInside,
    onlyFar,
    alwaysPresent: inAll,
    checks: {
      // the finding: the light counts are not the same in the two places
      lightCountChangesWithDistance: far.total !== inside.total,
      interiorHiddenWhenFar: far.interiorVisible === false && inside.interiorVisible === true,
      // the control: sun + sky fill must survive all three, or the probe is
      // measuring its own traverse rather than the scene
      controlSunAndSkySurviveAllThree: inAll.some((l) => l.startsWith('DirectionalLight'))
        && inAll.some((l) => l.startsWith('HemisphereLight')),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlSunAndSkySurviveAllThree;
  fs.writeFileSync(path.join(OUT, 'churn.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
