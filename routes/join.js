const express = require('express');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { isAllowedPath } = require('../lib/config');

const router = express.Router();

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ogv', '.wmv']);

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', ...args], { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-600)));
      else resolve(stdout);
    });
  });
}

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

  const listFile = path.join(os.tmpdir(), `join-${Date.now()}.txt`);
  const listBody = ordered.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');

  try {
    await fsp.writeFile(listFile, listBody);

    const concatInput = ['-f', 'concat', '-safe', '0', '-i', listFile];
    const audioInput = audioPath ? ['-i', audioPath] : [];
    const audioMap = audioPath
      ? ['-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-shortest']
      : [];

    // Fast path: stream-copy the video (lossless, instant). Works when all
    // inputs share codec/resolution/fps — true for one Motion Capture batch.
    try {
      const vcodec = audioPath ? ['-c:v', 'copy'] : ['-c', 'copy'];
      await runFfmpeg([...concatInput, ...audioInput, ...audioMap, ...vcodec, output]);
    } catch (copyErr) {
      // Fallback: re-encode via concat filter — handles mismatched inputs.
      const n = ordered.length;
      const inputs = ordered.flatMap(p => ['-i', p]);
      const filter = ordered.map((_, i) => `[${i}:v:0]`).join('') + `concat=n=${n}:v=1:a=0[outv]`;
      const args = [...inputs, ...audioInput, '-filter_complex', filter, '-map', '[outv]'];
      if (audioPath) args.push('-map', `${n}:a:0`, '-c:a', 'aac', '-shortest');
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', output);
      await runFfmpeg(args);
    }

    res.json({ ok: true, output, count: ordered.length });
  } catch (err) {
    res.status(500).json({ error: `Join failed: ${err.message}` });
  } finally {
    fsp.unlink(listFile).catch(() => {});
  }
});

module.exports = router;
