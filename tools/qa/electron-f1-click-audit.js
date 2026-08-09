// F1 — DOES EVERY PRESSABLE THING MAKE A SOUND?
//
// "A click on every button, everywhere. Menus, settings, the laptop, the
// register, the ledger, the desktop UI. If it can be pressed, it makes a sound."
//
// Phase 0 found the API — `audio.uiTick()` — and 25 call sites across six files.
// A count of call sites is not an answer to a universal claim: it says where a
// tick is played, not which buttons play one. laptop.js has ONE, for a whole
// back office.
//
// So hook the audio side and drive the buttons. Every click is followed by a
// read of the tick counter; a button that does not move it is silent, by
// measurement rather than by reading its file.
//
// THE NEGATIVE CONTROL is a click on dead space — somewhere with no button at
// all. If that also increments the counter, the counter is measuring something
// other than button presses and every "pass" below is meaningless.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-click-audit.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-click-audit');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], buttons: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);

  // Hook every sound-producing method on the audio module, not just uiTick — a
  // button that plays a DIFFERENT sound still satisfies "it makes a sound", and
  // counting only uiTick would report those as silent.
  // HOOK THE AUDIO GRAPH, NOT THE MODULE'S METHOD NAMES.
  //
  // The first two rounds counted calls to `window.__fw.audio.*` and could not
  // pass their own dead-space control. `update` runs every frame; `setPaused`
  // and `setToolLoop` fire on any interaction. Both are audio-module methods and
  // neither is a sound, so no name-based filter separates them — the distinction
  // is not in the names, it is in whether anything reached the speakers.
  //
  // A source node that STARTS is a sound. A state setter is not. Wrapping
  // `start` on the two node types that produce audio measures the thing itself
  // rather than its side effects — the same move that made `putDownCarried`'s
  // entry counter decisive in Section D.
  out.hook = await page.evaluate(() => {
    window.__f1 = { total: 0, byName: {} };
    const wrapped = [];
    for (const ctor of ['AudioBufferSourceNode', 'OscillatorNode', 'ConstantSourceNode']) {
      const C = window[ctor];
      if (!C?.prototype?.start) continue;
      const orig = C.prototype.start;
      C.prototype.start = function started(...args) {
        window.__f1.total += 1;
        window.__f1.byName[ctor] = (window.__f1.byName[ctor] || 0) + 1;
        return orig.apply(this, args);
      };
      wrapped.push(ctor);
    }
    return wrapped.length
      ? { ok: true, wrapped: wrapped.length, names: wrapped }
      : { ok: false, why: 'no source node constructors found' };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));

  // WHICH NAMES FIRE WHEN NOTHING IS PRESSED.
  //
  // The first run counted every call on the audio module as a sound and reported
  // nine of nine buttons sounding — while a click on dead space ticked too. The
  // tally showed why: `update` runs every frame, and `setToolLoop` and
  // `setPaused` are state, not sound. A counter that rises with the passage of
  // time cannot attribute anything to a click.
  //
  // So the idle set is measured first, with nothing touched, and every name in
  // it is excluded from the sound count. This promotes the dead-space control
  // from a pass/fail flag into the thing that DEFINES the measurement.
  await page.waitForTimeout(1500);
  out.idleSet = await page.evaluate(() => {
    window.__f1.idle = { ...window.__f1.byName };
    return Object.keys(window.__f1.idle);
  }).catch(() => []);
  await page.waitForTimeout(1200);
  out.idleSet2 = await page.evaluate(() => {
    const now = window.__f1.byName;
    const moved = Object.keys(now).filter((k) => (now[k] || 0) > (window.__f1.idle[k] || 0));
    window.__f1.perFrame = new Set(moved);
    window.__f1.isSound = (name) => !window.__f1.perFrame.has(name);
    return moved;
  }).catch(() => []);

  // SOUNDS ONLY: the running total of calls to names that did NOT move while
  // idle. Anything that ticks on its own is noise and is excluded by name.
  const ticks = () => page.evaluate(() => {
    const f = window.__f1;
    if (!f) return -1;
    let n = 0;
    for (const [k, v] of Object.entries(f.byName)) if (!f.perFrame.has(k)) n += v;
    return n;
  }).catch(() => -1);

  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1200);

  // CONTROL: click empty space. Must NOT tick.
  const beforeDead = await ticks();
  await page.mouse.click(30, 1300);
  await page.waitForTimeout(400);
  out.deadSpace = { before: beforeDead, after: await ticks() };

  // Enumerate visible, enabled buttons in the pause surface and click each,
  // recording the tick delta. Re-read the list each time because a click can
  // change the screen; stop once the pause menu is gone.
  const listButtons = () => page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden'
        && !b.disabled && !!b.offsetParent;
    })
    .map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent || '').trim().slice(0, 28),
        cls: String(b.className || '').split(' ')[0] || 'BUTTON',
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      };
    })).catch(() => []);

  // OPEN THE LAPTOP TOO. Phase 0 flagged laptop.js as having ONE uiTick call
  // site for a whole back office, and that is the question this instrument was
  // built to answer. Reached through the real API rather than by hunting for a
  // button, because the point is to audit the laptop buttons, not to prove I can
  // find its opener.
  // ASSERT THE OUTCOME, NOT THE NAME.
  //
  // /laptop/i matched "Close Laptop" and shut it. That is the third time this
  // session a text selector has matched a word shared by a thing and its
  // opposite -- E4's "Controls" tab versus the pause menu's "Controls" nav item
  // was the same fault, and it cost five runs there.
  //
  // No pattern fixes this, because the distinction is not in the words. What
  // fixes it is checking whether the laptop is actually open afterwards, and
  // trying the next candidate if not. An opener is defined by what it does.
  const laptopOpen = () => page.evaluate(() => !!window.__fw?.laptopOpen).catch(() => false);
  out.laptop = { openedBy: null, tried: [] };
  if (!(await laptopOpen())) {
    const cands = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((x) => {
        const r = x.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && !!x.offsetParent && !x.disabled;
      })
      .map((x) => {
        const r = x.getBoundingClientRect();
        return { text: (x.textContent || '').trim().slice(0, 24), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })).catch(() => []);
    for (const c of cands.slice(0, 12)) {
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(900);
      const now = await laptopOpen();
      out.laptop.tried.push({ text: c.text, opened: now });
      if (now) { out.laptop.openedBy = c.text; break; }
    }
  } else out.laptop.openedBy = 'already open';
  await page.waitForTimeout(1200);


  const seen = new Set();
  for (let round = 0; round < 26; round += 1) {
    const list = await listButtons();
    const next = list.find((b) => !seen.has(`${b.cls}|${b.text}`));
    if (!next) break;
    seen.add(`${next.cls}|${next.text}`);
    const before = await ticks();
    await page.mouse.click(next.x, next.y);
    await page.waitForTimeout(420);
    const after = await ticks();
    out.buttons.push({ ...next, before, after, sounded: after > before });
    // Some buttons navigate away; if the pause surface vanished, reopen it.
    const stillOpen = await page.evaluate(() => !!document.querySelector('.pause-panel, .settings-shell'))
      .catch(() => false);
    if (!stillOpen) {
      await page.keyboard.press(keys.pause || 'p');
      await page.waitForTimeout(900);
    }
  }

  const sounded = out.buttons.filter((b) => b.sounded);
  out.byName = await page.evaluate(() => window.__f1?.byName ?? {}).catch(() => ({}));
  out.verdict = {
    hookOk: out.hook?.ok ?? false,
    perFrameNamesExcluded: out.idleSet2 ?? null,
    audioMethodsWrapped: out.hook?.wrapped ?? null,
    // The control: dead space must be silent, or nothing below means anything.
    deadSpaceSilent: out.deadSpace ? out.deadSpace.after === out.deadSpace.before : null,
    buttonsClicked: out.buttons.length,
    buttonsThatSounded: sounded.length,
    silentButtons: out.buttons.filter((b) => !b.sounded).map((b) => `${b.cls}:${b.text}`),
    soundsHeard: out.byName,
  };
  fs.writeFileSync(path.join(OUT, 'f1-click-audit.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1-CLICK', JSON.stringify(out.verdict));
  return out;
}
