// THE SECOND BUILDING ON THE PROPERTY — the same frame, before and after.
//
// courseScene places vendor/models/clubhouse_ext_opt.glb at scale 20 some
// 40 m from the clubhouse ("the groundskeeper's residence", DEV_LOG
// 2026-07-13, source file literally named house+3d+model.glb). The owner's
// ruling (Overnight 2026-08-21 Block 1): one clubhouse — ours — and nothing
// else. This driver stands the player on the entrance approach facing the
// spot and screenshots at the DEFAULT player camera, so the removal has a
// before and an after from the identical pose.
//
//   QA_TAG=before|after node tools/qa/run-electron.cjs tools/qa/groundskeeper-house-spot.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/tripo-house';
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'shot';

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // The house is placed at (bx - 30, bz + 27) where bx/bz is the clubhouse
  // origin. Stand 22 m south-east of the spot, look at it, day-lit and still.
  const placed = await page.evaluate(() => {
    const fw = window.__fw;
    const st = fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630; // 10:30, day-lit
    if ('speedIdx' in st) st.speedIdx = 0;
    const ch = fw.scene3d.clubhouse();
    const centre = ch.localToWorld(0, 0);
    const spot = { x: centre.x - 30, z: centre.z + 27 };
    const w = fw.scene3d.walk.state;
    w.x = spot.x + 16; w.z = spot.z + 14;
    w.yaw = Math.atan2(spot.x - w.x, -(spot.z - w.z));
    w.pitch = 0.02;
    return { spot, stand: { x: w.x, z: w.z }, yaw: w.yaw };
  });
  await page.waitForTimeout(2200);
  const file = `${OUT}/${tag}.png`;
  await page.screenshot({ path: file });
  console.log(`framed ${JSON.stringify(placed)} -> ${file}`);
  return { placed, file };
}
