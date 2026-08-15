// GOAL 27, PHASE 2 — EVERY FIRST PRESS IN ONE TABLE.
//
// The acceptance is the brief's: "after warm-up, no first press of anything in
// the game produces a frame over 33 ms." This measures it the way the brief
// demands — program counts and rAF frame gaps, never longtask — by pressing
// every reachable surface TWICE and reporting first-vs-second for each:
// the second press is the per-surface control (a surface whose second press
// also stalls is not a first-use problem and gets said so).
//
// NO SILENT SKIPS: a surface whose trigger cannot be found reports
// 'unavailable' with the reason. Silent truncation reads as coverage.
//
// LIVE CONTROLS, every run:
//   1. planted-stall: a deliberate 100 ms busy-block inside its own tagged
//      window must register as that window's max gap, or the sampler is void.
//   2. fresh-program: drawing a never-seen ShaderMaterial must move
//      renderer.info.programs by >= 1, or the program counter is void.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-first-press-census.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/first-press-census');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], surfaces: {} };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // warm-up is part of the acceptance's own wording — wait for the deferred
  // warm to declare itself, then let the world settle
  out.warmState = await page.waitForFunction(() => (
    window.__fwWarm && window.__fwWarm.sweep !== 'pending' ? window.__fwWarm : false
  ), null, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => 'never-declared');
  await page.waitForTimeout(5000);

  // ---- the tagged-window rAF sampler -----------------------------------------
  await page.evaluate(() => {
    const S = { window: null, results: {} };
    window.__census = S;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (S.window) {
        const w = S.results[S.window];
        w.frames += 1;
        if (gap > w.maxGap) w.maxGap = gap;
        if (gap > 33) w.over33 += 1;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    S.begin = (name) => {
      S.results[name] = { frames: 0, maxGap: 0, over33: 0 };
      last = performance.now();
      S.window = name;
    };
    S.end = () => { S.window = null; };
    S.info = () => {
      const r = window.__fw?.scene3d?.renderer?.info;
      return r ? {
        programs: r.programs?.length ?? -1,
        geometries: r.memory?.geometries ?? -1,
        textures: r.memory?.textures ?? -1,
      } : { programs: -1, geometries: -1, textures: -1 };
    };
    // info.programs.length is a NET count — a material swap releases one
    // program and acquires one, reading as +0 (electron-stall-attribution.js
    // learned this the hard way). Arrivals are counted as NEW cacheKeys.
    S.programKeys = () => {
      const r = window.__fw?.scene3d?.renderer?.info;
      return (r?.programs || []).map((p) => String(p.cacheKey));
    };
  });

  // ---- CONTROL 1: planted stall ---------------------------------------------
  out.control_stall = await page.evaluate(() => new Promise((resolve) => {
    const S = window.__census;
    S.begin('control-stall');
    requestAnimationFrame(() => {
      const t0 = performance.now();
      while (performance.now() - t0 < 100) { /* deliberate */ }
      requestAnimationFrame(() => {
        S.end();
        const r = S.results['control-stall'];
        resolve(r.maxGap >= 95 ? `caught (${r.maxGap.toFixed(1)} ms)` : `MISSED (${r.maxGap.toFixed(1)} ms) — SAMPLER VOID`);
      });
    });
  }));

  // ---- CONTROL 2: fresh programs must arrive as NEW cacheKeys ---------------
  // Three fresh meshes with unique #defines, drawn for one frame, culling off.
  // The pattern (and both of its predecessor's failure modes — net counting,
  // graph-visible-but-not-submitted hosts) comes from electron-stall-attribution.js.
  out.control_program = await page.evaluate(() => new Promise(async (resolve) => {
    const sc = window.__fw?.scene3d;
    if (!sc?.scene) { resolve('UNAVAILABLE — no scene'); return; }
    let THREE;
    try { THREE = await import(new URL('vendor/three.module.js', document.baseURI).href); }
    catch (e) { resolve(`UNAVAILABLE — three import: ${String(e?.message || e)}`); return; }
    const beforeKeys = new Set(window.__census.programKeys());
    const holder = new THREE.Group();
    holder.name = 'QA_CensusForcedCompile';
    for (let i = 0; i < 3; i += 1) {
      const m = new THREE.MeshStandardMaterial({ color: 0x8899aa });
      m.defines = { FW_QA_CENSUS_FORCE: i };
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), m);
      box.frustumCulled = false;
      holder.add(box);
    }
    // in front of the eye, tiny — the proven pattern draws where the camera
    // looks rather than trusting culling-off alone
    const cam = sc.camera;
    if (cam) {
      cam.updateMatrixWorld(true);
      holder.position.set(0, 0, -1.2).applyMatrix4(cam.matrixWorld);
    }
    sc.scene.add(holder);
    let frames = 0;
    const hold = () => {
      frames += 1;
      if (frames < 6) { requestAnimationFrame(hold); return; }
      sc.scene.remove(holder);
      holder.traverse((o) => { o.material?.dispose?.(); o.geometry?.dispose?.(); });
      const arrivals = window.__census.programKeys().filter((k) => !beforeKeys.has(k)).length;
      resolve(arrivals >= 3 ? `caught (+${arrivals} arrivals)` : `MISSED (+${arrivals}) — PROGRAM COUNTER VOID`);
    };
    requestAnimationFrame(hold);
  }));

  // ---- the surface list, resolved in-page with reasons ----------------------
  // Each: begin window -> act -> hold 1.4 s -> end -> undo -> settle 1.2 s.
  // act -> hold 1.4 s -> VERIFY the surface actually opened -> undo -> settle.
  // A dispatched key that never reached its handler must read as UNAVAILABLE,
  // not as a clean 17 ms window — the 13-clean-rows version of this driver had
  // exactly that hole.
  const pressOnce = async (name, pressIdx, actSrc, verifySrc, undoSrc, holdMs = 1400) => {
    const win = `${name}#${pressIdx}`;
    // The previous surface's undo can still be settling (an Escape-closed book
    // lowers over several frames, and enterFrontDesk silently refuses while
    // app.ledgerOpen is true) — wait for a clean idle state or say so.
    const idle = await page.waitForFunction(() => {
      const fw = window.__fw;
      return fw?.scene3d?.walk?.isActive?.() === true
        && fw.ledgerOpen !== true && fw.frontDeskOpen !== true && fw.laptopOpen !== true
        && fw.courseMode !== 'overview'
        && !(fw.scene3d?.clubhouse?.()?.register?.isActive?.() === true);
    }, null, { timeout: 8000 }).then(() => true).catch(() => false);
    const preState = idle ? true : await page.evaluate(() => ({
      walk: window.__fw?.scene3d?.walk?.isActive?.(),
      ledger: window.__fw?.ledgerOpen,
      desk: window.__fw?.frontDeskOpen,
      laptop: window.__fw?.laptopOpen,
      mode: window.__fw?.courseMode,
    }));
    const before = await page.evaluate(() => window.__census.info());
    const beforeKeys = await page.evaluate(() => window.__census.programKeys());
    // Acts and undos are either real keyboard input ('KEY:Tab' — trusted,
    // full production path; a window-dispatched synthetic event only reaches
    // window-level listeners and silently missed the Escape handlers) or a
    // page function source.
    let actResult;
    if (typeof actSrc === 'string' && actSrc.startsWith('KEY:')) {
      await page.evaluate((w) => window.__census.begin(w), win);
      await page.keyboard.press(actSrc.slice(4));
      actResult = true;
    } else {
      actResult = await page.evaluate(`(async () => {
        window.__census.begin(${JSON.stringify(win)});
        try { return await (${actSrc})(window.__fw) ?? true; }
        catch (e) { return 'act-threw: ' + String(e?.message || e); }
      })()`);
    }
    await page.waitForTimeout(holdMs);
    const opened = await page.evaluate(`(() => {
      try { return (${verifySrc})(window.__fw); }
      catch (e) { return 'verify-threw: ' + String(e?.message || e); }
    })()`);
    const gaps = await page.evaluate((w) => {
      window.__census.end();
      return window.__census.results[w];
    }, win);
    const after = await page.evaluate(() => window.__census.info());
    const programArrivals = await page.evaluate((keys) => {
      const beforeSet = new Set(keys);
      return window.__census.programKeys().filter((k) => !beforeSet.has(k)).length;
    }, beforeKeys);
    if (typeof undoSrc === 'string' && undoSrc.startsWith('KEY:')) {
      await page.keyboard.press(undoSrc.slice(4));
    } else if (undoSrc) {
      await page.evaluate(`(async () => { try { await (${undoSrc})(window.__fw); } catch {} })()`);
    }
    await page.waitForTimeout(1200);
    return {
      ok: actResult === true && opened === true && idle,
      preStateClean: preState,
      actResult,
      opened,
      maxGapMs: +gaps.maxGap.toFixed(1),
      framesOver33: gaps.over33,
      frames: gaps.frames,
      programDelta: programArrivals,
      geometryDelta: after.geometries - before.geometries,
      textureDelta: after.textures - before.textures,
    };
  };

  const SURFACES = [
    ['tab-overview',
      'KEY:Tab',
      '(fw) => fw.courseMode === "overview" || "courseMode still " + String(fw.courseMode)',
      'KEY:Tab'],
    ['ledger-book',
      '(fw) => { const h = fw.scene3d?.walk?.hooks?.openLedger; if (typeof h !== "function") return "no openLedger hook"; h(); return true; }',
      '(fw) => fw.ledgerOpen === true || fw.scene3d?.clubhouse?.()?.ledgerBook?.isOpen?.() === true || "ledgerOpen " + String(fw.ledgerOpen)',
      'KEY:k'],
    ['book-page-turn',
      // The BOOK, not the ledger screen: hooks.openLedger raises the DOM
      // ledger while the 3D book stays shut, and turnPage refuses while
      // bookState is not open — three instrument versions measured nothing
      // because of that split. This drives the E key's own path (advance()
      // per frame until isOpen, then turnPage) and Q puts the book away.
      // EDGE-TRIGGERED advance, never per-frame: spamming advance() mid-rise
      // stacked repeated spread paints and produced three 1,005 ms frames —
      // the instrument manufacturing the stall it was measuring. And on a
      // FRESH world the ledger holds one spread, so turnPage(1) refuses
      // legitimately: this surface needs a world with transactions before a
      // first-press turn can exist at all. The stall itself is already
      // floor-measured in ledgerBook.js (one ~55 ms canvas-sync frame per
      // turn, size-independent); this row confirms it only on saves with a
      // second spread and says why otherwise.
      '(fw) => { const lb = fw.scene3d?.clubhouse?.()?.ledgerBook; if (!lb?.advance || !lb?.turnPage) return "no book api"; window.__pageTurnResult = undefined; const t0 = performance.now(); let advanced = 0; let wasOpen = lb.isOpen(); const drive = () => { try { if (!lb.isOpen()) { if (advanced < 4 && performance.now() - t0 > advanced * 700) { lb.advance(); advanced += 1; } } else { const r = lb.turnPage(1); if (r === true) { window.__pageTurnResult = true; window.__pageTurnAtMs = Math.round(performance.now() - t0); return; } if (wasOpen || performance.now() - t0 > 4500) { window.__pageTurnResult = "book open but turn refused — likely a single-spread fresh ledger; needs a save with transactions"; return; } } wasOpen = lb.isOpen(); } catch (e) { window.__pageTurnResult = "threw: " + String(e?.message || e); return; } if (performance.now() - t0 > 6000) { window.__pageTurnResult = "not open after 6 s"; return; } requestAnimationFrame(drive); }; requestAnimationFrame(drive); return true; }',
      '(fw) => window.__pageTurnResult === true || "turnPage " + String(window.__pageTurnResult)',
      'KEY:q',
      3400],
    ['front-desk',
      '(fw) => { const h = fw.scene3d?.walk?.hooks?.openFrontDesk; if (typeof h !== "function") return "no openFrontDesk hook"; h(null); return true; }',
      '(fw) => fw.frontDeskOpen === true || document.body.classList.contains("front-desk-mode") || "frontDeskOpen still " + String(fw.frontDeskOpen)',
      'KEY:Escape'],
    ['register-till',
      '(fw) => { const reg = fw.scene3d?.clubhouse?.()?.register; if (typeof reg?.enter !== "function") return "no register.enter"; reg.enter(); return true; }',
      '(fw) => { const reg = fw.scene3d?.clubhouse?.()?.register; return reg?.isActive?.() === true || "register not active"; }',
      '(fw) => { const reg = fw.scene3d?.clubhouse?.()?.register; if (typeof reg?.leave === "function") reg.leave(); }'],
    ['pause-menu',
      'KEY:Escape',
      '(fw) => { const el = document.querySelector(".pause-veil-ui"); return (el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden") || "no visible .pause-veil-ui"; }',
      'KEY:Escape'],
  ];
  for (const toolName of ['washer', 'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag']) {
    SURFACES.push([`tool-${toolName}`,
      `(fw) => { const w = fw.scene3d?.walk; const eq = w?.setToolImmediate || w?.setTool; if (!eq) return "no tool setter"; eq.call(w, ${JSON.stringify(toolName)}); return true; }`,
      `(fw) => fw.scene3d?.walk?.getTool?.() === ${JSON.stringify(toolName)} || "held: " + String(fw.scene3d?.walk?.getTool?.())`,
      '(fw) => { const w = fw.scene3d?.walk; const eq = w?.setToolImmediate || w?.setTool; if (eq) eq.call(w, null); }']);
  }
  // LAST, deliberately: the editor has no same-key close — its exit runs
  // through the pause shell — so its aftermath must have nothing after it to
  // poison. Undo is best-effort Escapes; the idle-wait on the (nonexistent)
  // next surface would catch any residue anyway.
  SURFACES.push(['course-editor',
    'KEY:j',
    '(fw) => fw.courseMode === "editor" || (document.querySelector(".course-editor-root, .editor-root, [data-editor-root]") && "dom-only") === "dom-only" || "courseMode " + String(fw.courseMode)',
    '(fw) => { /* two escapes: shell open, then resume-out is owner-specific; best effort */ }']);

  for (const [name, actSrc, verifySrc, undoSrc, holdMs] of SURFACES) {
    const first = await pressOnce(name, 1, actSrc, verifySrc, undoSrc, holdMs);
    const second = await pressOnce(name, 2, actSrc, verifySrc, undoSrc, holdMs);
    out.surfaces[name] = { first, second };
    const verdictBit = first.ok
      ? (first.maxGapMs > 33 ? (second.maxGapMs > 33 ? 'BOTH-SLOW (not first-use)' : 'FIRST-PRESS STALL') : 'clean')
      : `UNAVAILABLE: ${first.preStateClean !== true ? `dirty pre-state ${JSON.stringify(first.preStateClean)}`
        : (first.actResult === true ? first.opened : first.actResult)}`;
    console.log(`${name.padEnd(16)} 1st ${String(first.maxGapMs).padStart(7)} ms (${String(first.programDelta).padStart(3)}p ${String(first.geometryDelta).padStart(4)}g ${String(first.textureDelta).padStart(3)}t)   2nd ${String(second.maxGapMs).padStart(7)} ms (${String(second.programDelta).padStart(3)}p)   ${verdictBit}`);
  }

  console.log(`\nCONTROL stall: ${out.control_stall}`);
  console.log(`CONTROL program: ${out.control_program}`);
  console.log(`warm state at start: ${JSON.stringify(out.warmState)}`);
  console.log(`page errors: ${out.errs.length}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
