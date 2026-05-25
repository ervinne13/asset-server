const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const { isAllowedPath } = require('../lib/config');
const { readTags, writeTags } = require('../lib/xattrs');

const router = express.Router();

router.post('/api/move', async (req, res) => {
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
          // cross-filesystem: copy+delete, preserving xattrs
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

router.post('/api/mkdir', async (req, res) => {
  const { path: dirPath } = req.body;
  if (!isAllowedPath(dirPath)) return res.status(403).json({ error: 'path not allowed' });
  try {
    await fsp.mkdir(dirPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
