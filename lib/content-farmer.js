const { execFile } = require('child_process');
const { comfyGet } = require('./comfyui');
const { loadConfig } = require('./config');
const fs = require('fs');
const path = require('path');

const STATE_FILE   = path.join(__dirname, '..', 'server-state.json');
const HISTORY_FILE = path.join(__dirname, '..', 'farm-history.json');
const PROMPT_LOG   = '/home/ervinne/projects/comfyui-mcp/prompt-log.md';

// ── Persistence ───────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { contentFarmerEnabled: false }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function comfyUrl() {
  return loadConfig().comfyuiUrl || 'http://localhost:8188';
}

function tmux(args) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function sessionRunning() {
  return tmux(['has-session', '-t', 'comfyui-mcp']).then(() => true).catch(() => false);
}

// ── Prompt log ────────────────────────────────────────────────────────────────

function readPromptLog() {
  try { return fs.readFileSync(PROMPT_LOG, 'utf8'); }
  catch { return ''; }
}

// ── Farm history (unbounded, persists across restarts) ────────────────────────

const seenSlugs = new Set();

function loadExistingHistory() {
  try {
    const entries = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    entries.forEach(e => seenSlugs.add(e.slug));
  } catch {}
}

function syncHistory() {
  const lines = readPromptLog().split('\n').filter(l => /^\d+\.\s*\[/.test(l.trim()));
  let history = [];
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  let changed = false;
  for (const line of lines) {
    const m = line.match(/^\d+\.\s*\[(.+?)\]\s*(.+)$/);
    if (!m) continue;
    const slug = m[2].trim();
    if (!seenSlugs.has(slug)) {
      seenSlugs.add(slug);
      history.push({ date: m[1].trim(), slug });
      changed = true;
    }
  }
  if (changed) {
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2)); }
    catch (e) { console.error('[content-farmer] Failed to write history:', e.message); }
  }
}

function getHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return []; }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function buildFarmPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    'Content farm task — use your MCP tools: ' +
    '(1) Read prompt-log.md to see recent entries. ' +
    '(2) Invent the next composition: gravure-bold "accidental private moment" aesthetic, ' +
    'voyeur POV, subject always unselfconscious. Never tame — push toward implied nudity when it fits the scene. ' +
    'Bare skin and bare breasts are acceptable; if nipples would be visible, have the subject cover them naturally ' +
    '(hands, fabric edge, arm) rather than censoring or avoiding the shot entirely. Genitals never. ' +
    '(3) Every 4–5 entries, throw in an absurdist curveball: a tokusatsu or pop-culture figure ' +
    '(Kamen Rider, Super Sentai, Ultraman, etc.) appears in the background, completely out of place, ' +
    'blurred by shallow depth of field, minding their own business — checking their phone, reading a newspaper, ' +
    'waiting for a bus. The foreground subject is unaware. Deadpan. No acknowledgement of the absurdity. ' +
    '(4) Rotate categories, avoid any already in the log: ' +
    'teacher-upskirt, interview-format, stockings/leggings, worm-angle, armpit/stretch, ' +
    'candid-domestic, environmental-tease, fashion/lifestyle, candid-outdoor, ' +
    'wrong-place, uniform-corruption, voyeur-window, bondage-restrained, ' +
    'exhibitionism-upskirt, pole-dance, onsen-bath, gym-low-angle, absurdist-curveball. ' +
    '(5) Queue ZIT T2I with your MCP tool, width 768 height 1152. ' +
    '(6) Wait for ZIT to complete, then queue LTX I2V on the output image using your MCP tool. ' +
    `(7) Append one line to prompt-log.md: "N. [${today}] kebab-slug — one line scene description". ` +
    'Keep max 6 lines, drop the oldest if needed.'
  );
}

// farmState: 'idle' | 'sent' | 'running'
// idle   — queue empty, ready to send next task
// sent   — prompt dispatched to Claude, waiting for it to queue something
// running — ComfyUI jobs active, wait for them to finish
let farmState = 'idle';
let stateChangedAt = 0;
let lastError = null;
const SENT_TIMEOUT_MS = 10 * 60 * 1000; // if Claude hasn't queued anything in 10 min, retry

async function requestNewComposition() {
  if (!await sessionRunning()) throw new Error('Remote Control session is not running');
  const taskFile = path.join(path.dirname(PROMPT_LOG), 'farm-task.txt');
  fs.writeFileSync(taskFile, buildFarmPrompt());
  // Send a short command — long strings trigger Claude Code's paste-detection UI
  await tmux(['send-keys', '-t', 'comfyui-mcp', 'Read farm-task.txt and follow the instructions exactly.', 'Enter']);
  console.log('[content-farmer] task written to farm-task.txt, command sent');
}

async function tick() {
  const state = loadState();
  if (!state.contentFarmerEnabled) return;

  try {
    const queue = await comfyGet(comfyUrl(), '/api/queue');
    const pending = (queue.queue_pending || []).length;
    const running = (queue.queue_running || []).length;
    const queueActive = pending > 0 || running > 0;

    if (farmState === 'idle') {
      if (!queueActive) {
        farmState = 'sent';
        stateChangedAt = Date.now();
        lastError = null;
        requestNewComposition().catch(err => {
          console.error('[content-farmer] send failed:', err.message);
          lastError = err.message;
          farmState = 'idle';
        });
      }
    } else if (farmState === 'sent') {
      if (queueActive) {
        farmState = 'running';
        stateChangedAt = Date.now();
      } else if (Date.now() - stateChangedAt > SENT_TIMEOUT_MS) {
        console.warn('[content-farmer] timeout: Claude did not queue anything, retrying');
        farmState = 'idle';
      }
    } else if (farmState === 'running') {
      if (!queueActive) {
        syncHistory();
        farmState = 'idle';
      }
    }
  } catch (err) {
    console.error('[content-farmer] tick error:', err.message);
    lastError = err.message;
  }
}

let interval = null;

function start() {
  if (interval) return;
  loadExistingHistory();
  syncHistory();
  interval = setInterval(tick, 15000);
  setInterval(syncHistory, 30000);
  console.log('[content-farmer] scheduler started');
}

function isEnabled() {
  return loadState().contentFarmerEnabled;
}

function setEnabled(enabled) {
  const s = loadState();
  s.contentFarmerEnabled = Boolean(enabled);
  saveState(s);
  if (!enabled) {
    farmState = 'idle';
    stateChangedAt = 0;
    lastError = null;
  }
}

function getState() {
  return {
    enabled: isEnabled(),
    farmState,
    lastError,
  };
}

module.exports = { start, isEnabled, setEnabled, getHistory, getState, tick };
