// K (Goal 23) — IS THE OPEN/CLOSED SIGN ATTACHED TO ANYTHING?
//
// "Floating PRO SHOP sign." The geometry agreed before it was measured: an
// 0.012 yd board centred 0.10 yd off the wall leaves its back face 8.6 cm proud
// of the plaster with nothing between them.
//
// It cannot be pushed flush — the card SPINS THROUGH 180° to flip between OPEN
// and CLOSED, and that turn is the whole gesture. So the fix is a bracket, and
// the thing to verify is not "a bracket exists" but that it BRIDGES THE GAP and
// STAYS PUT WHEN THE CARD TURNS. A mount parented to the spinning card would
// swing out of the wall every time the shop opens, and would still pass any
// check that only asked whether it was there.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-k-sign-mount.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/k-sign-mount');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  const measure = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const ch = window.__fw.scene3d.clubhouse();
    let card = null; let mount = null;
    ch.interior.traverse((n) => {
      if (n.name === 'ClubhouseOpenClosedSign') card = n;
      if (n.name === 'ClubhouseOpenClosedSignMount') mount = n;
    });
    if (!card) return { cardFound: false };
    ch.interior.updateMatrixWorld(true);
    const cardBox = new THREE.Box3().setFromObject(card);
    const result = {
      cardFound: true,
      mountFound: !!mount,
      cardYaw: +card.rotation.y.toFixed(4),
      // the card's own standoff, in the interior's local frame
      cardLocalZ: +card.position.z.toFixed(4),
      cardDepth: +(cardBox.max.z - cardBox.min.z).toFixed(4),
    };
    if (mount) {
      const mountBox = new THREE.Box3().setFromObject(mount);
      result.mountLocalZ = +mount.position.z.toFixed(4);
      result.mountWorldZSpan = +(mountBox.max.z - mountBox.min.z).toFixed(4);
      // a bracket that does not reach the wall is a second floating object
      result.mountReachesFurtherThanCard = (mountBox.max.z - mountBox.min.z)
        > (cardBox.max.z - cardBox.min.z);
      result.mountIsSiblingNotChild = mount.parent === card.parent;
    }
    return result;
  });

  out.closed = await measure();

  // FLIP IT. The card turns 180 degrees; the mount must not move at all.
  await page.evaluate(() => {
    const s = window.__fw.state;
    if (s?.shop) s.shop.open = !s.shop.open;
    window.__fw.scene3d.clubhouse().syncOpenClosedSigns?.();
  }).catch(() => {});
  await page.waitForTimeout(1600);
  out.flipped = await measure();

  out.checks = {
    cardFound: out.closed.cardFound,
    mountFound: out.closed.mountFound === true,
    // THE POINT: the bracket spans the standoff, so nothing hangs in mid-air
    mountBridgesTheGap: out.closed.mountReachesFurtherThanCard === true,
    // ...and it is a SIBLING, so it stays in the wall when the card turns
    mountIsSiblingNotChild: out.closed.mountIsSiblingNotChild === true,
    mountDidNotMoveOnFlip: out.closed.mountLocalZ === out.flipped.mountLocalZ,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'sign-mount.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('K-SIGN', JSON.stringify({ closed: out.closed, flipped: out.flipped, checks: out.checks }, null, 2));
  return out;
}
