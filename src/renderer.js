// Storage functions are now available globally from storage.js

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let state = structuredClone(initialState);

async function load() {
  try {
    const fromStore = await window.focusflow.getState();
    console.log('Renderer loading store data:', fromStore);

    // WICHTIG: Lade die existierenden Daten VOLLSTÄNDIG ohne sie zu überschreiben
    if(fromStore && typeof fromStore === 'object'){
      // Beginne mit den gespeicherten Daten als Basis
      state = structuredClone(fromStore);

      // Ergänze nur fehlende Properties aus initialState
      Object.keys(initialState).forEach(key => {
        if(state[key] === undefined || state[key] === null) {
          state[key] = structuredClone(initialState[key]);
        }
      });

      // Stelle sicher, dass projects Array existiert (aber überschreibe es NICHT)
      if(!Array.isArray(state.projects)) {
        console.log('Projects array missing, creating default');
        state.projects = structuredClone(initialState.projects);
        state.currentProjectId = initialState.currentProjectId;
      } else if(state.projects.length === 0) {
        console.log('Projects array empty, adding default project');
        state.projects.push(...structuredClone(initialState.projects));
        state.currentProjectId = initialState.currentProjectId;
      }

      // Stelle sicher, dass alle Projekte die richtige Struktur haben (repariere nur Struktur)
      state.projects.forEach(project => {
        if(!project.columns) {
          console.log('Adding missing columns to project:', project.id);
          project.columns = { todo: [], doing: [], done: [] };
        }
        ['todo', 'doing', 'done'].forEach(column => {
          if(!Array.isArray(project.columns[column])) {
            console.log('Fixing column array for:', project.id, column);
            project.columns[column] = [];
          }
        });
      });

      // Debug-Log für geladene Daten
      const taskCounts = {
        todo: state.projects.reduce((sum, p) => sum + (p.columns?.todo?.length || 0), 0),
        doing: state.projects.reduce((sum, p) => sum + (p.columns?.doing?.length || 0), 0),
        done: state.projects.reduce((sum, p) => sum + (p.columns?.done?.length || 0), 0)
      };
      console.log('Loaded state successfully - Task counts:', taskCounts);
    } else {
      console.log('No store data found, using initial state');
      state = structuredClone(initialState);
    }
  } catch (error) {
    console.error('Error loading store:', error);
    state = structuredClone(initialState);
  }

  applyTheme(state.theme || 'dark');
  render();
}

async function persist() {
  try {
    console.log('Persisting state:', state);
    const result = await window.focusflow.setState(state);
    console.log('State persisted successfully');
    return result;
  } catch (error) {
    console.error('Error persisting state:', error);
    throw error;
  }
}
// Live sync: refresh UI when store changes anywhere (main/overlay/panel)
try {
  window.focusflow.onStoreUpdated((snapshot)=>{
    if(snapshot && snapshot.projects && Array.isArray(snapshot.projects)){
      // merge snapshot
      state = Object.assign(structuredClone(initialState), snapshot);
      // always apply theme from store
      applyTheme(state.theme || 'dark');
      // Avoid re-render visual lists during theme transition to prevent flicker
      if(!isThemeSwitching){
        renderBoard();
        renderTimerTaskSelect();
      }
    }
  });
} catch {}
// Theme
let isThemeSwitching = false;
function applyTheme(theme){
  const isDark = theme === 'dark';
  document.body.dataset.theme = isDark ? 'dark' : 'light';
  const checkbox = document.getElementById('input');
  if(checkbox) checkbox.checked = isDark ? true : false; // checked = dark
}

const themeCheckbox = document.getElementById('input');
if(themeCheckbox){
  themeCheckbox.addEventListener('change', async ()=>{
    const next = themeCheckbox.checked ? 'dark' : 'light';
    // run visual transition first to avoid racing with store broadcasts
    try{ await transitionTheme(next); }catch{}
    state.theme = next;
    await persist();
  }, { passive: true });
}

function transitionTheme(next){
  if(isThemeSwitching) return Promise.resolve();
  isThemeSwitching = true;
  const body = document.body;
  body.classList.add('theme-switching');

  const enableViewTransition = document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(enableViewTransition){
    try{
      const vt = document.startViewTransition(()=>{ applyTheme(next); });
      return vt.finished.finally(()=>{ isThemeSwitching = false; body.classList.remove('theme-switching'); });
    }catch(e){ /* fall through to overlay */ }
  }

  // Fallback overlay cross-fade if View Transitions not available
  return new Promise((resolve)=>{
    const fade = document.getElementById('themeFade');
    if(!fade){ applyTheme(next); body.classList.remove('theme-switching'); isThemeSwitching=false; resolve(); return; }
    fade.style.transition = 'opacity .35s ease';
    fade.style.opacity = '1';
    setTimeout(()=>{
      applyTheme(next);
      requestAnimationFrame(()=>{
        fade.style.opacity = '0';
        setTimeout(()=>{ body.classList.remove('theme-switching'); isThemeSwitching=false; resolve(); }, 380);
      });
    }, 120);
  });
}

// --- Rendering ---
function render() {
  // projects removed from layout
  renderBoard();
  renderNotes();
  renderTimerTaskSelect();
  // today summary removed
}

function renderProjects() {
  const list = $('#projectList');
  list.innerHTML = '';
  state.projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'project-item' + (p.id === state.currentProjectId ? ' active' : '');
    item.innerHTML = `<span>${p.name}</span><span class="badge">${allTasks(p).length}</span>`;
    item.onclick = async () => { state.currentProjectId = p.id; await persist(); render(); }
    list.appendChild(item);
  });
  // removed initial list entrance animation for snappier UX
}

function renderBoard() {
  const project = findProject(state, state.currentProjectId);
  const columns = ['todo','doing','done'];
  columns.forEach(col => {
    const list = $('#' + col + 'List');
    list.innerHTML = '';
    const cards = project.columns[col].map(task => renderCard(task));
    cards.forEach(el=> list.appendChild(el));
    // removed card entrance animation for snappier UX
    setupDroppable(list, col);
  });
}

function renderCard(task){
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.dataset.id = task.id;
  el.innerHTML = `
    <div class="card-title">${escapeHTML(task.title)}</div>
    ${task.notes ? `<div class="card-notes">${escapeHTML(task.notes)}</div>` : ''}
    <div class="card-actions">
      <button class="btn" data-action="edit">Bearbeiten</button>
      <button class="btn" data-action="delete">Löschen</button>
    </div>
  `;

  // Use passive listeners for better performance
  el.addEventListener('dragstart', (e)=>{
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  }, { passive: false });

  el.addEventListener('click', async (e)=>{
    const action = e.target.getAttribute('data-action');
    if(!action) return;
    if(action==='delete') await deleteTask(task.id);
    if(action==='edit') openTaskModal(task);
  }, { passive: false });

  return el;
}

// Track which elements already have drop listeners to avoid duplicates
const droppableListeners = new Set();

function setupDroppable(listEl, targetStatus){
  const key = `${listEl.id}-${targetStatus}`;
  if(droppableListeners.has(key)) return; // Already set up

  droppableListeners.add(key);

  listEl.addEventListener('dragover', (e)=>{ e.preventDefault(); listEl.classList.add('drag-over'); });
  listEl.addEventListener('dragleave', ()=> listEl.classList.remove('drag-over'));
  listEl.addEventListener('drop', async (e)=>{
    e.preventDefault();
    listEl.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    await moveTaskTo(id, targetStatus);
  });
}

// Allow dropping a task onto the timer to link it (whole drop zone)
const timerSelect = document.getElementById('timerTaskSelect');
const timerDropHint = document.getElementById('timerDropHint');
const timerDropZone = document.getElementById('timerDropZone');
['dragover','dragenter'].forEach(ev=>{
  timerDropZone.addEventListener(ev, (e)=>{ e.preventDefault(); timerDropZone.classList.add('drag-over'); timerDropHint.style.opacity='1'; });
});
['dragleave','dragend'].forEach(ev=>{
  timerDropZone.addEventListener(ev, ()=>{ timerDropZone.classList.remove('drag-over'); timerDropHint.style.opacity='0.6'; });
});
timerDropZone.addEventListener('drop', (e)=>{
  e.preventDefault(); timerDropZone.classList.remove('drag-over');
  const id = e.dataTransfer.getData('text/plain');
  if(!id) return; timerSelect.value = id; activeTimerTaskId = id; emitTimerUpdate('idle'); timerDropHint.style.opacity='0.6';
});

