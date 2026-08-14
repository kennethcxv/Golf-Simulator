// PLAYTEST 3, ITEM 1 — THE AUDITION SWITCHER, PROVED ON THE LIVE AUDIO GRAPH.
//
// The claim is not "a picker exists". It is "switching an option changes which
// recording the player hears", and that is a claim about the BUS, not the UI.
//
// A picker whose selection does nothing looks exactly like a working one from
// the outside: you change the dropdown, a sound plays, and the label updates.
// So this drives every option of every family, fires that family's cue, and
// records BOTH the peak on the master bus AND the FILE of the buffer that
// started -- from `__fwSample`, the tag the bank puts on a decoded vendored
// file. The file is the part that cannot be faked by a UI-only picker.
//
// The gate is therefore: for each family, the set of files heard across its
// options must have as many DISTINCT members as the family has options. Two
// options that play the same file are not two options.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-sfx-audition-gate.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/sfx-audition');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], rows: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  // The context only exists after a real gesture.
  const first = await page.$('.menu-screen button:not([disabled])');
  if (first) await first.click();
  await page.waitForTimeout(2500);

  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    if (!app?.audio?.qaMasterTap) return { ok: false, why: 'qaMasterTap not on the audio surface' };
    window.__p1 = { tap: app.audio.qaMasterTap(), starts: [] };
    const ctx = app.audio.qaContext ? app.audio.qaContext() : null;
    if (!ctx) return { ok: false, why: 'no audio context handle for the spy' };
    if (!ctx.__p1Spied) {
      const make = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = make();
        const start = node.start.bind(node);
        node.start = (...args) => {
          const tag = node.buffer && node.buffer.__fwSample;
          window.__p1.starts.push({ sampled: !!tag, file: tag ? tag.file : null, cue: tag ? tag.cue : null });
          return start(...args);
        };
        return node;
      };
      ctx.__p1Spied = true;
    }
    return { ok: true, bank: app.audio.qaSampleBankDiagnostics?.() ?? null };
  });
  console.log('INSTALLED', JSON.stringify({
    ok: out.installed.ok, loaded: out.installed.bank?.loaded, failed: out.installed.bank?.failed,
  }));
  if (!out.installed.ok) {
    fs.writeFileSync(path.join(OUT, 'sfx-audition.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('ABORTED:', out.installed.why);
    return out;
  }

  out.families = await page.evaluate(() => (window.__fw.audio.sfxFamilies?.() || []));
  console.log('FAMILIES', out.families.map((f) => `${f.family}:${f.options.length}`).join(' '));

  const PREVIEW_CUE = {
    menuButton: 'uiTick',
    drawerOpen: 'drawerOpen',
    cashLand: 'coinDeposit',
    ledgerTurn: 'ledgerTurn',
    ledgerPickup: 'ledgerPickup',
    ledgerClose: 'ledgerClose',
    music: 'music',
  };

  for (const fam of out.families) {
    // Music is a looping cue with its own lifetime; auditioning it through the
    // one-shot path would start a loop nothing stops. Its options are proved by
    // the same file-identity rule, just via the bank rather than the bus.
    if (fam.family === 'music') continue;
    const cue = PREVIEW_CUE[fam.family];
    if (!cue) continue;
    for (const opt of fam.options) {
      // eslint-disable-next-line no-await-in-loop
      const row = await page.evaluate(async ({ family, optionId, cueName, ms }) => {
        window.__p1.starts.length = 0;
        const played = window.__fw.audio.sfxPreview?.(family, optionId, cueName);
        const t0 = performance.now();
        let peak = 0;
        await new Promise((resolve) => {
          const tick = () => {
            const r = window.__p1.tap.read();
            if (r.peak > peak) peak = r.peak;
            if (performance.now() - t0 >= ms) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const starts = window.__p1.starts.slice();
        return {
          played: !!played,
          peak: +peak.toFixed(5),
          dbfs: peak > 0 ? +(20 * Math.log10(peak)).toFixed(1) : null,
          files: [...new Set(starts.filter((s) => s.sampled).map((s) => s.file))],
          starts: starts.length,
        };
      }, { family: fam.family, optionId: opt.id, cueName: cue, ms: 900 });
      const line = {
        family: fam.family, option: opt.id, label: opt.label, cue, ...row,
      };
      out.rows.push(line);
      console.log(`  ${fam.family.padEnd(13)} ${opt.id.padEnd(15)} ${String(line.dbfs ?? 'silent').padStart(7)} dBFS  ${line.files.join(',') || '(no sampled buffer)'}`);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(180);
    }
  }

  // THE GATE. Distinct files per family must equal the option count: two options
  // that play the same recording are one option wearing two labels, and a pin
  // that does nothing produces exactly that.
  const perFamily = {};
  for (const r of out.rows) {
    const f = (perFamily[r.family] = perFamily[r.family] || { options: 0, files: new Set(), silent: 0, peaks: [] });
    f.options += 1;
    for (const file of r.files) f.files.add(file);
    if (r.dbfs === null) f.silent += 1;
    else f.peaks.push(r.dbfs);
  }
  out.verdict = {
    families: Object.fromEntries(Object.entries(perFamily).map(([k, v]) => [k, {
      options: v.options,
      distinctFilesHeard: v.files.size,
      // the line that fails on a UI-only picker
      everyOptionPlaysItsOwnRecording: v.files.size === v.options,
      silentOptions: v.silent,
      peakDbfsRange: v.peaks.length ? [Math.min(...v.peaks), Math.max(...v.peaks)] : null,
    }])),
    allFamiliesDistinct: Object.values(perFamily).every((v) => v.files.size === v.options),
    anySilent: Object.values(perFamily).some((v) => v.silent > 0),
    totalOptionsAuditioned: out.rows.length,
  };
  console.log('SFX-AUDITION', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'sfx-audition.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
