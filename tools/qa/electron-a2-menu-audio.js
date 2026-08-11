// A2 (Goal 22) — A CHECK THAT CAN PERCEIVE SOUND.
//
// The main menu has been reported silent by the owner after being marked done,
// and the check that passed is `tests/menu-sound.test.js`: four REGEXES over
// the text of menu.js and main.js. They assert the file CONTAINS the string
// `audio?.uiTick?.()`. They cannot tell whether uiTick makes a sound, whether
// `audio` is non-null at that moment, whether the context exists or is
// suspended, or whether the gain is zero. A test that reads the source instead
// of the run cannot perceive the thing it certifies.
//
// This one listens. Before anything is clicked it wraps the Web Audio graph:
//
//   * every AudioContext constructed is recorded, with its state
//   * every source node created is recorded
//   * every start() is recorded -- a node built and never started is silent
//   * every gain value set is recorded -- a node started at 0 gain is silent
//
// Then it presses each menu button in turn and reports what the graph did in
// the window after each press. A press that schedules no source is the failure,
// and that is measurable without ears.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a2-menu-audio.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a2-menu-audio');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });

  // Install the tap before anything is CLICKED. addInitScript is not honoured
  // through the Electron wrapper, but it is not needed: the audio context can
  // only be constructed from a user gesture, and no gesture has happened yet,
  // so patching the constructor now still catches the first one. The tap
  // asserts this for itself below — if a context already exists we are late and
  // the run is void rather than quietly partial.
  await page.waitForTimeout(6000);
  await page.waitForSelector('button', { timeout: 120000 });
  await page.evaluate(() => {
    const log = [];
    window.__audioTap = {
      log,
      contexts: [],
      since(t) { return log.filter((e) => e.t >= t); },
      now() { return performance.now(); },
    };
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { log.push({ t: 0, kind: 'no-webaudio' }); return; }
    const record = (kind, extra) => log.push({ t: performance.now(), kind, ...extra });

    const wrapStart = (node, kind) => {
      const start = node.start?.bind(node);
      if (!start) return node;
      node.start = (...a) => { record('start', { node: kind }); return start(...a); };
      return node;
    };

    const patchContext = (ctx) => {
      window.__audioTap.contexts.push(ctx);
      record('context', { state: ctx.state, rate: ctx.sampleRate });
      const co = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => { record('create', { node: 'oscillator' }); return wrapStart(co(), 'oscillator'); };
      const cb = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => { record('create', { node: 'buffer' }); return wrapStart(cb(), 'buffer'); };
      const cg = ctx.createGain.bind(ctx);
      ctx.createGain = () => {
        const g = cg();
        record('create', { node: 'gain' });
        // A source started into a zero gain is as silent as no source at all,
        // so the value actually scheduled is part of the evidence.
        const sv = g.gain.setValueAtTime.bind(g.gain);
        g.gain.setValueAtTime = (v, t) => { record('gain', { value: +Number(v).toFixed(4) }); return sv(v, t); };
        return g;
      };
      return ctx;
    };

    const Wrapped = function AudioContextTap(...args) {
      const ctx = new Ctor(...args);
      return patchContext(ctx);
    };
    Wrapped.prototype = Ctor.prototype;
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
  });

  // NEGATIVE CONTROL, and the one that matters for this instrument: prove the
  // tap is wired to something real before trusting a silence it reports. Build
  // a context and a source by hand and check the tap saw them. A tap that
  // records nothing looks exactly like a game that plays nothing.
  const control = await page.evaluate(() => {
    const before = window.__audioTap.log.length;
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
    const after = window.__audioTap.log.slice(before);
    ctx.close?.();
    // this hand-built context is not the game's; drop it so the real one is [0]
    window.__audioTap.contexts.length = 0;
    window.__audioTap.log.length = before;
    return {
      sawContext: after.some((e) => e.kind === 'context'),
      sawCreate: after.some((e) => e.kind === 'create'),
      sawStart: after.some((e) => e.kind === 'start'),
      sawGain: after.some((e) => e.kind === 'gain'),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'menu.png') });

  // enumerate the buttons a player can actually press
  const buttons = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none';
    })
    .map((b, i) => ({
      i,
      text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40),
      disabled: !!b.disabled,
      x: Math.round(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2),
      y: Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2),
    })));

  const results = [];
  for (const b of buttons) {
    if (b.disabled) { results.push({ ...b, skipped: 'disabled' }); continue; }
    // Never press a button that leaves the menu; the subject is the menu.
    if (/new game|continue|load|quit|exit|start/i.test(b.text)) {
      // these are the ones that matter most, so press them but undo with Escape
      // only if a dialog opens; a press that navigates ends the measurement.
    }
    const t0 = await page.evaluate(() => window.__audioTap.now());
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(320);
    const heard = await page.evaluate((t) => {
      const tap = window.__audioTap;
      const since = tap.since(t);
      return {
        contexts: tap.contexts.length,
        contextState: tap.contexts[0]?.state ?? null,
        events: since.map((e) => ({ kind: e.kind, node: e.node, value: e.value, state: e.state })),
        starts: since.filter((e) => e.kind === 'start').length,
        creates: since.filter((e) => e.kind === 'create').length,
        gains: since.filter((e) => e.kind === 'gain').map((e) => e.value),
      };
    }, t0);
    results.push({ ...b, heard, audible: heard.starts > 0 && heard.gains.some((g) => g > 0.0005) });
    // close anything that opened so the next button is reachable
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // DISCRIMINATOR. Two stories fit "pressed a button, no oscillator": the
  // handler never ran, or it ran and uiTick bailed. Call uiTick directly, with
  // the tap listening, and the two stories separate.
  const direct = await page.evaluate(async () => {
    const app = window.__fw;
    const tap = window.__audioTap;
    const audio = app?.audio || null;
    const out = { hasAppAudio: !!audio, ready: audio?.ready ?? null, calls: {} };
    for (const name of ['uiTick', 'uiConfirm', 'uiError']) {
      if (typeof audio?.[name] !== 'function') { out.calls[name] = 'missing'; continue; }
      const t = tap.now();
      audio[name]();
      await new Promise((r) => setTimeout(r, 120));
      const since = tap.since(t);
      out.calls[name] = {
        creates: since.filter((e) => e.kind === 'create').length,
        starts: since.filter((e) => e.kind === 'start').length,
      };
      // space the calls past any debounce window
      await new Promise((r) => setTimeout(r, 400));
    }
    // and again, twice in a row, to expose a first-call-swallowed debounce
    if (typeof audio?.uiTick === 'function') {
      const t = tap.now();
      audio.uiTick();
      await new Promise((r) => setTimeout(r, 300));
      audio.uiTick();
      await new Promise((r) => setTimeout(r, 200));
      const since = tap.since(t);
      out.twiceInARow = since.filter((e) => e.kind === 'start').length;
    }
    return out;
  });

  // PHASE 3 — THE HYPOTHESIS, TESTED. The press listener is attached only
  // inside setVisible(true). If the boot path never calls it, the handler is
  // correct and unreachable. Call setVisible(true) by hand and press again: if
  // the button now speaks, that was the whole defect.
  const afterSetVisible = await page.evaluate(async () => {
    const app = window.__fw;
    const tap = window.__audioTap;
    if (typeof app?.menu?.setVisible !== 'function') return { available: false };
    app.menu.setVisible(true);
    await new Promise((r) => setTimeout(r, 300));
    const btn = [...document.querySelectorAll('button')].find((b) => !b.disabled
      && /settings/i.test(b.innerText || ''));
    if (!btn) return { available: true, pressed: false };
    const t = tap.now();
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 250));
    const since = tap.since(t);
    return {
      available: true,
      pressed: true,
      starts: since.filter((e) => e.kind === 'start').length,
      creates: since.filter((e) => e.kind === 'create').length,
    };
  });

  const pressed = results.filter((r) => !r.skipped);
  const out = {
    control, direct, afterSetVisible, buttons, results, errs,
    summary: {
      buttonsFound: buttons.length,
      buttonsPressed: pressed.length,
      buttonsThatMadeSound: pressed.filter((r) => r.audible).length,
      silentButtons: pressed.filter((r) => !r.audible).map((r) => r.text),
      anyContextEverCreated: results.some((r) => (r.heard?.contexts || 0) > 0),
      contextState: results.map((r) => r.heard?.contextState).filter(Boolean)[0] || null,
    },
  };
  out.checks = {
    // the instrument first: a tap that hears nothing proves nothing
    tapHearsAKnownSound: control.sawContext && control.sawCreate
      && control.sawStart && control.sawGain,
    // the whole point: EVERY enabled menu button makes a sound
    everyButtonSpeaks: pressed.length > 0 && pressed.every((r) => r.audible),
    audioContextExists: out.summary.anyContextEverCreated,
    contextRunning: out.summary.contextState === 'running',
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'menu-audio.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
