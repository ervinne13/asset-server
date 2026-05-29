import { api } from './api.js';
import { $, IMAGE_EXTS, toast } from './helpers.js';
import { state } from './state.js';
import { loadSavedPrompts, renderSavedPrompts, saveNewPrompt } from './saved-prompts.js';

const RECENT_KEY = 'qi-recent-prompts';
const RECENT_MAX = 10;

let saveMode = false;
let mainImageInfo = null;
let supportImageInfo = null;

// ── Recent prompts ────────────────────────────────────────────────────────────

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

function addRecent(text) {
  const list = [text, ...getRecent().filter(t => t !== text)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function renderRecent() {
  const recent = getRecent();
  const section = $('qi-recent-section');
  const list = $('qi-recent-list');
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  for (const text of recent) {
    const item = document.createElement('div');
    item.className = 'zit-recent-item';
    item.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
    item.title = text;
    item.addEventListener('click', () => {
      $('qi-prompt').value = text;
      $('qi-prompt').focus();
    });
    list.appendChild(item);
  }
}

// ── Image slot UI ─────────────────────────────────────────────────────────────

function updateSlotUI(slotId, info) {
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

// ── Image picker dialog ───────────────────────────────────────────────────────

const pickerDialog = $('img-picker-dialog');
const pickerTree = $('img-picker-tree');
let pickerSlot = null;
let pickerFile = null;
let pickerPath = null;
let pickerFileUrl = null;

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

$('img-picker-clear').addEventListener('click', () => {
  if (pickerSlot === 'main') { mainImageInfo = null; updateSlotUI('qi-main-img-slot', null); }
  else { supportImageInfo = null; updateSlotUI('qi-support-img-slot', null); }
  pickerDialog.hide();
});

$('img-picker-cancel').addEventListener('click', () => pickerDialog.hide());

$('img-picker-confirm').addEventListener('click', async () => {
  if (!pickerFile && !pickerPath) { pickerDialog.hide(); return; }

  const btn = $('img-picker-confirm');
  btn.loading = true;

  try {
    let result;
    let displayName;
    let previewUrl;

    if (pickerFile) {
      result = await api.uploadImageFromFile(pickerFile);
      displayName = pickerFile.name;
      previewUrl = URL.createObjectURL(pickerFile);
    } else {
      result = await api.uploadImageFromPath(pickerPath);
      displayName = pickerPath.split('/').pop();
      previewUrl = pickerFileUrl;
    }

    const info = { comfyFilename: result.comfyFilename, displayName, previewUrl };
    if (pickerSlot === 'main') { mainImageInfo = info; updateSlotUI('qi-main-img-slot', info); }
    else { supportImageInfo = info; updateSlotUI('qi-support-img-slot', info); }
    pickerDialog.hide();
  } catch (err) {
    toast(`Upload failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});

async function openPicker(slot) {
  pickerSlot = slot;
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

$('qi-main-img-slot').addEventListener('click', () => openPicker('main'));
$('qi-support-img-slot').addEventListener('click', () => openPicker('support'));

// ── Save mode ─────────────────────────────────────────────────────────────────

function setSaveMode(on) {
  saveMode = on;
  $('qi-title-row').style.display = on ? '' : 'none';
  const btn = $('btn-qi-submit');
  if (on) {
    btn.innerHTML = '<sl-icon slot="prefix" name="bookmark-plus"></sl-icon>Save & Generate';
  } else {
    btn.innerHTML = '<sl-icon slot="prefix" name="stars"></sl-icon>Generate';
    $('qi-title').value = '';
  }
}

// ── Open / close ──────────────────────────────────────────────────────────────

export async function openQwenPage() {
  $('qwen-i2i-status').textContent = '';
  $('btn-qi-submit').loading = false;
  setSaveMode(false);
  mainImageInfo = null;
  supportImageInfo = null;
  updateSlotUI('qi-main-img-slot', null);
  updateSlotUI('qi-support-img-slot', null);
  $('qwen-i2i-page').style.display = 'flex';
  await loadSavedPrompts();
  renderSavedPrompts($('qi-saved-list'), p => {
    $('qi-prompt').value = p.text;
    $('qi-prompt').focus();
  });
  renderRecent();
  setTimeout(() => $('qi-prompt').focus(), 120);
}

export function closeQwenPage() {
  $('qwen-i2i-page').style.display = 'none';
}

$('btn-qwen-i2i').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'qwen' }, '', '/qwen');
  openQwenPage();
});

$('qwen-i2i-back').addEventListener('click', () => history.back());

$('qi-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('qi-prompt').value = text;
    $('qi-prompt').focus();
  } catch {
    toast('Clipboard access denied', 'warning');
  }
});

// ── Dropdown ──────────────────────────────────────────────────────────────────

const caretIcon = $('qi-caret-icon');
$('qi-submit-menu').addEventListener('sl-show', () => { caretIcon.name = 'chevron-up'; });
$('qi-submit-menu').addEventListener('sl-hide', () => { caretIcon.name = 'chevron-down'; });

$('qi-submit-menu').addEventListener('sl-select', e => {
  if (e.detail.item.id === 'qi-menu-save-generate') {
    setSaveMode(true);
    setTimeout(() => $('qi-title').focus(), 50);
  }
});

$('qi-save-mode-cancel').addEventListener('click', () => setSaveMode(false));

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-qi-submit').addEventListener('click', async () => {
  const prompt = $('qi-prompt').value.trim();
  if (!prompt) { toast('Enter a prompt', 'warning'); return; }

  let savedPromptId = null;
  if (saveMode) {
    const title = $('qi-title').value.trim();
    if (!title) { toast('Enter a title', 'warning'); $('qi-title').focus(); return; }
    try {
      const saved = await saveNewPrompt(title, prompt, true);
      savedPromptId = saved.id;
      renderSavedPrompts($('qi-saved-list'), p => {
        $('qi-prompt').value = p.text;
        $('qi-prompt').focus();
      });
      setSaveMode(false);
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'danger');
      return;
    }
  }

  const count = parseInt($('qi-count').value) || 1;
  const btn = $('btn-qi-submit');
  btn.loading = true;
  $('qwen-i2i-status').textContent = 'Submitting…';

  const negativePrompt = $('qi-negative').value.trim() || undefined;
  const width = parseInt($('qi-width').value) || 1024;
  const height = parseInt($('qi-height').value) || 1536;

  try {
    addRecent(prompt);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        api.qwenI2iNsfw({
          prompt,
          negativePrompt,
          mainImage: mainImageInfo?.comfyFilename,
          supportImage: supportImageInfo?.comfyFilename,
          width,
          height,
          savedPromptId: i === 0 ? savedPromptId : null,
        })
      )
    );
    close();
    const label = count > 1 ? `${count} jobs queued` : 'Queued';
    toast(savedPromptId ? `${label} — thumbnail will save in background` : `${label} — output will appear in staging`);
  } catch (err) {
    $('qwen-i2i-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
