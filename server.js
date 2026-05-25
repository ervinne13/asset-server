const express = require('express');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.json');
const INDEX_DIR = path.join(__dirname, 'index');
const TRASH_DIR = path.join(os.tmpdir(), 'asset-server-trash');
let APP_VERSION;
try {
  APP_VERSION = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
} catch {
  APP_VERSION = Date.now().toString();
}

app.use(express.json());
// JS/CSS: always revalidate so deploys are picked up immediately
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function isAllowedPath(p) {
  const config = loadConfig();
  const roots = Object.values(config.roots || {}).filter(Boolean);
  return roots.some(root => p === root || p.startsWith(root + '/'));
}

app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// ── Tag helpers (via Python 3 built-in os.getxattr / os.setxattr) ────────────

const PY_READ = [
  'import os,sys,json',
  'try:',
  '  v=os.getxattr(sys.argv[1],"user.xdg.tags").decode()',
  '  print(json.dumps([t.strip() for t in v.split(",") if t.strip()]))',
  'except:',
  '  print("[]")',
].join('\n');

const PY_WRITE = [
  'import os,sys',
  'p,v=sys.argv[1],sys.argv[2]',
  'if v: os.setxattr(p,"user.xdg.tags",v.encode())',
  'else:',
  '  try: os.removexattr(p,"user.xdg.tags")',
  '  except: pass',
].join('\n');

function readTags(filePath) {
  try {
    const out = execFileSync('python3', ['-c', PY_READ, filePath],
      { encoding: 'utf8', timeout: 2000 });
    return JSON.parse(out.trim());
  } catch { return []; }
}

function writeTags(filePath, tags) {
  try {
    execFileSync('python3', ['-c', PY_WRITE, filePath, tags.join(',')],
      { timeout: 2000 });
  } catch (err) {
    console.warn(`writeTags failed for ${filePath}:`, err.message);
  }
}

// ── Directory listing ─────────────────────────────────────────────────────────

