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
const rendererArguments = [
  ...(DEV ? ['--fw-dev'] : []),
  ...(requestedClubhouse ? [`--fw-clubhouse=${requestedClubhouse}`] : []),
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
  win = new BrowserWindow({
    width: 1600,
    height: 940,
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
  win.once('ready-to-show', () => win && win.show());
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
ipcMain.handle('fw:display-info', (event) => {
  assertTrusted(event);
  if (!win) throw new Error('The game window is not ready.');
  const display = screen.getDisplayMatching(win.getBounds());
  const current = win.getContentBounds();
  // E2: 1080p, 1440p and 4K by name, and 4K is new. The list used to be FILTERED
  // by the work area, so a size the monitor could not show simply was not there
  // — which reads as a missing feature rather than a physical limit. Every size
  // is returned now, each carrying whether it fits, and the settings screen
  // greys the ones that do not and says why.
  const candidates = [
    [1100, 680, ''], [1280, 720, '720p'], [1366, 768, ''], [1600, 900, ''],
    [1920, 1080, '1080p'], [2560, 1440, '1440p'], [3840, 2160, '4K'],
  ];
  if (!candidates.some(([width, height]) => width === current.width && height === current.height)) {
    candidates.push([current.width, current.height, 'current']);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    mode: win.isFullScreen() ? 'fullscreen' : 'windowed',
    width: current.width,
    height: current.height,
    workArea: { width: display.workAreaSize.width, height: display.workAreaSize.height },
    resolutions: candidates.map(([width, height, label]) => ({
      width,
      height,
      label,
      fits: width <= display.workAreaSize.width && height <= display.workAreaSize.height,
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
  if (!win || win.isFullScreen()) throw new Error('Window size can only change in windowed mode.');
  const w = Math.max(1100, Math.round(Number(width) || 0));
  const h = Math.max(680, Math.round(Number(height) || 0));
  const display = screen.getDisplayMatching(win.getBounds());
  if (w > display.workAreaSize.width || h > display.workAreaSize.height) {
    throw new Error('Resolution does not fit the active display.');
  }
  win.setContentSize(w, h, true);
  win.center();
  return true;
});

ipcMain.handle('fw:quit', (event) => {
  assertTrusted(event);
  app.quit();
  return true;
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
