import { state } from './state.js';
import { api } from './api.js';
import { isImg, isVideo } from './helpers.js';
import { selectFile } from './selection.js';
import { softDelete } from './trash.js'; // circular via files.js — safe, all exports are hoisted functions
import { openTagDialog } from './tags.js';
import { openPromptDialog } from './prompt.js';
import { openGenerateDialog } from './generate.js';

let imgEl, videoEl, nameEl, nameTopEl, counterEl, prevBtn, nextBtn, lbPromptBtn, lbGenerateBtn;

// Lazy DOM build — only creates the overlay on first open
function buildDOM() {
  const overlay = document.createElement('div');
  overlay.id = 'lightbox';
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <span class="lb-top-name" id="lb-name-top"></span>
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
      <div class="lb-actions">
        <button class="lb-action-btn" id="lb-tag" title="Edit tags">
          <sl-icon name="tag"></sl-icon>
        </button>
        <button class="lb-action-btn" id="lb-prompt" title="Show workflow prompts" style="display:none">
          <sl-icon name="stars"></sl-icon>
        </button>
        <button class="lb-action-btn" id="lb-generate" title="Edit with Qwen AI" style="display:none">
          <sl-icon name="pencil-fill"></sl-icon>
        </button>
      </div>
      <span id="lb-name"></span>
      <span id="lb-counter"></span>
      <button class="lb-delete" id="lb-delete" title="Delete (d)">
        <sl-icon name="trash"></sl-icon>
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  imgEl      = document.getElementById('lb-img');
  videoEl    = document.getElementById('lb-video');
  nameEl     = document.getElementById('lb-name');
  nameTopEl  = document.getElementById('lb-name-top');
  counterEl  = document.getElementById('lb-counter');
  prevBtn    = document.getElementById('lb-prev');
  nextBtn    = document.getElementById('lb-next');
  lbPromptBtn    = document.getElementById('lb-prompt');
  lbGenerateBtn  = document.getElementById('lb-generate');

  document.getElementById('lb-close').onclick  = closeLightbox;
  document.getElementById('lb-delete').onclick = () => {
    if (state.selectedFile) softDelete(state.selectedFile).then(() => updateLightbox());
  };
  document.getElementById('lb-tag').onclick    = () => openTagDialog(state.selectedFile);
  document.getElementById('lb-prompt').onclick    = () => openPromptDialog(state.selectedFile);
  document.getElementById('lb-generate').onclick  = () => { closeLightbox(); openGenerateDialog(state.selectedFile); };
  prevBtn.onclick = () => stepLightbox(-1);
  nextBtn.onclick = () => stepLightbox(1);

  // Click the dark background (not media or buttons) to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeLightbox();
  });

  // ── Swipe navigation ───────────────────────────────────────────────────────
  let touchStartX = 0;
  let touchStartY = 0;

  overlay.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Only fire if clearly horizontal and past the threshold
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      stepLightbox(dx < 0 ? 1 : -1); // swipe left → next, swipe right → prev
    }
  }, { passive: true });
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
  if (nameTopEl) nameTopEl.textContent = item.name;
  counterEl.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
  prevBtn.style.visibility = idx > 0                ? '' : 'hidden';
  nextBtn.style.visibility = idx < items.length - 1 ? '' : 'hidden';
  if (lbGenerateBtn) lbGenerateBtn.style.display = isImg(item.name) ? '' : 'none';
  if (lbPromptBtn) {
    lbPromptBtn.style.display = 'none';
    if (item.name.toLowerCase().endsWith('.png')) {
      api.getPrompt(item.path).then(d => {
        if (d.prompts?.length && state.selectedFile?.path === item.path)
          lbPromptBtn.style.display = '';
      }).catch(() => {});
    }
  }
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
export function playLightboxVideo() {
  if (videoEl && videoEl.src && videoEl.style.display !== 'none') videoEl.play().catch(() => {});
}

export function toggleLightboxVideo() {
  if (!videoEl || !videoEl.src || videoEl.style.display === 'none') return false;
  videoEl.paused ? videoEl.play() : videoEl.pause();
  return true;
}

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
