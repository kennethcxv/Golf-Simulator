// F3 — prove the crash path in the shipping shell.
//
// Three things have to be true, and each is checked by DOING it rather than by
// reading the handler:
//   1. a thrown renderer error reaches the native log (the bridge answers with
//      the path it wrote to),
//   2. the player gets a panel that says what happened and offers a reload —
//      not a frozen picture,
//   3. a storm of the SAME error is rate-limited, so a per-frame throw cannot
//      fill the disk or stack a hundred panels.
//
// The negative control: before throwing anything, assert the panel is NOT on
// screen. A test that only ever looks after the fault cannot tell a working
// guard from a panel that is always there.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/crash-handling');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => window.__fw?.screen === 'menu', null, { timeout: 120000 });
  await page.waitForTimeout(800);

  const control = await page.evaluate(() => ({
    panelPresent: !!document.querySelector('.fault-panel'),
    bridge: {
      reportError: typeof window.fairwayNative?.reportError,
      crashLog: typeof window.fairwayNative?.crashLog,
    },
  }));

  // 1 + 2: a real uncaught error, thrown the way a broken frame would throw it.
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('FW_QA_DELIBERATE_FAULT'); }, 0);
  });
  await page.waitForTimeout(1200);
  const afterOne = await page.evaluate(() => {
    const panel = document.querySelector('.fault-panel');
    return {
      panelPresent: !!panel,
      panelText: panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 300) : null,
      reloadButton: !!document.querySelector('.fault-panel-reload'),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'fault-panel.png') });

  // 3: the storm. Same message, twenty times.
  await page.evaluate(() => {
    for (let i = 0; i < 20; i += 1) {
      setTimeout(() => { throw new Error('FW_QA_STORM'); }, 0);
    }
  });
  await page.waitForTimeout(1500);
  const afterStorm = await page.evaluate(() => ({
    panels: document.querySelectorAll('.fault-panel').length,
  }));

  const log = await page.evaluate(() => window.fairwayNative?.crashLog?.());
  const tail = String(log?.tail || '');
  fs.writeFileSync(path.join(OUT, 'crash-log-tail.txt'), tail);

  return {
    control,
    afterOne,
    afterStorm,
    logPath: log?.path || null,
    logMentionsDeliberateFault: tail.includes('FW_QA_DELIBERATE_FAULT'),
    logStormOccurrences: (tail.match(/FW_QA_STORM/g) || []).length,
    pass: control.panelPresent === false
      && afterOne.panelPresent === true
      && afterOne.reloadButton === true
      && afterStorm.panels === 1
      && tail.includes('FW_QA_DELIBERATE_FAULT'),
  };
}
