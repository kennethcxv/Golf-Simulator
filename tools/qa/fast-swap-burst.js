// SWAPPING ITEMS FAST — the belt scrubbed like a player, not tapped like a QA.
//
// tool-swap-input-to-pixel taps F every ~1.5 s and measures each press in
// isolation; the owner's complaint is "swapping items FAST". This driver
// scrubs: bursts of F at human-scrub cadence (180 ms between downs), and it
// measures the two things a scrub can break that isolated taps cannot see:
//
//   1. how many presses the game actually APPLIED (a scrub that eats inputs
//      reads as lag even when each applied swap is fast), and
//   2. settle: from the LAST key-up of the burst to the viewmodel of the
//      final tool actually drawn -- the number the player feels when they
//      stop scrubbing on the tool they wanted.
//
//   node tools/qa/run-electron.cjs tools/qa/fast-swap-burst.js --clubhouse=pine-hills-v2
//
// THE CONTROL: a deliberate 300 ms main-thread block injected during one
// burst must inflate that burst's settle by roughly the block. An instrument
// that cannot see a block it was handed cannot certify a scrub as smooth.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/fast-swap';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], bursts: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // Warm every belt tool once through the API, the same rule the tap driver
  // learned: a first-ever equip pays a real load and would masquerade as
  // scrub lag.
  await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const tools = walk.beltTools?.() || ['broom', 'mop', 'spray', 'sponge', 'trashbag'];
    for (const t of tools) {
      walk.setTool?.(t);
      await new Promise((r) => { setTimeout(r, 120); });
    }
    walk.setTool?.(null);
  }).catch(() => {});
  await page.waitForTimeout(800);

  const burst = async (label, presses, gapMs, injectBlock) => {
    await page.evaluate(() => {
      window.__fwScrub = { t0: null, lastUp: null, settled: null, applied: 0, startTool: window.__fw.scene3d.walk.getTool?.() ?? null };
      const walk = window.__fw.scene3d.walk;
      let last = walk.getTool?.() ?? null;
      const poll = () => {
        const cur = walk.getTool?.() ?? null;
        if (cur !== last) { window.__fwScrub.applied += 1; last = cur; }
        if (!window.__fwScrub.stop) setTimeout(poll, 4);
      };
      setTimeout(poll, 0);
    });
    const t0 = Date.now();
    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.down('f');
      await page.waitForTimeout(70);
      await page.keyboard.up('f');
      if (injectBlock && i === Math.floor(presses / 2)) {
        await page.evaluate(() => {
          const until = performance.now() + 300;
          while (performance.now() < until) { /* deliberate block */ }
        });
      }
      await page.waitForTimeout(Math.max(0, gapMs - 70));
    }
    const lastUpAt = Date.now() - t0;
    // settle: wait for the viewmodel to stop changing (stable for 400 ms)
    const settle = await page.evaluate(async () => {
      const walk = window.__fw.scene3d.walk;
      const t1 = performance.now();
      let lastTool = walk.getTool?.() ?? null;
      let lastChange = t1;
      for (;;) {
        await new Promise((r) => { setTimeout(r, 16); });
        const now = performance.now();
        const cur = walk.getTool?.() ?? null;
        if (cur !== lastTool) { lastTool = cur; lastChange = now; }
        if (now - lastChange > 400) return { settleMs: +(lastChange - t1).toFixed(1), finalTool: lastTool };
        if (now - t1 > 8000) return { settleMs: null, finalTool: lastTool };
      }
    });
    const scrub = await page.evaluate(() => { window.__fwScrub.stop = true; return window.__fwScrub; });
    const row = {
      label,
      presses,
      gapMs,
      applied: scrub.applied,
      settleMs: settle.settleMs,
      finalTool: settle.finalTool,
      wallMs: lastUpAt,
    };
    out.bursts.push(row);
    console.log(`${label.padEnd(34)} presses ${presses} @ ${gapMs} ms   applied ${String(scrub.applied).padStart(2)}   settle after last press ${String(settle.settleMs).padStart(7)} ms   final ${settle.finalTool}`);
    await page.waitForTimeout(900);
    return row;
  };

  const b1 = await burst('scrub 8 presses @180ms', 8, 180, false);
  const b2 = await burst('scrub 8 presses @180ms (repeat)', 8, 180, false);
  const b3 = await burst('scrub 12 presses @150ms', 12, 150, false);
  const control = await burst('CONTROL scrub + 300ms block', 8, 180, true);

  // The control: the injected block must be visible in the settle or the wall.
  const cleanSettles = [b1.settleMs, b2.settleMs].filter((v) => v != null);
  const base = cleanSettles.length ? Math.min(...cleanSettles) : null;
  if (base != null && control.settleMs != null && control.wallMs < b1.wallMs + 200 && control.settleMs < base + 180) {
    fail(`the control's 300 ms block left no trace (settle ${control.settleMs} vs ${base}, wall ${control.wallMs} vs ${b1.wallMs}) — this instrument cannot see a block`);
  }

  // The verdicts: a scrub must apply presses and settle promptly.
  for (const b of [b1, b2, b3]) {
    if (b.applied < Math.floor(b.presses * 0.75)) {
      fail(`${b.label}: only ${b.applied} of ${b.presses} presses applied — the belt eats fast input`);
    }
    if (b.settleMs == null || b.settleMs > 700) {
      fail(`${b.label}: viewmodel settled ${b.settleMs} ms after the last press (ceiling 700) — the scrub lags behind the hand`);
    }
  }

  // __fwFrameHealth cross-check: the control burst injected a real 300 ms
  // block into play, so the in-game recorder must hold at least one gap over
  // 250 ms with the verdict *blocked*. This is the recorder's negative control
  // riding an existing one.
  out.frameHealth = await page.evaluate(() => window.__fwFrameHealth || null);
  const blockedSeen = !!out.frameHealth?.recent?.some((e) => e.verdict === 'blocked' && e.gapMs >= 250);
  if (!blockedSeen) {
    fail('window.__fwFrameHealth never recorded the deliberate 300 ms block as a blocked gap — the in-game recorder is blind');
  }
  console.log(`frameHealth: gaps250 ${out.frameHealth?.gaps250} gaps900 ${out.frameHealth?.gaps900} worst ${out.frameHealth?.worstMs} ms (${out.frameHealth?.mainThreadShare})`);
  fs.writeFileSync(`${OUT}/fast-swap.json`, JSON.stringify(out, null, 2));
  console.log(`failures: ${out.failures.length}`);
  return out;
}
