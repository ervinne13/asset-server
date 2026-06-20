import { api } from './api.js';
import { $, IMAGE_EXTS, VIDEO_EXTS, toast } from './helpers.js';
import { state } from './state.js';

let onSelectCallback = null;
let onClearCallback = null;
let pickerKind = 'image';
let pickerReturnPath = false;

let pickerFile = null;
let pickerPath = null;
let pickerFileUrl = null;

const pickerDialog = $('img-picker-dialog');
const pickerTree = $('img-picker-tree');

function activeExts() {
  return pickerKind === 'video' ? VIDEO_EXTS : IMAGE_EXTS;
}

function showPreview(url, isVideo) {
  const img = $('img-picker-preview-img');
  const vid = $('img-picker-preview-vid');
  if (isVideo) {
    img.style.display = 'none';
    vid.src = url;
    vid.style.display = '';
  } else {
    vid.pause();
    vid.removeAttribute('src');
    vid.style.display = 'none';
    img.src = url;
    img.style.display = '';
  }
  $('img-picker-preview').style.display = '';
  $('img-picker-placeholder').style.display = 'none';
}

export function updateSlotUI(slotId, info) {
  const el = $(slotId);
  if (info && info.kind === 'video') {
    el.innerHTML = '';
    const vid = document.createElement('video');
    vid.src = info.previewUrl;
    vid.className = 'qi-img-slot-preview';
    vid.muted = true;
    vid.loop = true;
    vid.preload = 'metadata';
    vid.onmouseenter = () => vid.play().catch(() => {});
    vid.onmouseleave = () => { vid.pause(); vid.currentTime = 0; };
    el.appendChild(vid);
    const label = document.createElement('span');
    label.className = 'qi-img-slot-name';
    label.textContent = info.displayName;
    el.appendChild(label);
    el.classList.add('has-image');
  } else if (info) {
    el.innerHTML = '';
    const img = document.createElement('img');
    img.src = info.previewUrl;
    img.className = 'qi-img-slot-preview';
    img.alt = info.displayName;
    el.appendChild(img);
    const label = document.createElement('span');
    label.className = 'qi-img-slot-name';
    label.textContent = info.displayName;
    el.appendChild(label);
    el.classList.add('has-image');
  } else {
    el.innerHTML = '<sl-icon name="image"></sl-icon><span>Click to select</span>';
    el.classList.remove('has-image');
  }
}

function makePickerLabel(text) {
  const item = document.createElement('sl-tree-item');
  item.textContent = text;
  item.classList.add('move-tree-label');
  item.disabled = true;
  return item;
}

function makePickerFolderItem(label, folderPath, icon) {
  const item = document.createElement('sl-tree-item');
  item.lazy = true;
  item._path = folderPath;
  item._isDir = true;
  if (icon) {
    item.innerHTML = `<sl-icon name="${icon}" slot="prefix" class="move-tree-icon"></sl-icon>${label}`;
  } else {
    item.textContent = label;
  }
  return item;
}

async function populatePickerLevel(parentEl, dirPath) {
  let items;
  try { items = await api.ls(dirPath); } catch { return; }
  const exts = activeExts();
  const fileIcon = pickerKind === 'video' ? 'film' : 'image';
  for (const item of items) {
    if (item.isDir) {
      const ti = document.createElement('sl-tree-item');
      ti.textContent = item.name;
      ti.lazy = true;
      ti._path = item.path;
      ti._isDir = true;
      parentEl.appendChild(ti);
    } else if (exts.has(item.name.slice(item.name.lastIndexOf('.')).toLowerCase())) {
      const ti = document.createElement('sl-tree-item');
      ti.innerHTML = `<sl-icon name="${fileIcon}" slot="prefix" style="font-size:12px;color:var(--sl-color-neutral-500)"></sl-icon>${item.name}`;
      ti._path = item.path;
      ti._isDir = false;
      ti._fileUrl = api.fileUrl(item.path, item.mtime);
      parentEl.appendChild(ti);
    }
  }
}

