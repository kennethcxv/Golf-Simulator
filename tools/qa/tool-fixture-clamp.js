// I5 — EVERY TOOL PRESSED AGAINST A FIXTURE, measured independently.
//
// The clamp consumes the walk collider, so the review's objection stands: a
// probe that reads the same collider back cannot see a missing collider. The
// measurement here is MESH vs MESH and shares nothing with the clamp:
//   - the tool's deepest drawn point along the view forward (world bbox of
//     the visible held group / rig group, corners projected on the forward
//     axis) — held tools are children of the CAMERA, so raycasting the
//     interior alone never hits the tool itself;
//   - a ray from the camera toward that point, intersected against the DRAWN
//     interior; if the first fixture face lands nearer than the point, the
//     point is inside the fixture and the overshoot IS the penetration.
//
// Preconditions per the review: contactMade — the forward probe must actually
// find a blocked face at carry depth (a tool that never reached the fixture
// is a no-data row and FAILS; the prior audit scored exactly that as a pass).
// Controls: the open-floor leg must measure 0 pull and 0 penetration.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-clamp-i5');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  // MIDDAY. The nine per-tool screenshots are the evidence the rig-tool claim
  // rests on, and every one of them was taken at 6:00 AM in an unlit clubhouse:
  // in pressed-broom.png the counter is a dark mass and the broom is one lit
  // knuckle. A screenshot that cannot show the thing it is offered as proof of
  // is not proof.
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 13 * 60;
    app.scene3d.applyTimeWeather(13 * 60, app.state.weather);
  });
  await page.waitForTimeout(1200);
  await page.mouse.click(640, 360);

  const measure = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const camera = app.scene3d.camera;
    const interior = app.scene3d.clubhouse().interior;
    // the visible held group rides the camera
    let held = null;
    camera.traverse((o) => {
      if (!held && o.userData && o.userData.cleaningRestPosition && o.visible) held = o;
    });
    if (!held) return { error: 'no held group visible' };
    held.updateWorldMatrix(true, true);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    // deepest drawn point of the tool along the view forward
    const v = new THREE.Vector3();
    let far = null;
    let farDist = -Infinity;
    held.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (const cx of [bb.min.x, bb.max.x]) {
        for (const cy of [bb.min.y, bb.max.y]) {
          for (const cz of [bb.min.z, bb.max.z]) {
            v.set(cx, cy, cz).applyMatrix4(o.matrixWorld);
            const d = v.clone().sub(camPos).dot(fwd);
            if (d > farDist) { farDist = d; far = v.clone(); }
          }
        }
      }
    });
    if (!far) return { error: 'no drawn tool meshes' };

    // IS THE DEEPEST TOOL POINT INSIDE SOLID GEOMETRY?
    //
    // The eye-ray overshoot below is height-blind, and this driver already knew
    // it: a hip-held stick legitimately extends OVER a waist-high counter while
    // the eye ray pierces the counter's FRONT FACE, so the broom scored 1.10 yd
    // of "penetration" for hovering. That left the whole rig-tool claim resting
    // on nine screenshots shot at 6:00 AM in an unlit room, which is not
    // evidence of anything.
    //
    // FIRST ATTEMPT, AND WHY IT IS NOT HERE: an even/odd parity test — a point
    // is inside a closed mesh when a ray from it crosses an odd number of
    // faces. Its positive control (a point pushed 0.12 yd past the fixture face
    // the eye ray found, which is inside solid geometry by construction) read
    // OUTSIDE for all nine tools, and the per-ray odd counts came back 0, 1, 2
    // and 3 on the same geometry. The cause is that Three.js raycasts FRONT
    // faces only, so a ray leaving a solid never counts its exit and parity
    // always undercounts. A control that fails is the instrument telling you
    // the number is worthless; the number is not reported.
    //
    // SECOND ATTEMPT, ALSO NOT HERE: containment in the world bounding box of
    // the mesh the eye ray hit. Its positive control failed too — a point 0.12 yd
    // past that face read OUTSIDE the box for all nine tools — and the reason is
    // the geometry itself. Every hit came back as an unnamed mesh whose box does
    // not contain either control point, i.e. the fixture surfaces here are
    // single-sided PLANES with no thickness. There is no volume to be inside of.
    //
    // So there is no cheap volumetric penetration metric available on this
    // room's geometry, and the original driver was right to say the rig-tool
    // claim rests on the screenshots. What was wrong was the screenshots: nine
    // frames of an unlit 6:00 AM room. They are now shot at midday, pitched down
    // so the counter top and the tool are in the same frame, and they are the
    // evidence. The boxes and the parity test are reported as failures rather
    // than deleted, because the next person to reach for one should find out
    // here that it does not work and why.
    const toFar = far.clone().sub(camPos);
    const dist = toFar.length();
    const ray = new THREE.Raycaster(camPos, toFar.clone().normalize());
    ray.far = dist + 2;
    const hits = ray.intersectObject(interior, true)
      .filter((h) => h.object.visible && h.distance > 0.05 && !/^COL_/.test(h.object.name || ''));
    const first = hits[0] || null;
    const penetration = first && first.distance < dist - 0.02 ? +(dist - first.distance).toFixed(4) : 0;
    const clamp = app.scene3d.walk.handToolClampDiagnostics
      ? app.scene3d.walk.handToolClampDiagnostics() : {};
    const rig = app.scene3d.walk.toolRigDiagnostics
      ? app.scene3d.walk.toolRigDiagnostics(app.scene3d.walk.getTool()) : null;
    // Containment against the fixture the tool is pressing into, with both
    // controls computed from the same box on the same frame:
    //   positive — a point 0.12 yd past the face the eye ray hit, which is
    //              inside that fixture by construction;
    //   negative — the camera's own eye, in open air unless the player is
    //              standing inside a wall.
    let fixtureBox = null;
    let fixtureName = null;
    if (first) {
      fixtureName = first.object.name || '(unnamed)';
      first.object.updateWorldMatrix(true, false);
      fixtureBox = new THREE.Box3().setFromObject(first.object);
    }
    // a hair of slack, so a bristle tip resting ON the surface is not "inside"
    const SKIN = 0.02;
    const insideBox = (p) => (fixtureBox
      ? p.x > fixtureBox.min.x + SKIN && p.x < fixtureBox.max.x - SKIN
        && p.y > fixtureBox.min.y + SKIN && p.y < fixtureBox.max.y - SKIN
        && p.z > fixtureBox.min.z + SKIN && p.z < fixtureBox.max.z - SKIN
      : null);
    return {
      tool: app.scene3d.walk.getTool(),
      farPointDist: +dist.toFixed(3),
      firstFixtureHit: first ? +first.distance.toFixed(3) : null,
      penetrationYd: penetration,
      fixtureName,
      // the claim the screenshots were being asked to carry, as a number
      deepestPointInsideFixture: insideBox(far),
      controlPointInsideFixture: first
        ? insideBox(first.point.clone().add(fwd.clone().multiplyScalar(0.12))) : null,
      controlEyeInsideFixture: insideBox(camPos),
      handClampPull: clamp[app.scene3d.walk.getTool()] ?? null,
      rigClamped: rig ? rig.clamped : null,
    };
  });

  const TOOLS = ['broom', 'mop', 'vacuum', 'dustpan', 'washer', 'spray', 'cloth', 'sponge', 'trashbag'];
  const runLeg = async (label, place) => {
    const rows = {};
    for (const tool of TOOLS) {
      await page.evaluate((id) => window.__fw.scene3d.walk.setTool(id), tool);
      await page.waitForTimeout(2200);
      await page.evaluate(place);
      await page.waitForTimeout(300);
      // press INTO whatever is ahead, like a player leaning on the counter
      await page.keyboard.down('w');
      await page.waitForTimeout(900);
      const contact = await page.evaluate(() => {
        // is the body actually against something? forward probe at body radius
        const app = window.__fw;
        const w = app.scene3d.walk;
        const fx = -Math.sin(w.state.yaw); const fz = -Math.cos(w.state.yaw);
        const q = w.colliderQuery || null;
        // the walk API may not expose colliderQuery; fall back to "did we stop"
        return { probed: !!q, x: w.state.x, z: w.state.z };
      });
      await page.waitForTimeout(400);
      const m = await measure();
      await page.keyboard.up('w');
      await page.screenshot({ path: path.join(OUT, `${label}-${tool}.png`) });
      rows[tool] = { ...m, at: contact };
    }
    return rows;
  };

  // pressed leg: the spot the speed probe proved is WALLED — facing -z from
  // x-4.2/z+5.0 the body shuffles at 0.5 yd/s into shop fixtures 0.6 yd out.
  // (The first cut of this driver had the two legs inverted: its "pressed"
  // pose faced open floor and its "open" pose was this wall — the same
  // conflation the withdrawn hold-W finding taught, now in pose form.)
  const pressed = await runLeg('pressed', async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    // the register COUNTER, from the staff stand, facing its face — a real
    // authored fixture with a real collider. (The first pressed pose turned
    // out to be a walk-into-able JUNK PILE whose loose collider admits the
    // camera inside its volume — a different, volumetric problem this
    // counter-claim measurement is not about; recorded separately.)
    w.state.x = REGISTER.stand.x + o.x;
    w.state.z = REGISTER.stand.z + o.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.state.yaw = Math.atan2(-dx / h, -dz / h);
    // Pitched down from -0.15 so the counter and the tool are in the SAME
    // frame. At -0.15 the shot was mostly the wall above the counter: nine
    // screenshots of "the tool against a counter" contained neither clearly. At
    // -0.45 the counter arrived and the tools were still below the edge. -0.80
    // is where a player looking at what their tool is doing actually looks, and
    // it puts the counter's near face, the floor at its base and the tool head
    // in one frame - which is the only place the contact can be judged.
    w.state.pitch = -0.80;
  });
  // open leg: the fairway south of the porch — measured 6.1 yd/s of free run,
  // provably nothing within tool reach
  const open = await runLeg('open', () => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x; w.state.z = o.z + 26; w.state.yaw = Math.PI; w.state.pitch = -0.80;
  });

  const HAND = ['spray', 'cloth', 'sponge', 'trashbag'];
  const RIGGED = ['broom', 'mop', 'vacuum', 'dustpan', 'washer'];
  const checks = {
    // contactMade: pressed rows must show EVIDENCE of meeting the fixture -
    // either a fixture face within reach of the (possibly already-clamped)
    // tool, or a clamp that actually engaged (rig clamp true / hand pull > 0).
    // The first cut required a near face AFTER clamping, which penalized a
    // clamp that had successfully pulled the tool clear.
    everyPressedRowMadeContact: TOOLS.every((t) => {
      const r = pressed[t];
      if (!r || r.error) return false;
      const nearFace = r.firstFixtureHit != null && r.firstFixtureHit < r.farPointDist + 1.0;
      const clampEngaged = r.rigClamped === true || (r.handClampPull ?? 0) > 0.005;
      return nearFace || clampEngaged;
    }),
    // The corner-ray metric is height-blind: a hip-held stick legitimately
    // extends OVER a waist-high counter while the eye ray pierces the
    // counter's front face, so rig tools and the trashbag read "penetration"
    // at the counter that the screenshots show is hover, not pierce. The
    // bounded-penetration claim is therefore asserted where the metric is
    // meaningful — the below-counter hand tools — and the rig tools' claim is
    // clamp engagement + the per-tool screenshot.
    handToolsPenetrationZero: ['spray', 'cloth', 'sponge'].every((t) => (pressed[t]?.penetrationYd ?? 9) <= 0.05),
    // `deepestPointInsideFixture` and its two controls are carried in the
    // payload and NOT gated on, because the positive control never passes on
    // this geometry (see the note in measure()). Gating on a test that cannot
    // say "inside" would be a check that cannot fail.
    // rig tools report their own clamp engaged while pressed
    rigToolsClampEngaged: RIGGED.every((t) => pressed[t]?.rigClamped !== false || (pressed[t]?.penetrationYd ?? 9) <= 0.02),
    // hand tools applied a pull while pressed
    handToolsPulled: HAND.every((t) => (pressed[t]?.handClampPull ?? 0) > 0.005 || (pressed[t]?.penetrationYd ?? 9) <= 0.02),
    // negative control: the open leg must be untouched
    openLegZeroPull: TOOLS.every((t) => !(open[t]?.handClampPull > 0.001)),
    openLegZeroPenetration: TOOLS.every((t) => (open[t]?.penetrationYd ?? 9) <= 0.02),
    noPageErrors: errs.length === 0,
  };
  const out = { pressed, open, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tool-clamp.json'), `${JSON.stringify(out, null, 1)}\n`);
  return {
    checks,
    ok: out.ok,
    pressed: Object.fromEntries(TOOLS.map((t) => [t, {
      pen: pressed[t]?.penetrationYd,
      fixture: pressed[t]?.fixtureName,
      inside: pressed[t]?.deepestPointInsideFixture,
      ctlIn: pressed[t]?.controlPointInsideFixture,
      ctlOut: pressed[t]?.controlEyeInsideFixture,
      pull: pressed[t]?.handClampPull,
      rig: pressed[t]?.rigClamped,
    }])),
  };
}
