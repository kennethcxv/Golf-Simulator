// B4 — "No hands visible on any handheld tool: scrubber, sponge, cloth, spray."
//
// THAT IS THE INSTRUCTION, not a defect report, and I had it backwards for most
// of a session: I measured the hands, found them present, and argued the line
// was a bug report. It is not. The hand-worked tools are meant to be DRAWN
// BARE — the tool sits in view on its own with no first-person hand on it — and
// the stick tools keep theirs.
//
// So this driver asserts BOTH halves, and both are needed. A build that lost
// the hands everywhere would satisfy "the five read zero" while being badly
// broken, and only the stick-tool half catches that.
//
// electron-hands-on-every-tool.js answers a WEAKER question than the brief asks.
// Its verdict is `onScreen`: a bounding-box-versus-screen-rect overlap. That
// proves the hands' box intersects the viewport, and cannot tell that apart from
// a hand buried inside the tool, drawn on a layer the pass never carries, or
// facing away. The discriminator already found two of my own parts that rendered
// zero pixels from all 26 directions while sitting exactly where their box said.
// A box is not a pixel. Its `ok` was also gated on the controls alone, so it
// could report every tool handless and still exit green.
//
// This counts PIXELS, in the REAL screenshot. Not in an offscreen re-render:
// the first version of this driver rendered the scene itself and had to pick a
// camera, and picking wrongly is exactly how it produced four confident zeros
// for tools whose hands are plainly visible in the picture beside them. The
// hands are drawn through different passes for different tools - the stick
// rigs draw on layer 29 through their own vmCamera, the hand-worked tools on
// layer 0 through the main camera - so any driver that names one lens is wrong
// for half the set. Screenshotting the game asks no questions about lenses.
//
// The hands are also found STRUCTURALLY, as the descendants of the
// FirstPersonHands root, not by name. A name filter of /hand|finger|thumb|palm/
// matched five meshes for all nine tools - five INVISIBLE ones, because the
// real hand meshes are unnamed and their forearm is called
// FirstPersonRightForearm, which contains no "hand" at all.
//
// CONTROLS:
//   * HIDDEN. The same shot with the hands' visible=false. Magenta must fall to
//     ~0. A counter that reports thousands of hand pixels when no hand is being
//     drawn is counting something else.
//   * AN ABSENT COLOUR. Pure green, counted in the same buffer. Must be 0, or
//     the counter returns a number rather than matching a colour.
//   * THE BROOM. The approved reference must pass or the probe is broken.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/hand-pixels');
  fs.mkdirSync(OUT, { recursive: true });
  const sharp = (await import('sharp')).default;
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;                        // NPCs at 1x, per the rules
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.30;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    // The player's own hands, not a customer's: the ancestor chain has to reach
    // the camera. Matching by name across the whole scene once counted 79
    // CUSTOMER hands per tool and passed every tool without finding the
    // player's own.
    const underCamera = (o) => { for (let p = o.parent; p; p = p.parent) if (p === cam) return true; return false; };

    let painted = [];
    let hidden = [];

    const handMeshes = () => {
      let root = null;
      s3.scene.traverse((o) => {
        if (!root && String(o.name || '') === 'FirstPersonHands' && underCamera(o)) root = o;
      });
      if (!root) return [];
      const out = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (vis) out.push(o);
      });
      return out;
    };

    window.__handCount = () => handMeshes().length;

    // A flat 0xff00ff does not reach the screenshot as 0xff00ff. The renderer
    // tone-maps with ACES at exposure 1.12 and then the composer runs, so pure
    // magenta lands somewhere desaturated and darker and a tolerance tight
    // enough to be meaningful misses it entirely — which is how the first
    // version of this counted zero hand pixels for all nine tools INCLUDING the
    // broom control. Neutralising the pipeline for the painted frame is what
    // makes the colour mean what it says. sRGB output leaves pure primaries
    // alone (0 and 1 are fixed points), so nothing else has to be touched.
    let savedTone = null;
    window.__flatShotMode = (on) => {
      const r = s3.renderer;
      if (on) {
        savedTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
        r.toneMapping = THREE.NoToneMapping;
        r.toneMappingExposure = 1;
        s3.setPostEnabled?.(false);
      } else if (savedTone) {
        r.toneMapping = savedTone.tm;
        r.toneMappingExposure = savedTone.exp;
        savedTone = null;
        s3.setPostEnabled?.(true);
      }
      s3.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    };

    window.__paintHands = (on) => {
      if (!on) {
        painted.forEach(({ mesh, mat }) => { mesh.material = mat; });
        painted = [];
        return 0;
      }
      const meshes = handMeshes();
      const paint = new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false });
      painted = meshes.map((mesh) => {
        const mat = mesh.material;
        mesh.material = paint;
        return { mesh, mat };
      });
      return meshes.length;
    };

    window.__hideHands = (on) => {
      if (!on) {
        hidden.forEach(({ mesh, vis }) => { mesh.visible = vis; });
        hidden = [];
        return 0;
      }
      const meshes = handMeshes();
      hidden = meshes.map((mesh) => {
        const vis = mesh.visible;
        mesh.visible = false;
        return { mesh, vis };
      });
      return meshes.length;
    };
  });

  // count pixels near a colour in a PNG screenshot
  const countIn = async (png, [r, g, b]) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let n = 0;
    for (let i = 0; i < data.length; i += ch) {
      if (Math.abs(data[i] - r) < 30 && Math.abs(data[i + 1] - g) < 30 && Math.abs(data[i + 2] - b) < 30) n += 1;
    }
    return n;
  };
  const MAGENTA = [255, 0, 255];
  const ABSENT = [0, 255, 0];

  // Every hand-worked tool, so whichever tool "scrubber" names is covered.
  const TOOLS = ['broom', 'spray', 'cloth', 'sponge', 'washer', 'trashbag', 'mop', 'vacuum', 'dustpan'];
  const rows = [];
  for (const id of TOOLS) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(1700);
    await page.screenshot({ path: path.join(OUT, `${id}.png`) });

    await page.evaluate(() => window.__flatShotMode(true));
    const meshCount = await page.evaluate(() => window.__paintHands(true));
    await page.waitForTimeout(300);
    const litShot = await page.screenshot();
    await page.evaluate(() => window.__paintHands(false));

    // CONTROL: the same frame, same flattened pipeline, no hands drawn at all
    await page.evaluate(() => window.__hideHands(true));
    await page.waitForTimeout(300);
    const hiddenShot = await page.screenshot();
    await page.evaluate(() => window.__hideHands(false));
    await page.evaluate(() => window.__flatShotMode(false));
    await page.waitForTimeout(200);

    // IN USE as well as idle. A hand that only appears while the trigger is
    // held is still a tool with no hands for most of the time it is out, and a
    // hand that vanishes the moment you use it is the defect the brief
    // describes. Both states are counted; the verdict takes the worse.
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__flatShotMode(true));
    await page.evaluate(() => window.__paintHands(true));
    await page.waitForTimeout(300);
    const usingShot = await page.screenshot();
    await page.evaluate(() => window.__paintHands(false));
    await page.evaluate(() => window.__flatShotMode(false));
    await page.mouse.up();
    await page.screenshot({ path: path.join(OUT, `${id}-using.png`) });
    await page.waitForTimeout(200);

    rows.push({
      tool: id,
      handMeshes: meshCount,
      handPixels: await countIn(litShot, MAGENTA),
      usingHandPixels: await countIn(usingShot, MAGENTA),
      hiddenPixels: await countIn(hiddenShot, MAGENTA),
      absentColourPixels: await countIn(litShot, ABSENT),
    });
  }

  const by = Object.fromEntries(rows.map((r) => [r.tool, r]));
  // A hand at arm's length is a big object. 400 px of 1280x720 is 0.04% of the
  // frame - far below what the eye needs, deliberately, so no verdict turns on
  // where exactly the threshold sits.
  const FLOOR = 400;
  // the WORSE of idle and in-use, so a tool cannot pass on one state alone
  const drew = (t) => Math.min(by[t]?.handPixels ?? 0, by[t]?.usingHandPixels ?? 0) >= FLOOR;
  // ...and the BETTER of the two for a tool that must show nothing, so a bare
  // tool cannot pass by being bare in only one of its states
  const bare = (t) => Math.max(by[t]?.handPixels ?? 1e9, by[t]?.usingHandPixels ?? 1e9) === 0;

  // B4: the hand-worked tools are DRAWN BARE - the tool sits in view with no
  // hand on it. So this driver is now an INVERSE check for those five and the
  // original check for the four stick tools, and it needs both halves: a build
  // that lost the hands everywhere would satisfy "the five read zero" while
  // being badly broken, and only the stick-tool half catches that.
  const BARE = ['spray', 'cloth', 'sponge', 'washer', 'trashbag'];
  const STICK = ['broom', 'mop', 'vacuum', 'dustpan'];

  const out = {
    intent: 'B4: the five hand-worked tools are drawn BARE (no hand on the tool); the four stick tools keep their hands. Both halves are asserted.',
    rows,
    pixelsByTool: Object.fromEntries(rows.map((r) => [r.tool, r.handPixels])),
    checks: {
      // THE FIVE DRAWN BARE, each on its own line so a failure says which
      sprayIsBare: bare('spray'),
      clothIsBare: bare('cloth'),
      spongeIsBare: bare('sponge'),
      washerIsBare: bare('washer'),
      trashbagIsBare: bare('trashbag'),
      everyBareToolIsBare: BARE.every(bare),
      // THE OTHER HALF, and it is not optional: without it, a build that lost
      // the hands everywhere would read as a pass.
      everyStickToolKeepsItsHands: STICK.every(drew),
      // CONTROL: the approved reference still has hands
      controlBroomHasHandPixels: drew('broom'),
      // CONTROL: hiding the hands takes the count with it
      controlHidingHandsRemovesThem: rows.every(
        (r) => r.hiddenPixels < Math.max(40, r.handPixels * 0.05),
      ),
      // CONTROL: the counter matches a colour rather than returning a number
      controlAbsentColourReadsZero: rows.every((r) => r.absentColourPixels === 0),
      // CONTROL: the probe found hands to paint on the tools that have them. It
      // cannot be asked of the bare five - their hand meshes are not drawn, so
      // finding none is the expected result there, and demanding otherwise
      // would make the check fail for the thing working correctly.
      controlFoundHandMeshesOnStickTools: STICK.every((t) => (by[t]?.handMeshes ?? 0) > 0),
      // ...and the bare five are SUPPRESSED, not deleted: the hand geometry is
      // shared with the stick tools and still exists, it is simply not drawn.
      controlBareToolsPaintNothingBecauseNothingIsDrawn: BARE.every((t) => (by[t]?.handMeshes ?? -1) === 0),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  // Unlike the driver this supersedes, the CLAIMS gate the verdict, not just
  // the controls.
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'hand-pixels.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
