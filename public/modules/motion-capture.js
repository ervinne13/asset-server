import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI, wireSlotDropZone } from './img-picker.js';

let videoInfo = null;
let imageInfo = null;
let pollTimer = null;
let tickTimer = null;
let lastJob = null;

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

wireSlotDropZone('mc-video-slot', 'video', info => { videoInfo = info; });
wireSlotDropZone('mc-img-slot', 'image', info => { imageInfo = info; });

// ── Progress rendering ──────────────────────────────────────────────────────────

function stageText(job) {
  const seg = `segment ${job.current}/${job.total}`;
  switch (job.stage) {
    case 'queued':        return 'Starting…';
    case 'generating':    return `Rendering ${seg}…`;
    case 'trimming':      return `Trimming overlap frames (${seg})…`;
    case 'uploading':     return `Uploading segment to ComfyUI (${seg})…`;
    case 'joining':       return `Joining ${job.total} segments…`;
    case 'joining-audio': return `Joining ${job.total} segments + adding audio…`;
    case 'done':          return `✓ Done — ${job.output ? job.output.split('/').pop() : 'finished'}`;
    default:              return job.stage || 'Working…';
  }
}

function formatDuration(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) return `${hrs}hr ${mins}min`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function renderLog(job) {
  const logs = job.segmentLogs || [];

  const lines = logs.map(e => ({
    text: `${e.segment}/${job.total} generated in ${formatDuration(e.durationMs)}`,
    current: false,
  }));

  if (job.stage === 'generating' && logs.length < job.total) {
    const elapsed = job.segmentStartedAt ? Date.now() - job.segmentStartedAt : 0;
    lines.push({
      text: `${job.current}/${job.total} generating (${formatDuration(elapsed)} so far)`,
      current: true,
    });
  }

  $('mc-log').innerHTML = lines
    .map(l => `<div class="mc-log-entry${l.current ? ' mc-log-entry-current' : ''}">${l.text}</div>`)
    .join('');

  const remaining = job.total - logs.length;
  const etaEl = $('mc-eta');
  if (remaining > 0 && job.status === 'running') {
    const avgMs = logs.length > 0
      ? logs.reduce((sum, e) => sum + e.durationMs, 0) / logs.length
      : 15 * 60 * 1000;
    const elapsed = job.segmentStartedAt && job.stage === 'generating'
      ? Date.now() - job.segmentStartedAt : 0;
    const etaMs = Math.max(0, avgMs - elapsed) + (remaining - 1) * avgMs;
    etaEl.textContent = `ETA: ~${formatDuration(etaMs)}`;
  } else {
    etaEl.textContent = '';
  }
}

function renderQueue(queue, avgMs = null) {
  const details = $('mc-queue-details');
  if (!queue || queue.length === 0) {
    details.style.display = 'none';
    return;
  }
  details.style.display = '';
  $('mc-queue-items').innerHTML = queue.map((entry, i) => {
    const name = (entry.video || '').split('/').pop() || 'unknown';
    const etaStr = avgMs ? ` · ~${formatDuration(entry.total * avgMs)}` : '';
    return `<div class="mc-queue-item">${i + 1}. ${entry.total} seg · ${name}${etaStr}</div>`;
  }).join('');
}

function applyJob(job, queue = []) {
  lastJob = job;
  const progress = $('mc-progress');
  const submit = $('btn-mc-submit');

  if (!job) {
    progress.style.display = 'none';
    submit.style.display = '';
    renderQueue([]);
    return;
  }

  const running = job.status === 'running';
  progress.style.display = '';
  submit.style.display = '';
  $('mc-progress-spinner').style.display = running ? '' : 'none';

  if (job.status === 'error') {
    $('mc-progress-stage').textContent = `✕ ${job.error || 'Failed'}`;
    $('mc-progress-detail').textContent = 'Raw segments were kept — you can join them manually.';
  } else {
    $('mc-progress-stage').textContent = stageText(job);
    const audioNote = job.warning || (job.audio ? 'Audio: from reference video' : 'Audio: none');
    const queueNote = queue.length > 0 ? ` · ${queue.length} more in queue` : '';
    $('mc-progress-detail').textContent = audioNote + queueNote;
  }

  renderLog(job);
  const avgMs = job.segmentLogs?.length > 0
    ? job.segmentLogs.reduce((sum, e) => sum + e.durationMs, 0) / job.segmentLogs.length
    : null;
  renderQueue(queue, avgMs);

  if (!running) stopPolling();
}

async function poll() {
  try {
    const { job, queue } = await api.mocapStatus();
    applyJob(job, queue);
  } catch { /* transient */ }
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, 4000);
  tickTimer = setInterval(() => {
    if (lastJob?.stage === 'generating') renderLog(lastJob);
  }, 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
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
  $('mc-progress').style.display = 'none';
  $('mc-log').innerHTML = '';
  $('mc-eta').textContent = '';
  $('btn-mc-submit').style.display = '';
  api.mocapStatus().then(({ job, queue }) => {
    if (job && (job.status === 'running' || job.status === 'done' || job.status === 'error')) {
      applyJob(job, queue);
      if (job.status === 'running') startPolling();
    }
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

// ── Duration toggle ───────────────────────────────────────────────────────────

$('mc-full-duration').addEventListener('sl-change', e => {
  $('mc-duration-row').style.display = e.target.checked ? 'none' : '';
});

// ── FPS → frame count sync ────────────────────────────────────────────────────

$('mc-fps').addEventListener('change', () => {
  const fps = Math.max(1, parseInt($('mc-fps').value) || 16);
  // 4n+1 nearest to 5s worth of frames
  $('mc-frame-count').value = Math.floor(5 * fps / 4) * 4 + 1;
});

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-mc-submit').addEventListener('click', async () => {
  if (!videoInfo) { toast('Select a reference video', 'warning'); return; }
  if (!imageInfo) { toast('Select a reference image', 'warning'); return; }

  const fullDuration = $('mc-full-duration').checked;
  let totalFrames;
  if (!fullDuration) {
    totalFrames = parseInt($('mc-total-frames').value);
    if (!totalFrames || totalFrames < 1) { toast('Enter total frames', 'warning'); return; }
  }

  const startFrame = parseInt($('mc-start-frame').value) || 0;
  const fps = parseInt($('mc-fps').value) || 16;
  const prompt = $('mc-prompt').value.trim() || undefined;
  const seedVal = $('mc-seed').value.trim();
  const seed = seedVal ? parseInt(seedVal) : undefined;
  const audio = $('mc-audio').checked;
  const frameCountVal = parseInt($('mc-frame-count').value);
  const frameCount = (frameCountVal && frameCountVal >= 1) ? frameCountVal : 81;
  const replacementMode = $('mc-replacement-mode').checked || undefined;

  const btn = $('btn-mc-submit');
  btn.loading = true;
  $('motion-capture-status').textContent = 'Submitting…';

  try {
    const submitResult = await api.mocap({
      video: videoInfo.comfyFilename,
      image: imageInfo.comfyFilename,
      prompt,
      totalFrames,
      fps,
      startFrame: startFrame || undefined,
      frameCount,
      seed,
      audio,
      replacementMode,
    });
    $('motion-capture-status').textContent = '';
    if (submitResult.queued) {
      toast(`Queued at position ${submitResult.position} — will start automatically`);
    } else {
      toast('Started — rendering segments sequentially');
    }
    startPolling();
  } catch (err) {
    $('motion-capture-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
