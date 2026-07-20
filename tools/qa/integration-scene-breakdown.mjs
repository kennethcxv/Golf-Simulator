import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8457/';
const label = process.env.QA_SCENE_LABEL || 'scene';
const sceneMinute = Number(process.env.QA_SCENE_MINUTE || 14 * 60);
const cameraMode = process.env.QA_SCENE_CAMERA || 'exterior';
const output = path.resolve(process.cwd(), process.env.QA_SCENE_REPORT
  || `qa/integration-seven/${label}-scene-breakdown.json`);
const screenshotOutput = process.env.QA_SCENE_SCREENSHOT
  ? path.resolve(process.cwd(), process.env.QA_SCENE_SCREENSHOT) : null;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-precise-memory-info', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  const polishedNewGame = page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ });
  if (await polishedNewGame.count()) {
    await polishedNewGame.click();
    await page.getByRole('dialog', { name: 'New game' }).waitFor();
    await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
  } else {
    await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
  }
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
  await page.evaluate(({ minuteOfDay, view }) => {
    const app = window.__fw;
    app.speedIdx = 0;
    const minute = minuteOfDay;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + minute;
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    const walk = app.scene3d.walk;
    walk.clearKeys();
    const at = view === 'register' ? { x: -7.8, z: 229.7 } : { x: -1.5, z: 243.5 };
    const target = view === 'register' ? { x: -5.2, z: 232.6 } : { x: -8.5, z: 231 };
    walk.state.x = at.x;
    walk.state.z = at.z;
    const dx = target.x - walk.state.x;
    const dz = target.z - walk.state.z;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = view === 'register' ? -0.07 : 0.03;
  }, { minuteOfDay: sceneMinute, view: cameraMode });
  await page.waitForTimeout(5_000);
  if (screenshotOutput) {
    await fs.mkdir(path.dirname(screenshotOutput), { recursive: true });
    await page.screenshot({ path: screenshotOutput, animations: 'disabled' });
  }

  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const renderer = app.scene3d.renderer;
    const camera = app.scene3d.camera;
    scene.updateMatrixWorld(true);

    const projectionView = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);

    const effectivelyVisible = (object) => {
      let current = object;
      while (current) {
        if (!current.visible) return false;
        current = current.parent;
      }
      return true;
    };

    const aggregate = (root, key) => {
      const materials = new Set();
      const geometries = new Set();
      const textures = new Set();
      const names = {};
      let meshes = 0;
      let visibleMeshes = 0;
      let cameraFrustumMeshes = 0;
      let shadowCasters = 0;
      let visibleShadowCasters = 0;
      let triangles = 0;
      let visibleTriangles = 0;
      let cameraFrustumTriangles = 0;
      let instances = 0;
      root.traverse((object) => {
        if (!object.isMesh) return;
        meshes += 1;
        const visible = effectivelyVisible(object);
        if (visible) visibleMeshes += 1;
        const count = object.geometry?.index?.count ?? object.geometry?.attributes?.position?.count ?? 0;
        const instanceCount = object.isInstancedMesh ? object.count : 1;
        const tri = count / 3 * instanceCount;
        const inCameraFrustum = visible
          && object.layers.test(camera.layers)
          && (!object.frustumCulled || frustum.intersectsObject(object));
        triangles += tri;
        instances += instanceCount;
        if (visible) visibleTriangles += tri;
        if (inCameraFrustum) {
          cameraFrustumMeshes += 1;
          cameraFrustumTriangles += tri;
        }
        if (object.castShadow) shadowCasters += 1;
        if (visible && object.castShadow) visibleShadowCasters += 1;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value.uuid);
          }
        }
        const name = object.name || '(unnamed mesh)';
        names[name] = (names[name] || 0) + 1;
      });
      return {
        key,
        type: root.type,
        name: root.name || null,
        visible: root.visible,
        meshes,
        visibleMeshes,
        cameraFrustumMeshes,
        shadowCasters,
        visibleShadowCasters,
        instances,
        triangles: Math.round(triangles),
        visibleTriangles: Math.round(visibleTriangles),
        cameraFrustumTriangles: Math.round(cameraFrustumTriangles),
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
        directChildren: root.children.length,
        worldPosition: root.getWorldPosition(new THREE.Vector3()).toArray(),
        commonMeshNames: Object.entries(names)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([name, count]) => ({ name, count })),
      };
    };

    const topLevel = scene.children.map((child, index) => aggregate(
      child,
      `${index}:${child.name || child.type}`,
    )).sort((a, b) => b.visibleTriangles - a.visibleTriangles);
    const named = [];
    scene.traverse((object) => {
      if (!object.name || object === scene) return;
      const item = aggregate(object, object.name);
      if (item.meshes > 0) named.push(item);
    });
    named.sort((a, b) => b.visibleTriangles - a.visibleTriangles || b.visibleMeshes - a.visibleMeshes);

    const clubhouse = app.scene3d.clubhouse();
    const interiorChildren = clubhouse?.interior?.children?.map((child, index) => aggregate(
      child,
      `${index}:${child.name || child.type}`,
    )).sort((a, b) => b.visibleShadowCasters - a.visibleShadowCasters
      || b.cameraFrustumMeshes - a.cameraFrustumMeshes
      || b.visibleMeshes - a.visibleMeshes) || [];
    const customerRoot = scene.children.find((child) => {
      let found = false;
      child.traverse((object) => { if (object.userData?.customerId) found = true; });
      return found;
    });
    const customerActors = customerRoot?.children?.map((child, index) => aggregate(
      child,
      `${index}:${child.userData?.customerId || child.name || child.type}`,
    )) || [];

    const lights = [];
    scene.traverse((object) => {
      if (!object.isLight) return;
      lights.push({
        type: object.type,
        name: object.name || null,
        visible: effectivelyVisible(object),
        intensity: object.intensity,
        castShadow: object.castShadow,
        position: object.getWorldPosition(new THREE.Vector3()).toArray(),
      });
    });

    const renderFrames = [];
    const oldAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    for (let index = 0; index < 10; index += 1) {
      renderer.info.reset();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      renderFrames.push({
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        lines: renderer.info.render.lines,
      });
    }

    const sampleRender = async () => {
      renderer.info.reset();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    };
    const renderAttribution = [];
    const measureMutation = async (label, apply, restore) => {
      apply();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      renderAttribution.push({ label, ...(await sampleRender()) });
      restore();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };

    const placeablesRoot = scene.getObjectByName('ClubhousePlaceables');
    if (placeablesRoot) await measureMutation(
      'without-placeables',
      () => { placeablesRoot.visible = false; },
      () => { placeablesRoot.visible = true; },
    );

    const directInteriorAncestor = (object) => {
      let current = object;
      while (current?.parent && current.parent !== clubhouse?.interior) current = current.parent;
      return current?.parent === clubhouse?.interior ? current : null;
    };
    const deliveryRoot = directInteriorAncestor(scene.getObjectByName('delivery_worktable'));
    if (deliveryRoot) await measureMutation(
      'without-delivery-fixtures',
      () => { deliveryRoot.visible = false; },
      () => { deliveryRoot.visible = true; },
    );
    if (customerRoot) await measureMutation(
      'without-customers',
      () => { customerRoot.visible = false; },
      () => { customerRoot.visible = true; },
    );

    const shadowMeshes = [];
    scene.traverse((object) => { if (object.isMesh && object.castShadow) shadowMeshes.push(object); });
    await measureMutation(
      'without-shadows',
      () => { renderer.shadowMap.enabled = false; },
      () => { renderer.shadowMap.enabled = true; },
    );
    if (app.scene3d.post?.gtao) {
      const before = app.scene3d.post.gtao.enabled;
      await measureMutation(
        'without-gtao',
        () => { app.scene3d.post.gtao.enabled = false; },
        () => { app.scene3d.post.gtao.enabled = before; },
      );
      if (placeablesRoot) await measureMutation(
        'without-gtao-or-placeables',
        () => {
          app.scene3d.post.gtao.enabled = false;
          placeablesRoot.visible = false;
        },
        () => {
          app.scene3d.post.gtao.enabled = before;
          placeablesRoot.visible = true;
        },
      );
      await measureMutation(
        'without-gtao-or-shadows',
        () => {
          app.scene3d.post.gtao.enabled = false;
          renderer.shadowMap.enabled = false;
        },
        () => {
          app.scene3d.post.gtao.enabled = before;
          renderer.shadowMap.enabled = true;
        },
      );
      if (placeablesRoot) await measureMutation(
        'without-gtao-shadows-or-placeables',
        () => {
          app.scene3d.post.gtao.enabled = false;
          renderer.shadowMap.enabled = false;
          placeablesRoot.visible = false;
        },
        () => {
          app.scene3d.post.gtao.enabled = before;
          renderer.shadowMap.enabled = true;
          placeablesRoot.visible = true;
        },
      );
    }
    if (app.scene3d.post?.bloom) {
      const before = app.scene3d.post.bloom.enabled;
      await measureMutation(
        'without-bloom',
        () => { app.scene3d.post.bloom.enabled = false; },
        () => { app.scene3d.post.bloom.enabled = before; },
      );
    }
    if (clubhouse?.interior) await measureMutation(
      'without-clubhouse-interior',
      () => { clubhouse.interior.visible = false; },
      () => { clubhouse.interior.visible = true; },
    );
    renderer.info.autoReset = oldAutoReset;
    renderer.info.reset();

    return {
      renderer: {
        frames: renderFrames,
        attribution: renderAttribution,
        memory: { ...renderer.info.memory },
      },
      camera: {
        position: camera.position.toArray(),
        rotation: camera.rotation.toArray().slice(0, 3),
        near: camera.near,
        far: camera.far,
      },
      scene: aggregate(scene, 'scene'),
      topLevel,
      interiorChildren,
      customerRoot: customerRoot ? aggregate(customerRoot, 'customers') : null,
      customerActors,
      lights,
      namedTopByTriangles: named.slice(0, 100),
      namedTopByMeshes: [...named]
        .sort((a, b) => b.visibleMeshes - a.visibleMeshes || b.visibleTriangles - a.visibleTriangles)
        .slice(0, 100),
      heapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });

  report.label = label;
  report.url = url;
  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  report.passed = consoleErrors.length === 0 && pageErrors.length === 0;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    passed: report.passed,
    label,
    renderer: report.renderer,
    scene: report.scene,
    topLevel: report.topLevel.slice(0, 20),
    namedTopByTriangles: report.namedTopByTriangles.slice(0, 20),
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
