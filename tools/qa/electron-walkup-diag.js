// 2.1 staging diagnosis — where am I, what time is it, and is anyone here?
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));
  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  const btnText = await page.evaluate(() => document.querySelector('.menu-action-primary').textContent.trim().slice(0,60));
  console.log('PRIMARY-BUTTON', JSON.stringify(btnText));
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  const d = await page.evaluate(() => {
    const app = window.__fw; const s3 = app.scene3d; const ch = s3.clubhouse();
    const w = s3.walk.state;
    return {
      clockMinutes: app.state?.clock?.minutes ?? null,
      day: app.state?.clock ? Math.floor(app.state.clock.minutes/1440) : null,
      cash: app.state?.cash ?? null,
      hasRouteNetwork: !!app.state?.golfDay?.routeNetwork,
      player: { x:+w.x.toFixed(1), z:+w.z.toFixed(1) },
      interior: ch?.interior?.position ? { x:+ch.interior.position.x.toFixed(1), z:+ch.interior.position.z.toFixed(1) } : null,
      isInsideNow: ch?.isInside ? ch.isInside(w.x,w.z) : null,
      stations: (s3.walk.stations()||[]).map(s=>({x:+s.x.toFixed(1),z:+s.z.toFixed(1),label:s.label||s.name||null})),
      customers: (ch?.qaCustomerTrack?.()||[]).length,
      footfall: ch?.footfallDiagnostics ? ch.footfallDiagnostics() : null,
      shopOpen: app.state?.shop?.open ?? null,
    };
  });
  console.log('DIAG', JSON.stringify(d, null, 2));
  return d;
}
