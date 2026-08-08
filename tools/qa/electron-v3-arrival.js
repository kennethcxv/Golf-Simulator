// VERIFIER 3 — THE STRANGER — run A "arrival".
// A brand-new player's first session on real input: menu, first steps, find
// the building, wander it, try the tools, the till, the mystery keys, the
// door sign. Screenshots at every beat into qa/electron/verify-v3/, every
// entry stamped seconds-since-gameplay-start. This driver DRIVES with real
// page.keyboard / page.mouse only; page.evaluate is used solely as the
// stranger's notebook (reading positions to aim the walk, dumping visible
// HUD text so the report can quote it).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-v3');
  fs.mkdirSync(OUT, { recursive: true });

  const t0app = Date.now();
  let t0 = t0app; // rebased when walk goes active
  const ts = () => +(((Date.now() - t0) / 1000).toFixed(1));
  const log = [];
  const errs = [];
  const note = (what, extra) => {
    const e = { t: ts(), what };
    if (extra !== undefined) e.extra = extra;
    log.push(e);
  };
  page.on('pageerror', (e) => errs.push({ t: ts(), pageerror: String((e && e.message) || e) }));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push({ t: ts(), consoleError: m.text() });
  });

  let shotN = 0;
  const shot = async (slug) => {
    shotN += 1;
    const name = `A-t${String(Math.max(0, Math.round(ts()))).padStart(4, '0')}-${String(shotN).padStart(2, '0')}-${slug}.png`;
    await page.screenshot({ path: path.join(OUT, name) }).catch(() => {});
    note(`shot:${slug}`, name);
    return name;
  };
  const save = () => {
    try {
      fs.writeFileSync(path.join(OUT, 'A-log.json'), `${JSON.stringify({ log, errs }, null, 2)}\n`);
    } catch (_) { /* ignore */ }
  };

  // The stranger's notebook: everything readable on screen right now.
  const hud = () => page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
    };
    const seen = new Set();
    const texts = [];
    for (const el of document.querySelectorAll('div,span,p,button,h1,h2,h3,h4,label,a')) {
      if (!vis(el)) continue;
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      if (own && own.length > 1 && !seen.has(own)) {
        seen.add(own);
        texts.push(own);
      }
      if (texts.length >= 80) break;
    }
    return texts;
  }).catch((e) => [`hud-dump-failed: ${String((e && e.message) || e)}`]);

  const read = () => page.evaluate(() => {
    const w = window.__fw && window.__fw.scene3d && window.__fw.scene3d.walk;
    if (!w || !w.state) return null;
    const s = w.state;
    return {
      x: +s.x.toFixed(2),
      z: +s.z.toFixed(2),
      yaw: +s.yaw.toFixed(4),
      pitch: +s.pitch.toFixed(4),
      locked: !!document.pointerLockElement,
      tool: w.tool ? w.tool() : null,
    };
  }).catch(() => null);

  try {
    // ---------------- fresh profile + boot ----------------
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
    const bootMod = await import(`file:///${bootPath}`);
    const cap = await bootMod.ownerResolution(page);
    note('ownerResolution', cap.caption);

    // The menu, seen before touching anything.
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /new game/i.test(c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
    await shot('menu-first-sight');
    note('menu-text', await hud());
    await page.getByRole('button', { name: /New game/i }).click();
    await page.waitForTimeout(700);
    await shot('after-new-game-click');
    note('difficulty-text', await hud());
    await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
    await page.waitForTimeout(400);
    const confirm = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
      await shot('confirm-screen');
      await confirm.click();
    }

    await page.waitForFunction(
      () => window.__fw && window.__fw.scene3d && window.__fw.scene3d.walk
        && window.__fw.scene3d.walk.isActive && window.__fw.scene3d.walk.isActive(),
      null, { timeout: 300000 },
    );
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 300000 }).catch(() => {});
    const menuSeconds = +(((Date.now() - t0app) / 1000).toFixed(1));
    t0 = Date.now();
    note('gameplay-start', { menuTookSeconds: menuSeconds });
    await page.bringToFront();
    await page.waitForTimeout(1800);
    await shot('first-frame');
    note('first-frame-hud', await hud());
    note('first-frame-state', await read());

    // ---------------- pointer lock + look calibration ----------------
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const cx = Math.round(vp.w / 2);
    const cy = Math.round(vp.h / 2);
    let mx = cx;
    let my = cy;
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(600);
    let st = await read();
    note('after-first-click', st);
    if (!st || !st.locked) {
      await shot('no-pointer-lock-after-click');
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(600);
      st = await read();
      note('second-lock-attempt', st);
    }

    const pauseOpenProbe = () => page.evaluate(() => {
      const cands = document.querySelectorAll('.pause-veil-ui, [class*="pause"]');
      for (const el of cands) {
        const s = getComputedStyle(el);
        if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.1) return true;
      }
      return false;
    }).catch(() => false);

    const recenter = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (await pauseOpenProbe()) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
      await page.mouse.move(cx, cy);
      mx = cx; my = cy;
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(450);
    };

    let offscreenOk = false;
    const sweepPx = async (dxTotal, dyTotal) => {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dxTotal), Math.abs(dyTotal || 0)) / 30));
      const sx = dxTotal / n;
      const sy = (dyTotal || 0) / n;
      for (let i = 0; i < n; i += 1) {
        mx += sx; my += sy;
        const offEdge = mx < 15 || mx > vp.w - 15 || my < 15 || my > vp.h - 15;
        const farOut = Math.abs(mx - cx) > 20000 || Math.abs(my - cy) > 4000;
        if ((offEdge && !offscreenOk) || farOut) {
          await recenter();
        }
        await page.mouse.move(Math.round(mx), Math.round(my), { steps: 1 });
      }
      await page.waitForTimeout(110);
    };

    // calibrate yaw/pitch per pixel
    const c1 = await read();
    await sweepPx(220, 0);
    const c2 = await read();
    let yawPerPx = c1 && c2 ? (c2.yaw - c1.yaw) / 220 : 0;
    await sweepPx(0, 130);
    const c3 = await read();
    let pitchPerPx = c2 && c3 ? (c3.pitch - c2.pitch) / 130 : 0;
    note('look-calibration', {
      yawPerPx: +yawPerPx.toFixed(6),
      pitchPerPx: +pitchPerPx.toFixed(6),
      locked: c3 ? c3.locked : null,
    });
    if (!yawPerPx || Math.abs(yawPerPx) < 1e-6) {
      await shot('mouse-look-dead');
      note('CONFUSION mouse look did nothing after locking', { c1, c2 });
      yawPerPx = 0.0025; // guess so the rest of the run can still try
    }
    if (!pitchPerPx || Math.abs(pitchPerPx) < 1e-6) pitchPerPx = -0.0025;

    // probe: do off-viewport coordinates still turn the view?
    mx = vp.w - 20;
    await page.mouse.move(mx, my);
    await page.waitForTimeout(80);
    const b4 = await read();
    for (let i = 0; i < 6; i += 1) {
      mx += 30;
      await page.mouse.move(Math.round(mx), my, { steps: 1 });
    }
    await page.waitForTimeout(150);
    const b5 = await read();
    offscreenOk = !!(b4 && b5) && Math.abs(b5.yaw - b4.yaw) > Math.abs(60 * yawPerPx);
    note('offscreen-look-probe', { works: offscreenOk, yawDelta: b4 && b5 ? +(b5.yaw - b4.yaw).toFixed(4) : null });
    await recenter();

    const turnYaw = async (dYaw) => { await sweepPx(dYaw / yawPerPx, 0); };
    const pitchBy = async (dPitch) => { await sweepPx(0, dPitch / pitchPerPx); };
    const levelPitch = async () => {
      const r = await read();
      if (r && Math.abs(r.pitch) > 0.03) await pitchBy(-r.pitch);
    };

    // ---------------- first look around: 360 in 6 steps ----------------
    for (let i = 0; i < 6; i += 1) {
      await shot(`pano-${i}`);
      await turnYaw(Math.PI / 3);
      await page.waitForTimeout(250);
    }
    note('pano-done-state', await read());

    // ---------------- the stranger's map notes ----------------
    const world = await page.evaluate(() => {
      const outW = {};
      try {
        const fw = window.__fw;
        const c = fw.scene3d.clubhouse ? fw.scene3d.clubhouse() : null;
        outW.interior = c && c.interior && c.interior.position
          ? { x: +c.interior.position.x.toFixed(2), z: +c.interior.position.z.toFixed(2) }
          : null;
        const st = fw.scene3d.walk.stations ? fw.scene3d.walk.stations() : null;
        if (Array.isArray(st)) {
          outW.stationShape = st[0] ? Object.keys(st[0]).slice(0, 20) : [];
          outW.stations = st.slice(0, 24).map((s) => {
            const p = s.position || s.pos || s;
            return {
              id: s.id || s.name || s.label || s.kind || '?',
              x: p && typeof p.x === 'number' ? +p.x.toFixed(2) : null,
              z: p && typeof p.z === 'number' ? +p.z.toFixed(2) : null,
              label: s.label || s.prompt || null,
            };
          });
        } else {
          outW.stations = String(st);
        }
      } catch (e) {
        outW.error = String((e && e.message) || e);
      }
      return outW;
    }).catch((e) => ({ error: String((e && e.message) || e) }));
    note('world-notes', world);

    // ---------------- movement + heading calibration ----------------
    const probeForward = async (ms) => {
      const p1 = await read();
      await page.keyboard.down('w');
      await page.waitForTimeout(ms || 380);
      await page.keyboard.up('w');
      await page.waitForTimeout(200);
      const p2 = await read();
      if (!p1 || !p2) return { p1, p2, fx: 0, fz: 0, mag: 0 };
      return { p1, p2, fx: p2.x - p1.x, fz: p2.z - p1.z, mag: Math.hypot(p2.x - p1.x, p2.z - p1.z) };
    };
    const sidestep = async () => {
      await page.keyboard.down('d');
      await page.waitForTimeout(420);
      await page.keyboard.up('d');
      await page.waitForTimeout(160);
    };

    const first = await probeForward(450);
    note('first-steps', { mag: +first.mag.toFixed(3), from: first.p1, to: first.p2 });
    if (first.mag < 0.05) {
      await shot('cannot-walk-forward');
      note('CONFUSION W did not move me', first);
    }
    // world-rotation sign vs yaw sign
    await turnYaw(0.5);
    const second = await probeForward(380);
    let rotSign = 1;
    if (first.mag > 0.03 && second.mag > 0.03) {
      const cross = first.fx * second.fz - first.fz * second.fx;
      const dot = first.fx * second.fx + first.fz * second.fz;
      const worldAng = Math.atan2(cross, dot);
      rotSign = worldAng >= 0 ? 1 : -1;
      note('heading-calibration', { worldAngPer0_5Yaw: +worldAng.toFixed(3), rotSign });
    }

    const steerLegToward = async (tx, tz, ms) => {
      const p = await probeForward(ms || 480);
      if (p.mag < 0.04) {
        await sidestep();
        return p;
      }
      const dxT = tx - p.p2.x;
      const dzT = tz - p.p2.z;
      const cross = p.fx * dzT - p.fz * dxT;
      const dot = p.fx * dxT + p.fz * dzT;
      const err = Math.atan2(cross, dot);
      if (Math.abs(err) > 0.09) await turnYaw(rotSign * err);
      return p;
    };

    const aimAt = async (tx, tz, label, stopDist) => {
      const stopAt = stopDist || 1.5;
      for (let k = 0; k < 26; k += 1) {
        const here = await read();
        if (!here) return { ok: false, why: 'no state' };
        const dist = Math.hypot(tx - here.x, tz - here.z);
        if (dist < stopAt) {
          note(`arrived:${label}`, { dist: +dist.toFixed(2), at: { x: here.x, z: here.z } });
          return { ok: true, dist };
        }
        await steerLegToward(tx, tz, dist > 6 ? 620 : 380);
      }
      const p = await read();
      note(`gave-up:${label}`, { at: p ? { x: p.x, z: p.z } : null });
      return { ok: false, why: 'iterations' };
    };

    // ---------------- walk to the building ----------------
    const target = world.interior || { x: 0, z: 0 };
    const outdoorPos = await read();
    note('outdoor-start', outdoorPos);
    const doorish = { x: target.x - 5.2, z: target.z + 3.0 };

    let lastHud = await hud();
    const hudDiffNote = async (tag) => {
      const now = await hud();
      const added = now.filter((tx) => !lastHud.includes(tx));
      if (added.length) {
        note(`hud-new:${tag}`, added);
        await shot(`hud-change-${tag}`);
      }
      lastHud = now;
      return added;
    };

    for (let leg = 0; leg < 12; leg += 1) {
      const p = await read();
      if (!p) break;
      const dist = Math.hypot(doorish.x - p.x, doorish.z - p.z);
      if (dist < 2.0) break;
      await steerLegToward(doorish.x, doorish.z, 650);
      if (leg === 2 || leg === 6) await shot(`approach-${leg}`);
      await hudDiffNote(`approach-${leg}`);
    }
    await shot('at-building');
    note('at-building-state', await read());
    await hudDiffNote('at-building');

    // Try to get inside: walk toward the interior centre itself.
    const beforeDoor = await read();
    note('door-outside-pos', beforeDoor);
    await aimAt(target.x, target.z, 'interior-centre', 2.2);
    await shot('inside-maybe');
    const insideState = await read();
    note('inside-state', insideState);
    await hudDiffNote('entering');

    // ---------------- indoor pano ----------------
    await levelPitch();
    for (let i = 0; i < 6; i += 1) {
      await shot(`indoor-pano-${i}`);
      await turnYaw(Math.PI / 3);
      await page.waitForTimeout(220);
    }

    // ---------------- visit stations like a player ----------------
    const stations = Array.isArray(world.stations) ? world.stations.filter((s) => s.x !== null) : [];
    note('station-plan', stations.map((s) => s.id));
    const visited = [];
    const openUiProbe = () => page.evaluate(() => {
      const lock = !!document.pointerLockElement;
      const dialogs = [...document.querySelectorAll('div')].filter((el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > innerWidth * 0.28 && r.height > innerHeight * 0.28
          && (parseFloat(s.zIndex) > 2 || s.position === 'fixed' || s.position === 'absolute');
      });
      return { lock, bigOverlays: dialogs.length };
    }).catch(() => ({ lock: null, bigOverlays: null }));

    for (const s of stations.slice(0, 6)) {
      const here = await read();
      if (!here) break;
      const d = Math.hypot(s.x - here.x, s.z - here.z);
      if (d > 40) { note(`skip-station:${s.id}`, { d: +d.toFixed(1) }); continue; }
      await aimAt(s.x, s.z, `station-${s.id}`, 1.6);
      await levelPitch();
      await shot(`station-${s.id}`);
      const added = await hudDiffNote(`station-${s.id}`);
      note(`station-${s.id}-prompt`, added);
      await page.keyboard.press('e');
      await page.waitForTimeout(900);
      const ui = await openUiProbe();
      await shot(`station-${s.id}-after-E`);
      note(`station-${s.id}-after-E`, { ui, hud: await hud() });
      if (ui.bigOverlays > 0 || !ui.lock) {
        await page.waitForTimeout(900);
        await shot(`station-${s.id}-ui`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        const ui2 = await openUiProbe();
        note(`station-${s.id}-after-escape`, ui2);
        if (ui2.bigOverlays > 0) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(600);
        }
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(450);
        mx = cx; my = cy;
      }
      visited.push(s.id);
      if (visited.length >= 5) break;
    }
    note('visited-stations', visited);

    // ---------------- the tool key ----------------
    await levelPitch();
    await shot('before-tool-wheel');
    await page.keyboard.down('f');
    await page.waitForTimeout(700);
    await shot('f-held-700ms');
    const wheelDump = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      if (!el) return null;
      return {
        visible: getComputedStyle(el).display !== 'none',
        items: [...el.querySelectorAll('.tool-wheel-item')].map((b) => ({
          label: ((b.querySelector('.tool-wheel-label') || b).textContent || '').trim(),
          disabled: b.classList.contains('is-disabled'),
        })),
        text: (el.innerText || '').slice(0, 600),
      };
    }).catch(() => null);
    note('tool-wheel', wheelDump);
    await page.keyboard.up('f');
    await page.waitForTimeout(350);
    await shot('f-released');
    const wheelStill = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      return el ? getComputedStyle(el).display !== 'none' : false;
    }).catch(() => false);
    note('wheel-after-release', wheelStill);
    if (wheelStill || (wheelDump && wheelDump.visible)) {
      await page.keyboard.press('1');
      await page.waitForTimeout(350);
      await shot('wheel-pressed-1');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
    }
    let toolState = await read();
    note('tool-after-wheel', toolState ? toolState.tool : null);
    await shot('tool-equipped-maybe');
    if (!toolState || !toolState.locked) {
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(400);
      mx = cx; my = cy;
      toolState = await read();
    }
    if (toolState && toolState.tool) {
      await pitchBy(-0.35);
      const pdown = await read();
      note('pitch-after-down-attempt', pdown ? pdown.pitch : null);
      await shot('tool-aim-down');
      await page.mouse.down();
      await page.waitForTimeout(1200);
      await shot('tool-working-1');
      await turnYaw(0.7);
      await page.waitForTimeout(300);
      await shot('tool-working-turn');
      await page.mouse.up();
      await page.waitForTimeout(300);
      await hudDiffNote('tool-work');
      const guesses = ['x', 'q', 'f'];
      for (const g of guesses) {
        await page.keyboard.press(g);
        await page.waitForTimeout(550);
        const r = await read();
        note(`unequip-try:${g}`, { tool: r ? r.tool : null });
        const wheelNow = await page.evaluate(() => {
          const el = document.querySelector('.tool-wheel');
          return el ? getComputedStyle(el).display !== 'none' : false;
        }).catch(() => false);
        if (wheelNow) {
          await shot(`unequip-${g}-opened-wheel`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(450);
        }
        if (!r || !r.tool) { note('tool-put-away-by', g); break; }
      }
      await shot('after-unequip-tries');
      await levelPitch();
    } else {
      note('CONFUSION no tool equipped after wheel interaction', wheelDump);
    }

    // ---------------- mystery keys: Tab, Z, X, P ----------------
    const keyProbe = async (key) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(700);
      const ui = await openUiProbe();
      await shot(`key-${key}`);
      const h = await hud();
      note(`key-${key}`, { ui, hudTop: h.slice(0, 25) });
      if (ui.bigOverlays > 0 || !ui.lock) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const ui2 = await openUiProbe();
        if (ui2.bigOverlays > 0) {
          await page.keyboard.press(key);
          await page.waitForTimeout(400);
        }
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(400);
        mx = cx; my = cy;
      }
    };
    await keyProbe('Tab');
    await keyProbe('z');
    await keyProbe('x');
    await keyProbe('p');

    // pause menu, seen once (settings dive happens next run)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await shot('escape-menu');
    note('escape-menu-text', await hud());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(400);
    mx = cx; my = cy;

    // ---------------- door sign hunt ----------------
    if (beforeDoor) {
      await aimAt(beforeDoor.x, beforeDoor.z, 'back-to-door', 1.8);
      await levelPitch();
      for (let i = 0; i < 4; i += 1) {
        await shot(`door-look-${i}`);
        const added = await hudDiffNote(`door-look-${i}`);
        if (added.some((tx) => /sign|open|closed/i.test(tx))) {
          note('door-sign-prompt-found', added);
          await page.keyboard.press('e');
          await page.waitForTimeout(800);
          await shot('door-sign-after-E');
          await hudDiffNote('door-sign-flip');
          break;
        }
        await turnYaw(Math.PI / 2);
        await page.waitForTimeout(200);
      }
    }

    // ---------------- audio proxy notes (cannot hear in harness) ----------------
    const audioNotes = await page.evaluate(() => {
      const o = {};
      try { o.footstepCues = Array.isArray(window.__fwFootsteps) ? window.__fwFootsteps.length : String(window.__fwFootsteps); } catch (e) { o.footstepCues = String(e); }
      try { o.eCounts = window.__eCounts || null; } catch (e) { o.eCounts = String(e); }
      return o;
    }).catch(() => null);
    note('audio-proxies', audioNotes);

    note('final-state', await read());
    note('final-hud', await hud());
    await shot('run-a-end');
  } catch (error) {
    note('RUN-A-CRASH', String((error && error.stack) || error));
    await page.screenshot({ path: path.join(OUT, 'A-crash.png') }).catch(() => {});
  }
  save();
  return { ok: true, entries: log.length, errors: errs.length, screenshots: shotN };
}
