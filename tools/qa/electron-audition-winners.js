// PLAYTEST 4, ITEM 1 — WHAT THE GAME ACTUALLY PLAYS AFTER THE AUDITION.
//
// The manifest says which recordings survived. That is a fact about a JSON file.
// This driver asks the RUNNING GAME the only question that matters: when the cue
// fires, which buffer reaches the graph, and how loud is it?
//
// So every BufferSource start is intercepted and the buffer it carries is read --
// its sample tag (which recording), its length, and its peak computed off the
// actual PCM rather than copied from the manifest. A peak read out of the manifest
// would still be printed if the file failed to decode and the graph played
// silence; a peak computed from getChannelData cannot.
//
// THE NEGATIVE CONTROL is at the end: a family is pinned to an option that no
// longer exists, and the instrument must show the cue STILL SOUNDING from the
// fallback rather than reporting a confident peak for a recording that is gone.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-audition-winners.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/audition-winners');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  // ---- the instrument -----------------------------------------------------
  out.spy = await page.evaluate(() => {
    const ctx = window.__fw.audio?.qaContext?.();
    if (!ctx) return { ok: false, why: 'no audio context' };
    window.__aud = [];
    const make = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const node = make();
      const start = node.start.bind(node);
      node.start = (...args) => {
        const buf = node.buffer;
        let peak = 0;
        if (buf) {
          for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < d.length; i += 1) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
          }
        }
        window.__aud.push({
          at: Math.round(performance.now()),
          tag: buf?.__fwSample ? { cue: buf.__fwSample.cue, file: buf.__fwSample.file, option: buf.__fwSample.option || null } : null,
          seconds: buf ? +(buf.length / buf.sampleRate).toFixed(3) : null,
          peak: +peak.toFixed(5),
          peakDb: peak > 0 ? +(20 * Math.log10(peak)).toFixed(2) : null,
        });
        return start(...args);
      };
      return node;
    };
    return { ok: true, sampleRate: ctx.sampleRate };
  });
  console.log('SPY', JSON.stringify(out.spy));

  // ---- what the picker offers now -----------------------------------------
  out.families = await page.evaluate(() => (window.__fw.audio?.sfxFamilies?.() || []).map((f) => ({
    family: f.family,
    current: f.current,
    options: f.options.map((o) => o.id),
  })));
  console.log('FAMILIES', JSON.stringify(out.families, null, 1));

  // ---- fire each cue and read the buffer that reached the graph ------------
  // Each cue is fired the way the GAME fires it where an exported verb exists,
  // and through the picker's own preview where the cue is only reachable by
  // family. Both routes land on the same sfx bus, so the peaks are comparable.
  const CUES = [
    { cue: 'uiTick', via: 'fn' }, { cue: 'uiConfirm', via: 'fn' }, { cue: 'uiCancel', via: 'fn' },
    { cue: 'uiError', via: 'fn' },
    { cue: 'drawerOpen', via: 'fn' }, { cue: 'coinDeposit', via: 'fn' },
    { cue: 'ledgerOpen', via: 'fn' }, { cue: 'ledgerTurn', via: 'fn' }, { cue: 'ledgerClose', via: 'fn' },
    { cue: 'ledgerPickup', via: 'family', family: 'ledgerPickup' },
  ];
  out.heard = [];
  for (const spec of CUES) {
    // eslint-disable-next-line no-await-in-loop
    const row = await page.evaluate(async (s) => {
      const audio = window.__fw.audio;
      const before = window.__aud.length;
      let fired = null;
      if (s.via === 'fn' && typeof audio[s.cue] === 'function') { audio[s.cue](); fired = 'fn'; } else {
        const fam = (audio.sfxFamilies() || []).find((f) => f.family === s.family);
        const opt = fam?.current || fam?.options?.[0]?.id;
        if (opt) { audio.sfxPreview(s.family, opt, s.cue); fired = `preview:${opt}`; }
      }
      await new Promise((r) => setTimeout(r, 260));
      return { fired, plays: window.__aud.slice(before) };
    }, spec);
    out.heard.push({ cue: spec.cue, ...row });
    console.log('CUE', spec.cue.padEnd(14), JSON.stringify(row));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(120);
  }

  // ---- THE NEGATIVE CONTROL ----------------------------------------------
  // Pin a family to a recording that was deleted. The correct behaviour is that
  // the cue KEEPS SOUNDING from the surviving pool; the failure this guards
  // against is a confident report about a buffer that never played.
  out.control = await page.evaluate(async () => {
    const audio = window.__fw.audio;
    const accepted = audio.sfxSetFamilyOption('ledgerClose', 'setdown');   // deleted in Playtest 4
    const before = window.__aud.length;
    // Fired through the game's own verb. The first version of this control called
    // `audio.sfxPlay`, which does not exist on this module, so it reported the cue
    // as SILENT when nothing had been asked to play at all — a fact about the
    // driver dressed up as a fact about the game (probe lie 32).
    audio.ledgerClose();
    await new Promise((r) => setTimeout(r, 260));
    const plays = window.__aud.slice(before);
    audio.sfxSetFamilyOption('ledgerClose', 'book');
    return { pinAccepted: accepted, stillSounded: plays.length > 0, plays };
  });
  console.log('CONTROL(deleted pin)', JSON.stringify(out.control));

  const byCue = {};
  for (const h of out.heard) {
    byCue[h.cue] = h.plays.map((p) => `${p.tag?.file || '(untagged/synth)'} ${p.peakDb ?? 'silent'}dB ${p.seconds}s`);
  }
  out.verdict = {
    winnersOnly: Object.fromEntries(out.families.filter((f) => f.family !== 'music').map((f) => [f.family, { options: f.options, pinned: f.current }])),
    heard: byCue,
    silentPlays: out.heard.flatMap((h) => h.plays).filter((p) => p.peak === 0).length,
    controlHeldUp: out.control.stillSounded === true && out.control.pinAccepted === false,
    pageErrors: out.errs.slice(0, 8),
  };
  console.log('AUDITION', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'audition-winners.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
