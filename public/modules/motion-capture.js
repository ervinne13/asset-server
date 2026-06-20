import { api } from './api.js';
import { $, toast } from './helpers.js';
import { openImagePicker, updateSlotUI, wireSlotDropZone } from './img-picker.js';

let videoInfo = null;
let imageInfo = null;
let pollTimer = null;
let tickTimer = null;
let logTimer = null;
let liveJob = null;
let liveQueue = [];

// ── Slots ──────────────────────────────────────────────────────────────────────

$('mc-video-slot').addEventListener('click', () => {
  openImagePicker({
    kind: 'video',
    onSelect: info => {
      videoInfo = info;
      updateSlotUI('mc-video-slot', info);
      $('mc-use-video-fps').disabled = false;
    },
    onClear: () => {
      videoInfo = null;
      updateSlotUI('mc-video-slot', null);
      $('mc-use-video-fps').checked = false;
      $('mc-use-video-fps').disabled = true;
      $('mc-fps').disabled = false;
    },
  });
});

$('mc-img-slot').addEventListener('click', () => {
  openImagePicker({
    onSelect: info => { imageInfo = info; updateSlotUI('mc-img-slot', info); },
    onClear: () => { imageInfo = null; updateSlotUI('mc-img-slot', null); },
  });
});

wireSlotDropZone('mc-video-slot', 'video', info => {
  videoInfo = info;
  $('mc-use-video-fps').disabled = false;
});
wireSlotDropZone('mc-img-slot', 'image', info => { imageInfo = info; });

// ── Helpers ───────────────────────────────────────────────────────────────────

function stageLabel(job, short = false) {
  const seg = `${job.current}/${job.total}`;
  switch (job.stage) {
    case 'queued':        return 'Starting…';
    case 'generating':    return short ? 'Rendering…' : `Rendering ${seg}…`;
    case 'trimming':      return short ? 'Trimming…'  : `Trimming (${seg})…`;
    case 'uploading':     return short ? 'Uploading…' : `Uploading (${seg})…`;
    case 'joining':       return `Joining ${job.total} seg…`;
    case 'joining-audio': return 'Joining + audio…';
    case 'paused':        return short ? 'Paused' : `Paused — next: seg ${job.current + 1}`;
    case 'done':          return 'Done';
    default:              return job.stage || 'Working…';
  }
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}hr ${m}min`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function eta(job) {
  const logs = job.segmentLogs || [];
  const remaining = job.total - logs.length;
  if (remaining <= 0 || job.status !== 'running') return null;
  const avg = logs.length > 0
    ? logs.reduce((s, e) => s + e.durationMs, 0) / logs.length
    : 15 * 60 * 1000;
  const elapsed = job.segmentStartedAt && job.stage === 'generating'
    ? Date.now() - job.segmentStartedAt : 0;
  return Math.max(0, avg - elapsed) + (remaining - 1) * avg;
}

function statusSpans(job) {
  const seg = `${job.current}/${job.total}`;

  if (job.status === 'error') return `<span>${seg} · Failed</span>`;
  if (job.status === 'done')  return `<span>${seg} · Done</span>`;

  const etaMs = eta(job);
  const etaStr = etaMs != null ? ` · ETA: ~${fmt(etaMs)}` : '';

  const mobile  = `${seg} · ${stageLabel(job, true)}${etaStr}`;
  let   desktop = `${seg} · ${stageLabel(job, false)}${etaStr}`;

  if (job.status === 'running' && job.startedAt) {
    const elapsed = Date.now() - job.startedAt;
    desktop += ` · Elapsed: ${fmt(elapsed)}`;
    if (etaMs != null) desktop += ` · Total: ~${fmt(elapsed + etaMs)}`;
  }

  return `<span class="mc-status-mobile">${mobile}</span>` +
         `<span class="mc-status-desktop">${desktop}</span>`;
}

function entryDetailHTML(job) {
  const lines = (job.segmentLogs || []).map(e =>
    `<div>${e.segment}/${job.total} generated in ${fmt(e.durationMs)}</div>`
  );
  if (job.stage === 'generating' && (job.segmentLogs || []).length < job.total) {
    const elapsed = job.segmentStartedAt ? Date.now() - job.segmentStartedAt : 0;
    lines.push(`<div class="mc-seg-current">${job.current}/${job.total} generating (${fmt(elapsed)} so far)</div>`);
  }
  const etaMs = eta(job);
  if (etaMs != null) lines.push(`<div class="mc-seg-eta">ETA: ~${fmt(etaMs)}</div>`);
  if (job.warning) lines.push(`<div class="mc-seg-warning">⚠ ${job.warning}</div>`);
  if (job.error)   lines.push(`<div class="mc-seg-error">✕ ${job.error}</div>`);
  if (job.output)  lines.push(`<div class="mc-seg-output">→ ${job.output.split('/').pop()}</div>`);

  const metaLines = [];
  if (job.fps)        metaLines.push(`FPS: ${job.fps}`);
  if (job.frameCount && job.fps && job.total) {
    const secs = (job.total * job.frameCount / job.fps).toFixed(1);
    metaLines.push(`Est Length: ${secs}s`);
  }
  if (job.replacementMode != null) {
    metaLines.push(job.replacementMode ? 'Subject Replacement' : 'Motion Capture');
  }

  const metaHTML = metaLines.length
    ? `<div class="mc-detail-meta">${metaLines.map(l => `<div>${l}</div>`).join('')}</div>`
    : '';

  return `<div class="mc-detail-body"><div class="mc-detail-log">${lines.join('')}</div>${metaHTML}</div>`;
}

function cancelBtn(jobId) {
  return `<button class="mc-action-btn mc-cancel-btn" data-cancel-job="${jobId}" title="Cancel">✕</button>`;
}
function pauseBtn(jobId) {
  return `<button class="mc-action-btn mc-pause-btn" data-pause-job="${jobId}" title="Pause after current segment">⏸</button>`;
}
function resumeBtn(jobId) {
  return `<button class="mc-action-btn mc-resume-btn" data-resume-job="${jobId}" title="Resume">▶</button>`;
}
function retryBtn(jobId) {
  return `<button class="mc-action-btn mc-retry-btn" data-retry-job="${jobId}" title="Retry with same settings">↺</button>`;
}

function entryHTML(job, forceOpen = false) {
  const running = job.status === 'running';
  const paused  = running && job.stage === 'paused';
  const failed  = job.status === 'error' || job.status === 'cancelled';
  const cls  = running ? (paused ? 'paused' : 'running') : (job.status === 'error' ? 'error' : job.status === 'cancelled' ? 'cancelled' : 'done');
  const icon = paused ? '⏸' : (running ? '●' : (failed ? '✕' : '✓'));
  const open = forceOpen ? ' open' : '';
  const actions = running
    ? cancelBtn(job.id) + (paused ? resumeBtn(job.id) : pauseBtn(job.id))
    : (failed ? retryBtn(job.id) : '');
  return `<details class="mc-log-entry mc-log-entry-${cls}"${open}>
  <summary class="mc-log-entry-summary">
    <span class="mc-log-entry-icon">${icon}</span>
    <span class="mc-log-entry-batch">mocap-${job.batch}</span>
    <span class="mc-log-entry-status">${statusSpans(job)}</span>
    ${actions}
  </summary>
  <div class="mc-log-entry-detail">${entryDetailHTML(job)}</div>
