// PHASE 3.3 (Goal 25) — THE HOVER OUTLINE CHECK, WRITTEN BEFORE THE FEATURE.
//
// golf-qa's rule is that every fix gets a check watched FAILING on the unfixed
// build. 3.3 is not implemented, so this is expected to fail now, and that failure
// is the evidence. Whoever builds the outline should run this first, see it red,
// then make it green -- rather than writing a check afterwards against the code
// they just wrote, which is how a check ends up asserting the bug.
//
// Five of 3.3's six clauses are numeric. This measures those five. The sixth --
// "clear, tasteful, comparable to the money highlight" -- needs an eye and is
// deliberately NOT scored here; a driver that pretended to judge taste would be
// the more dangerous kind of green.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p3-ledger-outline.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p3-ledger-outline');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], notes: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  const canvas = await page.$('#game') || await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(600);

  // THE ACCESSOR THIS DEPENDS ON DOES NOT EXIST YET. Its absence is the expected
  // failure, and it is reported as a distinct outcome rather than as a false
  // "outline is wrong" -- an instrument that cannot tell "not built" from
  // "built badly" is worthless for deciding what to do next.
  const readOutline = () => page.evaluate(() => {
    const ch = window.__fw.scene3d?.clubhouse?.();
    const fn = ch?.debugLedgerOutline;
    if (typeof fn !== 'function') return { missing: true };
    try { return { missing: false, ...(fn() || {}) }; } catch (e) { return { missing: false, threw: String(e.message || e) }; }
  });

  // ---- once the accessor exists, these are the five numeric clauses ---------
  //
  // THE FIRST VERSION OF THIS DID NOT AIM AT ANYTHING. It nudged the mouse a few
  // hundred pixels from wherever the player happened to be standing and called
  // that "aimed". Against the finished feature it returned active:false in all
  // five samples and scored two clauses GREEN — "clears when aim is lost" and
  // "does not clone a material per frame" are both trivially true about an
  // outline that never turns on. Identical readings before and after is this
  // project's signature probe lie and it nearly got logged as a product bug.
  //
  // So: stand the player in front of the book at its own recorded world spot and
  // face it. That is state forcing and it is disclosed — but the ACCEPTANCE is
  // not forced, because the game's own prompt is what confirms the aim landed.
  // If walkFindFocus does not name the ledger, this driver has not aimed at it,
  // whatever the numbers say.
  // FALLS BACK TO THE BOOK'S OWN WORLD MATRIX ON PURPOSE. ch.ledgerProp() only
  // exists on the fixed build, so a driver that depended on it could not stand
  // the camera in the same place on the reverted build — and the whole value of
  // the revert screenshot is that it is the SAME camera. matrixWorld rather than
  // an imported THREE: the translation is elements 12/13/14 and needs no module.
  // MATRIXWORLD FIRST, AND THAT ORDER IS THE WHOLE POINT.
  //
  // The first version preferred ch.ledgerProp(), which exists only on the fixed
  // build — so the revert run silently fell through to matrixWorld, stood the
  // camera somewhere else, and produced two pictures of two different views that
  // I was about to compare as if they were a control. They are not the same
  // number either: the prop's x/z come through L2W() from the layout table,
  // matrixWorld is where the mesh actually is.
  //
  // Preferring the book's own world matrix means BOTH builds anchor on the same
  // thing, and the physical truth is the better anchor anyway. ledgerProp stays
  // only as the fallback, and `from` is reported so a mismatch is visible.
  // AIM AT THE POINT THE GAME SCORES, STAND AT THE POINT THE BOOK IS.
  //
  // These are not the same point and that mattered: the prop's x/z come through
  // L2W() from the layout table, the mesh sits where matrixWorld says. Aiming at
  // the mesh satisfied the LOOSE gate (facing > 0.3) and missed the strict one
  // (0.6 yd cross-track), so every "aimed" sample this driver ever took was
  // riding the general prop scan. That is why it certified an outline that
  // lights from across the room: it never once exercised the path the
  // requirement is written about.
  const bookSpot = await page.evaluate(() => {
    const ch = window.__fw.scene3d?.clubhouse?.();
    const r = ch?.ledgerBook?.root;
    const p = ch?.ledgerProp?.() || null;
    let stand = null;
    if (r) {
      r.updateWorldMatrix(true, false);
      const e = r.matrixWorld.elements;
      stand = { x: e[12], z: e[14], aimY: e[13] + 0.03 };
    }
    if (!stand && !p) return null;
    const aim = p ? { x: p.x, z: p.z, aimY: p.aimY } : stand;
    const base = stand || aim;
    return {
      x: base.x, z: base.z, aimY: base.aimY,
      aimX: aim.x, aimZ: aim.z, aimAimY: aim.aimY,
      from: p ? 'prop-aim + mesh-stand' : 'mesh-only',
      // BOTH heights reported, because the XZ gap turned out to be zero and the
      // difference that actually mattered was vertical. A prop carrying aimY is
      // scored against the first-person RAY, so the pitch decides the
      // cross-track distance, and 0.6 yd of cross-track is a small angle at this
      // range.
      aimVsStandYd: +Math.hypot(aim.x - base.x, aim.z - base.z).toFixed(3),
      standAimY: stand ? +stand.aimY.toFixed(4) : null,
      propAimY: p ? +p.aimY.toFixed(4) : null,
      aimYGap: (stand && p) ? +Math.abs(p.aimY - stand.aimY).toFixed(4) : null,
    };
  });
  if (!bookSpot) {
    out.verdict = 'UNMEASURED — ch.ledgerProp() gave no world spot for the book';
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'outline.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('P3-OUTLINE', JSON.stringify(out, null, 2));
    return out;
  }
  out.bookSpot = bookSpot;

  const aimAt = async (on) => {
    await page.evaluate(([spot, facing]) => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse();
      // Stand off the book TOWARD THE ROOM, at a fixed distance.
      //
      // The first version took its bearing from the player's own position, which
      // on the first call was essentially ON the book — so the bearing was noise
      // and the camera ended up half inside the cover. The room centre is a
      // stable reference that does not depend on where the player was standing.
      const back = 2.2;
      const c = ch.interior.position;
      let dx = c.x - spot.x;
      let dz = c.z - spot.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      w.x = spot.x + dx * back;
      w.z = spot.z + dz * back;
      w.vx = 0; w.vz = 0;
      // LOOK AT THE SCORED POINT, not at the mesh. walkPropAimScore measures
      // cross-track distance from the aim ray to the PROP's focus point.
      const tx = spot.aimX ?? spot.x;
      const tz = spot.aimZ ?? spot.z;
      const ty = spot.aimAimY ?? spot.aimY ?? 0;
      const lookX = tx - w.x;
      const lookZ = tz - w.z;
      const h = Math.hypot(lookX, lookZ) || 0.001;
      const yaw = Math.atan2(-lookX / h, -lookZ / h);
      w.yaw = facing ? yaw : yaw + Math.PI;
      // PITCH FROM THE ACTUAL CAMERA, NOT FROM AN ASSUMED EYE HEIGHT.
      //
      // This was `atan2(ty - 1.62, h)`, mixing a WORLD y (the prop's aimY, about
      // -0.65 here) with a LOCAL eye height above the floor. It aimed roughly 46
      // degrees into the ground. The strict crosshair test then passed or failed
      // depending on where the camera happened to settle, which is why one run
      // came back 9/9 and the next 7/9 with no code change between them -- a
      // flaky green I nearly shipped as a fix.
      const eyeY = window.__fw.scene3d?.camera?.position?.y;
      const eye = Number.isFinite(eyeY) ? eyeY : (w.y ?? 0) + 1.62;
      w.pitch = facing ? Math.atan2(ty - eye, h) : 0;
    }, [bookSpot, on]);
    await page.waitForTimeout(700);
  };


  const probe = await readOutline();
  // THE CAMERA IS STAGED BEFORE THIS BRANCH, DELIBERATELY.
  //
  // Everything below the missing-accessor return used to be skipped on the
  // unfixed build, so the reverted run produced no frame — and a revert proof
  // with no picture cannot answer 3.3's one aesthetic clause. Staging first
  // means the SAME camera is shot on both builds and the difference between the
  // two images is exactly the outline and nothing else.
  const stageCamera = async () => {
    if (!bookSpot) return false;
    await aimAt(true);
    await page.screenshot({ path: path.join(OUT, `${process.env.P3_SHOT || 'aimed-at-the-book'}.png`) });
    return true;
  };
  if (probe.missing) {
    out.shotStaged = await stageCamera();
    out.verdict = 'NOT BUILT — ch.debugLedgerOutline() does not exist';
    out.notes.push('Expected on the unfixed build. This is the watched failure for 3.3.');
    out.notes.push('The aim test 3.3 needs is ALREADY solved: courseScene.js:7731 (Goal 24 Decision 3),');
    out.notes.push('which gates on WALK_CROSSHAIR_YD cross-track distance from the aim ray.');
    out.notes.push('Build: shells from that boolean + prompt + this accessor returning');
    out.notes.push('{ active, shellCount, shellOwnerSpans, materialsCreatedSinceBoot }.');
    out.clauses = {
      promptNamesTheLedger: null,
      clearsWhenAimIsLost: null,
      doesNotFrameTheWholeDesk: null,
      survivesOpenAndClose: null,
      doesNotCloneMaterialPerFrame: null,
    };
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'outline.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('P3-OUTLINE', JSON.stringify(out, null, 2));
    return out;
  }

  await aimAt(true);
  const aimed = await readOutline();
  // `.shop-prompt` is the shipping selector. `.walk-prompt` and `.prompt` do not
  // exist in this build and returned '' — an empty string that would have scored
  // "the prompt does not name the ledger" against a prompt that does. TWO
  // SELECTORS is a named FOUND_FALSE shape and I walked straight into it.
  const promptText = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
  // The one frame the sixth clause needs a human to look at. Named by the env
  // var so the SAME camera can be shot on a build with the outline removed --
  // the difference between the two images IS the outline, which is a far better
  // answer to "is it clear and tasteful" than my eye on a single frame.
  await page.screenshot({ path: path.join(OUT, `${process.env.P3_SHOT || 'aimed-at-the-book'}.png`) });

  await aimAt(false);
  const away = await readOutline();

  // THE SAMPLE THIS DRIVER WAS MISSING, AND IT IS WHY 3.3 WAS FOUND-FALSE.
  //
  // It tested AIMED versus 180-DEGREES-AWAY. Those two are so far apart that
  // BOTH paths through walkFindFocus agree on them, so the driver could not tell
  // which path the outline was riding. Everything interesting lives in between:
  //
  //   walkPropUnderCrosshair  cos(12 deg) facing AND 0.6 yd cross-track
  //   the general prop scan   facing > 0.3, about 72 deg, within the prop's own
  //                           radius -- and the ledger's radius is 2.2 yd
  //
  // Standing near the book and looking well off it satisfies the second and not
  // the first. If the outline lights there, it is riding the loose path: "it
  // highlights from across the room, not under the crosshair."
  //
  // 55 degrees is chosen to sit clearly inside the loose gate (cos 55 = 0.57 >
  // 0.3) and clearly outside the strict one (0.57 < cos 12 = 0.978), so the
  // sample cannot be argued either way by a few degrees of camera drift.
  const aimOffBy = async (degrees) => {
    await page.evaluate(([spot, deg]) => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse();
      const c = ch.interior.position;
      let dx = c.x - spot.x; let dz = c.z - spot.z;
      const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      // WELL INSIDE the prop radius, so the loose scan's distance gate passes
      w.x = spot.x + dx * 1.2; w.z = spot.z + dz * 1.2; w.vx = 0; w.vz = 0;
      const tx = spot.aimX ?? spot.x;
      const tz = spot.aimZ ?? spot.z;
      const lx = tx - w.x; const lz = tz - w.z;
      const h = Math.hypot(lx, lz) || 0.001;
      w.yaw = Math.atan2(-lx / h, -lz / h) + (deg * Math.PI / 180);
      w.pitch = Math.atan2((spot.aimAimY ?? spot.aimY ?? 0) - 1.62, h);
    }, [bookSpot, degrees]);
    await page.waitForTimeout(700);
  };
  await aimOffBy(55);
  const inRangeNotAimed = await readOutline();
  const inRangeNotAimedPrompt = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
  await page.screenshot({ path: path.join(OUT, `${process.env.P3_SHOT || 'aimed-at-the-book'}-inrange-notaimed.png`) });

  // AND THE SECOND HALF OF THE OWNER'S REPORT: "stays lit after I pick it up."
  // Carrying is a real state with its own key (X); the outline has no business
  // surviving into it, and nothing in the previous driver ever entered it.
  await aimAt(true);
  await page.evaluate(() => window.__fw.scene3d.clubhouse()?.ledgerBook?.setCarried?.(true));
  await page.waitForTimeout(900);
  const whileCarried = await readOutline();
  await page.evaluate(() => window.__fw.scene3d.clubhouse()?.ledgerBook?.setCarried?.(false));
  await page.waitForTimeout(900);

  // material churn: sample twice, several seconds apart, while aimed
  await aimAt(true);
  const m1 = await readOutline();
  await page.waitForTimeout(3000);
  const m2 = await readOutline();

  // open and close, then re-aim: the outline must not be stale
  await page.keyboard.press('k');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await aimAt(true);
  const afterCycle = await readOutline();

  out.samples = {
    aimed, away, inRangeNotAimed, inRangeNotAimedPrompt, whileCarried,
    m1, m2, afterCycle, promptText,
  };
  out.clauses = {
    // THE OWNER'S TWO FINDINGS, scored as clauses so they can never pass by
    // being untested again.
    darkWhenInRangeButNotAimed:
      inRangeNotAimed.active === false && (inRangeNotAimed.shellCount ?? 0) === 0,
    darkWhileCarried:
      whileCarried.active === false && (whileCarried.shellCount ?? 0) === 0,
    // THE INSTRUMENT'S OWN CONTROL, added after the first version scored two
    // clauses green about an outline that was never on. If aimed and away read
    // the same, this driver has measured nothing and no other clause here means
    // anything.
    aimedAndAwayDiffer: aimed.active !== away.active,
    // and the game's own answer that the aim landed at all
    theGameAgreesIAmAimedAtIt: /ledger|book/i.test(promptText),
    promptNamesTheLedger: /ledger|book/i.test(promptText),
    clearsWhenAimIsLost: away.active === false || (away.shellCount ?? 0) === 0,
    // A COVER IS NOT A DESK. The span of the outlined owner has to be book-sized;
    // framing the whole counter would pass a naive "an outline exists" check.
    doesNotFrameTheWholeDesk: Array.isArray(aimed.shellOwnerSpans)
      && aimed.shellOwnerSpans.length > 0
      && aimed.shellOwnerSpans.every((s) => s != null && s < 2.0),
    survivesOpenAndClose: afterCycle.active === true && (afterCycle.shellCount ?? 0) > 0,
    doesNotCloneMaterialPerFrame:
      m2.materialsCreatedSinceBoot != null && m1.materialsCreatedSinceBoot != null
        ? (m2.materialsCreatedSinceBoot - m1.materialsCreatedSinceBoot) < 5
        : null,
  };
  out.notScored = 'clear, tasteful, comparable to the money highlight — needs an eye, not this driver';
  out.ok = Object.values(out.clauses).every((v) => v === true) && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'outline.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P3-OUTLINE', JSON.stringify({ clauses: out.clauses, ok: out.ok }, null, 2));
  return out;
}
