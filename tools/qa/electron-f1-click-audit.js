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
  out.hook = await page.evaluate(() => {
    const a = window.__fw?.audio;
    if (!a) return { ok: false, why: 'no window.__fw.audio' };
    window.__f1 = { total: 0, byName: {} };
    const names = Object.keys(a).filter((k) => typeof a[k] === 'function');
    for (const n of names) {
      const orig = a[n].bind(a);
      a[n] = (...args) => {
        window.__f1.total += 1;
        window.__f1.byName[n] = (window.__f1.byName[n] || 0) + 1;
        return orig(...args);
      };
    }
    return { ok: true, wrapped: names.length, names: names.slice(0, 30) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));

  const ticks = () => page.evaluate(() => window.__f1?.total ?? -1).catch(() => -1);

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

  const seen = new Set();
  for (let round = 0; round < 14; round += 1) {
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
