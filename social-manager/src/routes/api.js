const path = require('path');
const express = require('express');
const { runDailyPost } = require('../services/postJob');
const { readHistory } = require('../services/historyStore');
const { listPhotos } = require('../services/photoLibrary');

const router = express.Router();

// How many photos are currently loaded in assets/photos, and their
// filenames — useful for confirming an upload actually landed in the right
// place before it starts getting used.
router.get('/photos', async (req, res) => {
  try {
    const photos = await listPhotos();
    res.json({
      count: photos.length,
      filenames: photos.map((p) => path.basename(p)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Generates content + image WITHOUT posting to Facebook/Instagram — lets you
// see what today's post would look like before it goes out automatically.
// An optional ?postType=... query param (travel_quote, travel_tip,
// destination_spotlight, illustration, or checklist) overrides the normal
// day-based rotation, purely for testing — so you can preview every post
// type today instead of waiting for each one to come up naturally.
router.post('/preview', async (req, res) => {
  try {
    const { postType } = req.query;
    const result = await runDailyPost({ dryRun: true, postType });
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