// Debounce rendering to prevent lag when moving multiple tasks quickly
let renderDebounceTimer = null;
const debouncedRender = () => {
  clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(() => {
    renderBoard();
    renderTimerTaskSelect();
  }, 150); // Wait 150ms after last move before re-rendering
};

async function moveTaskTo(taskId, status){
  const project = findProject(state, state.currentProjectId);
  const columns = project.columns;
  let found;
  for(const col of ['todo','doing','done']){
    const idx = columns[col].findIndex(t=>t.id===taskId);
    if(idx>-1){ found = columns[col].splice(idx,1)[0]; break; }
  }
  if(found){
    found.status = status;
    columns[status].push(found);

    // Persist immediately but debounce rendering
    await persist();
    debouncedRender();
  }
}

async function deleteTask(taskId){
  const project = findProject(state, state.currentProjectId);
  ['todo','doing','done'].forEach(c=>{
    const idx = project.columns[c].findIndex(t=>t.id===taskId);
    if(idx>-1) project.columns[c].splice(idx,1);
  });
  await persist();
  debouncedRender(); // Use debounced rendering here too
}

// --- Notes removed ---
function renderNotes(){}

// --- Add Project ---
// Guard: Sidebar projects UI removed; only bind if button exists
const addProjectBtn = document.getElementById('addProjectBtn');
if(addProjectBtn){
  addProjectBtn.addEventListener('click', async ()=>{
    const name = prompt('Project name');
    if(!name) return;
    state.projects.push({ id: uid(), name, columns: { todo:[], doing:[], done:[] } });
    state.currentProjectId = state.projects[state.projects.length-1].id;
    await persist(); render();
  });
}

// --- Quick add task ---
document.getElementById('newTaskInput').addEventListener('keydown', async (e)=>{
  if(e.key==='Enter'){
    const title = e.target.value?.trim?.() ?? String(e.target.value||'').trim();
    if(!title) return;
    await addTask(title);
    e.target.value = '';
  }
});

// Ensure New Task button opens modal - ROBUST handling for complex Uiverse button
function setupNewTaskButton(){
  const newTaskBtn = document.getElementById('newTaskBtn');
  if(!newTaskBtn) return;

  // Force button to be clickable
  newTaskBtn.style.pointerEvents = 'auto';
  newTaskBtn.style.cursor = 'pointer';

  // Multiple event types for maximum compatibility
  ['click', 'mousedown', 'touchstart'].forEach(eventType => {
    newTaskBtn.addEventListener(eventType, (e)=>{
      e.preventDefault();
      e.stopPropagation();
      console.log(`NewTaskBtn ${eventType} triggered`);
      if(eventType === 'click' || eventType === 'mousedown'){
        openTaskModal();
      }
    }, true); // Use capture phase
  });
}

// Auto-updater listeners
function setupUpdateListeners() {
  if (!window.focusflow) return;

  // Update available
  window.focusflow.onUpdateAvailable((info) => {
    console.log('📦 Update available:', info.version);
    document.getElementById('updateVersion').textContent = info.version;
    openModalById('updateModal');
  });

  // Update progress
  window.focusflow.onUpdateProgress((progress) => {
    console.log('📥 Download progress:', progress.percent + '%');
    const progressEl = document.getElementById('updateProgress');
    const fillEl = document.getElementById('progressFill');
    const textEl = document.getElementById('progressText');

    if (progressEl && fillEl && textEl) {
      progressEl.style.display = 'block';
      fillEl.style.width = progress.percent + '%';
      textEl.textContent = `Download läuft... ${Math.round(progress.percent)}%`;
    }
  });

  // Update downloaded
  window.focusflow.onUpdateDownloaded((info) => {
    console.log('✅ Update downloaded, ready to install');
    const buttonEl = document.getElementById('updateButton');
    const textEl = document.getElementById('progressText');

    if (buttonEl && textEl) {
      buttonEl.textContent = '🚀 Jetzt neu starten';
      buttonEl.onclick = () => window.focusflow.installUpdate();
      textEl.textContent = 'Update bereit zum Installieren!';
    }
  });
}

// Update modal functions
function closeUpdateModal() {
  closeModalById('updateModal');
}

function startUpdate() {
  console.log('🚀 Starting update download...');
  const buttonEl = document.getElementById('updateButton');
  if (buttonEl) {
    buttonEl.textContent = '📥 Download läuft...';
    buttonEl.disabled = true;
  }
  // The download starts automatically when update is available
}

// Initialize after DOM loads
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => {
    setupUpdateListeners();
    setupNewTaskButton();
  });
} else {
  setupUpdateListeners();
  setupNewTaskButton();
}

// Universal fallback for any click within button area
document.addEventListener('click', (e)=>{
  if(e.target.closest('#newTaskBtn')){
    console.log('Universal fallback triggered for newTaskBtn');
    openTaskModal();
  }
  if(e.target.closest('#quickNotesIcon')){
    console.log('Universal fallback triggered for quickNotesIcon');
    openQuickNotesPopup();
  }
}, true);

// Keyboard shortcuts
window.addEventListener('keydown', (e)=>{
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='f'){ e.preventDefault(); $('#search').focus(); }
});

window.focusflow.onNewTask(()=> openTaskModal());
window.focusflow.onQuickCapture(async ()=>{
  const text = prompt('Quick capture');
  if(text) await addTask(text);
});

async function addTask(title){
  const project = findProject(state, state.currentProjectId);
  const task = { id: uid(), title, notes:'', status:'todo', createdAt: Date.now() };
  project.columns.todo.push(task);
  await persist(); renderBoard(); renderTimerTaskSelect();
}

// --- Task modal ---
let editingId = null;
function openTaskModal(task){
  editingId = task?.id || null;
  document.getElementById('modalTitle').textContent = editingId ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
  document.getElementById('taskTitle').value = task?.title || '';
  document.getElementById('taskNotes').value = task?.notes || '';
  openModalById('modal');
  document.getElementById('taskTitle').focus();
}
document.getElementById('cancelTask').onclick = ()=> closeModalById('modal');

// Generic modal helpers with open/close animation and backdrop click-to-close
function openModalById(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  modal.classList.remove('hidden');
  // allow click on backdrop to close
  if(!modal.__outsideBound){
    modal.addEventListener('mousedown', (e)=>{
      if(e.target === modal) closeModalById(id);
    });
    modal.__outsideBound = true;
  }
}
function closeModalById(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  // play closing animation
  modal.classList.add('closing');
  const onDone = ()=>{ modal.classList.add('hidden'); modal.classList.remove('closing'); modal.removeEventListener('animationend', onDone); };
  modal.addEventListener('animationend', onDone);
  // Fallback timeout
  setTimeout(onDone, 320);
}
document.getElementById('saveTask').onclick = async ()=>{
  const title = $('#taskTitle').value.trim();
  const notes = $('#taskNotes').value.trim();
  if(!title){ alert('Bitte einen Titel eingeben'); return; }
  const project = findProject(state, state.currentProjectId);
  if(editingId){
    const task = allTasks(project).find(t=>t.id===editingId);
    if(task){ task.title = title; task.notes = notes; }
  } else {
    project.columns.todo.push({ id: uid(), title, notes, status:'todo', createdAt: Date.now() });
  }
  await persist(); render();
  closeModalById('modal');
}

// Info modal
const infoBtn = document.getElementById('infoBtn');
const aboutModal = document.getElementById('aboutModal');
const closeAbout = document.getElementById('closeAbout');
if(infoBtn && aboutModal){ infoBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); openModalById('aboutModal'); }); }
if(closeAbout){ closeAbout.addEventListener('click', ()=> closeModalById('aboutModal')); }

// --- Search filter ---
$('#search').addEventListener('input', (e)=>{
  const q = e.target.value.toLowerCase();
  $$('.card').forEach(card =>{
    const title = card.querySelector('.card-title').textContent.toLowerCase();
    const notes = (card.querySelector('.card-notes')?.textContent || '').toLowerCase();
    card.style.display = (title.includes(q) || notes.includes(q)) ? '' : 'none';
  });
});

