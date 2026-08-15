// PLAYTEST 5, ITEM 3 — THE PART STILL OUTSTANDING FROM LAST ROUND.
//
//   "When I come back and somebody is standing inside me, I should just move a
//    bit. You rate-limited the clamp but could not stage an overlap to watch the
//    nudge fire. It still needs proving."
//
// WHY THE LAST ATTEMPT COULD NOT STAGE IT, and it is on the ledger as probe lie
// 36: it wrote the CUSTOMER's `mesh.position` to place them inside the player.
// That does not stick. A customer's mesh is re-driven from their own state every
// frame, so the write was overwritten before the next sample and the run read
// 0.72 yd -- which is where they already were.
//
// So this moves the PLAYER instead. `walk.x` / `walk.z` ARE the player's
// position: the walk controller integrates them and the camera is derived from
// them, so writing them is the same thing the W key does, only instantly. That
// is also the owner's scenario in the first place -- he comes BACK to somewhere
// and finds a body in it.
//
// The instrument is the clubhouse's own `qaPlayerSeparation()`: `nudgeYards` and
// `nudgeFrames` are the separator's own counters, so this reads what the game
// did rather than inferring it from positions.
//
// NEGATIVE CONTROL: the same counters are watched for four seconds with the
// player standing well clear of everybody. They must NOT move. A nudge counter
// that ticks with nobody nearby is measuring the frame loop, not the separator,
// and the overlap result below would mean nothing.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-player-nudge-fires.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/player-nudge-fires');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  out.api = await page.evaluate(() => {
    const ch = window.__fw?.scene3d?.clubhouse?.();
    return {
      hasSeparation: typeof ch?.qaPlayerSeparation === 'function',
      hasSpawn: typeof ch?.debugSpawn === 'function',
      sample: ch?.qaPlayerSeparation?.() ?? null,
    };
  });
  console.log(`separation API: ${JSON.stringify(out.api)}`);
  if (!out.api.hasSeparation) {
    console.log('NO qaPlayerSeparation — cannot measure. Aborting rather than reporting a number.');
    fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  await page.evaluate(() => {
    const st = window.__fw.state;
    if (st?.shop) st.shop.signOpen = true;
    if (st?.campaign) st.campaign.businessOpen = true;
    const ch = window.__fw.scene3d.clubhouse();
    for (let i = 0; i < 3; i += 1) ch.debugSpawn?.(false);
  });
  await page.evaluate(() => { window.__fw.speedIdx = 1; });

  const sep = () => page.evaluate(() => window.__fw.scene3d.clubhouse().qaPlayerSeparation());

  // Wait for somebody to actually be inside the building and visible.
  let found = null;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(3000);
    found = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const list = (ch.customers?.() || []).filter((c) => c?.mesh && c.mesh.visible !== false);
      if (!list.length) return null;
      const c = list[0];
      return { name: c.fullName || c.name, x: +c.mesh.position.x.toFixed(3), z: +c.mesh.position.z.toFixed(3), count: list.length };
    });
    console.log(`  +${(i + 1) * 3}s  customers on the floor: ${found ? found.count : 0}`);
    if (found) break;
  }
  out.customer = found;
  if (!found) {
    console.log('nobody came in — INCONCLUSIVE, not a pass');
    out.verdict = { result: 'INCONCLUSIVE — no customer ever reached the floor' };
    fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // ------------------------------------------------------- NEGATIVE CONTROL
  // Stand well clear and watch the separator's own counters stay put.
  out.controlBefore = await sep();
  await page.waitForTimeout(4000);
  out.controlAfter = await sep();
  out.controlMoved = (out.controlAfter.nudgeFrames - out.controlBefore.nudgeFrames) !== 0
    || Math.abs(out.controlAfter.nudgeYards - out.controlBefore.nudgeYards) > 1e-6;
  console.log(`\nCONTROL, standing clear (${out.controlBefore.nearestCustomer} yd away): `
    + `frames ${out.controlBefore.nudgeFrames} -> ${out.controlAfter.nudgeFrames}, `
    + `yards ${out.controlBefore.nudgeYards} -> ${out.controlAfter.nudgeYards} `
    + `${out.controlMoved ? '<<< COUNTERS MOVED WITH NOBODY NEAR — INSTRUMENT SUSPECT' : 'still — the counters only move for a real overlap'}`);

  // ------------------------------------------------------------ the overlap
  // Put the PLAYER on the customer. walk.x/walk.z is the player's position.
  const before = await sep();
  out.staged = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const list = (ch.customers?.() || []).filter((c) => c?.mesh && c.mesh.visible !== false);
    const c = list[0];
    const walk = fw.scene3d.walk.state;
    const from = { x: +walk.x.toFixed(3), z: +walk.z.toFixed(3) };
    walk.x = c.mesh.position.x;
    walk.z = c.mesh.position.z;
    return { from, onto: { x: +c.mesh.position.x.toFixed(3), z: +c.mesh.position.z.toFixed(3) } };
  });
  console.log(`\nplayer moved ${JSON.stringify(out.staged.from)} -> ${JSON.stringify(out.staged.onto)} (standing IN them)`);

  // Sample every rAF: the nudge is rate-limited, so it is a slow crawl and a
  // coarse sampler could miss its whole life.
  out.series = [];
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(250);
    const s = await sep();
    out.series.push({ t: i * 250, ...s });
  }
  const after = out.series[out.series.length - 1];
  out.before = before;
  out.after = after;

  console.log('\nSEPARATION AFTER THE OVERLAP (every 250 ms):');
  for (const s of out.series.filter((_, i) => i % 3 === 0)) {
    console.log(`  t=${String(s.t).padStart(4)}ms  nearest ${String(s.nearestCustomer).padEnd(8)} `
      + `clearance ${s.clearance}  nudged ${s.nudgeYards} yd over ${s.nudgeFrames} frames  blocking=${s.blocking}`);
  }

  out.verdict = {
    controlHeldStill: !out.controlMoved,
    nudgeFramesFired: after.nudgeFrames - before.nudgeFrames,
    nudgeYardsMoved: +(after.nudgeYards - before.nudgeYards).toFixed(4),
    nearestAtStart: out.series[0]?.nearestCustomer ?? null,
    nearestAtEnd: after.nearestCustomer,
    clearance: after.clearance,
    separated: after.nearestCustomer != null && after.nearestCustomer >= after.clearance,
  };
  out.verdict.result = out.controlMoved ? 'INSTRUMENT SUSPECT — control counters moved with nobody near'
    : out.verdict.nudgeFramesFired > 0
      ? `NUDGE FIRED — ${out.verdict.nudgeFramesFired} frames, ${out.verdict.nudgeYardsMoved} yd, `
        + `nearest ${out.verdict.nearestAtStart} -> ${out.verdict.nearestAtEnd} yd`
      : 'NUDGE NEVER FIRED — the player stood inside them and nothing moved';
  console.log(`\nVERDICT ${JSON.stringify(out.verdict, null, 2)}`);

  await page.screenshot({ path: path.join(OUT, `${tag}-after.png`) });
  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
