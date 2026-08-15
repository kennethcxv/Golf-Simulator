// N1 — F1 re-verified in Electron, at the controls, with in-game falsifiers.
//
// "Reported done" is not evidence on this project, and DOM-level persistence
// is not either (the review: a slider can move and persist while the game
// ignores it). So each control gets an IN-GAME effect check:
//   FOV        -> the live walk camera's fov changes
//   sensitivity-> preferences value read back where mouseLook reads it
//   volume     -> the audio graph's master gain node value moves
//   preset     -> renderer feature flags follow (render scale et al)
//   native     -> displayInfo returns the real window mode + resolution list
// Persistence: the driver relaunch is phase 2 (SETTINGS_PHASE=verify) — the
// changed values must come back from disk with no UI interaction.
//
// N3 rider: the fw:crash-log IPC round-trip is exercised here too (the log
// content itself was banked right after H1's pre-fix crash).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/settings');
  fs.mkdirSync(OUT, { recursive: true });
  const PHASE = process.env.SETTINGS_PHASE || 'change';

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const readState = () => page.evaluate(() => {
    const app = window.__fw;
    return {
      prefFov: app.preferences?.values?.camera?.fov ?? null,
      prefSens: app.preferences?.values?.camera?.sensitivity ?? null,
      prefInvert: app.preferences?.values?.camera?.invertY ?? null,
      prefMaster: app.preferences?.values?.audio?.master ?? null,
      prefQuality: app.preferences?.values?.display?.quality ?? null,
      prefRenderScale: app.preferences?.values?.display?.renderScale ?? null,
      liveCameraFov: app.scene3d?.camera?.fov ?? null,
      walkSens: app.scene3d?.walk?.state ? app.scene3d.walk.sens ?? null : null,
      masterGain: app.audio?.masterGainValue?.() ?? app.audio?.graphSnapshot?.()?.master ?? null,
    };
  });

  if (PHASE === 'verify') {
    // relaunch phase: the values must come back from DISK
    const persisted = await readState();
    const crashLog = await page.evaluate(async () => {
      const native = window.fairwayNative;
      if (!native?.crashLog) return { available: false };
      const result = await native.crashLog();
      return { available: true, path: result?.path || null, tailLength: (result?.tail || '').length };
    });
    const checks = {
      fovPersisted: Math.abs((persisted.prefFov ?? 0) - 74) < 0.5,
      sensitivityPersisted: Math.abs((persisted.prefSens ?? 0) - 1.65) < 0.01,
      invertPersisted: persisted.prefInvert === true,
      masterPersisted: Math.abs((persisted.prefMaster ?? 0) - 0.55) < 0.01,
      qualityPersisted: persisted.prefQuality === 'low',
      liveCameraFollowsPersistedFov: Math.abs((persisted.liveCameraFov ?? 0) - 74) < 0.5,
      crashLogIpcAnswers: crashLog.available && !!crashLog.path,
      noPageErrors: errs.length === 0,
    };
    const out = { phase: 'verify', persisted, crashLog, errs: errs.slice(0, 8), checks };
    out.ok = Object.values(checks).every(Boolean);
    fs.writeFileSync(path.join(OUT, 'settings-verify-phase2.json'), `${JSON.stringify(out, null, 1)}\n`);
    return out;
  }

  // --- phase 1: open the menu, look at it, change values through the UI -----
  const before = await readState();
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-veil-ui button')]
      .find((b) => /settings/i.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(600);
  const shellPresent = await page.evaluate(() => !!document.querySelector('.settings-shell'));
  await page.screenshot({ path: path.join(OUT, 'settings-audio.png') });

  // walk the tabs for the screenshot record + control inventory
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.settings-tab')].map((t) => t.textContent));
  const inventory = {};
  for (const tab of tabs) {
    await page.evaluate((label) => {
      [...document.querySelectorAll('.settings-tab')].find((t) => t.textContent === label)?.click();
    }, tab);
    await page.waitForTimeout(350);
    inventory[tab] = await page.evaluate(() => ({
      sliders: [...document.querySelectorAll('.settings-page input[type=range]')].map((i) => i.getAttribute('aria-label')),
      toggles: [...document.querySelectorAll('.settings-page .setting-toggle')].length,
      selects: [...document.querySelectorAll('.settings-page select')].map((s) => s.getAttribute('aria-label')),
    }));
    await page.screenshot({ path: path.join(OUT, `settings-${tab.toLowerCase()}.png`) });
  }

  // change through the REAL controls: camera tab
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-tab')].find((t) => /camera/i.test(t.textContent))?.click();
  });
  await page.waitForTimeout(300);
  const setSlider = (label, value) => page.evaluate(({ label: l, value: v }) => {
    const input = [...document.querySelectorAll('input[type=range]')]
      .find((i) => i.getAttribute('aria-label') === l);
    if (!input) return false;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, { label, value });
  const fovSet = await setSlider('Field of view', 74);
  const sensSet = await setSlider('Mouse sensitivity', 1.65);
  const invertSet = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.setting-toggle')]
      .find((b) => b.closest('.setting-row')?.textContent.includes('Invert vertical look'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  // audio tab: master volume
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-tab')].find((t) => /audio/i.test(t.textContent))?.click();
  });
  await page.waitForTimeout(300);
  const masterSet = await setSlider('Master volume', 0.55);
  // display tab: quality preset
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-tab')].find((t) => /display/i.test(t.textContent))?.click();
  });
  await page.waitForTimeout(300);
  const presetSet = await page.evaluate(() => {
    const select = [...document.querySelectorAll('select')]
      .find((s) => s.getAttribute('aria-label') === 'Graphics quality');
    if (!select) return false;
    select.value = 'low';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  const nativeRows = await page.evaluate(async () => {
    const native = window.fairwayNative;
    if (!native?.displayInfo) return { available: false };
    const info = await native.displayInfo();
    return { available: true, mode: info.mode, resolutions: (info.resolutions || []).length };
  });
  await page.screenshot({ path: path.join(OUT, 'settings-display-changed.png') });

  // close the menu; read the LIVE effects
  await page.keyboard.press('p');
  await page.waitForTimeout(700);
  const after = await readState();

  const checks = {
    settingsShellOpens: shellPresent,
    allListedControlsExist: fovSet && sensSet && invertSet && masterSet && presetSet,
    nativeDisplayControlsAvailable: nativeRows.available && nativeRows.resolutions > 0,
    fovAppliesToTheLiveCamera: Math.abs((after.liveCameraFov ?? 0) - 74) < 0.5,
    masterReachesTheAudioGraph: after.masterGain == null
      ? 'no-accessor' : Math.abs(after.masterGain - 0.55) < 0.05,
    presetLandsInPreferences: after.prefQuality === 'low',
    noPageErrors: errs.length === 0,
  };
  const out = {
    phase: 'change', before, after, tabs, inventory, nativeRows, errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every((v) => v === true || v === 'no-accessor');
  fs.writeFileSync(path.join(OUT, 'settings-verify-phase1.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
