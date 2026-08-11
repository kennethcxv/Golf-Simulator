// 1B (Goal 22) — THE CLIP. A stranger's whole route in, recorded.
//
// The cold-walk driver proves the mechanics; this one proves the EXPERIENCE,
// because Section 1's subject is a person who could not find the way in and a
// number cannot show that. Two things it does that the mechanics driver does
// not:
//
//   * it CLICKS FIRST, to take pointer lock. The focus prompt is gated on
//     `document.pointerLockElement` (main.js), so a driver that only presses
//     keys walks the whole way with no "[E] open both" on screen and records a
//     frame that misrepresents what a player sees. That is not a game defect;
//     it is a driver that was not playing the game.
//   * it moves slowly and pauses on each beat, so the extracted frames land on
//     the approach, the prompt, the doors swinging and the threshold rather
//     than between them.
//
//   VIDEO_DIR=qa/clips/walk-in node tools/qa/run-electron.cjs \
//     tools/qa/electron-1b-walk-in-clip.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/1b-walk-in-clip');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // CLICK TO LOOK — this is the first thing the control bar tells a player to
  // do, and until it happens the game deliberately shows no focus prompt.
  await page.mouse.click(800, 450);
  await page.waitForTimeout(1200);
  const locked = await page.evaluate(() => !!document.pointerLockElement);

  const beat = async (label, ms = 1200) => {
    await page.waitForTimeout(ms);
    const s = await page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d?.clubhouse?.();
      const w = app.scene3d.walk.state;
      // `.shop-prompt` is the element main.js writes the focus label into.
      // Three wrong guesses in one session (.objectives-panel, .prompt,
      // .walk-prompt) all reported "not on screen" about a HUD that was drawing
      // fine — a selector that matches nothing is indistinguishable from a
      // feature that renders nothing, and both come back false.
      // `.shop-prompt` is the element main.js writes the focus label into.
      // Three wrong guesses in one session (.objectives-panel, .prompt,
      // .walk-prompt) all reported "not on screen" about a HUD that was drawing
      // fine — a selector matching nothing is indistinguishable from a feature
      // rendering nothing, and both come back false.
      //
      // And elementFromPoint — the instrument that finally caught X3's card
      // behind the canvas — is the WRONG question here, which cost a fourth
      // false negative. It reports the topmost element that ACCEPTS POINTER
      // EVENTS, so any HUD layer carrying `pointer-events: none` answers with
      // the canvas underneath and reads as unpainted. It proves paint only for
      // hit-testable elements. The prompt is not one; the frames at 22.75-24 s
      // of qa/clips/walk-in show it drawn and legible while this test said
      // false. So ask what actually governs THIS element: main.js gates the
      // prompt purely on `label && document.pointerLockElement` via opacity.
      const promptEl = document.querySelector('.shop-prompt');
      let promptVisible = false;
      if (promptEl) {
        const r = promptEl.getBoundingClientRect();
        const cs = getComputedStyle(promptEl);
        const hasText = (promptEl.innerText || '').trim().length > 0;
        const onCanvas = r.width > 0 && r.height > 0
          && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        promptVisible = hasText && cs.opacity !== '0' && cs.visibility !== 'hidden'
          && cs.display !== 'none' && onCanvas;
      }
      return {
        z: +w.z.toFixed(2),
        inside: !!ch?.isInside?.(w.x, w.z),
        focus: app.scene3d.walk.getFocusLabel?.() || '',
        promptOnScreen: promptVisible,
        promptText: (promptEl?.innerText || '').trim().slice(0, 120),
        promptFound: !!promptEl,
        atMs: Math.round(performance.now()),
      };
    });
    s.beat = label;
    return s;
  };

  const beats = [];
  beats.push(await beat('standing at spawn', 1500));

  // walk in, in short steps, pausing so the frames land on something
  let sawDoorPrompt = null;
  let crossed = null;
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    const s = await beat(`walk-${i}`, 500);
    beats.push(s);
    if (!sawDoorPrompt && /Shop doors/.test(s.focus)) sawDoorPrompt = s;
    if (/Shop doors.*open both/.test(s.focus)) break;
  }

  // stand and read the prompt for a beat, the way a player does
  beats.push(await beat('reading the door prompt', 2000));

  await page.keyboard.press('e');
  beats.push(await beat('doors opening', 2200));

  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(650);
    await page.keyboard.up('w');
    const s = await beat(`step-in-${i}`, 400);
    beats.push(s);
    if (s.inside && !crossed) { crossed = s; break; }
  }
  beats.push(await beat('standing inside', 2500));
  // turn and look back at the door we came through
  await page.mouse.move(800, 450);
  for (let i = 0; i < 24; i += 1) {
    await page.mouse.move(800 + i * 30, 450, { steps: 1 });
    await page.waitForTimeout(30);
  }
  beats.push(await beat('looking back from inside', 2000));

  const out = {
    locked, beats, sawDoorPrompt, crossed, errs,
    checks: {
      pointerLocked: locked === true,
      doorPromptAppeared: sawDoorPrompt !== null,
      promptWasOnScreen: beats.some((b) => b.promptOnScreen && /Shop doors/.test(b.focus)),
      crossedTheThreshold: crossed !== null,
      noPageErrors: errs.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'walk-in-clip.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
