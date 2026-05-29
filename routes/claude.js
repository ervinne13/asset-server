const express = require('express');
const { execFile } = require('child_process');

const router = express.Router();

function tmux(args) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

router.get('/api/claude/status', async (req, res) => {
  try {
    await tmux(['has-session', '-t', 'comfyui-mcp']);
    res.json({ running: true });
  } catch {
    res.json({ running: false });
  }
});

router.post('/api/claude/start', async (req, res) => {
  try {
    await tmux(['has-session', '-t', 'comfyui-mcp']);
    return res.json({ ok: true, already: true });
  } catch {
    // session doesn't exist — create it
  }
  try {
    await tmux(['new-session', '-d', '-s', 'comfyui-mcp', '-c', '/home/ervinne/projects/comfyui-mcp', 'claude', '--model', 'claude-sonnet-4-6']);
    res.json({ ok: true });
    // wait for claude to initialize, then activate remote control
    setTimeout(() => {
      tmux(['send-keys', '-t', 'comfyui-mcp', '/remote-control', 'Enter']).catch(() => {});
    }, 3000);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/claude/stop', async (req, res) => {
  try {
    await tmux(['kill-session', '-t', 'comfyui-mcp']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
