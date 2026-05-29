const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, isAllowedPath } = require('../lib/config');
const { comfyGet, comfyPost, readPngTextChunks, extractPrompts } = require('../lib/comfyui');
const { pollAndSaveImage } = require('./zit-prompts');

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
  const { prompt, seed, savedPromptId } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'zit-txt2img.api.json'), 'utf8'));

  workflow['57:27'].inputs.text = prompt.trim();
  workflow['57:3'].inputs.seed = (seed != null && !isNaN(seed)) ? seed : Math.floor(Math.random() * 2 ** 32);
  workflow['9'].inputs.filename_prefix = datePrefix('zit');

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    if (savedPromptId && result.prompt_id) {
      pollAndSaveImage(result.prompt_id, savedPromptId).catch(() => {});
    }
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

router.post('/api/comfyui/upload-image', async (req, res) => {
  const url = comfyUrl(loadConfig());
  const contentType = req.headers['content-type'] || '';

  let filePath = null;
  let filename = null;
  let isTemp = false;

  try {
    if (contentType.startsWith('application/octet-stream')) {
      filename = (req.headers['x-filename'] || `upload-${Date.now()}.png`)
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join(os.tmpdir(), `comfy-${Date.now()}-${filename}`);
      isTemp = true;
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filePath);
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      });
    } else {
      const { path: libPath } = req.body;
      if (!libPath) return res.status(400).json({ error: 'path required' });
      if (!isAllowedPath(libPath)) return res.status(403).json({ error: 'path not allowed' });
      filePath = libPath;
      filename = path.basename(libPath);
    }

    const out = execFileSync('curl', [
      '-s', '-F', `image=@${filePath};filename=${filename}`, `${url}/api/upload/image`,
    ], { encoding: 'utf8', timeout: 30000 });
    const result = JSON.parse(out);
    const comfyFilename = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    res.json({ comfyFilename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (isTemp && filePath) { try { fs.unlinkSync(filePath); } catch {} }
  }
});

router.post('/api/comfyui/qwen-i2i-nsfw', async (req, res) => {
  const { prompt, negativePrompt, mainImage, supportImage, seed, width, height, savedPromptId } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'qwen-i2i-nsfw.api.json'), 'utf8'));

  workflow['12'].inputs.text = prompt.trim();
  if (negativePrompt != null) workflow['7'].inputs.text = negativePrompt;
  workflow['2'].inputs.seed = (seed != null && !isNaN(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 32);
  if (width) workflow['10'].inputs.width = parseInt(width);
  if (height) workflow['10'].inputs.height = parseInt(height);
  if (mainImage) workflow['11'].inputs.image = mainImage;
  if (supportImage) workflow['14'].inputs.image = supportImage;
  workflow['6'].inputs.filename_prefix = datePrefix('qwen-nsfw');

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    if (savedPromptId && result.prompt_id) {
      pollAndSaveImage(result.prompt_id, savedPromptId).catch(() => {});
    }
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

module.exports = router;
