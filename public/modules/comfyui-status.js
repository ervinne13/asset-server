import { api } from './api.js';

const el = document.getElementById('comfyui-status');
const dot = el.querySelector('.comfyui-dot');
const label = el.querySelector('.comfyui-label');

async function poll() {
  try {
    const { running, queueDepth } = await api.comfyStatus();
    if (running) {
      el.className = 'comfyui-status running';
      el.title = queueDepth > 1 ? `Generating — ${queueDepth - 1} more queued` : 'Generating…';
      label.textContent = queueDepth > 1 ? `ComfyUI · Generating +${queueDepth - 1}` : 'ComfyUI · Generating…';
    } else {
      el.className = 'comfyui-status idle';
      el.title = 'ComfyUI idle';
      label.textContent = 'ComfyUI · Idle';
    }
  } catch {
    el.className = 'comfyui-status offline';
    el.title = 'ComfyUI unreachable';
    label.textContent = 'ComfyUI · Offline';
  }
}

poll();
setInterval(poll, 3000);
