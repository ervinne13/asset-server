import { state } from './state.js';
import { api } from './api.js';
import { $, toast } from './helpers.js';
import { selectFile, clearSelection, updateRightPanel } from './selection.js';
import { clearPreview } from './preview.js';
import { renderFiles } from './files.js';
import { navigate } from './router.js';

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

async function deleteCurrentFolder() {
  const folderPath = state.currentPath;
  if (!folderPath) return;

  const folderName = folderPath.split('/').pop() || folderPath;
  const parentPath = folderPath.split('/').slice(0, -1).join('/');

  let result;
  try {
    result = await api.post('/api/trash', { path: folderPath });
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'danger');
    return;
  }

  await navigate(parentPath);

  let undone = false;
  const purgeTimer = setTimeout(async () => {
    if (!undone) await api.post('/api/trash/purge', { trashPath: result.trashPath }).catch(() => {});
  }, 5200);

  showUndoToast(`Deleted: ${folderName}`, async () => {
    undone = true;
    clearTimeout(purgeTimer);
    try {
      await api.post('/api/trash/restore', { trashPath: result.trashPath, originalPath: result.originalPath });
      await navigate(folderPath);
    } catch (err) {
      toast(`Restore failed: ${err.message}`, 'danger');
    }
  });
}

// ── Button wiring ─────────────────────────────────────────────────────────────

$('btn-delete').onclick = () => softDelete(state.selectedFile);
$('btn-preview-trash').onclick = () => softDelete(state.selectedFile);
$('btn-delete-folder').onclick = deleteCurrentFolder;

$('btn-bulk-delete').onclick = () => {
  const items = state.currentItems.filter(i => state.selectedFiles.has(i.path));
  bulkSoftDelete(items);
};

// ── Trash page ────────────────────────────────────────────────────────────────

function fmtAge(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function loadTrashList() {
  const listEl = $('trash-list');
  const statusEl = $('trash-status');
  listEl.innerHTML = '<div class="trash-empty">Loading…</div>';
  try {
    const { items } = await api.get('/api/trash/list');
    if (!items.length) {
      listEl.innerHTML = '<div class="trash-empty">Trash is empty</div>';
      return;
    }
    listEl.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'trash-row';
      row.innerHTML = `
        <sl-icon name="${item.isDir ? 'folder2' : 'file-earmark'}" class="trash-row-icon"></sl-icon>
        <div class="trash-row-info">
          <div class="trash-row-name">${item.name}</div>
          <div class="trash-row-path">${item.originalPath || '(original path unknown)'}</div>
        </div>
        <span class="trash-row-age">${fmtAge(item.trashedAt)}</span>
        <sl-button size="small" class="trash-btn-restore" variant="default">Restore</sl-button>
        <sl-button size="small" class="trash-btn-purge" variant="danger">Delete</sl-button>
      `;
      row.querySelector('.trash-btn-restore').addEventListener('click', async () => {
        if (!item.originalPath) { toast('No original path recorded — cannot restore', 'warning'); return; }
        try {
          await api.post('/api/trash/restore', { trashPath: item.trashPath });
          toast(`Restored → ${item.originalPath}`);
          row.remove();
          if (!$('trash-list').children.length) $('trash-list').innerHTML = '<div class="trash-empty">Trash is empty</div>';
        } catch (err) { toast(`Restore failed: ${err.message}`, 'danger'); }
      });
      row.querySelector('.trash-btn-purge').addEventListener('click', async () => {
        try {
          await api.post('/api/trash/purge', { trashPath: item.trashPath });
          row.remove();
          if (!$('trash-list').children.length) $('trash-list').innerHTML = '<div class="trash-empty">Trash is empty</div>';
        } catch (err) { toast(`Delete failed: ${err.message}`, 'danger'); }
      });
      listEl.appendChild(row);
    }
    statusEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
  } catch (err) {
    listEl.innerHTML = `<div class="trash-empty">Failed to load: ${err.message}</div>`;
  }
}

export function openTrashPage() {
  $('trash-page').style.display = 'flex';
  $('trash-status').textContent = '';
  loadTrashList();
}

export function closeTrashPage() {
  $('trash-page').style.display = 'none';
}

$('btn-trash').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'trash' }, '', '/trash');
  openTrashPage();
});

$('trash-back').addEventListener('click', () => history.back());
