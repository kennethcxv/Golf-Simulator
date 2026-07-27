async (page) => {
  // §11 collision/float audit for the pine-hills starter interior. Traverses
  // the live scene and reports, with world positions and screenshots:
  //   FLOATERS — floor-class meshes whose bounding box hangs above the floor
  //   SINKERS  — meshes buried below the finished floor
  //   OVERLAPS — solid prop pairs whose XZ footprints intersect heavily
  // Heuristics skip wall/ceiling/glass/overlay classes by name; results are a
  // triage list for the placement pass, not auto-fixes.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(process.env.FLOAT_QA_ROOT
    || path.join(repo, 'qa', 'recovery-2026-07-22', 'float-audit'));
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);

  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const interior = clubhouse.interior;
    interior.updateWorldMatrix(true, true);
    const origin = interior.position;
    const floorY = (() => {
      // The walk floor at the interior center is the authoritative datum.
      const probe = clubhouse.group?.position?.y || 0;
      return app.scene3d.walk?.floorYAt?.(origin.x, origin.z) ?? probe;
    })();

    const SKIP = /veil|Veil|light|Light|lamp|Lamp|ceiling|Ceiling|Beam|beam|wall|Wall|Panel|panel|window|Window|glass|Glass|trim|Trim|Baseboard|roof|Roof|door|Door|sign|Sign|cobweb|Cobweb|grime|Grime|wet|Wet|mote|Mote|decal|Decal|overlay|Overlay|Backdrop|backdrop|curtain|shadow|Shadow/;
    const entries = [];
    for (const child of interior.children) {
      if (!child.visible) continue;
      const name = child.name || '(anon)';
      if (SKIP.test(name)) continue;
      const box = new THREE.Box3().setFromObject(child);
      if (!Number.isFinite(box.min.x) || box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3());
      if (size.x < 0.05 && size.z < 0.05) continue;
      if (size.y < 0.02) continue;
      entries.push({
        name,
        min: { x: +box.min.x.toFixed(3), y: +box.min.y.toFixed(3), z: +box.min.z.toFixed(3) },
        max: { x: +box.max.x.toFixed(3), y: +box.max.y.toFixed(3), z: +box.max.z.toFixed(3) },
        size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
        localX: +(((box.min.x + box.max.x) / 2) - origin.x).toFixed(2),
        localZ: +(((box.min.z + box.max.z) / 2) - origin.z).toFixed(2),
      });
    }

    const floaters = [];
    const sinkers = [];
    for (const entry of entries) {
      const lift = entry.min.y - floorY;
      // Tall standing objects should touch the floor. Items resting ON other
      // furniture legitimately start higher; only flag lifts in the ambiguous
      // hover band that reads as floating from eye height.
      if (lift > 0.035 && lift < 0.55 && entry.size.y > 0.25) {
        floaters.push({ ...entry, lift: +lift.toFixed(3) });
      }
      if (lift < -0.06) sinkers.push({ ...entry, sink: +lift.toFixed(3) });
    }

    const overlaps = [];
    const area = (e) => (e.max.x - e.min.x) * (e.max.z - e.min.z);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i]; const b = entries[j];
        const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        if (ox <= 0 || oz <= 0 || oy <= 0.05) continue;
        const overlapArea = ox * oz;
        const smaller = Math.min(area(a), area(b));
        const ratio = overlapArea / Math.max(0.0001, smaller);
        if (ratio > 0.30 && smaller > 0.05) {
          overlaps.push({
            a: a.name, b: b.name, ratio: +ratio.toFixed(2),
            at: { x: a.localX, z: a.localZ },
          });
        }
      }
    }
    return { floorY: +floorY.toFixed(3), scanned: entries.length, floaters, sinkers, overlaps };
  });

  // Photograph each finding from a nearby eye-height pose.
  const pose = async (x, z, faceX, faceZ) => {
    await page.evaluate(({ x, z, faceX, faceZ }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + x;
      walk.state.z = origin.z + z;
      const dx = faceX - x; const dz = faceZ - z;
      const L = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / L, -dz / L);
      walk.state.pitch = -0.18;
    }, { x, z, faceX, faceZ });
    await page.waitForTimeout(380);
  };
  let shotIndex = 0;
  const findings = [...report.floaters.map((f) => ({ kind: 'floater', ...f })),
    ...report.sinkers.map((f) => ({ kind: 'sinker', ...f }))].slice(0, 10);
  for (const finding of findings) {
    shotIndex += 1;
    await pose(finding.localX + 1.6, finding.localZ + 1.2, finding.localX, finding.localZ);
    const file = `${String(shotIndex).padStart(2, '0')}-${finding.kind}-${finding.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png`;
    await page.screenshot({ path: path.join(out, file) });
    finding.screenshot = file;
  }

  const result = { ok: true, ...report, findings };
  fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
