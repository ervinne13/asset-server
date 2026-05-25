const express = require('express');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../lib/config');

const router = express.Router();
const INDEX_DIR = path.join(__dirname, '..', 'index');

router.post('/api/index/rebuild', async (req, res) => {
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

router.get('/api/index/search', (req, res) => {
  const { q } = req.query;
  const indexPath = path.join(INDEX_DIR, 'library.json');
  if (!fs.existsSync(indexPath)) return res.json({ folders: [], files: [], indexed: false });

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const lower = (q || '').toLowerCase();

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

module.exports = router;
