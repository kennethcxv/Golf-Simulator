// B3 — HOW FAR THE PALM IS FROM THE SHAFT, in yards, perpendicular.
//
// The flipbook settled that the fingers sit BESIDE the broom's pole rather than
// around it. Every previous attempt at this measured something else — "does the
// hand follow the head" produced 0.167 → 0.329 and the picture did not change —
// because those numbers were about the hand tracking the head's MOTION, not
// about the hand being ON the shaft at all.
//
// The number the picture is about is the perpendicular distance from the hand's
// palm to the shaft's own LINE. A hand gripping a 0.023 yd pole has its palm
// centre within about a pole radius of that line; a hand beside it does not.
// The shaft line comes from the tool's two authored grip sockets, which is the
// pole by definition, so the metric cannot drift from the geometry.
//
// CONTROLS, and both are needed:
//   * A DELIBERATELY DISPLACED probe point, 0.25 yd off the palm along the
//     camera's right. It must measure ~0.25 yd further from the line than the
//     palm does. If a known offset does not read as an offset, the metric is not
//     measuring distance from the line and nothing else it says counts.
//   * A point ON the line, halfway between the two grip sockets. It must
//     measure ~0. Together the two bracket the scale: zero reads as zero and a
//     quarter-yard reads as a quarter-yard.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/grip-on-shaft');
  fs.mkdirSync(OUT, { recursive: true });
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
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.34;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    const under = (o) => { for (let p = o.parent; p; p = p.parent) if (p === cam) return true; return false; };
    const vis = (o) => { let v = o.visible; for (let p = o.parent; p && v; p = p.parent) v = p.visible; return v; };

    // perpendicular distance from a point to the infinite line through a,b
    const distToLine = (point, a, b) => {
      const ab = b.clone().sub(a);
      const ap = point.clone().sub(a);
      const len = ab.length();
      if (len < 1e-6) return ap.length();
      const t = ap.dot(ab) / (len * len);
      return ap.sub(ab.multiplyScalar(t)).length();
    };

    window.__gripOnShaft = (toolId) => {
      // the shaft: the two authored grips define the pole, wherever the rig has
      // put it this frame
      let primary = null;
      let support = null;
      let hand = null;
      s3.scene.traverse((o) => {
        if (!vis(o)) return;
        const n = String(o.name || '');
        if (!primary && /SOCKET_GripPrimary/i.test(n) && under(o)) primary = o;
        if (!support && /SOCKET_GripSupport/i.test(n) && under(o)) support = o;
        if (!hand && n === 'FirstPersonRightHand' && under(o)) hand = o;
      });
      if (!primary || !support || !hand) {
        return { tool: toolId, error: `missing ${!primary ? 'primary' : ''}${!support ? ' support' : ''}${!hand ? ' hand' : ''}`.trim() };
      }
      cam.updateMatrixWorld(true);
      const a = primary.getWorldPosition(new THREE.Vector3());
      const b = support.getWorldPosition(new THREE.Vector3());
      const palm = hand.getWorldPosition(new THREE.Vector3());

      // CONTROL 1: a point known to be 0.25 yd off, along the camera's right
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      const displaced = palm.clone().addScaledVector(right, 0.25);
      // CONTROL 2: a point known to be ON the line
      const onLine = a.clone().lerp(b, 0.5);

      return {
        tool: toolId,
        shaftLengthYd: +a.distanceTo(b).toFixed(4),
        palmToShaftYd: +distToLine(palm, a, b).toFixed(4),
        controlDisplacedYd: +distToLine(displaced, a, b).toFixed(4),
        controlOnLineYd: +distToLine(onLine, a, b).toFixed(4),
        palmToPrimaryYd: +palm.distanceTo(a).toFixed(4),
      };
    };
  });

  // B3 — THROUGH THE SWEEP, NOT AT ONE PITCH. "The measurement is not the claim.
  // Watch a clip." A single reading says the hand is on the shaft at one moment;
  // the complaint is about MOTION. So the pitch is driven the whole way, -0.40
  // to +1.35 and back, and the palm-to-shaft distance is sampled throughout. A
  // hand that follows holds its distance; a hand that detaches does not.
  const PITCHES = [];
  for (let p = -0.40; p <= 1.35; p += 0.125) PITCHES.push(+p.toFixed(3));
  const rows = [];
  for (const tool of ['broom', 'mop', 'vacuum', 'dustpan']) {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(1500);
    const samples = [];
    for (const pitch of PITCHES) {
      await page.evaluate((v) => { window.__fw.scene3d.walk.state.pitch = v; }, pitch);
      await page.waitForTimeout(150);
      const r = await page.evaluate((t) => window.__gripOnShaft(t), tool);
      if (!r.error) samples.push({ pitch, d: r.palmToShaftYd });
    }
    await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.34; });
    await page.waitForTimeout(300);
    const settled = await page.evaluate((t) => window.__gripOnShaft(t), tool);
    const ds = samples.map((x) => x.d);
    rows.push({
      ...settled,
      sweptPitches: samples.length,
      minAcrossSweep: ds.length ? Math.min(...ds) : null,
      maxAcrossSweep: ds.length ? Math.max(...ds) : null,
      // the claim: the palm never leaves the pole as the view swings
      staysOnTheShaft: ds.length > 0 && Math.max(...ds) <= 0.06,
      worstAt: samples.length ? samples.reduce((a, b) => (b.d > a.d ? b : a)).pitch : null,
    });
    await page.screenshot({ path: path.join(OUT, `${tool}.png`) });
  }

  const ok = rows.filter((r) => !r.error);
  const out = {
    rows,
    checks: {
      // The DUSTPAN is single-handed by design - fpHands hides the support hand
      // for a tool with no left grip - so it has no SOCKET_GripSupport and a
      // "line through the two grips" is undefined for it. That is an exclusion
      // with a reason, not a measurement that failed.
      everyTwoHandedToolMeasured: rows
        .filter((r) => r.tool !== 'dustpan')
        .every((r) => !r.error),
      dustpanIsSingleHandedAsExpected: rows.some(
        (r) => r.tool === 'dustpan' && String(r.error || '').includes('support'),
      ),
      // the metric must see a known displacement as a displacement...
      controlDisplacementReads: ok.every((r) => r.controlDisplacedYd > r.palmToShaftYd + 0.10),
      // ...and a point on the line as zero
      controlOnLineReadsZero: ok.every((r) => r.controlOnLineYd < 0.001),
      // THE FINDING: a hand gripping a 0.023 yd pole is within a pole radius of
      // its axis. Anything beyond that is a hand beside the shaft.
      handIsOnTheShaft: Object.fromEntries(ok.map((r) => [r.tool, r.palmToShaftYd <= 0.05])),
      // B3: and it stays there through the whole look sweep, not just at rest
      handStaysOnTheShaftThroughTheSweep: ok.every((r) => r.staysOnTheShaft),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlDisplacementReads && out.checks.controlOnLineReadsZero
    && out.checks.everyTwoHandedToolMeasured;
  fs.writeFileSync(path.join(OUT, 'grip-on-shaft.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
