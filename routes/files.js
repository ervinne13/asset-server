const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const { loadConfig, saveConfig, isAllowedPath } = require('../lib/config');

const router = express.Router();

router.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

router.get('/api/ls', async (req, res) => {
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

router.post('/api/folder-view', (req, res) => {
  const { path: folderPath, view } = req.body;
  if (!['grid', 'list'].includes(view)) return res.status(400).json({ error: 'invalid view' });
  const config = loadConfig();
  if (!config.folderViews) config.folderViews = {};
  config.folderViews[folderPath] = view;
  saveConfig(config);
  res.json({ ok: true });
});

router.post('/api/folder-sort', (req, res) => {
  const { path: folderPath, sort } = req.body;
  if (!['newest', 'oldest', 'alpha-asc', 'alpha-desc'].includes(sort)) return res.status(400).json({ error: 'invalid sort' });
  const config = loadConfig();
  if (!config.folderSorts) config.folderSorts = {};
  config.folderSorts[folderPath] = sort;
  saveConfig(config);
  res.json({ ok: true });
});

router.get('/api/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  res.download(filePath, path.basename(filePath));
});

router.get('/files/*', (req, res) => {
  const filePath = '/' + req.params[0];
  if (!isAllowedPath(filePath)) return res.status(403).send('Forbidden');
  // ?t= is the mtime timestamp — URL changes when file changes, so it's safe to cache immutably
  const cacheControl = req.query.t
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';
  res.sendFile(filePath, { headers: { 'Cache-Control': cacheControl } });
});

module.exports = router;
