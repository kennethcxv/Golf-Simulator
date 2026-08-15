// VERIFIER 3 — THE STRANGER. Plays the first ~20 minutes knowing only that this
// is a first-person golf-shop restoration game. Menu is driven the way a person
// would (no qa-boot clickThroughMenu). Every beat: screenshot to
// qa/electron/stranger/step-NN.png + a read of the visible on-screen text.
// Gameplay decisions come ONLY from what the screen says; internal reads are
// limited to instrumentation (game clock, yaw/pitch/position, pointer lock).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/stranger');
  fs.mkdirSync(OUT, { recursive: true });

  const log = [];
  const meta = { lookMode: null, notes: [] };
  let stepNo = 0;
  const t0 = Date.now();

  // ---------- reading the screen -------------------------------------------
  const readScreen = () => page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const grab = (sel) => [...document.querySelectorAll(sel)].filter(visible)
      .map((n) => (n.innerText || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 400))
      .filter(Boolean);
    const grabRaw = (sel) => [...document.querySelectorAll(sel)]
      .map((n) => (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 400))
      .filter(Boolean);
    const uniq = (a) => [...new Set(a)];
    let gameMinutes = null;
    try { const m = window.__fw && window.__fw.state && window.__fw.state.clock && window.__fw.state.clock.minutes; if (Number.isFinite(m)) gameMinutes = m; } catch (_) { /* stranger has no watch */ }
    return {
      gameMinutes,
      pointerLocked: !!document.pointerLockElement,
      hud: uniq(grab('.hud-min .hud-chip, .hud-context')),
      prompt: uniq(grab('.shop-prompt')),
      promptRaw: uniq(grabRaw('.shop-prompt')),
      cond: uniq(grab('.shop-cond')),
      lockHint: uniq(grab('.shop-lockhint')),
      dirtReticle: uniq(grabRaw('.dirt-reticle')),
      dirtSense: uniq(grabRaw('.dirt-sense-hint')),
      inventory: uniq(grab('.property-inventory')),
      regHint: uniq(grab('.reg-hint')),
      toasts: uniq(grab('.notification-center .notification, .toast')),
      objectives: uniq(grab('.objectives-card, .objectives-panel, .objective')),
      wheel: uniq(grab('.tool-wheel-title, .tool-wheel-selected, .tool-wheel-detail, .tool-wheel-help, .tool-wheel-ring [role="option"]')),
      hintBar: uniq(grab('.hint-bar')),
      pause: uniq(grab('.pause-status, .pause-overview, .pause-hint')).slice(0, 6),
      laptopOpen: (() => { try { return !!(window.__fw && window.__fw.laptopOpen); } catch (_) { return null; } })(),
      buttons: [...document.querySelectorAll('button')].filter(visible)
        .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)).filter(Boolean).slice(0, 40),
      bigText: uniq(grab('.difficulty-card, .menu-title, .menu-subtitle, h1, h2')).slice(0, 12),
    };
  });

  const step = async (action, detail) => {
    stepNo += 1;
    const nn = String(stepNo).padStart(2, '0');
    try { await page.screenshot({ path: path.join(OUT, `step-${nn}.png`) }); } catch (_) { /* keep playing */ }
    let screen = null;
    try { screen = await readScreen(); } catch (error) { screen = { error: String(error).slice(0, 200) }; }
    const entry = { step: stepNo, png: `step-${nn}.png`, realSec: Math.round((Date.now() - t0) / 1000), action, detail: detail || null, screen };
    log.push(entry);
    try { fs.writeFileSync(path.join(OUT, 'stranger-log.json'), `${JSON.stringify({ meta, log }, null, 2)}\n`); } catch (_) { /* non-fatal */ }
    return screen;
  };

  // ---------- instrumentation (mechanics only, not decisions) ---------------
  const pose = () => page.evaluate(() => {
    try {
      const w = window.__fw.scene3d.walk;
      return { x: +w.state.x.toFixed(3), z: +w.state.z.toFixed(3), yaw: +w.state.yaw.toFixed(4), pitch: +w.state.pitch.toFixed(4) };
    } catch (_) { return null; }
  }).catch(() => null);

  const wrapPi = (a) => { let v = a; while (v > Math.PI) v -= 2 * Math.PI; while (v < -Math.PI) v += 2 * Math.PI; return v; };

  // Camera: synthetic mousemove events with movementX/Y (Playwright absolute
  // moves cancel out under pointer lock). Fallback: direct yaw/pitch writes.
  const sendLook = (dx, dy) => page.evaluate(([mx, my]) => {
    const chunks = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 50));
    for (let i = 0; i < chunks; i += 1) {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: mx / chunks, movementY: my / chunks, bubbles: true }));
    }
  }, [dx, dy]).catch(() => {});

  let pxPerRadYaw = 0;
  const calibrateLook = async () => {
    const before = await pose();
    if (!before) { meta.lookMode = 'none'; return; }
    await sendLook(240, 0);
    await page.waitForTimeout(160);
    const after = await pose();
    const moved = after ? wrapPi(after.yaw - before.yaw) : 0;
    if (Math.abs(moved) > 0.01) {
      meta.lookMode = 'synthetic-mousemove';
      pxPerRadYaw = 240 / moved;
    } else {
      meta.lookMode = 'state-write-fallback';
      meta.notes.push('Synthetic mouse look did not turn the camera; using direct yaw/pitch writes (harness limitation, not a game finding).');
    }
  };

  const turnToYaw = async (target) => {
    for (let i = 0; i < 10; i += 1) {
      const cur = await pose();
      if (!cur) return;
      const err = wrapPi(target - cur.yaw);
      if (Math.abs(err) < 0.05) return;
      if (meta.lookMode === 'synthetic-mousemove') {
        const px = Math.max(-420, Math.min(420, err * pxPerRadYaw));
        await sendLook(px, 0);
        await page.waitForTimeout(90);
      } else {
        await page.evaluate((y) => { window.__fw.scene3d.walk.state.yaw = y; }, target).catch(() => {});
        return;
      }
    }
  };

  const pitchTo = async (target) => {
    if (meta.lookMode === 'synthetic-mousemove') {
      for (let i = 0; i < 8; i += 1) {
        const cur = await pose();
        if (!cur) return;
        const err = target - cur.pitch;
        if (Math.abs(err) < 0.04) return;
        const px = Math.max(-300, Math.min(300, err * Math.abs(pxPerRadYaw)));
        await sendLook(0, px);
        await page.waitForTimeout(80);
        const now = await pose();
        if (now && Math.abs(now.pitch - cur.pitch) < 0.005) {
          // vertical axis may be inverted relative to yaw calibration
          await sendLook(0, -2 * px);
          await page.waitForTimeout(80);
        }
      }
    } else {
      await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, target).catch(() => {});
    }
  };

  const promptNow = async () => {
    const s = await readScreen().catch(() => null);
    if (!s) return '';
    return (s.prompt[0] || s.promptRaw[0] || '').trim();
  };

  const walkFor = async (key, ms) => {
    const before = await pose();
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    const after = await pose();
    const moved = before && after ? +Math.hypot(after.x - before.x, after.z - before.z).toFixed(2) : null;
    return { movedYd: moved };
  };

  // Turn on the spot and note every prompt the crosshair offers.
  const scanOffers = async (spokes) => {
    const offers = [];
    const start = await pose();
    const base = start ? start.yaw : 0;
    const n = spokes || 12;
    for (let k = 0; k < n; k += 1) {
      const yaw = wrapPi(base + (k / n) * Math.PI * 2);
      await turnToYaw(yaw);
      await page.waitForTimeout(240);
      const p = await promptNow();
      if (p) offers.push({ yaw: +yaw.toFixed(3), prompt: p });
    }
    return offers;
  };

  const approach = async (yaw, maxLegs) => {
    await turnToYaw(yaw);
    const legs = [];
    for (let i = 0; i < (maxLegs || 6); i += 1) {
      const r = await walkFor('w', 700);
      const p = await promptNow();
      legs.push({ movedYd: r.movedYd, prompt: p });
      if (p) break;
      if (r.movedYd !== null && r.movedYd < 0.25) {
        await walkFor(i % 2 ? 'a' : 'd', 450); // bumped into something — sidestep
      }
    }
    return legs;
  };

  const clickButton = (rxSource) => page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const b = [...document.querySelectorAll('button, [role="button"]')].filter(visible)
      .find((n) => rx.test((n.textContent || '').trim()));
    if (!b) return null;
    b.click();
    return (b.textContent || '').trim().slice(0, 70);
  }, rxSource).catch(() => null);

  const relock = async () => {
    const s = await readScreen().catch(() => null);
    if (s && s.pointerLocked) return;
    await page.mouse.click(800, 500);
    await page.waitForTimeout(400);
  };

  // ======================== THE SESSION ====================================
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(2500);

    // -- 1: the very first screen
    await step('title screen: read everything before touching anything');

    // -- 2: click the obvious start ("New game")
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((c) => /new game/i.test(c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 120000 });
    await page.getByRole('button', { name: /New game/i }).click();
    await page.waitForTimeout(900);
    const diffScreen = await step('clicked "New game" — what comes next');

    // -- 3: pick a difficulty like a person: recommended if marked, else first
    const cards = (diffScreen && diffScreen.bigText) || [];
    let pick = cards.find((c) => /recommended|default/i.test(c)) || null;
    const pickText = pick || cards[0] || '';
    const cardLoc = page.locator('.difficulty-card');
    const count = await cardLoc.count().catch(() => 0);
    if (count > 0) {
      let idx = 0;
      for (let i = 0; i < count; i += 1) {
        const t = await cardLoc.nth(i).innerText().catch(() => '');
        if (/recommended|default/i.test(t)) { idx = i; break; }
      }
      await cardLoc.nth(idx).click();
    }
    await page.waitForTimeout(500);
    const confirm = page.getByRole('button', { name: /^(Start|Confirm|Yes|Begin|Play)/i }).first();
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click();
    await step('picked a difficulty card and confirmed', { cardsSeen: cards, picked: pickText.slice(0, 120) });

    // -- 4: staring at the load
    await page.waitForTimeout(3000);
    await step('three seconds into loading — what am I told while I wait');
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      const veilGone = !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
      let walking = false;
      try { walking = !!(window.__fw && window.__fw.scene3d && window.__fw.scene3d.walk && window.__fw.scene3d.walk.isActive()); } catch (_) { walking = false; }
      return veilGone && walking;
    }, null, { timeout: 300000 });
    await step('the world appeared — first frame');
    await page.waitForTimeout(3000);
    await step('settled at spawn: what is on screen unprompted');

    // -- 5: the hint says "Click to look" — do that
    await page.mouse.click(800, 500);
    await page.waitForTimeout(600);
    await step('clicked the world like the hint said — did the cursor lock');
    await calibrateLook();

    // -- 6: look all the way around; list everything that offers itself
    const offers1 = await scanOffers(12);
    await step('turned a full circle on the spot', { offersSeen: offers1 });

    // -- 7: walk toward whatever offered itself (a door, hopefully)
    let target = offers1.find((o) => /door|enter/i.test(o.prompt)) || offers1[0] || null;
    if (target) {
      const legs = await approach(target.yaw, 7);
      await step('walked toward the first thing that offered a prompt', { target, legs });
    } else {
      const legs = await approach(0, 5);
      await step('nothing offered a prompt; walked forward anyway', { legs });
    }

    // -- 8: press E on whatever the prompt names
    let p = await promptNow();
    await page.keyboard.press('e');
    await page.waitForTimeout(900);
    await step('pressed E on the prompt in front of me', { promptWas: p });

    // walk through in case that was a door
    await walkFor('w', 1000);
    await step('kept walking after E (through the doorway, if that was one)');

    // -- 9: inside — full look around + what the game says the goal is
    const offers2 = await scanOffers(12);
    await step('turned a full circle here', { offersSeen: offers2 });

    // -- 10: the hint bar names keys. Try F first ("tap/hold F tools").
    await page.keyboard.press('f');
    await page.waitForTimeout(700);
    const wheelScreen = await step('tapped F because the hint bar said "tap/hold F tools"');

    // -- 11: if a wheel opened, read it and equip the first real tool
    if (wheelScreen && wheelScreen.wheel && wheelScreen.wheel.length) {
      await page.keyboard.press('1');
      await page.waitForTimeout(400);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await step('pressed 1 then Enter in the tool wheel (its help line named numbers and Enter)');
      const still = await readScreen().catch(() => null);
      if (still && still.wheel && still.wheel.length) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        await step('wheel still open — pressed Esc to close it');
      }
    } else {
      await step('tapping F did not visibly open anything');
    }
    await relock();

    // -- 12: the dirt-sense hint (if shown): HOLD Q and watch
    await page.keyboard.down('q');
    await page.waitForTimeout(1300);
    await page.keyboard.up('q');
    await page.waitForTimeout(400);
    await step('held Q (the eye hint says "Q reveal dirt") — did anything change');

    // -- 13: aim at the floor and hold the left mouse button (tool attempt)
    await pitchTo(-0.55);
    await page.waitForTimeout(250);
    await page.mouse.down();
    await page.waitForTimeout(2000);
    await page.mouse.up();
    await step('aimed at the floor and held the left mouse button for two seconds');

    // -- 14: walk to a dirt patch if the reticle names one nearby
    const offersDirt = await scanOffers(8);
    await pitchTo(-0.35);
    await page.mouse.down();
    await page.waitForTimeout(2200);
    await page.mouse.up();
    await step('second cleaning attempt while slowly looking down-forward', { offersSeen: offersDirt });
    await pitchTo(-0.05);

    // -- 15: try X carry / Z set down on whatever the crosshair offers
    p = await promptNow();
    await page.keyboard.press('x');
    await page.waitForTimeout(700);
    await step('pressed X (hint bar says "X carry")', { promptWas: p });
    await walkFor('w', 600);
    await page.keyboard.press('z');
    await page.waitForTimeout(700);
    await step('walked a step and pressed Z ("Z set down")');

    // -- 16: hunt for the laptop / desk / register the shop must have
    let laptopFound = null;
    for (let round = 0; round < 3 && !laptopFound; round += 1) {
      const offers = await scanOffers(12);
      laptopFound = offers.find((o) => /laptop|computer|desk|register|till|counter/i.test(o.prompt)) || null;
      if (!laptopFound) {
        const any = offers[round % Math.max(1, offers.length)] || null;
        if (any) await approach(any.yaw, 3); else await walkFor('w', 900);
        await step(`no desk/laptop prompt yet — wandered (round ${round + 1})`, { offersSeen: offers });
      } else {
        await step('found a prompt that sounds like the shop desk', { offer: laptopFound });
      }
    }
    if (laptopFound) {
      await approach(laptopFound.yaw, 6);
      p = await promptNow();
      await page.keyboard.press('e');
      await page.waitForTimeout(1200);
      const lap = await step('pressed E on it', { promptWas: p });
      if (lap && (lap.laptopOpen || (lap.buttons && lap.buttons.length > 6))) {
        const b1 = await clickButton('shop|store|orders?|stock|market');
        await page.waitForTimeout(900);
        await step('inside a screen with buttons — clicked the most shop-sounding one', { clicked: b1 });
        const b2 = await clickButton('task|goal|objective|campaign|to.?do|plan');
        await page.waitForTimeout(900);
        await step('clicked the most goal-sounding button', { clicked: b2 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        const afterEsc = await step('pressed Esc to leave this screen');
        if (afterEsc && afterEsc.buttons && afterEsc.buttons.some((t) => /resume/i.test(t))) {
          await clickButton('resume');
          await page.waitForTimeout(600);
          await step('a pause menu had opened instead — clicked Resume');
        }
      }
    }
    await relock();

    // -- 17: give the world time; patrol and read every toast that arrives
    for (let slice = 0; slice < 5; slice += 1) {
      await page.waitForTimeout(50000);
      const s = await step(`patrol read ${slice + 1} — waiting to see if anyone or anything shows up`);
      const toastText = s && s.toasts ? s.toasts.join(' | ') : '';
      const wantsService = /customer|serve|till|register|checkout|queue|waiting|sale/i.test(toastText);
      const teeTime = /tee.?time|booking|reserved|golfer/i.test(toastText);
      if (teeTime) {
        const offers = await scanOffers(10);
        await step('a toast mentioned a tee time / booking — looked around for any way to act on it', { offersSeen: offers, toastText });
      }
      if (wantsService) {
        const offers = await scanOffers(12);
        const till = offers.find((o) => /serve|register|till|checkout|counter|customer/i.test(o.prompt)) || offers[0] || null;
        if (till) {
          await approach(till.yaw, 6);
          p = await promptNow();
          await page.keyboard.press('e');
          await page.waitForTimeout(1200);
          await step('a toast said someone needs serving — walked to the counter and pressed E', { promptWas: p, toastText });
          const reg = await readScreen().catch(() => null);
          if (reg && reg.regHint && reg.regHint.length) {
            await page.keyboard.press('t');
            await page.waitForTimeout(1200);
            await step('the register hint names T — pressed T ("total up")');
            await page.keyboard.press('d');
            await page.waitForTimeout(1200);
            await step('pressed D ("drawer")');
            await page.mouse.click(800, 520);
            await page.waitForTimeout(900);
            await step('clicked the thing in the middle of the counter (guessing)');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(800);
            await step('pressed Esc ("step back")');
            const maybePause = await readScreen().catch(() => null);
            if (maybePause && maybePause.buttons && maybePause.buttons.some((t) => /resume/i.test(t))) {
              await clickButton('resume');
              await page.waitForTimeout(500);
            }
            await relock();
          }
        }
        break;
      }
      // otherwise drift: quarter turn and a short walk, like a bored shopkeeper
      const cur = await pose();
      await turnToYaw(wrapPi((cur ? cur.yaw : 0) + Math.PI / 2));
      await walkFor('w', 700);
    }

    // -- 18: the hint bar's remaining keys: Tab overview, P pause
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    await step('pressed Tab (hint bar says "Tab overview")');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    await step('pressed Tab again to come back');
    await relock();

    await page.keyboard.press('p');
    await page.waitForTimeout(900);
    await step('pressed P (hint bar says "P pause")');
    const resumed = await clickButton('resume');
    await page.waitForTimeout(700);
    await step('clicked Resume', { clicked: resumed });
    await relock();

    // -- 19: last look: where am I, what is the game telling me to do next
    const finalOffers = await scanOffers(8);
    await step('final look around — what would I do next if the session continued', { offersSeen: finalOffers });
  } catch (error) {
    meta.notes.push(`Session ended early: ${String(error).slice(0, 300)}`);
    try { await step('SESSION ERROR — final state'); } catch (_) { /* nothing */ }
  }

  fs.writeFileSync(path.join(OUT, 'stranger-log.json'), `${JSON.stringify({ meta, log }, null, 2)}\n`);
  return { ok: true, steps: stepNo, lookMode: meta.lookMode, out: 'qa/electron/stranger' };
}
