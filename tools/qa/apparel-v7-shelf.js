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
  console.log(`loading from ${DIR}${OFF ? `   A/B: ${OFF} switched OFF` : ''}`);

  // name, file, origin rule, height off the floor, display, centre relative
  // to the origin. The last number is what the sightline is probed along: the
  // first cut probed at EYE level, found 3.18 m clear, and then hung the
  // folded polo at 1.02 m where the ray to it goes down through a window pier.
  // A clearance measured along a different ray than the one the camera uses is
  // not a clearance.
  const SUBJECTS = [
    ['polo-folded', 'apparel_polo_folded.glb', 'base', 1.02, 'shelf', +0.03],
    ['hoodie-hung', 'apparel_hoodie_hung.glb', 'hook', 1.66, 'rail', -0.46],
  ];
  const CONTROL = process.env.V7_CONTROL === 'wall';
  const ANCHOR = CONTROL ? 4.5 : 2.55;
  const DISTANCES = CONTROL
    ? [['wallcontrol', 4.5]]
    : [['room', 2.55], ['browse', 0.85]];
  if (CONTROL) console.log('NEGATIVE CONTROL: the garment is inside the wall');

  const rows = [];
  for (const [name, file, rule, height, display, centreY] of SUBJECTS) {
    // --- 1. which way is there room to stand back? -------------------------
    const aim = await page.evaluate(async ([ANCHOR, CONTROL, height, centreY]) => {
      const app = window.__fw;
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
      // Clearance ALONG THE RAY THE CAMERA WILL ACTUALLY USE: from the eye to
      // the point where the garment's middle would sit, not along the horizon.
      const clearance = (d, dropY) => {
        const target = eye.clone().add(d.clone().normalize().multiplyScalar(ANCHOR));
        target.y = floorY + height + dropY;
        const ray = target.clone().sub(eye);
        const len = ray.length();
        probe.set(eye, ray.normalize());
        probe.near = 0.05; probe.far = 12.0;
        const h = probe.intersectObject(scene, true)
          .filter((x) => x.object.visible && x.object.material);
        return (h.length ? h[0].distance : 99) * (ANCHOR / Math.max(len, 1e-6));
      };
      // TURN UNTIL THERE IS SOMEWHERE TO STAND BACK TO. pine-hills-v2
      // suppresses assets 61/62/63 to grey volumes and one of them stands
      // 1.06 m in front of the shop-floor pose at chest height, so a garment
      // hung dead ahead is photographed through it, and stepping sideways did
      // not help at any offset out to 2.4 m. The greybox stays; the camera
      // turns, and the bearing it chose gets reported rather than assumed.
      let turn = 0, why = null, best = -1;
      const sweep = CONTROL ? [0] : [0, -30, 30, -60, 60, -90, 90, -150, 150, 180];
      for (const deg of sweep) {
        const a = deg * Math.PI / 180;
        const d = new THREE.Vector3(
          fwd.x * Math.cos(a) - fwd.z * Math.sin(a), 0,
          fwd.x * Math.sin(a) + fwd.z * Math.cos(a));
        // the middle of the garment and its extremes -- a rail passes over a
        // counter that a hem does not
        const c = Math.min(clearance(d, centreY), clearance(d, centreY + 0.35),
          clearance(d, centreY - 0.35));
        if (c > best) { best = c; turn = deg; }
        if (c > ANCHOR + 0.45) { turn = deg; why = `${deg} deg, ${c.toFixed(2)} m clear`; break; }
      }
      if (why === null) why = `NO CLEAR LINE -- best ${turn} deg at ${best.toFixed(2)} m`;
      // Set the yaw and stop there. WHICH WAY the game turns for a positive
      // yaw is not assumed: step 2 reads the camera back and places the
      // garment along whatever direction actually came out.
      app.scene3d.walk.state.yaw += (window.__v7yawSign || 1) * turn * Math.PI / 180;
      return { why, turn };
    }, [ANCHOR, CONTROL, height, centreY]);
    await page.waitForTimeout(500);

    // --- 2. read the camera back, then place along the REAL forward --------
    const placed = await page.evaluate(async ([file, rule, height, display, DIR, ANCHOR]) => {
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
      scene.add(holder);

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
      if (display === 'shelf') {
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

      const err = rule === 'hook' ? box.max.y - at.y : box.min.y - at.y;
      const size = box.getSize(new THREE.Vector3());
      window.__v7fwd = { x: fwd.x, z: fwd.z };
      window.__v7home = { x: app.scene3d.walk.state.x, z: app.scene3d.walk.state.z };
      return {
        maps,
        originErrMm: +(err * 1000).toFixed(1),
        sizeMm: [size.x, size.y, size.z].map((v) => +(v * 1000).toFixed(0)),
      };
    }, [file, rule, height, display, DIR, ANCHOR]);
    console.log(`\n${name}: sightline ${aim.why}`);

    for (const [tag, dist] of DISTANCES) {
      await page.evaluate(async ([dist, ANCHOR]) => {
        const w = window.__fw.scene3d.walk;
        const f = window.__v7fwd;
        const h = window.__v7home;
        const back = ANCHOR - dist;
        w.state.x = h.x + f.x * back;
        w.state.z = h.z + f.z * back;
        w.state.vx = 0; w.state.vz = 0;
      }, [dist, ANCHOR]);
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
        const mid = box.getCenter(new THREE.Vector3());
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
        const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
        const offAxis = Math.hypot(centre[0], centre[1]);

        // OCCLUSION: is anything between the eye and it. A Sprite raycast
        // dereferences Raycaster.camera and this scene has sprites; the shop's
        // batched props sit on layer masks the default raycaster skips.
        const mid = box.getCenter(new THREE.Vector3());
        const rc = new THREE.Raycaster(camPos, mid.clone().sub(camPos).normalize(),
          0.05, camPos.distanceTo(mid) + 1.0);
        rc.camera = cam;
        rc.layers.enableAll();
        const hits = rc.intersectObject(scene, true)
          .filter((x) => x.object.visible && x.object.material);
        let blocker = null;
        for (const x of hits) {
          let n = x.object, mine = false;
          while (n) { if (n === holder) { mine = true; break; } n = n.parent; }
          if (mine) break;
          blocker = `${x.object.name || x.object.type} at ${x.distance.toFixed(2)} m`;
          break;
        }
        return {
          px: [Math.round(spanX * 800), Math.round(spanY * 450)],
          offAxis: Number.isFinite(offAxis) ? +offAxis.toFixed(2) : 9.9,
          behind,
          blocker,
          hitCount: hits.length,
          firstHits: hits.slice(0, 3).map((x) =>
            `${x.object.name || x.object.type}@${x.distance.toFixed(2)}`),
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
        + `${v.hitCount} hits: ${v.firstHits.join('  ')}`);
      for (const m of placed.maps) {
        console.log(`    ${(m.name || '?').padEnd(15)} `
          + `normal ${m.normal ? 'y' : 'N'} ao ${m.ao ? 'y' : 'N'} `
          + `rough ${m.rough ? 'y' : 'N'}  aoChannel ${m.aoChan} `
          + `uv1 ${m.hasUv1 ? 'y' : 'n'}  rgb ${m.colour ? m.colour.join(',') : '-'}`);
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
