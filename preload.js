const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusflow', {
  getState: () => ipcRenderer.invoke('store:get'),
  setState: (state) => ipcRenderer.invoke('store:set', state),
  onNewTask: (cb) => ipcRenderer.on('ui:new-task', cb),
  onQuickCapture: (cb) => ipcRenderer.on('ui:quick-capture', cb),
  notify: (payload) => ipcRenderer.send('notification', payload),
  onNotify: (cb) => ipcRenderer.on('notification', (_e, p) => cb(p)),
  onStoreUpdated: (cb) => ipcRenderer.on('store:updated', (_e, state) => cb(state)),
  // Focus overlay toggle
  toggleFocusOverlay: (enabled) => ipcRenderer.invoke('focus:toggle', enabled),
  // Timer update push from renderer to main (for tray and overlay)
  pushTimerUpdate: (payload) => ipcRenderer.send('timer:update', payload),
  // Subscribe to timer updates (for overlay window to render)
  onTimerUpdate: (cb) => ipcRenderer.on('timer:update', (_e, p) => cb(p)),
  // Overlay size/mode
  overlaySetMode: (mode) => ipcRenderer.invoke('overlay:set-mode', mode),
  overlayResize: (bounds) => ipcRenderer.invoke('overlay:resize', bounds),
  panelResize: (bounds) => ipcRenderer.invoke('panel:resize', bounds),
  overlayTogglePanel: (open) => ipcRenderer.invoke('overlay:panel:toggle', open),
  onOverlayMode: (cb) => ipcRenderer.on('overlay:mode', (_e, m) => cb(m)),
  // Timer commands
  sendTimerCommand: (cmd) => ipcRenderer.send('timer:command', cmd),
  onTimerCommand: (cb) => ipcRenderer.on('timer:command', (_e, c) => cb(c)),
  // Explicit confirm flow for reliability
  confirmTimer: () => ipcRenderer.send('timer:confirm'),
  onTimerConfirm: (cb) => ipcRenderer.on('timer:confirm', (_e) => cb()),
  // Task editing from overlay
  editTaskFromOverlay: (taskId) => ipcRenderer.send('overlay:edit-task', taskId),
  onTaskEditRequest: (cb) => ipcRenderer.on('overlay:edit-task', (_e, taskId) => cb(taskId)),
  // Window control helpers
  minimizeApp: () => ipcRenderer.invoke('app:minimize'),
  showAppFront: () => ipcRenderer.invoke('app:showFront'),
  // Open external link from renderer via main
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  // Auto-updater
  checkForUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, progress) => cb(progress)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info))
});
