import { $, toast } from './helpers.js';
import { makeRecentPrompts } from './saved-prompts.js';

const DEFAULT_SYSTEM_PROMPT =
  `You are an expert prompt engineer for AI image generation. ` +
  `Your only output is image prompts — no introductions, labels, explanations, or commentary. ` +
  `Separate each prompt with a blank line. Do not number them. ` +
  `Every prompt must be vivid, specific, and ready to paste directly into a text-to-image generator.`;

const { addRecent, renderRecent } = makeRecentPrompts(
  'cf-recent-themes', 'cf-recent-section', 'cf-recent-list', 'cf-theme'
);

let pollTimer = null;

// ── Render ─────────────────────────────────────────────────────────────────────

function renderLog(log) {
  const el = $('cf-log');
  if (!log.length) { el.innerHTML = '<div class="cf-empty">No activity yet</div>'; return; }
  el.innerHTML = log.map(e => {
    const t = new Date(e.at).toLocaleTimeString();
    return `<div class="cf-log-row"><span class="cf-log-time">${t}</span><span>${e.msg}</span></div>`;
  }).join('');
}

function renderHistory(history) {
  const el = $('cf-history');
  if (!history.length) { el.innerHTML = '<div class="cf-empty">Nothing queued yet</div>'; return; }
  el.innerHTML = history.map(e => {
    const t = new Date(e.queuedAt).toLocaleTimeString();
    const seedLabel = e.seed != null ? ` · seed ${e.seed}` : '';
    return `<div class="cf-hist-row">
      <span class="cf-hist-time">${t}${seedLabel}</span>
      <p class="cf-hist-prompt">${e.prompt}</p>
    </div>`;
  }).join('');
}

function applyStatus(data) {
  const running = data.running;
  const btn = $('btn-cf-toggle');
  btn.variant = running ? 'danger' : 'primary';
  btn.textContent = running ? 'Stop' : 'Start Farming';
  btn.loading = false;

  $('cf-status').textContent = running ? 'Running' : '';
  $('cf-status').style.color = running ? 'var(--sl-color-success-600)' : '';

  const seedRow = $('cf-seed-row');
  const continuous = $('cf-continuous').checked;
  seedRow.style.display = continuous ? '' : 'none';

  renderLog(data.log || []);
  renderHistory(data.history || []);
}

async function poll() {
  try {
    const res = await fetch('/api/content-farmer/status');
    const data = await res.json();
    applyStatus(data);
  } catch {}
}

// ── Open / close ───────────────────────────────────────────────────────────────

export async function openContentFarmerPage() {
  if (!$('cf-system-prompt').value) $('cf-system-prompt').value = DEFAULT_SYSTEM_PROMPT;
  $('cf-page').style.display = 'flex';
  renderRecent();
  await poll();
  pollTimer = setInterval(poll, 5000);
}

export function closeContentFarmerPage() {
  $('cf-page').style.display = 'none';
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── Nav ────────────────────────────────────────────────────────────────────────

$('btn-content-farmer').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'content-farmer' }, '', '/content-farmer');
  openContentFarmerPage();
});

$('cf-back').addEventListener('click', () => history.back());

// ── Continuous mode toggle ─────────────────────────────────────────────────────

$('cf-continuous').addEventListener('sl-change', () => {
  $('cf-seed-row').style.display = $('cf-continuous').checked ? '' : 'none';
});

// ── Radio groups → hidden inputs ───────────────────────────────────────────────

$('cf-prompt-count-group').addEventListener('sl-change', e => {
  $('cf-prompt-count').value = e.target.value;
});

$('cf-images-per-prompt-group').addEventListener('sl-change', e => {
  $('cf-images-per-prompt').value = e.target.value;
});

// ── Start / Stop ───────────────────────────────────────────────────────────────

$('btn-cf-toggle').addEventListener('click', async () => {
  const btn = $('btn-cf-toggle');
  const running = btn.variant === 'danger';
  btn.loading = true;

  if (running) {
    await fetch('/api/content-farmer/stop', { method: 'POST' });
  } else {
    const systemPrompt = $('cf-system-prompt').value.trim();
    const theme = $('cf-theme').value.trim();
    if (!theme) {
      toast('Enter a theme first', 'warning');
      btn.loading = false;
      $('cf-theme').focus();
      return;
    }
    addRecent(theme);
    const body = {
      systemPrompt,
      theme,
      promptCount: parseInt($('cf-prompt-count').value) || 3,
      imagesPerPrompt: parseInt($('cf-images-per-prompt').value) || 2,
      continuous: $('cf-continuous').checked,
      seed: $('cf-seed').value ? parseInt($('cf-seed').value) : undefined,
    };
    const res = await fetch('/api/content-farmer/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json();
      toast(d.error || 'Failed to start', 'danger');
      btn.loading = false;
      return;
    }
  }

  await poll();
});
