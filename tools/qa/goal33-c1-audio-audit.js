// C1 — WHAT DOES THIS GAME ACTUALLY SOUND LIKE, MEASURED AT THE MASTER BUS.
//
// "Before adding anything: what sounds does the game currently have, where do
//  they play from, and is there a mixer at all? I suspect it is thin."
//
// The inventory says otherwise, and the inventory is not the claim being tested.
// src/core/audio.js is 2,956 lines with a five-bus mixer (master, ambience, sfx,
// ui, music), roughly a hundred cues, per-surface footsteps, three-layer tool
// loops driven by live stroke intensity, and a central DOM click sink that
// classifies confirm / cancel / destructive / disabled. So the question this
// driver asks is not "does it exist" but "does it MAKE A SOUND when played".
//
// HOW, honestly: I cannot listen. The nearest measurable thing to listening is
// the signal itself, and the audio module already exposes it — startCapture()
// taps the post-volume master through an analyser. So each interaction is
// performed with real input and the master RMS/peak is sampled across it.
//
//   silence floor    the room with nothing happening — every cue is judged
//                    against this, because "0.004 RMS" means nothing on its own
//   per interaction  RMS and peak while the action happens
//   unknown cues     window.__fwUnknownCues, the game's OWN record of a sender
//                    asking for a cue that does not exist (an unmapped cue is a
//                    defect, not a silent no-op)
//   ui click sink    every DOM button press routes through one sink; this walks
//                    real buttons and checks the sink answered
//
// A cue whose RMS does not rise above the silence floor is SILENT, whatever the
// code says it did. That is the whole point of measuring rather than asserting.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<profile> \
//   node tools/qa/run-electron.cjs tools/qa/goal33-c1-audio-audit.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'c1-audio', errs: [], failures: [], notes: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const cont = [...document.querySelectorAll('button')]
        .find((b) => /\bContinue\b/.test(b.querySelector('.menu-action-label')?.textContent || b.textContent || ''));
      return !!(cont && !cont.disabled);
    }, null, { timeout: 90000 });
  }
  const how = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  out.bootPath = how;
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(600);

  // ---- what the mixer thinks it is doing -----------------------------------
  out.mixer = await page.evaluate(() => {
    const a = window.__fw.audio;
    if (!a) return { missing: true };
    const prefs = window.__fw.preferences?.values?.audio ?? null;
    return {
      ready: !!a.ready,
      context: a.qaContext ? a.qaContext() : null,
      muted: a.isMuted ? a.isMuted() : null,
      volumes: prefs,
      musicActive: a.musicActive ? a.musicActive() : null,
      apiSize: Object.keys(a).length,
    };
  });
  console.log('MIXER', JSON.stringify(out.mixer));
  if (out.mixer.missing) { fail('window.__fw.audio is not exposed — nothing to measure'); return out; }
  if (out.mixer.muted) fail('the game is MUTED in this profile — every measurement below would read silent for the wrong reason');

  // ---- the analyser tap ----------------------------------------------------
  // startCapture() is the VIDEO recorder's audio path — it wants the game canvas
  // and refuses under Electron ("This browser cannot capture the game canvas").
  // The analyser tap is independent of it, so its absence is a note, not a stop.
  out.captureStarted = await page.evaluate(async () => {
    const a = window.__fw.audio;
    if (!a.startCapture) return { ok: false, why: 'no startCapture in the audio API' };
    try { await a.startCapture(); return { ok: true }; } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  });
  if (!out.captureStarted.ok) out.notes.push(`startCapture unavailable (${out.captureStarted.why}); measuring through qaMasterTap only`);

  // ONE analyser for the whole run. qaMasterTap() BUILDS an analyser and returns
  // a reader — calling it per frame would connect a new node to the master bus
  // sixty times a second and measure the cost of its own instrument.
  const tapMade = await page.evaluate(() => {
    const a = window.__fw.audio;
    if (!a.qaMasterTap) return false;
    window.__tap = a.qaMasterTap();
    return !!window.__tap;
  });
  if (!tapMade) { fail('qaMasterTap() returned nothing — no analyser on the master bus'); return out; }

  // Sample across a window and report the loudest slice: a cue is a transient,
  // so an average over two seconds buries it.
  const listen = async (label, action, ms = 1400) => {
    const sampler = page.evaluate((dur) => new Promise((resolve) => {
      const t0 = performance.now();
      let peak = 0;
      let bestRms = 0;
      let state = null;
      const tick = () => {
        const s = window.__tap ? window.__tap.read() : null;
        if (s) {
          peak = Math.max(peak, s.peak ?? 0);
          bestRms = Math.max(bestRms, s.rms ?? 0);
          state = s.state;
        }
        if (performance.now() - t0 < dur) requestAnimationFrame(tick);
        else resolve({ peak: +peak.toFixed(5), rms: +bestRms.toFixed(5), state });
      };
      requestAnimationFrame(tick);
    }), ms);
    if (action) await action();
    const r = await sampler;
    out.measurements = out.measurements || {};
    out.measurements[label] = r;
    console.log(`AUDIO ${label}`, JSON.stringify(r));
    return r;
  };

  // ---- the floor, first ----------------------------------------------------
  // NOT silence: ambience and music are running, so the floor is the MIX. A cue
  // that does not clear it is inaudible in play whatever the code did, which is
  // the honest test — and the second pass below separates "buried" from "never
  // fired" by dropping the bed and asking again.
  const floor = await listen('00-silence-floor', null, 2200);

  // ---- real interactions ---------------------------------------------------
  await listen('01-footsteps-walking', async () => {
    await page.keyboard.down('w');
    await page.waitForTimeout(4000);
    await page.keyboard.up('w');
  }, 4400);
  out.footstepsAfterWalk = await page.evaluate(() => (window.__fwFootsteps || []).length);

  await listen('02-tool-equip-F', async () => {
    await page.keyboard.press('f');
  }, 1500);
  out.toolAfterF = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);

  await listen('03-tool-use-mouse-held', async () => {
    await page.mouse.down();
    await page.waitForTimeout(1600);
    await page.mouse.up();
  }, 2000);

  await listen('04-ledger-open-K', async () => {
    await page.keyboard.press('k');
  }, 1600);

  await listen('05-ledger-page-E', async () => {
    await page.keyboard.press('e');
  }, 1500);

  await page.keyboard.press('k').catch(() => {});
  await page.waitForTimeout(900);

  // The DOM UI: the pause menu is a real screen with real buttons, and the
  // click sink is supposed to voice every one of them.
  await listen('06-ui-escape-menu', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }, 1500);

  const buttons = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => b.offsetParent !== null && !b.disabled)
    .slice(0, 6)
    .map((b, i) => ({ i, text: (b.textContent || '').trim().slice(0, 40) })));
  out.visibleButtons = buttons;
  if (buttons.length) {
    await listen('07-ui-button-hover', async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null && !x.disabled)[0];
        if (b) b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      });
    }, 1100);
    await listen('08-ui-button-click', async () => {
      const box = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null && !x.disabled)[0];
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (b.textContent || '').trim().slice(0, 30) };
      });
      out.clickedButton = box;
      if (box) await page.mouse.click(box.x, box.y);
    }, 1400);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);

  // ---- SECOND PASS: same cues with the bed pulled down --------------------
  // "Buried in the mix" and "never fired" are different defects and the first
  // pass cannot tell them apart. Ambience and music go to zero (restored after),
  // which drops the floor without touching the sfx bus, and the cues that
  // stayed quiet are asked again.
  out.beforeAudioPrefs = await page.evaluate(() => JSON.parse(JSON.stringify(window.__fw.preferences.values.audio)));
  await page.evaluate(() => {
    window.__fw.preferences.set('audio.ambience', 0);
    try { window.__fw.audio.musicStop?.(); } catch { /* ignore */ }
  });
  await page.waitForTimeout(1200);
  const quietFloor = await listen('10-floor-no-bed', null, 2000);
  await listen('11-footsteps-no-bed', async () => {
    await page.keyboard.down('w');
    await page.waitForTimeout(3000);
    await page.keyboard.up('w');
  }, 3400);
  await listen('12-tool-equip-no-bed', async () => { await page.keyboard.press('f'); }, 1500);
  await listen('13-tool-use-no-bed', async () => {
    await page.mouse.down();
    await page.waitForTimeout(1600);
    await page.mouse.up();
  }, 2000);
  out.quietFloorRms = quietFloor.rms;
  await page.evaluate((prev) => {
    window.__fw.preferences.set('audio.ambience', prev.ambience);
  }, out.beforeAudioPrefs);

  // ---- the game's own record of senders asking for cues that do not exist ---
  out.unknownCues = await page.evaluate(() => window.__fwUnknownCues || []);
  out.footstepLog = await page.evaluate(() => (window.__fwFootsteps || []).length);
  out.footstepSurfaces = await page.evaluate(() => {
    const seen = {};
    for (const f of (window.__fwFootsteps || [])) seen[f.surface] = (seen[f.surface] || 0) + 1;
    return seen;
  });

  await page.evaluate(() => {
    try { window.__tap?.stop?.(); } catch { /* ignore */ }
    try { window.__fw.audio.stopCapture?.(); } catch { /* ignore */ }
  });
  const shot = path.join(OUT, 'c1-audio-audit.png');
  await page.screenshot({ path: shot });
  out.screenshot = shot;

  // ---- verdict: which interactions were SILENT -----------------------------
  const m = out.measurements || {};
  const classify = (floorRms, keys) => {
    const audible = [];
    const silent = [];
    for (const k of keys) {
      const v = m[k];
      if (!v) continue;
      // A cue has to clear the floor by a real margin, not by rounding.
      if (v.rms <= Math.max(floorRms * 1.5, floorRms + 0.0008)) silent.push(`${k} rms=${v.rms} peak=${v.peak}`);
      else audible.push(`${k} rms=${v.rms} peak=${v.peak}`);
    }
    return { audible, silent };
  };
  const inMix = classify(floor.rms, Object.keys(m).filter((k) => /^0[1-9]/.test(k)));
  const bedDown = classify(out.quietFloorRms ?? floor.rms, Object.keys(m).filter((k) => /^1[1-9]/.test(k)));
  out.result = {
    mixFloorRms: floor.rms,
    noBedFloorRms: out.quietFloorRms ?? null,
    inTheMix: inMix,
    withTheBedDown: bedDown,
    unknownCues: out.unknownCues,
    footstepsLoggedAfter4sWalk: out.footstepsAfterWalk ?? null,
    footstepsLoggedTotal: out.footstepLog,
    footstepSurfaces: out.footstepSurfaces,
    toolEquippedByF: out.toolAfterF ?? null,
  };
  if (out.unknownCues.length) fail(`senders asked for ${out.unknownCues.length} cue(s) that do not exist: ${out.unknownCues.join(', ')}`);
  fs.writeFileSync(path.join(OUT, 'c1-audio-audit.json'), JSON.stringify(out, null, 2));
  console.log('C1', JSON.stringify(out.result, null, 2));
  return out;
}
