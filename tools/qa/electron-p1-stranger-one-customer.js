// PHASE 1 ADVERSARIAL REVIEW (Goal 25) — CAN A STRANGER SERVE ONE CUSTOMER?
//
// One question, and the phase gate depends on the answer:
//
//   products, a specific tee time or check-in, ONE payment, the bag, out the door
//
// WHAT MAKES THIS DIFFERENT FROM THE DRIVER THAT ALREADY PASSES.
// `electron-b-checkout-unsticks.js` reports 29/29 green on this build, including
// the return-to-checkout transition and the goods-only refused ticket. It also:
//
//   * calls `ch.sendToCounter([...])` to conjure a customer with a scripted cart
//   * sets `state.shop.open`, `campaign.businessOpen` and the clock directly
//   * teleports the player to REGISTER.stand
//   * clicks products by projecting their world position to a screen point
//
// Every one of those is a QA shortcut, and the owner — who has none of them —
// still reports that the card never arrives. So this driver is allowed NONE of
// them. It uses the menu, the mouse, WASD, E, and whatever the screen says.
// Internal reads are permitted ONLY as instrumentation (where am I, is the
// pointer locked, did a ticket bank) and never to make something happen.
//
// It is written to STOP AT THE FIRST WALL and say exactly where, because that
// wall is the next item. Reaching step 4 of 9 is a useful result; pretending to
// reach 9 is not.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-stranger-one-customer.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-stranger');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], beats: [], wall: null };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  let stepNo = 0;
  const shot = async (name) => {
    stepNo += 1;
    const file = `${String(stepNo).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 48)}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    return file;
  };

  // What is on screen, in words. The stranger decides from this and nothing else.
  const readScreen = () => page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const grab = (sel) => [...new Set([...document.querySelectorAll(sel)].filter(visible)
      .map((n) => (n.innerText || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 220))
      .filter(Boolean))];
    return {
      pointerLocked: !!document.pointerLockElement,
      prompt: grab('.shop-prompt'),
      hud: grab('.hud-min .hud-chip, .hud-context'),
      toasts: grab('.notification-center .notification, .toast'),
      regHint: grab('.reg-hint'),
      hintBar: grab('.hint-bar'),
      // WHAT IS THE GAME TELLING ME TO DO? The first run never recorded this,
      // so when the stranger failed to open the shop there was no way to tell
      // "the game never said" from "the game said and the driver did not look".
      objectives: grab('.objectives-card, .objectives-panel, .objective, .task-card'),
      firstUse: grab('.first-use, .firstuse-card, .tip-card'),
      veil: grab('.load-veil-place, .load-veil-tip'),
      buttons: [...document.querySelectorAll('button')].filter(visible)
        .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
        .filter(Boolean).slice(0, 24),
    };
  });

  // Instrumentation only — never used to cause anything.
  const probe = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app?.scene3d?.clubhouse?.() || null;
    const w = app?.scene3d?.walk?.state || null;
    const tx = ch?.register?.getTx?.() || null;
    return {
      minutes: app?.state?.clock?.minutes ?? null,
      pos: w ? { x: +w.x.toFixed(2), z: +w.z.toFixed(2) } : null,
      inside: ch && w ? !!ch.isInside(w.x, w.z, 0.35) : null,
      shopOpen: !!app?.state?.shop?.open,
      registerActive: !!ch?.register?.isActive?.(),
      txItems: tx ? tx.items.length : 0,
      txStage: tx?.stage ?? null,
      banked: (app?.state?.shop?.transactionHistory || []).length,
      customers: ch?.customerCount?.() ?? null,
    };
  });

  const beat = async (name, extra = {}) => {
    const [screen, inst] = [await readScreen(), await probe()];
    const file = await shot(name);
    const row = { step: stepNo, name, file, screen, inst, ...extra };
    out.beats.push(row);
    console.log(`P1 ${String(stepNo).padStart(2, '0')} ${name} :: prompt=${JSON.stringify(screen.prompt)} banked=${inst.banked} tx=${inst.txItems}/${inst.txStage}`);
    return row;
  };
  // THE FIRST WALL IS THE ONE THAT MATTERS. The first version overwrote
  // `out.wall` at every failure, so a run that died in the menu reported
  // "payment" -- the last thing it tried, not the thing that stopped it. Every
  // wall is kept, and `out.wall` is pinned to the first.
  out.walls = [];
  const wall = (where, why, detail = {}) => {
    const row = { step: stepNo, where, why, ...detail };
    out.walls.push(row);
    if (!out.wall) out.wall = row;
    console.log(`P1 WALL at ${where}: ${why}`);
    return row;
  };

  // ---- 1. the menu, driven like a person ----------------------------------
  await page.waitForFunction(() => document.querySelectorAll('button').length > 0, null, { timeout: 120000 });
  await beat('title screen');
  const clickByText = async (re, { timeout = 8000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const handles = await page.$$('button');
      for (const h of handles) {
        const label = ((await h.textContent()) || '').trim();
        if (!re.test(label)) continue;
        const box = await h.boundingBox().catch(() => null);
        if (!box) continue;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return label;
      }
      await page.waitForTimeout(250);
    }
    return null;
  };
  const newGame = await clickByText(/new game|start|play/i);
  if (!newGame) { wall('menu', 'no button matching New Game/Start/Play'); }
  await page.waitForTimeout(1200);
  await beat('after new game');

  // THE DIFFICULTY CARDS ARE NOT BUTTONS, and the first run of this driver
  // proved it the expensive way: `clickByText` only queries <button>, so it
  // never picked a card, the game never started, and fourteen beats later the
  // driver reported "clicked forty times on the register and no ticket ever
  // banked". Every screenshot was the same NEW GAME dialog. That is the exact
  // FOUND_FALSE shape -- a probe that cannot see the thing reports the same as
  // a thing that did not happen -- and it would have been written up as a
  // payment bug. `.difficulty-card` is the selector stranger-session.js has
  // used since Goal 20.
  const cardLoc = page.locator('.difficulty-card');
  const cardCount = await cardLoc.count().catch(() => 0);
  if (cardCount > 0) {
    let idx = 0;
    for (let i = 0; i < cardCount; i += 1) {
      const label = await cardLoc.nth(i).innerText().catch(() => '');
      if (/recommended|default/i.test(label)) { idx = i; break; }
    }
    await cardLoc.nth(idx).click();
    await page.waitForTimeout(600);
  }
  const confirm = await clickByText(/^(start|confirm|yes|begin|play)/i, { timeout: 4000 });
  await beat('picked a difficulty and confirmed', { cardCount, confirm });
  // CONTROL: if the dialog is still up, everything after this is meaningless.
  const dialogGone = await page.locator('.difficulty-card').count().catch(() => 0) === 0;
  if (!dialogGone) wall('difficulty dialog', 'the New Game dialog is still on screen after picking a card and confirming');

  // ---- 2. into the world ---------------------------------------------------
  const arrived = await page.waitForFunction(
    () => window.__fw?.scene3d?.walk?.isActive?.(),
    null, { timeout: 300000 },
  ).then(() => true).catch(() => false);
  if (!arrived) wall('load', 'the walk state never became active');
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await beat('spawned');

  // real pointer lock, the way the hint says
  const canvasBox = await (await page.$('#game') || await page.$('canvas'))?.boundingBox();
  const cx = canvasBox ? canvasBox.x + canvasBox.width / 2 : 700;
  const cy = canvasBox ? canvasBox.y + canvasBox.height / 2 : 400;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(800);
  const locked = (await readScreen()).pointerLocked;
  await beat('clicked to look', { locked });
  if (!locked) wall('pointer lock', 'clicking the canvas did not lock the pointer');

  // ---- 3. find the way in --------------------------------------------------
  // Walk forward in real legs, reading the prompt each leg, and press E on
  // anything that offers. No teleporting.
  const walk = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(200);
  };
  const look = async (dx) => { await page.mouse.move(cx + dx, cy, { steps: 6 }); await page.waitForTimeout(200); };

  let insideNow = (await probe()).inside;
  for (let leg = 0; leg < 14 && !insideNow; leg += 1) {
    const s = await readScreen();
    const p = (s.prompt[0] || '').toLowerCase();
    if (/door|entrance|enter|open/.test(p)) {
      await page.keyboard.press('e');
      await page.waitForTimeout(1200);
      await beat(`pressed E on "${(s.prompt[0] || '').slice(0, 40)}"`);
    }
    await walk('w', 900);
    insideNow = (await probe()).inside;
    if (leg % 4 === 3) await look(90);
  }
  await beat('after trying to get inside', { insideNow });
  if (!insideNow) wall('entrance', 'walked fourteen legs and never got inside the clubhouse');

  // ---- 3b. THE ONE DISCLOSED SEED, AND WHY IT EXISTS ----------------------
  //
  // Run with P1_OPEN_SHOP=1 this driver seeds the world to "restored, stocked,
  // sign open" and records that it did. Nothing about the CUSTOMER or the
  // TRANSACTION is seeded: no sendToCounter, no scripted cart, no teleport to
  // the till, no forced checkout phase. Every click and key from here is real.
  //
  // It exists because a brand-new game gates customers behind the whole
  // restoration campaign — install the display shelves, repair the structure,
  // open three cartons, restock six retail groups, clear every route, and only
  // then may the shop open. That is the game working as designed, and it is an
  // hour of play. Without this seed the stranger tests the restoration tutorial;
  // with it, the stranger tests the checkout, which is the thing the owner
  // reports broken. Both runs are reported separately and neither is called the
  // other.
  out.seeded = false;
  if (process.env.P1_OPEN_SHOP === '1') {
    out.seeded = await page.evaluate(async () => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      // The MINIMAL seed, deliberately: the same four facts the existing
      // acceptance driver sets, and nothing more. `disableCampaign()` was the
      // first choice and is worse here -- it restores authored fixtures behind
      // the renderer's back, and a fixture restored in state but not rebuilt in
      // the scene is a shop that is open in the sim and empty on screen.
      if (app.state.shop) app.state.shop.open = true;
      if (app.state.campaign) app.state.campaign.businessOpen = true;
      if (app.state.shop) app.state.shop.signOpen = true;
      for (const id of ['balls1', 'glove1', 'tees1']) {
        const inv = app.state.shop?.inventory?.[id];
        if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
      }
      ch.rebuildStock?.();
      ch.setOrganicWalkins?.(true);
      // mid-morning, inside trading hours, so walk-ins are allowed at all
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
      return true;
    });
    await page.waitForTimeout(1500);
    await beat('seeded a restored, stocked, open shop (disclosed)');
  }

  // ---- 4. open the shop for business --------------------------------------
  // A stranger opens the shop the way the world offers it: find the sign and
  // press E. This is a real interaction, not a state write.
  // LOOK AROUND WHERE YOU ARE STANDING, THEN MOVE. The first version turned a
  // little and walked forward every third turn, so it marched steadily AWAY
  // from the door — and the OPEN/CLOSED card hangs on the jamb of the door it
  // had just come through. It searched twelve times and never faced the one
  // wall the sign is on. A person entering a shop turns on the spot first.
  //
  // So: a full circle in twelve 30-degree steps without moving the feet,
  // reading the prompt at every step; only then one step forward and another
  // circle. Five stations, sixty looks.
  let shopOpen = (await probe()).shopOpen;
  const sweepFor = async (re, label) => {
    for (let station = 0; station < 5; station += 1) {
      for (let turn = 0; turn < 12; turn += 1) {
        const s = await readScreen();
        const p = (s.prompt[0] || '').toLowerCase();
        if (re.test(p)) {
          await page.keyboard.press('e');
          await page.waitForTimeout(1200);
          await beat(`pressed E on "${(s.prompt[0] || '').slice(0, 44)}"`);
          return true;
        }
        await look(110); // ~30 degrees per step at the shipped sensitivity
      }
      await walk('w', 650);
    }
    console.log(`P1 sweep found nothing for ${label}`);
    return false;
  };
  if (!shopOpen) {
    await sweepFor(/sign|open|closed|business|come in|back soon/, 'the OPEN/CLOSED sign');
    shopOpen = (await probe()).shopOpen;
  }
  await beat('after trying to open the shop', { shopOpen });
  if (!shopOpen) wall('the sign', 'never found a prompt that opened the shop for business');

  // ---- 5. wait for a customer to arrive on their own ----------------------
  const gotCustomer = await page.waitForFunction(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    const tx = ch?.register?.getTx?.();
    return (tx && tx.items.length > 0) || (ch?.customerCount?.() ?? 0) > 0;
  }, null, { timeout: 180000 }).then(() => true).catch(() => false);
  await beat('waited for a customer', { gotCustomer });
  if (!gotCustomer) wall('no customer', 'three minutes of open shop and nobody came in');

  // ---- 6. get to the counter and take the sale ----------------------------
  const reachedTill = await page.waitForFunction(() => {
    const tx = window.__fw?.scene3d?.clubhouse?.()?.register?.getTx?.();
    return !!tx && tx.items.length > 0;
  }, null, { timeout: 240000 }).then(() => true).catch(() => false);
  await beat('customer put goods on the counter', { reachedTill });
  if (!reachedTill) wall('no goods', 'a customer exists but never placed goods on the counter');

  // walk toward the counter until the prompt names it, then E
  let atRegister = (await probe()).registerActive;
  if (!atRegister) {
    await sweepFor(/register|till|counter|serve|checkout|desk/, 'the register');
    atRegister = (await probe()).registerActive;
  }
  await beat('at the register', { atRegister });
  if (!atRegister) wall('the till', 'never found a prompt that opened the register');

  // ---- 7. ring up every product with real clicks --------------------------
  // The stranger clicks what it can see. It does NOT project world positions;
  // it sweeps the lower half of the screen where goods sit on the counter.
  const itemsAtStart = (await probe()).txItems;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = await probe();
    if (before.txStage && before.txStage !== 'scanning') break;
    for (let gx = 0.3; gx <= 0.72; gx += 0.07) {
      for (let gy = 0.52; gy <= 0.78; gy += 0.07) {
        const st = await probe();
        if (st.txStage && st.txStage !== 'scanning') break;
        await page.mouse.click(
          (canvasBox ? canvasBox.x : 0) + (canvasBox ? canvasBox.width : 1400) * gx,
          (canvasBox ? canvasBox.y : 0) + (canvasBox ? canvasBox.height : 800) * gy,
        );
        await page.waitForTimeout(500);
      }
    }
  }
  const afterScan = await beat('clicked around the counter to ring goods up', { itemsAtStart });
  const scannedOk = afterScan.inst.txStage !== 'scanning' || afterScan.inst.txItems === 0;

  // ---- 8. answer whatever the customer asks, then pay ---------------------
  // Read the screen: if a tee time is outstanding the instruction says so.
  await page.waitForTimeout(1500);
  const asked = await beat('what does the screen say now');
  const wantsTee = JSON.stringify(asked.screen).toLowerCase().includes('tee time');

  // Try to finish the sale using only what is drawn: click the middle of the
  // screen repeatedly (card/terminal/keypad all live there) for up to 40 beats,
  // stopping as soon as a ticket banks.
  const bankedBefore = (await probe()).banked;
  let banked = false;
  for (let i = 0; i < 40 && !banked; i += 1) {
    await page.mouse.click(
      (canvasBox ? canvasBox.x : 0) + (canvasBox ? canvasBox.width : 1400) * (0.42 + (i % 5) * 0.06),
      (canvasBox ? canvasBox.y : 0) + (canvasBox ? canvasBox.height : 800) * (0.42 + (i % 4) * 0.07),
    );
    await page.waitForTimeout(700);
    banked = (await probe()).banked > bankedBefore;
  }
  await beat('tried to complete the payment', { wantsTee, banked });
  if (!banked) wall('payment', 'clicked forty times on the register and no ticket ever banked');

  // ---- 9. the customer leaves ---------------------------------------------
  const left = await page.waitForFunction(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    return !ch?.register?.isActive?.() || !ch?.register?.getTx?.();
  }, null, { timeout: 90000 }).then(() => true).catch(() => false);
  await beat('after the sale', { left });

  const inst = await probe();
  out.result = {
    mode: out.seeded ? 'checkout-gate (shop seeded open, transaction all real input)'
      : 'fresh-start (nothing seeded)',
    reachedTheWall: out.wall ? out.wall.where : null,
    banked: inst.banked,
    wantsTee,
    steps: stepNo,
  };
  out.checks = {
    gotInside: out.beats.some((b) => b.inst.inside === true),
    openedTheShop: out.beats.some((b) => b.inst.shopOpen === true),
    aCustomerCame: out.beats.some((b) => (b.inst.customers ?? 0) > 0 || b.inst.txItems > 0),
    goodsOnTheCounter: out.beats.some((b) => b.inst.txItems > 0),
    tookTheSale: out.beats.some((b) => b.inst.registerActive === true),
    ringUpFinished: scannedOk,
    oneTicketBanked: inst.banked === bankedBefore + 1,
    customerLeft: left === true,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = !out.wall && Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'stranger.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-STRANGER', JSON.stringify({
    result: out.result, checks: out.checks, firstWall: out.wall, allWalls: out.walls,
  }, null, 2));
  return out;
}
