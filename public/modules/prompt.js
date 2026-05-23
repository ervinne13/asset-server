import { state } from './state.js';
import { api } from './api.js';
import { $, toast } from './helpers.js';

export async function openPromptDialog(item) {
  if (!item) return;

  const content = $('prompt-content');
  content.innerHTML = '<span class="prompt-loading">Loading…</span>';
  $('prompt-dialog').show();

  let prompts;
  try {
    const data = await api.getPrompt(item.path);
    prompts = data.prompts || [];
  } catch (err) {
    content.innerHTML = `<span class="prompt-empty">Failed to read image: ${err.message}</span>`;
    return;
  }

  if (!prompts.length) {
    content.innerHTML = '<span class="prompt-empty">No workflow data found in this image.</span>';
    return;
  }

  content.innerHTML = '';
  for (const { title, text } of prompts) {
    const block = document.createElement('div');
    block.className = 'prompt-block';

    const header = document.createElement('div');
    header.className = 'prompt-block-header';

    const label = document.createElement('span');
    label.className = 'prompt-block-label';
    label.textContent = title;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'prompt-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      } catch {
        toast('Copy failed — clipboard not available', 'warning');
      }
    });

    header.append(label, copyBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'prompt-textarea';
    textarea.readOnly = true;
    textarea.value = text;
    textarea.rows = Math.min(8, Math.max(3, Math.ceil(text.length / 60)));

    block.append(header, textarea);
    content.appendChild(block);
  }
}

// ── Wire up ───────────────────────────────────────────────────────────────────

$('btn-prompt-open').addEventListener('click', () => openPromptDialog(state.selectedFile));
$('btn-prompt-close').addEventListener('click', () => $('prompt-dialog').hide());
