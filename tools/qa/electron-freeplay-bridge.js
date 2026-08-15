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
//   {"cmd":"qa","script":"ring"|"email"}    ALLOWLISTED state injection — the
//       booking channels fire on a slow sim trickle (~1 per 2 game-hours), so
//       a session-scoped verifier gets exactly these two fixed triggers: one
//       phone request ("ring") or one email request with its mail row
//       ("email"). No arbitrary code crosses this bridge; a verifier that
//       uses one must record the concession in its report.
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
  // two verifiers must never share a command file — each session gets its
  // own dir via QA_FREEPLAY_DIR
  const OUT = path.resolve(process.env.QA_FREEPLAY_DIR || 'qa/electron/freeplay');
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
  let shotFailStreak = 0;
  // A screenshot that throws used to end the whole session: shot() was called
  // from outside the command try/catch, so one failure propagated past the
  // loop and out of the driver. That is how Goal 22's first stranger run died
  // two minutes in with a blank error and five usable frames — the app fell
  // over during "Loading models" and took a 30-minute verifier slot with it.
  // A dead frame is a FINDING, not a reason to stop playing, so record it and
  // let the operator see the gap.
  const shot = async (label) => {
    const name = `shot-${String(shotIdx).padStart(3, '0')}.png`;
    let dim = { w: 0, h: 0 };
    let failed = null;
    try {
      const buf = await page.screenshot();
      fs.writeFileSync(path.join(OUT, name), buf);
      dim = pngSize(buf);
      shotFailStreak = 0;
    } catch (err) {
      failed = String(err.message || err).slice(0, 300);
      shotFailStreak += 1;
      fs.appendFileSync(path.join(OUT, 'errors.log'), `shot ${shotIdx}: ${failed}\n`);
    }
    try {
      fs.writeFileSync(stateFile, JSON.stringify({
        lastShot: failed ? null : name, shotFailed: failed,
        label: label || null, pngW: dim.w, pngH: dim.h,
        coordSpace: { w: 1600, h: 900 }, processed: shotIdx, t: Date.now(),
      }, null, 2));
    } catch (_) { /* the operator still has the PNGs */ }
    shotIdx += 1;
  };
  await shot('boot');

  // LOOK. This used to nudge out to 800+dx and come straight back to 800 every
  // step, on the belief that "the lock consumes deltas, absolute position is
  // irrelevant". It is not irrelevant: the delta of the return move is the exact
  // negative of the delta of the nudge, so every sweep this bridge has ever run
  // netted to ZERO turn. Measured in A (Goal 20). Verifier sessions that
  // reported "I looked around" were standing still.
  //
  // A sweep now TRAVELS, the way a hand does. When it runs out of window it
  // wraps to the far side in one move, which costs the 140 px that
  // applyMouseLook clamps a single event to — under 10% of a full pass, and the
  // pass is ~170 degrees, so most sweeps never wrap at all.
  let sx = 800;
  let sy = 450;
  const sweep = async (c) => {
    const n = Math.max(1, Math.min(120, c.n || 10));
    const dx = c.dx || 0;
    const dy = c.dy || 0;
    for (let i = 0; i < n; i += 1) {
      if (sx + dx < 60 || sx + dx > 1540 || sy + dy < 60 || sy + dy > 840) {
        if (dx) sx = dx > 0 ? 100 : 1500;
        if (dy) sy = dy > 0 ? 100 : 800;
        await page.mouse.move(sx, sy, { steps: 1 });
        await page.waitForTimeout(16);
      }
      sx += dx;
      sy += dy;
      await page.mouse.move(sx, sy, { steps: 1 });
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
        } else if (c.cmd === 'qa' && c.script === 'inside') {
          // ALLOWLISTED concession for verifiers: a fresh save cannot walk
          // through the restoration-locked doors, and the four regression
          // subjects (ledger, broom, queue) live indoors. This places the
          // player inside the shop near the front desk, opens the business,
          // and turns organic walk-ins on. Everything after it is real input;
          // a verifier that uses it must record the concession.
          await page.evaluate(() => {
            const app = window.__fw;
            const ch = app.scene3d?.clubhouse?.();
            if (!ch) return;
            const st = app.scene3d.walk.state;
            const o = ch.interior.position;
            st.x = o.x + 1.4;
            st.z = o.z + 1.2;
            st.yaw = Math.PI;
            st.pitch = -0.1;
            app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
            if (app.state.campaign) app.state.campaign.businessOpen = true;
            if (app.state.shop) app.state.shop.signOpen = true;
            ch.setOrganicWalkins?.(true);
          });
        } else if (c.cmd === 'qa' && c.script === 'sale') {
          // ALLOWLISTED concession: stages the canonical 3-item card sale at
          // the counter (the same sendToCounter path every checkout driver
          // uses), so a verifier can judge bagging/card/sizes without waiting
          // out organic shopping. Recorded by the verifier that uses it.
          await page.evaluate(async () => {
            const app = window.__fw;
            const ch = app.scene3d?.clubhouse?.();
            if (!ch) return;
            const skus = ['balls1', 'water1', 'sportdrink2'];
            for (const id of skus) {
              const inv = app.state.shop?.inventory?.[id];
              if (inv) inv.shelf = Math.max(inv.shelf, 12);
            }
            ch.rebuildStock?.();
            ch.sendToCounter?.(skus, 'card');
          });
        } else if (c.cmd === 'qa' && (c.script === 'ring' || c.script === 'email')) {
          await page.evaluate((kind) => {
            const app = window.__fw;
            if (!app?.state?.reservations) return;
            const state = app.state;
            const book = state.reservations;
            book.requests = Array.isArray(book.requests) ? book.requests : [];
            const nowAbs = Math.floor(state.clock.minutes);
            const dayAbs = Math.floor(nowAbs / 1440) + (kind === 'email' ? 1 : 0);
            book.nextRequestId = (book.nextRequestId || 1) + 1;
            const id = `req_qa_bridge_${book.nextRequestId}`;
            const minute = kind === 'email' ? 9 * 60 : 14 * 60;
            book.requests.push({
              id,
              channel: kind === 'ring' ? 'phone' : 'email',
              holder: kind === 'ring' ? 'Dana Whitfield' : 'Omar Reyes',
              partySize: 2,
              dayAbs,
              minute,
              createdAtAbs: nowAbs,
              expiresAtAbs: kind === 'ring' ? nowAbs + 30 : dayAbs * 1440 + minute - 60,
              status: 'pending',
            });
            if (kind === 'email') {
              state.mail = state.mail && Array.isArray(state.mail.messages) ? state.mail : { messages: [], nextId: 1 };
              state.mail.messages.unshift({
                id: state.mail.nextId++,
                kind: 'booking-request',
                from: 'Omar Reyes',
                data: { requestId: id, holder: 'Omar Reyes', partySize: 2, dayAbs, minute },
                atAbs: nowAbs,
                read: false,
                resolved: null,
                dedupeKey: `qa-bridge:${id}`,
              });
            }
          }, c.script);
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
      // The window is gone. Say so, rather than spinning silently for the rest
      // of the half hour while the operator keeps typing at a corpse.
      if (shotFailStreak >= 8) {
        fs.writeFileSync(doneFile, JSON.stringify({
          crashed: true, commands: processed + 1,
          note: 'the game window stopped responding to screenshots; see errors.log',
        }));
        return { ok: false, crashed: true, commands: processed + 1 };
      }
    }
  }
  await shot('timeout');
  fs.writeFileSync(doneFile, JSON.stringify({ timeout: true, commands: processed }));
  return { ok: true, timeout: true };
}