// --- Timers ---
let countdownInterval = null;
let countdownRemaining = 25 * 60; // seconds
let originalCountdownTime = 25 * 60; // Original time to reset to
let stopwatchInterval = null;
let stopwatchElapsed = 0; // seconds
let activeTimerTaskId = null;
let isPaused = false; // Track pause state
let pendingSessionDurationSec = 0; // For session complete modal confirmation

function renderTimerTaskSelect(){
  const select = document.getElementById('timerTaskSelect');
  const project = findProject(state, state.currentProjectId);
  const tasks = allTasks(project);
  select.innerHTML = `<option value="">— Keine Aufgabe verknüpft —</option>` + tasks.map(t=>`<option value="${t.id}">${escapeHTML(t.title)}</option>`).join('');
  if(activeTimerTaskId) select.value = activeTimerTaskId;
}

function formatMMSS(sec){
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
function formatHHMMSS(sec){
  const h = Math.floor(sec/3600).toString().padStart(2,'0');
  const m = Math.floor((sec%3600)/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function updateTimePoolDisplay(){
  const el = document.getElementById('timePoolTotal');
  if(el){
    const t = state.timePoolSec||0;
    const formatted = formatHHMMSS(t);
    el.textContent = formatted;
    console.log('📊 Time pool display updated:', formatted, '(', t, 'seconds)');
  } else {
    console.log('❌ Time pool element not found');
  }
}

function updateCountdownDisplay(){
  const el = $('#countdownDisplay');
  if(el) el.textContent = formatMMSS(countdownRemaining);
}
function updateStopwatchDisplay(){
  const el = $('#stopwatchDisplay');
  if(el) el.textContent = formatHHMMSS(stopwatchElapsed);
}

function emitTimerUpdate(mode){
  const label = mode==='countdown' ? 'Fokus' : 'Stoppuhr';
  window.focusflow.pushTimerUpdate({
    mode,
    remaining: countdownRemaining,
    elapsed: stopwatchElapsed,
    label,
    taskId: activeTimerTaskId || null,
    isPaused: isPaused
  });
}

function setTimerRunningUI(running){
  const startBtn = document.getElementById('startCountdown');
  if(!startBtn) return;
  if(running){
    startBtn.textContent = 'Pause';
    startBtn.classList.add('danger');
  } else {
    startBtn.textContent = 'Starten';
    startBtn.classList.remove('danger');
  }
}

$('#startCountdown').onclick = async ()=>{
  // custom minutes input removed; keep current countdownRemaining
  console.log('▶️ [RENDERER] Starting timer with countdownRemaining:', countdownRemaining);
  console.log('▶️ [RENDERER] Current originalCountdownTime:', originalCountdownTime);

  // If paused and countdown not running, treat as resume
  if(isPaused && !countdownInterval && countdownRemaining > 0){
    console.log('▶️ [RENDERER] Resume via Start button');
    const taskId = activeTimerTaskId;
    const startedAt = Date.now();
    try{ window.focusflow.minimizeApp(); window.focusflow.toggleFocusOverlay(true); }catch{}
    countdownInterval = setInterval(async ()=>{
      countdownRemaining -= 1;
      updateCountdownDisplay();
      emitTimerUpdate('countdown');
      if(countdownRemaining<=0){
        clearInterval(countdownInterval); countdownInterval = null; countdownRemaining = 0; updateCountdownDisplay();
        await recordSession({ label: 'Fokus', taskId, startedAt, endedAt: Date.now() });
        notify('Zeit abgelaufen!', 'Fokus-Block beendet.');
        emitTimerUpdate('idle');
        try{ window.focusflow.showAppFront(); }catch{}
        try{ const dur = Math.max(0, Math.round((Date.now()-startedAt)/1000)); pendingSessionDurationSec = dur; showSessionCompleteModal({ mode:'countdown', durationSec: dur }); }catch{}
        setTimerRunningUI(false);
      }
    }, 1000);
    isPaused = false;
    emitTimerUpdate('countdown');
    setTimerRunningUI(true);
    return;
  }

  // Make sure originalCountdownTime is set when starting timer
  if(!originalCountdownTime || originalCountdownTime === 0) {
    originalCountdownTime = countdownRemaining;
    console.log('▶️ [RENDERER] Set originalCountdownTime to:', originalCountdownTime);
  }

  if(!countdownInterval){
    // Minimize main window and show overlay when starting
    try{ await window.focusflow.setState(state); }catch{}
    try{ window.focusflow.minimizeApp(); window.focusflow.toggleFocusOverlay(true); /* keep panel collapsed by default */ }catch{}
    const taskId = $('#timerTaskSelect').value || null;
    activeTimerTaskId = taskId;
    const startedAt = Date.now();
    countdownInterval = setInterval(async ()=>{
      countdownRemaining -= 1;
      updateCountdownDisplay();
      emitTimerUpdate('countdown');
      if(countdownRemaining<=0){
        clearInterval(countdownInterval); countdownInterval = null; countdownRemaining = 0; updateCountdownDisplay();
        await recordSession({ label: 'Fokus', taskId, startedAt, endedAt: Date.now() });
        notify('Zeit abgelaufen!', 'Fokus-Block beendet.');
        emitTimerUpdate('idle');
        // Bring app to front when timer completes and show celebration modal
        try{ window.focusflow.showAppFront(); }catch{}
        try{ const dur = Math.max(0, Math.round((Date.now()-startedAt)/1000)); pendingSessionDurationSec = dur; showSessionCompleteModal({ mode:'countdown', durationSec: dur }); }catch{}
        setTimerRunningUI(false);
      }
    }, 1000);
    emitTimerUpdate('countdown');
    setTimerRunningUI(true);
  } else {
    // Stop if running
    clearInterval(countdownInterval); countdownInterval = null; emitTimerUpdate('idle'); setTimerRunningUI(false);
  }
};
// Pause button removed per requirements
$('#resetCountdown').onclick = ()=>{
  console.log('🔄 [RENDERER] Local reset button clicked');
  console.log('🔄 [RENDERER] originalCountdownTime:', originalCountdownTime);
  console.log('🔄 [RENDERER] countdownRemaining before reset:', countdownRemaining);
  clearInterval(countdownInterval);
  countdownInterval=null;
  countdownRemaining = originalCountdownTime;
  isPaused = true; // ensure overlay shows Play to resume
  console.log('🔄 [RENDERER] countdownRemaining after reset:', countdownRemaining);
  updateCountdownDisplay();
  emitTimerUpdate('countdown');
};

// Inline-edit timer by typing mm:ss into the display
const countdownDisplayEl = document.getElementById('countdownDisplay');
countdownDisplayEl.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    e.preventDefault(); countdownDisplayEl.blur();
  }
});
countdownDisplayEl.addEventListener('blur', ()=>{
  const raw = countdownDisplayEl.textContent.trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if(!match){ updateCountdownDisplay(); return; }
  const minutes = parseInt(match[1],10);
  const seconds = parseInt(match[2],10);
  if(Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60){
    countdownRemaining = minutes*60 + seconds;
    originalCountdownTime = countdownRemaining; // Remember the new time
    updateCountdownDisplay(); emitTimerUpdate('idle');
  } else {
    updateCountdownDisplay();
  }
});

const startStopwatchBtn = $('#startStopwatch');
if(startStopwatchBtn) {
  startStopwatchBtn.onclick = async ()=>{
    if(!stopwatchInterval){
      const taskId = $('#timerTaskSelect').value || null;
      try{ await window.focusflow.setState(state); }catch{}
      try{ window.focusflow.toggleFocusOverlay(true); window.focusflow.overlayTogglePanel(true); }catch{}
      activeTimerTaskId = taskId;
      const startedAt = Date.now();
      stopwatchInterval = setInterval(()=>{ stopwatchElapsed += 1; updateStopwatchDisplay(); emitTimerUpdate('stopwatch'); }, 1000);
      const pauseStopwatchBtn = $('#pauseStopwatch');
      if(pauseStopwatchBtn) {
        pauseStopwatchBtn.onclick = async ()=>{
          if(stopwatchInterval){ clearInterval(stopwatchInterval); stopwatchInterval=null; }
          const endedAt = Date.now();
          await recordSession({ label:'Stopwatch', taskId, startedAt, endedAt });
          emitTimerUpdate('idle');
          try{ window.focusflow.showAppFront(); }catch{}
          try{ const dur = Math.max(0, Math.round((endedAt-startedAt)/1000)); pendingSessionDurationSec = dur; showSessionCompleteModal({ mode:'stopwatch', durationSec: dur }); }catch{}
        };
      }
      emitTimerUpdate('stopwatch');
    }
  };
}
const resetStopwatchBtn = $('#resetStopwatch');
if(resetStopwatchBtn) {
  resetStopwatchBtn.onclick = ()=>{ if(stopwatchInterval){ clearInterval(stopwatchInterval); stopwatchInterval=null; } stopwatchElapsed = 0; updateStopwatchDisplay(); emitTimerUpdate('idle'); };
}

