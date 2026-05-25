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
    res.json({ ok: true, trashPath, originalPath: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/trash/restore', async (req, res) => {
  const { trashPath, originalPath } = req.body;
  try {
    await trashMove(trashPath, originalPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/trash/purge', async (req, res) => {
  const { trashPath } = req.body;
  try {
    await fsp.rm(trashPath, { recursive: true, force: true });
  } catch { /* already gone */ }
  res.json({ ok: true });
});

module.exports = router;
