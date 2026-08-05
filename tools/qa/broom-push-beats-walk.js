// D7 — the push really does beat the walk now, measured on the debris.
//
// `pushSpeed` was 2.6 while the player walked at 3.4, so a walking sweep
// overran its own pile. The test could not see it because it compared against a
// hand-written copy of a walk speed that had since changed. Both are fixed, but
// "the constant is now bigger" is a claim about a number; this is the claim
// about the game: WALK FORWARD WHILE SWEEPING AND THE PILE STAYS AHEAD OF YOU.
//
// Measured as the signed forward distance from the bristle contact point to the
// pile, along the player's own facing, sampled every frame of a real walk. It
// must never go negative — negative means the pile is behind the bristles, which
// is exactly the "dirt pops out behind the broom" the number exists to prevent.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/push-beats-walk');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    const debris = await import(new URL('src/sim/cleaningDebris.js', document.baseURI).href);
    app.__debrisModule = debris;
    const feel = await import(new URL('src/data/broomFeel.js', document.baseURI).href);
    const loco = await import(new URL('src/data/locomotion.js', document.baseURI).href);
    w.clearKeys();
    // A long clear lane down the sales floor, facing -z, so a forward walk has
    // room to run and nothing to collide with.
    // The sales floor runs east-west. yaw -PI/2 faces -x, which is the open
    // lane; an earlier version of this driver faced -z from here, walked into a
    // fixture after 1.9 yd and read 0.000 yd/s — see the note on the walk below.
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.42;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card')
      .forEach((n) => { n.style.display = 'none'; });
    // One pile, planted a stride in front of the player, so the measurement is
    // about that pile rather than about whatever the room happened to seed.
    const list = debris.ensureDebris(app.state);
    list.length = 0;
    const fx = -Math.sin(w.state.yaw);
    const fz = -Math.cos(w.state.yaw);
    list.push({ x: w.state.x + fx * 0.9, z: w.state.z + fz * 0.9, a: 1, kind: 'grit' });
    return {
      pushSpeed: feel.BROOM_FEEL.dirt.pushSpeed,
      walkSpeed: loco.WALK_SPEED_YD_S,
      runSpeed: loco.RUN_SPEED_YD_S,
      pile: { x: list[0].x, z: list[0].z },
    };
  });
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: path.join(OUT, 'a-before.png') });

  // Walk forward, sweeping, through the real key path.
  //
  // WHAT WENT WRONG HERE THREE TIMES, because it is worth more than the result:
  // this driver read 0.000 yd/s of player movement and I concluded that
  // page.keyboard.down('w') does not work under Electron, and wrote that up as
  // a harness defect affecting twenty drivers. It was wrong. walk.moveIntent —
  // a seam built for exactly this question, whose own comment says position
  // delta "reads identically for 'the key never arrived' and 'a wall was in the
  // way'" — showed 130 frames of forward intent during those zero readings. The
  // key arrived, landed in walkHeld and the movement block acted on it every
  // frame. The player was walking into a fixture. Facing the open lane, the
  // same press moves 0.935 yd (tools/qa/walk-input-probe.js).
  //
  // So the intent counter is read alongside the position now, and the driver
  // reports both: a run where the player wanted to move and could not is a
  // blocked lane, not a dead input, and it must never again be mistaken for one.
  // FIND AN OPEN RUN RATHER THAN ASSUMING ONE.
  //
  // The room is full of fixtures and a start pose that faces one produces a
  // walk of 0.0 yd with full forward intent — which is what sent this driver
  // chasing a non-existent input bug. So try each cardinal facing, keep the one
  // the player actually covers ground in, and fail loudly if none of them work.
  const lanes = [];
  for (const yaw of [-Math.PI / 2, Math.PI / 2, 0, Math.PI]) {
    const from = await page.evaluate((y) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.clearKeys();
      w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = y; w.state.pitch = -0.42;
      return { x: w.state.x, z: w.state.z };
    }, yaw);
    await page.waitForTimeout(350);
    await page.keyboard.down('w');
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
    const to = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      return { x: w.state.x, z: w.state.z };
    });
    lanes.push({ yaw: +yaw.toFixed(3), ranYd: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(3) });
  }
  const best = lanes.reduce((a, b) => (b.ranYd > a.ranYd ? b : a));
  await page.evaluate((y) => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = y; w.state.pitch = -0.42;
    // The pile goes where the BRISTLES are, not where the player is. The broom's
    // contact point sits ~1.8 yd downrange, so a pile a stride in front of the
    // player's feet is behind the head and outside the 0.66 yd sweep radius —
    // which is why an earlier run swept nothing while reporting 147 planted
    // frames. Seeded from the tool's own live contact socket.
    const debris = app.__debrisModule;
    const g = w.heldToolGeometry ? w.heldToolGeometry() : null;
    if (debris) {
      const list = debris.ensureDebris(app.state);
      list.length = 0;
      const fx = -Math.sin(y);
      const fz = -Math.cos(y);
      const at = (g && g.contactWorld)
        ? { x: g.contactWorld.x, z: g.contactWorld.z }
        : { x: w.state.x + fx * 1.7, z: w.state.z + fz * 1.7 };
      list.push({ x: at.x, z: at.z, a: 1, kind: 'grit' });
    }
  }, best.yaw);
  await page.waitForTimeout(700);

  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
  await page.evaluate(() => window.__fw.scene3d.walk.moveIntent.begin());
  await page.keyboard.down('w');
  const trace = await page.evaluate(async () => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const debris = await import(new URL('src/sim/cleaningDebris.js', document.baseURI).href);
    const rows = [];
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const list = debris.debrisState(app.state);
        const g = w.broomDiagnostics ? w.broomDiagnostics() : null;
        const pile = list[0];
        if (pile) {
          const fx = -Math.sin(w.state.yaw);
          const fz = -Math.cos(w.state.yaw);
          rows.push({
            ms: Math.round(performance.now() - started),
            playerToPile: +((pile.x - w.state.x) * fx + (pile.z - w.state.z) * fz).toFixed(4),
            playerX: +w.state.x.toFixed(4),
            playerZ: +w.state.z.toFixed(4),
            pileX: +pile.x.toFixed(4),
            pileZ: +pile.z.toFixed(4),
            planted: g ? g.workBlend > 0.6 : null,
          });
        }
        if (performance.now() - started >= 2600) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return rows;
  });
  await page.keyboard.up('w');
  const intent = await page.evaluate(() => {
    const r = window.__fw.scene3d.walk.moveIntent.read();
    window.__fw.scene3d.walk.moveIntent.end();
    return r;
  });
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'b-after.png') });

  const first = trace[0];
  const last = trace[trace.length - 1];
  const walked = Math.hypot(last.playerX - first.playerX, last.playerZ - first.playerZ);
  const pileMoved = Math.hypot(last.pileX - first.pileX, last.pileZ - first.pileZ);
  const seconds = (last.ms - first.ms) / 1000;
  const summary = {
    frames: trace.length,
    seconds: +seconds.toFixed(2),
    declaredPushSpeed: setup.pushSpeed,
    declaredWalkSpeed: setup.walkSpeed,
    playerYdPerSec: +(walked / seconds).toFixed(3),
    pileYdPerSec: +(pileMoved / seconds).toFixed(3),
    gapStart: first.playerToPile,
    gapEnd: last.playerToPile,
    minGap: +Math.min(...trace.map((r) => r.playerToPile)).toFixed(4),
    framesPlanted: trace.filter((r) => r.planted).length,
    // what the movement block WANTED, independent of whether it got it
    moveIntentFrames: intent.frames,
    moveIntentMovingFrames: intent.movingFrames,
    lanesTried: lanes,
    laneChosen: best,
  };
  const checks = {
    // the movement block wanted to move — separates a dead input from a wall
    movementWasRequested: intent.movingFrames > 20,
    // and the player really did walk — otherwise the whole run proves nothing.
    // Sweeping is slower than a clear walk (the tool consults the collider and
    // the stroke gates movement), so this is a floor on "did they cover ground",
    // not a claim about matching WALK_SPEED_YD_S.
    playerActuallyMoved: walked > 0.2,
    // the pile really was swept, not merely walked past
    pileActuallyMoved: pileMoved > 0.3,
    // THE INVARIANT: the pile never ends up behind the bristles
    pileStaysAhead: summary.minGap > 0,
    // and it keeps up: over the run, the pile travels at least as far as the player
    pileKeepsPace: pileMoved >= walked * 0.9,
  };
  fs.writeFileSync(path.join(OUT, 'push-beats-walk.json'),
    `${JSON.stringify({ setup, summary, checks, trace }, null, 1)}\n`);
  // UNFINISHED, AND IT SAYS SO RATHER THAN SCORING.
  //
  // If the player did not move, nothing below it means anything: a stationary
  // player never overruns a pile, so `pileStaysAhead` passes trivially and the
  // run reads as "the push beats the walk, confirmed". Four ways of walking
  // have been tried here (page.keyboard.down, a rAF-side state write, a
  // driver-side stepped write, and a synthetic document keydown) and all four
  // measured 0.000 yd/s INSIDE this driver — though the synthetic keydown does
  // move the player 0.85 yd in isolation, see tools/qa/walk-input-probe.js.
  // Until that is resolved this driver refuses to answer.
  if (!checks.playerActuallyMoved) {
    return {
      setup,
      summary,
      checks,
      ok: false,
      inconclusive: true,
      why: checks.movementWasRequested
        ? 'The movement block asked to move on ' + intent.movingFrames + ' frames and the '
          + 'player did not: the lane is blocked, not the input. Move the start pose.'
        : 'No forward intent was recorded, so the key never reached walkHeld. This is the '
          + 'input path, not the lane.',
    };
  }
  return { setup, summary, checks, ok: Object.values(checks).every(Boolean) };
}
