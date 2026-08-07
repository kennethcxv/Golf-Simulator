// A6 — THE RESOLUTION LIST, READ AS THE PLAYER READS IT.
//
// Goal 16's D1 already fixed the comparison at the IPC level and
// tools/qa/electron-d1-resolution.js checks it there. The brief lists A6 again,
// so this checks the layer D1 never did: the STRINGS AND DISABLED STATES the
// player actually sees in the settings panel.
//
// Why not a screenshot: the list is a native <select>, and Electron's
// capturePage cannot capture an OS-drawn dropdown popup. Collapsed, it shows
// one entry. A screenshot filed as evidence here would look identical on a
// fixed and a broken build - so the evidence is the rendered option text and
// the disabled flag, plus a screenshot of the Display PAGE (which is real DOM
// and does capture) for the surrounding copy.
//
// The negative control rides the marker file, the only channel measured to
// reach the main process (fault 54).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a6-reslist.js --clubhouse=pine-hills-v2
//   A6_TAG=fake1366   (with fw-fake-display.txt written first)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a6-reslist');
  fs.mkdirSync(OUT, { recursive: true });
  const TAG = process.env.A6_TAG || 'real';
  const out = { tag: TAG, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  await page.bringToFront().catch(() => {});

  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll('.pause-nav button, .pause-nav .nav-item, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent));
    nav?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 });
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.settings-tab')].find((t) => /display/i.test(t.textContent));
    tab?.click();
  });

  // The native rows arrive asynchronously (displayInfo is IPC). Waiting for the
  // select to EXIST is waiting for the first paint of the real content - which
  // is the paint the player's eye lands on, and the one a check that reads the
  // IPC payload instead would never see.
  await page.waitForFunction(() => {
    const sels = [...document.querySelectorAll('.settings-page select')];
    return sels.some((s) => [...s.options].some((o) => /\d{3,4}\s*×\s*\d{3,4}/.test(o.textContent)));
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);

  out.options = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.settings-page select')]
      .find((s) => [...s.options].some((o) => /\d{3,4}\s*×\s*\d{3,4}/.test(o.textContent)));
    if (!sel) return null;
    return [...sel.options].map((o) => ({
      text: o.textContent,
      disabled: o.disabled === true,
      value: o.value,
      selected: o.selected === true,
    }));
  });
  // The detail line beside the list reads a DIFFERENT field (workArea) from the
  // one that decides `fits`, so the two can disagree. Read it too.
  out.roomLine = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('.settings-page *')]
      .map((n) => n.textContent || '')
      .find((tx) => /This display has room for/.test(tx));
    return hit ? /This display has room for [^.]*\./.exec(hit)?.[0] ?? null : null;
  });
  out.displayInfo = await page.evaluate(
    () => window.fairwayNative?.displayInfo?.().catch(() => null) ?? null,
  );

  await page.screenshot({ path: path.join(OUT, `a6-${TAG}-display-page.png`) });

  const rows = out.options || [];
  const at = (w, h) => rows.find((r) => r.value === `${w}x${h}`) || null;
  const tooBig = (r) => !!r && /larger than this display/.test(r.text);
  out.verdict = {
    listRendered: rows.length > 0,
    // On the real 4K panel nothing at or below 4K may be greyed or captioned.
    fourKOffered: !!at(3840, 2160) && !at(3840, 2160).disabled && !tooBig(at(3840, 2160)),
    fourteenFortyOffered: !!at(2560, 1440) && !at(2560, 1440).disabled
      && !tooBig(at(2560, 1440)),
    // The control's expectation, inverted: on a 1366x768 display they MUST be
    // greyed with the reason.
    fourKRefused: !!at(3840, 2160) && at(3840, 2160).disabled && tooBig(at(3840, 2160)),
    fourteenFortyRefused: !!at(2560, 1440) && at(2560, 1440).disabled
      && tooBig(at(2560, 1440)),
    smallStillOffered: !!at(1280, 720) && !at(1280, 720).disabled,
    roomLine: out.roomLine,
    qaFakeDisplay: out.displayInfo?.qaFakeDisplay ?? null,
    physicalReported: out.displayInfo?.physical ?? null,
    noPageErrors: out.errs.length === 0,
  };
  fs.writeFileSync(path.join(OUT, `a6-${TAG}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`A6[${TAG}]`, JSON.stringify(out.verdict));
  console.log(`A6[${TAG}] options`, JSON.stringify(rows.map((r) => `${r.text}${r.disabled ? ' [DISABLED]' : ''}`)));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
