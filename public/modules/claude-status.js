import { updateSidebarDot } from './claude-page.js';

async function poll() {
  try {
    const rc = await fetch('/api/claude/status').then(r => r.json());
    updateSidebarDot(rc.running ?? false);
  } catch {}
}

poll();
setInterval(poll, 10000);
