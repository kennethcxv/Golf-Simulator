// F1 — WAS THE HUD CHIP EVER SILENT? Testing my own published fix.
//
// I reported the clock chip as "the only silent control the audit reached" and
// fixed it by adding `app.audio?.uiTick?.()` to its onclick. Reading the code
// afterwards says that was probably unnecessary, and possibly a fix to nothing:
//
//   src/ui/ui.js:46-54    every el('button') gets __fwClickCue and a pointerdown
//                         listener that calls window.__fwUiClick(node)
//   src/main.js:1040-44   and any button NOT born in the factory gets the same
//                         cue from a document-level capture listener
//
// The chip is `el('button', {class:'hud-chip hud-clock'})`. Layer 1 covers it.
// So why did it measure silent? Because that audit ran with the PAUSE MENU
// OPEN, and a .modal-backdrop eats the pointerdown there - the same artifact
// that made me wrongly report "the fix did not take" an hour later. If the
// backdrop swallowed the press, NOTHING would have sounded, fix or no fix, and
// "silent" says nothing about the chip.
//
// THE INSTRUMENT, and why it is clean: hook window.__fwUiClick. My onclick
// calls audio.uiTick() DIRECTLY and never touches __fwUiClick, so every arrival
// at this hook is the factory path and nothing else. No code has to be reverted
// to separate them.
//
// CONTROLS, both required:
//   dead space  - clicking empty canvas must NOT reach __fwUiClick
//   known-good  - a button already proved to cue must reach it, so a zero on the
//                 chip means "the chip", not "the hook is dead"
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-chip-was-it-real.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-chip-was-it-real');
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

  out.hook = await page.evaluate(() => {
    window.__f1chip = [];
    const orig = window.__fwUiClick;
    if (typeof orig !== 'function') return { ok: false, why: 'no __fwUiClick sink on window' };
    window.__fwUiClick = (node) => {
      window.__f1chip.push({
        cls: String(node?.className || '').slice(0, 40),
        text: (node?.textContent || '').trim().slice(0, 30),
      });
      return orig(node);
    };
    return { ok: true };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));

  const arrivals = () => page.evaluate(() => (window.__f1chip || []).length).catch(() => -1);
  const last = () => page.evaluate(() => (window.__f1chip || []).at(-1) || null).catch(() => null);

  // Where is the chip, and is anything covering it? IN PLAY - no pause menu, no
  // backdrop, which is the whole point of this run.
  out.chip = await page.evaluate(() => {
    const c = document.querySelector('.hud-clock');
    if (!c) return { found: false };
    const r = c.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true,
      x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height),
      hasFactoryCue: !!c.__fwClickCue,
      text: (c.textContent || '').trim().slice(0, 30),
      topAtCentre: top ? `${top.tagName}.${String(top.className || '').slice(0, 30)}` : null,
      covered: !(top && (top === c || c.contains(top))),
      pointerEvents: getComputedStyle(c).pointerEvents,
      rootPointerEvents: getComputedStyle(document.querySelector('.hud-min')).pointerEvents,
      backdrops: document.querySelectorAll('.modal-backdrop').length,
    };
  }).catch((e) => ({ found: false, threw: String(e && e.message) }));

  // CONTROL 1 - dead space must not reach the sink.
  const d0 = await arrivals();
  await page.mouse.click(20, 1340);
  await page.waitForTimeout(350);
  out.deadSpace = { before: d0, after: await arrivals() };

  // THE MEASUREMENT - the chip, in play, one plain mouse click.
  if (out.chip.found) {
    const b0 = await arrivals();
    await page.mouse.click(out.chip.x, out.chip.y);
    await page.waitForTimeout(400);
    out.chipClick = { before: b0, after: await arrivals(), sawNode: await last() };
  }

  // CONTROL 2 - a known-good button, so a zero above is about the chip and not
  // about a dead hook. The cash chip is a div, so use the pause menu... which is
  // exactly the surface with the backdrop. Instead: click the chip's sibling if
  // one exists, else open pause AFTER the measurement is banked and click there.
  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1200);
  const k0 = await arrivals();
  const knownGood = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.modal-backdrop button, .pause-nav-btn')]
      .find((x) => { const r = x.getBoundingClientRect(); return r.width > 4 && !!x.offsetParent && !x.disabled && !/resume|quit|close|back|exit/i.test((x.textContent || '').trim()); });
    if (!btn) return null;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return (btn.textContent || '').trim().slice(0, 24);
  }).catch(() => null);
  await page.waitForTimeout(350);
  out.knownGood = { button: knownGood, before: k0, after: await arrivals() };

  await page.screenshot({ path: path.join(OUT, 'f1-chip.png') });

  const chipReached = out.chipClick ? out.chipClick.after > out.chipClick.before : null;
  out.verdict = {
    hookOk: out.hook.ok,
    chipHasFactoryCue: out.chip.hasFactoryCue ?? null,
    chipCoveredInPlay: out.chip.covered ?? null,
    backdropsInPlay: out.chip.backdrops ?? null,
    deadSpaceSilent: out.deadSpace.after === out.deadSpace.before,
    knownGoodReached: out.knownGood.after > out.knownGood.before,
    CHIP_REACHED_SINK: chipReached,
    reading: chipReached === true
      ? 'FACTORY ALREADY CUED THE CHIP - my onclick tick was redundant, and "silent" was the backdrop'
      : chipReached === false
        ? 'chip genuinely escapes the factory cue - the fix was real'
        : 'inconclusive',
  };
  fs.writeFileSync(path.join(OUT, 'f1-chip-was-it-real.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1-CHIP', JSON.stringify(out.verdict));
  return out;
}
