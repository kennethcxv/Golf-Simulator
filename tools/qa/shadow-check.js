async (page) => {
  // Visual proof the refit shadows read right: on foot (tight snapped 2048 box) and from
  // the overview map (whole-course 4096, the classic fit).
  const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/perf';
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    const st = app.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 9 * 60; // long morning shadows
    const w = app.scene3d.walk.state;
    w.x = 6; w.z = 148; w.yaw = 2.6; w.pitch = -0.06; // clubhouse + trees in frame, sun across
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/shadows-walk.png` });
  // walk 40 yards and look again — the snapped box must follow without swimming or clipping
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    w.x = -30; w.z = 110; w.yaw = -2.2;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/shadows-walk-moved.png` });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shadows-overview.png` });
  const mode = await page.evaluate(() => ({
    mapSize: window.__fw.scene3d.post.sun.shadow.mapSize.x,
    walkActive: window.__fw.scene3d.walk.isActive(),
  }));
  return { mode };
}
