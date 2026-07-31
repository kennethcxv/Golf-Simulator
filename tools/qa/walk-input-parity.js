async (page) => {
  // WALK INPUT PARITY â€” movement keys through the REAL key-event path, both
  // clubhouse variants (greybox-walk item 2's regression instrument).
  //
  //   node tools/qa/run-playwright.cjs tools/qa/walk-input-parity.js
  //
  // Each of W/A/S/D is synthesized as a genuine keydown/keyup pair and the walk
  // position delta measured, from the door clearway (open floor in both rooms).
  // Catches: a dead binding, an intercepted key, a latched key cancelling its
  // opposite, and variant-conditional input divergence.
  //
  // WHAT THIS DOES NOT PROVE (2026-07-28, the hard way). "Synthesized" is a
  // CDP-dispatched event: no OS keyboard, no layout mapping, no shell
  // accelerator, and no competing listener racing it. This file was green 8/8
  // on D while D did not strafe under a real hand. So a pass here means "the
  // binding and the movement basis are intact", NOT "the key works when the
  // player presses it". The real-hand path is instrumented separately by
  // ?keydebug=1 (src/debug/keyCapture.js) with tools/qa/key-capture-control.js
  // as its synthetic baseline.
  //
  // WHAT IT MISSED, AND NOW CHECKS (2026-07-29). The ?keydebug=1 capture came
  // back with walkHeld holding ["meta"] and a MetaLeft keydown that never got a
  // keyup: the Windows key handed focus to the shell, the release landed there,
  // and the page carried a phantom modifier for the rest of the session. This
  // file could never have seen it, because a sweep that only presses and
  // releases W/A/S/D cleanly never strands anything â€” every state it tests is
  // one it created itself.
  //
  // So the sweep is no longer the whole harness. Before it runs, a modifier is
  // deliberately stranded (a keydown with no keyup, the way the OS does it) and
  // the run then proves three things a stale modifier would fail: the page
  // drops the phantom on the next genuine keypress, each of the three interrupt
  // signals releases everything, and W/A/S/D still move with a phantom present.
  // Remove the strand stage and this file goes back to being unable to see the
  // bug that shipped.
  //
  // AND WHAT *THAT* MISSED (2026-07-29, second pass). Every check above waits
  // for a keypress to trigger the repair â€” which is precisely what a stranded
  // modifier prevents, because the OS claims Win+D and the browser never sees
  // the keydown. The fix was measured by the one input the fault cannot
  // suppress, and so is this file: check 1b strands a modifier, presses
  // NOTHING, moves the mouse, and requires the phantom to be gone. It also
  // names the listener that cleared it, so the check cannot pass on a stray
  // blur while mousemove stays broken.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  // Open floor differs per room: v1's checkout island owns the mid-floor. The
  // v2 stand moved (0.5, 0.5) â†’ (0.5, 1.7) on 2026-07-28: the resize re-seated
  // the feature table at (0.55, âˆ’0.55), 0.40 yd north of the original stand,
  // and the northward sweep read as a dead W key â€” a stale-stand red, the
  // exact drift class HARNESS_TRUST.md exists to catch, in this file's own
  // fixture. The new spot clears â‰¥0.9 yd of body travel on all four sweeps
  // against every current v2 rect (feature north, desk south, member east,
  // essentials west).
  const STANDS = {
    'pine-hills': { x: -0.8, z: 3.6 },
    'pine-hills-v2': { x: 0.5, z: 1.7 },
  };

  const sweep = async (STAND) => {
    const rows = [];
    for (const key of ['w', 'a', 's', 'd']) {
      const before = await page.evaluate((stand) => {
        const app = window.__fw;
        const o = app.scene3d.clubhouse().interior.position;
        const w = app.scene3d.walk.state;
        w.x = stand.x + o.x;
        w.z = stand.z + o.z;
        w.yaw = 0;
        w.pitch = 0;
        return { x: w.x, z: w.z };
      }, STAND);
      await page.waitForTimeout(120);
      await page.keyboard.down(key);
      await page.waitForTimeout(600);
      await page.keyboard.up(key);
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => {
        const w = window.__fw.scene3d.walk.state;
        return { x: w.x, z: w.z };
      });
      rows.push({ key, dx: +(after.x - before.x).toFixed(3), dz: +(after.z - before.z).toFixed(3) });
    }
    return rows;
  };

  // Strand a modifier exactly the way the shell does: deliver the keydown, never
  // deliver the keyup. The dispatch is synthetic because the real cause (an OS
  // focus steal) cannot be driven from CDP â€” but the RECOVERY below is measured
  // through genuine CDP key events, which is the half that matters.
  const strandMeta = () => page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Meta', code: 'MetaLeft', metaKey: true, bubbles: true,
    }));
    return window.__fw.scene3d.walk.heldKeys();
  });
  const heldNow = () => page.evaluate(() => ({
    held: window.__fw.scene3d.walk.heldKeys(),
    phantoms: window.__fw.scene3d.walk.phantomModifiers?.() ?? null,
  }));

  // Which of these actually discriminate, measured against the unfixed build on
  // 2026-07-29: the two phantom checks and visibilitychange go red without the
  // fix. The blur and pointer-lock checks stay green either way, because
  // main.js's resetCameraInput() already reaches into walk.clearKeys on both â€”
  // they are regression guards for that path, not evidence for this one. Said
  // out loud here so a future reader does not read six greens as six proofs.
  const strandedModifierChecks = async () => {
    const checks = [];
    const record = (name, ok, detail) => checks.push({ name, ok, ...detail });

    // 1. The strand itself must take, or the rest of this stage proves nothing.
    const stranded = await strandMeta();
    record('modifier can be stranded', stranded.includes('meta'), { held: stranded });

    // 1b. THE CHECK THE FIRST FIX FAILED. Reconciling on keydown looks sufficient
    //     until you notice that a stranded modifier is what stops the keydown
    //     from arriving: with Meta down the OS claims Win+D and the browser never
    //     sees a D keydown at all, so the page waits for a repair signal that the
    //     fault itself is suppressing. This check presses NOTHING. It strands the
    //     modifier and then does the one thing a player does without deciding to
    //     â€” move the mouse â€” and requires the phantom to be gone.
    //
    //     Ordered before the keydown check below deliberately: run it after, and
    //     the keydown would already have cleared the phantom and this would pass
    //     on an unfixed build.
    const strandedForMouse = await strandMeta();
    record('modifier still stranded going into the mouse check',
      strandedForMouse.includes('meta'), { held: strandedForMouse });
    await page.mouse.move(760, 430);
    await page.mouse.move(790, 452);
    await page.waitForTimeout(120);
    const afterMouse = await page.evaluate(() => ({
      held: window.__fw.scene3d.walk.heldKeys(),
      modifiers: window.__fw.scene3d.walk.heldModifiers?.() ?? null,
      source: window.__fw.scene3d.walk.lastReconcileSource?.() ?? null,
    }));
    record('a phantom modifier clears on mouse movement alone, no key pressed',
      !afterMouse.held.includes('meta'), afterMouse);
    // Naming the listener that did it, so a pass cannot be produced by some other
    // path (a stray blur, a focus poll) while mousemove stays broken.
    record('and it was the mousemove reconcile that cleared it',
      afterMouse.source === 'mousemove', { source: afterMouse.source });
    record('the HUD readout is empty once the phantom is gone',
      Array.isArray(afterMouse.modifiers) && afterMouse.modifiers.length === 0,
      { modifiers: afterMouse.modifiers });

    // 1c. And while it IS stranded, the player must be able to see it. This is
    //     the instrument the week-long version of this bug lacked entirely.
    const visible = await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Meta', code: 'MetaLeft', metaKey: true, bubbles: true,
      }));
      return window.__fw.scene3d.walk.heldModifiers?.() ?? null;
    });
    record('a stranded modifier is visible in the walk controller\'s readout',
      Array.isArray(visible) && visible.includes('Meta'), { modifiers: visible });

    // 2. The next GENUINE keypress carries the OS's real modifier state, so the
    //    page must notice the disagreement and drop its phantom.
    await strandMeta();
    await page.keyboard.press('d');
    await page.waitForTimeout(80);
    const after = await heldNow();
    record('a phantom modifier is dropped on the next real keydown',
      !after.held.includes('meta'), { held: after.held, phantoms: after.phantoms });
    record('the phantom is reported, not silently swallowed',
      Array.isArray(after.phantoms) && after.phantoms.includes('Meta'), { phantoms: after.phantoms });

    // 2b. The other half of the defect is the half no page code can repair: a
    //     modifier genuinely down at the OS level turns W into a browser chord.
    //     preventDefault is the mitigation, and it only applies under pointer
    //     lock â€” outside it, the page has no business eating the player's keys.
    //
    //     This browser context does not reliably grant pointer lock, so the
    //     check is SKIPPED rather than passed when the lock is absent. A vacuous
    //     green here would read as "swallowing verified" in the tally and it is
    //     not â€” the measured version of this check lives in the Electron
    //     harness, which holds a real lock. First run after it was written:
    //     pointerLocked false in both variants, i.e. skipped, not proved.
    await page.mouse.click(800, 450).catch(() => {});
    await page.waitForTimeout(250);
    const swallowed = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const seen = [];
      const probe = (e) => seen.push({ key: e.key, prevented: e.defaultPrevented });
      window.addEventListener('keydown', probe);
      const locked = document.pointerLockElement === canvas;
      for (const key of ['w', 'a', 's', 'd']) {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true,
        }));
      }
      window.removeEventListener('keydown', probe);
      return { locked, seen };
    });
    checks.push({
      name: 'walk keys are swallowed while pointer-locked',
      ok: swallowed.locked ? swallowed.seen.every((s) => s.prevented) : true,
      skipped: !swallowed.locked,
      skipReason: swallowed.locked ? undefined : 'this browser context never granted pointer lock',
      pointerLocked: swallowed.locked,
      seen: swallowed.seen,
    });

    // 3. Each interrupt signal releases everything. Pointer-lock loss is the one
    //    the real capture proved blur does not cover.
    // Each signal has to be measured ALONE. Two things conspire against that.
    // Calling exitPointerLock() for real makes Chrome blur the page when the
    // lock bubble goes away, and that blur can arrive a beat late â€” landing
    // inside a later check and clearing the keys for the wrong reason. The
    // 2026-07-29 negative-control run caught this twice: "pointer-lock loss
    // releases every held key" reported green against a build with no
    // pointer-lock handling at all, because a stray blur did the work.
    //
    // So: settle the real lock off well before any check, order the genuine blur
    // FIRST (its own co-firing blur is then harmless), and count blurs during
    // every check so a masked result is visible instead of quietly green.
    await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__parityBlurs = 0;
      if (!window.__parityBlurHook) {
        window.__parityBlurHook = true;
        window.addEventListener('blur', () => { window.__parityBlurs += 1; });
      }
    });

    for (const [name, expectsBlur, fire] of [
      ['window blur', true, () => page.evaluate(() => window.dispatchEvent(new Event('blur')))],
      ['visibilitychange to hidden', false, () => page.evaluate(() => {
        const own = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        if (own) Object.defineProperty(Document.prototype, 'visibilityState', own);
      })],
      ['pointer-lock loss', false, () => page.evaluate(() => {
        document.dispatchEvent(new Event('pointerlockchange'));
      })],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const heldAfterStrand = await page.evaluate(() => {
        window.__parityBlurs = 0;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Meta', code: 'MetaLeft', metaKey: true, bubbles: true,
        }));
        return window.__fw.scene3d.walk.heldKeys();
      });
      // eslint-disable-next-line no-await-in-loop
      await fire();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(120);
      // eslint-disable-next-line no-await-in-loop
      const state = await page.evaluate(() => ({
        held: window.__fw.scene3d.walk.heldKeys(),
        blurs: window.__parityBlurs,
      }));
      // A stray blur means this signal was not the thing that cleared the keys,
      // so the check proved nothing â€” that is a failure of the instrument and is
      // reported as a failure, not smoothed over.
      const attributable = expectsBlur || state.blurs === 0;
      // And the setup has to have taken. A check that starts from an already
      // empty held-set proves nothing about the signal under test â€” it would
      // report green on a build that ignores the signal entirely.
      const strandTook = heldAfterStrand.length > 0;
      record(`${name} releases every held key`, state.held.length === 0 && attributable && strandTook, {
        heldAfterStrand,
        held: state.held,
        strayBlurs: expectsBlur ? undefined : state.blurs,
        attributable,
        strandTook,
      });
    }

    // 4. And movement must not be hostage to a phantom: with meta stranded, D
    //    still strafes. This is the player-visible half of the defect.
    await strandMeta();
    return checks;
  };

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.mouse.click(800, 450);
    await page.waitForTimeout(300);
  };

  // At yaw 0 the walk basis maps W to -z, S to +z, A to -x, D to +x.
  const expected = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
  const out = {
    stands: STANDS, variants: {}, verdicts: [], strandedModifier: {},
  };
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    await boot(variant);
    // Runs BEFORE the sweep and leaves a phantom modifier stranded, so the sweep
    // below is measured with one held â€” movement must not be hostage to it.
    out.strandedModifier[variant] = await strandedModifierChecks();
    const rows = await sweep(STANDS[variant]);
    out.variants[variant] = rows;
    for (const row of rows) {
      const [ex, ez] = expected[row.key];
      const moved = Math.hypot(row.dx, row.dz);
      const alongExpected = row.dx * ex + row.dz * ez;
      out.verdicts.push({
        variant,
        key: row.key,
        moved: +moved.toFixed(3),
        ok: moved > 0.25 && alongExpected > 0.8 * moved,
      });
    }
  }
  const strandChecks = Object.values(out.strandedModifier).flat();
  // Skipped checks are counted as skipped, never as passes. A tally that folds
  // "could not be measured" into "measured and fine" is how a harness reports
  // green on a thing it never touched.
  const measured = strandChecks.filter((c) => !c.skipped);
  out.strandedModifierOk = measured.length > 0 && measured.every((c) => c.ok);
  out.strandedModifierFailures = measured.filter((c) => !c.ok);
  out.strandedModifierSkipped = strandChecks.filter((c) => c.skipped)
    .map((c) => ({ name: c.name, skipReason: c.skipReason }));
  out.strandedModifierTally = `${measured.filter((c) => c.ok).length}/${measured.length} measured, `
    + `${strandChecks.length - measured.length} skipped`;
  out.ok = out.verdicts.every((v) => v.ok) && out.strandedModifierOk;
  fs.writeFileSync(path.join(outDir, 'walk-input-parity.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
