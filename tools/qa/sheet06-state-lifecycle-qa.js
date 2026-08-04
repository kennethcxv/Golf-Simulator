async (page) => {
  // SHEET 6 SAVE / STATE / LIFECYCLE QA
  //
  // This route deliberately uses the game's own autosave, document reload, and
  // visible Continue button. The first open and close transitions use the same
  // E interaction as a player. Direct state mutation is limited to a documented
  // repeatable restoration fixture and goes through the public simulation
  // mutators plus clubhouse.rebuildReno(), never a renderer-only write.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { pathToFileURL } = process.getBuiltinModule('node:url');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.SHEET06_STATE_QA_OUT
    ? path.resolve(repo, process.env.SHEET06_STATE_QA_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'sheet_06', 'state_lifecycle', 'current');
  fs.mkdirSync(out, { recursive: true });

  const contractPath = path.join(repo, 'tools', 'qa', 'sheet06-state-lifecycle-contract.mjs');
  const contract = await import(`${pathToFileURL(contractPath).href}?qa=${Date.now()}`);
  const requiredCycles = contract.SHEET06_STATE_LIFECYCLE_CYCLES;
  const viewport = { width: 1600, height: 900 };
  const waitTimeoutMs = Number(process.env.SHEET06_STATE_QA_TIMEOUT_MS || 90000);
  const diagnostics = [];
  let phase = 'setup';

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ phase, kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.push({ phase, kind: 'pageerror', message: error.message });
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    diagnostics.push({
      phase,
      kind: /ERR_ABORTED/i.test(failure) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${failure})`,
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.push({
      phase,
      kind: 'http-response',
      message: `${response.status()} ${response.request().method()} ${response.url()}`,
      resourceType: response.request().resourceType(),
    });
  });

  await page.setViewportSize(viewport);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');

  async function waitForVeil() {
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
    }, null, { timeout: waitTimeoutMs });
  }

  async function establishControlledFixture() {
    return page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      if (!app?.state || !clubhouse) throw new Error('Sheet-6 fixture requires the active clubhouse.');
      app.speedIdx = 0;
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.setTool?.(null);
      walk.setSpraying?.(false);
      walk.setSoaping?.(false);
      const origin = clubhouse.interior.position;
      const local = { x: -1.5, z: 8.35, tx: -0.8, tz: 6.625 };
      walk.state.x = origin.x + local.x;
      walk.state.z = origin.z + local.z;
      walk.state.yaw = Math.atan2(-(local.tx - local.x), -(local.tz - local.z));
      walk.state.pitch = 0.01;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.state.weather.today = {
        tempHiF: 72,
        tempLoF: 54,
        rainIn: 0,
        humidity: 0.48,
        windMph: 5,
      };
      app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      return {
        description: 'paused 2 PM clear-weather Willow Creek fixture; no walk-ins; player held beside the main entrance',
        localPlayer: { x: local.x, z: local.z },
        localTarget: { x: local.tx, z: local.tz },
      };
    });
  }

  async function continueIntoGame(label) {
    phase = `${label}:menu`;
    const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
    await clickThroughMenu(page);
    phase = `${label}:game-load`;
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, {
      timeout: waitTimeoutMs,
    });
    // Establish the near-door player fixture before waiting for GLBs. An open
    // entrance therefore cannot legitimately auto-close during the load gate.
    const fixture = await establishControlledFixture();
    await page.evaluate(async () => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      if (typeof clubhouse?.sheet06ProductionReady !== 'function') {
        throw new Error('clubhouse.sheet06ProductionReady() is unavailable.');
      }
      await clubhouse.sheet06ProductionReady();
    });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      const snapshot = production?.diagnostics?.()
        || clubhouse?.sheet06ProductionDiagnostics?.()
        || null;
      return snapshot?.activationStatus === 'active'
        && snapshot?.actualSharedGameIntegrated === true;
    }, null, { timeout: waitTimeoutMs });
    await waitForVeil();
    await page.waitForTimeout(450);
    return fixture;
  }

  async function listenerCensus() {
    const targets = [
      ['window', 'window'],
      ['document', 'document'],
      ['game', "document.getElementById('game')"],
    ];
    const byTargetAndType = {};
    const errors = [];
    let total = 0;
    for (const [label, expression] of targets) {
      let objectId = null;
      try {
        const evaluated = await cdp.send('Runtime.evaluate', {
          expression,
          returnByValue: false,
          awaitPromise: false,
        });
        objectId = evaluated?.result?.objectId || null;
        if (!objectId) throw new Error(`${label} did not produce a remote object.`);
        const result = await cdp.send('DOMDebugger.getEventListeners', {
          objectId,
          depth: -1,
          pierce: true,
        });
        for (const listener of result.listeners || []) {
          const key = [
            label,
            listener.type || 'unknown',
            listener.useCapture ? 'capture' : 'bubble',
            listener.passive ? 'passive' : 'active',
            listener.once ? 'once' : 'persistent',
          ].join(':');
          byTargetAndType[key] = (byTargetAndType[key] || 0) + 1;
          total += 1;
        }
      } catch (error) {
        errors.push({ target: label, message: error.message });
      } finally {
        if (objectId) await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
      }
    }
    return {
      available: errors.length === 0,
      total,
      byTargetAndType: Object.fromEntries(
        Object.entries(byTargetAndType).sort(([left], [right]) => left.localeCompare(right)),
      ),
      errors,
    };
  }

  async function collectSnapshot(label) {
    const snapshot = await page.evaluate((sampleLabel) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const scene = app?.scene3d?.scene;
      if (!clubhouse || !scene) throw new Error(`Sheet-6 snapshot '${sampleLabel}' requires the active scene.`);
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      if (!production?.diagnostics || !production?.getRoot || !production?.getAssemblyRoot) {
        throw new Error('Sheet-6 public production facade is incomplete.');
      }
      const productionDiagnostics = production.diagnostics();
      const templateNumbers = [51, 52, 53, 54, 55, 56, 57, 58, 59, 60];
      const assemblyNumbers = [55, 56, 57, 58, 59, 60];
      const mountNames = [
        'SHEET06_PRODUCTION_EXTERIOR_STAGING',
        'SHEET06_PRODUCTION_INTERIOR_STAGING',
        'SHEET06_PRODUCTION_EXTERIOR_LIVE',
        'SHEET06_PRODUCTION_INTERIOR_LIVE',
      ];
      const templates = templateNumbers.map((number) => ({ number, root: production.getRoot(number) }));
      const assemblies = assemblyNumbers.map((number) => ({ number, root: production.getAssemblyRoot(number) }));
      const sceneNodes = [];
      scene.traverse((node) => sceneNodes.push(node));
      const nameCounts = (names) => Object.fromEntries(names.map((name) => [
        name,
        sceneNodes.filter((node) => node.name === name).length,
      ]));
      const nodeCount = (root) => {
        let count = 0;
        root?.traverse?.(() => { count += 1; });
        return count;
      };
      const mounts = mountNames.map((name) => sceneNodes.find((node) => node.name === name) || null);

      const root55 = production.getAssemblyRoot(55);
      const root56 = production.getAssemblyRoot(56);
      const root58 = production.getAssemblyRoot(58);
      const root59 = production.getAssemblyRoot(59);
      const root60 = production.getAssemblyRoot(60);
      const descendants = (root) => {
        const values = [];
        root?.traverse?.((node) => values.push(node));
        return values;
      };
      const panelDamage = descendants(root56).filter((node) => (
        node?.userData?.damage_overlay === true || node?.userData?.damageOverlay === true
      ));
      const kit56 = productionDiagnostics.assembly?.kits?.find((kit) => kit.assetNumber === 56);
      const architecture = JSON.parse(JSON.stringify(app.state.shop.reno.architecture));
      return {
        label: sampleLabel,
        capturedAt: new Date().toISOString(),
        architecture,
        production: productionDiagnostics,
        roots: {
          templateRootCount: templates.filter((entry) => entry.root).length,
          assemblyRootCount: assemblies.filter((entry) => entry.root).length,
          uniqueTemplateUuidCount: new Set(templates.map((entry) => entry.root?.uuid).filter(Boolean)).size,
          uniqueAssemblyUuidCount: new Set(assemblies.map((entry) => entry.root?.uuid).filter(Boolean)).size,
          templateSceneOccurrences: templates.map((entry) => ({
            assetNumber: entry.number,
            uuid: entry.root?.uuid || null,
            occurrences: sceneNodes.filter((node) => node === entry.root).length,
          })),
          assemblySceneOccurrences: assemblies.map((entry) => ({
            assetNumber: entry.number,
            uuid: entry.root?.uuid || null,
            occurrences: sceneNodes.filter((node) => node === entry.root).length,
          })),
          mountNameCounts: nameCounts(mountNames),
          assemblyNameCounts: nameCounts(assemblyNumbers.map(
            (number) => `SHEET06_ASSET_${number}_PRODUCTION_ASSEMBLY`,
          )),
          sheet06NodeCount: mounts.reduce((sum, root) => sum + nodeCount(root), 0),
          sceneNodeCount: sceneNodes.length,
        },
        forwarding: {
          windows: {
            restored: root55?.userData?.sheet06Restored,
            finish: root55?.userData?.sheet06Finish,
            brokenStates: (root55?.children || []).map(
              (windowRoot) => windowRoot.userData?.sheet06WindowBroken,
            ),
          },
          panels: {
            restored: root56?.userData?.sheet06Restored,
            finish: root56?.userData?.sheet06Finish,
            instanceCount: kit56?.instanceCount ?? 0,
            damageOverlays: {
              objectCount: panelDamage.length,
              visibleObjectCount: panelDamage.filter((node) => node.visible !== false).length,
            },
          },
          ceiling: {
            restored: root58?.userData?.sheet06Restored,
            finish: root58?.userData?.sheet06Finish,
          },
          floor: {
            restored: root59?.userData?.sheet06Restored,
            finish: root59?.userData?.sheet06Finish,
            selectedVariant: productionDiagnostics.assembly?.floor?.selectedVariant ?? null,
            damageVisible: root60?.visible ?? null,
            damageSiteCount: root60?.children?.length ?? 0,
            visibleVariantCounts: (root60?.children || []).map(
              (site) => site.children.filter((variant) => variant.visible !== false).length,
            ),
          },
        },
      };
    }, label);
    snapshot.listeners = await listenerCensus();
    return snapshot;
  }

  async function normalDoorControl(targetDoor) {
    phase = `normal-e-${targetDoor}`;
    await establishControlledFixture();
    await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
    await page.waitForFunction(() => /Shop door/i.test(
      window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
    ), null, { timeout: 5000 });
    const labelBefore = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    await page.keyboard.press('e');
    await page.waitForFunction((expected) => {
      const main = window.__fw?.state?.shop?.reno?.architecture?.doors?.main;
      return main?.left === expected && main?.right === expected;
    }, targetDoor, { timeout: 5000 });
    await page.waitForTimeout(350);
    const persistedDoorState = await page.evaluate(() => {
      const main = window.__fw.state.shop.reno.architecture.doors.main;
      return { left: main.left, right: main.right };
    });
    return {
      mode: 'normal-keyboard-e',
      input: 'canvas click then E',
      labelBefore,
      persistedDoorState,
      ok: persistedDoorState.left === targetDoor && persistedDoorState.right === targetDoor,
    };
  }

  async function applyTargetAndAutosave(target, preserveDoorFromControl) {
    return page.evaluate(async ({ expected, keepDoor }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const restoration = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      const beforeApplications = production.diagnostics().stateApplications;
      const mutations = [];
      for (const [component, value] of Object.entries(expected.components)) {
        mutations.push(restoration.updateArchitectureComponent(app.state, component, value));
      }
      if (!keepDoor) mutations.push(restoration.setMainDoorState(app.state, expected.door));
      if (mutations.some((result) => result?.ok !== true)) {
        throw new Error(`Architecture fixture mutation failed: ${JSON.stringify(mutations)}`);
      }
      clubhouse.rebuildReno();
      await new Promise((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
          const snapshot = production.diagnostics();
          if (snapshot.stateApplications > beforeApplications) return resolve();
          if (performance.now() - started > 10000) {
            return reject(new Error('Sheet-6 applyState did not observe rebuildReno().'));
          }
          setTimeout(poll, 25);
        };
        poll();
      });
      await app.autosave();
      const raw = localStorage.getItem('golfempire:autosave');
      if (!raw) throw new Error('The game autosave did not create golfempire:autosave.');
      const saved = JSON.parse(raw);
      const holding = saved.holdings?.find((entry) => entry.property?.id === saved.activeId);
      if (!holding?.state?.shop?.reno?.architecture) {
        throw new Error('Autosave is missing the active holding architecture block.');
      }
      return {
        mutations,
        storageKey: 'golfempire:autosave',
        rawBytes: raw.length,
        autosaveArchitecture: holding.state.shop.reno.architecture,
      };
    }, { expected: target, keepDoor: preserveDoorFromControl });
  }

  phase = 'initial-navigation';
  await page.goto(baseUrl, {
    waitUntil: 'domcontentloaded',
    timeout: waitTimeoutMs,
  });
  const fixture = await continueIntoGame('initial');
  const cycles = [];
  const captures = [];

  for (let cycleIndex = 0; cycleIndex < requiredCycles; cycleIndex += 1) {
    const target = contract.sheet06LifecycleTarget(cycleIndex);
    phase = `cycle-${cycleIndex + 1}:mutate`;
    const control = cycleIndex < 2
      ? await normalDoorControl(target.door)
      : {
        mode: 'documented-state-fixture',
        input: 'clubhouseRestoration.setMainDoorState()',
        ok: true,
        persistedDoorState: { left: target.door, right: target.door },
      };
    const saved = await applyTargetAndAutosave(target, cycleIndex < 2);
    const beforeSave = await collectSnapshot(`cycle-${cycleIndex + 1}:before-save`);

    phase = `cycle-${cycleIndex + 1}:document-reload`;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: waitTimeoutMs });
    await continueIntoGame(`cycle-${cycleIndex + 1}:reload`);
    const afterReload = await collectSnapshot(`cycle-${cycleIndex + 1}:after-reload`);

    if (cycleIndex < 2) {
      const screenshot = path.join(
        out,
        cycleIndex === 0
          ? 'sheet06-door-open-after-autosave-reload.png'
          : 'sheet06-door-closed-after-autosave-reload.png',
      );
      await page.screenshot({ path: screenshot });
      captures.push(screenshot);
    }
    cycles.push({
      cycleIndex,
      target,
      control,
      storage: { key: saved.storageKey, rawBytes: saved.rawBytes },
      autosaveArchitecture: saved.autosaveArchitecture,
      beforeSave,
      afterReload,
    });
  }

  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const evaluation = contract.evaluateSheet06StateLifecycle({
    cycles,
    browserDiagnostics: blockingDiagnostics,
    requiredCycles,
  });
  const report = {
    schemaVersion: contract.SHEET06_STATE_LIFECYCLE_SCHEMA_VERSION,
    ok: evaluation.ok,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/sheet06-state-lifecycle-qa.js --bootstrap',
    outputEnvironment: {
      directory: 'SHEET06_STATE_QA_OUT',
      runnerResult: 'QA_RESULT_PATH',
    },
    methodology: {
      viewport,
      deviceScaleFactor: 1,
      fixture,
      persistencePath: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> document reload -> visible Continue',
      normalControls: 'cycle 1 canvas click + E opens; cycle 2 canvas click + E closes',
      controlledCycles: requiredCycles,
      stateForwarding: 'clubhouseRestoration public mutators -> clubhouse.rebuildReno() -> Sheet-6 production applyState',
      listenerCensus: 'Chrome DevTools Protocol DOMDebugger.getEventListeners for window, document, and #game after every reload',
      nodeCensus: 'four exact Sheet-6 mounts plus root identity/scene occurrence counts after every reload',
    },
    captures,
    cycles,
    evaluation,
    diagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'state-lifecycle-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
