const http = require('http');
const fs = require('fs');

function comfyGet(baseUrl, urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const req = http.get({
      hostname: u.hostname,
      port: parseInt(u.port) || 80,
      path: u.pathname,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
  });
}

function comfyPost(baseUrl, urlPath, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const u = new URL(urlPath, baseUrl);
    const req = http.request({
      hostname: u.hostname,
      port: parseInt(u.port) || 80,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

const CLIP_TYPES = new Set([
  'CLIPTextEncode', 'CLIPTextEncodeSDXL', 'CLIPTextEncodeSDXLRefiner',
  'smZ CLIPTextEncode', 'BNK_CLIPTextEncodeAdvanced',
]);

const TEXT_ENTRY_TYPES = new Set([
  ...CLIP_TYPES,
  'TextEncodeQwenImageEditPlus',
  'CLIPTextEncodeFlux',
]);

function readPngTextChunks(filePath) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return {}; }
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return {};
  const result = {};
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type   = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IEND') break;
    if (type === 'tEXt' && offset + 8 + length <= buf.length) {
      const data    = buf.subarray(offset + 8, offset + 8 + length);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = data.toString('ascii', 0, nullIdx);
        result[key] = data.toString('utf8', nullIdx + 1);
      }
    }
    offset += 12 + length;
  }
  return result;
}

// Yields every node recursively, descending into subgraph children.
function* iterNodes(nodes) {
  for (const node of nodes) {
    yield node;
    if (Array.isArray(node.nodes)) yield* iterNodes(node.nodes);
  }
}

function extractPrompts(workflowJson) {
  try {
    const wf = JSON.parse(workflowJson);
    const prompts = [];

    if (Array.isArray(wf.nodes)) {
      for (const node of iterNodes(wf.nodes)) {
        const text = node.widgets_values?.[0];
        if (typeof text !== 'string' || !text.trim()) continue;
        if (TEXT_ENTRY_TYPES.has(node.type) || node.type === 'PrimitiveStringMultiline') {
          prompts.push({ title: node.title || node.type, text: text.trim() });
        }
      }
    } else {
      const TEXT_KEYS = ['text', 'prompt', 'value', 'text_a', 'text_b'];
      const seen = new Set();

      function collectText(nodeId, fallbackTitle) {
        if (seen.has(nodeId)) return;
        seen.add(nodeId);
        const node = wf[nodeId];
        if (!node) return;
        const title = node._meta?.title || fallbackTitle || node.class_type;
        for (const key of TEXT_KEYS) {
          const val = (node.inputs || {})[key];
          if (typeof val === 'string' && val.trim()) {
            prompts.push({ title, text: val.trim() });
          } else if (Array.isArray(val) && typeof val[0] === 'string') {
            collectText(val[0], title);
          }
        }
      }

      for (const [id, node] of Object.entries(wf)) {
        if (!TEXT_ENTRY_TYPES.has(node.class_type)) continue;
        const title = node._meta?.title || node.class_type;
        for (const key of ['text', 'prompt']) {
          const val = (node.inputs || {})[key];
          if (typeof val === 'string' && val.trim()) {
            seen.add(id);
            prompts.push({ title, text: val.trim() });
          } else if (Array.isArray(val) && typeof val[0] === 'string') {
            collectText(val[0], title);
          }
        }
      }

      for (const [id, node] of Object.entries(wf)) {
        if (node.class_type === 'PrimitiveStringMultiline' && !seen.has(id)) {
          const val = node.inputs?.value;
          if (typeof val === 'string' && val.trim()) {
            prompts.push({ title: node._meta?.title || 'Prompt', text: val.trim() });
          }
        }
      }
    }

    return prompts;
  } catch { return []; }
}

const KSAMPLER_TYPES = new Set([
  'KSampler', 'KSamplerAdvanced', 'KSamplerSelect', 'SamplerCustom',
  'KSamplerAdvancedPipe', 'KSamplerPipe',
]);

function isRGThreeSeedType(t) {
  const l = t.toLowerCase();
  return l.includes('rgthree') && l.includes('seed');
}

function extractSeed(workflowJson) {
  try {
    const wf = JSON.parse(workflowJson);

    if (Array.isArray(wf.nodes)) {
      // Visual workflow — recurse into subgraphs.
      // Prefer RGThree seed nodes (KSampler drops seed from widgets_values when linked).
      let kSeed = null;
      for (const node of iterNodes(wf.nodes)) {
        if (!node.type) continue;
        if (isRGThreeSeedType(node.type)) {
          const s = node.widgets_values?.[0];
          if (typeof s === 'number') return s;
        }
        if (!kSeed && (node.type.includes('KSampler') || node.type === 'RandomNoise')) {
          const s = node.widgets_values?.[0];
          if (typeof s === 'number') kSeed = s;
        }
      }
      if (kSeed !== null) return kSeed;
    } else {
      // API prompt format — subgraph nodes have ids like "57:3", already flat.
      // Follow link references when seed is wired from an external node.
      for (const node of Object.values(wf)) {
        if (!node.class_type) continue;
        if (isRGThreeSeedType(node.class_type)) {
          const s = node.inputs?.seed ?? node.inputs?.value;
          if (typeof s === 'number') return s;
        }
      }
      for (const node of Object.values(wf)) {
        if (!node.class_type) continue;
        if (!(KSAMPLER_TYPES.has(node.class_type) || node.class_type.includes('KSampler') || node.class_type === 'RandomNoise')) continue;
        let seed = node.inputs?.seed ?? node.inputs?.noise_seed;
        // Linked seed: ["source_node_id", output_slot] — follow to source node.
        if (Array.isArray(seed) && typeof seed[0] === 'string') {
          const src = wf[seed[0]];
          if (src) seed = src.inputs?.value ?? src.inputs?.seed;
        }
        if (typeof seed === 'number') return seed;
      }
    }
  } catch {}
  return null;
}

module.exports = { comfyGet, comfyPost, readPngTextChunks, extractPrompts, extractSeed };
