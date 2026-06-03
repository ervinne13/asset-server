import { api } from './api.js';
import { $, IMAGE_EXTS, toast } from './helpers.js';
import { state } from './state.js';

let onSelectCallback = null;
let onClearCallback = null;

let pickerFile = null;
let pickerPath = null;
let pickerFileUrl = null;

const pickerDialog = $('img-picker-dialog');
const pickerTree = $('img-picker-tree');

export function updateSlotUI(slotId, info) {
  const el = $(slotId);
  if (info) {
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
  for (const item of items) {
    if (item.isDir) {
      const ti = document.createElement('sl-tree-item');
      ti.textContent = item.name;
      ti.lazy = true;
      ti._path = item.path;
      ti._isDir = true;
      parentEl.appendChild(ti);
    } else if (IMAGE_EXTS.has(item.name.slice(item.name.lastIndexOf('.')).toLowerCase())) {
      const ti = document.createElement('sl-tree-item');
      ti.innerHTML = `<sl-icon name="image" slot="prefix" style="font-size:12px;color:var(--sl-color-neutral-500)"></sl-icon>${item.name}`;
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
  $('img-picker-preview-img').src = pickerFileUrl;
  $('img-picker-preview').style.display = '';
});

$('img-picker-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  pickerFile = file;
  pickerPath = null;
  pickerFileUrl = null;
  pickerTree.querySelectorAll('sl-tree-item').forEach(i => { i.selected = false; });
  $('img-picker-preview-img').src = URL.createObjectURL(file);
  $('img-picker-preview').style.display = '';
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
    $('img-picker-preview-img').src = pickerFileUrl;
    $('img-picker-preview-img').alt = name;
    $('img-picker-preview').style.display = '';
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

    if (onSelectCallback) onSelectCallback({ comfyFilename: result.comfyFilename, displayName, previewUrl });
    pickerDialog.hide();
  } catch (err) {
    toast(`Upload failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});

export function openImagePicker({ onSelect, onClear = null }) {
  onSelectCallback = onSelect;
  onClearCallback = onClear;

  pickerFile = null;
  pickerPath = null;
  pickerFileUrl = null;
  $('img-picker-preview').style.display = 'none';
  $('img-picker-file').value = '';
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
