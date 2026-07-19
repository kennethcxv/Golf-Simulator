async (page) => {
  // Browser acceptance for the player-facing save recovery boundary. Fixture
  // code damages storage; Continue remains a normal visible button click.
  const fs = process.getBuiltinModule('node:fs');
  const outputDir = process.env.SAVE_STABILITY_OUTPUT_DIR || 'qa/save-stability/runtime';
  fs.mkdirSync(outputDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const result = {
    ok: false,
    protocol: {
      baseUrl,
      outputDir,
      route: 'visible Continue button for backup recovery, future-version refusal, and unrecoverable corruption',
      storage: 'browser localStorage primary + previous-valid backup',
    },
    scenarios: {},
    checks: [],
    screenshots: [],
    diagnostics: { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] },
  };
  let phase = 'setup';
  page.on('console', (message) => {
    const entry = { phase, text: message.text() };
    if (message.type() === 'error') result.diagnostics.consoleErrors.push(entry);
    else if (message.type() === 'warning') result.diagnostics.consoleWarnings.push(entry);
  });
  page.on('pageerror', (error) => result.diagnostics.pageErrors.push({ phase, text: error.message }));
  page.on('requestfailed', (request) => result.diagnostics.requestFailures.push({
    phase,
    url: request.url(),
    errorText: request.failure()?.errorText || 'unknown',
  }));

  const capture = async (name) => {
    const path = `${outputDir}/${name}.png`;
    await page.screenshot({ path });
    result.screenshots.push(path);
  };
  const waitForContinue = async () => {
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => entry.textContent.trim() === 'Continue');
      return !!button && !button.disabled;
    }, null, { timeout: 20000 });
  };
  const continueAndToast = async (expectedText) => {
    const button = page.getByRole('button', { name: 'Continue', exact: true });
    await button.click();
    const toast = page.locator('.toast').filter({ hasText: expectedText }).last();
    await toast.waitFor({ state: 'visible', timeout: 30000 });
    return toast.textContent();
  };
  const check = (id, ok, actual, expected) => {
    result.checks.push({ id, ok: !!ok, actual, expected });
  };

  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForContinue();
    const valid = await page.evaluate(() => localStorage.getItem('golfempire:autosave'));
    if (!valid) throw new Error('The --bootstrap autosave was not present.');

    phase = 'backup-recovery';
    await page.evaluate((text) => {
      localStorage.setItem('golfempire-backup:autosave', text);
      // `null` is valid JSON but never a valid Golf Flipper save root. It must
      // not mask the previous valid backup.
      localStorage.setItem('golfempire:autosave', 'null');
    }, valid);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await capture('save-recovery-backup-before');
    await waitForContinue();
    const backupToast = await continueAndToast(/Autosave.*previous valid backup/i);
    await capture('save-recovery-backup-notice');
    await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.state,
      null, { timeout: 90000 });
    const backupState = await page.evaluate((text) => ({
      primaryMatchesBackup: localStorage.getItem('golfempire:autosave') === text,
      parsed: JSON.parse(localStorage.getItem('golfempire:autosave'))?.empireVersion,
      screen: window.__fw.screen,
    }), valid);
    result.scenarios.backupRecovery = { toast: backupToast, ...backupState };
    check('backup-recovery-notice', /previous valid backup/i.test(backupToast),
      backupToast, 'notice names the previous valid backup');
    check('backup-repaired-primary', backupState.primaryMatchesBackup,
      backupState.primaryMatchesBackup, true);
    check('backup-loaded-game', backupState.screen === 'game', backupState.screen, 'game');

    phase = 'manual-slot-backup-discovery';
    await page.evaluate((text) => {
      localStorage.removeItem('golfempire:slot1');
      localStorage.setItem('golfempire-backup:slot1', text);
      localStorage.removeItem('golfempire:slot1-meta');
      localStorage.removeItem('golfempire-backup:slot1-meta');
    }, valid);
    await page.keyboard.press('Escape');
    await page.locator('.pause-panel').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Load game', exact: true }).click();
    const slotOne = page.locator('.slot-card').filter({ hasText: 'Slot 1' });
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('.slot-card')]
        .find((entry) => /Slot 1/.test(entry.textContent || ''));
      const button = card?.querySelector('button');
      return !!card && /Save found.*details unavailable/i.test(card.textContent || '')
        && !!button && !button.disabled;
    }, null, { timeout: 10000 });
    await capture('save-recovery-manual-slot-discovered');
    await slotOne.getByRole('button', { name: 'Load', exact: true }).click();
    const manualNotice = page.locator('.toast')
      .filter({ hasText: /Slot 1.*previous valid backup/i }).last();
    await manualNotice.waitFor({ state: 'visible', timeout: 30000 });
    const manualToast = await manualNotice.textContent();
    await capture('save-recovery-manual-slot-notice');
    await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.state,
      null, { timeout: 90000 });
    const manualState = await page.evaluate((text) => ({
      primaryMatchesBackup: localStorage.getItem('golfempire:slot1') === text,
      screen: window.__fw.screen,
    }), valid);
    result.scenarios.manualSlotBackupDiscovery = { toast: manualToast, ...manualState };
    check('manual-slot-without-metadata-discovered', true,
      'visible enabled Load button and fallback details', 'visible enabled Load button');
    check('manual-slot-backup-notice', /previous valid backup/i.test(manualToast),
      manualToast, 'notice names the previous valid backup');
    check('manual-slot-primary-repaired', manualState.primaryMatchesBackup,
      manualState.primaryMatchesBackup, true);
    check('manual-slot-loaded-game', manualState.screen === 'game', manualState.screen, 'game');

    phase = 'future-version-backup-refusal';
    const futureBackup = await page.evaluate((text) => {
      const value = JSON.parse(text);
      value.empireVersion += 100;
      const encoded = JSON.stringify(value);
      const primary = '{damaged-primary';
      localStorage.setItem('golfempire:autosave', primary);
      localStorage.setItem('golfempire-backup:autosave', encoded);
      return { primary, backup: encoded };
    }, valid);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForContinue();
    const futureBackupToast = await continueAndToast(/Autosave.*newer build/i);
    await capture('save-recovery-future-backup-refused');
    const futureBackupState = await page.evaluate((expected) => ({
      unchanged: localStorage.getItem('golfempire:autosave') === expected.primary
        && localStorage.getItem('golfempire-backup:autosave') === expected.backup,
      menuVisible: getComputedStyle(document.querySelector('.menu-screen')).display !== 'none',
      screen: window.__fw?.screen || null,
    }), futureBackup);
    result.scenarios.futureBackupRefusal = { toast: futureBackupToast, ...futureBackupState };
    check('future-backup-version-notice', /newer build.*not changed/i.test(futureBackupToast),
      futureBackupToast, 'newer backup refusal explicitly says the save was not changed');
    check('future-backup-bytes-unchanged', futureBackupState.unchanged,
      futureBackupState.unchanged, true);
    check('future-backup-stays-menu', futureBackupState.menuVisible
        && futureBackupState.screen === 'menu',
      futureBackupState, 'menu remains active');

    phase = 'future-version-refusal';
    const future = await page.evaluate((text) => {
      const value = JSON.parse(text);
      value.empireVersion += 100;
      const encoded = JSON.stringify(value);
      localStorage.setItem('golfempire:autosave', encoded);
      localStorage.removeItem('golfempire-backup:autosave');
      return encoded;
    }, valid);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForContinue();
    const futureToast = await continueAndToast(/Autosave.*newer build/i);
    await capture('save-recovery-future-refused');
    const futureState = await page.evaluate((encoded) => ({
      unchanged: localStorage.getItem('golfempire:autosave') === encoded,
      menuVisible: getComputedStyle(document.querySelector('.menu-screen')).display !== 'none',
      screen: window.__fw?.screen || null,
    }), future);
    result.scenarios.futureRefusal = { toast: futureToast, ...futureState };
    check('future-version-notice', /newer build.*not changed/i.test(futureToast),
      futureToast, 'newer build refusal explicitly says the save was not changed');
    check('future-version-unchanged', futureState.unchanged, futureState.unchanged, true);
    check('future-version-stays-menu', futureState.menuVisible && futureState.screen === 'menu',
      futureState, 'menu remains active');

    phase = 'unrecoverable-corruption';
    const damaged = await page.evaluate(() => {
      const primary = '{not-json';
      const backup = '[also-not-json';
      localStorage.setItem('golfempire:autosave', primary);
      localStorage.setItem('golfempire-backup:autosave', backup);
      return { primary, backup };
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForContinue();
    const damagedToast = await continueAndToast(/Autosave.*damaged/i);
    await capture('save-recovery-unrecoverable');
    const damagedState = await page.evaluate((expected) => ({
      unchanged: localStorage.getItem('golfempire:autosave') === expected.primary
        && localStorage.getItem('golfempire-backup:autosave') === expected.backup,
      menuVisible: getComputedStyle(document.querySelector('.menu-screen')).display !== 'none',
      screen: window.__fw?.screen || null,
    }), damaged);
    result.scenarios.unrecoverableCorruption = { toast: damagedToast, ...damagedState };
    check('unrecoverable-notice', /damaged.*no valid backup/i.test(damagedToast),
      damagedToast, 'damage and missing valid backup are explicit');
    check('unrecoverable-unchanged', damagedState.unchanged, damagedState.unchanged, true);
    check('unrecoverable-stays-menu', damagedState.menuVisible && damagedState.screen === 'menu',
      damagedState, 'menu remains active');
  } catch (error) {
    result.failure = { phase, message: error?.message || String(error), stack: error?.stack || null };
  }

  const unexpectedRequests = result.diagnostics.requestFailures
    .filter((entry) => entry.errorText !== 'net::ERR_ABORTED');
  check('functional-route', !result.failure, result.failure || null, null);
  check('console-errors', result.diagnostics.consoleErrors.length === 0,
    result.diagnostics.consoleErrors, []);
  check('page-errors', result.diagnostics.pageErrors.length === 0,
    result.diagnostics.pageErrors, []);
  check('unexpected-request-failures', unexpectedRequests.length === 0, unexpectedRequests, []);
  result.ok = result.checks.every((entry) => entry.ok);
  return result;
}
