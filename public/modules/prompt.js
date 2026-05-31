import { state } from './state.js';
import { api } from './api.js';
import { $ } from './helpers.js';

export async function openPromptDialog(item) {
  if (!item) return;

  const content = $('prompt-content');
  content.innerHTML = '<span class="prompt-loading">Loading…</span>';
  $('prompt-dialog').show();

  let prompts, seed;
  try {
    const data = await api.getPrompt(item.path);
    prompts = data.prompts || [];
    seed = data.seed ?? null;
  } catch (err) {
    content.innerHTML = `<span class="prompt-empty">Failed to read image: ${err.message}</span>`;
    return;
  }

  if (!prompts.length && seed == null) {
    content.innerHTML = '<span class="prompt-empty">No workflow data found in this image.</span>';
    return;
  }

  content.innerHTML = '';

  if (seed != null) {
    const seedBlock = document.createElement('div');
    seedBlock.className = 'prompt-seed';
    const seedLabel = document.createElement('span');
    seedLabel.className = 'prompt-block-label';
    seedLabel.textContent = 'Seed';
    const seedValue = document.createElement('span');
    seedValue.className = 'prompt-seed-value';
    seedValue.textContent = seed;
    seedBlock.append(seedLabel, seedValue);
    content.appendChild(seedBlock);
  }

  for (const { title, text } of prompts) {
    const block = document.createElement('div');
    block.className = 'prompt-block';

    const label = document.createElement('span');
    label.className = 'prompt-block-label';
    label.textContent = title;

    const textarea = document.createElement('textarea');
    textarea.className = 'prompt-textarea';
    textarea.readOnly = true;
    textarea.value = text;
    textarea.rows = Math.min(8, Math.max(3, Math.ceil(text.length / 60)));

    block.append(label, textarea);
    content.appendChild(block);
  }
}

// ── Wire up ───────────────────────────────────────────────────────────────────

$('btn-prompt-open').addEventListener('click', () => openPromptDialog(state.selectedFile));
$('btn-prompt-close').addEventListener('click', () => $('prompt-dialog').hide());
