const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Disable GPU to ensure transparent windows work on Windows ──
app.disableHardwareAcceleration();

// ─── Paths ───────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const MEDIA_DIR = path.join(USER_DATA, 'media');
const CONFIG_PATH = path.join(USER_DATA, 'config.json');

// ─── State Definitions (predefined, always available) ────
const PET_STATES = {
  normal:   { label: '正常待机', icon: '🐕', anim: 'float',  desc: '默认闲置状态，轻缓浮动' },
  playing:  { label: '玩耍互动', icon: '🎾', anim: 'bounce', desc: '点击或互动时显示的活泼状态' },
  sleeping: { label: '睡觉休息', icon: '💤', anim: 'sleep',  desc: '长时间无操作后自动进入' },
  happy:    { label: '开心撒娇', icon: '💕', anim: 'wiggle', desc: '被抚摸时显示的开心状态' },
  eating:   { label: '进食干饭', icon: '🍖', anim: 'pulse',  desc: '喂零食时显示的进食状态' },
  angry:    { label: '生气炸毛', icon: '💢', anim: 'shake',  desc: '可选：反复戳弄后的生气状态' }
};

// ─── Default Config ──────────────────────────────────────
const DEFAULT_CONFIG = {
  activeMedia: null,
  petSize: 200,

  // State → media filename mapping. Empty string = use placeholder.
  stateMedias: {
    normal: '',
    playing: '',
    sleeping: '',
    happy: '',
    eating: '',
    angry: ''
  },

  interactionButtons: [
    { label: '摸摸头', state: 'happy',   responses: ['好舒服~', '再摸摸嘛~', '嘿嘿嘿~'] },
    { label: '喂零食', state: 'eating',  responses: ['好吃好吃!', '还有吗还有吗?', '汪! 太棒了~'] },
    { label: '击掌',   state: 'playing', responses: ['耶! ✋', '配合满分!', '再来一次!'] }
  ],

  clickResponses: ['汪!', '呜~', '嘿嘿', '干嘛呀~', 'Hello!'],

  idleMessages: [
    { message: '你在干嘛呀?', interval: 60000 },
    { message: '好无聊哦...', interval: 120000 },
    { message: '带我出去玩吧~', interval: 180000 }
  ],
  idleEnabled: true,

  // How many seconds of inactivity before entering sleeping state (0 = disabled)
  sleepAfterIdleSec: 30,

  // Movement speed when following mouse (1 = slowest, 10 = fastest)
  moveSpeed: 5
};

// ─── App State ───────────────────────────────────────────
let petWindow = null;
let panelWindow = null;
let currentConfig = null;

// ─── Helpers ─────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadConfig() {
  ensureDir(USER_DATA);
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };

      // Migration: ensure stateMedias exists and has all keys
      if (!currentConfig.stateMedias) {
        currentConfig.stateMedias = { ...DEFAULT_CONFIG.stateMedias };
      } else {
        for (const key of Object.keys(DEFAULT_CONFIG.stateMedias)) {
          if (!(key in currentConfig.stateMedias)) {
            currentConfig.stateMedias[key] = DEFAULT_CONFIG.stateMedias[key];
          }
        }
      }

      // Migration: add 'state' field to old buttons
      if (currentConfig.interactionButtons) {
        currentConfig.interactionButtons.forEach((btn, i) => {
          if (!btn.state) {
            btn.state = i === 0 ? 'happy' : i === 1 ? 'eating' : 'playing';
          }
        });
      }
    } catch (e) {
      currentConfig = { ...DEFAULT_CONFIG };
    }
  } else {
    currentConfig = { ...DEFAULT_CONFIG };
  }
  saveConfig();
  return currentConfig;
}

function saveConfig() {
  try {
    ensureDir(USER_DATA);
    // Use a replacer to strip any non-serializable values
    const safe = JSON.parse(JSON.stringify(currentConfig));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

function getMediaList() {
  ensureDir(MEDIA_DIR);
  try {
    return fs.readdirSync(MEDIA_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.webp', '.webm', '.mp4', '.mov', '.gif', '.png', '.jpg', '.jpeg', '.apng'].includes(ext);
    });
  } catch (e) {
    return [];
  }
}

function broadcastToPet(channel, data) {
  try {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send(channel, data);
    }
  } catch (e) {
    console.error('broadcastToPet error:', e);
  }
}

