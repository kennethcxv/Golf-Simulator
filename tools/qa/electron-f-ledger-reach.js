// VERIFIER 2, FINDING 4 — CAN A PLAYER ACTUALLY REACH THE LEDGER?
//
// A verifier spent forty minutes and never opened the book. The crosshair was
// on the cover and the prompt said "Front desk". The cause: stations were
// selected by a rule of their own — first match in registration order, gated
// only on a hundred-degree facing cone — so the desk, registered eight thousand
// lines earlier, always won, and the book's focusBias and aimY were dead code
// on that path.
//
// This aims at the book the way a player does and then presses the keys, which
// also gives F3 and F4 the real-play verification the verifier could not reach:
//
//   1. with a station in reach, LOOKING AT THE BOOK names the book
//   2. looking back at the desk still names the desk (the fix must not steal it)
//   3. E opens it
//   4. D does NOT turn the page   (F4)
//   5. E DOES turn the page       (F4)
//   6. Q closes it                (F3)
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f-ledger-reach.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f-ledger-reach');
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

  // Inside, business open, standing at the counter — the exact situation the
  // verifier was in. Recorded as a concession: a fresh save cannot pass the
  // restoration-locked doors.
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x + 1.4; w.z = o.z + 1.2; w.yaw = Math.PI; w.pitch = -0.1;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    ch.setOrganicWalkins?.(true);
  });
  await page.waitForTimeout(1200);

  // Walk to within reach of the book, then AIM at it. Aiming is computed from
  // the book's own world matrix (matrixWorld, not a THREE import) and written
  // as yaw/pitch, which is what a mouse produces — the thing under test is the
  // SCORING, not the hand that moved the mouse.
  const aim = async (target) => page.evaluate((which) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const cam = app.scene3d.camera || app.scene3d.walk.camera;
    const e = ch.ledgerBook.root.matrixWorld.elements;
    const book = { x: e[12], y: e[13], z: e[14] };
    // stand a comfortable read away from the book, on the staff side
    if (which === 'approach') {
      w.x = book.x + 0.15;
      w.z = book.z + 1.15;
      return { moved: true, book };
    }
    const camY = cam ? cam.position.y : w.y + 1.6;
    const to = which === 'book'
      ? { x: book.x - w.x, y: book.y - camY, z: book.z - w.z }
      : { x: 0, y: -0.05, z: -1 }; // level, away from the book
    const len = Math.hypot(to.x, to.y, to.z) || 1;
    const d = { x: to.x / len, y: to.y / len, z: to.z / len };
    w.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    w.yaw = Math.atan2(-d.x, -d.z);
    return { yaw: w.yaw, pitch: w.pitch, book };
  }, target);

  const read = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const el = document.querySelector('.walk-prompt, .prompt, #prompt');
    return {
      label: app.scene3d.walk.getFocusLabel ? (app.scene3d.walk.getFocusLabel() || '') : (el?.textContent || ''),
      ledgerOpen: !!app.ledgerOpen,
      bookIsOpen: !!ch.ledgerBook.isOpen(),
      inHand: !!ch.ledgerBook.isInHand?.(),
      spread: ch.ledgerBook.diagnostics?.()?.spread ?? null,
      page: ch.ledgerBook.diagnostics?.()?.pageIndex
        ?? ch.ledgerBook.diagnostics?.()?.page ?? null,
    };
  });

  const out = { steps: {}, errs };
  const shoot = async (name) => {
    const s = await read();
    out.steps[name] = s;
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    return s;
  };

  await aim('approach');
  await page.waitForTimeout(1500);

  await aim('book');
  await page.waitForTimeout(1500);
  const atBook = await shoot('01-aimed-at-book');

  await aim('away');
  await page.waitForTimeout(1500);
  const atDesk = await shoot('02-aimed-away');

  await aim('book');
  await page.waitForTimeout(1500);
  await shoot('03-back-on-book');

  // E raises the shut book, E again opens it (the authored two-stage gesture)
  await page.keyboard.press('e');
  await page.waitForTimeout(1200);
  await shoot('04-after-first-e');
  await page.keyboard.press('e');
  await page.waitForTimeout(1600);
  const opened = await shoot('05-open');

  // F4: D must do nothing in the book
  const beforeD = await read();
  await page.keyboard.press('d');
  await page.waitForTimeout(900);
  const afterD = await shoot('06-after-d');

  // F4: E must turn forward
  await page.keyboard.press('e');
  await page.waitForTimeout(1100);
  const afterE = await shoot('07-after-e');

  // F3: Q must put it away
  await page.keyboard.press('q');
  await page.waitForTimeout(1600);
  const afterQ = await shoot('08-after-q');

  const namesLedger = (s) => /ledger|club register/i.test(s.label || '');
  out.checks = {
    lookingAtBookNamesTheBook: namesLedger(atBook),
    lookingAwayDoesNotNameTheBook: !namesLedger(atDesk),
    eOpensTheBook: opened.bookIsOpen === true && opened.ledgerOpen === true,
    dDoesNotTurnThePage: JSON.stringify(afterD.spread) === JSON.stringify(beforeD.spread),
    eTurnsThePage: JSON.stringify(afterE.spread) !== JSON.stringify(beforeD.spread),
    qClosesTheBook: afterQ.ledgerOpen === false,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'ledger-reach.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
