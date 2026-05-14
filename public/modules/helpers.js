export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.tif']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ogv', '.wmv']);

export const $ = id => document.getElementById(id);
export const isImg = name => IMAGE_EXTS.has(name.slice(name.lastIndexOf('.')).toLowerCase());
export const isVideo = name => VIDEO_EXTS.has(name.slice(name.lastIndexOf('.')).toLowerCase());

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function fmtDate(mtime) {
  return new Date(mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function toast(msg, variant = 'primary') {
  const el = document.createElement('sl-alert');
  el.variant = variant;
  el.closable = true;
  el.duration = 4000;
  el.innerHTML = msg;
  document.body.appendChild(el);
  customElements.whenDefined('sl-alert').then(() => el.toast());
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
