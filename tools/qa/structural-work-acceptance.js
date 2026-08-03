async (page) => {
  // First-person structural repair + refinish acceptance in the live scene.
  //
  // The fixture makes exactly one component (panels) damaged again, stocks two
  // repair-components kits, and then everything player-visible happens through
  // normal controls: the walk-focus prompt, holding E through the authored
  // repair duration (consuming one kit at the completion edge), tapping E to
  // refinish (paid through the works ledger), a real autosave through the
  // production storage facade, and a full page reload proving persistence.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(process.env.STRUCTURAL_QA_ROOT
    || path.join(repo, 'qa', 'structural-work', 'acceptance'));
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  const diagnostics = [];
  const diagnosticCounts = { consoleError: 0, pageError: 0, requestFailed: 0 };
  let expectedNavigation = true;
  const note = (kind, value) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, text: String(value) });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') note('consoleError', message.text());
  });
  page.on('pageerror', (error) => note('pageError', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (expectedNavigation && /ERR_ABORTED/i.test(failure)) return;
    note('requestFailed', `${request.url()} (${failure})`);
  });

  const evidence = [];
  const shot = async (name) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file });
    evidence.push(name);
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  async function waitForGame() {
    await page.waitForTimeout(1000);
    const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
    await clickThroughMenu(page);
    const firstAffordableProperty = page.getByRole('button', { name: 'Buy', exact: true }).first();
    if (await firstAffordableProperty.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstAffordableProperty.click();
    }
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForTimeout(600);
    expectedNavigation = false;
    await page.mouse.click(640, 360);
    await page.waitForTimeout(200);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForGame();

  // --- Fixture: one damaged component, two kits, cash for two refinishes ---
  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const state = app.state;
    const Campaign = await import('/src/sim/campaign.js');
    if (state.campaign?.enabled) Campaign.disableCampaign(state);
    const R = await import('/src/sim/clubhouseRestoration.js');
    R.ensureClubhouseRestoration(state);
    R.updateArchitectureComponent(state, 'panels', { restored: false });
    state.shop.reno.componentRepairProgress.panels = 0;
    if (!state.shop.inventory.repairkit1) {
      state.shop.inventory.repairkit1 = { shelf: 0, back: 0 };
    }
    state.shop.inventory.repairkit1.back = 2;
    state.shop.inventory.repairkit1.shelf = 0;
    if (state.shop.carry?.skuId === 'repairkit1') state.shop.carry = null;
    state.cash = Math.max(Number(state.cash) || 0, 400);
    app.scene3d.clubhouse().rebuildReno();
    return {
      campaignEnabled: !!state.campaign?.enabled,
      panels: { ...state.shop.reno.architecture.components.panels },
      kits: state.shop.inventory.repairkit1.back,
      cash: state.cash,
    };
  });
  assert(!fixture.campaignEnabled, 'Fixture requires normal (non-campaign) play.');
  assert(fixture.panels.restored === false, 'Fixture did not leave the panels damaged.');

  // --- Stand at the panels damage site through the normal walk camera ---
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = origin.x + 5.15;
    walk.state.z = origin.z + 2.05;
    walk.state.yaw = 0;
    walk.state.pitch = -0.18;
  });
  await page.waitForTimeout(400);

  const focusLabel = await page.waitForFunction(() => {
    const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
    return /Wall panels/.test(label) ? label : null;
  }, null, { timeout: 8000 }).then((handle) => handle.jsonValue());
  assert(/hold \[E\] to repair/.test(focusLabel),
    `Damaged panels prompt does not offer the hold repair: ${focusLabel}`);
  assert(/2 repair components ready/.test(focusLabel),
    `Prompt does not report the physical kit count: ${focusLabel}`);
  await shot('01-damaged-panels-prompt.png');

  const damagedVisual = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().sheet06Production.getRoot(56);
    const visibility = {};
    // Exact adapter-contract names only: the adapter toggles these named
    // group nodes; their descendants keep local visible=true by design.
    const CONTRACT = ['LOD0_PanelsRestored', 'PanelsRestored',
      'LOD0_PanelsDamaged', 'PanelsDamaged', 'PanelDamage'];
    root?.traverse?.((node) => {
      if (CONTRACT.includes(node.name)) visibility[node.name] = node.visible;
    });
    return visibility;
  });

  // --- Hold E through the full authored repair ---
  await page.keyboard.down('e');
  const midProgress = await page.waitForFunction(() => {
    const progress = window.__fw.state.shop.reno.componentRepairProgress.panels;
    return progress > 0.15 && progress < 1 ? progress : null;
  }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());
  const midState = await page.evaluate(() => ({
    restored: window.__fw.state.shop.reno.architecture.components.panels.restored,
    kits: window.__fw.state.shop.inventory.repairkit1.back,
  }));
  assert(midState.restored === false, 'Panels restored before the hold completed.');
  assert(midState.kits === 2, 'A kit was consumed before the completion edge.');
  await shot('02-repair-hold-in-progress.png');
  await page.waitForFunction(() => (
    window.__fw.state.shop.reno.architecture.components.panels.restored === true
  ), null, { timeout: 9000 });
  await page.keyboard.up('e');

  const repaired = await page.evaluate(() => ({
    panels: { ...window.__fw.state.shop.reno.architecture.components.panels },
    progress: window.__fw.state.shop.reno.componentRepairProgress.panels,
    kits: window.__fw.state.shop.inventory.repairkit1.back,
    repAwards: Object.keys(window.__fw.state.reputation?.processedIds || {})
      .filter((id) => id.includes(':repair:panels')).length,
  }));
  assert(repaired.panels.restored === true, 'Holding E did not restore the panels.');
  assert(repaired.progress === 1, 'Completed repair did not settle at progress 1.');
  assert(repaired.kits === 1, `Completion should consume exactly one kit (left: ${repaired.kits}).`);
  assert(repaired.repAwards === 2, `Expected the two exact-once reputation awards, saw ${repaired.repAwards}.`);
  await page.waitForTimeout(500);
  await shot('03-panels-repaired.png');

  const restoredVisual = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().sheet06Production.getRoot(56);
    const visibility = {};
    // Exact adapter-contract names only: the adapter toggles these named
    // group nodes; their descendants keep local visible=true by design.
    const CONTRACT = ['LOD0_PanelsRestored', 'PanelsRestored',
      'LOD0_PanelsDamaged', 'PanelsDamaged', 'PanelDamage'];
    root?.traverse?.((node) => {
      if (CONTRACT.includes(node.name)) visibility[node.name] = node.visible;
    });
    return visibility;
  });
  const visualsApply = Object.keys(restoredVisual).length > 0;
  if (visualsApply) {
    for (const [name, visible] of Object.entries(restoredVisual)) {
      if (/Restored/.test(name)) assert(visible, `${name} should be visible after repair`);
      else assert(!visible, `${name} should be hidden after repair`);
    }
  }

  // --- Refinish by tapping E: exact cost, exact ledger key, finish change ---
  const beforePaint = await page.evaluate(() => ({
    cash: window.__fw.state.cash,
    finish: window.__fw.state.shop.reno.architecture.components.panels.finish,
  }));
  const paintLabel = await page.waitForFunction(() => {
    const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
    return /refinish/.test(label) ? label : null;
  }, null, { timeout: 6000 }).then((handle) => handle.jsonValue());
  assert(/\$60/.test(paintLabel), `Refinish prompt does not state the $60 cost: ${paintLabel}`);
  await page.keyboard.press('e');
  await page.waitForFunction((previous) => (
    window.__fw.state.shop.reno.architecture.components.panels.finish !== previous
  ), beforePaint.finish, { timeout: 5000 });
  const painted = await page.evaluate(() => ({
    cash: window.__fw.state.cash,
    finish: window.__fw.state.shop.reno.architecture.components.panels.finish,
    applications: window.__fw.state.shop.reno.componentPaintApplications.panels,
    ledgerKeys: Object.keys(window.__fw.state.ledger?.processedIds || {})
      .filter((id) => id.startsWith('clubhouse-paint:')),
  }));
  assert(Math.round((beforePaint.cash - painted.cash) * 100) === 6000,
    `Refinish should cost exactly $60 (cash ${beforePaint.cash} -> ${painted.cash}).`);
  assert(painted.applications === 1, 'Paint application counter did not advance to 1.');
  assert(painted.ledgerKeys.length === 1,
    `Expected exactly one clubhouse-paint ledger key, saw ${JSON.stringify(painted.ledgerKeys)}.`);
  await page.waitForTimeout(400);
  await shot('04-panels-refinished.png');

  // --- Real autosave through the production storage facade, then reload ---
  await page.evaluate(async () => {
    const { empireSnapshot } = await import('/src/sim/empire.js');
    const Storage = await import('/src/core/storage.js');
    await Storage.saveData('autosave', empireSnapshot(window.__fw.empire));
    await Storage.saveData('autosave-meta', {
      savedAt: Date.now(),
      clubName: window.__fw.state.clubName || 'Structural QA',
      propertyName: window.__fw.state.clubName || 'Structural QA',
    });
  });
  expectedNavigation = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGame();

  const reloaded = await page.evaluate(() => ({
    panels: { ...window.__fw.state.shop.reno.architecture.components.panels },
    progress: window.__fw.state.shop.reno.componentRepairProgress.panels,
    applications: window.__fw.state.shop.reno.componentPaintApplications.panels,
    kits: window.__fw.state.shop.inventory.repairkit1.back,
  }));
  assert(reloaded.panels.restored === true, 'Reload lost the completed repair.');
  assert(reloaded.panels.finish === painted.finish, 'Reload lost the applied finish.');
  assert(reloaded.progress === 1, 'Reload lost the repair progress.');
  assert(reloaded.applications === 1, 'Reload lost the paint application count.');
  assert(reloaded.kits === 1, 'Reload changed the remaining kit count.');
  await shot('05-after-reload.png');

  assert(diagnosticCounts.consoleError === 0,
    `Console errors during the run: ${JSON.stringify(diagnostics.slice(0, 5))}`);
  assert(diagnosticCounts.pageError === 0,
    `Page errors during the run: ${JSON.stringify(diagnostics.slice(0, 5))}`);

  const result = {
    ok: true,
    focusLabel,
    midProgress,
    repaired,
    paint: { before: beforePaint, after: painted, label: paintLabel },
    reloaded,
    visuals: { applied: visualsApply, damaged: damagedVisual, restored: restoredVisual },
    diagnostics: diagnosticCounts,
    evidence,
  };
  fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
