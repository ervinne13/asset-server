const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-600)));
      else resolve(stdout);
    });
  });
}

function ffmpeg(args) {
  return run('ffmpeg', ['-y', ...args]);
}

// Decode the final ~0.5s, writing each frame to the same PNG (overwrite), so the
// file ends up holding the true last frame of the video.
async function extractLastFrame(videoPath, outPng) {
  await ffmpeg(['-sseof', '-0.5', '-i', videoPath, '-update', '1', '-q:v', '2', outPng]);
  return outPng;
}

async function probeDuration(filePath) {
  const out = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nokey=1:noprint_wrappers=1', filePath,
  ]);
  const n = parseFloat(out.trim());
  return Number.isFinite(n) ? n : null;
}

// Concatenate videos in the given order. Tries a lossless stream-copy first
// (works when inputs share codec/params), falls back to a re-encode. Optionally
// muxes audio from audioPath, trimmed to the joined video length.
async function joinVideos({ inputs, output, audioPath }) {
  const listFile = path.join(os.tmpdir(), `join-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const listBody = inputs.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');

  try {
    await fsp.writeFile(listFile, listBody);

    const concatInput = ['-f', 'concat', '-safe', '0', '-i', listFile];
    const audioInput = audioPath ? ['-i', audioPath] : [];
    const audioMap = audioPath ? ['-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-shortest'] : [];

    try {
      const vcodec = audioPath ? ['-c:v', 'copy'] : ['-c', 'copy'];
      await ffmpeg([...concatInput, ...audioInput, ...audioMap, ...vcodec, output]);
    } catch {
      // Fallback: re-encode via concat filter (handles mismatched inputs).
      const n = inputs.length;
      const ins = inputs.flatMap(p => ['-i', p]);
      const filter = inputs.map((_, i) => `[${i}:v:0]`).join('') + `concat=n=${n}:v=1:a=0[outv]`;
      const args = [...ins, ...audioInput, '-filter_complex', filter, '-map', '[outv]'];
      if (audioPath) args.push('-map', `${n}:a:0`, '-c:a', 'aac', '-shortest');
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', output);
      await ffmpeg(args);
    }
    return output;
  } finally {
    fsp.unlink(listFile).catch(() => {});
  }
}

module.exports = { extractLastFrame, probeDuration, joinVideos };
