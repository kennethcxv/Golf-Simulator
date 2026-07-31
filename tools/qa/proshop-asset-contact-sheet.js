// One framed portrait of every pro-shop asset, shot identically, for visual ranking.
//
//   node tools/qa/run-playwright.cjs tools/qa/proshop-asset-contact-sheet.js
//
// The discriminator audit needs a best-to-worst ranking by eye, and a ranking is only
// worth correlating against if every asset got the same look. Same room, same lights,
// same clock, same lens, same three-quarter angle, and a standoff solved from each
// asset's own bounding sphere so a wall clock and a sofa arrive the same size in frame.
//
// Portraits, not in-situ shots. An earlier pass photographed each asset where it stands
// and a third of the frames came back as a partition, a neighbouring cabinet, or the
// inside of the subject itself -- this room is small and everything is pushed against a
// wall. Ranking construction quality from those would have ranked the room's layout. So
// every other renderable is hidden, the room's lights are left exactly as they are, and
// the backdrop is a flat neutral grey identical for all forty.
//
// The frames are rendered to an offscreen target with a camera this script owns, rather
// than by driving the player and screenshotting. Two earlier attempts did it the other
// way: the walk rig clamps the eye against collision and derives its height from terrain
// rather than from the interior root, so requested poses came back displaced by an amount
// that differed per asset -- the one thing a comparison set may not do. Owning the camera
// makes the framing exact and identical by construction. The cost is that GTAO and the
// rest of the post chain do not run, so these are lit-and-shaded portraits rather than
// final frames; tone mapping and colour space still match the game because the target is
// sRGB and the renderer's own tone mapping is left in place.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  // QA_FRAMES_DIR redirects the portraits (e.g. an after-fix re-shoot that must not
  // clobber the frames the ranking was made from). QA_ONLY_ASSETS="73,78,87" limits the
  // pass; a limited pass writes its contact-sheet.json next to its frames, never over
  // the full-population data file.
  const out = process.env.QA_FRAMES_DIR
    ? path.resolve(repo, process.env.QA_FRAMES_DIR)
    : path.join(repo, 'Designs', 'ProShop', 'Discriminator', 'frames');
  const only = String(process.env.QA_ONLY_ASSETS || '')
    .split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
  const dataDir = only.length ? out : path.join(repo, 'Designs', 'ProShop', 'Discriminator', 'data');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);
  const M = 13 * 60;

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
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

  // Stand inside: the room's detail content is gated on the player being in it.
  await page.evaluate((m) => {
    const app = window.__fw; const s3 = app.scene3d;
    const o = s3.clubhouse().interior.position; const w = s3.walk; w.clearKeys();
    w.state.x = o.x + 5; w.state.z = o.z; app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + m;
    s3.applyTimeWeather(m, app.state.weather);
    const cs = typeof s3.clubhouse().customers === 'function' ? s3.clubhouse().customers() : s3.clubhouse().customers;
    if (Array.isArray(cs)) cs.forEach((c2) => { if (c2 && c2.mesh) c2.mesh.visible = false; });
  }, M);
  await page.waitForTimeout(12000);

  const subjects = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const seen = new Map();
    ch.interior.traverse((n) => {
      const m = /^AssetRuntime_(\d+)_([A-Za-z0-9_]+)$/.exec(n.name || '');
      if (!m) return;
      if (!seen.has(Number(m[1]))) seen.set(Number(m[1]), n.name);
    });
    return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([n, name]) => ({ n, name }));
  });
  const wanted = only.length ? subjects.filter((s) => only.includes(s.n)) : subjects;

  const shots = [];
  for (const subject of wanted) {
    const shot = await page.evaluate(async ({ target }) => {
      const THREE = await import('/vendor/three.module.js');
      const s3 = window.__fw.scene3d; const ch = s3.clubhouse(); const o = ch.interior.position;
      const renderer = s3.renderer;
      const SIZE = 700;
      const FILL = 0.78;          // share of the vertical FOV the bounding sphere subtends
      const AZIMUTH = 35 * Math.PI / 180;

      let node = null;
      ch.interior.traverse((n) => { if (!node && (n.name || '') === target) node = n; });
      if (!node) return { found: false, target };

      // --- un-batch ---------------------------------------------------------------
      // propPlacement.js merges the non-animated, non-fixture props into one global
      // `Assets61to100PlacedStaticBatch` and takes their source meshes off every camera
      // layer (`source.layers.mask = 0`) rather than hiding them. Those meshes therefore
      // still report visible === true and still have bounds, but draw nothing -- which is
      // why an earlier pass returned ten empty portraits and read them as assets that are
      // never on screen. Restoring the layer and hiding the batch draws exactly the same
      // geometry in exactly the same place, attributed to the asset it belongs to.
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
      const unbatch = () => {
        for (const n of relayered) n.layers.mask = 0;
        if (batchNode) batchNode.visible = batchWasVisible;
      };

      // --- isolate ---------------------------------------------------------------
      // Nothing in here yields to the render loop, so the scene is only ever in this
      // state inside this call and the game never draws a frame of it.
      const saved = new Map();
      const hide = (n) => { if (!saved.has(n)) { saved.set(n, n.visible); n.visible = false; } };
      const keep = new Set();
      for (let p = node; p; p = p.parent) keep.add(p);
      s3.scene.traverse((n) => {
        if (keep.has(n) || n.isLight) return;
        let inside = false;
        for (let p = n; p; p = p.parent) if (p === node) { inside = true; break; }
        if (inside) return;
        if (n.isMesh || n.isSprite || n.isLine || n.isPoints) hide(n);
      });
      const wasVisible = node.visible;
      for (let p = node; p && p !== s3.scene; p = p.parent) {
        if (!p.visible) { if (!saved.has(p)) saved.set(p, p.visible); p.visible = true; }
      }

      let meshTotal = 0; let meshVisible = 0; let meshBatched = 0;
      node.traverse((n) => {
        if (!n.isMesh) return;
        meshTotal += 1;
        if (n.visible) meshVisible += 1;
        if (n.userData?.assetRuntimePlacedStaticRenderSuppressed) meshBatched += 1;
      });

      const box = new THREE.Box3();
      node.traverse((n) => {
        if (!n.isMesh || !n.visible || /^COL_|Collision/i.test(n.name || '')) return;
        box.expandByObject(n);
      });
      const restore = () => {
        for (const [n, v] of saved) n.visible = v;
        unbatch();
      };
      if (box.isEmpty()) { restore(); return { found: true, target, empty: true, meshTotal, meshVisible }; }

      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = size.length() / 2;

      // --- camera ----------------------------------------------------------------
      // Exact fit: a sphere of radius r at distance d subtends 2*asin(r/d), so solving
      // for a fixed share of the vertical FOV puts every asset at the same apparent size
      // regardless of whether it is a wall clock or a sofa.
      const fovV = (s3.walk?.state?.fov ?? s3.camera.fov) * Math.PI / 180;
      const dist = radius / Math.sin((FILL * fovV) / 2);

      // Elevation is NOT a constant. A fixed downward three-quarter is right for a desk
      // and wrong for anything mounted above the player's head: it photographs a ceiling
      // camera's mounting plate, which is the one face nobody in the game will ever see.
      // So the elevation is the angle a standing player's eye actually makes with the
      // asset from this standoff, clamped so a floor mat is still shot at a readable
      // slant rather than from directly overhead.
      const eyeY = o.y + (s3.walk?.state?.eye ?? 1.75);
      const rawElevation = Math.atan2(eyeY - centre.y, dist);
      const ELEVATION = Math.max(-55 * Math.PI / 180, Math.min(48 * Math.PI / 180, rawElevation));

      const cam = new THREE.PerspectiveCamera(s3.walk?.state?.fov ?? s3.camera.fov, 1, 0.02, 300);
      const place = (az) => {
        const horiz = Math.cos(ELEVATION) * dist;
        cam.position.set(
          centre.x + Math.sin(az) * horiz,
          centre.y + Math.sin(ELEVATION) * dist,
          centre.z + Math.cos(az) * horiz,
        );
        cam.lookAt(centre);
        cam.updateMatrixWorld(true);
      };

      const savedTarget = renderer.getRenderTarget();
      const savedBackground = s3.scene.background;
      // Fog is left alone. The render loop writes fog.density every frame and replacing
      // the object with null throws; over a two-yard standoff indoors it contributes
      // nothing anyway.
      s3.scene.background = new THREE.Color(0x6E7378);
      const BG = [0x6E, 0x73, 0x78];
      const shoot = (size, samples) => {
        const rt = new THREE.WebGLRenderTarget(size, size, {
          colorSpace: THREE.SRGBColorSpace, samples, depthBuffer: true,
        });
        renderer.setRenderTarget(rt);
        renderer.clear(true, true, true);
        renderer.render(s3.scene, cam);
        const b = new Uint8Array(size * size * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, size, size, b);
        rt.dispose();
        let covered = 0;
        for (let i = 0; i < b.length; i += 4) {
          if (b[i] !== BG[0] || b[i + 1] !== BG[1] || b[i + 2] !== BG[2]) covered += 1;
        }
        // Internal structure: luminance steps between neighbouring pixels that are BOTH
        // on the subject. Silhouette edges are excluded deliberately -- they measure how
        // big the thing is, and every candidate angle is looking at the same thing.
        const lum = new Float32Array(size * size);
        const onSubject = new Uint8Array(size * size);
        for (let p = 0; p < size * size; p += 1) {
          const i = p * 4;
          onSubject[p] = (b[i] !== BG[0] || b[i + 1] !== BG[1] || b[i + 2] !== BG[2]) ? 1 : 0;
          lum[p] = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
        }
        let edges = 0;
        let perimeter = 0;
        for (let y = 0; y < size - 1; y += 1) {
          for (let x = 0; x < size - 1; x += 1) {
            const p = y * size + x;
            if (!onSubject[p]) {
              // Background pixel touching the subject: one step of silhouette outline.
              if (onSubject[p + 1] || onSubject[p + size]) perimeter += 1;
              continue;
            }
            if (!onSubject[p + 1] || !onSubject[p + size]) perimeter += 1;
            if (onSubject[p + 1] && Math.abs(lum[p] - lum[p + 1]) > 6) edges += 1;
            else if (onSubject[p + size] && Math.abs(lum[p] - lum[p + size]) > 6) edges += 1;
          }
        }
        // Isoperimetric ratio: 1 for a disc, higher the more indented the outline. A
        // shelving unit is full of holes and scores high; a box scores near 1.
        const compactness = covered > 0 ? (perimeter * perimeter) / (4 * Math.PI * covered) : null;
        return {
          buf: b,
          coverage: covered / (size * size),
          edges,
          // Per unit of subject area, so it measures detail DENSITY rather than how much
          // of the frame the asset happens to fill.
          edgeDensity: covered > 0 ? edges / covered : 0,
          compactness,
        };
      };

      // --- choose the azimuth by measured structure -------------------------------
      // A fixed angle relative to the room photographed the filing cabinet and the
      // trophy cabinet edge-on, and an asset shot edge-on ranks worse than one shot
      // face-on for reasons that have nothing to do with how well it was built. So the
      // angle is measured over twelve candidates.
      //
      // Scored on visible INTERNAL STRUCTURE, not on silhouette area. Area picks the
      // back of a cabinet every time -- a flat slab is the largest projection an object
      // has -- which is precisely the view that hides the drawers, the muntins and the
      // hardware. Structure picks the face that has something on it, which is the face a
      // person would photograph. The winner is then skewed as far off square as still
      // shows 90% of that structure, because square-on hides depth and depth is part of
      // what is being judged.
      const probes = [];
      for (let i = 0; i < 12; i += 1) {
        const az = (i / 12) * Math.PI * 2;
        place(az);
        const p = shoot(128, 0);
        probes.push({
          az,
          deg: Math.round((az * 180) / Math.PI),
          coverage: p.coverage,
          edges: p.edges,
          edgeDensity: p.edgeDensity,
          compactness: p.compactness,
        });
      }
      const bestProbe = probes.reduce((a, b) => (b.edges > a.edges ? b : a));
      const threeQuarter = probes
        .filter((p) => p.edges >= bestProbe.edges * 0.9)
        .map((p) => {
          let delta = Math.abs(p.az - bestProbe.az);
          if (delta > Math.PI) delta = Math.PI * 2 - delta;
          return { ...p, delta };
        })
        .filter((p) => p.delta <= (50 * Math.PI) / 180)
        .reduce((a, b) => (b.delta > a.delta ? b : a), { ...bestProbe, delta: 0 });
      // Nudge toward a three-quarter read even when every candidate was equal.
      const chosenAz = threeQuarter.delta > 0.05 ? threeQuarter.az : bestProbe.az + AZIMUTH;
      place(chosenAz);

      const final = shoot(SIZE, 4);
      const { buf, coverage } = final;
      renderer.setRenderTarget(savedTarget);
      s3.scene.background = savedBackground;
      restore();

      // Averaged over all twelve angles, so the figure describes the asset rather than
      // the one angle it was photographed from.
      const mean = (f) => probes.reduce((a, p) => a + f(p), 0) / probes.length;

      // readRenderTargetPixels is bottom-up; canvas ImageData is top-down.
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(SIZE, SIZE);
      for (let y = 0; y < SIZE; y += 1) {
        const src = (SIZE - 1 - y) * SIZE * 4;
        img.data.set(buf.subarray(src, src + SIZE * 4), y * SIZE * 4);
      }
      ctx.putImageData(img, 0, 0);

      return {
        azimuthDeg: Math.round((chosenAz * 180) / Math.PI) % 360,
        elevationDeg: +((ELEVATION * 180) / Math.PI).toFixed(1),
        elevationFromPlayerEye: Math.abs(rawElevation - ELEVATION) < 1e-6,
        aboveEyeLevel: centre.y > eyeY,
        azimuthChosenBy: threeQuarter.delta > 0.05 ? 'measured structure, skewed to three-quarter' : 'measured structure + fixed offset',
        // Visible detail per unit of the asset's own area, at a fixed apparent size. This
        // is the closest thing here to what the eye is actually responding to, so it is
        // reported as a mean over all twelve angles as well as at the chosen one.
        edgeDensityMean: +mean((p) => p.edgeDensity).toFixed(4),
        edgeDensityChosen: +final.edgeDensity.toFixed(4),
        edgeDensityMax: +Math.max(...probes.map((p) => p.edgeDensity)).toFixed(4),
        // Silhouette indentation, 1.0 = a disc. Measures how much shape the outline has.
        compactnessMean: +mean((p) => p.compactness || 0).toFixed(3),
        structureProbes: probes.map((p) => ({
          deg: p.deg,
          coverage: +(p.coverage * 100).toFixed(1),
          edges: p.edges,
          edgeDensity: +p.edgeDensity.toFixed(4),
          compactness: p.compactness == null ? null : +p.compactness.toFixed(2),
        })),
        found: true, target, wasVisible, meshTotal, meshVisible, meshBatched,
        drawnFromGlobalBatch: meshBatched > 0,
        sizeYd: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
        radiusYd: +radius.toFixed(3),
        centreLocal: [+(centre.x - o.x).toFixed(2), +(centre.y - o.y).toFixed(2), +(centre.z - o.z).toFixed(2)],
        standoffYd: +dist.toFixed(3),
        coveragePct: +(coverage * 100).toFixed(1),
        png: canvas.toDataURL('image/png'),
      };
    }, { target: subject.name });

    if (shot.png) {
      const file = `asset_${String(subject.n).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(out, file), Buffer.from(shot.png.split(',')[1], 'base64'));
      shot.file = file;
      delete shot.png;
    }
    shots.push({ ...subject, ...shot });
  }

  fs.writeFileSync(path.join(dataDir, 'contact-sheet.json'), `${JSON.stringify({ shots }, null, 2)}\n`);
  const bad = shots.filter((s) => !s.found || s.empty || !s.file);
  return {
    ok: bad.length === 0,
    captured: shots.filter((s) => s.file).length,
    problems: bad.map((s) => `${s.n}: ${!s.found ? 'not found' : s.empty ? 'no visible geometry' : 'no image'}`),
    hiddenInStarter: shots.filter((s) => s.wasVisible === false).map((s) => s.n),
    drawnFromGlobalBatch: shots.filter((s) => s.drawnFromGlobalBatch).map((s) => s.n),
    emptyFrames: shots.filter((s) => s.coveragePct === 0).map((s) => s.n),
    coverage: shots.map((s) => `${s.n}: ${s.coveragePct}%`).join('  '),
  };
}
