
const { contextBridge, ipcRenderer } = require('electron');

// Sanitize a value to be safe for Electron's structured clone
function safeValue(v) {
  const n = Number(v);
  return (isFinite(n)) ? Math.round(n) : 0;
}
function safeCoords(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return [0, 0];
  return [safeValue(arr[0]), safeValue(arr[1])];
}
function safeClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch(e) { return null; }
}

contextBridge.exposeInMainWorld('petAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => {
    const safe = safeClone(config);
    if (!safe) return Promise.resolve({ success: false });
    return ipcRenderer.invoke('save-config', safe);
  },

  // Media
  uploadMedia: () => ipcRenderer.invoke('upload-media'),
  deleteMedia: (filename) => ipcRenderer.invoke('delete-media', String(filename || '')),
  getMediaList: () => ipcRenderer.invoke('get-media-list'),
  getMediaPath: (filename) => ipcRenderer.invoke('get-media-path', String(filename || '')),
  setActiveMedia: (filename) => ipcRenderer.invoke('set-active-media', String(filename || '')),

  // Panel
  openPanel: () => ipcRenderer.send('open-panel'),

  // Window drag (sanitized to prevent structured-clone failures)
  moveWindow: (delta) => {
    try { ipcRenderer.send('move-window', safeCoords(delta)); } catch(e) {}
  },
  moveWindowTo: (pos) => {
    try { ipcRenderer.send('move-window-to', safeCoords(pos)); } catch(e) {}
  },
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  getWindowPos: () => ipcRenderer.invoke('get-window-pos'),
  getCursorPos: () => ipcRenderer.invoke('get-cursor-pos'),

  // Pet States (read-only definition)
  getPetStates: () => ipcRenderer.invoke('get-pet-states'),

  // Listeners
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config-updated', (_event, config) => {
      try { callback(config); } catch(e) {}
    });
  },
  onMediaUpdated: (callback) => {
    ipcRenderer.on('media-updated', (_event, list) => {
      try { callback(list); } catch(e) {}
    });
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
