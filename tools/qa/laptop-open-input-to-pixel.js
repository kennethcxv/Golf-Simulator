// WHAT DOES OPENING THE LAPTOP COST, FROM THE KEY TO A USABLE SCREEN?
//
// Goal 36 profiled the open on the owner's save: the interface build is 14 ms
// and the rest is DECLARED TIMER -- lid choreography (420/470/900 ms). So the
// open is not a stall and never was; it is theater. This driver measures what
// the theater costs from the player's side, twice:
//
//   open #1  the session's first -- the machine boots (lid, power light, bar)
//   open #2  after an exit that leaves the lid open on the lock screen
//
// The distinction is the point. exitLaptop() leaves `laptopScreen('desk')` --
// lid open, lock screen showing -- and if open #2 replays the full boot
// theater against that picture, the sim is lying (a woken laptop does not
// boot) and the player pays ~900 ms for the lie on every open after the first.
//
// Two stamps per open, both from the REAL key press:
//   ack    key -> the app enters laptop mode (camera starts, lid commanded)
//   usable key -> the interface is actually visible on the glass
//
//   node tools/qa/run-electron.cjs tools/qa/laptop-open-input-to-pixel.js --clubhouse=pine-hills-v2
//
// THE CONTROL: before measuring, one press is made with the prompt NOT on the
// laptop; it must open nothing. An instrument that cannot tell "the key did
// something" from "the key did the thing I aimed at" reports lid theater for
// whatever station happened to be underfoot.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/laptop-open';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], opens: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  await page.waitForTimeout(2000);

  // The laptop needs to be installed for the E-prompt to exist at all. The
  // real gate is campaign.facilities (facilityInstalled in sim/campaign.js);
  // the first cut wrote a field nothing reads.
  await page.evaluate(() => {
    const st = window.__fw.state;
    if (st?.campaign?.enabled && st.campaign.facilities) st.campaign.facilities.laptop = true;
  });

  // CONTROL FIRST: stand away from every station and press E. Nothing may open.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const p = ch.localToWorld(0, 2.0); // open floor
    const w = window.__fw.scene3d.walk.state;
    w.x = p.x; w.z = p.z;
  });
  await page.waitForTimeout(600);
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  const controlOpened = await page.evaluate(() => ({
    laptop: !!window.__fw.laptopOpen,
    mode: document.body.classList.contains('laptop-mode'),
  }));
  if (controlOpened.laptop || controlOpened.mode) {
    fail('control: E on open floor opened the laptop — the aim guard below is not real');
  }

  // Stand where the STAFF stands -- the register's cashier pose is the one
  // dependable desk-side anchor the clubhouse exposes -- then sweep yaw and
  // sidestep along the desk until walk.getFocusLabel() names the laptop. The
  // focus label is the exact gate the player's own E goes through; a DOM
  // selector was tried first and matched nothing that exists.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const pose = ch.register?.cashierPose?.();
    if (pose) {
      const w = fw.scene3d.walk.state;
      w.x = pose.x; w.z = pose.z;
      if (typeof pose.yaw === 'number') w.yaw = pose.yaw;
    }
  });
  await page.waitForTimeout(500);

  const focusLabel = () => page.evaluate(() => {
    const l = window.__fw.scene3d.walk.getFocusLabel?.();
    return l && /laptop/i.test(l) ? l : null;
  });
  let prompt = await focusLabel();
  for (let leg = 0; leg < 8 && !prompt; leg += 1) {
    for (let i = 0; i < 16 && !prompt; i += 1) {
      await page.evaluate(() => {
        const w = window.__fw.scene3d.walk.state;
        w.yaw += Math.PI / 8;
      });
      await page.waitForTimeout(90);
      prompt = await focusLabel();
    }
    if (!prompt) {
      // sidestep half a metre along the desk line and sweep again
      await page.evaluate((dir) => {
        const w = window.__fw.scene3d.walk.state;
        w.x += Math.cos(w.yaw) * 0.5 * dir;
        w.z += Math.sin(w.yaw) * 0.5 * dir;
      }, leg % 2 ? 1 : -1);
      await page.waitForTimeout(150);
    }
  }
  out.prompt = prompt;
  if (!prompt) {
    fail('never saw the laptop E-prompt — the presses below are hook-level, not player-level');
  }

  const openOnce = async (label) => {
    await page.evaluate(() => {
      const w = window.__fwLaptopWatch = { ack: null, usable: null, t0: null };
      w.t0 = performance.now();
      // TIMER-POLLED, NOT rAF-POLLED. This machine throws multi-second rAF
      // outages with a healthy main thread (measured on both builds); an
      // rAF-sampled watcher adds the outage to every stamp and the assertion
      // flakes on the machine instead of failing on the build.
      const tick = () => {
        const now = performance.now();
        if (w.ack == null && document.body.classList.contains('laptop-mode')) w.ack = now - w.t0;
        const root = document.querySelector('.laptop-screen');
        if (w.usable == null && root) {
          const cs = getComputedStyle(root);
          const vis = cs.visibility !== 'hidden' && cs.display !== 'none' && root.offsetWidth > 0;
          if (vis) w.usable = now - w.t0;
        }
        if (w.usable == null && now - w.t0 < 15000) setTimeout(tick, 5);
      };
      setTimeout(tick, 0);
    });
    if (prompt) {
      await page.keyboard.press('e');
    } else {
      await page.evaluate(() => { window.__fw.scene3d.walk.hooks.openLaptop?.(); });
    }
    await page.waitForFunction(() => window.__fwLaptopWatch?.usable != null, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const w = window.__fwLaptopWatch;
      const gaps = (window.__fwBlocks?.gaps || []).filter((g) => g.t >= w.t0 && g.t <= w.t0 + w.usable + 50).map((g) => g.ms);
      gaps.sort((a, b) => a - b);
      return {
        ack: w.ack,
        usable: w.usable,
        worstBlock: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : null,
      };
    });
    out.opens.push({ label, ack: +r.ack?.toFixed(1), usable: +r.usable?.toFixed(1), worstBlock: r.worstBlock });
    console.log(`${label.padEnd(26)} ack ${String(r.ack?.toFixed(1)).padStart(7)} ms   usable ${String(r.usable?.toFixed(1)).padStart(8)} ms   worst block ${String(r.worstBlock).padStart(8)} ms`);
  };

  // block recorder for attribution: a 0 ms timer chain, running through both opens
  await page.evaluate(() => {
    const rec = { gaps: [], stop: false };
    window.__fwBlocks = rec;
    let last = performance.now();
    const loop = () => {
      const t = performance.now();
      rec.gaps.push({ t, ms: t - last });
      last = t;
      if (!rec.stop) setTimeout(loop, 0);
    };
    setTimeout(loop, 0);
  });

  // PROFILE open #1: the first cut found a single 12.8 s main-thread block in
  // it, and a block that size deserves a name, not a guess. CDP sampling
  // profiler around the press; top self-time functions printed.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await openOnce('open #1 (session boot)');
  const prof = await cdp.send('Profiler.stop');
  {
    const nodes = new Map(prof.profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = prof.profile.timeDeltas || [];
    const samples = prof.profile.samples || [];
    for (let i = 0; i < samples.length; i += 1) {
      self.set(samples[i], (self.get(samples[i]) || 0) + (dt[i] || 0));
    }
    const top = [...self.entries()]
      .map(([id, us]) => ({ n: nodes.get(id), ms: us / 1000 }))
      .filter((e) => e.n && e.ms > 100)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 12);
    console.log('open #1 self-time over 100 ms:');
    for (const e of top) {
      const f = e.n.callFrame;
      const where = `${(f.url || '').split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
      console.log(`  ${e.ms.toFixed(0).padStart(7)} ms  ${f.functionName || '(anonymous)'}  ${where}`);
    }
    out.openOneTop = top.map((e) => ({
      ms: +e.ms.toFixed(0),
      fn: e.n.callFrame.functionName || '(anonymous)',
      url: e.n.callFrame.url,
      line: e.n.callFrame.lineNumber + 1,
    }));
  }
  await page.waitForTimeout(700);
  // Leave the way a player can: the laptop's own close button. (A synthetic
  // Escape did not close it on the first cut; the button calls the same
  // opts.close() the mouse does.)
  await page.evaluate(() => { document.querySelector('.lt-close')?.click(); });
  await page.waitForFunction(() => !window.__fw.laptopOpen, null, { timeout: 5000 }).catch(() => {});
  const closed = await page.evaluate(() => !window.__fw.laptopOpen);
  if (!closed) fail('could not leave the laptop between opens — open #2 below is meaningless');
  await page.waitForTimeout(600);
  await openOnce('open #2 (lid already open)');

  // THE ASSERTIONS, compositor-immune on purpose: `usable - ack` subtracts any
  // rAF outage that lands before the mode change is even observed (a machine
  // phenomenon measured on both builds), and the block ceiling is read from
  // the timer queue, which the compositor cannot starve. On the unfixed build
  // open #1 carried a 4.8-12.8 s main-thread block and usable-ack read
  // 5.3-13.3 s; the fixed build's theater is 900 ms (boot) and 240 ms (wake).
  const o1 = out.opens[0];
  const o2 = out.opens[1];
  const span = (o) => (o && o.usable != null && o.ack != null ? o.usable - o.ack : null);
  // Ceilings sit between the measured populations, with the machine's rAF
  // outages already inside them: fixed boot spans measured 916-1663 ms against
  // 2005-2008 with the sync catalogue forced; wake spans 250-668 against 900+
  // when the boot replays. The rig-warm check is the binary one: the fixed
  // build stamps its veil cost into __fwWarm.thumbRig, the unfixed build has
  // nothing there to stamp.
  if (o1 && (span(o1) == null || span(o1) > 1900)) {
    fail(`open #1 took ${span(o1)?.toFixed(0)} ms from mode change to a usable screen (ceiling 1900) — the catalogue is being paid synchronously again`);
  }
  if (o1 && o1.worstBlock != null && o1.worstBlock > 400) {
    fail(`open #1 blocked the main thread for ${o1.worstBlock} ms (ceiling 400)`);
  }
  // The wake verdict discriminates by SIGNATURE, not by one ceiling. A replayed
  // boot is TIMER-paced: its span sits in the 800-1900 ms theater band and
  // cannot leave it. This machine's compositor outages sit ABOVE that band
  // (measured 2.0-5.7 s) with a near-idle main thread. So the band is the
  // defect; above the band with small blocks is the machine, and the leg is
  // retried once rather than blamed on the build.
  let wakeLeg = o2;
  const outageShaped = (o) => o && span(o) > 1900 && (o.worstBlock == null || o.worstBlock < 150);
  if (outageShaped(wakeLeg)) {
    console.log(`open #2 span ${span(wakeLeg).toFixed(0)} ms with worst block ${wakeLeg.worstBlock} ms — outage-shaped, retrying the wake leg once`);
    await page.evaluate(() => { document.querySelector('.lt-close')?.click(); });
    await page.waitForFunction(() => !window.__fw.laptopOpen, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    await openOnce('open #3 (wake retry)');
    wakeLeg = out.opens[out.opens.length - 1];
  }
  if (wakeLeg && span(wakeLeg) != null && span(wakeLeg) > 800 && span(wakeLeg) <= 1900) {
    fail(`the wake open took ${span(wakeLeg).toFixed(0)} ms from mode change to usable — that is the boot theater band; a woken laptop is replaying the boot`);
  }
  if (wakeLeg && outageShaped(wakeLeg)) {
    fail(`two consecutive wake opens were eaten by compositor outages (${span(wakeLeg).toFixed(0)} ms, blocks ${wakeLeg.worstBlock} ms) — the wake leg is UNMEASURED this run, not green`);
  }
  if (wakeLeg && wakeLeg.worstBlock != null && wakeLeg.worstBlock > 400) {
    fail(`the wake open blocked the main thread for ${wakeLeg.worstBlock} ms (ceiling 400)`);
  }
  const rigWarm = await page.evaluate(() => window.__fwWarm?.thumbRig ?? null);
  out.rigWarm = rigWarm;
  if (!rigWarm || !String(rigWarm).startsWith('ms:')) {
    fail(`the thumbnail rig was not warmed under the veil (read ${JSON.stringify(rigWarm)}) — the first product card pays the rig's shader compiles in hand`);
  }

  fs.writeFileSync(`${OUT}/laptop-open.json`, JSON.stringify(out, null, 2));
  console.log(`failures: ${out.failures.length}`);
  return out;
}
