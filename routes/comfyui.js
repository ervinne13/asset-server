const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { loadConfig, isAllowedPath } = require('../lib/config');
const { comfyGet, comfyPost, readPngTextChunks, extractPrompts, extractSeed } = require('../lib/comfyui');
const { extractLastFrame, probeDuration, joinVideos, trimFirstNFrames } = require('../lib/video');
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

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.gif', '.webp']);

// Save a lightweight sidecar next to where ComfyUI will write the video.
// filenamePrefix is the value set on the SaveVideo node (e.g. '20260601/video/ltx-').
// The video will land as <prefix>_00001.mp4; we strip the counter at read time.
function saveLtxSidecar(stagingRoot, filenamePrefix, text, seed) {
  if (!stagingRoot || !filenamePrefix) return;
  try {
    const sidecarPath = path.join(stagingRoot, `${filenamePrefix}.metadata.json`);
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, JSON.stringify({ text, seed }));
  } catch { /* non-critical */ }
}

router.get('/api/prompt', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.png') {
    const chunks = readPngTextChunks(filePath);
    let prompts = chunks.workflow ? extractPrompts(chunks.workflow) : [];
    if (!prompts.length && chunks.prompt) prompts = extractPrompts(chunks.prompt);
    const seed = extractSeed(chunks.workflow || '') ?? extractSeed(chunks.prompt || '');
    return res.json({ prompts, seed });
  }

  if (VIDEO_EXTS.has(ext)) {
    const base = filePath.slice(0, -ext.length);
    const dir  = path.dirname(base);
    // Strip ComfyUI's _00001 counter (and any trailing suffix like -audio)
    const stripped = path.basename(base).replace(/_\d{5}(-\w+)*$/, '');

    const candidates = [
      `${base}.json`,
      `${base}_metadata.json`,
      path.join(dir, `${stripped}.metadata.json`),
    ];

    for (const sidecar of candidates) {
      if (!fs.existsSync(sidecar)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
        // Our format: { text, seed }
        if (typeof data.text === 'string') {
          const prompts = data.text.trim() ? [{ title: 'Prompt', text: data.text.trim() }] : [];
          return res.json({ prompts, seed: data.seed ?? null });
        }
        // VHS format: { workflow, prompt } — both may be JSON objects or strings
        const wfStr = typeof data.workflow === 'object' ? JSON.stringify(data.workflow) : (data.workflow || '');
        const prStr = typeof data.prompt  === 'object' ? JSON.stringify(data.prompt)  : (data.prompt  || '');
        let prompts = extractPrompts(wfStr);
        if (!prompts.length) prompts = extractPrompts(prStr);
        const seed = extractSeed(wfStr) ?? extractSeed(prStr);
        return res.json({ prompts, seed });
      } catch { continue; }
    }
  }

  res.json({ prompts: [], seed: null });
});

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.tif']);

function findLatestImage(dir, best = { path: null, mtime: 0 }) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return best; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      findLatestImage(full, best);
    } else if (IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
      try {
        const { mtimeMs } = fs.statSync(full);
        if (mtimeMs > best.mtime) { best.mtime = mtimeMs; best.path = full; }
      } catch {}
    }
  }
  return best;
}

router.get('/api/latest-staging-image', (req, res) => {
  const staging = loadConfig().roots?.staging;
  if (!staging) return res.status(404).json({ error: 'staging not configured' });
  const { path: imgPath, mtime } = findLatestImage(staging);
  if (!imgPath) return res.status(404).json({ error: 'no image found in staging' });
  res.json({ path: imgPath, mtime, name: path.basename(imgPath) });
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

  const config = loadConfig();
  const url = comfyUrl(config);
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'ltx-i2v.api.json'), 'utf8'));

  const filenamePrefix = `${new Date().toISOString().slice(0,10).replace(/-/g,'')}/video/ltx-`;
  workflow['324'].inputs.image = image;
  workflow['320:319'].inputs.value = prompt.trim();
  workflow['320:301'].inputs.value = [3, 5, 10, 15].includes(Number(duration)) ? Number(duration) : 5;
  workflow['75'].inputs.filename_prefix = filenamePrefix;
  const seed = Math.floor(Math.random() * 2 ** 32);
  workflow['320:276'].inputs.noise_seed = seed;
  workflow['320:277'].inputs.noise_seed = seed + 1;

  saveLtxSidecar(config.roots?.staging, filenamePrefix, prompt.trim(), seed);

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

// ── Motion Capture: sequential chained generation ──────────────────────────────
// Each segment animates the last frame of the previous segment so the joined clip
// is frame-continuous (no 5s "snap"). Runs as a server-side background job.

const SEG = 5, FPS = 25;
const VIDEO_OUT_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.gif']);

let currentJob = null;
let lastJob = null;

const QUEUE_FILE = path.join(__dirname, '..', 'server-queue.json');
const CURRENT_JOB_FILE = path.join(__dirname, '..', 'server-current-job.json');

