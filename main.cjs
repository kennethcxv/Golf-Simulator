// FAIRWAY STATE — Electron main process.
// Window management and native save/load only; all game logic lives in src/ and
// also runs in a plain browser for headless QA.
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createNativeSaveStore } = require('./src/core/nativeSaveStore.cjs');

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

let store = null;

function saveStore() {
  if (!store) store = createNativeSaveStore({ dir: saveDir() });
  return store;
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
  return saveStore().save(key, json);
});

ipcMain.handle('fw:load', async (_e, key) => {
  return saveStore().load(key);
});

ipcMain.handle('fw:load-status', async (_e, key, options) => saveStore().loadStatus(key, options));

ipcMain.handle('fw:delete', async (_e, key) => {
  return saveStore().del(key);
});

ipcMain.handle('fw:list', async () => saveStore().list());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
