// 1A (Goal 22) — WHAT CAN A PLAYER FIND AT THE FRONT DOOR?
//
// Two strangers played 45 minutes and neither got inside. The brief says the
// threshold debris ignores E and X in silence and the porch belt has no broom
// and no bag. Before changing one value, this measures the situation a real
// player is standing in, from a FRESH profile, OUTSIDE, with no concessions.
//
// It asks four questions, and each is asked the way the player asks it:
//
//   1. What does the game TELL me to do?          (the objective card text)
//   2. What can my CROSSHAIR name?                 sweep the aim across a fan of
//      yaws at each step of the walk in, and collect every distinct focus label.
//      A prop the crosshair never names is a prop the player cannot find.
//   3. What is on my BELT out here?                walkToolEntries, as drawn.
//   4. Where is the work?                          clutter piles and debris
//      clusters with their positions, so "the entrance is dirty" can be checked
//      against "and here is what would clean it".
//
//   node tools/qa/run-electron.cjs tools/qa/electron-1a-entrance-verbs.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/1a-entrance');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // --- 1. what the game says to do -------------------------------------------
  const objective = await page.evaluate(() => {
    const texts = [];
    for (const sel of ['.objectives-panel', '.objectives', '.campaign-guide', '.task-card', '.hud-task']) {
      for (const el of document.querySelectorAll(sel)) {
        const s = (el.innerText || '').trim();
        if (s) texts.push({ sel, text: s.slice(0, 400) });
      }
    }
    return texts;
  });

  // --- 2. where am I, and where is the door? ---------------------------------
  const geometry = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    const w = app.scene3d.walk.state;
    const o = ch?.interior?.position;
    return {
      player: { x: +w.x.toFixed(2), z: +w.z.toFixed(2), yaw: +w.yaw.toFixed(2) },
      interiorOrigin: o ? { x: +o.x.toFixed(2), z: +o.z.toFixed(2) } : null,
      isInside: !!ch?.isInside?.(w.x, w.z),
    };
  });

  // --- 3. the belt, out here -------------------------------------------------
  // Read it the way the UI does: open the wheel and read the DOM, so this
  // measures what is DRAWN rather than what a function would return.
  await page.keyboard.down('f');
  await page.waitForTimeout(900);
  const beltShot = path.join(OUT, 'belt-outside.png');
  await page.screenshot({ path: beltShot });
  const belt = await page.evaluate(() => {
    const root = document.querySelector('.tool-wheel, .tool-belt, .walk-tool-wheel');
    if (!root) return { found: false, items: [] };
    const items = [...root.querySelectorAll('*')]
      .filter((el) => !el.children.length && (el.innerText || '').trim())
      .map((el) => (el.innerText || '').trim());
    return { found: true, items: [...new Set(items)] };
  });
  await page.keyboard.up('f');
  await page.waitForTimeout(500);

  // --- 4. where is the work? -------------------------------------------------
  const work = await page.evaluate(() => {
    const app = window.__fw;
    const reno = app.state?.shop?.reno;
    const piles = (reno?.clutter || []).map((p, i) => ({
      i, x: +Number(p.x).toFixed(2), z: +Number(p.z).toFixed(2), cleared: !!p.cleared,
    }));
    return {
      clutterTotal: piles.length,
      clutterUncleared: piles.filter((p) => !p.cleared).length,
      piles: piles.filter((p) => !p.cleared).slice(0, 40),
      entranceDoorRepaired: reno?.entranceDoorRepaired ?? null,
    };
  });

  // --- 5. THE QUESTION THAT MATTERS: what can the crosshair name? -----------
  // Walk toward the building in steps. At each step, fan the aim across a wide
  // arc and a few pitches and collect every distinct label the crosshair
  // produces. Anything the game wants the player to do that never appears here
  // is, to that player, invisible.
  const scan = async (label) => page.evaluate(async (tag) => {
    const app = window.__fw;
    const w = app.scene3d.walk.state;
    const seen = new Map();
    const baseYaw = w.yaw;
    const basePitch = w.pitch;
    for (let dy = -Math.PI; dy <= Math.PI; dy += Math.PI / 18) {
      for (const p of [-0.55, -0.3, -0.08, 0.15, 0.4]) {
        w.yaw = baseYaw + dy;
        w.pitch = p;
        // one frame so the aim raycast runs against the new orientation
        await new Promise((r) => requestAnimationFrame(() => r()));
        const text = app.scene3d.walk.getFocusLabel?.() || '';
        if (text && !seen.has(text)) {
          seen.set(text, { yawOffset: +dy.toFixed(2), pitch: p });
        }
      }
    }
    w.yaw = baseYaw;
    w.pitch = basePitch;
    return {
      tag,
      at: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) },
      labels: [...seen.entries()].map(([text, where]) => ({ text, ...where })),
    };
  }, label);

  const walkTo = async (x, z) => {
    await page.evaluate(({ tx, tz }) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = tx; w.z = tz;
    }, { tx: x, tz: z });
    await page.waitForTimeout(700);
  };

  const scans = [];
  scans.push(await scan('spawn'));

  // step in toward the interior origin along a straight line, sampling
  const org = geometry.interiorOrigin;
  const start = geometry.player;
  if (org) {
    for (const frac of [0.35, 0.6, 0.8, 0.92, 1.0]) {
      const x = start.x + (org.x - start.x) * frac;
      const z = start.z + (org.z - start.z) * frac;
      await walkTo(x, z);
      scans.push(await scan(`toward-door-${frac}`));
      await page.screenshot({ path: path.join(OUT, `walk-${String(frac).replace('.', '_')}.png`) });
    }
  }

  const allLabels = [...new Set(scans.flatMap((s) => s.labels.map((l) => l.text)))];
  const out = {
    objective, geometry, belt, work, scans, allLabels, errs,
    findings: {
      // the four questions, answered
      objectiveShown: objective.length > 0,
      beltOfferedOutside: belt.items,
      beltHasSweeper: belt.items.some((s) => /broom|sweep/i.test(s)),
      beltHasBag: belt.items.some((s) => /bag|trash|debris/i.test(s)),
      crosshairNamesDebris: allLabels.some((s) => /clutter|debris|rubbish|litter|pile/i.test(s)),
      crosshairNamesDoor: allLabels.some((s) => /door/i.test(s)),
      distinctLabelCount: allLabels.length,
    },
  };
  fs.writeFileSync(path.join(OUT, 'entrance-verbs.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
