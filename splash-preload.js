'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  onUpdate(fn) {
    ipcRenderer.on('splash:update', (_e, data) => fn(data));
  },
  dismiss() {
    ipcRenderer.send('splash:dismiss');
  },
});
