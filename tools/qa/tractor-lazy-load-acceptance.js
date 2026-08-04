// Cold-context browser acceptance for the restored-tractor lazy-load boundary.
//
// Run with the normal repository server on http://localhost:8457:
//   $env:HEADED='1'
//   $env:QA_RESULT_PATH='qa/steam-performance-master-pass/assets/tractor-lazy-load-acceptance/report.json'
//   node tools/qa/run-playwright.cjs tools/qa/tractor-lazy-load-acceptance.js --bootstrap
//
// The runner's bootstrapped save is read but never changed. Each case installs a
// deterministic derivative in its own cold BrowserContext, follows normal Continue,
// and closes that context before the next case so HTTP cache and localStorage cannot
// make the repaired load look eager (or the unrepaired load look deferred).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const artifactRoot = 'qa/steam-performance-master-pass/assets/tractor-lazy-load-acceptance';
  const outDir = path.join(repo, artifactRoot);
  const sampleMs = Math.max(1800, Number(process.env.TRACTOR_QA_SAMPLE_MS) || 3000);
  fs.mkdirSync(outDir, { recursive: true });

  const assets = [
    { key: 'restored', file: 'vendor/models/tractor_red.glb' },
    { key: 'restoredFallback', file: 'vendor/models/tractor.glb', optional: true },
    { key: 'mower', file: 'vendor/models/mower_deck.glb' },
    { key: 'broken', file: 'vendor/models/tractor_broken.glb' },
  ];
  const readGlbDescriptor = (entry) => {
    const filePath = path.join(repo, ...entry.file.split('/'));
    if (!fs.existsSync(filePath)) {
      if (entry.optional) return { ...entry, byteLength: null, missing: true };
      throw new Error(`Required tractor QA asset is missing: ${entry.file}`);
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(16) !== 0x4e4f534a) {
      throw new Error(`Expected a binary glTF with a leading JSON chunk: ${entry.file}`);
    }
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).replace(/\0/g, '').trim());
    let triangles = 0;
    for (const mesh of document.meshes || []) {
      for (const primitive of mesh.primitives || []) {
        if (primitive.indices == null || (primitive.mode != null && primitive.mode !== 4)) continue;
        triangles += Math.floor((document.accessors?.[primitive.indices]?.count || 0) / 3);
      }
    }
    const names = (collection) => [...new Set((collection || []).map((item) => item?.name).filter(Boolean))];
    return {
      ...entry,
      byteLength: bytes.length,
      triangles,
      nodeNames: names(document.nodes),
      meshNames: names(document.meshes),
      materialNames: names(document.materials),
      imageNames: names(document.images),
    };
  };
  const descriptors = assets.map(readGlbDescriptor);
  const targetFiles = new Set(descriptors.map((entry) => entry.file));
  const hash = (value) => crypto.createHash('sha256').update(value || '').digest('hex');
  const relativeArtifact = (name) => `${artifactRoot}/${name}`;

  const runnerAutosaveBefore = await page.evaluate(() => localStorage.getItem('golfempire:autosave'));
  if (!runnerAutosaveBefore) throw new Error('Run this acceptance harness with --bootstrap.');
  const fixtures = await page.evaluate(async () => {
    const empireModule = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const source = localStorage.getItem('golfempire:autosave');
    const build = (repaired) => {
      const empire = empireModule.deserializeEmpire(JSON.parse(source));
      const state = empireModule.activeState(empire);
      if (!state) throw new Error('Tractor QA bootstrap has no active property state.');
      state.tutorial.complete = true;
      state.tutorial.hidden = true;
      state.tractor = {
        steps: { cleared: repaired, fuel: repaired, belt: repaired },
        repaired,
      };
      state.weather.locked = true;
      state.weather.today = {
        tempHiF: 74,
        tempLoF: 55,
        rainIn: 0,
        humidity: 0.4,
        windMph: 6,
      };
      state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
      empire.clockMinutes = state.clock.minutes;
      return {
        serialized: JSON.stringify(empireModule.empireSnapshot(empire)),
        fingerprint: {
          clubName: state.clubName,
          seed: state.seed,
          repaired: state.tractor.repaired,
          steps: { ...state.tractor.steps },
          clockMinutes: state.clock.minutes,
        },
      };
    };
    return { unrepaired: build(false), repaired: build(true) };
  });

  const browser = page.context().browser();
  if (!browser) throw new Error('The tractor QA harness requires a Playwright-owned browser.');
  let contextsCreated = 0;
  let contextsClosed = 0;

  const runCase = async (name, fixture) => {
    contextsCreated += 1;
    const context = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
    });
    const diagnostics = {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
      harnessErrors: [],
    };
    const requestLog = [];
    let phase = 'context-init';
    let qaPage = null;
    try {
      await context.addInitScript(({ autosave }) => {
        if (location.origin !== 'http://localhost:8457') return;
        localStorage.setItem('golfempire:autosave', autosave);
        localStorage.setItem('gc-settings', JSON.stringify({
          renderScale: 1,
          ao: true,
          bloom: true,
          fov: 60,
          sens: 1,
        }));
      }, { autosave: fixture.serialized });
      qaPage = await context.newPage();
      qaPage.on('console', (message) => {
        const record = { phase, text: message.text() };
        if (message.type() === 'error') diagnostics.consoleErrors.push(record);
        else if (message.type() === 'warning') diagnostics.consoleWarnings.push(record);
      });
      qaPage.on('pageerror', (error) => diagnostics.pageErrors.push({ phase, text: error.message }));
      qaPage.on('request', (request) => {
        const requestPath = new URL(request.url()).pathname.replace(/^\/+/, '');
        if (targetFiles.has(requestPath)) requestLog.push({ phase, file: requestPath, method: request.method() });
      });
      qaPage.on('requestfailed', (request) => diagnostics.requestFailures.push({
        phase,
        url: request.url(),
        errorText: request.failure()?.errorText || 'unknown',
      }));

      const cdp = await context.newCDPSession(qaPage);
      await cdp.send('Performance.enable');
      await cdp.send('HeapProfiler.enable');
      const browserSnapshot = async (label) => {
        await cdp.send('HeapProfiler.collectGarbage');
        const [dom, perf, heap] = await Promise.all([
          cdp.send('Memory.getDOMCounters'),
          cdp.send('Performance.getMetrics'),
          cdp.send('Runtime.getHeapUsage'),
        ]);
        const metrics = Object.fromEntries(perf.metrics.map(({ name: key, value }) => [key, value]));
        return {
          label,
          documents: dom.documents,
          domNodes: dom.nodes,
          jsEventListeners: dom.jsEventListeners,
          performanceHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
          performanceHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
          runtimeHeapUsedBytes: heap.usedSize,
          runtimeHeapTotalBytes: heap.totalSize,
        };
      };

      phase = 'menu-load';
      await qaPage.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      const continueButton = qaPage.getByRole('button', { name: 'Continue', exact: true });
      await continueButton.waitFor({ state: 'visible', timeout: 20000 });
      await continueButton.click();
      phase = 'game-bootstrap';
      await qaPage.waitForFunction(() => (
        window.__fw?.screen === 'game'
          && window.__fw?.scene3d?.walk?.state
          && window.__fw?.state?.tractor
      ), null, { timeout: 90000 });
      await qaPage.waitForFunction(() => {
        const veil = document.querySelector('.load-veil');
        if (window.__fw?.prewarming === true) return false;
        if (!veil) return true;
        const style = getComputedStyle(veil);
        return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
      }, null, { timeout: 90000 });
      await qaPage.evaluate(async () => {
        const barrier = window.__fw.scene3d.assetBarrier?.(120000);
        if (barrier?.promise) await barrier.promise;
        window.__fw.speedIdx = 0;
        window.__fw.scene3d.walk.clearKeys?.();
        window.__fw.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
      });
      await qaPage.waitForTimeout(600);

      await qaPage.evaluate((assetDescriptors) => {
        const descriptorByKey = Object.fromEntries(assetDescriptors.map((entry) => [entry.key, entry]));
        const app = () => window.__fw;
        const materialsOf = (object) => (Array.isArray(object.material) ? object.material : [object.material])
          .filter(Boolean);
        const namesMatch = (descriptor, object) => {
          if (!descriptor || descriptor.missing) return false;
          if (descriptor.nodeNames.includes(object.name) || descriptor.meshNames.includes(object.name)) return true;
          for (const material of materialsOf(object)) {
            if (descriptor.materialNames.includes(material.name)) return true;
            for (const value of Object.values(material)) {
              if (!value?.isTexture) continue;
              const names = [value.name, value.image?.name, value.source?.data?.name].filter(Boolean);
              if (names.some((valueName) => descriptor.imageNames.includes(valueName))) return true;
            }
          }
          return false;
        };
        const isEffectivelyVisible = (object) => {
          for (let current = object; current; current = current.parent) if (!current.visible) return false;
          return true;
        };
        const assetSnapshot = (key) => {
          const descriptor = descriptorByKey[key];
          const scene = app().scene3d.scene;
          scene.updateMatrixWorld(true);
          const matches = [];
          const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
          scene.traverse((object) => {
            if (!object.isMesh || !namesMatch(descriptor, object)) return;
            object.geometry.computeBoundingBox();
            const worldBounds = object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
            if (!worldBounds) return;
            for (let axis = 0; axis < 3; axis += 1) {
              const axisName = ['x', 'y', 'z'][axis];
              bounds.min[axis] = Math.min(bounds.min[axis], worldBounds.min[axisName]);
              bounds.max[axis] = Math.max(bounds.max[axis], worldBounds.max[axisName]);
            }
            matches.push({
              uuid: object.uuid,
              name: object.name || null,
              ancestors: (() => {
                const ancestors = [];
                for (let current = object.parent; current && ancestors.length < 8; current = current.parent) {
                  ancestors.push({
                    uuid: current.uuid,
                    name: current.name || null,
                    type: current.type || null,
                  });
                }
                return ancestors;
              })(),
              materialNames: materialsOf(object).map((material) => material.name || null),
              effectivelyVisible: isEffectivelyVisible(object),
              triangles: object.geometry.index
                ? Math.floor(object.geometry.index.count / 3)
                : Math.floor((object.geometry.attributes.position?.count || 0) / 3),
            });
          });
          const found = matches.length > 0;
          const center = found ? bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) : null;
          const size = found ? bounds.min.map((value, axis) => bounds.max[axis] - value) : null;
          return {
            key,
            file: descriptor?.file || null,
            found,
            matches,
            visibleMatches: matches.filter((match) => match.effectivelyVisible).length,
            bounds: found ? { min: bounds.min, max: bounds.max, center, size } : null,
          };
        };
        const assetsSnapshot = () => Object.fromEntries(
          Object.keys(descriptorByKey).map((key) => [key, assetSnapshot(key)]),
        );
        const textureDimensions = (image) => {
          if (!image) return [];
          if (Array.isArray(image)) return image.flatMap(textureDimensions);
          const width = Number(image.width || image.videoWidth || image.naturalWidth || image.data?.width || 0);
          const height = Number(image.height || image.videoHeight || image.naturalHeight || image.data?.height || 0);
          return width > 0 && height > 0 ? [{ width, height }] : [];
        };
        const resources = () => {
          const scene = app().scene3d.scene;
          const renderer = app().scene3d.renderer;
          const geometries = new Set();
          const materials = new Set();
          const textures = new Set();
          let nodes = 0;
          let meshes = 0;
          scene.traverse((object) => {
            nodes += 1;
            if (!object.isMesh) return;
            meshes += 1;
            if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
            for (const material of materialsOf(object)) {
              if (material.uuid) materials.add(material.uuid);
              for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
              for (const uniform of Object.values(material.uniforms || {})) {
                const value = uniform?.value;
                if (value?.isTexture) textures.add(value);
                else if (Array.isArray(value)) for (const entry of value) if (entry?.isTexture) textures.add(entry);
              }
            }
          });
          let estimatedTextureMipBytes = 0;
          let dimensionedTextures = 0;
          for (const texture of textures) {
            const dimensions = textureDimensions(texture.image || texture.source?.data);
            if (dimensions.length) dimensionedTextures += 1;
            estimatedTextureMipBytes += dimensions.reduce(
              (sum, image) => sum + Math.round(image.width * image.height * 4 * (4 / 3)), 0,
            );
          }
          return {
            nodes,
            meshes,
            sceneGeometries: geometries.size,
            sceneMaterials: materials.size,
            sceneTextures: textures.size,
            dimensionedTextures,
            estimatedSceneTextureMipBytes: estimatedTextureMipBytes,
            rendererMemory: { ...renderer.info.memory },
            rendererPrograms: renderer.info.programs?.length ?? null,
          };
        };
        const combinedBounds = (keys) => {
          const snapshots = keys.map(assetSnapshot).filter((entry) => entry.bounds);
          if (!snapshots.length) return null;
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (const snapshot of snapshots) for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], snapshot.bounds.min[axis]);
            max[axis] = Math.max(max[axis], snapshot.bounds.max[axis]);
          }
          return {
            min,
            max,
            center: min.map((value, axis) => (value + max[axis]) / 2),
            size: min.map((value, axis) => max[axis] - value),
          };
        };
        const waitFrames = (count = 8) => new Promise((resolve) => {
          let remaining = count;
          const tick = () => {
            remaining -= 1;
            if (remaining <= 0) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const aim = (keys) => {
          const bounds = combinedBounds(keys);
          if (!bounds) return { ok: false, reason: `No scene bounds for ${keys.join(', ')}` };
          const walkApi = app().scene3d.walk;
          const walk = walkApi.state;
          const maxDimension = Math.max(...bounds.size);
          let chosen = null;
          for (const distance of [Math.max(7.5, maxDimension * 1.8), Math.max(10, maxDimension * 2.3), 13]) {
            for (const angle of [0.72, 2.25, -0.82, -2.35]) {
              const x = bounds.center[0] + Math.cos(angle) * distance;
              const z = bounds.center[2] + Math.sin(angle) * distance;
              if (walkApi.isFree(x, z, 0.55)) { chosen = { x, z, distance, angle, free: true }; break; }
            }
            if (chosen) break;
          }
          if (!chosen) {
            const distance = Math.max(10, maxDimension * 2.3);
            chosen = {
              x: bounds.center[0] + distance * 0.72,
              z: bounds.center[2] + distance * 0.69,
              distance,
              angle: null,
              free: false,
            };
          }
          walkApi.clearKeys?.();
          walk.x = chosen.x;
          walk.z = chosen.z;
          const dx = bounds.center[0] - walk.x;
          const dz = bounds.center[2] - walk.z;
          const horizontal = Math.hypot(dx, dz) || 1;
          walk.yaw = Math.atan2(-dx, -dz);
          const eyeY = app().scene3d.heightAt(walk.x, walk.z) + walk.eye;
          const targetY = bounds.min[1] + bounds.size[1] * 0.47;
          walk.pitch = Math.max(-0.34, Math.min(0.18, Math.atan2(targetY - eyeY, horizontal)));
          return { ok: true, keys, bounds, camera: { ...chosen, yaw: walk.yaw, pitch: walk.pitch } };
        };
        const focus = (key, offset) => {
          const target = assetSnapshot(key);
          if (!target.bounds) return { ok: false, reason: `No scene bounds for ${key}` };
          const walkApi = app().scene3d.walk;
          const walk = walkApi.state;
          const length = Math.hypot(offset[0], offset[1]) || 1;
          const distance = 2.75;
          walkApi.clearKeys?.();
          walk.x = target.bounds.center[0] + (offset[0] / length) * distance;
          walk.z = target.bounds.center[2] + (offset[1] / length) * distance;
          const dx = target.bounds.center[0] - walk.x;
          const dz = target.bounds.center[2] - walk.z;
          walk.yaw = Math.atan2(-dx, -dz);
          walk.pitch = -0.08;
          return { ok: true, player: { x: walk.x, z: walk.z }, target: target.bounds.center };
        };
        const placeDrivingFixture = () => {
          const walkApi = app().scene3d.walk;
          const base = walkApi.state;
          const clear = (x, z, radius = 1.35) => walkApi.isFree(x, z, radius);
          let chosen = null;
          for (let ring = 0; ring <= 30 && !chosen; ring += 1) {
            const radius = ring * 6;
            for (let spoke = 0; spoke < 32; spoke += 1) {
              const angle = (spoke / 32) * Math.PI * 2;
              const x = base.x + Math.cos(angle) * radius;
              const z = base.z + Math.sin(angle) * radius;
              if (!clear(x, z)) continue;
              let broad = true;
              for (const testRadius of [6, 12, 17]) for (let sample = 0; sample < 16; sample += 1) {
                const testAngle = (sample / 16) * Math.PI * 2;
                if (!clear(x + Math.cos(testAngle) * testRadius, z + Math.sin(testAngle) * testRadius)) {
                  broad = false;
                  break;
                }
              }
              if (broad) { chosen = { x, z }; break; }
            }
          }
          if (!chosen) return { ok: false, reason: 'No broad collision-free tractor fixture found.' };
          walkApi.placeCart(chosen.x, chosen.z, 0);
          base.x = chosen.x;
          base.z = chosen.z + 2.75;
          base.yaw = 0;
          base.pitch = -0.08;
          return { ok: true, cart: chosen, player: { x: base.x, z: base.z } };
        };
        const sample = (label, durationMs) => new Promise((resolve) => {
          const renderer = app().scene3d.renderer;
          const info = renderer.info;
          const previousAutoReset = info.autoReset;
          const deltas = [];
          const calls = [];
          const triangles = [];
          const observerRecords = { count: 0 };
          const observer = new MutationObserver((records) => { observerRecords.count += records.length; });
          const ui = document.getElementById('ui');
          if (ui) observer.observe(ui, { subtree: true, childList: true, attributes: true, characterData: true });
          let last = performance.now();
          const started = last;
          let lastWalk = null;
          let pathDistance = 0;
          let mountedFrames = 0;
          info.autoReset = false;
          info.reset();
          const tick = (now) => {
            if (now > last) deltas.push(now - last);
            last = now;
            calls.push(info.render.calls || 0);
            triangles.push(info.render.triangles || 0);
            info.reset();
            const walk = app().scene3d.walk.state;
            if (lastWalk) pathDistance += Math.hypot(walk.x - lastWalk.x, walk.z - lastWalk.z);
            lastWalk = { x: walk.x, z: walk.z };
            if (app().scene3d.walk.cart.mounted) mountedFrames += 1;
            if (now - started < durationMs) { requestAnimationFrame(tick); return; }
            observer.disconnect();
            info.reset();
            info.autoReset = previousAutoReset;
            const values = deltas.slice(3).filter((value) => Number.isFinite(value) && value > 0);
            const ordered = values.slice().sort((a, b) => a - b);
            const mean = (items) => items.length
              ? items.reduce((sum, value) => sum + value, 0) / items.length
              : 0;
            const percentile = (q) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * q))] || 0;
            const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
            const slowMean = mean(ordered.slice(-slowCount));
            resolve({
              label,
              durationMs: +(last - started).toFixed(2),
              frames: values.length,
              averageFps: mean(values) ? +(1000 / mean(values)).toFixed(2) : null,
              onePercentLowFps: slowMean ? +(1000 / slowMean).toFixed(2) : null,
              p50FrameMs: +percentile(0.50).toFixed(3),
              p95FrameMs: +percentile(0.95).toFixed(3),
              p99FrameMs: +percentile(0.99).toFixed(3),
              worstFrameMs: +(ordered.at(-1) || 0).toFixed(3),
              framesOver33ms: values.filter((value) => value > 33.333).length,
              framesOver50ms: values.filter((value) => value > 50).length,
              framesOver100ms: values.filter((value) => value > 100).length,
              drawCallsAverage: +mean(calls).toFixed(2),
              drawCallsMax: Math.max(0, ...calls),
              trianglesAverage: Math.round(mean(triangles)),
              trianglesMax: Math.max(0, ...triangles),
              uiMutationRecords: observerRecords.count,
              pathDistance: +pathDistance.toFixed(3),
              mountedFrameRatio: values.length ? +(mountedFrames / values.length).toFixed(3) : 0,
            });
          };
          requestAnimationFrame(tick);
        });
        const targetResourceTiming = () => performance.getEntriesByType('resource')
          .map((entry) => ({
            file: new URL(entry.name).pathname.replace(/^\/+/, ''),
            durationMs: +entry.duration.toFixed(3),
            transferBytes: entry.transferSize,
            encodedBodyBytes: entry.encodedBodySize,
            decodedBodyBytes: entry.decodedBodySize,
          }))
          .filter((entry) => assetDescriptors.some((asset) => asset.file === entry.file));
        window.__tractorQa = {
          assets: assetsSnapshot,
          resources,
          aim,
          focus,
          placeDrivingFixture,
          sample,
          targetResourceTiming,
          waitFrames,
        };
      }, descriptors);
      await qaPage.evaluate(() => window.__tractorQa.waitFrames(12));

      const fixtureState = await qaPage.evaluate(() => ({
        repaired: window.__fw.state.tractor.repaired,
        steps: { ...window.__fw.state.tractor.steps },
        sceneId: window.__fw.scene3d.scene.uuid,
      }));
      const initial = await qaPage.evaluate(() => ({
        assets: window.__tractorQa.assets(),
        resources: window.__tractorQa.resources(),
        targetResourceTiming: window.__tractorQa.targetResourceTiming(),
      }));
      const screenshots = [];
      let interaction = null;
      let performance = null;
      let browserMetrics = null;

      if (name === 'unrepaired') {
        phase = 'unrepaired-normal-interaction';
        const focusAttempts = [];
        for (const offset of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const pose = await qaPage.evaluate(({ key, direction }) => window.__tractorQa.focus(key, direction), {
            key: 'broken', direction: offset,
          });
          await qaPage.waitForTimeout(260);
          const label = await qaPage.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
          focusAttempts.push({ offset, pose, label });
          if (/broken tractor/i.test(label || '')) break;
        }
        const repairedBefore = await qaPage.evaluate(() => window.__fw.state.tractor.repaired);
        await qaPage.keyboard.press('e');
        await qaPage.waitForTimeout(350);
        interaction = {
          input: 'normal keyboard E while focused on the broken tractor',
          focusAttempts,
          repairedBefore,
          repairedAfter: await qaPage.evaluate(() => window.__fw.state.tractor.repaired),
          targetRequestsAfter: requestLog.slice(),
        };
        const camera = await qaPage.evaluate(() => window.__tractorQa.aim(['broken']));
        await qaPage.evaluate(() => window.__tractorQa.waitFrames(12));
        const screenshot = relativeArtifact('01-unrepaired-yard.png');
        await qaPage.screenshot({ path: path.join(repo, ...screenshot.split('/')) });
        screenshots.push({ label: 'unrepaired fixed player camera', file: screenshot, camera });
        performance = { idle: await qaPage.evaluate((duration) => (
          window.__tractorQa.sample('unrepaired-yard-idle', duration)
        ), sampleMs) };
        browserMetrics = { settled: await browserSnapshot('unrepaired-settled') };
      } else {
        phase = 'repaired-visual';
        const camera = await qaPage.evaluate(() => window.__tractorQa.aim(['restored', 'mower']));
        await qaPage.evaluate(() => window.__tractorQa.waitFrames(12));
        const screenshot = relativeArtifact('02-repaired-tractor-mower.png');
        await qaPage.screenshot({ path: path.join(repo, ...screenshot.split('/')) });
        screenshots.push({ label: 'restored tractor plus hitched mower fixed player camera', file: screenshot, camera });
        const beforeDrive = await qaPage.evaluate(() => ({
          assets: window.__tractorQa.assets(),
          resources: window.__tractorQa.resources(),
        }));
        const beforeBrowser = await browserSnapshot('repaired-before-drive');
        performance = { idle: await qaPage.evaluate((duration) => (
          window.__tractorQa.sample('repaired-tractor-mower-idle', duration)
        ), sampleMs) };

        phase = 'repaired-normal-drive';
        const drivingFixture = await qaPage.evaluate(() => window.__tractorQa.placeDrivingFixture());
        await qaPage.evaluate(() => window.__tractorQa.waitFrames(10));
        const focusLabel = await qaPage.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
        const cartStart = await qaPage.evaluate(() => ({ ...window.__fw.scene3d.walk.cart }));
        await qaPage.keyboard.press('e');
        await qaPage.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted, null, { timeout: 5000 });
        const samplePromise = qaPage.evaluate((duration) => (
          window.__tractorQa.sample('repaired-normal-driving', duration)
        ), sampleMs);
        await qaPage.keyboard.down('w');
        await qaPage.keyboard.down('a');
        await qaPage.waitForTimeout(Math.floor(sampleMs * 0.42));
        await qaPage.keyboard.up('a');
        await qaPage.keyboard.down('d');
        await qaPage.waitForTimeout(Math.floor(sampleMs * 0.42));
        await qaPage.keyboard.up('d');
        await qaPage.keyboard.up('w');
        performance.drive = await samplePromise;
        const drivingScreenshot = relativeArtifact('03-repaired-driving.png');
        await qaPage.screenshot({ path: path.join(repo, ...drivingScreenshot.split('/')) });
        screenshots.push({
          label: 'normal-control mounted driving camera',
          file: drivingScreenshot,
          camera: await qaPage.evaluate(() => ({
            position: window.__fw.scene3d.camera.position.toArray(),
            yaw: window.__fw.scene3d.walk.state.yaw,
            pitch: window.__fw.scene3d.walk.state.pitch,
          })),
        });
        const cartBeforeDismount = await qaPage.evaluate(() => ({ ...window.__fw.scene3d.walk.cart }));
        const afterDriveAssets = await qaPage.evaluate(() => window.__tractorQa.assets());
        await qaPage.keyboard.press('e');
        await qaPage.waitForFunction(() => !window.__fw.scene3d.walk.cart.mounted, null, { timeout: 5000 });
        await qaPage.evaluate(() => window.__tractorQa.waitFrames(8));
        interaction = {
          input: 'normal keyboard E mount, W+A/W+D drive, E dismount',
          drivingFixture,
          focusLabel,
          cartStart,
          cartBeforeDismount,
          mounted: true,
          dismounted: await qaPage.evaluate(() => !window.__fw.scene3d.walk.cart.mounted),
          beforeDriveAssets: beforeDrive.assets,
          afterDriveAssets,
        };
        browserMetrics = {
          beforeDrive: beforeBrowser,
          afterDrive: await browserSnapshot('repaired-after-drive'),
        };
      }

      const final = await qaPage.evaluate(() => ({
        repaired: window.__fw.state.tractor.repaired,
        assets: window.__tractorQa.assets(),
        resources: window.__tractorQa.resources(),
        targetResourceTiming: window.__tractorQa.targetResourceTiming(),
      }));
      const benignWarnings = diagnostics.consoleWarnings.filter((warning) => (
        /THREE\.WebGLProgram: Program Info Log/i.test(warning.text)
          && /dyn_index_vec4_float4_int/i.test(warning.text)
      ));
      diagnostics.benignWarnings = benignWarnings;
      diagnostics.nonBenignWarnings = diagnostics.consoleWarnings.filter((warning) => !benignWarnings.includes(warning));
      diagnostics.unexpectedRequestFailures = diagnostics.requestFailures.filter(
        (failure) => failure.errorText !== 'net::ERR_ABORTED',
      );
      return {
        name,
        fixture: fixture.fingerprint,
        fixtureState,
        initial,
        interaction,
        final,
        performance,
        browserMetrics,
        screenshots,
        requestLog,
        requestCounts: Object.fromEntries(descriptors.map((descriptor) => [
          descriptor.file,
          requestLog.filter((request) => request.file === descriptor.file).length,
        ])),
        diagnostics,
      };
    } catch (error) {
      diagnostics.harnessErrors.push({ phase, message: error.message, stack: error.stack || null });
      if (qaPage) {
        const screenshot = relativeArtifact(`${name}-harness-failure.png`);
        await qaPage.screenshot({ path: path.join(repo, ...screenshot.split('/')) }).catch(() => {});
      }
      return { name, fixture: fixture.fingerprint, requestLog, diagnostics, failedAtPhase: phase };
    } finally {
      if (qaPage) {
        for (const key of ['w', 'a', 'd', 'e']) await qaPage.keyboard.up(key).catch(() => {});
      }
      await context.close();
      contextsClosed += 1;
    }
  };

  const unrepaired = await runCase('unrepaired', fixtures.unrepaired);
  const repaired = await runCase('repaired', fixtures.repaired);
  const runnerAutosaveAfter = await page.evaluate(() => localStorage.getItem('golfempire:autosave'));

  const center = (entry) => entry?.bounds?.center || null;
  const distance = (a, b) => (a && b ? Math.hypot(...a.map((value, index) => value - b[index])) : null);
  const motion = (before, after) => {
    const a = center(before);
    const b = center(after);
    return a && b ? b.map((value, index) => value - a[index]) : null;
  };
  const tractorBefore = repaired.interaction?.beforeDriveAssets?.restored;
  const tractorAfter = repaired.interaction?.afterDriveAssets?.restored;
  const mowerBefore = repaired.interaction?.beforeDriveAssets?.mower;
  const mowerAfter = repaired.interaction?.afterDriveAssets?.mower;
  const tractorMotion = motion(tractorBefore, tractorAfter);
  const mowerMotion = motion(mowerBefore, mowerAfter);
  const hitchSeparationBefore = distance(center(tractorBefore), center(mowerBefore));
  const hitchSeparationAfter = distance(center(tractorAfter), center(mowerAfter));
  const closestCommonAncestor = (a, b) => {
    const aa = a?.matches?.length === 1 ? a.matches[0].ancestors || [] : [];
    const bb = b?.matches?.length === 1 ? b.matches[0].ancestors || [] : [];
    let best = null;
    for (let ai = 0; ai < aa.length; ai += 1) {
      const bi = bb.findIndex((entry) => entry.uuid === aa[ai].uuid);
      if (bi < 0) continue;
      const depthSum = ai + bi;
      if (!best || depthSum < best.depthSum) best = { ...aa[ai], tractorDepth: ai, mowerDepth: bi, depthSum };
    }
    return best;
  };
  const hitchAncestorBefore = closestCommonAncestor(tractorBefore, mowerBefore);
  const hitchAncestorAfter = closestCommonAncestor(tractorAfter, mowerAfter);
  const tractorTravel = distance(tractorMotion, [0, 0, 0]);
  const mowerTravel = distance(mowerMotion, [0, 0, 0]);
  const checks = [];
  const check = (id, ok, actual, expected) => checks.push({ id, ok: !!ok, actual, expected });
  const requests = (record, file) => record?.requestCounts?.[file] ?? null;
  const timed = (record, file) => record?.final?.targetResourceTiming?.filter((entry) => entry.file === file).length ?? null;
  check('unrepaired-fixture', unrepaired.fixtureState?.repaired === false,
    unrepaired.fixtureState?.repaired, false);
  check('unrepaired-restored-request-deferred', requests(unrepaired, 'vendor/models/tractor_red.glb') === 0,
    requests(unrepaired, 'vendor/models/tractor_red.glb'), 0);
  check('unrepaired-mower-request-deferred', requests(unrepaired, 'vendor/models/mower_deck.glb') === 0,
    requests(unrepaired, 'vendor/models/mower_deck.glb'), 0);
  check('unrepaired-restored-resource-absent', timed(unrepaired, 'vendor/models/tractor_red.glb') === 0,
    timed(unrepaired, 'vendor/models/tractor_red.glb'), 0);
  check('unrepaired-mower-resource-absent', timed(unrepaired, 'vendor/models/mower_deck.glb') === 0,
    timed(unrepaired, 'vendor/models/mower_deck.glb'), 0);
  check('unrepaired-restored-scene-absent', unrepaired.final?.assets?.restored?.found === false,
    unrepaired.final?.assets?.restored?.found, false);
  check('unrepaired-mower-scene-absent', unrepaired.final?.assets?.mower?.found === false,
    unrepaired.final?.assets?.mower?.found, false);
  check('unrepaired-broken-model-present', requests(unrepaired, 'vendor/models/tractor_broken.glb') === 1
      && unrepaired.final?.assets?.broken?.visibleMatches > 0,
  { requests: requests(unrepaired, 'vendor/models/tractor_broken.glb'), scene: unrepaired.final?.assets?.broken },
  'one request and a visible broken tractor mesh');
  check('unrepaired-normal-e-does-not-unlock', unrepaired.interaction?.repairedBefore === false
      && unrepaired.interaction?.repairedAfter === false
      && unrepaired.interaction?.focusAttempts?.some((attempt) => /broken tractor/i.test(attempt.label || '')),
  unrepaired.interaction, 'normal E at the incomplete broken tractor keeps it unrepaired');

  check('repaired-fixture', repaired.fixtureState?.repaired === true,
    repaired.fixtureState?.repaired, true);
  check('repaired-restored-request-once', requests(repaired, 'vendor/models/tractor_red.glb') === 1,
    requests(repaired, 'vendor/models/tractor_red.glb'), 1);
  check('repaired-mower-request-once', requests(repaired, 'vendor/models/mower_deck.glb') === 1,
    requests(repaired, 'vendor/models/mower_deck.glb'), 1);
  check('repaired-fallback-unused', requests(repaired, 'vendor/models/tractor.glb') === 0,
    requests(repaired, 'vendor/models/tractor.glb'), 0);
  check('repaired-broken-model-not-loaded', requests(repaired, 'vendor/models/tractor_broken.glb') === 0,
    requests(repaired, 'vendor/models/tractor_broken.glb'), 0);
  check('repaired-authored-assets-visible', repaired.final?.assets?.restored?.visibleMatches > 0
      && repaired.final?.assets?.mower?.visibleMatches > 0,
  { restored: repaired.final?.assets?.restored, mower: repaired.final?.assets?.mower },
  'visible authored restored tractor and mower meshes with finite world bounds');
  check('repaired-normal-drive', repaired.interaction?.mounted === true
      && repaired.interaction?.dismounted === true
      && repaired.performance?.drive?.pathDistance > 5,
  { interaction: repaired.interaction, performance: repaired.performance?.drive },
  'normal E/W+A/W+D/E route mounts, moves more than 5 yd, and dismounts');
  check('mower-remains-hitched-through-drive', tractorTravel > 1 && mowerTravel > 1
      && hitchAncestorBefore?.depthSum <= 6
      && hitchAncestorAfter?.uuid === hitchAncestorBefore.uuid
      && Math.abs(hitchSeparationAfter - hitchSeparationBefore) < 0.15,
  {
    tractorMotion,
    mowerMotion,
    tractorTravel,
    mowerTravel,
    hitchAncestorBefore,
    hitchAncestorAfter,
    hitchSeparationBefore,
    hitchSeparationAfter,
  },
  'both assets move, retain the same nearby cart ancestor, and preserve hitch separation');
  check('performance-samples-valid', unrepaired.performance?.idle?.frames > 30
      && repaired.performance?.idle?.frames > 30
      && repaired.performance?.drive?.frames > 30,
  { unrepaired: unrepaired.performance, repaired: repaired.performance },
  'more than 30 measured frames per fixed-camera and driving sample');
  for (const record of [unrepaired, repaired]) {
    check(`${record.name}-console-errors`, record.diagnostics?.consoleErrors?.length === 0,
      record.diagnostics?.consoleErrors || null, []);
    check(`${record.name}-non-benign-warnings`, record.diagnostics?.nonBenignWarnings?.length === 0,
      record.diagnostics?.nonBenignWarnings || null, []);
    check(`${record.name}-page-errors`, record.diagnostics?.pageErrors?.length === 0,
      record.diagnostics?.pageErrors || null, []);
    check(`${record.name}-request-failures`, record.diagnostics?.unexpectedRequestFailures?.length === 0,
      record.diagnostics?.unexpectedRequestFailures || null, []);
    check(`${record.name}-harness-errors`, record.diagnostics?.harnessErrors?.length === 0,
      record.diagnostics?.harnessErrors || null, []);
  }
  check('isolated-contexts-closed', contextsCreated === 2 && contextsClosed === 2,
    { contextsCreated, contextsClosed }, { contextsCreated: 2, contextsClosed: 2 });
  check('runner-bootstrap-save-unchanged', runnerAutosaveAfter === runnerAutosaveBefore,
    { beforeSha256: hash(runnerAutosaveBefore), afterSha256: hash(runnerAutosaveAfter) },
    'matching SHA-256 values');

  const resourceDelta = {
    rendererGeometries: (repaired.initial?.resources?.rendererMemory?.geometries ?? 0)
      - (unrepaired.initial?.resources?.rendererMemory?.geometries ?? 0),
    rendererTextures: (repaired.initial?.resources?.rendererMemory?.textures ?? 0)
      - (unrepaired.initial?.resources?.rendererMemory?.textures ?? 0),
    sceneMeshes: (repaired.initial?.resources?.meshes ?? 0) - (unrepaired.initial?.resources?.meshes ?? 0),
    estimatedSceneTextureMipBytes: (repaired.initial?.resources?.estimatedSceneTextureMipBytes ?? 0)
      - (unrepaired.initial?.resources?.estimatedSceneTextureMipBytes ?? 0),
  };
  return {
    ok: checks.every((entry) => entry.ok),
    capturedAt: new Date().toISOString(),
    protocol: {
      launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/tractor-lazy-load-acceptance.js --bootstrap',
      viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
      fixtures: 'two derivatives of deterministic seed-424242 --bootstrap autosave; dry 10:00 AM weather',
      isolation: 'one fresh BrowserContext per case; each closed after capture; runner bootstrap save read-only',
      controls: {
        bootstrap: 'visible Continue button',
        unrepaired: 'normal E interaction at incomplete broken tractor',
        repaired: 'normal E mount, W+A/W+D drive, E dismount',
        camera: 'fixed QA-only player pose derived from authored model world bounds',
      },
      measurements: {
        network: 'Playwright request events plus same-origin Resource Timing entries',
        frame: `requestAnimationFrame deltas over ${sampleMs} ms; 1% low is reciprocal mean of slowest 1%`,
        renderer: 'THREE.WebGLRenderer.info sampled per frame plus settled memory/program counts',
        textureMemory: 'unique scene-reachable image dimensions x RGBA8 x 4/3 mip estimate',
        browser: 'CDP Performance/Runtime heap and Memory DOM/listener counters after forced GC',
      },
    },
    assetDescriptors: descriptors,
    fixtureHashes: {
      runnerBootstrap: hash(runnerAutosaveBefore),
      unrepaired: hash(fixtures.unrepaired.serialized),
      repaired: hash(fixtures.repaired.serialized),
    },
    artifacts: [
      relativeArtifact('01-unrepaired-yard.png'),
      relativeArtifact('02-repaired-tractor-mower.png'),
      relativeArtifact('03-repaired-driving.png'),
      relativeArtifact('report.json'),
    ],
    unrepaired,
    repaired,
    comparison: {
      repairedMinusUnrepairedSettledResources: resourceDelta,
      tractorMotion,
      mowerMotion,
      hitchSeparationBefore,
      hitchSeparationAfter,
    },
    isolation: {
      contextsCreated,
      contextsClosed,
      runnerBootstrapSaveUnchanged: runnerAutosaveAfter === runnerAutosaveBefore,
      runnerBootstrapBeforeSha256: hash(runnerAutosaveBefore),
      runnerBootstrapAfterSha256: hash(runnerAutosaveAfter),
    },
    checks,
  };
}
