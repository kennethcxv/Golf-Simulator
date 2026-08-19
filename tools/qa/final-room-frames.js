// THE `final` ROOM, LIT, PHOTOGRAPHED — and counted, so "empty" is a number.
//
// The owner asked for a stripped presentation: walls, floor and ceiling, the
// hero front desk, two shelves and the laptop. Nothing else. Two frames --
// standing inside the door at 10:30, and one at the desk.
//
// A photograph alone cannot say the room is empty, so this also COUNTS what is
// drawn: every fixture anchor in the scene, and every runtime prop root from
// sheets 51-100. The claim "four things in it" is then a list rather than an
// impression.
//
// AND IT IS THE CLEANEST TEST OF THE VERTICAL-SURFACE QUESTION. Both pixel
// probes written for that refused to testify -- one failed its unlit control,
// the other its dark control, and the room is at the texture-unit ceiling so a
// lit probe material will not even link. An empty lit room needs no probe: the
// desk front is a vertical surface and the desk top is a horizontal one, in the
// same frame, under the same lights, on the same asset. So the frame is
// measured for that too.
//
// THE CONTROL is the same driver run against pine-hills-v3, which is the same
// floor plan DRESSED rather than stripped. If v3 does not come back with many
// more fixtures and props than `final`, the stripping did nothing and the frames
// are of the ordinary room.
//
//   node tools/qa/run-electron.cjs tools/qa/final-room-frames.js --clubhouse=final
//   node tools/qa/run-electron.cjs tools/qa/final-room-frames.js --clubhouse=pine-hills-v3
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const out = { failures: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(2500);

  // Which room actually resolved. A driver that asked for `final` and got v2
  // would photograph the greybox and report it as the stripped room.
  out.variant = await page.evaluate(() => {
    const q = new URLSearchParams(location.search).get('clubhouse');
    return { query: q, argv: (window.__fwArgvClubhouse || null) };
  });
  const TAG = (process.env.QA_FINAL_TAG || 'final').replace(/[^a-z0-9-]+/gi, '_');
  const OUT = `qa/final-room/${TAG}`;
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`tag=${TAG}  clubhouse query=${out.variant.query}`);

  // 10:30, ceiling circuit repaired, laptop facility present. The starter is a
  // failing municipal shop whose ceiling circuit is DEAD -- the first club-wall
  // frames were of a correctly built wall in the dark, and the game said so on
  // its own HUD. The owner asked for this room LIT.
  out.lit = await page.evaluate(() => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    if ('speedIdx' in st) st.speedIdx = 0;
    const reno = st.shop.reno;
    for (const k of Object.keys(reno.architecture.components)) {
      reno.architecture.components[k].restored = true;
    }
    for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    reno.facilities = reno.facilities || {};
    reno.facilities.laptop = true;
    return { panels: Object.keys(reno.lightPanels).length, minutes: st.clock.minutes };
  });
  if (out.lit.minutes % 1440 !== 630) throw new Error(`clock pin did not take: ${out.lit.minutes}`);
  // THE STARTER'S SIM STATE IS NOT THE ROOM. Delivery cartons on the floor and
  // the neglected shop's grime are save data, not presentation, so the variant
  // deliberately does not branch on them -- a room that edited deliveries would
  // be changing the game, not the dressing. They are cleared HERE, in the
  // driver, and named so the frame is honest about being staged.
  out.cleared = await page.evaluate(() => {
    const st = window.__fw.state;
    const d = st.shop.deliveries;
    const before = Array.isArray(d?.pending) ? d.pending.length : null;
    if (d) {
      if (Array.isArray(d.pending)) d.pending.length = 0;
      if (Array.isArray(d.placed)) d.placed.length = 0;
      if (Array.isArray(d.boxes)) d.boxes.length = 0;
    }
    const reno = st.shop.reno;
    if (reno && Array.isArray(reno.clutter)) for (const pile of reno.clutter) pile.cleared = true;
    return { deliveriesBefore: before };
  });
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.refreshShopProgression?.();
    ch.rebuildBoxes?.();
  });
  await page.waitForTimeout(2500);

  // WHAT IS ACTUALLY IN THE ROOM.
  out.census = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const root = ch.interior;
    const fixtures = [];
    const props = [];
    let drawnMeshes = 0;
    root.traverse((o) => {
      let vis = o.visible;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (!vis) return;
      const n = o.name || '';
      if (/^Fixture_/.test(n)) fixtures.push(n.replace(/^Fixture_/, ''));
      if (/^AssetRuntime_/.test(n)) props.push(n);
      if (o.isMesh && o.layers.mask !== 0) drawnMeshes += 1;
    });
    return {
      fixtures: fixtures.sort(),
      propCount: props.length,
      props: props.slice(0, 8),
      drawnMeshes,
      laptopVisible: !!ch.laptopRig?.()?.object?.visible,
    };
  });
  console.log(`fixtures drawn (${out.census.fixtures.length}): ${out.census.fixtures.join(', ') || '(none)'}`);
  console.log(`runtime props 51-100 drawn: ${out.census.propCount}`);
  console.log(`drawn meshes under the interior: ${out.census.drawnMeshes}`);
  console.log(`laptop visible: ${out.census.laptopVisible}`);

  const places = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return {
      door: ch.localToWorld(-0.8, 4.10),
      desk: ch.localToWorld(2.10, 1.20),
      deskTarget: ch.localToWorld(3.30, 3.35),
      roomCentre: ch.localToWorld(0, 0),
    };
  });

  const shoot = async (name, from, lookAt, pitch) => {
    await page.evaluate(([p, t, pi]) => {
      const st = window.__fw.scene3d.walk.state;
      st.x = p.x; st.z = p.z;
      // The camera looks along -(sin yaw, cos yaw), so the target vector is
      // NEGATED. Aiming with atan2(dx, dz) photographs the opposite wall, and
      // the tell is the entrance rug's lettering coming out mirrored.
      st.yaw = Math.atan2(p.x - t.x, p.z - t.z);
      st.pitch = pi;
    }, [from, lookAt, pitch]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`   wrote ${OUT}/${name}.png`);
  };

  // Standing inside the door, aimed at the desk -- the owner's shot is the room
  // as you meet it, and the desk is the thing in it.
  await shoot('01-inside-the-door', places.door, places.deskTarget, -0.04);
  await shoot('01b-inside-the-door-room', places.door, places.roomCentre, -0.04);
  await shoot('02-the-desk', places.desk, places.deskTarget, -0.06);

  // ---- THE VERTICAL SURFACE, measured off the desk frame itself.
  //
  // No probe material, no added geometry: the desk's own front face is vertical
  // and its own top is horizontal, both in shot, both lit by the same room. The
  // frame is split into a lower band (the desk front, below the counter line)
  // and the band above it, and their medians compared. It is a coarse statistic
  // and it is labelled as one -- but it is taken on the shipped asset under the
  // shipped lights, which is more than either probe managed.
  const sharp = (await import('sharp')).default;
  const file = `${OUT}/02-the-desk.png`;
  const meta = await sharp(file).metadata();
  const band = async (top, height) => {
    const { data, info } = await sharp(file)
      .extract({
        left: Math.floor(meta.width * 0.25), top, width: Math.floor(meta.width * 0.5), height,
      })
      .raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const lum = [];
    for (let i = 0; i < data.length; i += ch) {
      lum.push((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255);
    }
    lum.sort((a, b) => a - b);
    return +lum[lum.length >> 1].toFixed(4);
  };
  const upper = await band(Math.floor(meta.height * 0.42), Math.floor(meta.height * 0.14));
  const lower = await band(Math.floor(meta.height * 0.62), Math.floor(meta.height * 0.20));
  out.deskBands = { upperMedianLuma: upper, lowerMedianLuma: lower, ratio: +(upper / Math.max(1e-6, lower)).toFixed(2) };
  console.log(`desk frame: upper band ${upper}   lower band ${lower}   upper:lower ${out.deskBands.ratio}`);

  fs.writeFileSync(`${OUT}/final-room.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
