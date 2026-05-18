import { state } from './state.js';
import { api } from './api.js';
import { $ } from './helpers.js';

let vocab = null;
let currentPath = null;
let currentTags = [];

export async function openTagDialog(item) {
  if (!item) return;
  currentPath = item.path;
  try {
    const data = await api.getTags(item.path);
    currentTags = [...(data.tags || [])];
  } catch {
    currentTags = [];
  }
  renderChips();
  $('tag-input').value = '';
  hideSuggestions();
  $('tag-dialog').show();
  setTimeout(() => $('tag-input').focus(), 100);
  ensureVocab();
}

function renderChips() {
  const wrap = $('tag-chips');
  wrap.innerHTML = '';
  if (!currentTags.length) {
    const empty = document.createElement('span');
    empty.className = 'tag-empty';
    empty.textContent = 'No tags yet';
    wrap.appendChild(empty);
    return;
  }
  for (const tag of currentTags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = tag;
    const rm = document.createElement('button');
    rm.className = 'tag-chip-remove';
    rm.title = `Remove ${tag}`;
    rm.textContent = '×';
    rm.addEventListener('click', () => removeTag(tag));
    chip.append(label, rm);
    wrap.appendChild(chip);
  }
}

async function addTag(raw) {
  const tag = raw.replace(/,/g, '').trim();
  if (!tag || currentTags.includes(tag)) return;
  currentTags = [...currentTags, tag];
  renderChips();
  await saveTags();
}

async function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderChips();
  await saveTags();
}

async function saveTags() {
  try {
    await api.saveTags(currentPath, currentTags);
  } catch (err) {
    console.error('Tag save failed:', err);
  }
}

async function ensureVocab() {
  if (vocab !== null) return;
  try {
    const data = await api.tagVocab();
    vocab = data.tags || [];
  } catch {
    vocab = [];
  }
}

function updateSuggestions(input) {
  if (!vocab || !input.trim()) { hideSuggestions(); return; }
  const lower = input.toLowerCase();
  const matches = vocab
    .filter(t => t.toLowerCase().includes(lower) && !currentTags.includes(t))
    .slice(0, 8);
  const box = $('tag-suggestions');
  if (!matches.length) { hideSuggestions(); return; }
  box.innerHTML = '';
  for (const t of matches) {
    const row = document.createElement('div');
    row.className = 'tag-suggestion-item';
    row.textContent = t;
    row.addEventListener('mousedown', e => {
      e.preventDefault();
      addTag(t);
      $('tag-input').value = '';
      hideSuggestions();
    });
    box.appendChild(row);
  }
  box.style.display = 'block';
}

function hideSuggestions() {
  $('tag-suggestions').style.display = 'none';
}

// ── Wire up events ────────────────────────────────────────────────────────────

$('btn-tag-open').addEventListener('click', () => openTagDialog(state.selectedFile));

const input = $('tag-input');
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(input.value);
    input.value = '';
    hideSuggestions();
  } else if (e.key === 'Escape') {
    $('tag-dialog').hide();
  }
});
input.addEventListener('input', () => updateSuggestions(input.value));
input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

$('btn-tag-done').addEventListener('click', () => $('tag-dialog').hide());