function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch { return []; }
}
function writeQueue(q) {
  try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); } catch {}
}
function enqueueJob(entry) {
  const q = readQueue(); q.push(entry); writeQueue(q);
}
function dequeueJob() {
  const q = readQueue(); if (!q.length) return null;
  const entry = q.shift(); writeQueue(q); return entry;
}
function queueLength() { return readQueue().length; }
function persistCurrentJob(job) {
  try { fs.writeFileSync(CURRENT_JOB_FILE, JSON.stringify(job)); } catch (e) { console.error('[mocap] persist error:', e.message); }
}
function clearCurrentJobFile() {
  try { fs.unlinkSync(CURRENT_JOB_FILE); } catch {}
}

function jobFromEntry(entry) {
  return {
    ...entry,
    current: 0, stage: 'queued', status: 'running',
    output: null, error: null, warning: null,
    segmentLogs: [], segmentStartedAt: null,
  };
}

function comfyInputDir(config) {
  if (config.comfyInputDir) return config.comfyInputDir;
  const staging = config.roots?.staging;
  return staging ? path.join(path.dirname(staging), 'input') : null;
}

function uploadFrameToComfy(url, filePath) {
  const out = execFileSync('curl', ['-s', '-F', `image=@${filePath}`, `${url}/api/upload/image`],
    { encoding: 'utf8', timeout: 30000 });
  const r = JSON.parse(out);
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

function resolveVideoOutput(entry, staging) {
  for (const nodeOut of Object.values(entry.outputs || {})) {
    for (const arr of Object.values(nodeOut)) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item.filename !== 'string') continue;
        if (!VIDEO_OUT_EXTS.has(path.extname(item.filename).toLowerCase())) continue;
        return item.fullpath || path.join(staging, item.subfolder || '', item.filename);
      }
    }
  }
  return null;
}

async function waitForVideo(url, promptId, staging, timeoutMs = 45 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let grace = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const history = await comfyGet(url, `/history/${promptId}`);
      const entry = history[promptId];
      if (entry) {
        const out = resolveVideoOutput(entry, staging);
        if (out) return out;
        if (entry.status && entry.status.completed === false) throw new Error('segment did not complete');
      }
      const queue = await comfyGet(url, '/api/queue');
      const ids = [...(queue.queue_running || []), ...(queue.queue_pending || [])].map(e => e[1]);
      if (!ids.includes(promptId)) {
        if (++grace >= 3) throw new Error('segment left the queue without producing a video (failed or cancelled)');
      } else {
        grace = 0;
      }
    } catch (err) {
      if (/did not complete|left the queue/.test(err.message)) throw err;
      // transient comfy/network error → keep polling
    }
  }
  throw new Error('timed out waiting for segment to render');
}

function buildSegment(image, video, skip, segDur, prompt, seed, prefix) {
  const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'scail-animation.api.json'), 'utf8'));
  wf['113'].inputs.video = video;
  wf['113'].inputs.skip_first_frames = skip;
  wf['58'].inputs.image = image;
  wf['126'].inputs.value = segDur;
  if (prompt) wf['6'].inputs.text = prompt;
  wf['3'].inputs.seed = seed;
  wf['49'].inputs.filename_prefix = prefix;
  return wf;
}

