async (page) => {
  // BLOCKER 6 â€” the collision and parenting sweep. Fifth instance of one class:
  // an object whose collider is missing, or is somewhere the object is not.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-collision-parenting-sweep.js
  //
  // Two symmetric questions, asked of the room rather than of the source:
  //
  //   MISSING   a floor-standing solid whose middle the player can stand in.
  //             Measured with walk.isFree at the object's own centre, which is
  //             the same test the player's body runs.
  //   ORPHANED  a collider with no geometry in it. That is the tray-collider
  //             shape: a solid the player bumps into with nothing there to see.
  //
  // The batching trap this room is known for (10 props draw from a merged
  // static batch with layers.mask = 0) is why footprints are measured from
  // GEOMETRY bounds via Box3.setFromObject and not from visibility: a prop that
  // never draws still has to be walked around, and a scene-graph probe that
  // filters on `visible` measures the wrong population. Objects are included by
  // having geometry, not by drawing.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(3000);
  };

  const sweep = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const origin = ch.center;
    const walk = app.scene3d.walk;
    const cols = walk.colliders;
    const radius = walk.state.radius || 0.32;

    const solids = [...(cols.props || []), ...(cols.structures || [])];
    const floorY = ch.interior.getWorldPosition(new THREE.Vector3()).y;

    // The room only, so course furniture and the porch do not enter the count.
    const bounds = L.PUBLIC_ROOM_BOUNDS;
    const inRoom = (lx, lz) => lx >= bounds.minX - 1.2 && lx <= bounds.maxX + 1.2
      && lz >= bounds.minZ - 1.2 && lz <= bounds.maxZ + 1.2;

    // --- candidates: floor-standing solids with a real footprint --------------
    // Walk one level of "prop-like" groups rather than every mesh, so a chair is
    // one candidate and not eleven slats.
    const seen = new Set();
    const candidates = [];
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();

    // A merged static batch is ONE node holding the geometry of many props
    // scattered across the room, so its bounding box is the union of all of
    // them and its centre lands in open floor. The first run of this sweep
    // reported BATCH_PineHillsStatic_1 â€” 3.5 x 11.9 yd â€” as a prop with a
    // missing collider. It is not a prop; it is a draw call.
    const isBatch = (node) => /^BATCH_|StaticDressingBatch|RUNTIME_.*Batch/i.test(node.name || '');

    const consider = (node) => {
      if (!node || seen.has(node)) return;
      if (isBatch(node)) return;
      let hasGeometry = false;
      node.traverse((o) => { if (o.isMesh && o.geometry) hasGeometry = true; });
      if (!hasGeometry) return;
      box.setFromObject(node, true);
      if (!Number.isFinite(box.min.x) || box.isEmpty()) return;
      box.getSize(size);
      box.getCenter(centre);
      const lx = centre.x - origin.x;
      const lz = centre.z - origin.z;
      if (!inRoom(lx, lz)) return;
      // Floor-standing: its base is near the floor. A wall panel, a ceiling
      // fitting or a picture is not something a body walks into on the floor.
      const base = box.min.y - floorY;
      if (base > 0.45) return;
      // Big enough to be worth walking around, and tall enough to be in the way.
      if (size.x < 0.32 || size.z < 0.32 || size.y < 0.35) return;
      // Not the room itself.
      if (size.x > 12 || size.z > 12) return;
      seen.add(node);
      node.traverse((o) => seen.add(o));
      candidates.push({
        name: node.name || '(unnamed)',
        type: node.type,
        parent: node.parent?.name || null,
        local: { x: +lx.toFixed(2), z: +lz.toFixed(2) },
        size: { w: +size.x.toFixed(2), h: +size.y.toFixed(2), d: +size.z.toFixed(2) },
        world: { x: centre.x, z: centre.z },
        footprint: {
          minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
        },
      });
    };

    // Named roots first (props, fixtures, furniture), then anything else with
    // geometry that survived the filters above.
    const roots = [];
    ch.interior.traverse((o) => { if (o.name) roots.push(o); });
    for (const r of roots) consider(r);
    ch.interior.traverse((o) => consider(o));

    // --- MISSING: the player can stand in the middle of it -------------------
    const blockedAt = (wx, wz) => solids.some((c) => (c.minX !== undefined
      ? wx + radius > c.minX && wx - radius < c.maxX && wz + radius > c.minZ && wz - radius < c.maxZ
      : Math.hypot(wx - c.x, wz - c.z) < c.r + radius));
    const missing = [];
    for (const cand of candidates) {
      if (blockedAt(cand.world.x, cand.world.z)) continue;
      // The centre may sit in a hollow (a table's legs are at the corners), so
      // require the whole footprint to be walkable before calling it missing.
      const f = cand.footprint;
      const probes = [
        [f.minX + 0.1, f.minZ + 0.1], [f.maxX - 0.1, f.minZ + 0.1],
        [f.minX + 0.1, f.maxZ - 0.1], [f.maxX - 0.1, f.maxZ - 0.1],
      ];
      if (probes.some(([x, z]) => blockedAt(x, z))) continue;
      missing.push(cand);
    }

    // --- ORPHANED: a collider with nothing in it -----------------------------
    // Tested against ALL geometry in the room, not against the candidate list.
    // Candidates are filtered to floor-standing solids of a certain size, so a
    // collider around a wall-mounted or small prop would read as orphaned when
    // it is doing its job â€” the first run reported two on exactly that basis.
    // Traversed from the clubhouse GROUP, not from interior: a receiving-pad or
    // porch prop registers its collider like any other but its geometry hangs
    // off a different root, and reading only the interior reported one of those
    // as an orphan.
    const allGeometry = [];
    ch.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const b = new THREE.Box3().setFromObject(o, true);
      if (b.isEmpty() || !Number.isFinite(b.min.x)) return;
      allGeometry.push({
        minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z,
      });
    });
    const anyGeometryIn = (c) => allGeometry.some((f) => (
      f.maxX > c.minX && f.minX < c.maxX && f.maxZ > c.minZ && f.minZ < c.maxZ
    ));
    const orphaned = [];
    for (const c of cols.props || []) {
      if (c.minX === undefined) continue;      // circles are trees and characters
      if (c.door || c.shellWall) continue;     // the building
      const cx = (c.minX + c.maxX) / 2;
      const cz = (c.minZ + c.maxZ) / 2;
      const lx = cx - origin.x;
      const lz = cz - origin.z;
      if (!inRoom(lx, lz)) continue;
      if (anyGeometryIn(c)) continue;
      orphaned.push({
        local: { x: +lx.toFixed(2), z: +lz.toFixed(2) },
        size: { w: +(c.maxX - c.minX).toFixed(2), d: +(c.maxZ - c.minZ).toFixed(2) },
      });
    }

    // --- DOOR AND WINDOW FURNITURE ------------------------------------------
    //
    // The walk reported "door planks are walkable", which is the same class as
    // the eleven props: geometry that reads as solid and has no hull. Doors were
    // excluded from every pass above â€” the orphan test skips `c.door` outright â€”
    // so nothing here has ever been checked.
    //
    // Two filters keep this honest rather than noisy:
    //
    //   HEIGHT. A transom, a header, a glazing bar above the opening is
    //   SUPPOSED to be walk-through: a body passes under it. Only geometry whose
    //   vertical span overlaps a standing body (0.10 to 1.70) can be a defect.
    //
    //   THE OPENING. An OPEN door leaf has swung out of the doorway and the
    //   doorway is then correctly walkable â€” that is the door working. So the
    //   test is not "is the doorway blocked" but "does this piece of geometry
    //   have a collider on it", asked at the leaf's own current position.
    //
    //   MOTION, NOT CONTAINMENT â€” added 2026-07-29 and the whole point of this
    //   stage now. The first version asked only "does SOME collider's box
    //   overlap this mesh", with the doors in whatever state they happened to be
    //   in, which was closed. A closed leaf's collider lies right across the
    //   aperture, so anything fixed to the APERTURE â€” boarding planks, their
    //   fasteners â€” came back covered and the sweep reported doorMissing: 0.
    //
    //   The leaf's collider swings with the leaf (doors.js updateDoorCollider
    //   recomputes it from hinge to tip every frame the angle changes). So a
    //   door collider can only ever be said to cover geometry that swings WITH
    //   it. For anything that stays put, that overlap is a coincidence of the
    //   door being shut, and it evaporates the moment the player opens it.
    //
    //   Hence coverage is split by collider kind here, and the caller measures
    //   the same meshes again with every door open. What moved is on the leaf;
    //   what did not move needs a collider of its own.
    const BODY_MIN_Y = 0.10;
    const BODY_MAX_Y = 1.70;
    const FURNITURE = /door|leaf|plank|board|shutter|window|glaz|mullion|jamb|casement|sash/i;
    const NOT_FURNITURE = /floor|ceiling|batch_|scoreboard|keyboard|billboard|dashboard|cardboard|tee.?board|events?.?board|wordmark/i;
    const overlaps = (c, b) => c.minX !== undefined
      && c.maxX > b.min.x && c.minX < b.max.x && c.maxZ > b.min.z && c.minZ < b.max.z;
    const doorCols = (cols.props || []).filter((c) => c.door === true);
    const staticCols = (cols.props || []).filter((c) => c.door !== true);
    const doorAndWindow = [];
    ch.group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const name = o.name || '';
      if (!FURNITURE.test(name) || NOT_FURNITURE.test(name)) return;
      const b = new THREE.Box3().setFromObject(o, true);
      if (b.isEmpty() || !Number.isFinite(b.min.x)) return;
      if (b.max.y < BODY_MIN_Y || b.min.y > BODY_MAX_Y) return; // over or under a body
      const w = b.max.x - b.min.x;
      const d = b.max.z - b.min.z;
      if (w < 0.06 && d < 0.06) return;                          // trim, not a barrier
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      // EFFECTIVE VISIBILITY, WALKED UP THE PARENT CHAIN â€” measured 2026-07-29.
      //
      // The one doorMissing this sweep kept reporting, MESH_WindowWest_CreamCasing at 37.5%
      // walk-through, turned out to be asset 51's PARKED ORIGINAL: suppressed under
      // SHEET06_PRODUCTION_EXTERIOR_STAGING with visible=false, left at the live building's
      // coordinates, its box poking 0.46 yd past the west corner onto the lawn. The three
      // "walkable" band probes were that sliver. The VISIBLE replacement (asset 55's
      // window-0-s instance) measures 0/336 walkable â€” fully solid.
      //
      // visible=false prunes the whole subtree at render time, so a mesh that is effectively
      // invisible cannot be seen and must NOT demand a collider â€” a collider for it is an
      // invisible fence, the orphan defect this sweep's other half exists to catch. This is
      // NOT the batching caveat at the top of the file: batched props hide via layers.mask=0
      // with visible=true, and those stay judged, because they are real objects that draw.
      let effectiveVisible = true;
      let hiddenBy = null;
      for (let parent = o; parent; parent = parent.parent) {
        if (parent.visible === false) {
          effectiveVisible = false;
          hiddenBy = parent.name || parent.type;
          break;
        }
      }
      // WALKABILITY IS SAMPLED ON THE GEOMETRY, NOT AT THE BOUNDING-BOX CENTRE.
      //
      // MESH_BoardedApertureDamage_DATA is ONE mesh 9.77 yd wide: Blender joins
      // every board across the whole facade into a single object. Its bounding
      // box therefore spans apertures AND the solid wall between them, and its
      // centre lands in open floor that has no board anywhere near it. Asking
      // "can a body stand at the centre" of that is the same fault the batch note
      // at the top of this file describes, one level down â€” a joined mesh's
      // centre is not where its geometry is.
      //
      // So sample real vertices, keep the ones at body height, and ask the
      // player's own collision test at each. A board a body can stand inside is
      // a board a body walks through.
      // WHICH collider blocks matters as much as whether one does. A leaf swung
      // to 100deg still has a large AXIS-ALIGNED bound, and that box can lie
      // across the opening the leaf just vacated. Geometry "held solid" only by
      // that box is not solid at all -- it is the same borrowed-collider fault
      // one level down, and counting it as coverage would let this stage certify
      // the exact defect it exists to find.
      const pos = o.geometry.getAttribute('position');
      let bandSamples = 0;
      let walkableSamples = 0;
      let doorOnlyBlocked = 0;
      const walkableAt = [];
      if (pos && pos.count) {
        o.updateWorldMatrix(true, false);
        const v = new THREE.Vector3();
        const stride = Math.max(1, Math.floor(pos.count / 240));
        for (let i = 0; i < pos.count; i += stride) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.y < BODY_MIN_Y || v.y > BODY_MAX_Y) continue;
          bandSamples += 1;
          const hitStatic = solids.some((c) => c.door !== true && (c.minX !== undefined
            ? v.x + radius > c.minX && v.x - radius < c.maxX && v.z + radius > c.minZ && v.z - radius < c.maxZ
            : Math.hypot(v.x - c.x, v.z - c.z) < c.r + radius));
          const hitDoor = doorCols.some((c) => c.minX !== undefined
            && v.x + radius > c.minX && v.x - radius < c.maxX
            && v.z + radius > c.minZ && v.z - radius < c.maxZ);
          if (!hitStatic && !hitDoor) {
            walkableSamples += 1;
            if (walkableAt.length < 5) {
              walkableAt.push({ x: +(v.x - origin.x).toFixed(2), z: +(v.z - origin.z).toFixed(2) });
            }
          } else if (!hitStatic && hitDoor) doorOnlyBlocked += 1;
        }
      }
      doorAndWindow.push({
        // Object identity, so the two passes can be joined. Names repeat â€” four
        // MESH_WindowStandard_* meshes share one â€” and traversal order is not a
        // contract worth resting a defect report on.
        uuid: o.uuid,
        name,
        effectiveVisible,
        hiddenBy,
        local: { x: +(cx - origin.x).toFixed(2), z: +(cz - origin.z).toFixed(2) },
        world: { x: +cx.toFixed(3), z: +cz.toFixed(3) },
        size: { w: +w.toFixed(2), d: +d.toFixed(2), h: +(b.max.y - b.min.y).toFixed(2) },
        yRange: [+b.min.y.toFixed(2), +b.max.y.toFixed(2)],
        coveredByDoorCollider: doorCols.some((c) => overlaps(c, b)),
        coveredByStaticCollider: staticCols.some((c) => overlaps(c, b)),
        hasCollider: doorCols.some((c) => overlaps(c, b)) || staticCols.some((c) => overlaps(c, b)),
        bandSamples,
        walkableSamples,
        doorOnlyBlocked,
        walkableFraction: bandSamples ? +(walkableSamples / bandSamples).toFixed(3) : null,
        // Held up only by a door collider: walkable the moment that box is not
        // where it happens to be. Counted separately, never as coverage.
        doorPropped: bandSamples ? +(doorOnlyBlocked / bandSamples).toFixed(3) : null,
        walkableAt,
        standableInside: !blockedAt(cx, cz),
      });
    });

    return {
      candidates: candidates.length,
      colliders: (cols.props || []).length,
      missing,
      orphaned,
      doorAndWindow,
    };
  });

  // Swing every door wide and let the animation settle, so the second pass sees
  // leaf colliders where the leaves actually are. Returns what it managed to
  // move â€” a pass taken against doors that did not open would be the closed pass
  // again under a different name, which is the exact fault being corrected.

  // HOLDING THE DOORS OPEN, rather than asking once and hoping.
  //
  // doors.js closes a door 2.5s after the last time anyone was near it
  // (`if (d.open && now - d.lastNear > 2.5)`). Setting `open` once and waiting
  // produced a "doors open" pass with the doors visibly shut -- the closed pass
  // measured twice under two names, which is the precise failure this whole
  // stage was rewritten to stop doing.
  //
  // Re-asserting `open` on a timer does not work either, and the way it fails is
  // worth recording: the close rule runs every FRAME and the re-assert every
  // 50ms, so the leaf decays toward shut between ticks and settles at a fifth of
  // its travel. Measured 0.338 rad against a real target of 1.745 -- a door
  // reported open, sitting at 19 percent.
  //
  // So pin `lastNear` instead of racing the timer. `now - lastNear` can then
  // never exceed 2.5 and the close branch is unreachable.
  const holdDoorsOpen = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const walk = window.__fw.scene3d.walk;
    clearInterval(window.__doorHold);
    const push = () => {
      for (const d of ch.doors || []) {
        d.desiredOpen = true;
        d.open = true;
        d.lastNear = Number.MAX_SAFE_INTEGER; // the close timer can never elapse
        if (d.mainLeaf && d.fixedSwing) d.swingTarget = d.fixedSwing;
        else if (!d.swingTarget && typeof d.chooseSwing === 'function') {
          d.swingTarget = d.chooseSwing(walk.x ?? 0, walk.z ?? 0);
        }
      }
    };
    push();
    window.__doorHold = setInterval(push, 250);
  });
  const releaseDoors = () => page.evaluate(() => {
    clearInterval(window.__doorHold);
    window.__doorHold = 0;
  });

  const openEveryDoor = async () => {
    const readDoors = () => page.evaluate(() => (window.__fw.scene3d.clubhouse().doors || [])
      .map((d) => ({
        name: d.name,
        angle: +Math.abs(d.angle).toFixed(3),
        // Each door's OWN full-open travel. An absolute threshold was a guess,
        // and it was wrong: 0.35 rad sits above where a door under a losing
        // hold-open race settles, so it certified nothing while failing runs.
        target: +Math.abs(d.mainLeaf ? (d.fixedSwing || 0) : (d.swingTarget || d.fixedSwing || 0)).toFixed(3),
      })));
    const before = await readDoors();
    await holdDoorsOpen();
    await page.waitForTimeout(2500); // 5.5/s exponential approach settles well inside this
    const after = await readDoors();
    // Open means the leaf reached most of ITS OWN travel.
    const isOpen = (d) => d.target > 0.05 && d.angle >= d.target * 0.8;
    return {
      before,
      after,
      opened: after.filter(isOpen).length,
      total: after.length,
    };
  };

  // WHITELIST-OR-FAIL. Two things in the room are deliberately walk-through,
  // and both are soft decor a shoulder brushes past rather than furniture:
  //
  //   the umbrella stand   PROP_PLACEMENTS declares collision: 'none' for it
  //   the floor plants     same reason, authored by the interior
  //
  // Everything else that a body can stand inside is a defect. Adding to this
  // list is a deliberate act with a reason next to it; the sweep going green
  // because something was quietly appended is the failure mode a whitelist
  // exists to make visible.
  const WALK_THROUGH_BY_DESIGN = [
    { pattern: /umbrella_stand/i, why: "PROP_PLACEMENTS declares collision: 'none'" },
    { pattern: /floorPlant/i, why: 'soft decor; a shoulder passes through the fronds' },
  ];

  // Door and window furniture that is walk-through ON PURPOSE, same
  // whitelist-or-fail discipline as the props above.
  const DOOR_WALK_THROUGH_BY_DESIGN = [
    { pattern: /porch|threshold|sill|mat/i, why: 'you step over it, not into it' },
    { pattern: /handle|knob|hinge|pull|lever|latch/i, why: 'hardware, not a barrier' },
  ];

  const out = {
    variants: {},
    whitelist: WALK_THROUGH_BY_DESIGN.map((w) => String(w.pattern)),
    doorWhitelist: DOOR_WALK_THROUGH_BY_DESIGN.map((w) => String(w.pattern)),
  };
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    // eslint-disable-next-line no-await-in-loop
    await boot(variant);
    // eslint-disable-next-line no-await-in-loop
    const result = await sweep();
    result.waived = result.missing.filter(
      (m) => WALK_THROUGH_BY_DESIGN.some((w) => w.pattern.test(m.name)),
    ).map((m) => ({
      name: m.name,
      why: WALK_THROUGH_BY_DESIGN.find((w) => w.pattern.test(m.name)).why,
    }));
    result.missing = result.missing.filter(
      (m) => !WALK_THROUGH_BY_DESIGN.some((w) => w.pattern.test(m.name)),
    );
    result.doorWaived = result.doorAndWindow.filter(
      (m) => DOOR_WALK_THROUGH_BY_DESIGN.some((w) => w.pattern.test(m.name)),
    ).map((m) => ({
      name: m.name,
      why: DOOR_WALK_THROUGH_BY_DESIGN.find((w) => w.pattern.test(m.name)).why,
    }));

    // --- THE MOTION TEST ------------------------------------------------------
    // Open every door and measure the same meshes again. Geometry that MOVED
    // travels with the leaf, so the leaf's collider genuinely covers it.
    // Geometry that did NOT move is fixed to the aperture, and a door collider
    // over it is an accident of the door being shut.
    // eslint-disable-next-line no-await-in-loop
    result.doorSwing = await openEveryDoor();
    // eslint-disable-next-line no-await-in-loop
    const openPass = (await sweep()).doorAndWindow;
    // Angles read AFTER the pass as well: a door that drifted shut halfway
    // through would otherwise be certified open by a reading taken before it.
    // eslint-disable-next-line no-await-in-loop
    result.doorSwing.afterPass = await page.evaluate(() => (window.__fw.scene3d.clubhouse().doors || [])
      .map((d) => ({
        name: d.name,
        angle: +Math.abs(d.angle).toFixed(3),
        target: +Math.abs(d.mainLeaf ? (d.fixedSwing || 0) : (d.swingTarget || d.fixedSwing || 0)).toFixed(3),
      })));
    // eslint-disable-next-line no-await-in-loop
    await releaseDoors();
    result.doorSwing.heldThroughPass = result.doorSwing.afterPass
      .filter((d) => d.target > 0.05 && d.angle >= d.target * 0.8).length;
    const openByUuid = new Map(openPass.map((m) => [m.uuid, m]));
    const MOVED_YD = 0.05; // a swung leaf travels most of its own width; this is noise

    result.doorMotion = result.doorAndWindow.map((closed) => {
      const open = openByUuid.get(closed.uuid) || null;
      const moved = open
        ? Math.hypot(open.world.x - closed.world.x, open.world.z - closed.world.z)
        : null;
      const travelsWithDoor = moved != null && moved > MOVED_YD;
      return {
        name: closed.name,
        effectiveVisible: closed.effectiveVisible,
        hiddenBy: closed.hiddenBy,
        local: closed.local,
        movedYd: moved == null ? null : +moved.toFixed(3),
        travelsWithDoor,
        closed: { door: closed.coveredByDoorCollider, static: closed.coveredByStaticCollider },
        open: open ? { door: open.coveredByDoorCollider, static: open.coveredByStaticCollider } : null,
        walkableFractionClosed: closed.walkableFraction,
        walkableFractionOpen: open ? open.walkableFraction : null,
        doorProppedOpen: open ? open.doorPropped : null,
        doorProppedClosed: closed.doorPropped,
        walkableAtOpen: open ? open.walkableAt : null,
        bandSamplesOpen: open ? open.bandSamples : null,
      };
    });

    // THE DEFECT THIS STAGE EXISTS FOR: fixed geometry a body can walk through.
    //
    // Gated on SAMPLED WALKABILITY, not on the coverage flags above, and that
    // distinction cost two runs. The coverage flags ask whether some collider's
    // box overlaps the mesh's box â€” containment again, one level up. The boarding
    // planks come back coveredByStaticCollider: true because the shell wall's
    // collider clips the edge of a bounding box that is 9.77 yd wide. Neither
    // that flag nor the box centre says anything about the boards themselves.
    //
    // WALKABLE_SHARE is deliberately not 0. Board geometry legitimately overhangs
    // an opening at its edges, and a couple of stray vertices in free space is
    // not a hole a player can walk through. A THIRD of a board's body-height
    // surface standing in open floor is.
    const WALKABLE_SHARE = 0.34;
    const MIN_BAND_SAMPLES = 8; // too few to characterise; reported, never judged
    const wouldFlag = (m) => (
      !m.travelsWithDoor
      && m.bandSamplesOpen >= MIN_BAND_SAMPLES
      && m.walkableFractionOpen != null && m.walkableFractionOpen >= WALKABLE_SHARE
      && !DOOR_WALK_THROUGH_BY_DESIGN.some((w) => w.pattern.test(m.name))
    );
    result.doorMissing = result.doorMotion.filter((m) => m.effectiveVisible !== false && wouldFlag(m));
    // Parked invisible geometry, reported so it cannot silently pile up, never gated: it does
    // not render, so it neither needs a collider nor may claim one of its own.
    result.doorHiddenParked = result.doorMotion
      .filter((m) => m.effectiveVisible === false)
      .map((m) => ({
        name: m.name,
        hiddenBy: m.hiddenBy,
        local: m.local,
        walkableFractionOpen: m.walkableFractionOpen,
        wouldHaveFlagged: wouldFlag(m),
      }));
    // THE CONTROL ON THE CLASSIFICATION ITSELF. If effectiveVisible were computed wrong and
    // everything read hidden, doorMissing would be trivially zero forever. The sweep must
    // still be judging a real population of visible furniture.
    result.doorVisibleJudged = result.doorMotion.filter((m) => m.effectiveVisible !== false).length;
    result.doorThresholds = { walkableShare: WALKABLE_SHARE, minBandSamples: MIN_BAND_SAMPLES };
    out.variants[variant] = result;
  }
  out.totals = {
    missing: Object.values(out.variants).reduce((n, v) => n + v.missing.length, 0),
    waived: Object.values(out.variants).reduce((n, v) => n + v.waived.length, 0),
    orphaned: Object.values(out.variants).reduce((n, v) => n + v.orphaned.length, 0),
    doorFurniture: Object.values(out.variants).reduce((n, v) => n + v.doorAndWindow.length, 0),
    doorMissing: Object.values(out.variants).reduce((n, v) => n + v.doorMissing.length, 0),
    doorWaived: Object.values(out.variants).reduce((n, v) => n + v.doorWaived.length, 0),
    doorHiddenParked: Object.values(out.variants).reduce((n, v) => n + v.doorHiddenParked.length, 0),
    doorVisibleJudged: Object.values(out.variants).reduce((n, v) => n + v.doorVisibleJudged, 0),
    doorFixedGeometry: Object.values(out.variants)
      .reduce((n, v) => n + v.doorMotion.filter((m) => !m.travelsWithDoor).length, 0),
    doorsActuallyOpened: Object.values(out.variants)
      .reduce((n, v) => n + (v.doorSwing?.opened || 0), 0),
  };
  // The motion test is only evidence if the doors moved. A run where nothing
  // swung would be the closed pass measured twice and reported as a pass, which
  // is the exact shape of fault this stage was written to correct.
  out.doorMotionMeasured = Object.values(out.variants)
    .every((v) => (v.doorSwing?.opened || 0) > 0
      && (v.doorSwing?.heldThroughPass || 0) === (v.doorSwing?.opened || 0));
  out.ok = out.totals.missing === 0 && out.totals.orphaned === 0
    && out.totals.doorMissing === 0 && out.doorMotionMeasured
    // the visibility classification must leave a real judged population per variant, or a
    // bug in it would hide every defect behind a green doorMissing: 0
    && Object.values(out.variants).every((v) => v.doorVisibleJudged >= 30);
  fs.writeFileSync(path.join(outDir, 'collision-parenting-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
