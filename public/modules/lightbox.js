import { state } from './state.js';
import { api } from './api.js';
import { isImg, isVideo } from './helpers.js';
import { selectFile } from './selection.js';

let imgEl, videoEl, nameEl, counterEl, prevBtn, nextBtn;

// Lazy DOM build — only creates the overlay on first open
function buildDOM() {
  const overlay = document.createElement('div');
  overlay.id = 'lightbox';
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <button class="lb-close" id="lb-close" title="Close (Esc)">✕</button>
    <div class="lb-stage">
      <button class="lb-nav lb-prev" id="lb-prev">&#8249;</button>
      <div class="lb-media">
        <img id="lb-img" alt="" />
        <video id="lb-video" controls loop></video>
      </div>
      <button class="lb-nav lb-next" id="lb-next">&#8250;</button>
    </div>
    <div class="lb-bar">
      <span id="lb-name"></span>
      <span id="lb-counter"></span>
    </div>
  `;
  document.body.appendChild(overlay);

  imgEl     = document.getElementById('lb-img');
  videoEl   = document.getElementById('lb-video');
  nameEl    = document.getElementById('lb-name');
  counterEl = document.getElementById('lb-counter');
  prevBtn   = document.getElementById('lb-prev');
  nextBtn   = document.getElementById('lb-next');

  document.getElementById('lb-close').onclick = closeLightbox;
  prevBtn.onclick = () => stepLightbox(-1);
  nextBtn.onclick = () => stepLightbox(1);

  // Click the dark background (not media or buttons) to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeLightbox();
  });
}

function mediaItems() {
  return state.currentItems.filter(i => !i.isDir && (isImg(i.name) || isVideo(i.name)));
}

function showItem(item) {
  imgEl.style.display   = 'none';
  videoEl.style.display = 'none';
  videoEl.pause();
  videoEl.src = '';

  if (isImg(item.name)) {
    imgEl.src = api.fileUrl(item.path, item.mtime);
    imgEl.style.display = '';
  } else if (isVideo(item.name)) {
    videoEl.src = api.fileUrl(item.path, item.mtime);
    videoEl.style.display = '';
  }

  const items = mediaItems();
  const idx   = items.findIndex(i => i.path === item.path);
  nameEl.textContent    = item.name;
  counterEl.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
  prevBtn.style.visibility = idx > 0                 ? '' : 'hidden';
  nextBtn.style.visibility = idx < items.length - 1  ? '' : 'hidden';
}

export function openLightbox(item) {
  if (!imgEl) buildDOM();
  state.photoMode = true;
  document.getElementById('lightbox').style.display = 'flex';
  selectFile(item);
  showItem(item);
}

export function closeLightbox() {
  const el = document.getElementById('lightbox');
  if (!el) return;
  state.photoMode = false;
  el.style.display = 'none';
  videoEl?.pause();
  if (videoEl) videoEl.src = '';
}

export function stepLightbox(dir) {
  const items = mediaItems();
  const idx   = items.findIndex(i => i.path === state.selectedFile?.path);
  if (idx === -1) return;
  const next = items[idx + dir];
  if (!next) return;
  selectFile(next);
  showItem(next);
}

// Re-sync display after an external change (e.g. delete advanced selection)
export function updateLightbox() {
  if (!state.photoMode) return;
  const item = state.selectedFile;
  const stillPresent = item && state.currentItems.some(i => i.path === item.path);
  if (stillPresent && (isImg(item.name) || isVideo(item.name))) {
    showItem(item);
  } else {
    closeLightbox();
  }
}
