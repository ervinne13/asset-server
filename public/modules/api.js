async function _fetch(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(text || r.statusText);
  }
  return r.json();
}

const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  get: url => _fetch(url),
  post: (url, body) => _fetch(url, json(body)),
  del: (url, body) => _fetch(url, { ...json(body), method: 'DELETE' }),

  config: () => api.get('/api/config'),
  ls: path => api.get(`/api/ls?path=${encodeURIComponent(path)}`),
  bookmarks: () => api.get('/api/bookmarks'),
  saveBookmarks: b => api.post('/api/bookmarks', b),
  move: (from, to) => api.post('/api/move', { from, to }),
  mkdir: path => api.post('/api/mkdir', { path }),
  rebuildIndex: () => api.post('/api/index/rebuild', {}),
  search: q => api.get(`/api/index/search?q=${encodeURIComponent(q)}`),
  downloadUrl: p => `/api/download?path=${encodeURIComponent(p)}`,
  fileUrl: (p, mtime) => `/files${p}${mtime ? `?t=${+new Date(mtime)}` : ''}`,
};
