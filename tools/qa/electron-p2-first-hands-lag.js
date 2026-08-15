// P2 (Goal 25 round 2) — "SWITCHING FROM THE BOTTLE TO THE DUSTPAN FREEZES THE
// GAME FOR ABOUT 5 SECONDS THE FIRST TIME, then every tool after that is
// instant." Plus: "turning a page lags the first time only."
//
// His sequence is the experiment. The registry says why it might be:
//
//   spray (the bottle)  hands: false   -- drawn BARE, no hand meshes at all
//   dustpan             hands: true    -- draws the hands
//
// Last round I measured "the first tool equipped in a session pays ~332 ms,
// whichever it is". The bottle-then-dustpan report sharpens that into something
// testable: it is not the first EQUIP, it is the first time the HANDS are drawn.
// A bare tool would then be free and cost the next hands tool nothing, because
// it never compiled the programs the hands need.
//
// TWO ARMS, and the second is the control that makes the first mean anything:
//   A  spray -> dustpan   (his order) -- if hands are the cause, spray is cheap
//                                        and dustpan pays the whole bill
//   B  dustpan first      -- pays immediately, and the later spray is free
//
// Both arms need their own fresh process, because "first in a session" is the
// whole variable; run with --arm=a or --arm=b.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p2-first-hands-lag.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p2-first-hands');
  fs.mkdirSync(OUT, { recursive: true });
  const arm = (process.env.ARM || 'a').toLowerCase();
  const out = { arm, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  const canvas = await page.$('#game') || await page.$('canvas');
  const bbox = await canvas.boundingBox();
  await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  await page.waitForTimeout(700);

  // Frame times AND the renderer's own program count. The program delta is what
  // turns "this frame was long" into "this frame compiled N shaders", which is
  // the difference between a symptom and a cause.
  const startTrace = () => page.evaluate(() => {
    window.__h = [];
    window.__hStop = false;
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      window.__h.push({
        ms: +(now - t0).toFixed(1),
        dt: +(now - last).toFixed(1),
        programs: window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null,
      });
      last = now;
      if (!window.__hStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const readTrace = () => page.evaluate(() => {
    window.__hStop = true;
    return window.__h;
  });

  const equip = (key) => page.evaluate((k) => {
    const w = window.__fw.scene3d.walk;
    if (w.setTool) w.setTool(k);
    else if (w.hooks?.setTool) w.hooks.setTool(k);
  }, key);

  const gesture = async (label, key, settleMs = 6500) => {
    await startTrace();
    await page.waitForTimeout(250);
    const beforePrograms = await page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null);
    await equip(key);
    await page.waitForTimeout(settleMs);
    const trace = await readTrace();
    const afterPrograms = await page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null);
    const dts = trace.map((f) => f.dt);
    const row = {
      label,
      tool: key,
      frames: trace.length,
      maxMs: +Math.max(...dts).toFixed(1),
      framesOver100: dts.filter((d) => d > 100).length,
      framesOver500: dts.filter((d) => d > 500).length,
      programsBefore: beforePrograms,
      programsAfter: afterPrograms,
      programDelta: (afterPrograms ?? 0) - (beforePrograms ?? 0),
    };
    out[label] = row;
    console.log('P2-HANDS', JSON.stringify(row));
    return row;
  };

  if (arm === 'b') {
    await gesture('firstDustpan', 'dustpan');
    await gesture('thenSpray', 'spray');
    await gesture('thenBroom', 'broom');
  } else {
    await gesture('firstSpray', 'spray');
    await gesture('thenDustpan', 'dustpan');
    await gesture('thenBroom', 'broom');
  }

  out.summary = arm === 'b'
    ? {
      arm: 'B (control): a hands tool FIRST',
      dustpanFirstMaxMs: out.firstDustpan?.maxMs,
      dustpanFirstPrograms: out.firstDustpan?.programDelta,
      laterSprayMaxMs: out.thenSpray?.maxMs,
      laterBroomMaxMs: out.thenBroom?.maxMs,
    }
    : {
      arm: "A (his order): bottle then dustpan",
      sprayFirstMaxMs: out.firstSpray?.maxMs,
      sprayFirstPrograms: out.firstSpray?.programDelta,
      dustpanAfterSprayMaxMs: out.thenDustpan?.maxMs,
      dustpanAfterSprayPrograms: out.thenDustpan?.programDelta,
      laterBroomMaxMs: out.thenBroom?.maxMs,
      HANDS_HYPOTHESIS_HOLDS:
        (out.firstSpray?.maxMs ?? 1e9) < 100 && (out.thenDustpan?.maxMs ?? 0) > 100,
    };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, `arm-${arm}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P2-FIRST-HANDS', JSON.stringify(out.summary, null, 2));
  return out;
}
