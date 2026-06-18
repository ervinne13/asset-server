import { api } from './api.js';
import { $, toast } from './helpers.js';

// Background notifier for Motion Capture chain jobs: toasts when a job finishes
// and drives the sidebar running indicator, even if the Motion Capture page is closed.

let lastNotified = null;
let primed = false;

function setSidebarDot(running) {
  $('btn-motion-capture').classList.toggle('mc-running', running);
}

async function tick() {
  let job;
  try { ({ job } = await api.mocapStatus()); } catch { return; }

  setSidebarDot(!!(job && job.status === 'running'));

  if (!job) return;

  const terminal = job.status === 'done' || job.status === 'error';

  // First poll: adopt any already-finished job silently so we don't announce a
  // run that completed before this page was loaded.
  if (!primed) {
    primed = true;
    if (terminal) lastNotified = job.id;
    return;
  }

  if (terminal && lastNotified !== job.id) {
    lastNotified = job.id;
    if (job.status === 'done') {
      toast(`Motion Capture finished → ${job.output ? job.output.split('/').pop() : 'done'}`);
    } else {
      toast(`Motion Capture failed: ${job.error || 'error'}`, 'danger');
    }
  }
}

setInterval(tick, 15000);
tick();
