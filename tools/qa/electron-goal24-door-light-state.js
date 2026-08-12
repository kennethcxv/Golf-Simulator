// Goal 24 doorway shader-state diagnostic.
//
// Runs the shipping Electron build and the same continuous-W main-entrance
// route as the locked performance protocol. This is deliberately diagnostic,
// not an acceptance shortcut: it records the exact light list, ancestor
// visibility, detail-LOD transition, and renderer program count around the
// first inbound crossing so a light-count program arrival has a named owner.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-goal24-door-light-state.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve(
    process.env.GOAL24_DOOR_LIGHT_OUT || 'qa/goal24/performance/door-light-state',
  );
  fs.mkdirSync(OUT, { recursive: true });
  const report = { schema: 'goal24-door-light-state-v1', pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (error) => report.pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(
    () => window.__fw?.scene3d?.walk?.isActive?.(),
    null,
    { timeout: 300000 },
  );
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});

  report.prewarmTimings = await page.evaluate(
    () => window.__fw.scene3d.prewarmTimings?.() || null,
  );
  report.bindings = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  const forward = report.bindings.moveForward || 'w';
  const interact = report.bindings.interact || 'e';

  const stage = (side, distance) => page.evaluate(async ({ wantedSide, wantedDistance }) => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const halfD = layout.SHELL.d / 2 - layout.SHELL.wallT / 2;
    const ip = ch.interior.position;
    const converted = ch.L2W?.(layout.DOOR_MAIN.x, halfD);
    const target = converted || { x: ip.x + layout.DOOR_MAIN.x, z: ip.z + halfD };
    let nx = target.x - ip.x;
    let nz = target.z - ip.z;
    const length = Math.hypot(nx, nz) || 1;
    nx /= length;
    nz /= length;
    if (ch.isInside(target.x + nx, target.z + nz, 0.1)) {
      nx *= -1;
      nz *= -1;
    }
    const sign = wantedSide === 'inside' ? -1 : 1;
    st.x = target.x + nx * wantedDistance * sign;
    st.z = target.z + nz * wantedDistance * sign;
    st.yaw = Math.atan2(-(target.x - st.x), -(target.z - st.z));
    st.pitch = -0.05;
    st.vx = 0;
    st.vz = 0;
    fw.scene3d.walk.clearKeys?.();
    return {
      target,
      normal: { x: nx, z: nz },
      center: { x: ch.center?.x ?? ip.x, z: ch.center?.z ?? ip.z },
      interior: { halfWidth: layout.INTERIOR.w / 2, halfDepth: layout.INTERIOR.d / 2 },
    };
  }, { wantedSide: side, wantedDistance: distance });

  const snapshot = (label, target) => page.evaluate(({ sampleLabel, doorTarget }) => {
    const fw = window.__fw;
    const scene3d = fw.scene3d;
    const scene = scene3d.scene;
    const camera = scene3d.camera;
    const ch = scene3d.clubhouse();
    const st = scene3d.walk.state;
    const runtime = ch.assets51to100Runtime?.diagnostics?.() || null;
    const lightRows = [];
    const effectiveCounts = {};
    const visibleTreeCounts = {};
    const pathFor = (object) => {
      const names = [];
      let cursor = object;
      while (cursor) {
        names.push(cursor.name || cursor.type || '(anonymous)');
        cursor = cursor.parent;
      }
      return names.reverse().join('/');
    };
    scene.traverse((object) => {
      if (!object.isLight) return;
      let ancestorVisible = true;
      let cursor = object;
      while (cursor) {
        if (cursor.visible === false) ancestorVisible = false;
        cursor = cursor.parent;
      }
      const cameraLayerMatch = object.layers?.test?.(camera.layers) !== false;
      const treeVisible = ancestorVisible && object.visible !== false;
      const effective = treeVisible && cameraLayerMatch;
      if (treeVisible) visibleTreeCounts[object.type] = (visibleTreeCounts[object.type] || 0) + 1;
      if (effective) effectiveCounts[object.type] = (effectiveCounts[object.type] || 0) + 1;
      lightRows.push({
        name: object.name || '',
        type: object.type,
        path: pathFor(object),
        intensity: Number.isFinite(object.intensity) ? object.intensity : null,
        ownVisible: object.visible !== false,
        ancestorVisible,
        cameraLayerMatch,
        layerMask: object.layers?.mask ?? null,
        effective,
        renderBudgetActive: object.userData?.renderBudgetActive ?? null,
        runtimeLightRenderSuppressed: object.userData?.runtimeLightRenderSuppressed ?? null,
      });
    });
    const dx = Math.max(Math.abs(camera.position.x - doorTarget.center.x)
      - doorTarget.interior.halfWidth, 0);
    const dz = Math.max(Math.abs(camera.position.z - doorTarget.center.z)
      - doorTarget.interior.halfDepth, 0);
    const main = ch.mainEntranceDiagnostics?.() || null;
    return {
      label: sampleLabel,
      atMs: performance.now(),
      player: {
        x: st.x,
        z: st.z,
        inside: !!ch.isInside(st.x, st.z, 0.35),
        distanceToDoor: Math.hypot(st.x - doorTarget.target.x, st.z - doorTarget.target.z),
      },
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        detailExteriorDistance: Math.hypot(dx, dz),
      },
      interiorVisible: ch.interior?.visible === true,
      detail: runtime ? {
        detailedVisible: runtime.detailedVisible,
        sequence: runtime.detailVisibilitySequence,
        transition: runtime.lastDetailVisibilityTransition,
      } : null,
      panelBudget: ch.diagnostics?.()?.lighting?.panelRenderBudget
        ?? ch.diagnostics?.()?.panelRenderBudget
        ?? null,
      entrance: main,
      programs: scene3d.renderer.info.programs?.length ?? null,
      effectiveCounts,
      visibleTreeCounts,
      lights: lightRows,
    };
  }, { sampleLabel: label, doorTarget: target });

  await page.mouse.click(800, 450);
  const route = await stage('outside', 6.5);
  await page.waitForTimeout(700);
  report.samples = [await snapshot('outside-6.5', route)];

  const driveUntil = async (predicate, timeoutMs) => {
    const samples = [];
    const started = Date.now();
    await page.keyboard.down(forward);
    try {
      while (Date.now() - started < timeoutMs) {
        await page.waitForTimeout(20);
        const sample = await snapshot(`drive-${samples.length + 1}`, route);
        samples.push(sample);
        if (predicate(sample)) return samples;
      }
    } finally {
      await page.keyboard.up(forward);
    }
    throw new Error(`Door-light drive timed out after ${timeoutMs} ms.`);
  };

  const approach = await driveUntil(
    (sample) => sample.player.distanceToDoor <= 1.9 || sample.player.inside,
    5000,
  );
  report.samples.push(...approach);
  report.samples.push(await snapshot('approach-finish', route));
  await page.keyboard.press(interact);
  await page.waitForFunction(() => {
    const value = window.__fw.scene3d.clubhouse().mainEntranceDiagnostics?.();
    return value?.leftState === 'open'
      && value?.rightState === 'open'
      && Math.abs(value.leftAngle || 0) > 0.2
      && Math.abs(value.rightAngle || 0) > 0.2;
  }, null, { timeout: 5000 });
  report.samples.push(await snapshot('door-open', route));

  const crossing = await driveUntil(
    (sample) => sample.player.inside && sample.player.distanceToDoor >= 1.8,
    25000,
  );
  report.samples.push(...crossing);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().assets51to100Runtime?.diagnostics?.()?.detailedVisible === true
  ), null, { timeout: 3000 });
  report.samples.push(await snapshot('detail-visible-settled', route));

  const meaningful = [];
  let priorSignature = null;
  for (const sample of report.samples) {
    const signature = JSON.stringify({
      inside: sample.player.inside,
      interiorVisible: sample.interiorVisible,
      detail: sample.detail?.detailedVisible,
      sequence: sample.detail?.sequence,
      programs: sample.programs,
      counts: sample.effectiveCounts,
    });
    if (signature !== priorSignature || /outside|finish|open|settled/.test(sample.label)) {
      meaningful.push(sample);
      priorSignature = signature;
    }
  }
  report.meaningfulSamples = meaningful;
  report.ok = report.pageErrors.length === 0
    && report.consoleErrors.length === 0
    && report.samples.at(-1)?.detail?.detailedVisible === true
    && report.samples.at(-1)?.player?.inside === true;
  fs.writeFileSync(
    path.join(OUT, 'door-light-state.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log('GOAL24_DOOR_LIGHT_STATE', JSON.stringify({
    ok: report.ok,
    samples: report.samples.length,
    meaningful: meaningful.map((sample) => ({
      label: sample.label,
      player: sample.player,
      interiorVisible: sample.interiorVisible,
      detail: sample.detail,
      programs: sample.programs,
      effectiveCounts: sample.effectiveCounts,
    })),
    errors: { page: report.pageErrors.length, console: report.consoleErrors.length },
  }));
  return report;
}
