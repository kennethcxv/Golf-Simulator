async (page) => {
  const forceStaleUnpack = process.env.TEX3D_FORCE_STALE === '1';
  const result = {
    ok: false,
    route: [],
    consoleWarnings: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    probe: null,
    forceStaleUnpack,
    beforeLoad: null,
  };

  page.on('console', (message) => {
    const entry = { type: message.type(), text: message.text() };
    if (message.type() === 'warning') result.consoleWarnings.push(entry);
    if (message.type() === 'error') result.consoleErrors.push(entry);
  });
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.on('requestfailed', (request) => result.requestFailures.push({
    url: request.url(),
    errorText: request.failure()?.errorText || 'unknown',
  }));

  await page.addInitScript(() => {
    const probe = {
      phase: 'initial-navigation',
      pixelStores: [],
      texImage3D: [],
      texSubImage3D: [],
    };
    window.__texImage3dProbe = probe;
    const proto = globalThis.WebGL2RenderingContext?.prototype;
    if (!proto) return;

    const stateByContext = new WeakMap();
    const stateFor = (gl) => {
      let state = stateByContext.get(gl);
      if (!state) {
        state = { flipY: false, premultiplyAlpha: false };
        stateByContext.set(gl, state);
      }
      return state;
    };
    const stack = () => String(new Error().stack || '')
      .split('\n').slice(2, 10).join('\n');
    const describeSource = (value) => {
      if (value == null) return null;
      if (ArrayBuffer.isView(value)) {
        return { type: value.constructor?.name || 'TypedArray', byteLength: value.byteLength };
      }
      return {
        type: value.constructor?.name || typeof value,
        width: Number(value.width || value.videoWidth || value.naturalWidth || 0) || null,
        height: Number(value.height || value.videoHeight || value.naturalHeight || 0) || null,
      };
    };

    const rawPixelStorei = proto.pixelStorei;
    proto.pixelStorei = function probedPixelStorei(pname, param) {
      const state = stateFor(this);
      if (pname === this.UNPACK_FLIP_Y_WEBGL) state.flipY = !!param;
      if (pname === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL) state.premultiplyAlpha = !!param;
      if ((pname === this.UNPACK_FLIP_Y_WEBGL
        || pname === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL)
        && probe.pixelStores.length < 300) {
        probe.pixelStores.push({ pname, param: Number(param), ...state });
      }
      return rawPixelStorei.call(this, pname, param);
    };

    for (const name of ['texImage3D', 'texSubImage3D']) {
      const raw = proto[name];
      if (typeof raw !== 'function') continue;
      proto[name] = function probedTexture3dUpload(...args) {
        const tracked = stateFor(this);
        const actual = {
          flipY: !!this.getParameter(this.UNPACK_FLIP_Y_WEBGL),
          premultiplyAlpha: !!this.getParameter(this.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
        };
        const bucket = probe[name];
        if (bucket.length < 100) {
          bucket.push({
            phase: probe.phase,
            target: Number(args[0]),
            level: Number(args[1]),
            internalFormat: Number(args[2]),
            width: Number(args[3]),
            height: Number(args[4]),
            depth: Number(args[5]),
            tracked: { ...tracked },
            actual,
            offending: actual.flipY || actual.premultiplyAlpha,
            source: describeSource(args[args.length - 1]),
            stack: stack(),
          });
        }
        return raw.apply(this, args);
      };
    }
  });

  const waitForVeil = async (timeout = 90000) => {
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
    }, null, { timeout });
    await page.waitForFunction(() => window.__fw?.prewarming !== true, null, { timeout });
  };
  const waitForGame = async (oldSceneId = null, timeout = 90000) => {
    await page.waitForFunction((oldId) => {
      const app = window.__fw;
      return app?.screen === 'game'
        && !!app.scene3d?.scene?.uuid
        && (!oldId || app.scene3d.scene.uuid !== oldId);
    }, oldSceneId, { timeout });
    await waitForVeil(timeout);
    await page.waitForTimeout(750);
  };
  const openPause = async () => {
    const pause = page.locator('.pause-veil-ui');
    if (await pause.isVisible().catch(() => false)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.keyboard.press('Escape');
      if (await pause.waitFor({ state: 'visible', timeout: 1800 })
        .then(() => true).catch(() => false)) return;
    }
    throw new Error('Pause menu did not open through Escape.');
  };
  const pauseNav = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(100);
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  result.route.push('continue');
  await page.evaluate(() => { window.__texImage3dProbe.phase = 'live-before-save'; });

  await openPause();
  await pauseNav('Save game');
  await page.getByRole('button', { name: 'Save here', exact: true }).first().click();
  await page.waitForFunction(() => localStorage.getItem('golfempire:slot1') !== null,
    null, { timeout: 5000 });
  result.route.push('slot1-save');
  await pauseNav('Resume');

  await openPause();
  await pauseNav('Load game');
  const oldScene = await page.evaluate(() => window.__fw.scene3d.scene.uuid);
  result.beforeLoad = await page.evaluate((forceStale) => {
    const renderer = window.__fw.scene3d.renderer;
    const gl = renderer.getContext();
    const before = {
      sceneId: window.__fw.scene3d.scene.uuid,
      texImage3dCalls: window.__texImage3dProbe.texImage3D.length,
      flipY: !!gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),
      premultiplyAlpha: !!gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
    };
    window.__texImage3dProbe.phase = 'slot1-load';
    if (forceStale) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    return {
      ...before,
      forced: forceStale,
      flipYAfterForce: !!gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),
    };
  }, forceStaleUnpack);
  const load = page.getByRole('button', { name: 'Load', exact: true }).first();
  await load.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.slot-act')]
      .find((entry) => entry.textContent.trim() === 'Load');
    return !!button && !button.disabled;
  }, null, { timeout: 5000 });
  await load.click();
  await waitForGame(oldScene);
  result.route.push('slot1-load');

  result.probe = await page.evaluate(() => ({
    ...window.__texImage3dProbe,
    sceneId: window.__fw?.scene3d?.scene?.uuid || null,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  }));
  result.offendingTexture3dUploads = [
    ...result.probe.texImage3D,
    ...result.probe.texSubImage3D,
  ].filter((entry) => entry.offending);
  result.texture3dWarnings = result.consoleWarnings.filter((entry) => (
    entry.text.includes('texImage3D: FLIP_Y')
    || entry.text.includes('texSubImage3D: FLIP_Y')
  ));
  result.unexpectedRequestFailures = result.requestFailures
    .filter((entry) => entry.errorText !== 'net::ERR_ABORTED');
  result.ok = result.route.length === 3
    && result.pageErrors.length === 0
    && result.consoleErrors.length === 0
    && result.unexpectedRequestFailures.length === 0
    && result.offendingTexture3dUploads.length === 0
    && result.texture3dWarnings.length === 0;
  return result;
}
