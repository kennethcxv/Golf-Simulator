// B4 — DO THE HANDS SURVIVE THE WHOLE LOOK RANGE, or only the pose I chose?
//
// electron-hand-pixels.js proves hands are drawn at ONE stand point and ONE
// pitch. That is the same error B3 was sent back for: a single reading answers
// "were they there when I looked", not "are they there". The report said the
// hands are visible; the player said they are not; both can be true if they go
// missing at a pitch the probe never visited.
//
// And there is a specific reason to expect exactly that. Round 5b measured the
// vacuum's and the washer's hands sitting ENTIRELY BELOW the frame whenever the
// player looks down at the floor - NDC y -1.39 and -1.35 - which is precisely
// when a floor tool is used. That was fixed with a +0.06 lift and then verified
// at a working pitch. Verified at A working pitch.
//
// So the pitch is driven across the whole usable look range and the hands are
// counted at every step. The verdict is the WORST sample, not the average and
// not the one that flatters it.
//
// CONTROLS, same three as the single-pose driver, applied at every step:
//   * hiding the hands must take the count to ~0
//   * a colour nothing was painted must read 0 in the same buffer
//   * the broom, the approved reference, must survive the sweep too
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/hand-pixels-sweep');
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
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    const underCamera = (o) => { for (let p = o.parent; p; p = p.parent) if (p === cam) return true; return false; };

    let painted = [];
    let hiddenSet = [];
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
    window.__paintHands = (on) => {
      if (!on) { painted.forEach(({ mesh, mat }) => { mesh.material = mat; }); painted = []; return 0; }
      const paint = new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false });
      painted = handMeshes().map((mesh) => {
        const mat = mesh.material; mesh.material = paint; return { mesh, mat };
      });
      return painted.length;
    };
    window.__hideHands = (on) => {
      if (!on) { hiddenSet.forEach(({ mesh, vis }) => { mesh.visible = vis; }); hiddenSet = []; return 0; }
      hiddenSet = handMeshes().map((mesh) => {
        const vis = mesh.visible; mesh.visible = false; return { mesh, vis };
      });
      return hiddenSet.length;
    };
    // A flat colour does not survive ACES at exposure 1.12 plus the composer;
    // without this the count is zero for everything, control included.
    let savedTone = null;
    window.__flatShotMode = (on) => {
      const r = s3.renderer;
      if (on) {
        savedTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
        r.toneMapping = THREE.NoToneMapping; r.toneMappingExposure = 1;
        s3.setPostEnabled?.(false);
      } else if (savedTone) {
        r.toneMapping = savedTone.tm; r.toneMappingExposure = savedTone.exp;
        savedTone = null; s3.setPostEnabled?.(true);
      }
      s3.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    };
  });

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

  // Pitch is negative-DOWN in this game. -0.85 is looking at the floor right in
  // front of the boots, which is where a floor tool is worked; +0.60 is looking
  // up at the shelves. The range covers both ends of what a player does with a
  // tool in hand.
  const PITCHES = [-0.85, -0.62, -0.45, -0.30, -0.10, 0.15, 0.40, 0.60];
  // the four the brief names, plus the broom as the approved reference
  // SPLIT ALONG THE SHIPPED RULING, not along what this sweep used to assume.
  //
  // cleaningTools.js gives hands:false to washer, spray, cloth, sponge and
  // trashbag - they are worked bare-handed. This driver used to demand that
  // spray/cloth/sponge/washer hands clear a 400px floor, which is the INVERSE of
  // the shipped contract: it would fail on correct behaviour and train everyone
  // to ignore a red gate. The stick tools are the ones that must show hands.
  const HANDED = ['broom', 'mop'];
  const BARE = ['spray', 'cloth', 'sponge', 'washer', 'trashbag'];
  const TOOLS = [...HANDED, ...BARE];
  const rows = [];

  for (const id of TOOLS) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(1700);
    const samples = [];
    for (const pitch of PITCHES) {
      await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
      await page.waitForTimeout(320);

      await page.evaluate(() => window.__flatShotMode(true));
      await page.evaluate(() => window.__paintHands(true));
      await page.waitForTimeout(240);
      const lit = await page.screenshot();
      await page.evaluate(() => window.__paintHands(false));

      await page.evaluate(() => window.__hideHands(true));
      await page.waitForTimeout(240);
      const hid = await page.screenshot();
      await page.evaluate(() => window.__hideHands(false));
      await page.evaluate(() => window.__flatShotMode(false));

      samples.push({
        pitch,
        px: await countIn(lit, MAGENTA),
        hiddenPx: await countIn(hid, MAGENTA),
        absentPx: await countIn(lit, ABSENT),
      });
    }
    // a picture at the worst pitch, so a number that fails has a face
    const worst = samples.reduce((a, b) => (b.px < a.px ? b : a));
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, worst.pitch);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${id}-worst-pitch-${worst.pitch}.png`) });

    rows.push({
      tool: id,
      samples,
      minPx: Math.min(...samples.map((s) => s.px)),
      maxPx: Math.max(...samples.map((s) => s.px)),
      worstPitch: worst.pitch,
      goesBlankAt: samples.filter((s) => s.px < 400).map((s) => s.pitch),
    });
  }

  const FLOOR = 400;
  // A bare-handed tool should read essentially zero hand-coloured pixels. The
  // ceiling is not zero because the counter matches a colour and a few pixels of
  // forearm or a colour-adjacent surface can survive antialiasing; it is far
  // below the floor, so the two halves cannot both pass on the same frame.
  const CEILING = 60;
  const out = {
    pitchesSwept: PITCHES,
    rows,
    minByTool: Object.fromEntries(rows.map((r) => [r.tool, r.minPx])),
    handed: HANDED,
    bare: BARE,
    checks: {
      // THE CLAIM, HALF ONE: a stick tool's hands never disappear anywhere in
      // the look range.
      handedToolsKeepTheirHands: HANDED.every(
        (t) => (rows.find((r) => r.tool === t)?.minPx ?? 0) >= FLOOR,
      ),
      // THE CLAIM, HALF TWO: a bare-handed tool draws no hands at ANY pitch.
      // Asserted against a CEILING, which is the direction the ruling actually
      // specifies - and the suppression must be symmetric, so one tool leaking
      // hands at one pitch fails this.
      bareToolsShowNoHands: BARE.every(
        (t) => (rows.find((r) => r.tool === t)?.maxPx ?? Infinity) <= CEILING,
      ),
      // named individually so a failure says WHICH tool leaked
      ...Object.fromEntries(BARE.map((t) => [
        `${t}DrawsNoHands`,
        (rows.find((r) => r.tool === t)?.maxPx ?? Infinity) <= CEILING,
      ])),
      // CONTROL: the approved reference survives it too
      controlBroomSurvivesTheSweep: (rows.find((r) => r.tool === 'broom')?.minPx ?? 0) >= FLOOR,
      // CONTROL: the two halves must DISAGREE. If a handed tool and a bare tool
      // read the same, the counter is not measuring hands at all and both halves
      // are meaningless.
      controlHandedAndBareDiffer: (() => {
        const h = Math.min(...HANDED.map((t) => rows.find((r) => r.tool === t)?.minPx ?? 0));
        const b = Math.max(...BARE.map((t) => rows.find((r) => r.tool === t)?.maxPx ?? 0));
        return h > b * 4 && h - b > 200;
      })(),
      // CONTROL: hiding the hands removes them, at every pitch
      controlHidingRemovesThemEverywhere: rows.every((r) => r.samples.every(
        (s) => s.hiddenPx < Math.max(40, s.px * 0.05),
      )),
      // CONTROL: the counter matches a colour rather than returning a number
      controlAbsentColourReadsZero: rows.every((r) => r.samples.every((s) => s.absentPx === 0)),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'hand-pixels-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
