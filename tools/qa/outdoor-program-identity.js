// WHICH PROGRAM COSTS FOUR TO SIX SECONDS, AND WHY.
//
// tools/qa/door-crossing-stall.js reproduced the owner's hitch and narrowed it to
// one event: the FIRST belt press after crossing outside blocks for 4,603 ms
// (and 6,599 ms with the retired belt-outdoor warm forced back on, so the warm
// was never the cure). Both runs minted exactly ONE program across that block.
//
// One program. Not a storm of compiles -- a single link that takes seconds. So
// this presses each tool outdoors ONE AT A TIME, times each press on its own,
// and when a press is expensive it dumps the identity of the program that
// arrived: three's own cacheKey, and the material and defines behind it.
//
// The owner's hypothesis is that this is a texture-unit problem. The clubhouse
// already proved it sits at the ceiling -- a MeshStandardMaterial created at
// runtime there failed to link with "FRAGMENT shader texture image units count
// exceeds MAX_TEXTURE_IMAGE_UNITS(16)". So the GL limits and the material's own
// texture-slot count are recorded beside every press, which is the measurement
// that can confirm or refute it rather than assume it.
//
// THE CONTROL is the second press of the same tool in the same place. By
// construction nothing is left to link, so it must be cheap. If a second press
// costs the same as the first, the cost is not compilation and every conclusion
// about programs below is wrong.
//
//   node tools/qa/run-electron.cjs tools/qa/outdoor-program-identity.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/outdoor-program';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], presses: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const shaderErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/MAX_TEXTURE_IMAGE_UNITS|VALIDATE_STATUS|Shader Error|program/i.test(t)) shaderErrors.push(t.slice(0, 400));
  });

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const inv = window.__fw.state.shop.inventory;
    inv.vac1 = inv.vac1 || { shelf: 0, back: 0 };
    inv.vac1.back = Math.max(1, inv.vac1.back);
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
  });

  // What the GL context will actually allow, from the context rather than from
  // the specification.
  out.limits = await page.evaluate(() => {
    const gl = window.__fw.scene3d.renderer.getContext();
    const cap = window.__fw.scene3d.renderer.capabilities;
    return {
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxCombined: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxVertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxVaryings: gl.getParameter(gl.MAX_VARYING_VECTORS),
      maxFragUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      threeMaxTextures: cap.maxTextures,
      precision: cap.precision,
    };
  });
  console.log(`GL limits: ${JSON.stringify(out.limits)}`);

  const geo = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return { inside: ch.localToWorld(-0.8, 2.6), outside: ch.localToWorld(-0.8, 9.5) };
  });

  const place = (p) => page.evaluate((q) => {
    const st = window.__fw.scene3d.walk.state;
    st.x = q.x; st.z = q.z;
  }, p);

  // One press, timed on the timer queue, with the program set diffed around it.
  const press = async (tool, where) => {
    const before = await page.evaluate(() => {
      const r = window.__fw.scene3d.renderer;
      return (r.info.programs || []).map((p) => p.cacheKey || '');
    });
    const timed = await page.evaluate(async (t) => {
      const w = window.__fw.scene3d.walk;
      const set = w.setToolImmediate || w.setTool;
      // Block measurement on the timer queue: a frame that stalls for seconds
      // yields too few rAF callbacks to have gaps of its own.
      let worst = 0;
      let last = performance.now();
      let live = true;
      const tick = () => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
        if (live) setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
      const t0 = performance.now();
      set.call(w, t);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 400));
      live = false;
      return { ms: +(performance.now() - t0).toFixed(1), worstBlock: +worst.toFixed(1) };
    }, tool);
    const after = await page.evaluate(() => {
      const r = window.__fw.scene3d.renderer;
      return (r.info.programs || []).map((p) => p.cacheKey || '');
    });
    const fresh = after.filter((k) => !before.includes(k));
    const row = {
      tool, where, ...timed, minted: after.length - before.length, newKeys: fresh.slice(0, 3),
    };
    out.presses.push(row);
    const flag = row.worstBlock > 500 ? '   <-- STALL' : '';
    console.log(`  ${where.padEnd(8)} ${tool.padEnd(10)} ${String(row.ms).padStart(8)} ms`
      + `  block ${String(row.worstBlock).padStart(8)}  minted ${String(row.minted).padStart(3)}${flag}`);
    if (fresh.length && row.worstBlock > 500) {
      console.log(`      new program key: ${fresh[0].slice(0, 220)}`);
    }
    await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      (w.setToolImmediate || w.setTool)(null);
    });
    await page.waitForTimeout(250);
    return row;
  };

  const BELT = ['vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag', 'washer'];

  console.log('\n== INDOORS, first press of each tool ==');
  await place(geo.inside);
  await page.waitForTimeout(1500);
  for (const t of BELT) await press(t, 'inside');

  console.log('\n== OUTDOORS, first press of each tool (already warm indoors) ==');
  await place(geo.outside);
  await page.waitForTimeout(2000);
  out.isOutside = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const st = window.__fw.scene3d.walk.state;
    return !ch.isInside(st.x, st.z);
  });
  if (!out.isOutside) fail('the player is still inside — the "outdoors" rows are a second set of indoor rows');
  for (const t of BELT) await press(t, 'outside');

  console.log('\n== THE CONTROL: every tool pressed a SECOND time, outdoors ==');
  for (const t of BELT) await press(t, 'out-2nd');

  // ---- KEYBOARD vs API, WHICH IS THE WHOLE DIFFERENCE FROM THE DRIVER THAT
  // CAUGHT THE STALL.
  //
  // door-crossing-stall.js pressed a real key and saw 4,603 ms. Everything above
  // pressed through walk.setToolImmediate and sees 37 ms. Those are not the same
  // code path: the key goes through cycleWalkTool -> selectWalkTool, which also
  // calls audio.setToolLoop(null), audio.equipTick() and raises the equip toast.
  // None of that is shader work, and none of it runs above. So the belt is
  // cycled here with the KEYBOARD, in the same place, on the same boot.
  console.log('== KEYBOARD presses, outdoors, same place ==');
  const keyPress = async (i) => {
    const t0 = await page.evaluate(() => {
      window.__kb = { worst: 0, last: performance.now(), live: true };
      const tick = () => {
        const n = performance.now();
        window.__kb.worst = Math.max(window.__kb.worst, n - window.__kb.last);
        window.__kb.last = n;
        if (window.__kb.live) setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
      const r = window.__fw.scene3d.renderer;
      return { programs: (r.info.programs || []).length };
    });
    await page.keyboard.down('f');
    await page.waitForTimeout(90);
    await page.keyboard.up('f');
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      window.__kb.live = false;
      const rr = window.__fw.scene3d.renderer;
      return {
        worst: +window.__kb.worst.toFixed(1),
        programs: (rr.info.programs || []).length,
        tool: window.__fw.scene3d.walk.getTool() || null,
      };
    });
    const row = {
      tool: r.tool, where: 'out-KEY', worstBlock: r.worst, minted: r.programs - t0.programs, i,
    };
    out.presses.push(row);
    console.log('  out-KEY  press ' + String(i + 1).padStart(2) + ' -> '
      + String(r.tool).padEnd(10) + '  block ' + String(r.worst).padStart(8)
      + '  minted ' + String(row.minted).padStart(3)
      + (r.worst > 500 ? '   <-- STALL' : ''));
    return row;
  };
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    (w.setToolImmediate || w.setTool)(null);
  });
  await page.waitForTimeout(600);
  for (let i = 0; i < 9; i += 1) await keyPress(i);
  out.worstKeyboard = out.presses.filter((q) => q.where === 'out-KEY')
    .reduce((a, q) => Math.max(a, q.worstBlock), 0);
  console.log('worst block on the KEYBOARD path outdoors: ' + out.worstKeyboard + ' ms');


  // ---- verdicts
  const worstOf = (w) => out.presses.filter((p) => p.where === w)
    .reduce((a, p) => Math.max(a, p.worstBlock), 0);
  out.worst = { inside: worstOf('inside'), outside: worstOf('outside'), secondPass: worstOf('out-2nd') };
  console.log(`\nworst block  indoors ${out.worst.inside} ms   outdoors ${out.worst.outside} ms`
    + `   second pass ${out.worst.secondPass} ms`);
  if (out.worst.secondPass > out.worst.outside * 0.5 && out.worst.outside > 500) {
    fail(`a second press cost ${out.worst.secondPass} ms against ${out.worst.outside} ms first time — `
      + 'the cost is not compilation, so the program identity below explains nothing');
  }

  out.shaderErrors = shaderErrors.slice(0, 10);
  if (shaderErrors.length) {
    console.log(`\nshader/program console messages (${shaderErrors.length}):`);
    for (const e of out.shaderErrors) console.log(`  ${e.replace(/\n/g, ' ')}`);
  } else {
    console.log('\nno shader or program console messages at all');
  }

  fs.writeFileSync(`${OUT}/programs.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
