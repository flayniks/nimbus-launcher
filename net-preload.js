'use strict';
// The hidden Nimbus LAN window: only passes messages between the WebRTC code and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('net', {
  on(fn) {
    ipcRenderer.on('net:cmd', (_e, msg) => fn(msg));
  },
  send(type, payload) {
    ipcRenderer.send('net:event', { type, ...payload });
  },
});