pickerTree.addEventListener('sl-lazy-load', async e => {
  const ti = e.target;
  if (ti._isDir) await populatePickerLevel(ti, ti._path);
  ti.lazy = false;
});

pickerTree.addEventListener('sl-selection-change', e => {
  const sel = e.detail.selection[0] ?? null;
  if (!sel || sel._isDir || !sel._path) {
    pickerPath = null;
    pickerFileUrl = null;
    $('img-picker-preview').style.display = 'none';
    return;
  }
  pickerPath = sel._path;
  pickerFileUrl = sel._fileUrl;
  pickerFile = null;
  showPreview(pickerFileUrl, pickerKind === 'video');
});

function setPickerFile(file) {
  pickerFile = file;
  pickerPath = null;
  pickerFileUrl = null;
  pickerTree.querySelectorAll('sl-tree-item').forEach(i => { i.selected = false; });
  showPreview(URL.createObjectURL(file), pickerKind === 'video');
}

$('img-picker-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  setPickerFile(file);
});

// Drag-and-drop onto the preview panel.
const previewPanel = document.querySelector('.img-picker-preview-panel');
let dragCounter = 0;

previewPanel.addEventListener('dragenter', e => {
  e.preventDefault();
  if (!pickerDialog.open) return;
  dragCounter++;
  previewPanel.classList.add('drag-over');
});

previewPanel.addEventListener('dragleave', () => {
  if (--dragCounter <= 0) { dragCounter = 0; previewPanel.classList.remove('drag-over'); }
});

previewPanel.addEventListener('dragover', e => { e.preventDefault(); });

previewPanel.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  previewPanel.classList.remove('drag-over');
  if (!pickerDialog.open) return;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (pickerKind === 'video' && !isVideo) { toast('Select a video file', 'warning'); return; }
  if (pickerKind === 'image' && !isImage) { toast('Select an image file', 'warning'); return; }
  setPickerFile(file);
});

// Paste a copied image straight into the picker (Cmd/Ctrl+V) while it's open.
document.addEventListener('paste', e => {
  if (!pickerDialog.open || pickerKind !== 'image') return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const blob = it.getAsFile();
      if (!blob) return;
      e.preventDefault();
      const ext = (it.type.split('/')[1] || 'png').split(';')[0];
      const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: it.type });
      setPickerFile(file);
      toast('Image pasted');
      return;
    }
  }
});

$('img-picker-upload-btn').addEventListener('click', () => $('img-picker-file').click());

$('img-picker-latest-btn').addEventListener('click', async () => {
  const btn = $('img-picker-latest-btn');
  btn.disabled = true;
  try {
    const { path: imgPath, mtime, name } = await api.latestStagingImage();
    pickerFile = null;
    pickerPath = imgPath;
    pickerFileUrl = api.fileUrl(imgPath, mtime);
    pickerTree.querySelectorAll('sl-tree-item').forEach(i => { i.selected = false; });
    $('img-picker-preview-img').alt = name;
    showPreview(pickerFileUrl, false);
  } catch (err) {
    toast(`Could not find latest: ${err.message}`, 'warning');
  } finally {
    btn.disabled = false;
  }
});

$('img-picker-clear').addEventListener('click', () => {
  if (onClearCallback) onClearCallback();
  pickerDialog.hide();
});

$('img-picker-cancel').addEventListener('click', () => pickerDialog.hide());

