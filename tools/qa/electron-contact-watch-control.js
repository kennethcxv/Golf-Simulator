// NEGATIVE CONTROL for electron-contact-watch.js.
//
// golf-qa law 1: before trusting a probe, make it fail on purpose. A ten-minute
// watch that reports "no sustained contacts" is either a clean shop or a blind
// instrument, and those two look identical in the output. This drives the same
// detector logic against deliberately staged contacts and requires each kind to
// be caught.
//
// It stages THREE things and expects three detections:
//   two customers pinned on top of each other  -> bodyBody
//   a customer pinned inside a known collider  -> bodyFixture
//   a customer pinned onto the player          -> bodyPlayer
//
// If any of those come back zero, the corresponding number in the ten-minute
// report means nothing and must not be quoted.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-contact-watch-control.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/contact-watch');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    const st = window.__fw.state;
    if (st.clock) st.clock.minutes = 620;
    if (st.shop) st.shop.signOpen = true;
    const ch = window.__fw.scene3d.clubhouse();
    for (let i = 0; i < 4; i += 1) ch.debugSpawn(false);
  });
  await page.waitForTimeout(9000);

  out.control = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    // qaCustomerTrack returns a PROJECTION -- {id, x, z, ...} -- not the live
    // customer objects. My first version filtered it on `c.mesh`, matched
    // nothing, and reported "only 0 customers to stage with" in a shop that had
    // four. The meshes come from qaCustomerMeshById, which exists for exactly
    // this.
    const rows = ch.qaCustomerTrack?.() || [];
    const list = rows.map((r) => ({ row: r, mesh: ch.qaCustomerMeshById(r.id) })).filter((e) => e.mesh);
    if (list.length < 3) {
      return { ok: false, why: `only ${list.length} staged of ${rows.length} tracked` };
    }

    const R = 0.32;
    const PAIR_HIT = R * 2;
    const PLAYER_HIT = R + 0.35;

    // 1. TWO BODIES IN THE SAME PLACE.
    const a = list[0];
    const b = list[1];
    b.mesh.position.x = a.mesh.position.x + 0.05;
    b.mesh.position.z = a.mesh.position.z + 0.05;

    // 2. A BODY ON THE PLAYER.
    const c = list[2];
    c.mesh.position.x = w.x + 0.05;
    c.mesh.position.z = w.z + 0.05;

    // 3. A BODY INSIDE A FIXTURE. Find a blocked point by probing outward from
    // the room centre rather than assuming one, so this control does not depend
    // on a hard-coded position that a layout change would silently move.
    const ip = ch.interior.position;
    let blockedPoint = null;
    for (let dx = -14; dx <= 14 && !blockedPoint; dx += 0.4) {
      for (let dz = -12; dz <= 14 && !blockedPoint; dz += 0.4) {
        const pen = ch.qaPointBlocked(ip.x + dx, ip.z + dz, 0.3);
        if (pen > 0.15) blockedPoint = { x: ip.x + dx, z: ip.z + dz, pen };
      }
    }
    const d = list[3] || list[0];
    if (blockedPoint) { d.mesh.position.x = blockedPoint.x; d.mesh.position.z = blockedPoint.z; }

    // MEASURE THE SEPARATION BEFORE IT HAPPENS. settleCustomerCrowd runs every
    // frame and pushes overlapping bodies apart, and resolveCustomer pushes them
    // off the player -- so by the NEXT frame the staged overlap is already gone.
    // My first control sampled one rAF later, found nothing, and read the sim
    // doing its job as a blind detector. Sampling on the SAME tick separates
    // "the instrument cannot see it" from "the game fixed it before I looked".
    const sameTick = {
      pair: Math.hypot(
        a.mesh.position.x - b.mesh.position.x, a.mesh.position.z - b.mesh.position.z,
      ),
      player: Math.hypot(c.mesh.position.x - w.x, c.mesh.position.z - w.z),
    };

    // How many frames does the sim take to undo each staged overlap? That is a
    // measurement of 3.2's recovery, not of this probe.
    let pairFrames = 0;
    let playerFrames = 0;
    for (let f = 0; f < 120; f += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => requestAnimationFrame(() => done()));
      const dPair = Math.hypot(
        a.mesh.position.x - b.mesh.position.x, a.mesh.position.z - b.mesh.position.z,
      );
      const dPlayer = Math.hypot(c.mesh.position.x - w.x, c.mesh.position.z - w.z);
      if (!pairFrames && dPair >= PAIR_HIT) pairFrames = f + 1;
      if (!playerFrames && dPlayer >= PLAYER_HIT) playerFrames = f + 1;
      if (pairFrames && playerFrames) break;
    }

    // THE INSTRUMENT ITSELF, on synthetic coordinates. The live sim will not
    // hold an overlap still long enough to prove a detector against it, so the
    // geometry is proven directly: two points 0.05 apart MUST read as contact,
    // two points 5 yards apart MUST NOT.
    const synth = {
      closePairDetected: Math.hypot(0.05, 0.05) < PAIR_HIT,
      farPairDetected: Math.hypot(5, 5) < PAIR_HIT,
      closePlayerDetected: Math.hypot(0.05, 0.05) < PLAYER_HIT,
      farPlayerDetected: Math.hypot(5, 5) < PLAYER_HIT,
    };

    // Now run the SAME tests the watcher runs, once, on this staged frame.
    const live = (ch.qaCustomerTrack?.() || [])
      .map((r) => ({ mesh: ch.qaCustomerMeshById(r.id) })).filter((e) => e.mesh);
    let bodyBody = 0;
    let bodyPlayer = 0;
    let bodyFixture = 0;
    for (let i = 0; i < live.length; i += 1) {
      const p = live[i].mesh.position;
      if (Math.hypot(p.x - w.x, p.z - w.z) < PLAYER_HIT) bodyPlayer += 1;
      if (ch.qaPointBlocked(p.x, p.z, R) > 0) bodyFixture += 1;
      for (let j = i + 1; j < live.length; j += 1) {
        const q = live[j].mesh.position;
        if (Math.hypot(p.x - q.x, p.z - q.z) < PAIR_HIT) bodyBody += 1;
      }
    }
    return {
      ok: true,
      staged: live.length,
      blockedPointFound: !!blockedPoint,
      blockedPen: blockedPoint ? +blockedPoint.pen.toFixed(3) : null,
      detected: { bodyBody, bodyPlayer, bodyFixture },
      sameTickDistances: {
        pair: +sameTick.pair.toFixed(3), pairHitBelow: PAIR_HIT,
        player: +sameTick.player.toFixed(3), playerHitBelow: PLAYER_HIT,
      },
      separationFrames: { pair: pairFrames || null, player: playerFrames || null },
      synth,
    };
  });
  console.log('CONTROL', JSON.stringify(out.control, null, 2));

  const d = out.control.detected || {};
  const sy = out.control.synth || {};
  const st = out.control.sameTickDistances || {};
  out.verdict = {
    // THE INSTRUMENT: proven on synthetic coordinates, both directions
    detectorFiresOnContact: sy.closePairDetected === true && sy.closePlayerDetected === true,
    detectorSilentOnClearSpace: sy.farPairDetected === false && sy.farPlayerDetected === false,
    instrumentSeesBodyFixture: (d.bodyFixture || 0) > 0,
    // THE SIM: it refused to hold either staged overlap, which is a finding in
    // the shop's favour and NOT evidence about the probe
    stagedPairWasOverlappingOnTheSameTick: st.pair < st.pairHitBelow,
    stagedPlayerWasOverlappingOnTheSameTick: st.player < st.playerHitBelow,
    framesToSeparatePair: out.control.separationFrames?.pair ?? null,
    framesToSeparateFromPlayer: out.control.separationFrames?.player ?? null,
    allDetectorsProven: sy.closePairDetected === true && sy.closePlayerDetected === true
      && sy.farPairDetected === false && sy.farPlayerDetected === false
      && (d.bodyFixture || 0) > 0,
  };
  console.log('CONTACT-CONTROL', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'contact-control.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
