const express = require('express');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isAllowedPath } = require('../lib/config');

const router = express.Router();
const TRASH_DIR = path.join(os.tmpdir(), 'asset-server-trash');

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

router.post('/api/trash', async (req, res) => {
  const { path: filePath } = req.body;
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  try {
    if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const trashPath = path.join(TRASH_DIR, `${id}_${path.basename(filePath)}`);
    await trashMove(filePath, trashPath);
    fs.writeFileSync(trashPath + '.meta.json', JSON.stringify({ originalPath: filePath, trashedAt: Date.now() }));
    res.json({ ok: true, trashPath, originalPath: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/trash/list', async (req, res) => {
  try {
    if (!fs.existsSync(TRASH_DIR)) return res.json({ items: [] });
    const entries = await fsp.readdir(TRASH_DIR);
    const items = [];
    for (const name of entries) {
      if (name.endsWith('.meta.json')) continue;
      const trashPath = path.join(TRASH_DIR, name);
      const metaPath = trashPath + '.meta.json';
      let originalPath = null, trashedAt = null;
      try { ({ originalPath, trashedAt } = JSON.parse(fs.readFileSync(metaPath, 'utf8'))); } catch {}
      let stat;
      try { stat = await fsp.stat(trashPath); } catch { continue; }
      items.push({
        trashPath,
        originalPath,
        name: originalPath ? path.basename(originalPath) : name.replace(/^\d+-[a-z0-9]+_/, ''),
        trashedAt,
        isDir: stat.isDirectory(),
      });
    }
    items.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/trash/restore', async (req, res) => {
  const { trashPath } = req.body;
  let { originalPath } = req.body;
  if (!originalPath) {
    try { ({ originalPath } = JSON.parse(fs.readFileSync(trashPath + '.meta.json', 'utf8'))); } catch {}
  }
  if (!originalPath) return res.status(400).json({ error: 'originalPath required (no sidecar found)' });
  try {
    await trashMove(trashPath, originalPath);
    try { fs.unlinkSync(trashPath + '.meta.json'); } catch {}
    res.json({ ok: true, originalPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/trash/purge', async (req, res) => {
  const { trashPath } = req.body;
  try { await fsp.rm(trashPath, { recursive: true, force: true }); } catch {}
  try { await fsp.unlink(trashPath + '.meta.json'); } catch {}
  res.json({ ok: true });
});

module.exports = router;
