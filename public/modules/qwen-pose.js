import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

let imageInfo = null;

// ── Image slot ────────────────────────────────────────────────────────────────

$('qp-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { imageInfo = info; updateSlotUI('qp-img-slot', info); },
    onClear: () => { imageInfo = null; updateSlotUI('qp-img-slot', null); },
  });
});

// ── Open / close ──────────────────────────────────────────────────────────────

export function openQwenPosePage() {
  $('qwen-pose-status').textContent = '';
  $('btn-qp-submit').loading = false;
  imageInfo = null;
  updateSlotUI('qp-img-slot', null);
  $('qwen-pose-page').style.display = 'flex';
}

export function closeQwenPosePage() {
  $('qwen-pose-page').style.display = 'none';
}

$('btn-qwen-pose').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'qwen-pose' }, '', '/qwen-pose');
  openQwenPosePage();
});

$('qwen-pose-back').addEventListener('click', () => history.back());

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-qp-submit').addEventListener('click', async () => {
  if (!imageInfo) { toast('Select an input image', 'warning'); return; }

  const poseIndex = parseInt($('qp-pose-index').value);
  const negativePrompt = $('qp-negative').value.trim() || undefined;
  const seedVal = $('qp-seed').value.trim();
  const seed = seedVal ? parseInt(seedVal) : undefined;
  const count = parseInt($('qp-count').value) || 1;

  const btn = $('btn-qp-submit');
  btn.loading = true;
  $('qwen-pose-status').textContent = 'Submitting…';

  try {
    await Promise.all(
      Array.from({ length: count }, () =>
        api.qwenPose({ image: imageInfo.comfyFilename, poseIndex, negativePrompt, seed })
      )
    );
    closeQwenPosePage();
    toast(count > 1 ? `${count} jobs queued — outputs will appear in staging` : 'Queued — output will appear in staging');
  } catch (err) {
    $('qwen-pose-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
