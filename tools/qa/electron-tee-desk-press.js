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

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(7000); // past the deferred warm

  // 1. Find the starter desk in the world. The prop list is not exposed, but the
  //    facility kit is placed in the scene, so the STAND is findable by name and
  //    the prop sits on it.
  out.located = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const hits = [];
    s3.scene.traverse((o) => {
      if (!/starter/i.test(o.name || '')) return;
      const p = o.getWorldPosition(new (o.position.constructor)());
      hits.push({ name: o.name, type: o.type, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
    });
    return hits.slice(0, 12);
  });

  // 2. Stand at it, facing it, and PROVE it with the focus label the player
  //    reads. A press with no focus is a press at nothing.
  out.approach = await page.evaluate((spots) => {
    const s3 = window.__fw.scene3d;
    const w = s3.walk.state;
    const tries = [];
    for (const spot of spots) {
      // ring of stand-off points around the stand; the prop radius is ~3.1 and
      // the collider ~0.55, so 1.6 yd out is inside reach and outside the desk
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const x = spot.x + Math.sin(a) * 1.6;
        const z = spot.z + Math.cos(a) * 1.6;
        w.x = x; w.z = z; w.vx = 0; w.vz = 0;
        w.yaw = Math.atan2(-(spot.x - x), -(spot.z - z));
        w.pitch = -0.12;
        s3.walk.update?.(0.016);
        const label = s3.walk.getFocusLabel?.() ?? null;
        tries.push({ spot: spot.name, angle: i, label });
        if (label && /starter desk/i.test(label)) {
          return { found: true, spot: spot.name, x, z, label, tried: tries.length };
        }
      }
    }
    return { found: false, tried: tries.length, sample: tries.slice(0, 8) };
  }, out.located);

  if (!out.approach.found) {
    out.summary = { ABORTED: 'never reached a focus that names the starter desk', located: out.located, approach: out.approach };
    fs.writeFileSync(path.join(OUT, 'tee-desk.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('TEE-DESK', JSON.stringify(out.summary, null, 2));
    return out;
  }
  await page.waitForTimeout(800);

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
  await gesture('teeDesk_press_2nd_CONTROL', () => page.keyboard.press('e'), 3000);
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
