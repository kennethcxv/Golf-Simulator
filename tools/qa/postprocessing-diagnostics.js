async (page) => {
  const warnings = [];
  const errors = [];
  let phase = 'boot';
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'warning') warnings.push({ phase, text: text.slice(0, 500) });
    if (message.type() === 'error') errors.push({ phase, text: text.slice(0, 500) });
  });
  page.on('pageerror', (error) => errors.push({ phase, text: `PAGEERROR: ${error.message}` }));

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.locked = true;
    app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    window.__postDiag = {
      spin: false,
      setOutdoor() {
        const walk = window.__fw.scene3d.walk.state;
        walk.x = -2;
        walk.z = 160;
        walk.yaw = 0.2;
        walk.pitch = -0.02;
      },
      setInterior() {
        const current = window.__fw;
        const origin = current.scene3d.clubhouse().interior.position;
        const walk = current.scene3d.walk.state;
        walk.x = origin.x + 6;
        walk.z = origin.z + 3;
        walk.yaw = 1.2;
        walk.pitch = -0.04;
      },
    };
    const drive = () => {
      if (window.__postDiag?.spin && window.__fw?.scene3d?.walk) {
        const walk = window.__fw.scene3d.walk.state;
        walk.yaw += 0.035;
        walk.pitch = Math.sin(performance.now() / 900) * 0.08;
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);

    const renderer = app.scene3d.renderer;
    const composer = app.scene3d.post.composer;
    const gl = renderer.getContext();
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const gpu = { supported: !!timer, active: false, frame: 0, pending: [], samplesMs: [] };
    if (timer) {
      const originalRender = composer.render.bind(composer);
      composer.render = function timedComposerRender(...args) {
        gpu.frame += 1;
        if (!gpu.active || gpu.frame % 8 !== 0 || gpu.pending.length >= 8) return originalRender(...args);
        const query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        const value = originalRender(...args);
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        gpu.pending.push(query);
        return value;
      };
      const poll = () => {
        for (let index = gpu.pending.length - 1; index >= 0; index -= 1) {
          const query = gpu.pending[index];
          if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
          const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
          const elapsedNs = gl.getQueryParameter(query, gl.QUERY_RESULT);
          if (!disjoint && Number.isFinite(elapsedNs)) gpu.samplesMs.push(elapsedNs / 1e6);
          gl.deleteQuery(query);
          gpu.pending.splice(index, 1);
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }
    window.__postDiagGpu = gpu;
  });

  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const durationMs = values.reduce((sum, value) => sum + value, 0);
    const mean = durationMs / Math.max(1, values.length);
    const slowMean = (fraction) => {
      const count = Math.max(1, Math.ceil(sorted.length * fraction));
      return sorted.slice(-count).reduce((sum, value) => sum + value, 0) / count;
    };
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, values.length);
    const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    return {
      frames: values.length,
      avgFps: +(values.length * 1000 / durationMs).toFixed(2),
      onePercentLowFps: +(1000 / slowMean(0.01)).toFixed(2),
      pointOnePercentLowFps: +(1000 / slowMean(0.001)).toFixed(2),
      avgFrameMs: +mean.toFixed(3),
      p95FrameMs: +percentile(0.95).toFixed(3),
      p99FrameMs: +percentile(0.99).toFixed(3),
      worstFrameMs: +sorted[sorted.length - 1].toFixed(3),
      frameVarianceMs2: +variance.toFixed(3),
      frameStdDevMs: +Math.sqrt(variance).toFixed(3),
    };
  };

  const renderSnapshot = () => page.evaluate(() => new Promise((resolve) => {
    const { renderer, scene } = window.__fw.scene3d;
    requestAnimationFrame(() => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      requestAnimationFrame(() => {
        const render = { ...renderer.info.render };
        renderer.info.autoReset = true;
        let nodes = 0;
        let meshes = 0;
        let instancedMeshes = 0;
        let matrixAutoUpdate = 0;
        const materials = new Set();
        scene.traverse((object) => {
          nodes += 1;
          if (object.matrixAutoUpdate) matrixAutoUpdate += 1;
          if (object.isInstancedMesh) instancedMeshes += 1;
          else if (object.isMesh) meshes += 1;
          const list = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
          for (const material of list) if (material) materials.add(material.uuid);
        });
        resolve({
          source: 'THREE.WebGLRenderer.info accumulated across one complete composed frame',
          drawCalls: render.calls,
          triangles: render.triangles,
          lines: render.lines,
          points: render.points,
          nodes,
          meshes,
          instancedMeshes,
          matrixAutoUpdate,
          materials: materials.size,
          rendererGeometries: renderer.info.memory.geometries,
          rendererTextures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? null,
        });
      });
    });
  }));

  const results = [];
  async function sample(name, configure) {
    phase = name;
    await page.evaluate(configure);
    await page.evaluate(() => { window.__postDiag.spin = true; });
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const gpu = window.__postDiagGpu;
      gpu.samplesMs = [];
      gpu.active = gpu.supported;
    });
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const values = [];
      let previous = performance.now();
      const started = previous;
      const tick = (now) => {
        values.push(now - previous);
        previous = now;
        if (now - started < 5000) requestAnimationFrame(tick);
        else resolve(values.slice(5));
      };
      requestAnimationFrame(tick);
    }));
    await page.evaluate(() => { window.__postDiagGpu.active = false; });
    await page.waitForTimeout(300);
    const gpu = await page.evaluate(() => {
      const probe = window.__postDiagGpu;
      const samples = probe.samplesMs.slice();
      const average = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null;
      return {
        supported: probe.supported,
        samples: samples.length,
        averageMs: average == null ? null : +average.toFixed(3),
        worstMs: samples.length ? +Math.max(...samples).toFixed(3) : null,
      };
    });
    results.push({ name, frames: summarize(frames), gpu, render: await renderSnapshot() });
  }

  await sample('outdoor-all-on', () => {
    window.__postDiag.setOutdoor();
    const post = window.__fw.scene3d.post;
    post.gtao.enabled = true;
    post.bloom.enabled = true;
    post.sun.castShadow = true;
    window.__fw.scene3d.renderer.shadowMap.enabled = true;
  });
  await sample('outdoor-gtao-off', () => {
    window.__postDiag.setOutdoor();
    const post = window.__fw.scene3d.post;
    post.gtao.enabled = false;
    post.bloom.enabled = true;
    post.sun.castShadow = true;
    window.__fw.scene3d.renderer.shadowMap.enabled = true;
  });
  await sample('outdoor-bloom-off', () => {
    window.__postDiag.setOutdoor();
    const post = window.__fw.scene3d.post;
    post.gtao.enabled = true;
    post.bloom.enabled = false;
    post.sun.castShadow = true;
    window.__fw.scene3d.renderer.shadowMap.enabled = true;
  });
  await sample('outdoor-shadows-off', () => {
    window.__postDiag.setOutdoor();
    const post = window.__fw.scene3d.post;
    post.gtao.enabled = true;
    post.bloom.enabled = true;
    post.sun.castShadow = false;
    window.__fw.scene3d.renderer.shadowMap.enabled = false;
  });
  await sample('interior-all-on', () => {
    window.__postDiag.setInterior();
    const post = window.__fw.scene3d.post;
    post.gtao.enabled = true;
    post.bloom.enabled = true;
    post.sun.castShadow = true;
    window.__fw.scene3d.renderer.shadowMap.enabled = true;
  });
  await sample('interior-gtao-off', () => {
    window.__postDiag.setInterior();
    const post = window.__fw.scene3d.post;
    post.gtao.enabled = false;
    post.bloom.enabled = true;
    post.sun.castShadow = true;
    window.__fw.scene3d.renderer.shadowMap.enabled = true;
  });

  await page.evaluate(() => { window.__postDiag.spin = false; });
  const glWarnings = warnings.filter((entry) => /GL_INVALID_OPERATION|WebGL/.test(entry.text));
  const warningCountsByPhase = Object.fromEntries([...new Set(glWarnings.map((entry) => entry.phase))]
    .map((name) => [name, glWarnings.filter((entry) => entry.phase === name).length]));
  return {
    protocol: { viewport: '1600x900', dpr: 1, warmupMs: 1800, sampleMs: 5000, fixedClock: '14:00', route: 'deterministic rapid-look at fixed outdoor and interior positions' },
    results,
    diagnostics: { warningCount: warnings.length, errorCount: errors.length, glWarningCount: glWarnings.length, warningCountsByPhase, warnings: warnings.slice(0, 40), errors },
  };
}
