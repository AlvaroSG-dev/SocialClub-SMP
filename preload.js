'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('launcher', {
  init: () => ipcRenderer.invoke('init'),
  status: () => ipcRenderer.invoke('status'),
  play: (data) => ipcRenderer.invoke('play', data),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  copy: (text) => ipcRenderer.invoke('clipboard', text),
  msLogin: () => ipcRenderer.invoke('ms:login'),
  msLogout: () => ipcRenderer.invoke('ms:logout'),
  skinPick: () => ipcRenderer.invoke('skin:pick'),
  skinCurrent: (a) => ipcRenderer.invoke('skin:current', a),
  news: () => ipcRenderer.invoke('news'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateOpen: () => ipcRenderer.invoke('update:open'),
  skinSaved: () => ipcRenderer.invoke('skin:saved'),
  skinUpload: (data) => ipcRenderer.invoke('skin:upload', data),
  onLog: (cb) => on('log', cb),
  onStage: (cb) => on('stage', cb),
  onProgress: (cb) => on('progress', cb),
  onState: (cb) => on('state', cb),
  onMsCode: (cb) => on('ms-code', cb),
});
