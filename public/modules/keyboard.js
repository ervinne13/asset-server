import { state } from './state.js';
import { api } from './api.js';
import { isVideo } from './helpers.js';
import { selectFile, clearSelection, refreshSelectionVisuals, updateRightPanel } from './selection.js';
import { navigate } from './router.js';
import { softDelete, bulkSoftDelete } from './trash.js';
import { openLightbox, closeLightbox, stepLightbox, updateLightbox, playLightboxVideo, toggleLightboxVideo } from './lightbox.js';

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
//
//  Navigation
//    →  /  ↓       Next item  (↓ jumps a full row in grid view)
//    ←  /  ↑       Prev item  (↑ jumps a full row in grid view)
//    Enter / Space  Open image/video in photo mode  /  open folder
//    Backspace      Go up one folder (when nothing is selected)
//
//  Photo mode  (Enter to open, Esc to close)
//    ←  /  →       Prev / next image
//    Space          Play / pause video
//    d / Delete / Backspace   Delete current image — 5 s undo, advances to next
//
//  Selection
//    Ctrl+A         Select all files in current folder
//    Escape         Clear selection  (or close photo mode)
//
//  File actions
//    d / Delete     Soft-delete selected file(s) — 5 s undo toast
//    Backspace      Soft-delete (when a file is selected)
//
//  Video (preview panel)
//    Space          Play / pause video preview
//

function gridColumnCount() {
  const cards = Array.from(document.querySelectorAll('.file-card'));
  if (cards.length < 2) return 1;
  const firstTop = cards[0].getBoundingClientRect().top;
  let cols = 0;
  for (const card of cards) {
    if (Math.abs(card.getBoundingClientRect().top - firstTop) < 5) cols++;
    else break;
  }
  return Math.max(1, cols);
}

function moveSelection(key) {
  const items = state.currentItems;
  if (!items.length) return;

  let idx = state.selectedFile
    ? items.findIndex(i => i.path === state.selectedFile.path)
    : -1;

  const step = (state.view === 'grid' && (key === 'ArrowDown' || key === 'ArrowUp'))
    ? gridColumnCount()
    : 1;
  const forward = key === 'ArrowRight' || key === 'ArrowDown';

  if (idx === -1) {
    idx = forward ? 0 : items.length - 1;
  } else {
    idx = forward
      ? Math.min(idx + step, items.length - 1)
      : Math.max(idx - step, 0);
  }

  const item = items[idx];
  const el   = Array.from(document.querySelectorAll('.file-card, .file-row')).find(e => e._item?.path === item.path);
  if (!el) return;

  selectFile(item);
  el.scrollIntoView({ block: 'nearest' });
}

function deleteSelected() {
  if (state.selectedFiles.size > 1) {
    bulkSoftDelete(state.currentItems.filter(i => state.selectedFiles.has(i.path)));
  } else if (state.selectedFile) {
    softDelete(state.selectedFile);
  }
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, sl-input, [contenteditable]')) return;

  // ── Photo mode intercepts most keys ──────────────────────────────────────────
  if (state.photoMode) {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        stepLightbox(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        stepLightbox(1);
        break;
      case 'Escape':
      case 'Enter':
        closeLightbox();
        break;
      case ' ':
        e.preventDefault();
        if (!toggleLightboxVideo()) closeLightbox();
        break;
      case 'Delete':
      case 'd':
      case 'Backspace':
        if (state.selectedFile) {
          softDelete(state.selectedFile).then(() => updateLightbox());
        }
        break;
    }
    return;
  }

  // ── Normal mode ───────────────────────────────────────────────────────────────
  switch (e.key) {
    // ── Navigation
    case 'ArrowRight':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(e.key);
      break;

    case 'Enter':
      if (state.selectedFile) {
        if (state.selectedFile.isDir) navigate(state.selectedFile.path);
        else openLightbox(state.selectedFile);
      }
      break;

    case ' ':
      e.preventDefault();
      if (state.selectedFile && !state.selectedFile.isDir) {
        openLightbox(state.selectedFile);
        if (isVideo(state.selectedFile.name)) playLightboxVideo();
      }
      break;

    // ── Selection
    case 'a':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        state.selectedFiles.clear();
        state.currentItems.filter(i => !i.isDir).forEach(i => state.selectedFiles.add(i.path));
        state.selectedFile    = state.currentItems.find(i => !i.isDir) ?? null;
        state.lastSelectedIdx = state.currentItems.findIndex(i => !i.isDir);
        refreshSelectionVisuals();
        updateRightPanel();
      }
      break;

    case 'Escape':
      clearSelection();
      break;

    // ── File actions
    case 'Delete':
    case 'd':
      deleteSelected();
      break;

    case 'Backspace':
      if (state.selectedFile) {
        deleteSelected();
      } else if (state.currentPath) {
        const parent = state.currentPath.split('/').slice(0, -1).join('/');
        if (parent) navigate(parent);
      }
      break;

  }
});
