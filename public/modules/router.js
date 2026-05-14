import { state } from './state.js';
import { api } from './api.js';
import { $, toast, isImg, isVideo } from './helpers.js';
import { renderFiles } from './files.js';           // circular dep — fine at runtime
import { clearPreview } from './preview.js';
import { clearSelection, refreshSelectionVisuals, updateRightPanel } from './selection.js';
import { renderBookmarks } from './bookmarks.js';   // circular dep — fine at runtime
import { closeMobileSidebar } from './mobile.js';

export function pathToUrl(absPath) {
  const { staging, library } = state.config?.roots || {};
  if (staging && (absPath === staging || absPath.startsWith(staging + '/'))) {
    const rel = absPath.slice(staging.length);
    return '/staging' + rel.split('/').map(encodeURIComponent).join('/');
  }
  if (library && (absPath === library || absPath.startsWith(library + '/'))) {
    const rel = absPath.slice(library.length);
    return '/library' + rel.split('/').map(encodeURIComponent).join('/');
  }
  return '/';
}

export function urlToPath(pathname) {
  const { staging, library } = state.config?.roots || {};
  if (!pathname || pathname === '/') return null;
  if (pathname.startsWith('/staging')) {
    const rel = pathname.slice('/staging'.length);
    return (staging || '') + rel.split('/').map(decodeURIComponent).join('/');
  }
  if (pathname.startsWith('/library')) {
    const rel = pathname.slice('/library'.length);
    return (library || '') + rel.split('/').map(decodeURIComponent).join('/');
  }
  return null;
}

export async function navigate(dirPath, { historyMode = 'push' } = {}) {
  state.currentPath = dirPath;
  closeMobileSidebar();
  clearSelection();
  clearPreview();
  renderBookmarks();

  let items;
  try {
    items = await api.ls(dirPath);
  } catch (err) {
    toast(`Cannot open folder: ${err.message}`, 'danger');
    return;
  }

  state.currentItems = items;

  if (state.folderViews[dirPath] !== undefined) {
    state.view = state.folderViews[dirPath];
  } else {
    const hasMedia = items.some(i => !i.isDir && (isImg(i.name) || isVideo(i.name)));
    state.view = hasMedia ? 'grid' : 'list';
  }

  const url = pathToUrl(dirPath);
  if (historyMode === 'push') history.pushState({ path: dirPath }, '', url);
  else if (historyMode === 'replace') history.replaceState({ path: dirPath }, '', url);

  renderBreadcrumb(dirPath);
  renderFiles(items);
}

export async function silentRefresh() {
  if (!state.currentPath) return;
  if ($('move-dialog').open) return;

  let items;
  try { items = await api.ls(state.currentPath); } catch { return; }

  state.currentItems = items;
  renderFiles(items);

  // Drop selected paths that disappeared
  const presentPaths = new Set(items.map(i => i.path));
  for (const p of state.selectedFiles) {
    if (!presentPaths.has(p)) state.selectedFiles.delete(p);
  }
  if (state.selectedFile && !presentPaths.has(state.selectedFile.path)) {
    state.selectedFile = null;
  }

  refreshSelectionVisuals();
  updateRightPanel();
}

function renderBreadcrumb(dirPath) {
  const bc = $('breadcrumb');
  bc.innerHTML = '';

  const { staging, library } = state.config?.roots || {};

  let rootLabel, rootPath, relPath;

  if (staging && (dirPath === staging || dirPath.startsWith(staging + '/'))) {
    rootLabel = 'Staging';
    rootPath  = staging;
    relPath   = dirPath.slice(staging.length);
  } else if (library && (dirPath === library || dirPath.startsWith(library + '/'))) {
    rootLabel = 'Library Root';
    rootPath  = library;
    relPath   = dirPath.slice(library.length);
  }

  function crumb(label, path) {
    const item = document.createElement('sl-breadcrumb-item');
    item.textContent = label;
    if (path) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => navigate(path));
    }
    bc.appendChild(item);
  }

  if (rootLabel) {
    crumb(rootLabel, dirPath !== rootPath ? rootPath : null);
    const parts = relPath.split('/').filter(Boolean);
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const pathTo = rootPath + '/' + parts.slice(0, i + 1).join('/');
      crumb(part, isLast ? null : pathTo);
    });
  } else {
    // Fallback for paths outside configured roots
    dirPath.split('/').filter(Boolean).forEach((part, i, arr) => {
      const pathTo = '/' + arr.slice(0, i + 1).join('/');
      crumb(part, i < arr.length - 1 ? pathTo : null);
    });
  }
}
