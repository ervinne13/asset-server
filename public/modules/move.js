import { state } from './state.js';
import { api } from './api.js';
import { $, toast } from './helpers.js';
import { clearSelection } from './selection.js';
import { navigate, silentRefresh } from './router.js'; // circular dep — fine at runtime

const moveDialog = $('move-dialog');
const moveTree = $('move-tree');
let selectedTreeItem = null;

export async function createFolderAt(parentPath) {
  const name = prompt('Folder name:');
  if (!name?.trim()) return null;
  const fullPath = `${parentPath}/${name.trim()}`;
  try {
    await api.mkdir(fullPath);
    return fullPath;
  } catch (err) {
    toast(`Failed to create folder: ${err.message}`, 'danger');
    return null;
  }
}

function makeTreeItem(label, path, { icon, labelClass } = {}) {
  const item = document.createElement('sl-tree-item');
  if (icon) {
    item.innerHTML = `<sl-icon name="${icon}" slot="prefix" class="move-tree-icon"></sl-icon>${label}`;
  } else {
    item.textContent = label;
  }
  if (labelClass) item.classList.add(labelClass);
  if (path) {
    item.lazy = true;
    item._path = path;
  }
  return item;
}

const RECENT_MOVE_KEY = 'recentMoveDest';

function getRecentMoveDest() {
  return localStorage.getItem(RECENT_MOVE_KEY) || null;
}

function saveRecentMoveDest(path) {
  localStorage.setItem(RECENT_MOVE_KEY, path);
}

export async function openMoveDialog() {
  const libRoot = state.config?.roots?.library;
  if (!libRoot) { toast('Library root not configured', 'warning'); return; }

  state.moveDestPath = libRoot;
  $('move-dest-display').textContent = libRoot;
  moveTree.innerHTML = '';

  const recentDest = getRecentMoveDest();
  if (recentDest) {
    const recentLabel = makeTreeItem('Recently Used', null, { labelClass: 'move-tree-label' });
    recentLabel.disabled = true;
    moveTree.appendChild(recentLabel);

    const recentItem = makeTreeItem(recentDest.split('/').pop(), recentDest, { icon: 'clock-history' });
    recentItem.title = recentDest;
    moveTree.appendChild(recentItem);
  }

  if (state.bookmarks.length > 0) {
    const bmLabel = makeTreeItem('Bookmarks', null, { labelClass: 'move-tree-label' });
    bmLabel.disabled = true;
    moveTree.appendChild(bmLabel);

    state.bookmarks.forEach(bm => {
      moveTree.appendChild(makeTreeItem(bm.name, bm.path, { icon: 'bookmark-fill' }));
    });

    const libLabel = makeTreeItem('Library', null, { labelClass: 'move-tree-label' });
    libLabel.disabled = true;
    moveTree.appendChild(libLabel);
  }

  await populateMoveTreeLevel(moveTree, libRoot);
  moveDialog.show();
}

async function populateMoveTreeLevel(parentEl, dirPath) {
  let items;
  try { items = await api.ls(dirPath); } catch { return; }

  items.filter(i => i.isDir).forEach(item => {
    const treeItem = document.createElement('sl-tree-item');
    treeItem.textContent = item.name;
    treeItem.lazy = true;
    treeItem._path = item.path;
    parentEl.appendChild(treeItem);
  });
}

moveTree.addEventListener('sl-lazy-load', async e => {
  const treeItem = e.target;
  await populateMoveTreeLevel(treeItem, treeItem._path);
  treeItem.lazy = false;
});

moveTree.addEventListener('sl-selection-change', e => {
  selectedTreeItem = e.detail.selection[0] ?? null;
  if (selectedTreeItem?._path) {
    state.moveDestPath = selectedTreeItem._path;
    $('move-dest-display').textContent = selectedTreeItem._path;
  }
});

$('btn-new-folder-move').onclick = async () => {
  const newPath = await createFolderAt(state.moveDestPath);
  if (!newPath) return;

  const parent = selectedTreeItem ?? moveTree;
  Array.from(parent.querySelectorAll(':scope > sl-tree-item')).forEach(i => i.remove());
  await populateMoveTreeLevel(parent, state.moveDestPath);
  if (selectedTreeItem) {
    selectedTreeItem.lazy = false;
    selectedTreeItem.expanded = true;
  }

  const newItem = Array.from(parent.querySelectorAll(':scope > sl-tree-item')).find(i => i._path === newPath);
  if (newItem) {
    moveTree.querySelectorAll('sl-tree-item').forEach(i => { i.selected = false; });
    newItem.selected = true;
    selectedTreeItem = newItem;
  }
  state.moveDestPath = newPath;
  $('move-dest-display').textContent = newPath;
};

$('btn-move').onclick = () => openMoveDialog();
$('btn-bulk-move').onclick = () => openMoveDialog();

$('btn-new-folder').onclick = async () => {
  if (!state.currentPath) return;
  const created = await createFolderAt(state.currentPath);
  if (created) silentRefresh();
};

$('btn-move-confirm').onclick = async () => {
  if (!state.moveDestPath) return;

  const paths = state.selectedFiles.size > 0
    ? [...state.selectedFiles]
    : state.selectedFile ? [state.selectedFile.path] : [];
  if (paths.length === 0) return;

  try {
    await api.move(paths, state.moveDestPath);
    saveRecentMoveDest(state.moveDestPath);
    moveDialog.hide();
    state.currentItems = state.currentItems.filter(i => !paths.includes(i.path));
    clearSelection();
    navigate(state.currentPath);
    toast(`Moved ${paths.length === 1 ? paths[0].split('/').pop() : `${paths.length} files`} → ${state.moveDestPath.split('/').pop()}`);
  } catch (err) {
    toast(`Move failed: ${err.message}`, 'danger');
  }
};

$('btn-move-cancel').onclick = () => moveDialog.hide();