</details>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function queueEntryHTML(entry, position) {
  return `<div class="mc-log-entry mc-log-entry-queued">
  <div class="mc-log-entry-summary">
    <span class="mc-log-entry-icon">○</span>
    <span class="mc-log-entry-batch">mocap-${entry.batch}</span>
    <span class="mc-log-entry-status">${entry.total} seg · Queue #${position}</span>
    ${cancelBtn(entry.id)}
  </div>
</div>`;
}

function renderLive() {
  const html = (liveJob ? entryHTML(liveJob, true) : '') +
    liveQueue.map((e, i) => queueEntryHTML(e, i + 1)).join('');
  $('mc-logs-running').innerHTML = html;
  $('mc-logs-drawer-running').innerHTML = html;
  $('btn-mc-logs').classList.toggle('mc-logs-running', !!(liveJob && liveJob.status === 'running'));
}

function renderHistory(entries, liveId) {
  const filtered = entries.filter(e => e.id !== liveId);
  const html = filtered.map(e => entryHTML(e)).join('') ||
    '<div class="mc-logs-empty">No jobs yet today</div>';
  $('mc-logs-history').innerHTML = html;
  $('mc-logs-drawer-history').innerHTML = html;
}

// ── Log fetch ──────────────────────────────────────────────────────────────────

