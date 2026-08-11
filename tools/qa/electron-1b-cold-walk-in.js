// 1B (Goal 22) — WALK IN COLD. The only question in Section 1.
//
// Fresh profile, real keyboard, no teleports, no concessions: boot, walk to the
// clubhouse, get through the front door. Two strangers have failed this for a
// combined 45 minutes.
//
// Every previous front-door check moved the player by writing walk.state.x/z,
// which walks THROUGH walls and through the collision that may be the actual
// defect. This one holds W. If the player cannot arrive, that IS the finding —
// it is what voided the Goal 21 door driver, where the player never reached the
// door and E pulled weeds instead.
//
// Three questions, each asked the way the player asks it:
//
//   1. Does the game TELL me what to do? Not "does the card exist" — X3 proved
//      a card can exist, report visible, and sit behind the canvas. Ask
//      elementFromPoint at the card's own centre: is the card the thing the
//      player's eye lands on there?
//   2. Walking in, what can my crosshair NAME, second by second?
//   3. At the door, does E open it, and can I then get inside?
//
//   node tools/qa/run-electron.cjs tools/qa/electron-1b-cold-walk-in.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/1b-cold-walk');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // --- 1. IS THE PLAYER TOLD ANYTHING? --------------------------------------
  const guidance = await page.evaluate(() => {
    const card = document.querySelector('.objectives-card');
    if (!card) return { exists: false };
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    // THE QUESTION THAT MATTERS: at the card's own centre, what does the player
    // actually see? A card behind the canvas answers `canvas` here and reports
    // perfectly visible to every other question.
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    return {
      exists: true,
      display: cs.display,
      opacity: cs.opacity,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: (card.innerText || '').trim().slice(0, 300),
      hitTag: hit ? hit.tagName.toLowerCase() : null,
      hitInsideCard: !!(hit && card.contains(hit)),
      painted: !!(hit && card.contains(hit)),
    };
  });

  const sample = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    const w = app.scene3d.walk.state;
    return {
      x: +w.x.toFixed(2), z: +w.z.toFixed(2), yaw: +w.yaw.toFixed(2),
      inside: !!ch?.isInside?.(w.x, w.z),
      focus: app.scene3d.walk.getFocusLabel?.() || '',
    };
  });

  const start = await sample();

  // --- 2. WALK. Real keys, one second at a time. ----------------------------
  const trail = [];
  let doorSeenAt = null;
  for (let step = 0; step < 22; step += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
    await page.waitForTimeout(200);
    const s = await sample();
    s.step = step;
    trail.push(s);
    if (!doorSeenAt && /door/i.test(s.focus)) {
      doorSeenAt = step;
      await page.screenshot({ path: path.join(OUT, `door-in-view-step${step}.png`) });
    }
    if (s.inside) break;
    // stop walking once we are hard against something and the door is named
    if (step > 3) {
      const prev = trail[trail.length - 2];
      const moved = Math.hypot(s.x - prev.x, s.z - prev.z);
      if (moved < 0.05 && doorSeenAt !== null) break;
    }
  }
  const atDoor = await sample();
  await page.screenshot({ path: path.join(OUT, 'at-door.png') });

  // --- 3. PRESS E, THE WAY A PLAYER DOES ------------------------------------
  const before = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    const d = ch?.doors?.diagnostics?.() || null;
    return { doors: d, focus: app.scene3d.walk.getFocusLabel?.() || '' };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, 'after-E.png') });
  const afterE = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    const toasts = [...document.querySelectorAll('.toast, .toasts *, .hud-toast')]
      .map((n) => (n.innerText || '').trim()).filter(Boolean).slice(0, 6);
    return {
      doors: ch?.doors?.diagnostics?.() || null,
      focus: app.scene3d.walk.getFocusLabel?.() || '',
      toasts,
    };
  });

  // --- 4. NOW TRY TO GET IN -------------------------------------------------
  const pushIn = [];
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(800);
    await page.keyboard.up('w');
    await page.waitForTimeout(150);
    const s = await sample();
    pushIn.push(s);
    if (s.inside) break;
  }
  const final = await sample();
  await page.screenshot({ path: path.join(OUT, 'final.png') });

  const out = {
    guidance, start, trail, doorSeenAt, atDoor, before, afterE, pushIn, final, errs,
    checks: {
      guidanceCardPainted: guidance.painted === true,
      guidanceHasText: (guidance.text || '').length > 10,
      playerActuallyMoved: Math.hypot(final.x - start.x, final.z - start.z) > 3,
      doorWasNameable: doorSeenAt !== null,
      // the whole point
      gotInside: final.inside === true,
      noPageErrors: errs.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'cold-walk.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
