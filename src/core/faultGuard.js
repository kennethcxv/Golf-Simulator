// F3 — WHAT THE PLAYER SEES WHEN SOMETHING BREAKS.
//
// The renderer used to have no error handling at all: a throw inside a rAF
// callback stopped the frame loop, the picture froze, and the only signal was a
// console message in a window with no devtools. The player's options were to
// stare at it or kill the process.
//
// Three behaviours, in order of how much they hurt:
//   * a NON-FATAL fault (a rejected promise, a bad asset) is logged and
//     swallowed — the session keeps running,
//   * a REPEATED fault from the same place is logged once and then rate-limited,
//     so a per-frame throw cannot fill a disk or a screen,
//   * a FATAL fault (the frame loop is gone) raises a panel that says what
//     happened, where the log is, and offers to reload.
//
// Everything here is defensive by construction. A fault handler that throws is
// worse than no fault handler, so every branch is wrapped and the panel is built
// from DOM primitives with no dependency on the app that just died.

const SEEN = new Map();
const REPEAT_WINDOW_MS = 10000;
const MAX_REPORTS_PER_KEY = 3;

let installed = false;
let panelShown = false;

function keyFor(origin, message) {
  return `${origin}::${String(message || '').slice(0, 120)}`;
}

// Rate limit per distinct fault, not globally: a storm of one bad asset must
// not hide the second, different fault that follows it.
function shouldReport(origin, message, now) {
  const key = keyFor(origin, message);
  const entry = SEEN.get(key);
  if (!entry) {
    SEEN.set(key, { count: 1, first: now });
    return true;
  }
  entry.count += 1;
  if (now - entry.first > REPEAT_WINDOW_MS) {
    entry.first = now;
    entry.count = 1;
    return true;
  }
  return entry.count <= MAX_REPORTS_PER_KEY;
}

export function faultCounts() {
  return [...SEEN.entries()].map(([key, entry]) => ({ key, count: entry.count }));
}

export function resetFaultGuardForTests() {
  SEEN.clear();
  installed = false;
  panelShown = false;
}

function describe(error) {
  if (error == null) return { message: 'unknown', stack: '' };
  if (typeof error === 'string') return { message: error, stack: '' };
  return {
    message: String(error.message || error),
    stack: String(error.stack || ''),
  };
}

/** Send one fault to the native log. Never throws, never awaits the caller. */
export function reportFault(origin, error, extra = {}, deps = {}) {
  const bridge = deps.native !== undefined ? deps.native : globalThis.fairwayNative;
  const now = deps.now ? deps.now() : Date.now();
  const { message, stack } = describe(error);
  if (!shouldReport(origin, message, now)) return { reported: false, reason: 'rate-limited' };
  try {
    // eslint-disable-next-line no-console
    console.error(`[fault:${origin}]`, error);
  } catch { /* a console that throws is not a reason to stop */ }
  try {
    bridge?.reportError?.({ origin, message, stack, ...extra });
  } catch { /* the bridge is best-effort; a browser QA run has none */ }
  return { reported: true, message };
}

/**
 * The fatal panel. Built without touching any app module, because the app is
 * what just failed. Returns the element so a test can assert on its content.
 */
export function showFatalPanel({ message, logPath = null, doc = globalThis.document, onReload = null } = {}) {
  if (!doc || panelShown) return null;
  panelShown = true;
  const wrap = doc.createElement('div');
  wrap.className = 'fault-panel';
  wrap.setAttribute('role', 'alertdialog');
  wrap.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'display:flex',
    'align-items:center', 'justify-content:center',
    'background:rgba(8,12,10,0.92)', 'color:#e8e6df',
    'font:16px/1.5 system-ui,sans-serif', 'padding:24px',
  ].join(';');
  const card = doc.createElement('div');
  card.style.cssText = [
    'max-width:520px', 'background:#141a17', 'border:1px solid #2f3a34',
    'border-radius:10px', 'padding:24px 26px',
  ].join(';');
  const title = doc.createElement('h2');
  title.textContent = 'The game hit a problem';
  title.style.cssText = 'margin:0 0 10px;font-size:20px;font-weight:600;';
  const body = doc.createElement('p');
  body.textContent = 'Your last save is untouched. Reloading starts again from it.';
  body.style.cssText = 'margin:0 0 14px;';
  const detail = doc.createElement('p');
  detail.textContent = String(message || 'Unknown error');
  detail.style.cssText = 'margin:0 0 14px;font:13px/1.4 ui-monospace,monospace;color:#9fb3a6;word-break:break-word;';
  const where = doc.createElement('p');
  where.textContent = logPath ? `Details were written to ${logPath}` : 'Details were written to the crash log.';
  where.style.cssText = 'margin:0 0 18px;font-size:13px;color:#8b998f;word-break:break-all;';
  const button = doc.createElement('button');
  button.textContent = 'Reload the game';
  button.className = 'fault-panel-reload';
  button.style.cssText = [
    'font:inherit', 'padding:10px 18px', 'border-radius:7px', 'cursor:pointer',
    'border:1px solid #4c6b56', 'background:#1f3327', 'color:#e8e6df',
  ].join(';');
  button.addEventListener('click', () => {
    try {
      if (onReload) onReload();
      else globalThis.location?.reload?.();
    } catch { /* nothing left to do */ }
  });
  card.append(title, body, detail, where, button);
  wrap.append(card);
  doc.body.appendChild(wrap);
  return wrap;
}

/**
 * Install the window-level hooks. Idempotent — a second call is a no-op, which
 * matters because the scene can be rebuilt without a page reload.
 */
export function installFaultGuard({ scope = globalThis, native = null, fatalOnFrameLoss = true } = {}) {
  if (installed) return false;
  installed = true;
  const bridge = native || scope.fairwayNative;

  scope.addEventListener?.('error', (event) => {
    const error = event?.error || event?.message;
    const result = reportFault('window.onerror', error, {
      url: String(event?.filename || ''),
      line: event?.lineno ?? null,
    }, { native: bridge });
    // A ResourceLoad error (a missing image, a missing audio file) arrives here
    // with no `error` object. Those are handled by their own loaders' fallbacks
    // and must never raise the fatal panel.
    if (!fatalOnFrameLoss || !event?.error) return;
    if (!result.reported) return;
    const panel = showFatalPanel({ message: result.message, doc: scope.document });
    // The path arrives over IPC, so it cannot be in the first paint. Fill it in
    // when it lands: a player reporting a bug needs the file, and "the crash
    // log" without a path is not an instruction.
    if (panel) {
      Promise.resolve(bridge?.crashLog?.()).then((log) => {
        if (!log?.path) return;
        const where = panel.querySelector('p:nth-of-type(3)');
        if (where) where.textContent = `Details were written to ${log.path}`;
      }).catch(() => { /* the panel is still useful without it */ });
    }
  });

  scope.addEventListener?.('unhandledrejection', (event) => {
    reportFault('unhandledrejection', event?.reason, {}, { native: bridge });
    // Non-fatal by policy: a rejected fetch for one asset must not end a session
    // that is otherwise running.
  });

  return true;
}