// Confirm current timer/session and add to time pool
async function confirmCurrentTimer(){
  const now = Date.now();
  const projectId = state.currentProjectId;
  const taskId = activeTimerTaskId || null;

  // Determine elapsed for countdown or stopwatch
  let elapsedSec = 0;

  // Countdown: compute by original - remaining, regardless of paused state
  if(typeof originalCountdownTime === 'number' && originalCountdownTime > 0){
    const candidate = Math.max(0, (originalCountdownTime || 0) - (countdownRemaining || 0));
    if(candidate > 0) elapsedSec = candidate;
  }

  // Stopwatch fallback or if stopwatch was active
  if(stopwatchInterval || (!elapsedSec && stopwatchElapsed > 0)){
    elapsedSec = Math.max(elapsedSec, stopwatchElapsed);
  }

  // Clear any running intervals
  if(countdownInterval){ clearInterval(countdownInterval); countdownInterval = null; }
  if(stopwatchInterval){ clearInterval(stopwatchInterval); stopwatchInterval = null; }

  // Update time pool
  console.log('⏱️  Confirm current timer - adding', elapsedSec, 'seconds to time pool');
  console.log('⏱️  Previous time pool:', state.timePoolSec || 0);
  state.timePoolSec = (state.timePoolSec||0) + (elapsedSec||0);
  console.log('⏱️  New time pool total:', state.timePoolSec);

  // Persist a snapshot for analytics
  if(elapsedSec > 0){
    const session = {
      id: uid(), label: 'Confirmed', taskId, projectId,
      startISO: new Date(now - (elapsedSec*1000)).toISOString(),
      endISO: new Date(now).toISOString(),
      durationSec: elapsedSec
    };
    state.timerSessions.push(session);
  }

  // Reset live timers display (keep customMinutes or default 25)
  countdownRemaining = (parseInt(document.getElementById('customMinutes')?.value,10)||25)*60;
  originalCountdownTime = countdownRemaining;
  updateCountdownDisplay();
  stopwatchElapsed = 0; updateStopwatchDisplay();
  activeTimerTaskId = null;
  isPaused = true; // after confirming, show Play to resume
  setTimerRunningUI(false); // ensure main UI shows not running state
  emitTimerUpdate('countdown');
  await persist();
  updateTimePoolDisplay();
}

// Confirm button: add current elapsed to time pool and record session snapshot
const confirmBtn = document.getElementById('confirmTime');
if(confirmBtn){
  confirmBtn.addEventListener('click', async ()=>{
    await confirmCurrentTimer();
  });
}

function startCountdownForTask(taskId){
  $('#timerTaskSelect').value = taskId; activeTimerTaskId = taskId;
  countdownRemaining = 25*60;
  originalCountdownTime = countdownRemaining; // Remember the time
  $('#startCountdown').click();
}

async function recordSession({ label, taskId, startedAt, endedAt }){
  const session = {
    id: uid(), label, taskId, projectId: state.currentProjectId,
    startISO: new Date(startedAt).toISOString(),
    endISO: new Date(endedAt).toISOString(),
    durationSec: Math.max(0, Math.round((endedAt - startedAt)/1000))
  };
  state.timerSessions.push(session);
  // accumulate done time into task
  if(taskId){
    const project = findProject(state, state.currentProjectId);
    const all = allTasks(project);
    const t = all.find(x=>x.id===taskId);
    if(t){ t.doneSec = (t.doneSec||0) + session.durationSec; }
  }
  await persist();
}

function renderTodaySummary(){
  const today = new Date();
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d1 = d0 + 24*3600*1000;
  const sessions = state.timerSessions.filter(s=>{
    const t = Date.parse(s.startISO);
    return t>=d0 && t<d1;
  });
  const total = sessions.reduce((a,s)=>a+s.durationSec,0);
  $('#todaySummary').innerHTML = sessions.length===0
    ? 'No sessions yet.'
    : `${sessions.length} session(s), total ${formatHHMMSS(total)} today.`;
}

function notify(title, body){
  try {
    // In renderer, HTML5 Notification
    new Notification(title, { body });
  } catch {}
  window.focusflow.notify({ title, body });
}

// --- Utilities ---
function escapeHTML(str){ return str.replace(/[&<>'"]/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c])); }
function debounce(fn, ms=300){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
const debouncePersist = debounce(()=>persist(), 400);

// Initialize
updateCountdownDisplay();
updateStopwatchDisplay();
load();
emitTimerUpdate('idle');
updateTimePoolDisplay();

// Spotlight effect removed per request

// Background animation removed

// Toggle full focus overlay
const toggleOverlayBtn = document.getElementById('toggleOverlay');
if(toggleOverlayBtn) {
  toggleOverlayBtn.addEventListener('click', async ()=>{
    const isActive = document.body.dataset.overlay === 'on';
    const next = !isActive;
    await window.focusflow.toggleFocusOverlay(next);
    document.body.dataset.overlay = next ? 'on' : 'off';
  });
}

// Schnellnotizen Popup functionality
function openQuickNotesPopup() {
  const modal = document.getElementById('quickNotesModal');
  if (modal) {
    openModalById('quickNotesModal');
    renderMainQuickNotes();

    // Bind close button when modal opens
    const closeBtn = document.getElementById('closeQuickNotes');
    if (closeBtn) {
      // Remove existing listeners to prevent duplicates
      closeBtn.replaceWith(closeBtn.cloneNode(true));
      const newCloseBtn = document.getElementById('closeQuickNotes');
      newCloseBtn.addEventListener('click', closeQuickNotesPopup);
      console.log('[Main] Close button bound successfully');
    } else {
      console.warn('[Main] Close button not found');
    }

    // Bind create new note button
    const createBtn = document.getElementById('createNewNote');
    if (createBtn) {
      createBtn.replaceWith(createBtn.cloneNode(true));
      const newCreateBtn = document.getElementById('createNewNote');
      newCreateBtn.addEventListener('click', createNewNoteFromMain);
      console.log('[Main] Create note button bound successfully');
    }

    // Clear input fields when opening
    const titleInput = document.getElementById('newNoteTitle');
    const contentInput = document.getElementById('newNoteContent');
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';

    // Add Enter key handler for quick creation
    if (contentInput) {
      contentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          createNewNoteFromMain();
        }
      });
    }
  }
}

function closeQuickNotesPopup() {
  const modal = document.getElementById('quickNotesModal');
  if (modal) {
    closeModalById('quickNotesModal');
  }
}

// Function to create new note from main app
async function createNewNoteFromMain() {
  try {
    const titleInput = document.getElementById('newNoteTitle');
    const contentInput = document.getElementById('newNoteContent');

    if (!titleInput || !contentInput) return;

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title && !content) {
      alert('Bitte geben Sie mindestens einen Titel oder Inhalt ein.');
      return;
    }

    const currentState = await window.focusflow.getState();
    const quickNotes = Array.isArray(currentState?.quickNotes) ? currentState.quickNotes : [];

    // Create new note
    const newNote = {
      id: Date.now().toString(),
      name: title || 'Unbenannte Notiz',
      text: content,
      timestamp: new Date().toISOString()
    };

    // Add to beginning of array (newest first)
    quickNotes.unshift(newNote);

    // Save updated state
    const updatedState = { ...currentState, quickNotes };
    await window.focusflow.setState(updatedState);

    // Clear input fields
    titleInput.value = '';
    contentInput.value = '';

    // Re-render the list
    renderMainQuickNotes();

    console.log('[Main] New note created:', newNote);
  } catch (error) {
    console.error('[Main] Error creating new note:', error);
    alert('Fehler beim Erstellen der Notiz. Bitte versuchen Sie es erneut.');
  }
}

