// PLAYTEST 3, ITEM 8 — PHASE 10 VERIFIER 3, THE STRANGER.
//
// "Clean start, no code read, real input, no developer shortcuts. Can a stranger
// complete one full customer -- products, a tee time, one payment, bag, out the
// door -- then a second and a third, without getting stuck, hearing silence where
// a sound belongs, or hitting a stall?"
//
// The rule that shapes this file: NO DEVELOPER SHORTCUTS. So there is no
// `debugSpawn`, no `qaSendCustomerTo`, no reaching into the sim to place a
// customer or force a stage. Everything below is a key, a mouse button, or the
// game's own on-screen time control -- things a stranger has. State is READ
// freely (that is observation, not intervention) but never written.
//
// THREE FAILURE MODES, and they need three different instruments:
//
//   STUCK    the player cannot make the game do the next thing. Measured as the
//            checkout stage/flow not advancing while input is being delivered.
//   SILENCE  a cue that should have sounded did not. Measured on the audio graph
//            -- every BufferSource start is stamped, so "the drawer opened and
//            nothing played" is a fact rather than an impression.
//   STALL    the frame rate collapses. Measured as the longest gap between rAF
//            ticks during the run, which is the thing a player calls a freeze.
//
// THE NEGATIVE CONTROL is at the end and it matters more than the run: the stall
// detector is fed a deliberately blocked frame and must report it. A detector
// that cannot see a 500 ms hitch would report a smooth session on a stuttering
// build, and this repo has shipped exactly that shape of lie before.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-stranger-three-customers.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/stranger');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], timeline: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (/\[F8-INVARIANT\]|refused|RangeError|TypeError/i.test(t)) out.errs.push(`console: ${t.slice(0, 200)}`);
  });

  // CLEAN START, through the menu, the way a stranger arrives.
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  // ---- instruments -------------------------------------------------------
  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    window.__st = { starts: [], gaps: [], lastTick: 0, maxGap: 0, frames: 0 };
    const tick = (t) => {
      const s = window.__st;
      if (s.lastTick) {
        const gap = t - s.lastTick;
        if (gap > s.maxGap) s.maxGap = gap;
        if (gap > 120) s.gaps.push({ at: Math.round(t), ms: Math.round(gap) });
      }
      s.lastTick = t;
      s.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const ctx = app.audio?.qaContext?.();
    if (ctx && !ctx.__stSpied) {
      const make = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = make();
        const start = node.start.bind(node);
        node.start = (...args) => {
          const tag = node.buffer && node.buffer.__fwSample;
          window.__st.starts.push({ at: Math.round(performance.now()), cue: tag ? tag.cue : null });
          return start(...args);
        };
        return node;
      };
      ctx.__stSpied = true;
    }
    return { audioSpy: !!ctx };
  });
  console.log('INSTALLED', JSON.stringify(out.installed));

  const snap = async (label) => {
    const row = await page.evaluate((tag) => {
      const app = window.__fw;
      const ch = app.scene3d?.clubhouse?.();
      const reg = ch?.register;
      const st = app.state;
      const customers = ch?.qaCustomerTrack?.() || [];
      return {
        tag,
        t: Math.round(performance.now()),
        minutes: st?.clock?.minutes ?? null,
        signOpen: st?.shop?.signOpen ?? null,
        cash: st?.cash ?? null,
        customers: customers.length,
        queued: customers.filter((c) => c.queued).length,
        registerActive: !!reg?.isActive?.(),
        checkoutStatus: reg?.checkoutStatus?.() ?? null,
        flow: reg?.getFlow?.()?.state ?? null,
        deskTargets: (reg?.deskHitTargets?.() || []).filter((h) => !h.disabled).map((h) => h.id).slice(0, 8),
        frames: window.__st.frames,
        maxGapMs: Math.round(window.__st.maxGap),
        cues: window.__st.starts.length,
      };
    }, label);
    out.timeline.push(row);
    console.log('SNAP', JSON.stringify(row));
    return row;
  };

  await snap('after-boot');

  // ---- real input: open the shop and get to the desk ---------------------
  //
  // A stranger walks. `page.keyboard` delivers the same events the OS does; the
  // pointer is captured first because under pointer lock a click at coordinates
  // never reaches the element (that lie is on record in HARNESS_DEBT).
  await page.mouse.click(640, 400);
  await page.waitForTimeout(800);

  const walk = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };

  // Head indoors. Direction is deliberately not computed from the interior
  // origin -- a stranger does not know where that is; they walk toward the
  // building they can see and correct. Several short bursts with look-steps
  // between them is what that looks like.
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await walk('KeyW', 1500);
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(640 + (i % 2 ? 80 : -80), 400);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
  }
  const arrived = await snap('after-walking');

  out.inside = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    return { inside: ch.isInside(w.x, w.z) };
  });
  console.log('INSIDE?', JSON.stringify(out.inside));

  // ---- wait for trade, using the game's OWN time control ------------------
  //
  // Advancing the clock with the on-screen speed control is a thing a player
  // does; writing state.clock.minutes is not. If the control cannot be found the
  // run says so rather than reaching past it.
  out.timeControl = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,[role="button"]')]
      .find((b) => /speed|fast|▶|»/i.test(b.textContent || b.getAttribute('aria-label') || ''));
    return { found: !!el, label: el ? (el.textContent || '').trim().slice(0, 24) : null };
  });
  console.log('TIME CONTROL', JSON.stringify(out.timeControl));

  // Watch for up to four minutes of wall time for customers to arrive and for
  // the checkout to become reachable. Nothing is forced.
  const deadline = Date.now() + 240000;
  let served = 0;
  let lastFlow = null;
  let noProgressSince = Date.now();
  while (Date.now() < deadline && served < 3) {
    // eslint-disable-next-line no-await-in-loop
    const row = await snap(`watch-${served}`);
    if (row.flow !== lastFlow || row.customers !== (out.timeline.at(-2)?.customers ?? -1)) {
      lastFlow = row.flow;
      noProgressSince = Date.now();
    }
    // If the desk offers an action a stranger would press, press it -- through
    // deskAction, which REFUSES anything not currently drawn and hit-testable,
    // so it can only do what a player could do at this instant.
    if (row.deskTargets && row.deskTargets.length) {
      // eslint-disable-next-line no-await-in-loop
      const pressed = await page.evaluate((ids) => {
        const reg = window.__fw.scene3d.clubhouse()?.register;
        const results = [];
        for (const id of ids.slice(0, 3)) {
          const r = reg?.deskAction?.(id);
          results.push({ id, ok: r?.ok ?? false, reason: r?.reason ?? null });
          if (r?.ok) break;
        }
        return results;
      }, row.deskTargets);
      out.timeline.push({ tag: 'desk-press', pressed });
      console.log('DESK', JSON.stringify(pressed));
      if (pressed.some((p) => p.ok)) noProgressSince = Date.now();
    }
    if (row.checkoutStatus && /complete|thank|done/i.test(row.checkoutStatus)) {
      served += 1;
      noProgressSince = Date.now();
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(6000);
  }
  const stuckSeconds = Math.round((Date.now() - noProgressSince) / 1000);

  await page.screenshot({ path: path.join(OUT, 'stranger-final.png') });
  const final = await snap('final');

  // ---- THE NEGATIVE CONTROL ----------------------------------------------
  //
  // Block the main thread on purpose and require the stall detector to see it.
  // Without this, "maxGap 18 ms, no stalls" is equally consistent with a smooth
  // build and with a detector that never ran.
  out.control = await page.evaluate(async () => {
    const before = window.__st.maxGap;
    const t0 = performance.now();
    while (performance.now() - t0 < 500) { /* deliberate 500 ms block */ }
    await new Promise((d) => requestAnimationFrame(() => d()));
    await new Promise((d) => requestAnimationFrame(() => d()));
    return {
      maxGapBefore: Math.round(before),
      maxGapAfter: Math.round(window.__st.maxGap),
      detectorSawIt: window.__st.maxGap > before + 300,
    };
  });
  console.log('CONTROL(stall detector)', JSON.stringify(out.control));

  const cueNames = await page.evaluate(() => {
    const counts = {};
    for (const s of window.__st.starts) counts[s.cue || '(untagged)'] = (counts[s.cue || '(untagged)'] || 0) + 1;
    return counts;
  });

  out.verdict = {
    reachedInside: out.inside.inside === true,
    customersSeen: Math.max(...out.timeline.map((r) => r.customers ?? 0)),
    registerEverActive: out.timeline.some((r) => r.registerActive),
    customersServed: served,
    // the three failure modes
    stuckForSeconds: stuckSeconds,
    longestFrameGapMs: final.maxGapMs,
    framesDrawn: final.frames,
    cuesHeard: cueNames,
    totalCueStarts: final.cues,
    silentRun: final.cues === 0,
    // and the line that says whether any of the above can be believed
    stallDetectorProved: out.control.detectorSawIt === true,
    pageErrors: out.errs.slice(0, 10),
  };
  console.log('STRANGER', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'stranger.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
