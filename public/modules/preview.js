import { state } from './state.js';
import { api } from './api.js';
import { $, isImg, isVideo, fmtSize, fmtDate, toast } from './helpers.js';
import { openGenerateDialog } from './generate.js';

let currentPreviewPath = null;

export function showPreview(item) {
  $('preview-empty').style.display = 'none';
  $('bulk-panel').style.display = 'none';
  $('preview-content').style.display = 'flex';

  const img   = $('preview-img');
  const video = $('preview-video');
  const isSameItem = item.path === currentPreviewPath;
  currentPreviewPath = item.path;

  img.style.display = 'none';
  if (!isSameItem) {
    video.style.display = 'none';
    video.pause();
    video.src = '';
  }

  // Remove any leftover folder icon
  $('preview-media-wrap').querySelector('.preview-folder-icon')?.remove();

  if (item.isDir) {
    const icon = document.createElement('sl-icon');
    icon.name = 'folder2';
    icon.className = 'preview-folder-icon';
    $('preview-media-wrap').appendChild(icon);

    $('preview-name').textContent   = item.name;
    $('preview-info').textContent   = 'Folder';
    $('btn-download').style.display = 'none';
    $('btn-move').style.display     = 'none';
    $('preview-toolbar').style.display = 'none';
  } else {
    $('btn-download').style.display = '';
    $('btn-move').style.display     = '';

    if (isImg(item.name)) {
      const wrap = $('preview-media-wrap');
      wrap.classList.add('is-loading');
      img.onload  = () => wrap.classList.remove('is-loading');
      img.onerror = () => wrap.classList.remove('is-loading');
      img.src = api.fileUrl(item.path, item.mtime);
      img.style.display = '';
    } else if (isVideo(item.name)) {
      if (!isSameItem) {
        video.src = api.fileUrl(item.path, item.mtime);
      }
      video.style.display = '';
    }

    $('preview-name').textContent = item.name;
    $('preview-info').textContent = `${fmtSize(item.size)} · ${fmtDate(item.mtime)}`;

    const dl    = $('btn-download');
    dl.href     = api.downloadUrl(item.path);
    dl.download = item.name;

    const showToolbar = isImg(item.name) || isVideo(item.name);
    $('preview-toolbar').style.display = showToolbar ? 'flex' : 'none';
    $('btn-generate-open').style.display = isImg(item.name) ? '' : 'none';
    if (isImg(item.name)) updateCreativeVideoBtn(item.path);
    $('btn-creative-video').style.display = isImg(item.name) ? '' : 'none';
    $('btn-prompt-open').style.display = 'none';
    if (item.name.toLowerCase().endsWith('.png') || isVideo(item.name)) {
      api.getPrompt(item.path).then(d => {
        if ((d.prompts?.length || d.seed != null) && state.selectedFile?.path === item.path)
          $('btn-prompt-open').style.display = '';
      }).catch(() => {});
    }
  }
}

export function clearPreview() {
  currentPreviewPath = null;
  $('preview-empty').style.display = '';
  $('preview-content').style.display = 'none';
  $('bulk-panel').style.display = 'none';
  $('preview-toolbar').style.display = 'none';
  $('btn-prompt-open').style.display = 'none';
  $('btn-generate-open').style.display = 'none';
  $('btn-creative-video').style.display = 'none';
  const video = $('preview-video');
  video.pause();
  video.src = '';
}

function updateCreativeVideoBtn(filePath) {
  const queued = JSON.parse(localStorage.getItem('videoQueued') || '[]');
  const btn = $('btn-creative-video');
  const icon = btn.querySelector('sl-icon');
  if (queued.includes(filePath)) {
    icon.name = 'camera-video-fill';
    btn.style.color = 'var(--sl-color-primary-500)';
    btn.title = 'Re-queue creative video';
  } else {
    icon.name = 'camera-video';
    btn.style.color = '';
    btn.title = 'Queue for creative video';
  }
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

export async function copySelectedToClipboard() {
  const item = state.selectedFile;
  if (!item) return;

  if (isImg(item.name)) {
    try {
      const resp = await fetch(api.fileUrl(item.path, item.mtime));
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast('Copied to clipboard');
    } catch {
      try {
        await navigator.clipboard.writeText(location.origin + api.fileUrl(item.path, item.mtime));
        toast('URL copied (HTTPS required to copy image data)');
      } catch {
        toast('Copy failed — clipboard not available', 'warning');
      }
    }
  } else {
    try {
      await navigator.clipboard.writeText(location.origin + api.fileUrl(item.path, item.mtime));
      toast('URL copied to clipboard');
    } catch {
      toast('Copy failed — clipboard not available', 'warning');
    }
  }
}

$('btn-generate-open').addEventListener('click', () => openGenerateDialog(state.selectedFile));

$('btn-creative-video').addEventListener('click', async () => {
  const item = state.selectedFile;
  if (!item) return;
  const btn = $('btn-creative-video');
  btn.disabled = true;
  btn.title = 'Generating prompt…';
  try {
    await api.creativeVideo(item.path);
    const queued = JSON.parse(localStorage.getItem('videoQueued') || '[]');
    if (!queued.includes(item.path)) queued.push(item.path);
    localStorage.setItem('videoQueued', JSON.stringify(queued));
    updateCreativeVideoBtn(item.path);
    toast('Creative video queued — check ComfyUI queue');
  } catch (err) {
    toast(`Creative video failed: ${err.message}`, 'danger');
    updateCreativeVideoBtn(item.path);
  } finally {
    btn.disabled = false;
  }
});

// Click preview image → open full-size in new tab
$('preview-img').addEventListener('click', () => {
  if (state.selectedFile) window.open(api.fileUrl(state.selectedFile.path, state.selectedFile.mtime), '_blank');
});
