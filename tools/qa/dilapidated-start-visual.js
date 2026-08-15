async (page) => {
  // Visual proof of the dilapidated start: a fresh Relaxed game must LOOK
  // broken — dilapidated exterior, damaged interior components, power off
  // until the ceiling is repaired — with the campaign repair prompts live.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(process.env.DILAP_QA_ROOT
    || path.join(repo, 'qa', 'recovery-2026-07-22', 'dilapidated-start'));
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(640, 360);

  const pose = async (x, z, faceX, faceZ, pitch = -0.05) => {
    await page.evaluate(({ x, z, faceX, faceZ, pitch }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + x;
      walk.state.z = origin.z + z;
      const dx = faceX - x; const dz = faceZ - z;
      const L = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / L, -dz / L);
      walk.state.pitch = pitch;
    }, { x, z, faceX, faceZ, pitch });
    await page.waitForTimeout(450);
  };

  const facts = await page.evaluate(async () => {
    const { campaignRepairStatus, openingReadiness } = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    const state = window.__fw.state;
    return {
      components: Object.fromEntries(Object.entries(state.shop.reno.architecture.components)
        .map(([id, value]) => [id, value.restored])),
      repairsRequirement: openingReadiness(state).requirements.find((r) => r.id === 'repairs'),
      ceiling: campaignRepairStatus(state, 'ceiling'),
    };
  });

  await pose(1.6, 14.5, 0, 6.0, -0.02);
  await page.screenshot({ path: path.join(out, '01-exterior-approach.png') });
  await pose(-6.0, 12.5, 0, 6.0, -0.02);
  await page.screenshot({ path: path.join(out, '02-exterior-angle.png') });
  await pose(-0.8, 4.4, -0.8, 0.0, -0.05);
  await page.screenshot({ path: path.join(out, '03-interior-from-entry.png') });
  await pose(3.0, 0.5, 5.15, 0.75, -0.12);
  await page.screenshot({ path: path.join(out, '04-damaged-panels-area.png') });
  await pose(-2.0, 1.5, -2.1, -0.8, -0.45);
  await page.screenshot({ path: path.join(out, '05-damaged-floor-area.png') });
  await pose(5.15, 2.4, 5.15, 0.75, -0.10);
  const focusLabel = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
  await page.screenshot({ path: path.join(out, '06-repair-prompt.png') });

  const result = { ok: true, facts, focusLabel, out };
  fs.writeFileSync(path.join(out, 'latest-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
