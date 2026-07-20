// FAIRWAY STATE — Electron main process.
// Window management and native save/load only; all game logic lives in src/ and
// also runs in a plain browser for headless QA.
'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const DEV = process.argv.includes('--dev');
if (DEV) {
  // 9223 belongs to GlassWaterV2 dev, 9223/9224 saw FAIRWAY STATE QA — GOLF EMPIRE uses 9225
  app.commandLine.appendSwitch('remote-debugging-port', '9225');
}

let win = null;

function saveDir() {
  const dir = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyToFile(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return path.join(saveDir(), safe + '.json');
}

function keyToBackupFile(key) {
  return keyToFile(key) + '.bak';
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#141d12',
    title: 'GOLF EMPIRE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  if (DEV) {
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }
  win.on('closed', () => { win = null; });
}

// --- persistence IPC ---------------------------------------------------

ipcMain.handle('fw:save', async (_e, key, json) => {
  const file = keyToFile(key);
  const backup = keyToBackupFile(key);
  const temp = file + '.tmp';
  try { await fsp.copyFile(file, backup); } catch {}
  await fsp.writeFile(temp, JSON.stringify(json), 'utf8');
  try { await fsp.unlink(file); } catch {}
  await fsp.rename(temp, file);
  return true;
});

ipcMain.handle('fw:load', async (_e, key) => {
  const record = await loadRecord(key);
  return record.status === 'ok' || record.status === 'recovered' ? record.data : null;
});

async function loadRecord(key) {
  const file = keyToFile(key);
  try {
    return { status: 'ok', data: JSON.parse(await fsp.readFile(file, 'utf8')) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'missing', data: null };
    try {
      return {
        status: 'recovered',
        data: JSON.parse(await fsp.readFile(keyToBackupFile(key), 'utf8')),
        error: 'The latest save was damaged; the previous backup is available.',
      };
    } catch {
      return { status: 'corrupt', data: null, error: 'This save could not be read.' };
    }
  }
}

ipcMain.handle('fw:load-record', async (_e, key) => loadRecord(key));

ipcMain.handle('fw:delete', async (_e, key) => {
  try { await fsp.unlink(keyToFile(key)); } catch {}
  try { await fsp.unlink(keyToBackupFile(key)); } catch {}
  return true;
});

ipcMain.handle('fw:list', async () => {
  try {
    const files = await fsp.readdir(saveDir());
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
});

// Native-only presentation controls. Browser QA intentionally omits these
// rather than displaying toggles that cannot work there.
ipcMain.handle('fw:display-info', () => {
  if (!win) throw new Error('The game window is not ready.');
  const display = screen.getDisplayMatching(win.getBounds());
  const current = win.getContentBounds();
  const candidates = [
    [1100, 680], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440],
  ].filter(([width, height]) => width <= display.workAreaSize.width && height <= display.workAreaSize.height);
  if (!candidates.some(([width, height]) => width === current.width && height === current.height)) {
    candidates.push([current.width, current.height]);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    mode: win.isFullScreen() ? 'fullscreen' : 'windowed',
    width: current.width,
    height: current.height,
    resolutions: candidates.map(([width, height]) => ({ width, height })),
  };
});

ipcMain.handle('fw:set-window-mode', (_e, mode) => {
  if (!win) throw new Error('The game window is not ready.');
  if (!['windowed', 'fullscreen'].includes(mode)) throw new Error('Unsupported window mode.');
  win.setFullScreen(mode === 'fullscreen');
  return true;
});

ipcMain.handle('fw:set-resolution', (_e, width, height) => {
  if (!win || win.isFullScreen()) throw new Error('Window size can only change in windowed mode.');
  const w = Math.max(1100, Math.round(Number(width) || 0));
  const h = Math.max(680, Math.round(Number(height) || 0));
  const display = screen.getDisplayMatching(win.getBounds());
  if (w > display.workAreaSize.width || h > display.workAreaSize.height) throw new Error('Resolution does not fit the active display.');
  win.setContentSize(w, h, true);
  win.center();
  return true;
});

ipcMain.handle('fw:quit', () => {
  app.quit();
  return true;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
