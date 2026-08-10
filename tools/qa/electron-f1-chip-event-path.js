// F1 — WHERE DOES A CLICK ON THE HUD CHIP DIE?
//
// Established by measurement, not assumption:
//   - in play, a real page.mouse.click at the chip's centre reaches nothing
//   - the chip is elementFromPoint-topmost, pointer-events:auto, uncovered
//   - pointer lock is NOT active, so my first explanation was wrong
//   - on the pause menu a real mouse click on a button DOES reach the sink,
//     so page.mouse.click works fine in this harness
//
// The remaining candidates are all about the journey rather than the target:
// something upstream is swallowing the press in play, or the press is not being
// delivered to the DOM at all. This run watches the whole path instead of
// guessing which one it is - document capture, the chip's own listeners, and
// the bubble phase, each recording defaultPrevented and propagation.
//
// WHY IT MATTERS BEYOND THE SOUND. The chip's own title reads "Click or Space:
// pause / resume". If a real click on it does nothing while walking, the defect
// is not a missing tick - it is a control that does not work, and the tick I
// added to its onclick would be sitting behind a handler that never runs.
//
// CONTROL: the same instrumented click on the CASH chip's neighbourhood and on
// bare canvas, so "no listener fired" is distinguishable from "no event arrived".
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-chip-event-path.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-chip-event-path');
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

  out.setup = await page.evaluate(() => {
    window.__f1p = [];
    const rec = (where) => (e) => {
      window.__f1p.push({
        where,
        type: e.type,
        target: `${e.target?.tagName || '?'}.${String(e.target?.className || '').slice(0, 28)}`,
        prevented: e.defaultPrevented,
        x: Math.round(e.clientX ?? -1),
        y: Math.round(e.clientY ?? -1),
      });
    };
    // The full journey: capture at the top, the chip itself, and the bubble end.
    for (const t of ['pointerdown', 'mousedown', 'click']) {
      document.addEventListener(t, rec(`doc-capture:${t}`), true);
      window.addEventListener(t, rec(`win-bubble:${t}`), false);
    }
    const chip = document.querySelector('.hud-clock');
    if (chip) for (const t of ['pointerdown', 'mousedown', 'click']) chip.addEventListener(t, rec(`chip:${t}`), false);
    return { chipFound: !!chip };
  }).catch((e) => ({ chipFound: false, threw: String(e && e.message) }));

  const drain = () => page.evaluate(() => { const v = window.__f1p.slice(); window.__f1p.length = 0; return v; }).catch(() => []);

  const box = await page.evaluate(() => {
    const c = document.querySelector('.hud-clock');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });

  // Does the chip's own state change? That is the real question - sound is
  // downstream of the handler running at all.
  const speed = () => page.evaluate(() => window.__fw?.speedIdx ?? null).catch(() => null);

  await drain();
  out.beforeSpeed = await speed();
  if (box) await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(600);
  out.chipEvents = await drain();
  out.afterSpeed = await speed();

  // CONTROL: bare canvas well away from any chip. If THIS records doc-capture
  // events and the chip did not, the press is being delivered and something is
  // eating it at the chip. If neither records, no event is arriving at all.
  await drain();
  await page.mouse.click(900, 900);
  await page.waitForTimeout(500);
  out.canvasEvents = await drain();

  await page.screenshot({ path: path.join(OUT, 'f1-chip-path.png') });

  const chipSaw = (p) => out.chipEvents.some((e) => e.where === p);
  out.verdict = {
    chipFound: out.setup.chipFound,
    // did anything at all arrive for the chip click?
    eventsOnChipClick: out.chipEvents.length,
    docCaptureSawPointerdown: chipSaw('doc-capture:pointerdown'),
    chipHandlerSawPointerdown: chipSaw('chip:pointerdown'),
    chipHandlerSawClick: chipSaw('chip:click'),
    reachedWindowBubble: out.chipEvents.some((e) => e.where.startsWith('win-bubble')),
    anyPrevented: out.chipEvents.some((e) => e.prevented),
    // the outcome the player would notice
    speedBefore: out.beforeSpeed,
    speedAfter: out.afterSpeed,
    CHIP_ACTUALLY_WORKED: out.beforeSpeed !== out.afterSpeed,
    // control
    eventsOnCanvasClick: out.canvasEvents.length,
  };
  fs.writeFileSync(path.join(OUT, 'f1-chip-event-path.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1-PATH', JSON.stringify(out.verdict));
  return out;
}
