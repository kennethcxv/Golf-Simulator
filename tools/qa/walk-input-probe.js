// D7 — CAN THE HARNESS MAKE THE PLAYER WALK AT ALL?
//
// Three separate methods measured 0 yd/s in the push-beats-walk driver: holding
// W through Playwright, writing walk.state inside a rAF callback, and writing it
// between frames from the driver side. Before writing any of that up as "the
// broom does not sweep", establish which of them move the player and which do
// not — because ~20 drivers in tools/qa call page.keyboard.down('w') and treat
// what follows as a walk.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    const o = window.__fw.scene3d.clubhouse().interior.position;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 6.0; w.state.yaw = 0; w.state.pitch = 0;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);

  const at = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    return {
      x: +w.state.x.toFixed(4), z: +w.state.z.toFixed(4),
      locked: !!document.pointerLockElement,
      stateIsStable: w.state === w.state,
    };
  });

  const out = {};
  // (a) the established pattern: hold W
  let a0 = await at();
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  let a1 = await at();
  out.holdW = { from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4) };

  // (b) a direct write between frames
  a0 = await at();
  await page.evaluate(() => { window.__fw.scene3d.walk.state.z -= 1.0; });
  await page.waitForTimeout(400);
  a1 = await at();
  out.directWrite = { from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4) };

  // (c) a synthetic keydown on the document, which is where main.js listens
  a0 = await at();
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
  });
  a1 = await at();
  out.syntheticKey = { from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4) };

  out.verdict = {
    holdWWorks: out.holdW.movedYd > 0.5,
    directWriteWorks: out.directWrite.movedYd > 0.5,
    syntheticKeyWorks: out.syntheticKey.movedYd > 0.5,
  };
  return out;
}
