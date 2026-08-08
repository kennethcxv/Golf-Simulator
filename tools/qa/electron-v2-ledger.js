async (page) => {
  // VERIFIER 2 — LEDGER: A2/C5 per-turn frame cost, C1 pointer lock survival,
  // C6 no-strafe + no-machine-gun paging. All interactions REAL input.
  const out = { ok: true, phase: 'boot', faults: [] };
  const ROOTP = process.cwd().replace(/\\/g, '/');
  const shots = `${ROOTP}/qa/electron/verify-v2`;
  const HITCH = 33.34;
  // Fault-52 class: an unfocused window throttles rAF to ~1 fps and every
  // number is a ~1000 ms phantom. Win focus hard, verify, abort if lost.
  const ensureFront = async () => {
    for (let i = 0; i < 6; i += 1) {
      try {
        await page.electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          if (win.isMinimized()) win.restore();
          win.setAlwaysOnTop(true);
          win.show();
          win.moveTop();
          win.focus();
          win.setAlwaysOnTop(false);
        });
      } catch (_) { /* fall through to CDP */ }
      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(250);
      const focused = await page.evaluate(() => document.hasFocus()).catch(() => false);
      if (focused) return true;
    }
    return false;
  };
  try {
    const boot = await import(`file:///${ROOTP}/tools/qa/lib/qa-boot.mjs`);
    await page.bringToFront();
    out.menuPath = await boot.clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive, null, { timeout: 120000 });
    out.focusedAfterBoot = await ensureFront();
    out.windowCaption = (await boot.ownerResolution(page, page.electronApp)).caption;
    // Let first-load streaming settle so ledger costs are not confounded.
    await page.waitForTimeout(6000);

    // ---- STAGE: teleport to the station nearest the ledger book, face it.
    out.phase = 'stage';
    out.stage = await page.evaluate(() => {
      const fw = window.__fw;
      const walk = fw.scene3d.walk;
      const st = walk.state;
      const ch = fw.scene3d.clubhouse();
      let lp = ch.ledgerBook.position;
      if (typeof lp === 'function') lp = ch.ledgerBook.position();
      // ledgerBook.position is interior-LOCAL (recon: local 1.6/3.49 + interior
      // -360/4 = station -358.4/7.49). Convert to world by addition.
      const ip = ch.interior.position;
      const book = { x: ip.x + lp.x, z: ip.z + lp.z, localX: lp.x, localZ: lp.z };
      let stations = [];
      try { stations = walk.stations() || []; } catch (_) { /* none */ }
      if (!stations.length) return { found: false, reason: 'no stations' };
      const byDist = stations
        .map((s) => ({ s, d: Math.hypot(s.x - book.x, s.z - book.z) }))
        .sort((a, b) => a.d - b.d);
      const target = byDist[0].s;
      // The station point sits ON the book's x/z — stand 1.3 yd toward the
      // interior centre, inside the 2.2 yd radius, facing the book.
      const toCentre = { x: ip.x - book.x, z: ip.z - book.z };
      const len = Math.hypot(toCentre.x, toCentre.z) || 1;
      const stand = { x: book.x + (toCentre.x / len) * 1.3, z: book.z + (toCentre.z / len) * 1.3 };
      st.x = stand.x; st.z = stand.z;
      const dx = book.x - st.x;
      const dz = book.z - st.z;
      st.yaw = Math.atan2(-dx, -dz); // forward is (-sin yaw, -cos yaw)
      st.pitch = -0.3; // look down at the desk (negative = down)
      return {
        found: true,
        book,
        station: { x: target.x, z: target.z, r: target.r },
        stationDistToBook: +byDist[0].d.toFixed(2),
        stand,
        otherStation: byDist[1] ? { x: byDist[1].s.x, z: byDist[1].s.z, d: +byDist[1].d.toFixed(2) } : null,
        yaw: +st.yaw.toFixed(3),
      };
    });
    await page.waitForTimeout(900);
    // Hunt the focus label until it names the ledger (staging, not input).
    out.focusHunt = await page.evaluate(async () => {
      const walk = window.__fw.scene3d.walk;
      const st = walk.state;
      const read = () => {
        try { return walk.getFocusLabel ? walk.getFocusLabel() : null; } catch (_) { return null; }
      };
      const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
      const tried = [];
      const baseYaw = st.yaw;
      for (const dp of [0, -0.15, 0.15, -0.3]) {
        for (const dy of [0, -0.2, 0.2, -0.45, 0.45]) {
          st.yaw = baseYaw + dy;
          st.pitch = -0.3 + dp;
          await sleep(140);
          const label = read();
          const text = label == null ? null : String(typeof label === 'object' ? JSON.stringify(label) : label);
          tried.push({ dy: +dy.toFixed(2), dp: +dp.toFixed(2), label: text ? text.slice(0, 90) : null });
          if (text && /ledger|read/i.test(text)) {
            return { hit: true, yaw: +st.yaw.toFixed(3), pitch: +st.pitch.toFixed(3), label: text.slice(0, 140), tried };
          }
        }
      }
      st.yaw = baseYaw; st.pitch = -0.3;
      return { hit: false, tried };
    });
    out.stationInReach = await page.evaluate(() => {
      try {
        const r = window.__fw.scene3d.walk.stationInReach ? window.__fw.scene3d.walk.stationInReach() : 'no-api';
        if (!r) return null;
        return JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'function' ? '[fn]' : v)));
      } catch (e) { return { err: String((e && e.message) || e) }; }
    });
    out.promptAtDesk = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && (el.textContent || '').length < 220 && /ledger|read the book|\[E\]/i.test(el.textContent || ''))
      .slice(0, 6)
      .map((el) => (el.textContent || '').trim().slice(0, 160)));
    await page.screenshot({ path: `${shots}/ledger-01-desk.png` });

    // ---- INSTRUMENT: rAF sampler + capture-phase keydown stamps + lock log.
    out.phase = 'instrument';
    await page.evaluate(() => {
      const v2 = {
        deltas: [], keys: [], lock: [], marks: [], repeats: 0, lastT: null, running: true,
      };
      window.__v2 = v2;
      const loop = (t) => {
        if (!v2.running) return;
        if (v2.lastT != null) v2.deltas.push([t, +(t - v2.lastT).toFixed(2)]);
        v2.lastT = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      document.addEventListener('pointerlockchange', () => {
        v2.lock.push({ t: performance.now(), locked: !!document.pointerLockElement });
      }, true);
      const readDiag = () => {
        try {
          const d = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
          return {
            state: d.state,
            spread: d.spread,
            spreadCount: d.spreadCount,
            turning: d.turning,
            contentReady: d.contentReady,
            lastTurnFrameMs: d.paintStats ? d.paintStats.lastTurnFrameMs : null,
            deferredPending: d.paintStats ? d.paintStats.deferredPending : null,
          };
        } catch (e) { return { err: String((e && e.message) || e) }; }
      };
      window.__v2diag = readDiag;
      window.addEventListener('keydown', (e) => {
        if (e.repeat) { v2.repeats += 1; return; }
        v2.keys.push({
          t: performance.now(), code: e.code, diag: readDiag(), locked: !!document.pointerLockElement,
        });
      }, true);
    });

    // ---- POINTER LOCK from a real click, BEFORE opening (C1 premise).
    out.phase = 'lock';
    out.focusedBeforeLock = await ensureFront();
    const dims = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await page.mouse.click(dims.w / 2, dims.h / 2);
    await page.waitForTimeout(500);
    out.lockedBeforeOpen = await page.evaluate(() => !!document.pointerLockElement);
    if (!out.lockedBeforeOpen) {
      // one retry — some builds want a second click
      await page.mouse.click(dims.w / 2, dims.h / 2);
      await page.waitForTimeout(500);
      out.lockedBeforeOpen = await page.evaluate(() => !!document.pointerLockElement);
      out.faults.push('pointer lock needed a second click');
    }

    const diagNow = () => page.evaluate(() => window.__v2diag());
    const mark = (label) => page.evaluate((l) => { window.__v2.marks.push({ label: l, t: performance.now() }); }, label);
    const posNow = () => page.evaluate(() => {
      const st = window.__fw.scene3d.walk.state;
      const p = (st.position && Number.isFinite(st.position.x)) ? st.position : st;
      return { x: p.x, z: p.z, t: performance.now() };
    });

    out.diagBeforeOpen = await diagNow();

    // rAF health gate: refuse to measure through a throttled window.
    await page.waitForTimeout(900);
    out.preOpenHealth = await page.evaluate(() => {
      const d = window.__v2.deltas.slice(-40).map((r) => r[1]).sort((a, b) => a - b);
      return d.length ? { n: d.length, median: d[Math.floor(d.length / 2)] } : { n: 0, median: null };
    });
    if (!out.preOpenHealth.n || out.preOpenHealth.median > 100) {
      out.abort = `window-unfocused: rAF median ${out.preOpenHealth.median} ms over ${out.preOpenHealth.n} frames — timings would be phantom`;
      return out;
    }

    const waitState = async (want, timeoutMs) => {
      try {
        await page.waitForFunction(
          (w) => { try { return window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state === w; } catch (_) { return false; } },
          want, { timeout: timeoutMs },
        );
        return true;
      } catch (_) { return false; }
    };
    const pressEUntil = async (want, label) => {
      await page.keyboard.press('KeyE');
      if (await waitState(want, 6000)) return true;
      out.faults.push(`${label}: first E did not reach '${want}' in 6 s — pressing E once more`);
      await page.keyboard.press('KeyE');
      if (await waitState(want, 6000)) return true;
      out.faults.push(`${label}: second E also failed to reach '${want}'`);
      return false;
    };

    // ---- OPEN 1 (the first open of the session — the claimed one-time beat).
    out.phase = 'open1';
    await mark('open1-press');
    const open1ok = await pressEUntil('open', 'open1');
    if (!open1ok) await page.screenshot({ path: `${shots}/ledger-02-open-stuck.png` });
    await mark('open1-settled-start');
    await page.waitForTimeout(1600);
    await mark('open1-settled-end');
    out.diagAfterOpen = await diagNow();
    out.diagFullAfterOpen = await page.evaluate(() => {
      try {
        const d = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
        return JSON.parse(JSON.stringify({
          state: d.state, spread: d.spread, spreadCount: d.spreadCount, pageCount: d.pageCount,
          contentReady: d.contentReady, sections: d.sections, overlaps: d.overlaps,
          paintStats: d.paintStats, frameFill: d.frameFill,
        }));
      } catch (e) { return { err: String((e && e.message) || e) }; }
    });
    out.lockedAfterOpen = await page.evaluate(() => !!document.pointerLockElement);
    await page.screenshot({ path: `${shots}/ledger-02-open.png` });

    // ---- 12 REAL D TAPS at ~450 ms spacing.
    out.phase = 'turns';
    const spreadBeforeTurns = (await diagNow()).spread;
    await mark('turns-start');
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('KeyD');
      await page.waitForTimeout(450);
    }
    await mark('turns-end');
    out.diagAfterTurns = await diagNow();
    out.lockedAfterTurns = await page.evaluate(() => !!document.pointerLockElement);
    await page.screenshot({ path: `${shots}/ledger-03-after-turns.png` });
    // If the book ran out of forward spreads, take the deficit as A back-turns
    // so 12 REAL turns are measured in total.
    const advancedD = Math.abs((out.diagAfterTurns.spread ?? 0) - (spreadBeforeTurns ?? 0));
    out.advancedOnD = advancedD;
    const deficit = Math.max(0, Math.min(12, 12 - advancedD));
    await mark('aturns-start');
    for (let i = 0; i < deficit; i += 1) {
      await page.keyboard.press('KeyA');
      await page.waitForTimeout(450);
    }
    await mark('aturns-end');
    out.diagAfterATurns = await diagNow();

    // ---- AMBIENT window, book open, no input.
    out.phase = 'ambient';
    await mark('ambient-start');
    await page.waitForTimeout(3000);
    await mark('ambient-end');

    // ---- C6: hold D for 2 s — drift must be ~0, pages must not machine-gun.
    out.phase = 'holdD';
    const holdD0 = await posNow();
    const holdDdiag0 = await diagNow();
    const cue0 = await page.evaluate(() => (window.__eCounts ? JSON.parse(JSON.stringify(window.__eCounts)) : null));
    await mark('holdD-down');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyD');
    await mark('holdD-up');
    const holdD1 = await posNow();
    const holdDdiag1 = await diagNow();
    const cue1 = await page.evaluate(() => (window.__eCounts ? JSON.parse(JSON.stringify(window.__eCounts)) : null));
    out.holdD = { pos0: holdD0, pos1: holdD1, diag0: holdDdiag0, diag1: holdDdiag1, cue0, cue1 };

    // ---- C6: hold A for 2 s (back-turns) — same checks.
    out.phase = 'holdA';
    const holdA0 = await posNow();
    const holdAdiag0 = await diagNow();
    await mark('holdA-down');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyA');
    await mark('holdA-up');
    const holdA1 = await posNow();
    const holdAdiag1 = await diagNow();
    out.holdA = { pos0: holdA0, pos1: holdA1, diag0: holdAdiag0, diag1: holdAdiag1 };

    // ---- CLOSE.
    out.phase = 'close1';
    await mark('close1-press');
    await page.keyboard.press('KeyE');
    out.close1Reached = await waitState('closed', 8000);
    await page.waitForTimeout(800);
    out.lockedAfterClose = await page.evaluate(() => !!document.pointerLockElement);

    // ---- REOPEN 1 — the claim: no first-open spike class, zero >33 ms.
    out.phase = 'reopen1';
    await mark('reopen1-press');
    await pressEUntil('open', 'reopen1');
    await page.waitForTimeout(1600);
    await mark('reopen1-settled');
    await page.screenshot({ path: `${shots}/ledger-04-reopen.png` });

    // 4 more real turns after reopen.
    out.phase = 'reopen-turns';
    await mark('reopen-turns-start');
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('KeyD');
      await page.waitForTimeout(450);
    }
    await mark('reopen-turns-end');

    // ---- CLOSE + REOPEN 2 (second sample of the reopen class).
    out.phase = 'reopen2';
    await page.keyboard.press('KeyE');
    out.close2Reached = await waitState('closed', 8000);
    await page.waitForTimeout(800);
    await mark('reopen2-press');
    await pressEUntil('open', 'reopen2');
    await page.waitForTimeout(1600);
    await mark('reopen2-settled');
    out.lockedAtEnd = await page.evaluate(() => !!document.pointerLockElement);

    // ---- Mid-strafe open (reviewer's ordering case): close, strafe, open with D held.
    out.phase = 'midStrafe';
    await page.keyboard.press('KeyE'); // close
    await waitState('closed', 8000);
    await page.waitForTimeout(500);
    const ms0 = await posNow();
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(250); // short strafe — stay inside station reach
    const ms1 = await posNow(); // strafing while closed — should move
    await page.keyboard.press('KeyE'); // open mid-strafe, D still held
    const msOpened = await waitState('open', 6000);
    if (!msOpened) out.faults.push('midStrafe: open never reached');
    const ms2 = await posNow();
    await page.waitForTimeout(1500); // D still physically held
    const ms3 = await posNow();
    await page.keyboard.up('KeyD');
    const msDiag = await diagNow();
    out.midStrafe = { ms0, ms1, ms2, ms3, diag: msDiag };

    // ---- Final close; strafe must be alive again.
    out.phase = 'finalClose';
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(900);
    const fc0 = await posNow();
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyD');
    const fc1 = await posNow();
    out.strafeAliveAfterClose = { fc0, fc1 };

    // ---- COLLECT + ANALYZE.
    out.phase = 'collect';
    const data = await page.evaluate(() => {
      const v2 = window.__v2; v2.running = false;
      return { deltas: v2.deltas, keys: v2.keys, lock: v2.lock, marks: v2.marks, repeats: v2.repeats };
    });
    out.repeats = data.repeats;
    out.lockLog = data.lock;
    out.keyCount = data.keys.length;

    const markAt = (label) => { const m = data.marks.find((x) => x.label === label); return m ? m.t : null; };
    const framesIn = (a, b) => data.deltas.filter(([t]) => t >= a && t < b).map(([, dt]) => dt);
    const stats = (arr) => {
      if (!arr.length) return { n: 0 };
      const sorted = [...arr].sort((x, y) => y - x);
      return {
        n: arr.length,
        over33: arr.filter((d) => d > HITCH).length,
        over100: arr.filter((d) => d > 100).length,
        worst: sorted[0],
        top5: sorted.slice(0, 5),
        median: sorted[Math.floor(sorted.length / 2)],
      };
    };

    // Per-turn windows from the REAL keydown stamps (capture-phase).
    const dKeys = data.keys.filter((k) => k.code === 'KeyD');
    const aKeys = data.keys.filter((k) => k.code === 'KeyA');
    const eKeys = data.keys.filter((k) => k.code === 'KeyE');
    const turnsStart = markAt('turns-start');
    const turnsEnd = markAt('turns-end');
    const turnKeys = dKeys.filter((k) => k.t >= turnsStart - 50 && k.t <= turnsEnd);
    out.turns = turnKeys.map((k, i) => {
      const next = turnKeys[i + 1];
      const winEnd = next ? next.t : k.t + 450;
      const s = stats(framesIn(k.t, winEnd));
      return {
        i,
        pressT: +k.t.toFixed(0),
        pageBefore: k.diag,
        locked: k.locked,
        over33: s.over33,
        over100: s.over100,
        worst: s.worst,
      };
    });

    const aStart = markAt('aturns-start');
    const aEnd = markAt('aturns-end');
    const aTurnKeys = aKeys.filter((k) => k.t >= aStart - 50 && k.t <= aEnd);
    out.aTurns = aTurnKeys.map((k, i) => {
      const next = aTurnKeys[i + 1];
      const winEnd = next ? next.t : k.t + 450;
      const s = stats(framesIn(k.t, winEnd));
      return { i, over33: s.over33, over100: s.over100, worst: s.worst, pageBefore: k.diag, locked: k.locked };
    });

    const reopenTurnKeys = dKeys.filter((k) => k.t >= markAt('reopen-turns-start') - 50 && k.t <= markAt('reopen-turns-end'));
    out.reopenTurns = reopenTurnKeys.map((k, i) => {
      const next = reopenTurnKeys[i + 1];
      const winEnd = next ? next.t : k.t + 450;
      const s = stats(framesIn(k.t, winEnd));
      return { i, over33: s.over33, worst: s.worst, pageBefore: k.diag, locked: k.locked };
    });

    const openE = eKeys.find((k) => k.t >= markAt('open1-press') - 80);
    out.open1Frames = openE ? stats(framesIn(openE.t, openE.t + 2000)) : null;
    const reopen1E = eKeys.find((k) => k.t >= markAt('reopen1-press') - 80);
    out.reopen1Frames = reopen1E ? stats(framesIn(reopen1E.t, reopen1E.t + 2000)) : null;
    const reopen2E = eKeys.find((k) => k.t >= markAt('reopen2-press') - 80);
    out.reopen2Frames = reopen2E ? stats(framesIn(reopen2E.t, reopen2E.t + 2000)) : null;
    const close1E = eKeys.find((k) => k.t >= markAt('close1-press') - 80);
    out.close1Frames = close1E ? stats(framesIn(close1E.t, close1E.t + 1500)) : null;
    out.ambientFrames = stats(framesIn(markAt('ambient-start'), markAt('ambient-end')));

    // Hold windows: frame cost + drift + page delta computed by me outside.
    out.holdDFrames = stats(framesIn(markAt('holdD-down'), markAt('holdD-up')));
    out.holdAFrames = stats(framesIn(markAt('holdA-down'), markAt('holdA-up')));

    out.eKeyTimes = eKeys.map((k) => ({ t: +k.t.toFixed(0), state: k.diag && k.diag.state, locked: k.locked }));
    out.phase = 'done';
  } catch (error) {
    out.error = `${out.phase}: ${String((error && error.message) || error)}`;
    try { await page.screenshot({ path: `${shots}/ledger-fail-${out.phase}.png` }); } catch (_) { /* best effort */ }
  }
  return out;
}
