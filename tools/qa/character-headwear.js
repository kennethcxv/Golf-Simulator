// Q6 — the cap sits ON the head instead of through it.
//
// "the persons hat is like phased in with there head." Eyeballing a render
// cannot settle that, so the driver samples the two surfaces directly: for a
// ring of directions around and over the skull, it compares how far the SKULL
// reaches with how far the CAP CROWN reaches, in the head's own space. A cap
// that covers has clearance everywhere it overlaps; a cap that intersects has
// at least one direction where the skull is further out.
//
// NEGATIVE CONTROL: the same measurement is run against a deliberately sunk
// cap (the old seating restored on a clone), which must FAIL - otherwise the
// instrument would pass anything.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/character-headwear');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);

  const measure = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const { makeCharacter } = await import(new URL('src/render3d/characterAsset.js', document.baseURI).href);

    // Sample both surfaces by raycasting OUT from inside the head. Whatever a
    // ray meets first in a given direction is the surface the player sees.
    const probe = (character, sinkCap) => {
      const head = character.root.getObjectByName('headJoint');
      if (!head) return { error: 'no headJoint' };
      // the crown is the big cap sphere; the skull is the big skin sphere
      const spheres = [];
      head.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'SphereGeometry') spheres.push(o);
      });
      const crown = spheres.find((o) => o.geometry.parameters.phiLength
        && o.geometry.parameters.thetaLength < Math.PI * 0.9
        && o.geometry.parameters.radius > 0.1);
      const skull = spheres.find((o) => o !== crown
        && o.geometry.parameters.radius > 0.14
        && o.geometry.parameters.thetaLength >= Math.PI * 0.9);
      if (!crown || !skull) return { error: 'crown or skull not found' };
      if (sinkCap) {
        crown.position.y = 0.05;
        crown.scale.set(1.02, 0.94, 1.06);
      }
      head.updateWorldMatrix(true, true);

      const centre = new THREE.Vector3(0, 0.06, 0);
      head.localToWorld(centre);
      const caster = new THREE.Raycaster();
      const samples = [];
      // Cast INWARD, from outside the head toward its centre. A ray fired from
      // inside a sphere meets only back faces, which a FrontSide material does
      // not report - the first attempt found zero hits for exactly that reason.
      // Casting inward also tests the claim more directly: wherever the cap
      // covers, the CAP must be the outermost surface.
      for (let el = 0; el <= 80; el += 10) {
        for (let az = 0; az < 360; az += 30) {
          const a = (az * Math.PI) / 180;
          const e = (el * Math.PI) / 180;
          const dir = new THREE.Vector3(
            Math.cos(e) * Math.sin(a),
            Math.sin(e),
            Math.cos(e) * Math.cos(a),
          ).normalize();
          const from = centre.clone().addScaledVector(dir, 1);
          caster.set(from, dir.clone().negate());
          caster.far = 2;
          const skullHit = caster.intersectObject(skull, false)[0];
          const crownHit = caster.intersectObject(crown, false)[0];
          if (!skullHit || !crownHit) continue; // the cap does not cover here
          // positive = the cap is further out than the skull, which is covering
          samples.push({
            el,
            az,
            clearance: +(skullHit.distance - crownHit.distance).toFixed(4),
          });
        }
      }
      const clearances = samples.map((s) => s.clearance);
      const worst = clearances.length ? Math.min(...clearances) : null;
      const through = samples.filter((s) => s.clearance <= 0);
      return {
        samples: samples.length,
        worstClearance: worst,
        directionsSkullPokesThrough: through.length,
        worstAt: through.length ? through.sort((a, b) => a.clearance - b.clearance)[0] : null,
      };
    };

    const live = probe(makeCharacter({}), false);
    const control = probe(makeCharacter({}), true);
    return { live, control };
  });

  assert(!measure.live.error, `live probe failed: ${measure.live.error}`);
  assert(!measure.control.error, `control probe failed: ${measure.control.error}`);

  // and a look at it, at the player's camera
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    club.sendToCounter(['balls1'], 'cash');
  });
  await page.waitForTimeout(9000);
  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = 0.06;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '01-customer-at-counter.png') });

  const checks = {
    capActuallyCovers: measure.live.samples > 20,
    // the claim: nowhere the cap covers does the skull come through it
    noSkullThroughTheCap: measure.live.directionsSkullPokesThrough === 0,
    realClearanceNotAHair: (measure.live.worstClearance ?? -1) > 0.004,
    // NEGATIVE CONTROL: the old seating must still fail, or this measures nothing
    controlSunkCapStillIntersects: measure.control.directionsSkullPokesThrough > 0,
    noPageErrors: errs.length === 0,
  };
  const out = { ...measure, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'headwear.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