async function renderMainQuickNotes() {
  try {
    const currentState = await window.focusflow.getState();
    const quickNotes = Array.isArray(currentState?.quickNotes) ? currentState.quickNotes : [];

    const list = document.getElementById('mainQuickNotesList');
    if (!list) return;

    if (quickNotes.length === 0) {
      list.innerHTML = '<div class="empty-state">Keine Schnellnotizen vorhanden<br/>Erstellen Sie eine neue Notiz oben!</div>';
      return;
    }

    list.innerHTML = '';
    quickNotes.forEach((note, index) => {
      const item = document.createElement('div');
      item.className = 'quick-note-item';
      item.dataset.noteId = note.id; // Add data attribute for easier finding
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '8px';
      item.style.padding = '12px';
      item.style.marginBottom = '8px';
      item.style.borderRadius = '6px';
      item.style.border = '1px solid #e0e0e0';

            // Create content div
      const contentDiv = document.createElement('div');
      contentDiv.style.flex = '1';
      contentDiv.innerHTML =
        '<div class="quick-note-name" style="font-weight: 600; margin-bottom: 4px;">' + (note.name || 'Unbenannte Notiz') + '</div>' +
        '<div class="quick-note-text" style="color: #666; font-size: 13px;">' + (note.text || '').replace(/</g, '&lt;').replace(/\n/g, ' ').substring(0, 100) + (note.text && note.text.length > 100 ? '...' : '') + '</div>';

      // Create edit button
      const editBtn = document.createElement('button');
      editBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      editBtn.style.cssText = 'background: #4ecdc4; color: white; border: none; border-radius: 4px; margin-right: 8px; width: 32px; height: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
      editBtn.title = 'Bearbeiten';
      editBtn.onmouseenter = () => editBtn.style.background = '#45b7aa';
      editBtn.onmouseleave = () => editBtn.style.background = '#4ecdc4';
      editBtn.onclick = function() {
        try {
          console.log('Edit button clicked for note:', note.id);

          // Close quick notes modal
          const quickNotesModal = document.getElementById('quickNotesModal');
          if (quickNotesModal) {
            quickNotesModal.classList.add('hidden');
          }

          // Open editor modal directly
          const editorModal = document.getElementById('quickNoteEditorModal');
          const nameInput = document.getElementById('noteEditorName');
          const contentDiv = document.getElementById('noteEditorContent');

                    if (editorModal && nameInput && contentDiv) {
            nameInput.value = note.name || '';
            contentDiv.innerHTML = (note.text || '').replace(/\n/g, '<br>');
            editorModal.classList.remove('hidden');

                        // Set current editing note
            window.currentEditingNoteId = note.id;

            // Bind formatting buttons
            setTimeout(() => {
              const boldBtn = document.getElementById('formatBold');
              const italicBtn = document.getElementById('formatItalic');
              const underlineBtn = document.getElementById('formatUnderline');
              const strikeBtn = document.getElementById('formatStrike');

                                          // Function to update button states
              function updateFormatButtons() {
                if (boldBtn) {
                  const isBold = document.queryCommandState('bold');
                  boldBtn.style.backgroundColor = isBold ? '#4f8cff' : 'white';
                  boldBtn.style.color = isBold ? 'white' : '#333';
                  boldBtn.style.border = isBold ? '1px solid #4f8cff' : '1px solid #ddd';
                }

                if (italicBtn) {
                  const isItalic = document.queryCommandState('italic');
                  italicBtn.style.backgroundColor = isItalic ? '#4f8cff' : 'white';
                  italicBtn.style.color = isItalic ? 'white' : '#333';
                  italicBtn.style.border = isItalic ? '1px solid #4f8cff' : '1px solid #ddd';
                }

                if (underlineBtn) {
                  const isUnderline = document.queryCommandState('underline');
                  underlineBtn.style.backgroundColor = isUnderline ? '#4f8cff' : 'white';
                  underlineBtn.style.color = isUnderline ? 'white' : '#333';
                  underlineBtn.style.border = isUnderline ? '1px solid #4f8cff' : '1px solid #ddd';
                }

                if (strikeBtn) {
                  const isStrike = document.queryCommandState('strikeThrough');
                  strikeBtn.style.backgroundColor = isStrike ? '#4f8cff' : 'white';
                  strikeBtn.style.color = isStrike ? 'white' : '#333';
                  strikeBtn.style.border = isStrike ? '1px solid #4f8cff' : '1px solid #ddd';
                }
              }

              if (boldBtn) {
                boldBtn.onclick = () => {
                  document.execCommand('bold', false, null);
                  updateFormatButtons();
                  contentDiv.focus();
                };
              }

              if (italicBtn) {
                italicBtn.onclick = () => {
                  document.execCommand('italic', false, null);
                  updateFormatButtons();
                  contentDiv.focus();
                };
              }

              if (underlineBtn) {
                underlineBtn.onclick = () => {
                  document.execCommand('underline', false, null);
                  updateFormatButtons();
                  contentDiv.focus();
                };
              }

              if (strikeBtn) {
                strikeBtn.onclick = () => {
                  document.execCommand('strikeThrough', false, null);
                  updateFormatButtons();
                  contentDiv.focus();
                };
              }

              // Update button states when cursor moves or selection changes
              contentDiv.addEventListener('keyup', updateFormatButtons);
              contentDiv.addEventListener('mouseup', updateFormatButtons);
              contentDiv.addEventListener('selectionchange', updateFormatButtons);

              // Initial button state update
              setTimeout(updateFormatButtons, 100);

              // Bind save/cancel/delete buttons
              const saveBtn = document.getElementById('saveNoteEdit');
              const cancelBtn = document.getElementById('cancelNoteEdit');
              const deleteBtn = document.getElementById('deleteNote');

              if (saveBtn) {
                saveBtn.onclick = () => {
                  const nameInput = document.getElementById('noteEditorName');
                  const contentDiv = document.getElementById('noteEditorContent');

                  if (nameInput && contentDiv && window.currentEditingNoteId) {
                    const newName = nameInput.value.trim();
                    const newText = contentDiv.innerHTML.replace(/<div>/g, '\n').replace(/<\/div>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();

                    window.focusflow.getState().then(state => {
                      if (!state?.quickNotes) return;

                      const noteIndex = state.quickNotes.findIndex(n => n.id === window.currentEditingNoteId);
                      if (noteIndex !== -1) {
                        state.quickNotes[noteIndex].name = newName;
                        state.quickNotes[noteIndex].text = newText;

                        window.focusflow.setState(state).then(() => {
                          closeNoteEditor(true); // Return to quick notes modal
                        });
                      }
                    });
                  }
                };
              }

              if (cancelBtn) {
                cancelBtn.onclick = () => {
                  closeNoteEditor(true); // Return to quick notes modal
                };
              }

              if (deleteBtn) {
                deleteBtn.onclick = () => {
                  if (window.currentEditingNoteId && confirm('Notiz wirklich löschen?')) {
                    window.focusflow.getState().then(state => {
                      if (!state?.quickNotes) return;

                      state.quickNotes = state.quickNotes.filter(n => n.id !== window.currentEditingNoteId);

                                              window.focusflow.setState(state).then(() => {
                          closeNoteEditor(true); // Return to quick notes modal
                        });
                    });
                  }
                };
              }

              // Focus the content area
              contentDiv.focus();
            }, 150);
          } else {
            console.error('Editor elements not found!');
          }
        } catch (err) {
          alert('ERROR: ' + err.message);
        }
      };

      // Create delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = '×';
      deleteBtn.style.cssText = 'background: #dc3545; color: white; border: none; border-radius: 4px; width: 32px; height: 32px; cursor: pointer; font-size: 16px;';
      deleteBtn.title = 'Löschen';
      deleteBtn.onclick = function() {
        window.deleteNote(note.id);
      };

      // Append all elements
      item.appendChild(contentDiv);
      item.appendChild(editBtn);
      item.appendChild(deleteBtn);

      list.appendChild(item);
    });
  } catch (err) {
    console.error('Error rendering main quick notes:', err);
  }
}

async function deleteMainQuickNote(noteId) {
  try {
    const currentState = await window.focusflow.getState();
    if (!currentState || !Array.isArray(currentState.quickNotes)) return;

    currentState.quickNotes = currentState.quickNotes.filter(note => note.id !== noteId);
    await window.focusflow.setState(currentState);

    console.log('Main quick note deleted:', noteId);
    renderMainQuickNotes();
  } catch (err) {
    console.error('Error deleting main quick note:', err);
  }
}

let currentEditingNoteId = null;

// Note Editor Functions
function openNoteEditor(noteId) {
  console.log('Opening note editor for:', noteId);
  currentEditingNoteId = noteId;

  window.focusflow.getState().then(state => {
    const note = state?.quickNotes?.find(n => n.id === noteId);
    console.log('Found note:', note);

    if (!note) {
      console.error('Note not found:', noteId);
      alert('Fehler: Notiz nicht gefunden!');
      return;
    }

    const modal = document.getElementById('quickNoteEditorModal');
    const nameInput = document.getElementById('noteEditorName');
    const contentDiv = document.getElementById('noteEditorContent');

    console.log('Modal elements:', { modal: !!modal, nameInput: !!nameInput, contentDiv: !!contentDiv });

    if (!modal) {
      console.error('quickNoteEditorModal not found in DOM');
      alert('Fehler: Editor-Modal nicht gefunden!');
      return;
    }

    if (!nameInput || !contentDiv) {
      console.error('Editor inputs not found:', { nameInput: !!nameInput, contentDiv: !!contentDiv });
      alert('Fehler: Editor-Elemente nicht gefunden!');
      return;
    }

    // Close quick notes modal first
    const quickNotesModal = document.getElementById('quickNotesModal');
    if (quickNotesModal) {
      quickNotesModal.classList.add('hidden');
    }

    // Set values
    nameInput.value = note.name || '';
    contentDiv.innerHTML = (note.text || '').replace(/\n/g, '<br>');

    // Show editor modal
    modal.classList.remove('hidden');
    console.log('Editor modal opened successfully');

    // Bind editor buttons
    bindEditorButtons();

    // Focus the content area
    setTimeout(() => {
      contentDiv.focus();
    }, 100);
  }).catch(err => {
    console.error('Error in openNoteEditor:', err);
    alert('Fehler beim Laden der Notiz: ' + err.message);
  });
}

function closeNoteEditor(shouldReturnToQuickNotes = true) {
  const modal = document.getElementById('quickNoteEditorModal');
  if (modal) {
    modal.classList.add('hidden');

    if (shouldReturnToQuickNotes) {
      // Return to quick notes modal and scroll to the edited note
      const editedNoteId = currentEditingNoteId;
      currentEditingNoteId = null;

      // Small delay to ensure editor is hidden first
      setTimeout(() => {
        openQuickNotesPopup();

        // Update the list and scroll to the edited note if we have an ID
        setTimeout(() => {
          renderMainQuickNotes().then(() => {
            if (editedNoteId) {
              scrollToNoteInList(editedNoteId);
            }
          });
        }, 100);
      }, 50);
    } else {
      currentEditingNoteId = null;
    }
  }
}

function scrollToNoteInList(noteId) {
  try {
    // Find the note item by data attribute
    const targetItem = document.querySelector(`[data-note-id="${noteId}"]`);

    if (targetItem) {
      targetItem.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      // Add a brief highlight effect
      targetItem.style.transition = 'background-color 0.3s ease';
      targetItem.style.backgroundColor = 'rgba(79, 140, 255, 0.1)';
      setTimeout(() => {
        targetItem.style.backgroundColor = '';
      }, 1000);

      console.log('Scrolled to note:', noteId);
    } else {
      console.log('Note not found for scrolling:', noteId);
    }
  } catch (error) {
    console.log('Could not scroll to note:', error);
  }
}

function saveNoteEdit() {
  if (!currentEditingNoteId) return;

  const nameInput = document.getElementById('noteEditorName');
  const contentDiv = document.getElementById('noteEditorContent');

  if (!nameInput || !contentDiv) return;

  const newName = nameInput.value.trim();
  // Get text content while preserving line breaks
  const newText = contentDiv.innerHTML.replace(/<div>/g, '\n').replace(/<\/div>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();

  window.focusflow.getState().then(state => {
    if (!state?.quickNotes) return;

    const noteIndex = state.quickNotes.findIndex(n => n.id === currentEditingNoteId);
    if (noteIndex === -1) return;

    state.quickNotes[noteIndex].name = newName;
    state.quickNotes[noteIndex].text = newText;

    window.focusflow.setState(state).then(() => {
      closeNoteEditor(true); // Return to quick notes modal
    });
  });
}

function deleteNoteFromEditor() {
  if (!currentEditingNoteId) return;

  if (confirm('Möchten Sie diese Notiz wirklich löschen?')) {
    deleteMainQuickNote(currentEditingNoteId);
    closeNoteEditor(true); // Return to quick notes modal after delete
  }
}

function bindEditorButtons() {
  // Remove existing listeners to prevent duplicates
  const buttons = ['formatBold', 'formatItalic', 'formatUnderline', 'formatStrike', 'saveNoteEdit', 'cancelNoteEdit', 'deleteNote'];
  buttons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
    }
  });

  // Format buttons
  document.getElementById('formatBold')?.addEventListener('click', () => {
    document.execCommand('bold', false, null);
    document.getElementById('noteEditorContent')?.focus();
  });
  document.getElementById('formatItalic')?.addEventListener('click', () => {
    document.execCommand('italic', false, null);
    document.getElementById('noteEditorContent')?.focus();
  });
  document.getElementById('formatUnderline')?.addEventListener('click', () => {
    document.execCommand('underline', false, null);
    document.getElementById('noteEditorContent')?.focus();
  });
  document.getElementById('formatStrike')?.addEventListener('click', () => {
    document.execCommand('strikeThrough', false, null);
    document.getElementById('noteEditorContent')?.focus();
  });

  // Action buttons
  document.getElementById('saveNoteEdit')?.addEventListener('click', saveNoteEdit);
  document.getElementById('cancelNoteEdit')?.addEventListener('click', closeNoteEditor);
  document.getElementById('deleteNote')?.addEventListener('click', deleteNoteFromEditor);
}

