const express = require('express');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { isAllowedPath } = require('../lib/config');

const router = express.Router();

const THUMB_DIR = path.join(__dirname, '..', 'thumbnails');
const THUMB_WIDTH = 600;

router.get('/api/thumb', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });

  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  const thumbPath = path.join(THUMB_DIR, hash + '.jpg');

  try {
    const [srcStat, thumbStat] = await Promise.allSettled([
      fsp.stat(filePath),
      fsp.stat(thumbPath),
    ]);

    if (srcStat.status === 'rejected') return res.status(404).json({ error: 'file not found' });

    const srcMtime = srcStat.value.mtimeMs;
    const thumbMtime = thumbStat.status === 'fulfilled' ? thumbStat.value.mtimeMs : 0;

    if (thumbMtime < srcMtime) {
      await sharp(filePath)
        .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(thumbPath);
    }

    const cacheControl = req.query.t
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400';

    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(thumbPath);
  } catch (err) {
    console.error('thumb error:', filePath, err.message);
    res.redirect(`/files${filePath}`);
  }
});

module.exports = router;
