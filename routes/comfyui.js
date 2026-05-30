const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, isAllowedPath } = require('../lib/config');
const { comfyGet, comfyPost, readPngTextChunks, extractPrompts } = require('../lib/comfyui');
const { pollAndSaveImage } = require('./saved-prompts');

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
  const { prompt, seed, savedPromptId, width, height } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'zit-txt2img.api.json'), 'utf8'));

  workflow['57:27'].inputs.text = prompt.trim();
  workflow['57:3'].inputs.seed = (seed != null && !isNaN(seed)) ? seed : Math.floor(Math.random() * 2 ** 32);
  if (width) workflow['57:13'].inputs.width = parseInt(width);
  if (height) workflow['57:13'].inputs.height = parseInt(height);
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

router.post('/api/comfyui/ltx-i2v', async (req, res) => {
  const { prompt, image, duration } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });
  if (!image) return res.status(400).json({ error: 'image required' });

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'ltx-i2v.api.json'), 'utf8'));

  workflow['324'].inputs.image = image;
  workflow['320:319'].inputs.value = prompt.trim();
  workflow['320:301'].inputs.value = [3, 5, 10, 15].includes(Number(duration)) ? Number(duration) : 5;
  workflow['75'].inputs.filename_prefix = datePrefix('ltx-i2v');
  const seed = Math.floor(Math.random() * 2 ** 32);
  workflow['320:276'].inputs.noise_seed = seed;
  workflow['320:277'].inputs.noise_seed = seed + 1;

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

function extractJobInfo(nodes) {
  const prefix = nodes['9']?.inputs?.filename_prefix
    || nodes['6']?.inputs?.filename_prefix
    || nodes['75']?.inputs?.filename_prefix
    || nodes['45']?.inputs?.filename_prefix
    || '';

  let workflow = 'unknown';
  let workflowLabel = 'Unknown';
  let prompt = '';
  let image = null;

  const isLtx = prefix.includes('/ltx-i2v-') || nodes['75']?.class_type === 'SaveVideo';
  const isZit = !isLtx && (prefix.includes('/zit-') || nodes['9']?.class_type === 'SaveImage');
  const isQwenNsfw = !isLtx && !isZit && (prefix.includes('/qwen-nsfw-') || nodes['6']?.class_type === 'SaveImage');
  const isQwen = !isLtx && !isZit && !isQwenNsfw && (prefix.includes('/qwen-') || nodes['45']?.class_type === 'SaveImage');

  if (isZit) {
    workflow = 'zit';
    workflowLabel = 'ZIT T2I';
    prompt = nodes['57:27']?.inputs?.text || '';
  } else if (isQwenNsfw) {
    workflow = 'qwen-nsfw';
    workflowLabel = 'Qwen I2I';
    prompt = nodes['12']?.inputs?.text || '';
    image = nodes['11']?.inputs?.image || null;
  } else if (isLtx) {
    workflow = 'ltx-i2v';
    workflowLabel = 'LTX I2V';
    prompt = nodes['320:319']?.inputs?.value || '';
    image = nodes['324']?.inputs?.image || null;
  } else if (isQwen) {
    workflow = 'qwen';
    workflowLabel = 'Qwen Edit';
    prompt = nodes['62']?.inputs?.value || '';
    image = nodes['47']?.inputs?.image || null;
  }

  if (!prompt) {
    const prompts = extractPrompts(JSON.stringify(nodes));
    prompt = prompts[0]?.text || '';
  }

  let submittedAt = null;
  const m = prefix.match(/(\d{8})(\d{4})$/);
  if (m) {
    submittedAt = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:00`;
  }

  return { workflow, workflowLabel, prefix, prompt, image, submittedAt };
}

router.get('/api/comfyui/queue', async (req, res) => {
  const url = comfyUrl(loadConfig());
  try {
    const queue = await comfyGet(url, '/api/queue');
    const parseJob = (entry, status) => {
      const [queueNum, promptId, nodes] = entry;
      return { queueNum, promptId, status, ...extractJobInfo(nodes || {}) };
    };
    res.json({
      running: (queue.queue_running || []).map(e => parseJob(e, 'running')),
      pending: (queue.queue_pending || []).map(e => parseJob(e, 'pending')),
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/api/comfyui/cancel', async (req, res) => {
  const { promptId } = req.body;
  if (!promptId) return res.status(400).json({ error: 'promptId required' });
  const url = comfyUrl(loadConfig());
  try {
    await comfyPost(url, '/api/queue', { delete: [promptId] });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/comfyui/interrupt', async (req, res) => {
  const url = comfyUrl(loadConfig());
  try {
    await comfyPost(url, '/api/interrupt', {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
