const { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell, globalShortcut, Tray, nativeImage, screen, powerSaveBlocker } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// electron-store v9 is ESM-only; use dynamic import in CommonJS
const storeReady = (async () => {
  const { default: Store } = await import('electron-store');
  return new Store({
  name: 'focusflow',
  defaults: {
      state: {
        theme: 'dark',
        currentProjectId: 'inbox',
        projects: [
          { id: 'inbox', name: 'Inbox', columns: { todo: [], doing: [], done: [] } }
        ],
        notes: '',
        quickNotes: [], // Array von {id, text, timestamp}
        timerSessions: [],
        timePoolSec: 0,
        pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15, cycle: 0 },
        scheduled: []
      }
    },
    // Wichtig: Stelle sicher, dass der Store file-basiert und persistent ist
    clearInvalidConfig: false, // Verhindere das Löschen korrupter Daten
    serialize: value => JSON.stringify(value, null, 2), // Lesbare Speicherung für Debugging
    deserialize: text => JSON.parse(text)
  });
})();

let mainWindow;
let overlayWindow;
let panelWindow;
let tray;
let lastTimerPayload = { mode: 'idle', remaining: 0, elapsed: 0, label: 'Focus' };
let overlayMode = 'bar'; // 'bar' | 'dot'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    titleBarStyle: 'hiddenInset', // keep traffic lights visible
    titleBarOverlay: false,
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111112' : '#f5f5f7',
    icon: path.join(__dirname, 'assets', process.platform === 'darwin' ? 'icon.png' : 'icon.png'),
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Ensure macOS traffic lights remain visible even when window blurs
  try { mainWindow.setWindowButtonVisibility(true); } catch {}
  mainWindow.on('focus', () => { try { mainWindow.setWindowButtonVisibility(true); } catch {} });
  mainWindow.on('blur', () => { try { mainWindow.setWindowButtonVisibility(true); } catch {} });

  // macOS Menu
  const template = [
    {
      label: 'MO:ST Zeitmanagement',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Task',
          accelerator: 'CommandOrControl+N',
          click: () => mainWindow.webContents.send('ui:new-task')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Toggle Full Focus Overlay', accelerator: 'CommandOrControl+Shift+F', click: ()=> { const enable = !(overlayWindow && !overlayWindow.isDestroyed()); toggleOverlay(enable); } }
      ]
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://electronjs.org');
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Global shortcuts
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    mainWindow.webContents.send('ui:quick-capture');
  });

  // Create tray (menu bar) with dynamic title
  createTray();
}

