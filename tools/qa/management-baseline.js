async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.MANAGEMENT_QA_OUT || 'qa/management/baseline';
  const viewportRaw = String(process.env.MANAGEMENT_QA_VIEWPORT || '1600x900').toLowerCase();
  const viewportMatch = /^(\d{3,5})x(\d{3,5})$/.exec(viewportRaw);
  if (!viewportMatch) throw new Error(`Invalid MANAGEMENT_QA_VIEWPORT: ${viewportRaw}`);
  const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.goto(baseUrl);
  await page.setViewportSize(viewport);
  await page.waitForTimeout(900);
  const continueButton = page.getByText('Continue', { exact: true });
  if (await continueButton.isEnabled().catch(() => false)) await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 8.55;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 9 * 60;
    app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/00-standing-at-desk.png` });

  const physicalBefore = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const effectiveVisible = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const chairs = [];
    clubhouse.interior.traverse((object) => {
      if (!/chair/i.test(object.name || '')) return;
      const p = object.getWorldPosition(object.position.clone());
      chairs.push({
        name: object.name,
        visible: effectiveVisible(object),
        world: { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) },
      });
    });
    const rig = clubhouse.laptopRig();
    const laptopWorld = rig.object.getWorldPosition(rig.object.position.clone());
    const pose = clubhouse.laptopPose(app.scene3d.camera.fov, app.scene3d.camera.aspect);
    return {
      chairs,
      laptop: {
        lidAngle: rig.lidAngle,
        lidOpen: rig.lidOpen,
        world: { x: +laptopWorld.x.toFixed(3), y: +laptopWorld.y.toFixed(3), z: +laptopWorld.z.toFixed(3) },
      },
      seatPose: pose ? {
        x: +pose.x.toFixed(3), y: +pose.y.toFixed(3), z: +pose.z.toFixed(3),
        yaw: +pose.yaw.toFixed(4), pitch: +pose.pitch.toFixed(4),
      } : null,
    };
  });

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const root = document.querySelector('.laptop-screen');
    return root && root.style.display !== 'none';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/01-home.png` });

  const framing = await page.evaluate(() => {
    const app = window.__fw;
    const camera = app.scene3d.camera;
    camera.updateMatrixWorld();
    const canvas = document.getElementById('game');
    const viewport = canvas.getBoundingClientRect();
    const points = app.scene3d.clubhouse().laptopScreenCorners().map((corner) => {
      const projected = corner.clone().project(camera);
      return {
        x: viewport.left + ((projected.x + 1) / 2) * viewport.width,
        y: viewport.top + ((1 - projected.y) / 2) * viewport.height,
      };
    });
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const ordered = [...points].sort((a, b) => a.y - b.y);
    const top = ordered.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = ordered.slice(2).sort((a, b) => a.x - b.x);
    const polygon = [top[0], top[1], bottom[1], bottom[0]];
    let area = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
    const frame = document.querySelector('.lt-frame');
    const content = document.querySelector('.lt-content');
    const bodyFont = content ? parseFloat(getComputedStyle(content).fontSize) : null;
    return {
      viewport: { width: viewport.width, height: viewport.height },
      quad: { width: +width.toFixed(2), height: +height.toFixed(2), points },
      coverage: {
        width: +(width / viewport.width).toFixed(4),
        height: +(height / viewport.height).toFixed(4),
        area: +(area / (viewport.width * viewport.height)).toFixed(4),
      },
      effectiveBodyFontPx: bodyFont == null ? null : +(bodyFont * (height / 640)).toFixed(2),
      frameTransform: frame ? getComputedStyle(frame).transform : null,
      camera: { fov: camera.fov, near: camera.near, aspect: camera.aspect },
      pointerLocked: !!document.pointerLockElement,
    };
  });

  const pages = [];
  const subpages = [];
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.lt-navbtn:not(.lt-close)')].map((button) => ({
    label: button.textContent.trim(),
  })));
  for (let index = 0; index < buttons.length; index += 1) {
    const label = buttons[index].label;
    const target = await page.evaluate((wanted) => {
      const button = [...document.querySelectorAll('.lt-navbtn:not(.lt-close)')]
        .find((entry) => entry.textContent.trim() === wanted);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, label);
    if (!target) throw new Error(`Laptop navigation button disappeared: ${label}`);
    await page.mouse.move(target.x, target.y);
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction((wanted) => document.querySelector('.lt-statusname')?.textContent?.trim() === wanted, label);
    await page.waitForTimeout(250);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: `${out}/${String(index + 2).padStart(2, '0')}-${slug}.png` });
    pages.push(await page.evaluate(() => {
      const content = document.querySelector('.lt-content');
      return {
        status: document.querySelector('.lt-statusname')?.textContent?.trim() || null,
        heading: document.querySelector('.lt-h1')?.textContent?.trim() || null,
        tabs: [...document.querySelectorAll('.lt-tab')].map((tab) => tab.textContent.trim()),
        sections: [...document.querySelectorAll('.lt-sect,.lt-minihead')].map((entry) => entry.textContent.trim()).slice(0, 20),
        buttons: [...content.querySelectorAll('button')].map((button) => button.textContent.trim()).filter(Boolean).slice(0, 30),
        scroll: { clientHeight: content.clientHeight, scrollHeight: content.scrollHeight },
      };
    }));

    const primaryTabs = await page.evaluate(() => [...document.querySelectorAll('.lt-tabs-big .lt-tab')]
      .map((tab) => tab.textContent.trim()));
    for (let tabIndex = 0; tabIndex < primaryTabs.length; tabIndex += 1) {
      const tabLabel = primaryTabs[tabIndex];
      const tabTarget = await page.evaluate((wanted) => {
        const tab = [...document.querySelectorAll('.lt-tabs-big .lt-tab')]
          .find((entry) => entry.textContent.trim() === wanted);
        if (!tab) return null;
        const rect = tab.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, tabLabel);
      if (!tabTarget) throw new Error(`Laptop primary tab disappeared: ${label} / ${tabLabel}`);
      await page.mouse.move(tabTarget.x, tabTarget.y);
      await page.mouse.click(tabTarget.x, tabTarget.y);
      await page.waitForFunction((wanted) => [...document.querySelectorAll('.lt-tabs-big .lt-tab.on')]
        .some((entry) => entry.textContent.trim() === wanted), tabLabel);
      await page.waitForTimeout(180);
      const tabSlug = tabLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const screenshot = `${out}/${String(index + 2).padStart(2, '0')}-${slug}-${String(tabIndex + 1).padStart(2, '0')}-${tabSlug}.png`;
      await page.screenshot({ path: screenshot });
      subpages.push(await page.evaluate(({ parent, tab, file }) => {
        const content = document.querySelector('.lt-content');
        return {
          parent,
          tab,
          screenshot: file,
          sections: [...document.querySelectorAll('.lt-sect,.lt-minihead')]
            .map((entry) => entry.textContent.trim()).slice(0, 24),
          text: content.textContent.trim().slice(0, 800),
          scroll: { clientHeight: content.clientHeight, scrollHeight: content.scrollHeight },
        };
      }, { parent: label, tab: tabLabel, file: screenshot }));
    }
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const beforeDom = await cdp.send('Memory.getDOMCounters');
  const performanceSample = await page.evaluate(async () => {
    const mutations = { count: 0 };
    const root = document.querySelector('.laptop-screen');
    const observer = new MutationObserver((entries) => { mutations.count += entries.length; });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    const deltas = [];
    let last = performance.now();
    const started = last;
    await new Promise((resolve) => {
      const frame = (now) => {
        deltas.push(now - last);
        last = now;
        if (now - started >= 6000) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    observer.disconnect();
    const clean = deltas.slice(5).sort((a, b) => a - b);
    const averageMs = clean.reduce((sum, value) => sum + value, 0) / Math.max(1, clean.length);
    const tailCount = Math.max(1, Math.ceil(clean.length * 0.01));
    const tailAverage = clean.slice(-tailCount).reduce((sum, value) => sum + value, 0) / tailCount;
    const scene = window.__fw.scene3d.scene;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'envMap', 'lightMap'];
    scene.traverse((object) => {
      if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) {
        if (material.uuid) materials.add(material.uuid);
        for (const key of textureKeys) if (material[key]?.uuid) textures.add(material[key].uuid);
      }
    });
    const info = window.__fw.scene3d.renderer.info;
    return {
      frames: clean.length,
      averageFps: +(1000 / averageMs).toFixed(2),
      onePercentLowFps: +(1000 / tailAverage).toFixed(2),
      worstFrameMs: +(clean.at(-1) || 0).toFixed(2),
      drawCalls: info.render.calls,
      renderedTriangles: info.render.triangles,
      sceneGeometries: geometries.size,
      sceneMaterials: materials.size,
      sceneTextures: textures.size,
      rendererGeometries: info.memory.geometries,
      rendererTextures: info.memory.textures,
      textureMemoryBytes: null,
      textureMemoryReason: 'Three.js exposes texture count but not resident GPU texture bytes.',
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      uiMutationCount: mutations.count,
      uiMutationsPerSecond: +(mutations.count / 6).toFixed(3),
    };
  });
  const performanceMetrics = await cdp.send('Performance.getMetrics');
  const metric = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value]));

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw?.laptopOpen === false, null, { timeout: 8000 });
  await page.waitForTimeout(900);
  const cycleSnapshots = [];
  for (let cycle = 1; cycle <= 10; cycle += 1) {
    await page.waitForFunction(() => {
      const prompt = document.querySelector('.shop-prompt');
      return !!(prompt && /laptop/i.test(prompt.textContent || ''));
    }, null, { timeout: 10000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw?.laptopOpen === true
      && document.querySelector('.laptop-screen')?.style.display !== 'none', null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw?.laptopOpen === false, null, { timeout: 8000 });
    cycleSnapshots.push(await page.evaluate((index) => ({
      cycle: index,
      laptopRoots: document.querySelectorAll('.laptop-screen').length,
      visibleLaptopRoots: [...document.querySelectorAll('.laptop-screen')]
        .filter((root) => root.style.display !== 'none').length,
      walkActive: window.__fw.scene3d.walk.state.active,
      camera: { fov: window.__fw.scene3d.camera.fov, near: window.__fw.scene3d.camera.near },
    }), cycle));
  }
  await page.waitForTimeout(500);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const afterDom = await cdp.send('Memory.getDOMCounters');
  const afterMetrics = await cdp.send('Performance.getMetrics');
  const afterMetric = Object.fromEntries(afterMetrics.metrics.map((entry) => [entry.name, entry.value]));
  await page.screenshot({ path: `${out}/99-after-ten-cycles.png` });

  const result = {
    ok: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.requestFailures.filter((entry) => entry.error !== 'net::ERR_ABORTED').length === 0
      && cycleSnapshots.every((entry) => entry.laptopRoots === 1 && entry.visibleLaptopRoots === 0
        && entry.walkActive && entry.camera.fov === 66 && entry.camera.near === 0.15),
    protocol: {
      viewport: `${viewport.width}x${viewport.height}`,
      deviceScaleFactor: 1,
      camera: 'office chair at +8.55,+4.5 from clubhouse interior origin; yaw -PI/2; pitch -0.05',
      time: 'Day-local 09:00, speed paused',
      warmupMs: 2500,
      sampleMs: 6000,
      controls: 'trusted E, Escape, and projected-screen mouse clicks',
    },
    physicalBefore,
    framing,
    pages,
    subpages,
    performance: {
      ...performanceSample,
      activeEventListeners: metric.JSEventListeners ?? beforeDom.jsEventListeners ?? null,
      domNodes: beforeDom.nodes,
      documents: beforeDom.documents,
      postCycle: {
        activeEventListeners: afterMetric.JSEventListeners ?? afterDom.jsEventListeners ?? null,
        domNodes: afterDom.nodes,
        documents: afterDom.documents,
        jsHeapBytes: afterMetric.JSHeapUsedSize ?? null,
      },
    },
    cycles: cycleSnapshots,
    diagnostics,
  };
  return result;
}
