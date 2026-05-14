import { state } from './state.js';
import { api } from './api.js';
import { $, toast, debounce } from './helpers.js';
import { makeRow } from './files.js';
import { navigate } from './router.js'; // circular dep — fine at runtime

export function renderSearchResults(result, q) {
  const grid = $('file-grid');
  grid.innerHTML = '';
  grid.className = 'file-grid view-list';

  const { folders, files, root } = result;

  if (folders.length === 0 && files.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = 'No results.';
    grid.appendChild(el);
    return;
  }

  if (folders.length > 0) {
    folders.forEach(folder => {
      const row = document.createElement('div');
      row.className = 'file-row search-folder-row';
      row.innerHTML = `
        <sl-icon class="row-icon" name="folder2"></sl-icon>
        <span class="row-name">${folder.name}</span>
        <span class="row-meta">${folder.rel}</span>
      `;
      row.onclick = () => {
        $('search-bar').style.display = 'none';
        $('search-input').value = '';
        navigate(folder.absPath);
      };
      grid.appendChild(row);
    });
  } else {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = `No folders matching "${q}".`;
    grid.appendChild(el);
  }

  const toggle = document.createElement('div');
  toggle.className = 'search-file-toggle';
  toggle.innerHTML = `<button class="search-file-btn">Search "${q}" in file names (${files.length} results)</button>`;
  toggle.querySelector('button').onclick = () => {
    toggle.remove();
    appendFileResults(files, root);
  };
  grid.appendChild(toggle);
}

function appendFileResults(files, root) {
  const grid = $('file-grid');

  if (files.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.style.gridColumn = '1/-1';
    el.textContent = 'No matching files.';
    grid.appendChild(el);
    return;
  }

  const header = document.createElement('div');
  header.className = 'search-section-label';
  header.textContent = 'Files';
  grid.appendChild(header);

  files.forEach(entry => {
    const absPath = root + '/' + entry.path;
    const item = { name: entry.name, path: absPath, isDir: false, size: entry.size, mtime: entry.mtime };
    const row = makeRow(item);
    row._item = item;
    grid.appendChild(row);
  });
}

// ── Search bar event wiring ───────────────────────────────────────────────────

$('btn-search-open').addEventListener('click', () => {
  $('search-bar').style.display = 'flex';
  $('search-input').focus();
});

$('btn-search-close').onclick = () => {
  $('search-bar').style.display = 'none';
  $('search-input').value = '';
  if (state.currentPath) navigate(state.currentPath);
};

$('search-input').addEventListener('sl-input', debounce(async e => {
  const q = e.target.value.trim();
  if (!q) {
    if (state.currentPath) navigate(state.currentPath);
    return;
  }
  let result;
  try {
    result = await api.search(q);
  } catch (err) {
    toast(`Search failed: ${err.message}`, 'danger');
    return;
  }
  if (!result.indexed) {
    toast('No index yet — click ↻ Index to build it', 'warning');
    return;
  }
  renderSearchResults(result, q);
}, 300));
