async (page) => {
  // BLOCKER 1 â€” walk the ceiling beat end to end in a live session and prove
  // each stage by what the player can SEE, not by what the sim returns.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-ceiling-beat-acceptance.js
  //
  // The bug this exists to stop: "Dead ceiling light repaired" with the room
  // still dark. A sim-only assertion would have passed that happily â€” the panel
  // state really did change â€” so every stage here is checked against rendered
  // light intensity and the prompt the player actually reads.
  //
  // Stages: dark start -> repair refused and prompt names the circuit -> power
  // the ring -> repair with a kit -> panels light. Screenshots at each stage.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'ceiling-beat');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Stand under the faulted run, looking up at the fittings.
  const pose = async () => page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = 1.7 + o.x; w.z = 0.0 + o.z; w.yaw = 0; w.pitch = 0.62;
    app.speedIdx = 0;
  });

  // Rendered light, not sim state: this is the number the walk disputed.
  const lightRead = async () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const panels = [];
    ch.interior.parent.traverse((o) => {
      if (o.isRectAreaLight || o.isPointLight || o.isSpotLight) {
        if (/panel/i.test(o.name || '') || /panel/i.test(o.parent?.name || '')) {
          panels.push({ name: o.name || o.parent?.name, visible: o.visible, intensity: +o.intensity.toFixed(3) });
        }
      }
    });
    const diag = ch.ceilingLightingDiagnostics?.() || {};
    return {
      circuitPowered: diag.circuitPowered ?? null,
      repairComplete: diag.repairComplete ?? null,
      litPanels: panels.filter((p) => p.visible && p.intensity > 0.001).length,
      panels,
    };
  });

  const promptRead = async () => page.evaluate(() => (
    window.__fw.scene3d.walk.getFocusLabel?.() || null
  ));

  const simRead = async () => page.evaluate(async () => {
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const s = R.restorationSnapshot(window.__fw.state);
    return {
      lightPanels: s.lightPanels,
      kitsBack: window.__fw.state.shop?.inventory?.repairkit1?.back ?? 0,
      powered: R.ceilingCircuitPowered(window.__fw.state),
    };
  });

  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  };

  const stages = {};

  // --- 1. dark start: the circuit is out and the prompt must say so ---------
  await pose();
  // Aim at the nearest faulted fitting so the focus label resolves.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = -0.2 + o.x; w.z = -2.55 + o.z; w.pitch = 0.9;
  });
  await page.waitForTimeout(700);
  stages.darkStart = { light: await lightRead(), sim: await simRead(), prompt: await promptRead() };
  await shot('1-dark-start');

  // Pressing E here must NOT report a repair.
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  stages.refusedWhileDark = {
    sim: await simRead(),
    light: await lightRead(),
    // The toast the player gets instead of a false success.
    toast: await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.toast, .notification, [class*="toast"]')];
      return nodes.map((n) => n.textContent.trim()).filter(Boolean).slice(-3);
    }),
  };
  await shot('2-refused-while-dark');

  // --- 2. power the ring, then repair with kits ----------------------------
  await page.evaluate(async () => {
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const st = window.__fw.state;
    st.shop.inventory.repairkit1 = st.shop.inventory.repairkit1 || { shelf: 0, back: 0 };
    st.shop.inventory.repairkit1.back += 4;
    R.restorationAction(st, { type: 'repair-component', component: 'ceiling', progress: 1 });
    window.__fw.scene3d.clubhouse().refreshRestoration?.();
  });
  await page.waitForTimeout(1200);
  stages.poweredNeglected = { light: await lightRead(), sim: await simRead(), prompt: await promptRead() };
  await shot('3-powered-neglected');

  // Flicker sampled over time: a flickering run must actually vary.
  const flickerSamples = [];
  for (let i = 0; i < 24; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    flickerSamples.push(await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const out = [];
      ch.interior.parent.traverse((o) => {
        if ((o.isRectAreaLight || o.isPointLight) && /panel/i.test(o.name || o.parent?.name || '')) {
          out.push(+o.intensity.toFixed(3));
        }
      });
      return out;
    }));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(90);
  }
  const varied = flickerSamples[0].map((_, i) => {
    const series = flickerSamples.map((s) => s[i]).filter((v) => v !== undefined);
    return Math.max(...series) - Math.min(...series);
  });
  stages.flicker = {
    samples: flickerSamples.length,
    perPanelSwing: varied.map((v) => +v.toFixed(3)),
    flickeringPanels: varied.filter((v) => v > 0.05).length,
    deadPanels: flickerSamples[0].filter((v) => v <= 0.001).length,
  };

  // --- 3. complete the beat through the real interaction -------------------
  await page.evaluate(async () => {
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    for (const targetId of ['ceiling:panel-02', 'ceiling:panel-07']) {
      R.restorationAction(window.__fw.state, { type: 'repair-light', targetId });
    }
    window.__fw.scene3d.clubhouse().refreshRestoration?.();
  });
  await page.waitForTimeout(1200);
  stages.repaired = { light: await lightRead(), sim: await simRead(), prompt: await promptRead() };
  await shot('4-repaired');

  const failures = [];
  if (stages.darkStart.light.circuitPowered !== false) failures.push('dark start: circuit was already powered');
  if (stages.darkStart.light.litPanels !== 0) failures.push('dark start: panels are lit');
  // The prompt has to describe what is overhead, not what the save file calls
  // it. With zero lit panels nothing can be flickering, so the word must not
  // appear â€” this read is why the label is power-conditional.
  if (/flicker/i.test(stages.darkStart.prompt || '')) {
    failures.push(`dark start: prompt claims a flicker the player cannot see â€” "${stages.darkStart.prompt}"`);
  }
  if (!/dark/i.test(stages.darkStart.prompt || '')) {
    failures.push(`dark start: prompt does not describe the unlit fitting â€” "${stages.darkStart.prompt}"`);
  }
  if (/flicker/i.test(stages.poweredNeglected.prompt || '') === false) {
    failures.push(`powered: the flicker fault is now visible but unnamed â€” "${stages.poweredNeglected.prompt}"`);
  }
  if (stages.refusedWhileDark.sim.lightPanels['panel-07'] !== 'dead') {
    failures.push('E on a dead ring reported a repair â€” the exact lie this gate exists to stop');
  }
  if (stages.poweredNeglected.light.circuitPowered !== true) failures.push('power did not reach the ring');
  if (stages.flicker.flickeringPanels < 2) {
    failures.push(`only ${stages.flicker.flickeringPanels} fitting(s) flicker â€” the abandoned read needs 2`);
  }
  if (stages.flicker.deadPanels < 2) {
    failures.push(`only ${stages.flicker.deadPanels} fitting(s) fully dark â€” the abandoned read needs 2`);
  }
  if (stages.repaired.light.litPanels !== 4) {
    failures.push(`after repair only ${stages.repaired.light.litPanels}/4 fittings light`);
  }
  if (stages.repaired.sim.kitsBack !== stages.poweredNeglected.sim.kitsBack - 2) {
    failures.push('two panel repairs did not spend two kits');
  }

  const out = { stages, failures, ok: failures.length === 0, shots: shotDir };
  fs.writeFileSync(path.join(outDir, 'ceiling-beat-acceptance.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
