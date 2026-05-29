import { api } from './api.js';
import { $, toast } from './helpers.js';
import { loadSavedPrompts, renderSavedPrompts, saveNewPrompt } from './saved-prompts.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

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

// ── Image slots ───────────────────────────────────────────────────────────────

$('qi-main-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { mainImageInfo = info; updateSlotUI('qi-main-img-slot', info); },
    onClear: () => { mainImageInfo = null; updateSlotUI('qi-main-img-slot', null); },
  });
});

$('qi-support-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { supportImageInfo = info; updateSlotUI('qi-support-img-slot', info); },
    onClear: () => { supportImageInfo = null; updateSlotUI('qi-support-img-slot', null); },
  });
});

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

$('qi-clear').addEventListener('click', () => {
  $('qi-prompt').value = '';
  $('qi-prompt').focus();
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
    closeQwenPage();
    const label = count > 1 ? `${count} jobs queued` : 'Queued';
    toast(savedPromptId ? `${label} — thumbnail will save in background` : `${label} — output will appear in staging`);
  } catch (err) {
    $('qwen-i2i-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
