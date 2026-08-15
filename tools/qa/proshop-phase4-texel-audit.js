async (page) => {
  // PHASE 4 â€” does the new v2 architecture meet ART_BIBLE Â§7.3 under its own
  // materials? Two questions, both measured, neither assumed:
  //
  //   1. SUPPLY vs REQUIREMENT per surface. Same method as
  //      proshop-texel-density.js (that harness is a v1 instrument with v1
  //      poses; this one boots the variant and aims at the architecture):
  //      cast three rays a pixel apart, read world hit + UV, derive
  //      pixelsPerYard (what the display resolves = the requirement) and
  //      texelsPerYard (what the asset supplies) at the CLOSEST standoff a
  //      player can actually take to each surface.
  //   2. The 512 ceiling. The architecture maps are runtime canvases, so
  //      tests/proshop-texture-budget.test.js â€” which reads shipped GLBs â€”
  //      cannot see them. This walks every texture SOURCE reachable from the
  //      interior and reports any long edge over 512.
  //
  // Â§7.3's own warning is the reason every row carries `hit` and `tex`: an
  // untextured surface has no UV derivative, so the sample passes through it
  // and reports whatever is behind. A missing texture reads as a passing one
  // otherwise.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-phase4-texel-audit.js
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.PHASE4_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase4', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = 20260727;

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
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
  await page.waitForTimeout(4500);
  // Power the room so nothing is measured through an unlit-state difference.
  await page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    R.restorationAction(app.state, { type: 'repair-component', component: 'ceiling', progress: 1 });
    app.speedIdx = 0;
    app.scene3d.clubhouse().pineHillsInterior?.refresh?.();
  });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const origin = ch.interior.position;
    const walk = s3.walk;
    const cam = s3.camera;
    const VIEW_W = 1600;
    const VIEW_H = 900;

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

    const rc = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [ch.interior];
    const castAt = (px, py) => {
      ndc.set((px / VIEW_W) * 2 - 1, -(py / VIEW_H) * 2 + 1);
      rc.setFromCamera(ndc, cam);
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
    const sample = (px, py) => {
      const c = castAt(px, py);
      if (!c || !c.uv) return null;
      const mat = Array.isArray(c.object.material) ? c.object.material[0] : c.object.material;
      const ti = texInfo(mat);
      if (!ti) {
        return { untextured: true, obj: c.object.name || '(unnamed)', dist: c.distance };
      }
      const rx = castAt(px + 1, py);
      const ry = castAt(px, py + 1);
      if (!rx || !ry || !rx.uv || !ry.uv) return null;
      if (rx.object !== c.object || ry.object !== c.object) return null;
      const dwx = rx.point.distanceTo(c.point);
      const dwy = ry.point.distanceTo(c.point);
      const yardsPerPixel = Math.sqrt(dwx * dwy);
      if (!(yardsPerPixel > 0) || yardsPerPixel > 1) return null;
      const jxu = (rx.uv.x - c.uv.x) * ti.repX * ti.w;
      const jxv = (rx.uv.y - c.uv.y) * ti.repY * ti.h;
      const jyu = (ry.uv.x - c.uv.x) * ti.repX * ti.w;
      const jyv = (ry.uv.y - c.uv.y) * ti.repY * ti.h;
      const det = Math.abs(jxu * jyv - jxv * jyu);
      const texelsPerPixel = Math.sqrt(det);
      if (!(texelsPerPixel > 0) || !Number.isFinite(texelsPerPixel)) return null;
      const aniso = Math.max(dwx, dwy) / Math.min(dwx, dwy);
      if (aniso > 4) return null;
      return {
        obj: c.object.name || '(unnamed)',
        tex: `${ti.name} ${ti.w}x${ti.h}`,
        texW: ti.w,
        texH: ti.h,
        dist: c.distance,
        pixelsPerYard: 1 / yardsPerPixel,
        texelsPerYard: texelsPerPixel / yardsPerPixel,
        mip: Math.log2(texelsPerPixel),
      };
    };
    const median = (arr, key) => {
      const v = arr.map((a) => a[key]).sort((a, b) => a - b);
      return v.length ? +v[Math.floor(v.length / 2)].toFixed(2) : null;
    };
    const lookAt = (lx, lz, tx, tz, targetY) => {
      const dx = tx - lx; const dz = tz - lz;
      const yaw = Math.atan2(-dx, -dz);
      const horiz = Math.hypot(dx, dz);
      const pitch = Math.atan2((targetY ?? 1.0) - 1.75, horiz);
      return { yaw, pitch };
    };

    // Architecture targets. texelsPerYard (SUPPLY) is intrinsic to how a
    // surface is textured and does not depend on camera distance, so each
    // probe stands at a comfortable, collision-safe standoff rather than
    // nose-to-the-wall; pixelsPerYard is reported alongside as the
    // requirement AT THAT DISTANCE, and the gate is the Â§7.3 class number.
    //
    // Every target carries CANDIDATE stands and an EXPECTED mesh-name
    // pattern, because the walk collider silently relocates a camera placed
    // inside a fixture: the first audit asked for (-2.00, 0.10) and was
    // shoved to (-1.56, 0.39) behind a shelf, and asked for (1.44, 4.65) and
    // was shoved to (3.00, 4.55), where it measured a production moulding.
    // A row is only accepted when the realised camera is near the requested
    // stand AND the centre ray lands on the surface being audited.
    const TARGETS = [
      {
        id: 'west-wall-sage-band', cls: 'standing', required: 384, aimY: 0.50,
        expect: /GREY_WestWall_SageBand/,
        stands: [[-1.30, -0.20], [-1.30, 3.40], [-1.30, -3.00], [-1.30, 0.60]],
        lookX: -2.60,
      },
      {
        id: 'west-wall-cream-field', cls: 'background', required: 256, aimY: 2.10,
        expect: /GREY_WestWall_CreamField/,
        stands: [[-1.30, -0.20], [-1.30, 3.40], [-1.30, -3.00], [-1.30, 0.60]],
        lookX: -2.60,
      },
      {
        // Trim runs are 0.08â€“0.12 yd tall, so they occupy few rows of the
        // sample grid even head-on: they accept on fewer samples.
        id: 'west-wall-chair-rail', cls: 'hero', required: 768, aimY: 1.04, minSamples: 4,
        expect: /GREY_WestWall_ChairRail/,
        stands: [[-1.30, 3.40], [-1.30, -0.20], [-1.30, -3.00], [-1.30, 0.60]],
        lookX: -2.60,
      },
      {
        id: 'west-wall-skirting', cls: 'hero', required: 768, aimY: 0.06, minSamples: 4,
        expect: /GREY_WestWall_Skirting/,
        stands: [[-1.30, 3.40], [-1.30, -0.20], [-1.30, -3.00], [-1.30, 0.60]],
        lookX: -2.60,
      },
      {
        id: 'north-wall-cream-field', cls: 'background', required: 256, aimY: 2.10,
        expect: /GREY_NorthWall_CreamField/,
        stands: [[1.80, -3.20], [0.90, -3.10], [2.60, -3.30], [-1.40, -2.90]],
        lookZ: -4.60,
      },
      {
        id: 'north-wall-sage-band', cls: 'standing', required: 384, aimY: 0.50,
        expect: /GREY_NorthWall_SageBand/,
        stands: [[1.80, -3.20], [0.90, -3.10], [2.60, -3.30], [-1.40, -2.90]],
        lookZ: -4.60,
      },
      {
        id: 'ceiling-lid', cls: 'outofreach', required: 192, aimY: 2.80,
        expect: /GREY_Ceiling$/,
        stands: [[1.00, 0.40], [0.40, 0.40], [2.00, 0.30]],
        lookOffsetZ: 0.15,
      },
      {
        id: 'ceiling-beam-face', cls: 'outofreach', required: 192, aimY: 2.66,
        expect: /GREY_CeilingBeam_/,
        stands: [[1.00, 1.05], [0.40, 1.05], [2.00, -0.25]],
        lookOffsetZ: 0.60,
      },
      {
        id: 'corridor-seal-field', cls: 'background', required: 256, aimY: 2.10,
        expect: /GREY_CorridorSeal_CreamField/,
        stands: [[5.10, 2.88], [5.00, 3.20], [4.90, 2.50]],
        lookX: 5.70,
      },
      {
        // The three west-seal fillets are wedged between the desk return, the
        // wordmark hutch and the south wall. If no stand can see one, that is
        // itself the finding â€” a surface the player cannot reach has no texel
        // class to meet â€” so this target reports occlusion instead of failing,
        // with the occluder named in the evidence.
        id: 'west-seal-fillet', cls: 'hero', required: 768, aimY: 1.10, minSamples: 4,
        occlusionIsAnswer: true,
        expect: /GREY_HutchEastFill|GREY_HutchGapFill|GREY_ReturnBackFill/,
        stands: [
          [4.60, 5.19], [4.20, 5.10], [3.60, 5.19], [5.30, 4.60], [2.80, 5.05],
          [1.44, 4.55], [0.60, 5.10], [2.20, 4.60],
        ],
        lookX: 5.60,
      },
    ];

    const rows = [];
    for (const t of TARGETS) {
      const attempts = [];
      let accepted = null;
      for (const stand of t.stands) {
        const lookPoint = t.lookX != null
          ? [t.lookX, stand[1]]
          : t.lookZ != null
            ? [stand[0], t.lookZ]
            : [stand[0], stand[1] + (t.lookOffsetZ || 0.15)];
        const aim = lookAt(stand[0], stand[1], lookPoint[0], lookPoint[1], t.aimY);
        const realised = await pose(stand[0], stand[1], aim.yaw, aim.pitch);
        const drift = Math.hypot(realised.camLocal[0] - stand[0], realised.camLocal[2] - stand[1]);
        const good = [];
        const untextured = [];
        for (let py = VIEW_H / 2 - 72; py <= VIEW_H / 2 + 72; py += 12) {
          for (let px = VIEW_W / 2 - 120; px <= VIEW_W / 2 + 120; px += 12) {
            const s = sample(px, py);
            if (!s) continue;
            if (s.untextured) untextured.push(s);
            else good.push(s);
          }
        }
        const onTarget = good.filter((s) => t.expect.test(s.obj));
        attempts.push({
          stand,
          camLocal: realised.camLocal,
          driftYd: +drift.toFixed(2),
          onTargetSamples: onTarget.length,
          sawInstead: [...new Set(good.concat(untextured).map((s) => s.obj))].slice(0, 4),
        });
        // Acceptance is "did we measure the right surface, with enough
        // samples" â€” NOT "did the camera stand exactly where asked".
        // texelsPerYard is a property of the surface's own UV parameterisation
        // and is independent of camera distance, so a collider nudging the
        // stand does not invalidate the reading; it only changes the
        // informational pixelsPerYard. Drift is recorded on every row.
        // (An earlier revision gated on drift <= 0.45 and reported the
        // west-seal fillets as "not player-visible" â€” while its own attempt
        // log showed one stand landing 208 samples on them. The gate was
        // manufacturing a false finding.)
        if (onTarget.length >= (t.minSamples || 8)
          && (!accepted || drift < accepted.drift)) {
          accepted = { realised, onTarget, untextured, drift };
          if (drift <= 0.45) break;
        }
      }
      if (!accepted) {
        rows.push({
          id: t.id,
          cls: t.cls,
          requiredTexelsPerYard: t.required,
          resolved: false,
          occlusionIsAnswer: !!t.occlusionIsAnswer,
          // What stood in the way, across every attempt â€” the evidence for
          // "not player-visible" when that is the honest answer.
          occluders: [...new Set(attempts.flatMap((a) => a.sawInstead))],
          attempts,
        });
        continue;
      }
      const good = accepted.onTarget;
      const supply = median(good, 'texelsPerYard');
      rows.push({
        id: t.id,
        cls: t.cls,
        requiredTexelsPerYard: t.required,
        resolved: true,
        camLocal: accepted.realised.camLocal,
        driftYd: +accepted.drift.toFixed(2),
        attemptsUsed: attempts.length,
        samples: good.length,
        hit: [...new Set(good.map((s) => s.obj))],
        tex: [...new Set(good.map((s) => s.tex))],
        distYd: median(good, 'dist'),
        // The requirement AT THIS DISTANCE (display-side); the gate below is
        // the Â§7.3 class number, which is authored for the closest approach.
        pixelsPerYardAtProbe: median(good, 'pixelsPerYard'),
        texelsPerYard: supply,
        minMip: +Math.min(...good.map((s) => s.mip)).toFixed(2),
        // 2% tolerance on the floor: repeats are solved to land exactly on the
        // class requirement, and the probe reports a MEDIAN of ray-derived
        // Jacobians, so a matched surface measures a hair under its target
        // (384 reads 383.85). Treating that as a deficiency would fail every
        // correctly-authored surface.
        meetsRequirement: supply >= t.required * 0.98,
        // Â§7.3: nothing may supply more than 2x its class requirement.
        withinTwiceRequirement: supply <= t.required * 2,
      });
    }

    // ---- the 512 ceiling for RUNTIME textures. tests/proshop-texture-budget
    // reads shipped GLBs and cannot see canvas textures at all, so this is the
    // only check that covers them. Sources are counted, not texture instances
    // (TEXTURE_MEMORY_POLICY Â§0: three keys GPU uploads on Source).
    //
    // Sources are split by OWNER: a source used by any GREY_* mesh belongs to
    // the v2 architecture kit (what Phase 4 authored and is answerable for);
    // everything else is inherited from the v1 shell and shared fixture kit,
    // which this phase is not permitted to re-author.
    const bySource = new Map();
    ch.interior.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const greybox = /^GREY_/.test(o.name || '');
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const t = m[key];
          if (!t || !t.image || !t.source) continue;
          const w = t.image.width || 0;
          const h = t.image.height || 0;
          if (!w || !h) continue;
          if (!bySource.has(t.source.uuid)) {
            bySource.set(t.source.uuid, {
              name: t.name || m.name || '(unnamed)', w, h, uses: 0, architecture: false,
            });
          }
          const entry = bySource.get(t.source.uuid);
          entry.uses += 1;
          if (greybox) entry.architecture = true;
        }
      }
    });
    const sources = [...bySource.values()];
    const architecture = sources.filter((s) => s.architecture);
    const inherited = sources.filter((s) => !s.architecture);
    const mb = (list) => +(list.reduce((sum, s) => sum + s.w * s.h * 4 * (4 / 3), 0) / 1048576).toFixed(2);

    return {
      targets: rows,
      textureSources: {
        count: sources.length,
        // Resident bytes at RGBA8 + full mip chain (TEXTURE_MEMORY_POLICY Â§0).
        residentMBRGBA8WithMips: mb(sources),
        architecture: {
          count: architecture.length,
          residentMB: mb(architecture),
          oversize: architecture.filter((s) => Math.max(s.w, s.h) > 512),
          sizes: architecture
            .slice()
            .sort((a, b) => (b.w * b.h) - (a.w * a.h))
            .map((s) => ({ name: s.name, size: `${s.w}x${s.h}`, uses: s.uses })),
        },
        inherited: {
          count: inherited.length,
          residentMB: mb(inherited),
          // Reported, NOT gated: these belong to the v1 shell and the shared
          // fixture/merch kit. Phase 4 may not re-author them, and doing so
          // would change v1. Listed so the Â§7.3 exposure is on the record.
          oversize: inherited
            .filter((s) => Math.max(s.w, s.h) > 512)
            .sort((a, b) => (b.w * b.h) - (a.w * a.h))
            .map((s) => ({ name: s.name, size: `${s.w}x${s.h}`, uses: s.uses })),
        },
      },
    };
  });

  const failures = [];
  const notes = [];
  for (const row of result.targets) {
    if (!row.resolved) {
      const seen = row.attempts.map((a) => `${JSON.stringify(a.stand)}â†’drift ${a.driftYd}, saw ${a.sawInstead.join('/') || 'nothing'}`).join(' | ');
      if (row.occlusionIsAnswer) {
        notes.push(`${row.id}: not visible from any audited stand â€” occluded by ${row.occluders.join(', ') || 'nothing (no hit)'}. A surface the player cannot see has no texel class to meet.`);
      } else {
        failures.push(`${row.id}: could not stand where it aimed â€” ${seen}`);
      }
    } else if (!row.meetsRequirement) {
      failures.push(`${row.id}: supplies ${row.texelsPerYard} texels/yd, needs ${row.requiredTexelsPerYard}`);
    } else if (!row.withinTwiceRequirement) {
      failures.push(`${row.id}: supplies ${row.texelsPerYard} texels/yd, over 2x its ${row.requiredTexelsPerYard} requirement`);
    }
  }
  const archOversize = result.textureSources.architecture.oversize;
  if (archOversize.length) {
    failures.push(`512 ceiling (architecture): ${archOversize.map((s) => `${s.name} ${s.w}x${s.h}`).join(', ')}`);
  }

  const report = {
    ...result, errs: errs.slice(0, 12), notes, failures, ok: failures.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'phase4-texel-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
