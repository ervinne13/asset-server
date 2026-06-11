const express = require('express');
const router = express.Router();
const farmer = require('../lib/content-farmer');

router.get('/api/content-farmer/status', (req, res) => {
  res.json(farmer.getStatus());
});

router.post('/api/content-farmer/start', (req, res) => {
  const {
    systemPrompt,
    theme,
    promptCount = 3,
    imagesPerPrompt = 2,
    continuous = false,
    seed,
  } = req.body;

  if (!theme?.trim()) return res.status(400).json({ error: 'theme required' });
  if (!systemPrompt?.trim()) return res.status(400).json({ error: 'systemPrompt required' });

  const resolvedSeed = continuous
    ? (parseInt(seed) || Math.floor(Math.random() * 2 ** 32))
    : undefined;

  farmer.start({
    systemPrompt: systemPrompt.trim(),
    theme: theme.trim(),
    promptCount: Math.min(Math.max(parseInt(promptCount) || 3, 1), 10),
    imagesPerPrompt: Math.min(Math.max(parseInt(imagesPerPrompt) || 2, 1), 4),
    continuous: !!continuous,
    seed: resolvedSeed,
  });

  res.json({ ok: true });
});

router.post('/api/content-farmer/stop', (req, res) => {
  farmer.stop();
  res.json({ ok: true });
});

module.exports = router;
