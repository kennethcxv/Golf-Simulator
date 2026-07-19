'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairwayNative', {
  save: (key, json) => ipcRenderer.invoke('fw:save', key, json),
  load: (key) => ipcRenderer.invoke('fw:load', key),
  loadStatus: (key, options) => ipcRenderer.invoke('fw:load-status', key, options),
  del: (key) => ipcRenderer.invoke('fw:delete', key),
  list: () => ipcRenderer.invoke('fw:list'),
});
