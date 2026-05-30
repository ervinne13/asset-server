import { api } from './api.js';
import { $, toast } from './helpers.js';
import { loadSavedPrompts, renderSavedPrompts, saveNewPrompt, makeRecentPrompts } from './saved-prompts.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

let saveMode = false;
let imageInfo = null;

const { addRecent, renderRecent } = makeRecentPrompts('ltx-i2v-recent-prompts', 'ltx-recent-section', 'ltx-recent-list', 'ltx-prompt');

// ── Image slot ────────────────────────────────────────────────────────────────

$('ltx-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { imageInfo = info; updateSlotUI('ltx-img-slot', info); },
    onClear: () => { imageInfo = null; updateSlotUI('ltx-img-slot', null); },
  });
});

// ── Save mode ─────────────────────────────────────────────────────────────────

function setSaveMode(on) {
  saveMode = on;
  $('ltx-title-row').style.display = on ? '' : 'none';
  const btn = $('btn-ltx-submit');
  if (on) {
    btn.innerHTML = '<sl-icon slot="prefix" name="bookmark-plus"></sl-icon>Save & Generate';
  } else {
    btn.innerHTML = '<sl-icon slot="prefix" name="film"></sl-icon>Generate';
    $('ltx-title').value = '';
  }
}

// ── Open / close ──────────────────────────────────────────────────────────────

export async function openLtxPage() {
  $('ltx-i2v-status').textContent = '';
  $('btn-ltx-submit').loading = false;
  setSaveMode(false);
  imageInfo = null;
  updateSlotUI('ltx-img-slot', null);
  $('ltx-i2v-page').style.display = 'flex';
  await loadSavedPrompts();
  renderSavedPrompts($('ltx-saved-list'), p => {
    $('ltx-prompt').value = p.text;
    $('ltx-prompt').focus();
  });
  renderRecent();
  setTimeout(() => $('ltx-prompt').focus(), 120);
}

export function closeLtxPage() {
  $('ltx-i2v-page').style.display = 'none';
}

$('btn-ltx-i2v').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'ltx' }, '', '/ltx-i2v');
  openLtxPage();
});

$('ltx-i2v-back').addEventListener('click', () => history.back());

$('ltx-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('ltx-prompt').value = text;
    $('ltx-prompt').focus();
  } catch {
    toast('Clipboard access denied', 'warning');
  }
});

$('ltx-clear').addEventListener('click', () => {
  $('ltx-prompt').value = '';
  $('ltx-prompt').focus();
});

// ── Dropdown ──────────────────────────────────────────────────────────────────

const caretIcon = $('ltx-caret-icon');
$('ltx-submit-menu').addEventListener('sl-show', () => { caretIcon.name = 'chevron-up'; });
$('ltx-submit-menu').addEventListener('sl-hide', () => { caretIcon.name = 'chevron-down'; });

$('ltx-submit-menu').addEventListener('sl-select', e => {
  if (e.detail.item.id === 'ltx-menu-save-generate') {
    setSaveMode(true);
    setTimeout(() => $('ltx-title').focus(), 50);
  }
});

$('ltx-save-mode-cancel').addEventListener('click', () => setSaveMode(false));

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-ltx-submit').addEventListener('click', async () => {
  const prompt = $('ltx-prompt').value.trim();
  if (!prompt) { toast('Enter a prompt', 'warning'); return; }
  if (!imageInfo) { toast('Select an input image', 'warning'); return; }

  let savedPromptId = null;
  if (saveMode) {
    const title = $('ltx-title').value.trim();
    if (!title) { toast('Enter a title', 'warning'); $('ltx-title').focus(); return; }
    try {
      const saved = await saveNewPrompt(title, prompt, false);
      savedPromptId = saved.id;
      renderSavedPrompts($('ltx-saved-list'), p => {
        $('ltx-prompt').value = p.text;
        $('ltx-prompt').focus();
      });
      setSaveMode(false);
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'danger');
      return;
    }
  }

  const count = parseInt($('ltx-count').value) || 1;
  const btn = $('btn-ltx-submit');
  btn.loading = true;
  $('ltx-i2v-status').textContent = 'Submitting…';

  try {
    addRecent(prompt);
    const duration = parseInt($('ltx-duration').value) || 5;
    await Promise.all(
      Array.from({ length: count }, () =>
        api.ltxI2v({ prompt, image: imageInfo.comfyFilename, duration })
      )
    );
    closeLtxPage();
    const label = count > 1 ? `${count} jobs queued` : 'Queued';
    toast(savedPromptId ? `${label} — prompt saved` : `${label} — video will appear in staging`);
  } catch (err) {
    $('ltx-i2v-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
