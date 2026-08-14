// PHASE 1 GATE (Goal 26) — WHAT ACTUALLY PLAYS, AND HOW LOUD.
//
// "A verifier taps the audio graph and records what actually plays: node created,
// buffer, timestamp, peak level. A source test asserting a callback exists proves
// nothing -- that exact check certified a silent menu for two sessions."
//
// The ledger records that exact failure twice (FOUND_FALSE, "the main menu sound"):
// four regexes over the source of menu.js, every asserted string genuinely
// present, and no test executed anything. So nothing here reads source.
//
// THE TRAP THIS PHASE HAS THAT THE OTHERS DID NOT. Goal 22's fix was verified by
// counting graph events, which was right for "is it silent?" and is WRONG here:
// the synth voices this phase replaces are themselves oscillators and
// filtered-noise BUFFERS. A gate that counts BufferSources would pass with a
// perfect score on the oscillator build -- it would certify the exact thing it
// was built to detect the absence of. That is shape 10: the failure mode and the
// finding produce the same number.
//
// So a cue is only credited when the buffer that started carries __fwSample, the
// tag src/core/sampleBank.js puts on a decoded VENDORED FILE. The report names
// the file per cue. Peak is read off the master bus, post-volume, in dBFS.
//
// CONTROLS, both of which must fail for the run to mean anything:
//   silence      a window of the same length with no cue fired
//   synthOnly    a cue with no recording behind it -- audible, and NOT credited
//                as sampled, which proves the tag is doing the discriminating
//
//   node tools/qa/run-electron.cjs tools/qa/electron-phase1-audio-gate.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/phase1-audio');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], cues: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const text = String(m.text());
    if (/audio|decode|fault:/i.test(text) && /error|fail/i.test(text)) out.errs.push(`console: ${text.slice(0, 200)}`);
  });

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  // The context only exists after a real gesture, so one click wakes it.
  const first = await page.$('.menu-screen button:not([disabled])');
  if (first) await first.click();
  await page.waitForTimeout(1500);

  // ---- install the tap and the buffer spy -----------------------------------
  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    if (!app?.audio?.qaMasterTap) return { ok: false, why: 'qaMasterTap not on the audio surface' };
    window.__p1 = { tap: app.audio.qaMasterTap(), starts: [] };
    const probe = window.__p1.tap.read();
    // Spy on every BufferSource start so the report can say WHICH FILE played.
    // Wrapping createBufferSource rather than the bank means a cue that bypasses
    // the bank is still seen -- it just arrives untagged, which is the point.
    const ctx = app.audio.qaContext ? app.audio.qaContext() : null;
    if (!ctx) return { ok: false, why: 'no audio context handle for the spy' };
    if (!ctx.__p1Spied) {
      const make = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = make();
        const start = node.start.bind(node);
        node.start = (...args) => {
          const tag = node.buffer && node.buffer.__fwSample;
          window.__p1.starts.push({
            at: ctx.currentTime,
            seconds: node.buffer ? +node.buffer.duration.toFixed(3) : null,
            sampled: !!tag,
            file: tag ? tag.file : null,
            cue: tag ? tag.cue : null,
            loop: !!node.loop,
          });
          return start(...args);
        };
        return node;
      };
      ctx.__p1Spied = true;
    }
    return { ok: true, state: probe.state, bank: app.audio.qaSampleBankDiagnostics?.() ?? null };
  });
  console.log('INSTALLED', JSON.stringify(out.installed?.bank?.loaded !== undefined
    ? { ok: out.installed.ok, loaded: out.installed.bank.loaded, failed: out.installed.bank.failed, cues: out.installed.bank.cues?.length }
    : out.installed));
  if (!out.installed?.ok) {
    fs.writeFileSync(path.join(OUT, 'phase1-audio.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('ABORTED: the tap could not be installed, so nothing below would mean anything.');
    return out;
  }

  // ---- one cue: fire it, watch the bus, read what started -------------------
  //
  // The tap is polled rather than sampled once: these cues decay over tens to
  // hundreds of milliseconds and a single read lands wherever the event loop
  // happens to put it. G1 already paid for that -- one shot read -33.7 dBFS on
  // one run and -29.4 on the next with no code change. The MAX over the window
  // is the number that means something.
  // NOTE: this deliberately does NOT clear window.__p1.starts. The first version
  // did, and it wiped the very starts the cue had just recorded a millisecond
  // earlier -- every cue came back sampledStarts=0 while fifty files sat loaded
  // in the bank. The probe destroyed its own evidence and reported the result as
  // "no recording played", which is exactly the shape this file's header warns
  // about. Clearing happens in cue(), before the cue fires, and nowhere else.
  const measure = async (label, fire, { windowMs = 900 } = {}) => {
    const result = await page.evaluate(async ({ ms }) => {
      const t0 = performance.now();
      let peak = 0;
      const poll = () => {
        const r = window.__p1.tap.read();
        if (r.peak > peak) peak = r.peak;
      };
      poll();
      await new Promise((resolve) => {
        const tick = () => {
          poll();
          if (performance.now() - t0 >= ms) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { peak };
    }, { ms: windowMs }).catch(() => ({ peak: 0 }));
    // fire() runs concurrently with the window: it is dispatched first, then the
    // window opens on the next tick.
    const starts = await page.evaluate(() => window.__p1.starts.slice());
    const row = {
      label,
      peak: +result.peak.toFixed(5),
      dbfs: result.peak > 0 ? +(20 * Math.log10(result.peak)).toFixed(1) : null,
      bufferStarts: starts.length,
      sampledStarts: starts.filter((s) => s.sampled).length,
      files: [...new Set(starts.filter((s) => s.sampled).map((s) => s.file))],
      looped: starts.some((s) => s.loop),
    };
    return row;
  };

  // fire-then-window, so the attack is inside the measured span
  const cue = async (label, fireFn, windowMs = 900) => {
    await page.evaluate(() => { window.__p1.starts.length = 0; });
    await fireFn();
    const row = await measure(label, null, { windowMs });
    out.cues.push(row);
    console.log('CUE', JSON.stringify(row));
    return row;
  };

  const sfx = (name, ...args) => page.evaluate(
    ({ n, a }) => { const f = window.__fw?.audio?.[n]; if (typeof f === 'function') f(...a); },
    { n: name, a: args },
  );

  // ---- CONTROL 1: silence ---------------------------------------------------
  await cue('CONTROL_silence', async () => {}, 900);

  // ---- the money, which is the item ----------------------------------------
  await cue('drawerUnlock', () => sfx('drawerUnlock'));
  await page.waitForTimeout(400);
  await cue('drawerOpen', () => sfx('drawerOpen'), 1400);
  await page.waitForTimeout(400);
  await cue('billDeposit_firstNote', () => sfx('billDeposit', 0));
  await page.waitForTimeout(300);
  await cue('billDeposit_deepPile', () => sfx('billDeposit', 1));
  await page.waitForTimeout(300);
  await cue('coinDeposit_emptyWell', () => sfx('coinDeposit', 0));
  await page.waitForTimeout(300);
  await cue('coinDeposit_deepPile', () => sfx('coinDeposit', 1));
  await page.waitForTimeout(300);
  await cue('coinSettle', () => sfx('coinSettle'));
  await page.waitForTimeout(300);
  await cue('drawerClose', () => sfx('drawerClose'), 1400);
  await page.waitForTimeout(400);

  // THE CASH RUN — the one cue that is not a one-shot. Measured while it is UP,
  // then again after it is told to stop, because "it plays" and "it stops" are
  // two different claims and a stuck loop is worse than a missing sound.
  await cue('cashRun_running', () => sfx('cashRunStart', { intensity: 1 }), 1200);
  out.cashRunActiveWhileUp = await page.evaluate(() => !!window.__fw?.audio?.cashRunActive?.());
  await sfx('cashRunStop');
  await page.waitForTimeout(700);
  await cue('cashRun_afterStop_CONTROL', async () => {}, 900);
  out.cashRunActiveAfterStop = await page.evaluate(() => !!window.__fw?.audio?.cashRunActive?.());
  console.log('CASH-RUN', JSON.stringify({
    upWhileRunning: out.cashRunActiveWhileUp, upAfterStop: out.cashRunActiveAfterStop,
  }));

  // ---- the ledger and the menu ---------------------------------------------
  await cue('ledgerOpen', () => sfx('ledgerOpen'), 1400);
  await page.waitForTimeout(300);
  await cue('ledgerTurn', () => sfx('ledgerTurn'));
  await page.waitForTimeout(300);
  await cue('ledgerClose', () => sfx('ledgerClose'));
  await page.waitForTimeout(300);
  await cue('uiTick', () => sfx('uiTick'), 700);
  await page.waitForTimeout(300);
  await cue('uiConfirm', () => sfx('uiConfirm'), 700);
  await page.waitForTimeout(300);

  // ---- CONTROL 2: a cue with NO recording behind it -------------------------
  //
  // If this reads sampledStarts > 0 the tag is not discriminating and every
  // "sampled" above is worthless. It should be AUDIBLE and NOT sampled.
  await cue('CONTROL_synthOnly_doorbell', () => sfx('doorbell'), 900);

  out.bank = await page.evaluate(() => window.__fw?.audio?.qaSampleBankDiagnostics?.() ?? null);

  const silence = out.cues.find((c) => c.label === 'CONTROL_silence');
  const synthOnly = out.cues.find((c) => c.label === 'CONTROL_synthOnly_doorbell');
  out.verdict = {
    silenceFloorDb: silence?.dbfs ?? null,
    controlsHold: (silence?.sampledStarts === 0) && (synthOnly?.sampledStarts === 0),
    sampledCues: out.cues.filter((c) => c.sampledStarts > 0).map((c) => c.label),
    silentCues: out.cues.filter((c) => c.label !== 'CONTROL_silence' && (c.dbfs === null || c.dbfs < -45))
      .map((c) => ({ label: c.label, dbfs: c.dbfs })),
    bankLoaded: out.bank?.loaded ?? null,
    bankFailed: out.bank?.failed ?? null,
  };
  fs.writeFileSync(path.join(OUT, 'phase1-audio.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('PHASE1-AUDIO', JSON.stringify(out.verdict, null, 2));
  console.log('TABLE');
  for (const c of out.cues) {
    console.log(`  ${c.label.padEnd(28)} ${String(c.dbfs ?? 'silent').padStart(7)} dBFS  starts=${c.bufferStarts} sampled=${c.sampledStarts} ${c.looped ? 'LOOP ' : ''}${c.files.join(',')}`);
  }
  return out;
}
