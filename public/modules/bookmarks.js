import { state } from './state.js';
import { api } from './api.js';
import { $ } from './helpers.js';
import { navigate, pathToUrl } from './router.js'; // circular dep — fine at runtime

export async function loadBookmarks() {
  state.bookmarks = await api.bookmarks();
  renderBookmarks();
}

export function renderBookmarks() {
  const list = $('bookmark-list');
  list.innerHTML = '';

  state.bookmarks.forEach((bm, i) => {
    const row = document.createElement('div');
    row.className = 'bookmark-row' + (state.currentPath === bm.path ? ' active' : '');
    row.dataset.idx = i;
    row.title = bm.path;
    row.innerHTML = `
      <a class="bm-link" href="${pathToUrl(bm.path)}">
        <sl-icon name="folder2" class="bm-icon"></sl-icon>
        <span class="bm-name">${bm.name}</span>
      </a>
      <button class="bm-remove" title="Remove bookmark">✕</button>
      <span class="bm-handle" title="Drag to reorder">⠿</span>
    `;

    row.querySelector('.bm-link').addEventListener('click', e => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        navigate(bm.path);
      }
    });

    row.querySelector('.bm-remove').onclick = async e => {
      e.stopPropagation();
      state.bookmarks.splice(i, 1);
      await api.saveBookmarks(state.bookmarks);
      renderBookmarks();
    };

    const handle = row.querySelector('.bm-handle');
    handle.addEventListener('mousedown', () => row.setAttribute('draggable', 'true'));
    row.addEventListener('dragend', () => row.setAttribute('draggable', 'false'));

    list.appendChild(row);
  });

  list.ondragover = e => {
    e.preventDefault();
    const target = e.target.closest('.bookmark-row');
    list.querySelectorAll('.bookmark-row').forEach(r => r.classList.remove('drag-over'));
    if (target) target.classList.add('drag-over');
  };
  list.ondragleave = () => list.querySelectorAll('.bookmark-row').forEach(r => r.classList.remove('drag-over'));
  list.ondragstart = e => {
    const row = e.target.closest('.bookmark-row');
    if (!row) return;
    e.dataTransfer.setData('text/plain', row.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  list.ondrop = async e => {
    e.preventDefault();
    list.querySelectorAll('.bookmark-row').forEach(r => r.classList.remove('drag-over'));
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
    const target = e.target.closest('.bookmark-row');
    if (!target || isNaN(fromIdx)) return;
    const toIdx = parseInt(target.dataset.idx);
    if (fromIdx === toIdx) return;
    const [moved] = state.bookmarks.splice(fromIdx, 1);
    state.bookmarks.splice(toIdx, 0, moved);
    await api.saveBookmarks(state.bookmarks);
    renderBookmarks();
  };
}

// ── Add-bookmark button ───────────────────────────────────────────────────────

$('btn-add-bookmark').addEventListener('click', async () => {
  if (!state.currentPath) return;
  const name = prompt('Bookmark name:', state.currentPath.split('/').pop() || state.currentPath);
  if (!name) return;
  state.bookmarks.push({ name, path: state.currentPath });
  await api.saveBookmarks(state.bookmarks);
  renderBookmarks();
});