async function runChain(job, resumeFrom = 0, resumeLastFrame = null) {
  const config = loadConfig();
  const url = comfyUrl(config);
  const staging = config.roots?.staging;
  // Derive dirPrefix from the batch timestamp so resumed jobs use the same directory.
  const dirPrefix = `${job.batch.slice(0, 8)}/mocap`;

  let refImage = resumeFrom > 0 ? resumeLastFrame : job.image;
  if (!job.rawPaths) job.rawPaths = [];

  // Pre-compute segment durations for verification later.
  const durations = Array.from({ length: job.total }, (_, k) =>
    k === job.total - 1 ? (job.totalDuration - k * SEG) : SEG
  );

  persistCurrentJob(job);

  try {
    for (let i = resumeFrom; i < job.total; i++) {
      const segDur = durations[i];
      job.current = i + 1;
      job.segmentStartedAt = Date.now();
      job.stage = 'generating';

      const prefix = `${dirPrefix}/mocap-${job.batch}-seg${String(i + 1).padStart(2, '0')}`;
      const wf = buildSegment(refImage, job.video, (job.startAt + i * SEG) * FPS, segDur, job.prompt, job.seed, prefix);
      const result = await comfyPost(url, '/api/prompt', { prompt: wf });
      if (!result.prompt_id) throw new Error(`ComfyUI rejected segment ${i + 1}`);

      const outPath = await waitForVideo(url, result.prompt_id, staging);
      job.rawPaths.push(outPath);
      job.lastSegmentPath = outPath;
      job.segmentLogs.push({ segment: i + 1, durationMs: Date.now() - job.segmentStartedAt });
      persistCurrentJob(job);

      if (i < job.total - 1) {
        job.stage = 'extracting';
        const png = path.join(os.tmpdir(), `mocap-${job.batch}-frame${i + 1}.png`);
        await extractLastFrame(outPath, png);
        refImage = uploadFrameToComfy(url, png);
        fs.unlink(png, () => {});
      }
    }

    job.stage = 'joining';
    const output = path.join(staging, dirPrefix, `mocap-${job.batch}.mp4`);

    let audioPath;
    if (job.audio) {
      const inputDir = comfyInputDir(config);
      const candidate = inputDir ? path.join(inputDir, job.video) : null;
      if (candidate && fs.existsSync(candidate)) {
        audioPath = candidate;
        job.stage = 'joining-audio';
      } else {
        job.warning = 'reference video audio not found — output is silent';
      }
    }

    await joinVideos({ inputs: job.rawPaths, output, audioPath });

    // Verify the join before deleting any raw segments.
    const expected = durations.reduce((a, b) => a + b, 0);
    const actual = await probeDuration(output);
    const ok = fs.existsSync(output) && actual != null && Math.abs(actual - expected) <= Math.max(1.5, expected * 0.15);
    if (!ok) throw new Error(`join verification failed (expected ~${expected}s, got ${actual}s) — raws kept`);

    for (const p of job.rawPaths) { try { fs.unlinkSync(p); } catch {} }

    job.output = output;
    job.stage = 'done';
    job.status = 'done';
    console.log(`[mocap] job ${job.id} done → ${output}`);
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    console.error(`[mocap] job ${job.id} failed:`, err.message);
  } finally {
    clearCurrentJobFile();
    lastJob = job;
    currentJob = null;
    const nextEntry = dequeueJob();
    if (nextEntry) {
      currentJob = jobFromEntry(nextEntry);
      console.log(`[mocap] starting queued job ${currentJob.id} (${readQueue().length} remaining)`);
      runChain(currentJob).catch(err => console.error('[mocap] queued job failed:', err.message));
    }
  }
}

router.post('/api/comfyui/mocap', async (req, res) => {
  const { video, image, prompt, totalDuration, startAt: startAtRaw, seed, audio, forceSingle } = req.body;
  const startAt = (startAtRaw != null && !isNaN(startAtRaw)) ? Math.max(0, Number(startAtRaw)) : 0;
  if (!video) return res.status(400).json({ error: 'video required' });
  if (!image) return res.status(400).json({ error: 'image required' });
  if (queueLength() >= 10) return res.status(429).json({ error: 'Queue is full (max 10 jobs). Wait for some to finish.' });

  let total;
  if (totalDuration != null) {
    total = parseInt(totalDuration);
    if (!total || total < 1) return res.status(400).json({ error: 'totalDuration must be a positive integer' });
  } else {
    const config = loadConfig();
    const inputDir = comfyInputDir(config);
    if (!inputDir) return res.status(400).json({ error: 'comfyInputDir not configured — cannot probe video duration' });
    const videoPath = path.join(inputDir, video);
    const probed = await probeDuration(videoPath).catch(() => null);
    if (!probed || probed < 1) return res.status(400).json({ error: 'Could not determine video duration — specify totalDuration manually' });
    total = Math.max(1, Math.ceil(probed - startAt));
  }

  const now = new Date();
  const batch = `${now.toISOString().slice(0, 10).replace(/-/g, '')}${now.toTimeString().slice(0, 5).replace(':', '')}`;

  const job = {
    id: `mocap-${Date.now()}`,
    batch,
    video, image,
    prompt: prompt?.trim() || '',
    totalDuration: total,
    seed: (seed != null && !isNaN(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 32),
    audio: !!audio,
    startAt,
    total: forceSingle ? 1 : Math.ceil(total / SEG),
    current: 0,
    stage: 'queued',
    status: 'running',
    output: null,
    error: null,
    warning: null,
    startedAt: Date.now(),
    segmentLogs: [],
    segmentStartedAt: null,
  };
  const entry = {
    id: job.id, batch: job.batch, video: job.video, image: job.image,
    prompt: job.prompt, totalDuration: job.totalDuration, startAt: job.startAt,
    seed: job.seed, audio: job.audio, forceSingle: !!forceSingle,
    total: job.total, queuedAt: Date.now(),
  };

  if (currentJob) {
    enqueueJob(entry);
    return res.json({ ok: true, jobId: job.id, segments: job.total, queued: true, position: queueLength() });
  }
  currentJob = job;
  runChain(job).catch(err => console.error('[mocap] job failed:', err.message));

  res.json({ ok: true, jobId: job.id, segments: job.total, queued: false });
});

function publicJob(j) {
  if (!j) return null;
  const { id, batch, status, stage, current, total, output, error, warning, audio, segmentLogs, segmentStartedAt, startedAt } = j;
  return { id, batch, status, stage, current, total, output, error, warning, audio, segmentLogs, segmentStartedAt, startedAt };
}

router.get('/api/comfyui/mocap/status', (req, res) => {
  res.json({ job: publicJob(currentJob || lastJob), queue: readQueue() });
});

// ── Motion Capture 2: SCAIL base + extended chained generation ──────────────
// Uses scail-base-motion for the first segment, then scale-extended-motion for
// subsequent segments. Extended outputs include 5 prepended overlap frames that
// get trimmed before joining. startAt advances by segmentDuration each segment.

const QUEUE_FILE_2 = path.join(__dirname, '..', 'server-queue2.json');
const CURRENT_JOB_FILE_2 = path.join(__dirname, '..', 'server-current-job2.json');

let currentJob2 = null;
let lastJob2 = null;

function readQueue2() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE_2, 'utf8')); } catch { return []; }
}
function writeQueue2(q) {
  try { fs.writeFileSync(QUEUE_FILE_2, JSON.stringify(q, null, 2)); } catch {}
}
function enqueueJob2(entry) {
  const q = readQueue2(); q.push(entry); writeQueue2(q);
}
function dequeueJob2() {
  const q = readQueue2(); if (!q.length) return null;
  const entry = q.shift(); writeQueue2(q); return entry;
}
function queueLength2() { return readQueue2().length; }
function persistCurrentJob2(job) {
  try { fs.writeFileSync(CURRENT_JOB_FILE_2, JSON.stringify(job)); } catch (e) { console.error('[mocap2] persist error:', e.message); }
}
function clearCurrentJobFile2() {
  try { fs.unlinkSync(CURRENT_JOB_FILE_2); } catch {}
}
function jobFromEntry2(entry) {
  return {
    ...entry,
    current: 0, stage: 'queued', status: 'running',
    output: null, error: null, warning: null,
    segmentLogs: [], segmentStartedAt: null,
    rawPaths: [], joinPaths: [], trimmedPaths: [],
  };
}

