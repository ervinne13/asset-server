import { state } from './state.js';
import { $ } from './helpers.js';
import { showPreview, pausePreviewVideo } from './preview.js';

export function refreshSelectionVisuals() {
  document.querySelectorAll('.file-card, .file-row').forEach(el => {
    el.classList.toggle('selected', !!el._item && state.selectedFiles.has(el._item.path));
  });
}

export function updateRightPanel() {
  // Queue view owns the right panel on desktop — don't fight it
  if (document.getElementById('comfy-queue-view')?.style.display === 'flex') return;

  const n = state.selectedFiles.size;
  const bulkPanel = $('bulk-panel');
  const previewEmpty = $('preview-empty');
  const previewContent = $('preview-content');
  const folderPanel = $('folder-panel');

  if (n === 0) {
    bulkPanel.style.display = 'none';
    previewContent.style.display = 'none';
    pausePreviewVideo();

    if (state.currentPath) {
      previewEmpty.style.display = 'none';
      folderPanel.style.display = 'flex';
      const name = state.currentPath.split('/').pop() || state.currentPath;
      const count = state.currentItems.length;
      $('folder-panel-name').textContent = name;
      $('folder-panel-info').textContent = count === 0 ? 'Empty' : `${count} item${count !== 1 ? 's' : ''}`;
      $('btn-delete-folder').style.display = count === 0 ? '' : 'none';
    } else {
      folderPanel.style.display = 'none';
      previewEmpty.style.display = '';
    }
  } else if (n === 1) {
    folderPanel.style.display = 'none';
    bulkPanel.style.display = 'none';
    showPreview(state.selectedFile);
  } else {
    folderPanel.style.display = 'none';
    previewEmpty.style.display = 'none';
    previewContent.style.display = 'none';
    bulkPanel.style.display = 'flex';
    $('bulk-count').textContent = `${n} files selected`;
  }
}

export function selectFile(item) {
  state.selectedFiles.clear();
  state.selectedFiles.add(item.path);
  state.selectedFile = item;
  state.lastSelectedIdx = state.currentItems.findIndex(i => i.path === item.path);
  refreshSelectionVisuals();
  updateRightPanel();
}

export function handleItemClick(e, item) {
  const idx = state.currentItems.findIndex(i => i.path === item.path);

  if (e.ctrlKey || e.metaKey) {
    if (state.selectedFiles.has(item.path)) {
      state.selectedFiles.delete(item.path);
      if (state.selectedFile?.path === item.path) {
        state.selectedFile = state.selectedFiles.size > 0
          ? (state.currentItems.find(i => state.selectedFiles.has(i.path)) ?? null)
          : null;
      }
    } else {
      state.selectedFiles.add(item.path);
      state.selectedFile = item;
    }
    state.lastSelectedIdx = idx;
    refreshSelectionVisuals();
    updateRightPanel();
  } else if (e.shiftKey && state.lastSelectedIdx >= 0) {
    const from = Math.min(state.lastSelectedIdx, idx);
    const to = Math.max(state.lastSelectedIdx, idx);
    for (let i = from; i <= to; i++) {
      const it = state.currentItems[i];
      if (it && !it.isDir) state.selectedFiles.add(it.path);
    }
    state.selectedFile = item;
    refreshSelectionVisuals();
    updateRightPanel();
  } else {
    selectFile(item);
  }
}

export function clearSelection() {
  state.selectedFiles.clear();
  state.selectedFile = null;
  state.lastSelectedIdx = -1;
  refreshSelectionVisuals();
  updateRightPanel();
}

$('file-grid').addEventListener('click', e => {
  if (!e.target.closest('.file-card, .file-row')) clearSelection();
});
