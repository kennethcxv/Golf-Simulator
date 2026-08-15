// PLAYTEST 4, ITEM 7d — FINISH THE STRANGER, BY FOLLOWING THE GAME'S OWN PROMPTS.
//
// "Your driver never got inside, so the three-customer half never ran. Follow the
// tutorial's own prompts rather than guessing a heading. And answer the question
// it raised: on Day 1 at 6:01 AM the shop is shut and nothing tells a new player
// to open it."
//
// Last session's driver held W six times toward a building it could not see and
// never got in. This one reads `campaignView(state)` -- the same objective list
// the player is reading -- and reports, objective by objective, what the game is
// asking for, whether it is blocked, and by what. That is the difference between
// "the stranger could not get in" and "the stranger was on step 2 of 19".
//
// It then acts on the first two objectives the way their own hints describe:
// LOOK AROUND (a sustained look sweep, which is what sets `lookedAround`) and
// WALK TOWARD THE CLUBHOUSE. Nothing is injected; the campaign's own event
// recorder decides whether either happened.
//
// NEGATIVE CONTROL: the objective reader is checked against a state where nothing
// has been done, and must report the first objective INCOMPLETE. A reader that
// says "complete" for everything would report a finished tutorial on a fresh boot.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-stranger-follows-tutorial.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/stranger-tutorial');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const objectives = () => page.evaluate(async () => {
    const mod = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    const view = mod.campaignView(window.__fw.state);
    const list = view?.objectives || view?.tasks || [];
    return {
      minutes: window.__fw.state.clock.minutes,
      signOpen: window.__fw.state.shop?.signOpen ?? null,
      businessOpen: window.__fw.state.campaign?.businessOpen ?? null,
      objectives: list.map((o) => ({
        id: o.id, label: o.label, complete: !!o.complete, blocked: o.blocked || null,
        hint: o.hint || null, optional: !!o.optional, zone: o.zone || null,
      })),
    };
  });

  out.atBoot = await objectives();
  console.log('OBJECTIVES AT BOOT');
  for (const o of out.atBoot.objectives) {
    console.log(`  ${o.complete ? 'DONE' : (o.blocked ? 'BLOCKED' : 'open ')}  ${o.id.padEnd(22)} ${o.label}${o.blocked ? `  <- ${o.blocked}` : ''}`);
  }
  console.log('clock', out.atBoot.minutes, 'signOpen', out.atBoot.signOpen, 'businessOpen', out.atBoot.businessOpen);

  // CONTROL: the reader must not call a fresh tutorial finished.
  out.control = {
    firstObjective: out.atBoot.objectives[0]?.id ?? null,
    firstIsIncomplete: out.atBoot.objectives[0]?.complete === false,
    anyComplete: out.atBoot.objectives.filter((o) => o.complete).length,
    total: out.atBoot.objectives.length,
  };
  console.log('CONTROL(reader)', JSON.stringify(out.control));

  // ---- DO WHAT THE FIRST OBJECTIVE ASKS -----------------------------------
  await page.mouse.click(800, 450);
  await page.waitForTimeout(500);
  // "Look around": a sustained sweep, which is what sets the flag. Held long
  // enough to pass the game's own span threshold rather than flicked.
  for (let i = 0; i < 14; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(800 + (i % 2 ? 520 : -520), 430 + (i % 3 ? 40 : -40), { steps: 18 });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(220);
  }
  out.afterLooking = await objectives();
  const survey = (v) => v.objectives.find((o) => o.id === 'survey');
  console.log('AFTER LOOKING', JSON.stringify(survey(out.afterLooking)));

  // "Then walk toward the clubhouse." The heading is taken from the BUILDING,
  // which is what a person who can see it would do -- the interior origin is a
  // real thing in the scene, not a developer shortcut, and last session's failure
  // was walking in a direction nobody had checked.
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const target = ch.interior.position;
    w.yaw = Math.atan2(-(target.x - w.x), -(target.z - w.z));
  });
  for (let i = 0; i < 14; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.down('KeyW');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1400);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.up('KeyW');
    // eslint-disable-next-line no-await-in-loop
    const inside = await page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const w = app.scene3d.walk.state;
      return { inside: ch.isInside(w.x, w.z), x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
    });
    if (i % 4 === 0) console.log('walking', JSON.stringify(inside));
    if (inside.inside) break;
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('e');   // the doors are opened with E, per the hint
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }

  out.afterWalking = await objectives();
  out.inside = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    return { inside: ch.isInside(w.x, w.z), x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
  });
  console.log('AFTER WALKING', JSON.stringify(out.inside), JSON.stringify(survey(out.afterWalking)));

  const openObj = out.atBoot.objectives.find((o) => o.id === 'open') || null;
  out.verdict = {
    tutorialObjectives: out.atBoot.objectives.length,
    completeAtBoot: out.control.anyComplete,
    surveyCompleteAfterFollowingIt: survey(out.afterWalking)?.complete ?? null,
    reachedInside: out.inside.inside === true,
    // THE 6:01 AM QUESTION, answered from the game's own objective list.
    openObjectiveExists: !!openObj,
    openObjectiveLabel: openObj?.label ?? null,
    openObjectiveHint: openObj?.hint ?? null,
    openObjectiveBlockedBy: openObj?.blocked ?? null,
    objectivesBeforeOpen: out.atBoot.objectives.findIndex((o) => o.id === 'open'),
    clockAtBoot: out.atBoot.minutes,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('STRANGER-TUTORIAL', JSON.stringify(out.verdict, null, 2));
  await page.screenshot({ path: path.join(OUT, 'stranger-tutorial.png') });
  fs.writeFileSync(path.join(OUT, 'stranger-tutorial.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
