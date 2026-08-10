// FREE-PLAY BRIDGE — lets an agent PLAY the game interactively with zero code
// knowledge. The game boots to the MAIN MENU (no qa-boot click-through; the
// whole point is that the operator has read nothing). The operator appends
// JSONL commands to qa/electron/freeplay/commands.jsonl; after each command the
// bridge takes a screenshot and updates state.json. The operator looks at the
// screenshot and decides the next command. That is a stranger at the keyboard.
//
// Commands (one JSON object per line):
//   {"cmd":"key","key":"Escape"}            press-and-release (Playwright names)
//   {"cmd":"keyhold","key":"w","ms":1500}   hold a key
//   {"cmd":"chord","keys":["w","a"],"ms":800}  hold several keys together
//   {"cmd":"move","x":800,"y":450}          move cursor (menu hover)
//   {"cmd":"click","x":800,"y":450}         click at DIP coordinates
//   {"cmd":"sweep","dx":30,"dy":0,"n":10}   pointer-locked look: n relative steps
//   {"cmd":"wait","ms":2000}                let the world run
//   {"cmd":"shot"}                          extra screenshot, no input
//   {"cmd":"end"}                           finish the session
//
// Coordinates are in the 1600x900 content space set below. state.json reports
// the true PNG pixel size so the operator can scale if the shots come out at a
// different resolution.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-freeplay-bridge.js --clubhouse=pine-hills-v2 --user-data-dir=<isolated>
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/freeplay');
  fs.mkdirSync(OUT, { recursive: true });
  const cmdFile = path.join(OUT, 'commands.jsonl');
  const stateFile = path.join(OUT, 'state.json');
  const doneFile = path.join(OUT, 'done.json');
  fs.writeFileSync(cmdFile, '');
  try { fs.unlinkSync(doneFile); } catch (_) { /* fresh session */ }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(5000);

  const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
  let shotIdx = 0;
  const shot = async (label) => {
    const name = `shot-${String(shotIdx).padStart(3, '0')}.png`;
    const buf = await page.screenshot();
    fs.writeFileSync(path.join(OUT, name), buf);
    const dim = pngSize(buf);
    fs.writeFileSync(stateFile, JSON.stringify({
      lastShot: name, label: label || null, pngW: dim.w, pngH: dim.h,
      coordSpace: { w: 1600, h: 900 }, processed: shotIdx, t: Date.now(),
    }, null, 2));
    shotIdx += 1;
  };
  await shot('boot');

  // pointer-lock relative look: keep the cursor mid-window and nudge it; the
  // lock consumes movement deltas, absolute position is irrelevant while locked
  const sweep = async (c) => {
    const n = Math.max(1, Math.min(60, c.n || 10));
    for (let i = 0; i < n; i += 1) {
      await page.mouse.move(800 + (c.dx || 0), 450 + (c.dy || 0), { steps: 2 });
      await page.mouse.move(800, 450, { steps: 1 });
      await page.waitForTimeout(16);
    }
  };

  let processed = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 32 * 60 * 1000) {
    let lines = [];
    try { lines = fs.readFileSync(cmdFile, 'utf8').split('\n').filter(Boolean); } catch (_) { /* mid-write */ }
    if (lines.length <= processed) { await page.waitForTimeout(250); continue; }
    for (; processed < lines.length; processed += 1) {
      let c = null;
      try { c = JSON.parse(lines[processed]); } catch (_) { continue; }
      try {
        if (c.cmd === 'key') await page.keyboard.press(c.key);
        else if (c.cmd === 'keyhold') { await page.keyboard.down(c.key); await page.waitForTimeout(c.ms || 500); await page.keyboard.up(c.key); }
        else if (c.cmd === 'chord') {
          for (const k of c.keys) await page.keyboard.down(k);
          await page.waitForTimeout(c.ms || 500);
          for (const k of [...c.keys].reverse()) await page.keyboard.up(k);
        } else if (c.cmd === 'move') await page.mouse.move(c.x, c.y, { steps: 6 });
        else if (c.cmd === 'click') { await page.mouse.move(c.x, c.y, { steps: 4 }); await page.mouse.click(c.x, c.y, { button: c.button || 'left' }); }
        else if (c.cmd === 'sweep') await sweep(c);
        else if (c.cmd === 'wait') await page.waitForTimeout(Math.min(20000, c.ms || 1000));
        else if (c.cmd === 'end') { await shot('end'); fs.writeFileSync(doneFile, JSON.stringify({ endedAt: Date.now(), commands: processed + 1 })); return { ok: true, commands: processed + 1 }; }
      } catch (err) {
        fs.appendFileSync(path.join(OUT, 'errors.log'), `cmd ${processed}: ${err.message}\n`);
      }
      await page.waitForTimeout(120);
      await shot(JSON.stringify(c).slice(0, 80));
    }
  }
  await shot('timeout');
  fs.writeFileSync(doneFile, JSON.stringify({ timeout: true, commands: processed }));
  return { ok: true, timeout: true };
}