// ─── Window Creation ─────────────────────────────────────

function createPetWindow() {
  const config = loadConfig();
  const winSize = config.petSize + 120;

  petWindow = new BrowserWindow({
    width: winSize,
    height: winSize + 44,
    x: undefined,
    y: undefined,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  });

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  petWindow.loadFile('pet.html');

  // ── Windows transparent window fix ──
  // Load fully, then force transparent at every layer
  petWindow.webContents.once('did-finish-load', () => {
    // Nuke default backgrounds on every layer
    petWindow.webContents.executeJavaScript(`
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      document.querySelector('.container').style.background = 'transparent';
      document.getElementById('petArea').style.background = 'transparent';
      document.getElementById('placeholder').style.background = 'transparent';
    `);

    petWindow.webContents.setBackgroundThrottling(false);
    petWindow.show();

    // On Windows, setBackgroundColor must be called AFTER show() to stick
    setTimeout(() => {
      petWindow.setBackgroundColor('#00000000');
    }, 50);
  });

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.focus();
    return;
  }

  panelWindow = new BrowserWindow({
    width: 560,
    height: 780,
    title: '山海经 · 控制面板',
    autoHideMenuBar: true,
    resizable: true,
    minimizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  panelWindow.loadFile('panel.html');

  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

// ─── Preload Script ──────────────────────────────────────

function ensurePreloadScript() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const preloadContent = `
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
`;

  if (!fs.existsSync(preloadPath) || fs.readFileSync(preloadPath, 'utf-8') !== preloadContent) {
    fs.writeFileSync(preloadPath, preloadContent, 'utf-8');
  }
}

// ─── IPC Handlers ────────────────────────────────────────

function registerIPC() {
  // Get config
  ipcMain.handle('get-config', () => {
    return loadConfig();
  });

  // Save config
  ipcMain.handle('save-config', (_event, config) => {
    try {
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid config' };
      }
      // Merge safely, only accepting known config keys
      const safeConfig = { ...DEFAULT_CONFIG };
      if (config.activeMedia !== undefined) safeConfig.activeMedia = String(config.activeMedia);
      if (typeof config.petSize === 'number' && isFinite(config.petSize)) safeConfig.petSize = config.petSize;
      if (typeof config.moveSpeed === 'number' && isFinite(config.moveSpeed)) safeConfig.moveSpeed = config.moveSpeed;
      if (typeof config.sleepAfterIdleSec === 'number' && isFinite(config.sleepAfterIdleSec)) safeConfig.sleepAfterIdleSec = config.sleepAfterIdleSec;
      if (typeof config.idleEnabled === 'boolean') safeConfig.idleEnabled = config.idleEnabled;
      if (config.stateMedias && typeof config.stateMedias === 'object') {
        for (const key of Object.keys(DEFAULT_CONFIG.stateMedias)) {
          if (typeof config.stateMedias[key] === 'string') safeConfig.stateMedias[key] = config.stateMedias[key];
        }
      }
      if (Array.isArray(config.interactionButtons)) safeConfig.interactionButtons = config.interactionButtons.filter(b => b && typeof b === 'object');
      if (Array.isArray(config.clickResponses)) safeConfig.clickResponses = config.clickResponses.filter(r => typeof r === 'string');
      if (Array.isArray(config.idleMessages)) safeConfig.idleMessages = config.idleMessages.filter(m => m && typeof m === 'object');

      currentConfig = safeConfig;
      saveConfig();
      broadcastToPet('config-updated', currentConfig);
      return { success: true };
    } catch (e) {
      console.error('save-config error:', e);
      return { success: false, error: e.message };
    }
  });

  // Get pet states definition (read-only)
  ipcMain.handle('get-pet-states', () => {
    return PET_STATES;
  });

  // Open panel
  ipcMain.on('open-panel', () => {
    createPanelWindow();
  });

  // Move window (manual drag)
  ipcMain.on('move-window', (_event, delta) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (!Array.isArray(delta) || delta.length < 2) return;
    const dx = Number(delta[0]), dy = Number(delta[1]);
    if (!isFinite(dx) || !isFinite(dy)) return;
    const [x, y] = petWindow.getPosition();
    if (!isFinite(x) || !isFinite(y)) return;
    petWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  // Move window to absolute position
  ipcMain.on('move-window-to', (_event, pos) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    if (!Array.isArray(pos) || pos.length < 2) return;
    const x = Number(pos[0]), y = Number(pos[1]);
    if (!isFinite(x) || !isFinite(y)) return;
    petWindow.setPosition(Math.round(x), Math.round(y));
  });

  // Get full virtual desktop bounds (all displays combined)
  ipcMain.handle('get-screen-size', () => {
    const displays = screen.getAllDisplays();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of displays) {
      const { x, y, width, height } = d.workArea;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  });

  // Get current pet window position
  ipcMain.handle('get-window-pos', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const pos = petWindow.getPosition();
      const x = Number(pos[0]), y = Number(pos[1]);
      return [isFinite(x) ? x : 0, isFinite(y) ? y : 0];
    }
    return [0, 0];
  });

  // Get global cursor position (screen coordinates)
  ipcMain.handle('get-cursor-pos', () => {
    try {
      const point = screen.getCursorScreenPoint();
      const x = Number(point.x), y = Number(point.y);
      return [isFinite(x) ? x : 0, isFinite(y) ? y : 0];
    } catch (e) {
      return [0, 0];
    }
  });

  // Upload media
  ipcMain.handle('upload-media', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择宠物素材',
      filters: [
        { name: '图片/视频/动画', extensions: ['webp', 'webm', 'mp4', 'mov', 'gif', 'png', 'jpg', 'jpeg', 'apng'] }
      ],
      properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length === 0) return { success: false, files: [] };

    ensureDir(MEDIA_DIR);
    const copied = [];

    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      let destName = baseName + ext;
      let destPath = path.join(MEDIA_DIR, destName);

      let counter = 1;
      while (fs.existsSync(destPath)) {
        destName = `${baseName}_${counter}${ext}`;
        destPath = path.join(MEDIA_DIR, destName);
        counter++;
      }

      fs.copyFileSync(filePath, destPath);
      copied.push(destName);
    }

    // Set first uploaded as fallback activeMedia if empty
    if (!currentConfig.activeMedia || !fs.existsSync(path.join(MEDIA_DIR, currentConfig.activeMedia))) {
      currentConfig.activeMedia = copied[0];
      saveConfig();
    }

    const mediaList = getMediaList();
    broadcastToPet('media-updated', mediaList);
    broadcastToPet('config-updated', currentConfig);

    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('media-updated', mediaList);
      panelWindow.webContents.send('config-updated', currentConfig);
    }

    return { success: true, files: copied };
  });

  // Delete media
  ipcMain.handle('delete-media', (_event, filename) => {
    const filePath = path.join(MEDIA_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Clear from activeMedia
    if (currentConfig.activeMedia === filename) {
      const remaining = getMediaList();
      currentConfig.activeMedia = remaining.length > 0 ? remaining[0] : null;
    }

    // Clear from all stateMedias
    if (currentConfig.stateMedias) {
      for (const key of Object.keys(currentConfig.stateMedias)) {
        if (currentConfig.stateMedias[key] === filename) {
          currentConfig.stateMedias[key] = '';
        }
      }
    }

    saveConfig();

    const mediaList = getMediaList();
    broadcastToPet('media-updated', mediaList);
    broadcastToPet('config-updated', currentConfig);

    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('media-updated', mediaList);
      panelWindow.webContents.send('config-updated', currentConfig);
    }

    return { success: true, list: mediaList };
  });

  // Get media list
  ipcMain.handle('get-media-list', () => {
    return getMediaList();
  });

  // Get full path for a media file
  ipcMain.handle('get-media-path', (_event, filename) => {
    if (!filename) return null;
    const filePath = path.join(MEDIA_DIR, filename);
    if (fs.existsSync(filePath)) return filePath;
    return null;
  });

  // Set active media (legacy / fallback)
  ipcMain.handle('set-active-media', (_event, filename) => {
    currentConfig.activeMedia = filename;
    saveConfig();
    broadcastToPet('config-updated', currentConfig);
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('config-updated', currentConfig);
    }
    return { success: true };
  });
}

// ─── App Lifecycle ───────────────────────────────────────

app.whenReady().then(() => {
  ensurePreloadScript();
  registerIPC();
  createPetWindow();

  globalShortcut.register('Ctrl+Shift+P', () => {
    createPanelWindow();
  });
});

app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (petWindow === null) createPetWindow();
});
