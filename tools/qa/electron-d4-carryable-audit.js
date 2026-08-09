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
      // Does CARRYING the book put the app in ledger mode? If so, ledgerKeyHandler
      // runs on every keydown and is the first suspect for eating setDown.
      ledgerOpen: !!fw?.ledgerOpen,
      walkActiveView: fw?.view ?? null,
      courseMode: fw?.courseMode ?? null,
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
  // THE LIVE BINDING TABLE, dumped rather than inferred.
  //
  // Three wrong explanations of D2 in a row came from reading source instead of
  // the running game -- including one that declared the setDown binding absent
  // because a grep for "setDown:" could not match . This asks the
  // game what it actually holds, and what it thinks the z key means.
  out.liveBindings = keys;
  out.zMapsTo = Object.entries(keys).filter(([, v]) => String(v).toLowerCase() === 'z').map(([k]) => k);
  out.setDownBinding = keys.setDown ?? 'ABSENT FROM LIVE BINDINGS';

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

  // D2, FIRST HALF: set down WITHOUT moving, still facing the desk it came from.
  //
  // The earlier run pressed the set-down key only after walking 3.3 yd into open
  // floor and reported that the book stayed carried. That is two hypotheses at
  // once — "there is no put-down" and "the put-down needs a surface" — and they
  // want different fixes. Trying it here, where a surface is certainly in view,
  // separates them: if it works at the desk and not in the open, the verb exists
  // and its precondition is the finding.
  const setDownKeyEarly = keys.setDown || 'z';
  await page.keyboard.press(setDownKeyEarly);
  await page.waitForTimeout(1300);
  out.setDownAtDesk = await probe();
  // Pick it back up so the walk-away half starts carrying again. If the desk
  // set-down failed, this press is a no-op and the state is unchanged, which the
  // probe below records either way.
  if (out.setDownAtDesk?.carried !== 'ledger') {
    await page.keyboard.press('x');
    await page.waitForTimeout(1200);
  }
  out.reCarried = await probe();

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

  // OBSERVE THE KEYDOWN ITSELF. The setDown case calls e.preventDefault() as its
  // second statement, so defaultPrevented at a LATE listener says whether the arm
  // ran -- no source access, no patching of game code, just watching the event.
  //
  //   reached=true, defaultPrevented=true   -> the case ran; the fault is inside it
  //   reached=true, defaultPrevented=false  -> the case never ran
  //   reached=false                         -> something consumed it before us
  await page.evaluate(() => {
    window.__zTrace = [];
    window.addEventListener('keydown', (e) => {
      if (String(e.key).toLowerCase() !== 'z') return;
      // THE RAW KEY, which is what boundAction is handed.
      //
      // This trace lowercased e.key before comparing, so it has never actually
      // shown what the event carries — and `actionForKey(bindings, e.key)` gets
      // it raw. If the event says 'Z' and the table says 'z', the lookup misses
      // and every downstream symptom follows: no setDown action, no ledger
      // branch, putDownCarried never entered, book still carried.
      window.__zTrace.push({
        phase: 'capture', rawKey: e.key, code: e.code, defaultPrevented: e.defaultPrevented,
      });
    }, true);
    window.addEventListener('keydown', (e) => {
      if (String(e.key).toLowerCase() !== 'z') return;
      window.__zTrace.push({ phase: 'bubble', defaultPrevented: e.defaultPrevented });
    }, false);
  });
  await page.keyboard.press('z');
  await page.waitForTimeout(900);
  out.zTrace = await page.evaluate(() => window.__zTrace).catch(() => null);
  out.carriedAfterTracedZ = (await probe()).carried;
  // THE LAST LINK, MEASURED. What did the predicate see?
  // THE LAST LINK, MEASURED. What did the predicate see at the moment z ran?
  out.carryDiag = await page.evaluate(
    () => (window.__fwCarryDiag ? window.__fwCarryDiag() : 'no accessor'),
  ).catch((e) => ({ threw: String(e && e.message) }));

  // D2, THE DECIDING TEST. Call `placeAt` directly, exactly as putDownCarried
  // does, and watch `isCarried`.
  //
  // The keypress route is proven as far as the binding: the live table maps z to
  // setDown. What is unproven is whether the handler runs and `placeAt` fails to
  // clear the carried state, or the handler never runs at all. Calling `placeAt`
  // with the same arguments separates them without another inference:
  //
  //   isCarried goes false  -> placeAt works, so the handler never ran
  //   isCarried stays true  -> placeAt is the defect
  //
  // This is the one question left, and it is answered by doing rather than by
  // reading — which is what the last three wrong explanations of this item all
  // failed to do.
  out.placeAtDirect = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const walk = fw?.scene3d?.walk;
    const book = ch?.ledgerBook;
    if (!book || !walk || !ch) return { ran: false, why: 'missing book/walk/clubhouse' };
    const before = !!book.isCarried?.();
    if (typeof book.placeAt !== 'function') return { ran: false, before, why: 'placeAt is not a function' };
    const off = ch.interior.position;
    try {
      book.placeAt({
        x: walk.x - Math.sin(walk.yaw) * 0.52 - off.x,
        z: walk.z - Math.cos(walk.yaw) * 0.52 - off.z,
        ry: walk.yaw,
      });
    } catch (e) { return { ran: false, before, threw: String(e && e.message) }; }
    return { ran: true, before, after: !!book.isCarried?.() };
  }).catch((e) => ({ ran: false, threw: String(e && e.message) }));

  out.verdict = {
    focused: out.stand?.hit ?? null,
    // Leads with the deciding test.
    placeAtRan: out.placeAtDirect?.ran ?? null,
    carriedBeforePlaceAt: out.placeAtDirect?.before ?? null,
    carriedAfterPlaceAt: out.placeAtDirect?.after ?? null,
    placeAtClearsCarried: out.placeAtDirect?.ran === true
      && out.placeAtDirect?.before === true && out.placeAtDirect?.after === false,
    families: ['carton', 'ledger', 'goods'],
    exercised: ['ledger'],
    unreached: ['carton', 'goods'],
    // D2 pick-up and put-down, on the same verb.
    pickedUp: out.afterPickUp?.carried === 'ledger',
    putDownAtDesk: out.setDownAtDesk?.carried === null,
    reCarriedForWalk: out.reCarried?.carried === 'ledger',
    putDownInOpenFloor: out.afterPutDown?.carried === null,
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
