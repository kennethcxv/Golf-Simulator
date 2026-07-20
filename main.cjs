// FAIRWAY STATE — Electron main process.
// Window management and native save/load only; all game logic lives in src/ and
// also runs in a plain browser for headless QA.
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const {
  assertTrustedIpcEvent,
  serializeSave,
  trustedRendererUrl,
  validateSaveKey,
} = require('./src/electron/security.cjs');

const DEV = process.argv.includes('--dev');
if (DEV) {
  // 9223 belongs to GlassWaterV2 dev, 9223/9224 saw FAIRWAY STATE QA — GOLF EMPIRE uses 9225
  app.commandLine.appendSwitch('remote-debugging-port', '9225');
}

let win = null;
const TRUSTED_RENDERER_URL = trustedRendererUrl(__dirname);

function saveDir() {
  const dir = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyToFile(key) {
  return path.join(saveDir(), validateSaveKey(key) + '.json');
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
    },
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== TRUSTED_RENDERER_URL) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.once('ready-to-show', () => win && win.show());
  if (DEV) {
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }
  win.on('closed', () => { win = null; });
}

// --- persistence IPC ---------------------------------------------------

ipcMain.handle('fw:save', async (event, key, value) => {
  assertTrustedIpcEvent(event, TRUSTED_RENDERER_URL);
  await fsp.writeFile(keyToFile(key), serializeSave(value), 'utf8');
  return true;
});

ipcMain.handle('fw:load', async (event, key) => {
  assertTrustedIpcEvent(event, TRUSTED_RENDERER_URL);
  try {
    return JSON.parse(await fsp.readFile(keyToFile(key), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('fw:delete', async (event, key) => {
  assertTrustedIpcEvent(event, TRUSTED_RENDERER_URL);
  try { await fsp.unlink(keyToFile(key)); } catch {}
  return true;
});

ipcMain.handle('fw:list', async (event) => {
  assertTrustedIpcEvent(event, TRUSTED_RENDERER_URL);
  try {
    const files = await fsp.readdir(saveDir());
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
