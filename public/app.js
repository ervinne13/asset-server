import { state } from './modules/state.js';
import { api } from './modules/api.js';
import { $, toast } from './modules/helpers.js';
import { navigate, urlToPath, silentRefresh } from './modules/router.js';
import { loadBookmarks } from './modules/bookmarks.js';
import { renderFiles } from './modules/files.js';

// Side-effect imports — each module wires its own event handlers
import './modules/mobile.js';
import './modules/preview.js';
import './modules/tags.js';
import './modules/prompt.js';
import './modules/generate.js';
import './modules/search.js';
import './modules/move.js';
import './modules/trash.js';
import './modules/keyboard.js';

// ── View toggle ───────────────────────────────────────────────────────────────

function setView(v) {
  state.view = v;
  if (state.currentPath) {
    state.folderViews[state.currentPath] = v;
    api.post('/api/folder-view', { path: state.currentPath, view: v }).catch(() => { });
    renderFiles(state.currentItems);
  }
}

$('btn-view-grid').addEventListener('click', () => setView('grid'));
$('btn-view-list').addEventListener('click', () => setView('list'));

// ── Quick nav ─────────────────────────────────────────────────────────────────

$('btn-staging').onclick = () => {
  if (state.config?.roots?.staging) navigate(state.config.roots.staging);
  else toast('Staging folder not configured in config.json', 'warning');
};

$('btn-library').onclick = () => {
  if (state.config?.roots?.library) navigate(state.config.roots.library);
};

// ── Index rebuild ─────────────────────────────────────────────────────────────

$('btn-rebuild-index').addEventListener('click', async () => {
  const btn = $('btn-rebuild-index');
  btn.loading = true;
  try {
    const result = await api.rebuildIndex();
    toast(`Index built — ${result.count.toLocaleString()} files`);
  } catch (err) {
    toast(`Index failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});

// ── Panel expand ──────────────────────────────────────────────────────────────

const PANEL_SIZES = [290, 480, 700];
let panelSizeIdx = Math.min(parseInt(localStorage.getItem('panelSizeIdx') || '0', 10), PANEL_SIZES.length - 1);

$('btn-expand-panel').addEventListener('click', () => {
  panelSizeIdx = (panelSizeIdx + 1) % PANEL_SIZES.length;
  document.documentElement.style.setProperty('--panel-right', PANEL_SIZES[panelSizeIdx] + 'px');
  localStorage.setItem('panelSizeIdx', panelSizeIdx);
});

// ── Staging auto-refresh ──────────────────────────────────────────────────────

setInterval(() => {
  const staging = state.config?.roots?.staging;
  if (!staging || !state.currentPath) return;
  if (state.currentPath === staging || state.currentPath.startsWith(staging + '/')) {
    silentRefresh();
  }
}, 5000);

window.addEventListener('popstate', e => {
  if (e.state?.path) navigate(e.state.path, { historyMode: 'none' });
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  try {
    state.config = await api.config();
  } catch {
    toast('Could not load config.json — copy config.example.json to config.json', 'danger');
    return;
  }

  state.folderViews = state.config.folderViews || {};
  await loadBookmarks();

  const fromUrl = urlToPath(location.pathname);
  const start = fromUrl || state.config.roots?.staging || state.config.roots?.library;
  if (start) navigate(start, { historyMode: 'replace' });
})();
