// C2 (Goal 20) — DRIVE THE PHONE THE WAY THE PHONE SAYS IT IS DRIVEN.
//
// Verifier 2 disproved the voicemail claim: the row was there, the mouse
// reached it, and the phone's OWN input model — arrows and Enter — could not.
// ArrowDown never moved off Back and Enter left the app. My checks passed
// because they tested the sim verbs and asserted the wiring; nobody pressed the
// keys.
//
// So this presses the keys. Real keyboard, through the real window, no mouse
// touched after the phone is open.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c2-phone-keyboard.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c2-phone-keys');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // A missed call with a voicemail, planted the way the roller makes them and
  // then allowed to ring out on the real tick. Recorded as a concession: the
  // organic wait is minutes of game time and this is about the KEYS.
  await page.evaluate(() => {
    const app = window.__fw;
    const book = app.state.reservations;
    book.requests = Array.isArray(book.requests) ? book.requests : [];
    const now = Math.floor(app.state.clock.minutes);
    book.nextRequestId = (book.nextRequestId || 1) + 1;
    book.requests.push({
      id: `req_keys_${book.nextRequestId}`,
      channel: 'phone',
      holder: 'Dana Whitfield',
      partySize: 2,
      dayAbs: Math.floor(now / 1440) + 1,
      minute: 9 * 60,
      createdAtAbs: now,
      expiresAtAbs: now - 1, // already rung out
      status: 'pending',
    });
  });
  // let the tick settle it into a missed call with a voicemail
  await page.waitForFunction(() => {
    const calls = window.__fw?.state?.phone?.calls || [];
    return calls.some((c) => c.outcome === 'missed' && c.voicemail);
  }, null, { timeout: 60000 });

  const snap = () => page.evaluate(() => {
    const dock = document.querySelector('.phone-dock');
    const buttons = [...document.querySelectorAll('.phone-body button')];
    const focused = buttons.findIndex((b) => b.classList.contains('focus'));
    const call = (window.__fw.state.phone.calls || []).find((c) => c.voicemail);
    return {
      open: !!dock && getComputedStyle(dock).display !== 'none',
      buttons: buttons.map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46)),
      focusedIndex: focused,
      focusedText: focused >= 0 ? (buttons[focused].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46) : null,
      // The Back button precedes the list in DOM order, so "is the focus on a
      // row" is a question about WHERE the focused button lives, not its index.
      // The first version of this driver asserted index 0 and reported a
      // failure the game did not have.
      focusedInList: focused >= 0 ? !!buttons[focused].closest('.phone-list') : false,
      rowCount: document.querySelectorAll('.phone-list button').length,
      played: !!call?.voicemailPlayed,
      calledBack: !!call?.calledBack,
    };
  });

  const out = { steps: {}, errs };
  const press = async (key, label) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(420);
    const s = await snap();
    out.steps[label] = s;
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    return s;
  };

  await press('t', 'open-phone');
  await press('Enter', 'enter-calls-app'); // the Phone app is the first tile
  const inApp = out.steps['enter-calls-app'];
  out.steps.rowsPresent = inApp.rowCount > 0;

  // THE FIX UNDER TEST: the focus must start on a ROW, and Down must move.
  const first = await snap();
  out.steps.focusStartsOnARow = first.focusedInList === true && first.rowCount > 0;
  const afterDown = await press('ArrowDown', 'arrow-down');
  out.steps.arrowMovesFocus = afterDown.focusedIndex !== first.focusedIndex;
  await press('ArrowUp', 'arrow-up-back-to-first');

  const afterPlay = await press('Enter', 'enter-plays-voicemail');
  out.steps.enterPlaysMessage = afterPlay.played === true && afterPlay.open === true;

  const afterCallBack = await press('Enter', 'enter-rings-back');
  out.steps.enterRingsBack = afterCallBack.calledBack === true;

  out.checks = {
    phoneOpens: out.steps['open-phone'].open === true,
    rowsPresent: out.steps.rowsPresent === true,
    focusStartsOnARow: out.steps.focusStartsOnARow === true,
    arrowMovesFocus: out.steps.arrowMovesFocus === true,
    enterPlaysMessage: out.steps.enterPlaysMessage === true,
    enterRingsBack: out.steps.enterRingsBack === true,
    stayedInTheApp: afterPlay.open === true && afterPlay.rowCount > 0,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'phone-keys.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
