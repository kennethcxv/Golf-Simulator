// PINE HILLS DISCRETE RESTORATION + LIGHTING ACCEPTANCE
//
// Production verbs only:
//   F              select/stow the shipped cleaning tools
//   held LMB       broom, vacuum, bag, spray, and wipe discrete neglect targets
//   E              straighten/organize/rehang and repair both failed ceiling panels
//   Escape + UI    save and reload a partially restored clubhouse
//
// Direct page access is restricted to deterministic fixture setup, fixed player
// poses, diagnostics, and observation. No restoration action or target progress
// is called or written by this driver.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const out = path.resolve(process.env.PINE_HILLS_RESTORATION_OUT
    || path.join(repo, 'qa', 'pine-hills-clubhouse', 'restoration-lights-acceptance'));
  const shotsDir = path.join(out, 'screenshots');
  const videoDir = path.join(out, 'video');
  const videoFile = path.join(videoDir, 'pine-hills-restoration-lights-normal-controls.webm');
  const resultPath = path.resolve(process.env.QA_RESULT_PATH || path.join(out, 'latest-result.json'));
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const checks = [];
  const blockers = [];
  const controls = [];
  const captures = [];
  const targetRoutes = {};
  const diagnostics = [];
  let fixture = null;
  let baseline = null;
  let finalSnapshot = null;
  let persistence = null;
  let lightEvidence = null;
  let captureStarted = null;
  let mediaCapture = null;
  let browserReady = false;
  let phase = 'boot';

  const relative = (file) => path.relative(repo, file).replaceAll('\\', '/');
  const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
  const serializeError = (error) => ({
    phase,
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || null,
    evidence: error?.evidence || null,
  });

  page.on('pageerror', (error) => diagnostics.push({
    kind: 'pageerror', message: error.message, phase,
  }));
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    diagnostics.push({
      kind: `console:${message.type()}`,
      message: message.text(),
      phase,
    });
  });
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
    phase,
  }));
  page.on('response', (response) => {
    if (response.status() >= 400) diagnostics.push({
      kind: 'response:error',
      message: `${response.status()} ${response.url()}`,
      phase,
    });
  });

  function check(name, ok, detail = null) {
    const entry = { name, ok: !!ok };
    if (detail !== null && detail !== undefined) entry.detail = detail;
    checks.push(entry);
    return entry.ok;
  }

  function requireCheck(name, ok, detail = null) {
    if (check(name, ok, detail)) return true;
    const error = new Error(name);
    error.evidence = detail;
    throw error;
  }

  async function waitForGame() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.evaluate(async () => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      await clubhouse.sheet06ProductionReady?.();
      await clubhouse.props71to100?.ready;
      await clubhouse.pineHillsInterior?.ready;
    });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || style.visibility === 'hidden'
        || Number.parseFloat(style.opacity) < 0.02;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(900);
  }

  async function installObservers({ reset = false } = {}) {
    return page.evaluate(({ reset }) => {
      const app = window.__fw;
      const cues = [
        'clubhouse-cleanup-complete',
        'clubhouse-light-repaired',
        'clubhouse-restoration-complete',
      ];
      if (reset || !Array.isArray(window.__pineRestorationCueLog)) {
        window.__pineRestorationCueLog = [];
      }
      for (const cue of cues) {
        const current = app.audio?.[cue];
        if (typeof current !== 'function' || current.__pineRestorationObserved) continue;
        const wrapped = function observedRestorationCue(...args) {
          window.__pineRestorationCueLog.push({ cue, at: performance.now() });
          return current.apply(this, args);
        };
        wrapped.__pineRestorationObserved = true;
        wrapped.__pineRestorationOriginal = current;
        app.audio[cue] = wrapped;
      }

      if (reset || !Array.isArray(window.__pineRestorationToastLog)) {
        window.__pineRestorationToastLog = [];
      }
      if (reset || !Array.isArray(window.__pineRestorationToastDomLog)) {
        window.__pineRestorationToastDomLog = [];
      }
      const currentToast = app.scene3d?.walk?.hooks?.toast;
      if (typeof currentToast === 'function' && !currentToast.__pineRestorationObserved) {
        const wrappedToast = function observedRestorationToast(message, kind, ...args) {
          window.__pineRestorationToastLog.push({
            text: String(message || ''), kind: kind || '', at: performance.now(),
          });
          return currentToast.call(this, message, kind, ...args);
        };
        wrappedToast.__pineRestorationObserved = true;
        wrappedToast.__pineRestorationOriginal = currentToast;
        app.scene3d.walk.hooks.toast = wrappedToast;
      }
      window.__pineRestorationToastObserver?.disconnect?.();
      const seen = new WeakSet();
      const record = (node) => {
        if (!(node instanceof Element)) return;
        const descendants = typeof node.querySelectorAll === 'function'
          ? [...node.querySelectorAll('.toast, .notification')]
          : [];
        const candidates = [
          ...(node.matches?.('.toast, .notification') ? [node] : []),
          ...descendants,
        ];
        for (const toast of candidates) {
          if (seen.has(toast)) continue;
          seen.add(toast);
          window.__pineRestorationToastDomLog.push({
            text: String(toast.querySelector?.('.notification-message')?.textContent
              || toast.textContent || '').trim(),
            className: String(toast.className || ''),
            at: performance.now(),
          });
        }
      };
      const observer = new MutationObserver((records) => {
        for (const recordEntry of records) {
          for (const node of recordEntry.addedNodes) record(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.__pineRestorationToastObserver = observer;
      return {
        cues: Object.fromEntries(cues.map((cue) => [cue, typeof app.audio?.[cue]])),
        toastHook: typeof app.scene3d?.walk?.hooks?.toast,
      };
    }, { reset });
  }

  async function prepareWorld() {
    return page.evaluate(async () => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.scene3d.setGolfersFrozen?.(true);
      app.scene3d.clearGolfers?.();
      app.state.tutorial.complete = true;
      app.state.tutorial.hidden = true;
      // This is the same documented equipment fixture used by the complete
      // cleaning-gameplay acceptance. It grants the vacuum, never progress.
      const inventory = app.state.shop.inventory;
      if (!inventory.vac1) inventory.vac1 = { shelf: 0, back: 1, ordered: 0 };
      inventory.vac1.back = Math.max(1, Number(inventory.vac1.back) || 0);
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      app.scene3d.walk.clearKeys?.();
      app.scene3d.camera.fov = 66;
      app.scene3d.camera.updateProjectionMatrix();
      const pine = await import(new URL('src/render3d/clubhouse/pineHillsInterior.js', document.baseURI).href);
      const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      return {
        cleanupPoses: JSON.parse(JSON.stringify(pine.PINE_HILLS_CLEANUP_POSES)),
        panels: Object.fromEntries(layout.CLUBHOUSE_CEILING_PANELS
          .filter((panel) => panel.id === 'panel-02' || panel.id === 'panel-07')
          .map((panel) => [panel.id, { ...panel }])),
        ceilingY: layout.SHELL.h - 0.08,
        origin: clubhouse.interior.position.toArray(),
        playerActive: app.scene3d.walk.isActive(),
        pineDiagnostics: clubhouse.pineHillsInterior?.diagnostics?.() || null,
        repairKitCount: (() => {
          const line = inventory.repairkit1;
          const carry = app.state.shop.carry;
          const boxes = app.state.shop.deliveries?.boxes || [];
          return (Number(line?.shelf) || 0) + (Number(line?.back) || 0)
            + (carry?.skuId === 'repairkit1' ? Number(carry.qty) || 0 : 0)
            + boxes.filter((box) => box?.skuId === 'repairkit1')
              .reduce((sum, box) => sum + (Number(box.qty ?? box.quantity) || 0), 0);
        })(),
      };
    });
  }

  async function poseFacing(localX, localZ, targetX, targetZ, targetY = 0.05) {
    await page.evaluate(({ localX, localZ, targetX, targetZ, targetY }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      const dx = targetX - localX;
      const dz = targetZ - localZ;
      const horizontal = Math.max(0.001, Math.hypot(dx, dz));
      walk.clearKeys?.();
      walk.state.x = origin.x + localX;
      walk.state.z = origin.z + localZ;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.atan2(targetY - 1.62, horizontal);
    }, { localX, localZ, targetX, targetZ, targetY });
    await page.waitForTimeout(180);
  }

  async function fixedOverview() {
    // Stay on the authored main-door clearway. The older camera point at
    // x=-3.35 sat inside the furnished pro-shop approach collider after a
    // production save/load rebuild; the walk controller correctly
    // depenetrated that direct QA pose back to the porch, which made F cycle
    // outdoor maintenance tools instead of the indoor cleaning belt.
    await poseFacing(-0.80, 4.75, -3.10, -2.10, 2.80);
  }

  async function stateSnapshot(label) {
    return page.evaluate((label) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const scene = app.scene3d.scene;
      const targetIds = [
        'entry:leaves-trash', 'corner:cobweb-nw', 'corner:cobweb-ne',
        'wall:scuff-west', 'wall:scuff-east',
        'lounge:pizza-box', 'lounge:empty-cups', 'lounge:chair-crooked',
        'wall:fallen-frame', 'desk:paper-stack', 'desk:overflow-bin', 'desk:sticky-notes',
        'ceiling:panel-02', 'ceiling:panel-07',
      ];
      const cleanupIds = targetIds.filter((id) => !id.startsWith('ceiling:'));
      const effectiveVisible = (object) => {
        for (let cursor = object; cursor; cursor = cursor.parent) {
          if (cursor.visible === false) return false;
        }
        return !!object;
      };
      const detail = (object) => object ? {
        name: object.name || null,
        visible: object.visible !== false,
        effectiveVisible: effectiveVisible(object),
        position: object.position.toArray().map((value) => Number(value.toFixed(4))),
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z]
          .map((value) => Number(value.toFixed(4))),
        scale: object.scale.toArray().map((value) => Number(value.toFixed(4))),
      } : null;
      const matching = (root, source) => {
        const result = [];
        const pattern = new RegExp(source, 'i');
        root?.traverse?.((object) => {
          if (!pattern.test(object.name || '')) return;
          result.push(detail(object));
        });
        return result;
      };
      const named = (targetId) => {
        const colonNormalized = targetId.replaceAll(':', '_');
        return scene.getObjectByName(`RestorationTarget_${colonNormalized}`)
          || scene.getObjectByName(`RestorationTarget_${colonNormalized.replaceAll('-', '_')}`);
      };
      const pine = clubhouse.pineHillsInterior;
      const litter = pine?.getRoot?.('loungeLitter');
      const desk = pine?.getRoot?.('deskClutter');
      const overflow = pine?.getRoot?.('overflowBin');
      const frame = pine?.getRoot?.('fallenFrame');
      let chair = null;
      scene.traverse((object) => {
        if (object.userData?.assetRuntime?.assetNumber === 68) chair = object;
      });
      const panels = {};
      for (const panelId of ['panel-02', 'panel-07']) {
        const light = scene.getObjectByName(`CeilingPanelLight_${panelId}`);
        const face = scene.getObjectByName(`CeilingPanelFace_${panelId}`);
        panels[panelId] = {
          faultState: app.state.shop.reno.lightPanels?.[panelId] || null,
          light: light ? {
            ...detail(light),
            intensity: Number((light.intensity || 0).toFixed(6)),
          } : null,
          face: face ? {
            ...detail(face),
            color: face.material?.color?.getHexString?.() || null,
            emissive: face.material?.emissive?.getHexString?.() || null,
            emissiveIntensity: Number((face.material?.emissiveIntensity || 0).toFixed(6)),
          } : null,
        };
      }
      const reno = app.state.shop.reno;
      const propertyId = String(app.state.property?.id
        ?? app.state.propertyInventory?.propertyId
        ?? app.state.propertyId
        ?? `club-${app.state.seed ?? 'unknown'}`);
      const expectedSourceIds = [
        ...cleanupIds,
        'ceiling:panel-02:cleanliness', 'ceiling:panel-02:service',
        'ceiling:panel-07:cleanliness', 'ceiling:panel-07:service',
      ];
      const relevantHistory = (app.state.reputation?.history || [])
        .filter((entry) => entry.source === 'clubhouse-restoration'
          && expectedSourceIds.includes(entry.sourceId))
        .map((entry) => ({
          id: entry.id,
          sourceId: entry.sourceId,
          categoryDeltas: { ...entry.categoryDeltas },
          reason: entry.reason,
        }));
      const processedPrefix = `clubhouse-restoration:${propertyId}:1:`;
      const relevantProcessedIds = Object.keys(app.state.reputation?.processedIds || {})
        .filter((id) => id.startsWith(processedPrefix)
          && expectedSourceIds.includes(id.slice(processedPrefix.length)))
        .sort();
      return {
        label,
        restoration: {
          targetProgress: Object.fromEntries(targetIds.map((id) => [id, reno.targetProgress?.[id]])),
          lightPanels: { ...reno.lightPanels },
          fullCleanupAwarded: reno.fullCleanupAwarded,
        },
        reputation: {
          overall: app.state.reputation?.overall,
          categories: { ...app.state.reputation?.categories },
          relevantHistory,
          relevantProcessedIds,
          propertyId,
        },
        visual: {
          'entry:leaves-trash': detail(named('entry:leaves-trash')),
          'corner:cobweb-nw': detail(named('corner:cobweb-nw')),
          'corner:cobweb-ne': detail(named('corner:cobweb-ne')),
          'wall:scuff-west': detail(named('wall:scuff-west')),
          'wall:scuff-east': detail(named('wall:scuff-east')),
          'lounge:pizza-box': matching(litter, 'PizzaBox|LoungeNapkin'),
          'lounge:empty-cups': matching(litter, 'EmptyCup'),
          'lounge:chair-crooked': detail(chair),
          'wall:fallen-frame': detail(frame),
          'desk:paper-stack': matching(desk, 'PaperStack_'),
          'desk:overflow-bin': detail(overflow),
          'desk:sticky-notes': matching(desk, 'DeskPhoneNote'),
          'ceiling:panel-02': panels['panel-02'],
          'ceiling:panel-07': panels['panel-07'],
        },
        input: {
          tool: app.scene3d.walk.getTool(),
          focus: app.scene3d.walk.getFocusLabel?.() || null,
          cleaning: app.scene3d.walk.cleaningDiagnostics?.() || null,
        },
        events: {
          cues: [...(window.__pineRestorationCueLog || [])],
          toasts: [...(window.__pineRestorationToastLog || [])],
          domToasts: [...(window.__pineRestorationToastDomLog || [])],
        },
        audio: {
          toolLoops: app.audio.toolLoopDiagnostics?.() || null,
          graph: app.audio.debugStats?.() || null,
        },
        renderer: {
          calls: app.scene3d.renderer.info.render.calls,
          triangles: app.scene3d.renderer.info.render.triangles,
          geometries: app.scene3d.renderer.info.memory.geometries,
          textures: app.scene3d.renderer.info.memory.textures,
        },
      };
    }, label);
  }

  async function screenshot(name, description, extra = null) {
    const file = path.join(shotsDir, `${name}.png`);
    await page.screenshot({ path: file });
    const context = await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      return {
        viewport: [innerWidth, innerHeight],
        fov: app.scene3d.camera.fov,
        localPlayer: [walk.state.x - origin.x, walk.state.z - origin.z]
          .map((value) => Number(value.toFixed(4))),
        yaw: Number(walk.state.yaw.toFixed(5)),
        pitch: Number(walk.state.pitch.toFixed(5)),
        tool: walk.getTool(),
        focus: walk.getFocusLabel?.() || null,
      };
    });
    captures.push({ file: relative(file), description, context, extra });
    return file;
  }

  async function waitForToasts() {
    await page.waitForFunction(() => (
      document.querySelectorAll('.toast, .notification').length === 0
    ), null, {
      timeout: 6500,
    }).catch(() => {});
    await page.waitForTimeout(100);
  }

  async function cycleTo(expected) {
    for (let press = 0; press < 14; press += 1) {
      const current = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
      if (current === expected) {
        controls.push({ control: 'F', expected, equipped: current, presses: press });
        return true;
      }
      await page.keyboard.press('f');
      await page.waitForTimeout(90);
    }
    const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
    controls.push({ control: 'F', expected, equipped, presses: 14 });
    return false;
  }

  async function holdTool(ms, targetId, screenshotName = null) {
    const viewport = page.viewportSize() || { width: 1600, height: 900 };
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.down({ button: 'left' });
    const evidenceDelay = Math.min(ms, 360);
    await page.waitForTimeout(evidenceDelay);
    const during = await stateSnapshot(`${targetId}:during`);
    if (screenshotName) {
      await screenshot(screenshotName, `${targetId} worked through held left mouse.`, {
        diagnostic: during.input.cleaning,
      });
    }
    if (ms > evidenceDelay) await page.waitForTimeout(ms - evidenceDelay);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(170);
    const after = await stateSnapshot(`${targetId}:after-hold`);
    controls.push({
      control: 'held LMB',
      tool: during.input.tool,
      targetId,
      durationMs: ms,
      result: during.input.cleaning?.result || null,
      audio: during.audio.toolLoops,
    });
    return { during, after };
  }

  async function contactCandidates(targetId, tool) {
    const pose = fixture.cleanupPoses[targetId];
    return page.evaluate(({ pose, tool }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const objectives = [{ x: pose.x, z: pose.z }];
      const offsetAngles = [
        0, Math.PI, Math.PI / 2, -Math.PI / 2,
        Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4,
      ];
      for (const offsetRadius of [0.32, 0.58]) {
        for (const angle of offsetAngles) {
          objectives.push({
            x: pose.x + Math.cos(angle) * offsetRadius,
            z: pose.z + Math.sin(angle) * offsetRadius,
          });
        }
      }
      const aimed = ['spray', 'cloth', 'sponge'].includes(tool);
      const radii = aimed ? [1.18, 1.38, 1.58] : [1.48, 1.32, 1.66, 1.16];
      const result = [];
      for (const objective of objectives) {
        for (const radius of radii) {
          for (let index = 0; index < 12; index += 1) {
            const angle = (index / 12) * Math.PI * 2;
            const x = objective.x + Math.cos(angle) * radius;
            const z = objective.z + Math.sin(angle) * radius;
            if (!clubhouse.isInside(origin.x + x, origin.z + z)) continue;
            if (!walk.isFree(origin.x + x, origin.z + z, 0.34)) continue;
            result.push({ x, z, targetX: objective.x, targetZ: objective.z });
          }
        }
      }
      return result;
    }, { pose, tool });
  }

  async function acquireToolTarget(targetId, tool) {
    const candidates = await contactCandidates(targetId, tool);
    const before = (await stateSnapshot(`${targetId}:acquire-before`))
      .restoration.targetProgress[targetId];
    let attempts = 0;
    for (const candidate of candidates.slice(0, 120)) {
      attempts += 1;
      await poseFacing(candidate.x, candidate.z, candidate.targetX, candidate.targetZ, 0.035);
      const used = await holdTool(150, targetId);
      const progress = used.after.restoration.targetProgress[targetId];
      const result = used.during.input.cleaning?.result;
      if (progress > before || result?.targetId === targetId) {
        return { candidate, progress, result, tested: attempts };
      }
    }
    return {
      candidate: null,
      progress: (await stateSnapshot(`${targetId}:acquire-failed`))
        .restoration.targetProgress[targetId],
      tested: Math.min(120, candidates.length),
    };
  }

  async function workToolTarget(targetId, tool, goal, key, options = {}) {
    phase = `tool:${targetId}:${tool}`;
    const routeBefore = await stateSnapshot(`${targetId}:before`);
    if (!options.forceContact
      && routeBefore.restoration.targetProgress[targetId] + 0.0005 >= goal) {
      requireCheck(`${targetId} was completed by the preceding adjacent ${tool} contact`, true, {
        progress: routeBefore.restoration.targetProgress[targetId],
      });
      await screenshot(`${key}-${targetId.replaceAll(':', '-')}-${tool}-feedback`,
        `${targetId} already completed by the preceding adjacent production contact.`, {
          progress: routeBefore.restoration.targetProgress[targetId],
        });
      targetRoutes[targetId] ||= { stages: [] };
      targetRoutes[targetId].stages.push({
        tool,
        goal,
        beforeProgress: routeBefore.restoration.targetProgress[targetId],
        afterProgress: routeBefore.restoration.targetProgress[targetId],
        adjacentContact: true,
        acquired: null,
        passes: 0,
        cues: [],
        toasts: [],
      });
      return routeBefore;
    }
    requireCheck(`${targetId} equips ${tool} through F`, await cycleTo(tool), { tool });
    const acquired = await acquireToolTarget(targetId, tool);
    requireCheck(`${targetId} is reached by the ${tool} contact`, !!acquired.candidate, acquired);
    const activeScreenshot = `${key}-${targetId.replaceAll(':', '-')}-${tool}-active`;
    let current = acquired.progress;
    let passes = 0;
    // The overflowing desk bin is the longest bagging target: its production
    // rate needs slightly more than twelve 620 ms holds from a fresh state.
    // Keep a bounded guard, but allow enough normal held input to cross the
    // completion edge instead of treating 90% progress as a gameplay failure.
    while (current + 0.0005 < goal && passes < 18) {
      const used = await holdTool(620, targetId, passes === 0 ? activeScreenshot : null);
      current = used.after.restoration.targetProgress[targetId];
      passes += 1;
      if (used.during.input.cleaning?.result?.reason === 'bag-full') break;
    }
    const completed = await stateSnapshot(`${targetId}:completed-${tool}`);
    requireCheck(`${targetId} reaches ${goal} through ${tool}`,
      completed.restoration.targetProgress[targetId] + 0.0005 >= goal,
      { acquired, passes, progress: completed.restoration.targetProgress[targetId] });
    await screenshot(`${key}-${targetId.replaceAll(':', '-')}-${tool}-feedback`,
      `${targetId} production progress feedback and changed world state.`, {
        progress: completed.restoration.targetProgress[targetId],
      });
    targetRoutes[targetId] ||= { stages: [] };
    targetRoutes[targetId].stages.push({
      tool,
      goal,
      beforeProgress: routeBefore.restoration.targetProgress[targetId],
      afterProgress: completed.restoration.targetProgress[targetId],
      acquired,
      passes,
      cues: completed.events.cues.slice(routeBefore.events.cues.length),
      toasts: completed.events.toasts.slice(routeBefore.events.toasts.length),
    });
    return completed;
  }

  async function candidateApproaches(targetX, targetZ, radii = [0.84, 1.02, 1.20, 1.36]) {
    return page.evaluate(({ targetX, targetZ, radii }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      const result = [];
      for (const radius of radii) {
        for (let index = 0; index < 20; index += 1) {
          const angle = (index / 20) * Math.PI * 2;
          const x = targetX + Math.cos(angle) * radius;
          const z = targetZ + Math.sin(angle) * radius;
          if (walk.isFree(origin.x + x, origin.z + z, 0.34)) result.push({ x, z });
        }
      }
      return result;
    }, { targetX, targetZ, radii });
  }

  async function findInteraction(targetX, targetZ, targetY, needle, radii) {
    const candidates = await candidateApproaches(targetX, targetZ, radii);
    for (const candidate of candidates) {
      await poseFacing(candidate.x, candidate.z, targetX, targetZ, targetY);
      const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
      if (label.toLowerCase().includes(needle.toLowerCase())) return { ...candidate, label };
    }
    return {
      candidateCount: candidates.length,
      label: await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || ''),
    };
  }

  async function pressTargetInteraction(targetId, spec, key) {
    phase = `interaction:${targetId}`;
    requireCheck(`${targetId} stows cleaning tools before E`, await cycleTo(null));
    await waitForToasts();
    const before = await stateSnapshot(`${targetId}:before-E`);
    const focus = await findInteraction(
      spec.x, spec.z, spec.targetY ?? 1.0, spec.needle, spec.radii,
    );
    requireCheck(`${targetId} exposes its production E prompt`,
      String(focus.label || '').toLowerCase().includes(spec.needle.toLowerCase()), focus);
    await screenshot(`${key}-${targetId.replaceAll(':', '-')}-before`,
      `${targetId} before the normal E interaction.`, { focus });
    await page.keyboard.press('e');
    controls.push({ control: 'E', targetId, label: focus.label });
    await page.waitForTimeout(spec.waitMs || 620);
    const after = await stateSnapshot(`${targetId}:after-E`);
    requireCheck(`${targetId} completes through E`,
      after.restoration.targetProgress[targetId] >= 1,
      { before: before.restoration.targetProgress[targetId], after: after.restoration.targetProgress[targetId] });
    await screenshot(`${key}-${targetId.replaceAll(':', '-')}-feedback`,
      `${targetId} after normal E with semantic player feedback.`, {
        cues: after.events.cues.slice(before.events.cues.length),
        toasts: after.events.toasts.slice(before.events.toasts.length),
      });
    await waitForToasts();
    await screenshot(`${key}-${targetId.replaceAll(':', '-')}-after`,
      `${targetId} retained changed visual state after feedback clears.`);
    targetRoutes[targetId] = {
      control: 'E',
      focus,
      beforeProgress: before.restoration.targetProgress[targetId],
      afterProgress: after.restoration.targetProgress[targetId],
      cues: after.events.cues.slice(before.events.cues.length),
      toasts: after.events.toasts.slice(before.events.toasts.length),
      beforeVisual: before.visual[targetId],
      afterVisual: after.visual[targetId],
    };
    return after;
  }

  async function openPauseMenu() {
    if (await page.evaluate(() => !!document.pointerLockElement)) {
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await page.locator('.pause-veil-ui').count()) return true;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(220);
    }
    await page.waitForSelector('.pause-veil-ui', { timeout: 5000 });
    return true;
  }

  async function saveSlotOne() {
    await openPauseMenu();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    const button = page.getByRole('button', { name: 'Save here', exact: true }).first();
    await button.waitFor({ state: 'visible' });
    await button.click();
    await page.waitForTimeout(500);
    controls.push({ control: 'Escape > Save game > Save here', ok: true });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForTimeout(350);
  }

  async function loadSlotOne() {
    await openPauseMenu();
    await page.getByRole('button', { name: 'Load game', exact: true }).click();
    const button = page.getByRole('button', { name: 'Load', exact: true }).first();
    await button.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const candidate = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.trim() === 'Load');
      return !!candidate && !candidate.disabled;
    }, null, { timeout: 6000 });
    await page.evaluate(() => { window.__pinePriorScene = window.__fw.scene3d; });
    await button.click();
    const confirmLoad = page.locator('.modal')
      .getByRole('button', { name: 'Load game', exact: true });
    await confirmLoad.waitFor({ state: 'visible' });
    await confirmLoad.click();
    await page.waitForFunction(() => window.__fw?.scene3d
      && window.__fw.scene3d !== window.__pinePriorScene
      && window.__fw.scene3d.clubhouse?.(), null, { timeout: 90000 });
    await waitForGame();
    fixture = await prepareWorld();
    // Normal loads intentionally return the player to the clubhouse porch.
    // Re-enter the documented fixed interior QA pose before cycling indoor
    // tools; persistence assertions concern the saved restoration state.
    await fixedOverview();
    await installObservers();
    controls.push({ control: 'Escape > Load game > Load > Load game confirmation', ok: true });
  }

  async function samplePanel(panelId, count = 18, intervalMs = 90) {
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      rows.push(await page.evaluate((panelId) => {
        const scene = window.__fw.scene3d.scene;
        const light = scene.getObjectByName(`CeilingPanelLight_${panelId}`);
        const face = scene.getObjectByName(`CeilingPanelFace_${panelId}`);
        return {
          state: window.__fw.state.shop.reno.lightPanels?.[panelId] || null,
          lightVisible: light?.visible === true,
          lightIntensity: Number((light?.intensity || 0).toFixed(6)),
          faceEmissiveIntensity: Number((face?.material?.emissiveIntensity || 0).toFixed(6)),
          faceEmissive: face?.material?.emissive?.getHexString?.() || null,
        };
      }, panelId));
      await page.waitForTimeout(intervalMs);
    }
    return rows;
  }

  function visibleCount(value) {
    if (Array.isArray(value)) return value.filter((entry) => entry?.effectiveVisible).length;
    return value?.effectiveVisible ? 1 : 0;
  }

  function visualChanged(targetId, before, after) {
    if (targetId === 'lounge:chair-crooked') {
      return !!before && !!after && Math.abs(before.rotation[1] - after.rotation[1]) > 0.1;
    }
    if (targetId === 'wall:fallen-frame') {
      return !!before && !!after
        && Math.hypot(...before.position.map((value, index) => value - after.position[index])) > 0.5;
    }
    if (targetId.startsWith('ceiling:')) {
      return !!before?.light && !!after?.light
        && (before.faultState !== after.faultState
          || before.light.intensity !== after.light.intensity
          || before.light.visible !== after.light.visible
          || before.face?.emissive !== after.face?.emissive);
    }
    return visibleCount(before) > 0 && visibleCount(after) === 0;
  }

  try {
    phase = 'navigate';
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const continueButton = page.getByText('Continue', { exact: true }).first();
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    requireCheck('bootstrap autosave exposes Continue', await continueButton.isVisible());
    await continueButton.click();
    controls.push({ control: 'Continue', ok: true });
    await waitForGame();
    browserReady = true;

    phase = 'deterministic-fixture';
    fixture = await prepareWorld();
    const observerStatus = await installObservers({ reset: true });
    requireCheck('first-person Pine Hills runtime and all interior assets are ready',
      fixture.playerActive
        && fixture.pineDiagnostics?.failed === 0
        && fixture.pineDiagnostics?.loaded === fixture.pineDiagnostics?.expected,
      fixture);
    requireCheck('inherited clubhouse repair kit is available without QA injection',
      fixture.repairKitCount > 0, fixture.repairKitCount);
    requireCheck('all semantic restoration cue APIs are callable',
      Object.values(observerStatus.cues).every((type) => type === 'function')
        && observerStatus.toastHook === 'function', observerStatus);

    // One normal belt gesture initializes WebAudio before recording begins.
    await page.keyboard.press('f');
    await page.waitForTimeout(120);
    await cycleTo(null);
    await page.waitForFunction(() => window.__fw.audio.ready, null, { timeout: 5000 });
    captureStarted = await page.evaluate(async () => {
      const audio = window.__fw.audio;
      audio.setMuted(false);
      audio.setVolume(0.8);
      return audio.startCapture(document.getElementById('game'), {
        fps: 30,
        videoBitsPerSecond: 4_000_000,
        audioBitsPerSecond: 128_000,
      });
    });
    requireCheck('gameplay recording starts with canvas video and live WebAudio',
      captureStarted.videoTracks > 0
        && captureStarted.audioTracks > 0
        && captureStarted.audioContextState === 'running', captureStarted);

    baseline = await stateSnapshot('fresh-baseline');
    const allTargetIds = Object.keys(baseline.restoration.targetProgress);
    requireCheck('fresh bootstrap starts every discrete restoration target unfinished',
      allTargetIds.every((targetId) => baseline.restoration.targetProgress[targetId] === 0),
      baseline.restoration);
    requireCheck('fresh bootstrap starts panel-02 flickering and panel-07 dead',
      baseline.restoration.lightPanels['panel-02'] === 'flicker'
        && baseline.restoration.lightPanels['panel-07'] === 'dead',
      baseline.restoration.lightPanels);
    await fixedOverview();
    await screenshot('00-fresh-clubhouse-overview',
      'Fixed player-camera baseline with every discrete target unfinished.');
    await poseFacing(-3.35, 2.05,
      fixture.panels['panel-02'].x, fixture.panels['panel-02'].z, fixture.ceilingY);
    await screenshot('01-broken-ceiling-panels',
      'Fixed upward player view showing the flickering and dead production panels.');
    const panel02BeforeSamples = await samplePanel('panel-02');
    const panel07BeforeSamples = await samplePanel('panel-07', 5, 80);

    // First half of the route: every mutation comes from an actual held tool.
    await workToolTarget('corner:cobweb-nw', 'vacuum', 1, '04');
    await workToolTarget('entry:leaves-trash', 'broom', 0.62, '02');
    await workToolTarget('entry:leaves-trash', 'trashbag', 1, '03');
    await workToolTarget('wall:scuff-west', 'spray', 0.28, '05');

    phase = 'mid-restoration-save';
    const beforeSave = await stateSnapshot('mid-restoration-before-save');
    await screenshot('06-mid-restoration-before-save',
      'Partial west scuff plus completed entry and northwest cobweb before pause-menu save.');
    await saveSlotOne();
    const saved = await stateSnapshot('mid-restoration-saved');
    // Surface solution is intentionally transient and may dry while the pause
    // UI is open. Reapply it through the real spray tool before wiping.
    await workToolTarget('wall:scuff-west', 'spray', 0.28, '07a', { forceContact: true });
    await holdTool(620, 'wall:scuff-west');
    await workToolTarget('wall:scuff-west', 'cloth', 0.65, '07');
    const postSaveMutation = await stateSnapshot('post-save-normal-control-mutation');
    requireCheck('post-save cloth mutation advances the west scuff through normal controls',
      postSaveMutation.restoration.targetProgress['wall:scuff-west'] >= 0.65
        && postSaveMutation.restoration.targetProgress['wall:scuff-west'] <= 1
        && postSaveMutation.restoration.targetProgress['wall:scuff-west']
          > saved.restoration.targetProgress['wall:scuff-west'],
      { saved: saved.restoration, mutated: postSaveMutation.restoration });
    phase = 'mid-restoration-load';
    await loadSlotOne();
    const loaded = await stateSnapshot('mid-restoration-loaded');
    persistence = { beforeSave, saved, postSaveMutation, loaded };
    requireCheck('pause-menu load restores exact partial target progress',
      loaded.restoration.targetProgress['entry:leaves-trash'] === 1
        && loaded.restoration.targetProgress['corner:cobweb-nw'] === 1
        && loaded.restoration.targetProgress['wall:scuff-west'] === saved.restoration.targetProgress['wall:scuff-west']
        && loaded.restoration.targetProgress['wall:scuff-west'] < 1,
      persistence);
    requireCheck('pause-menu load rolls back post-save target rewards exactly',
      loaded.reputation.relevantHistory.length === saved.reputation.relevantHistory.length
        && JSON.stringify(loaded.reputation.relevantProcessedIds)
          === JSON.stringify(saved.reputation.relevantProcessedIds),
      { saved: saved.reputation, loaded: loaded.reputation });
    await screenshot('08-mid-restoration-after-load',
      'Pause-menu load restores the visibly partial west scuff and completed earlier work.');

    // Finish all tool-owned target classes after the production reload.
    await workToolTarget('wall:scuff-west', 'spray', 0.28, '09a', { forceContact: true });
    await holdTool(620, 'wall:scuff-west');
    await workToolTarget('wall:scuff-west', 'cloth', 1, '09');
    await workToolTarget('corner:cobweb-ne', 'vacuum', 1, '10');
    await workToolTarget('wall:scuff-east', 'spray', 0.28, '11');
    await workToolTarget('wall:scuff-east', 'spray', 0.28, '11b', { forceContact: true });
    await holdTool(620, 'wall:scuff-east');
    await workToolTarget('wall:scuff-east', 'sponge', 1, '12');
    await workToolTarget('lounge:pizza-box', 'trashbag', 1, '13');
    await workToolTarget('lounge:empty-cups', 'trashbag', 1, '14');
    await workToolTarget('desk:overflow-bin', 'trashbag', 1, '15');

    const interactionSpecs = {
      'lounge:chair-crooked': {
        ...fixture.cleanupPoses['lounge:chair-crooked'], needle: 'straighten chair', targetY: 1.0,
      },
      'wall:fallen-frame': {
        ...fixture.cleanupPoses['wall:fallen-frame'], needle: 'rehang frame', targetY: 1.0,
      },
      'desk:paper-stack': {
        ...fixture.cleanupPoses['desk:paper-stack'], needle: 'organize papers', targetY: 1.0,
      },
      'desk:sticky-notes': {
        ...fixture.cleanupPoses['desk:sticky-notes'], needle: 'clear sticky notes', targetY: 1.0,
      },
    };
    let interactionIndex = 16;
    for (const [targetId, spec] of Object.entries(interactionSpecs)) {
      await pressTargetInteraction(targetId, spec, String(interactionIndex).padStart(2, '0'));
      interactionIndex += 1;
    }

    // The failed panels use their actual ceiling interaction and inherited kit.
    const beforeLightRepairs = await stateSnapshot('before-light-repairs');
    await pressTargetInteraction('ceiling:panel-02', {
      ...fixture.panels['panel-02'],
      needle: 'panel-02',
      targetY: fixture.ceilingY,
      radii: [0.88, 1.08, 1.28, 1.42],
      waitMs: 700,
    }, '20');
    const panel02AfterSamples = await samplePanel('panel-02');
    await pressTargetInteraction('ceiling:panel-07', {
      ...fixture.panels['panel-07'],
      needle: 'panel-07',
      targetY: fixture.ceilingY,
      radii: [0.88, 1.08, 1.28, 1.42],
      waitMs: 700,
    }, '21');
    const panel07AfterSamples = await samplePanel('panel-07', 8, 80);
    const afterLightRepairs = await stateSnapshot('after-light-repairs');
    lightEvidence = {
      before: beforeLightRepairs,
      after: afterLightRepairs,
      samples: {
        panel02Before: panel02BeforeSamples,
        panel02After: panel02AfterSamples,
        panel07Before: panel07BeforeSamples,
        panel07After: panel07AfterSamples,
      },
    };

    const range = (rows, key) => {
      const values = rows.map((row) => row[key]);
      return Math.max(...values) - Math.min(...values);
    };
    requireCheck('panel-02 changes from a variable flicker to stable working output',
      panel02BeforeSamples.every((row) => row.state === 'flicker')
        && range(panel02BeforeSamples, 'lightIntensity') > 0.01
        && panel02AfterSamples.every((row) => row.state === 'working'
          && row.lightVisible && row.lightIntensity > 0)
        && range(panel02AfterSamples, 'lightIntensity') < 0.0001,
      lightEvidence.samples);
    requireCheck('panel-07 changes from physically dead to lit working output',
      panel07BeforeSamples.every((row) => row.state === 'dead'
        && !row.lightVisible && row.lightIntensity === 0)
        && panel07AfterSamples.every((row) => row.state === 'working'
          && row.lightVisible && row.lightIntensity > 0),
      lightEvidence.samples);

    await cycleTo(null);
    await waitForToasts();
    await fixedOverview();
    await screenshot('22-final-restored-clubhouse-overview',
      'Fixed final player camera after every discrete target and both light repairs.');
    await poseFacing(-3.35, 2.05,
      fixture.panels['panel-02'].x, fixture.panels['panel-02'].z, fixture.ceilingY);
    await screenshot('23-final-working-ceiling-panels',
      'Fixed upward player view with panel-02 and panel-07 working steadily.');
    finalSnapshot = await stateSnapshot('final');

    const cleanupIds = Object.keys(finalSnapshot.restoration.targetProgress)
      .filter((targetId) => !targetId.startsWith('ceiling:'));
    requireCheck('all twelve discrete cleanup targets complete through production controls',
      cleanupIds.length === 12
        && cleanupIds.every((targetId) => finalSnapshot.restoration.targetProgress[targetId] === 1),
      finalSnapshot.restoration.targetProgress);
    requireCheck('both production light targets and panel states are repaired',
      finalSnapshot.restoration.targetProgress['ceiling:panel-02'] === 1
        && finalSnapshot.restoration.targetProgress['ceiling:panel-07'] === 1
        && finalSnapshot.restoration.lightPanels['panel-02'] === 'working'
        && finalSnapshot.restoration.lightPanels['panel-07'] === 'working',
      finalSnapshot.restoration);

    const visualChecks = Object.fromEntries(Object.keys(finalSnapshot.restoration.targetProgress)
      .map((targetId) => [targetId, visualChanged(
        targetId, baseline.visual[targetId], finalSnapshot.visual[targetId],
      )]));
    requireCheck('every discrete target class has an observable player-world visual change',
      Object.values(visualChecks).every(Boolean), {
        visualChecks,
        before: baseline.visual,
        after: finalSnapshot.visual,
      });

    const expectedSourceIds = [
      ...cleanupIds,
      'ceiling:panel-02:cleanliness', 'ceiling:panel-02:service',
      'ceiling:panel-07:cleanliness', 'ceiling:panel-07:service',
    ];
    const historyCounts = Object.fromEntries(expectedSourceIds.map((sourceId) => [
      sourceId,
      finalSnapshot.reputation.relevantHistory.filter((entry) => entry.sourceId === sourceId).length,
    ]));
    requireCheck('every restoration reputation award posts exactly once',
      finalSnapshot.reputation.relevantHistory.length === 16
        && finalSnapshot.reputation.relevantProcessedIds.length === 16
        && Object.values(historyCounts).every((count) => count === 1),
      { historyCounts, reputation: finalSnapshot.reputation });
    requireCheck('exact target scoring totals are +2.8 cleanliness and +1.0 service',
      round(finalSnapshot.reputation.categories.cleanliness
        - baseline.reputation.categories.cleanliness, 1) === 2.8
        && round(finalSnapshot.reputation.categories.service
          - baseline.reputation.categories.service, 1) === 1.0,
      { before: baseline.reputation.categories, after: finalSnapshot.reputation.categories });

    const expectedToolLoops = ['broom', 'vacuum', 'trashbag', 'spray', 'cloth', 'sponge'];
    requireCheck('every restoration tool exposes its live work-loop audio diagnostic',
      expectedToolLoops.every((tool) => controls.some((entry) => (
        entry.control === 'held LMB' && entry.tool === tool && entry.audio?.active === tool
      ))), { expectedToolLoops, heldControls: controls.filter((entry) => entry.control === 'held LMB') });
    requireCheck('final tool stow releases all held input and loop audio',
      finalSnapshot.input.tool === null && finalSnapshot.audio.toolLoops?.active === null,
      { input: finalSnapshot.input, audio: finalSnapshot.audio });

    const cueCounts = finalSnapshot.events.cues.reduce((counts, entry) => ({
      ...counts,
      [entry.cue]: (counts[entry.cue] || 0) + 1,
    }), {});
    requireCheck('semantic cleanup and light-repair audio cues fire once per completed target',
      cueCounts['clubhouse-cleanup-complete'] === 12
        && cueCounts['clubhouse-light-repaired'] === 2,
      { cueCounts, cues: finalSnapshot.events.cues });
    const expectedToastFragments = [
      'Entry leaves and trash cleared',
      'Northwest cobweb vacuumed', 'Northeast cobweb vacuumed',
      'West wall scuff cleaned', 'East wall scuff cleaned',
      'Pizza box cleared', 'Empty cups cleared', 'Lounge chair straightened',
      'Fallen picture rehung', 'Desk papers organized', 'Overflowing bin emptied',
      'Monitor sticky notes cleared',
      'Flickering ceiling light repaired', 'Dead ceiling light repaired',
    ];
    requireCheck('semantic player toasts identify every cleanup and light repair',
      expectedToastFragments.every((fragment) => finalSnapshot.events.toasts
        .some((entry) => entry.text.includes(fragment))),
      { expectedToastFragments, toasts: finalSnapshot.events.toasts });
  } catch (error) {
    blockers.push(serializeError(error));
    if (browserReady) {
      await screenshot('99-acceptance-blocker', 'Strongest inspectable state at the acceptance blocker.', {
        blocker: blockers.at(-1),
      }).catch(() => {});
      finalSnapshot = await stateSnapshot('blocked-final').catch(() => finalSnapshot);
    }
  } finally {
    await page.keyboard.up('e').catch(() => {});
    await page.mouse.up({ button: 'left' }).catch(() => {});
    if (browserReady) {
      const active = await page.evaluate(() => window.__fw?.audio?.captureActive === true).catch(() => false);
      if (active) {
        try {
          const downloadName = path.basename(videoFile);
          const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
          const stopPromise = page.evaluate((name) => (
            window.__fw.audio.stopCapture({ downloadName: name })
          ), downloadName);
          const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
          const failure = await download.failure();
          if (failure) throw new Error(`Gameplay video download failed: ${failure}`);
          await download.saveAs(videoFile);
          mediaCapture = {
            output: relative(videoFile),
            bytesOnDisk: fs.statSync(videoFile).size,
            ...captureStarted,
            ...stopped,
          };
        } catch (error) {
          blockers.push(serializeError(error));
        }
      }
    }
  }

  check('recorded normal-control route retains video with non-silent player audio',
    !!mediaCapture
      && mediaCapture.bytesOnDisk > 100_000
      && mediaCapture.audioPeak > 0.0001
      && mediaCapture.nonSilentAudioWindows > 0,
    mediaCapture);
  const allowedPcfDeprecation = (entry) => entry.kind === 'console:warning'
    && /THREE\.WebGLShadowMap: PCFSoftShadowMap has been deprecated/i.test(entry.message);
  const blockingDiagnostics = diagnostics.filter((entry) => (
    entry.kind === 'console:error'
    || entry.kind === 'pageerror'
    || entry.kind === 'response:error'
    || (entry.kind === 'requestfailed' && !/ERR_ABORTED/i.test(entry.message))
    || (entry.kind === 'console:warning'
      && !allowedPcfDeprecation(entry)
      && /(?:WebGL|GL_INVALID_|texSubImage2D|texStorage2D|generateMipmap)/i.test(entry.message))
  ));
  check('browser route has no console errors, page errors, or unexpected request failures',
    blockingDiagnostics.length === 0, { blocking: blockingDiagnostics, all: diagnostics });

  const failedChecks = checks.filter((entry) => !entry.ok);
  const result = {
    ok: blockers.length === 0 && failedChecks.length === 0,
    status: blockers.length ? 'blocked' : (failedChecks.length ? 'failed' : 'passed'),
    capturedAt: new Date().toISOString(),
    launch: [
      `$env:PINE_HILLS_RESTORATION_OUT='${relative(out)}'`,
      `$env:VIDEO_DIR='${relative(videoDir)}'`,
      `$env:QA_RESULT_PATH='${relative(resultPath)}'`,
      'node tools/qa/run-playwright.cjs tools/qa/pine-hills-restoration-lights-acceptance.js --bootstrap',
    ].join('; '),
    methodology: {
      viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
      camera: '66-degree FOV; fixed 14:00 lighting; captures retain exact local pose/yaw/pitch.',
      fixtureBoundary: [
        'Fresh relaxed seed 424242 and first campaign property are created only by --bootstrap.',
        'NPCs are frozen, time is fixed at 14:00, and the documented cleaning acceptance grants one vacuum without touching progress.',
        'Target locations come from the live Pine Hills and shop-layout exports; walk-free player poses are deterministic.',
        'No restorationAction, target-progress mutation, light-panel mutation, or direct reputation mutation is used.',
      ],
      normalControls: [
        'F selects/stows broom, vacuum, trash bag, spray, cloth, and sponge.',
        'Held LMB works the actual viewmodel contact/nozzle through the production cleaning gate.',
        'E owns the four direct cleanup interactions and both repair-kit ceiling interactions.',
        'Escape > Save game > Save here and Escape > Load game > Load prove partial-state persistence.',
      ],
      exactOnce: 'Every expected clubhouse-restoration sourceId, processed ID, category delta, semantic cue, and save rollback is counted.',
    },
    fixture,
    checks,
    failedChecks,
    blockers,
    controls,
    targetRoutes,
    persistence,
    lightEvidence,
    baseline,
    finalSnapshot,
    mediaCapture,
    captures,
    diagnostics: { entries: diagnostics, blocking: blockingDiagnostics },
    resultPath: relative(resultPath),
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
