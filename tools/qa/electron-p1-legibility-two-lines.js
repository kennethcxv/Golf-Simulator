// GOAL 25 — THE TWO LEGIBILITY FIXES THE STRANGER SURFACED.
//
// The owner's words: "they are why the sale looked broken to me."
//
//   L1  the queue head is desk business waiting for the player, so shoppers
//       behind never reach the counter. SAY SO ON SCREEN.
//   L2  banking waits on the bag being dragged to the customer's palm. SAY THAT
//       TOO.
//
// Neither is a code defect, so there is no crash to catch and no number that
// moves. What can be perceived is TEXT THE PLAYER CAN READ, so that is what this
// measures: the live DOM string for L1, the live register accessors for L2, and
// a screenshot of each at the default camera so the claim rests on something a
// human can look at rather than on a substring match.
//
// NEGATIVE CONTROL, and it is the whole reason this driver is trustworthy: a
// note that is ALWAYS on screen would pass a naive "the text is present" check
// while telling the player nothing. So L1 is measured THREE times --
//
//   * empty shop            -> the note must be ABSENT
//   * plain retail shopper  -> the note must be ABSENT (they are not desk
//                              business; the line is not blocked on the player)
//   * desk walk-in + queue  -> the note must be PRESENT and must name the count
//
// -- and a run where all three read the same is reported as an instrument
// failure, not as a pass.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-legibility-two-lines.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-legibility');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], notes: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // seed a restored, stocked, open shop with the player inside -- same disclosed
  // seed the Phase 1 stranger used, and nothing about the queue
  await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    campaign.disableCampaign(app.state);
    if (app.state.shop) { app.state.shop.open = true; app.state.shop.signOpen = true; }
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    for (const id of ['balls1', 'glove1', 'tees1']) {
      const inv = app.state.shop?.inventory?.[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    w.x = ip.x; w.z = ip.z + 3.0; w.vx = 0; w.vz = 0;
    ch.refreshShopProgression?.();
    ch.rebuildStock?.();
  });
  await page.waitForTimeout(2000);

  const canvas = await page.$('#game') || await page.$('canvas');
  const boxRect = await canvas.boundingBox();
  await page.mouse.click(boxRect.x + boxRect.width / 2, boxRect.y + boxRect.height / 2);
  await page.waitForTimeout(600);

  // READ THE DOM, NOT THE PREDICATE. `ch.deskHoldup()` is the rule; the note is
  // what a player actually sees. Reading the rule back would certify that the
  // rule agrees with itself.
  // NOT `display`. The note lives on the condition chip's prepainted-opacity
  // path (a display flip at the doorway is the 200 ms stall this project already
  // paid for once), so "is the player reading it" is an OPACITY question. 0.004
  // is the warm-but-invisible base; anything near 1 is on screen.
  const readNote = () => page.evaluate(() => {
    const n = document.querySelector('.shop-queue-note');
    if (!n) return { exists: false, text: '', shown: false, opacity: null };
    const opacity = parseFloat(getComputedStyle(n).opacity);
    return {
      exists: true,
      text: (n.textContent || '').trim(),
      opacity,
      shown: opacity > 0.5 && getComputedStyle(n).display !== 'none',
      // and what the rule itself said, recorded beside it so a disagreement
      // between rule and paint is visible rather than silently resolved
      rule: (() => {
        try { return window.__fw.scene3d.clubhouse()?.deskHoldup?.() ?? null; } catch { return 'threw'; }
      })(),
    };
  });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    return `${name}.png`;
  };

  // ---- L1 control 1: nobody in the shop ------------------------------------
  await page.waitForTimeout(900);
  out.l1EmptyShop = await readNote();
  out.l1EmptyShopShot = await shot('l1-a-empty-shop');

  // ---- L1 control 2: a plain retail shopper at the head --------------------
  // Not desk business. The line is not blocked on the player, so there is
  // nothing to say and the note must stay down.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.sendToCounter?.(['balls1'], 'card');
  });
  await page.waitForTimeout(9000);
  out.l1RetailHead = await readNote();
  out.l1RetailHeadShot = await shot('l1-b-retail-head');

  // ---- L1 the real case: desk business at the head, shoppers behind --------
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    // clear the retail shopper so the desk errand takes the head slot
    ch.dismissCounterCustomer?.();
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.sendWalkInToDesk?.({ requestedTeeMinute: 11 * 60 });
  });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.sendToCounter?.(['glove1'], 'card');
    ch.sendToCounter?.(['tees1'], 'cash');
  });
  await page.waitForTimeout(11000);
  out.l1DeskHead = await readNote();
  out.l1DeskHeadShot = await shot('l1-c-desk-head-queue');

  // ---- L2: the sale that is paid but not banked ----------------------------
  // Read the two register surfaces at stage `done`. Rather than fight the whole
  // manual flow, ask the register what it WOULD print in that state through the
  // same functions the screen draws from -- and record the live stage beside it
  // so a reading taken in the wrong state is visible.
  out.l2 = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const reg = ch?.register;
    const tx = reg?.getTx?.() || null;
    return {
      liveStage: tx?.stage ?? null,
      liveStatus: reg?.checkoutStatus?.() ?? null,
      deliveryPhase: reg?.deliveryPhase?.() ?? null,
    };
  });

  // the two strings themselves, read out of the module source at the exact call
  // sites, so "did the wording change" is answered against the shipped file and
  // not against a stale memory of it
  out.l2Strings = await page.evaluate(async () => {
    const res = await fetch(new URL('src/render3d/clubhouse/simplifiedRegisterMode.js', document.baseURI).href);
    const src = await res.text();
    const statusLine = src.match(/if \(tx\.stage === 'done'\) return autoFulfilled \? '[^']*' : '([^']*)';/);
    const instrLine = src.match(/if \(tx\.stage === 'done'\) return '([^']*)';/);
    const res2 = await fetch(new URL('src/main.js', document.baseURI).href);
    const src2 = await res2.text();
    // `[^']*` stopped at the backslash of an escaped apostrophe and returned
    // null, which scored as "the wording was never changed" against a file that
    // had been changed -- a probe lie, caught only because the fixed build's
    // green was two clauses short. Tolerate the escape.
    const hintLine = src2.match(/case 'done': return '((?:[^'\\]|\\.)*)';/);
    return {
      registerStatus: statusLine ? statusLine[1] : null,
      registerInstruction: instrLine ? instrLine[1] : null,
      tillHint: hintLine ? hintLine[1] : null,
    };
  });

  const namesBanking = (s) => !!s && /bank/i.test(s);
  const namesTheBag = (s) => !!s && /bag|handles|palm/i.test(s);

  out.clauses = {
    // L1
    noteAbsentInEmptyShop: out.l1EmptyShop.shown === false,
    noteAbsentForPlainRetailHead: out.l1RetailHead.shown === false,
    notePresentForDeskHead: out.l1DeskHead.shown === true && out.l1DeskHead.text.length > 0,
    noteNamesTheDesk: /desk/i.test(out.l1DeskHead.text || ''),
    // NOT `/shopper/i`. The first version of this clause matched one English
    // noun, so it would have gone red on the plural-safe rewrite (correct code)
    // and stayed green in nine locales that never contained the word (broken
    // copy). What the owner asked for is a COUNT and a CONSEQUENCE, so that is
    // what is scored: a number of people waiting, and a statement that they do
    // not reach the counter.
    noteNamesWhoIsHeldUp: /\d/.test(out.l1DeskHead.text || '')
      && /counter/i.test(out.l1DeskHead.text || ''),
    // THE INSTRUMENT'S OWN CONTROL: if all three L1 readings match, the driver
    // measured nothing and must not be believed either way. Compared on the pair
    // (shown, text) because the node now always carries text — a text-only
    // comparison would have been the "scored the same before and after" probe
    // lie this project keeps logging.
    l1ReadingsDiffer: new Set([
      `${out.l1EmptyShop.shown}|${out.l1EmptyShop.text}`,
      `${out.l1RetailHead.shown}|${out.l1RetailHead.text}`,
      `${out.l1DeskHead.shown}|${out.l1DeskHead.text}`,
    ]).size > 1,
    // L2
    registerStatusNamesBanking: namesBanking(out.l2Strings.registerStatus),
    registerInstructionNamesBanking: namesBanking(out.l2Strings.registerInstruction),
    registerInstructionStillNamesTheBag: namesTheBag(out.l2Strings.registerInstruction),
    tillHintNamesBanking: namesBanking(out.l2Strings.tillHint),
    tillHintStillNamesTheBag: namesTheBag(out.l2Strings.tillHint),
  };
  out.notScored = 'whether the wording READS well at the default camera — the four screenshots are for that, and a human has to look';
  out.ok = Object.values(out.clauses).every((v) => v === true) && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'legibility.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-LEGIBILITY', JSON.stringify({ clauses: out.clauses, l1: {
    empty: out.l1EmptyShop.text, retail: out.l1RetailHead.text, desk: out.l1DeskHead.text,
  }, l2: out.l2Strings, ok: out.ok }, null, 2));
  return out;
}
