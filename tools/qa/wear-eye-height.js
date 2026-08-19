// THE WEAR, JUDGED AT EYE HEIGHT, BESIDE THE REFERENCE.
//
// Step two of the ground work: a worn apron beside each tee and a walk-off scar
// at each green, authored from the course vector as a mask and streaked along
// the mow flow field. The reference readings that drive it were measured off the
// six tracked photographs in Designs/Course/Ground/wear by
// tools/course/wear_sample.py:
//
//   the dry straw halo runs 1.14x the turf's luma
//   the compacted core runs 1.64x the turf's luma
//   both LIGHTER than the turf, in all six photographs
//
// So the acceptance is not "does a frame look worn". It is whether the ground
// beside a tee now carries a population of pixels brighter than the turf around
// it, in the ratio the photographs say, and whether it did NOT before.
//
// The camera stands at eye height at three stations: the tee apron, the green
// walk-off, and mid-fairway. MID-FAIRWAY IS THE CONTROL STATION -- no tee, no
// green, no simulated traffic, so its bright tail must NOT move. A change that
// lifts the whole course is a change to the turf, not an authored scar, and this
// is the frame that tells those two apart.
//
// Run it once on the build with the wear in, and once with courseScene.js
// restored from a file copy, and compare. A number from one build is not a
// result; the pair is.
//
//   node tools/qa/run-electron.cjs tools/qa/wear-eye-height.js --clubhouse=pine-hills-v2
//
// QA_WEAR_TAG   label written into the output filenames (e.g. "after" / "before")
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const TAG = process.env.QA_WEAR_TAG || 'after';
  const OUT = `qa/wear/${TAG}`;
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], tag: TAG, stations: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(2500);

  // Mid-morning, so the ground is lit by the sun rather than by the dark. Every
  // ground frame taken on this project before the clock was pinned was shot at
  // 6:02 AM into a black course.
  out.clock = await page.evaluate(() => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    if ('speedIdx' in st) st.speedIdx = 0;
    return st.clock.minutes;
  });
  if (out.clock % 1440 !== 630) throw new Error(`clock pin did not take: ${out.clock}`);

  // THE TERRAIN MUST BE THE AUTHORED MATERIAL. A frame that looks plausible
  // while the ground has fallen back to the procedural canvas is the shape of
  // most instrument faults on record here, so ask before shooting.
  out.wiring = await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    let terrain = null;
    sc.scene.traverse((o) => { if (o.name === 'CourseTerrain') terrain = o; });
    if (!terrain) return { found: false };
    const m = terrain.material;
    return {
      found: true,
      programError: !!m.userData?.programError,
      hasMap: !!m.map,
      hasNormal: !!m.normalMap,
    };
  });
  console.log(`terrain: ${JSON.stringify(out.wiring)}`);
  if (!out.wiring.found) fail('there is no CourseTerrain in the scene — nothing below is a ground frame');
  if (out.wiring.programError) fail('the terrain material failed to compile — the frames are a fallback');

  // The stations, off hole 1 of the live course vector.
  const plan = await page.evaluate(() => {
    const st = window.__fw.state;
    const course = st.course;
    if (!course?.vec?.holes?.length) return null;
    const CELL = course.cellYd || 8;
    const worldW = course.w * CELL;
    const worldH = course.h * CELL;
    const toWorld = (p) => ({ x: p.x * CELL - worldW / 2, z: p.y * CELL - worldH / 2 });
    const h = course.vec.holes[0];
    const line = h.line || [];
    if (line.length < 2) return null;
    const tee = toWorld(line[0]);
    const green = toWorld(line[line.length - 1]);
    const mid = toWorld(line[Math.floor(line.length * 0.5)]);
    const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
    return { tee, green, mid, yawDown: yawTo(tee, green) };
  });
  if (!plan) throw new Error('no hole 1 in the course vector — nowhere to stand');
  // THE COURSE ITSELF, RECORDED. Two runs of this driver on two builds produced
  // frames with a different bunker and a different treeline, which means the
  // A/B was comparing two courses and not two builds. Every run now states the
  // hole it stood on so that can never again be discovered by eye.
  out.plan = plan;
  console.log(`hole 1: tee ${JSON.stringify(plan.tee)}  green ${JSON.stringify(plan.green)}`);

  const stand = async (name, pos, yaw, pitch) => {
    await page.evaluate(([p, y, pi]) => {
      const sc = window.__fw.scene3d;
      const st = sc.walk.state;
      st.x = p.x; st.z = p.z; st.yaw = y; st.pitch = pi;
    }, [pos, yaw, pitch]);
    await page.waitForTimeout(1600);
    const file = `${OUT}/${name}.png`;
    await page.screenshot({ path: file });

    // Read the ground half of the frame only: the sky and the treeline carry
    // their own bright pixels and would swamp a "brighter tail" statistic.
    const sharp = (await import('sharp')).default;
    const meta = await sharp(file).metadata();
    const top = Math.floor(meta.height * 0.52);
    const { data, info } = await sharp(file)
      .extract({ left: 0, top, width: meta.width, height: meta.height - top })
      .raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const lum = [];
    const sat = [];
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i] / 255; const g = data[i + 1] / 255; const b = data[i + 2] / 255;
      lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      sat.push(mx > 1e-6 ? (mx - mn) / mx : 0);
    }
    lum.sort((a, b) => a - b);
    const q = (p) => +lum[Math.min(lum.length - 1, Math.floor(lum.length * p))].toFixed(4);
    const med = q(0.5);
    const row = {
      station: name,
      file,
      p50: med,
      p90: q(0.9),
      p99: q(0.99),
      // THE NUMBER. How far the brightest tenth of the ground sits above the
      // median of the ground -- which is exactly what a scar lighter than the
      // turf around it produces, and what a uniformly lit fairway does not.
      brightTail: +(q(0.9) / Math.max(1e-6, med)).toFixed(3),
      meanSat: +(sat.reduce((a, b) => a + b, 0) / sat.length).toFixed(4),
    };
    out.stations.push(row);
    console.log(`  ${name.padEnd(22)} p50 ${row.p50}   p90 ${row.p90}   p99 ${row.p99}`
      + `   bright tail ${row.brightTail}   sat ${row.meanSat}`);
    return row;
  };

  console.log(`\n== ${TAG} ==`);
  // Beside the tee, looking down the hole, eye height, default camera.
  await stand('01-tee-apron', { x: plan.tee.x + 4.5, z: plan.tee.z + 4.5 }, plan.yawDown, -0.22);
  // Off the edge of the green, where a player walks off toward the next tee.
  await stand('02-green-walkoff', { x: plan.green.x + 5.0, z: plan.green.z + 5.0 }, plan.yawDown + Math.PI, -0.24);
  // THE CONTROL STATION: mid-fairway, away from both.
  await stand('03-midfairway-control', plan.mid, plan.yawDown, -0.20);

  fs.writeFileSync(`${OUT}/wear.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