function uploadVideoToComfy(url, filePath) {
  const out = execFileSync('curl', ['-s', '-F', `image=@${filePath}`, `${url}/api/upload/image`],
    { encoding: 'utf8', timeout: 60000 });
  const r = JSON.parse(out);
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

function buildBaseSegment2(image, video, fps, startAt, segDur, prompt, seed, prefix) {
  const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'scail-base-motion.api.json'), 'utf8'));
  wf['113'].inputs.video = video;
  wf['132'].inputs.value = startAt;
  wf['58'].inputs.image = image;
  wf['126'].inputs.value = segDur;
  wf['135'].inputs.value = fps;
  if (prompt) wf['137'].inputs.text = prompt;
  wf['139'].inputs.seed = seed;
  wf['49'].inputs.filename_prefix = prefix;
  return wf;
}

function buildExtendedSegment2(image, video, prevVideoComfyName, fps, startAt, segDur, prompt, seed, prefix) {
  const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'scale-extended-motion.api.json'), 'utf8'));
  wf['210'].inputs.video = video;
  wf['204'].inputs.value = startAt;
  wf['211'].inputs.image = image;
  wf['203'].inputs.value = segDur;
  wf['201'].inputs.value = fps;
  if (prompt) wf['202'].inputs.text = prompt;
  wf['225'].inputs.file = prevVideoComfyName;
  wf['208'].inputs.seed = seed;
  wf['207'].inputs.filename_prefix = prefix;
  return wf;
}

