const express = require('express');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.json');
const INDEX_DIR = path.join(__dirname, 'index');
const TRASH_DIR = path.join(os.tmpdir(), 'asset-server-trash');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ── SPA fallback (serve index.html for /staging/*, /library/*, etc.) ─────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

const config = loadConfig();
const port = config.port || 3000;
app.listen(port, () => console.log(`Asset Server → http://localhost:${port}`));
