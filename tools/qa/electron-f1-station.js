// F1 (Full_Goal_16), per plan R-H: four documented entry routes into the
// cashier with a cleaning tool out, each on REAL input, each asserting the
// cashier UI is up (body.register-mode + register.isActive) and the editor
// stayed shut; plus the two negative controls (E in open floor stays dead,
// the fix is scoped to station reach).
//   Route 1 — labelHook hijack state: mop equipped, mopping pitch, at the till.
//   Route 2 — extreme down-pitch (facing-gate case).
//   Route 3 — dead hose-focus (aim above the counter, null cell fallback).
//   Route 4 — E pressed AGAIN with the register open must NOT fall through
//             to the course editor (courseMode stays non-editor).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-station');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = { errs };
  const cbox = await (await page.$('canvas')).boundingBox();
  const lockCanvas = async () => {
    await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.waitForTimeout(300);
  };

  // staging, declared: the cleaning kit exists AND the player stands INSIDE
  // the shop — the wheel only offers the cleaning tools indoors (the probe
  // run listed course tools at spawn: washer/hose/divot/rake, no mop)
  await page.evaluate(() => {
    const inv = window.__fw.state?.shop?.inventory;
    if (inv && inv.vac1 && !(inv.vac1.back >= 1)) inv.vac1.back = 1;
    const s3 = window.__fw.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4;
  });
  await page.waitForTimeout(400);
  await lockCanvas();

  // equip the MOP through the player's own door: hold F, pick by digit
  await page.keyboard.down('f');
  await page.waitForTimeout(600);
  await page.keyboard.up('f');
  await page.waitForTimeout(400);
  const wheelState = await page.evaluate(() => ({
    items: [...document.querySelectorAll('.tool-wheel [role="option"]')].map((b) => (b.textContent || '').trim().slice(0, 24)),
  }));
  const mopIdx = wheelState.items.findIndex((t) => /mop/i.test(t));
  out.wheel = { mopIdx, items: wheelState.items };
  if (mopIdx >= 0) {
    await page.keyboard.press(String(mopIdx + 1));
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }
  // the wheel MUST be closed before any route: an open wheel is modal and
  // eats the interact key (run 1: every route pressed E into the wheel)
  for (let i = 0; i < 3; i += 1) {
    const open = await page.evaluate(() => document.body.classList.contains('tool-wheel-open'));
    if (!open) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await lockCanvas();
  out.tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.());

  // find the till among the stations: stand at each, read the live prompt
  const stations = await page.evaluate(() => window.__fw.scene3d.walk.stations());
  out.stations = stations;
  let till = null;
  for (const st of stations) {
    const probe = await page.evaluate(([s]) => {
      const w = window.__fw.scene3d.walk.state;
      // stand a step south of the prop, face it
      const dx = s.x - (s.x); const dz = -1.2;
      w.x = s.x + dx; w.z = s.z - dz * -1; // one step OFF the prop centre
      w.x = s.x; w.z = s.z + 1.2;
      w.yaw = Math.PI; // face -? — corrected below by aiming at the prop
      const ddx = s.x - w.x; const ddz = s.z - w.z;
      w.yaw = Math.atan2(-ddx, -ddz);
      w.pitch = -0.1;
      return true;
    }, [st]);
    void probe;
    await page.waitForTimeout(450);
    const prompt = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
    if (/desk|register|till|serve|check|arrivals/i.test(prompt) && !/ledger/i.test(prompt)) {
      till = { ...st, prompt };
      break;
    }
  }
  out.till = till;
  if (!till) {
    fs.writeFileSync(path.join(OUT, 'f1.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  const gotoTill = async (pitch) => {
    await page.evaluate(([s, p]) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = s.x; w.z = s.z + 1.15;
      const ddx = s.x - w.x; const ddz = s.z - w.z;
      w.yaw = Math.atan2(-ddx, -ddz);
      w.pitch = p;
    }, [till, pitch]);
    await page.waitForTimeout(450);
  };
  const registerState = () => page.evaluate(() => ({
    active: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
    bodyClass: document.body.classList.contains('register-mode'),
    courseMode: window.__fw.courseMode,
    prompt: document.querySelector('.shop-prompt')?.textContent || '',
    inReach: window.__fw.scene3d.walk.stationInReach(),
  }));
  const leaveRegister = async () => {
    await page.evaluate(() => { window.__fw.scene3d.clubhouse().register?.leave?.(); });
    await page.waitForTimeout(600);
  };

  async function route(name, pitch, shot) {
    await gotoTill(pitch);
    const before = await registerState();
    await page.keyboard.press('e');
    await page.waitForTimeout(900);
    const after = await registerState();
    await page.screenshot({ path: path.join(OUT, shot) });
    const res = {
      name,
      pitch,
      promptBefore: before.prompt.slice(0, 70),
      inReachBefore: !!before.inReach,
      opened: after.active && after.bodyClass,
      editor: after.courseMode === 'editor',
      pass: !!before.inReach && after.active && after.bodyClass && after.courseMode !== 'editor',
    };
    await leaveRegister();
    return res;
  }

  out.routes = [];
  out.routes.push(await route('route1 labelHook-hijack (mop, mopping pitch)', -0.55, 'route1.png'));
  out.routes.push(await route('route2 extreme down-pitch', -1.2, 'route2.png'));
  out.routes.push(await route('route3 dead hose-focus (aim above counter)', 0.3, 'route3.png'));

  // route 4: with the register OPEN, E must not fall through to the editor
  await gotoTill(-0.3);
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  const openState = await registerState();
  await page.keyboard.press('e');
  await page.waitForTimeout(700);
  const afterSecondE = await registerState();
  await page.screenshot({ path: path.join(OUT, 'route4.png') });
  out.routes.push({
    name: 'route4 E-with-register-open stays out of the editor',
    openedFirst: openState.active,
    editorAfterSecondE: afterSecondE.courseMode === 'editor',
    stillActive: afterSecondE.active,
    pass: openState.active && afterSecondE.courseMode !== 'editor',
  });
  await leaveRegister();

  // negative control A: open floor, mop out, E does nothing
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const o = s3.clubhouse().interior.position;
    const w = s3.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.4;
  });
  await page.waitForTimeout(450);
  const floorBefore = await registerState();
  await page.keyboard.press('e');
  await page.waitForTimeout(700);
  const floorAfter = await registerState();
  out.negativeOpenFloor = {
    inReach: !!floorBefore.inReach,
    opened: floorAfter.active,
    editor: floorAfter.courseMode === 'editor',
    pass: !floorBefore.inReach && !floorAfter.active && floorAfter.courseMode !== 'editor',
  };

  // negative control B: the station scan yields NOTHING out of reach — the
  // priority is scoped to the radius, not global
  out.negativeReach = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const w = s3.walk.state;
    const st = s3.walk.stations()[0];
    w.x = st.x + 8; w.z = st.z + 8;
    return { farInReach: s3.walk.stationInReach() };
  });
  out.negativeReach.pass = out.negativeReach.farInReach === null;

  out.checks = {
    mopEquipped: out.tool === 'mop',
    allRoutesOpen: out.routes.every((r2) => r2.pass),
    openFloorStaysDead: out.negativeOpenFloor.pass,
    reachScoped: out.negativeReach.pass,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'f1.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
