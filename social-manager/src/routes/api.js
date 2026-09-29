const path = require('path');
const express = require('express');
const { runDailyPost, runGiveawayPost, runReelPost } = require('../services/postJob');
const { readHistory } = require('../services/historyStore');
const { listPhotos } = require('../services/photoLibrary');
const { getActiveGiveaway } = require('../services/giveawayService');

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

// Summarizes which of the real photos (see sourcePhotoFile on each history
// entry) have actually appeared in a real post, and how many times each —
// built from history, not a separate tracking system, so it always matches
// what genuinely got posted. dryRun previews are excluded, since they don't
// represent a real post going out.
router.get('/photo-usage', async (req, res) => {
  try {
    const [allPhotos, history] = await Promise.all([listPhotos(), readHistory()]);
    const filenames = allPhotos.map((p) => path.basename(p));

    const counts = {};
    for (const entry of history) {
      if (entry.dryRun || !entry.sourcePhotoFile) continue;
      counts[entry.sourcePhotoFile] = (counts[entry.sourcePhotoFile] || 0) + 1;
    }

    const used = filenames.filter((f) => counts[f]).length;

    res.json({
      totalPhotos: filenames.length,
      usedAtLeastOnce: used,
      neverUsed: filenames.length - used,
      counts, // { filename: timesUsed } — only includes photos used at least once
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checks whether a giveaway is currently active, without generating
// content or posting anything — useful for confirming the connection to
// the main site's giveaway API works, and for seeing what data it's
// currently returning.
router.get('/giveaway-status', async (req, res) => {
  try {
    const giveaway = await getActiveGiveaway();
    res.json({ active: !!giveaway, giveaway });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates a giveaway post's content + image WITHOUT posting — same
// dry-run pattern as /preview. If no giveaway is currently active, returns
// { skipped: true } rather than an error, since that's the expected result
// on any day without a live giveaway.
router.post('/giveaway-preview', async (req, res) => {
  try {
    const result = await runGiveawayPost({ dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a real giveaway post right now, in addition to the daily
// schedule — only actually posts if a giveaway is currently active.
router.post('/giveaway-post-now', async (req, res) => {
  try {
    const result = await runGiveawayPost({ dryRun: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates a Reel (video + headline + caption) WITHOUT posting — same
// dry-run pattern as /preview, but meaningfully slower (a few seconds of
// real FFmpeg encoding), since there's no cheap way to preview a video
// that's actually representative of what would really get posted.
router.post('/reel-preview', async (req, res) => {
  try {
    const result = await runReelPost({ dryRun: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a real Reel post right now, in addition to the daily
// 11am schedule. This posts to BOTH Facebook and Instagram Reels for
// real — there is no "just testing" version of this one.
router.post('/reel-post-now', async (req, res) => {
  try {
    const result = await runReelPost({ dryRun: false });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug-only: retries JUST the Facebook Reel publish step against an
// already-generated video's public URL — e.g. one from a previous
// /reel-post-now attempt where Instagram already succeeded but Facebook
// failed. Lets you retest the Facebook side in isolation without
// generating new content or creating a second Instagram post for the same
// attempt. Body: { videoUrl, caption }.
// Debug-only: retries JUST the Facebook Reel publish step against an
// already-generated video already sitting in public/previews/ — e.g. from
// a previous /reel-post-now attempt where Instagram already succeeded but
// Facebook failed. Lets you retest the Facebook side in isolation without
// generating new content or creating a second Instagram post for the same
// attempt. Body: { videoFileName, caption } — videoFileName is just the
// filename (e.g. "8298ed64-....mp4"), not a full URL or path.
router.post('/debug-facebook-reel', async (req, res) => {
  const { videoFileName, caption } = req.body || {};
  if (!videoFileName || !caption) {
    return res.status(400).json({ error: 'Body must include videoFileName and caption.' });
  }
  try {
    const { postReelToFacebook } = require('../services/facebookService');
    const videoFilePath = path.join(__dirname, '..', '..', 'public', 'previews', videoFileName);
    const result = await postReelToFacebook({ videoFilePath, caption });
    res.json({ facebook: result });
  } catch (err) {
    const message = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: message });
  }
});

module.exports = router;