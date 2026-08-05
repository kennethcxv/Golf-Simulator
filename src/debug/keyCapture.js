// KEY CAPTURE OVERLAY — for the class of bug where a key "works" in every
// harness and does nothing under a real hand.
//
// Two synthetic harnesses (walk-input-parity.js, electron-walk-input.mjs) both
// measure D and both pass, while D does not strafe in real play. Synthetic
// events are dispatched by the automation driver and land on the document with
// no OS keyboard, no layout mapping, and no other listener racing them. So the
// divergence is somewhere in the delivery chain, not in the movement code —
// and the only way to see it is to watch a REAL keypress travel.
//
// The overlay taps the chain at four points and shows where the key stops:
//
//   1. window capture  — the earliest a page can observe the event at all.
//   2. window bubble   — where the walk controller's own listener sits. A key
//                        present at (1) and missing at (2) was killed in
//                        between by a stopPropagation.
//   3. walkHeld        — whether the walk controller actually recorded it
//                        (courseScene exposes it read-only for exactly this).
//   4. position delta  — whether the walker then moved.
//
// A key that reaches (1) but not (2) is an interception. One that reaches (2)
// but not (3) is a filter (isTextEntryTarget, or a mode that returns early).
// One that reaches (3) but not (4) is movement/collision. One that never
// reaches (1) never left the OS or the shell — a layout, an Electron
// accelerator, or the physical keyboard.
//
// Enabled only by ?keydebug=1. Never runs otherwise; nothing here is on a
// normal frame path.

const MAX_EVENTS = 400;

export function isKeyCaptureRequested(search = window.location.search) {
  return new URLSearchParams(search).get('keydebug') === '1';
}