async function runChain2(job) {
  const config = loadConfig();
  const url = comfyUrl(config);
  const staging = config.roots?.staging;
  const dirPrefix = `${job.batch.slice(0, 8)}/mocap2`;

  const fps = job.fps || 16;
  const segDur = job.segmentDuration || 3;

  if (!job.rawPaths) job.rawPaths = [];
  if (!job.joinPaths) job.joinPaths = [];
  if (!job.trimmedPaths) job.trimmedPaths = [];

  persistCurrentJob2(job);

  try {
    let prevVideoComfyName = null;

    for (let i = 0; i < job.total; i++) {
      const startAt = job.startAt + i * segDur;
      job.current = i + 1;
      job.segmentStartedAt = Date.now();
      job.stage = 'generating';

      const prefix = `${dirPrefix}/mocap2-${job.batch}-seg${String(i + 1).padStart(2, '0')}`;

      const wf = i === 0
        ? buildBaseSegment2(job.image, job.video, fps, startAt, segDur, job.prompt, job.seed, prefix)
        : buildExtendedSegment2(job.image, job.video, prevVideoComfyName, fps, startAt, segDur, job.prompt, job.seed, prefix);

      const result = await comfyPost(url, '/api/prompt', { prompt: wf });
      if (!result.prompt_id) throw new Error(`ComfyUI rejected segment ${i + 1}`);

      const outPath = await waitForVideo(url, result.prompt_id, staging);
      job.rawPaths.push(outPath);
      job.lastSegmentPath = outPath;
      job.segmentLogs.push({ segment: i + 1, durationMs: Date.now() - job.segmentStartedAt });
      persistCurrentJob2(job);

      if (i === 0) {
        // Base segment: use raw output directly for join
        job.joinPaths.push(outPath);
      } else {
        // Extended segment: trim the 5 prepended overlap frames before joining
        job.stage = 'trimming';
        const trimmed = outPath.replace(/\.mp4$/i, '-trimmed.mp4');
        await trimFirstNFrames(outPath, trimmed, 5, fps);
        job.joinPaths.push(trimmed);
        job.trimmedPaths.push(trimmed);
      }
      persistCurrentJob2(job);

      if (i < job.total - 1) {
        // Upload the raw output (with overlap frames intact) for the next extended run
        job.stage = 'uploading';
        prevVideoComfyName = uploadVideoToComfy(url, outPath);
      }
    }

    job.stage = 'joining';
    const output = path.join(staging, dirPrefix, `mocap2-${job.batch}.mp4`);

    let audioPath;
    if (job.audio) {
      const inputDir = comfyInputDir(config);
      const candidate = inputDir ? path.join(inputDir, job.video) : null;
      if (candidate && fs.existsSync(candidate)) {
        audioPath = candidate;
        job.stage = 'joining-audio';
      } else {
        job.warning = 'reference video audio not found — output is silent';
      }
    }

    await joinVideos({ inputs: job.joinPaths, output, audioPath });

    const expected = job.total * segDur;
    const actual = await probeDuration(output);
    const ok = fs.existsSync(output) && actual != null && Math.abs(actual - expected) <= Math.max(2, expected * 0.2);
    if (!ok) throw new Error(`join verification failed (expected ~${expected}s, got ${actual}s) — raws kept`);

    for (const p of job.rawPaths) { try { fs.unlinkSync(p); } catch {} }
    for (const p of job.trimmedPaths) { try { fs.unlinkSync(p); } catch {} }

    job.output = output;
    job.stage = 'done';
    job.status = 'done';
    console.log(`[mocap2] job ${job.id} done → ${output}`);
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    console.error(`[mocap2] job ${job.id} failed:`, err.message);
  } finally {
    clearCurrentJobFile2();
    lastJob2 = job;
    currentJob2 = null;
    const nextEntry = dequeueJob2();
    if (nextEntry) {
      currentJob2 = jobFromEntry2(nextEntry);
      console.log(`[mocap2] starting queued job ${currentJob2.id} (${readQueue2().length} remaining)`);
      runChain2(currentJob2).catch(err => console.error('[mocap2] queued job failed:', err.message));
    }
  }
}

