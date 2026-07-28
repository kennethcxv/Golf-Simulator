// Measure APPARENT TEXEL DENSITY inside the pro shop.
//
// The question this answers: what texture resolution does a surface in this room
// actually need?  Not by convention ("2K is standard") but by measurement.
//
// Method.  For a sample of screen pixels we cast three rays — at the pixel, one
// pixel right, one pixel down — and read back both the world hit point and the
// UV.  That gives two derivatives at the same surface point:
//
//   yardsPerPixel   = |dWorld/dPixel|   how much of the world one pixel covers
//   texelsPerPixel  = |dTexel/dPixel|   how many texels the GPU samples per pixel
//                                       (this is exactly the GPU's mip selector)
//
// From those two:
//
//   pixelsPerYard   = 1 / yardsPerPixel        what the DISPLAY can resolve here
//   texelsPerYard   = texelsPerPixel / yardsPerPixel   what the ASSET supplies
//
// texelsPerYard is an intrinsic property of how an asset was textured — it does
// not depend on where the camera is.  pixelsPerYard is what the screen can show
// at that distance.  A surface needs texelsPerYard >= pixelsPerYard at the
// CLOSEST distance the player can reach it, and no more.  Everything above that
// is memory the player cannot see.
//
// texelsPerPixel is reported too because it is the direct read of waste:
//   texelsPerPixel ~= 1  -> matched, mip 0 in use
//   texelsPerPixel  = 4  -> 16x more texture than the screen resolves (2 mips down)
//   log2(texelsPerPixel) = the mip level the GPU picks.  If the MINIMUM mip level
//   observed across every pose is >= 1, mip 0 is never sampled and the map can be
//   halved with zero visible change.
//
// Runs against the live scene through tools/qa/run-playwright.cjs.
async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = 20260727; // pinned: the world seed is random per new game

  await page.setViewportSize({ width: 1600, height: 900 });
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
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(4500);

  const result = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const origin = ch.interior.position;
    const walk = s3.walk;
    const cam = s3.camera;

    const VIEW_W = 1600;
    const VIEW_H = 900;

    // ---- pose the camera in local shop coordinates ----------------------------
    // The camera transform is produced by the app's own frame loop, not by
    // assigning walk.state — so yield two real frames and then read back where
    // the camera actually ended up.  Every pose records its realised position so
    // a stuck camera shows up in the data instead of silently duplicating rows.
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pose = async (lx, lz, yaw, pitch) => {
      walk.clearKeys();
      walk.state.x = origin.x + lx;
      walk.state.z = origin.z + lz;
      walk.state.yaw = yaw;
      walk.state.pitch = pitch;
      await nextFrame();
      await nextFrame();
      cam.updateMatrixWorld(true);
      return {
        camLocal: [
          +(cam.position.x - origin.x).toFixed(3),
          +(cam.position.y - origin.y).toFixed(3),
          +(cam.position.z - origin.z).toFixed(3),
        ],
      };
    };

    const lookAtFrom = (lx, lz, tx, tz, targetY) => {
      const dx = tx - lx; const dz = tz - lz;
      const yaw = Math.atan2(-dx, -dz);
      const horiz = Math.hypot(dx, dz);
      const eyeY = 1.75;
      const pitch = Math.atan2((targetY ?? 1.0) - eyeY, horiz);
      return { lx, lz, yaw, pitch, horiz };
    };

    // ---- one measurement at one screen pixel ---------------------------------
    const rc = new THREE.Raycaster();
    const v2 = new THREE.Vector2();
    const targets = [ch.interior];

    const castAt = (px, py) => {
      v2.set((px / VIEW_W) * 2 - 1, -(py / VIEW_H) * 2 + 1);
      rc.setFromCamera(v2, cam);
      const hits = rc.intersectObjects(targets, true);
      for (const h of hits) {
        if (!h.object.isMesh || !h.object.visible) continue;
        let vis = true;
        let p = h.object;
        while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
        if (!vis) continue;
        return h;
      }
      return null;
    };

    const texInfo = (mat) => {
      if (!mat) return null;
      const t = mat.map;
      if (!t || !t.image) return null;
      const w = t.image.width || 0;
      const h = t.image.height || 0;
      if (!w || !h) return null;
      return {
        name: t.name || mat.name || '(unnamed)',
        w,
        h,
        repX: t.repeat ? t.repeat.x : 1,
        repY: t.repeat ? t.repeat.y : 1,
      };
    };

    // Sample one pixel: returns the derivative pair, or null if the neighbour rays
    // land on a different object (a silhouette edge — the derivative is garbage there).
    const sample = (px, py) => {
      const c = castAt(px, py);
      if (!c || !c.uv) return null;
      const mat = Array.isArray(c.object.material) ? c.object.material[0] : c.object.material;
      const ti = texInfo(mat);
      if (!ti) return null;
      const rx = castAt(px + 1, py);
      const ry = castAt(px, py + 1);
      if (!rx || !ry || !rx.uv || !ry.uv) return null;
      if (rx.object !== c.object || ry.object !== c.object) return null;

      // world derivative
      const dwx = rx.point.distanceTo(c.point);
      const dwy = ry.point.distanceTo(c.point);
      const yardsPerPixel = Math.sqrt(dwx * dwy);
      if (!(yardsPerPixel > 0) || yardsPerPixel > 1) return null; // grazing angle, reject

      // texel derivative — Jacobian determinant, exactly the GPU's mip selector
      const jxu = (rx.uv.x - c.uv.x) * ti.repX * ti.w;
      const jxv = (rx.uv.y - c.uv.y) * ti.repY * ti.h;
      const jyu = (ry.uv.x - c.uv.x) * ti.repX * ti.w;
      const jyv = (ry.uv.y - c.uv.y) * ti.repY * ti.h;
      const det = Math.abs(jxu * jyv - jxv * jyu);
      const texelsPerPixel = Math.sqrt(det);
      if (!(texelsPerPixel > 0) || !Number.isFinite(texelsPerPixel)) return null;

      // reject grazing incidence: the two derivatives should be within ~4x of
      // each other, otherwise we are measuring a surface seen almost edge-on
      const aniso = Math.max(dwx, dwy) / Math.min(dwx, dwy);
      if (aniso > 4) return null;

      return {
        obj: c.object.name || '(unnamed)',
        tex: `${ti.name} ${ti.w}x${ti.h}`,
        texW: ti.w,
        texH: ti.h,
        dist: c.distance,
        yardsPerPixel,
        pixelsPerYard: 1 / yardsPerPixel,
        texelsPerPixel,
        texelsPerYard: texelsPerPixel / yardsPerPixel,
        mip: Math.log2(texelsPerPixel),
      };
    };

    const sweepFrame = (step = 40) => {
      const out = [];
      for (let py = step; py < VIEW_H - step; py += step) {
        for (let px = step; px < VIEW_W - step; px += step) {
          const s = sample(px, py);
          if (s) out.push(s);
        }
      }
      return out;
    };

    const stats = (arr, key) => {
      if (!arr.length) return null;
      const v = arr.map((a) => a[key]).sort((a, b) => a - b);
      const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
      return {
        n: v.length,
        min: +q(0).toFixed(3),
        p10: +q(0.10).toFixed(3),
        median: +q(0.5).toFixed(3),
        p90: +q(0.90).toFixed(3),
        max: +q(1).toFixed(3),
      };
    };

    // ======================================================================
    // PART A — survey: what does the room actually supply, and how oversampled
    // is it, from the standing poses a player really occupies?
    // ======================================================================
    const SURVEY_POSES = [
      { id: 'entrance-sightline', lx: -0.8, lz: 4.6, yaw: 0, pitch: -0.03 },
      { id: 'counter-approach', lx: -0.8, lz: 1.6, yaw: 0, pitch: -0.12 },
      { id: 'counter-close', lx: -0.6, lz: 0.2, yaw: 0, pitch: -0.25 },
      { id: 'retail-floor', lx: -4.2, lz: 0.6, yaw: Math.PI / 2, pitch: -0.10 },
      { id: 'stockroom-corner', lx: 5.4, lz: -1.2, yaw: -0.9, pitch: -0.18 },
      { id: 'lounge', lx: -5.4, lz: -2.4, yaw: 2.4, pitch: -0.16 },
    ];

    const survey = [];
    const allSamples = [];
    for (const p of SURVEY_POSES) {
      const realised = await pose(p.lx, p.lz, p.yaw, p.pitch);
      const s = sweepFrame(40);
      allSamples.push(...s);
      survey.push({
        pose: p.id,
        camLocal: realised.camLocal,
        samples: s.length,
        texelsPerPixel: stats(s, 'texelsPerPixel'),
        mip: stats(s, 'mip'),
        pixelsPerYard: stats(s, 'pixelsPerYard'),
        texelsPerYard: stats(s, 'texelsPerYard'),
        dist: stats(s, 'dist'),
      });
    }

    // per-texture rollup across every pose — this is what decides a per-map ceiling
    const byTex = new Map();
    for (const s of allSamples) {
      if (!byTex.has(s.tex)) byTex.set(s.tex, []);
      byTex.get(s.tex).push(s);
    }
    const perTexture = [...byTex.entries()]
      .map(([tex, arr]) => {
        const mipMin = Math.min(...arr.map((a) => a.mip));
        return {
          tex,
          size: `${arr[0].texW}x${arr[0].texH}`,
          samples: arr.length,
          minMip: +mipMin.toFixed(2),
          medianMip: stats(arr, 'mip').median,
          texelsPerYard: stats(arr, 'texelsPerYard').median,
          nearestDist: +Math.min(...arr.map((a) => a.dist)).toFixed(2),
          // mip 0 unused => the map can be halved this many times with no visible change
          halvings: Math.max(0, Math.floor(mipMin)),
        };
      })
      .sort((a, b) => b.samples - a.samples);

    // ======================================================================
    // PART B — distance sweep on one hero surface.  Walk the camera in along a
    // fixed axis and read pixelsPerYard at each stop.  pixelsPerYard is the
    // REQUIREMENT curve: it is what the display resolves, independent of what
    // the asset supplies, so it is the number a resolution ceiling must meet.
    // ======================================================================
    // Aim at the reception counter front face (the ART_BIBLE §1 "best" anchor),
    // straight down -Z from the retail floor, at counter-top height.
    // Two targets: the reception counter (the §1 best-in-room anchor, and the
    // surface the resolution ceiling was derived from) and asset_065's worktop
    // (the asset rebuilt through the new path, so the ceiling can be checked
    // against a real product of it rather than only against the thing that set it).
    const TARGETS = [
      { id: 'counter', lx: -0.8, lz: -0.2, y: 0.85 },
      { id: 'worktable-065', lx: 6.3, lz: -1.7, y: 0.96 },
    ];
    const distanceSweep = [];
    for (const T of TARGETS) {
    const COUNTER_TARGET = T;
    for (const d of [0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0]) {
      const lz = COUNTER_TARGET.lz + d;
      const p = lookAtFrom(COUNTER_TARGET.lx, lz, COUNTER_TARGET.lx, COUNTER_TARGET.lz, COUNTER_TARGET.y);
      const realised = await pose(p.lx, p.lz, p.yaw, p.pitch);
      // sample the centre of frame only — we want the surface we aimed at
      const s = [];
      for (let py = VIEW_H / 2 - 80; py <= VIEW_H / 2 + 80; py += 20) {
        for (let px = VIEW_W / 2 - 120; px <= VIEW_W / 2 + 120; px += 20) {
          const r = sample(px, py);
          if (r) s.push(r);
        }
      }
      distanceSweep.push({
        target: T.id,
        standoffYd: d,
        camLocal: realised.camLocal,
        samples: s.length,
        hit: s.length ? s[Math.floor(s.length / 2)].obj : null,
        tex: s.length ? s[Math.floor(s.length / 2)].tex : null,
        pixelsPerYard: s.length ? stats(s, 'pixelsPerYard').median : null,
        texelsPerYard: s.length ? stats(s, 'texelsPerYard').median : null,
        texelsPerPixel: s.length ? stats(s, 'texelsPerPixel').median : null,
        mip: s.length ? stats(s, 'mip').median : null,
      });
    }
    }

    // ======================================================================
    // PART C — the constants the policy is derived from, read from the live app
    // rather than assumed.
    // ======================================================================
    const constants = {
      viewport: [VIEW_W, VIEW_H],
      cameraFovDeg: cam.fov,
      cameraAspect: +cam.aspect.toFixed(4),
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: s3.renderer.getPixelRatio(),
      drawingBuffer: [s3.renderer.domElement.width, s3.renderer.domElement.height],
      walkBodyRadiusYd: walk.radius ?? walk.state?.radius ?? null,
      walkEyeHeightYd: walk.eye ?? walk.state?.eye ?? null,
      walkApiKeys: Object.keys(walk).slice(0, 24),
      walkStateKeys: walk.state ? Object.keys(walk.state).slice(0, 24) : null,
      // analytic cross-check: for a surface square to the view at distance d,
      // pixelsPerYard = H / (2 d tan(fov/2))
      analyticPixelsPerYardAt: Object.fromEntries(
        [0.5, 1, 2, 3, 4].map((d) => [
          `${d}yd`,
          +(VIEW_H / (2 * d * Math.tan((cam.fov * Math.PI) / 360))).toFixed(1),
        ]),
      ),
    };

    // ======================================================================
    // PART D — full texture inventory (every sampled map in the scene), so the
    // projection arithmetic is grounded in what is really resident.
    // ======================================================================
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
    const inventoryOf = (root) => {
      const seen = new Set();
      const sizeHist = {};
      let bytes = 0;
      let count = 0;
      // Duplicate detection: two distinct Texture objects whose images have the
      // same dimensions AND the same glTF image name are the SAME source paid for
      // twice.  That is precisely what the sharing lever removes.
      const byIdentity = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m) return;
          SLOTS.forEach((k) => {
            const t = m[k];
            if (!t || !t.image || seen.has(t.uuid)) return;
            const w = t.image.width || 0; const h = t.image.height || 0;
            if (!w) return;
            seen.add(t.uuid);
            count += 1;
            const b = w * h * 4 * (4 / 3); // RGBA8 + full mip chain
            bytes += b;
            const key = `${w}x${h}`;
            sizeHist[key] = (sizeHist[key] || 0) + 1;
            const ident = `${t.name || '(unnamed)'}|${w}x${h}|${k}`;
            if (!byIdentity.has(ident)) byIdentity.set(ident, { n: 0, bytes: b });
            byIdentity.get(ident).n += 1;
          });
        });
      });
      let dupBytes = 0;
      let dupCount = 0;
      const dupes = [];
      for (const [ident, v] of byIdentity) {
        if (v.n > 1 && !ident.startsWith('(unnamed)')) {
          dupCount += v.n - 1;
          dupBytes += v.bytes * (v.n - 1);
          dupes.push({ ident, copies: v.n, wastedMB: +((v.bytes * (v.n - 1)) / 1048576).toFixed(2) });
        }
      }
      dupes.sort((a, b) => b.wastedMB - a.wastedMB);
      return {
        uniqueSampledTextures: count,
        estResidentMB: +(bytes / 1048576).toFixed(1),
        sizeHistogram: sizeHist,
        namedDuplicateInstances: dupCount,
        namedDuplicateMB: +(dupBytes / 1048576).toFixed(1),
        topDuplicates: dupes.slice(0, 10),
      };
    };

    return {
      constants,
      survey,
      perTexture: perTexture.slice(0, 30),
      distanceSweep,
      inventory: {
        scene: { ...inventoryOf(s3.scene), rendererTextureCount: s3.renderer.info.memory.textures },
        clubhouseInterior: inventoryOf(ch.interior),
      },
      totalSamples: allSamples.length,
    };
  });

  return { ok: true, ...result };
}
