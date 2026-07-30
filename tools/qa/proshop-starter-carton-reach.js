async (page) => {
  // CAN THE PLAYER REACH THE STARTER CARTONS?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-starter-carton-reach.js
  //
  // Reported 2026-07-29: "The clubhouse box that spawns without an order has collision I
  // cannot walk through, or get close enough to interact with."
  //
  // Those are the starter cartons from src/sim/clubhouseStarterStock.js — orderId null,
  // loc 'world', placed on FLOOR_BOX_SURFACE_ID near the retail fixtures. They are the only
  // boxes in the room that arrive without a delivery.
  //
  // The claim splits in two and they need separating, because the fix differs:
  //   A. the collider is bigger than the carton, so the player is held at a distance;
  //   B. the collider is right but the carton sits where no approach exists at all —
  //      inside a fixture footprint, or in a pocket the walker cannot enter.
  //
  // So this measures the collider against the carton's own footprint, and then walks a
  // real approach: from a ring of start points around each carton, step the player inward
  // through the actual collision code and record the closest standing position achieved
  // and whether the carton becomes the aimed focus from there.
  //
  // NOT a position teleport check. Setting walk.x/z next to the box would answer "is there
  // a legal point nearby", which is not the question — the question is whether a player
  // walking at it arrives. The approach uses walkTryMove via the ordinary key path.
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
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3200);

  const survey = await page.evaluate(async () => {
    const app = window.__fw;
    const D = await import('/src/sim/deliveries.js');
    const P = await import('/src/sim/boxPlacement.js');
    const L = await import('/src/data/shopLayout.js');
    const ch = app.scene3d.clubhouse();
    // The v2 room pulls the west wall to x -2.60 and the north wall to z -4.60. A carton
    // placed against a v1 fixture the variant CUTS lands behind those walls, in sealed
    // dead cavity, and no approach exists at any bearing. This is the difference between
    // "the collider is wrong" and "the carton is in a different room".
    const bounds = L.PUBLIC_ROOM_BOUNDS;
    const insidePublicRoom = (x, z) => x >= bounds.minX && x <= bounds.maxX
      && z >= bounds.minZ && z <= bounds.maxZ;
    const boxes = D.boxesOf(app.state);
    return {
      total: boxes.length,
      publicBounds: {
        minX: +bounds.minX.toFixed(2), maxX: +bounds.maxX.toFixed(2),
        minZ: +bounds.minZ.toFixed(2), maxZ: +bounds.maxZ.toFixed(2),
      },
      starter: boxes
        .filter((b) => b.orderId == null)
        .map((b) => {
          const dims = P.boxPlacementDimensions ? P.boxPlacementDimensions(b) : null;
          const world = ch.localToWorld(b.x || 0, b.z || 0);
          return {
            id: b.id,
            skuId: b.skuId,
            label: b.assortmentLabel || null,
            loc: b.loc,
            surfaceId: b.surfaceId || null,
            starterPlacement: b.starterPlacement || null,
            local: { x: +(b.x || 0).toFixed(2), z: +(b.z || 0).toFixed(2) },
            insidePublicRoom: insidePublicRoom(b.x || 0, b.z || 0),
            world: { x: +world.x.toFixed(2), z: +world.z.toFixed(2) },
            ry: +(b.ry || 0).toFixed(3),
            dims: dims ? { w: +dims.w.toFixed(2), d: +dims.d.toFixed(2), h: +dims.h.toFixed(2) } : null,
            lifecycle: b.lifecycle,
          };
        }),
    };
  });

  // The collider each carton registered, matched to the carton by position rather than by
  // id — the collider list is geometry, not a map, so this is how the runtime sees it.
  const colliderReport = await page.evaluate((starter) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const cols = app.scene3d.walk.colliders;
    const props = cols?.props || [];
    return starter.map((box) => {
      const near = props
        .filter((c) => c && c.minX !== undefined)
        .map((c) => ({
          cx: (c.minX + c.maxX) / 2,
          cz: (c.minZ + c.maxZ) / 2,
          w: c.maxX - c.minX,
          d: c.maxZ - c.minZ,
        }))
        .map((c) => ({ ...c, dist: Math.hypot(c.cx - box.world.x, c.cz - box.world.z) }))
        .sort((a, b) => a.dist - b.dist);
      const own = near[0] && near[0].dist < 0.35 ? near[0] : null;
      // The carton's own footprint at its yaw, which is exactly what the collider is
      // supposed to be. Anything wider is holding the player off.
      const cosine = Math.abs(Math.cos(box.ry));
      const sine = Math.abs(Math.sin(box.ry));
      const expectW = box.dims ? cosine * box.dims.w + sine * box.dims.d : null;
      const expectD = box.dims ? sine * box.dims.w + cosine * box.dims.d : null;
      return {
        id: box.id,
        hasOwnCollider: !!own,
        collider: own ? { w: +own.w.toFixed(2), d: +own.d.toFixed(2), offsetYd: +own.dist.toFixed(2) } : null,
        expected: expectW != null ? { w: +expectW.toFixed(2), d: +expectD.toFixed(2) } : null,
        oversizedByYd: own && expectW != null
          ? { w: +(own.w - expectW).toFixed(2), d: +(own.d - expectD).toFixed(2) }
          : null,
        // Everything else within 1.5 yd: a carton can be unreachable because of what is
        // AROUND it rather than its own box.
        neighboursWithin1p5: near.filter((c) => c.dist > 0.35 && c.dist < 1.5).length,
      };
    });
  }, survey.starter);

  // A real approach. Start on a ring, face the carton, and drive the walker inward with
  // the same per-frame movement the player uses. Report the closest standing distance and
  // what the crosshair then resolves to.
  const approach = async (box) => {
    const results = [];
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const walked = await page.evaluate(async ({ target, deg }) => {
        const app = window.__fw;
        const walk = app.scene3d.walk;
        const state = walk.state && 'x' in walk.state ? walk.state : walk;
        const rad = (deg * Math.PI) / 180;
        const startX = target.x + Math.sin(rad) * 3.2;
        const startZ = target.z + Math.cos(rad) * 3.2;
        state.x = startX;
        state.z = startZ;
        // Look at the carton: yaw 0 faces -z in this controller, so atan2 is negated.
        state.yaw = Math.atan2(-(target.x - startX), -(target.z - startZ));
        state.pitch = -0.25; // a carton on the floor is below eye level
        return {
          bearing: deg,
          startedAtYd: +Math.hypot(startX - target.x, startZ - target.z).toFixed(2),
          placed: { x: +state.x.toFixed(2), z: +state.z.toFixed(2) },
        };
      }, { target: box.world, deg: bearing });
      if (!walked.placed) continue;
      // Walk forward for a moment through the real key path.
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(900);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(120);
      const arrived = await page.evaluate(({ target, boxId }) => {
        const app = window.__fw;
        const walk = app.scene3d.walk;
        const state = walk.state && 'x' in walk.state ? walk.state : walk;
        const focus = walk.getFocus?.() || null;
        return {
          endedAtYd: +Math.hypot(state.x - target.x, state.z - target.z).toFixed(2),
          at: { x: +state.x.toFixed(2), z: +state.z.toFixed(2) },
          focusKind: focus?.kind ?? null,
          focusLabel: focus?.label ?? null,
          // WHICH prop the crosshair actually chose. Without this the probe counted
          // "Old clutter — [E] haul it out" as a successful carton prompt, because the
          // filter only looked for the string "[E]".
          focusAtYd: focus?.prop && Number.isFinite(focus.prop.x)
            ? +Math.hypot(focus.prop.x - target.x, focus.prop.z - target.z).toFixed(2)
            : null,
          // THE STRING THE PLAYER READS. getFocusLabel is the accessor main.js renders into
          // .shop-prompt; the first version of this probe called walk.focusPrompt(), which
          // does not exist, so every bearing reported "no prompt" — a probe that answers
          // "undefined" for its central question and files it as a defect.
          promptText: (() => {
            try { return walk.getFocusLabel?.() ?? null; } catch { return null; }
          })(),
          boxId,
        };
      }, { target: box.world, boxId: box.id });
      results.push({ ...walked, ...arrived });
    }
    const best = results.reduce((a, b) => (a && a.endedAtYd <= b.endedAtYd ? a : b), null);
    // THE CARTON'S OWN PROMPT: the crosshair must have chosen the prop standing where this
    // carton is, and that prop must offer an action.
    const withPrompt = results.filter((r) => (
      r.focusAtYd != null && r.focusAtYd <= 0.2
      && r.promptText && /\[E\]/.test(r.promptText)
    ));
    return {
      id: box.id,
      label: box.label,
      closestYd: best?.endedAtYd ?? null,
      closestFrom: best?.bearing ?? null,
      bearingsThatPrompt: withPrompt.map((r) => r.bearing),
      promptSeen: withPrompt[0]?.promptText || null,
      perBearing: results,
    };
  };

  const reach = [];
  for (const box of survey.starter) reach.push(await approach(box));

  // A carton's x/z are LOCAL TO ITS SURFACE. For a shelf-mounted box they are shelf-local,
  // so ch.localToWorld(x, z) points at the middle of the room — which is why the first run
  // reported the drinks carton "unreachable at 0.44 yd" while measuring a spot it was
  // nowhere near. Reach is only meaningful for floor cartons.
  const floorCartonIds = new Set(
    survey.starter.filter((b) => b.surfaceId === 'floor:clubhouse').map((b) => b.id),
  );

  const findings = {
    starterCartonCount: survey.starter.length,
    // Only FLOOR cartons register a collider — a shelf-mounted one sits on furniture that
    // already has its own. Scoped, because the first version of this finding failed a
    // correct shelf placement for not having a floor box.
    everyFloorCartonHasItsOwnCollider: colliderReport
      .filter((c) => floorCartonIds.has(c.id))
      .every((c) => c.hasOwnCollider),
    floorCartonIds: [...floorCartonIds],
    nonFloorCartons: survey.starter
      .filter((b) => b.surfaceId !== 'floor:clubhouse')
      .map((b) => ({ id: b.id, label: b.label, surfaceId: b.surfaceId, placement: b.starterPlacement?.kind })),
    // A. Is any collider bigger than the carton it belongs to?
    oversizedColliders: colliderReport
      .filter((c) => c.oversizedByYd && (c.oversizedByYd.w > 0.02 || c.oversizedByYd.d > 0.02))
      .map((c) => ({ id: c.id, oversizedByYd: c.oversizedByYd })),
    // B. Is the carton even in the room the player can walk in?
    cartonsOutsidePublicRoom: survey.starter
      .filter((b) => !b.insidePublicRoom)
      .map((b) => ({ id: b.id, label: b.label, local: b.local, nearFixtureIds: b.starterPlacement?.nearFixtureIds || null })),
    // C. Can the player get within arm's reach, and does the carton's OWN prompt appear?
    unreachableCartons: reach
      .filter((r) => floorCartonIds.has(r.id) && !r.bearingsThatPrompt.length)
      .map((r) => ({ id: r.id, label: r.label, closestYd: r.closestYd, closestFrom: r.closestFrom })),
    closestByCarton: reach.map((r) => ({ id: r.id, closestYd: r.closestYd, prompts: r.bearingsThatPrompt.length })),
  };

  const result = {
    what: 'starter cartons: collider footprint versus the carton, and a walked approach from eight bearings',
    survey,
    colliderReport,
    reach,
    findings,
    errs: errs.slice(0, 12),
    // The claim under test is that the player CAN reach and open every starter carton.
    ok: findings.starterCartonCount > 0
      && findings.everyFloorCartonHasItsOwnCollider
      && findings.oversizedColliders.length === 0
      && findings.cartonsOutsidePublicRoom.length === 0
      && findings.unreachableCartons.length === 0
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'starter-carton-reach.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
