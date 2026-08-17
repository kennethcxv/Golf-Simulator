// OWNER-PLAY REPRO — the game the way HE boots it, not the way the census
// does. His save (Continue on a copy of his real profile), no sim-speed pin,
// no clock pin, customers live, REAL held-key walking to the front door,
// the door opened by the same proximity/verb path he used, then a real Tab.
//
// Instruments carried the whole way:
//   * a rAF gap log (anything over 100 ms, timestamped);
//   * PerformanceObserver('longtask') — a 10 s JS block names itself here;
//   * renderer.info + program-key snapshots bracketing the door and the Tab,
//     so an arriving program / texture / geometry attributes the freeze.
//
//   VIDEO_DIR=qa/ownerplay node tools/qa/run-electron.cjs \
//     tools/qa/ownerplay-door-tab-repro.js --clubhouse=pine-hills-v2
//   (profile: QA_ELECTRON_USER_DATA_DIR must point at the OWNER-PLAY COPY)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  // samplers BEFORE any click
  await page.evaluate(() => {
    const S = { gaps: [], longtasks: [], last: performance.now() };
    window.__own = S;
    const tick = () => {
      const now = performance.now();
      const gap = now - S.last;
      if (gap > 100) S.gaps.push({ t: +now.toFixed(0), ms: +gap.toFixed(1) });
      S.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          S.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0), name: e.name });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* longtask unsupported: gaps still stand */ }
  });

  // HIS boot: wait for CONTINUE itself to enable (the save scan lands after
  // the manifest — two cuts of this driver raced it and measured a fresh
  // world). If it stays disabled 25 s on a profile that carries his save,
  // record that as its own finding and proceed new-game.
  out.continueEnabled = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')]
      .find((c) => /\bContinue\b/.test(c.textContent || ''));
    return !!b && !b.disabled;
  }, null, { timeout: 25000 }).then(() => true).catch(() => false);
  out.bootMode = await boot.clickThroughMenu(page, {});
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500); // he waits no longer than this

  const snap = (label) => page.evaluate((lab) => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;
    window.__ownKeys = window.__ownKeys || {};
    window.__ownKeys[lab] = (info.programs || []).map((p) => String(p.cacheKey));
    return {
      t: +performance.now().toFixed(0),
      programs: info.programs?.length ?? -1,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }, label);

  // where he is, where the door is
  out.stage = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let doorNode = null;
    s3.scene.traverse((o) => {
      const u = o.userData || {};
      if (!doorNode) { for (const k in u) if (/door/i.test(k)) { doorNode = o; break; } }
    });
    const V = s3.camera.position.constructor;
    const dp = doorNode ? doorNode.getWorldPosition(new V()) : null;
    const w = s3.walk;
    return {
      speedIdx: window.__fw.speedIdx,
      clockMin: window.__fw.state?.clock?.minutes ?? null,
      player: w.state ? { x: +w.state.x.toFixed(1), z: +w.state.z.toFixed(1) } : null,
      door: dp ? { x: +dp.x.toFixed(1), z: +dp.z.toFixed(1) } : null,
    };
  });
  if (!out.stage.door || !out.stage.player) {
    out.errs.push('no door node or walk.state — cannot walk');
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
    return out;
  }

  // pointer capture, then REAL walking: hold W, steer by walk.state.yaw
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  out.beforeDoor = await snap('beforeDoor');
  await page.keyboard.down('w');
  const walkStart = Date.now();
  let arrived = false;
  while (Date.now() - walkStart < 25000) {
    const d = await page.evaluate(({ tx, tz }) => {
      const w = window.__fw.scene3d.walk;
      const dx = tx - w.state.x;
      const dz = tz - w.state.z;
      const dist = Math.hypot(dx, dz);
      // walk-forward convention: forward = (-sin yaw, -cos yaw)
      w.state.yaw = Math.atan2(-dx, -dz);
      return dist;
    }, { tx: out.stage.door.x, tz: out.stage.door.z });
    if (d < 2.1) { arrived = true; break; }
    await page.waitForTimeout(180);
  }
  await page.keyboard.up('w');
  out.walk = { arrived, walkMs: Date.now() - walkStart };

  // the door: proximity opens it; if a prompt names it, E as well — his verb
  const label = await page.evaluate(() => window.__fw.scene3d?.walk?.getFocusLabel?.() || null);
  out.doorPromptLabel = label && String(label).slice(0, 70);
  if (label && /door|open/i.test(String(label))) await page.keyboard.press('e');
  await page.waitForTimeout(3500); // the freeze he felt lives here if it lives anywhere
  out.afterDoor = await snap('afterDoor');

  // walk THROUGH the doorway, outside, like he did
  await page.keyboard.down('w');
  await page.waitForTimeout(1800);
  await page.keyboard.up('w');
  await page.waitForTimeout(1200);
  out.afterWalkThrough = await snap('afterWalkThrough');

  // TAB — the overview
  out.beforeTab = await snap('beforeTab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(4000);
  out.afterTab = await snap('afterTab');
  await page.screenshot({ path: path.join(OUT, 'after-tab.png') });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);

  // collect the logs and name the arrivals
  const logs = await page.evaluate(() => ({
    gaps: window.__own.gaps,
    longtasks: window.__own.longtasks,
  }));
  out.gaps = logs.gaps.filter((g) => g.ms > 300);
  out.longtasks = logs.longtasks.filter((t) => t.ms > 300);
  out.programArrivals = await page.evaluate(() => {
    const k = window.__ownKeys;
    // name each arrival by its nearest settled twin's differing fields —
    // the axis of the freeze, not just its count (the 2681f28 rule: fields
    // by VALUE difference, never named by index alone)
    const arrivalsWithTwins = (a, b) => {
      const A = new Set(k[a] || []);
      return (k[b] || []).filter((x) => !A.has(x)).map((key) => {
        const f = key.split(',');
        let best = null;
        for (const oldKey of A) {
          const o = oldKey.split(',');
          if (o.length !== f.length) continue;
          const diffs = [];
          for (let i = 0; i < f.length && diffs.length <= 5; i += 1) {
            if (o[i] !== f[i]) diffs.push({ i, was: o[i], is: f[i] });
          }
          if (diffs.length && (!best || diffs.length < best.length)) best = diffs;
        }
        return { family: f[0]?.slice(0, 14), nearestTwinDiffs: best || 'no same-width twin' };
      });
    };
    return {
      acrossDoor: arrivalsWithTwins('beforeDoor', 'afterDoor'),
      acrossWalkThrough: arrivalsWithTwins('afterDoor', 'afterWalkThrough'),
      acrossTab: arrivalsWithTwins('beforeTab', 'afterTab'),
    };
  });

  const d = (a, b, f) => (out[b][f] ?? 0) - (out[a][f] ?? 0);
  out.attribution = {
    door: {
      programs: d('beforeDoor', 'afterDoor', 'programs'),
      geometries: d('beforeDoor', 'afterDoor', 'geometries'),
      textures: d('beforeDoor', 'afterDoor', 'textures'),
    },
    walkThrough: {
      programs: d('afterDoor', 'afterWalkThrough', 'programs'),
      geometries: d('afterDoor', 'afterWalkThrough', 'geometries'),
      textures: d('afterDoor', 'afterWalkThrough', 'textures'),
    },
    tab: {
      programs: d('beforeTab', 'afterTab', 'programs'),
      geometries: d('beforeTab', 'afterTab', 'geometries'),
      textures: d('beforeTab', 'afterTab', 'textures'),
    },
  };

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'repro-result.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
