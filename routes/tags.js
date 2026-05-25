const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, isAllowedPath } = require('../lib/config');
const { readTags, writeTags } = require('../lib/xattrs');

const router = express.Router();

router.get('/api/tags', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  res.json({ tags: readTags(filePath) });
});

router.post('/api/tags', (req, res) => {
  const { path: filePath, tags } = req.body;
  if (!filePath || !Array.isArray(tags)) return res.status(400).json({ error: 'path and tags[] required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  writeTags(filePath, tags);
  res.json({ ok: true });
});

router.get('/api/tags/vocab', async (req, res) => {
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

module.exports = router;
