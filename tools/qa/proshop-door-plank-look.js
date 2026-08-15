async (page) => {
  // WHAT IS ACTUALLY ON THE MAIN DOORWAY, LOOKED AT RATHER THAN ASSERTED.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-door-plank-look.js
  //
  // The report is visual â€” "the planks are visible with the door BOTH open and
  // closed, and more visible closed" â€” so the answer has to be visual too. The
  // collision sweep can say the boards are solid (it does: 0 of 408 body-height
  // samples walkable, doors open or shut). It cannot say whether boarding over an
  // aperture belongs on a shop the player is trading out of, and that is the
  // question the screenshot is for.
  //
  // Also reports EFFECTIVE visibility for each damage mesh â€” visible on itself is
  // not enough, since any ancestor can hide it and the runtime toggles damage
  // modules by group. Layer masks are checked too: this room draws ten props from
  // a merged batch with layers.mask = 0, so "visible: true" and "drawn" are not
  // the same claim.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  const damageReport = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const ch = window.__fw.scene3d.clubhouse();
    const camera = window.__fw.scene3d.camera;
    const rows = [];
    ch.group.traverse((o) => {
      if (!o.isMesh || !/Boarded|Damage|Plank|Fastener/i.test(o.name || '')) return;
      let node = o;
      let hiddenBy = null;
      while (node) {
        if (node.visible === false) hiddenBy = node.name || node.type;
        node = node.parent;
      }
      const b = new THREE.Box3().setFromObject(o, true);
      rows.push({
        name: o.name,
        selfVisible: o.visible,
        effectivelyVisible: !hiddenBy,
        hiddenBy,
        // A zero mask never draws however visible the flag says it is.
        layerMask: o.layers.mask,
        drawnForCamera: !!camera && o.layers.test(camera.layers),
        local: {
          x: +(((b.min.x + b.max.x) / 2) - ch.center.x).toFixed(2),
          z: +(((b.min.z + b.max.z) / 2) - ch.center.z).toFixed(2),
        },
        yRange: [+b.min.y.toFixed(2), +b.max.y.toFixed(2)],
      });
    });
    return rows;
  });

  // Stand inside, a few yards back from the main entrance, looking at it.
  //
  // AIMED, THEN CHECKED. The first version set yaw 0 and photographed the back of
  // the shop â€” a picture of the wrong wall, captioned "the main doorway". So the
  // aim is now verified by projecting the door casing through the live camera and
  // requiring it inside the frame. A shot that does not contain its subject is
  // reported as a miss, not filed as evidence.
  const facing = async (openDoors) => page.evaluate(async (open) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    const camera = app.scene3d.camera;
    // MESH_MainDoor_CreamCasing sits at local (-0.80, 5.70). Stand back from it
    // inside the room and look SOUTH (+z) at the doorway. yaw 0 looks north --
    // walkDefaultSpawn stands south of the building at yaw 0 facing the entry.
    const doorW = { x: ch.center.x + -0.80, z: ch.center.z + 5.70 };
    const wx = doorW.x;
    const wz = ch.center.z + 2.30;
    const target = walk.state && 'x' in walk.state ? walk.state : walk;
    target.x = wx;
    target.z = wz;
    target.yaw = Math.PI;
    target.pitch = -0.02;
    // HELD, not asked once. doors.js closes a door 2.5s after the last time
    // anyone was near it, so a single request gave a "doors open" shot with the
    // doors visibly shut. Re-asserting on a timer loses too: the close rule runs
    // every frame and the leaf settles at a fifth of its travel. Pinning lastNear
    // makes the close branch unreachable.
    clearInterval(window.__doorHold);
    if (open) {
      const push = () => {
        for (const d of ch.doors || []) {
          d.desiredOpen = true;
          d.open = true;
          d.lastNear = Number.MAX_SAFE_INTEGER;
          if (d.mainLeaf && d.fixedSwing) d.swingTarget = d.fixedSwing;
        }
      };
      push();
      window.__doorHold = setInterval(push, 250);
    } else {
      for (const d of ch.doors || []) {
        d.desiredOpen = false; d.open = false; d.swingTarget = 0; d.lastNear = -1e9;
      }
    }
    return { wx: +wx.toFixed(2), wz: +wz.toFixed(2), doorWorld: { x: +doorW.x.toFixed(2), z: +doorW.z.toFixed(2) } };
  }, openDoors);

  // Aim is checked AFTER the frame loop has moved the camera to the new pose, not
  // in the same tick that requested it. The first attempt projected inside
  // facing() and got doorNdc.z = 1.088 -- the door behind a camera that had not
  // turned yet -- which would have failed a shot that was in fact correct.
  const checkAim = async () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    camera.updateMatrixWorld(true);
    const p = new THREE.Vector3(ch.center.x + -0.80, camera.position.y, ch.center.z + 5.70).project(camera);
    return {
      doorNdc: { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) },
      doorInFrame: p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
      camera: { x: +camera.position.x.toFixed(2), z: +camera.position.z.toFixed(2) },
      // The shot has to prove the door state it claims, or it is just a picture.
      doorAngles: (ch.doors || []).map((d) => ({
        name: d.name,
        angle: +Math.abs(d.angle).toFixed(3),
        target: +Math.abs(d.mainLeaf ? (d.fixedSwing || 0) : (d.swingTarget || d.fixedSwing || 0)).toFixed(3),
      })),
    };
  });

  const closedPose = await facing(false);
  await page.waitForTimeout(2500);
  Object.assign(closedPose, await checkAim());
  const closedDamage = await damageReport();
  await page.screenshot({ path: path.join(outDir, 'door-planks-closed.png') });

  const openPose = await facing(true);
  await page.waitForTimeout(2500);
  Object.assign(openPose, await checkAim());
  const openDamage = await damageReport();
  await page.screenshot({ path: path.join(outDir, 'door-planks-open.png') });

  const drawn = openDamage.filter((r) => r.effectivelyVisible && r.drawnForCamera);
  const result = {
    what: 'the main doorway, closed and open, with damage-mesh visibility measured',
    pose: { closed: closedPose, open: openPose },
    shots: ['door-planks-closed.png', 'door-planks-open.png'],
    damageMeshes: { closed: closedDamage, open: openDamage },
    drawnDamageMeshes: drawn.map((r) => r.name),
    errs: errs.slice(0, 8),
    // A LOOK, not an acceptance. Whether boarding belongs on a trading shop is a
    // design call; this only guarantees both shots were taken and the visibility
    // question was actually measured rather than assumed.
    ok: closedDamage.length > 0 && openDamage.length > 0
      && closedPose.doorInFrame && openPose.doorInFrame
      // Each shot must be in the state its filename claims -- for the doors that
      // are actually IN it. The stockroom and receiving doors are in other rooms
      // and their state says nothing about this frame; requiring them to swing
      // would fail a correct shot for an irrelevant reason.
      && closedPose.doorAngles.filter((d) => /shop door/i.test(d.name)).every((d) => d.angle < 0.05)
      && openPose.doorAngles.filter((d) => /shop door/i.test(d.name))
        .every((d) => d.target > 0.05 && d.angle >= d.target * 0.8)
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'door-plank-look.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
