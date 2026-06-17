import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

let videoInfo = null;
let imageInfo = null;

// ── Slots ──────────────────────────────────────────────────────────────────────

$('mc-video-slot').addEventListener('click', () => {
  openImagePicker({
    kind: 'video',
    onSelect: info => { videoInfo = info; updateSlotUI('mc-video-slot', info); },
    onClear: () => { videoInfo = null; updateSlotUI('mc-video-slot', null); },
  });
});

$('mc-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { imageInfo = info; updateSlotUI('mc-img-slot', info); },
    onClear: () => { imageInfo = null; updateSlotUI('mc-img-slot', null); },
  });
});

// ── Open / close ──────────────────────────────────────────────────────────────

export function openMotionCapturePage() {
  $('motion-capture-status').textContent = '';
  $('btn-mc-submit').loading = false;
  videoInfo = null;
  imageInfo = null;
  updateSlotUI('mc-video-slot', null);
  updateSlotUI('mc-img-slot', null);
  $('motion-capture-page').style.display = 'flex';
}

export function closeMotionCapturePage() {
  $('motion-capture-page').style.display = 'none';
}

$('btn-motion-capture').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'motion-capture' }, '', '/motion-capture');
  openMotionCapturePage();
});

$('motion-capture-back').addEventListener('click', () => history.back());

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-mc-submit').addEventListener('click', async () => {
  if (!videoInfo) { toast('Select a reference video', 'warning'); return; }
  if (!imageInfo) { toast('Select a reference image', 'warning'); return; }

  const totalDuration = parseInt($('mc-duration').value);
  if (!totalDuration || totalDuration < 1) { toast('Enter a total duration (seconds)', 'warning'); return; }

  const prompt = $('mc-prompt').value.trim() || undefined;
  const seedVal = $('mc-seed').value.trim();
  const seed = seedVal ? parseInt(seedVal) : undefined;

  const btn = $('btn-mc-submit');
  btn.loading = true;
  $('motion-capture-status').textContent = 'Submitting…';

  try {
    const { segments } = await api.mocap({
      video: videoInfo.comfyFilename,
      image: imageInfo.comfyFilename,
      prompt,
      totalDuration,
      seed,
    });
    closeMotionCapturePage();
    toast(segments > 1 ? `${segments} jobs queued — clips will appear in staging` : 'Queued — clip will appear in staging');
  } catch (err) {
    $('motion-capture-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
