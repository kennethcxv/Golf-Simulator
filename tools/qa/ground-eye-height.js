// STEP ONE OF THE COURSE — JUDGE THE GROUND WHERE THE PLAYER STANDS.
//
// The brief is explicit about where this is judged: "IN GAME, standing on the
// course, at eye height and looking down the hole". Not the editor's planning
// camera, which looks down from sixty yards and cannot tell a normal map from
// a tint, and not a cropped tile.
//
// So this walks the player onto the course with `scene3d.walk.enter`, aims down
// the playing line of hole 1, and shoots at the DEFAULT player camera at owner
// resolution. Six stands, one per surface the brief names:
//
//   tee_down_the_hole   the tee box, looking at the green
//   fairway_down        mid-fairway, same direction -- the 95%-of-every-frame shot
//   fairway_at_feet     same spot, looking DOWN. The mow pattern must nearly
//                       vanish here; that is the whole point of the change, and
//                       a stripe that is as strong underfoot as at the horizon
//                       is the painted-on version.
//   fairway_turned      same spot, turned 180 degrees. The light and dark bands
//                       must SWAP, because they are the same grass laid two ways.
//   green_surface       standing on the green
//   bunker_edge         beside a bunker, for the sand
//   cart_path           on a path, for the concrete
//
// It also reports what the shader actually bound -- texture units, whether the
// program linked, and the terrain's roughness/normal wiring -- because a
// beautiful frame proves nothing if the ground silently fell back to the
// procedural canvas.
//
//   node tools/qa/run-electron.cjs tools/qa/ground-eye-height.js --clubhouse=pine-hills-v2
//
// OUT_DIR controls where the frames land (default qa/ground/).
async (page, electronApp) => {
  const fs = await import('node:fs/promises');
  const outDir = process.env.OUT_DIR || 'qa/ground';
  await fs.mkdir(outDir, { recursive: true });

  const errors = [];
  const shaderLog = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Program Info Log|ERROR:|shader/i.test(t)) shaderLog.push(`${m.type()}: ${t}`);
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/vendor\/textures/.test(u)) errors.push(`TEXTURE 404: ${u}`);
  });

  const boot = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d,
    null,
    { timeout: 120000 },
  );
  // 180 s and a catch, matching every other Electron driver here: a COLD
  // profile puts the shader-compile screen in front of the veil, and this run
  // adds eight new ground textures to what it has to compile. A hard 120 s
  // failed the first attempt with no frames at all and no diagnosis.
  let veilCleared = true;
  try {
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 180000 });
  } catch {
    veilCleared = false;
  }
  await page.waitForTimeout(2500);

  const cap = await boot.ownerResolution(page, electronApp);

  // Fixed weather and a pinned clock: two runs of this must be comparable, and
  // the ground's whole subject is how light falls on it.
  await page.evaluate(() => {
    const w = window.__fw.state.weather;
    w.locked = true;
    w.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
    // state.clock.minutes, not hour/minute: the first run set fields that do
    // not exist and every frame came back at 6:02 AM, which put a dawn sun on
    // eight screenshots meant to judge a surface by how light falls on it.
    const c = window.__fw.state.clock;
    if (c) c.minutes = 10 * 60 + 30;
  });
  await page.waitForTimeout(1800);
  const clockAt = await page.evaluate(() => window.__fw.state.clock?.minutes ?? null);
  if (clockAt === null || Math.abs(clockAt - 630) > 90) {
    throw new Error(`the clock pin did not take: minutes=${clockAt}. Every frame would be `
      + 'judged under whatever light the boot happened to leave, which is how eight dawn '
      + 'screenshots were once read as a surface fault.');
  }

  // Where hole 1 is, in world yards, read from the sim rather than guessed.
  const holePlan = await page.evaluate(() => {
    const st = window.__fw.state;
    const course = st.course;
    const CELL = 8;
    const worldW = course.w * CELL;
    const worldH = course.h * CELL;
    const toWorld = (p) => ({ x: p.x * CELL - worldW / 2, z: p.y * CELL - worldH / 2 });
    const h = (course.vec.holes || [])[0];
    if (!h) return null;
    const line = h.line || [];
    const tee = toWorld(line[0]);
    const green = toWorld(line[line.length - 1]);
    const mid = toWorld(line[Math.floor(line.length * 0.55)]);
    const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
    const bunker = (h.bunkers || [])[0];
    const bunkerPt = bunker && bunker.pts && bunker.pts.length
      ? toWorld(bunker.pts.reduce((a, p) => ({ x: a.x + p.x / bunker.pts.length, y: a.y + p.y / bunker.pts.length }), { x: 0, y: 0 }))
      : null;
    const path = (course.paths || [])[0];
    const pathPt = path && path.pts && path.pts.length > 2 ? toWorld(path.pts[Math.floor(path.pts.length / 2)]) : null;
    const greenCentre = h.green && h.green.pts && h.green.pts.length
      ? toWorld(h.green.pts.reduce((a, p) => ({ x: a.x + p.x / h.green.pts.length, y: a.y + p.y / h.green.pts.length }), { x: 0, y: 0 }))
      : green;
    return {
      tee, mid, green, greenCentre, bunkerPt, pathPt,
      yawDown: yawTo(tee, green),
      yawMid: yawTo(mid, green),
    };
  });
  if (!holePlan) throw new Error('no hole 1 in the course vector — nothing to stand on');

  // What the terrain material actually bound. A frame that looks right while the
  // ground quietly fell back to the canvas procedural is the exact shape of
  // every instrument fault on record, so ask before shooting.
  const wiring = await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    let terrain = null;
    sc.scene.traverse((o) => { if (o.name === 'CourseTerrain') terrain = o; });
    if (!terrain) return { found: false };
    const m = terrain.material;
    const u = m.userData?.shaderUniforms || null;
    const imgOf = (t) => (t && t.image
      ? { w: t.image.width || t.image.naturalWidth || 0, h: t.image.height || t.image.naturalHeight || 0,
        src: (t.image.currentSrc || t.image.src || '').split('/').slice(-1)[0] || 'canvas/data' }
      : null);
    const info = window.__fw.renderer ? window.__fw.renderer.info : null;
    return {
      found: true,
      programError: !!m.userData?.programError,
      map: imgOf(m.map),
      normalMap: imgOf(m.normalMap),
      normalScale: m.normalScale ? [m.normalScale.x, m.normalScale.y] : null,
      uniformSamplers: u ? Object.keys(u).filter((k) => u[k]?.value?.isTexture).length : null,
      programs: info?.programs?.length ?? null,
    };
  });

  const shots = [];
  async function stand(name, pos, yaw, pitch = -0.12, settle = 1400) {
    const placed = await page.evaluate(([p, y, pi]) => {
      const sc = window.__fw.scene3d;
      if (!sc.walk.isActive()) sc.walk.enter({ x: p.x, z: p.z, yaw: y });
      const st = sc.walk.state;
      st.x = p.x; st.z = p.z; st.yaw = y; st.pitch = pi;
      return { x: st.x, z: st.z, yaw: st.yaw, pitch: st.pitch, active: sc.walk.isActive() };
    }, [pos, yaw, pitch]);
    await page.waitForTimeout(settle);
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path });
    // The drawn camera, not the requested one: the walker is pushed out of
    // colliders and the rig eases, so where it ENDED is the only honest label.
    const drawn = await page.evaluate(() => {
      const c = window.__fw.scene3d.camera;
      c.updateMatrixWorld(true);
      const e = c.matrixWorld.elements;
      return { x: +e[12].toFixed(2), y: +e[13].toFixed(2), z: +e[14].toFixed(2), fov: c.fov };
    });
    shots.push({ name, path, asked: { ...pos, yaw, pitch }, placed, drawn });
    return drawn;
  }

  await stand('01_tee_down_the_hole', holePlan.tee, holePlan.yawDown, -0.10);
  await stand('02_fairway_down', holePlan.mid, holePlan.yawMid, -0.10);
  await stand('03_fairway_at_feet', holePlan.mid, holePlan.yawMid, -0.85);
  await stand('04_fairway_turned', holePlan.mid, holePlan.yawMid + Math.PI, -0.10);
  await stand('05_green_surface', holePlan.greenCentre, holePlan.yawMid, -0.35);
  if (holePlan.bunkerPt) await stand('06_bunker_edge', holePlan.bunkerPt, holePlan.yawMid, -0.30);
  if (holePlan.pathPt) await stand('07_cart_path', holePlan.pathPt, holePlan.yawMid, -0.45);

  // WET vs DRY, because "a different roughness wet versus dry" is one of the
  // named requirements and it is invisible in a still unless it is driven.
  //
  // state.TURF.moisture, 0..100, not state.course.moisture. The first run wrote
  // a field that does not exist and produced a "soaked" frame identical to the
  // dry one, which would have been reported as "the wet look is subtle".
  const soak = await page.evaluate(() => {
    const t = window.__fw.state.turf;
    if (!t || !t.moisture) return { ok: false, why: 'state.turf.moisture missing' };
    const before = t.moisture[Math.floor(t.moisture.length / 2)];
    for (let i = 0; i < t.moisture.length; i += 1) t.moisture[i] = 100;
    window.__fw.scene3d.markCourseDirty?.();
    window.__fw.scene3d.refreshCourseTextures?.();
    return { ok: true, before, after: t.moisture[Math.floor(t.moisture.length / 2)] };
  });
  if (!soak.ok || soak.after !== 100) {
    throw new Error(`the soak did not take (${JSON.stringify(soak)}) — a wet frame that is `
      + 'the dry frame would be reported as "the difference is subtle"');
  }
  await page.waitForTimeout(2500);
  await stand('08_fairway_soaked', holePlan.mid, holePlan.yawMid, -0.20);

  // ------------------------------------------------------------------ MOW A/B
  //
  // Whether the mowing reads is not a thing to judge by looking at one frame
  // and saying "I think I see bands". Force the stripe uniform off, shoot,
  // force it on, shoot, and DIFF: the difference image IS the mow pattern, and
  // nothing else in the scene moved.
  //
  // Two numbers come out of it that the old implementation could not have
  // produced. `far` is how strongly the bands read toward the horizon and
  // `near` is how strongly they read at the player's feet; the reference
  // photograph (mow/cambridge_stripes.jpg) has the first much larger than the
  // second, and the old `col *= 1.0 + band * amp` had them equal by
  // construction because it did not know where the camera was.
  const stripeState = await page.evaluate(() => {
    const sc = window.__fw.scene3d;
    const pol = window.__fw.state.maintenance?.policies || {};
    return {
      policy: { green: pol.green?.pattern, fairway: pol.fairway?.pattern, tee: pol.tee?.pattern },
      uniform: sc.terrainStripeModes ? sc.terrainStripeModes() : null,
    };
  });

  const setStripes = (on) => page.evaluate((v) => {
    const sc = window.__fw.scene3d;
    return sc.setTerrainStripeModes ? sc.setTerrainStripeModes(v) : null;
  }, on ? 1 : 0);

  const setViewDep = (on) => page.evaluate((v) => {
    const sc = window.__fw.scene3d;
    return sc.setMowViewDependence ? sc.setMowViewDependence(v) : null;
  }, on);

  const abPair = async (tag, viewDep) => {
    await setViewDep(viewDep);
    await setStripes(false);
    await page.waitForTimeout(900);
    await stand(`${tag}_mow_off`, holePlan.mid, holePlan.yawMid, -0.10);
    await setStripes(true);
    await page.waitForTimeout(900);
    await stand(`${tag}_mow_on`, holePlan.mid, holePlan.yawMid, -0.10);
  };
  await abPair('09', true);    // what ships
  await abPair('11', false);   // THE CONTROL: the flat multiply this replaced
  await setViewDep(true);

  let mowDiff = null;
  try {
    const sharp = (await import('sharp')).default;
    const read = async (f) => {
      const { data, info } = await sharp(`${outDir}/${f}`).removeAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      return { data, w: info.width, h: info.height, ch: info.channels };
    };
    const bands = async (offFile, onFile) => {
      const a = await read(offFile);
      const b = await read(onFile);
      // The HUD sits in the top and bottom strips; the ground fills the middle.
      // Band the frame by height so "near" and "far" mean what they say.
      const bandOf = (y) => (y < a.h * 0.52 ? null : (y < a.h * 0.68 ? 'far' : (y > a.h * 0.88 ? 'near' : 'mid')));
      const acc = { far: [0, 0], mid: [0, 0], near: [0, 0] };
      for (let y = 0; y < a.h; y += 1) {
        const band = bandOf(y);
        if (!band) continue;
        for (let x = Math.floor(a.w * 0.25); x < Math.floor(a.w * 0.75); x += 1) {
          const i = (y * a.w + x) * a.ch;
          const la = (a.data[i] * 0.299 + a.data[i + 1] * 0.587 + a.data[i + 2] * 0.114);
          const lb = (b.data[i] * 0.299 + b.data[i + 1] * 0.587 + b.data[i + 2] * 0.114);
          acc[band][0] += Math.abs(lb - la);
          acc[band][1] += 1;
        }
      }
      const m = (k) => +(acc[k][0] / Math.max(1, acc[k][1])).toFixed(3);
      return { far: m('far'), mid: m('mid'), near: m('near'), ratio: +(m('far') / Math.max(1e-6, m('near'))).toFixed(2) };
    };
    const shipped = await bands('09_mow_off.png', '09_mow_on.png');
    const control = await bands('11_mow_off.png', '11_mow_on.png');
    mowDiff = {
      shipped,
      control,
      note: 'mean |luma| difference (0-255) between a mow-off and a mow-on frame, by depth band. '
        + '`shipped` is the view-dependent mechanism; `control` is the flat albedo multiply it '
        + 'replaced, measured in the same boot. far/near ratio near 1 means the pattern does not '
        + 'know where the camera is, which is the fault.',
    };
  } catch (e) {
    mowDiff = { error: String(e && e.message) };
  }

  return {
    clockAt,
    soak,
    stripeState,
    mowDiff,
    windowCaption: cap.caption,
    veilCleared,
    wiring,
    hole: holePlan,
    shots,
    shaderLog: shaderLog.slice(0, 12),
    errors: errors.slice(0, 20),
    errorCount: errors.length,
  };
}
