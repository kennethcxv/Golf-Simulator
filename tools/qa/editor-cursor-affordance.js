// THE EDITOR'S CURSOR MUST BE ON SCREEN BEFORE THE MOUSE MOVES.
//
// The owner's report: "I open the editor and there is nothing showing me where
// I am about to edit until I move the mouse and wait." This is not a stall —
// the brush ring, the shaped feature outline and its fill are RETAINED across
// pointer moves, but they are only ever revealed BY a pointer move, and after
// entry no pointer move has happened yet.
//
// Two phases, because there are two ways the pointer can fail to be over the
// course and they exercise different code:
//
//   A — no pointer input at all. Enter with `j`, screenshot, then change tools
//       with DOM clicks so the physical mouse never moves. This is "without
//       moving the mouse" literally.
//   B — the mouse ON THE RAIL. Move it onto each tool button and click it for
//       real. The pointer is now off the course, which is the case the rig
//       target anchor exists for.
//
// Every step records what the renderer will actually submit
// (scene.editorCursorState()), where that lands in NDC through the live camera,
// the program count, and a screenshot. A step whose indicator is absent, or
// present but off-screen or behind the camera, is a FAIL.
//
// NEGATIVE CONTROL: run this on the build before the fix. Every step must fail
// with `cursor absent`. A check born green proves only that it passes.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/editor-cursor-affordance.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/editor-cursor');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = {
    tag, errs: [], failures: [], steps: [],
  };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  await page.evaluate(() => {
    const S = { gaps: [], last: performance.now() };
    window.__ec = S;
    const tick = () => {
      const n = performance.now();
      if (n - S.last > 50) S.gaps.push({ t: +n.toFixed(0), ms: +(n - S.last).toFixed(1) });
      S.last = n;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /\bContinue\b/.test(c.querySelector('.menu-action-label')?.textContent || c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 90000 }).catch(() => {});
  }
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  out.ownerRes = (await boot.ownerResolution(page, page.electronApp)).caption;
  await page.waitForTimeout(1500);
  // ownerResolution reports DIP/physical sizes; mouse coordinates are CSS
  // pixels, so take them from the page itself.
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  // WHAT IS ON SCREEN TELLING THE PLAYER WHERE THE NEXT CLICK LANDS.
  //
  // Three independent overlays can be the indicator — the brush ring, the
  // shaped feature preview (outline + fill), the placement ghost — so read all
  // three and take the union. The projection matters as much as the flag: a
  // ring at a world point behind the camera is `visible` and invisible.
  const cursor = () => page.evaluate(() => {
    const sc = window.__fw?.scene3d;
    if (!sc?.editorCursorState) return { unavailable: true };
    const st = sc.editorCursorState();
    const cam = sc.camera;
    let ndc = null;
    const at = st.brush || st.ghost
      || (st.preview && Number.isFinite(st.preview.x) ? st.preview : null);
    // Projected by hand rather than through THREE.Vector3.project — the page
    // has no THREE binding on window, and the two matrices are plain arrays the
    // renderer already refreshed this frame.
    if (at && cam) {
      const mul = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
      ];
      const y = sc.heightAt ? sc.heightAt(at.x, at.z) : 0;
      const eye = mul(cam.matrixWorldInverse.elements, [at.x, y, at.z, 1]);
      const clip = mul(cam.projectionMatrix.elements, eye);
      if (clip[3]) {
        ndc = {
          x: +(clip[0] / clip[3]).toFixed(3),
          y: +(clip[1] / clip[3]).toFixed(3),
          z: +(clip[2] / clip[3]).toFixed(3),
        };
      }
    }
    return {
      ...st,
      ndc,
      tool: window.__fw?.editorUi?.()?.qa?.tool?.() ?? null,
      programs: (sc.renderer.info.programs || []).length,
    };
  });

  const worstGap = async (sinceMs) => page.evaluate(
    (t0) => Math.max(0, ...window.__ec.gaps.filter((g) => g.t >= t0).map((g) => g.ms)),
    sinceMs,
  );
  const now = () => page.evaluate(() => +performance.now().toFixed(0));

  const step = async (name, label) => {
    const t0 = await now();
    await page.waitForTimeout(700);
    const c = await cursor();
    const shot = `${tag}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    const present = !!(c.brush || c.preview || c.ghost);
    const onScreen = !c.ndc
      ? null
      : Math.abs(c.ndc.x) <= 1 && Math.abs(c.ndc.y) <= 1 && c.ndc.z > -1 && c.ndc.z < 1;
    const row = {
      name, label, present, onScreen, ndc: c.ndc, tool: c.tool,
      brush: c.brush, preview: c.preview, ghost: c.ghost, measure: c.measure,
      programs: c.programs, worstGapMs: await worstGap(t0), shot,
    };
    out.steps.push(row);
    if (c.unavailable) fail(`${name}: scene.editorCursorState() is missing — driver cannot see the cursor at all`);
    else if (!present) fail(`${name}: cursor absent — nothing shows where the next click lands`);
    else if (onScreen === false) fail(`${name}: cursor present but off-screen at ndc ${JSON.stringify(c.ndc)}`);
    console.log(`${name.padEnd(22)} present=${present} onScreen=${onScreen} programs=${c.programs} gap=${row.worstGapMs}ms`);
    return row;
  };

  // ---- PHASE A: not one pointer event ---------------------------------------
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
    && !!document.querySelector('.ced-rail'), null, { timeout: 90000 })
    .catch(() => fail('editor never opened'));
  await page.waitForTimeout(2000);
  await step('A00-open', 'editor open, mouse untouched');

  const tools = await page.evaluate(() => [...document.querySelectorAll('.ced-tool')]
    .map((b) => (b.textContent || '').trim()));
  out.tools = tools;
  for (let i = 0; i < tools.length; i++) {
    // DOM click: the tool changes, the physical pointer does not move, which is
    // the owner's "select each tool and screenshot after each without moving
    // the mouse" exactly.
    await page.evaluate((idx) => {
      [...document.querySelectorAll('.ced-tool')][idx]?.click();
    }, i);
    await step(`A${String(i + 1).padStart(2, '0')}-${tools[i].replace(/\W+/g, '').slice(0, 10) || `tool${i}`}`,
      `tool ${tools[i]} via DOM click, mouse untouched`);
  }

  // ---- PHASE B: the mouse parked on the rail, off the course -----------------
  const rects = await page.evaluate(() => [...document.querySelectorAll('.ced-tool')].map((b) => {
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }));
  for (let i = 0; i < rects.length; i++) {
    await page.mouse.move(rects[i].x, rects[i].y, { steps: 6 });
    await page.mouse.click(rects[i].x, rects[i].y);
    await step(`B${String(i + 1).padStart(2, '0')}-${tools[i].replace(/\W+/g, '').slice(0, 10) || `tool${i}`}`,
      `tool ${tools[i]} clicked with the real mouse, pointer on the rail`);
  }

  // ---- PHASE C: the pointer genuinely off the course ------------------------
  // Phase B does not actually test the anchor: the rail is drawn OVER the
  // course, so a ray through a rail pixel still lands on the ground behind the
  // panel. The sky above the horizon is the real miss, and so is a point past
  // the property line. Both must still leave something on screen.
  for (const [name, x, y] of [
    ['C1-sky', Math.round(vp.w * 0.5), 6],
    ['C2-skyleft', 12, 10],
  ]) {
    await page.mouse.move(x, y, { steps: 6 });
    await step(name, `pointer at ${x},${y} — off the course entirely`);
  }

  // ---- PHASE D: the rig-target anchor, exercised for real -------------------
  // Neither B nor C reaches the anchor. The editor camera looks down at a
  // course that fills the frame, so a ray through a rail pixel lands on the
  // ground BEHIND the panel and a ray through the top of the screen lands on
  // the ground at the horizon — both in bounds. The anchor only fires where
  // the ray misses. Find such a pixel by asking the scene rather than assuming
  // one exists, and orbit the camera down until one does if it does not.
  const findMiss = () => page.evaluate(() => {
    const sc = window.__fw?.scene3d;
    for (let y = 2; y < window.innerHeight * 0.75; y += 10) {
      for (const f of [0.35, 0.5, 0.65, 0.85]) {
        const x = Math.round(window.innerWidth * f);
        const g = sc.raycastGround(x, y);
        if (!g || !g.inBounds) return { x, y, reason: g ? 'outOfBounds' : 'noHit' };
      }
    }
    return null;
  });
  const orbit = async (dy) => {
    const mx = Math.round(vp.w * 0.6);
    const my = Math.round(vp.h * 0.5);
    await page.mouse.move(mx, my, { steps: 4 });
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(mx, Math.max(4, Math.min(vp.h - 4, my + i * dy)), { steps: 2 });
    }
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(700);
  };
  let miss = await findMiss();
  out.anchorProbe = { firstTry: miss, pitch: [] };
  // right-drag orbits; which SIGN lowers the pitch depends on rig.orbit's
  // convention, so try both rather than assume, and record the pitch each time
  // so a run that never reached the horizon says so with a number.
  for (const dy of [-22, 26]) {
    if (miss) break;
    await orbit(dy);
    out.anchorProbe.pitch.push(await page.evaluate(() => +window.__fw.scene3d.rig.pitch.toFixed(3)));
    miss = await findMiss();
  }
  out.anchorProbe.afterOrbit = miss;
  if (!miss) fail('phase D: no screen pixel misses the course — the anchor path is UNTESTED by this run');
  else {
    await page.mouse.move(miss.x, miss.y, { steps: 6 });
    const row = await step('D1-anchor', `pointer at ${miss.x},${miss.y} — ray ${miss.reason}`);
    const rig = await page.evaluate(() => {
      const t = window.__fw.scene3d.rig.target;
      return { x: +t.x.toFixed(2), z: +t.z.toFixed(2) };
    });
    out.anchorProbe.rigTarget = rig;
    out.anchorProbe.brush = row.brush;
    const at = row.brush || row.ghost || row.preview;
    const onTarget = at && Math.hypot(at.x - rig.x, at.z - rig.z) < 12;
    out.anchorProbe.onTarget = !!onTarget;
    if (row.present && !onTarget) {
      fail(`phase D: indicator present but not at the rig target (${JSON.stringify(at)} vs ${JSON.stringify(rig)})`);
    }
    console.log(`D1 anchor: rigTarget ${JSON.stringify(rig)} indicator ${JSON.stringify(at)} onTarget=${onTarget}`);
  }

  // ---- the placement ghost's own cost ---------------------------------------
  // The owner: "Either cache one material per object type and reuse it, or
  // accept the one frame and say so." Answer it with a number: switch the
  // objects tool through several types with the pointer over the course and
  // report what each type costs in programs and in the worst frame gap.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.ced-tool')].find((x) => /object/i.test(x.textContent || ''));
    b?.click();
  });
  await page.mouse.move(Math.round(vp.w * 0.55), Math.round(vp.h * 0.55), { steps: 8 });
  await page.waitForTimeout(900);
  const ghostTypes = await page.evaluate(() => [...document.querySelectorAll('.ced-tool-panel button')]
    .map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40));
  out.ghostTypeButtons = ghostTypes;
  out.ghostCosts = [];
  for (let i = 0; i < Math.min(6, ghostTypes.length); i++) {
    const t0 = await now();
    const before = (await cursor()).programs;
    await page.evaluate((idx) => {
      const btns = [...document.querySelectorAll('.ced-tool-panel button')].filter((b) => (b.textContent || '').trim());
      btns[idx]?.click();
    }, i);
    await page.mouse.move(
      Math.round(vp.w * 0.55) + (i % 2 ? 3 : -3), Math.round(vp.h * 0.55), { steps: 3 },
    );
    await page.waitForTimeout(900);
    const c = await cursor();
    out.ghostCosts.push({
      button: ghostTypes[i],
      ghostType: c.ghost?.type ?? null,
      programsBefore: before,
      programsAfter: c.programs,
      arrivals: c.programs - before,
      worstGapMs: await worstGap(t0),
    });
    console.log(`ghost ${ghostTypes[i].padEnd(16)} +${c.programs - before}p gap=${out.ghostCosts.at(-1).worstGapMs}ms type=${c.ghost?.type}`);
  }
  await page.screenshot({ path: path.join(OUT, `${tag}-ghost.png`) });

  // leave without billing the save
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.ced-top-btn')].find((x) => /exit/i.test(x.textContent || ''));
    b?.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /discard/i.test(x.textContent || ''));
    b?.click();
  });
  await page.waitForTimeout(2500);
  out.leftEditor = await page.evaluate(() => window.__fw?.courseMode !== 'editor');

  out.summary = {
    steps: out.steps.length,
    absent: out.steps.filter((s) => !s.present).map((s) => s.name),
    offScreen: out.steps.filter((s) => s.onScreen === false).map((s) => s.name),
  };
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(out, null, 2));
  console.log('\n== editor cursor affordance ==');
  console.log(`steps ${out.summary.steps} · absent ${out.summary.absent.length} · off-screen ${out.summary.offScreen.length}`);
  console.log(`failures ${out.failures.length}`);
  console.log(`evidence qa/editor-cursor/${tag}.json`);
}
