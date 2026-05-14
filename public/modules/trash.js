import { state } from './state.js';
import { api } from './api.js';
import { $, toast } from './helpers.js';
import { selectFile, clearSelection, updateRightPanel } from './selection.js';
import { clearPreview } from './preview.js';
import { renderFiles } from './files.js';

export async function softDelete(item) {
  if (!item) return;

  let result;
  try {
    result = await api.post('/api/trash', { path: item.path });
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'danger');
    return;
  }

  const idx = state.currentItems.findIndex(i => i.path === item.path);
  state.currentItems = state.currentItems.filter(i => i.path !== item.path);
  state.selectedFiles.delete(item.path);
  renderFiles(state.currentItems);
  clearPreview();

  const next = state.currentItems[idx] || state.currentItems[idx - 1];
  if (next && !next.isDir) {
    const el = Array.from(document.querySelectorAll('.file-card, .file-row')).find(e => e._item?.path === next.path);
    selectFile(next, el);
  }

  let undone = false;
  const purgeTimer = setTimeout(async () => {
    if (!undone) await api.post('/api/trash/purge', { trashPath: result.trashPath }).catch(() => { });
  }, 5200);

  showUndoToast(`Deleted: ${item.name}`, async () => {
    undone = true;
    clearTimeout(purgeTimer);
    try {
      await api.post('/api/trash/restore', { trashPath: result.trashPath, originalPath: result.originalPath });
      state.currentItems.splice(idx, 0, item);
      renderFiles(state.currentItems);
      const el = Array.from(document.querySelectorAll('.file-card, .file-row')).find(e => e._item?.path === item.path);
      selectFile(item, el);
    } catch (err) {
      toast(`Restore failed: ${err.message}`, 'danger');
    }
  });
}

export async function bulkSoftDelete(items) {
  if (!items?.length) return;

  const results = [];
  const failed = [];

  await Promise.all(items.map(async item => {
    try {
      const result = await api.post('/api/trash', { path: item.path });
      results.push({ item, result });
    } catch {
      failed.push(item);
    }
  }));

  if (failed.length > 0) toast(`Failed to delete ${failed.length} file(s)`, 'danger');

  const deletedPaths = new Set(results.map(r => r.item.path));
  state.currentItems = state.currentItems.filter(i => !deletedPaths.has(i.path));
  clearSelection();
  renderFiles(state.currentItems);

  if (results.length === 0) return;

  const label = results.length === 1 ? results[0].item.name : `${results.length} files`;
  let undone = false;

  const purgeTimers = results.map(({ result }) =>
    setTimeout(async () => {
      if (!undone) await api.post('/api/trash/purge', { trashPath: result.trashPath }).catch(() => { });
    }, 5200)
  );

  showUndoToast(`Deleted: ${label}`, async () => {
    undone = true;
    purgeTimers.forEach(clearTimeout);

    const restoreErrors = [];
    await Promise.all(results.map(async ({ item, result }) => {
      try {
        await api.post('/api/trash/restore', { trashPath: result.trashPath, originalPath: result.originalPath });
        state.currentItems.push(item);
      } catch {
        restoreErrors.push(item.name);
      }
    }));

    // Restore sort order: dirs first, then alphabetical
    state.currentItems.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    renderFiles(state.currentItems);

    if (restoreErrors.length > 0) {
      toast(`Restore failed for: ${restoreErrors.join(', ')}`, 'danger');
    }
  });
}

export function showUndoToast(msg, onUndo, duration = 5000) {
  const t = document.createElement('div');
  t.className = 'undo-toast';
  t.innerHTML = `
    <span class="undo-toast-msg">${msg}</span>
    <button class="undo-toast-btn">Undo</button>
    <div class="undo-progress"><div class="undo-progress-bar"></div></div>
  `;
  document.body.appendChild(t);

  const bar = t.querySelector('.undo-progress-bar');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${duration}ms linear`;
    bar.style.width = '0%';
  }));

  const timer = setTimeout(() => t.remove(), duration);

  t.querySelector('.undo-toast-btn').onclick = () => {
    clearTimeout(timer);
    t.remove();
    onUndo();
  };
}

// ── Button wiring ─────────────────────────────────────────────────────────────

$('btn-delete').onclick = () => softDelete(state.selectedFile);

$('btn-bulk-delete').onclick = () => {
  const items = state.currentItems.filter(i => state.selectedFiles.has(i.path));
  bulkSoftDelete(items);
};