// Make functions global for onclick handlers
window.openQuickNotesPopup = openQuickNotesPopup;
window.closeQuickNotesPopup = closeQuickNotesPopup;
window.deleteMainQuickNote = deleteMainQuickNote;
window.createNewNoteFromMain = createNewNoteFromMain;

// Global functions for note editing
window.editNote = function(noteId) {
  console.log('Global editNote called for:', noteId);
  openNoteEditor(noteId);
};

window.deleteNote = function(noteId) {
  console.log('Global deleteNote called for:', noteId);
  deleteMainQuickNote(noteId);
};
window.openNoteEditor = openNoteEditor;
window.closeNoteEditor = closeNoteEditor;

// Add click handler to notes icon
try{
  const icon = document.getElementById('quickNotesIcon');
  if(icon){
    icon.style.pointerEvents = 'auto';
    icon.style.cursor = 'pointer';

    // Multiple event types for maximum compatibility
    ['click', 'mousedown', 'touchstart'].forEach(eventType => {
      icon.addEventListener(eventType, (e)=>{
        e.preventDefault();
        e.stopPropagation();
        console.log(`[Main] quickNotesIcon ${eventType} triggered`);
        if(eventType === 'click' || eventType === 'mousedown'){
          openQuickNotesPopup();
        }
      }, true); // Use capture phase
    });

    // Universal fallback for any click within icon area
    icon.addEventListener('click', (e)=>{
      console.log('[Main] Universal fallback triggered for quickNotesIcon');
      openQuickNotesPopup();
    }, true);

  } else {
    console.warn('[Main] quickNotesIcon not found');
  }
}catch(err){ console.warn('[Main] quickNotesIcon bind error', err); }

// removed link-open and scheduler

// Receive timer commands from overlay (pause/reset shortcuts) via preload API
console.log('🔧 [RENDERER] Setting up timer command listener via preload...');
console.log('🔧 [RENDERER] window.focusflow available:', !!window.focusflow);
console.log('🔧 [RENDERER] window.focusflow.onTimerCommand available:', !!(window.focusflow && window.focusflow.onTimerCommand));

