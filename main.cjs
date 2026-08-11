// FAIRWAY STATE — Electron main process.
// Window management and native save/load only; all game logic lives in src/ and
// also runs in a plain browser for headless QA.
'use strict';

const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createNativeSaveStore } = require('./src/core/nativeSaveStore.cjs');
const { createCrashReporter } = require('./src/electron/crashReport.cjs');
const {
  assertTrustedIpcEvent,
  isTrustedRendererUrl,
  serializeSave,
  trustedRendererUrl,
  validateSaveKey,
} = require('./src/electron/security.cjs');

const DEV = process.argv.includes('--dev');
if (DEV) {
  // 9223 belongs to GlassWaterV2 dev, 9223/9224 saw FAIRWAY STATE QA — GOLF EMPIRE uses 9225
  app.commandLine.appendSwitch('remote-debugging-port', '9225');
}

// WHICH CLUBHOUSE ROOM THIS LAUNCH ASKS FOR, e.g.
//   npm run dev -- --clubhouse=pine-hills-v2
// The packaged app has no address bar, so the greybox room used to be unreachable outside
// a browser tab. Renderer argv is the one channel that arrives before the first page
// script runs, which is what src/data/shopLayout.js needs: it freezes every datum at
// module load and cannot wait for an IPC round-trip. The persisted Developer-tab setting
// covers the sticky case; this covers a one-shot run that leaves nothing behind.
//
// Validated here as well as in the renderer: only these names may cross into argv.
const SELECTABLE_CLUBHOUSE_VARIANTS = [
  'pine-hills-v2', 'pine-hills', 'modern-public', 'mountain-lodge', 'legacy',
];
const requestedClubhouse = (() => {
  const flag = process.argv.find((arg) => arg.startsWith('--clubhouse='));
  const value = flag ? flag.slice('--clubhouse='.length) : null;
  if (value && !SELECTABLE_CLUBHOUSE_VARIANTS.includes(value)) {
    console.warn(`[main] ignoring --clubhouse=${value}; expected one of ${SELECTABLE_CLUBHOUSE_VARIANTS.join(', ')}`);
    return null;
  }
  return value;
})();
// A (Goal 20): a QA launch tells the renderer to use a virtual pointer lock, so
// an automated run never seizes the machine owner's real cursor. FW_QA=1 comes
// from tools/qa/run-electron.cjs and from nothing else, so the shipped game
// cannot receive these. See src/core/qaLookCapture.js for the trade.
const QA_LAUNCH = process.env.FW_QA === '1';
const rendererArguments = [
  ...(DEV ? ['--fw-dev'] : []),
  ...(requestedClubhouse ? [`--fw-clubhouse=${requestedClubhouse}`] : []),
  ...(QA_LAUNCH ? ['--fw-qa'] : []),
  ...(QA_LAUNCH && process.env.FW_QA_POINTERLOCK === '1' ? ['--fw-qa-pointerlock'] : []),
];

let win = null;
let store = null;
const TRUSTED_RENDERER_URL = trustedRendererUrl(__dirname);

