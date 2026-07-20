// Does the clubhouse interior dominate the sun-shadow bake? Measure the bake
// time with interior shadow-casting ON vs OFF, at the same interior spot.
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  // park inside the shop, freeze the clock, install a bake-attributed sampler
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x + 6; w.z = o.z + 3; w.yaw = 1.2; w.pitch = -0.04;
    app.speedIdx = 0;
    window.__samp = null;
    const stats = app.scene3d.post && app.scene3d.post.stats;
    window.__run = async (spinMs) => {
      const s = { deltas: [], bakes: [], last: performance.now(), lastBakes: stats ? stats().shadowBakes : 0 };
      let raf = 0; let stop = false;
      const w2 = app.scene3d.walk.state;
      const tick = () => {
        const now = performance.now();
        s.deltas.push(now - s.last); s.last = now;
        const b = stats ? stats().shadowBakes : 0;
        s.bakes.push(b !== s.lastBakes); s.lastBakes = b;
        w2.yaw += 0.05; // spin to force shadow re-fits
        if (!stop) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, spinMs));
      stop = true; cancelAnimationFrame(raf);
      const pairs = s.deltas.map((v, i) => [v, s.bakes[i]]).slice(5);
      const bake = pairs.filter((p) => p[1]).map((p) => p[0]);
      const nonbake = pairs.filter((p) => !p[1]).map((p) => p[0]);
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      return {
        bakeAvg: Math.round(avg(bake) * 100) / 100,
        bakeWorst: bake.length ? Math.round(Math.max(...bake) * 10) / 10 : 0,
        nonBakeAvg: Math.round(avg(nonbake) * 100) / 100,
        bakeCount: bake.length,
      };
    };
  });

  const before = await page.evaluate(() => window.__run(3500));

  // disable shadow-casting on the interior CONTENTS (leave the shell + terrain)
  const toggled = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    let off = 0;
    ch.interior.traverse((o) => {
      if (o.isMesh && o.castShadow) { o.castShadow = false; o.__wasCaster = true; off += 1; }
    });
    const sun = window.__fw.scene3d.post.sun;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    return off;
  });

  const after = await page.evaluate(() => window.__run(3500));

  return { interiorCastersDisabled: toggled, before, after };
}
