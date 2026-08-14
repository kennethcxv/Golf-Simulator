// 1.4 (Goal 26) — EXACTLY ONE SOUND PER MENU PRESS.
//
// Narrow on purpose. The broad inventory kept drifting into the running game and
// then counted the game's own ambient oscillators as click events, and two
// earlier probes attached their spy to a context that did not exist yet and
// reported silence. Both of those are the same underlying mistake: measuring
// before the thing being measured exists, and letting "I saw nothing" stand in
// for "nothing happened".
//
// So the ORDER is the instrument here:
//   1. wake the context with one press, and WAIT for qaContext() to be non-null
//   2. WAIT for the sample bank to finish decoding (a cue measured before it
//      lands is scored against the synth fallback, which is a different claim)
//   3. only then attach the spy
//   4. press menu controls that do NOT start a game, so the menu stays up and no
//      gameplay audio can bleed into the window
//
// Two calls into uiTick within one press is EXPECTED and correct: the menu's own
// handler and the global sink both see it, and the 120 ms press window inside
// uiTick collapses them. What 1.4 asks for is exactly one SOUND, so the count
// that matters is voices started, not functions called -- and both are reported
// so the difference is visible rather than assumed.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-menu-one-sound.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/menu-one-sound');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], presses: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);

  // 1 + 2: wake, then WAIT — never a fixed timer.
  const wake = await page.$('.menu-screen button:not([disabled])');
  if (wake) await wake.click();
  const gotCtx = await page.waitForFunction(
    () => !!window.__fw?.audio?.qaContext?.(), null, { timeout: 30000 },
  ).then(() => true).catch(() => false);
  const gotBank = await page.waitForFunction(
    () => (window.__fw?.audio?.qaSampleBankDiagnostics?.()?.loaded ?? 0) >= 40, null, { timeout: 60000 },
  ).then(() => true).catch(() => false);
  out.preconditions = { gotCtx, gotBank };
  console.log('PRECONDITIONS', JSON.stringify(out.preconditions));
  if (!gotCtx || !gotBank) {
    console.log('ABORTED: measuring before the context and bank exist is how the last two probes reported silence.');
    fs.writeFileSync(path.join(OUT, 'menu-one-sound.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  // Escape back out of whatever the wake press opened, so the menu is up again.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);

  // 3: attach the spy, now that there is something to attach it to.
  out.installed = await page.evaluate(() => {
    const a = window.__fw.audio;
    const ctx = a.qaContext();
    window.__m1 = { voices: [], tickCalls: 0, cancelCalls: 0, confirmCalls: 0 };
    for (const [name, key] of [['uiTick', 'tickCalls'], ['uiCancel', 'cancelCalls'], ['uiConfirm', 'confirmCalls']]) {
      const real = a[name];
      if (typeof real === 'function') {
        a[name] = (...args) => { window.__m1[key] += 1; return real.apply(a, args); };
      }
    }
    if (!ctx.__m1Spied) {
      const mkB = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const n = mkB(); const s = n.start.bind(n);
        n.start = (...x) => {
          const tag = n.buffer && n.buffer.__fwSample;
          window.__m1.voices.push({ kind: 'buffer', cue: tag?.cue ?? null, file: tag?.file ?? null });
          return s(...x);
        };
        return n;
      };
      const mkO = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const n = mkO(); const s = n.start.bind(n);
        n.start = (...x) => { window.__m1.voices.push({ kind: 'osc', cue: null, file: null }); return s(...x); };
        return n;
      };
      ctx.__m1Spied = true;
    }
    return { ok: true, ctxState: ctx.state };
  });
  console.log('INSTALLED', JSON.stringify(out.installed));

  const reset = () => page.evaluate(() => {
    window.__m1.voices.length = 0;
    window.__m1.tickCalls = 0; window.__m1.cancelCalls = 0; window.__m1.confirmCalls = 0;
  });

  // CONTROL: an idle window of the same length. Anything it records is ambience
  // and has to be subtracted from every judgement below.
  await reset();
  await page.waitForTimeout(700);
  out.idle = await page.evaluate(() => ({ ...window.__m1 }));
  console.log('CONTROL_idle', JSON.stringify({ voices: out.idle.voices.length, ticks: out.idle.tickCalls }));

  // 4: press menu controls that keep the menu up. Settings and Credits open
  // dialogs (which 1.4 explicitly includes); neither starts a game.
  const pressByText = async (label, rx, { keyboard = false } = {}) => {
    await reset();
    const handle = await page.evaluateHandle((pattern) => {
      const re = new RegExp(pattern, 'i');
      return [...document.querySelectorAll('button, [role="button"]')]
        .find((n) => re.test((n.textContent || '').trim()) && !n.disabled) || null;
    }, rx.source);
    const element = handle.asElement();
    if (!element) { console.log('SKIP', label, '(not on screen)'); return null; }
    if (keyboard) { await element.evaluate((n) => n.focus()); await page.keyboard.press('Enter'); }
    else await element.click({ timeout: 5000 }).catch((e) => out.errs.push(`${label}: ${e.message}`));
    await page.waitForTimeout(650);
    const seen = await page.evaluate(() => ({ ...window.__m1 }));
    const row = {
      label,
      keyboard,
      voices: seen.voices.length,
      cues: [...new Set(seen.voices.map((v) => v.cue).filter(Boolean))],
      files: [...new Set(seen.voices.map((v) => v.file).filter(Boolean))],
      tickCalls: seen.tickCalls,
      cancelCalls: seen.cancelCalls,
      confirmCalls: seen.confirmCalls,
    };
    out.presses.push(row);
    console.log('PRESS', JSON.stringify(row));
    return row;
  };

  await pressByText('Settings (opens a dialog)', /^Settings/);
  await pressByText('settings tab: Camera', /^Camera$/);
  await pressByText('settings tab: Display', /^Display$/);
  await pressByText('settings tab: Camera (keyboard)', /^Camera$/, { keyboard: true });
  // 1.4: cancel gets its own variant. "Done"/"Cancel" closes the settings dialog.
  await pressByText('Done / Cancel', /^(Done|Cancel|Close)$/);
  await page.waitForTimeout(500);
  await pressByText('Credits (opens a dialog)', /^Credits$/);
  await pressByText('Back out of Credits', /^(Back|Close|Done|Cancel)$/);

  // DISABLED CONTROL: must stay silent.
  await reset();
  const disabledClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.menu-screen button')].find((n) => n.disabled);
    if (!b) return null;
    // A disabled <button> swallows synthetic clicks, so the press is delivered as
    // a pointerdown on it directly -- which is exactly what the capture-phase
    // sink sees in play, and therefore the path that has to stay silent.
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    return (b.textContent || '').trim().slice(0, 30);
  });
  await page.waitForTimeout(500);
  out.disabled = { label: disabledClicked, ...(await page.evaluate(() => ({ ...window.__m1 }))) };
  console.log('DISABLED', JSON.stringify({
    label: out.disabled.label, voices: out.disabled.voices.length, ticks: out.disabled.tickCalls,
  }));

  const real = out.presses.filter(Boolean);
  out.verdict = {
    idleVoices: out.idle.voices.length,
    pressesTested: real.length,
    silentPresses: real.filter((p) => p.voices === 0).map((p) => p.label),
    multiVoicePresses: real.filter((p) => p.voices > 1).map((p) => ({ label: p.label, voices: p.voices })),
    exactlyOne: real.filter((p) => p.voices === 1).length,
    sampledPresses: real.filter((p) => p.files.length > 0).length,
    disabledStayedSilent: (out.disabled.voices?.length ?? 0) === 0,
    cancelVariantSeen: real.some((p) => p.cues.includes('uiCancel') || p.cancelCalls > 0),
    keyboardRow: real.find((p) => p.keyboard) || null,
  };
  fs.writeFileSync(path.join(OUT, 'menu-one-sound.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('MENU-ONE-SOUND', JSON.stringify(out.verdict, null, 2));
  return out;
}
