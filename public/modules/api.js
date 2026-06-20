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
  join: body => api.post('/api/join', body),
  mkdir: path => api.post('/api/mkdir', { path }),
  rebuildIndex: () => api.post('/api/index/rebuild', {}),
  search: q => api.get(`/api/index/search?q=${encodeURIComponent(q)}`),
  downloadUrl: p => `/api/download?path=${encodeURIComponent(p)}`,
  fileUrl: (p, mtime) => `/files${p}${mtime ? `?t=${+new Date(mtime)}` : ''}`,
  thumbUrl: (p, mtime) => `/api/thumb?path=${encodeURIComponent(p)}${mtime ? `&t=${+new Date(mtime)}` : ''}`,
  getPrompt: p => api.get(`/api/prompt?path=${encodeURIComponent(p)}`),
  getTags: p => api.get(`/api/tags?path=${encodeURIComponent(p)}`),
  saveTags: (p, tags) => api.post('/api/tags', { path: p, tags }),
  tagVocab: () => api.get('/api/tags/vocab'),
  generate: body => api.post('/api/comfyui/generate', body),
  zitTxt2Img: (prompt, seed, savedPromptId, width, height) => api.post('/api/comfyui/zit-txt2img', { prompt, seed, savedPromptId, width, height }),
  savedPromptsList: () => api.get('/api/saved-prompts'),
  savedPromptsSave: body => api.post('/api/saved-prompts', body),
  savedPromptsDelete: id => api.del(`/api/saved-prompts/${id}`, {}),
  uploadImageFromFile: file => fetch('/api/comfyui/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
    body: file,
  }).then(async r => {
    if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); }
    return r.json();
  }),
  uploadImageFromPath: p => api.post('/api/comfyui/upload-image', { path: p }),
  latestStagingImage: () => api.get('/api/latest-staging-image'),
  qwenI2iNsfw: body => api.post('/api/comfyui/qwen-i2i-nsfw', body),
  qwenPose: body => api.post('/api/comfyui/qwen-pose', body),
  postProcessSkin: body => api.post('/api/comfyui/post-process-skin', body),
  ltxI2v: body => api.post('/api/comfyui/ltx-i2v', body),
  mocap: body => api.post('/api/comfyui/mocap', body),
  mocapStatus: () => api.get('/api/comfyui/mocap/status'),
  mocapLogs: (date) => api.get(`/api/comfyui/mocap/logs${date ? `?date=${date}` : ''}`),
  mocapCancel: (jobId) => api.post('/api/comfyui/mocap/cancel', { jobId }),
  mocapPause:  (jobId) => api.post('/api/comfyui/mocap/pause',  { jobId }),
  mocapResume: (jobId) => api.post('/api/comfyui/mocap/resume', { jobId }),
  mocapRetry:  (jobId) => api.post('/api/comfyui/mocap/retry',  { jobId }),
  mocapClear: () => api.post('/api/comfyui/mocap/clear', {}),
  creativeVideo: filePath => api.post('/api/comfyui/creative-video', { filePath }),
  comfyQueue: () => api.get('/api/comfyui/queue'),
  comfyCancel: promptId => api.post('/api/comfyui/cancel', { promptId }),
  comfyInterrupt: () => api.post('/api/comfyui/interrupt', {}),
};