export function startKeyCapture(app) {
  const events = [];
  const seenAtCapture = new Map(); // code -> event seq, to pair capture with bubble
  let seq = 0;

  const root = document.createElement('div');
  root.className = 'keydebug';
  root.setAttribute('role', 'status');
  root.style.cssText = [
    'position:fixed', 'right:12px', 'top:12px', 'width:430px', 'max-height:76vh',
    'z-index:99999', 'background:rgba(12,14,18,0.94)', 'color:#e8e6e1',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'border:1px solid #3a4048', 'border-radius:8px', 'padding:10px 12px',
    'overflow:auto', 'white-space:pre-wrap', 'pointer-events:auto',
    'box-shadow:0 8px 28px rgba(0,0,0,0.45)',
  ].join(';');

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';
  const title = document.createElement('strong');
  title.textContent = 'KEY CAPTURE';
  title.style.cssText = 'flex:1;letter-spacing:0.06em;font-size:11px';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy report';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  for (const b of [copyBtn, clearBtn]) {
    b.style.cssText = 'font:11px ui-monospace,monospace;padding:3px 8px;'
      + 'background:#222831;color:#e8e6e1;border:1px solid #495059;border-radius:5px;cursor:pointer';
  }
  head.append(title, copyBtn, clearBtn);

  const body = document.createElement('div');
  root.append(head, body);
  document.body.appendChild(root);

  const walkOf = () => app?.scene3d?.walk || null;
  const heldOf = () => {
    const walk = walkOf();
    try {
      return typeof walk?.heldKeys === 'function' ? walk.heldKeys() : null;
    } catch { return null; }
  };
  const posOf = () => {
    const s = walkOf()?.state;
    return s && Number.isFinite(s.x) ? { x: s.x, z: s.z, yaw: s.yaw } : null;
  };

  const record = (row) => {
    events.push(row);
    if (events.length > MAX_EVENTS) events.shift();
    paint();
  };

  // Capture phase on window is the earliest observation point available to
  // page script: nothing in the page can have stopped it yet.
  const onCapture = (e) => {
    seq += 1;
    const id = seq;
    seenAtCapture.set(`${e.type}:${e.code}:${e.key}`, id);
    const before = posOf();
    // Read the outcome AFTER the event has finished propagating, so bubble
    // listeners and the walk controller have both had their turn.
    setTimeout(() => {
      const held = heldOf();
      const after = posOf();
      const moved = before && after
        ? +Math.hypot(after.x - before.x, after.z - before.z).toFixed(4)
        : null;
      const row = events.find((r) => r.id === id);
      if (row) {
        row.heldAfter = held;
        row.heldHasKey = held ? held.includes(String(e.key).toLowerCase()) : null;
        row.movedWithin0ms = moved;
      }
      paint();
    }, 0);

    record({
      id,
      type: e.type,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      which: e.which,
      repeat: e.repeat,
      isTrusted: e.isTrusted,
      ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
      target: e.target?.tagName ? `${e.target.tagName}${e.target.id ? `#${e.target.id}` : ''}` : String(e.target),
      activeElement: document.activeElement?.tagName || null,
      pointerLocked: !!document.pointerLockElement,
      // filled in by the bubble listener and the timeout above
      reachedBubble: false,
      defaultPreventedAtCapture: e.defaultPrevented,
      heldAfter: null,
      heldHasKey: null,
      movedWithin0ms: null,
      walkActive: !!walkOf()?.isActive?.(),
    });
  };

  // Bubble phase on window is where courseScene's walkKeyDown listens. If a key
  // is at capture but never here, something between the two killed it.
  const onBubble = (e) => {
    const id = seenAtCapture.get(`${e.type}:${e.code}:${e.key}`);
    const row = events.find((r) => r.id === id);
    if (row) {
      row.reachedBubble = true;
      row.defaultPreventedAtBubble = e.defaultPrevented;
      paint();
    }
  };

  const interesting = (r) => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(r.code);

  function paint() {
    const wasd = events.filter(interesting);
    const summary = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((code) => {
      const downs = wasd.filter((r) => r.code === code && r.type === 'keydown');
      if (!downs.length) return `${code.slice(3)}  - not pressed yet`;
      const last = downs[downs.length - 1];
      const bubbled = downs.filter((r) => r.reachedBubble).length;
      const inHeld = downs.filter((r) => r.heldHasKey).length;
      const movedAny = downs.filter((r) => (r.movedWithin0ms || 0) > 0.0005).length;
      return `${code.slice(3)}  n=${downs.length}  key='${last.key}'  bubble=${bubbled}/${downs.length}`
        + `  held=${inHeld}/${downs.length}  moved=${movedAny}/${downs.length}`;
    }).join('\n');

    const tail = events.slice(-14).map((r) => (
      `${String(r.id).padStart(3)} ${r.type === 'keydown' ? 'v' : '^'} `
      + `${(r.code || '?').padEnd(9)} key='${r.key}' `
      + `${r.reachedBubble ? 'bubble' : 'STOPPED'} `
      + `${r.heldHasKey === null ? '' : r.heldHasKey ? 'held' : 'NOT-HELD'} `
      + `${r.movedWithin0ms === null ? '' : `d=${r.movedWithin0ms}`} `
      + `tgt=${r.target}${r.repeat ? ' rpt' : ''}${r.isTrusted ? '' : ' SYNTH'}`
    )).join('\n');

    body.textContent = `${summary}\n\nheld now: ${JSON.stringify(heldOf())}\n`
      + `walkActive: ${!!walkOf()?.isActive?.()}  locked: ${!!document.pointerLockElement}\n`
      + `\nlast events\n${tail || '(none)'}`;
  }

  const report = () => JSON.stringify({
    when: new Date().toISOString(),
    href: window.location.href,
    userAgent: navigator.userAgent,
    // Layout matters: on a layout where D is not where QWERTY puts it, `key`
    // and `code` disagree, and code that keys off one of them breaks.
    keyboardLayout: navigator.keyboard?.getLayoutMap ? 'queryable' : 'unavailable',
    electron: !!(window.process?.versions?.electron || /Electron/i.test(navigator.userAgent)),
    walkActive: !!walkOf()?.isActive?.(),
    heldNow: heldOf(),
    events,
  }, null, 2);

  copyBtn.addEventListener('click', async () => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
    } catch {
      // Clipboard can be blocked; fall back to a selectable dump so the report
      // is never trapped inside the page.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;inset:5vh 5vw;z-index:100000;width:90vw;height:90vh';
      document.body.appendChild(ta);
      ta.select();
      copyBtn.textContent = 'Select + copy';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy report'; }, 1600);
  });
  clearBtn.addEventListener('click', () => { events.length = 0; seenAtCapture.clear(); paint(); });

  window.addEventListener('keydown', onCapture, true);
  window.addEventListener('keyup', onCapture, true);
  window.addEventListener('keydown', onBubble, false);
  window.addEventListener('keyup', onBubble, false);
  paint();

  const api = {
    report,
    events: () => events.slice(),
    stop() {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keyup', onCapture, true);
      window.removeEventListener('keydown', onBubble, false);
      window.removeEventListener('keyup', onBubble, false);
      root.remove();
    },
  };
  window.__fwKeyCapture = api;
  return api;
}
