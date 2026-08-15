// PLAYTEST 5, ITEM 4 — THE WALK-IN TEE TIME NEEDS TWO ATTEMPTS.
//
//   "I go to the screen to give a walk-in a time, it zooms me back out, I click
//    in again, and then it works. Every time."
//
// The desk screen's whole state is one boolean, `app.frontDeskOpen`: enterFrontDesk
// sets it true, exitFrontDesk sets it false, and nothing else in src/ writes it.
// So rather than guess which of the four exit paths fires, this replaces the
// property with an accessor that RECORDS EVERY WRITE WITH ITS STACK. The
// ejection then names its own caller instead of being inferred from a symptom.
//
// The desk is opened through `walk.hooks.openFrontDesk` -- the exact hook the
// starter-desk prop's `action` calls when you press E on it. Declared plainly:
// this drives the production verb without the walk-up, because the walk-up is a
// navigation problem and the question here is what closes the screen a beat
// after it opens.
//
// NEGATIVE CONTROL: the recorder is proved by a deliberate write --
// `app.frontDeskOpen = false` from the driver -- which must appear in the trace
// with the driver's own stack. A recorder that misses a write it was handed
// cannot be trusted to have caught the one that matters.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-desk-screen-ejects.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/desk-screen-ejects');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  out.install = await page.evaluate(() => {
    const fw = window.__fw;
    const trace = [];
    window.__deskTrace = trace;
    let value = fw.frontDeskOpen;
    const ok = (() => {
      try {
        Object.defineProperty(fw, 'frontDeskOpen', {
          configurable: true,
          enumerable: true,
          get() { return value; },
          set(next) {
            if (next !== value) {
              trace.push({
                t: +performance.now().toFixed(1),
                to: next,
                stack: String(new Error().stack || '').split('\n').slice(1, 7)
                  .map((l) => l.trim().replace(/^at\s+/, '').replace(/^.*Golf-Flipper\//, ''))
                  .join(' <- '),
              });
            }
            value = next;
          },
        });
        return true;
      } catch (e) { return String(e.message || e); }
    })();
    return { ok, initial: value, hasHook: typeof fw.scene3d?.walk?.hooks?.openFrontDesk === 'function' };
  });
  console.log(`recorder installed: ${JSON.stringify(out.install)}`);

  // ------------------------------------------------------- NEGATIVE CONTROL
  await page.evaluate(() => { window.__fw.frontDeskOpen = true; window.__fw.frontDeskOpen = false; });
  out.control = await page.evaluate(() => window.__deskTrace.slice());
  out.controlDetected = out.control.length >= 2;
  console.log(`CONTROL two deliberate writes -> recorder saw ${out.control.length} `
    + `${out.controlDetected ? '— recorder works' : '— RECORDER IS BLIND'}`);
  await page.evaluate(() => { window.__deskTrace.length = 0; });

  const state = () => page.evaluate(() => ({
    frontDeskOpen: window.__fw.frontDeskOpen,
    laptopOpen: window.__fw.laptopOpen,
    walkActive: !!window.__fw.scene3d?.walk?.isActive?.(),
    deskMode: document.body.classList.contains('front-desk-mode'),
  }));

  const attempt = async (label) => {
    await page.evaluate(() => { window.__deskTrace.length = 0; });
    // enterFrontDesk has five ways to return without opening anything, and it
    // returns SILENTLY from all of them. Read every one of them first, or a run
    // where the screen never appeared is indistinguishable from a run where it
    // appeared and was closed.
    const guards = await page.evaluate(() => {
      const fw = window.__fw;
      const ch = fw.scene3d?.clubhouse?.();
      let pose = null;
      let poseError = null;
      try { pose = ch?.register?.cashierPose?.() ?? null; } catch (e) { poseError = String(e?.message || e); }
      return {
        walkActive: !!fw.scene3d?.walk?.isActive?.(),
        view: fw.view,
        courseMode: fw.courseMode,
        frontDeskOpen: fw.frontDeskOpen,
        laptopOpen: fw.laptopOpen,
        registerActive: (() => { try { return !!ch?.register?.isActive?.(); } catch { return 'threw'; } })(),
        cashierPose: pose ? { x: +pose.x?.toFixed?.(2), z: +pose.z?.toFixed?.(2) } : null,
        cashierPoseIsNull: pose == null,
        poseError,
        hasClubhouse: !!ch,
      };
    });
    console.log(`\n[${label}] guards before the call: ${JSON.stringify(guards)}`);
    const opened = await page.evaluate(() => {
      const hooks = window.__fw.scene3d.walk.hooks;
      if (typeof hooks.openFrontDesk !== 'function') return 'no-hook';
      hooks.openFrontDesk(null);
      return true;
    });
    // Sample every frame for two seconds: the ejection is "a beat later", so a
    // single read after the fact would only ever show the settled state.
    const series = await page.evaluate(() => new Promise((resolve) => {
      const s = [];
      const t0 = performance.now();
      const tick = () => {
        s.push({ t: +(performance.now() - t0).toFixed(0), open: window.__fw.frontDeskOpen });
        if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
        else resolve(s);
      };
      requestAnimationFrame(tick);
    }));
    const trace = await page.evaluate(() => window.__deskTrace.slice());
    const st = await state();
    const flips = [];
    for (let i = 1; i < series.length; i += 1) {
      if (series[i].open !== series[i - 1].open) flips.push({ at: series[i].t, to: series[i].open });
    }
    const row = {
      label, opened, guards, flips, endedOpen: st.frontDeskOpen, deskModeClass: st.deskMode, trace,
    };
    out[label] = row;
    console.log(`\n[${label}] openFrontDesk -> ${JSON.stringify(opened)}`);
    console.log(`  flips over 2.2 s: ${JSON.stringify(flips)}`);
    console.log(`  ended open: ${st.frontDeskOpen}  (body.front-desk-mode = ${st.deskMode})`);
    for (const w of trace) console.log(`  write t=${w.t} -> ${w.to}   ${w.stack}`);
    return row;
  };

  out.first = await attempt('FIRST attempt');
  await page.screenshot({ path: path.join(OUT, `${tag}-01-first.png`) });
  // Leave cleanly, the way Escape does, then try again — the owner's second click.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  out.second = await attempt('SECOND attempt');
  await page.screenshot({ path: path.join(OUT, `${tag}-02-second.png`) });

  out.verdict = {
    controlDetected: out.controlDetected,
    firstEndedOpen: out.first.endedOpen,
    secondEndedOpen: out.second.endedOpen,
    firstFlips: out.first.flips.length,
    secondFlips: out.second.flips.length,
    reproduced: out.first.endedOpen === false && out.second.endedOpen === true,
    whoClosedIt: out.first.trace.filter((w) => w.to === false).map((w) => w.stack),
  };
  console.log(`\nVERDICT ${JSON.stringify(out.verdict, null, 2)}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
