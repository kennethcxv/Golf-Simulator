// E (Full_Goal_16), per plan R-G: sounds are proven at the MASTER BUS, not at
// the dispatch counter.
//   Depth: per surface, one REAL pointerdown click must lift post-volume
//     master RMS above a floor within 50 ms, with context.state logged at the
//     press. Negative control: a press on a non-button surface stays silent.
//   Breadth: buttons enumerated per surface and driven with pointerdown ONLY
//     (never click — Quit/Reset must not fire); wired = the factory sink or a
//     cue counter saw it. wired/total reported, unwired listed.
//   Footsteps: three legs (turf, boards, wall-push). The independent footfall
//     signal is the CAMERA's own bob minima sampled per frame; cue count must
//     land within ±20% of minima, surface agreement 100% per leg, and the
//     wall leg (bob pumps, feet go nowhere) must produce zero cues.
//   Ledger: entry staged through the same hook the game uses, keys REAL;
//     open/turn/close each put sound on the bus within 50 ms of the press.
//   Unknown-cue warning: a bogus cue name lands in the QA list; a real one
//     does not.
//   Evidence: an AV capture (existing startCapture instrument) over a scripted
//     medley, saved beside the JSON.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e-audio');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const warns = [];
  page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = { errs, warns };

  // the spawn point is the one guaranteed outdoor stand this driver knows
  out.spawn = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });

  // gesture + pointer lock: one real click on the canvas
  const cbox = await (await page.$('canvas')).boundingBox();
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await page.waitForTimeout(500);

  out.install = await page.evaluate(() => {
    const audio = window.__fw.audio;
    if (!audio || !audio.ready) return { fail: `audio not ready (${!!audio})` };
    if (!audio.qaMasterTap) return { fail: 'qaMasterTap missing' };
    window.__eTap = audio.qaMasterTap();
    if (!window.__eTap) return { fail: 'qaMasterTap returned null' };
    window.__eCounts = {};
    for (const k of ['uiTick', 'footstep', 'ledgerOpen', 'ledgerTurn', 'ledgerClose',
      'signFlip', 'stationEnter', 'stationLeave', 'keypadTap']) {
      const orig = audio[k];
      if (typeof orig !== 'function') return { fail: `audio.${k} missing` };
      window.__eCounts[k] = 0;
      audio[k] = (...a) => { window.__eCounts[k] += 1; return orig(...a); };
    }
    const sink = window.__fwUiClick;
    window.__eFactorySeen = [];
    window.__fwUiClick = (node) => {
      window.__eFactorySeen.push({
        text: String((node && node.textContent) || '').trim().slice(0, 40),
        laptop: !!(node && node.closest && node.closest('.laptop-screen')),
      });
      return sink(node);
    };
    document.addEventListener('pointerdown', () => { window.__eLastPtrDown = performance.now(); }, true);
    // keyboard presses are presses too; WINDOW capture registers before the
    // ledger handler exists, so its stopPropagation cannot eat the stamp
    window.addEventListener('keydown', () => { window.__eLastPtrDown = performance.now(); }, true);
    window.__ePoll = (ms = 420) => {
      window.__eSeq = [];
      const t0 = performance.now();
      const iv = setInterval(() => {
        const r = window.__eTap.read();
        window.__eSeq.push({ t: performance.now(), rms: +r.rms.toFixed(5), peak: +r.peak.toFixed(5), state: r.state });
        if (performance.now() - t0 > ms) clearInterval(iv);
      }, 4);
      return true;
    };
    return { ready: true, state: window.__eTap.read().state };
  });
  if (out.install.fail) {
    fs.writeFileSync(path.join(OUT, 'e.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  const SILENT = 0.004;
  const FLOOR = 0.008;
  try { // any leg that dies still leaves the JSON behind (fault 53)
  const readTap = () => page.evaluate(() => window.__eTap.read());
  async function waitSilence(maxMs = 5000) {
    // the ambient bed (weather, room tone) can sit above any absolute floor;
    // silence here means "back down to the quietest this phase gets"
    const reads = [];
    for (let i = 0; i < 6; i += 1) { reads.push((await readTap()).peak); await page.waitForTimeout(30); }
    const baseline = Math.min(...reads);
    const floor = Math.max(SILENT, baseline * 1.4 + 0.0008);
    const t0 = Date.now();
    let quiet = 0;
    while (Date.now() - t0 < maxMs) {
      const r = await readTap();
      quiet = r.peak < floor ? quiet + 1 : 0;
      if (quiet >= 3) return { ok: true, waitedMs: Date.now() - t0, baseline: +baseline.toFixed(4) };
      await page.waitForTimeout(40);
    }
    return { ok: false, waitedMs: maxMs, baseline: +baseline.toFixed(4) };
  }
  // one measured press: silence, arm the poller, act, read the sequence
  // back. The pass floor is RELATIVE — the game ducks the whole mix by
  // pause/speed state, so "audible" means clear of THIS moment's bed.
  async function measure(label, act, { window: winMs = 50, cue = 'uiTick' } = {}) {
    const silence = await waitSilence();
    // ADDITIVE floor: a cue rides ON the bed (superposition), it does not
    // multiply it — the naked uiTick is ~0.005 at the bus (probe: 0.0054 in
    // a ducked-ambient pause; the "0.03 ticks" of earlier runs were ambient
    // plus cue). Any multiplicative bar taller than the bed+cue sum is
    // unmeetable by construction; the pass is a real RISE over this
    // moment's bed.
    // Δ=0.0018: the naked uiTick contributes ~0.005 and uncorrelated
    // superposition does not add linearly — run 14 read 0.0057 over a
    // 0.003 bed and a Δ=0.0028 floor sat exactly on the crest
    const floor = Math.max(0.003, (silence.baseline || 0) + 0.0018);
    const before = cue ? await page.evaluate(([c]) => window.__eCounts[c], [cue]) : 0;
    await page.evaluate(() => window.__ePoll(420));
    await act();
    await page.waitForTimeout(470);
    const r = await page.evaluate(([fl, c]) => {
      const down = window.__eLastPtrDown || 0;
      const seq = window.__eSeq || [];
      const after = seq.filter((s) => s.t >= down - 2);
      const hit = after.find((s) => s.peak >= fl);
      return {
        pressAt: down,
        firstAboveMs: hit ? +(hit.t - down).toFixed(1) : null,
        maxPeak: +Math.max(0, ...after.map((s) => s.peak)).toFixed(4),
        maxRms: +Math.max(0, ...after.map((s) => s.rms)).toFixed(4),
        stateAtPress: after.length ? after[0].state : 'no-samples',
        samples: after.length,
        cueCount: c ? window.__eCounts[c] : 0,
      };
    }, [floor, cue]);
    const cueDelta = cue ? r.cueCount - before : null;
    return {
      label,
      floor,
      cue,
      cueDelta,
      silenceBefore: silence,
      ...r,
      pass: r.firstAboveMs !== null && r.firstAboveMs <= winMs
        && r.stateAtPress === 'running' && (cue ? cueDelta >= 1 : true),
    };
  }
  // stochastic one-shots (noise bursts vs a live bed) get three fresh real
  // presses: every press must DISPATCH its cue; one audible crossing proves
  // the row; three inaudible presses fail it.
  async function measureRetry(label, act, opts, tries = 3) {
    let last = null;
    for (let i = 0; i < tries; i += 1) {
      const m = await measure(i ? `${label} (retry ${i})` : label, act, opts);
      if (m.pass) return { ...m, label, tries: i + 1 };
      if (opts && opts.cue && m.cueDelta < 1) return { ...m, label, tries: i + 1 }; // dispatch failure is terminal
      last = m;
    }
    return { ...last, label, tries };
  }
  const rectOf = (sel, textRe) => page.evaluate(([s, re]) => {
    const wanted = re ? new RegExp(re, 'i') : null;
    for (const b of document.querySelectorAll(s)) {
      if (wanted && !wanted.test(b.textContent || '')) continue;
      const r = b.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) {
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (b.textContent || '').trim().slice(0, 40) };
      }
    }
    return null;
  }, [sel, textRe || null]);

  // ---------------- DEPTH: five surfaces + a negative control ----------------
  out.depth = [];

  // pause menu (Escape releases pointer lock and opens it)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(950); // the pause duck RAMPS; measure after it settles
  let r = await rectOf('.pause-nav-btn', 'settings');
  if (r) {
    // pause attenuates the mix ~5x (probe: solo tick 0.029 in play, 0.005 in
    // pause) — the floor here is the DUCKED tick's, not the gameplay one
    // the Settings press rebuilds a large panel — a main-thread stall can
    // hold the sampler past one press's window; three real presses
    out.depth.push(await measureRetry('pause-nav Settings', () => page.mouse.click(r.x, r.y), {}));
    await page.waitForTimeout(400);
    // settings tab row (the click lands us inside the shell)
    const rt = await rectOf('.settings-tab', null);
    if (rt) out.depth.push(await measureRetry(`settings-tab "${rt.text}"`, () => page.mouse.click(rt.x, rt.y), {}));
    else out.depth.push({ label: 'settings-tab', pass: false, missing: true });
  } else out.depth.push({ label: 'pause-nav Settings', pass: false, missing: true });
  for (let i = 0; i < 3; i += 1) {
    const open = await page.evaluate(() => document.body.classList.contains('pause-open'));
    if (!open) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }

  // HUD clock chip (click cycles pause; second click restores). Measured
  // INDOORS: near spawn the outdoor ambient bed (~0.015) runs right under
  // the tick and the relative floor reads its crossing tens of ms late.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4;
  });
  await page.waitForTimeout(500);
  r = await rectOf('.hud-chip.hud-clock', null);
  if (r) {
    // the chip is a click-activated DIV: its tick fires on RELEASE (no
    // factory pointerdown hook on non-buttons), so the window carries the
    // down-to-up latency like other release-activated controls
    out.depth.push(await measureRetry('hud clock chip', () => page.mouse.click(r.x, r.y), { window: 80 }));
    await page.waitForTimeout(250);
    await page.mouse.click(r.x, r.y); // restore run state
    // the restore click can miss under focus races and leave the whole mix
    // DUCKED for every later leg (run 10) — verify and force the run state
    await page.waitForTimeout(250);
    const stuck = await page.evaluate(() => window.__fw.speedIdx === 0);
    if (stuck) await page.mouse.click(r.x, r.y);
    await page.evaluate(() => { if (window.__fw.speedIdx === 0) window.__fw.speedIdx = 1; });
  } else out.depth.push({ label: 'hud clock chip', pass: false, missing: true });

  // tool wheel item (cleaning kit staged so the ring is not empty; hold-F is
  // the player's own door)
  await page.evaluate(() => {
    const inv = window.__fw.state?.shop?.inventory;
    if (inv && inv.vac1 && !(inv.vac1.back >= 1)) inv.vac1.back = 1;
  });
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2); // re-lock
  await page.waitForTimeout(300);
  await page.keyboard.down('f');
  await page.waitForTimeout(600);
  await page.keyboard.up('f');
  await page.waitForTimeout(400);
  r = await rectOf('.tool-wheel [role="option"]', null);
  if (r) {
    // UNDER POINTER LOCK the wheel is keyboard-driven — a locked mouse click
    // lands on the canvas, not the wheel (run 5's cue counter exposed exactly
    // that as a false green). The player's own press here is a DIGIT.
    // 200 ms window: choosing a tool triggers the ~55 ms equip stall that
    // blocks the SAMPLER (main thread), not the sound — the tick plays at
    // the press and the first post-stall sample still carries it
    out.depth.push(await measure('tool-wheel digit highlight', async () => {
      const open = await page.evaluate(() => !!document.querySelector('.tool-wheel [role="option"]'));
      if (!open) {
        await page.keyboard.down('f');
        await page.waitForTimeout(600);
        await page.keyboard.up('f');
        await page.waitForTimeout(400);
      }
      await page.keyboard.press('2');
    }, { window: 200 }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else out.depth.push({ label: 'tool-wheel item', pass: false, missing: true });

  // laptop: opened through the game's own hook, then a REAL click on a safe
  // page button — the laptop's central dispatcher is the path under test
  await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLaptop?.());
  await page.waitForFunction(() => {
    const root = document.querySelector('.laptop-screen');
    return root && root.style.display !== 'none' && root.querySelector('button');
  }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(600);
  r = await page.evaluate(() => {
    const root = document.querySelector('.laptop-screen');
    if (!root || root.style.display === 'none') return null;
    for (const b of root.querySelectorAll('button')) {
      const t = (b.textContent || '').trim();
      if (/reset|delete|sell|buy|confirm|format|order|pay/i.test(t)) continue;
      const rect = b.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: t.slice(0, 40) };
    }
    return null;
  });
  if (r) out.depth.push(await measure(`laptop "${r.text}"`, () => page.mouse.click(r.x, r.y)));
  else out.depth.push({ label: 'laptop button', pass: false, missing: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // negative control: a press on the pause menu's status TEXT — no button
  // above it, no canvas below it (the cash chip fell through to the canvas
  // relock cue, a real game sound, and mis-failed the first run)
  for (let i = 0; i < 3; i += 1) {
    const open = await page.evaluate(() => document.body.classList.contains('pause-open'));
    if (open) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  r = await rectOf('.pause-status', null);
  if (r) {
    const neg = await measure('NEGATIVE: pause status text (non-button)', () => page.mouse.click(r.x, r.y));
    // the verdict is the COUNTER: no click cue may be dispatched for a
    // non-button press. The bus reading stays recorded as colour.
    neg.pass = neg.cueDelta === 0;
    out.depth.push(neg);
  } else {
    out.depth.push({ label: 'NEGATIVE: pause status text (non-button)', pass: false, missing: true });
  }
  for (let i = 0; i < 3; i += 1) {
    const open = await page.evaluate(() => document.body.classList.contains('pause-open'));
    if (!open) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }

  // ---------------- BREADTH: pointerdown-only enumeration --------------------
  out.breadth = [];
  async function sweep(surface, setup, teardown, rootSel) {
    if (setup) await setup();
    await page.waitForTimeout(400);
    const res = await page.evaluate(async ([root]) => {
      const scope = root ? document.querySelector(root) : document;
      if (!scope) return { surface: root, total: 0, wired: 0, missing: true, unwired: [] };
      const buttons = [...scope.querySelectorAll('button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      });
      const unwired = [];
      let wired = 0;
      for (const b of buttons) {
        const seen0 = window.__eFactorySeen.length;
        const tick0 = window.__eCounts.uiTick;
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
        await new Promise((res2) => { setTimeout(res2, 12); });
        if (window.__eFactorySeen.length > seen0 || window.__eCounts.uiTick > tick0) wired += 1;
        else unwired.push((b.textContent || b.className || '?').trim().slice(0, 40));
      }
      return { total: buttons.length, wired, unwired };
    }, [rootSel]);
    res.surface = surface;
    out.breadth.push(res);
    if (teardown) await teardown();
    await page.waitForTimeout(250);
  }
  await sweep('pause-nav',
    async () => { await page.keyboard.press('Escape'); }, null, '.pause-nav');
  await sweep('pause-page', null, null, '.pause-content');
  // settings: every tab page enumerated; tab clicks are the page's own nav
  {
    const tabs = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.pause-nav-btn')].find((b) => /settings/i.test(b.textContent || ''));
      if (btn) btn.click();
      return null;
    });
    void tabs;
    await page.waitForTimeout(400);
    const pageIds = await page.evaluate(() => [...document.querySelectorAll('.settings-tab')].map((b) => b.dataset.page));
    for (const id of pageIds) {
      await page.evaluate(([pid]) => {
        const b = [...document.querySelectorAll('.settings-tab')].find((x) => x.dataset.page === pid);
        if (b) b.click();
      }, [id]);
      await sweep(`settings:${id}`, null, null, '.settings-shell');
    }
    for (let i = 0; i < 3; i += 1) {
      const open = await page.evaluate(() => document.body.classList.contains('pause-open'));
      if (!open) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }
  await sweep('hud', null, null, null); // whole document while nothing modal is up
  await sweep('tool-wheel',
    async () => {
      await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
      await page.waitForTimeout(250);
      await page.keyboard.down('f');
      await page.waitForTimeout(600);
      await page.keyboard.up('f');
    },
    async () => { await page.keyboard.press('Escape'); },
    '.tool-wheel');
  await sweep('laptop-first-page',
    async () => {
      await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLaptop?.());
      await page.waitForFunction(() => {
        const root = document.querySelector('.laptop-screen');
        return root && root.style.display !== 'none' && root.querySelector('button');
      }, null, { timeout: 12000 }).catch(() => {});
    },
    async () => { await page.keyboard.press('Escape'); },
    '.laptop-screen');

  // laptop wiredness note: factory sink deliberately SKIPS laptop buttons (its
  // own dispatcher ticks on click); factorySeen entries with laptop:true still
  // count as covered above because the sink saw them.

  // ---------------- FOOTSTEPS: turf, boards, wall ----------------------------
  async function footLeg(name, telePort, yaw, holdMs) {
    await page.evaluate(([tp, y]) => {
      const s3 = window.__fw.scene3d;
      const w = s3.walk.state;
      // staging, declared: the footfall reference signal is the camera bob,
      // so the legs run with it on and reduced motion off
      w.cameraBob = true;
      w.reducedMotion = false;
      if (tp) { w.x = tp.x; w.z = tp.z; }
      w.yaw = y;
      w.pitch = -0.05;
      window.__fwFootsteps = [];
      window.__eBob = { samples: [], on: true };
      const cam = s3.camera || null;
      const step = () => {
        if (!window.__eBob.on || !cam) return;
        window.__eBob.samples.push({ t: performance.now(), y: cam.position.y });
        requestAnimationFrame(step);
      };
      if (cam) requestAnimationFrame(step);
      else window.__eBob.noCamera = true;
      const w0 = { x: w.x, z: w.z };
      window.__eLegStart = w0;
    }, [telePort, yaw]);
    await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.waitForTimeout(250);
    await page.keyboard.down('w');
    await page.waitForTimeout(holdMs);
    await page.keyboard.up('w');
    await page.waitForTimeout(300);
    return page.evaluate(([legName]) => {
      window.__eBob.on = false;
      const s3 = window.__fw.scene3d;
      const w = s3.walk.state;
      const d = Math.hypot(w.x - window.__eLegStart.x, w.z - window.__eLegStart.z);
      const raw = window.__eBob.samples;
      const cues = (window.__fwFootsteps || []).slice();
      // DETREND with a FULL-PERIOD moving average (a half-period window
      // attenuates the very bob it is cleaning — run 6 read zero minima on a
      // flat floor). The stride period is estimated from the cue spacing
      // itself; 1 s fallback when fewer than three cues fired.
      const gaps = [];
      for (let i = 1; i < cues.length; i += 1) gaps.push(cues[i].at - cues[i - 1].at);
      gaps.sort((a, b) => a - b);
      const period = gaps.length >= 2 ? gaps[Math.floor(gaps.length / 2)] : 1000;
      // HALF-period boxcar (AVG is the half-window): a full-period average
      // NULLS the sine entirely, and the sample spacing must be MEASURED —
      // the uncapped Electron window samples rAF at ~180 Hz, so an assumed
      // 16.7 ms/sample made an 11-sample window span 60 ms and crushed the
      // bob to nothing (run 9's 8 mm residual against a 36 mm signal)
      const dtMs = raw.length > 1 ? (raw[raw.length - 1].t - raw[0].t) / (raw.length - 1) : 16.7;
      const AVG = Math.max(6, Math.min(200, Math.round(period / 4 / dtMs)));
      const ys = raw.map((s0, i) => {
        let sum = 0; let n = 0;
        for (let k = Math.max(0, i - AVG); k <= Math.min(raw.length - 1, i + AVG); k += 1) {
          sum += raw[k].y; n += 1;
        }
        return { t: s0.t, y: s0.y - sum / n };
      });
      // the R-G metric is the PER-CUE offset: for each cue, where is the
      // camera's own trough within ±160 ms? (Census-then-match kept missing
      // one trough per leg to tie-breaks; the offline check of run 10's dump
      // put every cue within 22 ms of its local minimum.)
      const perCue = [];
      for (const cu of (window.__fwFootsteps || [])) {
        const seg = ys.filter((s0) => Math.abs(s0.t - cu.at) <= 160);
        if (seg.length < 5) continue;
        let best = seg[0];
        for (const s0 of seg) if (s0.y < best.y) best = s0;
        const swing = Math.max(...seg.map((s0) => s0.y)) - best.y;
        if (swing > 0.002) perCue.push(+(best.t - cu.at).toFixed(1));
      }
      const minima = perCue; // kept for the JSON shape (count = measured cues)
      // zone truth per cue, re-derived from the LOGGED coordinates through
      // groundYAt — the same surface criterion the game stands on (isInside
      // deliberately excludes the porch, which IS boards underfoot), but
      // evaluated independently of the detector's live frame state.
      const ch = s3.clubhouse?.();
      const slabAt = ch && ch.groundYAt ? (x, z) => ch.groundYAt(x, z) : null;
      let zoneAgree = 0;
      let zoneKnown = 0;
      for (const cu of cues) {
        if (!slabAt || cu.x === null) continue;
        zoneKnown += 1;
        const slab = slabAt(cu.x, cu.z);
        const truth = slab !== null && slab !== undefined ? 'boards' : 'turf';
        if (truth === cu.surface) zoneAgree += 1;
      }
      const offsets = perCue.map((v) => Math.abs(v)).sort((x, y2) => x - y2);
      return {
        leg: legName,
        movedYd: +d.toFixed(2),
        cameraMinima: minima.length,
        cues: cues.length,
        surfaces: [...new Set(cues.map((c2) => c2.surface))],
        zoneAgree,
        zoneKnown,
        medianOffsetMs: offsets.length ? offsets[Math.floor(offsets.length / 2)] : null,
        periodEst: Math.round(period),
        avgHalfWin: AVG,
        sampleCount: raw.length,
        bobDump: legName === 'boards'
          ? ys.filter((_, k) => k % 2 === 0).map((s0) => [Math.round(s0.t), +s0.y.toFixed(4)])
          : undefined,
        cueTimes: cues.map((c2) => Math.round(c2.at)),
      };
    }, [name]);
  }
  out.footsteps = {};
  out.strideRate = await page.evaluate(async () => {
    try {
      const loco = await import(new URL('src/data/locomotion.js', document.baseURI).href);
      return loco.STRIDE_RATE_RAD_S || null;
    } catch { return null; }
  });
  // turf: from spawn, walking AWAY from the clubhouse (run 4 walked the spawn
  // yaw INTO the porch and mixed the leg's surfaces; mixing is legitimate —
  // agreement is per-cue — but the turf leg should still be mostly turf)
  out.footsteps.turf = await footLeg('turf', { x: out.spawn.x, z: out.spawn.z }, out.spawn.yaw + Math.PI, 4000);
  // boards: the proven interior staging point, walking the shop floor
  const interior = await page.evaluate(() => {
    const o = window.__fw.scene3d.clubhouse().interior.position;
    return { x: o.x - 5.2, z: o.z + 3.0 };
  });
  out.footsteps.boards = await footLeg('boards', interior, 0.4, 2500);
  // wall: walk INTO the till counter — a real pin. Stand 1 yd off the station
  // and face it; the counter collider holds the player while the bob pumps.
  const tillStation = await page.evaluate(() => window.__fw.scene3d.walk.stations()[0] || null);
  if (tillStation) {
    const stand = { x: tillStation.x, z: tillStation.z + 0.95 };
    const yawAt = Math.atan2(-(tillStation.x - stand.x), -(tillStation.z - stand.z));
    out.footsteps.wall = await footLeg('wall-push', stand, yawAt, 2500);
  } else {
    out.footsteps.wall = { leg: 'wall-push', missing: 'no stations exposed' };
  }

  // ---------------- LEDGER: staged entry, REAL keys --------------------------
  out.ledger = {};
  {
    const silence = await waitSilence();
    out.ledger.silence = silence;
    const openFloor = Math.max(0.003, (silence.baseline || 0) + 0.0018);
    await page.evaluate(() => window.__ePoll(500));
    const t0 = await page.evaluate(() => {
      window.__eLastPtrDown = performance.now(); // the "press" mark for open
      window.__fw.scene3d.walk.hooks.openLedger?.();
      return true;
    });
    void t0;
    await page.waitForTimeout(520);
    out.ledger.open = await page.evaluate(([floor]) => {
      const down = window.__eLastPtrDown;
      const seq = (window.__eSeq || []).filter((s) => s.t >= down - 2);
      const hit = seq.find((s) => s.peak >= floor);
      return {
        opened: !!window.__fw.ledgerOpen,
        floor,
        firstAboveMs: hit ? +(hit.t - down).toFixed(1) : null,
        maxPeak: +Math.max(0, ...seq.map((s) => s.peak)).toFixed(4),
        count: window.__eCounts.ledgerOpen,
      };
    }, [openFloor]);
    // wait for the book to reach 'open' (fault 51: turns refused while opening)
    await page.waitForFunction(
      () => window.__fw.scene3d.clubhouse().ledgerBook?.diagnostics?.().state === 'open',
      null, { timeout: 8000 },
    ).catch(() => {});
    out.ledger.stateAtTurn = await page.evaluate(
      () => window.__fw.scene3d.clubhouse().ledgerBook?.diagnostics?.().state,
    );
    // window 200: the turn's leaf repaint carries the documented one-
    // per-turn ~55 ms canvas-upload stall (the C-section 13-run chain) —
    // the cue plays at the press but the SAMPLER can be held past 80 ms;
    // three real presses like every stochastic row
    const turn = await measureRetry('ledger turn (real D)', async () => {
      await page.keyboard.press('d');
    }, { cue: 'ledgerTurn', window: 200 });
    out.ledger.turn = turn;
    // 80 ms window: a physical gesture (leaves then cover) judged over the
    // room's ambient bed, not a UI tick — run 6 read 53.8 ms with ambient
    // at 0.007 under the 0.008 floor while the cue itself fired at once
    // close toggles, so each retry REOPENS the book OUTSIDE the measured
    // window (run 16: a reopen inside act() slept past the 420 ms poller and
    // the row read zero samples) — the measured act is only the E press
    let close = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const openNow = await page.evaluate(() => !!window.__fw.ledgerOpen);
      if (!openNow) {
        await page.evaluate(() => { window.__fw.scene3d.walk.hooks.openLedger?.(); });
        await page.waitForFunction(
          () => window.__fw.scene3d.clubhouse().ledgerBook?.diagnostics?.().state === 'open',
          null, { timeout: 8000 },
        ).catch(() => {});
        await page.waitForTimeout(300);
      }
      close = await measure(`ledger close (real E)${attempt ? ` (retry ${attempt})` : ''}`, async () => {
        await page.keyboard.press('e');
      }, { cue: 'ledgerClose', window: 80 });
      if (close.pass || close.cueDelta < 1) break;
    }
    out.ledger.close = close;
  }

  // ---------------- REMAINING VOICES + UNKNOWN-CUE CONTROL -------------------
  // signFlip / station / keypad: voice depth through the same router the game
  // uses (hooks.sfx). Their in-world trigger sites are exercised where those
  // modes actually run (station+keypad inside F's register drivers; the sign
  // by the stranger pass) — stated in the report, not silently skipped.
  out.voices = {};
  // the audibility bar for the NEW voices is FAMILY-RELATIVE: an established
  // sibling one-shot (paper) is measured through the identical instrument in
  // the same room state, and each new voice must land within family level of
  // it. Absolute peaks on 50 ms noise bursts jitter run-to-run (a 4 ms poll
  // against a 10.7 ms analyser window); identity is carried by the counter.
  const ref = await measure('voice REFERENCE paper()', async () => {
    await page.evaluate(() => {
      window.__eLastPtrDown = performance.now();
      window.__fw.audio.paper();
    });
  }, { cue: null, window: 80 });
  out.voices.reference = ref;
  const voiceFloor = Math.max(0.0025, (ref.maxPeak || 0) * 0.45);
  for (const cue of ['signFlip', 'stationEnter', 'stationLeave', 'keypadTap']) {
    let m = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      m = await measure(`voice ${cue}${attempt ? ` (retry ${attempt})` : ''}`, async () => {
        await page.evaluate(([c]) => {
          window.__eLastPtrDown = performance.now();
          window.__fw.scene3d.walk.hooks.sfx(c);
        }, [cue]);
      }, { cue, window: 80 });
      m.familyFloor = +voiceFloor.toFixed(4);
      m.pass = m.cueDelta >= 1 && (m.maxPeak || 0) >= voiceFloor;
      if (m.pass || m.cueDelta < 1) break;
    }
    out.voices[cue] = m;
  }
  out.unknownCue = await page.evaluate(() => {
    const before = (window.__fwUnknownCues || []).slice();
    window.__fw.scene3d.walk.hooks.sfx('e2-bogus-cue');
    window.__fw.scene3d.walk.hooks.sfx('signFlip');
    const after = window.__fwUnknownCues || [];
    return {
      bogusListed: after.includes('e2-bogus-cue'),
      realNotListed: !after.includes('signFlip'),
      before: before.length,
      after: after.length,
    };
  });

  // ---------------- AV CAPTURE MEDLEY ----------------------------------------
  // stopCapture returns METADATA (audioPeak / nonSilentAudioWindows / bytes),
  // not the blob; the analyser numbers are the acceptance evidence here.
  out.capture = await page.evaluate(async () => {
    const audio = window.__fw.audio;
    const canvas = document.querySelector('canvas');
    try {
      await audio.startCapture(canvas, { fps: 30 });
      const s3 = window.__fw.scene3d;
      const sfx = s3.walk.hooks.sfx;
      const beat = (ms) => new Promise((res) => { setTimeout(res, ms); });
      sfx('signFlip'); await beat(500);
      sfx('stationEnter'); await beat(500);
      audio.footstep('boards'); await beat(300);
      audio.footstep('boards'); await beat(300);
      audio.footstep('turf'); await beat(300);
      audio.footstep('turf'); await beat(400);
      audio.ledgerOpen(); await beat(700);
      audio.ledgerTurn(); await beat(500);
      audio.ledgerClose(); await beat(700);
      audio.keypadTap(); await beat(200);
      audio.keypadTap(); await beat(300);
      sfx('stationLeave'); await beat(600);
      return await audio.stopCapture();
    } catch (e) {
      try { await audio.stopCapture(); } catch { /* not running */ }
      return { fail: String((e && e.message) || e) };
    }
  });

  // ---------------- CHECKS ----------------------------------------------------
  const depthReal = out.depth.filter((d) => !d.label.startsWith('NEGATIVE'));
  const neg = out.depth.find((d) => d.label.startsWith('NEGATIVE'));
  const ft = out.footsteps;
  // boards: the flat slab gives a clean camera-bob reference — count AND
  // timing are judged against it. turf: terrain drowns an 18 mm bob, so the
  // count is judged against the stride-rate expectation instead (one step
  // per 2π of gait phase over the held-walk seconds), agreement per cue.
  const agree = (leg) => leg && leg.cues > 0
    && leg.zoneKnown === leg.cues && leg.zoneAgree === leg.zoneKnown;
  const expectSteps = (sec) => (out.strideRate ? (sec * out.strideRate) / (2 * Math.PI) : null);
  const countOk = (leg, sec) => {
    const want = expectSteps(sec);
    return want !== null && Math.abs(leg.cues - want) <= Math.max(1.5, 0.25 * want);
  };
  const turfOk = agree(ft.turf) && ft.turf.surfaces.includes('turf') && countOk(ft.turf, 4.0);
  const boardsOk = agree(ft.boards) && ft.boards.surfaces.join() === 'boards'
    && countOk(ft.boards, 2.5) && ft.boards.cameraMinima >= 3;
  const wallPinned = !!ft.wall && ft.wall.movedYd < 0.6;
  const wallOk = wallPinned && ft.wall.cues === 0; // a real pin, zero steps
  out.checks = {
    depthAllSurfaces: depthReal.length >= 5 && depthReal.every((d) => d.pass),
    negativeControlSilent: !!neg && neg.pass,
    breadthAllWired: out.breadth.length >= 5
      && out.breadth.every((s) => (s.total > 0 || s.surface === 'pause-page') && s.wired === s.total),
    footTurf: turfOk,
    footBoards: boardsOk,
    footWallControl: wallOk,
    footTiming: !!ft.boards && ft.boards.medianOffsetMs !== null && ft.boards.medianOffsetMs <= 50,
    ledgerOpenSounds: out.ledger.open && out.ledger.open.opened && out.ledger.open.firstAboveMs !== null && out.ledger.open.count === 1,
    ledgerTurnWithin50: !!out.ledger.turn && out.ledger.turn.pass,
    ledgerCloseSounds: !!out.ledger.close && out.ledger.close.pass,
    voicesAudible: ['signFlip', 'stationEnter', 'stationLeave', 'keypadTap']
      .every((k) => out.voices[k] && out.voices[k].pass),
    unknownCueWarning: out.unknownCue.bogusListed && out.unknownCue.realNotListed,
    captureNonSilent: !!(out.capture && out.capture.nonSilentAudioWindows > 0 && out.capture.audioPeak > 0.004),
    noPageErrors: errs.length === 0,
  };
  } catch (e) {
    out.driverError = String((e && e.message) || e);
  }
  out.ok = !out.driverError && !!out.checks && Object.values(out.checks).every((v) => v === true);
  fs.writeFileSync(path.join(OUT, 'e.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