$('img-picker-confirm').addEventListener('click', async () => {
  if (!pickerFile && !pickerPath) { pickerDialog.hide(); return; }

  // Path-only mode (e.g. choosing an audio source for Join): no ComfyUI upload.
  if (pickerReturnPath) {
    if (!pickerPath) { pickerDialog.hide(); return; }
    if (onSelectCallback) onSelectCallback({ path: pickerPath, displayName: pickerPath.split('/').pop(), previewUrl: pickerFileUrl, kind: pickerKind });
    pickerDialog.hide();
    return;
  }

  const btn = $('img-picker-confirm');
  btn.loading = true;

  try {
    let result, displayName, previewUrl;

    if (pickerFile) {
      result = await api.uploadImageFromFile(pickerFile);
      displayName = pickerFile.name;
      previewUrl = URL.createObjectURL(pickerFile);
    } else {
      result = await api.uploadImageFromPath(pickerPath);
      displayName = pickerPath.split('/').pop();
      previewUrl = pickerFileUrl;
    }

    if (onSelectCallback) onSelectCallback({ comfyFilename: result.comfyFilename, serverPath: pickerPath || null, displayName, previewUrl, kind: pickerKind });
    pickerDialog.hide();
  } catch (err) {
    toast(`Upload failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});

// ── Slot drop-zone helper ─────────────────────────────────────────────────────
// Wires drag-and-drop directly onto a slot element. Uploads on drop, then calls
// onSelect with the same info shape as the modal confirm path.

export function wireSlotDropZone(slotId, kind, onSelect) {
  const el = $(slotId);
  let counter = 0;

  el.addEventListener('dragenter', e => {
    e.preventDefault();
    e.stopPropagation();
    counter++;
    el.classList.add('drag-over');
  });

  el.addEventListener('dragleave', () => {
    if (--counter <= 0) { counter = 0; el.classList.remove('drag-over'); }
  });

  el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    counter = 0;
    el.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (kind === 'video' && !file.type.startsWith('video/')) { toast('Drop a video file', 'warning'); return; }
    if (kind === 'image' && !file.type.startsWith('image/')) { toast('Drop an image file', 'warning'); return; }

    el.classList.add('slot-uploading');
    try {
      const result = await api.uploadImageFromFile(file);
      const info = { comfyFilename: result.comfyFilename, displayName: file.name, previewUrl: URL.createObjectURL(file), kind };
      onSelect(info);
      updateSlotUI(slotId, info);
    } catch (err) {
      toast(`Upload failed: ${err.message}`, 'danger');
    } finally {
      el.classList.remove('slot-uploading');
    }
  });
}

export function openImagePicker({ onSelect, onClear = null, kind = 'image', returnPath = false }) {
  onSelectCallback = onSelect;
  onClearCallback = onClear;
  pickerKind = kind;
  pickerReturnPath = returnPath;

  pickerFile = null;
  pickerPath = null;
  pickerFileUrl = null;
  $('img-picker-preview').style.display = 'none';
  $('img-picker-preview-img').src = '';
  $('img-picker-preview-vid').pause();
  $('img-picker-preview-vid').removeAttribute('src');
  $('img-picker-placeholder').style.display = '';
  $('img-picker-file').value = '';
  $('img-picker-file').accept = kind === 'video' ? 'video/*' : 'image/*';
  // returnPath needs a real server path, so device upload + "latest" don't apply.
  $('img-picker-upload-btn').style.display = returnPath ? 'none' : '';
  $('img-picker-latest-btn').style.display = (returnPath || kind === 'video') ? 'none' : '';
  $('img-picker-paste-hint').style.display = (returnPath || kind === 'video') ? 'none' : '';
  pickerDialog.label = kind === 'video' ? 'Select Video' : 'Select Image';
  $('img-picker-placeholder').innerHTML = `<sl-icon name="${kind === 'video' ? 'film' : 'image'}"></sl-icon><span>Select a file to preview</span>`;
  pickerTree.innerHTML = '';

  if (state.bookmarks?.length) {
    pickerTree.appendChild(makePickerLabel('Bookmarks'));
    state.bookmarks.forEach(bm => {
      pickerTree.appendChild(makePickerFolderItem(bm.name, bm.path, 'bookmark-fill'));
    });
    pickerTree.appendChild(makePickerLabel('All Folders'));
  }

  const roots = state.config?.roots;
  if (roots) {
    for (const [key, rootPath] of Object.entries(roots)) {
      if (rootPath) pickerTree.appendChild(makePickerFolderItem(key, rootPath, 'folder2'));
    }
  }

  pickerDialog.show();
}
