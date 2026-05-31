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

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sessionExists() {
  return tmux(['has-session', '-t', 'comfyui-mcp']).then(() => true).catch(() => false);
}

let sessionUrl = null;

async function tryGetSessionUrl() {
  if (sessionUrl) return sessionUrl;
  try {
    const pane = await tmux(['capture-pane', '-t', 'comfyui-mcp', '-p', '-S', '-50']);
    const m = pane.match(/https:\/\/claude\.ai\/code\/session_\w+/);
    if (m) sessionUrl = m[0];
  } catch {}
  return sessionUrl;
}

async function ensureRCRunning() {
  if (await sessionExists()) return { ok: true, already: true };
  await tmux(['new-session', '-d', '-s', 'comfyui-mcp', '-c', '/home/ervinne/projects/comfyui-mcp', 'claude', '--model', 'claude-sonnet-4-6']);
  setTimeout(async () => {
    try {
      await tmux(['send-keys', '-t', 'comfyui-mcp', '/remote-control', 'Enter']);
      await delay(5000);
      await tryGetSessionUrl();
    } catch {}
  }, 3000);
  return { ok: true };
}

router.get('/api/claude/status', async (req, res) => {
  const running = await sessionExists();
  if (!running) sessionUrl = null;
  const url = running ? await tryGetSessionUrl() : null;
  res.json({ running, sessionUrl: url });
});

router.post('/api/claude/start', async (req, res) => {
  try {
    res.json(await ensureRCRunning());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/claude/stop', async (req, res) => {
  try {
    await tmux(['kill-session', '-t', 'comfyui-mcp']);
    sessionUrl = null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
