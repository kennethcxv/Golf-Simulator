// ROUND 7 — is the shadow-sampler GL error flood MINE?
//
// The tee-desk run filled the console with
//   GL_INVALID_OPERATION: Mismatch between texture format and sampler type
//   (signed/unsigned/float/shadow)
// until Chromium gave up reporting. That message is documented in this repo from
// 2026-07-17 and again at main.js:2259 as what a shadows-OFF toggle produces, so
// it is probably pre-existing -- but this session changed a SHADOW DEFINE
// (PCFSoftShadowMap resolved to SHADOWMAP_TYPE_BASIC for anything compiled
// before the first bake; PCFShadowMap now compiles SHADOWMAP_TYPE_PCF), and the
// owner had a GPU process loss two rounds ago. "Probably pre-existing" is not
// good enough for that.
//
// Boots, stands still, counts. Run it on this build and on a copy with the one
// line reverted; the difference is the answer.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-gl-error-count.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/gl-error-count');
  fs.mkdirSync(OUT, { recursive: true });
  const label = process.env.LABEL || 'current';
  const out = { label, gl: 0, tooMany: 0, samples: [], other: 0 };
  page.on('console', (m) => {
    const text = String(m.text());
    if (/Mismatch between texture format and sampler type/.test(text)) {
      out.gl += 1;
      if (out.samples.length < 3) out.samples.push(text.slice(0, 160));
    } else if (/too many errors/.test(text)) out.tooMany += 1;
    else if (/GL_INVALID/.test(text)) out.other += 1;
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(12000); // stand still and let any per-draw flood accumulate

  out.shadow = await page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    return { enabled: r.shadowMap.enabled, type: r.shadowMap.type, autoUpdate: r.shadowMap.autoUpdate };
  });
  out.settingsShadows = await page.evaluate(() => {
    try { return window.__fw.settings?.values?.()?.display?.shadows ?? null; } catch { return 'unavailable'; }
  });
  fs.writeFileSync(path.join(OUT, `gl-${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('GL-ERRORS', JSON.stringify({
    label, mismatchErrors: out.gl, tooManyErrors: out.tooMany, otherGl: out.other,
    shadow: out.shadow, settingsShadows: out.settingsShadows, sample: out.samples[0] || null,
  }, null, 2));
  return out;
}
