'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairwayNative', {
  save: (key, json) => ipcRenderer.invoke('fw:save', key, json),
  load: (key) => ipcRenderer.invoke('fw:load', key),
  loadStatus: (key, options) => ipcRenderer.invoke('fw:load-status', key, options),
  loadRecord: (key) => ipcRenderer.invoke('fw:load-record', key),
  del: (key) => ipcRenderer.invoke('fw:delete', key),
  list: () => ipcRenderer.invoke('fw:list'),
  displayInfo: () => ipcRenderer.invoke('fw:display-info'),
  setWindowMode: (mode) => ipcRenderer.invoke('fw:set-window-mode', mode),
  setResolution: (width, height) => ipcRenderer.invoke('fw:set-resolution', width, height),
  quit: () => ipcRenderer.invoke('fw:quit'),
});
