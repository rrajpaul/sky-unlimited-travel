const express = require('express');
const { runDailyPost } = require('../services/postJob');
const { readHistory } = require('../services/historyStore');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Generates content + image WITHOUT posting to Facebook/Instagram — lets you
// see what today's post would look like before it goes out automatically.
router.post('/preview', async (req, res) => {
  try {
    const result = await runDailyPost({ dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a real post right now (in addition to the daily schedule).
router.post('/post-now', async (req, res) => {
  try {
    const result = await runDailyPost({ dryRun: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 500);
  const history = await readHistory();
  res.json(history.slice(0, limit));
});

module.exports = router;
