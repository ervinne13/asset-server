import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

let videoInfo = null;
let imageInfo = null;
let pollTimer = null;

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

// ── Progress rendering ──────────────────────────────────────────────────────────

function stageText(job) {
  const seg = `segment ${job.current}/${job.total}`;
  switch (job.stage) {
    case 'queued':        return 'Starting…';
    case 'generating':    return `Rendering ${seg}…`;
    case 'extracting':    return `Extracting last frame (${seg})…`;
    case 'joining':       return `Joining ${job.total} segments…`;
    case 'joining-audio': return `Joining ${job.total} segments + adding audio…`;
    case 'done':          return `✓ Done — ${job.output ? job.output.split('/').pop() : 'finished'}`;
    default:              return job.stage || 'Working…';
  }
}

function applyJob(job) {
  const progress = $('mc-progress');
  const submit = $('btn-mc-submit');

  if (!job) {
    progress.style.display = 'none';
    submit.style.display = '';
    return;
  }

  const running = job.status === 'running';
  progress.style.display = '';
  submit.style.display = running ? 'none' : '';
  $('mc-progress-spinner').style.display = running ? '' : 'none';

  if (job.status === 'error') {
    $('mc-progress-stage').textContent = `✕ ${job.error || 'Failed'}`;
    $('mc-progress-detail').textContent = 'Raw segments were kept — you can join them manually.';
  } else {
    $('mc-progress-stage').textContent = stageText(job);
    $('mc-progress-detail').textContent = job.warning || (job.audio ? 'Audio: from reference video' : 'Audio: none');
  }

  if (!running) stopPolling();
}

async function poll() {
  try {
    const { job } = await api.mocapStatus();
    applyJob(job);
  } catch { /* transient */ }
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, 4000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Open / close ──────────────────────────────────────────────────────────────

export function openMotionCapturePage() {
  $('motion-capture-status').textContent = '';
  $('btn-mc-submit').loading = false;
  videoInfo = null;
  imageInfo = null;
  updateSlotUI('mc-video-slot', null);
  updateSlotUI('mc-img-slot', null);
  $('motion-capture-page').style.display = 'flex';
  // Resume the live progress view only if a job is actually still running.
  $('mc-progress').style.display = 'none';
  $('btn-mc-submit').style.display = '';
  api.mocapStatus().then(({ job }) => {
    if (job && job.status === 'running') { applyJob(job); startPolling(); }
  }).catch(() => {});
}

export function closeMotionCapturePage() {
  $('motion-capture-page').style.display = 'none';
  stopPolling();
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
  const audio = $('mc-audio').checked;

  const btn = $('btn-mc-submit');
  btn.loading = true;
  $('motion-capture-status').textContent = 'Submitting…';

  try {
    await api.mocap({
      video: videoInfo.comfyFilename,
      image: imageInfo.comfyFilename,
      prompt,
      totalDuration,
      seed,
      audio,
    });
    $('motion-capture-status').textContent = '';
    toast('Started — rendering segments sequentially');
    startPolling();
  } catch (err) {
    $('motion-capture-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
