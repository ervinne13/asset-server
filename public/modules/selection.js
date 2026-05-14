import { state } from './state.js';
import { $ } from './helpers.js';
import { showPreview } from './preview.js';

export function refreshSelectionVisuals() {
  document.querySelectorAll('.file-card, .file-row').forEach(el => {
    el.classList.toggle('selected', !!el._item && state.selectedFiles.has(el._item.path));
  });
}

export function updateRightPanel() {
  const n = state.selectedFiles.size;
  const bulkPanel = $('bulk-panel');
  const previewEmpty = $('preview-empty');
  const previewContent = $('preview-content');

  if (n === 0) {
    bulkPanel.style.display = 'none';
    previewEmpty.style.display = '';
    previewContent.style.display = 'none';
  } else if (n === 1) {
    bulkPanel.style.display = 'none';
    showPreview(state.selectedFile);
  } else {
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