router.post('/api/comfyui/mocap2', async (req, res) => {
  const { video, image, prompt, totalDuration, fps: fpsRaw, startAt: startAtRaw, segmentDuration: segDurRaw, seed, audio } = req.body;
  const startAt = (startAtRaw != null && !isNaN(startAtRaw)) ? Math.max(0, Number(startAtRaw)) : 0;
  const fps = (fpsRaw != null && !isNaN(fpsRaw)) ? Math.max(1, Number(fpsRaw)) : 16;
  const segDur = (segDurRaw != null && !isNaN(segDurRaw)) ? Math.max(1, Number(segDurRaw)) : 3;

  if (!video) return res.status(400).json({ error: 'video required' });
  if (!image) return res.status(400).json({ error: 'image required' });
  if (queueLength2() >= 10) return res.status(429).json({ error: 'Queue is full (max 10 jobs). Wait for some to finish.' });

  let total;
  if (totalDuration != null) {
    total = parseInt(totalDuration);
    if (!total || total < 1) return res.status(400).json({ error: 'totalDuration must be a positive integer' });
  } else {
    const config = loadConfig();
    const inputDir = comfyInputDir(config);
    if (!inputDir) return res.status(400).json({ error: 'comfyInputDir not configured — cannot probe video duration' });
    const videoPath = path.join(inputDir, video);
    const probed = await probeDuration(videoPath).catch(() => null);
    if (!probed || probed < 1) return res.status(400).json({ error: 'Could not determine video duration — specify totalDuration manually' });
    total = Math.max(1, Math.ceil(probed - startAt));
  }

  const now = new Date();
  const batch = `${now.toISOString().slice(0, 10).replace(/-/g, '')}${now.toTimeString().slice(0, 5).replace(':', '')}`;

  const job = {
    id: `mocap2-${Date.now()}`,
    batch,
    video, image,
    prompt: prompt?.trim() || '',
    totalDuration: total,
    fps, segmentDuration: segDur,
    seed: (seed != null && !isNaN(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 32),
    audio: !!audio,
    startAt,
    total: Math.ceil(total / segDur),
    current: 0,
    stage: 'queued',
    status: 'running',
    output: null, error: null, warning: null,
    startedAt: Date.now(),
    segmentLogs: [], segmentStartedAt: null,
    rawPaths: [], joinPaths: [], trimmedPaths: [],
  };

  const entry = {
    id: job.id, batch: job.batch, video: job.video, image: job.image,
    prompt: job.prompt, totalDuration: job.totalDuration, startAt: job.startAt,
    fps: job.fps, segmentDuration: job.segmentDuration,
    seed: job.seed, audio: job.audio, total: job.total, queuedAt: Date.now(),
  };

  if (currentJob2) {
    enqueueJob2(entry);
    return res.json({ ok: true, jobId: job.id, segments: job.total, queued: true, position: queueLength2() });
  }
  currentJob2 = job;
  runChain2(job).catch(err => console.error('[mocap2] job failed:', err.message));

  res.json({ ok: true, jobId: job.id, segments: job.total, queued: false });
});

function publicJob2(j) {
  if (!j) return null;
  const { id, batch, status, stage, current, total, output, error, warning, audio, segmentLogs, segmentStartedAt, startedAt } = j;
  return { id, batch, status, stage, current, total, output, error, warning, audio, segmentLogs, segmentStartedAt, startedAt };
}

router.get('/api/comfyui/mocap2/status', (req, res) => {
  res.json({ job: publicJob2(currentJob2 || lastJob2), queue: readQueue2() });
});

const VIDEO_DIRECTION_SYSTEM = `You are a prompt engineer for OpenOppAI - a short-form AI video content page that animates photorealistic images using LTX 2.3.

Content style: SFW but borderline. Think suggestive, eye-catching, tasteful - not explicit. The goal is allure through motion, that ends up something we can still post on social media, mainly x/twitter.

HARD STOPS - never generate under any circumstances:
- CSAM or anything involving minors
- Full nudity (bare breasts are sometimes fine if the art direction calls for it, but NEVER genitalia)
- Explicit sexual acts or simulated sex
- Non-consensual framing or degrading content

ENCOURAGED within those limits:
- Natural incidental exposure from movement (skirts, loose clothing, wind)
- Idle body motion - leg swings, hair tosses, stretching, leaning
- Confident, candid, or unaware-of-camera poses animated naturally
- Subtle clothing movement that draws attention without crossing the line
- Cinematic locked-camera shots, photorealistic quality
- Exhibitionism or voyeur scenarios
- Upskirts from everyday scenes
- Narrative arc in a single clip: establish -> disruption -> reaction -> action
- Emotional beat changes readable on the face (distraction -> realization -> annoyance)
- "Caught" scenarios where the subject becomes aware of the viewer mid-clip
- Motion that builds toward camera rather than stays neutral
- Gravure shoots, catwalks, elegant pose variations as it fits the image
- Striptease or intimate dancing
- The payoff should feel earned, not just appended

For every image submitted, produce one LTX 2.3 motion prompt that:
1. Describes the subject and setting briefly (grounding)
2. Specifies the exact motion - what moves, how, at what cadence
3. Notes secondary motion (hair, fabric, hands)
4. Locks the camera unless movement is intentional
5. Ends with quality tags: cinematic, photorealistic, shallow depth of field
6. Avoid dreamy slow motion, we aim for natural realistic movements`;

const LTX_NEGATIVE_EXTRA = 'genitalia, sexual acts, graphic content, minors, body distortion, morphing, scene cuts, jump cuts';

function tmux(args) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function ensureRCSession() {
  try {
    await tmux(['has-session', '-t', 'comfyui-mcp']);
    return false;
  } catch {}
  await tmux(['new-session', '-d', '-s', 'comfyui-mcp', '-c', '/home/ervinne/projects/comfyui-mcp', 'claude', '--model', 'claude-sonnet-4-6']);
  await new Promise(r => setTimeout(r, 3000));
  await tmux(['send-keys', '-t', 'comfyui-mcp', '/remote-control', 'Enter']);
  await new Promise(r => setTimeout(r, 5000));
  return true;
}

async function getMotionPrompt(imagePath) {
  const id = `cv-${Date.now()}`;
  const taskFile = path.join(os.tmpdir(), `${id}-task.md`);
  const resultFile = path.join(os.tmpdir(), `${id}-result.txt`);

  fs.writeFileSync(taskFile, [
    '# Creative Video Direction Task',
    '',
    '## Your role',
    VIDEO_DIRECTION_SYSTEM,
    '',
    '## Steps',
    `1. Read the image at: ${imagePath}`,
    '2. Generate one LTX 2.3 motion prompt based on what you see.',
    `3. Write ONLY the prompt text (no labels, no explanation) to: ${resultFile}`,
  ].join('\n'));

  const justStarted = await ensureRCSession();
  if (justStarted) await new Promise(r => setTimeout(r, 2000));

  await tmux(['send-keys', '-t', 'comfyui-mcp', `Creative video direction task: read ${taskFile} for full instructions`, 'Enter']);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const text = fs.readFileSync(resultFile, 'utf8').trim();
      if (text) {
        try { fs.unlinkSync(resultFile); } catch {}
        try { fs.unlinkSync(taskFile); } catch {}
        return text;
      }
    } catch {}
  }
  try { fs.unlinkSync(taskFile); } catch {}
  throw new Error('Timed out waiting for motion prompt from RC session');
}

