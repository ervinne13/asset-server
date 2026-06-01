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
    el.dataset.path = item.path;
    grid.appendChild(el);
  });
}

export function patchFiles(newItems) {
  const grid = $('file-grid');

  // Fall back to full render when transitioning from/to empty state
  if (newItems.length === 0 || grid.querySelector('.empty-state')) {
    renderFiles(newItems);
    return;
  }

  // Build map of currently rendered elements by path
  const existingEls = new Map();
  for (const child of grid.children) {
    if (child._item) existingEls.set(child._item.path, child);
  }

  const newPaths = new Set(newItems.map(i => i.path));

  // Remove elements that are no longer in the listing
  for (const [p, el] of existingEls) {
    if (!newPaths.has(p)) grid.removeChild(el);
  }

  // Insert new elements in their correct sorted position
  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    if (existingEls.has(item.path)) continue;

    const newEl = state.view === 'grid' ? makeCard(item) : makeRow(item);
    newEl._item = item;
    newEl.dataset.path = item.path;
    newEl.classList.add('item-new');
    newEl.addEventListener('animationend', () => newEl.classList.remove('item-new'), { once: true });

    // Insert before the next item that already exists in the DOM
    let inserted = false;
    for (let j = i + 1; j < newItems.length; j++) {
      const nextEl = existingEls.get(newItems[j].path);
      if (nextEl && nextEl.parentNode === grid) {
        grid.insertBefore(newEl, nextEl);
        inserted = true;
        break;
      }
    }
    if (!inserted) grid.appendChild(newEl);
  }
}

export function makeCard(item) {
  const card = document.createElement('a');
  card.className = 'file-card';
  card.href = pathToUrl(item.path);

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';

  if (item.isDir) {
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
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.alt = item.name;
      img.src = api.fileUrl(item.path, item.mtime);
      thumb.appendChild(img);
    } else if (isVideo(item.name)) {
      const videoThumb = document.createElement('video');
      videoThumb.muted = true;
      videoThumb.playsInline = true;
      videoThumb.preload = 'none';
      videoThumb.style.display = 'none';

      const iconWrap = document.createElement('span');
      iconWrap.innerHTML = '<sl-icon name="camera-video"></sl-icon>';

      const obs = new IntersectionObserver((entries, o) => {
        if (!entries[0].isIntersecting) return;
        o.disconnect();
        videoThumb.src = api.fileUrl(item.path, item.mtime);
        videoThumb.preload = 'metadata';
        videoThumb.addEventListener('loadedmetadata', () => { videoThumb.currentTime = 1; });
        videoThumb.addEventListener('seeked', () => {
          videoThumb.style.display = '';
          iconWrap.style.display = 'none';
        }, { once: true });
      }, { rootMargin: '300px' });

      thumb.appendChild(videoThumb);
      thumb.appendChild(iconWrap);
      obs.observe(thumb);
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
      e.preventDefault();
      if (isMobile() && (isImg(item.name) || isVideo(item.name))) {
        selectFile(item);
        openLightbox(item);
      } else {
        handleItemClick(e, item);
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          history.replaceState(null, '', pathToUrl(item.path));
        }
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
  const row = document.createElement('a');
  row.className = 'file-row';
  row.href = pathToUrl(item.path);

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
      e.preventDefault();
      if (isMobile() && (isImg(item.name) || isVideo(item.name))) {
        selectFile(item);
        openLightbox(item);
      } else {
        handleItemClick(e, item);
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          history.replaceState(null, '', pathToUrl(item.path));
        }
      }
    };
  } else {
    row.onclick = e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) handleItemClick(e, item);
      else navigate(item.path);
    };
  }

  return row;
}

// Revert URL to the current folder when clicking empty grid space
$('file-grid').addEventListener('click', e => {
  if (!e.target.closest('.file-card, .file-row') && state.currentPath) {
    history.replaceState(null, '', pathToUrl(state.currentPath));
  }
});
