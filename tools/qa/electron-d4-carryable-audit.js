// D4 — THE LIVE CARRYABLE AUDIT, WHICH THE SOURCE SCAN CANNOT DO.
//
// Gate invariant 6 reports PASS on the carryable system, and
// tests/carryable-system.test.js is four regular expressions over main.js. It
// confirms the guards exist in the source TEXT and never boots the game. That is
// worth pinning and it is not the claim D4 makes:
//
//   "Audit every carryable object -- the ledger, boxes, cartons, anything else --
//    and give them all the same rules: one pick-up verb, one put-down verb, no
//    tool switching while carrying, nothing left floating... Report the full
//    list of carryables and confirm each obeys."
//
// `carriedThing()` (main.js:357) names three families: 'carton', 'ledger' and
// 'goods'. This driver exercises the LEDGER end to end against all four rules,
// and reports the other two as UNREACHED rather than counting them as passing —
// because an audit that silently covers one third of its subject is how invariant
// 6 came to read as covering all of it.
//
// THE NEGATIVE CONTROL for each rule is the same measurement taken while NOT
// carrying: the tool belt must work when hands are empty, and the book must NOT
// track the player when it is on the desk. A rule that reads the same carrying
// and not carrying is not measuring carrying.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-d4-carryable-audit.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d4-carryable-audit');
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
  await page.waitForTimeout(5000);

  // The one shared reading: what is carried, where the book is, where the player
  // is, and what tool is held. Everything below is a difference of these.
  const probe = () => page.evaluate(() => {
    const fw = window.__fw;
    const s3 = fw?.scene3d;
    const ch = s3?.clubhouse?.();
    let bookPos = null;
    try {
      let lp = ch.ledgerBook.position;
      if (typeof lp === 'function') lp = ch.ledgerBook.position();
      bookPos = { x: +lp.x.toFixed(2), y: +(lp.y ?? 0).toFixed(2), z: +lp.z.toFixed(2) };
    } catch { bookPos = null; }
    const st = s3?.walk?.state;
    return {
      carried: (() => {
        try { return ch?.ledgerBook?.isCarried?.() ? 'ledger' : (fw?.state?.shop?.carry ? 'goods' : null); }
        catch { return 'threw'; }
      })(),
      bookPos,
      player: st ? { x: +st.x.toFixed(2), z: +st.z.toFixed(2) } : null,
      tool: s3?.walk?.getTool?.() ?? null,
      prompt: String(s3?.walk?.getFocusLabel?.() || '').slice(0, 90),
    };
  }).catch((e) => ({ threw: String(e && e.message) }));

  // Stand at the book, derived and focus-confirmed.
  out.stand = await page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const walk = fw.scene3d.walk;
    const st = walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.3;
    st.z = book.z + (to.z / len) * 1.3;
    const base = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    for (const dp of [-0.3, -0.15, 0]) {
      for (let k = 0; k < 10; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        st.pitch = dp;
        await sleep(100);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/ledger|read/i.test(label)) return { hit: true, label: label.slice(0, 90) };
      }
    }
    return { hit: false, label: String(walk.getFocusLabel?.() || '').slice(0, 90) };
  });

  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  const beltKey = keys.toolBelt || 'f';

  // Try the belt and report whether the held tool CHANGED. Used twice: once
  // empty-handed (must change) and once carrying (must not).
  const tryBelt = async () => {
    const before = (await probe()).tool;
    await page.keyboard.down(beltKey);
    await page.waitForTimeout(400);
    // VISIBLE, NOT MERELY PRESENT.
    //
    // The first cut asked `querySelector('.tool-wheel')` and counted its items,
    // and reported `wheelOpen: true` while carrying — which I published as "the
    // wheel still opens with full hands", a D3 defect.
    //
    // It is not one. `showToolWheel` guards correctly: `if (carried) { toast(...);
    // return; }` before `toolWheel.show()`. What my check found was the element
    // left in the DOM by the EMPTY-HANDED test that runs first in this driver —
    // hidden, but still present and still holding its items. Existence is not
    // visibility, and asking the wrong one manufactured a defect out of a
    // correct guard.
    //
    // Now reads computed style and offsetParent, and reports both so the two
    // cases stay distinguishable.
    const wheelOpen = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      if (!el) return { present: false, visible: false };
      const cs = getComputedStyle(el);
      return {
        present: true,
        items: el.querySelectorAll('.tool-wheel-item').length,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden'
          && Number(cs.opacity) > 0.01 && !!el.offsetParent,
      };
    }).catch(() => ({ present: false, visible: false }));
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await page.keyboard.up(beltKey);
    await page.waitForTimeout(900);
    const after = (await probe()).tool;
    return { before, after, changed: before !== after, wheelOpen };
  };

  out.emptyHanded = await probe();
  // CONTROL: the belt must work when the hands are empty, or "the belt is
  // blocked while carrying" proves nothing about carrying.
  out.beltWhenEmpty = await tryBelt();

  // Put the tool away again so the carry test starts from the same place.
  await page.keyboard.down(beltKey);
  await page.waitForTimeout(350);
  await page.keyboard.press('b');
  await page.waitForTimeout(200);
  await page.keyboard.up(beltKey);
  await page.waitForTimeout(800);

  // D2 / the pick-up verb: X at the book.
  await page.keyboard.press('x');
  await page.waitForTimeout(1200);
  out.afterPickUp = await probe();

  // D3: the belt must NOT work now.
  out.beltWhenCarrying = await tryBelt();

  // D1: walk away and see whether the book comes too.
  const beforeWalk = await probe();
  await page.keyboard.down('s');
  await page.waitForTimeout(1600);
  await page.keyboard.up('s');
  await page.waitForTimeout(700);
  const afterWalk = await probe();
  const moved = (a, b) => (a && b ? +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) : null);
  out.walk = {
    playerMoved: moved(beforeWalk.player, afterWalk.player),
    bookMoved: moved(beforeWalk.bookPos, afterWalk.bookPos),
    carriedThroughout: beforeWalk.carried === 'ledger' && afterWalk.carried === 'ledger',
  };

  // D2: the put-down verb, and the book must not be left in the air.
  //
  // THE VERB IS Z, NOT A SECOND X. The first cut pressed X again on the
  // assumption that pick-up and put-down toggle, reported `putDown: false`, and
  // that reading would have gone into the record as "there is still no way to
  // put the book down" — D2's exact complaint, apparently confirmed, by a driver
  // pressing the wrong key.
  //
  // main.js states it in the player's own prompt: `${k('setDown', 'Z')} set
  // down`, and `case 'setDown'` is the handler. Read from the bindings here so a
  // rebind cannot make this wrong again.
  const setDownKey = keys.setDown || 'z';
  out.setDownKey = setDownKey;
  await page.keyboard.press(setDownKey);
  await page.waitForTimeout(1400);
  out.afterPutDown = await probe();

  out.verdict = {
    focused: out.stand?.hit ?? null,
    families: ['carton', 'ledger', 'goods'],
    exercised: ['ledger'],
    unreached: ['carton', 'goods'],
    // D2 pick-up and put-down, on the same verb.
    pickedUp: out.afterPickUp?.carried === 'ledger',
    putDown: out.afterPutDown?.carried === null,
    setDownKey: out.setDownKey ?? null,
    // D1 again, at the moment it matters most: after setting down, the book must
    // be somewhere, not nowhere. A null position here would be a thing put down
    // into the void.
    bookPosAfterPutDown: out.afterPutDown?.bookPos ?? null,
    // D3, with its control.
    beltWorksEmptyHanded: out.beltWhenEmpty?.changed === true,
    beltBlockedWhileCarrying: out.beltWhenCarrying?.changed === false,
    wheelVisibleWhenEmpty: out.beltWhenEmpty?.wheelOpen?.visible ?? null,
    wheelVisibleWhileCarrying: out.beltWhenCarrying?.wheelOpen?.visible ?? null,
    wheelDetailCarrying: out.beltWhenCarrying?.wheelOpen ?? null,
    // D1: the book must travel with the player, not stay behind.
    playerMovedYd: out.walk?.playerMoved ?? null,
    bookMovedYd: out.walk?.bookMoved ?? null,
    bookFollowed: (out.walk?.playerMoved ?? 0) > 0.5
      && (out.walk?.bookMoved ?? 0) > (out.walk?.playerMoved ?? 0) * 0.5,
  };
  fs.writeFileSync(path.join(OUT, 'd4-carryable-audit.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('D4-AUDIT', JSON.stringify(out.verdict));
  return out;
}
