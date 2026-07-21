async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const fixtureId = 'municipal_qa_player_worktable';

  async function waitReady() {
    await page.waitForFunction(async () => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const municipal = clubhouse?.course1Municipal;
      if (!municipal || (clubhouse.assetsReady && !clubhouse.assetsReady())) return false;
      try { await municipal.ready; } catch { return false; }
      return municipal.diagnostics?.().ready === true;
    }, null, { timeout: 90000 });
    // Continue can replace the first scene instance while it finalizes the
    // loaded autosave. Require the settled instance to remain ready as well.
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.course1Municipal?.diagnostics?.().ready === true
    ), null, { timeout: 90000 });
  }

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitReady();
  const before = await page.evaluate(() => ({
    architecture: JSON.parse(JSON.stringify(window.__fw.state.shop.reno.architecture)),
    inventory: JSON.parse(JSON.stringify(window.__fw.state.shop.inventory)),
    municipal: window.__fw.scene3d.clubhouse().course1Municipal.diagnostics(),
  }));

  await page.evaluate(async (id) => {
    const app = window.__fw;
    const layout = app.state.shop.layout || (app.state.shop.layout = {});
    layout.moved ||= {};
    layout.stored ||= [];
    layout.extra ||= [];
    layout.extra = layout.extra.filter((fixture) => fixture.id !== id);
    layout.extra.push({
      id,
      kind: 'table',
      x: -2.0,
      z: 0.0,
      ry: 0,
      skus: [],
      title: 'Player worktable',
      zone: 'player-custom',
    });
    await app.autosave();
  }, fixtureId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitReady();
  const after = await page.evaluate((id) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const anchor = [...clubhouse.interior.children].find((child) => (
      child.visible && Math.abs(child.position.x + 2) < 0.01 && Math.abs(child.position.z) < 0.01
    ));
    let visibleMeshes = 0;
    anchor?.traverse?.((object) => { if (object.isMesh && object.visible) visibleMeshes += 1; });
    return {
      architecture: JSON.parse(JSON.stringify(app.state.shop.reno.architecture)),
      inventory: JSON.parse(JSON.stringify(app.state.shop.inventory)),
      fixture: app.state.shop.layout?.extra?.find((entry) => entry.id === id) || null,
      anchorVisible: Boolean(anchor?.visible),
      visibleMeshes,
      municipal: clubhouse.course1Municipal.diagnostics(),
    };
  }, fixtureId);

  const architecturePreserved = JSON.stringify(before.architecture) === JSON.stringify(after.architecture);
  const inventoryPreserved = JSON.stringify(before.inventory) === JSON.stringify(after.inventory);
  return {
    ok: architecturePreserved
      && inventoryPreserved
      && after.fixture?.id === fixtureId
      && after.anchorVisible
      && after.visibleMeshes > 0
      && after.municipal.ready === true
      && after.municipal.interiorLease?.customFixtureCount === 1,
    architecturePreserved,
    inventoryPreserved,
    fixtureRoundTrip: after.fixture,
    anchorVisible: after.anchorVisible,
    visibleMeshes: after.visibleMeshes,
    beforeMunicipal: before.municipal,
    afterMunicipal: after.municipal,
  };
}