if (window.focusflow && window.focusflow.onTimerCommand) {
    window.focusflow.onTimerCommand((cmd)=>{
      try { window.focusflow.notify({ type: 'timer-debug', where: 'renderer', cmd }); } catch {}
      console.log('🎯 [RENDERER] TIMER COMMAND RECEIVED:', cmd);
      console.log('🎯 [RENDERER] Current timer state:', {
        countdownInterval: !!countdownInterval,
        stopwatchInterval: !!stopwatchInterval,
        countdownRemaining,
        stopwatchElapsed
      });

            if(cmd==='pause'){
        console.log('⏸️ [RENDERER] Processing PAUSE command...');

                if(countdownInterval && !isPaused) {
          // Pause countdown
          console.log('⏹️ [RENDERER] Pausing countdown timer');
          clearInterval(countdownInterval);
          countdownInterval=null;
          isPaused = true;
          emitTimerUpdate('countdown'); // Keep showing as countdown with current time
          setTimerRunningUI(false);
          console.log('✅ [RENDERER] Timer paused at', countdownRemaining, 'seconds');
        } else if(!countdownInterval && isPaused && countdownRemaining > 0) {
          // Resume countdown
          console.log('▶️ [RENDERER] Resuming countdown timer');
          const taskId = activeTimerTaskId;
          const startedAt = Date.now();
          countdownInterval = setInterval(async ()=>{
            countdownRemaining -= 1;
            updateCountdownDisplay();
            emitTimerUpdate('countdown');
            if(countdownRemaining<=0){
              clearInterval(countdownInterval); countdownInterval = null; countdownRemaining = 0; updateCountdownDisplay();
              await recordSession({ label: 'Fokus', taskId, startedAt, endedAt: Date.now() });
              notify('Zeit abgelaufen!', 'Fokus-Block beendet.');
              emitTimerUpdate('idle');
              try{ window.focusflow.showAppFront(); }catch{}
              setTimerRunningUI(false);
              isPaused = false;
            }
          }, 1000);
          isPaused = false;
          emitTimerUpdate('countdown');
          setTimerRunningUI(true);
          console.log('✅ [RENDERER] Timer resumed');
                } else if(stopwatchInterval && !isPaused) {
          // Pause stopwatch
          console.log('⏹️ [RENDERER] Pausing stopwatch timer');
          clearInterval(stopwatchInterval);
          stopwatchInterval=null;
          isPaused = true;
          emitTimerUpdate('stopwatch'); // Keep showing as stopwatch with current time
          console.log('✅ [RENDERER] Stopwatch paused at', stopwatchElapsed, 'seconds');
        } else if(!stopwatchInterval && isPaused && stopwatchElapsed >= 0) {
          // Resume stopwatch
          console.log('▶️ [RENDERER] Resuming stopwatch timer');
          stopwatchInterval = setInterval(()=>{
            stopwatchElapsed += 1;
            updateStopwatchDisplay();
            emitTimerUpdate('stopwatch');
          }, 1000);
          isPaused = false;
          emitTimerUpdate('stopwatch');
          console.log('✅ [RENDERER] Stopwatch resumed');
        } else {
          console.log('⚠️ [RENDERER] No active timers to pause/resume');
        }
      }

      if(cmd==='reset'){
        console.log('🔄 [RENDERER] Processing RESET command...');
        console.log('🔄 [RENDERER] Current originalCountdownTime:', originalCountdownTime);
        console.log('🔄 [RENDERER] Current countdownRemaining:', countdownRemaining);

        // Clear any running intervals
        if(countdownInterval){ clearInterval(countdownInterval); countdownInterval=null; }
        if(stopwatchInterval){ clearInterval(stopwatchInterval); stopwatchInterval=null; }

        // Reset timers and state
        countdownRemaining = originalCountdownTime; // Reset to originally set time
        stopwatchElapsed = 0;
        isPaused = true; // show Play after reset

        console.log('🔄 [RENDERER] After reset - countdownRemaining:', countdownRemaining);

        // Update displays
        updateCountdownDisplay();
        updateStopwatchDisplay();

        emitTimerUpdate('countdown');
        setTimerRunningUI(false);
        console.log('✅ [RENDERER] RESET command completed successfully');
      }

      if(cmd==='confirm'){
        console.log('✅ [RENDERER] Processing CONFIRM command...');
        const confirmBtn = document.getElementById('confirmTime');
        if(confirmBtn){
          confirmBtn.click();
          console.log('✅ [RENDERER] Confirm button clicked successfully');
        } else {
          console.log('❌ [RENDERER] Confirm button not found');
        }
      }
    });
    console.log('✅ [RENDERER] Timer command listener (preload) successfully registered!');
} else {
    console.log('❌ [RENDERER] ERROR: window.focusflow.onTimerCommand not available');
    try { window.focusflow?.notify({ type: 'timer-debug', where: 'renderer', error: 'onTimerCommand missing' }); } catch {}
}

// Setup timer confirm listener
try {
  console.log('🔧 [RENDERER] Setting up timer confirm listener...');
  window.focusflow.onTimerConfirm(async ()=>{
    console.log('✅ [RENDERER] Timer confirm received');
    await confirmCurrentTimer();
    console.log('✅ [RENDERER] Timer confirm processed');
  });
  console.log('✅ [RENDERER] Timer confirm listener registered');
} catch (err) {
  console.error('❌ [RENDERER] Timer confirm listener error:', err);
}





// Receive task edit requests from overlay
try {
  console.log('Setting up overlay:edit-task listener...');
  window.focusflow.onTaskEditRequest((taskId) => {
    console.log('Renderer received edit task request from overlay:', taskId);
    console.log('Current state:', state);
    console.log('Current project ID:', state.currentProjectId);

    // Find the task and open edit modal
    const project = findProject(state, state.currentProjectId);
    console.log('Found project:', project);

    if(project) {
      const allTasks = [...project.columns.todo, ...project.columns.doing, ...project.columns.done];
      console.log('All tasks:', allTasks);
      const task = allTasks.find(t => t.id === taskId);
      console.log('Found task:', task);

      if(task) {
        console.log('Opening task modal for task:', task);
        openTaskModal(task);
        console.log('Task modal opened');
      } else {
        console.log('Task not found with ID:', taskId);
      }
    } else {
      console.log('Project not found');
    }
  });
} catch(e) {
  console.log('Error setting up edit task listener:', e);
}

