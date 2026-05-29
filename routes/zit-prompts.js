const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadConfig } = require('../lib/config');
const { comfyGet } = require('../lib/comfyui');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROMPTS_FILE = path.join(DATA_DIR, 'saved-prompts.json');
const IMAGES_DIR = path.join(DATA_DIR, 'zit-images');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function loadPrompts() {
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); } catch { return []; }
}

function savePrompts(prompts) {
  ensureDataDir();
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
}

router.get('/api/zit-prompts', (req, res) => {
  const prompts = loadPrompts();
  prompts.sort((a, b) => a.title.localeCompare(b.title));
  res.json(prompts);
});

router.post('/api/zit-prompts', (req, res) => {
  const { title, text, nsfw } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  ensureDataDir();
  const prompts = loadPrompts();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id, title: title.trim(), text: text.trim(), nsfw: !!nsfw, createdAt: new Date().toISOString() };
  prompts.push(entry);
  savePrompts(prompts);
  res.json(entry);
});

router.delete('/api/zit-prompts/:id', (req, res) => {
  let prompts = loadPrompts();
  const entry = prompts.find(p => p.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (entry.imageFile) {
    try { fs.unlinkSync(path.join(IMAGES_DIR, entry.imageFile)); } catch {}
  }
  savePrompts(prompts.filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

router.get('/api/zit-prompts/:id/image', (req, res) => {
  const prompts = loadPrompts();
  const entry = prompts.find(p => p.id === req.params.id);
  if (!entry?.imageFile) return res.status(404).json({ error: 'no image' });
  const imgPath = path.join(IMAGES_DIR, entry.imageFile);
  if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'image not found' });
  res.sendFile(imgPath);
});

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get({
      hostname: u.hostname,
      port: parseInt(u.port) || 80,
      path: u.pathname + u.search,
    }, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function pollAndSaveImage(promptId, savedPromptId) {
  const base = loadConfig().comfyuiUrl || 'http://localhost:8188';
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const history = await comfyGet(base, `/history/${promptId}`);
      const entry = history[promptId];
      if (!entry) continue;

      let imageOutput = null;
      for (const nodeOut of Object.values(entry.outputs || {})) {
        if (nodeOut.images?.length) { imageOutput = nodeOut.images[0]; break; }
      }
      if (!imageOutput) continue;

      ensureDataDir();
      const destFile = `${savedPromptId}-${Date.now()}.png`;
      const destPath = path.join(IMAGES_DIR, destFile);
      const viewUrl = `${base}/view?filename=${encodeURIComponent(imageOutput.filename)}&subfolder=${encodeURIComponent(imageOutput.subfolder || '')}&type=${encodeURIComponent(imageOutput.type || 'output')}`;
      await downloadBinary(viewUrl, destPath);

      const prompts = loadPrompts();
      const p = prompts.find(p => p.id === savedPromptId);
      if (p) {
        if (p.imageFile) {
          try { fs.unlinkSync(path.join(IMAGES_DIR, p.imageFile)); } catch {}
        }
        p.imageFile = destFile;
        savePrompts(prompts);
        console.log(`[zit-prompts] saved image for "${p.title}" → ${destFile}`);
      }
      return;
    } catch (err) {
      console.error(`[zit-prompts] poll error (attempt ${i + 1}):`, err.message);
    }
  }
  console.warn(`[zit-prompts] gave up polling image for savedPromptId=${savedPromptId}`);
}

module.exports = { router, pollAndSaveImage };
