import { api } from './api.js';
import { $, toast } from './helpers.js';
import { currentQueue } from './comfyui-status.js';
import { navigate } from './router.js';
import { state } from './state.js';

let selectedJob = null;
let queueOpen = false;
let justOpened = false;

function isMobile() {
  return window.innerWidth < 768;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function openQueuePage() {
  queueOpen = true;
  selectedJob = null;
  if (isMobile()) {
    openMobile();
  } else {
    openDesktop();
  }
}

export function closeQueuePage() {
  if (!queueOpen) return;
  queueOpen = false;
  selectedJob = null;
  $('comfy-queue-page').style.display = 'none';
  $('comfy-queue-mobile-detail').style.display = 'none';
  closeDesktop();
}

// ── Desktop: uses panel-main + panel-right ────────────────────────────────────

function openDesktop() {
  $('file-grid').style.display = 'none';
  $('comfy-queue-view').style.display = 'flex';

  // Take over right panel
  for (const id of ['bulk-panel', 'folder-panel', 'preview-empty', 'preview-content']) {
    $(id).style.display = 'none';
  }
  $('queue-job-panel').style.display = 'flex';
  document.querySelector('.panel-right-header > span').textContent = 'Job Details';

  renderDesktop(currentQueue || { running: [], pending: [] });
}

function closeDesktop() {
  const queueView = $('comfy-queue-view');
  if (!queueView || queueView.style.display === 'none') return;

  $('comfy-queue-view').style.display = 'none';
  $('file-grid').style.display = '';
  $('queue-job-panel').style.display = 'none';
  document.querySelector('.panel-right-header > span').textContent = 'Preview';

  // Reset right panel to neutral — navigate() will call updateRightPanel() afterwards
  for (const id of ['bulk-panel', 'folder-panel', 'preview-content']) {
    $(id).style.display = 'none';
  }
  $('preview-empty').style.display = '';
}

function renderDesktop(queue) {
  const listEl = $('comfy-queue-list-desktop');
  const total = queue.running.length + queue.pending.length;
  $('comfy-queue-count').textContent = total === 0 ? 'Queue empty' : `${total} job${total !== 1 ? 's' : ''}`;

  renderJobList(listEl, queue);

  if (selectedJob) {
    const still = [...queue.running, ...queue.pending].find(j => j.promptId === selectedJob.promptId);
    if (still) renderRightPanelDetail(still);
    else { selectedJob = null; clearRightPanelDetail(); }
  }
}

// ── Mobile: full-screen overlay ───────────────────────────────────────────────

function openMobile() {
  $('comfy-queue-page').style.display = 'flex';
  $('comfy-queue-mobile-detail').style.display = 'none';
  justOpened = true;
  setTimeout(() => { justOpened = false; }, 400);
  renderMobile(currentQueue || { running: [], pending: [] });
}

function renderMobile(queue) {
  const listEl = $('comfy-queue-list');
  const total = queue.running.length + queue.pending.length;
  $('comfy-queue-status').textContent = total === 0 ? 'Queue empty' : `${total} job${total !== 1 ? 's' : ''}`;

  renderJobList(listEl, queue);

  if (selectedJob) {
    const still = [...queue.running, ...queue.pending].find(j => j.promptId === selectedJob.promptId);
    if (still) renderMobileDetail(still);
    else { selectedJob = null; $('comfy-queue-mobile-detail').style.display = 'none'; }
  }
}

// ── Shared job list rendering ─────────────────────────────────────────────────

function renderJobList(listEl, queue) {
  const allJobs = [...queue.running, ...queue.pending];
  if (allJobs.length === 0) {
    listEl.innerHTML = '<div class="comfy-queue-empty">No jobs in queue</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const job of allJobs) {
    const item = document.createElement('div');
    item.className = `comfy-queue-item${selectedJob?.promptId === job.promptId ? ' selected' : ''}`;
    item.dataset.promptId = job.promptId;
    const promptPreview = job.prompt
      ? (job.prompt.length > 80 ? job.prompt.slice(0, 80) + '…' : job.prompt)
      : '—';
    const timeStr = formatTime(job.submittedAt);
    item.innerHTML = `
      <div class="cqi-header">
        <span class="cqi-dot ${job.status}"></span>
        <span class="cqi-workflow">${job.workflowLabel || 'Unknown'}</span>
        ${timeStr ? `<span class="cqi-time">${timeStr}</span>` : ''}
      </div>
      <div class="cqi-prompt">${promptPreview}</div>
      ${job.image ? `<div class="cqi-image-tag"><sl-icon name="image"></sl-icon> ${job.image.split('/').pop()}</div>` : ''}
    `;
    item.addEventListener('click', () => selectJob(job, item));
    listEl.appendChild(item);
  }
}

function selectJob(job, itemEl) {
  if (justOpened) return;
  selectedJob = job;
  document.querySelectorAll('.comfy-queue-item').forEach(el => el.classList.remove('selected'));
  itemEl.classList.add('selected');
  if (isMobile()) {
    renderMobileDetail(job);
  } else {
    renderRightPanelDetail(job);
  }
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatElapsed(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  return mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
}

// ── Detail rendering ──────────────────────────────────────────────────────────

function buildDetailHTML(job) {
  return `
    <div class="cqd-workflow">
      <span class="cqi-dot ${job.status}"></span>
      <strong>${job.workflowLabel || 'Unknown'}</strong>
      <span class="cqd-status-text">${job.status === 'running' ? 'Generating…' : 'Queued'}</span>
    </div>
    ${job.prompt ? `
      <div class="cqd-field">
        <div class="cqd-label">Prompt</div>
        <div class="cqd-prompt">${job.prompt}</div>
      </div>
    ` : ''}
    ${job.image ? `
      <div class="cqd-field">
        <div class="cqd-label">Input image</div>
        <div class="cqd-value">${job.image.split('/').pop()}</div>
      </div>
    ` : ''}
    ${job.submittedAt ? `
      <div class="cqd-field">
        <div class="cqd-label">Queued at</div>
        <div class="cqd-value">${formatTime(job.submittedAt)}</div>
      </div>
    ` : ''}
    ${job.status === 'running' && job.submittedAt ? `
      <div class="cqd-field">
        <div class="cqd-label">Elapsed</div>
        <div class="cqd-value">${formatElapsed(job.submittedAt)}</div>
      </div>
    ` : ''}
    <div class="cqd-actions">
      <button class="action-btn danger cqd-cancel-btn">
        <sl-icon name="${job.status === 'running' ? 'stop-circle' : 'x-circle'}"></sl-icon>
        ${job.status === 'running' ? 'Cancel (interrupt)' : 'Remove from queue'}
      </button>
    </div>
  `;
}

function renderRightPanelDetail(job) {
  const panel = $('queue-job-panel');
  panel.innerHTML = buildDetailHTML(job);
  panel.querySelector('.cqd-cancel-btn').addEventListener('click', () => {
    job.status === 'running' ? interruptJob() : cancelJob(job);
  });
}

function clearRightPanelDetail() {
  $('queue-job-panel').innerHTML = '<div class="cqd-empty">Select a job to see details</div>';
}

function renderMobileDetail(job) {
  const panel = $('comfy-queue-mobile-detail');
  panel.querySelector('.cqd-inner').innerHTML = buildDetailHTML(job);
  panel.querySelector('.cqd-cancel-btn')?.addEventListener('click', () => {
    job.status === 'running' ? interruptJob() : cancelJob(job);
  });
  panel.style.display = 'flex';
}

// ── Cancel / interrupt ────────────────────────────────────────────────────────

async function cancelJob(job) {
  try {
    await api.comfyCancel(job.promptId);
    toast('Job removed from queue');
    selectedJob = null;
    clearRightPanelDetail();
    $('comfy-queue-mobile-detail').style.display = 'none';
  } catch (err) {
    toast(`Cancel failed: ${err.message}`, 'danger');
  }
}

async function interruptJob() {
  try {
    await api.comfyInterrupt();
    toast('Interrupted — job cancelled');
    selectedJob = null;
    clearRightPanelDetail();
    $('comfy-queue-mobile-detail').style.display = 'none';
  } catch (err) {
    toast(`Interrupt failed: ${err.message}`, 'danger');
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

// Close queue when any file navigation happens
document.addEventListener('app-navigate', () => closeQueuePage());

// Update queue display and badges on every poll
document.addEventListener('comfyui-queue-update', e => {
  updateWorkflowBadges(e.detail);
  if (!queueOpen) return;
  if (isMobile()) {
    renderMobile(e.detail);
  } else {
    renderDesktop(e.detail);
  }
});

function updateWorkflowBadges(queue) {
  const counts = {};
  for (const job of [...queue.running, ...queue.pending]) {
    counts[job.workflow] = (counts[job.workflow] || 0) + 1;
  }
  setBadge('zit-queue-badge', counts['zit'] || 0);
  setBadge('qi-queue-badge', counts['qwen-nsfw'] || 0);
  setBadge('ltx-queue-badge', counts['ltx-i2v'] || 0);
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = count === 1 ? '1 generating' : `${count} generating`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// Routing
$('btn-comfy-queue').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'comfy-queue' }, '', '/comfy-queue');
  openQueuePage();
});

$('comfy-queue-back').addEventListener('click', () => {
  closeQueuePage();
  const start = state.config?.roots?.staging || state.config?.roots?.library;
  if (start) navigate(start);
});
$('comfy-mobile-detail-back').addEventListener('click', () => {
  $('comfy-queue-mobile-detail').style.display = 'none';
});
