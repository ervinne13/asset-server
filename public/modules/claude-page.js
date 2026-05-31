import { $ } from './helpers.js';

async function pollStatus() {
  const [rcRes] = await Promise.allSettled([
    fetch('/api/claude/status').then(r => r.json()),
  ]);

  const data    = rcRes.status === 'fulfilled' ? rcRes.value : {};
  const running = data.running ?? false;
  const url     = data.sessionUrl ?? null;

  const rcBtn = $('claude-page-rc');
  rcBtn.textContent = running ? 'Remote Control: ON' : 'Remote Control: OFF';
  rcBtn.variant = running ? 'success' : 'neutral';
  rcBtn.dataset.running = running ? '1' : '0';

  const link = $('claude-session-link');
  if (running && url) {
    link.href = url;
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }

  updateSidebarDot(running);
}

export function updateSidebarDot(running) {
  const el = $('btn-claude-page');
  el.classList.toggle('rc-on', running);
}

$('claude-page-rc').addEventListener('click', async () => {
  const running = $('claude-page-rc').dataset.running === '1';
  $('claude-page-rc').loading = true;
  try {
    await fetch(running ? '/api/claude/stop' : '/api/claude/start', { method: 'POST' });
  } catch {}
  $('claude-page-rc').loading = false;
  await pollStatus();
});

let pollTimer = null;

export async function openClaudePage() {
  $('claude-page').style.display = 'flex';
  await pollStatus();
  pollTimer = setInterval(pollStatus, 10000);
}

export function closeClaudePage() {
  $('claude-page').style.display = 'none';
  clearInterval(pollTimer);
  pollTimer = null;
}

$('claude-page-back').addEventListener('click', () => history.back());

$('btn-claude-page').addEventListener('click', e => {
  e.preventDefault();
  history.pushState({ page: 'claude' }, '', '/claude');
  openClaudePage();
});
