// 1.4 (Goal 26) — THE INVENTORY: EVERY CLICKABLE CONTROL, EXACTLY ONE SOUND.
//
// "Build an inventory of every clickable menu and dialog control and verify each
// emits EXACTLY ONE sound event."
//
// The ledger has this item twice (FOUND_FALSE, "the main menu sound"). The first
// fix was verified by four regexes over the source of menu.js: every asserted
// string was genuinely present and NO TEST EXECUTED ANYTHING, so none could tell
// whether a sound was made. The second was real and found the handler attached
// inside setVisible(true) on a menu that is born visible -- so on the launch path
// the listener was never installed and 0/4 buttons spoke.
//
// This therefore enumerates the LIVE DOM, clicks each control with a real mouse
// press, and counts audio-graph events per click. Four things are checked, and
// the last two are the ones a naive version would miss:
//
//   1. every enabled control makes a sound
//   2. it makes EXACTLY ONE -- two is as much a defect as none, and bubbling
//      through a capture-phase listener plus a factory hook is how you get two
//   3. DISABLED controls stay SILENT
//   4. KEYBOARD activation sounds the same as a click
//
// The counter is buffer-start events on the live context, which is what the
// player hears, rather than a call count on a function that may be one of two
// populations (shape 1 -- and this file's own sink has two entry points, the
// factory hook and the capture listener, so that risk is real here).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-menu-click-inventory.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/menu-click-inventory');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], controls: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  // ONE PRESS TO CREATE THE CONTEXT, AND THEN WAIT FOR IT TO EXIST.
  //
  // A context can only be created from a user gesture, so before the first press
  // there is nothing to spy on. The first version installed the spy on a fixed
  // timer after the wake click and did not check: qaContext() returned null, the
  // spy was never attached, and every control reported zero sound events. The
  // probe was not watching, and "not watching" and "silent" produced the same
  // number -- the failure mode agreeing with the finding, which is shape 10.
  //
  // So the context is now WAITED FOR and its absence is a loud abort.
  const wake = await page.$('.menu-screen button:not([disabled])');
  if (wake) await wake.click();
  await page.waitForFunction(() => !!window.__fw?.audio?.qaContext?.(), null, { timeout: 30000 })
    .catch(() => {});
  // The bank decodes asynchronously after that first gesture; a cue measured
  // before it lands would be scored against the synth fallback.
  await page.waitForFunction(
    () => (window.__fw?.audio?.qaSampleBankDiagnostics?.()?.loaded ?? 0) > 0, null, { timeout: 60000 },
  ).catch(() => {});
  await page.waitForTimeout(600);

  out.installed = await page.evaluate(() => {
    const a = window.__fw?.audio;
    const ctx = a?.qaContext?.();
    if (!ctx) return { ok: false, why: 'no live audio context after the wake gesture' };
    window.__mi = { events: [] };
    if (!ctx.__miSpied) {
      // Both kinds of voice count as "a sound event": a recorded click is a
      // BufferSource, a synth click is an Oscillator, and a control that is
      // silent on one build and audible on the other must not read the same.
      const mkBuf = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const n = mkBuf();
        const s = n.start.bind(n);
        n.start = (...args) => {
          const tag = n.buffer && n.buffer.__fwSample;
          window.__mi.events.push({ kind: 'buffer', cue: tag?.cue ?? null, file: tag?.file ?? null });
          return s(...args);
        };
        return n;
      };
      const mkOsc = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const n = mkOsc();
        const s = n.start.bind(n);
        n.start = (...args) => { window.__mi.events.push({ kind: 'osc', cue: null, file: null }); return s(...args); };
        return n;
      };
      ctx.__miSpied = true;
    }
    return { ok: true };
  });
  if (!out.installed?.ok) { console.log('ABORTED', JSON.stringify(out.installed)); return out; }

  // Enumerate what is actually on screen and clickable.
  const listControls = () => page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"], .menu-action, .difficulty-card')];
    return nodes.filter((n) => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && Number(cs.opacity) > 0.05;
    }).map((n, i) => {
      n.dataset.miIndex = String(i);
      const r = n.getBoundingClientRect();
      return {
        index: i,
        tag: n.tagName.toLowerCase(),
        label: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 44),
        cls: String(n.className || '').slice(0, 60),
        disabled: !!(n.disabled || n.getAttribute('aria-disabled') === 'true'),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
      };
    });
  });

  const press = async (ctrl, { keyboard = false } = {}) => {
    await page.evaluate(() => { window.__mi.events.length = 0; });
    // A real press. The sink listens on pointerdown in the capture phase, so a
    // synthetic .click() would test a path the player never takes.
    if (keyboard) {
      await page.evaluate((i) => {
        const n = document.querySelector(`[data-mi-index="${i}"]`);
        if (n) { n.focus(); }
      }, ctrl.index);
      await page.keyboard.press('Enter');
    } else {
      // BY ELEMENT HANDLE, NOT BY COORDINATES.
      //
      // The first version used page.mouse.click(centreX, centreY) off
      // getBoundingClientRect, and every enabled control came back SILENT while
      // keyboard Enter worked. It was not a menu bug: this window runs at
      // devicePixelRatio 1.5, the raw press landed somewhere other than the
      // button, and the pointerdown that arrived had target DIV with no button
      // ancestor -- so the menu's own `closest('button')` handler correctly
      // declined to speak for it. elementFromPoint at the same coordinates still
      // answered BUTTON.menu-action, because it answers geometrically and knows
      // nothing about where the press actually went, so the two instruments
      // disagreed and the geometric one was the liar.
      //
      // An element handle lets Playwright compute the hit point itself, which is
      // the only version that survives a scaled display.
      const handle = await page.$(`[data-mi-index="${ctrl.index}"]`);
      if (handle) await handle.click({ timeout: 5000 }).catch(() => {});
      else await page.mouse.click(ctrl.x, ctrl.y);
    }
    await page.waitForTimeout(260);
    return page.evaluate(() => window.__mi.events.slice());
  };

  // ---- CONTROL: a press on dead space --------------------------------------
  //
  // If clicking the background makes a sound, the sink is firing on everything
  // and every "exactly one" below is meaningless.
  await page.evaluate(() => { window.__mi.events.length = 0; });
  await page.mouse.click(3, 3);
  await page.waitForTimeout(260);
  out.deadSpace = await page.evaluate(() => window.__mi.events.slice());
  console.log('CONTROL_deadSpace', JSON.stringify({ events: out.deadSpace.length }));

  let controls = await listControls();
  out.found = controls.length;
  console.log('CONTROLS', controls.length);

  // Clicking a control can navigate away and invalidate the rest of the list, so
  // the list is re-read after every press and controls are matched by LABEL.
  const done = new Set();
  for (let guard = 0; guard < 40; guard += 1) {
    controls = await listControls();
    const next = controls.find((c) => !done.has(`${c.label}|${c.cls}`));
    if (!next) break;
    done.add(`${next.label}|${next.cls}`);
    const events = await press(next);
    const row = {
      label: next.label || '(no label)',
      cls: next.cls,
      disabled: next.disabled,
      events: events.length,
      cues: [...new Set(events.map((e) => e.cue).filter(Boolean))],
      files: [...new Set(events.map((e) => e.file).filter(Boolean))],
      kinds: [...new Set(events.map((e) => e.kind))],
    };
    // Keyboard parity, on enabled controls only.
    if (!next.disabled) {
      const again = await listControls();
      const same = again.find((c) => c.label === next.label && c.cls === next.cls);
      if (same) {
        const kb = await press(same, { keyboard: true });
        row.keyboardEvents = kb.length;
        row.keyboardCues = [...new Set(kb.map((e) => e.cue).filter(Boolean))];
      }
    }
    out.controls.push(row);
    console.log('CTRL', JSON.stringify(row));
    await page.waitForTimeout(220);
  }

  const enabled = out.controls.filter((c) => !c.disabled);
  const disabled = out.controls.filter((c) => c.disabled);
  out.verdict = {
    deadSpaceSilent: out.deadSpace.length === 0,
    controlsTested: out.controls.length,
    enabledTested: enabled.length,
    silentEnabled: enabled.filter((c) => c.events === 0).map((c) => c.label),
    doubleFired: enabled.filter((c) => c.events > 1).map((c) => ({ label: c.label, events: c.events })),
    disabledThatSpoke: disabled.filter((c) => c.events > 0).map((c) => c.label),
    keyboardMismatch: enabled
      .filter((c) => c.keyboardEvents !== undefined && c.keyboardEvents !== c.events)
      .map((c) => ({ label: c.label, click: c.events, keyboard: c.keyboardEvents })),
    cancelVariantUsed: [...new Set(out.controls.flatMap((c) => c.cues))].includes('uiCancel'),
  };
  fs.writeFileSync(path.join(OUT, 'menu-click-inventory.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('MENU-INVENTORY', JSON.stringify(out.verdict, null, 2));
  return out;
}
