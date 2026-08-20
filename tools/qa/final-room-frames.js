// THE ROOM, PHOTOGRAPHED THE WAY THE OWNER ASKED: from the door and from the
// desk, in `final`, at 10:30, default player camera.
//
//   node tools/qa/run-electron.cjs tools/qa/final-room-frames.js --clubhouse=final
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/final-room';
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'block2';

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630; // 10:30
    if ('speedIdx' in st) st.speedIdx = 0;
    const reno = st.shop?.reno;
    if (reno?.lightPanels) for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    window.__fw.scene3d.clubhouse().refreshShopProgression?.();
  });
  await page.waitForTimeout(1200);

  const shot = async (name, lx, lz, yawToLx, yawToLz, pitch = 0.04) => {
    await page.evaluate(([px, pz, tx, tz, pt]) => {
      const fw = window.__fw;
      const ch = fw.scene3d.clubhouse();
      const p = ch.localToWorld(px, pz);
      const t = ch.localToWorld(tx, tz);
      const w = fw.scene3d.walk.state;
      w.x = p.x; w.z = p.z;
      w.yaw = Math.atan2(t.x - p.x, -(t.z - p.z));
      w.pitch = pt;
    }, [lx, lz, yawToLx, yawToLz, pitch]);
    await page.waitForTimeout(1400);
    const file = `${OUT}/${tag}-${name}.png`;
    await page.screenshot({ path: file });
    console.log(`shot ${name} -> ${file}`);
  };

  // from just inside the main door, looking at the desk (door local ~(-0.8, 4.6); desk at (3.30, 3.35))
  await shot('from-door', 0.6, 3.9, 3.3, 3.30);
  // from behind the desk, the staff view over the counter toward the room
  await shot('from-desk', 3.3, 4.25, 0.5, 0.5, 0.16);
  // the desk itself from the customer side, square on
  await shot('desk-front', 3.3, 0.8, 3.3, 3.35, 0.10);
  // the hutch close-up: the hero garments on their lit board
  await shot('hutch-closeup', 2.75, 2.9, 2.75, 5.2, 0.42);
  console.log('done');
  return { ok: true };
}
