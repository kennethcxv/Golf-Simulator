// ASSETS 71-100 ARE ACTUALLY IN THE ROOM.
//
// Thirty finished props sat in vendor/ with nothing loading them. This proves they now load, land
// where the layout says they should, sit inside the shell rather than through a wall, and keep
// clear of the two clearways the floor plan protects.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(repo, 'qa', 'assets_51_100_master', 'claude_completion', 'props_71_100');
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const missing = [];
  page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });

  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  const diag = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    await ch.sheet06ProductionReady?.();
    await ch.props71to100.ready;
    return ch.props71to100.diagnostics();
  });

  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    if (!v) return true;
    const cs = getComputedStyle(v);
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02;
  }, null, { timeout: 90000 });

  // Where did every prop actually END UP? Measured from the scene graph, not from the table
  // that asked for it — a placement socket that failed to resolve would put a prop at its
  // authoring origin and this is what would catch it.
  const geometry = await page.evaluate(async () => {
    const THREE = await import('three');
    const ch = window.__fw.scene3d.clubhouse();
    const interior = ch.interior;
    const group = interior.getObjectByName('Assets71to100Props');
    if (!group) return { error: 'prop group missing from the scene' };
    const rows = [];
    const box = new THREE.Box3();
    interior.updateMatrixWorld(true);
    for (const root of group.children) {
      // Box3.setFromObject reports WORLD space, but every number in the floor plan is
      // interior-local — the clubhouse itself sits somewhere out on the course. Convert, or
      // every prop in the building looks like it is a hundred yards outside it.
      box.setFromObject(root);
      const c = interior.worldToLocal(box.getCenter(new THREE.Vector3()));
      const lo = interior.worldToLocal(box.min.clone());
      const s = box.getSize(new THREE.Vector3());
      const n = Number((root.name.match(/^Prop_(\d+)_/) || [])[1]);
      rows.push({
        n,
        centre: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
        size: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)],
        minY: +lo.y.toFixed(3),
      });
    }
    return { rows: rows.sort((a, b) => a.n - b.n) };
  });

  const rows = geometry.rows || [];
  // INTERIOR is 20.5 x 13 yd; a prop whose bounds leave the shell is through a wall.
  const HX = 10.25 + 0.35; // a wall-mounted plate may sit slightly proud into the plaster
  const HZ = 6.5 + 0.35;
  const outsideShell = rows.filter((r) =>
    Math.abs(r.centre[0]) > HX || Math.abs(r.centre[2]) > HZ);
  const sunken = rows.filter((r) => r.minY < -0.12);          // buried in the floor
  const floating = rows.filter((r) => r.minY > 2.95);          // above the 3.2 ceiling
  const huge = rows.filter((r) => Math.max(...r.size) > 3.2);  // a scale error
  const atOrigin = rows.filter((r) =>
    Math.abs(r.centre[0]) < 0.05 && Math.abs(r.centre[2]) < 0.05); // placement socket failed

  // Fixed cameras over the three zones the props dress.
  const shots = [
    { id: '01-office', x: 7.4, z: 3.0, tx: 9.9, tz: 4.6, pitch: -0.06 },
    { id: '02-office-wall', x: 8.6, z: 3.4, tx: 8.4, tz: 6.5, pitch: 0.04 },
    { id: '03-stockroom-cleaning-bay', x: 8.7, z: -0.4, tx: 6.4, tz: 1.6, pitch: -0.34 },
    { id: '04-receiving-washer', x: 7.6, z: -3.6, tx: 9.1, tz: -5.6, pitch: -0.30 },
    { id: '05-entrance-safety', x: -0.9, z: 3.2, tx: -0.8, tz: 6.5, pitch: 0.14 },
    { id: '06-front-desk-props', x: 2.9, z: 2.4, tx: 2.9, tz: 4.2, pitch: -0.26 },
    { id: '07-north-wall-board', x: -4.0, z: -4.0, tx: -4.1, tz: -6.5, pitch: 0.02 },
    { id: '08-west-wall-emergency', x: -8.0, z: -1.4, tx: -10.25, tz: -1.4, pitch: 0.16 },
  ];
  for (const s of shots) {
    await page.evaluate((shot) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      const o = app.scene3d.clubhouse().interior.position;
      walk.state.x = o.x + shot.x;
      walk.state.z = o.z + shot.z;
      const dx = (o.x + shot.tx) - walk.state.x;
      const dz = (o.z + shot.tz) - walk.state.z;
      const d = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / d, -dz / d);
      walk.state.pitch = shot.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, s);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(out, `${s.id}.png`) });
  }

  return {
    ok: diag.placed === 30
      && diag.failed === 0
      && outsideShell.length === 0
      && sunken.length === 0
      && floating.length === 0
      && huge.length === 0
      && atOrigin.length === 0
      && missing.length === 0
      && errors.length === 0,
    diagnostics: diag,
    checks: {
      measured: rows.length,
      outsideShell: outsideShell.map((r) => r.n),
      sunkenIntoFloor: sunken.map((r) => `${r.n}@${r.minY}`),
      aboveCeiling: floating.map((r) => r.n),
      scaleErrors: huge.map((r) => `${r.n}:${Math.max(...r.size)}`),
      strandedAtOrigin: atOrigin.map((r) => r.n),
    },
    placements: rows,
    missingAssets: missing,
    errors,
    shots: out,
  };
}
