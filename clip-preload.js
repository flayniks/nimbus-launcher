'use strict';
// The hidden replay-clip recorder window: takes commands from the main process and answers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clip', {
  platform: process.platform,
  on(fn) {
    ipcRenderer.on('clip:cmd', (_e, msg) => fn(msg));
  },
  send(type, payload = {}) {
    ipcRenderer.send('clip:event', { type, ...payload });
  },
});