async function fetchLogs() {
  try {
    const { entries, date } = await api.mocapLogs();
    const d = date;
    const isToday = d === new Date().toISOString().slice(0, 10).replace(/-/g, '');
    $('mc-logs-date-label').textContent = isToday ? 'Today' : `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    renderHistory(entries, liveJob?.id);
  } catch {}
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const { job, queue } = await api.mocapStatus();
    liveJob = job;
    liveQueue = queue || [];
    renderLive();
    if (!job || job.status !== 'running') {
      stopPolling();
      fetchLogs();
    }
  } catch {}
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, 4000);
  tickTimer = setInterval(() => {
    if (liveJob?.stage === 'generating') renderLive();
  }, 1000);
  logTimer = setInterval(fetchLogs, 60000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (logTimer)  { clearInterval(logTimer);  logTimer = null; }
}

// ── Cancel job ────────────────────────────────────────────────────────────────

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-cancel-job],[data-pause-job],[data-resume-job],[data-retry-job]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  btn.disabled = true;

  if (btn.dataset.cancelJob) {
    try {
      await api.mocapCancel(btn.dataset.cancelJob);
      toast('Job cancelled');
      await poll();
    } catch (err) {
      toast(`Cancel failed: ${err.message}`, 'danger');
      btn.disabled = false;
    }
  } else if (btn.dataset.pauseJob) {
    try {
      await api.mocapPause(btn.dataset.pauseJob);
      toast('Will pause after current segment finishes');
      await poll();
    } catch (err) {
      toast(`Pause failed: ${err.message}`, 'danger');
      btn.disabled = false;
    }
  } else if (btn.dataset.resumeJob) {
    try {
      await api.mocapResume(btn.dataset.resumeJob);
      toast('Resumed');
      await poll();
    } catch (err) {
      toast(`Resume failed: ${err.message}`, 'danger');
      btn.disabled = false;
    }
  } else if (btn.dataset.retryJob) {
    try {
      const result = await api.mocapRetry(btn.dataset.retryJob);
      toast(result.queued ? `Queued at position ${result.position}` : 'Started');
      startPolling();
      fetchLogs();
    } catch (err) {
      toast(`Retry failed: ${err.message}`, 'danger');
      btn.disabled = false;
    }
  }
});

// ── Clear queue + logs ────────────────────────────────────────────────────────

$('btn-mc-clear').addEventListener('click', async () => {
  const btn = $('btn-mc-clear');
  btn.disabled = true;
  try {
    await api.mocapClear();
    liveQueue = [];
    renderLive();
    $('mc-logs-history').innerHTML = '<div class="mc-logs-empty">No jobs yet today</div>';
    $('mc-logs-drawer-history').innerHTML = $('mc-logs-history').innerHTML;
    $('mc-logs-date-label').textContent = 'Today';
    toast('Queue and logs cleared');
  } catch (err) {
    toast(`Clear failed: ${err.message}`, 'danger');
  } finally {
    btn.disabled = false;
  }
});

// ── Mobile Logs button ────────────────────────────────────────────────────────

$('btn-mc-logs').addEventListener('click', () => $('mc-logs-drawer').show());
$('btn-mc-logs-close').addEventListener('click', () => $('mc-logs-drawer').hide());

// ── Duration toggle ───────────────────────────────────────────────────────────

$('mc-full-duration').addEventListener('sl-change', e => {
  $('mc-duration-row').style.display = e.target.checked ? 'none' : '';
});

$('mc-use-video-fps').addEventListener('sl-change', e => {
  $('mc-fps').disabled = e.target.checked;
});

// ── FPS → frame count sync ────────────────────────────────────────────────────

$('mc-fps').addEventListener('change', () => {
  if ($('mc-use-video-fps').checked) return;
  const fps = Math.max(1, parseInt($('mc-fps').value) || 16);
  $('mc-frame-count').value = Math.floor(5 * fps / 4) * 4 + 1;
});

// ── Open / close ──────────────────────────────────────────────────────────────

export function openMotionCapturePage() {
  $('motion-capture-status').textContent = '';
  $('btn-mc-submit').loading = false;
  videoInfo = null;
  imageInfo = null;
  updateSlotUI('mc-video-slot', null);
  updateSlotUI('mc-img-slot', null);
  $('mc-use-video-fps').checked = false;
  $('mc-use-video-fps').disabled = true;
  $('mc-fps').disabled = false;
  $('motion-capture-page').style.display = 'flex';
  fetchLogs();
  api.mocapStatus().then(({ job, queue }) => {
    liveJob = job;
    liveQueue = queue || [];
    renderLive();
    if (job && job.status === 'running') startPolling();
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

  const useVideoFps = $('mc-use-video-fps').checked;
  const fps = useVideoFps ? undefined : (parseInt($('mc-fps').value) || 24);
  const fullDuration = $('mc-full-duration').checked;
  let totalFrames;
  if (!fullDuration) {
    const videoLength = parseFloat($('mc-video-length').value);
    if (!videoLength || videoLength <= 0) { toast('Enter video length in seconds', 'warning'); return; }
    totalFrames = Math.round(videoLength * fps);
  }

  const startAt = parseFloat($('mc-start-at').value) || 0;
  const startFrame = startAt > 0 ? Math.round(startAt * fps) : 0;
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
    const result = await api.mocap({
      video: videoInfo.comfyFilename,
      image: imageInfo.comfyFilename,
      videoServerPath: videoInfo.serverPath || undefined,
      imageServerPath: imageInfo.serverPath || undefined,
      prompt, totalFrames, fps,
      useVideoFps: useVideoFps || undefined,
      startFrame: startFrame || undefined,
      frameCount, seed, audio, replacementMode,
    });
    $('motion-capture-status').textContent = '';
    toast(result.queued
      ? `Queued at position ${result.position} — will start automatically`
      : 'Started — rendering segments sequentially'
    );
    startPolling();
    fetchLogs();
  } catch (err) {
    $('motion-capture-status').textContent = '';
    toast(`Failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});
