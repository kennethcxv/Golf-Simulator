// THE FRAME THAT DECIDES, which six revisions never took.
//
// Every one of those revisions was reviewed on a Blender macro at close range
// against a product photograph. That is not where the owner sees these. This
// stands the two garments the v7 brief scoped -- the FOLDED POLO on a shelf and
// the HUNG HOODIE on a rail -- in the live clubhouse, at the default player
// camera, in clubhouse light, and shoots them from the distance a player
// browses at AND from across the room.
//
// FOUR THINGS IN HERE ARE SCAR TISSUE, all from this one driver:
//
//   The player moves, the garment does not. The first cut put the garment
//   three metres ahead for the far shot and the shop floor is three metres
//   across, so "across the room" was a photograph of a wall.
//
//   Never compute where the camera will point -- turn it, wait, and READ it.
//   Rotating `fwd` by hand and assuming walk.state.yaw turns the same way put
//   the hoodie off frame entirely while the driver reported it unobstructed
//   and filling the screen.
//
//   The camera lags walk.state by a frame. Measuring in the same evaluate that
//   moved the player reported the previous shot's distance every time.
//
//   Occlusion and aim are different questions. A ray cast at the garment
//   proves nothing is in front of it and says nothing about whether the camera
//   is looking that way. Both are checked now.
//
//   node tools/qa/run-electron.cjs tools/qa/apparel-v7-shelf.js \
//        --clubhouse=pine-hills-v2
//
// V7_CONTROL=wall pins the garment through the wall: the blocker check must
// fire. APPAREL_DIR points it at another build; a tree whose GLBs predate the
// bake is the map control -- every cloth material must report no maps.
//
async (page) => {
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  const boot = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 180000 });
  } catch {
    console.log('load veil still up after 180 s -- continuing');
  }
  await page.waitForTimeout(2500);

  // Shop floor, 2 p.m., lights on. The game opens OUTSIDE at 6 a.m. in the rain
  // in a dilapidated shop, and a garment photographed there is a silhouette --
  // a picture of the starter state, not of the asset.
  const home = await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4;
    w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    w.state.vx = 0; w.state.vz = 0;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k];
      if (v && v.isCamera) { cam = v; break; }
    }
    if (!cam) throw new Error('no camera found on scene3d');
    window.__v7cam = cam;
    let s = cam; while (s.parent) s = s.parent;
    window.__v7scene = s;
    return { x: w.state.x, z: w.state.z, clock: app.state.clock.minutes };
  });
  console.log(`staged: ${JSON.stringify(home)}`);
  await page.waitForTimeout(2000);

  // WHICH WAY DOES A POSITIVE YAW TURN? Measure it, do not assume it.
  //
  // The sightline search rotates a forward vector in its own convention to
  // find a clear bearing and then writes that angle into walk.state.yaw. Those
  // two conventions are opposite here, so the search kept certifying one
  // direction and the camera kept turning to the other -- clear at -30, shot
  // at +30, straight through a window pier. This turns the head a known amount
  // and reads back what the world actually did.
  const readFwd = () => page.evaluate(async () => {
    const THREE = await import('three');
    const cam = window.__v7cam;
    cam.updateMatrixWorld(true);
    const f = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    f.y = 0; f.normalize();
    return { x: f.x, z: f.z };
  });
  const f0 = await readFwd();
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw += 0.35; });
  await page.waitForTimeout(450);
  const f1 = await readFwd();
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw -= 0.35; });
  await page.waitForTimeout(450);
  const turned = Math.atan2(f0.x * f1.z - f0.z * f1.x, f0.x * f1.x + f0.z * f1.z);
  const YAW_SIGN = turned < 0 ? -1 : 1;
  console.log(`yaw calibration: +0.350 rad of walk.state.yaw turned the camera `
    + `${turned.toFixed(3)} rad -- sign ${YAW_SIGN}`);
  if (Math.abs(Math.abs(turned) - 0.35) > 0.05) {
    console.log(`  WARNING: the magnitude does not match either, `
      + `|${Math.abs(turned).toFixed(3)}| vs 0.350`);
  }
  await page.evaluate((s) => { window.__v7yawSign = s; }, YAW_SIGN);

  const DIR = process.env.APPAREL_DIR || 'Assets/models/hero/v5';
  const OFF = process.env.V7_OFF || '';
  await page.evaluate((o) => { window.__v7off = o; }, OFF);
  await page.evaluate((p) => { window.__v7parent = p; }, process.env.V7_PARENT || '');
  console.log(`loading from ${DIR}${OFF ? `   A/B: ${OFF} switched OFF` : ''}`);

  // name, file, origin rule, height off the floor, display, centre relative
  // to the origin. The last number is what the sightline is probed along: the
  // first cut probed at EYE level, found 3.18 m clear, and then hung the
  // folded polo at 1.02 m where the ray to it goes down through a window pier.
  // A clearance measured along a different ray than the one the camera uses is
  // not a clearance.
  //
  // ALL ELEVEN, because only two of them have ever had this frame. The hung
  // hoodie and the folded polo were taken to twelve rounds each; the other
  // nine were carried along by whatever fix those two needed and then verified
  // in the FILE -- assert_maps.mjs opens the GLB and reads the PNG bytes, which
  // says the maps are there and nothing whatever about whether the thing looks
  // like a garment in a shop.
  //
  // Heights and centres are MEASURED off each GLB, not guessed: hung garments
  // carry max y = 0 and hang from the hook, resting ones carry min y = 0 and
  // sit on their own base, and the centre offset is half the real drop or
  // height so the sightline is probed along the ray the camera will use.
  const APPAREL_SUBJECTS = [
    // hung on the rail -- the hook is the origin, the drop is real
    ['polo-hung', 'apparel_polo_hung.glb', 'hook', 1.66, 'rail', -0.40],
    ['tee-hung', 'apparel_tee_hung.glb', 'hook', 1.66, 'rail', -0.40],
    ['hoodie-hung', 'apparel_hoodie_hung.glb', 'hook', 1.66, 'rail', -0.46],
    ['trousers-hung', 'apparel_trousers_hung.glb', 'hook', 1.66, 'rail', -0.60],
    // folded on the shelf -- base at zero
    ['polo-folded', 'apparel_polo_folded.glb', 'base', 1.02, 'shelf', +0.03],
    ['tee-folded', 'apparel_tee_folded.glb', 'base', 1.02, 'shelf', +0.027],
    ['hoodie-folded', 'apparel_hoodie_folded.glb', 'base', 1.02, 'shelf', +0.046],
    ['trousers-folded', 'apparel_trousers_folded.glb', 'base', 1.02, 'shelf', +0.024],
    ['towel', 'hard_towel.glb', 'base', 1.02, 'shelf', +0.035],
    ['cap', 'apparel_cap.glb', 'base', 1.02, 'shelf', +0.068],
    // THE PEG CAP IS THE ODD ONE and it must not be staged like the others.
    // Its origin is the WALL PLANE (z runs 0 .. +0.331, y straddles zero), so
    // it is not resting on anything and it is not hanging from a hook -- it
    // sticks out of a wall. Standing it on a shelf would photograph it lying
    // on its side and call the result a fault in the asset.
    ['cap-peg', 'apparel_cap_peg.glb', 'wall', 1.52, 'peg', 0.0],
  ];
  // THE FOUR HARDGOODS. A club stands on the floor in a rack rather than
  // sitting on a board, so they get no fixture -- a shelf under a driver would
  // be staging that misrepresents how the thing is displayed.
  // A club standing on the FLOOR is a metre tall and the camera ends up
  // pitched 62 degrees down at it from 0.6 m, which foreshortens the whole
  // thing into a stick lying on the tiles -- the milled face and the corded
  // grip, which are the entire point of baking these, cannot be judged from
  // that frame at all. A shop stands clubs in a RACK, head down at about knee
  // height, and the last number here aims the camera at the HEAD rather than
  // at the middle of a metre of shaft.
  const HARDGOOD_SUBJECTS = [
    ['driver', 'hard_driver.glb', 'base', 0.78, 'shelf', +0.10],
    ['putter', 'hard_putter.glb', 'base', 0.78, 'shelf', +0.08],
    ['iron', 'hard_iron.glb', 'base', 0.78, 'shelf', +0.08],
    // The counter is 2.4 m wide: browsing it from 0.6 m puts the camera
    // INSIDE it, and the aim check said so -- 7.23 half-frames off axis. A
    // player walks up to a counter, they do not stand in it.
    ['counter', 'hard_counter.glb', 'base', 0.0, 'none', +0.45, 1.70],
  ];
  const SET = process.env.V7_SET === 'hardgoods'
    ? HARDGOOD_SUBJECTS : APPAREL_SUBJECTS;
  // Eleven subjects x two distances in one boot is a long run, and a re-shoot
  // of one garment after a fix should not cost the other ten. V7_ONLY takes a
  // comma-separated list of subject names.
  const ONLY = (process.env.V7_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const SUBJECTS = ONLY.length ? SET.filter(([n]) => ONLY.includes(n)) : SET;
  if (ONLY.length && SUBJECTS.length !== ONLY.length) {
    const got = SUBJECTS.map(([n]) => n);
    throw new Error(`V7_ONLY named ${ONLY.length} subject(s) but matched ${SUBJECTS.length}`
      + ` (${got.join(', ') || 'none'}) -- a typo would silently shoot the wrong set`);
  }
  const CONTROL = process.env.V7_CONTROL === 'wall';
  const ANCHOR = CONTROL ? 4.5 : 2.55;
  const DISTANCES = CONTROL
    ? [['wallcontrol', 4.5]]
    : [['room', 2.55], ['browse', 0.85]];
  // A hardgood surface is a CLOSE-RANGE read -- a milled face and a corded
  // grip are what a player looks at when the club is in front of them -- so
  // the near frame comes in tighter than a garment's.
  if (SET === HARDGOOD_SUBJECTS && !CONTROL) DISTANCES[1] = ['browse', 0.60];
  if (CONTROL) console.log('NEGATIVE CONTROL: the garment is inside the wall');

  const rows = [];
  // WHERE THE PLAYER WAS STAGED. Every subject starts from here. Without this
  // the loop walked: subject N's home was subject N-1's BROWSE position, so
  // after a few garments the player was pressed into a wall and the browse
  // move had nowhere to go -- "asked to shoot from 0.85 m and the camera was
  // at 2.55 m", nine times out of eleven, on a run that otherwise looked fine.
  const BASE = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    return { x: w.state.x, z: w.state.z, yaw: w.state.yaw };
  });

  // V7_HEIGHT overrides every subject's height off the floor. The hung
  // garments measure 1-6% of full value on screen and the folded ones 30-44%
  // -- same garment, same albedo, same maps -- and the two differ in BOTH
  // height (1.66 m vs 1.02 m) and surface orientation (vertical vs facing the
  // ceiling). This separates them: hang them at shelf height and see which
  // number follows.
  const HEIGHT_OVERRIDE = process.env.V7_HEIGHT ? Number(process.env.V7_HEIGHT) : null;
  for (const [name, file, rule, heightAuthored, display, centreY, nearOverride] of SUBJECTS) {
    const height = HEIGHT_OVERRIDE ?? heightAuthored;
    // --- 1. TURN, THEN LOOK. -----------------------------------------------
    //
    // This used to rotate a forward vector in its own convention, pick the
    // clear bearing, write it to walk.state.yaw and trust it. Two things went
    // wrong with that and both were silent. The hand-rolled rotation turns the
    // opposite way to the game's yaw, so the sweep certified -30 deg and the
    // camera went to +30 -- through a pier. And the sign was established by a
    // one-shot calibration that came back 0.000 rad on this run and defaulted
    // to +1, which is how ELEVEN garments ended up photographed inside
    // MESH_InteriorWarmCreamPlasterLiners while the maps table printed beside
    // them still said MAPS 2/3 and looked like a result.
    //
    // So: no prediction and no sign. Turn the head to a candidate, let the
    // game tick, and measure the clearance along the direction the camera is
    // ACTUALLY facing. The first bearing that really clears is the one used.
    await page.evaluate((b) => {
      const w = window.__fw.scene3d.walk;
      w.state.x = b.x; w.state.z = b.z; w.state.yaw = b.yaw;
      w.state.pitch = 0; w.state.vx = 0; w.state.vz = 0;
      // AND TAKE THE LAST GARMENT DOWN FIRST. The placement step clears the
      // probe, but it runs AFTER this sweep -- so subject N was choosing its
      // bearing with subject N-1 still hanging in the room, and the clearest
      // line in the shop reads as blocked by the thing we just photographed.
      const prev = window.__v7scene.getObjectByName('__v7probe');
      if (prev) prev.parent.remove(prev);
    }, BASE);
    await page.waitForTimeout(450);

    const measure = () => page.evaluate(async ([ANCHOR, height, centreY]) => {
      const THREE = await import('three');
      const cam = window.__v7cam;
      const scene = window.__v7scene;
      cam.updateMatrixWorld(true);
      const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const q = cam.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      fwd.y = 0; fwd.normalize();
      const probe = new THREE.Raycaster();
      probe.camera = cam;
      probe.layers.enableAll();
      const floorY = eye.y - 1.62;
      // Clearance ALONG THE RAY THE CAMERA WILL ACTUALLY USE: eye to where the
      // garment's middle will sit, not along the horizon.
      const clearance = (dropY) => {
        const target = eye.clone().add(fwd.clone().multiplyScalar(ANCHOR));
        target.y = floorY + height + dropY;
        const ray = target.clone().sub(eye);
        const len = ray.length();
        probe.set(eye, ray.clone().normalize());
        probe.near = 0.05; probe.far = 12.0;
        // AND IGNORE WHAT IS PARENTED TO THE CAMERA. `HeldWasher`, `Tool_mop`
        // and `Tool_vacuum` are prewarmed held-tool viewmodels with visible
        // arm meshes even when state.tool is null, and they hang off the
        // camera -- so they sit ~1.17 m in front of the eye no matter which
        // way the head turns. The sweep reported "NO CLEAR LINE" at every one
        // of ten bearings, all of them 1.17 m, which is not a room, it is a
        // sleeve. The occlusion check already excluded these; the sightline
        // that chooses where to stand did not.
        const camOwned = (obj) => {
          let n = obj;
          while (n) { if (n === cam) return true; n = n.parent; }
          return false;
        };
        const h = probe.intersectObject(scene, true)
          .filter((x) => x.object.visible && x.object.material && !camOwned(x.object));
        return (h.length ? h[0].distance : 99) * (ANCHOR / Math.max(len, 1e-6));
      };
      // the middle of the garment and its extremes -- a rail passes over a
      // counter that a hem does not
      return Math.min(clearance(centreY), clearance(centreY + 0.35),
        clearance(centreY - 0.35));
    }, [ANCHOR, height, centreY]);

    let best = { deg: 0, clear: -1 };
    let why = null;
    const sweep = CONTROL ? [0] : [0, -30, 30, -60, 60, -90, 90, -150, 150, 180];
    for (const deg of sweep) {
      await page.evaluate(([b, d]) => {
        window.__fw.scene3d.walk.state.yaw = b.yaw + d * Math.PI / 180;
      }, [BASE, deg]);
      await page.waitForTimeout(260);
      const c = await measure();
      if (c > best.clear) best = { deg, clear: c };
      if (c > ANCHOR + 0.45) { why = `${deg} deg, ${c.toFixed(2)} m clear (verified after turning)`; break; }
    }
    if (why === null) {
      why = `NO CLEAR LINE -- best ${best.deg} deg at ${best.clear.toFixed(2)} m`;
    }
    await page.evaluate(([b, d]) => {
      window.__fw.scene3d.walk.state.yaw = b.yaw + d * Math.PI / 180;
    }, [BASE, best.deg]);
    const aim = { why, turn: best.deg, clear: +best.clear.toFixed(2) };
    await page.waitForTimeout(500);

    // --- 2. read the camera back, then place along the REAL forward --------
    const placed = await page.evaluate(async ([file, rule, height, display, DIR, ANCHOR, centreY, aimAtOrigin]) => {
      const app = window.__fw;
      const THREE = await import('three');
      const mod = await import('./src/render3d/gltfCache.js');
      const loader = new mod.CachedGLTFLoader();
      const cam = window.__v7cam;
      const scene = window.__v7scene;

      cam.updateMatrixWorld(true);
      const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const q = cam.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const floorY = eye.y - 1.62;

      const prev = scene.getObjectByName('__v7probe');
      if (prev) prev.parent.remove(prev);
      const holder = new THREE.Group();
      holder.name = '__v7probe';
      // WHOSE CHILD IS THE GARMENT? It has always been the SCENE's, and that
      // is a hypothesis nobody tested: the shop's own contents hang off the
      // clubhouse INTERIOR group, and if any light, layer or shadow decision
      // is scoped to that subtree then a garment parented to the scene root is
      // lit by a different room than the one it is being judged in. The hung
      // garments measure 1-6% of full value and the folded ones 30-44%, which
      // is a 30:1 difference no albedo explains -- so before that is reported
      // as a room fault it has to be ruled out as a staging one.
      // V7_PARENT=interior mounts it where the shop's own props live.
      let mount = scene;
      if (window.__v7parent === 'interior') {
        const inter = app.scene3d.clubhouse()?.interior;
        if (inter) mount = inter;
      }
      mount.add(holder);
      // world-space `at` is computed below off the camera, so if the mount has
      // its own transform the holder has to undo it or the garment lands in
      // the wrong room entirely
      mount.updateMatrixWorld(true);
      holder.matrixAutoUpdate = true;
      if (mount !== scene) {
        const inv = new THREE.Matrix4().copy(mount.matrixWorld).invert();
        holder.applyMatrix4(inv);
      }

      const g = await new Promise((res, rej) =>
        loader.load(`${DIR}/${file}`, res, undefined, rej));
      const root = (g.scene || g.scenes[0]).clone(true);
      const at = eye.clone().add(fwd.clone().multiplyScalar(ANCHOR));
      at.y = floorY + height;
      root.position.copy(at);
      root.rotation.y = Math.atan2(-fwd.x, -fwd.z);
      holder.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);

      // THE FIXTURE. "On a shelf or a rail" is part of what the brief asked to
      // be judged, and the first cut's folded polo hovered over bare floor
      // like a slab. Driver staging, the way the studio's shelf was; it is not
      // part of any asset and it does not ship.
      if (display === 'none') {
        // nothing: it stands on the floor
      } else if (display === 'peg') {
        // A WALL, because that is what it is mounted to. Behind the subject
        // along the camera's forward, not under it.
        const panel = new THREE.MeshStandardMaterial({
          color: 0x5f5852, roughness: 0.86, metalness: 0.0,
        });
        const bd = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.03), panel);
        bd.position.set(at.x - fwd.x * 0.02, at.y, at.z - fwd.z * 0.02);
        bd.rotation.y = Math.atan2(-fwd.x, -fwd.z);
        holder.add(bd);
      } else if (display === 'shelf') {
        const board = new THREE.MeshStandardMaterial({
          color: 0x6b6259, roughness: 0.78, metalness: 0.0,
        });
        const w = (box.max.x - box.min.x) + 0.22;
        const d = (box.max.z - box.min.z) + 0.16;
        const bd = new THREE.Mesh(new THREE.BoxGeometry(w, 0.032, d), board);
        bd.position.set(at.x, at.y - 0.016, at.z);
        holder.add(bd);
      } else {
        const steel = new THREE.MeshStandardMaterial({
          color: 0xa8abaf, roughness: 0.30, metalness: 0.85,
        });
        const bar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.016, 0.016, 1.9, 16), steel);
        bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), right);
        bar.position.set(at.x, at.y + 0.002, at.z);
        holder.add(bar);
      }

      const mats = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) {
          if (!m || mats.some((x) => x.m === m)) continue;
          mats.push({ m, mesh: o });
        }
      });
      const maps = mats.map(({ m, mesh }) => ({
        name: m.name,
        normal: !!m.normalMap,
        ao: !!m.aoMap,
        rough: !!m.roughnessMap,
        aoChan: m.aoMap ? (m.aoMap.channel ?? 0) : null,
        hasUv1: !!mesh.geometry.attributes.uv1,
        // COLOR_0 IS THE BAKED MACRO OCCLUSION and it does nothing unless the
        // material opts in. The attribute being in the file is not the same as
        // the shader reading it -- the same gap as normalTexture, one level
        // down -- so ask the material, not the geometry.
        vcol: !!m.vertexColors,
        hasCol0: !!mesh.geometry.attributes.color,
        colour: m.color ? [+m.color.r.toFixed(3), +m.color.g.toFixed(3),
          +m.color.b.toFixed(3)] : null,
      }));

      // A/B SWITCHES, applied in the renderer so a hypothesis costs one run
      // rather than one export. V7_OFF=normal zeroes the normal map, =ao
      // switches off the baked vertex occlusion, =both does both. The hood
      // reads as pale glossy plastic on a navy material and the candidates --
      // normal-map aliasing where the pattern UV is compressed, or the
      // occlusion, or the geometry itself -- are only distinguishable by
      // turning them off one at a time.
      const OFF = window.__v7off || '';
      if (OFF) {
        for (const { m } of mats) {
          if (OFF.includes('normal') && m.normalMap) m.normalScale.set(0, 0);
          if (OFF.includes('ao')) m.vertexColors = false;
          m.needsUpdate = true;
        }
      }

      const err = rule === 'hook' ? box.max.y - at.y
        : rule === 'wall' ? (box.max.y + box.min.y) / 2 - at.y
        : box.min.y - at.y;
      const size = box.getSize(new THREE.Vector3());
      window.__v7fwd = { x: fwd.x, z: fwd.z };
      window.__v7home = { x: app.scene3d.walk.state.x, z: app.scene3d.walk.state.z };
      window.__v7aim = aimAtOrigin ? { x: at.x, y: at.y + centreY, z: at.z } : null;
      return {
        maps,
        originErrMm: +(err * 1000).toFixed(1),
        sizeMm: [size.x, size.y, size.z].map((v) => +(v * 1000).toFixed(0)),
      };
      // SIX ARGUMENTS WERE BEING PASSED TO AN EIGHT-ARGUMENT LIST. `centreY`
      // and `aimAtOrigin` arrived undefined, so the aim override was always
      // null and the counter was framed on its bounding-box centre after all --
      // the fix written for it never ran. Nothing reported this, because a
      // missing argument is not an error in JavaScript, it is `undefined`.
    }, [file, rule, height, display, DIR, ANCHOR, centreY, !!nearOverride]);
    console.log(`\n${name}: sightline ${aim.why}`);

    for (const [tag, baseDist] of DISTANCES) {
      const dist = (tag === 'browse' && nearOverride) ? nearOverride : baseDist;
      const moved = await page.evaluate(async ([dist, ANCHOR]) => {
        const w = window.__fw.scene3d.walk;
        const f = window.__v7fwd;
        const h = window.__v7home;
        const back = ANCHOR - dist;
        const want = { x: h.x + f.x * back, z: h.z + f.z * back };
        w.state.x = want.x;
        w.state.z = want.z;
        w.state.vx = 0; w.state.vz = 0;
        return { want, immediately: { x: w.state.x, z: w.state.z } };
      }, [dist, ANCHOR]);
      // WHO PUT IT BACK? The browse frame kept coming out at the room distance
      // and the only reason it was noticed is the requested-vs-measured
      // assertion. Read walk.state again AFTER the tick: if it snapped back,
      // the walk simulation rejected the position (a collider), and if it held
      // but the camera did not follow, the camera is not driven by state.
      await page.waitForTimeout(350);
      const settled = await page.evaluate(() => {
        const w = window.__fw.scene3d.walk;
        return { x: w.state.x, z: w.state.z };
      });
      const slip = Math.hypot(settled.x - moved.want.x, settled.z - moved.want.z);
      if (slip > 0.05) {
        console.log(`  move ${tag}: asked for (${moved.want.x.toFixed(2)}, ${moved.want.z.toFixed(2)}), `
          + `walk.state settled at (${settled.x.toFixed(2)}, ${settled.z.toFixed(2)}) `
          + `-- ${slip.toFixed(2)} m of slip, the sim moved the player back`);
      }
      // Let the game tick, THEN look: the camera lags walk.state by a frame
      // and measuring in the same evaluate reported the previous position.
      await page.waitForTimeout(500);
      const view = await page.evaluate(async () => {
        const THREE = await import('three');
        const cam = window.__v7cam;
        const w = window.__fw.scene3d.walk;
        cam.updateMatrixWorld(true);
        const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const holder = window.__v7scene.getObjectByName('__v7probe');
        const box = new THREE.Box3().setFromObject(holder.children[0]);
        const a = window.__v7aim;
        const mid = a ? new THREE.Vector3(a.x, a.y, a.z)
                      : box.getCenter(new THREE.Vector3());
        const flat = Math.hypot(mid.x - eye.x, mid.z - eye.z);
        w.state.pitch = Math.atan2(mid.y - eye.y, flat);
        return { realDist: +flat.toFixed(3),
                 pitchDeg: +(w.state.pitch * 180 / Math.PI).toFixed(1) };
      });
      await page.waitForTimeout(900);

      const seen = await page.evaluate(async () => {
        const THREE = await import('three');
        const cam = window.__v7cam;
        const scene = window.__v7scene;
        const holder = scene.getObjectByName('__v7probe');
        const garment = holder.children[0];
        cam.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(garment);

        // AIM: where the box lands on screen, CLAMPED to the viewport.
        // Unclamped, a corner behind the near plane projects to a huge number
        // and the hoodie reported 21145 px wide on a 1600 px frame while being
        // entirely absent from it.
        const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const camDir = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
        let lo = [9, 9], hi = [-9, -9], behind = 0;
        for (let i = 0; i < 8; i++) {
          const c = new THREE.Vector3(
            (i & 1) ? box.max.x : box.min.x,
            (i & 2) ? box.max.y : box.min.y,
            (i & 4) ? box.max.z : box.min.z);
          if (c.clone().sub(camPos).dot(camDir) <= 0) { behind++; continue; }
          const p = c.project(cam);
          lo = [Math.min(lo[0], p.x), Math.min(lo[1], p.y)];
          hi = [Math.max(hi[0], p.x), Math.max(hi[1], p.y)];
        }
        const spanX = Math.max(0, Math.min(hi[0], 1) - Math.max(lo[0], -1));
        const spanY = Math.max(0, Math.min(hi[1], 1) - Math.max(lo[1], -1));
        // Off axis is measured from the AIM POINT where one was given: a club
        // deliberately framed on its head has its bounding box centred half a
        // metre higher, and calling that "the camera is not looking at it"
        // would be the check misreading a deliberate composition.
        const a = window.__v7aim;
        let centre;
        if (a) {
          const q = new THREE.Vector3(a.x, a.y, a.z).project(cam);
          centre = [q.x, q.y];
        } else {
          centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
        }
        const offAxis = Math.hypot(centre[0], centre[1]);

        // OCCLUSION: is anything between the eye and it.
        //
        // SAMPLE THE SURFACE, NOT THE BOUNDING-BOX CENTRE. One ray at the
        // centre of an AABB is fine for a shirt and useless for a golf club:
        // an L of head and shaft has nothing at the middle of its box, so the
        // ray sailed past and hit the wall four metres behind, and the driver
        // was reported "BLOCKED BY GREY_WestWall_SageBand at 3.46 m" while
        // standing in clear air at 2.55 m. Take points that are actually ON
        // the object and call it blocked only if most of them are.
        const pts = [];
        garment.traverse((o) => {
          if (!o.isMesh || !o.geometry.attributes.position) return;
          const pos = o.geometry.attributes.position;
          const step = Math.max(1, Math.floor(pos.count / 6));
          for (let i = 0; i < pos.count; i += step) {
            pts.push(new THREE.Vector3().fromBufferAttribute(pos, i)
              .applyMatrix4(o.matrixWorld));
          }
        });
        if (!pts.length) pts.push(box.getCenter(new THREE.Vector3()));

        const rc = new THREE.Raycaster();
        // A Sprite raycast dereferences Raycaster.camera and this scene has
        // sprites; the shop's batched props sit on layer masks the default
        // raycaster skips.
        rc.camera = cam;
        rc.layers.enableAll();
        // IGNORE THE HELD-TOOL VIEWMODEL. `HeldWasher`, `Tool_mop` and
        // `Tool_vacuum` are prewarmed subtrees parented to the CAMERA, with
        // arm and sleeve meshes left visible even though state.tool is null.
        // They ride the camera, so they crossed a different number of sample
        // rays every run: the same driver reported "clear" and "BLOCKED BY
        // BroomLeftSleeve at 1.40 m" on two consecutive runs of the same
        // scene. A viewmodel is drawn over everything by design and is in
        // every frame -- it is not what "something is standing in front of
        // the shelf" means.
        const mine = (obj) => {
          let n = obj;
          while (n) {
            if (n === holder || n === cam) return true;
            n = n.parent;
          }
          return false;
        };
        let blockedCount = 0;
        let blocker = null;
        let hitCount = 0;
        let firstHits = [];
        for (const pt of pts) {
          const dir = pt.clone().sub(camPos);
          const len = dir.length();
          rc.set(camPos, dir.normalize());
          rc.near = 0.05;
          rc.far = len - 0.004;      // stop just short of the point itself
          const hits = rc.intersectObject(scene, true)
            .filter((x) => x.object.visible && x.object.material && !mine(x.object));
          if (hits.length) {
            blockedCount++;
            if (!blocker) {
              blocker = `${hits[0].object.name || hits[0].object.type} at `
                + `${hits[0].distance.toFixed(2)} m`;
              firstHits = hits.slice(0, 3).map((x) =>
                `${x.object.name || x.object.type}@${x.distance.toFixed(2)}`);
            }
            hitCount += hits.length;
          }
        }
        const blockedFrac = blockedCount / pts.length;
        // A hanger arm or a shelf edge clipping one sample is not "hidden".
        if (blockedFrac <= 0.6) blocker = null;

        return {
          px: [Math.round(spanX * 800), Math.round(spanY * 450)],
          offAxis: Number.isFinite(offAxis) ? +offAxis.toFixed(2) : 9.9,
          behind,
          blocker,
          samples: pts.length,
          blockedPct: Math.round(blockedFrac * 100),
          hitCount,
          firstHits,
        };
      });

      const v = { ...view, ...seen };
      const shot = `qa/hero/v7/ingame/${name}-${tag}`
        + `${OFF ? `-no-${OFF}` : ''}.png`;
      await page.screenshot({ path: shot });
      const withMaps = placed.maps.filter((m) => m.normal && m.ao && m.rough).length;
      console.log(`${name} @ ${v.realDist} m (${tag})  ${placed.sizeMm.join(' x ')} mm  `
        + `origin ${placed.originErrMm} mm  pitch ${v.pitchDeg} deg  `
        + `${v.px[0]} x ${v.px[1]} px  off-axis ${v.offAxis}  `
        + `${v.blocker ? `BLOCKED BY ${v.blocker}` : 'clear'}`);
      console.log(`  -> ${shot}   MAPS ${withMaps}/${placed.maps.length}   `
        + `${v.blockedPct}% of ${v.samples} surface samples blocked`
        + `${v.firstHits.length ? `: ${v.firstHits.join('  ')}` : ''}`);
      for (const m of placed.maps) {
        console.log(`    ${(m.name || '?').padEnd(15)} `
          + `normal ${m.normal ? 'y' : 'N'} ao ${m.ao ? 'y' : 'N'} `
          + `rough ${m.rough ? 'y' : 'N'}  aoChannel ${m.aoChan} `
          + `uv1 ${m.hasUv1 ? 'y' : 'n'}  vcol ${m.vcol ? 'y' : 'N'}`
          + `${m.hasCol0 ? '' : ' (no COLOR_0)'}  `
          + `rgb ${m.colour ? m.colour.join(',') : '-'}`);
      }
      rows.push({ name, tag, shot, wanted: dist, ...placed, ...v });
    }
  }

  const bad = [];
  for (const r of rows) {
    if (Math.abs(r.originErrMm) > 1.0) {
      bad.push(`${r.name}: origin off by ${r.originErrMm} mm in the game`);
    }
    if (Math.abs(r.realDist - r.wanted) > 0.12) {
      bad.push(`${r.name} @ ${r.tag}: asked to shoot from ${r.wanted} m and the `
        + `camera was at ${r.realDist} m`);
    }
    // THE AIM CHECK, which the hoodie needed and did not have: the subject's
    // screen-space centre must be inside the frame, not merely unobstructed.
    if (r.offAxis > 0.85) {
      bad.push(`${r.name} @ ${r.tag}: the subject's centre is ${r.offAxis} of a `
        + `half-frame off axis -- the camera is not looking at it`);
    }
    if (r.blocker) {
      bad.push(`${r.name} @ ${r.tag}: ${r.blocker} is in front of it -- this `
        + `frame is not a photograph of the garment`);
    }
    if (Math.max(r.px[0], r.px[1]) < (r.tag === 'browse' ? 260 : 24)) {
      bad.push(`${r.name} @ ${r.tag}: ${r.px[0]} x ${r.px[1]} px on screen -- `
        + `nothing can be judged from that`);
    }
    for (const m of r.maps) {
      const cloth = /pique|jersey|fleece|twill|terry|rib|trim|cord|under|thread/i
        .test(m.name || '');
      if (!cloth) continue;
      if (m.hasCol0 && !m.vcol) {
        bad.push(`${r.name}/${m.name}: the mesh carries COLOR_0 and the material `
          + `is not reading it -- the baked occlusion is doing nothing`);
      }
      if (!m.hasCol0) {
        bad.push(`${r.name}/${m.name}: no COLOR_0 -- no baked macro occlusion`);
      }
      if (!m.normal) bad.push(`${r.name}/${m.name}: no normalMap in the renderer`);
      if (!m.rough) bad.push(`${r.name}/${m.name}: no roughnessMap in the renderer`);
      if (!m.ao) bad.push(`${r.name}/${m.name}: no aoMap in the renderer`);
      else if (m.aoChan === 1 && !m.hasUv1) {
        bad.push(`${r.name}/${m.name}: aoMap is bound to UV1 and the geometry `
          + `has no uv1 -- it samples nothing`);
      }
    }
  }
  console.log(bad.length
    ? `\nFAILED:\n  ${bad.join('\n  ')}`
    : `\n${rows.length} frames: subject centred, unobstructed, and every cloth `
      + `material carrying normal, ao and roughness in the live renderer`);
  return { rows, failures: bad };
}