app.get('/api/ls', async (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(dirPath)) return res.status(403).json({ error: 'path not allowed' });

  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const items = (
      await Promise.all(
        entries
          .filter(e => !e.name.startsWith('.'))
          .map(async e => {
            const fullPath = path.join(dirPath, e.name);
            try {
              const stat = await fsp.stat(fullPath);
              return { name: e.name, path: fullPath, isDir: e.isDirectory(), size: stat.size, mtime: stat.mtime };
            } catch {
              return null;
            }
          })
      )
    ).filter(Boolean);

    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Folder view preference ────────────────────────────────────────────────────

app.post('/api/folder-view', (req, res) => {
  const { path: folderPath, view } = req.body;
  if (!['grid', 'list'].includes(view)) return res.status(400).json({ error: 'invalid view' });
  const config = loadConfig();
  if (!config.folderViews) config.folderViews = {};
  config.folderViews[folderPath] = view;
  saveConfig(config);
  res.json({ ok: true });
});

// ── Bookmarks ─────────────────────────────────────────────────────────────────

app.get('/api/bookmarks', (req, res) => res.json(loadConfig().bookmarks || []));

app.post('/api/bookmarks', (req, res) => {
  const config = loadConfig();
  config.bookmarks = req.body;
  saveConfig(config);
  res.json({ ok: true });
});

// ── Move (handles cross-filesystem via copy+delete) ───────────────────────────

app.post('/api/move', async (req, res) => {
  const { from, to } = req.body;
  if (!Array.isArray(from) || !to) return res.status(400).json({ error: 'from[] and to required' });

  try {
    for (const src of from) {
      if (!isAllowedPath(src)) throw new Error(`path not allowed: ${src}`);
      const dest = path.join(to, path.basename(src));
      try {
        await fsp.rename(src, dest);
      } catch (err) {
        if (err.code === 'EXDEV') {
          // cross-filesystem move: copy then delete (xattrs not preserved by copyFile)
          const tags = readTags(src);
          await fsp.copyFile(src, dest);
          if (tags.length) writeTags(dest, tags);
          await fsp.unlink(src);
        } else {
          throw err;
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Make directory ────────────────────────────────────────────────────────────

app.post('/api/mkdir', async (req, res) => {
  const { path: dirPath } = req.body;
  if (!isAllowedPath(dirPath)) return res.status(403).json({ error: 'path not allowed' });
  try {
    await fsp.mkdir(dirPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Trash (soft delete with undo) ─────────────────────────────────────────────

// Moves src → dest, handling cross-filesystem (EXDEV) for both files and dirs
async function trashMove(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    const stat = await fsp.stat(src);
    if (stat.isDirectory()) {
      await fsp.cp(src, dest, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
    } else {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    }
  }
}

app.post('/api/trash', async (req, res) => {
  const { path: filePath } = req.body;
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  try {
    if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const trashPath = path.join(TRASH_DIR, `${id}_${path.basename(filePath)}`);
    await trashMove(filePath, trashPath);
    res.json({ ok: true, trashPath, originalPath: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trash/restore', async (req, res) => {
  const { trashPath, originalPath } = req.body;
  try {
    await trashMove(trashPath, originalPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trash/purge', async (req, res) => {
  const { trashPath } = req.body;
  try {
    await fsp.rm(trashPath, { recursive: true, force: true });
  } catch { /* already gone */ }
  res.json({ ok: true });
});

// ── Download ──────────────────────────────────────────────────────────────────

app.get('/api/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  res.download(filePath, path.basename(filePath));
});

// ── File serving (for img src / preview) ─────────────────────────────────────

app.get('/files/*', (req, res) => {
  const filePath = '/' + req.params[0];
  if (!isAllowedPath(filePath)) return res.status(403).send('Forbidden');
  res.sendFile(filePath, { headers: { 'Cache-Control': 'public, max-age=86400' } });
});

// ── ComfyUI workflow prompt extraction ───────────────────────────────────────

const CLIP_TYPES = new Set([
  'CLIPTextEncode', 'CLIPTextEncodeSDXL', 'CLIPTextEncodeSDXLRefiner',
  'smZ CLIPTextEncode', 'BNK_CLIPTextEncodeAdvanced',
]);

function readPngTextChunks(filePath) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return {}; }
  // PNG signature
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return {};
  const result = {};
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type   = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IEND') break;
    if (type === 'tEXt' && offset + 8 + length <= buf.length) {
      const data    = buf.subarray(offset + 8, offset + 8 + length);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = data.toString('ascii', 0, nullIdx);
        result[key] = data.toString('utf8', nullIdx + 1);
      }
    }
    offset += 12 + length;
  }
  return result;
}

// Node types that are entry points into the text graph
const TEXT_ENTRY_TYPES = new Set([
  ...CLIP_TYPES,
  'TextEncodeQwenImageEditPlus',
  'CLIPTextEncodeFlux',
]);

function extractPrompts(workflowJson) {
  try {
    const wf = JSON.parse(workflowJson);
    const prompts = [];

    if (Array.isArray(wf.nodes)) {
      // UI workflow format: widgets_values[0] holds the text directly
      for (const node of wf.nodes) {
        const text = node.widgets_values?.[0];
        if (typeof text !== 'string' || !text.trim()) continue;
        if (TEXT_ENTRY_TYPES.has(node.type) || node.type === 'PrimitiveStringMultiline') {
          prompts.push({ title: node.title || node.type, text: text.trim() });
        }
      }
    } else {
      // API prompt format: trace graph backwards from text-encode entry points
      const TEXT_KEYS = ['text', 'prompt', 'value', 'text_a', 'text_b'];
      const seen = new Set();

      function collectText(nodeId, fallbackTitle) {
        if (seen.has(nodeId)) return;
        seen.add(nodeId);
        const node = wf[nodeId];
        if (!node) return;
        const title = node._meta?.title || fallbackTitle || node.class_type;
        for (const key of TEXT_KEYS) {
          const val = (node.inputs || {})[key];
          if (typeof val === 'string' && val.trim()) {
            prompts.push({ title, text: val.trim() });
          } else if (Array.isArray(val) && typeof val[0] === 'string') {
            collectText(val[0], title);
          }
        }
      }

      // Seed traversal from CLIP / text-encode entry nodes
      for (const [id, node] of Object.entries(wf)) {
        if (!TEXT_ENTRY_TYPES.has(node.class_type)) continue;
        const title = node._meta?.title || node.class_type;
        for (const key of ['text', 'prompt']) {
          const val = (node.inputs || {})[key];
          if (typeof val === 'string' && val.trim()) {
            seen.add(id);
            prompts.push({ title, text: val.trim() });
          } else if (Array.isArray(val) && typeof val[0] === 'string') {
            collectText(val[0], title);
          }
        }
      }

      // Pick up any PrimitiveStringMultiline not reachable from a CLIP node
      for (const [id, node] of Object.entries(wf)) {
        if (node.class_type === 'PrimitiveStringMultiline' && !seen.has(id)) {
          const val = node.inputs?.value;
          if (typeof val === 'string' && val.trim()) {
            prompts.push({ title: node._meta?.title || 'Prompt', text: val.trim() });
          }
        }
      }
    }

    return prompts;
  } catch { return []; }
}

app.get('/api/prompt', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  if (path.extname(filePath).toLowerCase() !== '.png') return res.json({ prompts: [] });
  const chunks = readPngTextChunks(filePath);
  let prompts = chunks.workflow ? extractPrompts(chunks.workflow) : [];
  if (!prompts.length && chunks.prompt) prompts = extractPrompts(chunks.prompt);
  res.json({ prompts });
});

// ── Tags ──────────────────────────────────────────────────────────────────────

app.get('/api/tags', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  res.json({ tags: readTags(filePath) });
});

app.post('/api/tags', (req, res) => {
  const { path: filePath, tags } = req.body;
  if (!filePath || !Array.isArray(tags)) return res.status(400).json({ error: 'path and tags[] required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  writeTags(filePath, tags);
  res.json({ ok: true });
});

app.get('/api/tags/vocab', async (req, res) => {
  const config = loadConfig();
  const roots = Object.values(config.roots || {}).filter(Boolean);
  const filePaths = [];
  const LIMIT = 1000;

  async function walk(dir) {
    if (filePaths.length >= LIMIT) return;
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (filePaths.length >= LIMIT) break;
      if (item.name.startsWith('.')) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else filePaths.push(full);
    }
  }

  try {
    for (const root of roots) await walk(root);

    const pyScript = [
      'import os,sys,json',
      'paths=json.loads(sys.stdin.read())',
      'tags=set()',
      'for p in paths:',
      '  try:',
      '    v=os.getxattr(p,"user.xdg.tags").decode()',
      '    [tags.add(t.strip()) for t in v.split(",") if t.strip()]',
      '  except: pass',
      'print(json.dumps(sorted(tags)))',
    ].join('\n');

    const out = execFileSync('python3', ['-c', pyScript],
      { input: JSON.stringify(filePaths), encoding: 'utf8', timeout: 10000 });
    res.json({ tags: JSON.parse(out.trim()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Index: rebuild ────────────────────────────────────────────────────────────

app.post('/api/index/rebuild', async (req, res) => {
  const config = loadConfig();
  const libraryRoot = config.roots?.library;
  if (!libraryRoot) return res.status(400).json({ error: 'library root not configured' });

  const entries = [];

  async function walk(dir) {
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
      } else {
        try {
          const stat = await fsp.stat(fullPath);
          entries.push({
            path: path.relative(libraryRoot, fullPath),
            name: item.name,
            ext: path.extname(item.name).toLowerCase(),
            size: stat.size,
            mtime: stat.mtime,
          });
        } catch { }
      }
    }
  }

  try {
    await walk(libraryRoot);
    if (!fs.existsSync(INDEX_DIR)) fs.mkdirSync(INDEX_DIR);
    const index = { root: libraryRoot, indexedAt: new Date().toISOString(), entries };
    fs.writeFileSync(path.join(INDEX_DIR, 'library.json'), JSON.stringify(index));
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Index: search ─────────────────────────────────────────────────────────────

app.get('/api/index/search', (req, res) => {
  const { q } = req.query;
  const indexPath = path.join(INDEX_DIR, 'library.json');
  if (!fs.existsSync(indexPath)) return res.json({ folders: [], files: [], indexed: false });

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const lower = (q || '').toLowerCase();

  // Derive unique folder paths from file entries
  const folderSet = new Set();
  index.entries.forEach(e => {
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'));
    }
  });

  const folders = Array.from(folderSet)
    .filter(rel => !lower || rel.split('/').pop().toLowerCase().includes(lower))
    .sort()
    .map(rel => ({ rel, name: rel.split('/').pop(), absPath: index.root + '/' + rel }));

  const files = lower
    ? index.entries.filter(e => e.name.toLowerCase().includes(lower))
    : [];

  res.json({ folders: folders.slice(0, 100), files: files.slice(0, 300), root: index.root, indexed: true });
});

// ── ComfyUI helpers ───────────────────────────────────────────────────────────

function comfyGet(baseUrl, urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const req = http.get({
      hostname: u.hostname,
      port: parseInt(u.port) || 80,
      path: u.pathname,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
  });
}

function comfyPost(baseUrl, urlPath, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const u = new URL(urlPath, baseUrl);
    const req = http.request({
      hostname: u.hostname,
      port: parseInt(u.port) || 80,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

app.get('/api/comfyui/status', async (req, res) => {
  const config = loadConfig();
  const comfyUrl = config.comfyuiUrl || 'http://localhost:8188';
  try {
    const queue = await comfyGet(comfyUrl, '/api/queue');
    const running = (queue.queue_running?.length || 0) > 0;
    const queueDepth = (queue.queue_running?.length || 0) + (queue.queue_pending?.length || 0);
    const currentPromptId = queue.queue_running?.[0]?.[1] ?? null;
    res.json({ running, queueDepth, currentPromptId });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/comfyui/generate', async (req, res) => {
  const { filePath, positiveBody, negativePrompt, seed } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });

  const config = loadConfig();
  const comfyUrl = config.comfyuiUrl || 'http://192.168.0.110:8188';

  // Upload image to ComfyUI input folder
  let uploadResult;
  try {
    const out = execFileSync('curl', ['-s', '-F', `image=@${filePath}`, `${comfyUrl}/api/upload/image`],
      { encoding: 'utf8', timeout: 30000 });
    uploadResult = JSON.parse(out);
  } catch (err) {
    return res.status(500).json({ error: `Upload failed: ${err.message}` });
  }

  const uploadedName = uploadResult.subfolder
    ? `${uploadResult.subfolder}/${uploadResult.name}`
    : uploadResult.name;

  // Load and clone workflow template
  const templatePath = path.join(__dirname, 'workflows', 'qwen-image-edit.api.json');
  const prompt = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

  prompt['47'].inputs.image = uploadedName;
  prompt['62'].inputs.value = positiveBody || '';
  if (negativePrompt !== undefined && negativePrompt !== null) {
    prompt['48'].inputs.value = negativePrompt;
  }
  prompt['46'].inputs.seed = (seed != null && !isNaN(seed))
    ? seed
    : Math.floor(Math.random() * 2 ** 32);

  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const t = now.toTimeString().slice(0, 5).replace(':', '');
  prompt['45'].inputs.filename_prefix = `${d}/qwen-${d}${t}`;

  try {
    const result = await comfyPost(comfyUrl, '/api/prompt', { prompt });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

// ── SPA fallback — inject version into asset URLs for cache-busting ──────────

const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

app.get('*', (req, res) => {
  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  // Stamp ?v= on all local JS and CSS references so each deploy gets fresh assets
  html = html.replace(/((?:src|href)=")(\/[^"]+\.(?:js|css))(")/g,
    `$1$2?v=${APP_VERSION}$3`);
  res.type('html').set('Cache-Control', 'no-cache').send(html);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const config = loadConfig();
const port = config.port || 3000;
app.listen(port, () => console.log(`Asset Server → http://localhost:${port}`));
