// ITEM 5 — WHAT DOES exitEditor INVALIDATE?
//
// The owner: "I left the course editor, swapped to my broom and got 5 seconds,
// then walked outside and the front door delayed again. Both of those surfaces
// were already fixed and both came back after an editor round trip."
//
// main.js:1836 has carried an open question for two goals — "the under-veil exit
// leaves state ... Do not retry this shape without understanding what exitEditor
// invalidates." Every instrument aimed at this so far counted program ARRIVALS.
// Arrivals cannot see this defect: a surface that was warm, went cold, and
// recompiled reads as an arrival only AFTER the stall the owner felt, and reads
// as +0 net if something else was disposed in the same window.
//
// THIS CHECK MEASURES DELETIONS. Full cacheKey sets are captured before entering
// the editor and after leaving it; the verdict is the set difference A \ B —
// programs that were warm, and are gone. That is a different KIND of number from
// every check that passed before it, which is the bar CLAUDE.md sets for a
// ledger item.
//
// NEGATIVE CONTROL (runs first, before any measurement): a throwaway mesh with a
// deliberately unique cache key is drawn, snapped, disposed, and snapped again.
// The deletion detector must name that key. If it does not, nothing below this
// line means anything and the driver says so.
//
// PLAYED, not booted: walk in through the door, tap the belt round to the broom
// and back off it, and let the tripwire arm (frame 900 of walk) BEFORE the
// bracket opens. A driver that boots, warms and immediately presses the surface
// is measuring the warm.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal34-editor-roundtrip-invalidation.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal34');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'roundtrip';
  const out = { tag, errs: [], failures: [], marks: {} };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  await page.evaluate(() => {
    const S = { gaps: [], longtasks: [], last: performance.now() };
    window.__rt = S;
    const tick = () => {
      const now = performance.now();
      const gap = now - S.last;
      if (gap > 50) S.gaps.push({ t: +now.toFixed(0), ms: +gap.toFixed(1) });
      S.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) S.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* gaps still stand */ }
  });

  if (process.env.QA_RESUME) {
    out.continueEnabled = await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /\bContinue\b/.test(c.querySelector('.menu-action-label')?.textContent || c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 90000 }).then(() => true).catch(() => false);
  }
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  const now = () => page.evaluate(() => +performance.now().toFixed(0));
  // A QUIET LEG immediately before each measured gesture. If a no-input window
  // is already carrying second-long gaps, the gesture's number is the machine,
  // not the game — this is the metronome tell for Chromium's 1 Hz throttle on a
  // window that lost the foreground, which voided rt2's items 5a and 5b.
  const quiet = async (label) => {
    await page.bringToFront().catch(() => {});
    const t0 = await now();
    await page.waitForTimeout(2600);
    const t1 = await now();
    const w = await page.evaluate(({ a, b }) => {
      const g = window.__rt.gaps.filter((x) => x.t >= a && x.t <= b).map((x) => x.ms);
      return g.length ? +Math.max(...g).toFixed(0) : 0;
    }, { a: t0, b: t1 });
    out.quiet = out.quiet || {};
    out.quiet[label] = w;
    if (w > 300) fail(`quiet control before ${label} carried a ${w} ms gap — that leg measures the machine`);
    return w;
  };
  const snap = (label) => page.evaluate((lab) => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;
    window.__rtKeys = window.__rtKeys || {};
    window.__rtKeys[lab] = (info.programs || []).map((p) => String(p.cacheKey));
    return {
      t: +performance.now().toFixed(0),
      programs: info.programs?.length ?? -1,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      calls: info.render.calls,
    };
  }, label);
  // set difference over the captured key lists, with each loss named by its
  // nearest surviving twin so a deletion says WHICH axis went cold
  const diff = (a, b) => page.evaluate(({ A, B }) => {
    const k = window.__rtKeys;
    const setA = new Set(k[A] || []);
    const setB = new Set(k[B] || []);
    const name = (key, against) => {
      const f = key.split(',');
      let best = null;
      for (const other of against) {
        const o = other.split(',');
        if (o.length !== f.length) continue;
        const diffs = [];
        for (let i = 0; i < f.length && diffs.length <= 4; i += 1) {
          if (o[i] !== f[i]) diffs.push({ i, was: o[i], is: f[i] });
        }
        if (diffs.length && (!best || diffs.length < best.length)) best = diffs;
      }
      return { family: f[0]?.slice(0, 18), fields: f.length, nearestTwinDiffs: best || 'no-same-width-twin' };
    };
    const deleted = [...setA].filter((x) => !setB.has(x));
    const added = [...setB].filter((x) => !setA.has(x));
    return {
      deletedCount: deleted.length,
      addedCount: added.length,
      deleted: deleted.slice(0, 40).map((x) => name(x, setB)),
      added: added.slice(0, 40).map((x) => name(x, setA)),
    };
  }, { A: a, B: b });

  // ---------------------------------------------------------------------------
  // NEGATIVE CONTROL. Draw a mesh whose program cannot already exist, snap,
  // dispose it, snap. `deleted` must contain exactly that one key.
  // ---------------------------------------------------------------------------
  // The donor must be a mesh that is DEMONSTRABLY DRAWING — a hidden or
  // layer-masked mesh yields no program at all and the control would then be
  // testing nothing while reporting a number. One frame of onBeforeRender
  // stamps decide it; the first attempt staged a 2 cm mesh at the camera
  // origin, inside the near plane, and never drew.
  await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const drew = [];
    const restore = [];
    s3.scene.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || !o.geometry) return;
      const prev = o.onBeforeRender;
      restore.push([o, prev]);
      o.onBeforeRender = function stamp(...a) {
        if (drew.length < 40) drew.push(o);
        if (typeof prev === 'function') prev.apply(this, a);
      };
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const [o, prev] of restore) o.onBeforeRender = prev || (() => {});
      window.__rtCtl = { drewCount: drew.length, donor: drew[0] || null };
      resolve();
    }));
  }));
  out.control = await page.evaluate(() => {
    const C = window.__rtCtl;
    if (!C.donor) return { staged: false, why: 'no mesh drew in the sampled frame', drewCount: C.drewCount };
    const donor = C.donor;
    const orig = donor.material;
    const m = orig.clone();
    // `defines` are part of three's program cache key, so this key cannot
    // already exist however many twins the scene carries.
    m.defines = { ...(orig.defines || {}), RT_CONTROL_UNIQUE: 1 };
    m.needsUpdate = true;
    donor.material = m;
    C.orig = orig;
    C.clone = m;
    return { staged: true, drewCount: C.drewCount, donorName: donor.name || '(unnamed)' };
  });
  await page.waitForTimeout(1400); // several real frames, so it is submitted
  out.control.withClone = await snap('ctlWith');
  await page.evaluate(() => {
    const C = window.__rtCtl;
    if (!C.donor) return;
    C.donor.material = C.orig;
    C.clone.dispose();
  });
  await page.waitForTimeout(1400);
  out.control.restored = await snap('ctlWithout');
  out.control.detector = await diff('ctlWith', 'ctlWithout');
  out.control.staged1Program = out.control.staged
    && (out.control.withClone.programs - out.control.restored.programs) === 1;
  out.control.works = out.control.staged1Program && out.control.detector.deletedCount >= 1;
  if (!out.control.works) {
    fail('NEGATIVE CONTROL FAILED: disposing a uniquely-keyed material did not '
      + 'show up as a deletion, so this driver cannot see invalidation at all');
  }

  // ---------------------------------------------------------------------------
  // PLAY. Walk in, use the belt, and let the tripwire arm before measuring.
  // ---------------------------------------------------------------------------
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);

  const inside = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse?.();
    return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
  });
  out.walkIn = { legs: 0, inside: false };
  for (let leg = 0; leg < 6 && !out.walkIn.inside; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(600);
    out.walkIn.legs = leg + 1;
    out.walkIn.inside = await inside();
  }
  if (!out.walkIn.inside) fail('never got inside — the played session did not happen');

  // the belt, tapped the way he taps it (F cycles; hold opens the wheel)
  const tapToTool = async (want, maxTaps = 12) => {
    for (let i = 0; i < maxTaps; i += 1) {
      const held = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
      if (held === want) return { ok: true, taps: i };
      await page.keyboard.press('f');
      await page.waitForTimeout(420);
    }
    return { ok: false, taps: maxTaps };
  };
  const stow = async () => {
    for (let i = 0; i < 12; i += 1) {
      const held = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
      if (held == null) return true;
      await page.keyboard.press('f');
      await page.waitForTimeout(380);
    }
    return false;
  };
  out.playBroom = await tapToTool('broom');
  await page.waitForTimeout(1200);
  await stow();
  await page.waitForTimeout(800);

  // arm the tripwire: frame 900 of active walk, the point past which any
  // arrival is a genuinely missed surface rather than deferred load work
  out.tripwireArmed = await page.waitForFunction(
    () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
    null, { timeout: 240000 },
  ).then(() => true).catch(() => false);

  // ---------------------------------------------------------------------------
  // THE BRACKET.
  // ---------------------------------------------------------------------------
  out.beforeEditor = await snap('beforeEditor');

  // control leg: the broom while everything is still warm, so the post-exit
  // number below has something of the same kind to be compared against
  await quiet('broomWarm');
  out.marks.broomWarmPress = await now();
  const warmEquip = await tapToTool('broom');
  await page.waitForTimeout(2500);
  out.marks.broomWarmDone = await now();
  out.broomWarm = { ...warmEquip, snap: await snap('broomWarm') };
  await stow();
  await page.waitForTimeout(700);

  await quiet('editorOpen');
  out.marks.editorPress = await now();
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
    && !!document.querySelector('.ced-rail'), null, { timeout: 60000 })
    .catch(() => fail('editor never opened on j'));
  await page.waitForTimeout(4000);
  out.marks.editorOpen = await now();
  out.afterEditorOpen = await snap('afterEditorOpen');
  await page.screenshot({ path: path.join(OUT, `${tag}-editor-open.png`) });

  // ITEM 4: the first tee tool inside the editor
  await quiet('tee');
  out.marks.teePress = await now();
  const teeClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.ced-tool')];
    const tee = btns.find((b) => /Tee/i.test(b.textContent || ''));
    if (!tee) return false;
    tee.click();
    return true;
  });
  if (!teeClicked) fail('no Tee button in the editor rail');
  await page.waitForTimeout(6000);
  out.marks.teeDone = await now();
  out.afterTee = await snap('afterTee');
  await page.screenshot({ path: path.join(OUT, `${tag}-editor-tee.png`) });

  // Escape does NOT leave the editor: main.js claims it for the pause menu
  // before courseEditor's own handler sees it (qa/goal34/rt1-after-exit.png is
  // the pause menu sitting over a still-active editor, which is how the first
  // cut of this driver measured items 5a and 5b from INSIDE the editor). The
  // Exit button in the editor's top bar is the gesture that leaves.
  await quiet('exit');
  out.marks.exitPress = await now();
  out.exitClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.ced-top-btn')]
      .find((x) => /Exit/i.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!out.exitClicked) fail('no Exit button in the editor top bar');
  // "Leave the editor?" appears only when the session is dirty; discard, since
  // this driver must not bill the owner's save for a tee it never placed
  await page.waitForTimeout(900);
  out.exitModal = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((x) => /Discard & leave/i.test(x.textContent || ''));
    if (!btn) return 'none';
    btn.click();
    return 'discarded';
  });
  // hide() leaves .ced-rail in the DOM — the first cut waited on its REMOVAL,
  // sat 90 s in a dead waitForFunction, and the window fell to the 1 Hz
  // occluded-rAF throttle inside that window. Mode is the signal; visibility,
  // not existence, is the DOM half.
  await page.waitForFunction(() => {
    if (window.__fw?.courseMode === 'editor') return false;
    const rail = document.querySelector('.ced-rail');
    return !rail || rail.offsetParent === null;
  }, null, { timeout: 90000 })
    .catch(() => fail('editor never closed on the Exit button'));
  await page.waitForTimeout(4000);
  out.backInWalk = await page.evaluate(() => ({
    courseMode: window.__fw?.courseMode ?? null,
    walkActive: !!window.__fw?.scene3d?.walk?.isActive?.(),
    pauseOpen: !!document.querySelector('.pause-menu, .pause-root'),
  }));
  if (!out.backInWalk.walkActive) fail('not walking after the exit — 5a/5b would measure the editor');
  out.marks.exitDone = await now();
  out.afterExit = await snap('afterExit');
  await page.screenshot({ path: path.join(OUT, `${tag}-after-exit.png`) });

  // ITEM 5a: the broom, again, after the round trip
  await quiet('broomAfterExit');
  out.marks.broomColdPress = await now();
  const coldEquip = await tapToTool('broom');
  await page.waitForTimeout(2500);
  out.marks.broomColdDone = await now();
  out.broomAfterExit = { ...coldEquip, snap: await snap('broomAfterExit') };
  await page.screenshot({ path: path.join(OUT, `${tag}-broom-after-exit.png`) });

  // ITEM 5b: back out through the front door, holding it
  await quiet('doorAfterExit');
  out.marks.doorPress = await now();
  await page.keyboard.down('s');
  await page.waitForTimeout(5000);
  await page.keyboard.up('s');
  await page.waitForTimeout(2500);
  out.marks.doorDone = await now();
  out.afterDoor = await snap('afterDoor');
  await page.screenshot({ path: path.join(OUT, `${tag}-after-door.png`) });

  // ---------------------------------------------------------------------------
  // THE VERDICT.
  // ---------------------------------------------------------------------------
  out.acrossRoundTrip = await diff('beforeEditor', 'afterExit');
  out.acrossEntry = await diff('beforeEditor', 'afterEditorOpen');
  out.acrossExit = await diff('afterTee', 'afterExit');
  out.acrossBroomAfterExit = await diff('afterExit', 'broomAfterExit');
  out.acrossDoorAfterExit = await diff('broomAfterExit', 'afterDoor');

  const logs = await page.evaluate(() => ({ gaps: window.__rt.gaps, longtasks: window.__rt.longtasks }));
  const worst = (t0, t1) => {
    const g = logs.gaps.filter((x) => x.t >= t0 && x.t <= t1).map((x) => x.ms);
    return g.length ? +Math.max(...g).toFixed(0) : 0;
  };
  const M = out.marks;
  out.acceptance = {
    broomWarmWorstMs: worst(M.broomWarmPress, M.broomWarmDone),
    editorOpenWorstMs: worst(M.editorPress, M.editorOpen),
    teeWorstMs: worst(M.teePress, M.teeDone),
    exitWorstMs: worst(M.exitPress, M.exitDone),
    broomAfterExitWorstMs: worst(M.broomColdPress, M.broomColdDone),
    doorAfterExitWorstMs: worst(M.doorPress, M.doorDone),
  };
  out.longtasks = logs.longtasks.filter((t) => t.ms > 250);
  out.tripwire = await page.evaluate(() => window.__fw.scene3d.programArrivalTripwire?.() || 'no tripwire');

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    bootPath: out.bootPath,
    control: {
      works: out.control.works,
      staged1Program: out.control.staged1Program,
      deleted: out.control.detector.deletedCount,
      drewCount: out.control.drewCount,
    },
    walkIn: out.walkIn,
    exit: { clicked: out.exitClicked, modal: out.exitModal, back: out.backInWalk },
    tripwireArmed: out.tripwireArmed,
    counts: {
      beforeEditor: out.beforeEditor,
      afterEditorOpen: out.afterEditorOpen,
      afterExit: out.afterExit,
      broomAfterExit: out.broomAfterExit.snap,
      afterDoor: out.afterDoor,
    },
    acrossRoundTrip: { deleted: out.acrossRoundTrip.deletedCount, added: out.acrossRoundTrip.addedCount },
    acrossEntry: { deleted: out.acrossEntry.deletedCount, added: out.acrossEntry.addedCount },
    acrossExit: { deleted: out.acrossExit.deletedCount, added: out.acrossExit.addedCount },
    broomAfterExitArrivals: out.acrossBroomAfterExit.addedCount,
    doorAfterExitArrivals: out.acrossDoorAfterExit.addedCount,
    quiet: out.quiet,
    acceptance: out.acceptance,
    tripwireRows: Array.isArray(out.tripwire) ? out.tripwire.length : out.tripwire,
    failures: out.failures,
  }, null, 2));
  return out;
}
