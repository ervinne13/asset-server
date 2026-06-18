const express = require('express');
const path = require('path');
const { isAllowedPath } = require('../lib/config');
const { joinVideos } = require('../lib/video');

const router = express.Router();

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ogv', '.wmv']);

// Natural sort by basename so seg01 < seg02 < … < seg10.
function byName(a, b) {
  return path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' });
}

router.post('/api/join', async (req, res) => {
  const { paths, audioPath, outputName } = req.body;
  if (!Array.isArray(paths) || paths.length < 2) {
    return res.status(400).json({ error: 'paths[] with at least 2 videos required' });
  }
  for (const p of paths) {
    if (!isAllowedPath(p)) return res.status(403).json({ error: `path not allowed: ${p}` });
    if (!VIDEO_EXTS.has(path.extname(p).toLowerCase())) {
      return res.status(400).json({ error: `not a video: ${path.basename(p)}` });
    }
  }
  if (audioPath && !isAllowedPath(audioPath)) {
    return res.status(403).json({ error: 'audio path not allowed' });
  }

  const ordered = [...paths].sort(byName);
  const dir = path.dirname(ordered[0]);
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const base = (outputName && outputName.trim())
    ? outputName.trim().replace(/[/\\]/g, '_').replace(/\.[^.]+$/, '')
    : `joined-${ts}`;
  const output = path.join(dir, `${base}.mp4`);

  try {
    await joinVideos({ inputs: ordered, output, audioPath: audioPath || undefined });
    res.json({ ok: true, output, count: ordered.length });
  } catch (err) {
    res.status(500).json({ error: `Join failed: ${err.message}` });
  }
});

module.exports = router;
