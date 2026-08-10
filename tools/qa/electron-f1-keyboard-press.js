// F1 — DOES A BUTTON PRESSED BY KEYBOARD MAKE A SOUND?
//
// The previous run said the HUD chip never reaches __fwUiClick on a real mouse
// click, while a pause button does. Two things follow, and this run tests both
// rather than asserting either.
//
// 1. WHY THE MOUSE MISSES THE CHIP. In play the walker locks the pointer for
//    mouse-look. Under pointer lock the browser routes mouse events to the lock
//    target, so a click at the chip's coordinates never reaches it -
//    elementFromPoint still answers geometrically, which is why the chip read as
//    hittable AND measured zero. Measured here as document.pointerLockElement,
//    not inferred.
//
// 2. THE GENERAL DEFECT THAT FALLS OUT OF IT. The factory cue rides
//    `pointerdown` (src/ui/ui.js:51). Keyboard activation of a focused button
//    fires `click` with NO pointerdown. So Space or Enter on any button in the
//    game should be silent - and F1 says "if it can be pressed, it makes a
//    sound". A keyboard press is a press.
//
//    This also explains why my chip fix appeared to work: the probe used
//    element.click(), which is the same shape as keyboard activation - it fires
//    the click path I added and never the pointerdown path I was claiming to
//    have found broken.
//
// The count is SOUNDS at the Web Audio graph, not calls, because that mistake
// has already voided two runs in this section.
//
// CONTROLS:
//   idle     - no keys, nothing focused: must stay silent (kills per-frame noise)
//   mouse    - the same button pressed by real mouse: must sound, so a silent
//              keyboard result is about the EVENT and not about that button
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-keyboard-press.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-keyboard-press');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
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

  // (1) Why the mouse missed the chip - measured, in play, before anything else.
  out.pointerLock = await page.evaluate(() => ({
    locked: !!document.pointerLockElement,
    target: document.pointerLockElement
      ? `${document.pointerLockElement.tagName}.${String(document.pointerLockElement.className || '').slice(0, 24)}`
      : null,
  })).catch(() => ({ locked: null }));

  out.hook = await page.evaluate(() => {
    window.__f1kb = { sounds: 0, sink: 0 };
    for (const ctor of ['AudioBufferSourceNode', 'OscillatorNode', 'ConstantSourceNode']) {
      const C = window[ctor];
      if (!C?.prototype?.start) continue;
      const orig = C.prototype.start;
      C.prototype.start = function started(...a) { window.__f1kb.sounds += 1; return orig.apply(this, a); };
    }
    const sink = window.__fwUiClick;
    if (typeof sink === 'function') {
      window.__fwUiClick = (n) => { window.__f1kb.sink += 1; return sink(n); };
    }
    return { ok: true, hasSink: typeof sink === 'function' };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));

  const snap = () => page.evaluate(() => ({ ...window.__f1kb })).catch(() => null);
  const delta = (a, b) => ({ sounds: b.sounds - a.sounds, sink: b.sink - a.sink });

  // Open the pause menu: it has real buttons, and no pointer lock.
  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1400);
  out.lockAfterPause = await page.evaluate(() => !!document.pointerLockElement).catch(() => null);

  // CONTROL: idle. Nothing pressed, nothing focused.
  await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  const i0 = await snap();
  await page.waitForTimeout(1200);
  out.idle = delta(i0, await snap());

  // Pick one non-destructive button and keep it for BOTH presses, so the two
  // readings differ only in how it was pressed.
  out.target = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && !!x.offsetParent && !x.disabled; })
      .find((x) => !/resume|quit|close|back|exit|save|load|delete|new/i.test((x.textContent || '').trim()));
    if (!btn) return null;
    btn.id = btn.id || '__f1kbTarget';
    const r = btn.getBoundingClientRect();
    return {
      id: btn.id,
      text: (btn.textContent || '').trim().slice(0, 24),
      hasFactoryCue: !!btn.__fwClickCue,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    };
  }).catch(() => null);

  if (out.target) {
    // KEYBOARD: focus it, then a real Enter through the input pipeline.
    await page.evaluate((id) => document.getElementById(id)?.focus(), out.target.id).catch(() => {});
    await page.waitForTimeout(250);
    out.focused = await page.evaluate((id) => document.activeElement?.id === id, out.target.id).catch(() => false);
    const k0 = await snap();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    out.keyboardEnter = delta(k0, await snap());

    // and Space, which is the other way a button is pressed from the keyboard.
    await page.evaluate((id) => document.getElementById(id)?.focus(), out.target.id).catch(() => {});
    await page.waitForTimeout(250);
    const s0 = await snap();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    out.keyboardSpace = delta(s0, await snap());

    // CONTROL: the SAME button, real mouse. If this sounds and the keys did not,
    // the difference is the event, not the button.
    const still = await page.evaluate((id) => {
      const b = document.getElementById(id);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      return { x: cx, y: cy, reachable: !!top && (top === b || b.contains(top)) };
    }, out.target.id).catch(() => null);
    if (still?.reachable) {
      const m0 = await snap();
      await page.mouse.click(still.x, still.y);
      await page.waitForTimeout(500);
      out.mouseClick = delta(m0, await snap());
    } else out.mouseClick = { skipped: 'covered', still };
  }

  await page.screenshot({ path: path.join(OUT, 'f1-keyboard.png') });

  out.verdict = {
    pointerLockedInPlay: out.pointerLock.locked,
    lockTarget: out.pointerLock.target,
    button: out.target?.text ?? null,
    focusedOk: out.focused ?? null,
    idleSilent: out.idle ? out.idle.sounds === 0 : null,
    ENTER_sounded: out.keyboardEnter ? out.keyboardEnter.sounds > 0 : null,
    SPACE_sounded: out.keyboardSpace ? out.keyboardSpace.sounds > 0 : null,
    mouse_sounded: out.mouseClick?.sounds !== undefined ? out.mouseClick.sounds > 0 : null,
    enterReachedSink: out.keyboardEnter ? out.keyboardEnter.sink > 0 : null,
    mouseReachedSink: out.mouseClick?.sink !== undefined ? out.mouseClick.sink > 0 : null,
  };
  fs.writeFileSync(path.join(OUT, 'f1-keyboard-press.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1-KEYBOARD', JSON.stringify(out.verdict));
  return out;
}
