import { state } from './modules/state.js';
import { api } from './modules/api.js';
import { $, toast } from './modules/helpers.js';
import { navigate, urlToPath, silentRefresh } from './modules/router.js';
import { loadBookmarks } from './modules/bookmarks.js';
import { renderFiles, sortItems } from './modules/files.js';

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
import './modules/comfyui-status.js';
import './modules/claude-status.js';
import { openZitPage, closeZitPage } from './modules/zit.js';
import { openQwenPage, closeQwenPage } from './modules/qwen-i2i.js';
import { openQwenPosePage, closeQwenPosePage } from './modules/qwen-pose.js';
import { openPostProcessSkinPage, closePostProcessSkinPage } from './modules/post-process-skin.js';
import { openLtxPage, closeLtxPage } from './modules/ltx-i2v.js';
import { openQueuePage, closeQueuePage } from './modules/comfyui-queue.js';
import { openClaudePage, closeClaudePage } from './modules/claude-page.js';
import { openContentFarmerPage, closeContentFarmerPage } from './modules/content-farmer.js';
import { closeMobileSidebar } from './modules/mobile.js';

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

// ── Sort toggle ───────────────────────────────────────────────────────────────

const SORT_ICONS = {
  newest: 'sort-numeric-down-alt',
  oldest: 'sort-numeric-up',
  'alpha-asc': 'sort-alpha-down',
  'alpha-desc': 'sort-alpha-up-alt',
};

function updateSortButton() {
  $('btn-sort').name = SORT_ICONS[state.sort];
  $('sort-dropdown').querySelectorAll('sl-menu-item').forEach(item => {
    if (item.value === state.sort) item.setAttribute('checked', '');
    else item.removeAttribute('checked');
  });
}

$('sort-dropdown').addEventListener('sl-select', e => {
  const sort = e.detail.item.value;
  state.sort = sort;
  localStorage.setItem('sort', sort);
  updateSortButton();
  if (state.currentItems.length) {
    state.currentItems = sortItems(state.currentItems);
    renderFiles(state.currentItems);
  }
});

updateSortButton();

// ── Quick nav ─────────────────────────────────────────────────────────────────

$('btn-staging').onclick = e => {
  e.preventDefault();
  if (state.config?.roots?.staging) navigate(state.config.roots.staging);
  else toast('Staging folder not configured in config.json', 'warning');
};

$('btn-library').onclick = e => {
  e.preventDefault();
  if (state.config?.roots?.library) navigate(state.config.roots.library);
};

// ── Open in OS ────────────────────────────────────────────────────────────────

$('btn-open-in-os').addEventListener('click', () => {
  if (!state.currentPath) return;
  const mappings = state.config?.osOpenMapping;
  if (!mappings?.length) {
    toast('Add osOpenMapping to config.json to enable Open in OS', 'warning');
    return;
  }
  const match = mappings.find(m => state.currentPath.startsWith(m.serverPath));
  if (!match) {
    toast('No osOpenMapping entry matches current path', 'warning');
    return;
  }
  const url = match.clientUrl + state.currentPath.slice(match.serverPath.length);
  const a = document.createElement('a');
  a.href = url;
  a.click();
});

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
  closeMobileSidebar();
  closeZitPage();
  closeQwenPage();
  closeQwenPosePage();
  closePostProcessSkinPage();
  closeLtxPage();
  closeQueuePage();
  closeClaudePage();
  closeContentFarmerPage();
  if (e.state?.page === 'zit') openZitPage();
  else if (e.state?.page === 'qwen') openQwenPage();
  else if (e.state?.page === 'qwen-pose') openQwenPosePage();
  else if (e.state?.page === 'post-process-skin') openPostProcessSkinPage();
  else if (e.state?.page === 'ltx') openLtxPage();
  else if (e.state?.page === 'comfy-queue') openQueuePage();
  else if (e.state?.page === 'claude') openClaudePage();
  else if (e.state?.page === 'content-farmer') openContentFarmerPage();
  else if (e.state?.path) navigate(e.state.path, { historyMode: 'none' });
  else {
    const p = urlToPath(location.pathname, location.search);
    if (p) navigate(p, { historyMode: 'none' });
  }
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

  const origPathname = location.pathname;
  const fromUrl = urlToPath(origPathname, location.search);

  // Queue is the default home view
  if (origPathname === '/comfy-queue' || (origPathname === '/' && !fromUrl)) {
    history.replaceState({ page: 'comfy-queue' }, '', '/comfy-queue');
    openQueuePage();
    return;
  }

  const start = fromUrl || state.config.roots?.staging || state.config.roots?.library;
  if (start) await navigate(start, { historyMode: 'replace' });

  if (origPathname === '/zit') {
    history.pushState({ page: 'zit' }, '', '/zit');
    openZitPage();
  } else if (origPathname === '/qwen') {
    history.pushState({ page: 'qwen' }, '', '/qwen');
    openQwenPage();
  } else if (origPathname === '/qwen-pose') {
    history.pushState({ page: 'qwen-pose' }, '', '/qwen-pose');
    openQwenPosePage();
  } else if (origPathname === '/ltx-i2v') {
    history.pushState({ page: 'ltx' }, '', '/ltx-i2v');
    openLtxPage();
  } else if (origPathname === '/post-process-skin') {
    history.pushState({ page: 'post-process-skin' }, '', '/post-process-skin');
    openPostProcessSkinPage();
  } else if (origPathname === '/claude') {
    history.pushState({ page: 'claude' }, '', '/claude');
    openClaudePage();
  }
})();
