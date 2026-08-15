// D7 — CAN THE HARNESS MAKE THE PLAYER WALK AT ALL?
//
// Three separate methods measured 0 yd/s in the push-beats-walk driver: holding
// W through Playwright, writing walk.state inside a rAF callback, and writing it
// between frames from the driver side. Before writing any of that up as "the
// broom does not sweep", establish which of them move the player and which do
// not — because ~20 drivers in tools/qa call page.keyboard.down('w') and treat
// what follows as a walk.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    const o = window.__fw.scene3d.clubhouse().interior.position;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 6.0; w.state.yaw = 0; w.state.pitch = 0;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);

  const at = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    return {
      x: +w.state.x.toFixed(4), z: +w.state.z.toFixed(4),
      locked: !!document.pointerLockElement,
      stateIsStable: w.state === w.state,
    };
  });

  // Does the event ARRIVE, and with what target? "the player did not move" has
  // two very different causes — the key never reached the page, or it reached a
  // handler that filtered it — and only this tells them apart. courseScene's
  // walkKeyDown returns early for isTextEntryTarget(e.target), so the target is
  // the first thing to look at.
  await page.evaluate(() => {
    window.__keyLog = [];
    window.addEventListener('keydown', (e) => {
      window.__keyLog.push({
        phase: 'down',
        key: e.key,
        code: e.code,
        isTrusted: e.isTrusted,
        target: e.target && e.target.tagName ? e.target.tagName : String(e.target),
        activeElement: document.activeElement && document.activeElement.tagName
          ? document.activeElement.tagName : String(document.activeElement),
        defaultPrevented: e.defaultPrevented,
      });
    }, true);
  });

  const out = {};
  // (a) the established pattern: hold W
  let a0 = await at();
  // walk.moveIntent is a seam built for exactly this question: it counts what
  // the per-frame movement block SAW, so "the key never landed in walkHeld" and
  // "it landed and a collider was in the way" stop reading the same.
  await page.evaluate(() => window.__fw.scene3d.walk.moveIntent.begin());
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  out.holdWIntent = await page.evaluate(() => {
    const r = window.__fw.scene3d.walk.moveIntent.read();
    window.__fw.scene3d.walk.moveIntent.end();
    return r;
  });
  let a1 = await at();
  out.holdW = { from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4) };
  out.holdWEvents = await page.evaluate(() => window.__keyLog.slice());
  out.walkHeldAfterHoldW = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    return w.heldKeysSnapshot ? w.heldKeysSnapshot() : null;
  });

  // (b) a direct write between frames
  a0 = await at();
  await page.evaluate(() => { window.__fw.scene3d.walk.state.z -= 1.0; });
  await page.waitForTimeout(400);
  a1 = await at();
  out.directWrite = { from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4) };

  // (c) a synthetic keydown on the document, which is where main.js listens
  a0 = await at();
  await page.evaluate(() => window.__fw.scene3d.walk.moveIntent.begin());
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
  });
  await page.waitForTimeout(1500);
  out.syntheticIntent = await page.evaluate(() => {
    const r = window.__fw.scene3d.walk.moveIntent.read();
    window.__fw.scene3d.walk.moveIntent.end();
    return r;
  });
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
  });
  a1 = await at();
  out.syntheticKey = { from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4) };

  // (d) HOLD W AGAIN, from a pose the player is not jammed against something in.
  //
  // This is the control that overturned the first reading of this probe. (a)
  // measured 0.00 yd and was written up as "page.keyboard.down does not work
  // under Electron" — but walk.moveIntent showed 131 frames of forward intent
  // during it, so the key arrived, landed in walkHeld and the movement block
  // acted on it. What was missing was somewhere to go: the start pose faced a
  // collider. Position delta reads identically for "the input is dead" and "a
  // wall is in the way", which is the exact conflation the moveIntent seam was
  // built to break, and I did not use it until the third attempt.
  a0 = await at();
  await page.evaluate(() => window.__fw.scene3d.walk.moveIntent.begin());
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  out.holdWClearIntent = await page.evaluate(() => {
    const r = window.__fw.scene3d.walk.moveIntent.read();
    window.__fw.scene3d.walk.moveIntent.end();
    return r;
  });
  a1 = await at();
  out.holdWFromClearPose = {
    from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4),
  };

  // (e) THE DECISIVE CONTROL: hold W facing a direction that is demonstrably open.
  //
  // (a) and (d) both faced -z from the same spot and both moved 0.00 yd with
  // full forward intent, which is what walking into a fixture looks like. The
  // sales floor runs east-west; yaw -PI/2 is the open lane the dirt-reveal
  // driver uses. If the SAME key press moves the player here, the input was
  // never the problem and the first reading of this probe was wrong.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
  });
  await page.waitForTimeout(500);
  a0 = await at();
  await page.evaluate(() => window.__fw.scene3d.walk.moveIntent.begin());
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  out.openLaneIntent = await page.evaluate(() => {
    const r = window.__fw.scene3d.walk.moveIntent.read();
    window.__fw.scene3d.walk.moveIntent.end();
    return r;
  });
  a1 = await at();
  out.holdWOpenLane = {
    from: a0, to: a1, movedYd: +Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(4),
  };

  out.verdict = {
    holdWMovesInAnOpenLane: out.holdWOpenLane.movedYd > 0.5,
    holdWWorks: out.holdWFromClearPose.movedYd > 0.5,
    holdWFromTheStartPose: out.holdW.movedYd > 0.5,
    // the distinction that matters: did the movement code WANT to move?
    holdWReachedTheMovementBlock: (out.holdWIntent?.movingFrames ?? 0) > 10,
    holdWWorksLegacyReading: out.holdW.movedYd > 0.5,
    directWriteWorks: out.directWrite.movedYd > 0.5,
    syntheticKeyWorks: out.syntheticKey.movedYd > 0.5,
  };
  return out;
}
