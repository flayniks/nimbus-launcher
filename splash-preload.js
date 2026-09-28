'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  onUpdate(fn) {
    ipcRenderer.on('splash:update', (_e, data) => fn(data));
  },
  dismiss() {
    ipcRenderer.send('splash:dismiss');
  },
  /** The minigame started: the window takes keyboard focus so Space works. */
  playing() {
    ipcRenderer.send('splash:play');
  },
});