// Auto-updater setup
function setupAutoUpdater() {
  // Configure auto-updater
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'mlvps', // 🔧 Hier dein GitHub Username eintragen
    repo: 'most-zeitmanagement',
    private: false // true falls private repo
  });

  // Check for updates when app starts
  autoUpdater.checkForUpdatesAndNotify();

  // Auto-updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('📦 Update available:', info.version);
    // Benachrichtige die Renderer über verfügbares Update
    if (mainWindow) {
      mainWindow.webContents.send('update:available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('✅ App is up-to-date');
  });

  autoUpdater.on('error', (err) => {
    console.log('❌ Error in auto-updater:', err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    console.log(log_message);

    // Sende Progress an Renderer
    if (mainWindow) {
      mainWindow.webContents.send('update:progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded');
    // Zeige Update-bereit Dialog
    if (mainWindow) {
      mainWindow.webContents.send('update:downloaded', info);
    }
  });
}

app.whenReady().then(() => {
  try{ app.setName('MO:ST Zeitmanagement'); }catch{}
  setupAutoUpdater();
  createWindow();
  // Ensure store is properly initialized but NEVER override existing data
  (async () => {
    try {
      const store = await storeReady;
      const current = store.get('state');
      console.log('Store startup - current state:', current);

      // Only set defaults if there's truly NO state at all
      if (!current || typeof current !== 'object') {
        console.log('No state found, initializing with defaults');
        const defaultState = {
          theme: 'dark',
          currentProjectId: 'inbox',
          projects: [ { id:'inbox', name:'Inbox', columns:{ todo:[], doing:[], done:[] } } ],
          notes: '',
          quickNotes: [], // Array von {id, text, timestamp}
          timerSessions: [],
          timePoolSec: 0,
          pomodoro: { workMin:25, breakMin:5, longBreakMin:15, cycle:0 },
          scheduled: []
        };
        store.set('state', defaultState);
        try { broadcastStoreToAllWindows(); } catch {}
      } else {
        console.log('Existing state found, preserving data:', {
          projectCount: current.projects?.length || 0,
          todoCount: current.projects?.reduce((sum, p) => sum + (p.columns?.todo?.length || 0), 0) || 0,
          doneCount: current.projects?.reduce((sum, p) => sum + (p.columns?.done?.length || 0), 0) || 0
        });
        // Preserve all existing data - no migration needed
        try { broadcastStoreToAllWindows(); } catch {}
      }
    } catch (err) {
      console.error('Store initialization error:', err);
    }
  })();
  try{ powerSaveBlocker.start('prevent-app-suspension'); }catch{}

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: storage
ipcMain.handle('store:get', async (_evt) => {
  const store = await storeReady;
  const state = store.get('state');
  console.log('Store get request - returning state:', {
    hasState: !!state,
    projectCount: state?.projects?.length || 0,
    taskCounts: state?.projects ? {
      todo: state.projects.reduce((sum, p) => sum + (p.columns?.todo?.length || 0), 0),
      doing: state.projects.reduce((sum, p) => sum + (p.columns?.doing?.length || 0), 0),
      done: state.projects.reduce((sum, p) => sum + (p.columns?.done?.length || 0), 0)
    } : 'no projects'
  });
  return state;
});

ipcMain.handle('store:set', async (_evt, newState) => {
  const store = await storeReady;
  try {
    // Single-key snapshot approach avoids partial writes and schema drift
    const safe = JSON.parse(JSON.stringify(newState || {}));

    // Debug-Log vor dem Speichern
    const taskCounts = safe?.projects ? {
      todo: safe.projects.reduce((sum, p) => sum + (p.columns?.todo?.length || 0), 0),
      doing: safe.projects.reduce((sum, p) => sum + (p.columns?.doing?.length || 0), 0),
      done: safe.projects.reduce((sum, p) => sum + (p.columns?.done?.length || 0), 0)
    } : 'no projects';
    console.log('Store SAVING - Task counts:', taskCounts);

    store.set('state', safe);
    console.log('Store updated successfully, broadcasting to all windows');

    // Verify write was successful
    const written = store.get('state');
    const verifyTaskCounts = written?.projects ? {
      todo: written.projects.reduce((sum, p) => sum + (p.columns?.todo?.length || 0), 0),
      doing: written.projects.reduce((sum, p) => sum + (p.columns?.doing?.length || 0), 0),
      done: written.projects.reduce((sum, p) => sum + (p.columns?.done?.length || 0), 0)
    } : 'no projects';
    console.log('Store VERIFIED after write - Task counts:', verifyTaskCounts);

    // Notify all windows of store update with a small delay to ensure all windows are ready
    setTimeout(() => {
    const windows = [mainWindow, overlayWindow, panelWindow];
      windows.forEach((win, index) => {
      if (win && !win.isDestroyed()) {
          try {
            console.log(`Broadcasting to window ${index}:`, !!win);
            win.webContents.send('store:updated', safe);
          } catch (err) {
            console.error(`Error broadcasting to window ${index}:`, err);
          }
        }
      });
    }, 50); // Small delay to ensure all windows are ready
  } catch (err) {
    console.error('Error in store:set:', err);
  }
  return store.get('state');
});

async function broadcastStoreToAllWindows(){
  try{
    const store = await storeReady;
    const payload = store.get('state');
    console.log('Broadcasting store to all windows:', payload);
    const windows = [mainWindow, overlayWindow, panelWindow];
    windows.forEach((win, index) => {
      if (win && !win.isDestroyed()) {
        try{
          console.log(`Broadcasting to window ${index} (broadcastStoreToAllWindows):`, !!win);
          win.webContents.send('store:updated', payload);
        }catch(err){
          console.error(`Error broadcasting to window ${index}:`, err);
        }
      }
    });
  }catch(err){
    console.error('Error in broadcastStoreToAllWindows:', err);
  }
}

ipcMain.on('notification', (_evt, payload) => {
  try{ if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notification', payload); }catch{}
  try{ if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('notification', payload); }catch{}
  try{ if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send('notification', payload); }catch{}
});
// Open external links
ipcMain.handle('open:external', async (_evt, url) => {
  try{ await shell.openExternal(url); return true; } catch{ return false; }
});

// Relay timer commands from overlay to renderer
ipcMain.on('timer:command', (_evt, cmd) => {
  try{
    console.log('🔵 [MAIN IPC] timer:command received:', cmd);
    const hasMain = !!(mainWindow && !mainWindow.isDestroyed());
    console.log('🔵 [MAIN IPC] Main window available:', hasMain);
    if(hasMain) {
      console.log('🔵 [MAIN IPC] Sending timer:command to mainWindow...');
      mainWindow.webContents.send('timer:command', cmd);
      console.log('✅ [MAIN IPC] timer:command sent to mainWindow successfully');
    } else {
      console.log('❌ [MAIN IPC] Main window not available, command not sent');
    }
  }catch(err){
    console.log('❌ [MAIN IPC] Error handling timer:command:', err);
  }
});

// Update-related IPC handlers
ipcMain.on('update:check', () => {
  console.log('🔍 Manual update check requested');
  autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.on('update:install', () => {
  console.log('🚀 Installing update...');
  autoUpdater.quitAndInstall();
});

// Explicit confirm relay to renderer
ipcMain.on('timer:confirm', () => {
  try{
    console.log('🟢 [MAIN IPC] timer:confirm received');
    const hasMain = !!(mainWindow && !mainWindow.isDestroyed());
    console.log('🟢 [MAIN IPC] Main window available:', hasMain);
    if(hasMain) {
      console.log('🟢 [MAIN IPC] Sending timer:confirm to mainWindow...');
      mainWindow.webContents.send('timer:confirm');
      console.log('✅ [MAIN IPC] timer:confirm sent to mainWindow successfully');
    } else {
      console.log('❌ [MAIN IPC] Main window not available, confirm not sent');
    }
  }catch(err){
    console.log('❌ [MAIN IPC] Error handling timer:confirm:', err);
  }
});

// Handle notifications from overlay (especially confirm button)
ipcMain.on('notification', (_evt, payload) => {
  try{
    if(mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification', payload);
    }
  }catch{}
});

// Handle task editing from overlay
ipcMain.on('overlay:edit-task', (_evt, taskId) => {
  console.log('Main process received overlay:edit-task with taskId:', taskId);
  try{
    if(mainWindow && !mainWindow.isDestroyed()) {
      console.log('Sending edit-task message to main window');
      mainWindow.webContents.send('overlay:edit-task', taskId);
      console.log('Edit-task message sent successfully');
    } else {
      console.log('Main window not available');
    }
  }catch(e){
    console.log('Error in overlay:edit-task handler:', e);
  }
});

// Receive timer updates from renderer to mirror in tray and overlay
ipcMain.on('timer:update', (_evt, payload) => {
  const previousMode = (lastTimerPayload && lastTimerPayload.mode) ? lastTimerPayload.mode : 'idle';
  lastTimerPayload = payload || lastTimerPayload;
  updateTrayTitle();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('timer:update', lastTimerPayload);
  }
  try{
    // Auto-open overlay only when transitioning from idle -> active
    const mode = payload && payload.mode;
    const isActive = (mode==='countdown' || mode==='stopwatch');
    if(previousMode==='idle' && isActive){ toggleOverlay(true); }
  }catch{}
});

// Window controls from renderer
ipcMain.handle('app:minimize', async () => {
  try { if (mainWindow) mainWindow.minimize(); } catch {}
  return true;
});
ipcMain.handle('app:showFront', async () => {
  try {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      // Briefly force alwaysOnTop to surface window, then disable
      mainWindow.setAlwaysOnTop(true, 'modal-panel');
      setTimeout(()=>{ try{ mainWindow.setAlwaysOnTop(false); }catch{} }, 600);
    }
  } catch {}
  return true;
});

// Toggle always-on-top minimal overlay window
ipcMain.handle('focus:toggle', async (_evt, enable) => toggleOverlay(enable));
ipcMain.handle('overlay:resize', async (_evt, bounds) => {
  try { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setBounds(bounds); } catch {}
  return true;
});
// Allow the panel to request a dynamic resize based on its content
ipcMain.handle('panel:resize', async (_evt, desired) => {
  try {
    if (panelWindow && !panelWindow.isDestroyed()) {
      const ob = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : panelWindow.getBounds();
      const { workArea } = screen.getPrimaryDisplay();
      const x = ob.x;
      const y = ob.y + (ob.height || 0) + 6;
      const width = ob.width;
      const minHeight = 120;
      const maxHeight = Math.max(240, Math.min(workArea.height - (y - workArea.y) - 12, 820));
      const desiredHeight = Math.round((desired && desired.height) ? desired.height : (panelWindow.getBounds().height || 200));
      const height = Math.max(minHeight, Math.min(desiredHeight, maxHeight));
      panelWindow.setBounds({ x, y, width, height });
    }
  } catch {}
  return true;
});
// Toggle the attached panel under the overlay
ipcMain.handle('overlay:panel:toggle', async (_evt, open) => {
  try { togglePanel(!!open); } catch {}
  return true;
});
ipcMain.handle('overlay:set-mode', async (_evt, mode) => {
  overlayMode = (mode === 'dot') ? 'dot' : 'bar';
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:mode', overlayMode);
    positionOverlay();
  }
  return overlayMode;
});

function toggleOverlay(enable) {
  if (enable) {
    if (overlayWindow && !overlayWindow.isDestroyed()) return true;
    overlayWindow = new BrowserWindow({
      width: 420,
      height: 64,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(getOverlayHTML()));
    overlayWindow.on('closed', () => { overlayWindow = null; if(panelWindow && !panelWindow.isDestroyed()){ try{ panelWindow.close(); }catch{} panelWindow=null; } });
    overlayWindow.on('move', () => { try{ positionPanel(); }catch{} });
    overlayWindow.on('moved', () => { try{ positionPanel(); }catch{} });
    // On macOS, use will-move to get new bounds ahead of time for perfectly synced movement
    overlayWindow.on('will-move', (_event, newBounds) => { try{ positionPanel(newBounds); }catch{} });
    overlayWindow.on('resize', () => { try{ positionPanel(); }catch{} });
    overlayWindow.on('resized', () => { try{ positionPanel(); }catch{} });
    overlayWindow.webContents.on('did-finish-load', () => {
      overlayWindow.webContents.send('timer:update', lastTimerPayload);
      overlayWindow.webContents.send('overlay:mode', overlayMode);
      // Ensure overlay has latest store snapshot
      broadcastStoreToAllWindows();
    });
    positionOverlay();
    // Let clicks pass through so the overlay doesn't block UI
    try { overlayWindow.setIgnoreMouseEvents(false); } catch {}
    return true;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  if (panelWindow && !panelWindow.isDestroyed()) { try{ panelWindow.close(); }catch{} panelWindow=null; }
  return false;
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const isDot = overlayMode === 'dot';
  const width = isDot ? 56 : 420;
  const height = isDot ? 56 : 64;
  try {
    const { workArea } = screen.getPrimaryDisplay();
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.max(workArea.y + 10, 10);
    overlayWindow.setBounds({ x, y, width, height });
    positionPanel();
  } catch {}
}

function togglePanel(open){
  if(!overlayWindow || overlayWindow.isDestroyed()) return;
  if(open){
    // If it already exists, just show and animate in
    if(panelWindow && !panelWindow.isDestroyed()) {
      try{
        positionPanel();
        panelWindow.showInactive();
        panelWindow.setAlwaysOnTop(true, 'screen-saver');
        panelWindow.webContents.executeJavaScript('document.body.classList.remove("panel-leave"); document.body.classList.add("panel-enter"); setTimeout(()=>{ document.body.classList.remove("panel-enter"); }, 220);').catch(()=>{});
      }catch{}
      return;
    }
    panelWindow = new BrowserWindow({
      width: 420,
      height: 520,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      acceptFirstMouse: true,
      backgroundColor: '#00000000',
      parent: overlayWindow,
      modal: false,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    try{ panelWindow.setIgnoreMouseEvents(false); }catch{}
    panelWindow.setAlwaysOnTop(true, 'screen-saver');
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    panelWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(getPanelHTML()));
    panelWindow.on('closed', ()=> { panelWindow=null; });
    panelWindow.webContents.on('did-finish-load', ()=>{
      console.log('Panel loaded, broadcasting store');
      setTimeout(() => { broadcastStoreToAllWindows(); }, 100);
    });
    positionPanel();
  } else {
    if(panelWindow && !panelWindow.isDestroyed()) {
      try{
        panelWindow.webContents.executeJavaScript('document.body.classList.remove("panel-enter"); document.body.classList.add("panel-leave");').catch(()=>{});
      }catch{}
      // Hide after animation, keep window alive to avoid reload flicker on next open
      setTimeout(()=>{ try{ panelWindow.hide(); }catch{} }, 190);
    }
  }
}

function positionPanel(overlayBounds){
  if(!overlayWindow || overlayWindow.isDestroyed()) return;
  if(!panelWindow || panelWindow.isDestroyed()) return;
  try{
    const ob = overlayBounds || overlayWindow.getBounds();
    const width = ob.width; // match overlay width
    const x = ob.x; // align left
    const y = ob.y + ob.height + 6; // small gap
    // preserve current height when re-positioning
    const current = panelWindow.getBounds();
    const height = current?.height || 300;
    panelWindow.setBounds({ x, y, width, height });
  }catch{}
}

function getOverlayHTML() {
  return `<!doctype html><html><head>
  <meta charset="utf-8" />
  <style>
    :root{ --bg: rgba(18,18,20,0.82); --text:#fff; --accent:#4f8cff; }
    html,body{ margin:0; padding:0; }
    body{ font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Helvetica, Arial, sans-serif; color:var(--text); }
    .wrap{ position:relative; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 12px; background: var(--bg); border-radius:12px; box-shadow: 0 8px 30px rgba(0,0,0,0.25); -webkit-backdrop-filter: blur(16px) saturate(140%); backdrop-filter: blur(16px) saturate(140%); -webkit-app-region: drag; }
    .label{ font-size:11px; opacity:0.8; }
    .time{ font-variant-numeric: tabular-nums; font-size:24px; font-weight:700; letter-spacing:0.5px; transition: color 0.3s ease; }
    .time.confirmed{ animation: confirmPulse 0.8s ease; }
        @keyframes confirmPulse {
      0% { color: #fff; transform: scale(1); }
      50% { color: #4ecdc4; transform: scale(1.05); }
      100% { color: #fff; transform: scale(1); }
    }
    .badge{ font-size:10px; padding:3px 6px; border-radius:999px; background: rgba(255,255,255,0.12); }
    .controls{ display:flex; gap:8px; }
    .btn{ appearance:none; border:0; border-radius:10px; padding:6px 8px; background: rgba(255,255,255,0.16); color:#fff; cursor:pointer; -webkit-app-region: no-drag; transition: all 0.2s ease; transform: scale(1); display:inline-flex; align-items:center; justify-content:center; gap:6px; }
    .btn:hover{ background: rgba(255,255,255,0.24); transform: scale(1.05); }
    .btn:active{ transform: scale(0.95); background: rgba(255,255,255,0.3); }
    .btn .icon{ width:16px; height:16px; display:block; }
    .dot{ width:100%; height:100%; border-radius:50%; background: rgba(18,18,20,0.72); box-shadow: 0 8px 24px rgba(0,0,0,0.35); display:grid; place-items:center; -webkit-backdrop-filter: blur(10px) saturate(140%); }
    .dot-inner{ width:48px; height:48px; border-radius:999px; display:grid; place-items:center; background: radial-gradient(ellipse at 30% 30%, rgba(79,140,255,0.65), rgba(79,140,255,0.15)); color:#fff; font-variant-numeric: tabular-nums; font-weight:700; font-size:12px; transition: color 0.3s ease; }
    .dot-inner.confirmed{ animation: confirmPulse 0.8s ease; }
    /* Right expandable panel */
    .more-btn{ -webkit-app-region: no-drag; width:28px; height:28px; border-radius:8px; background: rgba(255,255,255,0.16); color:#fff; display:grid; place-items:center; cursor:pointer; border:0; }
    .more-btn svg{ width:16px; height:16px; transition: transform .22s ease; }
    .more-btn.open svg{ transform: rotate(180deg); }
    .side{ position:absolute; top:6px; right:6px; transform: translateX(100%); width:300px; height:260px; background: rgba(18,18,20,0.92); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:10px; box-shadow: 0 18px 46px rgba(0,0,0,0.35); -webkit-app-region: no-drag; display:flex; flex-direction:column; gap:8px; }
    .side.open{ transform: translateX(0); }
    .side h4{ margin:4px 2px; font-size:12px; letter-spacing:.08em; opacity:.8; text-transform:uppercase; }
    .notes{ flex:1; display:flex; flex-direction:column; gap:6px; }
    .notes textarea{ flex:1; resize:none; border-radius:10px; border:1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.06); color:#fff; padding:8px 10px; font-size:12px; }
    .todos{ flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:8px; }
    .todo-item{ display:flex; align-items:center; gap:8px; }
    .todo-title{ font-size:12px; opacity:.9; }
    /* Custom Satisfying Checkbox */
    .checkbox-wrapper * { -webkit-tap-highlight-color: transparent; outline: none; }
    .checkbox-wrapper input[type="checkbox"] { display: none; }
    .checkbox-wrapper label { --size: 24px; position: relative; display: block; width: var(--size); height: var(--size); margin: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%); border: 2px solid rgba(78,205,196,0.4); border-radius: 8px; cursor: pointer; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); overflow: hidden; position: relative; flex-shrink: 0; }
    .checkbox-wrapper label:before { content: ""; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px; background: linear-gradient(135deg, rgba(18,18,20,0.95) 0%, rgba(18,18,20,0.85) 100%); border-radius: 4px; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .checkbox-wrapper label:after { content: "✓"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0) rotate(360deg); color: #fff; font-size: 14px; font-weight: bold; opacity: 0; transition: all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55); text-shadow: 0 0 12px rgba(78,205,196,1), 0 0 24px rgba(78,205,196,0.6); }
    .checkbox-wrapper label:hover { border-color: rgba(78,205,196,0.8); box-shadow: 0 0 0 4px rgba(78,205,196,0.15), 0 6px 20px rgba(0,0,0,0.2); transform: translateY(-2px) scale(1.05); }
    .checkbox-wrapper label:hover:before { background: linear-gradient(135deg, rgba(18,18,20,0.98) 0%, rgba(18,18,20,0.9) 100%); transform: scale(0.9); }
    .checkbox-wrapper label:active { transform: translateY(0) scale(0.9); transition: all 0.1s ease; }
    .checkbox-wrapper input[type="checkbox"]:checked + label { border-color: #4ecdc4; background: linear-gradient(135deg, #4ecdc4 0%, #45b7aa 50%, #3a9d96 100%); box-shadow: 0 0 0 4px rgba(78,205,196,0.4), 0 12px 32px rgba(78,205,196,0.6), inset 0 2px 0 rgba(255,255,255,0.3), inset 0 -2px 8px rgba(0,0,0,0.2); }
    .checkbox-wrapper input[type="checkbox"]:checked + label:before { opacity: 0; transform: scale(0) rotate(180deg); }
    .checkbox-wrapper input[type="checkbox"]:checked + label:after { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
    .checkbox-wrapper.just-checked label { animation: checkboxPulse 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55); }
    .checkbox-wrapper.just-checked label:after { animation: checkmarkBounce 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) both; }
    @keyframes checkboxPulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
    @keyframes checkmarkBounce { 0% { transform: translate(-50%, -50%) scale(0) rotate(360deg); } 60% { transform: translate(-50%, -50%) scale(1.2) rotate(0deg); } 100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); } }
  </style>
  </head><body>
  <div class="wrap" id="bar">
     <div>
      <div class="label" id="label">Fokus</div>
      <div class="time" id="time">00:00</div>
    </div>
    <div style="display:flex; align-items:center; gap:8px;">
      <button class="btn" id="pauseBtn">Pause</button>
      <button class="btn" id="resetBtn">Reset</button>
      <button class="btn" id="confirmBtn" aria-label="Bestätigen" title="Bestätigen"><svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20 7L9 18L4 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="btn" id="minBtn" aria-label="Minimieren" title="Minimieren">–</button>
      <button class="more-btn" id="moreBtn" aria-label="Mehr" title="Mehr"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    <!-- side content moved to dedicated panel window -->
  </div>
  <div id="dotWrap" style="display:none; width:56px; height:56px; -webkit-app-region: drag;">
    <div class="dot" id="dot">
      <div class="dot-inner" id="dotTime">00:00</div>
    </div>
  </div>
  <script>
  (function(){
    console.log('=== OVERLAY SCRIPT STARTING ===');

    // Timer state tracking
    let isTimerPaused = false;
    const format = (sec)=>{ const m = Math.floor(sec/60).toString().padStart(2,'0'); const s = Math.floor(sec%60).toString().padStart(2,'0'); return m+':'+s; };
    const debounce=(fn,ms=400)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); } };

    // Update pause button appearance based on timer state
    function updatePauseButton(isPaused) {
      const pauseBtn = document.getElementById('pauseBtn');
      if(pauseBtn) {
        if(isPaused) {
          pauseBtn.innerHTML = 'Weiter'; // Play button when paused
          pauseBtn.title = 'Resume Timer';
        } else {
          pauseBtn.innerHTML = 'Pause'; // Pause button when running
          pauseBtn.title = 'Pause Timer';
        }
        isTimerPaused = isPaused;
      }
    }

    // Button click animation
    function animateButton(btn) {
      btn.style.transform = 'scale(0.9)';
      btn.style.background = 'rgba(255,255,255,0.4)';
      setTimeout(() => {
        btn.style.transform = 'scale(1.1)';
        setTimeout(() => {
          btn.style.transform = 'scale(1)';
          btn.style.background = 'rgba(255,255,255,0.16)';
        }, 100);
      }, 100);
    }
    // Timer updates via preload
    try{
      if(window.focusflow && window.focusflow.onTimerUpdate) {
        window.focusflow.onTimerUpdate((p) => {
          console.log('OVERLAY: Timer update received via preload:', p);
          if(!p) return;
          const lab = document.getElementById('label'); if(lab) lab.textContent = p.label || 'Fokus';
          const t = p.mode==='countdown' ? p.remaining : p.elapsed;
          const bar = document.getElementById('time'); if(bar) bar.textContent = format(Math.max(0, Math.floor(t||0)));
          const dotEl = document.getElementById('dotTime'); if(dotEl){ dotEl.textContent = format(Math.max(0, Math.floor(t||0))); }

          // Update pause button based on timer state
          updatePauseButton(p.mode === 'idle' || p.isPaused);
        });
      } else {
        console.log('OVERLAY: window.focusflow.onTimerUpdate not available, using fallback');
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('timer:update', (_e, p) => {
          console.log('OVERLAY: Timer update received via fallback:', p);
          if(!p) return;
          const lab = document.getElementById('label'); if(lab) lab.textContent = p.label || 'Fokus';
          const t = p.mode==='countdown' ? p.remaining : p.elapsed;
          const bar = document.getElementById('time'); if(bar) bar.textContent = format(Math.max(0, Math.floor(t||0)));
          const dotEl = document.getElementById('dotTime'); if(dotEl){ dotEl.textContent = format(Math.max(0, Math.floor(t||0))); }
        });
      }
    }catch(e){ console.log('OVERLAY: Timer update setup error:', e); }
    // Overlay mode via preload
    try{
      if(window.focusflow && window.focusflow.onOverlayMode) {
        window.focusflow.onOverlayMode((mode) => {
          console.log('OVERLAY: Mode change received via preload:', mode);
          const isDot = mode==='dot';
          const bar = document.getElementById('bar'); const dot = document.getElementById('dotWrap');
          if(bar && dot){ bar.style.display = isDot ? 'none' : 'flex'; dot.style.display = isDot ? 'block' : 'none'; }
        });
      } else {
        console.log('OVERLAY: window.focusflow.onOverlayMode not available, using fallback');
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('overlay:mode', (_e, mode) => {
          console.log('OVERLAY: Mode change received via fallback:', mode);
          const isDot = mode==='dot';
          const bar = document.getElementById('bar'); const dot = document.getElementById('dotWrap');
          if(bar && dot){ bar.style.display = isDot ? 'none' : 'flex'; dot.style.display = isDot ? 'block' : 'none'; }
        });
      }
    }catch(e){ console.log('OVERLAY: Mode setup error:', e); }
    function bind(){
      console.log('Overlay bind function called');
      console.log('Available elements:', document.querySelectorAll('button'));
      const minBtn = document.getElementById('minBtn');
      if(minBtn){
        console.log('Min button found and bound');
        minBtn.addEventListener('click', ()=>{
          try{
            if(window.focusflow && window.focusflow.toggleFocusOverlay) {
              window.focusflow.toggleFocusOverlay(false);
            } else {
              const { ipcRenderer } = require('electron');
              ipcRenderer.invoke('focus:toggle', false);
            }
          }catch{}
        });
      } else {
        console.log('Min button NOT found');
      }
      // Timer buttons using preload API
      const pauseBtn = document.getElementById('pauseBtn');
      console.log('OVERLAY: pauseBtn element:', pauseBtn);
      if(pauseBtn){
        console.log('OVERLAY: Adding click listener to pause button');
        pauseBtn.addEventListener('click', ()=>{
          console.log('🔴 OVERLAY: PAUSE/RESUME BUTTON CLICKED!');

          // Animate button click
          animateButton(pauseBtn);

          try{
            console.log('OVERLAY: Pause/Resume clicked - using preload API');
            if(window.focusflow && window.focusflow.sendTimerCommand) {
              window.focusflow.sendTimerCommand('pause');
              console.log('✅ OVERLAY: Pause/Resume command sent via preload API');
            } else {
              console.log('❌ OVERLAY: preload API not available, using fallback');
              const { ipcRenderer } = require('electron');
              ipcRenderer.send('timer:command', 'pause');
              console.log('🔄 OVERLAY: Pause/Resume command sent via fallback IPC');
            }
          }catch(e){
            console.log('❌ OVERLAY: Pause/Resume error:', e);
          }
        });
      } else {
        console.log('OVERLAY: pauseBtn NOT FOUND!');
      }
      const resetBtn = document.getElementById('resetBtn');
      if(resetBtn){
        resetBtn.addEventListener('click', async ()=>{
          console.log('🔄 OVERLAY: RESET BUTTON CLICKED!');

          // Close panel if open to show dialog properly
          const moreBtn = document.getElementById('moreBtn');
          if(moreBtn && moreBtn.classList.contains('open')) {
            try{
              if(window.focusflow && window.focusflow.overlayTogglePanel) {
                await window.focusflow.overlayTogglePanel(false);
              } else {
                const { ipcRenderer } = require('electron');
                await ipcRenderer.invoke('overlay:panel:toggle', false);
              }
              moreBtn.classList.remove('open');
            }catch{}
            // Wait a bit for panel to close
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          // Show confirmation dialog
          if(!confirm('Timer wirklich zurücksetzen?\\n\\nAlle Fortschritte gehen verloren.')) {
            console.log('🔄 OVERLAY: Reset cancelled by user');
            return;
          }

          // Animate button click
          animateButton(resetBtn);

          try{
            console.log('OVERLAY: Reset confirmed - using preload API');
            if(window.focusflow && window.focusflow.sendTimerCommand) {
              window.focusflow.sendTimerCommand('reset');
              console.log('✅ OVERLAY: Reset command sent via preload API');
            } else {
              console.log('❌ OVERLAY: preload API not available, using fallback');
              const { ipcRenderer } = require('electron');
              ipcRenderer.send('timer:command', 'reset');
              console.log('🔄 OVERLAY: Reset command sent via fallback IPC');
            }
          }catch(e){ console.log('❌ OVERLAY: Reset error:', e); }
        });
      }
      const confirmBtn = document.getElementById('confirmBtn');
      if(confirmBtn){
        confirmBtn.addEventListener('click', ()=>{
          console.log('✅ OVERLAY: CONFIRM BUTTON CLICKED!');

          // Animate button click
          animateButton(confirmBtn);

          // Add blue pulse animation to time display
          const timeEl = document.getElementById('time');
          const dotTimeEl = document.getElementById('dotTime');
          if(timeEl) {
            timeEl.classList.add('confirmed');
            setTimeout(() => timeEl.classList.remove('confirmed'), 800);
          }
          if(dotTimeEl) {
            dotTimeEl.classList.add('confirmed');
            setTimeout(() => dotTimeEl.classList.remove('confirmed'), 800);
          }

          try{
            console.log('OVERLAY: Confirm clicked - using preload API');
            if(window.focusflow && window.focusflow.confirmTimer) {
              window.focusflow.confirmTimer();
              console.log('✅ OVERLAY: Confirm command sent via preload API');
            } else {
              console.log('❌ OVERLAY: preload API not available, using fallback');
              const { ipcRenderer } = require('electron');
              ipcRenderer.send('timer:confirm');
              console.log('🔄 OVERLAY: Confirm command sent via fallback IPC');
            }
          }catch(e){ console.log('❌ OVERLAY: Confirm error:', e); }
        });
      }
      const moreBtn = document.getElementById('moreBtn');
      if(moreBtn){
        let open=false;
        moreBtn.addEventListener('click', async ()=>{
          open=!open;
          try{
            if(window.focusflow && window.focusflow.overlayTogglePanel) {
              await window.focusflow.overlayTogglePanel(open);
            } else {
              const { ipcRenderer } = require('electron');
              await ipcRenderer.invoke('overlay:panel:toggle', open);
            }
          }catch{}
          try{ moreBtn.classList.toggle('open', open); }catch{}
        });
      }
      const dotWrap = document.getElementById('dotWrap');
      if(dotWrap){
        dotWrap.addEventListener('dblclick', ()=>{
          try{
            if(window.focusflow && window.focusflow.overlaySetMode) {
              window.focusflow.overlaySetMode('bar');
            } else {
              const { ipcRenderer } = require('electron');
              ipcRenderer.invoke('overlay:set-mode', 'bar');
            }
          }catch{}
        });
      }
    }
    console.log('Setting up overlay bind, document state:', document.readyState);
    if(document.readyState==='loading') {
      console.log('Document loading, adding DOMContentLoaded listener');
      document.addEventListener('DOMContentLoaded', bind);
    } else {
      console.log('Document ready, calling bind immediately');
      bind();
    }
    // Store update listener for overlay - not needed without panel content
  })();
  </script>
  </body></html>`;
}

function getPanelHTML(){
  return '<!doctype html><html><head>' +
  '<meta charset="utf-8" />' +
  '<style>' +
    'body{ margin:0; padding:15px; font-family: -apple-system, BlinkMacSystemFont, Arial; color:white; background: rgba(18,18,20,0.92); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }' +
    '* { box-sizing: border-box; }' +
    'body.panel-enter{ animation: panelIn .2s ease forwards; }' +
    'body.panel-leave{ animation: panelOut .18s ease forwards; }' +
    '@keyframes panelIn{ from{ opacity:0; transform: translateY(-12px);} to{ opacity:1; transform: translateY(0);} }' +
    '@keyframes panelOut{ from{ opacity:1; transform: translateY(0);} to{ opacity:0; transform: translateY(-12px);} }' +
    'h4{ margin:8px 0 14px 0; font-size:13px; color: #4ecdc4; text-transform: uppercase; letter-spacing: 0.5px; }' +
    '.notes{ margin-bottom: 15px; flex-shrink: 0; }' +
    '.quick-note-input{ display: flex; gap: 8px; margin-bottom: 10px; -webkit-app-region: no-drag; pointer-events: auto; }' +
    '.quick-note-input textarea{ flex: 1; min-height: 80px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; padding: 10px; font-size: 12px; box-sizing: border-box; -webkit-app-region: no-drag; resize: none; line-height:1.35; outline: none; }' +
    '.quick-note-input textarea:focus{ border-color: #4f8cff; box-shadow: 0 0 0 2px rgba(79,140,255,0.35), 0 0 0 4px rgba(79,140,255,0.18); }' +
    'input:focus, select:focus{ outline: none; border-color: #4f8cff !important; box-shadow: 0 0 0 2px rgba(79,140,255,0.35), 0 0 0 4px rgba(79,140,255,0.18) !important; }' +
    '.add-btn{ background: #4ecdc4; border: none; border-radius: 6px; color: white; width: 44px; min-height: 80px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; -webkit-app-region: no-drag; pointer-events: auto; flex-shrink: 0; }' +
    '.todos-container{ flex: 1; display: flex; flex-direction: column; min-height: 0; gap: 16px; }' +
    '.add-btn:hover{ background: #45b7aa; transform: scale(1.05); }' +
    '.add-btn:active{ transform: scale(0.95); }' +
    '.todos{ display: block; margin: 0; min-height: 0; }' +
    '.todos:last-child{ margin-bottom: 0; }' +
    '.todo-list{ background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px; position: relative; overflow-y: auto; overflow-x: hidden; height: 140px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: rgba(78,205,196,0.6) transparent; }' +
    '.todo-list::-webkit-scrollbar{ width: 6px; }' +
    '.todo-list::-webkit-scrollbar-track{ background: transparent; }' +
    '.todo-list::-webkit-scrollbar-thumb{ background: rgba(78,205,196,0.4); border-radius: 3px; }' +
    '.todo-list::-webkit-scrollbar-thumb:hover{ background: rgba(78,205,196,0.6); }' +
    '#todoList, #doingList, #doneList{ height: 140px; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }' +
    '.todo-item{ display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background-color .25s ease, border-color .25s ease, color .25s ease; opacity: 1; transform: none; max-height: 50px; overflow: visible; position: relative; }' +
    '.todo-item:last-child{ border-bottom: none; }' +
    '.todo-item:hover{ background: rgba(255,255,255,0.05); border-radius: 6px; }' +
    '.todo-item.completed .todo-title{ text-decoration: line-through; opacity: 0.6; transition: all 0.5s ease; }' +
    '.todo-item.completing{ animation: taskComplete 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55); }' +
    '.todo-item.fade-out{ opacity: 0; transform: translateX(-100%); max-height: 0; padding-top: 0; padding-bottom: 0; margin: 0; }' +
    '.todo-item.fade-in{ opacity: 0; transform: translateX(100%); animation: slideIn 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards; }' +
    '.todo-item.moving-out{ animation: taskMoveOut 0.4s cubic-bezier(0.4, 0, 0.6, 1) forwards; }' +
    '.todo-item.moving-in{ animation: taskMoveIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both; }' +
    '@keyframes slideIn { to { opacity: 1; transform: translateX(0); } }' +
    '@keyframes taskComplete { 0% { background: rgba(255,255,255,0.05); transform: scale(1); } 25% { background: rgba(78,205,196,0.2); transform: scale(1.02); box-shadow: 0 0 20px rgba(78,205,196,0.3); } 50% { background: rgba(78,205,196,0.15); transform: scale(1.01); } 75% { background: rgba(78,205,196,0.1); transform: scale(1); } 100% { background: rgba(255,255,255,0.05); transform: scale(1); } }' +
    '@keyframes taskMoveOut { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-20px) scale(0.9); max-height: 0; padding-top: 0; padding-bottom: 0; } }' +
    '@keyframes taskMoveIn { 0% { opacity: 0; transform: translateY(20px) scale(0.9); max-height: 0; } 100% { opacity: 1; transform: translateY(0) scale(1); max-height: 50px; } }' +
    '.todo-title{ flex: 1; font-size: 12px; transition: all 0.5s ease; word-wrap: break-word; line-height: 1.3; }' +
    '.todo-actions{ display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }' +
    '.todo-item:hover .todo-actions{ opacity: 1; pointer-events: auto; }' +
    '.todo-action-btn{ width: 24px; height: 24px; border: none; background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; -webkit-app-region: no-drag; border-radius: 2px; }' +
    '.todo-edit-btn{ color: #888; }' +
    '.todo-edit-btn:hover{ background: rgba(136,136,136,0.1); transform: scale(1.1); color: #666; }' +
    '.todo-delete-btn{ color: #888; }' +
    '.todo-delete-btn:hover{ background: rgba(136,136,136,0.1); transform: scale(1.1); color: #666; }' +
    '.empty-state{ text-align: center; padding: 10px; color: rgba(255,255,255,0.6); font-size: 11px; }' +
    '.checkbox-wrapper * { -webkit-tap-highlight-color: transparent; outline: none; }' +
    '.checkbox-wrapper input[type="checkbox"] { display: none; }' +
    '.checkbox-wrapper label { --size: 20px; position: relative; display: block; width: var(--size); height: var(--size); margin: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%); border: 2px solid rgba(78,205,196,0.4); border-radius: 6px; cursor: pointer; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); overflow: hidden; position: relative; flex-shrink: 0; }' +
    '.checkbox-wrapper label:before { content: ""; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px; background: linear-gradient(135deg, rgba(18,18,20,0.95) 0%, rgba(18,18,20,0.85) 100%); border-radius: 3px; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }' +
    '.checkbox-wrapper label:after { content: "✓"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0) rotate(360deg); color: #fff; font-size: 12px; font-weight: bold; opacity: 0; transition: all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55); text-shadow: 0 0 10px rgba(78,205,196,1), 0 0 20px rgba(78,205,196,0.6); }' +
    '.checkbox-wrapper label:hover { border-color: rgba(78,205,196,0.8); box-shadow: 0 0 0 3px rgba(78,205,196,0.15), 0 4px 16px rgba(0,0,0,0.2); transform: translateY(-1px) scale(1.05); }' +
    '.checkbox-wrapper label:hover:before { background: linear-gradient(135deg, rgba(18,18,20,0.98) 0%, rgba(18,18,20,0.9) 100%); transform: scale(0.9); }' +
    '.checkbox-wrapper label:active { transform: translateY(0) scale(0.9); transition: all 0.1s ease; }' +
    '.checkbox-wrapper input[type="checkbox"]:checked + label { border-color: #4ecdc4; background: linear-gradient(135deg, #4ecdc4 0%, #45b7aa 50%, #3a9d96 100%); box-shadow: 0 0 0 3px rgba(78,205,196,0.4), 0 8px 24px rgba(78,205,196,0.6), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 6px rgba(0,0,0,0.2); animation: checkboxPulse 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55); }' +
    '.checkbox-wrapper input[type="checkbox"]:checked + label:before { opacity: 0; transform: scale(0) rotate(180deg); }' +
    '.checkbox-wrapper input[type="checkbox"]:checked + label:after { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }' +
    '.checkbox-wrapper.just-checked label:after { animation: checkmarkBounce 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) both; }' +
    '@keyframes checkboxPulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }' +
    '@keyframes checkmarkBounce { 0% { transform: translate(-50%, -50%) scale(0) rotate(360deg); } 60% { transform: translate(-50%, -50%) scale(1.2) rotate(0deg); } 100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); } }' +
    '.play-btn { --size: 20px; position: relative; display: block; width: var(--size); height: var(--size); margin: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%); border: 2px solid rgba(78,205,196,0.4); border-radius: 6px; cursor: pointer; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); overflow: hidden; position: relative; flex-shrink: 0; }' +
    '.play-btn:before { content: ""; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px; background: linear-gradient(135deg, rgba(18,18,20,0.95) 0%, rgba(18,18,20,0.85) 100%); border-radius: 3px; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }' +
    '.play-btn:after { content: "▶"; position: absolute; top: 50%; left: 50%; transform: translate(-45%, -50%) scale(1); color: #4ecdc4; font-size: 10px; font-weight: bold; opacity: 1; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }' +
    '.play-btn:hover { border-color: rgba(78,205,196,0.8); box-shadow: 0 0 0 3px rgba(78,205,196,0.15), 0 4px 16px rgba(0,0,0,0.2); transform: translateY(-1px) scale(1.05); }' +
    '.play-btn:hover:before { background: linear-gradient(135deg, rgba(18,18,20,0.98) 0%, rgba(18,18,20,0.9) 100%); transform: scale(0.9); }' +
    '.play-btn:active { transform: translateY(0) scale(0.9); transition: all 0.1s ease; }' +
  '</style>' +
  '</head><body>' +
    '<div class="notes">' +
      '<h4>Schnellnotizen</h4>' +
      '<div class="quick-note-input">' +
        '<textarea id="quickNoteInput" placeholder="Enter = Zeilenumbruch. Klicke auf + zum Speichern." maxlength="2000"></textarea>' +
        '<button id="addQuickNote" class="add-btn">+</button>' +
      '</div>' +
    '</div>' +
    '<div class="todos-container">' +
      '<div class="todos">' +
        '<h4>Zu tun</h4>' +
        '<div class="todo-list" id="todoList">' +
          '<div class="empty-state">Lädt...</div>' +
        '</div>' +
      '</div>' +
      '<div class="todos">' +
        '<h4>In Arbeit</h4>' +
        '<div class="todo-list" id="doingList">' +
          '<div class="empty-state">Keine Aufgaben in Arbeit</div>' +
        '</div>' +
      '</div>' +
      '<div class="todos">' +
        '<h4>Erledigt</h4>' +
        '<div class="todo-list" id="doneList">' +
          '<div class="empty-state">Keine erledigten Aufgaben</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '<script>' +
    'document.addEventListener("DOMContentLoaded", function(){ try{ document.body.classList.add("panel-enter"); setTimeout(function(){ document.body.classList.remove("panel-enter"); }, 220);}catch(e){} });' +
    'function requestResize(){ try{ const h = Math.ceil(document.body.scrollHeight); window.focusflow.panelResize({ height: h }); }catch(e){} }' +
    'var __panelEditingActive=false; var __renderInterval=null; ' +
    'function scheduleRender(){ try{ if(__renderInterval) clearInterval(__renderInterval); }catch(e){} __renderInterval = setInterval(function(){ if(!__panelEditingActive){ renderTodos(); } }, 2000); }' +

    'function addQuickNote(){' +
      'var input=document.getElementById("quickNoteInput"); var text=input.value.trim(); if(!text) return;' +
      'window.focusflow.getState().then(function(s){ if(!s||typeof s!=="object") return; if(!Array.isArray(s.quickNotes)) s.quickNotes=[];' +
        'var words=text.split(" ").slice(0,3).join(" "); var d=new Date(); var dateStr=d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"}); var timeStr=d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); var name=words+" - "+dateStr+" "+timeStr;' +
        's.quickNotes.unshift({ id: Date.now().toString()+Math.random().toString(36).slice(2), text:text, name:name, timestamp:Date.now() });' +
        'window.focusflow.setState(s).then(function(){ input.value=""; requestResize(); });' +
      '});' +
    '}' +

        'var __lastRenderIds = { todo: [], doing: [], done: [] };' +
        'var __prevPositions = {};' +
        'function __storePrevPositions(){ try{ __prevPositions = {}; document.querySelectorAll(".todo-item").forEach(function(el){ var cb = el.querySelector("input[type=\\"checkbox\\"]"); var id = cb ? cb.getAttribute("data-id") : null; if(id){ __prevPositions[id] = el.getBoundingClientRect(); } }); }catch(e){} }' +
        'function __playFLIP(){ try{ document.querySelectorAll(".todo-item").forEach(function(el){ var cb = el.querySelector("input[type=\\"checkbox\\"]"); var id = cb ? cb.getAttribute("data-id") : null; if(!id || !__prevPositions[id]) return; var prev = __prevPositions[id]; var rect = el.getBoundingClientRect(); var dy = prev.top - rect.top; if(Math.abs(dy) > 1){ el.style.willChange = "transform, opacity"; el.style.transform = "translateY("+dy+"px)"; el.style.opacity = "0.9"; requestAnimationFrame(function(){ el.style.transition = "transform 380ms cubic-bezier(0.2,0.8,0.2,1), opacity 380ms"; el.style.transform = "translateY(0)"; el.style.opacity = "1"; setTimeout(function(){ el.style.transition = ""; el.style.willChange = ""; }, 420); }); } }); }catch(e){} }' +
        'function renderTodos(){' +
      'window.focusflow.getState().then(function(state){' +
        'if(__panelEditingActive) return;' +
        'if(!state || typeof state !== "object") return;' +
        'var todoList = document.getElementById("todoList");' +
        'var doingList = document.getElementById("doingList");' +
        'var doneList = document.getElementById("doneList");' +
        '__storePrevPositions();' +
        'if(!todoList || !doingList || !doneList) return;' +

        'var allTodos = [];' +
        'if(Array.isArray(state.projects)){' +
          'state.projects.forEach(function(project){' +
            'if(project.columns && typeof project.columns === "object"){' +
              '["todo", "doing", "done"].forEach(function(columnName){' +
                'if(Array.isArray(project.columns[columnName])){' +
                  'project.columns[columnName].forEach(function(task){' +
                    'allTodos.push({ id: task.id, title: task.title, status: columnName });' +
                  '});' +
                '}' +
              '});' +
            '}' +
          '});' +
        '}' +

        'var todoTasks = allTodos.filter(function(t){ return t.status === "todo"; });' +
        'var doingTasks = allTodos.filter(function(t){ return t.status === "doing"; });' +
        'var doneTasks = allTodos.filter(function(t){ return t.status === "done"; });' +
        'var currentTodoIds = todoTasks.map(function(t){ return t.id; });' +
        'var currentDoingIds = doingTasks.map(function(t){ return t.id; });' +
        'var currentDoneIds = doneTasks.map(function(t){ return t.id; });' +
        'var newTodoIds = currentTodoIds.filter(function(id){ return __lastRenderIds.todo.indexOf(id) === -1; });' +
        'var newDoingIds = currentDoingIds.filter(function(id){ return __lastRenderIds.doing.indexOf(id) === -1; });' +
        'var newDoneIds = currentDoneIds.filter(function(id){ return __lastRenderIds.done.indexOf(id) === -1; });' +

        'if(todoTasks.length === 0){' +
          'todoList.innerHTML = "<div class=\\"empty-state\\">Keine Aufgaben</div>";' +
        '}else{' +
          'todoList.innerHTML = "";' +
          'todoTasks.forEach(function(todo){' +
            'var item = document.createElement("div");' +
            'var isNew = newTodoIds.indexOf(todo.id) !== -1;' +
            'item.className = isNew ? "todo-item moving-in" : "todo-item";' +
            'item.innerHTML = "<div class=\\"play-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"start\\"></div><div class=\\"todo-title\\">"+todo.title.replace(/</g,"&lt;")+"</div><div class=\\"todo-actions\\"><button class=\\"todo-action-btn todo-edit-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"edit\\"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/><path d=\\"m18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg></button><button class=\\"todo-action-btn todo-delete-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"delete\\"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M3 6h18\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/><path d=\\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg></button></div>";' +
            'todoList.appendChild(item);' +
            'if(isNew){ setTimeout(function(){ item.classList.remove("moving-in"); }, 800); }' +
          '});' +
        '}' +

        'if(doingTasks.length === 0){' +
          'doingList.innerHTML = "<div class=\\"empty-state\\">Keine Aufgaben in Arbeit</div>";' +
        '}else{' +
          'doingList.innerHTML = "";' +
          'doingTasks.forEach(function(todo){' +
            'var item = document.createElement("div");' +
            'var isNew = newDoingIds.indexOf(todo.id) !== -1;' +
            'item.className = isNew ? "todo-item moving-in" : "todo-item";' +
            'item.innerHTML = "<div class=\\"checkbox-wrapper\\"><input type=\\"checkbox\\" id=\\"doing_"+todo.id+"\\" data-id=\\""+todo.id+"\\"><label for=\\"doing_"+todo.id+"\\"><div class=\\"tick_mark\\"></div></label></div><div class=\\"todo-title\\">"+todo.title.replace(/</g,"&lt;")+"</div><div class=\\"todo-actions\\"><button class=\\"todo-action-btn todo-edit-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"edit\\"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/><path d=\\"m18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg></button><button class=\\"todo-action-btn todo-delete-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"delete\\"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M3 6h18\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/><path d=\\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2h4a2 2 0 0 1 2 2v2\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg></button></div>";' +
            'doingList.appendChild(item);' +
            'if(isNew){ setTimeout(function(){ item.classList.remove("moving-in"); }, 800); }' +
          '});' +
        '}' +

        'if(doneTasks.length === 0){' +
          'doneList.innerHTML = "<div class=\\"empty-state\\">Keine erledigten Aufgaben</div>";' +
        '}else{' +
          'doneList.innerHTML = "";' +
          'doneTasks.forEach(function(todo){' +
            'var item = document.createElement("div");' +
            'var isNew = newDoneIds.indexOf(todo.id) !== -1;' +
            'item.className = isNew ? "todo-item completed moving-in" : "todo-item completed";' +
            'item.innerHTML = "<div class=\\"checkbox-wrapper\\"><input type=\\"checkbox\\" checked id=\\"done_"+todo.id+"\\" data-id=\\""+todo.id+"\\"><label for=\\"done_"+todo.id+"\\"><div class=\\"tick_mark\\"></div></label></div><div class=\\"todo-title\\">"+todo.title.replace(/</g,"&lt;")+"</div><div class=\\"todo-actions\\"><button class=\\"todo-action-btn todo-edit-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"edit\\"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/><path d=\\"m18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg></button><button class=\\"todo-action-btn todo-delete-btn\\" data-id=\\""+todo.id+"\\" data-action=\\"delete\\"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M3 6h18\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/><path d=\\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg></button></div>";' +
            'doneList.appendChild(item);' +
            'if(isNew){ setTimeout(function(){ item.classList.remove("moving-in"); }, 800); }' +
          '});' +
        '}' +

        '__lastRenderIds.todo = currentTodoIds;' +
        '__lastRenderIds.doing = currentDoingIds;' +
        '__lastRenderIds.done = currentDoneIds;' +
        '__playFLIP();' +
        'requestResize();' +
      '});' +
    '}' +

    'function handleTodoActions(e){' +
      'console.log("handleTodoActions called", e.target);' +
      'var target = e.target;' +
      'if(!target.hasAttribute("data-action") && target.closest("[data-action]")){' +
        'target = target.closest("[data-action]");' +
      '}' +
      'if(target.hasAttribute("data-action")){' +
        'var action = target.getAttribute("data-action");' +
        'var todoId = target.getAttribute("data-id");' +
        'console.log("Action:", action, "TodoId:", todoId);' +
        'if(!todoId) return;' +
        'e.preventDefault();' +
        'e.stopPropagation();' +
        'if(action === "edit"){' +
          'console.log("Calling startInlineEditElement");' +
          'startInlineEditElement(target, todoId);' +
        '}else if(action === "save"){' +
          'console.log("Save button clicked");' +
          'var item = target.closest(".todo-item");' +
          'var input = item ? item.querySelector(".todo-inline-input") : null;' +
          'if(input){ input.blur(); }' +
        '}else if(action === "delete"){' +
          'console.log("Calling deleteTodo");' +
          'deleteTodo(todoId);' +
        '}else if(action === "start"){' +
          'console.log("Calling startTask");' +
          'startTask(todoId);' +
        '}' +
      '}' +
    '}' +

    'function editTodo(todoId){' +
      'console.log("editTodo function called with:", todoId);' +
      'window.focusflow.getState().then(function(state){' +
        'if(!state || !Array.isArray(state.projects)) return;' +
        'var task = null;' +
        'state.projects.forEach(function(project){' +
          'if(task) return;' +
          '["todo", "doing", "done"].forEach(function(columnName){' +
            'if(task || !Array.isArray(project.columns[columnName])) return;' +
            'var foundTask = project.columns[columnName].find(function(t){ return t.id === todoId; });' +
            'if(foundTask) task = foundTask;' +
          '});' +
        '});' +
        'if(task){' +
          'var newTitle = prompt("Aufgabe bearbeiten:", task.title);' +
          'if(newTitle !== null && newTitle.trim() !== ""){' +
            'task.title = newTitle.trim();' +
            'window.focusflow.setState(state).then(function(){' +
              'setTimeout(renderTodos, 100);' +
            '});' +
          '}' +
        '}else{' +
          'alert("Aufgabe nicht gefunden!");' +
        '}' +
      '});' +
    '}' +

    'function startTask(todoId){' +
      'console.log("startTask function called with:", todoId);' +
      'window.focusflow.getState().then(function(state){' +
        'if(!state || !Array.isArray(state.projects)) return;' +
        'var found = false;' +
        'state.projects.forEach(function(project){' +
          'if(found) return;' +
          'if(project.columns && Array.isArray(project.columns.todo)){' +
            'var taskIndex = project.columns.todo.findIndex(function(t){ return t.id === todoId; });' +
            'if(taskIndex !== -1){' +
              'var task = project.columns.todo.splice(taskIndex, 1)[0];' +
              'if(!Array.isArray(project.columns.doing)) project.columns.doing = [];' +
              'project.columns.doing.push(task);' +
              'found = true;' +
            '}' +
          '}' +
        '});' +
        'if(found){' +
          'window.focusflow.setState(state).then(function(){' +
            'setTimeout(renderTodos, 100);' +
          '});' +
        '}' +
      '});' +
    '}' +

    'function startInlineEditElement(btn, todoId){' +
      'try{' +
        '__panelEditingActive = true; try{ if(__renderInterval) clearInterval(__renderInterval); }catch(e){}' +
        'var item = btn.closest(".todo-item"); if(!item) return;' +
        'var titleEl = item.querySelector(".todo-title"); if(!titleEl) return;' +
        'var original = titleEl.textContent || "";' +
        'var input = document.createElement("input");' +
        'input.type = "text"; input.value = original; input.style.width = "100%"; input.style.padding = "6px"; input.style.borderRadius = "4px"; input.style.border = "1px solid rgba(255,255,255,0.2)"; input.style.background = "rgba(255,255,255,0.08)"; input.style.color = "white"; input.className = "todo-inline-input";' +
        'titleEl.replaceWith(input);' +
        'input.focus(); input.setSelectionRange(original.length, original.length);' +
        'var originalIcon = btn.innerHTML;' +
        'btn.innerHTML = "<svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\"><path d=\\"M20 7L9 18L4 13\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\"/></svg>";' +
        'btn.setAttribute("data-action", "save");' +
        'function finish(){ btn.innerHTML = originalIcon; btn.setAttribute("data-action", "edit"); __panelEditingActive=false; scheduleRender(); }' +
        'function commit(){ var newVal = (input.value||"").trim(); if(!newVal){ cancel(); return; } window.focusflow.getState().then(function(state){ if(!state||!Array.isArray(state.projects)) { finish(); return; } var done=false; state.projects.forEach(function(project){ if(done) return; ["todo","doing","done"].forEach(function(col){ if(done) return; var list = project.columns&&Array.isArray(project.columns[col]) ? project.columns[col] : null; if(!list) return; var t = list.find(function(tt){ return tt.id===todoId; }); if(t){ t.title = newVal; done=true; } }); }); if(done){ window.focusflow.setState(state).then(function(){ setTimeout(function(){ renderTodos(); finish(); }, 50); }); } else { cancel(); } }); }' +
        'function cancel(){ finish(); renderTodos(); }' +
        'input.addEventListener("keydown", function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); commit(); } if(ev.key==="Escape"){ ev.preventDefault(); cancel(); } });' +
        'input.addEventListener("blur", function(){ commit(); });' +
      '}catch(e){ console.log("inline edit error", e); }' +
    '}' +

    'function deleteTodo(todoId){' +
      'if(!confirm("Möchten Sie diese Aufgabe wirklich löschen?")) return;' +
      'window.focusflow.getState().then(function(state){' +
        'if(!state || !Array.isArray(state.projects)) return;' +
        'var found = false;' +
        'state.projects.forEach(function(project){' +
          'if(found || !project.columns || typeof project.columns !== "object") return;' +
          '["todo", "doing", "done"].forEach(function(columnName){' +
            'if(found || !Array.isArray(project.columns[columnName])) return;' +
            'var taskIndex = project.columns[columnName].findIndex(function(t){ return t.id === todoId; });' +
            'if(taskIndex !== -1){' +
              'project.columns[columnName].splice(taskIndex, 1);' +
              'found = true;' +
            '}' +
          '});' +
        '});' +
        'if(found){' +
          'window.focusflow.setState(state).then(function(){' +
            'setTimeout(renderTodos, 100);' +
          '});' +
        '}' +
      '});' +
    '}' +

    'function handleTodoToggle(e){' +
      'if(e.target.type === "checkbox"){' +
        'var todoId = e.target.getAttribute("data-id");' +
        'var isChecked = e.target.checked;' +
        'if(!todoId) return;' +
        'var todoItem = e.target.closest(".todo-item");' +
        'var checkboxWrapper = e.target.closest(".checkbox-wrapper");' +
        'if(todoItem && isChecked){ todoItem.classList.add("completing"); setTimeout(function(){ todoItem.classList.remove("completing"); }, 800); }' +
        'if(checkboxWrapper && isChecked){ checkboxWrapper.classList.add("just-checked"); setTimeout(function(){ checkboxWrapper.classList.remove("just-checked"); }, 800); }' +
        'if(todoItem){ todoItem.classList.add("moving-out"); }' +
        'window.focusflow.getState().then(function(state){' +
          'if(!state || !Array.isArray(state.projects)) return;' +
          'var found = false;' +
          'state.projects.forEach(function(project){' +
            'if(found || !project.columns || typeof project.columns !== "object") return;' +
            '["todo", "doing", "done"].forEach(function(columnName){' +
              'if(found || !Array.isArray(project.columns[columnName])) return;' +
              'var taskIndex = project.columns[columnName].findIndex(function(t){ return t.id === todoId; });' +
              'if(taskIndex !== -1){' +
                'var task = project.columns[columnName][taskIndex];' +
                'project.columns[columnName].splice(taskIndex, 1);' +
                'var targetColumnName = isChecked ? "done" : (columnName === "done" ? "doing" : "todo");' +
                'if(Array.isArray(project.columns[targetColumnName])){' +
                  'project.columns[targetColumnName].push(task);' +
                '}' +
                'found = true;' +
              '}' +
            '});' +
          '});' +
          'if(found){' +
            'window.focusflow.setState(state).then(function(){' +
              'setTimeout(renderTodos, 100);' +
            '});' +
          '}' +
        '});' +
      '}' +
    '}' +

    'document.addEventListener("DOMContentLoaded", function(){' +
      'var btn=document.getElementById("addQuickNote"); var ta=document.getElementById("quickNoteInput");' +
      'if(btn){' +
        'btn.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); addQuickNote(); });' +
        'btn.addEventListener("mousedown", function(e){ e.preventDefault(); e.stopPropagation(); addQuickNote(); });' +
        'btn.addEventListener("touchstart", function(e){ e.preventDefault(); e.stopPropagation(); addQuickNote(); });' +
      '}' +
      'document.addEventListener("click", function(e){' +
        'handleTodoActions(e);' +
        'if(e.target.closest("#addQuickNote")){ addQuickNote(); }' +
      '});' +
      'document.addEventListener("change", handleTodoToggle);' +
      'setTimeout(function(){ renderTodos(); }, 500);' +
      'scheduleRender();' +
      'requestResize();' +
    '});' +

    'try{ window.focusflow.onStoreUpdated(function(){ if(!__panelEditingActive){ setTimeout(function(){ renderTodos(); }, 100); } }); }catch(e){ console.log("Store listener failed:", e); }' +
  '</script>' +
  '</body></html>';
}

function createTray() {
  try {
    if (tray && !tray.isDestroyed()) return;
    const iconPath = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png');
    let image;
    if (fs.existsSync(iconPath)) {
      image = nativeImage.createFromPath(iconPath);
    } else {
      image = nativeImage.createEmpty();
    }
    tray = new Tray(image);
  } catch {
    // As a last resort, use an empty image
    try { tray = new Tray(nativeImage.createEmpty()); } catch {}
  }
  // No context menu; single-click behavior only
  tray.setToolTip('MO:ST Zeitmanagement');
  updateTrayTitle();
  tray.on('click', () => {
    // Click always shows the timer overlay (bar mode)
    overlayMode = 'bar';
    toggleOverlay(true);
    try{
      if(panelWindow && !panelWindow.isDestroyed()) positionPanel();
    }catch{}
  });
}

function updateTrayTitle() {
  if (!tray) return;
  const text = formatTrayText(lastTimerPayload);
  if (process.platform === 'darwin') {
    tray.setTitle(text); // shows text in the menu bar on macOS
  } else {
    tray.setToolTip('MO:ST Zeitmanagement ' + text);
  }
}

function formatTrayText(p) {
  const mode = (p.mode || 'idle');
  const sec = mode === 'countdown' ? p.remaining : p.elapsed;
  const m = String(Math.floor((sec||0)/60)).padStart(2, '0');
  const s = String(Math.floor((sec||0)%60)).padStart(2, '0');
  return `${m}:${s}`;
}
