// How much of the player's view does each pro-shop asset actually occupy?
//
//   node tools/qa/run-playwright.cjs tools/qa/proshop-screen-time.js
//
// "Roughly how much screen time it gets" is the one property in the discriminator audit
// that cannot be read out of a GLB, and it is the one most easily fabricated by
// eyeballing the room. This measures it.
//
// Method: an ID pass. Every mesh is temporarily swapped for a flat unlit material whose
// colour encodes which asset it belongs to, the scene is rendered to an offscreen target
// from each sampled pose, and the pixels are counted. Occlusion, perspective and the
// real lens all fall out of the render for free, which is why this is a render and not a
// bounding-box projection: the shelving unit behind the partition subtends a large solid
// angle and is worth nothing, and only a depth-tested render knows that.
//
// The pose set is a lattice over every position the player can physically stand in,
// times eight yaws, times two pitches. That is a UNIFORM prior over where the player
// stands, not a dwell-weighted one -- nobody has measured dwell, and inventing a weight
// would put a thumb on exactly the scale this audit exists to read. Stated here so the
// number is not mistaken for a playtest.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.join(repo, 'Designs', 'ProShop', 'Discriminator', 'data');
  fs.mkdirSync(out, { recursive: true });

  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);
  const M = 13 * 60;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(4000);

  // Stand inside. Detail content is gated on the player being in the room, so a probe
  // that never walks in measures an empty shell.
  await page.evaluate((m) => {
    const app = window.__fw; const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
    w.state.x = o.x + 5; w.state.z = o.z; app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
  }, M);
  await page.waitForTimeout(12000);

  const result = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const origin = ch.interior.position;
    const renderer = s3.renderer;

    // --- population -------------------------------------------------------------
    const roots = [];
    ch.interior.traverse((n) => {
      const m = /^AssetRuntime_(\d+)_([A-Za-z0-9_]+)$/.exec(n.name || '');
      if (m) roots.push({ node: n, n: Number(m[1]), name: n.name });
    });
    // One asset may be placed more than once (the shelving system is two fixtures);
    // screen time belongs to the ASSET, so instances of the same number share an id.
    const byNumber = new Map();
    roots.forEach((r) => {
      if (!byNumber.has(r.n)) byNumber.set(r.n, { n: r.n, instances: [], visible: false });
      const e = byNumber.get(r.n);
      e.instances.push(r.name);
      let vis = true;
      for (let p = r.node; p && p !== s3.scene; p = p.parent) if (!p.visible) { vis = false; break; }
      if (vis) e.visible = true;
    });
    const assets = [...byNumber.values()].sort((a, b) => a.n - b.n);

    // propPlacement.js merges the non-animated, non-fixture props into one global
    // `Assets61to100PlacedStaticBatch` and takes their source meshes off every camera
    // layer (`source.layers.mask = 0`) rather than hiding them. Left alone, their pixels
    // are drawn by a mesh this pass cannot attribute and ten assets score a flat zero --
    // which reads as "never on screen" when it means "drawn by something else". Restoring
    // the layer and hiding the batch draws identical geometry in identical places, with
    // the pixels attributed to the asset that owns them.
    const relayered = [];
    let batchNode = null;
    s3.scene.traverse((n) => {
      if (n.userData?.assetRuntimePlacedStaticBatch) batchNode = n;
      if (n.isMesh && n.userData?.assetRuntimePlacedStaticRenderSuppressed && n.layers.mask === 0) {
        relayered.push(n);
        n.layers.mask = 1;
      }
    });
    const batchWasVisible = batchNode ? batchNode.visible : null;
    if (batchNode) batchNode.visible = false;
    const batchedNumbers = new Set();
    roots.forEach((r) => {
      r.node.traverse((o) => {
        if (o.isMesh && o.userData?.assetRuntimePlacedStaticRenderSuppressed) batchedNumbers.add(r.n);
      });
    });

    // Colour ids on a 6-level lattice per channel. Decoding rounds to the nearest level,
    // so a stray bit from filtering or precision cannot silently reassign a pixel.
    const LEVELS = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const idOf = new Map();          // mesh -> asset index (1-based; 0 = not an asset)
    assets.forEach((a, i) => { a.id = i + 1; });
    const codeFor = (id) => [
      LEVELS[Math.floor(id / 36) % 6], LEVELS[Math.floor(id / 6) % 6], LEVELS[id % 6],
    ];
    if (assets.length + 1 > 216) throw new Error('too many assets for a 6-level id palette');

    roots.forEach((r) => {
      const id = byNumber.get(r.n).id;
      r.node.traverse((o) => { if (o.isMesh) idOf.set(o, id); });
    });

    // --- swap in the ID materials ------------------------------------------------
    const savedMaterial = new Map();
    const hiddenSprites = [];
    const idMaterials = new Map();
    const materialFor = (id, source) => {
      const key = `${id}|${source.side}`;
      let m = idMaterials.get(key);
      if (!m) {
        const [r, g, b] = codeFor(id);
        m = new THREE.MeshBasicMaterial({ side: source.side, toneMapped: false, fog: false });
        m.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
        idMaterials.set(key, m);
      }
      return m;
    };
    s3.scene.traverse((o) => {
      // Sprites, lines and points keep materials this pass cannot swap, so they would
      // draw their own colours into the ID buffer and decode as assets that do not
      // exist. Hidden for the duration and restored below.
      if (o.isSprite || o.isLine || o.isPoints) { hiddenSprites.push([o, o.visible]); o.visible = false; return; }
      if (!o.isMesh) return;
      savedMaterial.set(o, o.material);
      const id = idOf.get(o) || 0;
      const first = Array.isArray(o.material) ? o.material[0] : o.material;
      const swapped = materialFor(id, first || { side: THREE.FrontSide });
      o.material = Array.isArray(o.material) ? o.material.map(() => swapped) : swapped;
    });

    // --- pose lattice --------------------------------------------------------------
    // Every standable spot on a 1.5 yd lattice. Standable is tested the way the walker
    // tests it: nothing solid within the player's radius.
    const RADIUS = s3.walk?.state?.radius ?? 0.34;
    const EYE = s3.walk?.state?.eye ?? 1.75;
    const FOV = s3.walk?.state?.fov ?? s3.camera.fov;
    const ray = new THREE.Raycaster();
    ray.camera = s3.camera;
    ray.far = RADIUS + 0.05;
    // 0.75 yd spacing, not 1.5. The room is partitioned into a shop floor, a stockroom,
    // a lounge and a back office; a coarse lattice lands no standable point inside the
    // smaller ones and reports their contents as never seen, which is an artefact of the
    // sampling rather than a fact about the game.
    const standable = [];
    const blocked = [];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
    for (let lx = -8.25; lx <= 8.26; lx += 0.75) {
      for (let lz = -4.5; lz <= 4.51; lz += 0.75) {
        const p = new THREE.Vector3(origin.x + lx, origin.y + 1.0, origin.z + lz);
        let clear = true;
        for (const dir of DIRS) {
          ray.set(p, new THREE.Vector3(dir[0], 0, dir[1]));
          const hits = ray.intersectObject(ch.interior, true)
            .filter((h) => h.object.visible && !h.object.isSprite);
          if (hits.length) { clear = false; break; }
        }
        // Indoors, not merely unobstructed: a point outside the shell also has nothing
        // within arm's reach. Require floor below and ceiling above.
        if (clear) {
          ray.far = 6;
          ray.set(p, new THREE.Vector3(0, -1, 0));
          const down = ray.intersectObject(ch.interior, true).filter((h) => h.object.visible && !h.object.isSprite);
          ray.set(p, new THREE.Vector3(0, 1, 0));
          const up = ray.intersectObject(ch.interior, true).filter((h) => h.object.visible && !h.object.isSprite);
          ray.far = RADIUS + 0.05;
          if (!down.length || !up.length) clear = false;
        }
        (clear ? standable : blocked).push([+lx.toFixed(2), +lz.toFixed(2)]);
      }
    }

    // --- ID render over every pose --------------------------------------------------
    const W = 256; const H = 144;
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
    });
    const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.05, 400);
    const buf = new Uint8Array(W * H * 4);
    const totals = new Float64Array(assets.length + 1);
    const peak = new Float64Array(assets.length + 1);
    const framesSeen = new Int32Array(assets.length + 1);

    const savedTone = renderer.toneMapping;
    const savedTarget = renderer.getRenderTarget();
    const savedBackground = s3.scene.background;
    renderer.toneMapping = THREE.NoToneMapping;
    s3.scene.background = null;

    const YAWS = 8;
    const PITCHES = [0, -0.35];
    let frames = 0;
    let unknownPixels = 0;
    const decode = (v) => Math.round((v / 255) * 5);
    for (const [lx, lz] of standable) {
      for (let y = 0; y < YAWS; y += 1) {
        const yaw = (y / YAWS) * Math.PI * 2;
        for (const pitch of PITCHES) {
          cam.position.set(origin.x + lx, origin.y + EYE, origin.z + lz);
          cam.rotation.set(0, 0, 0);
          cam.rotateY(yaw);
          cam.rotateX(pitch);
          cam.updateMatrixWorld(true);
          renderer.setRenderTarget(rt);
          renderer.setClearColor(0x000000, 1);
          renderer.clear(true, true, true);
          renderer.render(s3.scene, cam);
          renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
          frames += 1;
          const frameCount = new Int32Array(assets.length + 1);
          for (let i = 0; i < buf.length; i += 4) {
            const id = decode(buf[i]) * 36 + decode(buf[i + 1]) * 6 + decode(buf[i + 2]);
            if (id === 0) continue;
            if (id > assets.length) { unknownPixels += 1; continue; }
            frameCount[id] += 1;
          }
          for (let id = 1; id <= assets.length; id += 1) {
            if (!frameCount[id]) continue;
            const frac = frameCount[id] / (W * H);
            totals[id] += frac;
            framesSeen[id] += 1;
            if (frac > peak[id]) peak[id] = frac;
          }
        }
      }
    }

    // --- restore -------------------------------------------------------------------
    renderer.setRenderTarget(savedTarget);
    renderer.toneMapping = savedTone;
    s3.scene.background = savedBackground;
    for (const [o, mat] of savedMaterial) o.material = mat;
    for (const [o, vis] of hiddenSprites) o.visible = vis;
    for (const m of idMaterials.values()) m.dispose();
    for (const n of relayered) n.layers.mask = 0;
    if (batchNode) batchNode.visible = batchWasVisible;
    rt.dispose();

    // Where each asset actually sits. Without this a zero cannot be told apart from an
    // asset parked off-stage at y = -256 by the fixture-gating fallback, and those two
    // zeroes mean opposite things.
    const placement = new Map();
    for (const a of assets) {
      const box = new THREE.Box3();
      for (const name of a.instances) {
        const node = ch.interior.getObjectByName(name);
        if (!node) continue;
        node.traverse((n) => {
          if (!n.isMesh || /^COL_|Collision/i.test(n.name || '')) return;
          box.expandByObject(n);
        });
      }
      if (box.isEmpty()) { placement.set(a.n, null); continue; }
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      placement.set(a.n, {
        localCentre: [+(c.x - origin.x).toFixed(2), +(c.y - origin.y).toFixed(2), +(c.z - origin.z).toFixed(2)],
        sizeYd: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)],
        inRoom: Math.abs(c.x - origin.x) < 9 && Math.abs(c.z - origin.z) < 5.5 && (c.y - origin.y) > -2,
      });
    }

    const rows = assets.map((a) => ({
      n: a.n,
      instances: a.instances,
      visibleInStarter: a.visible,
      drawnFromGlobalBatch: batchedNumbers.has(a.n),
      placement: placement.get(a.n),
      // Mean share of the frame across every sampled pose: the screen-time figure.
      meanScreenPct: +((totals[a.id] / frames) * 100).toFixed(4),
      // Share of poses in which any pixel of it is visible at all.
      visibleInPosesPct: +((framesSeen[a.id] / frames) * 100).toFixed(2),
      // Largest share it ever reaches, i.e. how big it gets when you do look at it.
      peakScreenPct: +(peak[a.id] * 100).toFixed(3),
    }));

    return {
      frames,
      standablePositions: standable.length,
      blockedPositions: blocked.length,
      yaws: YAWS,
      pitches: PITCHES,
      resolution: [W, H],
      fov: FOV,
      eye: EYE,
      radius: RADIUS,
      unknownPixels,
      globalBatchRestoredMeshes: relayered.length,
      globalBatchAssets: [...batchedNumbers].sort((a, b) => a - b),
      assets: rows.sort((a, b) => b.meanScreenPct - a.meanScreenPct),
    };
  });

  fs.writeFileSync(path.join(out, 'screen-time.json'), `${JSON.stringify(result, null, 2)}\n`);
  return {
    ok: result.unknownPixels === 0 && result.frames > 0,
    frames: result.frames,
    standablePositions: result.standablePositions,
    unknownPixels: result.unknownPixels,
    top: result.assets.slice(0, 12).map((a) => `${a.n}: ${a.meanScreenPct}% mean, ${a.peakScreenPct}% peak, seen in ${a.visibleInPosesPct}% of poses`),
    zero: result.assets.filter((a) => a.meanScreenPct === 0).map((a) => a.n),
  };
}
