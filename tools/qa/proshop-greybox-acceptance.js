async (page) => {
  // PINE HILLS V2 GREYBOX ACCEPTANCE â€” the measured numbers FLOOR_PLAN.md Â§9 owes.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-acceptance.js
  //
  // Boots the SAME seeded starter empire into pine-hills-v2 and then into the v1 room,
  // and measures with one instrument: the F1 entrance-sightline ray metric, the F2
  // wall-midpoint check, the F5 lounge-visibility percentages, the Â§6 clearances from
  // the live datums, the greybox suppression/presence contract, and screenshots.
  // Raycasting is done against an explicitly collected visible-mesh set because
  // THREE.Raycaster does not skip visible=false subtrees on its own â€” the suppressed
  // production furniture must not block rays invisibly.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });

  const boot = async (query) => {
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(3500); // merch/GLB mounts + the module's suppression sweep
  };

  // One in-page measurement pass, shared by both rooms.
  const measure = () => page.evaluate(async () => {
    const app = window.__fw;
    const THREE = await import('three');
    const L = await import('/src/data/shopLayout.js');
    const clubhouse = app.scene3d.clubhouse();
    const detail = clubhouse.pineHillsInterior;
    const diagnostics = detail?.diagnostics?.() || null;

    // The clubhouse interior group: find it from a known child.
    const scene = app.scene3d.scene;
    let interior = null;
    scene.traverse((node) => {
      if (!interior && (node.name === 'PineHillsV2InteriorLayer' || node.name === 'PineHillsInteriorLayer')) {
        interior = node.parent;
      }
    });
    if (!interior) {
      scene.traverse((node) => {
        if (!interior && node.name === 'CheckoutCounterVisualRoot') interior = node.parent;
      });
    }
    if (!interior) return { error: 'no interior group found' };

    // Visible-mesh collection: skip any subtree with visible=false, skip layer-0-less
    // (render-suppressed batch sources), skip flat overlays that must not count as
    // sightline blockers (grime/wet planes, rugs at floor height).
    const meshes = [];
    const collect = (node) => {
      if (node.visible === false) return;
      if (node.isMesh && node.layers.mask !== 0) {
        const name = node.name || '';
        if (!/Grime|WetFloor|Debris/i.test(name)) meshes.push(node);
      }
      for (const child of node.children) collect(child);
    };
    collect(interior);

    const raycaster = new THREE.Raycaster();
    const toWorld = (x, y, z) => interior.localToWorld(new THREE.Vector3(x, y, z));
    const worldScale = interior.getWorldScale(new THREE.Vector3()).x || 1;
    const castLocal = (from, to) => {
      const origin = toWorld(from.x, from.y, from.z);
      const target = toWorld(to.x, to.y, to.z);
      const direction = target.clone().sub(origin);
      const span = direction.length();
      direction.normalize();
      raycaster.set(origin, direction);
      raycaster.far = span + 60;
      const hits = raycaster.intersectObjects(meshes, false);
      const first = hits.find((hit) => hit.distance > 0.02);
      return {
        hitDistanceLocal: first ? first.distance / worldScale : Infinity,
        spanLocal: span / worldScale,
        hitName: first?.object?.name || null,
      };
    };

    // F1 â€” the entrance ray metric. Door pose (-0.8, 5.2), eye 1.7, looking north
    // (-z), central cone 40 deg wide x 20 deg tall, 41x21 rays, PASS = first hit
    // at >= 8 yd.
    const eye = { x: -0.8, y: 1.7, z: 5.2 };
    // Two figures per ray. LITERAL: first hit >= 8 yd (the original threshold â€”
    // physically capped in a small room where the walls arrive first). NORMALIZED
    // (the resize contract): first obstruction at >= 80% of the empty-room
    // distance along the ray's horizontal bearing, so the metric measures
    // FIXTURE occlusion, not room size. A hit on the (deliberately low) ceiling
    // or its beams counts as reaching the envelope â€” the room being short is
    // item 10's decision, not a sightline blocker.
    const roomBounds = L.PUBLIC_ROOM_BOUNDS;
    const envelopeDistance = (origin, yawOff) => {
      const dir = { x: Math.sin(yawOff), z: -Math.cos(yawOff) };
      let best = Infinity;
      if (dir.x < 0) best = Math.min(best, (roomBounds.minX - origin.x) / dir.x);
      if (dir.x > 0) best = Math.min(best, (roomBounds.maxX - origin.x) / dir.x);
      if (dir.z < 0) best = Math.min(best, (roomBounds.minZ - origin.z) / dir.z);
      if (dir.z > 0) best = Math.min(best, (roomBounds.maxZ - origin.z) / dir.z);
      return best;
    };
    let pass = 0;
    let normPass = 0;
    let total = 0;
    const hitHistogram = {};
    for (let ix = 0; ix <= 40; ix += 1) {
      for (let iy = 0; iy <= 20; iy += 1) {
        const yawOff = (ix / 40 - 0.5) * (40 * Math.PI / 180);
        const pitchOff = (iy / 20 - 0.5) * (20 * Math.PI / 180);
        const dist = 30;
        const target = {
          x: eye.x + Math.sin(yawOff) * dist,
          y: eye.y + Math.tan(pitchOff) * dist,
          z: eye.z - Math.cos(yawOff) * dist,
        };
        const ray = castLocal(eye, target);
        total += 1;
        if (ray.hitDistanceLocal >= 8) pass += 1;
        else if (ray.hitName) hitHistogram[ray.hitName] = (hitHistogram[ray.hitName] || 0) + 1;
        const envDist = envelopeDistance(eye, yawOff);
        const horizontalHit = Number.isFinite(ray.hitDistanceLocal)
          ? ray.hitDistanceLocal * Math.cos(pitchOff)
          : Infinity;
        const envelopeHit = /Ceiling|Beam|Floor|Wall/i.test(ray.hitName || '');
        if (envelopeHit || horizontalHit >= envDist * 0.8) normPass += 1;
      }
    }
    const f1 = {
      raysTotal: total,
      raysAtLeast8yd: pass,
      percent: Math.round((pass / total) * 1000) / 10,
      raysNormalizedPass: normPass,
      normalizedPercent: Math.round((normPass / total) * 1000) / 10,
      nearBlockers: Object.entries(hitHistogram).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };

    // F2 â€” from the (variant-resolved) room centre at eye height, the four
    // retail-wall midpoints of the live envelope.
    const cX = (roomBounds.minX + roomBounds.maxX) / 2 - 0.5;
    const cZ = (roomBounds.minZ + roomBounds.maxZ) / 2;
    const centre = { x: cX, y: 1.55, z: cZ };
    const wallTargets = {
      north: { x: cX, y: 1.55, z: roomBounds.minZ + 0.1 },
      south: { x: -0.8, y: 1.55, z: roomBounds.maxZ - 0.1 },
      west: { x: roomBounds.minX + 0.1, y: 1.55, z: cZ },
      eastPartition: { x: 5.6, y: 1.55, z: cZ },
    };
    const f2 = {};
    for (const [key, target] of Object.entries(wallTargets)) {
      const ray = castLocal(centre, target);
      // A wall-BACKED fixture face within 0.9 yd of the wall IS the wall's retail
      // face â€” F2 rejects free-standing mid-room blockers, not the walls' own units.
      f2[key] = {
        unoccluded: ray.hitDistanceLocal >= ray.spanLocal - 0.9,
        firstHit: ray.hitName,
        hitAt: Number.isFinite(ray.hitDistanceLocal) ? Math.round(ray.hitDistanceLocal * 100) / 100 : null,
      };
    }

    // F5 â€” lounge upholstery visibility from the door pose: sample a vertical grid
    // over each piece's bounding box (7 x 5), a sample is visible when the ray's
    // first hit IS that piece (or a child of it).
    const f5 = {};
    const pieceNames = ['GREY_chairA', 'GREY_chairB', 'GREY_coffee', 'GREY_loungeRug'];
    for (const name of pieceNames) {
      const piece = interior.getObjectByName(name);
      if (!piece) {
        f5[name] = { present: false };
        continue;
      }
      const bounds = new THREE.Box3().setFromObject(piece);
      const inv = interior.matrixWorld.clone().invert();
      bounds.applyMatrix4(inv); // to interior-local
      let visible = 0;
      let samples = 0;
      for (let sx = 0; sx <= 6; sx += 1) {
        for (let sy = 0; sy <= 4; sy += 1) {
          const target = {
            x: bounds.min.x + (sx / 6) * (bounds.max.x - bounds.min.x),
            y: Math.max(0.06, bounds.min.y) + (sy / 4) * (bounds.max.y - Math.max(0.06, bounds.min.y)),
            z: (bounds.min.z + bounds.max.z) / 2,
          };
          const ray = castLocal(eye, target);
          samples += 1;
          if (ray.hitDistanceLocal >= ray.spanLocal - 0.75) visible += 1;
          else {
            // A hit on the piece itself, or on ANY lounge-suite piece, counts: the
            // suite occluding its own members (a chair seat behind its coffee
            // table) is real furniture arrangement, and the eye still lands on the
            // lounge â€” which is what "the transformation reads from the door"
            // means. Only non-lounge blockers subtract.
            const suiteRoots = ['GREY_chairA', 'GREY_chairB', 'GREY_coffee', 'GREY_loungeRug', 'GREY_trophy', 'GreyboxLoungeLitter'];
            const hitObject = meshes.find((mesh) => mesh.name === ray.hitName);
            let cursor = hitObject;
            let landsOnSuite = false;
            while (cursor) {
              if (cursor === piece || suiteRoots.includes(cursor.name)) { landsOnSuite = true; break; }
              cursor = cursor.parent;
            }
            if (landsOnSuite) visible += 1;
          }
        }
      }
      f5[name] = {
        present: true,
        samples,
        visible,
        percent: Math.round((visible / samples) * 1000) / 10,
      };
    }

    // Â§6 clearances from the live (variant-resolved) datums + placed fixtures.
    const layoutModule = await import('/src/sim/layout.js');
    const placed = layoutModule.placedFixtures(app.state);
    const rectOf = (id) => {
      const fixture = placed.find((entry) => entry.id === id);
      return fixture ? L.fixtureRect(fixture) : null;
    };
    const frame = L.FRONT_DESK_FRAME;
    const slab = {
      minX: frame.x - frame.frontLength / 2, maxX: frame.x + frame.frontLength / 2,
      minZ: frame.z - frame.frontDepth / 2, maxZ: frame.z + frame.frontDepth / 2,
    };
    const hutch = rectOf('backcounter');
    const feature = rectOf('feature');
    const table = rectOf('table_polos');
    const returnMaxX = frame.x - frame.frontLength / 2 + frame.returnCollisionWidth;
    const clearances = {
      variant: L.CLUBHOUSE_LAYOUT_VARIANT,
      deskWestToClearway: slab.minX - L.DOOR_CLEARWAY.maxX,
      staffCorridor: hutch ? hutch.minZ - slab.maxZ : null,
      corridorWestSlot: hutch ? hutch.minX - returnMaxX : null,
      featureToReturnPass: feature ? slab.minX - feature.maxX : null,
      featureToTablePass: feature && table ? feature.minX - table.maxX : null,
      queueHeadToDesk: slab.minZ - L.queueSlot(0).z,
      queueSpacing: Math.hypot(
        L.queueSlot(1).x - L.queueSlot(0).x,
        L.queueSlot(1).z - L.queueSlot(0).z,
      ),
      registerAt: { x: L.COUNTER.registerX, z: L.COUNTER.registerZ },
      laptopAt: { x: L.FRONT_DESK.laptop.x, z: L.FRONT_DESK.laptop.z },
    };

    // Greybox contract checks.
    const names = (list) => list.map((name) => ({ name, found: !!interior.getObjectByName(name) }));
    const contract = {
      backdropAbsent: !interior.getObjectByName('PineHillsFrontDeskBackdrop'),
      greyPresent: names(['GREY_frontCounter', 'GREY_backcounter', 'GREY_chairB', 'GREY_teeTimeBoard', 'GREY_WestWall', 'GREY_NorthWall', 'GREY_Ceiling', 'GREY_CeilingBeam_1', 'GREY_CorridorSeal', 'GREY_ReturnBackFill', 'GREY_HutchGapFill', 'GREY_HutchEastFill']),
      legacyHidden: names(['LegacyCheckoutCounter', 'LegacyCheckoutProductionCounter', 'PineHillsFrontDeskReturn'])
        .map((entry) => ({
          ...entry,
          visible: entry.found ? (() => {
            let node = interior.getObjectByName(entry.name);
            while (node) {
              if (node.visible === false) return false;
              node = node.parent;
            }
            return true;
          })() : null,
        })),
      registerHardwareVisible: (() => {
        const root = interior.getObjectByName('CheckoutHardwareVisualRoot');
        return !!root && root.visible !== false;
      })(),
      tierIndex: (await import('/src/sim/shopProgression.js')).shopTierIndex?.(app.state) ?? null,
    };

    return {
      variant: L.CLUBHOUSE_LAYOUT_VARIANT,
      diagnostics,
      f1,
      f2,
      f5,
      clearances,
      contract,
      visibleMeshCount: meshes.length,
    };
  });

  const posePlayer = async (x, z, yawDeg) => {
    await page.evaluate(async ([px, pz, yaw]) => {
      const THREE = await import('three');
      const scene = window.__fw.scene3d.scene;
      let interior = null;
      scene.traverse((node) => {
        if (!interior && (node.name === 'PineHillsV2InteriorLayer' || node.name === 'PineHillsInteriorLayer')) {
          interior = node.parent;
        }
      });
      const world = interior
        ? interior.localToWorld(new THREE.Vector3(px, 0, pz))
        : new THREE.Vector3(px, 0, pz);
      const walk = window.__fw.scene3d.walk;
      walk.state.x = world.x;
      walk.state.z = world.z;
      walk.state.yaw = yaw * Math.PI / 180;
      walk.state.pitch = 0;
    }, [x, z, yawDeg]);
    await page.waitForTimeout(400);
  };

  const rooms = {};
  for (const [key, query] of [['v2', '?clubhouse=pine-hills-v2'], ['v1', '']]) {
    await boot(query);
    rooms[key] = await measure();
    await posePlayer(-0.8, 5.0, 0).catch(() => {});
    await page.screenshot({ path: path.join(outDir, `greybox-${key}-door-view.png`) });
    await posePlayer(-0.8, 4.6, -35).catch(() => {});
    await page.screenshot({ path: path.join(outDir, `greybox-${key}-door-to-lounge.png`) });
    await posePlayer(-1.6, 0.0, 65).catch(() => {});
    await page.screenshot({ path: path.join(outDir, `greybox-${key}-centre-view.png`) });
  }

  const result = {
    seed: SEED,
    rooms,
    errs: errs.slice(0, 20),
    ok: !!(
      rooms.v2 && !rooms.v2.error
      && rooms.v2.variant === 'pine-hills-v2'
      && rooms.v2.contract.backdropAbsent
      && rooms.v2.f1.normalizedPercent >= 60
      && rooms.v1 && rooms.v1.variant === null
    ),
  };
  fs.writeFileSync(path.join(outDir, 'greybox-acceptance.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
