import { api } from './api.js';
import { toast } from './helpers.js';

let savedPrompts = [];

export async function loadSavedPrompts() {
  try { savedPrompts = await api.savedPromptsList(); }
  catch { savedPrompts = []; }
  return savedPrompts;
}

export function getSavedPrompts() { return [...savedPrompts]; }

export function renderSavedPrompts(listEl, onSelect) {
  if (!savedPrompts.length) {
    listEl.innerHTML = '<span class="zit-empty">No saved prompts yet.</span>';
    return;
  }
  listEl.innerHTML = '';
  for (const p of savedPrompts) {
    const item = document.createElement('div');
    item.className = 'zit-saved-item';
    item.dataset.id = p.id;

    const thumb = document.createElement('div');
    thumb.className = 'zit-saved-thumb';
    if (p.imageFile) {
      const img = document.createElement('img');
      img.src = `/api/saved-prompts/${p.id}/image?t=${Date.now()}`;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<sl-icon name="image"></sl-icon>';
      thumb.classList.add('zit-saved-thumb--empty');
    }
    item.appendChild(thumb);

    const mid = document.createElement('div');
    mid.className = 'zit-saved-mid';

    const titleRow = document.createElement('div');
    titleRow.className = 'zit-saved-title-row';

    const titleEl = document.createElement('span');
    titleEl.className = 'zit-saved-title';
    titleEl.textContent = p.title;
    titleRow.appendChild(titleEl);

    if (p.nsfw) {
      const pill = document.createElement('span');
      pill.className = 'nsfw-pill';
      pill.textContent = 'NSFW';
      titleRow.appendChild(pill);
    }

    mid.appendChild(titleRow);
    item.appendChild(mid);

    const del = document.createElement('button');
    del.className = 'zit-saved-delete';
    del.title = 'Delete saved prompt';
    del.innerHTML = '&times;';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${p.title}"?`)) return;
      try {
        await api.savedPromptsDelete(p.id);
        savedPrompts = savedPrompts.filter(s => s.id !== p.id);
        renderSavedPrompts(listEl, onSelect);
      } catch (err) {
        toast(`Delete failed: ${err.message}`, 'danger');
      }
    });
    item.appendChild(del);

    item.addEventListener('click', () => onSelect(p));
    listEl.appendChild(item);
  }
}

export function makeRecentPrompts(storageKey, sectionId, listId, inputId) {
  const MAX = 10;
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; }
  }
  function addRecent(text) {
    const list = [text, ...getRecent().filter(t => t !== text)].slice(0, MAX);
    localStorage.setItem(storageKey, JSON.stringify(list));
  }
  function renderRecent() {
    const recent = getRecent();
    const section = document.getElementById(sectionId);
    const list = document.getElementById(listId);
    if (!recent.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    list.innerHTML = '';
    for (const text of recent) {
      const item = document.createElement('div');
      item.className = 'recent-prompt-item';
      item.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
      item.title = text;
      item.addEventListener('click', () => {
        const input = document.getElementById(inputId);
        input.value = text;
        input.focus();
      });
      list.appendChild(item);
    }
  }
  return { addRecent, renderRecent };
}

export async function saveNewPrompt(title, text, nsfw = false) {
  const saved = await api.savedPromptsSave({ title, text, nsfw });
  savedPrompts.push(saved);
  savedPrompts.sort((a, b) => a.title.localeCompare(b.title));
  return saved;
}
