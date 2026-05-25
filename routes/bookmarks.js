const express = require('express');
const { loadConfig, saveConfig } = require('../lib/config');

const router = express.Router();

router.get('/api/bookmarks', (req, res) => res.json(loadConfig().bookmarks || []));

router.post('/api/bookmarks', (req, res) => {
  const config = loadConfig();
  config.bookmarks = req.body;
  saveConfig(config);
  res.json({ ok: true });
});

module.exports = router;
