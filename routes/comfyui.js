const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, isAllowedPath } = require('../lib/config');
const { comfyGet, comfyPost, readPngTextChunks, extractPrompts } = require('../lib/comfyui');

const router = express.Router();
const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

function comfyUrl(config) {
  return config.comfyuiUrl || 'http://localhost:8188';
}

function datePrefix(tag) {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const t = now.toTimeString().slice(0, 5).replace(':', '');
  return `${d}/${tag}-${d}${t}`;
}

router.get('/api/prompt', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });
  if (path.extname(filePath).toLowerCase() !== '.png') return res.json({ prompts: [] });
  const chunks = readPngTextChunks(filePath);
  let prompts = chunks.workflow ? extractPrompts(chunks.workflow) : [];
  if (!prompts.length && chunks.prompt) prompts = extractPrompts(chunks.prompt);
  res.json({ prompts });
});

router.get('/api/comfyui/status', async (req, res) => {
  const url = comfyUrl(loadConfig());
  try {
    const queue = await comfyGet(url, '/api/queue');
    res.json({
      running: (queue.queue_running?.length || 0) > 0,
      queueDepth: (queue.queue_running?.length || 0) + (queue.queue_pending?.length || 0),
      currentPromptId: queue.queue_running?.[0]?.[1] ?? null,
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/api/comfyui/generate', async (req, res) => {
  const { filePath, positiveBody, negativePrompt, seed } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });

  const config = loadConfig();
  const url = comfyUrl(config);

  let uploadResult;
  try {
    const out = execFileSync('curl', ['-s', '-F', `image=@${filePath}`, `${url}/api/upload/image`],
      { encoding: 'utf8', timeout: 30000 });
    uploadResult = JSON.parse(out);
  } catch (err) {
    return res.status(500).json({ error: `Upload failed: ${err.message}` });
  }

  const uploadedName = uploadResult.subfolder
    ? `${uploadResult.subfolder}/${uploadResult.name}`
    : uploadResult.name;

  const prompt = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'qwen-image-edit.api.json'), 'utf8'));
  prompt['47'].inputs.image = uploadedName;
  prompt['62'].inputs.value = positiveBody || '';
  if (negativePrompt !== undefined && negativePrompt !== null) {
    prompt['48'].inputs.value = negativePrompt;
  }
  prompt['46'].inputs.seed = (seed != null && !isNaN(seed)) ? seed : Math.floor(Math.random() * 2 ** 32);
  prompt['45'].inputs.filename_prefix = datePrefix('qwen');

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

router.post('/api/comfyui/zit-txt2img', async (req, res) => {
  const { prompt, seed } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'zit-txt2img.api.json'), 'utf8'));

  workflow['57:27'].inputs.text = prompt.trim();
  workflow['57:3'].inputs.seed = (seed != null && !isNaN(seed)) ? seed : Math.floor(Math.random() * 2 ** 32);
  workflow['9'].inputs.filename_prefix = datePrefix('zit');

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

module.exports = router;
