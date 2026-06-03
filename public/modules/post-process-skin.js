import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

let imageInfo = null;

// ── Image slot ────────────────────────────────────────────────────────────────

$('pps-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { imageInfo = info; updateSlotUI('pps-img-slot', info); },
    onClear: () => { imageInfo = null; updateSlotUI('pps-img-slot', null); },
  });
});

// ── Denoise label sync ────────────────────────────────────────────────────────

$('pps-denoise').addEventListener('input', () => {
  $('pps-denoise-val').textContent = $('pps-denoise').value;
});

// ── Open / close ──────────────────────────────────────────────────────────────

export function openPostProcessSkinPage() {
  $('pps-status').textContent = '';
  $('btn-pps-submit').loading = false;
  imageInfo = null;
  updateSlotUI('pps-img-slot', null);
  $('pps-denoise').value = 15;
  $('pps-denoise-val').textContent = '15';
  $('post-process-skin-page').style.display = 'flex';
}

export function closePostProcessSkinPage() {
  $('post-process-skin-page').style.display = 'none';
}

$('btn-post-process-skin').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'post-process-skin' }, '', '/post-process-skin');
  openPostProcessSkinPage();
});

$('pps-back').addEventListener('click', () => history.back());

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-pps-submit').addEventListener('click', async () => {
  if (!imageInfo) { toast('Select an input image', 'warning'); return; }

  const denoise = parseInt($('pps-denoise').value);
  const seedVal = $('pps-seed').value.trim();
  const seed = seedVal ? parseInt(seedVal) : undefined;

  const btn = $('btn-pps-submit');
  btn.loading = true;
  $('pps-status').textContent = 'Submitting…';

  try {
    await api.postProcessSkin({ image: imageInfo.comfyFilename, denoise, seed });
    closePostProcessSkinPage();
    toast('Queued — output will appear in staging');
  } catch (err) {
    $('pps-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
