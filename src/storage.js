// Global functions for CommonJS compatibility
function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  const initialState = {
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
    scheduled: [] // {id, title, atISO}
  };

  function findProject(state, projectId) {
    return state.projects.find(p => p.id === projectId);
  }

  function allTasks(project) {
    return [ ...project.columns.todo, ...project.columns.doing, ...project.columns.done ];
  }
