async (page) => {
  // Where exactly is the parked reader, in desk-local terms, and what does the
  // bay look like up close? Boots a clean game, no customer needed.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/checkout-round7');
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const startBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await startBtn.isVisible({ timeout: 1500 }).catch(() => false)) await startBtn.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  // wait for the deferred kit models to land
  await page.waitForFunction(() => {
    let found = null;
    window.__fw.scene3d.clubhouse().interior.traverse((o) => {
      if (!found && o.name === 'checkout-payment_terminal') found = o;
    });
    return !!found;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const probe = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const { COUNTER_TOP, COUNTER, frontDeskLocalPoint } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    const interior = clubhouse.interior;
    const localize = (object) => {
      const world = object.getWorldPosition(new THREE.Vector3());
      const inRoom = interior.worldToLocal(world.clone());
      const desk = frontDeskLocalPoint(inRoom.x, inRoom.z);
      const euler = new THREE.Euler().setFromQuaternion(
        object.getWorldQuaternion(new THREE.Quaternion()), 'XYZ',
      );
      const box = new THREE.Box3().setFromObject(object);
      return {
        deskX: +desk.x.toFixed(3),
        deskZ: +desk.z.toFixed(3),
        y: +inRoom.y.toFixed(3),
        yAboveCounter: +(inRoom.y - COUNTER_TOP).toFixed(3),
        euler: [euler.x, euler.y, euler.z].map((v) => +v.toFixed(3)),
        boxYSpan: box.isEmpty() ? null : [+box.min.y.toFixed(3), +box.max.y.toFixed(3)],
      };
    };
    let terminal = null; let bay = null;
    interior.traverse((o) => {
      if (!terminal && o.name === 'checkout-payment_terminal') terminal = o;
      if (!bay && o.name === 'CheckoutTerminalBay') bay = o;
    });
    // CONTAINMENT, MEASURED IN THE BAY'S OWN FRAME. A world-space y/z pair
    // cannot answer "is it inside the alcove" once the desk is rotated.
    const inBayFrame = (object) => {
      if (!object || !bay) return null;
      bay.updateWorldMatrix(true, false);
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return null;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const local = bay.worldToLocal(new THREE.Vector3(x, y, z));
            lo[0] = Math.min(lo[0], local.x); hi[0] = Math.max(hi[0], local.x);
            lo[1] = Math.min(lo[1], local.y); hi[1] = Math.max(hi[1], local.y);
            lo[2] = Math.min(lo[2], local.z); hi[2] = Math.max(hi[2], local.z);
          }
        }
      }
      return {
        x: [+lo[0].toFixed(3), +hi[0].toFixed(3)],
        y: [+lo[1].toFixed(3), +hi[1].toFixed(3)],
        z: [+lo[2].toFixed(3), +hi[2].toFixed(3)],
      };
    };
    let pinPad = null;
    if (bay) bay.traverse((o) => { if (!pinPad && o.isGroup && o !== bay) pinPad = o; });
    return {
      counterDepth: COUNTER.depth,
      terminal: terminal ? localize(terminal) : null,
      bay: bay ? localize(bay) : null,
      counterTopWorldY: +(interior.position.y + COUNTER_TOP).toFixed(3),
      // the contract: everything parked must sit inside the opening. Read from
      // the module's own constant so the probe cannot drift from the geometry.
      opening: await (async () => {
        const { CHECKOUT_TERMINAL_BAY: B } = await import(new URL('src/render3d/clubhouse/simplifiedRegisterMode.js', document.baseURI).href);
        return { halfWidth: B.width / 2, halfHeight: B.height / 2, depth: B.reach };
      })(),
      readerInBay: inBayFrame(terminal),
      pinPadInBay: inBayFrame(pinPad),
    };
  });

  // close-up render of the bay from the staff side, slightly above
  const closeup = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene3d = window.__fw.scene3d;
    const clubhouse = scene3d.clubhouse();
    let bay = null;
    clubhouse.interior.traverse((o) => { if (!bay && o.name === 'CheckoutTerminalBay') bay = o; });
    if (!bay) return null;
    const centre = new THREE.Box3().setFromObject(bay).getCenter(new THREE.Vector3());
    const probeCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 40);
    bay.updateWorldMatrix(true, false);
    const outward = new THREE.Vector3(0, 0.45, 1).transformDirection(bay.matrixWorld).normalize();
    probeCam.position.copy(centre).addScaledVector(outward, 1.05);
    probeCam.lookAt(centre);
    probeCam.updateMatrixWorld(true);
    scene3d.renderer.render(scene3d.scene, probeCam);
    return document.querySelector('canvas').toDataURL('image/png');
  });
  if (closeup) {
    fs.writeFileSync(path.join(OUT, '10-bay-closeup.png'),
      Buffer.from(closeup.split(',')[1], 'base64'));
  }
  return probe;
}
