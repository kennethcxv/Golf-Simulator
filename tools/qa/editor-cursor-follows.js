// DOES THE BRUSH RING FOLLOW THE MOUSE?
//
// "I see the thing for cursor when editing the terrain or paint however it
// doesn't move according to the user's cursor it just stays there."
//
// The goal-36 driver and the brush-ring driver both PASSED this build. Neither
// asked the only question that matters here: they parked the pointer in one
// place and checked the ring was present and unoccluded. A ring nailed to the
// middle of the course satisfies both of them at every step.
//
// So this one moves the real mouse to a list of points over the course and
// demands the ring's centre be UNDER THE POINTER — projected back to screen
// pixels and compared against where the mouse actually is. A static ring fails
// at the first point that is not where it is stuck.
//
// It also reports, at each point, exactly what the editor's own pointer
// pipeline decided: the raycast record, whether the hit was in bounds, and what
// document.elementFromPoint says is on top. That names the mechanism instead of
// leaving "it doesn't move" as a symptom.
//
//   node tools/qa/run-electron.cjs \
//     tools/qa/editor-cursor-follows.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/editor-follow');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [], tools: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  const boot = await import(`file:///${bootPath}`);
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1200);

  // Where the ring's centre lands ON SCREEN, plus everything the editor used to
  // decide it. Projection is done by hand through the live camera because THREE
  // is not on window.
  const probe = () => page.evaluate(() => {
    const sc = window.__fw?.scene3d;
    if (!sc?.editorCursorState) return { unavailable: true };
    const st = sc.editorCursorState();
    const cam = sc.camera;
    const canvas = sc.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const mul = (m, v) => [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    const toPx = (x, z) => {
      const y = sc.heightAt ? sc.heightAt(x, z) : 0;
      const eye = mul(cam.matrixWorldInverse.elements, [x, y, z, 1]);
      const clip = mul(cam.projectionMatrix.elements, eye);
      if (!clip[3] || clip[3] <= 0) return null;
      return {
        px: rect.left + ((clip[0] / clip[3] + 1) / 2) * rect.width,
        py: rect.top + ((1 - clip[1] / clip[3]) / 2) * rect.height,
      };
    };
    const brush = st.brush || null;
    const ghost = st.ghost || null;
    const anchor = brush || ghost;
    // THE DRAWN TRANSFORM, NOT THE REQUESTED ONE. Projecting `position` back to
    // screen and comparing it against the mouse is circular — that number came
    // FROM the mouse ray. matrixWorld is what the renderer multiplies by, and
    // when the stability freeze has taken the ring the two disagree for ever.
    const d = anchor?.drawn || null;
    const centre = d ? toPx(d.x, d.z) : null;
    const asked = anchor ? toPx(anchor.x, anchor.z) : null;
    return {
      brush,
      ghost,
      live: d ? d.live : null,
      frozenBy: d ? d.frozenBy : null,
      centrePx: centre ? { x: Math.round(centre.px), y: Math.round(centre.py) } : null,
      askedPx: asked ? { x: Math.round(asked.px), y: Math.round(asked.py) } : null,
    };
  });

  // What the editor's OWN pipeline says about a screen point — the same three
  // questions updateHoverVisuals asks before it decides where to put the ring.
  const pipelineAt = (x, y) => page.evaluate(([px, py]) => {
    const sc = window.__fw?.scene3d;
    const canvas = sc?.renderer?.domElement;
    const g = sc?.raycastGround ? sc.raycastGround(px, py) : null;
    const el = document.elementFromPoint(px, py);
    let blocker = null;
    if (el && !(el === canvas || canvas.contains(el))) {
      blocker = el.tagName.toLowerCase();
      for (let p = el; p; p = p.parentElement) {
        if (typeof p.className === 'string' && /ced-/.test(p.className)) {
          blocker = p.className.split(/\s+/).find((c) => /^ced-/.test(c)) || blocker;
          break;
        }
      }
    }
    return {
      hit: !!g,
      inBounds: g ? !!g.inBounds : null,
      world: g ? { x: +g.point.x.toFixed(2), z: +g.point.z.toFixed(2) } : null,
      topEl: el ? (el === canvas || canvas.contains(el) ? 'canvas' : (blocker || 'other')) : 'none',
    };
  }, [Math.round(x), Math.round(y)]);

  // ---- STAGE THE STATE HIS SESSION IS ALWAYS IN -----------------------------
  //
  // The stability freeze arms at frame 900 of active walk — about fifteen
  // seconds on foot — and takes every bit-stable transform in the scene. A
  // driver that boots and opens the editor immediately never reaches it, which
  // is why two earlier probes measured a perfectly tracking cursor on a build
  // where his was nailed to one spot. The player has ALWAYS been walking around
  // for more than fifteen seconds before they press J.
  //
  // Waited for explicitly and failed on loudly: a run that never freezes is a
  // run that is not measuring the reported defect at all.
  out.freezeBefore = await page.waitForFunction(
    () => (window.__fw?.scene3d?.matrixFreezeDiagnostics?.()?.stabilityFrozen || 0) > 0
      && window.__fw.scene3d.matrixFreezeDiagnostics(),
    null, { timeout: 120000, polling: 500 },
  ).then((h) => h.jsonValue()).catch(() => null);
  if (!out.freezeBefore) {
    fail('the stability freeze never armed — this run is NOT in the state the defect needs');
  } else {
    console.log(`stability freeze armed: ${out.freezeBefore.stabilityFrozen} objects `
      + `frozen, ${out.freezeBefore.watchdogEnrolled} enrolled`);
  }

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
    && !!document.querySelector('.ced-rail'), null, { timeout: 90000 })
    .catch(() => fail('editor never opened'));
  await page.waitForTimeout(2200);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  // Five points spread across the open canvas, clear of the left rail (which
  // ends around 20% across) and the top bar. Deliberately NOT symmetric, so a
  // ring that follows only one axis fails too.
  const POINTS = [
    ['far-left', 0.30, 0.42],
    ['centre', 0.55, 0.52],
    ['right', 0.82, 0.40],
    ['low-right', 0.75, 0.78],
    ['high-mid', 0.48, 0.28],
  ].map(([name, fx, fy]) => ({ name, x: Math.round(vp.w * fx), y: Math.round(vp.h * fy) }));
  out.viewport = vp;

  // A ring the mouse is driving lands where the mouse is. The tolerance is
  // generous — the ring sits on the terrain surface and the pointer ray hits
  // that same surface, so the two agree to within a few pixels of projection
  // slop on a slope. 24 px at this resolution is a quarter of a rail button.
  const TOL_PX = 24;

  const runTool = async (label, re) => {
    await page.evaluate((src) => {
      const rx = new RegExp(src, 'i');
      [...document.querySelectorAll('.ced-tool')].find((b) => rx.test(b.textContent || ''))?.click();
    }, re.source);
    await page.waitForTimeout(900);
    const rows = [];
    for (const p of POINTS) {
      await page.mouse.move(p.x, p.y, { steps: 12 });
      await page.waitForTimeout(320);
      const [r, pipe] = [await probe(), await pipelineAt(p.x, p.y)];
      const shot = `${tag}-${label}-${p.name}.png`;
      await page.screenshot({ path: path.join(OUT, shot) });
      const dx = r.centrePx ? r.centrePx.x - p.x : null;
      const dy = r.centrePx ? r.centrePx.y - p.y : null;
      const err = dx === null ? null : +Math.hypot(dx, dy).toFixed(1);
      rows.push({
        point: p.name, mouse: p, shot, centrePx: r.centrePx, askedPx: r.askedPx,
        offsetPx: err, live: r.live, frozenBy: r.frozenBy, brush: r.brush, pipeline: pipe,
      });
      console.log(`  ${label.padEnd(8)} ${p.name.padEnd(10)} mouse=(${p.x},${p.y}) `
        + `drawn=${r.centrePx ? `(${r.centrePx.x},${r.centrePx.y})` : 'ABSENT'} `
        + `off=${err ?? '-'}px  live=${r.live} hit=${pipe.hit} inB=${pipe.inBounds} top=${pipe.topEl}`);
    }
    // THE TWO FAILURES THAT MATTER, NAMED SEPARATELY.
    // A ring that never moves is a different defect from a ring that moves but
    // lands in the wrong place, and the fix is different too.
    const centres = rows.filter((r) => r.centrePx).map((r) => `${r.centrePx.x},${r.centrePx.y}`);
    const distinct = new Set(centres).size;
    if (rows.some((r) => !r.centrePx)) {
      fail(`${label}: ring absent at ${rows.filter((r) => !r.centrePx).map((r) => r.point).join(',')}`);
    }
    if (centres.length > 1 && distinct === 1) {
      fail(`${label}: THE RING NEVER MOVED — same pixel (${centres[0]}) at all `
        + `${centres.length} pointer positions`);
    }
    const off = rows.filter((r) => r.offsetPx !== null && r.offsetPx > TOL_PX);
    if (off.length) {
      fail(`${label}: ring is not under the pointer at ${
        off.map((r) => `${r.point}(${r.offsetPx}px)`).join(', ')}`);
    }
    const dead = rows.filter((r) => r.live === false);
    if (dead.length) {
      fail(`${label}: the ring's matrix is FROZEN (${dead[0].frozenBy}) — every write to `
        + 'position is discarded before it reaches the renderer');
    }
    out.tools.push({ tool: label, distinctCentres: distinct, rows });
  };
  await runTool('terrain', /terrain/);
  await runTool('paint', /paint/);

  // ---- THE STATE THE FRESH SWEEP CANNOT REACH -------------------------------
  //
  // Above, every pointer position happened to land on the course, so the live
  // path was taken every time and the ring tracked perfectly. That is not the
  // only camera the editor has. Pull back and the course stops filling the
  // view; now a pointer over sky, over the surrounding land, or past the course
  // edge produces no in-bounds hit — and the cursor falls back to the RIG
  // TARGET, which is one fixed point. Every such position draws the ring in the
  // same place, which is exactly "it just stays there".
  //
  // Reproduced deliberately rather than hoped for: the camera is pulled out to
  // a distance where most of the screen is off-course, then the same sweep runs.
  await page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    [...document.querySelectorAll('.ced-tool')].find((b) => rx.test(b.textContent || ''))?.click();
  }, /terrain/.source);
  await page.waitForTimeout(600);
  out.zoomOut = await page.evaluate(() => {
    const sc = window.__fw?.scene3d;
    if (!sc?.rig) return null;
    const before = sc.rig.dist;
    sc.rig.dist = Math.max(before * 4, 900);
    sc.rig.pitch = Math.min(sc.rig.pitch ?? 0.6, 0.34); // look out at the horizon
    sc.rig.apply();
    return { before, after: sc.rig.dist };
  });
  await page.waitForTimeout(900);
  await runTool('terrain-pulled-back', /terrain/);

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\n== does the ring follow the mouse ==');
  for (const t of out.tools) {
    console.log(`${t.tool}: ${t.distinctCentres} distinct ring positions over ${POINTS.length} pointer positions`);
  }
  console.log(`failures ${out.failures.length} · evidence qa/editor-follow/${tag}.json`);
}
