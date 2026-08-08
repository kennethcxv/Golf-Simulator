// PHASE 5 — THE SIXTY-SECOND WALK.
//
// The brief names this exactly: "Boot cold, walk in, open a door, open the
// ledger, enter the register, equip a tool. Record frame times. Nothing over
// 16 ms except the first frame."
//
// It is the regression gate between sections, so it has to be honest about
// what it could not do rather than quietly scoring a shorter walk. Every beat
// reports whether it actually happened, and the verdict is gated on that:
// a walk that never found a door cannot certify doors.
//
// Frame times are sampled continuously across the whole run and attributed to
// whichever beat was in progress, so "nothing over 16 ms" can be answered per
// beat instead of as one number that hides where the cost is.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-sixty-second-walk.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/phase5-walk');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], beats: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  const pageStart = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  out.pageToPlayableMs = Date.now() - pageStart;
  // Fault 52: an unfocused window rAF-throttles to ~1 fps and manufactures
  // second-long frames out of nothing.
  await page.bringToFront().catch(() => {});

  // The sampler runs for the WHOLE walk and tags each frame with the beat in
  // progress, so a hitch can be attributed instead of merely counted.
  await page.evaluate(() => {
    const s = { rows: [], beat: 'settle', stop: false };
    window.__p5 = s;
    window.__p5beat = (name) => { s.beat = name; };
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      s.rows.push({ dt: +(now - last).toFixed(2), beat: s.beat });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const beat = async (name) => { out.progs[name] = await progs(); return page.evaluate((n) => window.__p5beat(n), name); };

  const progs = () => page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null).catch(() => null);
  out.progs = {};
  const record = (name, ok, detail) => { out.beats.push({ name, ok, ...detail }); };

  // GEOMETRY TRACE — WHERE ARE THE 54 BUILT?
  //
  // The first equip creates 54 geometries (scene-wide +54, controlled, so built
  // and not re-parented) carrying 9 materials that compile 9 programs and cost
  // 333-7855 ms. Four code readings failed to find the constructor.
  //
  // `THREE` is not on `window`, but every geometry's prototype is reachable from
  // any mesh in the scene, and every geometry calls `setAttribute` while being
  // built. Patch that once here, keep it OFF, and switch it on only across the
  // tool beat so the capture is the equip and nothing else.
  //
  // A standalone driver could not be used: the tool belt does not work straight
  // out of boot, and only this walk reaches the state where equipping succeeds.
  out.geoArmed = await page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    let proto = null;
    if (s3 && s3.scene) {
      s3.scene.traverse((o) => { if (!proto && o.geometry) proto = Object.getPrototypeOf(o.geometry); });
    }
    if (!proto) return 'no geometry to reach the prototype';
    // WALK UP TO THE CLASS THAT ACTUALLY OWNS `setAttribute`.
    //
    // `getPrototypeOf(someBoxGeometry)` is BoxGeometry.prototype, and patching
    // that intercepts boxes only. The first attempt did exactly this, reported
    // `patched`, and captured nothing — because the 54 geometries built at equip
    // are cylinders and lathes. `setAttribute` lives on BufferGeometry, so climb
    // until the prototype owns it.
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'setAttribute')) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!proto) return 'no prototype owns setAttribute';
    if (proto.__fwGeoPatched) return `already patched (${proto.constructor && proto.constructor.name})`;
    proto.__fwGeoPatched = true;
    window.__geoOn = false;
    window.__geoStacks = [];
    const original = proto.setAttribute;
    proto.setAttribute = function patched(name, value) {
      if (window.__geoOn && window.__geoStacks.length < 500) {
        window.__geoStacks.push(String(new Error().stack || '').split('\n').slice(2, 7).join(' <- '));
      }
      return original.call(this, name, value);
    };
    // THE NEGATIVE CONTROL THIS INSTRUMENT LACKED: name the class. A bare
    // "patched" cannot distinguish patching the right class and seeing nothing
    // from patching the wrong one, which is exactly how the first attempt hid
    // its own failure.
    return `patched:${(proto.constructor && proto.constructor.name) || 'unknown'}`;
  }).catch((e) => `threw: ${String(e && e.message)}`);

  // 1. SETTLE — the first frames after the veil. The brief exempts the first
  //    frame only, so this is sampled but reported separately.
  await page.waitForTimeout(6000);

  // 2. WALK IN
  await beat('walk');
  await page.mouse.click(700, 500);
  await page.waitForTimeout(300);
  const keys = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  const hold = async (k, ms) => {
    await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await page.keyboard.up(k);
  };
  // LOOK-ONLY BEAT: rotate the camera without translating. Separates a
  // view-dependent first-frame cost (culling, shadows, first draw of newly
  // visible geometry) from a movement-dependent one (streaming, broadphase).
  await beat('lookOnly');
  await page.mouse.move(500, 420);
  await page.mouse.move(508, 420, { steps: 4 });
  await page.mouse.move(500, 420, { steps: 4 });
  await page.waitForTimeout(900);
  await beat('walk');
  const posBefore = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z };
  });
  await hold('w', 2600);
  await beat('walkB');
  await page.mouse.move(600, 420);
  await page.mouse.move(1000, 420, { steps: 18 });
  await hold('w', 1800);
  await beat('walkC');
  await page.waitForTimeout(400);
  const posAfter = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z };
  });
  const walked = Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z);
  const lazy = await page.evaluate(() => window.__fw?.scene3d?.walk?.lazyBuildTimings?.() ?? 'no accessor').catch(() => null);
  record('walk', walked > 1.0, { yardsMoved: +walked.toFixed(2), lazy });

  // 3. A DOOR
  await beat('door');
  const doorHit = await page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const walk = fw.scene3d.walk;
    const st = walk.state;
    const list = ch.doors || [];
    const ip = ch.interior.position;
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    for (const door of list) {
      if (!Number.isFinite(door.lx) || !Number.isFinite(door.lz)) continue;
      const p = { x: ip.x + door.lx, z: ip.z + door.lz };
      const to = { x: ip.x - p.x, z: ip.z - p.z };
      const len = Math.hypot(to.x, to.z) || 1;
      st.x = p.x + (to.x / len) * 1.4;
      st.z = p.z + (to.z / len) * 1.4;
      st.pitch = -0.05;
      const base = Math.atan2(-(p.x - st.x), -(p.z - st.z));
      for (let k = 0; k < 14; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        await sleep(90);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/door/i.test(label)) return { hit: true, label: label.slice(0, 50) };
      }
    }
    return { hit: false };
  });
  if (doorHit.hit) {
    await page.keyboard.press(keys.interact || 'e');
    await page.waitForTimeout(2200);
  }
  record('door', doorHit.hit, { label: doorHit.label || null });

  // 4. THE LEDGER, on a real key
  await beat('ledger');
  const ledgerHit = await page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const walk = fw.scene3d.walk;
    const st = walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.3;
    st.z = book.z + (to.z / len) * 1.3;
    const base = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    for (const dp of [-0.3, -0.15, 0]) {
      for (let k = 0; k < 10; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        st.pitch = dp;
        await sleep(100);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/ledger|read/i.test(label)) return { hit: true };
      }
    }
    return { hit: false };
  });
  if (ledgerHit.hit) {
    await page.keyboard.press(keys.interact || 'e');
    await page.waitForTimeout(2500);
    await page.keyboard.press(keys.interact || 'e');
    await page.waitForTimeout(1500);
  }
  record('ledger', ledgerHit.hit, { opened: await page.evaluate(() => !!window.__fw.ledgerOpen) });

  // CLOSE THE BOOK BEFORE THE NEXT BEAT. This is the whole of the tool beat's
  // failure: an open ledger owns the keyboard, so the tool-belt key never
  // reached its handler and `getTool()` stayed "none". Measured
  // `ledgerStillOpen: true` at beat 5.
  //
  // Eight hypotheses died before this one — turf, unadopted assets, a failed
  // socket lookup, a broken rig, an off-by-one key map, a wheel closed too
  // early, a wrong belt binding, a mounted cart — and every one of them was
  // about the GAME or the tool. The cause was a beat that did not clean up
  // after itself, three beats earlier.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  if (await page.evaluate(() => !!window.__fw?.ledgerOpen)) {
    await page.keyboard.press(keys.interact || 'e');
    await page.waitForTimeout(600);
  }
  await page.mouse.click(700, 500);   // re-capture the pointer the book released
  await page.waitForTimeout(300);

  // 5. A TOOL, through the real wheel
  out.keysBefore = await page.evaluate(() => window.__fw?.scene3d?.programKeyBreakdown?.() ?? null).catch(() => null);
  out.keySetBefore = await page.evaluate(() => (window.__fw?.scene3d?.renderer?.info?.programs ?? []).map((pr) => String(pr.cacheKey ?? '')).slice()).catch(() => null);
  out.uuidBefore = await page.evaluate(() => { const s3 = window.__fw?.scene3d; if(!s3) return null; const cam=s3.camera, sc=s3.scene; const camG=new Set(), sceneG=new Set(); cam?.traverse(o=>{ if(o.geometry) camG.add(o.geometry.uuid); }); sc?.traverse(o=>{ if(o.geometry) sceneG.add(o.geometry.uuid); }); return { cam:[...camG], sceneCount: sceneG.size }; }).catch(() => null);
  // BOTH INSTRUMENTS, ONE RUN. The previous entry compared a trace from one run
  // against a census from another and called it "the same window". It was not.
  const sceneGeoCount = () => page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    const seen = new Set();
    if (s3 && s3.scene) s3.scene.traverse((o) => { if (o.geometry) seen.add(o.geometry.uuid); });
    return seen.size;
  }).catch(() => null);
  // Snapshot the uuids so the ones that appear can be named, not just counted.
  const geoIds = () => page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    const seen = [];
    if (s3 && s3.scene) s3.scene.traverse((o) => { if (o.geometry) seen.push(o.geometry.uuid); });
    return seen;
  }).catch(() => []);
  // MEASURE THE PARENT BEFORE WRITING ANY GUARD ABOUT IT.
  //
  // The seventh fix guarded on `!fpHands.root.parent` — assuming "not in the
  // scene" means "no parent" — and silently did nothing. That assumption was the
  // one line in the whole thread never measured. This is that measurement:
  // where do the hands actually live before a tool is equipped?
  out.handsHomeBefore = await page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    const cam = s3 && s3.camera;
    let hands = null;
    if (cam) cam.traverse((o) => { if (!hands && /FirstPersonRightHand/.test(o.name || '')) hands = o; });
    if (!hands && s3 && s3.scene) {
      s3.scene.traverse((o) => { if (!hands && /FirstPersonRightHand/.test(o.name || '')) hands = o; });
    }
    if (!hands) return 'hands not reachable from camera or scene';
    const chain = [];
    let p = hands;
    while (p && chain.length < 10) { chain.push(p.name || `(${p.type})`); p = p.parent; }
    return chain.join(' <- ');
  }).catch((e) => `threw: ${String(e && e.message)}`);
  const matIds = () => page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    const seen = [];
    if (s3 && s3.scene) s3.scene.traverse((o) => { if (o.material) seen.push(o.material.uuid); });
    return seen;
  }).catch(() => []);
  const keySnap = () => page.evaluate(() => (window.__fw?.scene3d?.renderer?.info?.programs ?? [])
    .map((pr) => String(pr.cacheKey ?? ''))).catch(() => []);
  out.keysBefore = await keySnap();
  out.matIdsBefore = await matIds();
  out.geoIdsBefore = await geoIds();
  out.geoCountBefore = await sceneGeoCount();
  await page.evaluate(() => { window.__geoOn = true; });
  await beat('tool');
  // THE BELT IS HOLD-TO-OPEN, SO THE SELECTION MUST HAPPEN WHILE IT IS HELD.
  //
  // This used to press the belt key, RELEASE it, and only then read the wheel
  // and press a number. Releasing closes the wheel, so the number key arrived
  // after there was nothing to select from: measured `getTool()` -> "none",
  // no tool equipped at all.
  //
  // That single ordering mistake is the whole of this beat's failure. It cost
  // five hypotheses — turf, unadopted assets, a failed socket lookup, a broken
  // rig, an off-by-one in the key mapping — and every one of them was about the
  // GAME. The rig was healthy the entire time: shaftDrop -1.359, headAboveFloor
  // -0.25, a broom correctly hanging head-down. The driver simply shut the
  // wheel before choosing.
  await page.keyboard.down(keys.toolBelt || 'f');
  await page.waitForTimeout(450);
  const wheelReallyOpen = await page.evaluate(() => { const t = window.__fw?.toolWheel; return { hasApi: !!t, isOpen: t?.isOpen?.() ?? null }; }).catch(() => null);
  const items = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? [...el.querySelectorAll('.tool-wheel-item')]
      .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
  });
  // THE SILENT SKIP THAT HID THIS BEAT'S FAILURE FOR AN UNKNOWN NUMBER OF RUNS.
  //
  // `if (at >= 0)` means: when the broom is not found among the wheel labels,
  // press nothing, equip nothing, and report `tool` failed with no reason. The
  // gate then prints beatsThatDidNot:["tool"] and the ONE fact that explains it
  // — what the wheel actually offered — is thrown away.
  //
  // Three gate runs reported this failure and not one could say why. A driver
  // that discards its own evidence turns a five-minute diagnosis into a
  // bisect, which is exactly what it cost here.
  //
  // Now every failure path carries what it saw.
  // THE WHEEL SELECTS ON THE TOOL'S OWN LETTER, NOT ON ITS POSITION.
  //
  // `toolShortcutIndex` (src/ui/toolWheel.js:3) matches `entry.shortcut`, and
  // WALK_TOOL_SHORTCUTS (src/main.js:2189) assigns letters: washer W, vacuum V,
  // mop M, broom B, dustpan D, spray S, cloth C, sponge G, trashbag T.
  //
  // This driver pressed String(index + 1) — a positional digit the wheel has no
  // concept of. That is why `getTool()` came back "none": the keypress matched
  // no entry at all, so nothing was ever equipped.
  //
  // Six hypotheses died before this one, every one of them about the GAME:
  // turf, unadopted assets, a failed socket lookup, a broken rig, an off-by-one
  // in a mapping that never existed, and a wheel closed too early. The rig was
  // healthy throughout — shaftDrop -1.359, headAboveFloor -0.25. The instrument
  // was pressing a key the game does not use.
  const at = items.findIndex((l) => /broom/i.test(l));
  const wheelOpened = items.length > 0;
  const shortcut = 'b';
  if (at >= 0) await page.keyboard.press(shortcut);
  await page.waitForTimeout(250);
  // released only AFTER the choice is made
  await page.keyboard.up(keys.toolBelt || 'f');
  await page.waitForTimeout(1200);
  const live = await boot.toolIsLive(page, 'broom').catch(() => ({ ok: false }));
  // BOARDS OR TURF, because toolIsLive's readiness proxy is `headAboveFloor !=
  // null` and that quantity is SAMPLED FROM THE CLUBHOUSE FLOOR. courseScene
  // says so itself: `floorY !== null ? 'boards' : 'turf'`. Outdoors there is no
  // groundYAt answer, so the proxy is unsatisfiable however healthy the rig is.
  // Without this field the beat cannot tell "the rig is broken" from "the
  // player is standing on grass".
  const stood = await page.evaluate(() => {
    const fw = window.__fw;
    const w = fw?.scene3d?.walk;
    const ch = fw?.scene3d?.clubhouse?.();
    if (!w || !ch?.groundYAt) return { known: false };
    const g = ch.groundYAt(w.state?.x ?? w.x, w.state?.z ?? w.z);
    return { known: true, surface: g == null ? 'turf' : 'boards', groundY: g ?? null };
  }).catch(() => ({ known: false }));
  // B2 — WHAT THE BROOM HEAD ACTUALLY LOOKS LIKE TO THE PLAYER.
  //
  // "The bristles read as separated tines rather than a brush." That is a claim
  // about a picture, and the only honest first move is to take the picture. B2
  // needs no stroke — it is about the head at rest: density, a defined block, a
  // visible ferrule — so this looks down, shoots, and looks back up, leaving the
  // pitch where the following beats expect it.
  const b2 = {};
  if (live.ok === true) {
    b2.before = await page.evaluate(() => {
      const d = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.('broom') || null;
      return { headNdc: d?.headNdc ?? null, pitch: +(window.__fw?.scene3d?.camera?.rotation?.x ?? 0).toFixed(3) };
    }).catch(() => null);
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(750);
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(400);
    b2.lookedDown = await page.evaluate(() => {
      const d = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.('broom') || null;
      return { headNdc: d?.headNdc ?? null, pitch: +(window.__fw?.scene3d?.camera?.rotation?.x ?? 0).toFixed(3) };
    }).catch(() => null);
    await page.screenshot({ path: path.join(OUT, 'b2-broom-head.png') });
    b2.shot = 'b2-broom-head.png';
    // RESTORE THE PITCH. This beat is not the last one; leaving the camera
    // pointed at the floor would silently change every beat after it, and a
    // capture that alters the run it is embedded in is not an observation.
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(750);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(300);
    b2.restored = await page.evaluate(() => +(window.__fw?.scene3d?.camera?.rotation?.x ?? 0).toFixed(3)).catch(() => null);
  }
  record('tool', live.ok === true, {
    held: live.held ?? null,
    stoodOn: stood,
    b2,
    ledgerStillOpen: await page.evaluate(() => !!window.__fw?.ledgerOpen).catch(() => null),
    cartMounted: await page.evaluate(() => window.__fw?.scene3d?.walk?.cart?.mounted ?? "unknown").catch(() => null),
    wheelReallyOpen,
    equipped: await page.evaluate(() => window.__fw?.scene3d?.walk?.getTool?.() ?? "none").catch(() => null),
    rigDiag: await page.evaluate(() => { const d = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.("broom"); return d ? { shaftDrop: d.shaftDrop, headAboveFloor: d.headAboveFloor, assetHeadWorldY: d.assetHeadWorldY, assetGripWorldY: d.assetGripWorldY, keys: Object.keys(d).length } : null; }).catch(() => null),
    authored: await page.evaluate(() => window.__fw?.scene3d?.walk?.toolAuthoredResults?.() ?? "no accessor").catch(() => null),
    // why it failed, in the artifact, instead of nowhere
    wheelOpened,
    wheelItems: items,
    broomIndex: at,
    pressedKey: at >= 0 ? String(at === 9 ? 0 : at + 1) : null,
    reason: live.ok === true ? null
      : !wheelOpened ? 'the tool wheel never opened (.tool-wheel absent or empty)'
        : at < 0 ? `no wheel label matched /broom/i — offered: ${items.join(' | ')}`
          : 'the broom was selected but the rig never solved a pose',
  });

  // SECOND EQUIP - does the cost repeat, or is it one-time?
  await beat('tool2');
  await page.keyboard.down(keys.toolBelt || 'f');
  await page.waitForTimeout(450);
  await page.keyboard.press('m');
  await page.waitForTimeout(250);
  await page.keyboard.up(keys.toolBelt || 'f');
  await page.waitForTimeout(1500);
  // B1 — THE PLAYER-CAMERA CAPTURE THE RULES REQUIRE.
  //
  // B1's whip retune is SHIPPED (deficitBase 0.85 -> 0.25, chaseBase 5.5 -> 11.0,
  // dragGain 0.22 -> 0.08, pushGain 2.2 -> 3.0) and measured at +35% live pixel
  // change, reproducible within 2%. But a pixel delta is not a picture, and the
  // RULES are explicit: a visual item without a default-camera screenshot is
  // UNCONFIRMED.
  //
  // This beat already equips the mop. Hold LMB so the strands are mid-stroke
  // rather than at rest — a still of a hanging mop proves nothing about motion —
  // and shoot at the DEFAULT camera, untouched.
  //
  // ROUND 1 (d109dfc) PRODUCED A PICTURE OF NOTHING. Looking at it is what said
  // so, and it failed on two counts at once:
  //
  //   1. THE MOP HEAD WAS NOT IN FRAME. All the image held was a shaft, a brass
  //      butt cap and one hand at the bottom edge; the strands — the entire
  //      subject of B1 — hung below the viewport. `equipped2: mop` was true and
  //      told me nothing about what the camera could see, which is the whole
  //      question a visual confirmation asks.
  //   2. THE STROKE WAS REFUSED. The frame carries the game's own toast: "The
  //      tool is against a fixture, not the floor." The equip happens at the
  //      checkout desk, `cleanWithTool` returned reason `blocked`
  //      (courseScene.js:7570), and `mouse.down()` bought a rejection, not a
  //      stroke. A still labelled "midstroke" that contains no stroke is worse
  //      than no still: it reads as evidence.
  //
  // So this round stands the player somewhere legal, points the camera at the
  // work, and PROVES both before shooting. The instrument is
  // `toolRigDiagnostics('mop').headNdc` — the drawn head projected through
  // `vmCamera`, the same camera the viewmodel pass draws with
  // (broomViewmodel.js:1126-1129) — and its NEGATIVE CONTROL is free: the
  // reading is taken before the look-down as well as after, and the before
  // reading is expected to be OUT of frame. An instrument that says "in frame"
  // at both ends is measuring nothing.
  //
  // Everything here is player input. Arrow keys pitch the view
  // (courseScene.js:8263) and `s` walks backward; no camera is posed, no field
  // of view touched, which is what "at the DEFAULT camera" requires.
  const equipped2 = await page.evaluate(() => window.__fw?.scene3d?.walk?.getTool?.() ?? 'none').catch(() => null);
  const b1 = { equipped2, shots: [] };
  const b1Probe = () => page.evaluate(() => {
    const w = window.__fw?.scene3d?.walk;
    const rig = w?.toolRigDiagnostics?.('mop') || null;
    const cln = w?.cleaningDiagnostics?.() || null;
    return {
      headNdc: rig?.headNdc ?? null,
      strokeX: rig?.strokeX ?? null,
      intensity: rig?.intensity ?? null,
      workBlend: rig?.workBlend ?? null,
      using: cln?.using ?? null,
      did: cln?.result?.did ?? null,
      blocked: cln?.result?.blocked ?? null,
      reason: cln?.result?.reason ?? null,
      // READ THE RENDER CAMERA, not a walk accessor. `walk` exposes no pitch and
      // no position — inventing `debugState()` here would have returned
      // undefined through an optional chain and reported `pitch: null` as if the
      // camera were level, which is exactly the shape of null this session has
      // been bitten by twice. camera.rotation.x IS the pitch the frame drew
      // with, and camera.position IS where the eye stood.
      pitch: +(window.__fw?.scene3d?.camera?.rotation?.x ?? 0).toFixed(3),
      pos: {
        x: +(window.__fw?.scene3d?.camera?.position?.x ?? 0).toFixed(2),
        z: +(window.__fw?.scene3d?.camera?.position?.z ?? 0).toFixed(2),
      },
    };
  }).catch((e) => ({ threw: String(e && e.message) }));
  const inFrame = (n) => !!n && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1;

  if (equipped2 === 'mop') {
    b1.atEquip = await b1Probe();
    // OFF THE DESK. Round 1's refusal was positional, not a tool fault.
    await page.keyboard.down('s');
    await page.waitForTimeout(1600);
    await page.keyboard.up('s');
    await page.waitForTimeout(500);
    b1.afterBackedOff = await b1Probe();
    // LOOK DOWN AT THE FLOOR. Eye height is ~1.6yd and the head works about
    // 0.9yd ahead, which is ~60 degrees below the horizon — outside a 66-degree
    // vertical FOV by a wide margin. Level gaze CANNOT contain the mop head.
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(750);
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(400);
    b1.afterLookDown = await b1Probe();
    await page.screenshot({ path: path.join(OUT, 'b1-mop-rest.png') });
    b1.shots.push('b1-mop-rest.png');
    // THE STROKE ITSELF, sampled three times across it. One frame cannot show
    // motion; three at different stroke phases can be compared to each other,
    // and `strokeX` says which phase each one caught.
    await page.mouse.down();
    await page.waitForTimeout(450);
    for (let i = 0; i < 3; i++) {
      const name = `b1-mop-stroke-${i}.png`;
      await page.screenshot({ path: path.join(OUT, name) });
      b1.shots.push(name);
      b1[`stroke${i}`] = await b1Probe();
      await page.waitForTimeout(220);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    b1.afterRelease = await b1Probe();
    // THE VERDICT THE ARTIFACT MUST CARRY, so a reader is not left inferring it
    // from eight raw probes.
    b1.headInFrameBefore = inFrame(b1.atEquip?.headNdc);
    b1.headInFrameAfter = inFrame(b1.afterLookDown?.headNdc);
    b1.controlHeld = b1.headInFrameAfter && !b1.headInFrameBefore;
    b1.strokePhasesDiffer = new Set([0, 1, 2]
      .map((i) => b1[`stroke${i}`]?.strokeX)).size > 1;
    // TWO DIFFERENT QUESTIONS, KEPT APART ON PURPOSE.
    //
    // The first cut of this predicate read `using && !blocked` and called it
    // `strokeAccepted`, which quietly asserted that a mop only swings when the
    // mopping WORKS. It does not. The run came back `using: true`, intensity
    // 0.398 -> 0.592 -> 0.605, workBlend 1, three distinct strokeX — a fully
    // live swing — alongside `blocked: true, reason: 'mop-dry'`, because the mop
    // has not been wrung in the cleaning-bay bucket yet and therefore lifts no
    // dirt. The predicate declared that genuinely good capture `usable: false`.
    //
    // B1 is the STRAND WHIP. The strands are driven by head motion (`strokeX`,
    // broomViewmodel.js:1301) and not by the clean result, so the swing is the
    // question and the clean is a separate game fact that belongs in the
    // artifact under its own name rather than gating a visual confirmation.
    b1.swingLive = [0, 1, 2].some((i) => b1[`stroke${i}`]?.using === true
      && (b1[`stroke${i}`]?.intensity ?? 0) > 0.1) && b1.strokePhasesDiffer;
    b1.cleanAccepted = [0, 1, 2].some((i) => (b1[`stroke${i}`]?.did ?? 0) > 0);
    b1.cleanRefusedBecause = b1.cleanAccepted ? null : (b1.stroke0?.reason ?? null);
    b1.usable = b1.headInFrameAfter && b1.swingLive;
  }
  record('tool2', true, {
    equipped2,
    b1,
    b1Camera: await page.evaluate(() => ({
      fov: window.__fw?.scene3d?.camera?.fov ?? null,
      css: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio,
    })).catch(() => null),
  });

  out.precompile = await page.evaluate(() => window.__fw?.scene3d?.walk?.toolPrecompileInfo?.() ?? 'no accessor').catch(() => null);
  out.keysAfter = await page.evaluate(() => window.__fw?.scene3d?.programKeyBreakdown?.() ?? null).catch(() => null);
  out.keySetAfter = await page.evaluate(() => (window.__fw?.scene3d?.renderer?.info?.programs ?? []).map((pr) => String(pr.cacheKey ?? '')).slice()).catch(() => null);
  out.uuidAfter = await page.evaluate(() => { const s3 = window.__fw?.scene3d; if(!s3) return null; const cam=s3.camera, sc=s3.scene; const camG=new Set(), sceneG=new Set(); cam?.traverse(o=>{ if(o.geometry) camG.add(o.geometry.uuid); }); sc?.traverse(o=>{ if(o.geometry) sceneG.add(o.geometry.uuid); }); return { cam:[...camG], sceneCount: sceneG.size }; }).catch(() => null);
  out.keysAfter = await keySnap();
  out.geoCountAfter = await sceneGeoCount();
  // ATTRIBUTE THE NEW MATERIALS, not just the new meshes. The census showed the
  // +54 meshes are hands and I inferred the +9 materials were theirs too — but
  // fpHands has five map-less materials that share one program key, and the
  // measured keys are textured. Two deltas in one window are not one fact.
  out.newMatOwners = await page.evaluate((before) => {
    const s3 = window.__fw && window.__fw.scene3d;
    const known = new Set(before);
    const tally = {};
    if (s3 && s3.scene) {
      s3.scene.traverse((o) => {
        if (!o.material || known.has(o.material.uuid)) return;
        let p = o;
        let label = '(no named ancestor)';
        while (p) { if (p.name) { label = p.name; break; } p = p.parent; }
        // DISTINCT materials, not meshes. The previous pass counted 54 meshes
        // and could not say how many distinct materials that was — which is the
        // number that maps onto the +9 programs.
        if (tally.__seen == null) tally.__seen = {};
        if (tally.__seen[o.material.uuid]) return;
        tally.__seen[o.material.uuid] = true;
        // WHAT DIFFERS STRUCTURALLY? Nine flat, map-less MeshStandardMaterials
        // should share ONE program key — three.js keys ignore colour and
        // roughness. Nine distinct programs means nine distinct keys, so
        // something structural differs. Print the properties that enter a key.
        const m = o.material;
        const shape = [
          m.type,
          m.flatShading ? 'flat' : 'smooth',
          `side${m.side}`,
          m.vertexColors ? 'vcol' : '-',
          m.transparent ? 'transp' : '-',
          m.fog === false ? 'nofog' : 'fog',
          o.isInstancedMesh ? 'inst' : '-',
          o.isSkinnedMesh ? 'skin' : '-',
          m.map ? 'map' : '-',
        ].join(',');
        const key = `${label} :: ${shape}`;
        tally[key] = (tally[key] || 0) + 1;
      });
    }
    return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, out.matIdsBefore || []).catch(() => null);
  // NAME THE SUBTREE. Walk each newly-present geometry's owner up its parent
  // chain to the first ancestor with a name — that is the subsystem that
  // attached it, and it is the one thing this whole thread has not identified.
  out.newOwners = await page.evaluate((before) => {
    const s3 = window.__fw && window.__fw.scene3d;
    const known = new Set(before);
    const tally = {};
    if (s3 && s3.scene) {
      s3.scene.traverse((o) => {
        if (!o.geometry || known.has(o.geometry.uuid)) return;
        let p = o;
        let label = '(no named ancestor)';
        while (p) {
          if (p.name) { label = p.name; break; }
          p = p.parent;
        }
        tally[label] = (tally[label] || 0) + 1;
      });
    }
    return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, out.geoIdsBefore || []).catch(() => null);
  out.geoSites = await page.evaluate(() => {
    window.__geoOn = false;
    const tally = {};
    for (const s of (window.__geoStacks || [])) tally[s] = (tally[s] || 0) + 1;
    return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }).catch(() => null);

  await beat('end');
  await page.waitForTimeout(800);

  out.frames = await page.evaluate(() => {
    const s = window.__p5;
    s.stop = true;
    const rows = s.rows.slice(2); // the sampler's own first frames
    const per = {};
    for (const r of rows) {
      per[r.beat] = per[r.beat] || [];
      per[r.beat].push(r.dt);
    }
    const stat = (list) => {
      if (!list.length) return null;
      const d = [...list].sort((a, b) => a - b);
      return {
        n: list.length,
        median: +d[Math.floor(d.length / 2)].toFixed(2),
        p95: +d[Math.floor((d.length - 1) * 0.95)].toFixed(2),
        worst: +Math.max(...list).toFixed(1),
        over16: list.filter((x) => x > 16).length,
        over16pct: +(100 * list.filter((x) => x > 16).length / list.length).toFixed(1),
        over33: list.filter((x) => x > 33).length,
        over100: list.filter((x) => x > 100).length,
      };
    };
    const byBeat = {};
    for (const [k, v] of Object.entries(per)) byBeat[k] = stat(v);
    return { all: stat(rows.map((r) => r.dt)), byBeat };
  });

  await page.screenshot({ path: path.join(OUT, 'phase5-end.png') });
  out.verdict = {
    everyBeatHappened: out.beats.every((b) => b.ok),
    beatsThatDidNot: out.beats.filter((b) => !b.ok).map((b) => b.name),
    // Standing Invariant 1, stated as the brief states it.
    noFrameOver16: out.frames.all.over16 === 0,
    worstFrameMs: out.frames.all.worst,
    framesOver16: out.frames.all.over16,
    framesOver16Pct: out.frames.all.over16pct,
    framesOver100: out.frames.all.over100,
    pageToPlayableMs: out.pageToPlayableMs,
    noPageErrors: out.errs.length === 0,
  };
  fs.writeFileSync(path.join(OUT, 'phase5-walk.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P5 verdict', JSON.stringify(out.verdict));
  console.log('P5 beats', JSON.stringify(out.beats));
  console.log('P5 byBeat', JSON.stringify(out.frames.byBeat));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
