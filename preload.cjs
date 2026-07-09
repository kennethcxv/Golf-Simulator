'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairwayNative', {
  save: (key, json) => ipcRenderer.invoke('fw:save', key, json),
  load: (key) => ipcRenderer.invoke('fw:load', key),
  del: (key) => ipcRenderer.invoke('fw:delete', key),
  list: () => ipcRenderer.invoke('fw:list'),
});