router.post('/api/comfyui/creative-video', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'path not allowed' });

  const config = loadConfig();
  const url = comfyUrl(config);

  let motionPrompt;
  try {
    motionPrompt = await getMotionPrompt(filePath);
  } catch (err) {
    return res.status(500).json({ error: `Prompt generation failed: ${err.message}` });
  }

  let comfyFilename;
  try {
    const out = execFileSync('curl', ['-s', '-F', `image=@${filePath}`, `${url}/api/upload/image`],
      { encoding: 'utf8', timeout: 30000 });
    const r = JSON.parse(out);
    comfyFilename = r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  } catch (err) {
    return res.status(500).json({ error: `Upload failed: ${err.message}` });
  }

  const filenamePrefix = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/video/ltx-`;
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'ltx-i2v.api.json'), 'utf8'));
  workflow['324'].inputs.image = comfyFilename;
  workflow['320:319'].inputs.value = motionPrompt;
  workflow['320:301'].inputs.value = 5;
  workflow['75'].inputs.filename_prefix = filenamePrefix;
  const seed = Math.floor(Math.random() * 2 ** 32);
  workflow['320:276'].inputs.noise_seed = seed;
  workflow['320:277'].inputs.noise_seed = seed + 1;
  const existingNeg = workflow['320:313']?.inputs?.text || '';
  if (workflow['320:313']) {
    workflow['320:313'].inputs.text = existingNeg ? `${existingNeg}, ${LTX_NEGATIVE_EXTRA}` : LTX_NEGATIVE_EXTRA;
  }

  saveLtxSidecar(config.roots?.staging, filenamePrefix, motionPrompt, seed);

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    res.json({ ok: true, promptId: result.prompt_id, motionPrompt });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

const WORKFLOW_DEFS = {
  'zit-txt2img':     { workflow: 'zit',        label: 'ZIT T2I',    prefixHint: '/zit-',       getPrompt: n => n['57:27']?.inputs?.text   || '', getImage: () => null },
  'qwen-i2i-nsfw':   { workflow: 'qwen-nsfw',  label: 'Qwen I2I',   prefixHint: '/qwen-nsfw-', getPrompt: n => n['12']?.inputs?.text      || '', getImage: n => n['11']?.inputs?.image || null },
  'ltx-i2v':         { workflow: 'ltx-i2v',    label: 'LTX I2V',   prefixHint: '/video/ltx-', getPrompt: n => n['320:319']?.inputs?.value || '', getImage: n => n['324']?.inputs?.image || null },
  'qwen-image-edit': { workflow: 'qwen',        label: 'Qwen Edit',  prefixHint: '/qwen-',      getPrompt: n => n['62']?.inputs?.value     || '', getImage: n => n['47']?.inputs?.image || null },
  'qwen-pose':        { workflow: 'qwen-pose',   label: 'Qwen Pose',  prefixHint: '/qwen-pose',  getPrompt: () => '',                                  getImage: n => n['73']?.inputs?.image  || null },
  'post-process-skin': { workflow: 'skin',        label: 'Skin PP',    prefixHint: '/skin-',      getPrompt: () => '',                                  getImage: n => n['337']?.inputs?.image || null },
  'scail-animation':   { workflow: 'mocap',       label: 'Motion Cap', prefixHint: '/mocap/',     getPrompt: n => n['6']?.inputs?.text       || '', getImage: n => n['58']?.inputs?.image  || null },
};

function extractJobInfo(nodes) {
  const prefix = nodes['9']?.inputs?.filename_prefix
    || nodes['6']?.inputs?.filename_prefix
    || nodes['72']?.inputs?.filename_prefix
    || nodes['75']?.inputs?.filename_prefix
    || nodes['45']?.inputs?.filename_prefix
    || nodes['341']?.inputs?.filename_prefix
    || nodes['49']?.inputs?.filename_prefix
    || '';

  // Primary: _meta label stamped by scripts/label-workflows.sh
  let tag = null;
  for (const node of Object.values(nodes)) {
    if (node?._meta?.asset_server_workflow) { tag = node._meta.asset_server_workflow; break; }
  }
  // Fallback: match filename_prefix
  if (!tag) {
    for (const [name, def] of Object.entries(WORKFLOW_DEFS)) {
      if (prefix.includes(def.prefixHint)) { tag = name; break; }
    }
  }

  const def = tag ? WORKFLOW_DEFS[tag] : null;

  let workflow = def?.workflow || 'unknown';
  let workflowLabel = def?.label || 'Unknown';
  let prompt = def ? def.getPrompt(nodes) : '';
  let image = def ? def.getImage(nodes) : null;

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

router.post('/api/comfyui/qwen-pose', async (req, res) => {
  const { image, poseIndex, negativePrompt, seed } = req.body;
  if (!image) return res.status(400).json({ error: 'image required' });
  const idx = parseInt(poseIndex);
  if (isNaN(idx) || idx < 0 || idx > 3) return res.status(400).json({ error: 'poseIndex must be 0–3' });

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'qwen-pose-options.api.json'), 'utf8'));

  workflow['73'].inputs.image = image;
  workflow['78'].inputs.index = idx;
  workflow['71'].inputs.seed = (seed != null && !isNaN(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 32);
  if (negativePrompt != null) workflow['75'].inputs.text = negativePrompt;
  workflow['72'].inputs.filename_prefix = datePrefix('qwen-pose');

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

router.post('/api/comfyui/post-process-skin', async (req, res) => {
  const { image, denoise, seed } = req.body;
  if (!image) return res.status(400).json({ error: 'image required' });

  const denoiseVal = (denoise != null && !isNaN(denoise))
    ? Math.min(0.6, Math.max(0.15, Number(denoise) / 100))
    : 0.15;

  const url = comfyUrl(loadConfig());
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, 'post-process-skin.api.json'), 'utf8'));

  workflow['337'].inputs.image = image;
  workflow['339:294'].inputs.denoise = denoiseVal;
  workflow['339:294'].inputs.seed = (seed != null && !isNaN(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 32);
  workflow['341'].inputs.filename_prefix = datePrefix('skin');

  try {
    const result = await comfyPost(url, '/api/prompt', { prompt: workflow });
    res.json({ ok: true, promptId: result.prompt_id });
  } catch (err) {
    res.status(500).json({ error: `ComfyUI submit failed: ${err.message}` });
  }
});

// On startup, resume any interrupted or queued jobs.
setTimeout(async () => {
  if (currentJob) return;

  // First: try to resume a job that was running when the server last stopped.
  try {
    const interrupted = JSON.parse(fs.readFileSync(CURRENT_JOB_FILE, 'utf8'));
    if (interrupted?.id && interrupted.current < interrupted.total) {
      console.log(`[mocap] resuming interrupted job ${interrupted.id} from segment ${interrupted.current + 1}`);
      currentJob = { ...interrupted, status: 'running', stage: 'queued', segmentStartedAt: null };
      let resumeLastFrame = null;
      if (interrupted.current > 0 && interrupted.lastSegmentPath) {
        try {
          const config = loadConfig();
          const url = comfyUrl(config);
          const png = path.join(os.tmpdir(), `mocap-${interrupted.batch}-resume.png`);
          await extractLastFrame(interrupted.lastSegmentPath, png);
          resumeLastFrame = uploadFrameToComfy(url, png);
          fs.unlink(png, () => {});
        } catch (e) {
          console.error('[mocap] resume: last-frame extraction failed:', e.message, '— raws kept');
          lastJob = { ...currentJob, status: 'error', error: 'Resume failed (frame extraction error) — raws kept' };
          currentJob = null;
          clearCurrentJobFile();
        }
      }
      if (currentJob) {
        runChain(currentJob, interrupted.current, resumeLastFrame)
          .catch(err => console.error('[mocap] resumed interrupted job failed:', err.message));
        return;
      }
    } else {
      clearCurrentJobFile();
    }
  } catch { /* no interrupted job file */ }

  // Then: resume any jobs waiting in the file queue.
  const entry = dequeueJob();
  if (entry) {
    console.log(`[mocap] resuming queued job ${entry.id} after server start`);
    currentJob = jobFromEntry(entry);
    runChain(currentJob).catch(err => console.error('[mocap] resumed job failed:', err.message));
  }
}, 3000);

// On startup, resume any queued mocap2 jobs (interrupted jobs restart from scratch
// since prevVideoComfyName state is lost).
setTimeout(() => {
  if (currentJob2) return;
  try {
    const interrupted = JSON.parse(fs.readFileSync(CURRENT_JOB_FILE_2, 'utf8'));
    if (interrupted?.id) {
      console.log(`[mocap2] interrupted job ${interrupted.id} found — marking as error (cannot resume mid-chain)`);
      lastJob2 = { ...interrupted, status: 'error', error: 'Server restarted mid-chain — raws kept, restart job manually' };
      clearCurrentJobFile2();
    }
  } catch { /* no interrupted job file */ }

  const entry = dequeueJob2();
  if (entry) {
    console.log(`[mocap2] resuming queued job ${entry.id} after server start`);
    currentJob2 = jobFromEntry2(entry);
    runChain2(currentJob2).catch(err => console.error('[mocap2] resumed job failed:', err.message));
  }
}, 4000);

module.exports = router;
