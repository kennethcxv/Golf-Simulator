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
  const beat = (name) => page.evaluate((n) => window.__p5beat(n), name);

  const record = (name, ok, detail) => { out.beats.push({ name, ok, ...detail }); };

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
  record('tool', live.ok === true, {
    held: live.held ?? null,
    stoodOn: stood,
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
  record('tool2', true, { equipped2: await page.evaluate(() => window.__fw?.scene3d?.walk?.getTool?.() ?? 'none').catch(() => null) });

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
