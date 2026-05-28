import { api } from './api.js';
import { $, toast } from './helpers.js';

const RECENT_KEY = 'zit-recent-prompts';
const RECENT_MAX = 10;

let saveMode = false;
let savedPrompts = [];

// ── Recent prompts (localStorage) ─────────────────────────────────────────────

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

function addRecent(text) {
  const list = [text, ...getRecent().filter(t => t !== text)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

// ── Saved prompts ─────────────────────────────────────────────────────────────

async function loadSavedPrompts() {
  try {
    savedPrompts = await api.zitPromptsList();
  } catch {
    savedPrompts = [];
  }
  renderSaved();
}

function renderSaved() {
  const list = $('zit-saved-list');
  if (!savedPrompts.length) {
    list.innerHTML = '<span class="zit-empty">No saved prompts yet.</span>';
    return;
  }
  list.innerHTML = '';
  for (const p of savedPrompts) {
    const item = document.createElement('div');
    item.className = 'zit-saved-item';
    item.dataset.id = p.id;

    const thumb = document.createElement('div');
    thumb.className = 'zit-saved-thumb';
    if (p.imageFile) {
      const img = document.createElement('img');
      img.src = `/api/zit-prompts/${p.id}/image?t=${Date.now()}`;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<sl-icon name="image"></sl-icon>';
      thumb.classList.add('zit-saved-thumb--empty');
    }
    item.appendChild(thumb);

    const title = document.createElement('span');
    title.className = 'zit-saved-title';
    title.textContent = p.title;
    item.appendChild(title);

    const del = document.createElement('button');
    del.className = 'zit-saved-delete';
    del.title = 'Delete saved prompt';
    del.innerHTML = '&times;';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${p.title}"?`)) return;
      try {
        await api.zitPromptsDelete(p.id);
        savedPrompts = savedPrompts.filter(s => s.id !== p.id);
        renderSaved();
      } catch (err) {
        toast(`Delete failed: ${err.message}`, 'danger');
      }
    });
    item.appendChild(del);

    item.addEventListener('click', () => {
      $('zit-prompt').value = p.text;
      $('zit-prompt').focus();
    });

    list.appendChild(item);
  }
}

function renderRecent() {
  const recent = getRecent();
  const section = $('zit-recent-section');
  const list = $('zit-recent-list');
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  for (const text of recent) {
    const item = document.createElement('div');
    item.className = 'zit-recent-item';
    item.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
    item.title = text;
    item.addEventListener('click', () => {
      $('zit-prompt').value = text;
      $('zit-prompt').focus();
    });
    list.appendChild(item);
  }
}

// ── Save mode ─────────────────────────────────────────────────────────────────

function setSaveMode(on) {
  saveMode = on;
  $('zit-title-row').style.display = on ? '' : 'none';
  const btn = $('btn-zit-submit');
  if (on) {
    btn.innerHTML = '<sl-icon slot="prefix" name="bookmark-plus"></sl-icon>Save & Generate';
  } else {
    btn.innerHTML = '<sl-icon slot="prefix" name="stars"></sl-icon>Generate';
    $('zit-title').value = '';
  }
}

// ── Open / close ──────────────────────────────────────────────────────────────

function open() {
  $('zit-status').textContent = '';
  $('btn-zit-submit').loading = false;
  setSaveMode(false);
  $('zit-page').style.display = 'flex';
  loadSavedPrompts();
  renderRecent();
  setTimeout(() => $('zit-prompt').focus(), 120);
}

function close() {
  $('zit-page').style.display = 'none';
}

$('btn-zit-txt2img').addEventListener('click', open);
$('zit-back').addEventListener('click', close);

$('zit-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('zit-prompt').value = text;
    $('zit-prompt').focus();
  } catch {
    toast('Clipboard access denied', 'warning');
  }
});

// ── Dropdown ──────────────────────────────────────────────────────────────────

const caretIcon = $('zit-caret-icon');
$('zit-submit-menu').addEventListener('sl-show', () => { caretIcon.name = 'chevron-up'; });
$('zit-submit-menu').addEventListener('sl-hide', () => { caretIcon.name = 'chevron-down'; });

$('zit-submit-menu').addEventListener('sl-select', (e) => {
  if (e.detail.item.id === 'zit-menu-save-generate') {
    setSaveMode(true);
    setTimeout(() => $('zit-title').focus(), 50);
  }
});

$('zit-save-mode-cancel').addEventListener('click', () => setSaveMode(false));

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-zit-submit').addEventListener('click', async () => {
  const prompt = $('zit-prompt').value.trim();
  if (!prompt) { toast('Enter a prompt', 'warning'); return; }

  let savedPromptId = null;
  if (saveMode) {
    const title = $('zit-title').value.trim();
    if (!title) { toast('Enter a title for the saved prompt', 'warning'); $('zit-title').focus(); return; }
    try {
      const saved = await api.zitPromptsSave({ title, text: prompt });
      savedPromptId = saved.id;
      savedPrompts.push(saved);
      savedPrompts.sort((a, b) => a.title.localeCompare(b.title));
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'danger');
      return;
    }
  }

  const count = parseInt($('zit-count').value) || 1;
  const btn = $('btn-zit-submit');
  btn.loading = true;
  $('zit-status').textContent = 'Submitting…';

  try {
    addRecent(prompt);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        api.zitTxt2Img(prompt, undefined, i === 0 ? savedPromptId : null)
      )
    );
    close();
    const label = count > 1 ? `${count} jobs queued` : 'Queued';
    toast(savedPromptId ? `${label} — thumbnail will save in background` : `${label} — output will appear in staging`);
  } catch (err) {
    $('zit-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
