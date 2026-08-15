// Probe: why does the laptop not open on this save? Reports the rig, the
// campaign stage, and what the crosshair prompt says at both stands.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const probe = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const rig = ch.laptopRig ? ch.laptopRig() : null;
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    const laptop = L.FRONT_DESK.laptop;
    w.x = L.FRONT_DESK.staffChair.x + o.x;
    w.z = L.FRONT_DESK.staffChair.z + o.z;
    const dx = laptop.x - L.FRONT_DESK.staffChair.x;
    const dz = laptop.z - L.FRONT_DESK.staffChair.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / h, -dz / h);
    w.pitch = Math.atan2(1.06 - 1.62, h);
    return {
      hasRigFn: !!ch.laptopRig,
      rig: rig ? { hasObject: !!rig.object, visible: rig.object?.visible ?? null } : null,
      campaign: app.state.campaign ? {
        enabled: app.state.campaign.enabled,
        businessOpen: app.state.campaign.businessOpen,
        stage: app.state.campaign.stage || null,
      } : null,
      shopStage: app.state.shop?.progression || app.state.shop?.stage || null,
      variant: app.state.property?.clubhouseVariant || null,
      restoration: app.state.shop?.restoration
        ? Object.entries(app.state.shop.restoration).slice(0, 6) : null,
    };
  });
  await page.waitForTimeout(600);
  const promptBefore = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || null);
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    laptopOpen: window.__fw.laptopOpen,
    frontDeskOpen: window.__fw.frontDeskOpen,
    prompt: document.querySelector('.shop-prompt')?.textContent || null,
  }));
  console.log('A-MAIL-PROBE', JSON.stringify({ probe, promptBefore, after }));
}