function saveDir() {
  const dir = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveStore() {
  if (!store) store = createNativeSaveStore({ dir: saveDir() });
  return store;
}

function assertTrusted(event) {
  assertTrustedIpcEvent(event, TRUSTED_RENDERER_URL);
}

function trustedSaveKey(event, key) {
  assertTrusted(event);
  return validateSaveKey(key);
}

function createWindow() {
  // A5 (Goal 17) — OPEN FULL-WINDOW AT THE DISPLAY'S OWN SIZE.
  //
  // It opened 1600x940 DIP regardless of the monitor. On the owner's 4K panel
  // that is a small window in the corner of the screen, and it is also why
  // every QA screenshot for six rounds was graded at roughly 62% of the linear
  // resolution the owner actually plays at (tools/qa/lib/qa-boot.mjs says so in
  // its own comment, and worked around it per-driver).
  //
  // READING TAKEN: "full-window" is the window FILLING the display, not
  // exclusive fullscreen — the settings panel already owns a fullscreen toggle,
  // and launching fullscreen would take a control away from the player to
  // satisfy a sizing request. Maximised over the work area is the reading that
  // changes the game without colliding with a control that already exists.
  const startDisplay = activeDisplay();
  const area = startDisplay.workArea || startDisplay.bounds || null;
  win = new BrowserWindow({
    x: area && Number.isFinite(area.x) ? area.x : undefined,
    y: area && Number.isFinite(area.y) ? area.y : undefined,
    width: area ? area.width : 1600,
    height: area ? area.height : 940,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#141d12',
    title: 'GOLF EMPIRE',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: rendererArguments,
    },
  });
  win.webContents.on('will-navigate', (event, url) => {
    // Same-document navigation with a query (?scene=shed) is how the renderer
    // enters scoped test scenes; everything else stays blocked.
    if (!isTrustedRendererUrl(url, TRUSTED_RENDERER_URL)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.once('ready-to-show', () => {
    if (!win) return;
    // Maximise BEFORE the first paint, so the player never sees a small window
    // snap outward. The explicit bounds above already cover the work area; this
    // closes the rounding gap and puts the window in the OS's own maximised
    // state, which is what "full-window" means to anyone using it.
    //
    // ...unless a QA fake display is in force, where maximising to the real
    // monitor would erase the simulation and hand the negative control a result
    // it could not fail.
    if (!usingFakeDisplay) win.maximize();
    // A (Goal 20): a QA window must not steal the operator's keyboard focus
    // either. It can afford not to, because the virtual pointer lock reports the
    // page as focused (src/core/qaLookCapture.js) and injected input needs no OS
    // focus — so the window comes up visible but inactive and the owner keeps
    // typing in whatever they were already using. A visible-but-unfocused window
    // is not occluded, so the render loop runs at full rate; minimising it would
    // throttle the renderer and is deliberately NOT done.
    if (QA_LAUNCH) win.showInactive(); else win.show();
  });
  if (DEV) {
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }
  win.on('closed', () => { win = null; });
}

// --- persistence IPC ---------------------------------------------------

ipcMain.handle('fw:save', async (event, key, value) => {
  const trustedKey = trustedSaveKey(event, key);
  serializeSave(value); // Reject oversized payloads before touching the native store.
  return saveStore().save(trustedKey, value);
});

ipcMain.handle('fw:load', async (event, key) => {
  return saveStore().load(trustedSaveKey(event, key));
});

ipcMain.handle('fw:load-status', async (event, key, options) => {
  return saveStore().loadStatus(trustedSaveKey(event, key), options);
});

// Player-facing save browsers need a compact, read-only status contract. Keep
// the crash-safe native store authoritative and adapt its richer result rather
// than introducing a second persistence implementation.
ipcMain.handle('fw:load-record', async (event, key) => {
  const result = await saveStore().loadStatus(trustedSaveKey(event, key), { repair: false });
  if (result.value != null) {
    return {
      status: result.recovered ? 'recovered' : 'ok',
      data: result.value,
      error: result.recovered ? 'The latest save was damaged; the previous backup is available.' : null,
    };
  }
  if (result.missing) return { status: 'missing', data: null };
  return { status: 'corrupt', data: null, error: 'This save could not be read.' };
});

ipcMain.handle('fw:delete', async (event, key) => {
  return saveStore().del(trustedSaveKey(event, key));
});

ipcMain.handle('fw:list', async (event) => {
  assertTrusted(event);
  const keys = await saveStore().list();
  return keys.filter((key) => {
    try {
      validateSaveKey(key);
      return true;
    } catch {
      return false;
    }
  });
});

// Native-only presentation controls. Browser QA intentionally omits these
// rather than displaying toggles that cannot work there.
//
// D1 (Full_Goal_16): THE LIST COMPARED PHYSICAL-PIXEL NAMES AGAINST DIP.
// The candidates are physical sizes — that is what "1080p/1440p/4K" mean —
// but `fits` compared them against display.workAreaSize, which Electron
// reports in DIP (scale-factor-divided) and minus the taskbar. On this 4K
// monitor at Windows scaling, the work area reads ~2560x1392, so 1440p and
// 4K read "larger than this display" ON a 4K display — the reported bug,
// verbatim. Everything below now speaks PHYSICAL pixels: the display's real
// size is size x scaleFactor, `fits` compares against that, and the apply
// path converts back to DIP (Electron's window units) — going borderless
// when a size can only exist without window chrome.
//
// FW_FAKE_DISPLAY ("1600x900@1") injects at this boundary so the QA negative
// control exercises the SHIPPED comparison, not a parallel branch.
// Set by activeDisplay() whenever a QA fake display is in force. createWindow
// reads it: maximising to the REAL monitor would override the simulated one and
// leave the negative control unable to fail, which is the whole point of it.
let usingFakeDisplay = false;
const activeDisplay = () => {
  // argv is the channel proven to reach main (the --clubhouse flag rides
  // it); the env form never arrived through the QA launcher (measured:
  // qaFakeEnv null while the parent shell held the var), so both are read.
  const argvFake = process.argv.find((a) => a.startsWith('--fw-fake-display='));
  let fileFake = null;
  try {
    // the one delivery channel that cannot be stripped by any launcher: a
    // marker file beside main.cjs. QA writes it, runs, deletes it.
    fileFake = fs.readFileSync(path.join(__dirname, 'fw-fake-display.txt'), 'utf8').trim() || null;
  } catch { fileFake = null; }
  const fake = (argvFake ? argvFake.slice('--fw-fake-display='.length) : null)
    || process.env.FW_FAKE_DISPLAY || fileFake;
  if (fake) {
    const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(fake);
    if (m) {
      usingFakeDisplay = true;
      const scale = Number(m[3]) || 1;
      const dipW = Math.round(Number(m[1]) / scale);
      const dipH = Math.round(Number(m[2]) / scale);
      return {
        size: { width: dipW, height: dipH },
        workAreaSize: { width: dipW, height: dipH - Math.round(40 / scale) },
        scaleFactor: scale,
        bounds: { x: 0, y: 0, width: dipW, height: dipH },
      };
    }
  }
  // A5 (Goal 17): ONE definition of "the active display", and it has to answer
  // before the window exists, because createWindow now sizes itself from it.
  // There used to be two — this, and whatever createWindow hard-coded — and
  // they only agree on a single-monitor machine.
  return win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
};

ipcMain.handle('fw:display-info', (event) => {
  assertTrusted(event);
  if (!win) throw new Error('The game window is not ready.');
  const display = activeDisplay();
  const scale = display.scaleFactor || 1;
  const physical = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
  };
  const workPhysical = {
    width: Math.round(display.workAreaSize.width * scale),
    height: Math.round(display.workAreaSize.height * scale),
  };
  const current = win.getContentBounds();
  const currentPhysical = {
    width: Math.round(current.width * scale),
    height: Math.round(current.height * scale),
  };
  // E2: 1080p, 1440p and 4K by name. Sizes are PHYSICAL pixels throughout.
  const candidates = [
    [1100, 680, ''], [1280, 720, '720p'], [1366, 768, ''], [1600, 900, ''],
    [1920, 1080, '1080p'], [2560, 1440, '1440p'], [3840, 2160, '4K'],
  ];
  if (!candidates.some(([width, height]) => width === currentPhysical.width
    && height === currentPhysical.height)) {
    candidates.push([currentPhysical.width, currentPhysical.height, 'current']);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    // Every channel, including the marker file. It used to report only argv and
    // env, so a LEFTOVER fw-fake-display.txt sat there faking the display while
    // this flag said "real" — the stale-control fault (53) with no way to see
    // it. `usingFakeDisplay` is set by activeDisplay() above, whichever channel
    // delivered it.
    qaFakeDisplay: usingFakeDisplay,
    mode: win.isFullScreen() ? 'fullscreen' : 'windowed',
    width: currentPhysical.width,
    height: currentPhysical.height,
    scaleFactor: scale,
    physical,
    // kept for the windowed-mode detail line; now physical like everything else
    workArea: workPhysical,
    resolutions: candidates.map(([width, height, label]) => ({
      width,
      height,
      label,
      fits: width <= physical.width && height <= physical.height,
      // a size the DISPLAY can show but the windowed work area cannot hold
      // applies as borderless-fullscreen rather than a clipped window
      needsBorderless: (width <= physical.width && height <= physical.height)
        && (width > workPhysical.width || height > workPhysical.height),
    })),
  };
});

ipcMain.handle('fw:set-window-mode', (event, mode) => {
  assertTrusted(event);
  if (!win) throw new Error('The game window is not ready.');
  if (!['windowed', 'fullscreen'].includes(mode)) throw new Error('Unsupported window mode.');
  win.setFullScreen(mode === 'fullscreen');
  return true;
});

ipcMain.handle('fw:set-resolution', (event, width, height) => {
  assertTrusted(event);
  if (!win) throw new Error('The game window is not ready.');
  // D1: width/height arrive in PHYSICAL pixels (what the list now speaks).
  const w = Math.max(1100, Math.round(Number(width) || 0));
  const h = Math.max(680, Math.round(Number(height) || 0));
  const display = activeDisplay();
  const scale = display.scaleFactor || 1;
  const physical = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
  };
  if (w > physical.width || h > physical.height) {
    throw new Error('Resolution does not fit the active display.');
  }
  const workPhysical = {
    width: Math.round(display.workAreaSize.width * scale),
    height: Math.round(display.workAreaSize.height * scale),
  };
  if (w > workPhysical.width || h > workPhysical.height) {
    // The display can show it but a chromed window cannot hold it: apply as
    // borderless-fullscreen — which is what picking "4K" on a 4K monitor
    // means. (Previously this path threw, which is the reported bug.)
    win.setFullScreen(true);
    return true;
  }
  if (win.isFullScreen()) win.setFullScreen(false);
  // Electron sizes windows in DIP; convert so the CONTENT is w x h physical.
  win.setContentSize(Math.round(w / scale), Math.round(h / scale), true);
  win.center();
  return true;
});

ipcMain.handle('fw:quit', (event) => {
  assertTrusted(event);
  app.quit();
  return true;
});

// B2 — the dev tuning overlay's persistence. The overlay tunes the live
// clones in the renderer; Save writes the full current mop/broom values
// HERE so they ship with the repo (src/data/toolFeelOverrides.json is
// merged over the defaults at boot). Dev-facing by design: the file lives
// in the source tree, not in userData.
const TOOL_FEEL_OVERRIDES_PATH = path.join(__dirname, 'src', 'data', 'toolFeelOverrides.json');
ipcMain.handle('fw:read-tool-feel', (event) => {
  assertTrusted(event);
  try {
    return JSON.parse(fs.readFileSync(TOOL_FEEL_OVERRIDES_PATH, 'utf8'));
  } catch {
    return null;
  }
});
ipcMain.handle('fw:save-tool-feel', (event, overrides) => {
  assertTrusted(event);
  if (!overrides || typeof overrides !== 'object') throw new Error('No overrides payload.');
  const allowed = {};
  for (const id of ['mop', 'broom']) {
    if (overrides[id] && typeof overrides[id] === 'object') allowed[id] = overrides[id];
  }
  fs.writeFileSync(TOOL_FEEL_OVERRIDES_PATH, `${JSON.stringify(allowed, null, 2)}\n`);
  return { saved: Object.keys(allowed), path: TOOL_FEEL_OVERRIDES_PATH };
});

// --- F3: crash handling -------------------------------------------------
// Before this, a renderer that died took the window with it: blank screen, no
// log, no way for a player to say what happened or to get back in without
// hunting for the executable again. Every fault now lands in one appended file
// and, when the game itself is gone, offers a restart.

let crashReporter = null;
const reporter = () => {
  if (!crashReporter) {
    crashReporter = createCrashReporter({
      dir: path.join(app.getPath('userData'), 'logs'),
      appVersion: app.getVersion(),
    });
  }
  return crashReporter;
};

// Reporting must not itself become the crash. Every path here is guarded, and
// the dialog is skipped entirely in headless/QA runs (FW_QA) so an automated
// launch can never sit on a modal nobody will click.
const HEADLESS = process.env.FW_QA === '1';
let offeringRestart = false;

function offerRestart(title, detail) {
  if (HEADLESS || offeringRestart || !app.isReady()) return;
  offeringRestart = true;
  try {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'GOLF EMPIRE stopped',
      message: title,
      detail: `${detail}

A log was written to:
${reporter().logPath}`,
      buttons: ['Restart', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) {
      app.relaunch();
      app.exit(0);
      return;
    }
    app.exit(1);
  } catch {
    app.exit(1);
  } finally {
    offeringRestart = false;
  }
}

process.on('uncaughtException', (error) => {
  reporter().record('main:uncaughtException', error);
  offerRestart('The game hit an unexpected error.', String(error && error.message ? error.message : error));
});
process.on('unhandledRejection', (reason) => {
  // A rejected promise in main is a fault but not necessarily fatal: log it and
  // keep running rather than killing a session that is still playable.
  reporter().record('main:unhandledRejection', reason);
});
app.on('render-process-gone', (_event, _contents, details) => {
  reporter().record('renderer:process-gone', details && details.reason, details);
  // 'clean-exit' is the window closing normally.
  if (details && details.reason === 'clean-exit') return;
  offerRestart('The game window stopped responding.', `Reason: ${details ? details.reason : 'unknown'}`);
});
app.on('child-process-gone', (_event, details) => {
  reporter().record('child:process-gone', details && details.reason, details);
});

// The renderer's own faults come here so there is ONE log rather than a console
// nobody can read after the window has gone.
ipcMain.handle('fw:report-error', (event, payload) => {
  assertTrusted(event);
  const info = payload && typeof payload === 'object' ? payload : {};
  const record = reporter().record(
    `renderer:${String(info.origin || 'error').slice(0, 40)}`,
    String(info.stack || info.message || 'unknown'),
    { url: String(info.url || '').slice(0, 300), line: info.line ?? null },
  );
  return { logPath: record.logPath, wrote: record.wrote };
});

ipcMain.handle('fw:crash-log', (event) => {
  assertTrusted(event);
  return { path: reporter().logPath, tail: reporter().tail() };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
