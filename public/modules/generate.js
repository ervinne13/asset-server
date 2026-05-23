import { state } from './state.js';
import { api } from './api.js';
import { $, toast } from './helpers.js';

const DEFAULT_NEGATIVE = 'extra limbs, bad hands, duplicate body parts, distorted anatomy, low quality, blurry face, stiff pose, exaggerated breasts, explicit nudity, exposed genitals, malformed fingers, text, watermark, logo, floating objects, incorrect perspective, poorly integrated subject, overexposed lighting, cartoonish proportions';

function closePage() {
  $('generate-page').style.display = 'none';
}

export function openGenerateDialog(item) {
  if (!item) return;
  $('gen-img').src = api.fileUrl(item.path, item.mtime);
  $('gen-positive').value = '';
  $('gen-negative').value = DEFAULT_NEGATIVE;
  $('gen-seed').value = '';
  $('gen-status').textContent = '';
  $('btn-gen-submit').loading = false;
  $('generate-page').style.display = 'flex';
  setTimeout(() => $('gen-positive').focus(), 120);
}

$('gen-back').addEventListener('click', closePage);

$('btn-gen-submit').addEventListener('click', async () => {
  const item = state.selectedFile;
  if (!item) return;
  const positiveBody = $('gen-positive').value.trim();
  if (!positiveBody) { toast('Enter an edit prompt', 'warning'); return; }
  const negativePrompt = $('gen-negative').value.trim();
  const seedRaw = $('gen-seed').value.trim();
  const seed = seedRaw ? parseInt(seedRaw, 10) : null;

  const btn = $('btn-gen-submit');
  btn.loading = true;
  $('gen-status').textContent = 'Submitting…';

  try {
    await api.generate({ filePath: item.path, positiveBody, negativePrompt, seed });
    closePage();
    toast('Queued — output will appear in staging');
  } catch (err) {
    $('gen-status').textContent = '';
    toast(`Generate failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
