// G1/G2 — the torso reads as one piece in motion, and the face features sit
// on the skull. Verified per plan R-K:
//   G1: four customers stepped through REAL Walk-mode update() phases; the
//       belt/chest/pelvis vertical offsets must move in LOCKSTEP through
//       the whole stride (the old build's law: chest 1.0x bob, pelvis 0.7x,
//       belt 0x — up to 2 cm of relative slide at the waist, the "pumping"
//       read). Negative control: the INSTRUMENT must see a planted
//       differential when one is reintroduced runtime-only.
//   G2: brow and mouth rear-face RADIAL distance from the skull centre,
//       computed in the head group's own space (features are direct children;
//       for a SphereGeometry skull the analytic surface IS the mesh surface,
//       and local coordinates make the check scale-proof across seeds).
//       Face-on screenshots at conversational distance.
// QA_G_TAG=before runs the same instrument against a stashed-old build and
// must go RED (the before/after screenshot pair is the goal's evidence).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g-characters', process.env.QA_G_TAG || 'after');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2200);
  await page.bringToFront().catch(() => {});

  const out = { errs };

  // Build four walking customers on the real shop floor, facing the camera
  // in profile, and measure through genuine update() strides.
  out.study = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const mod = await import(new URL('src/render3d/characterAsset.js', document.baseURI).href);
    const make = mod.makeCharacter || mod.default;
    if (!make) return { fail: 'makeCharacter not exported' };
    const o = s3.clubhouse().interior.position;
    const stage = new THREE.Group();
    stage.name = 'G_STAGE';
    stage.position.set(o.x - 5.0, o.y ?? 0, o.z + 2.4);
    s3.scene.add(stage);
    const chars = [];
    for (let i = 0; i < 4; i += 1) {
      const c = make({ seed: 101 + i * 37 });
      const root = c.root || c.group || c.mesh;
      root.position.set(i * 0.9 - 1.35, 0, 0);
      root.rotation.y = Math.PI / 2; // profile to the camera
      stage.add(root);
      c.setMode?.('Walk');
      chars.push({ c, root });
    }
    // helpers to find parts by construction facts
    const partsOf = (root) => {
      const found = { belt: null, buckle: null, pelvis: null, chest: null, head: null, skull: null, brows: [], mouth: null, eyes: [] };
      root.traverse((obj) => {
        if (obj.geometry?.type === 'CylinderGeometry' && Math.abs((obj.geometry.parameters.radiusTop ?? 0) - 0.205) < 1e-3) found.belt = obj;
        if (obj.geometry?.type === 'BoxGeometry' && Math.abs((obj.geometry.parameters.width ?? 0) - 0.062) < 1e-3) found.buckle = obj;
      });
      return found;
    };
    // vertical-law lockstep: step REAL update() through two full strides and
    // record belt-vs-chest and pelvis-vs-chest offset SPREAD (constant
    // offsets = one law; spread = relative slide, the pump)
    const spread = { beltVsChest: 0, pelvisVsChest: 0 };
    const first = chars[0];
    let belt = null;
    first.root.traverse((obj) => {
      if (!belt && obj.geometry?.type === 'CylinderGeometry' && Math.abs((obj.geometry.parameters.radiusTop ?? 0) - 0.205) < 1e-3) belt = obj;
    });
    // chest/pelvis are unnamed groups; find via known rest heights
    let chest = null; let pelvis = null;
    for (const child of first.root.children) {
      if (Math.abs(child.position.y - 1.07) < 0.03 && child.type === 'Group') chest = child;
      if (child.geometry && Math.abs(child.position.y - 0.98) < 0.03) pelvis = child;
    }
    if (!belt || !chest || !pelvis) return { fail: `parts missing belt=${!!belt} chest=${!!chest} pelvis=${!!pelvis}` };
    const rel = { bc: [], pc: [] };
    for (let k = 0; k < 120; k += 1) {
      for (const { c } of chars) c.update(1 / 60);
      rel.bc.push(belt.position.y - chest.position.y);
      rel.pc.push(pelvis.position.y - chest.position.y);
    }
    spread.beltVsChest = +(Math.max(...rel.bc) - Math.min(...rel.bc)).toFixed(5);
    spread.pelvisVsChest = +(Math.max(...rel.pc) - Math.min(...rel.pc)).toFixed(5);

    // NEGATIVE CONTROL: reintroduce the old differential runtime-only for 40
    // frames — the same spread metric MUST light up, or it cannot be
    // trusted to certify lockstep.
    const ctl = [];
    for (let k = 0; k < 40; k += 1) {
      for (const { c } of chars) c.update(1 / 60);
      belt.position.y = 1.055; // the old static-belt law, planted
      ctl.push(belt.position.y - chest.position.y);
    }
    const controlSpread = +(Math.max(...ctl) - Math.min(...ctl)).toFixed(5);

    // G2: radial seat, computed in the HEAD GROUP'S OWN SPACE — for a
    // SphereGeometry skull the mathematical surface IS the mesh surface,
    // and local coordinates make the check scale-proof across seeds. Gap =
    // (distance of the feature's rear face from the skull centre) - radius;
    // positive mm = proud, small negative = pressed in.
    const featureSeat = [];
    for (const { root } of chars) {
      let headGroup = null;
      root.traverse((obj) => {
        if (!headGroup && obj.type === 'Group' && Math.abs(obj.position.y - 0.62) < 0.02) headGroup = obj;
      });
      if (!headGroup) { featureSeat.push([{ kind: 'head', gapMm: null }]); continue; }
      let skull = null; const feats = [];
      headGroup.traverse((obj) => {
        if (obj.geometry?.type === 'SphereGeometry' && Math.abs((obj.geometry.parameters.radius ?? 0) - 0.155) < 1e-3) skull = obj;
        if (obj.geometry?.type === 'BoxGeometry') {
          const w = obj.geometry.parameters.width ?? 0;
          if (Math.abs(w - 0.052) < 1e-3) feats.push({ kind: 'brow', obj });
          if (Math.abs(w - 0.058) < 1e-3) feats.push({ kind: 'mouth', obj });
        }
      });
      if (!skull) { featureSeat.push([{ kind: 'skull', gapMm: null }]); continue; }
      const centre = skull.position; // head-local
      const seats = [];
      for (const f of feats) {
        const pos = f.obj.position; // head-local (features are direct children)
        const halfDepth = (f.obj.geometry.parameters.depth ?? 0.01) / 2;
        // rear-face point: pulled toward the centre along local -z by halfDepth
        const rear = { x: pos.x, y: pos.y, z: pos.z - halfDepth };
        const r = Math.sqrt(
          (rear.x - centre.x) ** 2 + (rear.y - centre.y) ** 2 + (rear.z - centre.z) ** 2,
        );
        seats.push({ kind: f.kind, gapMm: +(((r - 0.155) * 914.4)).toFixed(1) });
      }
      featureSeat.push(seats);
    }
    return { spread, controlSpread, featureSeat };
  });

  // face-on screenshots. Walk camera forward = (-sin yaw, 0, -cos yaw)
  // (mouseLook.js YXZ), so yaw PI looks +z; the row is turned to face -z so
  // the camera south of it sees faces, not the backs of caps.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const stage = s3.scene.getObjectByName('G_STAGE');
    for (const root of stage.children) root.rotation.y = Math.PI;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = o.x - 5.0; w.z = o.z - 0.4; w.yaw = Math.PI; w.pitch = -0.02;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'four-faces.png') });
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = o.x - 5.45; w.z = o.z + 1.2; w.yaw = Math.PI; w.pitch = 0.02;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'close-face.png') });
  // The float is along the face normal, so it hides from a face-on camera;
  // the profile is where a proud brow/mouth reads as a silhouette gap.
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = o.x - 5.45 - 0.85; w.z = o.z + 2.35; w.yaw = Math.PI * 1.5; w.pitch = -0.08;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'profile-face.png') });

  const study = out.study;
  const seats = (study.featureSeat || []).flat().filter((f) => f && !f.fail);
  out.checks = {
    lockstep: study.spread
      && study.spread.beltVsChest < 0.002 && study.spread.pelvisVsChest < 0.002,
    controlSeesDifferential: (study.controlSpread ?? 0) > 0.01,
    allFeaturesSeated: seats.length >= 8
      && seats.every((f) => f.gapMm !== null && f.gapMm <= 2.5 && f.gapMm >= -6),
    noPageErrors: errs.length === 0,
  };
  out.seatSummary = seats;
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'g.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
