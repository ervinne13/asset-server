const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function isAllowedPath(p) {
  const roots = Object.values(loadConfig().roots || {}).filter(Boolean);
  return roots.some(root => p === root || p.startsWith(root + '/'));
}

module.exports = { loadConfig, saveConfig, isAllowedPath };
