const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { comfyGet, comfyPost } = require('./comfyui');

const LM_STUDIO_DEFAULT = 'http://personal-macbook-m2.tail0cda6c.ts.net:5506';
const LM_MODEL = 'gemma-4-e4b-it-uncensored';
const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');
const QUEUE_THRESHOLD = 1;
const CHECK_INTERVAL_MS = 60 * 1000;

const state = {
  running: false,
  config: null,
  timer: null,
  log: [],     // { msg, at }
  history: [], // { prompt, seed, promptId, queuedAt }
};

function addLog(msg) {
  state.log.unshift({ msg, at: Date.now() });
  if (state.log.length > 100) state.log.pop();
  console.log(`[content-farmer] ${msg}`);
}

function comfyUrl() {
  return loadConfig().comfyuiUrl || 'http://localhost:8188';
}

function datePrefix() {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const t = now.toTimeString().slice(0, 5).replace(':', '');
  return `${d}/zit-${d}${t}`;
}

async function generatePrompts(systemPrompt, theme, count, continuous) {
  const config = loadConfig();
  const lmUrl = (config.lmStudioUrl || LM_STUDIO_DEFAULT).replace(/\/$/, '');

  const userMsg = continuous
    ? `Base theme: ${theme}\n\nGenerate ${count} image prompts that are all variations of the same scene. Keep the character appearance, clothing, setting, and lighting identical across all prompts. Vary only the pose, angle, or expression. Output only the prompts, separated by blank lines.`
    : `Theme: ${theme}\n\nGenerate ${count} image prompts. Output only the prompts, separated by blank lines.`;

  const res = await fetch(`${lmUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 2000,
      temperature: 0.85,
    }),
  });

  if (!res.ok) throw new Error(`LM Studio responded ${res.status}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';

  return raw
    .split(/\n{2,}|\n(?=\d+[\.\)])/g)
    .map(p => p.replace(/^\d+[\.\)]\s*/, '').replace(/^\*+\s*/, '').trim())
    .filter(p => p.length > 10);
}

async function getQueueDepth() {
  const queue = await comfyGet(comfyUrl(), '/api/queue');
  return (queue.queue_running?.length ?? 0) + (queue.queue_pending?.length ?? 0);
}

async function queueJob(prompt, seed) {
  const workflow = JSON.parse(
    fs.readFileSync(path.join(WORKFLOWS_DIR, 'zit-txt2img.api.json'), 'utf8')
  );
  workflow['57:27'].inputs.text = prompt;
  workflow['57:3'].inputs.seed = (seed != null && !isNaN(seed))
    ? seed
    : Math.floor(Math.random() * 2 ** 32);
  workflow['9'].inputs.filename_prefix = datePrefix();

  const result = await comfyPost(comfyUrl(), '/api/prompt', { prompt: workflow });
  return result.prompt_id;
}

async function tick() {
  if (!state.running) return;

  try {
    const depth = await getQueueDepth();
    addLog(`Queue depth: ${depth}`);

    if (depth <= QUEUE_THRESHOLD) {
      const { systemPrompt, theme, promptCount, imagesPerPrompt, continuous, seed } = state.config;
      addLog(`Refilling — asking LM Studio for ${promptCount} prompts…`);

      const prompts = await generatePrompts(systemPrompt, theme, promptCount, continuous);
      addLog(`Got ${prompts.length} prompts`);

      for (const prompt of prompts) {
        const jobSeed = continuous ? seed : undefined;
        for (let i = 0; i < imagesPerPrompt; i++) {
          try {
            const promptId = await queueJob(prompt, jobSeed);
            state.history.unshift({ prompt, seed: jobSeed ?? null, promptId, queuedAt: Date.now() });
            if (state.history.length > 300) state.history.pop();
          } catch (err) {
            addLog(`Queue error: ${err.message}`);
          }
        }
      }

      addLog(`Queued ${prompts.length * imagesPerPrompt} jobs total`);
    } else {
      addLog('Queue has items — waiting');
    }
  } catch (err) {
    addLog(`Tick error: ${err.message}`);
  }

  if (state.running) {
    state.timer = setTimeout(tick, CHECK_INTERVAL_MS);
    addLog('Next check in 60s');
  }
}

function start(config) {
  if (state.running) stop();
  state.running = true;
  state.config = config;
  state.log = [];
  addLog('Started');
  tick();
}

function stop() {
  state.running = false;
  clearTimeout(state.timer);
  state.timer = null;
  addLog('Stopped');
}

function getStatus() {
  return {
    running: state.running,
    config: state.config,
    log: state.log,
    history: state.history,
  };
}

module.exports = { start, stop, getStatus };
