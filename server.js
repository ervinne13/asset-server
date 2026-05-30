const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');

const app = express();

let APP_VERSION;
try {
  APP_VERSION = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
} catch {
  APP_VERSION = Date.now().toString();
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use(require('./routes/files'));
app.use(require('./routes/bookmarks'));
app.use(require('./routes/move'));
app.use(require('./routes/trash'));
app.use(require('./routes/tags'));
app.use(require('./routes/index-search'));
app.use(require('./routes/comfyui'));
app.use(require('./routes/saved-prompts').router);
app.use(require('./routes/claude'));

// ── SPA fallback ──────────────────────────────────────────────────────────────

const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

app.get('*', (req, res) => {
  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  html = html.replace(/((?:src|href)=")(\/[^"]+\.(?:js|css))(")/g, `$1$2?v=${APP_VERSION}$3`);
  res.type('html').set('Cache-Control', 'no-cache').send(html);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const config = loadConfig();
const port = config.port || 3000;
app.listen(port, () => console.log(`Asset Server → http://localhost:${port}`));
