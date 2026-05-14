import { state } from './state.js';
import { api } from './api.js';
import { $, isImg, isVideo, fmtSize, fmtDate } from './helpers.js';

export function showPreview(item) {
  $('preview-empty').style.display = 'none';
  $('bulk-panel').style.display = 'none';
  $('preview-content').style.display = 'flex';

  const img   = $('preview-img');
  const video = $('preview-video');

  img.style.display   = 'none';
  video.style.display = 'none';
  video.pause();
  video.src = '';

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
  } else {
    $('btn-download').style.display = '';
    $('btn-move').style.display     = '';

    if (isImg(item.name)) {
      img.src = api.fileUrl(item.path, item.mtime);
      img.style.display = '';
    } else if (isVideo(item.name)) {
      video.src = api.fileUrl(item.path, item.mtime);
      video.style.display = '';
    }

    $('preview-name').textContent = item.name;
    $('preview-info').textContent = `${fmtSize(item.size)} · ${fmtDate(item.mtime)}`;

    const dl    = $('btn-download');
    dl.href     = api.downloadUrl(item.path);
    dl.download = item.name;
  }
}

export function clearPreview() {
  $('preview-empty').style.display = '';
  $('preview-content').style.display = 'none';
  $('bulk-panel').style.display = 'none';
  const video = $('preview-video');
  video.pause();
  video.src = '';
}

// Click preview image → open full-size in new tab
$('preview-img').addEventListener('click', () => {
  if (state.selectedFile) window.open(api.fileUrl(state.selectedFile.path, state.selectedFile.mtime), '_blank');
});
