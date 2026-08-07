// A2 — "TABBING OUT AND BACK LOADS A DIFFERENT CLUBHOUSE FIRST, THEN MINE."
//
// A screenshot cannot catch this: whatever is wrong is wrong for a frame or two,
// and Playwright's screenshot forces a fresh paint that arrives after it. So the
// probe fingerprints the SCENE, every frame, from inside the render loop, across
// a real freeze and thaw.
//
// The fingerprint is chosen to separate "a different clubhouse" from "the same
// clubhouse, one frame late": the visible top-level roots, the count of visible
// meshes under the clubhouse group, the interior's own visibility, and the
// triangle count actually submitted. A different building shows up in all four.
//
// THE FREEZE IS REAL, not simulated. CDP's Page.setWebLifecycleState('frozen')
// is the state Chromium itself puts a backgrounded window into — rAF stops,
// timers stop. Dispatching a synthetic visibilitychange would exercise the app's
// handlers without ever stopping the loop, which is the half of the problem the
// complaint is about.
//
// CONTROL. The same fingerprint is recorded across an equal span of NORMAL
// frames, with no freeze. If the no-freeze leg shows the same variation, the
// fingerprint is measuring the living world (customers walking, doors swinging)
// rather than the thaw, and nothing here means anything.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tab-back');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  // Stand inside the shop looking at the room, where a swapped building would be
  // unmissable, with the world live.
  const world = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.6; w.z = o.z + 3.2; w.yaw = 0.6; w.pitch = -0.05;
    return { x: w.x, z: w.z, interior: { x: o.x, z: o.z } };
  });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const R = { on: false, rows: [] };
    window.__tab = R;
    const ch = s3.clubhouse();
    const chGroup = ch?.group || null;
    const chInterior = ch?.interior || null;

    const fingerprint = () => {
      // top-level roots the camera can see: the coarsest possible "is this a
      // different building" signal
      const roots = [];
      for (const child of s3.scene.children) {
        if (child.visible && child.name) roots.push(child.name);
      }
      let interiorVisibleMeshes = 0;
      let groupVisibleMeshes = 0;
      const visibleNamedRoots = [];
      if (chInterior) {
        chInterior.traverse((o) => {
          if (!o.visible) return;
          if (o.isMesh) interiorVisibleMeshes++;
          if (o.parent === chInterior && o.name) visibleNamedRoots.push(o.name);
        });
      }
      if (chGroup) {
        chGroup.traverse((o) => { if (o.visible && o.isMesh) groupVisibleMeshes++; });
      }
      return {
        roots: roots.sort().join('|'),
        interiorOn: !!chInterior?.visible,
        interiorVisibleMeshes,
        groupVisibleMeshes,
        interiorRoots: visibleNamedRoots.sort().join('|'),
      };
    };
    R.fingerprint = fingerprint;

    // hooked into the render loop so the sample is the state the frame DREW,
    // not the state a later evaluate() round-trip finds
    const origRender = s3.render;
    s3.render = function tabProbeRender(dt, st) {
      const out = origRender.call(this, dt, st);
      if (R.on) {
        const f = fingerprint();
        R.rows.push({
          t: Math.round(performance.now()),
          dt: Math.round(dt),
          ...f,
          tris: s3.renderer.info.render.triangles,
          draws: s3.renderer.info.render.calls,
        });
      }
      return out;
    };
    R.start = () => { R.on = true; R.rows = []; };
    R.stop = () => {
      R.on = false;
      const rows = R.rows;
      if (!rows.length) return { rows: [], distinct: 0 };
      // the first frame is the reference; anything that differs from the SETTLED
      // fingerprint (the last frame) is what the player saw flash
      const settled = rows[rows.length - 1];
      const key = (r) => `${r.roots}#${r.interiorOn}#${r.interiorRoots}`;
      const settledKey = key(settled);
      const odd = rows.map((r, i) => ({ i, ...r })).filter((r) => key(r) !== settledKey);
      const meshSwing = rows.map((r) => r.interiorVisibleMeshes);
      return {
        frames: rows.length,
        settled: {
          interiorOn: settled.interiorOn,
          interiorVisibleMeshes: settled.interiorVisibleMeshes,
          groupVisibleMeshes: settled.groupVisibleMeshes,
          rootCount: settled.roots.split('|').length,
        },
        oddFrames: odd.length,
        firstOdd: odd[0] || null,
        distinctFingerprints: new Set(rows.map(key)).size,
        interiorMeshMin: Math.min(...meshSwing),
        interiorMeshMax: Math.max(...meshSwing),
        maxDt: Math.max(...rows.map((r) => r.dt)),
        // the frames either side of the longest gap: whatever the player saw on
        // the way back is here if it is anywhere
        aroundTheGap: (() => {
          let at = 0;
          for (let i = 1; i < rows.length; i++) if (rows[i].dt > rows[at].dt) at = i;
          return rows.slice(Math.max(0, at - 1), at + 6).map((r) => ({
            dt: r.dt, interiorOn: r.interiorOn, meshes: r.interiorVisibleMeshes,
            groupMeshes: r.groupVisibleMeshes, tris: r.tris, draws: r.draws,
          }));
        })(),
        firstFrames: rows.slice(0, 8).map((r) => ({
          dt: r.dt, interiorOn: r.interiorOn, meshes: r.interiorVisibleMeshes,
          groupMeshes: r.groupVisibleMeshes, tris: r.tris, draws: r.draws,
        })),
      };
    };
  });

  // ---- CONTROL: the same window of frames, no freeze -----------------------------------
  await page.evaluate(() => window.__tab.start());
  await page.waitForTimeout(4000);
  const control = await page.evaluate(() => window.__tab.stop());

  // ---- THE THAW ------------------------------------------------------------------------
  //
  // CDP's Page.setWebLifecycleState('frozen') WAS TRIED FIRST AND DID NOTHING.
  // Chromium ignores it while the page is visible: the leg reported 731 frames
  // at 9-12 ms across the whole "frozen" span, i.e. the loop never stopped, and
  // the clean result it produced was a result about no treatment at all.
  // Minimising the real BrowserWindow is the thing the complaint describes.
  let freezeMethod = 'BrowserWindow.minimize';
  await page.evaluate(() => window.__tab.start());
  try {
    await page.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
  } catch (e) {
    freezeMethod = `minimize unavailable: ${String(e.message || e)}`;
  }
  await new Promise((r) => setTimeout(r, 5000));
  await page.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.restore();
    win?.focus();
  }).catch(() => {});
  await page.waitForTimeout(5000);
  const thaw = await page.evaluate(() => window.__tab.stop());

  // ---- and a plain blur/focus round, which is what alt-tab actually does ----------------
  await page.evaluate(() => window.__tab.start());
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(3000);
  const blurRound = await page.evaluate(() => window.__tab.stop());

  // ---- WHAT THE SCREEN ACTUALLY SHOWS ON THE WAY BACK ----------------------------------
  //
  // The scene graph came back identical, so if the player is seeing a different
  // room it is not a different room in the graph — it is pixels: stale
  // presentation, lighting re-derived from a jumped clock, or an effect chain
  // rebuilding. Only an image can settle that, so take a burst of them starting
  // the instant the window is restored, from OUTSIDE looking at the building,
  // which is where "a different clubhouse" would be visible at all.
  await page.evaluate(() => {
    const o = window.__fw.scene3d.clubhouse().interior.position;
    const w = window.__fw.scene3d.walk.state;
    w.x = o.x - 2; w.z = o.z + 26; w.yaw = Math.PI; w.pitch = -0.02;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'burst-00-reference.png') });
  await page.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.minimize();
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));
  await page.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.restore();
    win?.focus();
  }).catch(() => {});
  const burst = [];
  for (let i = 1; i <= 10; i++) {
    const file = path.join(OUT, `burst-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    burst.push(path.basename(file));
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'burst-99-settled.png') });

  const out = {
    world, freezeMethod, control, thaw, blurRound, burst,
    checks: {
      // the control has to be QUIET, or the fingerprint is watching the living
      // world rather than the thaw
      controlIsQuiet: control.distinctFingerprints === 1,
      controlSawFrames: control.frames > 100,
      // THE TREATMENT MUST HAVE HAPPENED. A minimised window stops painting, so
      // the thaw leg has to show FEWER frames than the control over a longer
      // span — and a gap. Without this the first version of this driver reported
      // a clean result for a freeze that never occurred.
      windowActuallyStopped: thaw.frames < control.frames,
      thawSawAGap: (thaw.firstFrames || []).length > 0 && thaw.maxDt > 200,
      thawSawFrames: thaw.frames > 20,
      // the finding, if there is one
      thawFlashesADifferentRoom: thaw.distinctFingerprints > 1,
      blurFlashesADifferentRoom: blurRound.distinctFingerprints > 1,
      interiorMeshCountStableAcrossThaw: thaw.interiorMeshMin === thaw.interiorMeshMax,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlSawFrames && out.checks.thawSawFrames;
  fs.writeFileSync(path.join(OUT, 'tab-back.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
