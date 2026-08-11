// DECISION 3 (Goal 24) — IF I AM AIMED AT THE LEDGER, THE PROMPT SAYS LEDGER.
//
// There is already a driver for this (electron-f-ledger-reach.js) and it PASSES,
// and the owner still cannot open the book. That gap is the whole point of this
// file. The old one stands on ONE authored spot, aims at the book's centre once,
// and asks "did it say ledger". A rule that works at exactly one place on the
// floor passes that and fails a player, because a player walks up to the desk
// wherever they happen to be walking.
//
// So this sweeps the STANDING POSITION over the whole approach to the desk and,
// at every one of them, points the camera exactly at the book's centre. The
// crosshair is therefore on the cover BY CONSTRUCTION at every sample, and the
// only thing varying is where the player's feet are. Whatever fraction of those
// says something other than "ledger" is the bug, measured as an area rather than
// as a single anecdote.
//
// CONTROL 1: the book has to be genuinely on screen and under the crosshair, or
// "the prompt is wrong" is just "the book is behind a wall". Every sample
// projects the book to NDC and is discarded if it is not near the centre.
// CONTROL 2: from the SAME spots, aiming at the DESK must name the desk. A rule
// that says "ledger" everywhere is not a fix, it is a new bug, and it would pass
// the positive check alone. This is the owner's sentence in reverse and it is
// the right control; "turn 99 degrees away" was the first version and it was
// wrong, because an articulated prop is allowed to RETAIN the focus it already
// has while you stay in its reach, so turning away kept saying ledger for
// reasons that have nothing to do with this rule. The player is teleported out
// of reach and back between samples so retention cannot answer for the scoring.
//
// CONTROL 3: the requested standing spot is not the standing spot. The collider
// ejects you out of the desk, and the first run of this driver reported seven
// consecutive samples with byte-identical NDC because they had all been pushed
// to the same place -- which reads as "measured 20 positions" and is really
// "measured 13". The position is now read back AFTER the frame.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-d3-crosshair-outranks-station.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d3-crosshair');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], samples: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    ch.setOrganicWalkins?.(false); // no walk-ins wandering through the samples
  });
  await page.waitForTimeout(1000);

  // Stand at (dx, dz) from the book and look straight at it. Yaw/pitch are what
  // a mouse produces; the thing under test is the SCORING, not the mouse.
  const place = (dx, dz) => page.evaluate(({ ox, oz }) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    ch.ledgerBook.root.updateMatrixWorld(true);
    const e = ch.ledgerBook.root.matrixWorld.elements;
    w.x = e[12] + ox; w.z = e[14] + oz; w.vx = 0; w.vz = 0;
  }, { ox: dx, oz: dz });

  // Break focus retention: out of reach for a frame, so the previous sample's
  // prop cannot answer for this one.
  const clearFocus = async () => {
    await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      w.x += 14; w.z += 14; w.vx = 0; w.vz = 0;
    });
    await page.waitForTimeout(200);
  };

  // Aim at a named target from wherever the collider actually left us. Pitch is
  // computed from the LIVE camera height, after the frame that moved the body --
  // computing it in the same evaluate that set the position used the previous
  // pose's camera and threw the aim off by a third of the screen at close range.
  //   'book'  — crosshair on the cover
  //   'level' — same spot, same bearing, looking straight ahead over the desk.
  //             The book lies ON the desk below eye level, so this is exactly
  //             the "standing at the counter not looking at the book" case the
  //             station rule exists to serve, and it must still name the desk.
  const aimAt = (target) => page.evaluate((which) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const cam = app.scene3d.camera;
    ch.ledgerBook.root.updateMatrixWorld(true);
    const e = ch.ledgerBook.root.matrixWorld.elements;
    const t = { x: e[12], y: e[13], z: e[14] };
    const bx = t.x - w.x; const bz = t.z - w.z;
    w.yaw = Math.atan2(-bx, -bz);
    w.pitch = which === 'level' ? -0.05 : Math.atan2(t.y - cam.position.y, Math.hypot(bx, bz));
    return { stand: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) }, target: which };
  }, target);

  // Where the book actually landed on screen, and what the prompt says.
  const readout = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const cam = app.scene3d.camera;
    const walk = app.scene3d.walk;
    ch.ledgerBook.root.updateMatrixWorld(true);
    cam.updateMatrixWorld(true);
    const e = ch.ledgerBook.root.matrixWorld.elements;
    const v = { x: e[12], y: e[13], z: e[14] };
    const proj = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    const m = proj.elements;
    const cw = m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15];
    return {
      label: walk.getFocusLabel?.() || '',
      ndcX: +((m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12]) / cw).toFixed(3),
      ndcY: +((m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13]) / cw).toFixed(3),
      inFront: cw > 0,
    };
  });

  const isBook = (label) => /ledger|the book/i.test(label);
  // A ring of approaches: straight on, from either side, close and far. These
  // are places a player walks to, not places chosen because they work.
  const SPOTS = [];
  for (const dz of [0.7, 1.15, 1.6, 2.1]) {
    for (const dx of [-0.9, -0.45, 0, 0.45, 0.9]) SPOTS.push({ dx, dz });
  }

  // THE SWEEP RUNS TWICE, BARE-HANDED AND HOLDING A MOP, AND THE SECOND PASS IS
  // THE ONE THAT MATTERS.
  //
  // The bare-handed pass was the whole driver at first, and it passed on the
  // UNFIXED build at 16 spots out of 16 — the Goal 20 work that gave stations
  // the shared aim score already made the aimed book beat the desk when your
  // hands are empty. A check that scores identically before and after the change
  // certifies nothing, and this one nearly shipped as the evidence for a fix it
  // could not see. It is kept as the no-regression half.
  //
  // With a tool equipped the prompt is answered by the tool blocks, which return
  // early, several rules above the general prop scan. That is the case the owner
  // is in — walk up to the desk holding something and the book under the
  // crosshair cannot be named — and it is what the new rule changes.
  const equipTool = (tool) => page.evaluate((t) => {
    try {
      const walk = window.__fw.scene3d.walk;
      if (t) walk.setTool(t); else walk.setTool(null);
      return walk.getTool?.() ?? t;
    } catch (e) { return `error: ${e.message || e}`; }
  }, tool);

  const seen = new Set();
  for (let i = 0; i < SPOTS.length; i += 1) {
    const s = SPOTS[i];
    await clearFocus();
    await place(s.dx, s.dz);
    await page.waitForTimeout(260); // let the collider resolve the body first
    const placed = await aimAt('book');
    await page.waitForTimeout(260); // then a frame with the new aim, so focus rescores
    const at = await readout();

    await clearFocus();
    await place(s.dx, s.dz);
    await page.waitForTimeout(260);
    await aimAt('level');
    await page.waitForTimeout(260);
    const level = await readout();

    // ...and the same spot again with a mop in hand.
    out.mopEquipped = await equipTool('mop');
    await clearFocus();
    await place(s.dx, s.dz);
    await page.waitForTimeout(260);
    await aimAt('book');
    await page.waitForTimeout(400);
    const holding = await readout();
    await equipTool(null);
    await page.waitForTimeout(150);

    // CONTROL 3: several requested spots resolve to ONE actual spot. Counting
    // them as separate samples inflates the coverage this claims to have.
    const key = `${placed.stand.x},${placed.stand.z}`;
    const duplicate = seen.has(key);
    seen.add(key);
    out.samples.push({
      ...s,
      stand: placed.stand,
      duplicate,
      label: at.label,
      namesBook: isBook(at.label),
      onScreen: at.inFront && Math.abs(at.ndcX) < 0.25 && Math.abs(at.ndcY) < 0.25,
      ndc: [at.ndcX, at.ndcY],
      levelLabel: level.label,
      levelNamesBook: isBook(level.label),
      holdingLabel: holding.label,
      holdingNamesBook: isBook(holding.label),
      holdingOnScreen: holding.inFront
        && Math.abs(holding.ndcX) < 0.25 && Math.abs(holding.ndcY) < 0.25,
    });
  }

  // Photograph one spot so the crosshair can be SEEN on the cover rather than
  // asserted. The worst spot if there is one, otherwise the furthest.
  const shotSpot = out.samples.find((s) => s.onScreen && !s.namesBook)
    || out.samples[out.samples.length - 1];
  await clearFocus();
  await place(shotSpot.dx, shotSpot.dz);
  await page.waitForTimeout(260);
  await aimAt('book');
  await page.waitForTimeout(500);
  await (await page.$('#game') || page).screenshot({ path: path.join(OUT, 'aimed-at-the-book.png') });

  const usable = out.samples.filter((s) => s.onScreen && !s.duplicate);
  const named = usable.filter((s) => s.namesBook);
  const held = out.samples.filter((s) => s.holdingOnScreen && !s.duplicate);
  const heldNamed = held.filter((s) => s.holdingNamesBook);
  out.measured = {
    spots: out.samples.length,
    // CONTROL 3: distinct places the body actually ended up
    distinctStandingSpots: seen.size,
    // CONTROL 1's yield: samples where the book really was under the crosshair
    usableSpots: usable.length,
    spotsNamingTheBook: named.length,
    spotsNamingSomethingElse: usable.filter((s) => !s.namesBook)
      .map((s) => `dx${s.dx}/dz${s.dz} -> ${s.label.slice(0, 40)}`),
    // CONTROL 2: looking level over the desk must go back to naming the desk
    levelStillNamingTheBook: usable.filter((s) => s.levelNamesBook).length,
    distinctLevelLabels: [...new Set(usable.map((s) => s.levelLabel.slice(0, 40)))],
    // THE DISCRIMINATING HALF: same aim, mop in hand
    heldSpots: held.length,
    heldNamingTheBook: heldNamed.length,
    heldNamingSomethingElse: [...new Set(held.filter((s) => !s.holdingNamesBook)
      .map((s) => s.holdingLabel.slice(0, 44)))],
  };
  // WHAT THIS DRIVER CAN AND CANNOT CERTIFY.
  //
  // Every check below passes on the UNFIXED build too. I ran it three ways —
  // bare-handed, holding a mop, and with a customer at the desk — reverted the
  // rule by file copy each time, and the numbers did not move. The reason is
  // that the ledger is itself registered as a `station`, so Goal 20's shared aim
  // score already resolves book-versus-desk in the book's favour whenever the
  // crosshair is on the cover. The rule the owner asked me to overrule was, in
  // these positions, already overruled.
  //
  // So these are NO-REGRESSION checks and they are labelled as such. They are
  // not evidence that anything was fixed, and this driver must not be cited as
  // if they were. What the change actually buys is generality — any aimed prop
  // now pre-empts, not just one that happens to be flagged `station` — and I
  // have no scenario that can see the difference.
  out.checks = {
    enoughUsableSpots: usable.length >= 8,
    noRegression_everyAimedSpotNamesTheBook:
      usable.length > 0 && named.length === usable.length,
    enoughHeldSpots: held.length >= 8,
    noRegression_namesTheBookWithAToolInHand:
      held.length > 0 && heldNamed.length === held.length,
    noPageErrors: out.errs.length === 0,
  };
  // Reported, not gated: this is TRUE ON BOTH BUILDS and is therefore a standing
  // finding rather than a verdict on the change. Looking level over the counter
  // from a yard away names the ledger, not the desk, at most spots — the exact
  // inverse of the owner's complaint, and the station rule's own purpose.
  out.findings = {
    levelAimNamesTheBookAt: `${out.measured.levelStillNamingTheBook} of ${usable.length} spots`,
    preExisting: 'measured identically with the new rule reverted',
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'crosshair.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log("D3-CROSSHAIR", JSON.stringify({ measured: out.measured, checks: out.checks, findings: out.findings }, null, 2));
  return out;
}
