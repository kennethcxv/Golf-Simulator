async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const diagnostics = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      diagnostics.push({ kind: message.type(), message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(async () => {
    const municipal = window.__fw?.scene3d?.clubhouse?.()?.course1Municipal;
    if (!municipal) return false;
    try { await municipal.ready; } catch { return false; }
    return municipal.diagnostics?.().ready === true;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(500);

  const runtime = await page.evaluate(async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const rawGltf = await new Promise((resolve, reject) => {
      new GLTFLoader().load(
        'vendor/models/course1_municipal/course1_municipal_clubhouse_architecture.glb',
        resolve,
        undefined,
        reject,
      );
    });
    const rawDoor = rawGltf.scene.getObjectByName('DOOR_MAIN_LEFT');
    const rawDoorDef = rawGltf.parser.json.nodes.find((node) => node.name === 'DOOR_MAIN_LEFT');
    const clubhouse = window.__fw.scene3d.clubhouse();
    const architecture = clubhouse.group.getObjectByName('Course1MunicipalClubhouseArchitecture');
    const read = (name) => {
      const object = architecture?.getObjectByName(name);
      if (!object) return null;
      object.updateWorldMatrix(true, true);
      object.geometry?.computeBoundingBox?.();
      const localBox = object.geometry?.boundingBox;
      return {
        name,
        visible: object.visible,
        position: object.position.toArray(),
        rotation: object.rotation.toArray().slice(0, 3),
        worldPosition: object.getWorldPosition(object.position.clone()).toArray(),
        localBounds: localBox ? { min: localBox.min.toArray(), max: localBox.max.toArray() } : null,
        children: object.children.map((child) => child.name),
        userData: object.userData,
      };
    };
    return {
      rawDoorPosition: rawDoor?.position?.toArray?.() || null,
      rawDoorTranslation: rawDoorDef?.translation || null,
      rawDoorTranslationTypes: rawDoorDef?.translation?.map((value) => typeof value) || null,
      diagnostics: clubhouse.course1Municipal.diagnostics(),
      interiorVisibleChildren: clubhouse.interior.children.filter((child) => child.visible).map((child) => child.name),
      doors: [
        'DOOR_MAIN_LEFT', 'DOOR_MAIN_RIGHT', 'DOOR_SERVICE_EAST',
        'DOOR_MAINTENANCE_BACK', 'DOOR_INTERIOR_EMPLOYEE',
        'DOOR_INTERIOR_OFFICE', 'DOOR_INTERIOR_RESTROOM', 'DOOR_INTERIOR_STORAGE',
      ].map(read),
    };
  });

  console.log(JSON.stringify({ ok: true, runtime, diagnostics }, null, 2));
}
