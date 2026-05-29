const btn = document.getElementById('btn-claude-status');

async function poll() {
  try {
    const res = await fetch('/api/claude/status');
    const { running } = await res.json();
    btn.textContent = running ? 'Claude: ON' : 'Claude: OFF';
    btn.variant = running ? 'success' : 'neutral';
    btn.dataset.running = running ? '1' : '0';
  } catch {
    btn.textContent = 'Claude: ?';
    btn.variant = 'neutral';
    btn.dataset.running = '0';
  }
}

btn.addEventListener('click', async () => {
  const running = btn.dataset.running === '1';
  try {
    await fetch(running ? '/api/claude/stop' : '/api/claude/start', { method: 'POST' });
  } catch {
    // ignore — poll will reflect actual state
  }
  await poll();
});

poll();
setInterval(poll, 10000);
