import { api } from './api.js';
import { $, toast } from './helpers.js';

function open() {
  $('zit-status').textContent = '';
  $('btn-zit-submit').loading = false;
  $('zit-page').style.display = 'flex';
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

$('btn-zit-submit').addEventListener('click', async () => {
  const prompt = $('zit-prompt').value.trim();
  if (!prompt) { toast('Enter a prompt', 'warning'); return; }

  const btn = $('btn-zit-submit');
  btn.loading = true;
  $('zit-status').textContent = 'Submitting…';

  try {
    await api.zitTxt2Img(prompt);
    close();
    toast('Queued — output will appear in staging');
  } catch (err) {
    $('zit-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