// --- Analytics ---
(function initAnalytics(){
  const openBtn = document.getElementById('openAnalytics');
  const modal = document.getElementById('analyticsModal');
  const closeBtn = document.getElementById('closeAnalytics');
  const viewDay = document.getElementById('analyticsViewDay');
  const viewWeek = document.getElementById('analyticsViewWeek');
  const viewMonth = document.getElementById('analyticsViewMonth');
  const chart = document.getElementById('analyticsChart');
  const xAxis = document.getElementById('analyticsXAxis');
  const summary = document.getElementById('analyticsSummary');
  const detail = document.getElementById('analyticsDetail');
  const resetAnalyticsBtn = document.getElementById('resetAnalytics');

  if(!openBtn || !modal) return;

  let currentView = 'day'; // 'day' | 'week' | 'month'

  function open(){ openModalById('analyticsModal'); render(); }
  function close(){ closeModalById('analyticsModal'); }
  if(openBtn) openBtn.onclick = open;
  if(closeBtn) closeBtn.onclick = close;

  if(resetAnalyticsBtn){
    resetAnalyticsBtn.onclick = async ()=>{
      if(!confirm('Alle Analytics zurücksetzen? Dies löscht bestätigte Sitzungen und setzt den Zeitpool zurück.')) return;
      try{
        state.timerSessions = [];
        state.timePoolSec = 0;
        await persist();
        updateTimePoolDisplay();
        render();
      }catch(e){ console.error('Reset analytics failed:', e); }
    };
  }

  function setView(v){ currentView = v; [viewDay,viewWeek,viewMonth].forEach(b=>b&&b.classList.remove('primary')); const btn = v==='day'?viewDay:(v==='week'?viewWeek:viewMonth); if(btn) btn.classList.add('primary'); render(); }
  if(viewDay) viewDay.onclick = ()=>setView('day');
  if(viewWeek) viewWeek.onclick = ()=>setView('week');
  if(viewMonth) viewMonth.onclick = ()=>setView('month');

  function startOfDay(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function startOfWeek(ts){ const d=new Date(ts); const day=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return d.getTime(); }
  function startOfMonth(ts){ const d=new Date(ts); d.setHours(0,0,0,0); d.setDate(1); return d.getTime(); }
  function fmtDate(ts){ const d=new Date(ts); return d.toLocaleDateString(); }
  function fmtWeek(ts){ const d=new Date(ts); const d2=new Date(ts+6*86400000); return d.toLocaleDateString()+" – "+d2.toLocaleDateString(); }
  function fmtMonth(ts){ const d=new Date(ts); return d.toLocaleDateString(undefined,{ year:'numeric', month:'short' }); }

  function getSessions(){ return Array.isArray(state.timerSessions)? state.timerSessions.slice(): []; }

  function getTaskTitleById(taskId){
    if(!taskId) return null;
    try{
      const project = findProject(state, state.currentProjectId);
      const tasks = allTasks(project);
      const t = tasks.find(x=>x.id===taskId);
      return t ? t.title : null;
    }catch{ return null; }
  }

  function aggregate(){
    const sessions = getSessions();
    const map = new Map();
    for(const s of sessions){
      const startTs = Date.parse(s.startISO);
      if(!Number.isFinite(startTs)) continue;
      let bucket;
      if(currentView==='day') bucket = startOfDay(startTs);
      else if(currentView==='week') bucket = startOfWeek(startTs);
      else bucket = startOfMonth(startTs);
      const prev = map.get(bucket)||0;
      map.set(bucket, prev + (s.durationSec||0));
    }
    // sort by time
    const rows = Array.from(map.entries()).sort((a,b)=>a[0]-b[0]);
    return rows;
  }

  function render(){
    const rows = aggregate();
    chart.innerHTML = '';
    xAxis.innerHTML = '';
    detail.innerHTML = '<div class="summary">Details erscheinen beim Klick auf eine Säule.</div>';
    const total = rows.reduce((a,[,v])=>a+v,0);
    summary.textContent = `Gesamt: ${formatHHMMSS(total)}`;
    const max = Math.max(1, ...rows.map(([,v])=>v));
    for(const [bucket,value] of rows){
      const h = Math.max(8, Math.round((value/max)*200));
      const bar = document.createElement('div');
      bar.style.height = h+'px';
      bar.style.width = '20px';
      bar.style.borderRadius = '6px 6px 2px 2px';
      bar.style.background = 'linear-gradient(180deg, rgba(79,140,255,0.9), rgba(79,140,255,0.4))';
      bar.style.cursor = 'pointer';
      bar.title = formatHHMMSS(value);
      bar.addEventListener('click', ()=>renderDetail(bucket));
      chart.appendChild(bar);

      const label = document.createElement('div');
      label.style.width = '20px';
      label.style.textAlign = 'center';
      label.style.fontSize = '11px';
      label.style.transform = 'translateY(-2px)';
      label.textContent = currentView==='day' ? new Date(bucket).toLocaleDateString(undefined,{weekday:'short'}) : (currentView==='week' ? 'KW' : new Date(bucket).toLocaleDateString(undefined,{ month:'short' }));
      xAxis.appendChild(label);
    }
  }

  function renderDetail(bucket){
    const sessions = getSessions();
    let matcher;
    if(currentView==='day'){ const s = startOfDay(bucket); const e = s+86400000; matcher = (ts)=> ts>=s && ts<e; }
    else if(currentView==='week'){ const s = startOfWeek(bucket); const e = s+7*86400000; matcher = (ts)=> ts>=s && ts<e; }
    else { const s = startOfMonth(bucket); const m=new Date(s); const e=new Date(m.getFullYear(), m.getMonth()+1,1).getTime(); matcher = (ts)=> ts>=s && ts<e; }

    const items = sessions
      .map(s=>({ ...s, ts: Date.parse(s.startISO)||0 }))
      .filter(s=> matcher(s.ts))
      .sort((a,b)=>a.ts-b.ts);

    if(items.length===0){ detail.innerHTML = '<div class="summary">Keine Sessions in diesem Zeitraum.</div>'; return; }

    const list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gridTemplateColumns = 'auto 1fr auto';
    list.style.gap = '6px 10px';
    list.style.alignItems = 'center';

    let sum = 0;
    for(const s of items){
      sum += s.durationSec||0;
      const when = document.createElement('div'); when.style.fontSize='12px'; when.style.color='var(--muted,#777)'; when.textContent = new Date(s.ts).toLocaleString();
      const title = getTaskTitleById(s.taskId);
      const label = document.createElement('div'); label.textContent = s.label + (title? ` · ${title}` : (s.taskId? ` · ${s.taskId}` : ''));
      const dur = document.createElement('div'); dur.style.fontVariantNumeric='tabular-nums'; dur.textContent = formatHHMMSS(s.durationSec||0);
      list.appendChild(when); list.appendChild(label); list.appendChild(dur);
    }
    detail.innerHTML = '';
    const header = document.createElement('div'); header.className='summary'; header.textContent = `Summe: ${formatHHMMSS(sum)} in ${items.length} Session(s)`;
    detail.appendChild(header);
    detail.appendChild(list);
  }

  // update analytics when store changes
  try{ window.focusflow.onStoreUpdated(()=>{ if(!modal.classList.contains('hidden')) render(); }); }catch{}
})();
// --- end Analytics ---

function showSessionCompleteModal({ mode, durationSec }){
  const modal = document.getElementById('sessionCompleteModal');
  if(!modal) return;
  const timeEl = modal.querySelector('[data-session-time]');
  if(timeEl) timeEl.textContent = formatHHMMSS(durationSec||0);
  modal.classList.remove('hidden');
  // Start confetti overlay
  requestAnimationFrame(()=>{
    try{ runConfetti(); }catch{}
  });
}

function runConfetti(){
  // Remove any existing confetti canvas
  const existing = document.querySelector('.confetti-canvas');
  if(existing) existing.remove();

  // Find the modal and append canvas to it (so it's inside the modal, not affected by backdrop blur)
  const modal = document.getElementById('sessionCompleteModal');
  if(!modal) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  modal.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const resize = ()=>{
    const rect = modal.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const colors = ['#4f8cff', '#40c9ff', '#00dbde', '#93c5fd', '#60a5fa'];
  let pieces = Array.from({length: 120}).map(()=>spawnPiece());

  function spawnPiece(){
    const rect = modal.getBoundingClientRect();
    return {
      x: Math.random() * rect.width,
      y: -20 - Math.random() * 100,
      r: 2 + Math.random() * 4,
      s: 1 + Math.random() * 2.5,
      a: Math.random() * Math.PI * 2,
      c: colors[(Math.random() * colors.length) | 0]
    };
  }

  let rafId;
  function tick(){
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p, i) => {
      p.y += p.s;
      p.x += Math.sin(p.y / 20) * 0.6;
      p.a += 0.05;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
      ctx.restore();
      if(p.y > canvas.height + 40){
        pieces[i] = spawnPiece();
      }
    });
    rafId = requestAnimationFrame(tick);
  }
  tick();

  // Store cleanup function
  window.__stopConfetti = () => {
    if(rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    if(canvas.parentNode) canvas.remove();
    window.__stopConfetti = null;
  };
}

// Ensure cleanup when modal closes
const sessionModal = document.getElementById('sessionCompleteModal');
if(sessionModal){
  const cleanup = ()=>{
    if(window.__stopConfetti) window.__stopConfetti();
    const h = sessionModal.querySelector('.confetti-canvas-holder');
    if(h){ if(h.__stopConfetti) h.__stopConfetti(); h.innerHTML=''; }
  };
  sessionModal.addEventListener('animationend', ()=>{ if(sessionModal.classList.contains('hidden')) cleanup(); });
  // Also cleanup when manually hidden without animation end
  sessionModal.addEventListener('transitionend', ()=>{ if(sessionModal.classList.contains('hidden')) cleanup(); });
}

document.getElementById('sessionConfirmBtn')?.addEventListener('click', async ()=>{
  try{
    if(pendingSessionDurationSec && pendingSessionDurationSec > 0){
      console.log('🕒 Adding to time pool:', pendingSessionDurationSec, 'seconds');
      console.log('🕒 Previous time pool:', state.timePoolSec || 0);

      state.timePoolSec = (state.timePoolSec||0) + pendingSessionDurationSec;

      console.log('🕒 New time pool total:', state.timePoolSec);

      await persist();
      updateTimePoolDisplay();

      console.log('🕒 Time pool display updated, element shows:', document.getElementById('timePoolTotal')?.textContent);

      pendingSessionDurationSec = 0;
    } else {
      console.log('❌ No pending session duration to add');
    }
  }catch(e){
    console.log('❌ Error confirming session:', e);
  }
  closeModalById('sessionCompleteModal');
});

document.getElementById('sessionCancelBtn')?.addEventListener('click', ()=>{
  closeModalById('sessionCompleteModal');
});

// Remove duplicate listeners - handled above
