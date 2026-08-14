// ROUND 7 — THE TEE DESK PRESS: what actually costs the frame?
//
// "the only lag was just clicking on the tee desk."
//
// Reading the code first raised a question this has to answer before any fix:
// the starter desk's action calls walkHooks.openFrontDesk -> enterFrontDesk(),
// and enterFrontDesk bails at `if (!pose || !frontDeskUi) return;`. Nothing in
// src/ assigns frontDeskUi -- src/ui/frontDesk.js is imported by nothing -- so
// on a plain reading the press opens NOTHING and the lag has to be somewhere
// else entirely (the focus move, putDownCarried, a prompt rebuild).
//
// That is a reading, not a measurement, and this repository has twice burned a
// session on a module that turned out to be dead (clubhouse/customers.js) and
// once on assuming a live one was dead. So this asks the running game.
//
// THE CONTROL THAT MATTERS: a driver that presses E while standing nowhere near
// the starter desk measures an empty press and reports it as clean. So the
// focus label is asserted to name the starter desk BEFORE the press, and the
// run says so. Same shape as the register drivers' "at the till" assertion.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-tee-desk-press.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tee-desk-press');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], gestures: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const text = String(m.text());
    if (/fault:|Error/i.test(text)) out.errs.push(`console: ${text.slice(0, 200)}`);
  });

  // THE OWNER'S OWN SAVE, planted into the QA profile. ensureGolfFacilities()
  // returns immediately without `st.golfDay.routeNetwork`, so on a clean profile
  // the starter desk does not exist at all -- the first run of this driver
  // searched a world with no tee desk in it and found nothing, which is a true
  // answer to the wrong question. `forceNew: false` does not help either: the
  // runner always launches on a fresh temp --user-data-dir, so there is no save
  // to resume. Same planting sequence as electron-owner-save-fps.js.
  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));
  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  // NOT /\bContinue\b/: an ENABLED Continue reads "ContinuePine Hills..." and the
  // trailing word boundary can only ever match a DISABLED button. Wait for the
  // button to enable, then click it. A timeout is a loud failure, not a fallback
  // to a new game -- a fresh campaign has no route network and would abort below
  // while looking like a measurement.
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(7000); // past the deferred warm

  // RETARGETED TO THE INDOOR TEE DESK.
  //
  // There are two desks and only one of them is the owner's. Outdoors by the
  // first tee is the "Starter desk", whose action routes to enterFrontDesk() --
  // and that bails, because nothing in src/ ever assigns frontDeskUi
  // (src/ui/frontDesk.js is imported by nothing). Measured there: the press
  // opens NOTHING, frontDeskOpen stays false and the DOM does not change.
  //
  // The owner's "tee desk" is the counter prop in clubhouse.js whose label reads
  // literally "Tee desk - [E] arrivals, check-ins and walk-ins", and whose action
  // is register.enter(). That is this one.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2; w.vx = 0; w.vz = 0;
  });
  await page.waitForTimeout(900);
  out.approach = await page.evaluate(() => ({
    found: true,
    spot: 'walk.stations()[0]',
    label: window.__fw.scene3d.walk.getFocusLabel?.() ?? null,
  }));
  if (!/tee desk/i.test(out.approach.label || '')) {
    out.summary = { ABORTED: 'focus does not name the tee desk', approach: out.approach };
    fs.writeFileSync(path.join(OUT, 'tee-desk.json'), JSON.stringify(out, null, 2) + String.fromCharCode(10));
    console.log('TEE-DESK', JSON.stringify(out.summary, null, 2));
    return out;
  }
  await page.waitForTimeout(800);

  // DID THE WARM ACTUALLY ENTER? gesture-register-<outcome> carries it. An
  // enter() that returned false and one that ran are indistinguishable from the
  // press side, and the whole point of the warm is that the player press is
  // really the SECOND entry.
  out.prewarmTimings = await page.evaluate(() => {
    const t = window.__fw.scene3d.prewarmTimings?.() ?? null;
    return Array.isArray(t) ? t.map((x) => ({ label: x.label, ms: x.ms })) : t;
  });
  out.gesturePhases = (out.prewarmTimings || []).filter((t) => String(t.label).startsWith('gesture'));
  console.log('GESTURE-PHASES', JSON.stringify(out.gesturePhases));

  const counters = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const info = s3.renderer.info;
    return {
      programs: info.programs?.length ?? null,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      // The station flags, so "the press did something" is observable rather
      // than assumed. A press that opens nothing and a press that opens a panel
      // are different bugs.
      frontDeskOpen: !!window.__fw.frontDeskOpen,
      ledgerOpen: !!window.__fw.ledgerOpen,
      laptopOpen: !!window.__fw.laptopOpen,
      bodyClass: document.body.className,
      domNodes: document.getElementsByTagName('*').length,
      focusLabel: s3.walk.getFocusLabel?.() ?? null,
    };
  });

  const gesture = async (label, run, settleMs = 3000) => {
    await page.evaluate(() => {
      window.__t = []; window.__tStop = false;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        window.__t.push(+(now - last).toFixed(1));
        last = now;
        if (!window.__tStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(250);
    const before = await counters();
    await run();
    await page.waitForTimeout(settleMs);
    const dts = (await page.evaluate(() => { window.__tStop = true; return window.__t; })).slice(1);
    const after = await counters();
    const row = {
      label,
      maxMs: dts.length ? +Math.max(...dts).toFixed(1) : null,
      medianMs: dts.length ? +dts.slice().sort((a, b) => a - b)[Math.floor(dts.length / 2)].toFixed(1) : null,
      framesOver50ms: dts.filter((d) => d > 50).length,
      programDelta: (after.programs ?? 0) - (before.programs ?? 0),
      textureDelta: after.textures - before.textures,
      geometryDelta: after.geometries - before.geometries,
      domNodeDelta: after.domNodes - before.domNodes,
      stateBefore: {
        frontDeskOpen: before.frontDeskOpen, bodyClass: before.bodyClass, focus: before.focusLabel,
      },
      stateAfter: {
        frontDeskOpen: after.frontDeskOpen, bodyClass: after.bodyClass, focus: after.focusLabel,
      },
    };
    out.gestures.push(row);
    console.log('TEE', JSON.stringify(row));
    return row;
  };

  // CONTROL: an idle window of the same length, so the frame numbers have a
  // floor to be read against.
  await gesture('control_idle', async () => {}, 3000);
  await gesture('teeDesk_press_1st', () => page.keyboard.press('e'), 3500);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(1200);
  await gesture('teeDesk_press_2nd_CONTROL', () => page.keyboard.press('e'), 3000);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave?.());
  await page.waitForTimeout(1200);
  await gesture('teeDesk_press_3rd', () => page.keyboard.press('e'), 3000);

  out.summary = {
    approach: { spot: out.approach.spot, label: out.approach.label },
    rows: out.gestures.map((g) => ({
      label: g.label,
      maxMs: g.maxMs,
      medianMs: g.medianMs,
      over50: g.framesOver50ms,
      prog: g.programDelta,
      tex: g.textureDelta,
      geo: g.geometryDelta,
      dom: g.domNodeDelta,
      opened: g.stateAfter.frontDeskOpen,
      bodyClass: g.stateAfter.bodyClass,
    })),
    errs: out.errs.slice(0, 8),
  };
  fs.writeFileSync(path.join(OUT, 'tee-desk.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('TEE-DESK', JSON.stringify(out.summary, null, 2));
  return out;
}
