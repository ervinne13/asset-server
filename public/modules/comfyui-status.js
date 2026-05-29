import { api } from './api.js';

const sidebarItem = document.getElementById('btn-comfy-queue');
const dot = sidebarItem.querySelector('.comfyui-dot');
const countEl = document.getElementById('comfy-jobs-count');

export let currentQueue = { running: [], pending: [] };

function setStatus(state) {
  sidebarItem.classList.remove('running', 'idle', 'offline', 'pending');
  sidebarItem.classList.add(state);
}

async function poll() {
  try {
    const queue = await api.comfyQueue();
    currentQueue = queue;
    const total = queue.running.length + queue.pending.length;
    const running = queue.running.length > 0;

    if (running) {
      setStatus('running');
      if (total > 1) {
        countEl.textContent = `${total} jobs`;
        countEl.style.display = '';
      } else {
        countEl.style.display = 'none';
      }
    } else if (total > 0) {
      setStatus('pending');
      countEl.textContent = `${total} queued`;
      countEl.style.display = '';
    } else {
      setStatus('idle');
      countEl.style.display = 'none';
    }

    document.dispatchEvent(new CustomEvent('comfyui-queue-update', { detail: queue }));
  } catch {
    setStatus('offline');
    countEl.style.display = 'none';
    document.dispatchEvent(new CustomEvent('comfyui-queue-update', { detail: { running: [], pending: [] } }));
  }
}

poll();
setInterval(poll, 3000);
