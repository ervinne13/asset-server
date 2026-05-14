import { state } from './state.js';
import { api } from './api.js';
import { $, toast } from './helpers.js';
import { clearSelection } from './selection.js';
import { navigate } from './router.js'; // circular dep — fine at runtime

const moveDialog = $('move-dialog');
const moveTree = $('move-tree');

export async function openMoveDialog() {
  const libRoot = state.config?.roots?.library;
  if (!libRoot) { toast('Library root not configured', 'warning'); return; }

  state.moveDestPath = libRoot;
  $('move-dest-display').textContent = libRoot;
  moveTree.innerHTML = '';

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
  const sel = e.detail.selection[0];
  if (sel?._path) {
    state.moveDestPath = sel._path;
    $('move-dest-display').textContent = sel._path;
  }
});

$('btn-move').onclick = () => openMoveDialog();
$('btn-bulk-move').onclick = () => openMoveDialog();

$('btn-move-confirm').onclick = async () => {
  if (!state.moveDestPath) return;

  const paths = state.selectedFiles.size > 0
    ? [...state.selectedFiles]
    : state.selectedFile ? [state.selectedFile.path] : [];
  if (paths.length === 0) return;

  try {
    await api.move(paths, state.moveDestPath);
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
