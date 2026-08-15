// PLAYTEST 5, P0 — THE COURSE EDITOR IS UNUSABLE.
//
// "Opening the course editor, I cannot click anything. It is enormously laggy —
// a click takes about twenty seconds to register. Then I pressed Tab and the
// screen tore in half: the top portion showing the course editor, the bottom
// half solid black."
//
// This driver REPRODUCES rather than asserts. It records rAF intervals in the
// walk view (baseline), enters the editor with the player's own key (J), records
// rAF intervals there, moves the pointer across the canvas the way a hand does,
// then dispatches ONE real click and measures wall time from mousedown to the
// first frame that carries the app's response.
//
// The instrument is the rAF interval stream, sampled AT rAF -- matching the rate
// of the thing measured (golf-qa law: match the sample rate). Long tasks are read
// from PerformanceObserver('longtask') so a 20 s stall shows as one entry with an
// attributable start, not as a smear across an average.
//
// NEGATIVE CONTROL: the same interval recorder is run across a deliberately
// blocked main thread (a synchronous 400 ms busy loop scheduled between frames).
// It must report a >=400 ms interval. A recorder that reports 16 ms through a
// planted 400 ms block is measuring nothing, and every "the editor is fine"
// number in this file would be worthless.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-course-editor-lag.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/course-editor-lag');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], console: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') out.console.push(String(m.text()).slice(0, 300));
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  // ---------------------------------------------------------------- instrument
  // One recorder, installed once, driven by start/stop. It runs its own rAF
  // chain so it samples the SAME callback queue the game's frame loop is in:
  // if the game's frame is 20 s long, this recorder's next callback is 20 s late
  // too, and that is exactly the number we want.
  await page.evaluate(() => {
    const rec = {
      running: false, label: null, last: 0, intervals: [], longTasks: [], observer: null,
    };
    window.__lagRec = rec;
    const step = (ts) => {
      if (!rec.running) return;
      if (rec.last) rec.intervals.push(+(ts - rec.last).toFixed(2));
      rec.last = ts;
      requestAnimationFrame(step);
    };
    rec.start = (label) => {
      rec.running = true; rec.label = label; rec.last = 0;
      rec.intervals = []; rec.longTasks = [];
      try {
        rec.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            rec.longTasks.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1) });
          }
        });
        rec.observer.observe({ entryTypes: ['longtask'] });
      } catch { rec.observer = null; }
      requestAnimationFrame(step);
    };
    rec.stop = () => {
      rec.running = false;
      try { rec.observer?.disconnect(); } catch { /* ignore */ }
      const s = rec.intervals.slice().sort((a, b) => a - b);
      const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null);
      return {
        label: rec.label,
        frames: s.length,
        medianMs: q(0.5),
        p95Ms: q(0.95),
        maxMs: s.length ? s[s.length - 1] : null,
        over100ms: s.filter((v) => v > 100).length,
        over1000ms: s.filter((v) => v > 1000).length,
        longTasks: rec.longTasks.sort((a, b) => b.dur - a.dur).slice(0, 8),
      };
    };
  });

  const record = async (label, ms, during = null) => {
    await page.evaluate((l) => window.__lagRec.start(l), label);
    if (during) await during();
    else await page.waitForTimeout(ms);
    return page.evaluate(() => window.__lagRec.stop());
  };

  // -------------------------------------------------------- NEGATIVE CONTROL
  // Plant a 400 ms synchronous block. The recorder must see it.
  out.control = await record('control-planted-400ms-block', 0, async () => {
    await page.evaluate(() => new Promise((resolve) => {
      setTimeout(() => {
        const end = performance.now() + 400;
        while (performance.now() < end) { /* block the main thread on purpose */ }
        setTimeout(resolve, 300);
      }, 200);
    }));
  });
  out.controlDetected = (out.control.maxMs || 0) >= 400;
  console.log(`CONTROL planted 400ms block -> recorder max ${out.control.maxMs} ms `
    + `(${out.controlDetected ? 'DETECTED — instrument works' : 'MISSED — INSTRUMENT IS BLIND'})`);

  // ------------------------------------------------------------- walk baseline
  out.walk = await record('walk', 4000);
  console.log(`WALK      median ${out.walk.medianMs} ms  p95 ${out.walk.p95Ms}  max ${out.walk.maxMs}  frames ${out.walk.frames}`);
  await page.screenshot({ path: path.join(OUT, '01-walk.png') });

  // --------------------------------------------------------------- enter editor
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  const tEnter = Date.now();
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor', null, { timeout: 120000 })
    .catch(() => out.errs.push('editor never became active after J'));
  out.enterMs = Date.now() - tEnter;
  console.log(`ENTER EDITOR via J: ${out.enterMs} ms`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '02-editor-open.png') });

  out.editorIdle = await record('editor-idle', 5000);
  console.log(`EDITOR IDLE   median ${out.editorIdle.medianMs} ms  p95 ${out.editorIdle.p95Ms}  max ${out.editorIdle.maxMs}  frames ${out.editorIdle.frames}  >1s ${out.editorIdle.over1000ms}`);

  // ------------------------------------------------- pointer moves over canvas
  // A hand moves the mouse before it clicks. If a pointermove handler is what
  // costs the 20 s, idle numbers will look fine and this will not.
  out.editorMove = await record('editor-pointermove', 0, async () => {
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.move(cx - 220 + i * 18, cy - 90 + Math.round(Math.sin(i / 2) * 60));
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);
  });
  console.log(`EDITOR MOVE   median ${out.editorMove.medianMs} ms  p95 ${out.editorMove.p95Ms}  max ${out.editorMove.maxMs}  >1s ${out.editorMove.over1000ms}`);
  console.log('  longest tasks during move:', JSON.stringify(out.editorMove.longTasks.slice(0, 4)));

  // ---------------------------------------------------------- click -> response
  // Watch a value the click is supposed to change, then time mousedown to the
  // first frame where it changed. Terrain strokes bump the editor session's
  // dirty/undo bookkeeping; the brush ring position moves on any canvas press.
  const beforeClick = await page.evaluate(() => {
    const fw = window.__fw;
    return {
      courseMode: fw.courseMode,
      undoDepth: fw.editorQa?.session?.()?.undo?.length ?? null,
      pointerEvents: (window.__clickProbe = { down: 0, up: 0, click: 0 }),
    };
  });
  await page.evaluate(() => {
    const p = window.__clickProbe;
    const c = document.querySelector('canvas');
    c.addEventListener('pointerdown', () => { p.down = performance.now(); }, { capture: true });
    c.addEventListener('pointerup', () => { p.up = performance.now(); }, { capture: true });
    window.addEventListener('click', () => { p.click = performance.now(); }, { capture: true });
  });
  out.beforeClick = beforeClick;

  const clickStart = Date.now();
  out.editorClick = await record('editor-click', 0, async () => {
    await page.mouse.move(cx, cy + 40);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(3000);
  });
  out.clickWallMs = Date.now() - clickStart;
  out.clickProbe = await page.evaluate(() => {
    const p = window.__clickProbe;
    return { down: +p.down.toFixed(1), up: +p.up.toFixed(1), click: +p.click.toFixed(1), handlerLagMs: +(p.click - p.down).toFixed(1) };
  });
  console.log(`EDITOR CLICK  median ${out.editorClick.medianMs} ms  p95 ${out.editorClick.p95Ms}  max ${out.editorClick.maxMs}  >1s ${out.editorClick.over1000ms}`);
  console.log(`  pointerdown->click handler lag: ${out.clickProbe.handlerLagMs} ms; wall for the whole click block: ${out.clickWallMs} ms`);
  console.log('  longest tasks during click:', JSON.stringify(out.editorClick.longTasks.slice(0, 4)));
  await page.screenshot({ path: path.join(OUT, '03-after-click.png') });

  // ------------------------------------------------------ TAB: the torn frame
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '04-after-tab-400ms.png') });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '05-after-tab-1600ms.png') });
  out.afterTab = await page.evaluate(() => {
    const fw = window.__fw;
    const c = document.querySelector('canvas');
    return {
      courseMode: fw.courseMode,
      view: fw.view,
      walkActive: !!fw.scene3d?.walk?.isActive?.(),
      canvasCssW: c.clientWidth,
      canvasCssH: c.clientHeight,
      canvasBufW: c.width,
      canvasBufH: c.height,
      dpr: window.devicePixelRatio,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
    };
  });
  console.log('AFTER TAB', JSON.stringify(out.afterTab));

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path.join(OUT, 'result.json')}`);
  return out;
}
