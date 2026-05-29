import { state } from './state.js';
import { api } from './api.js';
import { $, isImg, isVideo, fmtSize, fmtDate } from './helpers.js';
import { handleItemClick, selectFile } from './selection.js';
import { navigate, pathToUrl } from './router.js'; // circular dep — fine at runtime
import { openLightbox } from './lightbox.js'; // circular dep — fine at runtime
import { isMobile } from './mobile.js';

export function renderFiles(items) {
  const grid = $('file-grid');
  grid.innerHTML = '';
  grid.className = `file-grid view-${state.view}`;

  if (items.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = 'This folder is empty.';
    grid.appendChild(el);
    return;
  }

  items.forEach(item => {
    const el = state.view === 'grid' ? makeCard(item) : makeRow(item);
    el._item = item;
    grid.appendChild(el);
  });
}

export function makeCard(item) {
  const card = document.createElement(item.isDir ? 'a' : 'div');
  card.className = 'file-card';

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';

  if (item.isDir) {
    card.href = pathToUrl(item.path);
    thumb.innerHTML = `<sl-icon name="folder2-open"></sl-icon>`;
    card.onclick = e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) handleItemClick(e, item);
      else navigate(item.path);
    };
  } else {
    if (isImg(item.name)) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = item.name;
      img.src = api.fileUrl(item.path, item.mtime);
      thumb.appendChild(img);
    } else if (isVideo(item.name)) {
      thumb.innerHTML = `<sl-icon name="camera-video"></sl-icon>`;
    } else {
      thumb.innerHTML = `<sl-icon name="file-earmark"></sl-icon>`;
    }

    const dl = document.createElement('a');
    dl.className = 'card-dl';
    dl.href = api.downloadUrl(item.path);
    dl.download = item.name;
    dl.innerHTML = `<sl-icon name="download"></sl-icon>`;
    dl.title = 'Download';
    dl.addEventListener('click', e => e.stopPropagation());
    card.appendChild(dl);

    card.onclick = e => {
      if (isMobile() && (isImg(item.name) || isVideo(item.name))) {
        selectFile(item);
        openLightbox(item);
      } else {
        handleItemClick(e, item);
      }
    };
  }

  card.appendChild(thumb);

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name;
  card.appendChild(name);

  return card;
}

export function makeRow(item) {
  const row = document.createElement(item.isDir ? 'a' : 'div');
  row.className = 'file-row';

  const iconName = item.isDir ? 'folder2'
    : isImg(item.name) ? 'image'
      : isVideo(item.name) ? 'camera-video'
        : 'file-earmark';

  row.innerHTML = `
    <sl-icon class="row-icon" name="${iconName}"></sl-icon>
    <span class="row-name">${item.name}</span>
    <span class="row-meta">${item.isDir ? '' : `${fmtSize(item.size)} · ${fmtDate(item.mtime)}`}</span>
  `;

  if (!item.isDir) {
    const dl = document.createElement('a');
    dl.className = 'row-dl';
    dl.href = api.downloadUrl(item.path);
    dl.download = item.name;
    dl.innerHTML = `<sl-icon name="download"></sl-icon>`;
    dl.title = 'Download';
    dl.addEventListener('click', e => e.stopPropagation());
    row.appendChild(dl);
    row.onclick = e => {
      if (isMobile() && (isImg(item.name) || isVideo(item.name))) {
        selectFile(item);
        openLightbox(item);
      } else {
        handleItemClick(e, item);
      }
    };
  } else {
    row.href = pathToUrl(item.path);
    row.onclick = e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) handleItemClick(e, item);
      else navigate(item.path);
    };
  }

  return row;
}
