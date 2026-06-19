import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI } from './img-picker.js';

let videoInfo = null;
let imageInfo = null;
let pollTimer = null;
let tickTimer = null;
let lastJob = null;

// ── Slots ──────────────────────────────────────────────────────────────────────

$('mc2-video-slot').addEventListener('click', () => {
  openImagePicker({
    kind: 'video',
    onSelect: info => { videoInfo = info; updateSlotUI('mc2-video-slot', info); },
    onClear: () => { videoInfo = null; updateSlotUI('mc2-video-slot', null); },
  });
});

$('mc2-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { imageInfo = info; updateSlotUI('mc2-img-slot', info); },
    onClear: () => { imageInfo = null; updateSlotUI('mc2-img-slot', null); },
  });
});

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

  $('mc2-log').innerHTML = lines
    .map(l => `<div class="mc-log-entry${l.current ? ' mc-log-entry-current' : ''}">${l.text}</div>`)
    .join('');

  const remaining = job.total - logs.length;
  const etaEl = $('mc2-eta');
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
  const details = $('mc2-queue-details');
  if (!queue || queue.length === 0) {
    details.style.display = 'none';
    return;
  }
  details.style.display = '';
  $('mc2-queue-items').innerHTML = queue.map((entry, i) => {
    const name = (entry.video || '').split('/').pop() || 'unknown';
    const etaStr = avgMs ? ` · ~${formatDuration(entry.total * avgMs)}` : '';
    return `<div class="mc-queue-item">${i + 1}. ${entry.total} seg · ${name}${etaStr}</div>`;
  }).join('');
}

function applyJob(job, queue = []) {
  lastJob = job;
  const progress = $('mc2-progress');
  const submit = $('btn-mc2-submit');

  if (!job) {
    progress.style.display = 'none';
    submit.style.display = '';
    renderQueue([]);
    return;
  }

  const running = job.status === 'running';
  progress.style.display = '';
  submit.style.display = '';
  $('mc2-progress-spinner').style.display = running ? '' : 'none';

  if (job.status === 'error') {
    $('mc2-progress-stage').textContent = `✕ ${job.error || 'Failed'}`;
    $('mc2-progress-detail').textContent = 'Raw segments were kept — you can join them manually.';
  } else {
    $('mc2-progress-stage').textContent = stageText(job);
    const audioNote = job.warning || (job.audio ? 'Audio: from reference video' : 'Audio: none');
    const queueNote = queue.length > 0 ? ` · ${queue.length} more in queue` : '';
    $('mc2-progress-detail').textContent = audioNote + queueNote;
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
    const { job, queue } = await api.mocap2Status();
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

export function openMotionCapture2Page() {
  $('motion-capture2-status').textContent = '';
  $('btn-mc2-submit').loading = false;
  videoInfo = null;
  imageInfo = null;
  updateSlotUI('mc2-video-slot', null);
  updateSlotUI('mc2-img-slot', null);
  $('motion-capture2-page').style.display = 'flex';
  $('mc2-progress').style.display = 'none';
  $('mc2-log').innerHTML = '';
  $('mc2-eta').textContent = '';
  $('btn-mc2-submit').style.display = '';
  api.mocap2Status().then(({ job, queue }) => {
    if (job && (job.status === 'running' || job.status === 'done' || job.status === 'error')) {
      applyJob(job, queue);
      if (job.status === 'running') startPolling();
    }
  }).catch(() => {});
}

export function closeMotionCapture2Page() {
  $('motion-capture2-page').style.display = 'none';
  stopPolling();
}

$('btn-motion-capture2').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'motion-capture2' }, '', '/motion-capture2');
  openMotionCapture2Page();
});

$('motion-capture2-back').addEventListener('click', () => history.back());

// ── Duration toggle ───────────────────────────────────────────────────────────

$('mc2-full-duration').addEventListener('sl-change', e => {
  $('mc2-duration-row').style.display = e.target.checked ? 'none' : '';
});

// ── Generate ──────────────────────────────────────────────────────────────────

$('btn-mc2-submit').addEventListener('click', async () => {
  if (!videoInfo) { toast('Select a reference video', 'warning'); return; }
  if (!imageInfo) { toast('Select a reference image', 'warning'); return; }

  const fullDuration = $('mc2-full-duration').checked;
  let totalDuration;
  if (!fullDuration) {
    totalDuration = parseInt($('mc2-duration').value);
    if (!totalDuration || totalDuration < 1) { toast('Enter a total duration (seconds)', 'warning'); return; }
  }

  const startAt = parseInt($('mc2-start-at').value) || 0;
  const fps = parseInt($('mc2-fps').value) || 16;
  const prompt = $('mc2-prompt').value.trim() || undefined;
  const seedVal = $('mc2-seed').value.trim();
  const seed = seedVal ? parseInt(seedVal) : undefined;
  const audio = $('mc2-audio').checked;
  const segDurVal = parseInt($('mc2-segment-duration').value);
  const segmentDuration = (segDurVal && segDurVal >= 1) ? segDurVal : 3;

  const btn = $('btn-mc2-submit');
  btn.loading = true;
  $('motion-capture2-status').textContent = 'Submitting…';

  try {
    const submitResult = await api.mocap2({
      video: videoInfo.comfyFilename,
      image: imageInfo.comfyFilename,
      prompt,
      totalDuration,
      fps,
      startAt: startAt || undefined,
      segmentDuration,
      seed,
      audio,
    });
    $('motion-capture2-status').textContent = '';
    if (submitResult.queued) {
      toast(`Queued at position ${submitResult.position} — will start automatically`);
    } else {
      toast('Started — rendering segments sequentially');
    }
    startPolling();
  } catch (err) {
    $('motion-capture2-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
