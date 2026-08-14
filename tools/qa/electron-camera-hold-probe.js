// Can a QA driver hold the camera somewhere while register mode is active?
//
// The walk-up clip came back as 875 frames of the till close-up: register mode
// owns the camera, so filming "the customer walking up to me while I am at the
// register" from the player view shows a desk screen and a drawer and no lane at
// all. If the camera can be parked elsewhere and STAYS there, an overhead clip is
// possible; if register mode re-drives it every frame, it is not and the walk-up
// has to be filmed another way.
//
// Asked rather than assumed, because both answers lead somewhere and guessing
// wrong costs a whole recording session.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);
  const r = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const reg = s3.clubhouse()?.register;
    reg?.enter?.();
    await new Promise((done) => setTimeout(done, 800));
    const before = s3.camera.position.clone();
    // shove the camera somewhere unmistakable
    s3.camera.position.set(before.x, before.y + 6, before.z + 6);
    const set = s3.camera.position.clone();
    await new Promise((done) => setTimeout(done, 900));
    const after = s3.camera.position.clone();
    reg?.leave?.({ restorePointer: false });
    return {
      registerActive: !!reg?.isActive?.(),
      before: [+before.x.toFixed(2), +before.y.toFixed(2), +before.z.toFixed(2)],
      set: [+set.x.toFixed(2), +set.y.toFixed(2), +set.z.toFixed(2)],
      after: [+after.x.toFixed(2), +after.y.toFixed(2), +after.z.toFixed(2)],
      held: Math.abs(after.y - set.y) < 0.05 && Math.abs(after.z - set.z) < 0.05,
    };
  });
  console.log('CAMERA-HOLD', JSON.stringify(r));
  return r;
}
