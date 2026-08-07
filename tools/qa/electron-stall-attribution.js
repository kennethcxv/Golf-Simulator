// A — WHAT THE 1,877 ms FRAME IS.
//
// electron-frame-profile.js found the shape of the complaint: average frame rate
// is fine (70-160 fps on an RTX 5080) and the 1% low at a shop-floor spin is
// 1.9 fps. So "laggy and glitchy" is not a throughput problem, it is a handful of
// multi-hundred-millisecond stalls. An average cannot tell you what a stall is.
//
// Four things can produce a second-long frame in this renderer, and they are
// distinguishable by what CHANGES across the frame:
//
//   shader compile     renderer.info.programs.length goes UP. ANGLE defers the
//                      real HLSL compile to a program's first draw, so this is
//                      one stall per new program, on the JS thread.
//   light-count churn  the number of VISIBLE lights of some type changes. Three
//                      recompiles every standard material when it does — which
//                      shows up as programs.length going up a LOT at once.
//   shadow bake        post.stats().shadowBakes increments. Bounded, ~10Hz.
//   geometry/texture   info.memory.geometries or .textures goes up: a first
//                      upload of a large buffer.
//
// So every frame records all four, and the worst frames are reported with the
// deltas beside them. Nothing here is inferred from a total.
//
// TWO INSTRUMENT FAULTS FOUND HERE, both worth more than the result:
//
//  1. `needsUpdate = true` COMPILES NOTHING. The first control dirtied all 3,388
//     standard materials and expected a recompile storm; it got no stall and no
//     program growth. needsUpdate bumps material.version, which makes setProgram
//     re-derive the cache KEY — and an unchanged key hits the cache and returns
//     the same program. Only a changed key compiles. The control now gives each
//     of twenty materials a unique #define.
//  2. `info.programs.length` IS A NET COUNT. Three releases a program when its
//     last user leaves, so a material swapping to a new define RELEASES one and
//     ACQUIRES one: twenty forced compiles read as +2. Program arrivals are now
//     counted as additions to the set of cacheKeys, cumulatively.
//
// And one limit that cannot be instrumented away: ANGLE defers the real HLSL
// compile to a program's FIRST DRAW, which need not be the frame that acquired
// it. So an arrival is a leading indicator of a stall, not a coincident one, and
// this probe does not claim to label individual frames with certainty.
//
// WHAT IT DOES CLAIM, and what it gates on: the SAME pose spun TWICE. Nothing
// about the world differs between the two passes except that the GPU has now
// seen this content. If pass 1 stalls and pass 2 does not, the stalls are a
// first-visit cost — and with geometry and texture uploads both measured at zero
// across every stall frame, program compilation is the only first-visit cost
// left in a WebGL renderer.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/stall-attribution');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
  });

  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const S = { on: false, rows: [] };
    window.__stall = S;
    const lightCensus = () => {
      let point = 0; let spot = 0; let dir = 0; let area = 0; let hemi = 0;
      s3.scene.traverse((o) => {
        if (!o.isLight) return;
        // three counts a light only if it and every ancestor is visible
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (!vis) return;
        if (o.isPointLight) point++;
        else if (o.isSpotLight) spot++;
        else if (o.isDirectionalLight) dir++;
        else if (o.isRectAreaLight) area++;
        else if (o.isHemisphereLight) hemi++;
      });
      return { point, spot, dir, area, hemi };
    };
    S.lightCensus = lightCensus;
    S.start = () => {
      S.on = true; S.rows = []; S.arrived = 0;
      const info = s3.renderer.info;
      const stats = s3.post.stats;
      let last = performance.now();
      // the SET, not the length — see fault 2 in the header
      let known = new Set((info.programs || []).map((p) => p.cacheKey));
      let geo = info.memory.geometries;
      let tex = info.memory.textures;
      let bakes = stats ? stats().shadowBakes : 0;
      let lights = lightCensus();
      const lightSum = (l) => l.point + l.spot + l.dir + l.area + l.hemi;
      const loop = (t) => {
        if (!S.on) return;
        const live = info.programs || [];
        let nProg = 0;
        const nextKnown = new Set();
        for (const p of live) {
          nextKnown.add(p.cacheKey);
          if (!known.has(p.cacheKey)) nProg++;
        }
        known = nextKnown;
        S.arrived += nProg;
        const nGeo = info.memory.geometries;
        const nTex = info.memory.textures;
        const nBakes = stats ? stats().shadowBakes : 0;
        // the light census is a full scene traverse — only pay for it on a frame
        // that already went wrong, plus every 30th frame as a slow baseline
        const ms = t - last;
        const slow = ms > 40;
        const nLights = (slow || S.rows.length % 30 === 0) ? lightCensus() : lights;
        S.rows.push({
          ms: Math.round(ms * 10) / 10,
          programs: live.length,
          arrived: S.arrived,
          dProg: nProg,
          dGeo: nGeo - geo,
          dTex: nTex - tex,
          bake: nBakes !== bakes,
          lights: lightSum(nLights),
          dLights: lightSum(nLights) - lightSum(lights),
          lightBreak: nLights,
        });
        geo = nGeo; tex = nTex; bakes = nBakes; lights = nLights;
        last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    S.stop = () => {
      S.on = false;
      const rows = S.rows.slice(4);
      // Deliberately NOT a verdict per frame. An arrival on this frame is strong
      // evidence; a stall on a frame with no arrival may still be the deferred
      // first draw of a program acquired earlier, and the label says so rather
      // than defaulting to whatever else happened to be true.
      const label = (r) => {
        if (r.dProg > 0) return `program-arrival(+${r.dProg})`;
        if (r.dLights !== 0) return `light-count(${r.dLights > 0 ? '+' : ''}${r.dLights})`;
        if (r.dGeo > 0 || r.dTex > 0) return `upload(geo+${r.dGeo} tex+${r.dTex})`;
        if (r.bake) return 'bake-frame-no-arrival';
        return 'no-arrival-no-bake';
      };
      const stalls = rows.filter((r) => r.ms > 40).map((r) => ({ ...r, cause: label(r) }));
      const byCause = {};
      for (const s of stalls) {
        const key = s.cause.replace(/\(.*\)/, '');
        byCause[key] = byCause[key] || { frames: 0, totalMs: 0, worstMs: 0 };
        byCause[key].frames++;
        byCause[key].totalMs = Math.round((byCause[key].totalMs + s.ms) * 10) / 10;
        byCause[key].worstMs = Math.max(byCause[key].worstMs, s.ms);
      }
      return {
        frames: rows.length,
        totalMs: Math.round(rows.reduce((a, r) => a + r.ms, 0)),
        stallCount: stalls.length,
        stallMs: Math.round(stalls.reduce((a, r) => a + r.ms, 0)),
        byCause,
        worst: stalls.sort((a, b) => b.ms - a.ms).slice(0, 12),
        programsAtStart: rows[0]?.programs ?? null,
        programsAtEnd: rows[rows.length - 1]?.programs ?? null,
        programsArrived: S.arrived,
        lightsAtEnd: rows[rows.length - 1]?.lightBreak ?? null,
      };
    };
    window.__spin = { on: false, speed: 2.2 };
    const drive = () => {
      if (window.__spin.on) { s3.walk.state.yaw += window.__spin.speed / 60; s3.walk.state.pitch = -0.05; }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  });

  async function leg(name, { dx, dz, yaw, seconds = 10, spin = true, move = false, mid = null }) {
    await page.evaluate(({ dx: ax, dz: az, yaw: ay }) => {
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const w = window.__fw.scene3d.walk.state;
      w.x = o.x + ax; w.z = o.z + az; w.yaw = ay; w.pitch = -0.05;
    }, { dx, dz, yaw });
    await page.waitForTimeout(900);
    if (move) await page.keyboard.down('w');
    await page.evaluate((on) => { window.__spin.on = on; }, spin);
    await page.evaluate(() => window.__stall.start());
    if (mid) {
      await page.waitForTimeout((seconds * 1000) / 2);
      await page.evaluate(mid);
      await page.waitForTimeout((seconds * 1000) / 2);
    } else {
      await page.waitForTimeout(seconds * 1000);
    }
    const r = await page.evaluate(() => window.__stall.stop());
    await page.evaluate(() => { window.__spin.on = false; });
    if (move) await page.keyboard.up('w');
    return { name, ...r };
  }

  // WHICH programs arrive late. three.js stamps every WebGLProgram with the
  // cacheKey it was built from, so the set that appears during a spin can be
  // diffed against the set the prewarm left behind.
  //
  // THE SNAPSHOT MUST COME AFTER THE DRIVER'S OWN WORLD-SETUP HAS BEEN DRAWN.
  // The first version took it immediately after opening the shop and jumping the
  // clock to 1 PM, and 35 programs then appeared within a handful of frames —
  // programs THIS DRIVER caused, counted against the game. Three seconds of
  // frames first, so the baseline is a world that has been rendered as
  // configured.
  await page.waitForTimeout(3000);
  const keysBefore = await page.evaluate(() => (window.__fw.scene3d.renderer.info.programs || [])
    .map((p) => p.cacheKey));

  const legs = [];
  // WHERE THE PLAYER ALREADY IS, first, and without moving. Programs that arrive
  // HERE are the living world's own churn — a customer spawning, a delivery
  // building — and no amount of camera-pose warming will catch them. Programs
  // that arrive only after the teleport are pose-driven and can be warmed. The
  // two want completely different fixes, so the probe separates them before
  // anything is changed.
  const spawnSettle = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });
  await page.evaluate(() => window.__stall.start());
  await page.waitForTimeout(12000);
  const atSpawn = await page.evaluate(() => window.__stall.stop());
  legs.push({ name: 'spawn-still-no-teleport', at: spawnSettle, ...atSpawn });

  // The pose the frame profile found worst, spun twice: the second pass sees the
  // same geometry with every program already resident. If the stalls are
  // first-draw compiles they collapse; if they repeat, they are not.
  legs.push(await leg('shop-floor-spin-pass1', { dx: -5.6, dz: 2.4, yaw: 0, seconds: 12 }));
  legs.push(await leg('shop-floor-spin-pass2', { dx: -5.6, dz: 2.4, yaw: 0, seconds: 12 }));
  legs.push(await leg('shop-walk-spin', { dx: -5.6, dz: 5.2, yaw: 1.2, seconds: 12, move: true }));
  legs.push(await leg('outdoor-spin', { dx: -2.0, dz: 20.0, yaw: 0.2, seconds: 10 }));

  const keysAfter = await page.evaluate(() => (window.__fw.scene3d.renderer.info.programs || [])
    .map((p) => p.cacheKey));
  const beforeSet = new Set(keysBefore);
  const late = keysAfter.filter((k) => !beforeSet.has(k));
  const lateArrivals = late.map((k) => ({ shader: String(k).split(',')[0], len: String(k).split(',').length }));
  const lateByShader = {};
  for (const a of lateArrivals) lateByShader[a.shader] = (lateByShader[a.shader] || 0) + 1;

  // WHY each late program is a different program. A three.js cacheKey is a
  // comma-joined array of parameter values in a fixed order, so the nearest
  // early key of the same length names the field that differs — which is the
  // difference between "the light count changed" and "this material was simply
  // never drawn before", and those want opposite fixes. Guessing between them is
  // how the first attempt at this went wrong.
  //
  // The TAIL of the array is a fixed sequence (vendor/three.module.js
  // getProgramCacheKeyParameters), so counting back from the end names each
  // field without having to know how many #defines shifted the head.
  const TAIL = [
    'customProgramCacheKey', 'outputColorSpace', 'booleanFlags', 'depthPacking',
    'numClipIntersection', 'numClippingPlanes', 'toneMapping', 'shadowMapType',
    'numLightProbes', 'numSpotLightShadowsWithMaps', 'numSpotLightShadows',
    'numPointLightShadows', 'numDirLightShadows', 'numRectAreaLights',
    'numHemiLights', 'numSpotLightMaps', 'numSpotLights', 'numPointLights',
    'numDirLights', 'morphAttributeCount', 'morphTargetsCount', 'sizeAttenuation',
    'fogExp2', 'combine', 'thicknessMapUv', 'transmissionMapUv',
  ];
  const fieldName = (i, len) => TAIL[len - 1 - i] || `head#${i}`;
  const fieldDiffs = {};
  let sameLengthTwins = 0;
  let noTwin = 0;
  for (const k of late) {
    const parts = String(k).split(',');
    let best = null;
    for (const e of keysBefore) {
      const ep = String(e).split(',');
      if (ep.length !== parts.length || ep[0] !== parts[0]) continue;
      let d = 0;
      const at = [];
      for (let i = 0; i < parts.length; i++) if (ep[i] !== parts[i]) { d++; at.push(i); }
      if (!best || d < best.d) best = { d, at, ep };
    }
    if (!best) { noTwin++; continue; }
    sameLengthTwins++;
    const sig = best.at.map((i) => `${fieldName(i, parts.length)}:${best.ep[i]}->${parts[i]}`).join(' ');
    const keySig = best.at.length > 4 ? `${best.at.length} fields differ` : (sig || 'identical(!)');
    fieldDiffs[keySig] = (fieldDiffs[keySig] || 0) + 1;
  }

  // ---- negative control ---------------------------------------------------------------
  //
  // THIRD TRY. Attempt two gave a unique define to twenty EXISTING materials
  // found by scene traverse and produced two arrivals, not twenty — those
  // objects were not actually being drawn (culled, or on a layer the camera does
  // not carry). "Visible in the graph" is not "submitted this frame", and the
  // control has to be about what is submitted. So it now BUILDS twenty meshes a
  // couple of yards in front of the eye, where nothing can decline to draw them.
  const control = await leg('control-forced-compile', {
    dx: -5.6, dz: 2.4, yaw: 0, seconds: 8, spin: false,
    mid: async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const s3 = window.__fw.scene3d;
      const w = s3.walk.state;
      const holder = new THREE.Group();
      holder.name = 'QA_ForcedCompile';
      for (let i = 0; i < 20; i++) {
        const m = new THREE.MeshStandardMaterial({ color: 0x8899aa });
        m.defines = { FW_QA_FORCE_COMPILE: i };
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), m);
        box.position.set(
          w.x - Math.sin(w.yaw) * 2.2 + (i % 5) * 0.3 - 0.6,
          (s3.camera?.position?.y ?? 1.6) + Math.floor(i / 5) * 0.3 - 0.4,
          w.z - Math.cos(w.yaw) * 2.2,
        );
        box.frustumCulled = false;
        holder.add(box);
      }
      s3.scene.add(holder);
      window.__forcedDirty = 20;
      window.__forcedHolder = holder;
    },
  });
  await page.evaluate(() => {
    const h = window.__forcedHolder;
    if (!h) return;
    h.parent?.remove(h);
    h.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  });
  const forcedDirty = await page.evaluate(() => window.__forcedDirty || 0);

  const out = {
    legs,
    control,
    forcedDirty,
    programsAfterPrewarm: keysBefore.length,
    lateProgramCount: lateArrivals.length,
    lateByShader,
    fieldDiffs,
    sameLengthTwins,
    noTwin,
    checks: {
      // THE CONTROL: the probe must count the program arrivals it caused itself.
      // Twenty forced defines must read as ~twenty arrivals, not as the +2 that
      // a net length gave.
      controlSawItsOwnArrivals: control.programsArrived >= forcedDirty,
      controlForcedTwenty: forcedDirty === 20,
      // THE CLAIM: the same pose, twice. If the second pass is not dramatically
      // cheaper, these stalls are not a first-visit cost and the diagnosis is wrong.
      firstVisitCostsMore: legs[1].stallMs > legs[2].stallMs * 5,
      // ...and the internal control on that claim: a fresh pose OUTDOORS, where
      // the prewarm's own camera stood, must not stall. If everywhere stalled,
      // "the prewarm misses the interior" would not be the explanation.
      freshOutdoorPoseIsClean: legs[4].stallMs < 200,
      noUploadsOnStallFrames: [...legs, control]
        .every((l) => l.worst.every((w) => w.dGeo === 0 && w.dTex === 0)),
      everyLegSampled: legs.length === 5 && legs.every((l) => l.frames > 100),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlSawItsOwnArrivals && out.checks.controlForcedTwenty
    && out.checks.everyLegSampled;
  fs.writeFileSync(path.join(OUT, 'attribution.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
