// E2 (Goal 20) — WHY DOES THE CARD PASS THROUGH THE FINGERS?
//
// The pose has been authored twice by hand (Goal 18, Goal 19) and the fingers
// still cross the plastic. Both attempts placed the card by a chosen offset —
// "a few centimetres out of the fist" — without anybody measuring how far the
// fingers actually reach. This measures it, so the third attempt is arithmetic
// rather than a fourth guess:
//
//   * where the grip node is
//   * where every finger bone in that hand is, and the furthest one from the grip
//   * the card's world bounding box once attached
//   * the overlap between the two along the direction the card is pushed out
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e2-card-pinch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e2-card');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // stage a card sale at the counter, the way every checkout driver does
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x + 1.4; w.z = o.z + 1.2; w.yaw = Math.PI; w.pitch = -0.15;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    const skus = ['balls1', 'water1'];
    for (const id of skus) {
      const inv = app.state.shop?.inventory?.[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 12);
    }
    ch.rebuildStock?.();
    ch.sendToCounter?.(skus, 'card');
  });

  // wait for the card to reach the customer's hand
  const measured = await page.waitForFunction(() => {
    const THREE = window.__fw?.THREE;
    const ch = window.__fw.scene3d?.clubhouse?.();
    const reg = ch?.register;
    const scene = window.__fw.scene3d?.scene;
    if (!THREE || !scene) return null;
    // find the card mesh wherever it has been parented
    let card = null;
    scene.traverse((n) => { if (!card && /card/i.test(n.name || '') && n.userData?.kind === 'payment-card') card = n; });
    if (!card || !card.parent) return null;
    const grip = card.parent;
    if (!/grip|hand|palm|wrist/i.test(grip.name || '')) return null;
    grip.updateWorldMatrix(true, true);
    const gripAt = grip.getWorldPosition(new THREE.Vector3());
    // every descendant bone of the hand, and how far each sits from the grip
    const bones = [];
    grip.traverse((n) => {
      if (n === grip || n === card || card.getObjectById?.(n.id)) return;
      const p = n.getWorldPosition(new THREE.Vector3());
      bones.push({ name: n.name || n.type, d: +p.distanceTo(gripAt).toFixed(4) });
    });
    bones.sort((a, b) => b.d - a.d);
    const box = new THREE.Box3().setFromObject(card);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    return {
      gripName: grip.name || grip.type,
      cardCentreFromGrip: +centre.distanceTo(gripAt).toFixed(4),
      cardSize: [+size.x.toFixed(4), +size.y.toFixed(4), +size.z.toFixed(4)],
      furthestBone: bones[0] || null,
      boneCount: bones.length,
      bones: bones.slice(0, 8),
      reg: !!reg,
    };
  }, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);

  await page.screenshot({ path: path.join(OUT, 'card-in-hand.png') });
  const out = { measured, errs };
  fs.writeFileSync(path.join(OUT, 'card-pinch.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
