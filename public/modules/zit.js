import { api } from './api.js';
import { $, toast } from './helpers.js';
import { loadSavedPrompts, renderSavedPrompts, saveNewPrompt } from './saved-prompts.js';

const RECENT_KEY = 'zit-recent-prompts';
const RECENT_MAX = 10;

let saveMode = false;

// ── Recent prompts (localStorage) ─────────────────────────────────────────────

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

function addRecent(text) {
  const list = [text, ...getRecent().filter(t => t !== text)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
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

export async function openZitPage() {
  $('zit-status').textContent = '';
  $('btn-zit-submit').loading = false;
  setSaveMode(false);
  $('zit-page').style.display = 'flex';
  await loadSavedPrompts();
  renderSavedPrompts($('zit-saved-list'), p => {
    $('zit-prompt').value = p.text;
    $('zit-prompt').focus();
  });
  renderRecent();
  setTimeout(() => $('zit-prompt').focus(), 120);
}

export function closeZitPage() {
  $('zit-page').style.display = 'none';
}

$('btn-zit-txt2img').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'zit' }, '', '/zit');
  openZitPage();
});

$('zit-back').addEventListener('click', () => history.back());

$('zit-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('zit-prompt').value = text;
    $('zit-prompt').focus();
  } catch {
    toast('Clipboard access denied', 'warning');
  }
});

$('zit-clear').addEventListener('click', () => {
  $('zit-prompt').value = '';
  $('zit-prompt').focus();
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
      const saved = await saveNewPrompt(title, prompt, false);
      savedPromptId = saved.id;
      renderSavedPrompts($('zit-saved-list'), p => {
        $('zit-prompt').value = p.text;
        $('zit-prompt').focus();
      });
      setSaveMode(false);
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'danger');
      return;
    }
  }

  const count = parseInt($('zit-count').value) || 1;
  const dimVal = $('zit-dimensions').value;
  const [width, height] = dimVal.split('x').map(Number);
  const btn = $('btn-zit-submit');
  btn.loading = true;
  $('zit-status').textContent = 'Submitting…';

  try {
    addRecent(prompt);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        api.zitTxt2Img(prompt, undefined, i === 0 ? savedPromptId : null, width, height)
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
