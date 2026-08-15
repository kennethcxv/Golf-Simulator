// H5 — golden-image capture. Fixed poses, deterministic state, canvas-only.
//
// 102 instrument faults are on record and no numeric check can see a rake, a
// hat through a face, or a book inside its own covers. These captures CAN.
//
// Determinism decisions, each load-bearing:
//   - clock pinned to 14:00 before any capture (delivery drivers' precedent)
//   - every live customer despawned, and respawned arrivals despawned again
//     right before each pose
//   - the DOM UI (#ui) is hidden — clock text and money change every run and
//     are not what this instrument watches; the CANVAS is the subject
//   - 45 warm frames after each pose change (shadow fit is 10 Hz, GTAO
//     accumulates; first tool equip compiles shaders for up to ~8 s, so tool
//     poses wait for the viewmodel to report active first)
//   - window forced to 1600x940 DIP (main.cjs default) so pixels align across
//     runs on this machine
//
// Ledger-open and customer-at-till poses are DEFERRED on purpose: sections B
// and F of Full_Goal_18 are about to change those exact pixels; their goldens
// get pinned when that work lands.
//
//   node tools/qa/run-electron.cjs tools/qa/golden-capture.js --clubhouse=pine-hills-v2 [--out=DIR]
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const OUT = path.resolve(outArg ? outArg.slice(6) : 'qa/golden/current');
  fs.mkdirSync(OUT, { recursive: true });
  // A SKIPPED POSE USED TO READ AS A PASS (Goal 23). bag-packed failed to
  // stage, the manifest said so honestly — and the differ then compared LAST
  // run's leftover file, scored 0.0000%, and reported the pose green. The
  // capture that did not happen was the one the gate was most sure about.
  // Nothing survives a run it was not produced by.
  for (const stale of fs.readdirSync(OUT)) {
    if (stale.endsWith('.png')) fs.rmSync(path.join(OUT, stale));
  }

  // GOAL 19 WORLD PIN: every capture runs the SAME world. The harness profile
  // always boots a NEW GAME with a fresh random seed (measured: two boots,
  // two seeds, interior world-Y 1.6 yd apart — the "boot-varying world-Y"
  // that degraded every budget to 6.0). forceNew + pinSeed makes the seed a
  // constant, so the terrain, the building height, the sun-vs-floor geometry
  // and the outdoor content are byte-comparable across runs.
  // ...AND THE REST OF THE WORLD IS SEEDED TOO, WHICH IT STOPPED BEING.
  //
  // `pinSeed` fixes only the ONE onNewGame seed draw, and since
  // `458de6b` the gate correctly restores NATIVE Math.random immediately after
  // it — because holding one constant across asynchronous scene construction
  // poisoned Three.js UUIDs and made GLTFLoader reuse an unrelated material.
  // That fix was right about the corruption and left this gate unusable:
  // everything built after the seed draw now draws real randomness, so two
  // captures of the SAME COMMIT measured shop-floor at 23.4525% and 23.7509%.
  // A 0.30-point swing at a pose whose entire budget is 0.25%.
  //
  // Determinism and distinctness are not in conflict — a constant is only one
  // way to be reproducible, and it is the broken one. A SEEDED SEQUENCE gives a
  // different value every call (so UUIDs stay unique) and the same values every
  // run (so the gate can compare). Installed before any page script, so the
  // seed gate's own `original` is already this generator and its
  // restore-to-original keeps the capture deterministic.
  //
  // mulberry32: 5 lines, no dependency, well-distributed, exactly reproducible.
  await page.addInitScript(() => {
    let a = 0x9e3779b9;
    Math.random = function seededCaptureRandom() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  const boot = await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  // Compatibility no-op: qa-boot now restores real randomness inside the
  // exact onNewGame seed draw, before any scene/runtime construction begins.
  await page.evaluate(() => window.__qaRestoreRandom?.());
  try {
    const win = (await page.electronApp.browserWindow(page)) || null;
    if (win) await win.evaluate((w) => { w.setContentSize(1600, 940); });
  } catch { /* window shim differs; the default size is already 1600x940 */ }

  // Deterministic state: sim speed 0, day-preserving fixed clock, UI hidden.
  const prep = await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    const canvas = document.getElementById('game');
    return {
      clock: app.state.clock.minutes,
      speedIdx: app.speedIdx,
      // the pinned world, recorded: a drifting seed here means the pin broke
      seed: app.state.seed,
      interiorY: +app.scene3d.clubhouse().interior.position.y.toFixed(5),
      // THE LENS AND THE FRAME (Goal 23). Twelve poses failed for a week at
      // 7.7-9.2% and the bisect found nothing, because the cause was never in
      // the repository: the capture was running a different FIELD OF VIEW than
      // the run that was accepted. A pin that records the world but not the
      // lens pins half the picture. Magnification about the exact principal
      // point is what a lens change looks like and nothing else does, so these
      // four numbers turn a day of pixel archaeology into one line of diff.
      walkFov: app.scene3d.walk?.diagnostics?.()?.fov ?? null,
      dpr: window.devicePixelRatio,
      canvasCss: canvas ? `${Math.round(canvas.getBoundingClientRect().width)}x${Math.round(canvas.getBoundingClientRect().height)}` : null,
      canvasBuffer: canvas ? `${canvas.width}x${canvas.height}` : null,
    };
  });

  // PIN THE LENS THE WAY THE WORLD IS PINNED (Goal 23).
  //
  // The seed pin (47463cd) fixed the world and the gate still failed twelve
  // poses for a week. The cause: the FIELD OF VIEW is a persisted PLAYER
  // PREFERENCE, stored in the Electron profile's localStorage, shared by every
  // driver and every free-play session on this machine. Somebody moved the
  // slider to 60. The goldens were shot at the shipped 66. Every capture since
  // has been the same room through a different lens — a clean 1.125x
  // magnification about the exact principal point, which is what a lens change
  // looks like and what nothing else looks like.
  //
  // The world pin was necessary and not sufficient. Anything the player can
  // change and the profile can remember has to be pinned here, or the gate
  // measures the machine instead of the code.
  prep.lens = await page.evaluate(async () => {
    const app = window.__fw;
    const before = app.scene3d.walk?.diagnostics?.()?.fov ?? null;
    let shipped = null;
    try {
      const m = await import(new URL('src/core/preferences.js', document.baseURI).href);
      shipped = m.DEFAULT_PREFERENCES.camera.fov;
    } catch (e) { return { before, error: `preferences unavailable: ${e.message}` }; }
    app.scene3d.walk.configure({ fov: shipped });
    return { before, shipped, after: app.scene3d.walk?.diagnostics?.()?.fov ?? null };
  });

  const waitFrames = (n) => page.evaluate((frames) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= frames ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);

  const despawnAll = () => page.evaluate(async () => {
    const app = window.__fw;
    try {
      const simModule = await import('./src/sim/customerSimulation.js');
      const sim = simModule.ensureCustomerSimulation(app.state);
      const list = sim.active.slice();
      for (const c of list) { try { simModule.despawnCustomer(app.state, c, { reason: 'golden-capture' }); } catch { /* one stuck record must not void the pose */ } }
      return list.length;
    } catch (e) { return 'despawn unavailable: ' + e.message; }
  });

  const setPose = (dx, dz, yaw, pitch) => page.evaluate(([dx, dz, yaw, pitch]) => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x + dx; w.state.z = o.z + dz;
    w.state.yaw = yaw; w.state.pitch = pitch;
    w.state.vx = 0; w.state.vz = 0;
  }, [dx, dz, yaw, pitch]);

  // Poses. Offsets are from the live interior origin (the STALE-QA-offset
  // lesson: constants rot, the origin does not).
  const POSES = [
    // Scouted 2026-08-09: this corner of pine-hills-v2 is walls/boxes in every
    // direction — these two are material/trim/window tripwires, not hero shots.
    // Hero poses (counter mid-sale, customer conversational, ledger open) get
    // added when sections B/C/F land the states they depend on.
    { name: 'shop-floor', dx: -5.6, dz: 4.4, yaw: -Math.PI / 2, pitch: 0 },
    { name: 'stockroom-wall', dx: 0.0, dz: -2.0, yaw: 0, pitch: -0.05 },
  ];
  const TOOLS = ['broom', 'mop', 'vacuum', 'spray', 'cloth', 'sponge', 'dustpan', 'trashbag', 'washer', 'paint'];

  const shot = async (name) => {
    await despawnAll();
    await waitFrames(45);
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, `${name}.png`) });
  };

  const manifest = { capturedAt: 'fixed-clock 14:00', poses: [], prep };
  for (const p of POSES) {
    await setPose(p.dx, p.dz, p.yaw, p.pitch);
    await shot(p.name);
    manifest.poses.push(p.name);
  }
  // Tool poses share one stance.
  for (const tool of TOOLS) {
    await setPose(-5.6, 4.4, -Math.PI / 2, -0.15);
    const ok = await page.evaluate((t) => {
      try { window.__fw.scene3d.walk.setTool(t); return true; } catch (e) { return String(e); }
    }, tool);
    if (ok !== true) { manifest.poses.push(`SKIP tool-${tool}: ${ok}`); continue; }
    await page.waitForFunction(
      () => !!(window.__fw.scene3d.walk.heldToolDiagnostics?.()?.vmActive ?? window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive ?? true),
      null, { timeout: 20000 },
    ).catch(() => {});
    await waitFrames(30);
    await shot(`tool-${tool}`);
    manifest.poses.push(`tool-${tool}`);
  }
  await page.evaluate(() => { try { window.__fw.scene3d.walk.setTool(null); } catch { /* bare hands may not be a tool id */ } });

  // C1 (Goal 19) — THE BAG POSE. Stages the canonical 3-item sale on the
  // pinned world, bags everything through the shipped click interaction,
  // despawns the customer, and photographs the packed carrier from the
  // cashier's stand. This is the pose that makes "items stick out of the
  // bag" impossible to regress invisibly. If any staging step fails the
  // pose is SKIPPED LOUDLY in the manifest rather than captured wrong.
  try {
    // deterministic staging: the customer's spawn draws (shirt, cap, name)
    // come from runtime randomness — pin it for the staging span so the
    // person in frame is the same person every capture
    await page.evaluate((s) => {
      const original = Math.random;
      window.__qaRestoreRandom2 = () => { Math.random = original; delete window.__qaRestoreRandom2; };
      Math.random = () => s;
    }, 0.4242);
    await page.evaluate(async ([skuIds]) => {
      const app = window.__fw;
      const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const ch = app.scene3d.clubhouse();
      ch.setOrganicWalkins(false);
      for (const id of skuIds) {
        const inv = app.state.shop.inventory[id];
        if (inv) inv.shelf = Math.max(inv.shelf, 12);
      }
      ch.rebuildStock();
      const w = app.scene3d.walk.state;
      const off = ch.interior.position;
      w.x = REGISTER.stand.x + off.x;
      w.z = REGISTER.stand.z + off.z;
      const dx = REGISTER.monitor.x - REGISTER.stand.x;
      const dz = REGISTER.monitor.z - REGISTER.stand.z;
      const h = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / h, -dz / h);
      w.pitch = Math.atan2(1.18 - 1.62, h);
      return ch.sendToCounter(skuIds, 'card');
    }, [['balls1', 'water1', 'sportdrink2']]);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === 3;
    }, null, { timeout: 30000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
    await waitFrames(60);
    const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
    for (const uid of uids) {
      // AIM FIRST, THEN PROJECT (Goal 27). The old loop projected each item
      // from the fixed register stance and clicked only when it landed inside
      // the viewport — and the interior's boot-varying world offset moved the
      // projection, so on some boots one or two items sat off-view, went
      // unclicked, and the pose self-skipped ("only N goods packed"). The
      // diff counts an unanswered committed golden as a FAILURE (as it must),
      // which made the whole gate a coin flip on this staging. Pointing the
      // camera at the item before projecting keeps the real mouse verb and
      // removes the projection's dependence on the boot.
      const spot = await page.evaluate(async (id) => {
        const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
        const app = window.__fw;
        let found = null;
        app.scene3d.clubhouse().interior.traverse((o) => {
          if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === id) found = o;
        });
        if (!found) return null;
        const world = new THREE.Box3().setFromObject(found).getCenter(new THREE.Vector3());
        const w = app.scene3d.walk.state;
        const cam = app.scene3d.camera.getWorldPosition(new THREE.Vector3());
        const dx = world.x - cam.x;
        const dy = world.y - cam.y;
        const dz = world.z - cam.z;
        const h = Math.hypot(dx, dz) || 0.001;
        w.yaw = Math.atan2(-dx / h, -dz / h);
        w.pitch = Math.atan2(dy, h);
        return { id };
      }, uid);
      if (spot) await waitFrames(8); // let the camera settle on the new aim
      // The item's CENTER pixel can be occluded (the customer leans over the
      // counter; the reader sits in front), so a single center click can hit
      // the occluder and pack nothing while reporting success. Click candidate
      // points across the projected box until the packed COUNT moves, and
      // record the whole attempt per item — a skip must name its step.
      const outcome = { uid, found: !!spot, clicks: 0, packed: false };
      if (spot) {
        const packedNow = () => page.evaluate(() => {
          let count = 0;
          window.__fw.scene3d.clubhouse().interior.traverse((o) => {
            if (o.userData?.checkoutVisualState === 'packed-in-bag') count += 1;
          });
          return count;
        });
        const before = await packedNow();
        const points = await page.evaluate(async (id) => {
          const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
          const app = window.__fw;
          let found = null;
          app.scene3d.clubhouse().interior.traverse((o) => {
            if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === id) found = o;
          });
          if (!found) return null;
          const box = new THREE.Box3().setFromObject(found);
          const rect = document.querySelector('canvas').getBoundingClientRect();
          const toScreen = (v) => {
            const p = v.clone().project(app.scene3d.camera);
            return {
              x: rect.left + ((p.x + 1) / 2) * rect.width,
              y: rect.top + ((-p.y + 1) / 2) * rect.height,
              ok: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
            };
          };
          const c = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          return [
            toScreen(c),
            toScreen(c.clone().add(new THREE.Vector3(0, size.y * 0.3, 0))),
            toScreen(c.clone().add(new THREE.Vector3(size.x * 0.25, 0, 0))),
            toScreen(c.clone().add(new THREE.Vector3(-size.x * 0.25, 0, 0))),
            toScreen(c.clone().add(new THREE.Vector3(0, -size.y * 0.25, 0))),
          ].filter((p) => p.ok);
        }, spot.id);
        for (const p of points || []) {
          await page.mouse.click(p.x, p.y);
          outcome.clicks += 1;
          await waitFrames(30);
          if (await packedNow() > before) { outcome.packed = true; break; }
        }
        if (outcome.packed) await waitFrames(25);
      }
      manifest.bagStaging = manifest.bagStaging || [];
      manifest.bagStaging.push(outcome);
    }
    const packed = await page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      let count = 0;
      ch.interior.traverse((o) => { if (o.userData?.checkoutVisualState === 'packed-in-bag') count += 1; });
      // freeze the frame: customer gone, camera square on the carrier
      return count;
    });
    if (packed >= 3) {
      await page.evaluate(async () => {
        const app = window.__fw;
        const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
        const ch = app.scene3d.clubhouse();
        const w = app.scene3d.walk.state;
        const off = ch.interior.position;
        w.x = REGISTER.stand.x + off.x;
        w.z = REGISTER.stand.z + off.z;
        const dx = REGISTER.bag.x - REGISTER.stand.x;
        const dz = REGISTER.bag.z - REGISTER.stand.z;
        const h = Math.hypot(dx, dz) || 0.001;
        w.yaw = Math.atan2(-dx / h, -dz / h);
        w.pitch = Math.atan2(0.95 - 1.62, h);
      });
      // NO despawn for this pose: killing the customer mid-sale voids the
      // transaction and resets the carrier. The customer is pinned-spawn
      // deterministic and the camera is on the bag.
      await waitFrames(45);
      const canvas = await page.$('#game');
      await (canvas || page).screenshot({ path: path.join(OUT, 'bag-packed.png') });
      manifest.poses.push('bag-packed');
    } else {
      manifest.poses.push(`SKIP bag-packed: only ${packed} goods packed`);
    }
    await page.evaluate(() => { window.__qaRestoreRandom2?.(); });
  } catch (error) {
    await page.evaluate(() => { window.__qaRestoreRandom2?.(); }).catch(() => {});
    manifest.poses.push(`SKIP bag-packed: ${String(error && error.message ? error.message : error).slice(0, 120)}`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}
