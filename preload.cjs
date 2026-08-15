'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderer's own argv, filtered to the flags main.cjs plants deliberately
// (webPreferences.additionalArguments). This is a synchronous read available before any
// page script runs, which is the only kind src/data/shopLayout.js can use: it freezes
// every clubhouse datum at module-eval time, so a launch flag delivered by IPC would
// arrive after the room had already been decided. Copied to a plain array so nothing
// downstream can reach the live process object.
const FORWARDED_FLAG_PREFIXES = ['--fw-dev', '--fw-clubhouse=', '--fw-qa'];
const launchArgs = Object.freeze(
  (process.argv || [])
    .filter((arg) => typeof arg === 'string' && FORWARDED_FLAG_PREFIXES.some((p) => arg.startsWith(p)))
    .map(String),
);

contextBridge.exposeInMainWorld('fairwayNative', {
  launchArgs,
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
  // F3: the renderer's own faults go to the SAME log the main process writes,
  // so a support report is one file rather than a console that dies with the
  // window it was printing to.
  reportError: (payload) => ipcRenderer.invoke('fw:report-error', payload),
  crashLog: () => ipcRenderer.invoke('fw:crash-log'),
  // B2 (dev tuning overlay): the saved mop/broom feel overrides. What the
  // overlay tunes is written to src/data/toolFeelOverrides.json and merged
  // over the shipped defaults at boot — what you tune is what ships.
  readToolFeel: () => ipcRenderer.invoke('fw:read-tool-feel'),
  saveToolFeel: (overrides) => ipcRenderer.invoke('fw:save-tool-feel', overrides),
});
