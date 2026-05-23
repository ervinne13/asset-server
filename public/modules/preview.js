import { state } from './state.js';
import { api } from './api.js';
import { $, isImg, isVideo, fmtSize, fmtDate, toast } from './helpers.js';
import { openGenerateDialog } from './generate.js';

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
    $('preview-toolbar').style.display = 'none';
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

    const showToolbar = isImg(item.name) || isVideo(item.name);
    $('preview-toolbar').style.display = showToolbar ? 'flex' : 'none';
    const isPng = item.name.toLowerCase().endsWith('.png');
    $('btn-prompt-open').style.display = isPng ? '' : 'none';
    $('btn-generate-open').style.display = isImg(item.name) ? '' : 'none';
  }
}

export function clearPreview() {
  $('preview-empty').style.display = '';
  $('preview-content').style.display = 'none';
  $('bulk-panel').style.display = 'none';
  $('preview-toolbar').style.display = 'none';
  $('btn-prompt-open').style.display = 'none';
  $('btn-generate-open').style.display = 'none';
  const video = $('preview-video');
  video.pause();
  video.src = '';
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

$('btn-copy-file').addEventListener('click', copySelectedToClipboard);
$('btn-generate-open').addEventListener('click', () => openGenerateDialog(state.selectedFile));

// Click preview image → open full-size in new tab
$('preview-img').addEventListener('click', () => {
  if (state.selectedFile) window.open(api.fileUrl(state.selectedFile.path, state.selectedFile.mtime), '_blank');
});
